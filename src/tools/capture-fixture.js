'use strict';

/**
 * CLI tool для создания fixture-файлов Memory.
 *
 * Двухфазная логика:
 *   1. Прогон до достижения `controller.level >= --rcl` (predicate-based)
 *   2. Если RCL достигнут — доп. `--stabilize` тиков для стабилизации состояния
 *
 * Использование:
 *   node src/tools/capture-fixture.js <name> [options]
 *
 * Опции:
 *   --from <fixture>     — стартовый snapshot (по умолчанию: bootstrap_with_anchor)
 *   --rcl <level>        — целевой RCL (по умолчанию: 3, диапазон: 1..8)
 *   --ticks <N>          — макс. тиков на достижение RCL (по умолчанию: 10000)
 *   --stabilize <N>      — доп. тики после достижения RCL (по умолчанию: 2000)
 *   --log-level <level>  — 'all'|'error'|'warn' (по умолчанию: 'error')
 *   --progress <N>       — логировать каждые N тиков (0 = выключено, по умолчанию: 0)
 *   --room <name>        — имя комнаты (по умолчанию: W0N1)
 *   --sources <JSON>     — позиции источников (по умолчанию: [{"x":15,"y":15},{"x":35,"y":35}])
 *   --force              — перезаписать существующий fixture
 *   --warn-size <N>      — порог предупреждения по размеру в байтах (по умолчанию: 50000)
 *   --help               — показать справку
 *
 * Примеры:
 *   node capture-fixture.js rcl3-stable
 *   node capture-fixture.js rcl3-stable --from bootstrap_with_anchor --ticks 15000
 *   node capture-fixture.js rcl3-stable --rcl 3 --stabilize 3000 --progress 500
 *   node capture-fixture.js rcl3-stable --room W1N1 --force
 *
 * @file CLI для генерации memory fixture
 * @summary Создание `fixtures/<name>.memory.json` из прогона бота до целевого RCL.
 */

const { createWorld } = require('../lib/world');
const spec = require('../lib/builders/spec');
const { saveFixture, hasFixture } = require('../lib/builders/memory');
const { parseArgs, HelpRequested } = require('../lib/cli');

/**
 * @typedef {import('../lib/types').SourceSpecCanonical} SourceSpecCanonical
 * @typedef {import('../lib/types').BotMemory} BotMemory
 */

// ─── Схема CLI ──────────────────────────────────────────────────────────────

const SCHEMA = {
    title: 'capture-fixture',
    usage: 'node src/tools/capture-fixture.js <name> [options]',
    positional: [{ name: 'name', required: true, description: 'имя fixture (без .memory.json)' }],
    options: {
        from: { type: 'string', default: 'bootstrap_with_anchor', description: 'стартовая memory fixture' },
        rcl: { type: 'int', default: 3, min: 1, max: 8, description: 'целевой RCL' },
        ticks: { type: 'int', default: 10000, min: 1, description: 'макс. тиков на достижение RCL' },
        stabilize: { type: 'int', default: 2000, min: 0, description: 'доп. тики после достижения RCL' },
        logLevel: {
            type: 'enum',
            values: ['all', 'error', 'warn'],
            default: 'error',
            cli: '--log-level',
            description: 'уровень логирования',
        },
        progress: { type: 'int', default: 0, min: 0, description: 'логировать каждые N тиков (0 = off)' },
        room: { type: 'string', default: 'W0N1', description: 'имя комнаты' },
        sources: {
            type: 'json',
            default: [
                { x: 15, y: 15 },
                { x: 35, y: 35 },
            ],
            description: 'позиции источников (JSON)',
        },
        force: { type: 'bool', default: false, description: 'перезаписать существующий fixture' },
        warnSize: {
            type: 'int',
            default: 50000,
            min: 0,
            cli: '--warn-size',
            description: 'порог предупреждения по размеру (байты)',
        },
    },
};

// ─── Вспомогательные функции ─────────────────────────────────────────────────

