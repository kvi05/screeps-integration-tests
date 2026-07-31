'use strict';

const fs = require('fs');
const path = require('path');
const { ScreepsServer } = require('screeps-server-mockup');
const { createStorageAdapter } = require('./storageAdapter');
const { loadBotModules } = require('./loadBot');
const { getFreePort } = require('./port');
const { TestBot } = require('./testBot');
const { createDispose } = require('./cleanup');
const { computeAdjacentBorders } = require('./roomUtils');
const { getTerrainMatrixClass } = require('./terrain');

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

    const cacheDir = opts.cacheDir || path.join(__dirname, '..', '.cache', String(process.pid));
    const port = opts.port ?? (await getFreePort());

    // screeps-server-mockup writes logs to ./server/logs relative to cwd.
    // Create the directory automatically so users don't have to maintain
    // it manually in their repository.
    fs.mkdirSync(path.join(process.cwd(), 'server', 'logs'), { recursive: true });

    const server = new ScreepsServer({ path: cacheDir, port });

    await server.world.reset();

    const adapter = createStorageAdapter(server);

    // Compute which borders face adjacent declared rooms
    const adjacencyMap = computeAdjacentBorders(opts.rooms);

    for (const roomName of opts.rooms) {
        await prepareRoom(adapter, roomName, adjacencyMap[roomName]);
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

module.exports = { createRuntime, prepareServer, addBots, addBot };
