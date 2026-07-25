'use strict';

const path = require('path');
const { prepareServer, addBots } = require('../runtime/runtime');
const { materializeRoom, materializeCreep } = require('../builders');
const { setBotMemory, getBotMemory, deepMergeMemory, resolveInitialMemoryByBot } = require('../builders/memory');
const { loadRoomFixture, applyRoomOverrides } = require('../fixtures/roomFixture');
const { readEventLog, accumulateEvents } = require('../observers/eventLog');
const { collectMetrics, sampleMetrics } = require('../observers/metrics');
const { MetricsReport } = require('../assertions/metricsReport');
const { checkStopCondition } = require('../observers/predicate');
const { snapshotOwners, mergeOwners } = require('../observers/ownership');
const { createConsoleCapture } = require('../runtime/console');
const { createEventRegistry, registerDefaultEvents } = require('./events');
const { createWorldHelpers } = require('./worldHelpers');
const { finalizeReport } = require('./finalize');
const { exportProfiles } = require('../runtime/profile');
const { resolveDefaultUserId } = require('./resolveDefaults');
const { INVADER_USER_ID } = require('../../constants/screepsConstants');

// ─── Framework defaults ──────────────────────────────────────────────────────────

/** @type {string} */
const DEFAULT_WORLD_LOG_LEVEL = 'all';
/** @type {number} */
const DEFAULT_MAX_CONSOLE_LINES = 10000;
/** @type {number} */
const DEFAULT_MAX_TICKS = 100;

function resolveDistDir(opts) {
    return opts.distDir || process.env.BOT_DIST_DIR || path.resolve(process.cwd(), 'dist');
}

function resolveCacheBase(opts) {
    return opts.cacheDir || process.env.SIT_CACHE_DIR || path.resolve(process.cwd(), '.cache');
}

/**
 * @typedef {import('../types').ScreepsServer} ScreepsServer
 * @typedef {import('../runtime/storageAdapter').StorageAdapter} StorageAdapter
 * @typedef {import('../types').Bot} Bot
 * @typedef {import('../types').WorldOpts} WorldOpts
 * @typedef {import('../types').WorldInstance} WorldInstance
 * @typedef {import('../types').WorldReport} WorldReport
 * @typedef {import('../types').RoomSpecInput} RoomSpecInput
 * @typedef {import('../types').RoomSpecCanonical} RoomSpecCanonical
 * @typedef {import('../types').RoomOverrides} RoomOverrides
 * @typedef {import('../types').RoomFixtureSpec} RoomFixtureSpec
 * @typedef {import('../types').RoomStatus} RoomStatus
 * @typedef {import('../types').BotSpec} BotSpec
 * @typedef {import('../types').ControllerSpec} ControllerSpec
 * @typedef {import('../types').SourceSpecCanonical} SourceSpecCanonical
 * @typedef {import('../types').StructureSpec} StructureSpec
 * @typedef {import('../types').CreepSpecCanonical} CreepSpecCanonical
 * @typedef {import('../types').EventLogEntry} EventLogEntry
 * @typedef {import('../types').MetricsSample} MetricsSample
 * @typedef {import('../types').UntilOpts} UntilOpts
 * @typedef {import('../types').RunFn} RunFn
 * @typedef {import('../types').TickFn} TickFn
 * @typedef {import('../types').ExecFn} ExecFn
 * @typedef {import('../types').SpawnFn} SpawnFn
 * @typedef {import('../types').EventLogFn} EventLogFn
 * @typedef {import('../types').ReadMemoryFn} ReadMemoryFn
 * @typedef {import('../types').WriteMemoryFn} WriteMemoryFn
 * @typedef {import('../types').RegisterEventFn} RegisterEventFn
 * @typedef {import('../types').BotIdFn} BotIdFn
 * @typedef {import('../types').DisposeFn} DisposeFn
 */

// ─── Helper functions ────────────────────────────────────────────────────────

/**
 * Determines the RCL of a room from its controller in `rooms.objects`.
 * Returns 0 if the room has no controller.
 *
 * @param {StorageAdapter} adapter
 * @param {string} roomName
 * @returns {Promise<number>}
 */
