'use strict';

const path = require('path');
const { prepareServer, addBots } = require('./runtime');
const { materializeRoom, materializeCreep } = require('./builders');
const { setBotMemory, getBotMemory, deepMergeMemory, resolveInitialMemoryByBot } = require('./builders/memory');
const { loadRoomFixture, applyRoomOverrides } = require('./fixtures/roomFixture');
const { readEventLog, accumulateEvents } = require('./observers/eventLog');
const { collectMetrics, sampleMetrics } = require('./observers/metrics');
const { MetricsReport } = require('./metricsReport');
const { evaluatePredicate } = require('./observers/predicate');
const { snapshotOwners, mergeOwners } = require('./observers/ownership');
const { createConsoleCapture } = require('./console');
const { createWorldHelpers } = require('./worldHelpers');

function resolveDistDir(opts) {
    return opts.distDir || process.env.BOT_DIST_DIR || path.resolve(process.cwd(), 'dist');
}

function resolveCacheBase(opts) {
    return opts.cacheDir || process.env.SIT_CACHE_DIR || path.resolve(process.cwd(), '.cache');
}

/**
 * @typedef {import('./types').ScreepsServer} ScreepsServer
 * @typedef {import('./storageAdapter').StorageAdapter} StorageAdapter
 * @typedef {import('./types').Bot} Bot
 * @typedef {import('./types').WorldOpts} WorldOpts
 * @typedef {import('./types').WorldInstance} WorldInstance
 * @typedef {import('./types').WorldReport} WorldReport
 * @typedef {import('./types').RoomSpecInput} RoomSpecInput
 * @typedef {import('./types').RoomSpecCanonical} RoomSpecCanonical
 * @typedef {import('./types').RoomOverrides} RoomOverrides
 * @typedef {import('./types').RoomFixtureSpec} RoomFixtureSpec
 * @typedef {import('./types').RoomStatus} RoomStatus
 * @typedef {import('./types').BotSpec} BotSpec
 * @typedef {import('./types').ControllerSpec} ControllerSpec
 * @typedef {import('./types').SourceSpecCanonical} SourceSpecCanonical
 * @typedef {import('./types').StructureSpec} StructureSpec
 * @typedef {import('./types').CreepSpecCanonical} CreepSpecCanonical
 * @typedef {import('./types').EventLogEntry} EventLogEntry
 * @typedef {import('./types').MetricsSample} MetricsSample
 * @typedef {import('./types').SpawnSpecInput} SpawnSpecInput
 * @typedef {import('./types').UntilOpts} UntilOpts
 * @typedef {import('./types').RunFn} RunFn
 * @typedef {import('./types').TickFn} TickFn
 * @typedef {import('./types').ExecFn} ExecFn
 * @typedef {import('./types').SpawnFn} SpawnFn
 * @typedef {import('./types').EventLogFn} EventLogFn
 * @typedef {import('./types').ReadMemoryFn} ReadMemoryFn
 * @typedef {import('./types').WriteMemoryFn} WriteMemoryFn
 * @typedef {import('./types').RegisterEventFn} RegisterEventFn
 * @typedef {import('./types').BotIdFn} BotIdFn
 * @typedef {import('./types').DisposeFn} DisposeFn
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

// ─── Main API ────────────────────────────────────────────────────────────

/**
 * Main API: creates a multi-room world with any number of bots.
 *
 * Pipeline:
 * 1. prepareServer: ScreepsServer + N rooms + terrain, no objects
 * 2. addBots: create users, code, memory, console subscription
 * 3. materializeRoom for each room (including controller, spawn, etc.)
 * 4. setBotMemory per bot (resolved `memory` + `memoryOverrides`)
 * 5. server.start() and tick loop
 *
 * @param {WorldOpts} opts
 * @returns {Promise<WorldInstance>}
 */
