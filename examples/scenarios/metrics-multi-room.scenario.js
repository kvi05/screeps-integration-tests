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
        metrics: { every: 1, rooms: true, bots: true },
    });

    try {
        const { report } = world;

        // Insert construction sites directly into the DB before the run so
        // that the construction-site room metrics can be verified. The mock
        // bot never builds, so progress stays unchanged.
        const { db } = world.server.common.storage;
        await db['rooms.objects'].insert({
            type: 'constructionSite',
            room: ROOM_1,
            x: 10,
            y: 10,
            progress: 0,
            progressTotal: 100,
        });
        await db['rooms.objects'].insert({
            type: 'constructionSite',
            room: ROOM_1,
            x: 11,
            y: 10,
            progress: 40,
            progressTotal: 200,
        });

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

        // New room metrics: construction sites + total energy.
        ma.reached('rooms', ROOM_1, 'constructionSiteCount', 2);
        // (100-0) + (200-40) = 260
        ma.latestAtLeast('rooms', ROOM_1, 'constructionSiteTotalLeftProgress', 260);
        ma.latestAtLeast('rooms', ROOM_1, 'totalEnergy', 0);

        // Bot metrics (opt-in via metrics.bots): CPU usage, bucket, limit.
        const b = m.bot(BOT_USERNAME);
        assert.strictEqual(b.length, ticks, `${BOT_USERNAME}: expected ${ticks} samples`);
        ma.latestAtLeast('bots', BOT_USERNAME, 'cpuLimit', 100);
        const latestBot = b[b.length - 1];

        assert.strictEqual(latestBot.cpuUsage, 1, 'cpuUsage should be a number');
        assert.strictEqual(latestBot.bucket, 10000, 'bucket should be a number');
        assert.strictEqual(latestBot.cpuLimit, 100, 'cpuLimit should be a number');

        // Report structure is stable (MetricsReport getters).
        assert.deepStrictEqual(m.colonies, {}, 'colonies should be an empty object');
        assert.ok(Array.isArray(m.world), 'world should be an array');

        console.log(`PASS: metrics-multi-room (${report.ticksRun} ticks)`);
        return report;
    } finally {
        await world.dispose();
    }
}

module.exports = { run };