async function getRcl(adapter, roomName) {
    const { db } = adapter;
    const controller = await db['rooms.objects'].findOne({ room: roomName, type: 'controller' });
    return controller ? controller.level : 0;
}

/**
 * Advances the server by one tick and increments the tick counter.
 *
 * @param {import('screeps-server-mockup').ScreepsServer} server
 * @param {WorldReport} report
 */
async function doServerTick(server, report) {
    await server.tick();
    report.ticksRun++;
}

/**
 * Runs all per-room observations for a single tick: event log, owners
 * snapshot, metrics sampling, and RCL tracking.
 *
 * @param {import('./storageAdapter').StorageAdapter} adapter
 * @param {Object<string, import('./types').RoomStatus>} roomStatus
 * @param {WorldReport} report
 * @param {import('./types').MetricsOpts} metricsConfig
 * @param {number} tickNum
 */
async function observeAllRooms(adapter, roomStatus, report, metricsConfig, tickNum) {
    /** @type {string[]} */
    const roomNames = Object.keys(roomStatus);
    for (const name of roomNames) {
        try {
            const eventLog = await readEventLog(adapter, name);
            accumulateEvents(report, eventLog, tickNum);
            roomStatus[name].events += eventLog.length;
        } catch (e) {
            report.frameworkWarnings.push(`eventLog room ${name}: ${e.message ?? String(e)}`);
        }

        // Owners snapshot
        try {
            const owners = await snapshotOwners(adapter, name);
            mergeOwners(report, owners);
        } catch (e) {
            report.frameworkWarnings.push(`ownersSnapshot room ${name}: ${e.message ?? String(e)}`);
        }

        // Metrics sampling
        if (metricsConfig.rooms && metricsConfig.every > 0 && tickNum % metricsConfig.every === 0) {
            try {
                const metrics = await collectMetrics(adapter, name);
                sampleMetrics(report.metrics, name, metrics, tickNum);
            } catch (e) {
                report.frameworkWarnings.push(`metrics room ${name} tick ${tickNum}: ${e.message ?? String(e)}`);
            }
        }

        // RCL tracking (updated each tick for availability after tick())
        try {
            report.finalRcl[name] = await getRcl(adapter, name);
        } catch (e) {
            report.frameworkWarnings.push(`RCL room ${name}: ${e.message ?? String(e)}`);
        }

        roomStatus[name].ticks++;
    }
}

/**
 * Creates an empty {@link WorldReport} with default values.
 *
 * @returns {WorldReport}
 */
function createEmptyReport() {
    return {
        ticksRun: 0,
        finalRcl: {},
        errors: [],
        warnings: [],
        logs: [],
        finalMemory: {},
        profileText: {},
        profileCallgrind: {},
        wallClockMs: 0,
        events: [],
        metrics: new MetricsReport(),
        objectOwners: {},
        frameworkWarnings: [],
        stopReason: null,
    };
}

/**
 * Materialises all rooms from input specs into the DB.
 *
 * Iterates over `roomInputs`, calls `buildCanonicalRoom` to resolve
 * fixtures/overrides, then `materializeRoom` to write to the DB.
 *
 * @param {import('./types').RoomSpecInput[]} roomInputs
 * @param {import('./storageAdapter').StorageAdapter} adapter
 * @param {string} [defaultBotUserId] — _id of the first bot for default structure ownership
 * @param {Object<string, string>} [roomToBotUserId] — per-room bot user id lookup
 * @returns {Promise<Object<string, import('./types').RoomStatus>>}
 */
async function materializeRooms(roomInputs, adapter, defaultBotUserId, roomToBotUserId) {
    /** @type {Object<string, import('./types').RoomStatus>} */
    const roomStatus = {};
    for (const roomInput of roomInputs) {
        const name = roomInput.name;
        const canonical = await buildCanonicalRoom(roomInput, name, defaultBotUserId, roomToBotUserId);
        const ids = await materializeRoom(adapter, canonical);
        roomStatus[name] = {
            name,
            canonical,
            ids,
            ticks: 0,
            events: 0,
        };
    }
    return roomStatus;
}

