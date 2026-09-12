'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');

/**
 * Scenario: viewer-smoke.
 *
 * Minimal smoke test with viewer enabled: one room (RCL1, 2 sources, no creeps),
 * one bot, 20 ticks. Verifies: framework starts with viewer=true, bot runs,
 * snapshots are collected and sent via IPC.
 *
 * Run: npm run test:integration -- --only viewer-smoke --viewer
 *
 * @param {Object} [opts] — options from runScenario.js (viewer, profiling, ...)
 * @returns {Promise<Object>} report
 */
async function run(opts = {}) {
    const ticks = 20;
    const world = await createWorld({
        rooms: [spec.baseRoom('W0N1')],
        bots: [{ username: 'bot', rooms: 'W0N1' }],
        ticks,
        ...opts,
    });

    try {
        await world.run();

        assertBotWorked(world.report);
        assertNoErrors(world.report);
        assert.strictEqual(world.report.ticksRun, ticks, `expected ${ticks} ticks, got ${world.report.ticksRun}`);

        console.log(
            `PASS: viewer-smoke (${world.report.ticksRun} ticks, ${world.report.wallClockMs}ms, viewer=${!!opts.viewer})`,
        );
        return world.report;
    } finally {
        await world.dispose();
    }
}

module.exports = { run };
