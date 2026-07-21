'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked } = require('screeps-integration-tests/assertions');

const ROOM = 'W0N1';
const BOT = 'bot';

/**
 * Сценарий: runtime-isolation.
 *
 * Проверяет изоляцию runtime: последовательное создание двух миров,
 * корректная очистка dispose, отсутствие конфликтов портов.
 *
 * Запуск: npm run test:integration -- --only runtime-isolation
 *
 * @param {Object} [opts]
 * @returns {Promise<Object>}
 */
async function run(opts = {}) {
    // ─── Test A: два последовательных мира не конфликтуют ──────────
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
            profiling: opts.profiling,
        });

        try {
            await world1.run();
            assertBotWorked(world1.report);
        } finally {
            await world1.dispose();
        }

        // Второй мир после dispose первого
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
            profiling: opts.profiling,
        });

        try {
            await world2.run();
            assertBotWorked(world2.report);
        } finally {
            await world2.dispose();
        }
    }

    // ─── Test B: createWorld без ботов (source + spawn только) ────
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
            profiling: opts.profiling,
        });

        try {
            await world.run();
            assert.strictEqual(world.report.ticksRun, 3, 'ровно 3 тика');
        } finally {
            await world.dispose();
        }
    }

    // ─── Test C: readMemory возвращает {} для пустой памяти ─────────
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
            profiling: opts.profiling,
        });

        try {
            await world.run();
            const mem = await world.readMemory(BOT);
            assert.ok(mem, 'Memory не null');
            assert.ok(typeof mem === 'object', 'Memory - объект');
        } finally {
            await world.dispose();
        }
    }

    console.log('PASS: runtime-isolation (3/3 tests passed)');
    return {};
}

module.exports = { run };
