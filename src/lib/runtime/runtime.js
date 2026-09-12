'use strict';

/**
 * Runtime layer: server preparation, bot registration, and the runtime factory.
 */

const fs = require('fs');
const path = require('path');
const { ScreepsServer } = require('@cool-andre/screeps-server-mockup');
const { createStorageAdapter } = require('./storageAdapter');
const { loadBotModules } = require('./loadBot');
const { getFreePort } = require('./port');
const { TestBot } = require('./testBot');
const { createDispose } = require('./cleanup');
const { computeAdjacentBorders } = require('./roomUtils');
const { getTerrainMatrixClass } = require('./terrain');
const { ensureEngineSnapshotCompat } = require('./engineSnapshot');
const { FrameworkError } = require('../errors');

/**
 * @typedef {import('../types').ScreepsServer} ScreepsServer
 * @typedef {import('./storageAdapter').StorageAdapter} StorageAdapter
 * @typedef {import('../types').Bot} Bot
 * @typedef {import('../types').BotSpec} BotSpec
 * @typedef {import('../types').RuntimeOpts} RuntimeOpts
 * @typedef {import('../types').RuntimeResult} RuntimeResult
 * @typedef {import('../types').PrepareServerOpts} PrepareServerOpts
 * @typedef {import('../types').PreparedServer} PreparedServer
 * @typedef {import('../types').AddBotsOpts} AddBotsOpts
 * @typedef {import('../types').AddedBots} AddedBots
 * @typedef {import('../types').DisposeFn} DisposeFn
 */

// ─── Framework defaults ──────────────────────────────────────────────────────────

/** @type {number} */
const DEFAULT_BOT_CPU = 100;
/** @type {number} */
const DEFAULT_BOT_CPU_AVAILABLE = 10000;
/** @type {number} */
const DEFAULT_BOT_GCL = 1;
/** @type {number} */
const DEFAULT_BOT_ACTIVE = 10000;
/** @type {string} */
const DEFAULT_BOT_BRANCH = 'default';
/** @type {number} Max storage startup attempts before giving up */
const STORAGE_START_MAX_ATTEMPTS = 3;

/**
 * Creates a mockup server, rooms, and terrain.
 *
 * Runtime does not create game objects: controller and other room objects
 * are materialised through builders. This keeps controller optional
 * for rooms without bots or without a controller in the spec.
 *
 * The server is intentionally not started until bots and materialize objects
 * are added. `addBot` works with a prepared but not yet started server,
 * just like in the previous pipeline.
 *
 * Terrain borders are exit-aware: walls are placed only on edges that do NOT
 * face another declared room. Adjacent rooms in `opts.rooms` have open borders
 * so `Game.map.describeExits` correctly reports exits between them.
 *
 * @param {PrepareServerOpts} opts
 * @returns {Promise<PreparedServer>}
 */
async function prepareServer(opts) {
    if (!opts.rooms || opts.rooms.length === 0) {
        throw new Error('prepareServer: opts.rooms is required and must be a non-empty array');
    }

    // Safety net for direct createWorld/createRuntime usage outside the CLI:
    // regenerate the @screeps/driver engine snapshot when the installed blob
    // was built by a different Node/V8 version. The CLI runner performs this
    // check eagerly before forking workers, so here it is normally a no-op
    // (a single stamp-file read). Must run before the server starts any
    // engine process (fail loud, fail early).
    ensureEngineSnapshotCompat();

    const cacheDir = opts.cacheDir || path.join(__dirname, '..', '.cache', String(process.pid));

    // screeps-server-mockup writes logs to ./server/logs relative to cwd.
    // Create the directory automatically so users don't have to maintain
    // it manually in their repository.
    fs.mkdirSync(path.join(process.cwd(), 'server', 'logs'), { recursive: true });

    // Parallel workers can collide on the same ephemeral port: getFreePort
    // has a probe→release window before the storage child binds it. Retry
    // with a fresh port instead of failing the scenario.
    const maxAttempts = opts.port ? 1 : STORAGE_START_MAX_ATTEMPTS;
    /** @type {ScreepsServer|null} */
    let server = null;
    let engineWatch = null;
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const port = opts.port ?? (await getFreePort());
        const candidate = new ScreepsServer({ path: cacheDir, port });
        const candidateWatch = attachEngineWatch(candidate);
        try {
            await candidate.world.reset();
            server = candidate;
            engineWatch = candidateWatch;
            break;
        } catch (e) {
            candidateWatch.dispose();
            try {
                candidate.stop();
            } catch {
                // The server never fully started — nothing to stop.
            }
            lastError = e;
            if (attempt < maxAttempts) {
                console.error(
                    `[prepareServer] storage startup failed (attempt ${attempt}/${maxAttempts}): ` +
                        `${e.message ?? String(e)} — retrying with a new port...`,
                );
            }
        }
    }
    if (!server) {
        throw lastError;
    }

    const adapter = createStorageAdapter(server);

    // Compute which borders face adjacent declared rooms
    const adjacencyMap = computeAdjacentBorders(opts.rooms);

    for (const roomName of opts.rooms) {
        await prepareRoom(adapter, roomName, adjacencyMap[roomName]);
    }

    return { server, adapter, dispose: createDispose(server, adapter, cacheDir), engineWatch };
}