/**
 * Initialises bots: sets initial memory and attaches console capture.
 *
 * Called after `server.start()` so that console events can be received.
 *
 * @param {Object<string, import('./types').Bot>} bots
 * @param {Object<string, import('./types').ResolvedBotSpec>} resolvedBots
 * @param {import('./storageAdapter').StorageAdapter} adapter
 * @param {Object} opts — WorldOpts (uses `.memory`, `.memoryOverrides`)
 * @param {import('./types').WorldReport} report
 * @param {string} globalLogLevel
 * @param {number} maxConsoleLines
 */
async function initializeBots(bots, resolvedBots, adapter, opts, report, globalLogLevel, maxConsoleLines) {
    const initialMemoryByBot = resolveInitialMemoryByBot(Object.keys(bots), opts.memory, opts.memoryOverrides);
    for (const [username, bot] of Object.entries(bots)) {
        const botSpec = resolvedBots[username];
        const effectiveLogLevel = botSpec?.logLevel ?? globalLogLevel;

        const initialMemory = initialMemoryByBot[username];
        if (initialMemory) {
            await setBotMemory(adapter, bot.id, initialMemory);
        }

        const { handler } = createConsoleCapture({ report, logLevel: effectiveLogLevel, maxConsoleLines });
        bot.on('console', handler);
    }
}

// ─── Main API ────────────────────────────────────────────────────────────

/**
 * Main API: creates a multi-room world with any number of bots.
 *
 * Pipeline:
 * 1. prepareServer: ScreepsServer + N rooms + terrain, no objects
 * 2. addBots: create users, code, memory, console subscription
 * 3. materializeRoom for each room (including controller, spawn, etc.)
 * 4. server.start() — start the game engine
 * 5. initializeBots: setBotMemory per bot (resolved `memory` + `memoryOverrides`) + console capture
 *
 * @param {WorldOpts} opts
 * @returns {Promise<WorldInstance>}
 */