async function createWorld(opts) {
    if (!opts.rooms || opts.rooms.length === 0) {
        throw new Error('createWorld: opts.rooms is required and must be a non-empty array');
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

    /** @type {Object<string,RoomStatus>} */
    const roomStatus = {};
    for (const roomInput of opts.rooms) {
        const name = roomInput.name;
        const canonical = await buildCanonicalRoom(roomInput, name, defaultBotUserId);
        const ids = await materializeRoom(adapter, canonical);
        roomStatus[name] = {
            name,
            canonical,
            ids,
            ticks: 0,
            events: 0,
        };
    }

    await server.start();
    const runtime = { ...prepared, ...added };

    // ─── 3. Report accumulator ────────────────────────────────────────────
    /** @type {WorldReport} */
    const report = {
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

    const globalLogLevel = opts.logLevel || 'all';
    const maxConsoleLines = opts.maxConsoleLines || 10000;

    // ─── 4. Per-bot initialization (single pass) ───────────────────────
    // Memory + Console handler — everything in a single pass over bots.
    // Code already loaded in createRuntime → addBot.
    const initialMemoryByBot = resolveInitialMemoryByBot(Object.keys(bots), opts.memory, opts.memoryOverrides);
    for (const [username, bot] of Object.entries(bots)) {
        // Per-bot settings: local takes priority over global
        const botSpec = resolvedBots[username];
        const effectiveLogLevel = botSpec?.logLevel ?? globalLogLevel;

        // Memory
        const initialMemory = initialMemoryByBot[username];
        if (initialMemory) {
            await setBotMemory(adapter, bot.id, initialMemory);
        }

        // Console handler with per-bot logLevel
        const { handler } = createConsoleCapture({ report, logLevel: effectiveLogLevel, maxConsoleLines });
        bot.on('console', handler);
    }

    const startTime = Date.now();

    // ─── 7. Event registry ───────────────────────────────────────────────
    /** @type {Object<string,(adapter:StorageAdapter,room:string,params:Object)=>Promise<void>>} */
    const eventsRegistry = {};
    /** @type {RegisterEventFn} */
    function registerEvent(action, handler) {
        eventsRegistry[action] = handler;
    }

    registerEvent('spawnInvader', async (adpt, room, params) => {
        await materializeCreep(adpt, room, {
            x: params.x ?? 10,
            y: params.y ?? 25,
            name: params.name || `Invader_${Date.now()}`,
            body: params.body,
            userId: '2',
        });
    });

    registerEvent('spawnCreep', async (adpt, room, params) => {
        await materializeCreep(adpt, room, params);
    });

    /** @type {WorldInstance|undefined} */
    // world is referenced by onTick before assignment — circular dependency requires let
    // eslint-disable-next-line prefer-const
    let world;

    // ─── 8. Main loop ────────────────────────────────────────────────

    /**
     * One tick: collect event log / owners / metrics for each room,
     * execute declarative events, onTick callback, predicate check.
     *
     * @param {number} tickNum  — tick number (0-based); usually passed
     *   as `report.ticksRun` before increment so events/metrics
     *   reference the actual tick number.
     * @returns {Promise<boolean>} true if the test should stop
     */
    async function doTick(tickNum) {
        await server.tick();
        report.ticksRun++;

        // Event log
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

        // Events (declarative)
        if (opts.events) {
            for (const event of opts.events) {
                if (event.atTick === tickNum && eventsRegistry[event.action]) {
                    await eventsRegistry[event.action](adapter, event.room, event.params || {});
                }
            }
        }

        // onTick callback
        if (opts.onTick) {
            await opts.onTick(world, tickNum);
        }

        // Predicate check
        if (opts.until) {
            const { shouldStop, reason } = await evaluatePredicate(
                { report, server, bots, readMemory, getEventLog },
                opts.until,
            );
            if (shouldStop) {
                report.stopReason = reason;
                return true; // stop
            }
        }

        return false; // continue
    }

    /**
     * Exports profiling results for bots with effectiveProfiling flag.
     *
     * Sets the `__profileFinalize` flag in each profiled bot's Memory
     * and runs one technical server tick (DIRECTLY via server.tick(), not
     * via doTick — to avoid incrementing ticksRun and generating
     * metrics/events/predicate noise). The wrapper in main.js sees the flag, calls
     * profiler.output()/callgrind() and stores results in
     * Memory.__profileText / __profileCallgrind, which finalize() then reads.
     *
     * Always called — including on premature scenario termination
     * (predicate / maxTicks / exception in doTick).
     *
     * @returns {Promise<void>}
     */
    async function exportProfiles() {
        const profilingBots = Object.entries(resolvedBots)
            .filter(([, spec]) => spec && spec.effectiveProfiling)
            .map(([username]) => username);
        if (profilingBots.length === 0) {
            return;
        }
        for (const username of profilingBots) {
            await writeMemory(username, { __profileFinalize: true });
        }
        try {
            await server.tick();
        } catch (e) {
            // Server may have died — profile can no longer be retrieved. Don't suppress the original
            // run error (it will be re-thrown in run() after finalize).
            report.errors.push(`profile export tick failed: ${e.message || String(e)}`);
        }
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
     *  @type {RunFn}
     */
    async function run() {
        let runError;
        try {
            const maxTicks = (opts.until && opts.until.maxTicks) || opts.ticks || 100;

            // Don't tick if the scenario is already stopped
            if (!report.stopReason) {
                while (report.ticksRun < maxTicks) {
                    if (await doTick(report.ticksRun)) {
                        break;
                    }
                }
            }
        } catch (e) {
            runError = e;
        }

        await exportProfiles();
        const result = await finalize();

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
            if (await doTick(report.ticksRun)) {
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
     * For convenience use `spec.creep()`, `spec.invader()` or
     * `spec.dummyTarget()` — they fill in body and hits.
     *
     * @param {SpawnSpecInput} spawnSpec
     * @type {SpawnFn}
     */
    async function spawn(spawnSpec) {
        if (!spawnSpec.roomName) {
            throw new Error('world.spawn: roomName is required (multi-room mode)');
        }
        const userId = spawnSpec.userId || defaultBotUserId;
        if (!userId) {
            throw new Error('world.spawn: spawnSpec.userId is required (bot username or "2" for Invader)');
        }
        return materializeCreep(adapter, spawnSpec.roomName, { ...spawnSpec, userId });
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
     * Finalizes `report`:
     * - wallClockMs
     * - finalMemory per bot (via Memory from storage)
     * - finalRcl per room
     * - profileText/profileCallgrind per bot
     *
     * @returns {Promise<WorldReport>}
     */
    async function finalize() {
        report.wallClockMs = Date.now() - startTime;

        // finalMemory per-bot
        for (const [username, bot] of Object.entries(bots)) {
            try {
                report.finalMemory[username] = await getBotMemory(adapter, bot.id);
            } catch {
                report.finalMemory[username] = {};
            }
        }

        // finalRcl per-room
        /** @type {string[]} */
        const roomNames = Object.keys(roomStatus);
        for (const name of roomNames) {
            report.finalRcl[name] = await getRcl(adapter, name);
        }

        // Profiler per-bot (text + callgrind)
        for (const [username, mem] of Object.entries(report.finalMemory)) {
            const botSpec = resolvedBots[username];

            if (botSpec?.effectiveProfiling) {
                if (mem.__profileText) {
                    report.profileText[username] = mem.__profileText || null;
                }
                if (mem.__profileCallgrind) {
                    report.profileCallgrind[username] = mem.__profileCallgrind;
                }
            }
        }

        return report;
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
    const helpers = createWorldHelpers(adapter, defaultBotUserId);

    // ─── Return API ──────────────────────────────────────────────────────
    /** @type {WorldInstance} */
    world = {
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
 * - if `defaultBotUserId` is set, attach structures without userId to the bot
 *   (needed for towers, spawns, etc.).
 *
 * @param {RoomSpecInput} roomInput
 * @param {string} name - roomName
 * @param {string} [defaultBotUserId] — _id of the bot for structure attachment
 * @returns {RoomSpecCanonical}
 */
async function buildCanonicalRoom(roomInput, name, defaultBotUserId) {
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
    /** @param {Object} s @param {boolean} [userInvader] */
    const applyDefaults = (s, userInvader) => {
        return {
            ...s,
            roomName: s.roomName || name,
            userId: userInvader ? '2' : (s.userId ?? defaultBotUserId),
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