/**
 * Adds bots to a prepared server.
 *
 * Runtime-level function: inserts user, memory, code, console, and
 * attaches the bot to ACTIVE_ROOMS. **Does not touch** controller and **does not
 * auto-insert** spawn — those objects belong entirely to the materialize layer.
 *
 * @param {AddBotsOpts} opts
 * @returns {Promise<AddedBots>}
 */
async function addBots(opts) {
    /** @type {BotSpec[]} */
    const botsList = opts.bots || [];
    /** @type {Object<string,Bot>} */
    const bots = {};
    /** @type {Object<string,import('../types').ResolvedBotSpec>} */
    const resolvedBots = {};

    for (const b of botsList) {
        // Validate — 'room' (singular) was renamed to 'rooms' (plural)
        if (b.room !== undefined) {
            const hint = typeof b.room === 'string' ? `rooms: '${b.room}'` : 'rooms: <value>';
            throw new Error(
                `addBots: BotSpec for "${b.username}" uses unknown field 'room' (singular). ` +
                    `The field has been renamed to 'rooms' (plural). Replace \`room: ...\` with \`${hint}\`.`,
            );
        }

        // Per-bot resolution: local > global > default false.
        const effectiveProfiling = b.profiling ?? opts.profiling ?? false;
        const modules =
            b.modules ||
            loadBotModules(opts.distDir, {
                profiling: effectiveProfiling,
            });

        const bot = await addBot(opts.adapter, b.username, {
            rooms: b.rooms,
            cpu: b.cpu,
            cpuAvailable: b.cpuAvailable,
            gcl: b.gcl,
            modules,
        });

        bots[b.username] = bot;
        resolvedBots[b.username] = {
            ...b,
            effectiveProfiling,
        };
    }

    return { bots, resolvedBots };
}

/**
 * Custom addBot implementation without the mockup method's side effects.
 *
 * Creates user, memory, users.code, ACTIVE_ROOMS, and console events.
 *
 * Controller and spawn are intentionally untouched: they belong to the materialize layer.
 *
 * @param {StorageAdapter} adapter
 * @param {string} username
 * @param {Object} [opts]
 * @param {string|string[]} [opts.rooms] — room(s) where the bot will be active
 * @param {number} [opts.cpu=100]
 * @param {number} [opts.cpuAvailable=10000]
 * @param {number} [opts.gcl=1]
 * @param {Object} [opts.modules={}]
 * @returns {Promise<Bot>}
 */