/**
 * Извлекает RCL из Memory бота.
 *
 * @param {BotMemory|null|undefined} memory
 * @param {string} roomName
 * @returns {number}
 */
function getRclFromMemory(memory, roomName) {
    if (!memory || !memory.rooms || !memory.rooms[roomName]) {
        return 0;
    }
    /** @type {{level?: number}|undefined} */
    const ctrl = memory.rooms[roomName].controller;
    return (ctrl && ctrl.level) || 0;
}

// ─── Тестируемый API ────────────────────────────────────────────────────────

/**
 * @typedef {Object} CaptureFixtureOpts
 * @property {string}  name                      — имя fixture (без .memory.json)
 * @property {string}  [from='bootstrap_with_anchor'] — стартовая memory fixture
 * @property {number}  [targetRcl=3]
 * @property {number}  [maxTicks=10000]
 * @property {number}  [stabilize=2000]
 * @property {'all'|'error'|'warn'} [logLevel='error']
 * @property {number}  [progress=0]              — шаг progress-логов (0 = off)
 * @property {string}  [room='W0N1']
 * @property {Array<{x:number,y:number}>} [sources]
 * @property {boolean} [force=false]             — перезаписать существующий fixture
 * @property {number}  [warnSize=50000]          — предупреждать при size >= N
 */

/**
 * @typedef {Object} CaptureFixtureResult
 * @property {string}   path
 * @property {number}   size
 * @property {number}   finalRcl
 * @property {number}   ticksRun
 * @property {number}   wallClockMs
 * @property {boolean}  targetReached
 * @property {string[]} warnings
 */

/**
 * Создаёт fixture: прогоняет мир до targetRcl (Phase 1) и стабилизирует
 * Phase 2 (`stabilize` тиков). Возвращает результат — решение об exit-code
 * принимает вызывающий CLI.
 *
 * Exit codes:
 * - 0 — успех (RCL достигнут)
 * - 2 — RCL не достигнут (но fixture сохранён)
 *
 * @param {CaptureFixtureOpts} cfg
 * @returns {Promise<CaptureFixtureResult>}
 */
