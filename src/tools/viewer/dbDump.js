'use strict';

/**
 * @file Collects a full DB dump from the mockup server for snapshot
 *   save/load. Reads rooms.objects, rooms.terrain, rooms.flags, and
 *   relevant env keys (gameTime, memory, roomStatus).
 *
 * Responsibility:
 *   - `collectFullDump` — reads the full DB state and returns a v2 snapshot object
 *   - `restoreFromDump` — thin wrapper over `restoreState` from lib/orchestration
 *   - No worker restart needed — the mockup tick processor is stateless between ticks
 *
 * @module tools/viewer/dbDump
 */

const { restoreState } = require('../../lib/orchestration/restoreState');
const { getBotMemory } = require('../../lib/builders/memory');

/**
 * @typedef {import('../../lib/runtime/storageAdapter').StorageAdapter} StorageAdapter
 */

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Builds a minimal botConfig object from bots map for snapshot metadata.
 *
 * Stores the bot's user `_id` so that a world recreated from the snapshot
 * can remap object ownership (the new server assigns fresh bot ids).
 *
 * @param {Object<string, {id:string}>} bots — map of username → { id }
 * @returns {Object<string, {username:string, id:string|null, opts:{}}>}
 */
function buildBotConfig(bots) {
    /** @type {Object<string, {username:string, id:string|null, opts:{}}>} */
    const config = {};
    for (const [username, bot] of Object.entries(bots)) {
        config[username] = { username, id: bot.id || null, opts: {} };
    }
    return config;
}

// ─── collectFullDump ───────────────────────────────────────────────────────

/**
 * Collects a full snapshot of the current DB state.
 *
 * Reads all rooms.objects, rooms.terrain, rooms.flags collections and
 * relevant env keys (gameTime, memory, roomStatus, accessibleRooms).
 * Bot Memory is collected per-bot via getBotMemory.
 *
 * The returned snapshot uses format v2 with:
 *   - `version: '2.0'`
 *   - `meta.botConfig` — per-bot configuration
 *   - `meta.frameworkVersion` — package version
 *
 * @param {StorageAdapter} adapter
 * @param {Object<string, {id:string}>} bots — map of username → { id }
 * @param {Object<string, *>} roomStatus
 * @param {string} scenarioPath
 * @returns {Promise<Object>} — snapshot object ready for JSON serialization
 */
async function collectFullDump(adapter, bots, roomStatus, scenarioPath) {
    const { db, env } = adapter;

    // 1. DB collections
    const roomObjects = await db['rooms.objects'].find({});
    const roomTerrain = await db['rooms.terrain'].find({});
    const roomFlags = db['rooms.flags'] ? await db['rooms.flags'].find({}) : [];

    // 2. Env keys
    const gameTime = parseInt((await env.get(env.keys.GAMETIME)) || '0', 10);
    const roomStatusData = await env.get(env.keys.ROOM_STATUS_DATA);
    const accessibleRooms = await env.get(env.keys.ACCESSIBLE_ROOMS);

    // 3. Bot Memory
    /** @type {Object<string, *>} */
    const memory = {};
    for (const [username, bot] of Object.entries(bots)) {
        try {
            memory[username] = await getBotMemory(adapter, bot.id);
        } catch {
            memory[username] = {};
        }
    }

    return {
        version: '2.0',
        meta: {
            scenario: scenarioPath,
            timestamp: new Date().toISOString(),
            tick: gameTime,
            bots: Object.keys(bots),
            rooms: Object.keys(roomStatus),
            botConfig: buildBotConfig(bots),
            frameworkVersion: require('../../../package.json').version,
        },
        db: {
            'rooms.objects': roomObjects,
            'rooms.terrain': roomTerrain,
            'rooms.flags': roomFlags,
        },
        env: {
            gameTime,
            memory,
            roomStatus: roomStatusData ? JSON.parse(roomStatusData) : null,
            accessibleRooms: accessibleRooms ? JSON.parse(accessibleRooms) : null,
        },
    };
}

// ─── restoreFromDump ───────────────────────────────────────────────────────

/**
 * Restores the DB from a snapshot, overwriting the current state.
 * Does NOT restart the server — overwrites in-place.
 *
 * This is a thin wrapper over {@link restoreState} from
 * `lib/orchestration/restoreState.js`.  All actual DB/env overwrite
 * logic lives there.
 *
 * @param {StorageAdapter} adapter
 * @param {Object<string, {id:string}>} bots — map of username → { id }
 * @param {Object} snapshot — previously saved snapshot from collectFullDump
 * @param {Object} [extras]
 * @param {Object} [extras.report] — worker report to update ticksRun
 * @returns {Promise<{tick:number, rooms:number, bots:number}>}
 * @throws {Error} if snapshot is missing db or env
 */
async function restoreFromDump(adapter, bots, snapshot, extras = {}) {
    // Validate snapshot format
    if (!snapshot.db || !snapshot.env) {
        throw new Error('Invalid snapshot: missing db or env');
    }
    return restoreState(adapter, bots, snapshot, extras);
}

module.exports = { collectFullDump, restoreFromDump };