async function createWorld(opts) {
    if (!opts.rooms || opts.rooms.length === 0) {
        throw new Error('createWorld: opts.rooms is required and must be a non-empty array');
    }

    // Validate bots spec — catch old 'room' (singular) rename to 'rooms'
    if (opts.bots) {
        for (const botSpec of opts.bots) {
            if (botSpec.room !== undefined) {
                const hint = typeof botSpec.room === 'string' ? `rooms: '${botSpec.room}'` : 'rooms: <value>';
                throw new Error(
                    `createWorld: BotSpec for "${botSpec.username}" uses unknown field 'room' (singular). ` +
                        `The field has been renamed to 'rooms' (plural) to support multi-room bots. ` +
                        `Replace \`room: ...\` with \`${hint}\`.`,
                );
            }
        }
    }

    const metricsConfig = MetricsReport.resolveConfig(opts);

    // Pipeline:
    // 1. prepareServer — server + rooms + terrain.
    // 2. addBots — users, code, memory, console. Bot is created before
    //    materialize so room objects can be linked to `bot.id`
    //    via defaultBotUserId.
    // 3. materializeRoom — controller, spawn, sources, structures, creeps
    //    are described explicitly in spec. No other placeholders.
    // 4. server.start — game engine.
    const distDir = resolveDistDir(opts);
    const cacheBase = resolveCacheBase(opts);

    const prepared = await prepareServer({
        rooms: opts.rooms.map((r) => r.name),
        cacheDir: path.join(cacheBase, `w-${Date.now()}-${process.pid}`),
    });

    const { server, adapter } = prepared;
    const added = await addBots({
        adapter,
        bots: opts.bots || [],
        distDir,
        profiling: opts.profiling,
    });
    const { bots, resolvedBots } = added;
    const defaultBotUserId = bots[opts.bots?.[0]?.username]?.id;

    // Build per-room user-id lookup: first bot claiming a room wins.
    /** @type {Object<string, string>} */
    const roomToBotUserId = {};
    for (const botSpec of opts.bots || []) {
        const rooms = Array.isArray(botSpec.rooms) ? botSpec.rooms : [botSpec.rooms];
        for (const room of rooms) {
            if (!roomToBotUserId[room]) {
                roomToBotUserId[room] = bots[botSpec.username]?.id;
            }
        }
    }

    const roomStatus = await materializeRooms(opts.rooms, adapter, defaultBotUserId, roomToBotUserId);

    await server.start();
    const runtime = { ...prepared, ...added };

    const report = createEmptyReport();

    const globalLogLevel = opts.logLevel || DEFAULT_WORLD_LOG_LEVEL;
    const maxConsoleLines = opts.maxConsoleLines || DEFAULT_MAX_CONSOLE_LINES;

    await initializeBots(bots, resolvedBots, adapter, opts, report, globalLogLevel, maxConsoleLines);

    const startTime = Date.now();

    // ─── Event registry ──────────────────────────────────────────────────
    const { register: registerEvent, dispatch: dispatchEvents } = createEventRegistry();
    registerDefaultEvents({ register: registerEvent });

    // ─── Main loop ────────────────────────────────────────────────

    /**
     * One tick: collect event log / owners / metrics for each room,
     * execute declarative events, onTick callback, predicate check.
     *
     * Ownership snapshot is taken BEFORE server.tick() so that
     * objects destroyed during the tick still have their owner
     * in report.objectOwners (see ownership.js).
     *
     * @param {number} tickNum  — tick number (0-based); usually passed
     *   as `report.ticksRun` before increment so events/metrics
     *   reference the actual tick number.
     * @param {WorldInstance} worldInstance — needed for `opts.onTick` callback
     * @returns {Promise<boolean>} true if the test should stop
     */
    async function doTick(tickNum, worldInstance) {
        // Ownership snapshot BEFORE tick — captures objects that may be destroyed
        for (const name of Object.keys(roomStatus)) {
            try {
                const owners = await snapshotOwners(adapter, name);
                mergeOwners(report, owners);
            } catch {
                // non-critical
            }
        }

        await doServerTick(server, report);
        await observeAllRooms(adapter, roomStatus, report, metricsConfig, tickNum);

        // Events (declarative)
        await dispatchEvents(opts.events, tickNum, adapter);

        // onTick callback
        if (opts.onTick) {
            await opts.onTick(worldInstance, tickNum);
        }

        // Predicate check
        const { shouldStop } = await checkStopCondition(opts, report, server, bots, readMemory, getEventLog);
        return shouldStop;
    }

    /**
     * Main run: executes ticks until the scenario ends.
     *
     * Respects the global `maxTicks` limit and ticks already done (via `report.ticksRun`).
     * If the scenario is already stopped (`report.stopReason` or `report.ticksRun >= maxTicks`),
     * no extra ticks are made — only finalizes the report.
     *
     * Guarantees profile export even after an exception mid-scenario:
     * catches the error, runs the profiler finalization tick and
     * finalize(), then re-throws the original exception.
     *
     * @type {RunFn}
     */
    async function run() {
        let runError;
        try {
            const maxTicks = (opts.until && opts.until.maxTicks) || opts.ticks || DEFAULT_MAX_TICKS;

            // Don't tick if the scenario is already stopped
            if (!report.stopReason) {
                while (report.ticksRun < maxTicks) {
                    if (await doTick(report.ticksRun, world)) {
                        break;
                    }
                }
            }
        } catch (e) {
            runError = e;
        }

        await exportProfiles(resolvedBots, writeMemory, server, report);
        const result = await finalizeReport(
            report,
            startTime,
            bots,
            adapter,
            roomStatus,
            resolvedBots,
            getBotMemory,
            getRcl,
        );

        if (runError) {
            throw runError;
        }
        return result;
    }

    /**
     * Executes N server ticks.
     *
     * Respects `until.maxTicks` on entry — if the limit is already reached,
     * no ticks are performed. After each tick checks `until`
     * (predicate/signal/maxTicks) and stops early.
     * Does not check the global stop state (`report.stopReason`).
     *
     * @type {TickFn}
     */
    async function tick(n = 1) {
        // until.maxTicks already reached — no extra ticks
        if (opts.until && opts.until.maxTicks !== undefined && report.ticksRun >= opts.until.maxTicks) {
            return;
        }

        for (let i = 0; i < n; i++) {
            if (await doTick(report.ticksRun, world)) {
                break;
            }
        }
    }

    /**
     * Executes JS code in the bot's context via console.
     * @param {string} code
     * @param {string} [botUsername] — if omitted, uses the only bot (single-bot scenario)
     * @type {ExecFn}
     */
    async function exec(code, botUsername = defaultBot(bots)) {
        await bots[botUsername].console(code);
    }

    /**
     * Creates a new creep in the room.
     *
     * Accepts a complete creep spec — use `spec.creep()`, `spec.invader()`
     * or `spec.dummyTarget()` to build one.
     *
     * If `userId` is not set, resolves it from the bot's room claim
     * or falls back to the first bot. This is the only field that
     * `world.spawn` may add — all other fields (hits, store, etc.)
     * must be pre-computed by the spec constructor.
     *
     * @param {CreepSpecCanonical} creepSpec
     * @type {SpawnFn}
     */
    async function spawn(creepSpec) {
        if (!creepSpec.roomName) {
            throw new Error('world.spawn: roomName is required');
        }
        // explicit userId: undefined is preserved; default applied only if userId is not specified
        const userId =
            creepSpec.userId !== undefined
                ? creepSpec.userId
                : resolveDefaultUserId(creepSpec.roomName, roomToBotUserId, defaultBotUserId);
        if (userId === undefined) {
            throw new Error('world.spawn: userId is required (no default bot available)');
        }
        return materializeCreep(adapter, creepSpec.roomName, { ...creepSpec, userId });
    }

    /**
     * Reads event log for a room.
     * @type {EventLogFn}
     */
    async function getEventLog(room) {
        if (!room) {
            throw new Error('world.eventLog: room is required');
        }
        return readEventLog(adapter, room);
    }

    /**
     * Reads bot memory.
     * @type {ReadMemoryFn}
     */
    async function readMemory(botUsername) {
        const username = botUsername || defaultBot(bots);
        return getBotMemory(adapter, bots[username].id);
    }

    /**
     * Updates bot Memory via canonical deep merge.
     *
     * patch is merged over current memory: plain objects are recursively
     * merged, arrays/primitives are replaced, `undefined` does not
     * overwrite anything. This is symmetric to initial load via explicit memory pipeline.
     *
     * @type {WriteMemoryFn}
     */
    async function writeMemory(botUsername, patch) {
        const username = botUsername || defaultBot(bots);
        const current = await getBotMemory(adapter, bots[username].id);
        const next = deepMergeMemory(current, patch || {});
        await setBotMemory(adapter, bots[username].id, next);
    }

    /**
     * Stops the server and releases resources.
     * @type {DisposeFn}
     */
    async function dispose() {
        await runtime.dispose();
    }

    // ─── botId ────────────────────────────────────────────────────────────

    /**
     * Returns bot _id by username, index, or the first bot.
     *
     * @param {string|number} [bot] — bot username (string) or index (number, 0-based)
     *   If omitted — returns _id of the only bot (single-bot scenario).
     * @returns {string} bot _id
     * @throws {Error} if bot not found or (with empty argument) bots ≠ 1
     * @type {BotIdFn}
     */
    function botId(bot) {
        if (bot === undefined) {
            return bots[defaultBot(bots)].id;
        }
        if (typeof bot === 'number') {
            const entries = Object.values(bots);
            if (bot < 0 || bot >= entries.length) {
                throw new Error(
                    `botId: index ${bot} is out of range (0..${entries.length - 1}). Available bots: ${Object.keys(bots).join(', ')}`,
                );
            }
            return entries[bot].id;
        }
        if (typeof bot === 'string') {
            if (!bots[bot]) {
                throw new Error(`botId: bot "${bot}" not found. Available bots: ${Object.keys(bots).join(', ')}`);
            }
            return bots[bot].id;
        }
        throw new Error('botId: argument must be username (string), index (number), or undefined');
    }

    // ─── Helpers ─────────────────────────────────────────────────────────
    const helpers = createWorldHelpers(adapter, defaultBotUserId, roomToBotUserId);

    // ─── Return API ──────────────────────────────────────────────────────
    /** @type {WorldInstance} */
    const world = {
        run,
        tick,
        exec,
        spawn,
        botId,
        eventLog: getEventLog,
        readMemory,
        writeMemory,
        registerEvent,
        report,
        server,
        bots,
        rooms: roomStatus,
        dispose,
        ...helpers,
    };

    return world;
}

