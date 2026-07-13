'use strict';

const { createWorld } = require('../lib/world');
const { hasFixture } = require('../lib/builders/memory');
const {
    assertBotWorked,
    assertRclAtLeast,
    assertNoBotObjectDestroyed,
    assertBotUserNotDamaged,
    assertObjectAttacking,
    assertBotUserDamaged,
    assertBotUserNotAttacking,
} = require('../lib/assertions');
const spec = require('../lib/builders/spec');

const { EVENT_OBJECT_DESTROYED } = require('../lib/observers/eventLog');

const ROOM_NAME = 'W0N1';
const BOT_USERNAME = 'bot';

/**
 * Сценарий: defense-invader-rcl3.
 *
 * Реальная RCL3-комната (но без крипов) отбивает инвейдера.
 * - Загружает room fixture rcl3-stable (controller, sources, structures, roads).
 * - Загружает memory fixture.
 * - Спавнит dummy target и invader.
 *
 * Проверки:
 *   1. Инвейдер уничтожен.
 *   2. RCL не упал.
 *   3. Здания бота НЕ разрушены.
 *   4. Объекты бота не получил урон.
 *
 * Проверяет: Работоспособность башни (в реальной колонии)
 *
 * Запуск: npm run test:integration -- --only defense-invader-rcl3
 */
async function run(_opts = {}) {
    if (!hasFixture('rcl3-stable')) {
        console.log('SKIP: defense-invader-rcl3 — fixture rcl3-stable.memory.json не создан');
        console.log('  Создайте fixture: npm run test:integration:capture -- rcl3-stable');
        return { skipped: true };
    }

    const maxTicks = parseInt(process.env.TEST_MAX_TICKS || '4', 10);

    const world = await createWorld({
        rooms: [
            {
                name: ROOM_NAME,
                roomFixture: 'rcl3-stable',
                roomOverrides: {
                    creeps: [spec.creep(20, 20)],
                    hostiles: [spec.invader(40, 40)],
                },
            },
        ],
        bots: [{ username: BOT_USERNAME, room: ROOM_NAME }],
        memory: 'rcl3-stable',
        // Включаю тревогу в логике своего бота
        memoryOverrides: { colonies: { W0N1: { configs: { combatAlert: true } } } },
        ticks: maxTicks,

        until: {
            maxTicks,
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

        // 1. Бот выжил (не упал с ошибкой)
        assertBotWorked(report);

        // 2. RCL не упал
        assertRclAtLeast(report, ROOM_NAME, 3);

        // 3. Башня атаковала
        assertObjectAttacking(report, '9a73a4971e07bb4');

        // 4. Инвейдера атаковали
        assertBotUserDamaged(report, '2');

        // 5. invader НЕ атаковал
        assertBotUserNotAttacking(report, '2');

        // 6. Здания бота НЕ разрушены
        assertNoBotObjectDestroyed(report);

        // 7. Любые объекты бота не получили урон
        assertBotUserNotDamaged(report, bots[BOT_USERNAME].id);

        const destroyedCount = report.events.filter((e) => e.event === 2).length;
        console.log(
            `\nPASS: defense-invader-rcl3 (${report.ticksRun} ticks, RCL ${report.finalRcl[ROOM_NAME]}, destroyed: ${destroyedCount}, events: ${report.events.length}, ${report.wallClockMs}ms)`,
        );
        return report;
    } finally {
        await world.dispose();
    }
}

module.exports = { run };
