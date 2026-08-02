'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');

/**
 * Scenario: world-lifecycle.
 *
 * Verifies correct interaction between `world.run()` and `world.tick()`.
 *
 * Covered checks:
 * - tick() before run() counts toward the total tick limit
 * - run() does not exceed opts.ticks
 * - repeated run() adds no ticks
 * - tick() after run() without until continues ticking
 * - run()/tick(N) respect until (maxTicks)
 *
 * Run: npm run test:integration -- --only world-lifecycle
 *
 * @param {Object} [opts] — options from runScenario.js (profiling, ...)
 * @returns {Promise<Object>} report
 */
async function run(opts = {}) {
    // ─── Test A: behavior without until ──────────────────────────────────
    {
        const world = await createWorld({
            rooms: [spec.baseRoom('W0N1')],
            bots: [{ username: 'bot', rooms: 'W0N1' }],
            ticks: 10,
            profiling: opts.profiling,
        });

        try {
            // tick() before run() — run() counts already-completed ticks
            await world.tick(3);
            assert.strictEqual(world.report.ticksRun, 3, 'tick(3) should complete 3 ticks');

            // world.report reflects current state after each tick
            assert.ok(world.report.finalMemory.bot, 'finalMemory should be present after tick()');
            assert.ok(typeof world.report.finalMemory.bot === 'object', 'finalMemory should contain bot memory');
            assert.ok(world.report.wallClockMs > 0, 'wallClockMs should be updated after tick()');
            assert.ok(typeof world.report.finalRcl.W0N1 === 'number', 'finalRcl should be present after tick()');

            // sequential tick()
            await world.tick(2);
            assert.strictEqual(world.report.ticksRun, 5, 'tick(2) after tick(3) should give 5');

            // run() catches up to opts.ticks without exceeding the limit
            await world.run();
            assert.strictEqual(world.report.ticksRun, 10, 'run() should catch up to 10 ticks');

            // repeated run() adds no ticks
            await world.run();
            assert.strictEqual(world.report.ticksRun, 10, 'repeated run() should add no ticks');

            // tick() after run() without until continues ticking
            await world.tick(2);
            assert.strictEqual(world.report.ticksRun, 12, 'tick(2) after run() should give 12');

            // run() again does not tick — ticksRun >= opts.ticks
            await world.run();
            assert.strictEqual(world.report.ticksRun, 12, 'run() after tick(2) should not add ticks');

            assertBotWorked(world.report);
            assertNoErrors(world.report);
        } finally {
            await world.dispose();
        }
    }

    // ─── Test B: behavior with until.maxTicks ───────────────────────────
    {
        const world = await createWorld({
            rooms: [
                {
                    name: 'W0N1',
                    controller: spec.controller({ level: 1 }),
                    structures: [spec.spawn(25, 25)],
                },
            ],
            bots: [{ username: 'bot', rooms: 'W0N1' }],
            ticks: 20,
            until: { maxTicks: 10 },
            profiling: opts.profiling,
        });

        try {
            // run() stops at maxTicks
            await world.run();
            assert.strictEqual(world.report.ticksRun, 10, 'run() should stop at maxTicks=10');
            assert.ok(world.report.stopReason, 'should have stopReason');

            // repeated run() adds no ticks
            await world.run();
            assert.strictEqual(
                world.report.ticksRun,
                10,
                'repeated run() should add no ticks when stopReason is present',
            );

            // tick(N) respects until even within N ticks
            await world.tick(15);
            assert.strictEqual(
                world.report.ticksRun,
                10,
                `tick(15) with until.maxTicks=10 should give 10, got ${world.report.ticksRun}`,
            );

            // run() after stop adds no ticks
            await world.run();
            assert.strictEqual(world.report.ticksRun, 10, 'run() after stop does not add ticks');
        } finally {
            await world.dispose();
        }
    }

    console.log('PASS: world-lifecycle (2/2 tests passed)');
    return {};
}

module.exports = { run };
