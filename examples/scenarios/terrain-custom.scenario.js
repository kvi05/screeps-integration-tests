'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');
const { registerRoomFixture } = require('screeps-integration-tests/room-fixtures');
const { TERRAIN_MASK_WALL, TERRAIN_MASK_SWAMP } = require('screeps-integration-tests/constants');

/**
 * Scenario: terrain-custom.
 *
 * Verifies custom terrain support in all forms:
 * - Test A: positional terrain via RoomSpecInput inline
 * - Test B: terrain from a room fixture
 * - Test C: terrain overrides on fixture
 * - Test D: matrix format terrain
 * - Test E: callback format terrain
 *
 * Run: npm run test:integration -- --only terrain-custom
 *
 * @param {Object} [opts] — options from runScenario.js (profiling, ...)
 * @returns {Promise<Object>} report
 */
async function run(opts = {}) {
    const ticks = parseInt(process.env.TEST_TICKS || '20', 10);

    // ── Test A: positional terrain inline ────────────────────────────────
    {
        const world = await createWorld({
            rooms: [
                {
                    name: 'W0N1',
                    terrain: {
                        walls: [
                            { x: 10, y: 10 },
                            { x: 11, y: 10 },
                        ],
                        swamps: [{ x: 20, y: 20 }],
                    },
                    controller: spec.controller({ level: 1 }),
                    structures: [spec.spawn(25, 25)],
                    sources: [spec.source(15, 15)],
                },
            ],
            bots: [{ username: 'bot', rooms: ['W0N1'] }],
            ticks,
            profiling: opts.profiling,
            logLevel: 'error',
        });

        try {
            await world.run();

            // Verify terrain was actually applied
            const terrainPromiseA = world.evalInBot(`
                const t = Game.map.getRoomTerrain('W0N1');
                JSON.stringify({ w10_10: t.get(10,10), w11_10: t.get(11,10), s20_20: t.get(20,20) });
            `);
            await world.tick(1);
            const tcA = await terrainPromiseA;
            assert.strictEqual(tcA.w10_10, TERRAIN_MASK_WALL, 'A: expected wall at (10,10)');
            assert.strictEqual(tcA.w11_10, TERRAIN_MASK_WALL, 'A: expected wall at (11,10)');
            assert.strictEqual(tcA.s20_20, TERRAIN_MASK_SWAMP, 'A: expected swamp at (20,20)');

            assertBotWorked(world.report);
            assertNoErrors(world.report);
            assert.strictEqual(world.report.ticksRun, ticks + 1);
            console.log(`PASS: terrain-custom A — positional inline (${world.report.ticksRun} ticks)`);
        } finally {
            await world.dispose();
        }
    }

    // ── Test B: terrain from a room fixture ─────────────────────────────
    {
        // Register a fixture inline for the test (doesn't depend on auto-loading)
        registerRoomFixture('terrain-test-b', {
            controller: spec.controller({ level: 1 }),
            sources: [spec.source(15, 35)],
            structures: [spec.spawn(25, 25)],
            terrain: {
                walls: [
                    { x: 5, y: 5 },
                    { x: 6, y: 5 },
                ],
                swamps: [{ x: 30, y: 30 }],
            },
        });

        const world = await createWorld({
            rooms: [
                {
                    name: 'W0N1',
                    roomFixture: 'terrain-test-b',
                },
            ],
            bots: [{ username: 'bot', rooms: ['W0N1'] }],
            ticks,
            profiling: opts.profiling,
            logLevel: 'error',
        });

        try {
            await world.run();

            // Verify terrain from fixture was applied
            const terrainPromiseB = world.evalInBot(`
                const t = Game.map.getRoomTerrain('W0N1');
                JSON.stringify({ w5_5: t.get(5,5), w6_5: t.get(6,5), s30_30: t.get(30,30) });
            `);
            await world.tick(1);
            const tcB = await terrainPromiseB;
            assert.strictEqual(tcB.w5_5, TERRAIN_MASK_WALL, 'B: expected wall at (5,5)');
            assert.strictEqual(tcB.w6_5, TERRAIN_MASK_WALL, 'B: expected wall at (6,5)');
            assert.strictEqual(tcB.s30_30, TERRAIN_MASK_SWAMP, 'B: expected swamp at (30,30)');

            assertBotWorked(world.report);
            assertNoErrors(world.report);
            assert.strictEqual(world.report.ticksRun, ticks + 1);
            console.log(`PASS: terrain-custom B — from room fixture (${world.report.ticksRun} ticks)`);
        } finally {
            await world.dispose();
        }
    }

    // ── Test C: terrain overrides on fixture ────────────────────────────
    {
        registerRoomFixture('terrain-test-c', {
            controller: spec.controller({ level: 1 }),
            sources: [spec.source(15, 35)],
            structures: [spec.spawn(25, 25)],
            terrain: { walls: [{ x: 1, y: 1 }] },
        });

        // Override terrain with different walls
        const world = await createWorld({
            rooms: [
                {
                    name: 'W0N1',
                    roomFixture: 'terrain-test-c',
                    roomOverrides: {
                        terrain: { walls: [{ x: 10, y: 10 }], swamps: [{ x: 20, y: 20 }] },
                    },
                },
            ],
            bots: [{ username: 'bot', rooms: ['W0N1'] }],
            ticks,
            profiling: opts.profiling,
            logLevel: 'error',
        });

        try {
            await world.run();

            // Verify override terrain replaced fixture terrain
            const terrainPromiseC = world.evalInBot(`
                const t = Game.map.getRoomTerrain('W0N1');
                JSON.stringify({ w10_10: t.get(10,10), s20_20: t.get(20,20), w1_1: t.get(1,1) });
            `);
            await world.tick(1);
            const tcC = await terrainPromiseC;
            assert.strictEqual(tcC.w10_10, TERRAIN_MASK_WALL, 'C: expected wall at (10,10) from override');
            assert.strictEqual(tcC.s20_20, TERRAIN_MASK_SWAMP, 'C: expected swamp at (20,20) from override');
            assert.strictEqual(tcC.w1_1, 0, 'C: wall at (1,1) should be gone (fixture overridden)');

            assertBotWorked(world.report);
            assertNoErrors(world.report);
            assert.strictEqual(world.report.ticksRun, ticks + 1);
            console.log(`PASS: terrain-custom C — overrides on fixture (${world.report.ticksRun} ticks)`);
        } finally {
            await world.dispose();
        }
    }

    // ── Test D: matrix format terrain ───────────────────────────────────
    {
        // Create a 50×50 matrix with a few walls
        const matrix = Array.from({ length: 50 }, () => new Array(50).fill(0));
        // Wall at (5,5)
        matrix[5][5] = 1; // TERRAIN_MASK_WALL
        // Swamp at (10,10)
        matrix[10][10] = 2; // TERRAIN_MASK_SWAMP

        const world = await createWorld({
            rooms: [
                {
                    name: 'W0N1',
                    terrain: matrix,
                    controller: spec.controller({ level: 1 }),
                    structures: [spec.spawn(25, 25)],
                    sources: [spec.source(15, 15)],
                },
            ],
            bots: [{ username: 'bot', rooms: ['W0N1'] }],
            ticks,
            profiling: opts.profiling,
            logLevel: 'error',
        });

        try {
            await world.run();

            // Verify matrix terrain was applied
            const terrainPromiseD = world.evalInBot(`
                const t = Game.map.getRoomTerrain('W0N1');
                JSON.stringify({ w5_5: t.get(5,5), s10_10: t.get(10,10) });
            `);
            await world.tick(1);
            const tcD = await terrainPromiseD;
            assert.strictEqual(tcD.w5_5, TERRAIN_MASK_WALL, 'D: expected wall at (5,5) from matrix');
            assert.strictEqual(tcD.s10_10, TERRAIN_MASK_SWAMP, 'D: expected swamp at (10,10) from matrix');

            assertBotWorked(world.report);
            assertNoErrors(world.report);
            assert.strictEqual(world.report.ticksRun, ticks + 1);
            console.log(`PASS: terrain-custom D — matrix format (${world.report.ticksRun} ticks)`);
        } finally {
            await world.dispose();
        }
    }

    // ── Test E: callback format terrain ─────────────────────────────────
    {
        const world = await createWorld({
            rooms: [
                {
                    name: 'W0N1',
                    terrain: (matrix) => {
                        // Set a wall barrier
                        for (let x = 0; x < 10; x++) {
                            matrix.set(x, 5, 'wall');
                        }
                        matrix.set(25, 25, 'swamp');
                    },
                    controller: spec.controller({ level: 1 }),
                    structures: [spec.spawn(25, 25)],
                    sources: [spec.source(15, 15)],
                },
            ],
            bots: [{ username: 'bot', rooms: ['W0N1'] }],
            ticks,
            profiling: opts.profiling,
            logLevel: 'error',
        });

        try {
            await world.run();

            // Verify callback terrain was applied
            const terrainPromiseE = world.evalInBot(`
                const t = Game.map.getRoomTerrain('W0N1');
                JSON.stringify({ w0_5: t.get(0,5), w9_5: t.get(9,5), s25_25: t.get(25,25) });
            `);
            await world.tick(1);
            const tcE = await terrainPromiseE;
            assert.strictEqual(tcE.w0_5, TERRAIN_MASK_WALL, 'E: expected wall at (0,5) from callback');
            assert.strictEqual(tcE.w9_5, TERRAIN_MASK_WALL, 'E: expected wall at (9,5) from callback');
            assert.strictEqual(tcE.s25_25, TERRAIN_MASK_SWAMP, 'E: expected swamp at (25,25) from callback');

            assertBotWorked(world.report);
            assertNoErrors(world.report);
            assert.strictEqual(world.report.ticksRun, ticks + 1);
            console.log(`PASS: terrain-custom E — callback format (${world.report.ticksRun} ticks)`);
        } finally {
            await world.dispose();
        }
    }

    console.log('PASS: terrain-custom — all sub-tests passed');
    return { ticksRun: ticks, ok: true };
}

module.exports = { run };
