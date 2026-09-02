'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');
const { readSnapshot } = require('screeps-integration-tests/snapshot');
const { collectFullDump } = require('../../src/tools/viewer/dbDump');
const { createStorageAdapter } = require('../../src/lib/runtime/storageAdapter');

// ─── Constants ─────────────────────────────────────────────────────────────

const ROOM = 'W0N1';
const CREEP_NAME = 'harvester';

/** Ticks run by world A before the snapshot is captured. */
const TICKS_A = 15;
/** Ticks world B continues after restoring from the snapshot object. */
const TICKS_B = 5;
/** Ticks world C continues after restoring from a snapshot file. */
const TICKS_C = 3;

// Custom bot code: moves the creep one tile right every tick.
// Creep movement is only applied when the engine actually PROCESSES the room
// and the bot OWNS the creep — so movement is a reliable end-to-end signal
// that (a) the restored room is active and (b) ownership was remapped.
const BOT_MAIN = [
    "'use strict';",
    'module.exports.loop = function () {',
    `    const creep = Game.creeps['${CREEP_NAME}'];`,
    '    if (creep) {',
    '        creep.move(RIGHT);',
    '    }',
    '    Memory.tick = Game.time;',
    '};',
].join('\n');

/** @type {import('screeps-integration-tests').BotSpec[]} */
const BOT_SPEC = [{ username: 'bot', rooms: ROOM, modules: { main: BOT_MAIN } }];

/** @type {import('screeps-integration-tests').RoomSpecInput} */
const BASE_ROOM = spec.baseRoom(ROOM, {
    creeps: [spec.creep(20, 20, { name: CREEP_NAME })],
});

/**
 * Scenario: snapshot-flow.
 *
 * End-to-end test of the snapshot pipeline:
 *   1. Run a world and capture a full snapshot (v2 format).
 *   2. Recreate the world from the snapshot OBJECT — verify state is
 *      restored (tick, objects, memory, RCL) and the bot keeps working.
 *   3. Recreate the world from a snapshot FILE (CI API) — verify the
 *      exact `createWorld({ snapshot: '<file>' })` usage.
 *   4. Validate `readSnapshot` error handling.
 *
 * The creep movement assertion in phase 2 is the key regression test:
 * it fails when the restored room is not activated in the engine
 * (ticks run empty and fast) or when the restored objects are not
 * remapped to the freshly created bot's id.
 *
 * Run: npm run test:integration -- --only snapshot-flow
 *
 * @param {Object} [opts] — options from runScenario.js (profiling, viewer, ...), spread into createWorld
 * @returns {Promise<Object>} report
 */
