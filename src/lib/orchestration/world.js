'use strict';

const path = require('path');
const { prepareServer, addBots } = require('../runtime/runtime');
const { materializeRoom } = require('../builders');
const { setBotMemory, getBotMemory, resolveInitialMemoryByBot } = require('../builders/memory');
const { loadRoomFixture, applyRoomOverrides, ROOM_FIXTURES } = require('../fixtures/roomFixture');
const { readEventLog, accumulateEvents } = require('../observers/eventLog');
const { collectMetrics, sampleMetrics } = require('../observers/metrics');
const { MetricsReport } = require('../assertions/metricsReport');
const { checkStopCondition } = require('../observers/predicate');
const { snapshotOwners, mergeOwners } = require('../observers/ownership');
const { createConsoleCapture } = require('../runtime/console');
const { createEventRegistry, registerDefaultEvents } = require('./events');
const { createWorldHelpers, getRoomRcl } = require('./worldHelpers');
const { finalizeReport } = require('./finalize');
const { exportProfiles } = require('../runtime/profile');
const { resolveDefaultUserId } = require('./resolveDefaults');
const { INVADER_USER_ID } = require('../../constants/screepsConstants');
const { FixtureError, BotError, FrameworkError } = require('../errors');

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
 * @typedef {import('../types').SpawnCreepFn} SpawnCreepFn
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
    return getRoomRcl(adapter, roomName);
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
        throw new FrameworkError('EMPTY_ROOMS');
    }

    // Validate bots spec — catch old 'room' (singular) rename to 'rooms'
    if (opts.bots) {
        for (const botSpec of opts.bots) {
            if (botSpec.room !== undefined) {
                const hint = typeof botSpec.room === 'string' ? `rooms: ["${botSpec.room}"]` : 'rooms: <value>';
                throw new BotError('INVALID_BOTSPEC_FIELD', `bots[].room → ${hint}`, {
                    title: `Invalid BotSpec field "room" for bot "${botSpec.username}"`,
                    why: 'The field has been renamed from "room" (singular) to "rooms" (plural) to support multi-room bots.',
                    how: `Replace \`room: ...\` with \`${hint}\`.`,
                });
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
        const { shouldStop } = await checkStopCondition(
            opts,
            report,
            server,
            bots,
            worldInstance.readMemory,
            worldInstance.eventLog,
        );

        // Keep world.report current after each tick
        // (finalMemory, wallClockMs, RCL, profileText, profileCallgrind)
        try {
            await finalizeReport(report, startTime, bots, adapter, roomStatus, resolvedBots, getBotMemory, getRcl);
        } catch (e) {
            report.frameworkWarnings.push(`finalizeReport tick ${tickNum}: ${e.message ?? String(e)}`);
        }

        return shouldStop;
    }

    /**
     * Main run: executes ticks until the scenario ends.
     *
     * Respects the global `maxTicks` limit and ticks already done (via `report.ticksRun`).
     * If the scenario is already stopped (`report.stopReason` or `report.ticksRun >= maxTicks`),
     * no extra ticks are made.
     *
     * Per-tick report update (finalMemory, wallClockMs, RCL) happens inside
     * `doTick`. After the loop, `exportProfiles` runs a technical tick to
     * collect profiler output, then `finalizeReport` captures the final
     * snapshot (including __profileText / __profileCallgrind).
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

        await exportProfiles(resolvedBots, world.writeMemory, server, report);
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
     * Stops the server and releases resources.
     * @type {DisposeFn}
     */
    async function dispose() {
        await runtime.dispose();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────
    const helpers = createWorldHelpers(adapter, defaultBotUserId, roomToBotUserId, bots);

    // ─── Return API ──────────────────────────────────────────────────────
    /** @type {WorldInstance} */
    const world = {
        run,
        tick,
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
            const available = Object.keys(ROOM_FIXTURES);
            const suggestions =
                available.length > 0
                    ? [`Available room fixtures: ${available.join(', ')}`]
                    : ['No room fixtures are currently registered.'];
            throw new FixtureError(
                'MISSING_ROOM_FIXTURE',
                roomInput.roomFixture,
                {
                    title: `Room fixture '${roomInput.roomFixture}' not found`,
                },
                suggestions,
            );
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
            // explicit userId (including null/explicit falsy values) — preserve as-is
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
    resolveDistDir,
    resolveCacheBase,
};
