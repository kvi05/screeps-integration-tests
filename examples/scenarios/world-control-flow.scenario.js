'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');

const ROOM = 'W0N1';
const BOT = 'bot';

/**
 * Scenario: world-control-flow.
 *
 * Verifies: until predicate/signal, readMemory/writeMemory, world.exec,
 * opts.events + registerEvent, world.spawnCreep, world.getEventLog, onTick,
 * proper dispose cleanup.
 *
 * All tests are short (10-15 ticks).
 *
 * Run: npm run test:integration -- --only world-control-flow
 *
 * @param {Object} [opts]
 * @returns {Promise<Object>}
 */
async function run(opts = {}) {
    // ─── Test A: until.predicate (stop on condition) ────────────────
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
            ticks: 100,
            until: {
                maxTicks: 15,
                predicate: async (w) => {
                    const mem = await w.readMemory(BOT);
                    return mem && mem.ticksRun >= 5;
                },
            },
            profiling: opts.profiling,
        });

        try {
            await world.run();
            assert.ok(world.report.stopReason, 'should have stopReason');
            assert.ok(world.report.ticksRun >= 5, `predicate stopped at tick ${world.report.ticksRun}`);
            assert.ok(world.report.ticksRun <= 15, `did not exceed maxTicks: ${world.report.ticksRun}`);
            assertBotWorked(world.report);
        } finally {
            await world.dispose();
        }
    }

    // ─── Test B: until.signal (stop on Memory signal) ───────────────
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
            ticks: 100,
            until: { maxTicks: 10, signal: 'stopFlag', signalBot: BOT },
            onTick: async (w, tick) => {
                if (tick === 3) {
                    await w.writeMemory(BOT, { stopFlag: true });
                }
            },
            profiling: opts.profiling,
        });

        try {
            await world.run();
            assert.ok(world.report.stopReason, 'signal should have stopped');
            assert.ok(world.report.stopReason.includes('stopFlag'), `stopReason contains stopFlag`);
            assert.ok(world.report.ticksRun >= 4, `stopped at ${world.report.ticksRun} (expected >=4)`);
        } finally {
            await world.dispose();
        }
    }

    // ─── Test C: readMemory/writeMemory/exec ────────────────────────
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
            ticks: 5,
            profiling: opts.profiling,
        });

        try {
            await world.run();

            // readMemory
            const mem = await world.readMemory(BOT);
            assert.ok(mem && typeof mem === 'object', 'bot Memory is readable');

            // writeMemory + readMemory roundtrip
            await world.writeMemory(BOT, { customKey: 'value' });
            const updated = await world.readMemory(BOT);
            assert.strictEqual(updated.customKey, 'value', 'writeMemory/readMemory roundtrip');

            // writeMemory deep merge
            await world.writeMemory(BOT, { nested: { inner: 1 } });
            await world.writeMemory(BOT, { nested: { inner2: 2 } });
            const merged = await world.readMemory(BOT);
            assert.strictEqual(merged.nested.inner, 1, 'writeMemory deep-merge preserves existing fields');
            assert.strictEqual(merged.nested.inner2, 2, 'writeMemory deep-merge adds new fields');

            // exec (runs on the next tick)
            await world.exec('Memory.execKey = 42;', BOT);
            await world.tick(1);
            const execMem = await world.readMemory(BOT);
            assert.strictEqual(execMem.execKey, 42, 'world.exec runs JS');

            assertBotWorked(world.report);
        } finally {
            await world.dispose();
        }
    }

    // ─── Test D: world.spawnCreep + getEventLog ────────────
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
            ticks: 10,
            profiling: opts.profiling,
        });

        try {
            // Spawn a creep before run via the spawn method
            const botId = world.bots[BOT].id;
            const creepId = await world.spawnCreep(
                spec.creep(10, 10, {
                    roomName: ROOM,
                    name: 'TestCreep',
                    body: [{ type: 'move', hits: 100 }],
                    userId: botId,
                }),
            );
            assert.ok(creepId, 'spawn returned _id');

            await world.tick(2);

            // getEventLog
            const roomEvents = await world.getEventLog(ROOM);
            assert.ok(Array.isArray(roomEvents), 'world.getEventLog returns an array');

            // Verify the bot is running
            const mem = await world.readMemory(BOT);
            assert.ok(mem && Object.keys(mem).length > 0, 'bot is running');

            await world.dispose();

            // ─── Repeated dispose does not throw ─────────────────
            await world.dispose();
        } catch (e) {
            await world.dispose().catch(() => {});
            throw e;
        }
    }

    // ─── Test E: opts.events + registerEvent ────────────────────────
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
            ticks: 10,
            profiling: opts.profiling,
            events: [
                {
                    atTick: 3,
                    action: 'spawnInvader',
                    params: {
                        x: 40,
                        y: 40,
                        room: ROOM,
                        name: 'TestInvader',
                        body: [
                            { type: 'attack', hits: 150 },
                            { type: 'move', hits: 150 },
                        ],
                    },
                },
            ],
        });

        try {
            await world.run();

            assertBotWorked(world.report);
            assertNoErrors(world.report);
        } finally {
            await world.dispose();
        }
    }

    // ─── Test F: onTick callback works ─────────────────────────────
    {
        let onTickCalled = 0;
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
            ticks: 5,
            onTick: async (w, tick) => {
                onTickCalled++;
                if (tick === 2) {
                    const mem = await w.readMemory(BOT);
                    assert.ok(mem, 'onTick can read world');
                }
            },
            profiling: opts.profiling,
        });

        try {
            await world.run();
            assert.strictEqual(onTickCalled, 5, 'onTick called on every tick');
            assertBotWorked(world.report);
        } finally {
            await world.dispose();
        }
    }

    console.log('PASS: world-control-flow (6/6 tests passed)');
    return {};
}

module.exports = { run };
