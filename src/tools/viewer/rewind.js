'use strict';

/**
 * @file Rewinds the mockup server to a past tick by reconstructing state
 *   from per-tick snapshots (`sit:snap:<N>`), then delegating to
 *   `restoreState` for the actual DB overwrite.
 *
 * Responsibility:
 *   - `rewindToTick` — thin wrapper: reads sit:snap, builds snapshot object,
 *     calls `restoreState`.  Does NOT contain restore logic itself.
 *
 * @module tools/viewer/rewind
 */

const { restoreState } = require('../../lib/orchestration/restoreState');

/**
 * @typedef {import('../../lib/runtime/storageAdapter').StorageAdapter} StorageAdapter
 */

/**
 * Rewinds the server to tick N using per-tick snapshots (sit:snap:<N>).
 *
 * This is a thin wrapper over {@link restoreState}.  It reads the flat
 * object array from `sit:snap:<N>`, builds a minimal snapshot object
 * (without terrain/flags — rewind preserves static structure), and
 * delegates all DB/env overwrite logic to `restoreState`.
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
    const { env } = adapter;

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

    // 3. Build snapshot object
    //    terrain/flags are NOT included — restoreState skips them
    //    when the key is absent (rewind preserves static terrain)
    const snapshot = {
        version: '2.0',
        meta: {
            scenario: '',
            timestamp: '',
            tick: tickN,
            bots: Object.keys(bots),
            rooms: Object.keys(roomStatus),
            botConfig: {},
            frameworkVersion: '',
        },
        db: {
            'rooms.objects': allObjects,
            // 'rooms.terrain' — intentionally absent: rewind doesn't touch terrain
            // 'rooms.flags' — intentionally absent: rewind doesn't touch flags
        },
        env: {
            gameTime: tickN,
            memory: extras.memories || {},
            roomStatus: null,
            accessibleRooms: null,
        },
    };

    // 4. Delegate to restoreState
    return restoreState(adapter, bots, snapshot, extras);
}

module.exports = { rewindToTick };
