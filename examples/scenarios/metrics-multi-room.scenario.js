'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');
const { MetricsAssert } = require('screeps-integration-tests/metric-assertions');

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
        bots: [{ username: BOT_USERNAME, rooms: ROOM_1 }],
        ticks,
        profiling: opts.profiling,
        logLevel: 'error',
        metrics: { every: 1, rooms: true },
    });

    try {
        const { report } = world;
        await world.run();

        assertBotWorked(report);
        assertNoErrors(report);

        // MetricsReport — report.metrics содержит data + методы.
        const m = report.metrics;

        // Series комнат независимы.
        const r1 = m.room(ROOM_1);
        const r2 = m.room(ROOM_2);

        assert.strictEqual(r1.length, ticks, `${ROOM_1}: ожидали ${ticks} сэмплов`);
        assert.strictEqual(r2.length, ticks, `${ROOM_2}: ожидали ${ticks} сэмплов`);

        // Разные начальные RCL.
        const ma = new MetricsAssert(m);
        ma.latestAtLeast('rooms', ROOM_1, 'rcl', 2);
        ma.reached('rooms', ROOM_2, 'rcl', 1);
        assert.strictEqual(r2[r2.length - 1].rcl, 1, `${ROOM_2}: RCL должен оставаться 1`);

        // Снимок обеих комнат на тике 5.
        const snapshot = m.snapshotAtTick('rooms', 5);
        assert.ok(snapshot[ROOM_1], `снимок на tick 5 должен включать ${ROOM_1}`);
        assert.ok(snapshot[ROOM_2], `снимок на tick 5 должен включать ${ROOM_2}`);

        // Структура отчёта стабильна (геттеры MetricsReport).
        assert.deepStrictEqual(m.colonies, {}, 'colonies должен быть пустым объектом');
        assert.deepStrictEqual(m.bots, {}, 'bots должен быть пустым объектом');
        assert.ok(Array.isArray(m.world), 'world должен быть массивом');

        console.log(`PASS: metrics-multi-room (${report.ticksRun} ticks)`);
        return report;
    } finally {
        await world.dispose();
    }
}

module.exports = { run };
