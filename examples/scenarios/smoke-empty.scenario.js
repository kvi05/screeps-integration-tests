'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');

/**
 * Scenario: smoke-empty.
 *
 * Minimal smoke test: one room (RCL1, 2 sources, no creeps), one bot.
 * Verifies: framework starts, bot runs N ticks, no crashes, no errors.
 *
 * Run: npm run test:integration -- --only smoke-empty
 *
 * @param {Object} [opts] — options from runScenario.js (profiling, ...)
 * @returns {Promise<Object>} report
 */
async function run(opts = {}) {
    const ticks = parseInt(process.env.TEST_TICKS || '30', 10);
    const world = await createWorld({
        rooms: [spec.baseRoom('W0N1')],
        bots: [{ username: 'bot', rooms: 'W0N1' }],
        ticks,
        profiling: opts.profiling,
    });

    try {
        await world.run();

        assertBotWorked(world.report);
        assertNoErrors(world.report);
        assert.strictEqual(world.report.ticksRun, ticks, `expected ${ticks} ticks, got ${world.report.ticksRun}`);

        console.log(`PASS: smoke-empty (${world.report.ticksRun} ticks, ${world.report.wallClockMs}ms)`);
        return world.report;
    } finally {
        await world.dispose();
    }
}

module.exports = { run };
