'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');
const { assertLatestMetricAtLeast, assertMetricReached } = require('screeps-integration-tests/metric-assertions');
const { getWorldSnapshotAtTick, getRoomMetrics } = require('screeps-integration-tests/metrics');

const BOT_USERNAME = 'bot';
const ROOM_1 = 'W0N1';
const ROOM_2 = 'W0N2';

/**
 * Сценарий: metrics-multi-room.
 *
 * Проверяет, что метрики двух комнат хранятся в разных time-series
 * и не смешиваются. Использует короткий прогон.
 *
 * Запуск: npm run test:integration -- --only metrics-multi-room
 *
 * @param {Object} [opts] — опции из runScenario.js (profiling, ...)
 * @returns {Promise<Object>} report
 */
async function run(opts = {}) {
    const ticks = parseInt(process.env.TEST_TICKS || '10', 10);
    const world = await createWorld({
        rooms: [
            {
                name: ROOM_1,
                controller: spec.controller({ level: 2 }),
                sources: [spec.source(15, 15), spec.source(35, 35)],
                structures: [spec.spawn(25, 25)],
            },
            {
                name: ROOM_2,
                controller: spec.controller({ level: 1 }),
                sources: [spec.source(20, 20)],
            },
        ],
        bots: [{ username: BOT_USERNAME, room: ROOM_1 }],
        ticks,
        profiling: opts.profiling,
        logLevel: 'errors',
        metrics: { every: 1, rooms: true },
    });

    try {
        const { report } = world;
        await world.run();

        assertBotWorked(report);
        assertNoErrors(report);

        // Series комнат независимы.
        const r1 = getRoomMetrics(report, ROOM_1);
        const r2 = getRoomMetrics(report, ROOM_2);

        assert.strictEqual(r1.length, ticks, `${ROOM_1}: ожидали ${ticks} сэмплов`);
        assert.strictEqual(r2.length, ticks, `${ROOM_2}: ожидали ${ticks} сэмплов`);

        // Разные начальные RCL.
        assertLatestMetricAtLeast(report, 'rooms', ROOM_1, 'rcl', 2);
        assertMetricReached(report, 'rooms', ROOM_2, 'rcl', 1);
        assert.strictEqual(r2[r2.length - 1].rcl, 1, `${ROOM_2}: RCL должен оставаться 1`);

        // Снимок мира включает обе комнаты.
        const snapshot = getWorldSnapshotAtTick(report, 5);
        assert.ok(snapshot[ROOM_1], `снимок на tick 5 должен включать ${ROOM_1}`);
        assert.ok(snapshot[ROOM_2], `снимок на tick 5 должен включать ${ROOM_2}`);

        // Структура отчёта стабильна.
        assert.ok(report.metrics.colonies, 'должен быть раздел colonies');
        assert.ok(report.metrics.bots, 'должен быть раздел bots');
        assert.ok(Array.isArray(report.metrics.world), 'world должен быть массивом');

        console.log(`PASS: metrics-multi-room (${report.ticksRun} ticks)`);
        return report;
    } finally {
        await world.dispose();
    }
}

module.exports = { run };
