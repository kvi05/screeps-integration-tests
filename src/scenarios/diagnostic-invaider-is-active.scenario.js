'use strict';

const { createWorld } = require('../lib/world');
const { EVENT_OBJECT_DESTROYED } = require('../lib/observers/eventLog');
const {
    assertBotWorked,
    assertRclAtLeast,
    assertBotUserAttacking,
    assertBotUserNotDamaged,
    assertBotUserDamaged,
} = require('../lib/assertions');
const spec = require('../lib/builders/spec');

const ROOM_NAME = 'W0N1';
const BOT_USERNAME = 'bot';

/**
 * Сценарий: diagnostic-invader-is-active.
 *
 * Проверяет: что Invaiver в принцепе работает.
 *
 * Запуск: npm run test:integration -- --only diagnostic-invaider-is-active
 */
async function run(_opts = {}) {
    const maxTicks = parseInt(process.env.TEST_MAX_TICKS || '15', 10);

    const world = await createWorld({
        rooms: [
            {
                name: ROOM_NAME,
                controller: spec.controller({ level: 1, safeMode: 0 }),
                structures: [spec.spawn(25, 25)],
                creeps: [spec.creep(20, 10)],
                hostiles: [spec.invader(20, 15)],
            },
        ],
        bots: [{ username: BOT_USERNAME, room: ROOM_NAME }],
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
        assertRclAtLeast(report, ROOM_NAME, 1);

        // 3. Крип бота получил урон
        assertBotUserDamaged(report, bots[BOT_USERNAME].id);

        // 4. инвейдера НЕ аттаковали
        assertBotUserNotDamaged(report, '2');

        // 5. invader атаковал
        assertBotUserAttacking(report, '2');

        const destroyedCount = report.events.filter((e) => e.event === 2).length;
        console.log(
            `\nPASS: diagnostic-invader-is-active (${report.ticksRun} ticks, RCL ${report.finalRcl[ROOM_NAME]}, destroyed: ${destroyedCount}, events: ${report.events.length}, ${report.wallClockMs}ms)`,
        );
        return report;
    } finally {
        await world.dispose();
    }
}

module.exports = { run };