/**
 * Returns the username of the only bot (for single-bot scenarios).
 *
 * @param {Object<string,Bot>} bots
 * @returns {string}
 */
function defaultBot(bots) {
    const names = Object.keys(bots);
    if (names.length === 0) {
        throw new Error('defaultBot: no bots in opts.bots');
    }
    if (names.length > 1) {
        throw new Error(
            `defaultBot: more than 1 bot (${names.join(', ')}) — specify explicitly via world.readMemory(username)`,
        );
    }
    return names[0];
}

/**
 * Builds a canonical room specification.
 *
 * Algorithm:
 * - if `roomFixture` is a string, load by name from registry;
 * - if `roomFixture` is an object, use as inline fixture;
 * - if `roomFixture` is absent — assemble inline fields (controller, sources, structures, creeps, hostiles);
 * - apply `roomOverrides` on top of the base;
 * - set `roomName` on each object so materialize knows
 *   where to put it in the DB;
 * - if a bot claims this room via `roomToBotUserId`, its userId is used for
 *   objects without an explicit userId; otherwise falls back to `defaultBotUserId`.
 *
 * @param {RoomSpecInput} roomInput
 * @param {string} name - roomName
 * @param {string} [defaultBotUserId] — fallback _id (first bot)
 * @param {Object<string, string>} [roomToBotUserId] — per-room bot user id lookup
 * @returns {RoomSpecCanonical}
 */
