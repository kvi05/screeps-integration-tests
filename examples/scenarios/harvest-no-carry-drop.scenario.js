'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked } = require('screeps-integration-tests/assertions');
const { WORK, MOVE, CARRY, FIND_SOURCES, FIND_DROPPED_RESOURCES } = require('screeps-integration-tests/constants');

// ─── Room constants ─────────────────────────────────────────────────────────
const ROOM = 'W0N1';

const BASE_ROOM = {
    name: ROOM,
    controller: spec.controller({ level: 1 }),
    sources: [spec.source(15, 15, { energy: 3000, energyCapacity: 3000 })],
    structures: [spec.spawn(25, 25)],
};

/** @type {import('screeps-integration-tests').BotSpec[]} */
const BOT_SPEC = [{ username: 'bot', rooms: ROOM }];

/**
 * Scenario: harvest-no-carry-drop.
 *
 * Verifies mock server behaviour when a creep without a CARRY body part
 * (or with a full CARRY store) calls `.harvest()` on an energy source.
 *
 * On the official Screeps server, energy that cannot fit into the creep's
 * store automatically drops to the ground as a dropped resource
 * (FIND_DROPPED_RESOURCES).  The mock server does **not** implement this —
 * energy is simply lost.
 *
 * This scenario documents the current mock server limitation so that
 * bot authors are aware their harvest logic may behave differently
 * in integration tests vs. the live server.
 *
 * Run: npm run test:integration -- --only harvest-no-carry-drop
 *
 * @param {Object} [opts] — options from runScenario.js (profiling, ...)
 * @returns {Promise<Object>} report
 */
async function run(opts = {}) {
    // ─── Test A: No-CARRY creep harvest → energy lost ──────────────────
    {
        const world = await createWorld({
            rooms: [BASE_ROOM],
            bots: BOT_SPEC,
            ticks: 0,
            logLevel: 'error',
            ...opts,
        });

        try {
            const botId = world.botId();

            // Spawn a creep with WORK+MOVE (no CARRY), adjacent to the source
            await world.spawnCreep(
                spec.creep(14, 14, {
                    roomName: ROOM,
                    name: 'NoCarry',
                    body: [
                        { type: WORK, hits: 100 },
                        { type: MOVE, hits: 100 },
                    ],
                    userId: botId,
                }),
            );

            // Let the server initialise the creep (populate Game.creeps)
            await world.tick(1);

            // Record pre-harvest source energy
            const sourceBefore = await world.findOne({ room: ROOM, type: 'source' });
            const energyBefore = sourceBefore.energy;

            // Execute harvest via bot console
            await world.exec(`
                const creep = Game.creeps['NoCarry'];
                const sources = creep.room.find(${FIND_SOURCES});
                if (sources.length > 0) {
                    creep.harvest(sources[0]);
                }
            `);

            // Process the harvest intent
            await world.tick(1);

            // ── Assertions ────────────────────────────────────────────

            // Source energy MUST decrease — harvest did happen
            const sourceAfter = await world.findOne({ room: ROOM, type: 'source' });
            assert.ok(
                sourceAfter.energy < energyBefore,
                `A: source energy should decrease after harvest (was ${energyBefore}, now ${sourceAfter.energy})`,
            );

            // Creep store MUST be 0 — no CARRY, cannot hold energy
            const creep = await world.findOne({ room: ROOM, type: 'creep', name: 'NoCarry' });
            assert.strictEqual(creep.store.energy, 0, 'A: creep without CARRY should have 0 energy in store');

            // No dropped resources on the ground — mock server limitation
            const droppedCountPromise = world.evalInBot(`Game.rooms['${ROOM}'].find(${FIND_DROPPED_RESOURCES}).length`);
            await world.tick(1);
            const droppedCount = await droppedCountPromise;
            assert.strictEqual(droppedCount, 0, 'A: no energy dropped on ground (mock server does NOT auto-drop)');

            assertBotWorked(world.report);
            console.log('  ✓ A: No-CARRY harvest → energy lost (no auto-drop)');
        } finally {
            await world.dispose();
        }
    }

    // ─── Test B: Full-CARRY creep harvest → energy lost ───────────────
    {
        const world = await createWorld({
            rooms: [BASE_ROOM],
            bots: BOT_SPEC,
            ticks: 0,
            ...opts,
            logLevel: 'error',
        });

        try {
            const botId = world.botId();
            const carryCap = 50; // 1 × CARRY body part = 50 capacity

            // Spawn a creep with WORK+CARRY+MOVE but pre-fill its store to capacity
            await world.spawnCreep(
                spec.creep(14, 14, {
                    roomName: ROOM,
                    name: 'FullCarry',
                    body: [
                        { type: WORK, hits: 100 },
                        { type: CARRY, hits: 100 },
                        { type: MOVE, hits: 100 },
                    ],
                    store: { energy: carryCap },
                    userId: botId,
                }),
            );

            await world.tick(1);

            const sourceBefore = await world.findOne({ room: ROOM, type: 'source' });
            const energyBefore = sourceBefore.energy;

            await world.exec(`
                const creep = Game.creeps['FullCarry'];
                const sources = creep.room.find(${FIND_SOURCES});
                if (sources.length > 0) {
                    creep.harvest(sources[0]);
                }
            `);

            await world.tick(1);

            // ── Assertions ────────────────────────────────────────────

            const sourceAfter = await world.findOne({ room: ROOM, type: 'source' });
            assert.ok(
                sourceAfter.energy < energyBefore,
                `B: source energy should decrease after harvest (was ${energyBefore}, now ${sourceAfter.energy})`,
            );

            // Creep store MUST stay at capacity — no overflow
            const creep = await world.findOne({ room: ROOM, type: 'creep', name: 'FullCarry' });
            assert.strictEqual(
                creep.store.energy,
                carryCap,
                `B: creep store should stay at capacity (${carryCap}), not overflow`,
            );

            // No dropped resources
            const droppedCountPromise = world.evalInBot(`Game.rooms['${ROOM}'].find(${FIND_DROPPED_RESOURCES}).length`);
            await world.tick(1);
            const droppedCount = await droppedCountPromise;
            assert.strictEqual(droppedCount, 0, 'B: no energy dropped on ground (mock server does NOT auto-drop)');

            assertBotWorked(world.report);
            console.log('  ✓ B: Full-CARRY harvest → energy lost (no auto-drop)');
        } finally {
            await world.dispose();
        }
    }

    console.log('\nPASS: harvest-no-carry-drop');
    return {};
}

module.exports = { run };
