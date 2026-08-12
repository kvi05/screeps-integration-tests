'use strict';

/**
 * @file Rewinds the mockup server to a past tick by reconstructing state
 *   from per-tick snapshots (`sit:snap:<N>`), then overwriting the DB.
 *   Does NOT restart the worker — overwrites in-place.
 *
 * Responsibility:
 *   - `rewindToTick` — full rewind: validate, reconstruct, overwrite, truncate
 *
 * @module tools/viewer/rewind
 */

const { clearAndRefill } = require('./dbDump');
const { getBotMemory } = require('../../lib/builders/memory');

/**
 * @typedef {import('../../lib/runtime/storageAdapter').StorageAdapter} StorageAdapter
 */

/**
 * Rewinds the server to tick N using per-tick snapshots (sit:snap:<N>).
 *
 * Steps:
 *   1. Validate tickN < current gameTime
 *   2. Read per-tick snapshot — flat array of ALL room objects
 *   3. Reconstruct Memory from extras.memories (IPC round-trip) or fallback
 *   4. Overwrite db['rooms.objects'] (clear + refill via clearAndRefill)
 *   5. Overwrite env Memory for each bot
 *   6. Set gameTime = tickN
 *   7. Truncate future sit:snap keys (ticks > tickN are gone)
 *   8. Truncate roomHistory
 *   9. Update report.ticksRun (if extras.report)
 *
 * @param {StorageAdapter} adapter
 * @param {Object<string, {id:string}>} bots — map of username → { id }
 * @param {Object<string, *>} roomStatus
 * @param {number} tickN — target tick to rewind to
 * @param {Object} [extras]
 * @param {Object<string,Object>} [extras.memories] — reconstructed Memory
 *   per bot (from memoryHistory via IPC round-trip)
 * @param {Object} [extras.report] — worker's report object to update ticksRun
 * @returns {Promise<{tick:number, rooms:number, bots:number}>}
 * @throws {Error} if tickN >= current gameTime or no snapshot at tickN
 */
async function rewindToTick(adapter, bots, roomStatus, tickN, extras = {}) {
    const { db, env } = adapter;

    // 1. Validate
    const currentTick = parseInt((await env.get(env.keys.GAMETIME)) || '0', 10);
    if (tickN >= currentTick) {
        throw new Error(
            `Cannot rewind to tick ${tickN}: current tick is ${currentTick}. ` +
                'Rewind target must be strictly before the current tick.',
        );
    }

    // 2. Read per-tick snapshot (flat array of ALL room objects)
    const raw = await env.get('sit:snap:' + tickN);
    if (!raw) {
        throw new Error(`No snapshot at tick ${tickN}. ` + `Available range: 0–${currentTick - 1}`);
    }
    const allObjects = JSON.parse(raw);

    // 3. Reconstruct Memory for each bot
    //    extras.memories comes from parent's memoryHistory via IPC round-trip.
    //    Fall back to current Memory if a bot has no reconstructed data.
    /** @type {Object<string, Object>} */
    const memories = {};
    for (const [username, bot] of Object.entries(bots)) {
        let mem = extras.memories && extras.memories[username];
        if (mem === null || mem === undefined) {
            // Fallback: use current Memory (best effort)
            try {
                mem = await getBotMemory(adapter, bot.id);
            } catch {
                mem = {};
            }
        }
        memories[username] = mem;
    }

    // 4. Overwrite rooms.objects (clear + refill with stripped LokiJS internals)
    await clearAndRefill(db['rooms.objects'], allObjects, 'rooms.objects');

    // 5. Overwrite Memory
    for (const [username, bot] of Object.entries(bots)) {
        if (memories[username] !== null && memories[username] !== undefined) {
            await env.set(env.keys.MEMORY + bot.id, JSON.stringify(memories[username]));
        }
    }

    // 6. Set gameTime
    await env.set(env.keys.GAMETIME, String(tickN));

    // 7. Truncate: delete FUTURE sit:snap keys (ticks after tickN are gone)
    for (let i = tickN + 1; i <= currentTick; i++) {
        try {
            await env.del('sit:snap:' + i);
        } catch {
            /* ignore — key may not exist */
        }
    }

    // 8. Truncate roomHistory (past is gone after rewind)
    for (const roomName of Object.keys(roomStatus)) {
        try {
            await env.del(env.keys.ROOM_HISTORY + roomName);
        } catch {
            /* ignore — may not exist */
        }
    }

    // 9. Update worker state
    if (extras.report) {
        extras.report.ticksRun = tickN;
        extras.report.stopReason = null;
    }

    return {
        tick: tickN,
        rooms: Object.keys(roomStatus).length,
        bots: Object.keys(bots).length,
    };
}

module.exports = { rewindToTick };
