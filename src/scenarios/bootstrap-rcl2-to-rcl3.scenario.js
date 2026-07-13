'use strict';

const assert = require('node:assert');
const { createWorld } = require('../lib/world');
const { assertBotWorked, assertRclAtLeast, assertNoErrors } = require('../lib/assertions');
const { assertLatestMetricAtLeast } = require('../lib/metricAssertions');
const spec = require('../lib/builders/spec');

const ROOM_NAME = 'W0N1';
const BOT_USERNAME = 'bot';

/**
 * Сценарий: bootstrap-rcl2-to-rcl3.
 *
 * Стартует с RCL2 controller. Использует predicate-based termination —
 * тест завершается когда RCL достигает 3.
 *
 * Проверяет: bootstrap-логику.
 *
 * Запуск: npm run test:integration -- --only bootstrap-rcl2-to-rcl3
 *
 * @param {Object} [opts] — опции из runScenario.js (profiling, ...)
 * @returns {Promise<Object>} report
 */
async function run(opts = {}) {
    const maxTicks = parseInt(process.env.TEST_TICKS || '1101', 10);
    const world = await createWorld({
        rooms: [
            {
                name: ROOM_NAME,
                controller: spec.controller({ level: 2, progress: 44999 }),
                sources: [spec.source(15, 15), spec.source(30, 30)],
                structures: [spec.spawn(25, 25)],
            },
        ],
        bots: [{ username: BOT_USERNAME, room: ROOM_NAME }],
        memory: 'bootstrap_with_anchor',
        ticks: maxTicks,
        profiling: opts.profiling,
        logLevel: 'errors',
        metrics: { every: 100, rooms: true },

        until: {
            maxTicks,
            predicate: async (w) => {
                const mem = await w.readMemory(BOT_USERNAME);
                const ctrl = mem.rooms?.W0N1?.controller;
                return ctrl && ctrl.level >= 3;
            },
        },
    });

    try {
        const { report } = world;
        await world.run();

        assertBotWorked(report);
        assertNoErrors(report);
        assertRclAtLeast(report, ROOM_NAME, 2);
        assertLatestMetricAtLeast(report, 'rooms', ROOM_NAME, 'rcl', 3);
        assert.ok(report.wallClockMs < 10 * 60 * 1000, `тест дольше 10 минут: ${report.wallClockMs}ms`);

        console.log(
            `PASS: bootstrap-rcl2-to-rcl3 (RCL ${report.finalRcl[ROOM_NAME]}, ${report.ticksRun} ticks, ${report.wallClockMs}ms)`,
        );
        return report;
    } finally {
        await world.dispose();
    }
}

module.exports = { run };