async function buildCanonicalRoom(roomInput, name, defaultBotUserId, roomToBotUserId) {
    /** @type {RoomFixtureSpec | {controller, sources, structures, creeps, hostiles}} */
    let base;

    if (typeof roomInput.roomFixture === 'string') {
        const loaded = loadRoomFixture(roomInput.roomFixture);
        if (!loaded) {
            throw new Error(`buildCanonicalRoom: roomFixture '${roomInput.roomFixture}' not found`);
        }
        base = loaded.fixture;
    } else if (roomInput.roomFixture && typeof roomInput.roomFixture === 'object') {
        // inline fixture
        base = roomInput.roomFixture;
    } else {
        // no fixture — assemble from inline fields
        base = {
            controller: roomInput.controller,
            sources: roomInput.sources || [],
            structures: roomInput.structures || [],
            creeps: roomInput.creeps || [],
            hostiles: roomInput.hostiles || [],
        };
    }

    // apply overrides
    if (roomInput.roomOverrides) {
        base = applyRoomOverrides(base, roomInput.roomOverrides);
    }

    // final canonicalRoom with fixed roomName and userId on each object
    // For hostiles - user - '2'
    // Note: explicit userId: undefined is preserved (no default applied)
    /** @param {Object} s @param {boolean} [userInvader] */
    const applyDefaults = (s, userInvader) => {
        let resolvedUserId;
        if (userInvader) {
            resolvedUserId = INVADER_USER_ID;
        } else if (s.userId !== undefined) {
            // explicit userId (including undefined) — preserve as-is
            resolvedUserId = s.userId;
        } else {
            // no userId specified — apply default
            resolvedUserId = resolveDefaultUserId(name, roomToBotUserId, defaultBotUserId);
        }
        return {
            ...s,
            roomName: s.roomName || name,
            userId: resolvedUserId,
        };
    };

    /** @type {RoomSpecCanonical} */
    return {
        name,
        controller: base.controller ? applyDefaults(base.controller) : undefined,
        sources: (base.sources || []).map((s) => applyDefaults(s)),
        structures: (base.structures || []).map((s) => applyDefaults(s)),
        creeps: (base.creeps || []).map((s) => applyDefaults(s)),
        hostiles: (base.hostiles || []).map((s) => applyDefaults(s, true)),
    };
}

module.exports = {
    createWorld,
    buildCanonicalRoom,
    // For unit tests
    defaultBot,
    resolveDistDir,
    resolveCacheBase,
};