async function captureFixture(cfg) {
    const {
        name,
        from = 'bootstrap_with_anchor',
        targetRcl = 3,
        maxTicks = 10000,
        stabilize = 2000,
        logLevel = 'error',
        progress = 0,
        room = 'W0N1',
        sources = [
            { x: 15, y: 15 },
            { x: 35, y: 35 },
        ],
        force = false,
        warnSize = 50000,
    } = cfg;

    // Проверка на перезапись — ДО запуска мира (не тратим минуты впустую)
    if (!force && hasFixture(name)) {
        throw new Error(`Fixture "${name}" уже существует. Используйте --force для перезаписи.`);
    }

    const startTime = Date.now();
    /** @type {string[]} */
    const warnings = [];

    // ─── Создание мира ────────────────────────────────────────────────────
    /** @type {SourceSpecCanonical[]} */
    const sourceSpecs = sources.map((s) => spec.source(s.x, s.y));

    /** @type {Object} */
    const createWorldOpts = {
        rooms: [
            {
                name: room,
                controller: spec.controller({ level: 1 }),
                sources: sourceSpecs,
            },
        ],
        bots: [{ username: 'bot', room }],
        ticks: maxTicks + stabilize,
        profile: false,
        logLevel,

        // Phase 1: до достижения targetRcl (или до maxTicks)
        until: {
            maxTicks,
            predicate: async (w) => {
                const mem = await w.readMemory('bot');
                const cur = getRclFromMemory(mem, room);

                if (progress > 0 && w.report.ticksRun > 0 && w.report.ticksRun % progress === 0) {
                    console.log(`  [phase1] tick ${w.report.ticksRun}, RCL ${cur}`);
                }

                return cur >= targetRcl;
            },
        },
    };

    // Стартовая memory fixture прокидывается через общий memory-pipeline createWorld.
    if (from) {
        createWorldOpts.memory = from;
    }

    const world = await createWorld(createWorldOpts);

    try {
        // ─── Фаза 1 (запускается в world.run) ────────────────────────────
        console.log(`  Phase 1: reaching RCL ${targetRcl} (max ${maxTicks} ticks)...`);
        await world.run();

        /** @type {number} */
        const rclAfterPhase1 = world.report.finalRcl[room] || 0;
        const targetReached = rclAfterPhase1 >= targetRcl;

        if (targetReached) {
            console.log(`  RCL ${rclAfterPhase1} reached at tick ${world.report.ticksRun}`);
        }

        // ─── Фаза 2: стабилизация (после достижения RCL) ───────────────
        if (targetReached && stabilize > 0) {
            console.log(`  Phase 2: stabilizing (${stabilize} ticks)...`);

            for (let i = 0; i < stabilize; i++) {
                await world.tick(1);

                if (progress > 0 && world.report.ticksRun % progress === 0) {
                    const mem = await world.readMemory('bot');
                    const cur = getRclFromMemory(mem, room);
                    console.log(`  [phase2] tick ${world.report.ticksRun}, RCL ${cur}`);
                }
            }
        } else if (!targetReached) {
            console.log(`  Phase 2: SKIPPED (RCL ${targetRcl} not reached)`);
        }

        // ─── Сохранение fixture ───────────────────────────────────────────
        const finalMemory = await world.readMemory('bot');
        const finalRcl = getRclFromMemory(finalMemory, room);
        const { path: filePath, size } = saveFixture(name, finalMemory, { force });
        const wallClockMs = Date.now() - startTime;
        const wallSec = (wallClockMs / 1000).toFixed(1);

        if (!targetReached) {
            warnings.push(`RCL ${targetRcl} was NOT reached (final: ${finalRcl})`);
        }
        if (size >= warnSize) {
            warnings.push(`fixture size ${size} bytes >= threshold ${warnSize}`);
        }

        // ─── Итоговый отчёт ──────────────────────────────────────────────
        console.log(`  Fixture saved: ${filePath}`);
        console.log(`    RCL:      ${finalRcl} (target ${targetRcl}) ${targetReached ? '✓' : '✗'}`);
        console.log(`    ticks:    ${world.report.ticksRun}`);
        console.log(`    size:     ${size} bytes`);
        console.log(`    time:     ${wallSec}s`);

        for (const w of warnings) {
            console.log(`  WARNING: ${w}`);
        }

        /** @type {CaptureFixtureResult} */
        const result = {
            path: filePath,
            size,
            finalRcl,
            ticksRun: world.report.ticksRun,
            wallClockMs,
            targetReached,
            warnings,
        };
        return result;
    } finally {
        await world.dispose();
    }
}

// ─── CLI entry point ────────────────────────────────────────────────────────

/**
 * CLI entry point. Парсит args, вызывает captureFixture, возвращает exit-code.
 * @returns {Promise<number>}
 */
async function main() {
    const { positional, options } = parseArgs(SCHEMA, process.argv.slice(2));

    console.log(`[capture-fixture] Создание fixture "${positional.name}"`);
    console.log(
        `  from: ${options.from}, rcl: ${options.rcl}, ticks: ${options.ticks}, ` +
            `stabilize: ${options.stabilize}, room: ${options.room}`,
    );

    /** @type {CaptureFixtureResult} */
    const result = await captureFixture({
        name: positional.name,
        from: options.from,
        targetRcl: options.rcl,
        maxTicks: options.ticks,
        stabilize: options.stabilize,
        logLevel: options.logLevel,
        progress: options.progress,
        room: options.room,
        sources: options.sources,
        force: options.force,
        warnSize: options.warnSize,
    });

    return result.targetReached ? 0 : 2;
}

if (require.main === module) {
    main()
        .then((exitCode) => process.exit(exitCode))
        .catch((e) => {
            if (e instanceof HelpRequested) {
                console.log(e.helpText);
                process.exit(0);
            } else {
                console.error(`[capture-fixture] Fatal error: ${e.message}`);
                process.exit(1);
            }
        });
}

module.exports = { captureFixture };