async function addBot(adapter, username, opts = {}) {
    const { db, env } = adapter;
    const user = await db.users.insert({
        username,
        cpu: opts.cpu ?? DEFAULT_BOT_CPU,
        cpuAvailable: opts.cpuAvailable ?? DEFAULT_BOT_CPU_AVAILABLE,
        gcl: opts.gcl ?? DEFAULT_BOT_GCL,
        active: DEFAULT_BOT_ACTIVE,
        badge: adapter.world.genRandomBadge(),
    });

    // Normalize rooms to array
    const roomList = Array.isArray(opts.rooms) ? opts.rooms : [opts.rooms];

    await Promise.all([
        env.set(env.keys.MEMORY + user._id, '{}'),
        ...roomList.map((room) => env.sadd(env.keys.ACTIVE_ROOMS, room)),
        ...roomList.map((room) => db.rooms.update({ _id: room }, { $set: { active: true } })),
        db['users.code'].insert({
            user: user._id,
            branch: DEFAULT_BOT_BRANCH,
            modules: opts.modules || {},
            activeWorld: true,
        }),
    ]);

    return new TestBot(adapter, user).init();
}

/**
 * Simplified runtime facade.
 *
 * Pipeline: prepareServer → addBots → server.start.
 * Skips materialization — use createWorld() for the full pipeline.
 *
 * @param {RuntimeOpts} opts
 * @returns {Promise<RuntimeResult>}
 */
async function createRuntime(opts) {
    const prepared = await prepareServer({
        rooms: opts.rooms,
        cacheDir: opts.cacheDir,
        port: opts.port,
    });

    try {
        const added = await addBots({
            adapter: prepared.adapter,
            bots: opts.bots || [],
            distDir: opts.distDir,
            profiling: opts.profiling,
        });
        await prepared.server.start();
        // Engine processes exist only after start() — activate the
        // fail-fast watch and route dispose through it (the expected
        // process shutdown must not be recorded as an engine death).
        prepared.dispose = prepared.engineWatch.activate(prepared.dispose);
        return { ...prepared, ...added };
    } catch (error) {
        await prepared.dispose();
        throw error;
    }
}

/**
 * Creates a room and terrain without a controller.
 *
 * Borders are closed (wall) by default unless they face another declared room.
 * The `adjacentBorders` parameter specifies which borders should remain open
 * to allow exits between adjacent rooms. This ensures `Game.map.describeExits`
 * correctly reports exits only to rooms that actually exist in the test world.
 *
 * @param {StorageAdapter} adapter
 * @param {string} roomName
 * @param {{top: boolean, bottom: boolean, left: boolean, right: boolean}} adjacentBorders
 *   — which borders face adjacent declared rooms (true = open, false = wall)
 * @returns {Promise<void>}
 */
async function prepareRoom(adapter, roomName, adjacentBorders) {
    await adapter.world.addRoom(roomName);

    // addRoom() does not create terrain — add plain terrain so the processor
    // does not crash on the first tick.
    try {
        await adapter.world.getTerrain(roomName);
    } catch {
        const TerrainMatrix = getTerrainMatrixClass();
        const terrain = new TerrainMatrix();

        // Close borders that do NOT face adjacent declared rooms
        applyBorderWalls(terrain, adjacentBorders);

        await adapter.world.setTerrain(roomName, terrain);
    }
}

/**
 * Applies wall tiles to terrain borders that are not open.
 *
 * @param {any} terrain — TerrainMatrix instance
 * @param {{top: boolean, bottom: boolean, left: boolean, right: boolean}} adjacentBorders
 *   — which borders face adjacent declared rooms (true = open, false = wall)
 * @returns {void}
 */
function applyBorderWalls(terrain, adjacentBorders) {
    if (!adjacentBorders.top) {
        for (let i = 0; i < 50; i++) terrain.set(i, 0, 'wall'); // north
    }
    if (!adjacentBorders.bottom) {
        for (let i = 0; i < 50; i++) terrain.set(i, 49, 'wall'); // south
    }
    if (!adjacentBorders.left) {
        for (let i = 0; i < 50; i++) terrain.set(0, i, 'wall'); // west
    }
    if (!adjacentBorders.right) {
        for (let i = 0; i < 50; i++) terrain.set(49, i, 'wall'); // east
    }
}

/**
 * Watches the mockup server's engine child processes and the server's
 * 'error' events, converting engine deaths into a single `death` promise.
 *
 * screeps-server-mockup only emits 'info' (not 'error') when a process is
 * killed by a signal — which makes `server.tick()` hang forever (the Linux
 * CI symptom). On Windows an engine crash exits with a non-zero code and the
 * mockup emits 'error'; without a listener that kills the worker with
 * ERR_UNHANDLED_ERROR. This watch guarantees a fail-fast, actionable error
 * when an *engine* process (runner/processor) dies, while non-engine
 * processes (e.g. storage, which the mockup restarts automatically) produce
 * warnings only.
 *
 * @param {ScreepsServer} server
 * @returns {import('../types').EngineWatch}
 */
