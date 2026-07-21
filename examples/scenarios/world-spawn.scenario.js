'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');

const ROOM = 'W0N1';

/**
 * Базовые комнаты и боты для spawn-тестов.
 */
const BASE_ROOM_WITH_SPAWN = {
    name: ROOM,
    controller: spec.controller({ level: 1 }),
    sources: [spec.source(15, 15)],
    structures: [spec.spawn(25, 25)],
};

/**
 * Единый бот для большинства тестов.
 */
const BOT_SPEC = [{ username: 'bot', room: ROOM }];

/**
 * Сценарий: world-spawn.
 *
 * Проверяет метод `world.spawn()`: создание крипов в разных режимах,
 * обработку ошибок, работу с spec-конструкторами, множественный spawn,
 * spawn до/во время run, верификацию через find.
 *
 * Каждый тест использует отдельный createWorld + try/finally dispose.
 *
 * Запуск: npm run test:integration -- --only world-spawn
 *
 * @param {Object} [opts]
 * @returns {Promise<Object>} report
 */
async function run(opts = {}) {
    // ─── W1: Базовые spawn-режимы (A, B, C, D, E, F, O) ────────────────
    {
        const world = await createWorld({
            rooms: [BASE_ROOM_WITH_SPAWN],
            bots: BOT_SPEC,
            ticks: 10,
            profiling: opts.profiling,
            logLevel: 'error',
        });

        try {
            const botId = world.botId();

            // Test A: spawn с явным userId
            {
                const creepId = await world.spawn({
                    roomName: ROOM,
                    x: 10,
                    y: 10,
                    name: 'TestCreep_A',
                    body: [{ type: 'move', hits: 100 }],
                    userId: botId,
                });
                assert.ok(typeof creepId === 'string', 'A: spawn возвращает строку _id');
                const creep = await world.findOne({ _id: creepId });
                assert.ok(creep, 'A: крип найден в БД');
                assert.strictEqual(creep.name, 'TestCreep_A');
                assert.strictEqual(creep.room, ROOM);
                assert.strictEqual(creep.x, 10);
                assert.strictEqual(creep.y, 10);
                assert.strictEqual(creep.user, botId, 'A: userId совпадает с bot.id');
                assert.strictEqual(creep.type, 'creep');
            }

            // Test B: spawn без userId (single bot — fallback)
            {
                const creepId = await world.spawn({
                    roomName: ROOM,
                    x: 12,
                    y: 12,
                    name: 'TestCreep_B',
                    body: [{ type: 'work', hits: 100 }],
                });
                assert.ok(typeof creepId === 'string', 'B: spawn без userId возвращает _id');
                const creep = await world.findOne({ _id: creepId });
                assert.ok(creep, 'B: крип найден в БД');
                assert.strictEqual(creep.user, botId, 'B: userId = defaultBotUserId');
            }

            // Test C: spawn с userId='2' (invader)
            {
                const creepId = await world.spawn({
                    roomName: ROOM,
                    x: 30,
                    y: 30,
                    name: 'Invader_C',
                    body: [{ type: 'attack', hits: 100 }],
                    userId: '2',
                });
                assert.ok(typeof creepId === 'string', 'C: spawn с userId="2"');
                const creep = await world.findOne({ _id: creepId });
                assert.strictEqual(creep.user, '2', 'C: invader имеет userId="2"');
            }

            // Test D: spawn через spec.creep()
            {
                const creepSpec = spec.creep(15, 20, {
                    roomName: ROOM,
                    name: 'SpecCreep_D',
                    userId: botId,
                });
                const creepId = await world.spawn(creepSpec);
                assert.ok(typeof creepId === 'string', 'D: spawn(spec.creep())');
                const creep = await world.findOne({ _id: creepId });
                assert.strictEqual(creep.name, 'SpecCreep_D');
                assert.strictEqual(creep.x, 15);
                assert.strictEqual(creep.y, 20);
                assert.strictEqual(creep.user, botId);
                assert.strictEqual(creep.body.length, 6, 'D: body по умолчанию = 6');
                assert.strictEqual(creep.body[0].type, 'work');
                assert.strictEqual(creep.body[3].type, 'move');
                const expectedHits = creep.body.reduce((s, p) => s + p.hits, 0);
                assert.strictEqual(creep.hits, expectedHits, 'D: hits = сумма body');
            }

            // Test E: spawn через spec.invader()
            {
                const creepId = await world.spawn(spec.invader(40, 40, { roomName: ROOM, name: 'Invader_E' }));
                assert.ok(typeof creepId === 'string', 'E: spawn(spec.invader())');
                const creep = await world.findOne({ _id: creepId });
                assert.strictEqual(creep.user, '2', 'E: invader userId="2"');
                assert.strictEqual(creep.body.length, 6, 'E: body = 6');
                assert.strictEqual(creep.body[0].type, 'attack');
            }

            // Test F: spawn через spec.dummyTarget()
            {
                const creepId = await world.spawn(spec.dummyTarget(10, 10, { roomName: ROOM, name: 'Dummy_F' }));
                assert.ok(typeof creepId === 'string', 'F: spawn(spec.dummyTarget())');
                const creep = await world.findOne({ _id: creepId });
                assert.strictEqual(creep.name, 'Dummy_F');
                assert.strictEqual(creep.user, botId, 'F: dummyTarget получает defaultBotUserId');
            }

            // Test O: spawn возвращает уникальные _id при каждом вызове
            {
                const id1 = await world.spawn({
                    roomName: ROOM,
                    x: 1,
                    y: 1,
                    name: 'Unique_O_1',
                    body: [{ type: 'move', hits: 100 }],
                    userId: botId,
                });
                const id2 = await world.spawn({
                    roomName: ROOM,
                    x: 2,
                    y: 2,
                    name: 'Unique_O_2',
                    body: [{ type: 'move', hits: 100 }],
                    userId: botId,
                });
                assert.notStrictEqual(id1, id2, 'O: каждый spawn возвращает уникальный _id');
            }

            await world.run();
            assertBotWorked(world.report);
            assertNoErrors(world.report);
        } finally {
            await world.dispose();
        }
    }

    // ─── W2: botId в single-bot (P, Q, R) ────────────────────────────────
    {
        const world = await createWorld({
            rooms: [BASE_ROOM_WITH_SPAWN],
            bots: BOT_SPEC,
            ticks: 5,
            profiling: opts.profiling,
            logLevel: 'error',
        });

        try {
            // Test P: botId() без аргументов
            assert.strictEqual(world.botId(), world.botId(), 'P: botId() возвращает _id единственного бота');

            // Test Q: botId('bot') по username
            assert.strictEqual(world.botId('bot'), world.botId(), 'Q: botId("bot") возвращает _id');

            // Test R: botId(0) по индексу
            assert.strictEqual(world.botId(0), world.botId(), 'R: botId(0) возвращает _id первого бота');

            await world.run();
            assertBotWorked(world.report);
        } finally {
            await world.dispose();
        }
    }

    // ─── W3: Error-пути spawn (G, I) ─────────────────────────────────────
    {
        const world = await createWorld({
            rooms: [BASE_ROOM_WITH_SPAWN],
            bots: BOT_SPEC,
            ticks: 5,
            profiling: opts.profiling,
            logLevel: 'error',
        });

        try {
            const botId = world.botId();

            // Test G: spawn без roomName → ошибка
            await assert.rejects(
                world.spawn({
                    x: 10,
                    y: 10,
                    name: 'NoRoom_Creep',
                    body: [{ type: 'move', hits: 100 }],
                    userId: botId,
                }),
                /roomName is required/,
                'G: spawn without roomName throws an error',
            );

            // Test I: spawn без body → ошибка
            await assert.rejects(
                world.spawn({
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
            profiling: opts.profiling,
            logLevel: 'error',
        });

        try {
            const botId = world.botId();

            // Test J: spawn с кастомным body
            {
                const customBody = [
                    { type: 'work', hits: 150 },
                    { type: 'carry', hits: 100 },
                    { type: 'move', hits: 150 },
                    { type: 'heal', hits: 200 },
                ];
                const creepId = await world.spawn({
                    roomName: ROOM,
                    x: 20,
                    y: 25,
                    name: 'CustomBody_J',
                    body: customBody,
                    userId: botId,
                    hits: 600,
                    hitsMax: 800,
                });
                const creep = await world.findOne({ _id: creepId });
                assert.strictEqual(creep.body.length, 4, 'J: 4 body parts');
                assert.deepStrictEqual(creep.body, customBody, 'J: body совпадает');
                assert.strictEqual(creep.hits, 600, 'J: кастомные hits');
                assert.strictEqual(creep.hitsMax, 800, 'J: кастомные hitsMax');
            }

            // Test K: множественный spawn
            {
                const NUM_CREEPS = 5;
                const ids = [];
                for (let i = 0; i < NUM_CREEPS; i++) {
                    const id = await world.spawn({
                        roomName: ROOM,
                        x: 10 + i,
                        y: 10,
                        name: `MultiCreep_K_${i}`,
                        body: [{ type: 'move', hits: 100 }],
                        userId: botId,
                    });
                    ids.push(id);
                }
                assert.strictEqual(ids.length, NUM_CREEPS, 'K: создано 5 крипов');
                assert.strictEqual(new Set(ids).size, NUM_CREEPS, 'K: все _id уникальны');
            }

            // Test L: spawn до run
            {
                const preId = await world.spawn({
                    roomName: ROOM,
                    x: 5,
                    y: 5,
                    name: 'PreRun_Creep_L',
                    body: [{ type: 'move', hits: 100 }],
                    userId: botId,
                });
                assert.ok(preId, 'L: spawn до run вернул _id');
            }

            // Test N: spawn в нейтральную комнату (W0N2)
            {
                const creepId = await world.spawn({
                    roomName: 'W0N2',
                    x: 20,
                    y: 20,
                    name: 'NeutralRoom_N',
                    body: [{ type: 'move', hits: 100 }],
                    userId: botId,
                });
                assert.ok(typeof creepId === 'string', 'N: spawn в нейтральную комнату');
                const creep = await world.findOne({ _id: creepId });
                assert.ok(creep, 'N: крип найден в нейтральной комнате');
                assert.strictEqual(creep.room, 'W0N2');
            }

            await world.run();

            // L: верификация выживания после run
            {
                const preCreep = await world.findOne({ name: 'PreRun_Creep_L' });
                assert.ok(preCreep, 'L: крип выжил после run');
                assert.strictEqual(preCreep.hits, 100, 'L: hits не изменились');
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
                    await w.spawn({
                        roomName: ROOM,
                        x: 15,
                        y: 15,
                        name: 'OnTick_Creep_M',
                        body: [{ type: 'work', hits: 100 }],
                        userId: w.botId(),
                    });
                }
            },
            profiling: opts.profiling,
            logLevel: 'error',
        });

        try {
            await world.run();

            const creeps = await world.find({ room: ROOM, name: 'OnTick_Creep_M' });
            assert.strictEqual(creeps.length, 1, 'M: крип выжил после run');
            assert.strictEqual(creeps[0].hits, 100, 'M: hits не изменились');

            assertBotWorked(world.report);
            assertNoErrors(world.report);
        } finally {
            await world.dispose();
        }
    }

    // ─── W6a: botId в multi-bot (S, T, U) ────────────────────────────────
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
                { username: 'bot1', room: ROOM },
                { username: 'bot2', room: ROOM },
            ],
            ticks: 5,
            profiling: opts.profiling,
            logLevel: 'error',
        });

        try {
            // Test S: botId(0) возвращает _id первого бота
            assert.strictEqual(world.botId(0), world.botId(0), 'S: botId(0) = _id первого бота');

            // Test T: botId(1) возвращает _id второго бота
            assert.strictEqual(world.botId(1), world.botId(1), 'T: botId(1) = _id второго бота');

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
            profiling: opts.profiling,
            logLevel: 'error',
        });

        try {
            // Test H: spawn без userId и без ботов → ошибка
            await assert.rejects(
                world.spawn({
                    roomName: ROOM,
                    x: 10,
                    y: 10,
                    name: 'NoBot_Creep_H',
                    body: [{ type: 'move', hits: 100 }],
                }),
                /userId is required/,
                'H: spawn without userId and no bots throws an error',
            );

            // Test V: botId() без ботов → throws
            assert.throws(() => world.botId(), /defaultBot/, 'V: botId() without bots throws an error');

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
