'use strict';

const path = require('path');
const { prepareServer, addBots } = require('./runtime');
const { materializeRoom } = require('./builders');
const { setBotMemory, getBotMemory, deepMergeMemory, resolveInitialMemoryByBot } = require('./builders/memory');
const { loadRoomFixture, applyRoomOverrides } = require('./fixtures/roomFixture');
const { readEventLog, accumulateEvents } = require('./observers/eventLog');
const { collectMetrics, sampleMetrics } = require('./observers/metrics');
const { createMetricsReport, resolveMetricsConfig } = require('./metrics');
const { evaluatePredicate } = require('./observers/predicate');
const { snapshotOwners, mergeOwners } = require('./observers/ownership');
const { createConsoleCapture } = require('./console');

function resolveDistDir(opts) {
    return (
        opts.distDir ||
        process.env.BOT_DIST_DIR ||
        path.resolve(process.cwd(), 'dist')
    );
}

function resolveCacheBase(opts) {
    return (
        opts.cacheDir ||
        process.env.SIT_CACHE_DIR ||
        path.resolve(process.cwd(), '.cache')
    );
}

/**
 * @typedef {import('./types').ScreepsServer} ScreepsServer
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
 * @typedef {import('./types').DisposeFn} DisposeFn
 */

// ─── Вспомогательные функции ─────────────────────────────────────────────────

/**
 * Определяет RCL комнаты по контроллеру в `rooms.objects`.
 * Если контроллера нет в комнате — возвращает 0.
 *
 * @param {ScreepsServer} server
 * @param {string} roomName
 * @returns {Promise<number>}
 */
async function getRcl(server, roomName) {
    const { db } = server.common.storage;
    const controller = await db['rooms.objects'].findOne({ room: roomName, type: 'controller' });
    return controller ? controller.level : 0;
}

// ─── Основной API ────────────────────────────────────────────────────────────

/**
 * Главный API: создаёт multi-room мир с произвольным числом ботов.
 *
 * Pipeline:
 * 1. prepareServer: ScreepsServer + N комнат + terrain, без объектов
 * 2. addBots: создание пользователей, кода, memory, console subscription
 * 3. materializeRoom для каждой комнаты (включая controller, spawn и т.д.)
 * 4. setBotMemory per bot (resolved `memory` + `memoryOverrides`)
 * 5. server.start() и tick loop
 *
 * @param {WorldOpts} opts
 * @returns {Promise<WorldInstance>}
 */