async function run(opts = {}) {
    // ═══ Phase 1: world A — run and capture a snapshot ═══════════════════
    const snapshot = await (async () => {
        const worldA = await createWorld({
            rooms: [BASE_ROOM],
            bots: BOT_SPEC,
            ticks: TICKS_A,
            logLevel: 'error',
            ...opts,
        });

        try {
            await worldA.run();
            assert.strictEqual(worldA.report.ticksRun, TICKS_A, 'world A should run all ticks');
            assertBotWorked(worldA.report);
            assertNoErrors(worldA.report);

            // Capture the full world state — the same format the viewer saves.
            const adapter = createStorageAdapter(worldA.server);
            return await collectFullDump(adapter, worldA.bots, worldA.rooms, __filename);
        } finally {
            await worldA.dispose();
        }
    })();

    // ─── Snapshot sanity checks ──────────────────────────────────────────
    // The mockup initialises the gameTime counter to 1, so after N ticks
    // env.gameTime = N + 1.
    assert.strictEqual(snapshot.version, '2.0', 'snapshot must be v2');
    assert.strictEqual(
        snapshot.env.gameTime,
        TICKS_A + 1,
        'snapshot gameTime matches world A ticks (counter starts at 1)',
    );
    assert.deepStrictEqual(snapshot.meta.bots, ['bot'], 'snapshot meta.bots');
    assert.deepStrictEqual(snapshot.meta.rooms, [ROOM], 'snapshot meta.rooms');
    assert.ok(
        snapshot.meta.botConfig.bot && typeof snapshot.meta.botConfig.bot.id === 'string',
        'botConfig stores the bot user id for ownership remapping',
    );
    assert.ok(
        snapshot.db['rooms.objects'].some((o) => o.type === 'creep' && o.name === CREEP_NAME),
        'snapshot contains the creep',
    );

    // readSnapshot accepts and validates the same object
    assert.strictEqual(readSnapshot(snapshot), snapshot, 'readSnapshot passes the object through');

    // ═══ Phase 2: world B — recreate from the snapshot OBJECT ═════════════
    {
        const worldB = await createWorld({
            snapshot,
            bots: BOT_SPEC, // explicit bots: fresh user ids + custom modules
            ticks: snapshot.env.gameTime + TICKS_B,
            logLevel: 'error',
            ...opts,
        });

        try {
            // report starts at the snapshot tick
            assert.strictEqual(
                worldB.report.ticksRun,
                snapshot.env.gameTime,
                'report.ticksRun starts at snapshot gameTime',
            );

            // Objects restored with the same shape
            const objects = await worldB.find({ room: ROOM });
            assert.strictEqual(
                objects.length,
                snapshot.db['rooms.objects'].length,
                'restored object count matches snapshot',
            );

            // Ownership remapped: the new bot owns the restored objects
            const spawn = await worldB.findOne({ type: 'spawn' });
            assert.ok(spawn, 'spawn restored from snapshot');
            assert.strictEqual(spawn.user, worldB.botId(), 'spawn belongs to the new bot');

            const controller = await worldB.findOne({ type: 'controller' });
            assert.ok(controller, 'controller restored from snapshot');
            assert.strictEqual(controller.level, 1, 'controller level restored');

            // Memory restored from the snapshot
            const memoryAfterCreate = await worldB.readMemory('bot');
            assert.deepStrictEqual(memoryAfterCreate, snapshot.env.memory.bot, 'bot Memory restored');

            // The creep is exactly where the snapshot left it
            const creepBefore = await worldB.findOne({ type: 'creep', name: CREEP_NAME });
            assert.ok(creepBefore, 'creep restored from snapshot');

            // Continue ticking from the snapshot tick
            await worldB.run();
            assert.strictEqual(
                worldB.report.ticksRun,
                snapshot.env.gameTime + TICKS_B,
                'world B continues ticking from the snapshot tick',
            );
            assertBotWorked(worldB.report);
            assertNoErrors(worldB.report);
            assert.strictEqual(worldB.report.finalRcl[ROOM], 1, 'RCL preserved');

            // KEY regression check: the creep MOVED. This proves the restored
            // room is processed by the engine (no empty/fast ticks) and the
            // new bot owns the creep (intents are actually applied).
            const creepAfter = await worldB.findOne({ type: 'creep', name: CREEP_NAME });
            assert.strictEqual(
                creepAfter.x,
                creepBefore.x + TICKS_B,
                `creep should move ${TICKS_B} tiles right after restore (room processed + ownership remapped)`,
            );
        } finally {
            await worldB.dispose();
        }
    }

    // ═══ Phase 3: world C — recreate from a snapshot FILE (CI API) ════════
    {
        const snapshotFile = path.join(os.tmpdir(), `sit-snapshot-${process.pid}-${Date.now()}.json`);
        fs.writeFileSync(snapshotFile, JSON.stringify(snapshot));

        try {
            // readSnapshot accepts a file path
            const fromFile = readSnapshot(snapshotFile);
            assert.strictEqual(fromFile.env.gameTime, snapshot.env.gameTime, 'readSnapshot reads the file');

            // No explicit bots — createWorld builds them from snapshot.meta.botConfig
            const worldC = await createWorld({
                snapshot: snapshotFile,
                ticks: snapshot.env.gameTime + TICKS_C,
                logLevel: 'error',
                ...opts,
            });

            try {
                assert.strictEqual(
                    worldC.report.ticksRun,
                    snapshot.env.gameTime,
                    'file launch starts at snapshot tick',
                );

                await worldC.run();
                assert.strictEqual(
                    worldC.report.ticksRun,
                    snapshot.env.gameTime + TICKS_C,
                    'world C continues ticking from the snapshot tick',
                );
                assertBotWorked(worldC.report);
                assertNoErrors(worldC.report);
                assert.strictEqual(worldC.report.finalRcl[ROOM], 1, 'RCL preserved');

                // Game.time continues beyond the snapshot tick (memory is
                // written by the bot on every tick it actually runs).
                const memoryC = await worldC.readMemory('bot');
                assert.ok(
                    typeof memoryC.tick === 'number' && memoryC.tick > TICKS_A,
                    `gameTime should continue past ${TICKS_A}, got ${memoryC.tick}`,
                );
            } finally {
                await worldC.dispose();
            }
        } finally {
            try {
                fs.unlinkSync(snapshotFile);
            } catch {
                /* cleanup */
            }
        }
    }

    // ═══ Phase 4: readSnapshot validation errors ══════════════════════════
    assert.throws(() => readSnapshot({}), /missing db\['rooms\.objects'\]/);
    assert.throws(() => readSnapshot({ db: { 'rooms.objects': [] } }), /missing env\.gameTime/);

    console.log(`PASS: snapshot-flow (save → restore-object → restore-file; ${TICKS_A}+${TICKS_B}+${TICKS_C} ticks)`);
    return {};
}

module.exports = { run };
