'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { EventEmitter, once } = require('events');
const { ScreepsServer } = require('screeps-server-mockup');
const { createStorageAdapter } = require('./storageAdapter');
const { loadBotModules } = require('./loadBot');

/**
 * @typedef {import('./types').ScreepsServer} ScreepsServer
 * @typedef {import('./storageAdapter').StorageAdapter} StorageAdapter
 * @typedef {import('./types').Bot} Bot
 * @typedef {import('./types').BotSpec} BotSpec
 * @typedef {import('./types').RuntimeOpts} RuntimeOpts
 * @typedef {import('./types').RuntimeResult} RuntimeResult
 * @typedef {import('./types').PrepareServerOpts} PrepareServerOpts
 * @typedef {import('./types').PreparedServer} PreparedServer
 * @typedef {import('./types').AddBotsOpts} AddBotsOpts
 * @typedef {import('./types').AddedBots} AddedBots
 * @typedef {import('./types').DisposeFn} DisposeFn
 */

/**
 * Returns a free TCP port on 127.0.0.1.
 *
 * Used so each mockup server runs on its own port and does not
 * conflict with other parallel or sequential runs.
 *
 * @returns {Promise<number>}
 */
async function getFreePort() {
    const server = net.createServer();
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => {
                server.removeAllListeners();
                resolve(port);
            });
        });
    });
}

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
 * @param {PrepareServerOpts} opts
 * @returns {Promise<PreparedServer>}
 */
async function prepareServer(opts) {
    if (!opts.rooms || opts.rooms.length === 0) {
        throw new Error('prepareServer: opts.rooms is required and must be a non-empty array');
    }

    const cacheDir = opts.cacheDir || path.join(__dirname, '..', '.cache', String(process.pid));
    const port = opts.port ?? (await getFreePort());

    // screeps-server-mockup writes logs to ./server/logs relative to cwd.
    // Create the directory automatically so users don't have to maintain
    // it manually in their repository.
    fs.mkdirSync(path.join(process.cwd(), 'server', 'logs'), { recursive: true });

    const server = new ScreepsServer({ path: cacheDir, port });

    await server.world.reset();

    const adapter = createStorageAdapter(server);

    for (const roomName of opts.rooms) {
        await prepareRoom(adapter, roomName);
    }

    return { server, adapter, dispose: createDispose(server, adapter, cacheDir) };
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
    /** @type {Object<string,import('./types').ResolvedBotSpec>} */
    const resolvedBots = {};

    for (const b of botsList) {
        // Per-bot resolution: local > global > default false.
        const effectiveProfiling = b.profiling ?? opts.profiling ?? false;
        const modules =
            b.modules ||
            loadBotModules(opts.distDir, {
                profiling: effectiveProfiling,
            });

        const bot = await addBot(opts.adapter, b.username, {
            room: b.room,
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
        cpu: opts.cpu ?? 100,
        cpuAvailable: opts.cpuAvailable ?? 10000,
        gcl: opts.gcl ?? 1,
        active: 10000,
        badge: adapter.world.genRandomBadge(),
    });

    await Promise.all([
        env.set(env.keys.MEMORY + user._id, '{}'),
        env.sadd(env.keys.ACTIVE_ROOMS, opts.room),
        db.rooms.update({ _id: opts.room }, { $set: { active: true } }),
        db['users.code'].insert({
            user: user._id,
            branch: 'default',
            modules: opts.modules || {},
            activeWorld: true,
        }),
    ]);

    return new TestBot(adapter, user).init();
}

/**
 * Minimal bot object compatible with the API used by the framework.
 * Console subscription is handled here rather than through the mockup User,
 * so runtime does not depend on `world.addBot`'s implementation.
 */
class TestBot extends EventEmitter {
    constructor(adapter, data) {
        super();
        this._adapter = adapter;
        this._id = data._id;
        this._username = data.username;
    }

    get id() {
        return this._id;
    }

    get username() {
        return this._username;
    }

    get memory() {
        const { env } = this._adapter;
        return env.get(env.keys.MEMORY + this._id);
    }

    async console(expression) {
        const { db } = this._adapter;
        return db['users.console'].insert({ user: this._id, expression, hidden: false });
    }

    async init() {
        const { pubsub } = this._adapter;
        await pubsub.subscribe(`user:${this._id}/console`, (event) => {
            const data = JSON.parse(event);
            const { messages, error } = data;
            const { log = [], results = [] } = messages || {};
            if (error) {
                log.push(error);
            }
            this.emit('console', log, results, this._id, this._username);
        });
        return this;
    }
}

/**
 * Facade runtime API.
 *
 * Full world pipeline: prepareServer → addBots → buildCanonicalRoom →
 * materializeRoom → server.start. `createRuntime` simplifies this contract
 * for direct consumers.
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
        return { ...prepared, ...added };
    } catch (error) {
        await prepared.dispose();
        throw error;
    }
}

/**
 * Creates a room and terrain without a controller.
 *
 * @param {StorageAdapter} adapter
 * @param {string} roomName
 * @returns {Promise<void>}
 */
async function prepareRoom(adapter, roomName) {
    await adapter.world.addRoom(roomName);

    // addRoom() does not create terrain — add plain terrain so the processor
    // does not crash on the first tick.
    try {
        await adapter.world.getTerrain(roomName);
    } catch {
        const TerrainMatrix = require('screeps-server-mockup/dist/src/terrainMatrix').default;
        await adapter.world.setTerrain(roomName, new TerrainMatrix());
    }
}

/**
 * Waits for a child process to exit with a timeout.
 *
 * @param {import('child_process').ChildProcess} proc
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
async function waitForProcessExit(proc, timeoutMs) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
        return;
    }

    const ac = new AbortController();
    const timer = setTimeout(() => {
        ac.abort();
        try {
            proc.kill('SIGKILL');
        } catch {
            // ignore
        }
    }, timeoutMs);

    try {
        await once(proc, 'exit', { signal: ac.signal });
    } catch {
        // AbortError — process already killed by timer
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Creates a single safe dispose for all runtime phases.
 *
 * Stops server child processes, waits for them to exit, and
 * removes the cache directory. This prevents storage/engine
 * process leaks and port conflicts between sequential runs.
 *
 * @param {ScreepsServer} server
 * @param {StorageAdapter} adapter
 * @param {string} cacheDir
 * @returns {DisposeFn}
 */
function createDispose(server, adapter, cacheDir) {
    return async () => {
        const processes = adapter.getProcesses();

        for (const proc of processes) {
            try {
                proc.kill();
            } catch {
                // ignore
            }
        }

        await Promise.all(processes.map((proc) => waitForProcessExit(proc, 5000)));

        try {
            fs.rmSync(cacheDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    };
}

module.exports = { createRuntime, prepareServer, addBots, addBot, TestBot };
