'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');
const { MetricsAssert } = require('screeps-integration-tests/metric-assertions');

const BOT_USERNAME = 'bot';
const ROOM_1 = 'W0N1';
const ROOM_2 = 'W0N2';

/**
 * Scenario: metrics-multi-room.
 *
 * Verifies that metrics of two rooms are stored in separate time-series
 * and do not interleave. Uses a short run.
 *
 * Run: npm run test:integration -- --only metrics-multi-room
 *
 * @param {Object} [opts] — options from runScenario.js (profiling, ...)
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

        // MetricsReport — report.metrics contains data + methods.
        const m = report.metrics;

        // Room series are independent.
        const r1 = m.room(ROOM_1);
        const r2 = m.room(ROOM_2);

        assert.strictEqual(r1.length, ticks, `${ROOM_1}: expected ${ticks} samples`);
        assert.strictEqual(r2.length, ticks, `${ROOM_2}: expected ${ticks} samples`);

        // Different initial RCLs.
        const ma = new MetricsAssert(m);
        ma.latestAtLeast('rooms', ROOM_1, 'rcl', 2);
        ma.reached('rooms', ROOM_2, 'rcl', 1);
        assert.strictEqual(r2[r2.length - 1].rcl, 1, `${ROOM_2}: RCL should stay 1`);

        // Snapshot of both rooms at tick 5.
        const snapshot = m.snapshotAtTick('rooms', 5);
        assert.ok(snapshot[ROOM_1], `snapshot at tick 5 should include ${ROOM_1}`);
        assert.ok(snapshot[ROOM_2], `snapshot at tick 5 should include ${ROOM_2}`);

        // Report structure is stable (MetricsReport getters).
        assert.deepStrictEqual(m.colonies, {}, 'colonies should be an empty object');
        assert.deepStrictEqual(m.bots, {}, 'bots should be an empty object');
        assert.ok(Array.isArray(m.world), 'world should be an array');

        console.log(`PASS: metrics-multi-room (${report.ticksRun} ticks)`);
        return report;
    } finally {
        await world.dispose();
    }
}

module.exports = { run };
