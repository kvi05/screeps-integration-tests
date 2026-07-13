'use strict';

const { createWorld } = require('../lib/world');
const { hasFixture } = require('../lib/builders/memory');
const {
    assertBotWorked,
    assertBotUserDamaged,
    assertNoBotObjectDestroyed,
    assertBotUserNotDamaged,
} = require('../lib/assertions');
const { EVENT_OBJECT_DESTROYED } = require('../lib/observers/eventLog');
const spec = require('../lib/builders/spec');

const ROOM_NAME = 'W0N1';
const BOT_USERNAME = 'bot';

/**
 * Сценарий: defense-invader-rcl3-no-tower.
 *
 * RCL3-комната БЕЗ башни против инвейдера.
 * Переиспользует room fixture rcl3-stable + overrides:
 * - exclude: tower
 * - controller: safeMode=20000
 * - extensions: energy=200 (вместо 50)
 *
 * Ожидаемое поведение: инвейдер ничего не делает и умирает от защитников.
 *
 * Проверяет: работоспособность создания крипов защитников (почти в реальной колонии)
 *
 * Запуск: npm run test:integration -- --only defense-invader-rcl3-no-tower
 *
 * @param {Object} [opts] — опции из runScenario.js (profiling, ...)
 * @returns {Promise<Object>} report
 */
async function run(opts = {}) {
    if (!hasFixture('rcl3-stable')) {
        console.log('SKIP: defense-invader-rcl3-no-tower — fixture rcl3-stable.memory.json не создан');
        return { skipped: true };
    }

    const maxTicks = parseInt(process.env.TEST_TICKS || '180', 10);

    // ─── Colony fixture + overrides ────────────────────────────────────────
    // Та же RCL3 fixture (что и в сценарии с башней), но:
    // 1. Убираем tower (exclude)
    // 2. Меняем safeMode controller на 20000
    // 3. Меняем energy extensions с 50 на 200
    const world = await createWorld({
        rooms: [
            {
                name: ROOM_NAME,
                roomFixture: 'rcl3-stable',
                roomOverrides: {
                    // Удалить башни
                    exclude: ['tower'],
                    controller: { safeMode: 20000 },
                    // Все extensions получат energy=200 вместо 50
                    structures: [
                        spec.extension(27, 24, { energy: 200, energyCapacity: 200 }),
                        spec.extension(27, 25, { energy: 200, energyCapacity: 200 }),
                        spec.extension(28, 25, { energy: 200, energyCapacity: 200 }),
                        spec.extension(29, 26, { energy: 200, energyCapacity: 200 }),
                        spec.extension(29, 27, { energy: 200, energyCapacity: 200 }),
                        spec.extension(28, 28, { energy: 200, energyCapacity: 200 }),
                        spec.extension(27, 27, { energy: 200, energyCapacity: 200 }),
                        spec.extension(27, 29, { energy: 200, energyCapacity: 200 }),
                        spec.extension(26, 29, { energy: 200, energyCapacity: 200 }),
                        spec.extension(26, 28, { energy: 200, energyCapacity: 200 }),
                    ],
                    creeps: [spec.creep(10, 10)],
                    hostiles: [spec.invader(10, 25)],
                },
            },
        ],
        bots: [{ username: BOT_USERNAME, room: ROOM_NAME }],
        memory: 'rcl3-stable',
        ticks: maxTicks,
        profiling: opts.profiling,

        until: {
            predicate: async (w) => {
                const events = await w.getEventLog(ROOM_NAME);
                return events.some((e) => e.event === EVENT_OBJECT_DESTROYED);
            },
        },
    });

    try {
        const { bots, report } = world;

        await world.run();

        // ─── Assertions ───────────────────────────────────────────────────

        // Бот выжил (не упал с ошибкой)
        assertBotWorked(report);

        // Инвейдер был уничтожен (бот его убил крипами)
        assertBotUserDamaged(report, '2');

        // Здания бота НЕ разрушены
        assertNoBotObjectDestroyed(report);

        // Любые объекты бота не получили урон
        assertBotUserNotDamaged(report, bots[BOT_USERNAME].id);

        console.log(
            `\nPASS: defense-invader-rcl3-no-tower ` +
                `(${report.ticksRun} ticks, RCL ${report.finalRcl[ROOM_NAME]}, events: ${report.events.length}, ${report.wallClockMs}ms)`,
        );
        return report;
    } finally {
        await world.dispose();
    }
}

module.exports = { run };
