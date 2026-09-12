'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');

const ROOM = 'W0N1';

/**
 * Base rooms and bots for spawn tests.
 */
const BASE_ROOM_WITH_SPAWN = {
    name: ROOM,
    controller: spec.controller({ level: 1 }),
    sources: [spec.source(15, 15)],
    structures: [spec.spawn(25, 25)],
};

/**
 * Single bot for most tests.
 */
const BOT_SPEC = [{ username: 'bot', rooms: ROOM }];

/**
 * Scenario: world-spawn.
 *
 * Verifies the `world.spawnCreep()` method: creating creeps in different modes,
 * error handling, working with spec constructors, multiple spawns,
 * spawn before/during run, verification via find.
 *
 * Each test uses a separate createWorld + try/finally dispose.
 *
 * Run: npm run test:integration -- --only world-spawn
 *
 * @param {Object} [opts]
 * @returns {Promise<Object>} report
 */
async function run(opts = {}) {
    // ─── W1: Basic spawn modes (A, B, C, D, E, F, O) ───────────────
    {
        const world = await createWorld({
            rooms: [BASE_ROOM_WITH_SPAWN],
            bots: BOT_SPEC,
            ticks: 10,
            logLevel: 'error',
            ...opts,
        });

        try {
            const botId = world.botId();

            // Test A: spawn with explicit userId
            {
                const creepId = await world.spawnCreep(
                    spec.creep(10, 10, {
                        roomName: ROOM,
                        name: 'TestCreep_A',
                        body: [{ type: 'move', hits: 100 }],
                        userId: botId,
                    }),
                );
                assert.ok(typeof creepId === 'string', 'A: spawn returns a string _id');
                const creep = await world.findOne({ _id: creepId });
                assert.ok(creep, 'A: creep found in DB');
                assert.strictEqual(creep.name, 'TestCreep_A');
                assert.strictEqual(creep.room, ROOM);
                assert.strictEqual(creep.x, 10);
                assert.strictEqual(creep.y, 10);
                assert.strictEqual(creep.user, botId, 'A: userId matches bot.id');
                assert.strictEqual(creep.type, 'creep');
            }

            // Test B: spawn without userId (single bot — fallback)
            {
                const creepId = await world.spawnCreep(
                    spec.creep(12, 12, {
                        roomName: ROOM,
                        name: 'TestCreep_B',
                        body: [{ type: 'work', hits: 100 }],
                    }),
                );
                assert.ok(typeof creepId === 'string', 'B: spawn without userId returns _id');
                const creep = await world.findOne({ _id: creepId });
                assert.ok(creep, 'B: creep found in DB');
                assert.strictEqual(creep.user, botId, 'B: userId = defaultBotUserId');
            }

            // Test C: spawn with userId='2' (invader)
            {
                const creepId = await world.spawnCreep(
                    spec.creep(30, 30, {
                        roomName: ROOM,
                        name: 'Invader_C',
                        body: [{ type: 'attack', hits: 100 }],
                        userId: '2',
                    }),
                );
                assert.ok(typeof creepId === 'string', 'C: spawn with userId="2"');
                const creep = await world.findOne({ _id: creepId });
                assert.strictEqual(creep.user, '2', 'C: invader has userId="2"');
            }

            // Test D: spawn via spec.creep()
            {
                const creepSpec = spec.creep(15, 20, {
                    roomName: ROOM,
                    name: 'SpecCreep_D',
                    userId: botId,
                });
                const creepId = await world.spawnCreep(creepSpec);
                assert.ok(typeof creepId === 'string', 'D: spawn(spec.creep())');
                const creep = await world.findOne({ _id: creepId });
                assert.strictEqual(creep.name, 'SpecCreep_D');
                assert.strictEqual(creep.x, 15);
                assert.strictEqual(creep.y, 20);
                assert.strictEqual(creep.user, botId);
                assert.strictEqual(creep.body.length, 6, 'D: default body = 6');
                assert.strictEqual(creep.body[0].type, 'work');
                assert.strictEqual(creep.body[3].type, 'move');
                const expectedHits = creep.body.reduce((s, p) => s + p.hits, 0);
                assert.strictEqual(creep.hits, expectedHits, 'D: hits = sum of body');
            }

            // Test E: spawn via spec.invader()
            {
                const creepId = await world.spawnCreep(spec.invader(40, 40, { roomName: ROOM, name: 'Invader_E' }));
                assert.ok(typeof creepId === 'string', 'E: spawn(spec.invader())');
                const creep = await world.findOne({ _id: creepId });
                assert.strictEqual(creep.user, '2', 'E: invader userId="2"');
                assert.strictEqual(creep.body.length, 6, 'E: body = 6');
                assert.strictEqual(creep.body[0].type, 'attack');
            }

            // Test F: spawn via spec.dummyTarget()
            {
                const creepId = await world.spawnCreep(spec.dummyTarget(10, 10, { roomName: ROOM, name: 'Dummy_F' }));
                assert.ok(typeof creepId === 'string', 'F: spawn(spec.dummyTarget())');
                const creep = await world.findOne({ _id: creepId });
                assert.strictEqual(creep.name, 'Dummy_F');
                assert.strictEqual(creep.user, botId, 'F: dummyTarget gets defaultBotUserId');
            }

            // Test O: spawn returns unique _id on each call
            {
                const id1 = await world.spawnCreep(
                    spec.creep(1, 1, {
                        roomName: ROOM,
                        name: 'Unique_O_1',
                        body: [{ type: 'move', hits: 100 }],
                        userId: botId,
                    }),
                );
                const id2 = await world.spawnCreep(
                    spec.creep(2, 2, {
                        roomName: ROOM,
                        name: 'Unique_O_2',
                        body: [{ type: 'move', hits: 100 }],
                        userId: botId,
                    }),
                );
                assert.notStrictEqual(id1, id2, 'O: each spawn returns a unique _id');
            }

            await world.run();
            assertBotWorked(world.report);
            assertNoErrors(world.report);
        } finally {
            await world.dispose();
        }
    }

    // ─── W2: botId in single-bot (P, Q, R) ──────────────────────────
    {
        const world = await createWorld({
            rooms: [BASE_ROOM_WITH_SPAWN],
            bots: BOT_SPEC,
            ticks: 5,
            ...opts,
            logLevel: 'error',
        });

        try {
            // Test P: botId() with no arguments
            assert.strictEqual(world.botId(), world.botId(), 'P: botId() returns _id of the only bot');

            // Test Q: botId('bot') by username
            assert.strictEqual(world.botId('bot'), world.botId(), 'Q: botId("bot") returns _id');

            // Test R: botId(0) by index
            assert.strictEqual(world.botId(0), world.botId(), 'R: botId(0) returns _id of the first bot');

            await world.run();
            assertBotWorked(world.report);
        } finally {
            await world.dispose();
        }
    }

    // ─── W2.5: explicit userId: null (S) ────────────────────────────
    {
        const world = await createWorld({
            rooms: [BASE_ROOM_WITH_SPAWN],
            bots: BOT_SPEC,
            ticks: 5,
            ...opts,
            logLevel: 'error',
        });

        try {
            // Test S: spawn with explicit userId: null does not get default
            const creepId = await world.spawnCreep(
                spec.creep(5, 5, {
                    roomName: ROOM,
                    name: 'NoUser_Creep',
                    body: [{ type: 'move', hits: 100 }],
                    userId: null,
                }),
            );
            const creep = await world.findOne({ _id: creepId });
            assert.strictEqual(creep.user, null, 'S: explicit userId: null preserved');

            await world.run();
            assertBotWorked(world.report);
        } finally {
            await world.dispose();
        }
    }

    // ─── W3: Error paths of spawn (G, I) ─────────────────────────────
    {
        const world = await createWorld({
            rooms: [BASE_ROOM_WITH_SPAWN],
            bots: BOT_SPEC,
            ticks: 5,
            ...opts,
            logLevel: 'error',
        });

        try {
            const botId = world.botId();

            // Test G: spawn without roomName → error
            await assert.rejects(
                world.spawnCreep({
                    x: 10,
                    y: 10,
                    name: 'NoRoom_Creep',
                    body: [{ type: 'move', hits: 100 }],
                    userId: botId,
                }),
                /roomName is required/,
                'G: spawn without roomName throws an error',
            );

            // Test I: spawn without body → error
            await assert.rejects(
                world.spawnCreep({
                    roomName: ROOM,
                    x: 10,
                    y: 10,
                    name: 'NoBody_Creep',
                    userId: botId,
                }),
                /body is required/,
                'I: spawn without body throws an error',
            );

            await world.run();
            assertBotWorked(world.report);
        } finally {
            await world.dispose();
        }
    }

    // ─── W4: Advanced spawn (J, K, L, N) ─────────────────────────────────
    {
        const world = await createWorld({
            rooms: [
                BASE_ROOM_WITH_SPAWN,
                {
                    name: 'W0N2',
                    sources: [spec.source(15, 15)],
                    structures: [spec.spawn(25, 25)],
                },
            ],
            bots: BOT_SPEC,
            ticks: 10,
            ...opts,
            logLevel: 'error',
        });

        try {
            const botId = world.botId();

            // Test J: spawn with custom body
            {
                const customBody = [
                    { type: 'work', hits: 150 },
                    { type: 'carry', hits: 100 },
                    { type: 'move', hits: 150 },
                    { type: 'heal', hits: 200 },
                ];
                const creepId = await world.spawnCreep(
                    spec.creep(20, 25, {
                        roomName: ROOM,
                        name: 'CustomBody_J',
                        body: customBody,
                        userId: botId,
                        hits: 600,
                        hitsMax: 800,
                    }),
                );
                const creep = await world.findOne({ _id: creepId });
                assert.strictEqual(creep.body.length, 4, 'J: 4 body parts');
                assert.deepStrictEqual(creep.body, customBody, 'J: body matches');
                assert.strictEqual(creep.hits, 600, 'J: custom hits');
                assert.strictEqual(creep.hitsMax, 800, 'J: custom hitsMax');
            }

            // Test K: multiple spawn
            {
                const NUM_CREEPS = 5;
                const ids = [];
                for (let i = 0; i < NUM_CREEPS; i++) {
                    const id = await world.spawnCreep(
                        spec.creep(10 + i, 10, {
                            roomName: ROOM,
                            name: `MultiCreep_K_${i}`,
                            body: [{ type: 'move', hits: 100 }],
                            userId: botId,
                        }),
                    );
                    ids.push(id);
                }
                assert.strictEqual(ids.length, NUM_CREEPS, 'K: created 5 creeps');
                assert.strictEqual(new Set(ids).size, NUM_CREEPS, 'K: all _id are unique');
            }

            // Test L: spawn before run
            {
                const preId = await world.spawnCreep(
                    spec.creep(5, 5, {
                        roomName: ROOM,
                        name: 'PreRun_Creep_L',
                        body: [{ type: 'move', hits: 100 }],
                        userId: botId,
                    }),
                );
                assert.ok(preId, 'L: spawn before run returned _id');
            }

            // Test N: spawn in a neutral room (W0N2)
            {
                const creepId = await world.spawnCreep(
                    spec.creep(20, 20, {
                        roomName: 'W0N2',
                        name: 'NeutralRoom_N',
                        body: [{ type: 'move', hits: 100 }],
                        userId: botId,
                    }),
                );
                assert.ok(typeof creepId === 'string', 'N: spawn in neutral room');
                const creep = await world.findOne({ _id: creepId });
                assert.ok(creep, 'N: creep found in neutral room');
                assert.strictEqual(creep.room, 'W0N2');
            }

            await world.run();

            // L: verify survival after run
            {
                const preCreep = await world.findOne({ name: 'PreRun_Creep_L' });
                assert.ok(preCreep, 'L: creep survived after run');
                assert.strictEqual(preCreep.hits, 100, 'L: hits unchanged');
            }

            assertBotWorked(world.report);
            assertNoErrors(world.report);
        } finally {
            await world.dispose();
        }
    }

    // ─── W5: onTick spawn (M) ────────────────────────────────────────────
    {
        const world = await createWorld({
            rooms: [BASE_ROOM_WITH_SPAWN],
            bots: BOT_SPEC,
            ticks: 15,
            until: { maxTicks: 15 },
            onTick: async (w, tick) => {
                if (tick === 5) {
                    await w.spawnCreep(
                        spec.creep(15, 15, {
                            roomName: ROOM,
                            name: 'OnTick_Creep_M',
                            body: [{ type: 'work', hits: 100 }],
                            userId: w.botId(),
                        }),
                    );
                }
            },
            ...opts,
            logLevel: 'error',
        });

        try {
            await world.run();

            const creeps = await world.find({ room: ROOM, name: 'OnTick_Creep_M' });
            assert.strictEqual(creeps.length, 1, 'M: creep survived after run');
            assert.strictEqual(creeps[0].hits, 100, 'M: hits unchanged');

            assertBotWorked(world.report);
            assertNoErrors(world.report);
        } finally {
            await world.dispose();
        }
    }

    // ─── W6a: botId in multi-bot (S, T, U) ────────────────────────────
    {
        const world = await createWorld({
            rooms: [
                {
                    name: ROOM,
                    sources: [spec.source(15, 15)],
                    structures: [spec.spawn(25, 25)],
                },
            ],
            bots: [
                { username: 'bot1', rooms: ROOM },
                { username: 'bot2', rooms: ROOM },
            ],
            ticks: 5,
            ...opts,
            logLevel: 'error',
        });

        try {
            // Test S: botId(0) returns _id of the first bot
            assert.strictEqual(world.botId(0), world.botId(0), 'S: botId(0) = _id of the first bot');

            // Test T: botId(1) returns _id of the second bot
            assert.strictEqual(world.botId(1), world.botId(1), 'T: botId(1) = _id of the second bot');

            // Test U: botId('unknown') → throws
            assert.throws(() => world.botId('unknown_username'), /not found/, 'U: botId("unknown") throws an error');

            await world.run();
            assertNoErrors(world.report);
        } finally {
            await world.dispose();
        }
    }

    // ─── W6b: no-bots — spawn error + botId (H, V) ───────────────────────
    {
        const world = await createWorld({
            rooms: [
                {
                    name: ROOM,
                    sources: [spec.source(15, 15)],
                    structures: [spec.spawn(25, 25)],
                },
            ],
            bots: [],
            ticks: 3,
            ...opts,
            logLevel: 'error',
        });

        try {
            // Test H: spawn without userId and without bots → error
            await assert.rejects(
                world.spawnCreep({
                    roomName: ROOM,
                    x: 10,
                    y: 10,
                    name: 'NoBot_Creep_H',
                    body: [{ type: 'move', hits: 100 }],
                }),
                /userId is required/,
                'H: spawn without userId and no bots throws an error',
            );

            // Test V: botId() without bots → throws
            assert.throws(() => world.botId(), /no bots/, 'V: botId() without bots throws an error');

            await world.run();
            assertNoErrors(world.report);
        } finally {
            await world.dispose();
        }
    }

    console.log('PASS: world-spawn (22/22 tests passed)');
    return {};
}

module.exports = { run };
