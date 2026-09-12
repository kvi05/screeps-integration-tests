'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');
const { MetricsReport, MetricsRegression } = require('screeps-integration-tests/metrics');

const BOT_USERNAME = 'bot';
const ROOM = 'W0N1';

/**
 * Scenario: metrics-regression.
 *
 * Verifies MetricsRegression against a baseline built from the current run:
 * an identical baseline passes, a perturbed baseline is detected, and an
 * absolute tolerance absorbs small differences.
 *
 * Run: npm run test:integration -- --only metrics-regression
 *
 * @param {Object} [opts] — options from runScenario.js (profiling, ...)
 * @returns {Promise<Object>} report
 */
async function run(opts = {}) {
    const ticks = parseInt(process.env.TEST_TICKS || '10', 10);
    const world = await createWorld({
        rooms: [
            {
                name: ROOM,
                controller: spec.controller({ level: 2 }),
                sources: [spec.source(15, 15), spec.source(35, 35)],
                structures: [spec.spawn(25, 25)],
            },
        ],
        bots: [{ username: BOT_USERNAME, rooms: ROOM }],
        ticks,
        logLevel: 'error',
        metrics: { every: 1, rooms: true },
        ...opts,
    });

    try {
        const { report } = world;
        await world.run();

        assertBotWorked(report);
        assertNoErrors(report);

        // Build a baseline MetricsReport from the current room series.
        const baseline = new MetricsReport();
        for (const sample of report.metrics.room(ROOM)) {
            baseline.append('rooms', ROOM, sample.tick, { ...sample });
        }

        const regression = new MetricsRegression(baseline);

        // 1. Identical baseline → metric matches → passed.
        const same = regression.compare(report.metrics, 'rooms', ROOM, 'rcl');
        assert.strictEqual(same.passed, true, 'identical baseline should pass the comparison');
        assert.strictEqual(same.actual, same.expected, 'actual and expected should be equal');

        // 2. Perturbed baseline (rcl 2 -> 3) → difference detected → failed.
        for (const s of baseline.room(ROOM)) {
            s.rcl = 3;
        }
        const changed = regression.compare(report.metrics, 'rooms', ROOM, 'rcl');
        assert.strictEqual(changed.passed, false, 'perturbed baseline should be detected');
        assert.strictEqual(changed.delta, -1, 'delta should be -1 (2 vs 3)');

        // 3. Same difference, but with absolute tolerance → passed.
        const tolerated = regression.compare(report.metrics, 'rooms', ROOM, 'rcl', { tolerance: 5 });
        assert.strictEqual(tolerated.passed, true, 'tolerance should absorb the difference');

        console.log(`PASS: metrics-regression (${report.ticksRun} ticks)`);
        return report;
    } finally {
        await world.dispose();
    }
}

module.exports = { run };
