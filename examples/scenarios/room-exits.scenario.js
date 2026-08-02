'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked } = require('screeps-integration-tests/assertions');

/**
 * Scenario: room-exits.
 *
 * Empirical test of inter-room connections for different topologies:
 *  - vertically adjacent (W0N1 ↔ W0N2)
 *  - horizontally adjacent (W0N1 ↔ W1N1)
 *  - non-adjacent (W0N1 and W5N5 have no direct exit neighbor)
 *
 * Run: npm run test:integration -- --only room-exits
 *
 * @param {Object} [opts] — options from runScenario.js
 * @returns {Promise<Object>} report
 */
async function run(opts = {}) {
    const ticks = parseInt(process.env.TEST_TICKS || '3', 10);

    async function buildWorld(roomsInput) {
        return createWorld({
            rooms: roomsInput,
            bots: [
                {
                    username: 'bot',
                    rooms: roomsInput[0].name,
                    modules: { main: 'module.exports.loop = function() { Memory.__tick = Game.time; };' },
                },
            ],
            ticks,
            profiling: opts.profiling,
            logLevel: 'all',
        });
    }

    // Sends all describeExits requests in one batch, then one tick.
    // Returns map { roomName -> parsed exits | null }.
    async function readExits(world, roomNames) {
        const promises = roomNames.map((r) => world.evalInBot(`JSON.stringify(Game.map.describeExits('${r}'))`));
        await world.tick(1);
        const values = await Promise.all(promises);
        const result = {};
        roomNames.forEach((r, i) => {
            result[r] = values[i];
        });
        return result;
    }

    const TOP = 1;
    const BOTTOM = 5;
    const LEFT = 7;
    const RIGHT = 3;

    // ─── Case 1: vertically adjacent W0N1 (bottom) ↔ W0N2 (top) ───────
    {
        const world = await buildWorld([
            {
                name: 'W0N1',
                controller: spec.controller({ level: 1 }),
                sources: [spec.source(15, 15)],
                structures: [spec.spawn(25, 25)],
            },
            {
                name: 'W0N2',
                controller: spec.controller({ level: 1 }),
                sources: [spec.source(20, 20)],
            },
        ]);
        try {
            const ex = await readExits(world, ['W0N1', 'W0N2']);
            assert.strictEqual(ex['W0N1'][TOP], 'W0N2', 'W0N1.TOP -> W0N2');
            assert.strictEqual(ex['W0N2'][BOTTOM], 'W0N1', 'W0N2.BOTTOM -> W0N1');
            // No phantom exits on other borders
            assert.strictEqual(ex['W0N1'][BOTTOM], undefined, 'W0N1.BOTTOM should not exist');
            assert.strictEqual(ex['W0N1'][LEFT], undefined, 'W0N1.LEFT should not exist');
            assert.strictEqual(ex['W0N1'][RIGHT], undefined, 'W0N1.RIGHT should not exist');
            assert.strictEqual(ex['W0N2'][TOP], undefined, 'W0N2.TOP should not exist');
            assert.strictEqual(ex['W0N2'][LEFT], undefined, 'W0N2.LEFT should not exist');
            assert.strictEqual(ex['W0N2'][RIGHT], undefined, 'W0N2.RIGHT should not exist');
            assertBotWorked(world.report);
        } finally {
            await world.dispose();
        }
    }

    // ─── Case 2: horizontally adjacent W0N1 ↔ W1N1 ───────────────────
    {
        const world = await buildWorld([
            {
                name: 'W0N1',
                controller: spec.controller({ level: 1 }),
                sources: [spec.source(15, 15)],
                structures: [spec.spawn(25, 25)],
            },
            {
                name: 'W1N1',
                controller: spec.controller({ level: 1 }),
                sources: [spec.source(20, 20)],
            },
        ]);
        try {
            const ex = await readExits(world, ['W0N1', 'W1N1']);
            assert.strictEqual(ex['W0N1'][LEFT], 'W1N1', 'W0N1.LEFT -> W1N1');
            assert.strictEqual(ex['W1N1'][RIGHT], 'W0N1', 'W1N1.RIGHT -> W0N1');
            // No phantom exits on other borders
            assert.strictEqual(ex['W0N1'][TOP], undefined, 'W0N1.TOP should not exist');
            assert.strictEqual(ex['W0N1'][BOTTOM], undefined, 'W0N1.BOTTOM should not exist');
            assert.strictEqual(ex['W0N1'][RIGHT], undefined, 'W0N1.RIGHT should not exist');
            assert.strictEqual(ex['W1N1'][TOP], undefined, 'W1N1.TOP should not exist');
            assert.strictEqual(ex['W1N1'][BOTTOM], undefined, 'W1N1.BOTTOM should not exist');
            assert.strictEqual(ex['W1N1'][LEFT], undefined, 'W1N1.LEFT should not exist');
            assertBotWorked(world.report);
        } finally {
            await world.dispose();
        }
    }

    // ─── Case 3: non-adjacent W0N1 and W5N5 — no direct exit between them ─
    {
        const world = await buildWorld([
            {
                name: 'W0N1',
                controller: spec.controller({ level: 1 }),
                sources: [spec.source(15, 15)],
                structures: [spec.spawn(25, 25)],
            },
            {
                name: 'W5N5',
                controller: spec.controller({ level: 1 }),
                sources: [spec.source(20, 20)],
            },
        ]);
        try {
            const ex = await readExits(world, ['W0N1', 'W5N5']);
            // Both rooms are isolated — no exits at all
            assert.deepStrictEqual(ex['W0N1'], {}, 'W0N1 should have no exits');
            assert.deepStrictEqual(ex['W5N5'], {}, 'W5N5 should have no exits');
            assertBotWorked(world.report);
        } finally {
            await world.dispose();
        }
    }

    // ─── Case 4: findRoute between adjacent rooms (for expansion-to-source) ─
    {
        const world = await buildWorld([
            {
                name: 'W0N1',
                controller: spec.controller({ level: 1 }),
                sources: [spec.source(15, 15)],
                structures: [spec.spawn(25, 25)],
            },
            {
                name: 'W0N2',
                controller: spec.controller({ level: 1 }),
                sources: [spec.source(20, 20)],
            },
        ]);
        try {
            const routePromise = world.evalInBot(`JSON.stringify(Game.map.findRoute('W0N1', 'W0N2'))`);
            const exitPromise = world.evalInBot(`JSON.stringify(Game.rooms['W0N1'].findExitTo('W0N2'))`);
            await world.tick(1);
            const route = await routePromise;
            const exitTo = await exitPromise;
            // findRoute returns an array of moves [{exit, room}] or ERR_NO_PATH (-2)
            assert.ok(Array.isArray(route), `findRoute should return an array of moves, got: ${JSON.stringify(route)}`);
            // findExitTo returns an exit constant (TOP=1, RIGHT=3, BOTTOM=5, LEFT=7) or ERR_NO_PATH (-2)
            assert.ok(
                [TOP, RIGHT, BOTTOM, LEFT, -2].includes(exitTo),
                `findExitTo should return an exit constant or ERR_NO_PATH, got: ${exitTo}`,
            );
            assertBotWorked(world.report);
        } finally {
            await world.dispose();
        }
    }

    console.log('PASS: room-exits (all topologies)');
    return { ticksRun: ticks * 4 };
}

module.exports = { run };
