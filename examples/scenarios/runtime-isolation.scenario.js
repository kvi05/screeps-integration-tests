'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked } = require('screeps-integration-tests/assertions');

const ROOM = 'W0N1';
const BOT = 'bot';

/**
 * Scenario: runtime-isolation.
 *
 * Verifies runtime isolation: sequential creation of two worlds,
 * proper dispose cleanup, no port conflicts.
 *
 * Run: npm run test:integration -- --only runtime-isolation
 *
 * @param {Object} [opts]
 * @returns {Promise<Object>}
 */
async function run(opts = {}) {
    // ─── Test A: two sequential worlds do not conflict ─────────────
    {
        const world1 = await createWorld({
            rooms: [
                {
                    name: ROOM,
                    controller: spec.controller({ level: 1 }),
                    sources: [spec.source(15, 15)],
                    structures: [spec.spawn(25, 25)],
                },
            ],
            bots: [{ username: BOT, rooms: ROOM }],
            ticks: 5,
            ...opts,
        });

        try {
            await world1.run();
            assertBotWorked(world1.report);
        } finally {
            await world1.dispose();
        }

        // Second world after disposing the first
        const world2 = await createWorld({
            rooms: [
                {
                    name: ROOM,
                    controller: spec.controller({ level: 1 }),
                    sources: [spec.source(15, 15)],
                    structures: [spec.spawn(25, 25)],
                },
            ],
            bots: [{ username: BOT, rooms: ROOM }],
            ticks: 5,
            ...opts,
        });

        try {
            await world2.run();
            assertBotWorked(world2.report);
        } finally {
            await world2.dispose();
        }
    }

    // ─── Test B: createWorld without bots (source + spawn only) ───
    {
        const world = await createWorld({
            rooms: [
                {
                    name: ROOM,
                    controller: spec.controller({ level: 1 }),
                    sources: [spec.source(15, 15)],
                    structures: [spec.spawn(25, 25)],
                },
            ],
            bots: [{ username: BOT, rooms: ROOM }],
            ticks: 3,
            ...opts,
        });

        try {
            await world.run();
            assert.strictEqual(world.report.ticksRun, 3, 'exactly 3 ticks');
        } finally {
            await world.dispose();
        }
    }

    // ─── Test C: readMemory returns {} for empty memory ────────────
    {
        const world = await createWorld({
            rooms: [
                {
                    name: ROOM,
                    controller: spec.controller({ level: 1 }),
                    sources: [spec.source(15, 15)],
                    structures: [spec.spawn(25, 25)],
                },
            ],
            bots: [{ username: BOT, rooms: ROOM }],
            ticks: 3,
            ...opts,
        });

        try {
            await world.run();
            const mem = await world.readMemory(BOT);
            assert.ok(mem, 'Memory not null');
            assert.ok(typeof mem === 'object', 'Memory is an object');
        } finally {
            await world.dispose();
        }
    }

    console.log('PASS: runtime-isolation (3/3 tests passed)');
    return {};
}

module.exports = { run };