function attachEngineWatch(server) {
    /** @type {string[]} Fatal engine failures (at most one — first wins) */
    const errors = [];
    /** @type {string[]} Non-fatal crashes of other processes */
    const warnings = [];
    let disposed = false;
    let settled = false;
    let rejectDeath = () => {};
    /** @type {Promise<never>} */
    const death = new Promise((resolve, reject) => {
        rejectDeath = reject;
    });
    // Pre-attach a no-op handler: `race()` races `death` against tick
    // promises, and the losing side must never surface as an unhandled
    // rejection after the race has been resolved.
    death.catch(() => {});

    const HINT =
        'The framework regenerates the engine snapshot automatically (V8 snapshots break after ' +
        'Node.js upgrades). If the crash persists, reinstall dependencies with `npm ci`.';

    /**
     * Records a non-fatal process event.
     *
     * @param {string} message
     * @returns {void}
     */
    function warn(message) {
        if (disposed) {
            return;
        }
        warnings.push(message);
        console.error(`[engineWatch] ${message}`);
    }

    /**
     * Records the first fatal engine failure and rejects `death`.
     *
     * @param {string} message
     * @returns {void}
     */
    function record(message) {
        if (disposed || settled) {
            return;
        }
        settled = true;
        errors.push(message);
        console.error(`[engineWatch] ${message}`);
        rejectDeath(new FrameworkError('ENGINE_CRASH', '', {}, [message, HINT]));
    }

    // Intercept mockup 'error' events: without a listener they would kill
    // the worker with ERR_UNHANDLED_ERROR. The mockup auto-restarts the
    // crashed process, so these are warnings — the per-child exit listeners
    // below are responsible for failing fast on engine deaths.
    server.on('error', (message) => {
        warn(`mock server error: ${message}`);
    });

    return {
        errors,
        warnings,
        death,
        /**
         * Races a long-running engine promise (a tick, profile export)
         * against an engine death: a crashed engine rejects with
         * ENGINE_CRASH instead of hanging forever. The losing promise is
         * pre-handled so it never surfaces as an unhandled rejection
         * after the race has settled.
         *
         * @template T
         * @param {Promise<T>} promise
         * @returns {Promise<T>}
         */
        race(promise) {
            promise.catch(() => {});
            return Promise.race([promise, death]);
        },
        /**
         * Attaches exit listeners to the engine child processes. Must be
         * called after `server.start()` — processes are created only then.
         *
         * @returns {void}
         */
        attachChildren() {
            const children = Object.entries(server.processes || {});
            for (const [name, child] of children) {
                if (!child || typeof child.on !== 'function') {
                    continue;
                }
                child.on('exit', (code, signal) => {
                    if (disposed) {
                        return;
                    }
                    const message = `[${name}] process exited (code: ${code}, signal: ${signal})`;
                    if (name === 'engine_runner' || name === 'engine_processor') {
                        record(message);
                    } else if (code !== 0 || signal !== null) {
                        warn(`${message} — the mock server restarts it automatically`);
                    }
                });
            }
        },
        /**
         * Activates the watch for a started server: attaches the child
         * exit listeners (engine processes exist only after
         * `server.start()`) and returns a wrapped dispose that stops the
         * watch first, so the expected process shutdown is not recorded
         * as an engine death.
         *
         * @param {DisposeFn} dispose - server dispose function to wrap
         * @returns {DisposeFn} wrapped dispose
         */
        activate(dispose) {
            this.attachChildren();
            return async () => {
                this.dispose();
                await dispose();
            };
        },
        /**
         * Stops recording — used during dispose so that the expected
         * process shutdown does not reject the `death` promise.
         *
         * @returns {void}
         */
        dispose() {
            disposed = true;
        },
    };
}

module.exports = { createRuntime, prepareServer, addBots, addBot, attachEngineWatch };
