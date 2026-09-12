'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');
const { STRUCTURE_TOWER } = require('screeps-integration-tests/constants');

/**
 * Scenario: world-helpers.
 *
 * Demonstrates helper methods: setTicksToDowngrade, setHitsStructure,
 * damageHitsStructure, deleteStructure, createStructure, find.
 *
 * Run: npm run test:integration -- --only world-helpers
 *
 * @param {Object} [opts]
 * @returns {Promise<Object>} report
 */
async function run(opts = {}) {
    // ─── World creation ───────────────────────────────────────────────────
    const world = await createWorld({
        rooms: [
            {
                name: 'W0N1',
                controller: spec.controller({ level: 3 }),
                sources: [spec.source(15, 15), spec.source(35, 35)],
                structures: [spec.spawn(25, 25)],
            },
        ],
        bots: [{ username: 'bot', rooms: 'W0N1' }],
        ticks: 5,
        logLevel: 'error',
        ...opts,
    });

    try {
        const { report } = world;

        // ─── setTicksToDowngrade ──────────────────────────────────────────
        // Set downgradeTime = gameTime + 5000
        await world.setTicksToDowngrade('W0N1', 5000);

        // ─── createStructure ───────────────────────────────────────────────
        // Create a tower and a wall via spec
        const towerId = await world.createStructure(spec.tower(26, 24, { roomName: 'W0N1' }));
        const wallId = await world.createStructure(spec.wall(30, 30, { roomName: 'W0N1', hits: 500000 }));

        assert.ok(typeof towerId === 'string', 'towerId should be a string');
        assert.ok(typeof wallId === 'string', 'wallId should be a string');

        // ─── find ─────────────────────────────────────────────────────────
        // Find all towers
        const towers = await world.find({ room: 'W0N1', type: STRUCTURE_TOWER });
        assert.strictEqual(towers.length, 1, 'should be 1 tower');
        assert.strictEqual(towers[0].id, towerId, 'tower id from find matches id from createStructure');

        // Find by userId + type (maps to user)
        const myTower = await world.findOne({ type: STRUCTURE_TOWER, userId: world.botId() });
        assert.ok(myTower, 'should find the tower');
        assert.strictEqual(myTower.type, STRUCTURE_TOWER);

        // findId with index=0 for a source
        const sourceId = await world.findId({ room: 'W0N1', type: 'source' }, { index: 0 });
        assert.ok(typeof sourceId === 'string', 'sourceId should be a string');

        // ─── damageHitsStructure ──────────────────────────────────────────
        // Deal damage to the wall
        await world.damageHitsStructure(wallId, 10000);
        const wallAfterDamage = await world.findOne({ _id: wallId });
        assert.strictEqual(wallAfterDamage.hits, 490000, 'wall hits should decrease by 10000');

        // ─── setHitsStructure ─────────────────────────────────────────────
        // Restore hits and verify clamp to hitsMax
        await world.setHitsStructure(wallId, 999999999);
        const wallAfterRepair = await world.findOne({ _id: wallId });
        assert.strictEqual(wallAfterRepair.hits, 300000000, 'hits should not exceed hitsMax (300M)');

        // ─── deleteStructure ──────────────────────────────────────────────
        // Remove the tower
        await world.deleteStructure(towerId);
        const deletedTower = await world.findOne({ _id: towerId });
        assert.strictEqual(deletedTower, null, 'tower should be removed from DB');

        // ─── Run ──────────────────────────────────────────────────────────
        await world.run();

        // ─── Assertions ───────────────────────────────────────────────────
        assertBotWorked(report);
        assertNoErrors(report);

        console.log(`\nPASS: world-helpers (${report.ticksRun} ticks, ${report.wallClockMs / 1000}s)`);
        return report;
    } finally {
        await world.dispose();
    }
}

module.exports = { run };