async function createWorld(opts) {
    if (!opts.rooms || opts.rooms.length === 0) {
        throw new Error('createWorld: opts.rooms обязателен и должен быть непустым массивом');
    }

    const metricsConfig = resolveMetricsConfig(opts);

    // Pipeline:
    // 1. prepareServer — сервер + комнаты + terrain.
    // 2. addBots — пользователи, код, memory, console. Бот создаётся до
    //    materialize, чтобы объекты комнат могли привязаться к `bot.id`
    //    через defaultBotUserId.
    // 3. materializeRoom — controller, spawn, sources, structures, creeps
    //    описываются явно в spec. Никаких других placeholder-ов.
    // 4. server.start — игровой движок.
    const distDir = resolveDistDir(opts);
    const cacheBase = resolveCacheBase(opts);

    const prepared = await prepareServer({
        rooms: opts.rooms.map((r) => r.name),
        cacheDir: path.join(cacheBase, `w-${Date.now()}-${process.pid}`),
    });

    const { server } = prepared;
    const added = await addBots({
        server,
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
        const ids = await materializeRoom(server, canonical);
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
        metrics: createMetricsReport(),
        objectOwners: {},
        stopReason: null,
    };

    const globalLogLevel = opts.logLevel || 'errors';
    const maxConsoleLines = opts.maxConsoleLines || 10000;

    // ─── 4. Per-bot initialization (единый цикл) ───────────────────────
    // Memory + Console handler — всё за один проход по ботам.
    // Код уже загружен в createRuntime → addBot.
    const initialMemoryByBot = resolveInitialMemoryByBot(Object.keys(bots), opts.memory, opts.memoryOverrides);
    for (const [username, bot] of Object.entries(bots)) {
        // Per-bot settings: приоритет local > global
        const botSpec = resolvedBots[username];
        const effectiveLogLevel = botSpec?.logLevel ?? globalLogLevel;

        // Memory
        const initialMemory = initialMemoryByBot[username];
        if (initialMemory) {
            await setBotMemory(server, bot.id, initialMemory);
        }

        // Console handler с per-bot logLevel
        const { handler } = createConsoleCapture({ report, logLevel: effectiveLogLevel, maxConsoleLines });
        bot.on('console', handler);
    }

    const startTime = Date.now();

    // ─── 7. Event registry ───────────────────────────────────────────────
    /** @type {Object<string,(server:ScreepsServer,room:string,params:Object)=>Promise<void>>} */
    const eventsRegistry = {};
    /** @type {RegisterEventFn} */
    function registerEvent(action, handler) {
        eventsRegistry[action] = handler;
    }

    registerEvent('spawnInvader', async (_server, room, params) => {
        const { materializeCreep } = require('./builders');
        await materializeCreep(_server, room, {
            x: params.x ?? 10,
            y: params.y ?? 25,
            name: params.name || `Invader_${Date.now()}`,
            body: params.body,
            userId: '2',
        });
    });

    registerEvent('spawnCreep', async (_server, room, params) => {
        const { materializeCreep } = require('./builders');
        await materializeCreep(_server, room, params);
    });

    // ─── 8. Основной цикл ────────────────────────────────────────────────

    /**
     * Один тик: сбор event log / owners / metrics для каждой комнаты,
     * выполнение декларативных events, onTick callback, predicate check.
     *
     * @param {number} tickNum  — номер тика (0-based); обычно передаётся
     *   как `report.ticksRun` до инкремента, чтобы события/метрики
     *   ссылались на актуальный номер тика.
     * @returns {Promise<boolean>} true если тест нужно остановить
     */
    async function doTick(tickNum) {
        await server.tick();
        report.ticksRun++;

        // Event log
        /** @type {string[]} */
        const roomNames = Object.keys(roomStatus);
        for (const name of roomNames) {
            try {
                const eventLog = await readEventLog(server, name);
                accumulateEvents(report, eventLog, tickNum);
                roomStatus[name].events += eventLog.length;
            } catch {
                // event log может быть недоступен на первых тиках
            }

            // Owners snapshot
            try {
                const owners = await snapshotOwners(server, name);
                mergeOwners(report, owners);
            } catch {
                // не критично
            }

            // Metrics сэмплинг
            if (metricsConfig.rooms && metricsConfig.every > 0 && tickNum % metricsConfig.every === 0) {
                try {
                    const metrics = await collectMetrics(server, name);
                    sampleMetrics(report, name, metrics, tickNum);
                } catch {
                    // metrics не критичен
                }
            }

            // RCL tracking (обновляем каждый тик для доступности после tick())
            try {
                report.finalRcl[name] = await getRcl(server, name);
            } catch {
                // ok
            }

            roomStatus[name].ticks++;
        }

        // Events (декларативные)
        if (opts.events) {
            for (const event of opts.events) {
                if (event.atTick === tickNum && eventsRegistry[event.action]) {
                    await eventsRegistry[event.action](server, event.room, event.params || {});
                }
            }
        }

        // onTick callback
        if (opts.onTick) {
            await opts.onTick({ server, bots, report, tick: tickNum, registerEvent, readMemory, exec }, tickNum);
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
     * Экспортирует итоги профайлинга для ботов с флагом effectiveProfiling.
     *
     * Выставляет флаг `__profileFinalize` в Memory каждого профилируемого бота
     * и прогоняет один технический тик сервера (НАПРЯМУЮ через server.tick(), а не
     * через doTick — чтобы не инкрементировать ticksRun и не плодить
     * metrics/events/predicate-шум). Обёртка в main.js видит флаг, вызывает
     * profiler.output()/callgrind() и складывает результаты в
     * Memory.__profileText / __profileCallgrind, которые затем читает finalize().
     *
     * Вызывается всегда — в том числе при преждевременном завершении сценария
     * (predicate / maxTicks / исключение в doTick).
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
            // Сервер мог умереть — профиль уже не достать. Не подавляем оригинальную
            // ошибку прогона (она будет пере-брошена в run() после finalize).
            report.errors.push(`profile export tick failed: ${e.message || String(e)}`);
        }
    }

    /**
     * Основной прогон: выполняет тики до завершения сценария.
     *
     * Учитывает общий лимит `maxTicks` и уже сделанные тики (через `report.ticksRun`).
     * Если сценарий уже остановлен (`report.stopReason` или `report.ticksRun >= maxTicks`),
     * не делает лишних тиков — только финализирует отчёт.
     *
     * Гарантирует экспорт профиля даже при исключении в середине сценария:
     * перехватывает ошибку, прогоняет финализационный тик профайлера и
     * finalize(), затем пере-бросает исходное исключение.
     *
     *  @type {RunFn}
     */
    async function run() {
        let runError;
        try {
            const maxTicks = (opts.until && opts.until.maxTicks) || opts.ticks || 100;

            // Не тикаем, если сценарий уже остановлен
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
     * Выполняет N серверных тиков.
     *
     * Уважает `until.maxTicks` на входе — если лимит уже достигнут,
     * ни одного тика не делается. После тика проверяет `until`
     * (predicate/signal/maxTicks) и останавливается досрочно.
     * Не проверяет глобальное состояние остановки (`report.stopReason`).
     *
     * @type {TickFn}
     */
    async function tick(n = 1) {
        // until.maxTicks уже достигнут — ни одного лишнего тика
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
     * Выполняет JS-код в контексте бота через console.
     * @param {string} code
     * @param {string} [botUsername] — если не указан, берётся единственный бот (single-bot сценарий)
     * @type {ExecFn}
     */
    async function exec(code, botUsername = defaultBot(bots)) {
        await bots[botUsername].console(code);
    }

    /**
     * Создаёт нового крипа в комнате.
     * @param {SpawnSpecInput} spawnSpec
     * @type {SpawnFn}
     */
    async function spawn(spawnSpec) {
        if (!spawnSpec.roomName) {
            throw new Error('world.spawn: roomName обязателен (multi-room mode)');
        }
        const userId = spawnSpec.userId || defaultBotUserId;
        if (!userId) {
            throw new Error('world.spawn: spawnSpec.userId обязателен (username бота или "2" для Invader)');
        }
        const { materializeCreep } = require('./builders');
        return materializeCreep(server, spawnSpec.roomName, { ...spawnSpec, userId });
    }

    /**
     * Читает event log для комнаты.
     * @type {EventLogFn}
     */
    async function getEventLog(room) {
        if (!room) {
            throw new Error('world.eventLog: room обязателен');
        }
        return readEventLog(server, room);
    }

    /**
     * Читает память бота.
     * @type {ReadMemoryFn}
     */
    async function readMemory(botUsername) {
        const username = botUsername || defaultBot(bots);
        return getBotMemory(server, bots[username].id);
    }

    /**
     * Обновляет Memory бота через канонический deep merge.
     *
     * patch мерджится поверх текущей памяти: plain objects рекурсивно
     * сливаются, массивы/примитивы заменяются, `undefined` ничего не
     * затирает. Это симметрично initial load через explicit memory pipeline.
     *
     * @type {WriteMemoryFn}
     */
    async function writeMemory(botUsername, patch) {
        const username = botUsername || defaultBot(bots);
        const current = await getBotMemory(server, bots[username].id);
        const next = deepMergeMemory(current, patch || {});
        await setBotMemory(server, bots[username].id, next);
    }

    /**
     * Финализирует `report`:
     * - wallClockMs
     * - finalMemory per bot (через Memory из storage)
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
                report.finalMemory[username] = await getBotMemory(server, bot.id);
            } catch {
                report.finalMemory[username] = {};
            }
        }

        // finalRcl per-room
        /** @type {string[]} */
        const roomNames = Object.keys(roomStatus);
        for (const name of roomNames) {
            report.finalRcl[name] = await getRcl(server, name);
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
     * Останавливает сервер и освобождает ресурсы.
     * @type {DisposeFn}
     */
    async function dispose() {
        await runtime.dispose();
    }

    // ─── Возврат API ──────────────────────────────────────────────────────
    /** @type {WorldInstance} */
    const world = {
        run,
        tick,
        exec,
        spawn,
        eventLog: getEventLog,
        readMemory,
        writeMemory,
        registerEvent,
        report,
        server,
        bots,
        rooms: roomStatus,
        dispose,
    };

    return world;
}

/**
 * Возвращает username единственного бота (для single-bot-сценариев).
 *
 * @param {Object<string,Bot>} bots
 * @returns {string}
 */
function defaultBot(bots) {
    const names = Object.keys(bots);
    if (names.length === 0) {
        throw new Error('defaultBot: в opts.bots ни одного бота');
    }
    if (names.length > 1) {
        throw new Error(`defaultBot: ботов > 1 (${names.join(', ')}) — укажи явно через world.readMemory(username)`);
    }
    return names[0];
}

/**
 * Строит каноническую спецификацию комнаты.
 *
 * Алгоритм:
 * - если `roomFixture` — строка, грузим по имени из registry;
 * - если `roomFixture` — объект, используем как inline fixture;
 * - если `roomFixture` нет — собираем inline-поля (controller, sources, structures, creeps, hostiles);
 * - применяем `roomOverrides` поверх базы;
 * - проставляем `roomName` в каждый объект, чтобы materialize знал,
 *   куда класть его в БД;
 * - если `defaultBotUserId` задан, привязываем структуры без userId к боту
 *   (нужно для работы турелей, спавна и т.д.).
 *
 * @param {RoomSpecInput} roomInput
 * @param {string} name - roomName
 * @param {string} [defaultBotUserId] — _id бота для привязки структур
 * @returns {RoomSpecCanonical}
 */
async function buildCanonicalRoom(roomInput, name, defaultBotUserId) {
    /** @type {RoomFixtureSpec | {controller, sources, structures, creeps, hostiles}} */
    let base;

    if (typeof roomInput.roomFixture === 'string') {
        const loaded = loadRoomFixture(roomInput.roomFixture);
        if (!loaded) {
            throw new Error(`buildCanonicalRoom: roomFixture '${roomInput.roomFixture}' не найден`);
        }
        base = loaded.fixture;
    } else if (roomInput.roomFixture && typeof roomInput.roomFixture === 'object') {
        // inline fixture
        base = roomInput.roomFixture;
    } else {
        // no fixture — собираем из inline-полей
        base = {
            controller: roomInput.controller,
            sources: roomInput.sources || [],
            structures: roomInput.structures || [],
            creeps: roomInput.creeps || [],
            hostiles: roomInput.hostiles || [],
        };
    }

    // применяем overrides
    if (roomInput.roomOverrides) {
        base = applyRoomOverrides(base, roomInput.roomOverrides);
    }

    // финальный canonicalRoom с фиксированным roomName и userId на каждом объекте
    // Для hostiles - user - '2'
    /** @param {Object} s @param {boolean} [userInvader] */
    const applyDefaults = (s, userInvader) => {
        return {
            ...s,
            roomName: s.roomName || name,
            userId: userInvader ? '2' : s.userId || defaultBotUserId,
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

module.exports = { createWorld, buildCanonicalRoom };
