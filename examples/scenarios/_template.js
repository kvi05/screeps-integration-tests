'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');

// ─── Room constants ─────────────────────────────────────────────────────────
// Extract frequently used configs to the top of the scenario
// to avoid duplicating spec calls in each createWorld.
const ROOM = 'W0N1';

const BASE_ROOM = {
    name: ROOM,
    controller: spec.controller({ level: 1 }),
    sources: [spec.source(15, 15), spec.source(35, 35)],
    structures: [spec.spawn(25, 25)],
};

/** @type {import('screeps-integration-tests').BotSpec[]} */
const BOT_SPEC = [{ username: 'bot', rooms: ROOM }];

/**
 * Scenario: <filename without .scenario.js>.
 *
 * <description>
 *
 * Expected behavior: <optional>
 *
 * Verifies: <--->
 *
 * Run: npm run test:integration -- --only <filename-without-.scenario.js>
 *
 * @param {Object} [opts] — options from runScenario.js (profiling, ...)
 * @returns {Promise<Object>} report
 */
async function run(opts = {}) {
    const ticks = parseInt(process.env.TEST_TICKS || '100', 10);

    // ─── World creation ───────────────────────────────────────────────────
    const world = await createWorld({
        rooms: [BASE_ROOM],
        bots: BOT_SPEC,
        ticks: ticks,
        profiling: opts.profiling,
        logLevel: 'error',
    });

    try {
        // ─── High-level helpers (always available) ────────────────────────
        //   world.botId()                    — _id of the first (only) bot
        //   world.botId('bot')               — _id of the bot by username
        //   world.botId(0)                   — _id of the bot by index (0-based)
        //   world.find(query)                — search objects in rooms.objects
        //   world.findOne(query)             — single object or null
        //   world.createStructure(spec)      — create a structure
        //   world.setHitsStructure(id, hits) — set HP (0 to destroy cleanly)
        //   world.damageHitsStructure(id,dmg)— deal damage
        //   world.deleteStructure(id)        — remove a structure (directly from DB, bypassing standard mechanics)
        //   world.getEventLog(room)          — room events for the tick
        //   world.readMemory(user?)          — read bot Memory
        //   world.writeMemory(user, patch)   — update Memory

        // ─── Actions ─────────────────────────────────────────────────────
        await world.run();

        // ─── Assertions ───────────────────────────────────────────────────
        assertBotWorked(world.report);
        assertNoErrors(world.report);
        assert.ok(true, 'description if test fails');

        console.log(`\nPASS: <Scenario name> (${world.report.ticksRun} ticks, ${world.report.wallClockMs / 1000}s)`);
        return world.report;
    } finally {
        await world.dispose();
    }
}

module.exports = { run };
