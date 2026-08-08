'use strict';

/**
 * @file Collects a per-tick snapshot from adapter.db for the viewer.
 *
 * Responsibility:
 *   Reads rooms.objects + terrain from the adapter, returns a dojo-compatible
 *   Frame with all objects and terrain data for the current tick.
 *
 * The Frame format is compatible with screeps-dojo recordings, so the
 * dojo Canvas renderer can be reused without modification.
 *
 * @see {@link ../types.FrameObject}  for the FrameObject typedef
 * @see {@link ../types.Frame}       for the Frame typedef
 *
 * @module lib/observers/snapshot
 */

/**
 * @typedef {import('../types').FrameObject} FrameObject
 * @typedef {import('../types').Frame} Frame
 */

// ─── Terrain cache ──────────────────────────────────────────────────────────

/**
 * Cached terrain data keyed by room name.
 * Terrain is static — collected once per room, reused across ticks.
 * @type {Object<string, string[]>}
 */
const terrainCache = Object.create(null);

/**
 * Collects terrain for a single room, caching the result.
 *
 * @param {import('../runtime/storageAdapter').StorageAdapter} adapter
 * @param {string} roomName
 * @returns {Promise<string[]|null>} — terrain rows (50 strings of 50 chars), or null
 */
async function getTerrainCached(adapter, roomName) {
    if (terrainCache[roomName]) {
        return terrainCache[roomName];
    }
    try {
        const matrix = await adapter.world.getTerrain(roomName);
        if (!matrix) return null;

        const rows = [];
        for (let y = 0; y < 50; y++) {
            let row = '';
            for (let x = 0; x < 50; x++) {
                const tile = matrix.get(x, y);
                if (tile === 1) {
                    row += '#'; // wall
                } else if (tile === 2) {
                    row += '~'; // swamp
                } else {
                    row += '.'; // plain
                }
            }
            rows.push(row);
        }
        terrainCache[roomName] = rows;
        return rows;
    } catch {
        return null;
    }
}

// ─── Core ────────────────────────────────────────────────────────────────────

/**
 * Collects all room objects + terrain into a single Frame.
 *
 * @param {import('../runtime/storageAdapter').StorageAdapter} adapter
 * @param {Object<string, import('../types').RoomStatus>} roomStatus
 * @param {Object} report
 * @param {number} tickNum
 * @returns {Promise<Frame>}
 */
async function collectSnapshot(adapter, roomStatus, report, tickNum) {
    const { db } = adapter;

    /** @type {FrameObject[]} */
    const objects = [];

    const roomNames = Object.keys(roomStatus);

    // Collect all objects from all rooms
    const allObjects = await db['rooms.objects'].find({});

    /** @type {Object<string, string[]>} */
    const terrain = {};

    for (const roomName of roomNames) {
        // Objects for this room
        const roomObjects = allObjects.filter((o) => o.room === roomName);

        for (const obj of roomObjects) {
            /** @type {FrameObject} */
            const frameObj = {
                _id: obj._id || obj.id,
                type: obj.type,
                x: obj.x,
                y: obj.y,
                room: obj.room || roomName,
            };

            // Copy optional fields if present
            if (obj.user !== undefined) {
                frameObj.user = obj.user;
            }
            if (obj.hits !== undefined) {
                frameObj.hits = obj.hits;
            }
            if (obj.hitsMax !== undefined) {
                frameObj.hitsMax = obj.hitsMax;
            }
            if (obj.store !== undefined) {
                frameObj.store = obj.store;
            }
            if (obj.storeCapacity !== undefined) {
                frameObj.storeCapacity = obj.storeCapacity;
            }
            if (obj.storeCapacityResource !== undefined) {
                frameObj.storeCapacityResource = obj.storeCapacityResource;
            }
            if (obj.body !== undefined) {
                frameObj.body = obj.body;
            }
            if (obj.name !== undefined) {
                frameObj.name = obj.name;
            }
            if (obj.level !== undefined) {
                frameObj.level = obj.level;
            }
            if (obj.progress !== undefined) {
                frameObj.progress = obj.progress;
            }
            if (obj.progressTotal !== undefined) {
                frameObj.progressTotal = obj.progressTotal;
            }
            if (obj.energy !== undefined) {
                frameObj.energy = obj.energy;
            }
            if (obj.energyCapacity !== undefined) {
                frameObj.energyCapacity = obj.energyCapacity;
            }
            if (obj.actionLog !== undefined) {
                frameObj.actionLog = obj.actionLog;
            }
            if (obj.spawning !== undefined) {
                frameObj.spawning = obj.spawning;
            }
            if (obj.ticksToSpawn !== undefined) {
                frameObj.ticksToSpawn = obj.ticksToSpawn;
            }
            if (obj.amount !== undefined) {
                frameObj.amount = obj.amount;
            }
            if (obj.resourceType !== undefined) {
                frameObj.resourceType = obj.resourceType;
            }
            if (obj.downgradeTime !== undefined) {
                frameObj.downgradeTime = obj.downgradeTime;
            }
            if (obj.safeMode !== undefined) {
                frameObj.safeMode = obj.safeMode;
            }
            if (obj.ageTime !== undefined) {
                frameObj.ageTime = obj.ageTime;
            }
            if (obj.decayTime !== undefined) {
                frameObj.decayTime = obj.decayTime;
            }
            if (obj.isPowerEnabled !== undefined) {
                frameObj.isPowerEnabled = obj.isPowerEnabled;
            }

            objects.push(frameObj);
        }

        // Terrain for this room (cached)
        const rows = await getTerrainCached(adapter, roomName);
        if (rows) {
            terrain[roomName] = rows;
        }
    }

    // Console logs for this tick
    /** @type {Array<{level:string, message:string, bot:string}>} */
    const consoleLines = [];
    if (report._consoleEntries) {
        for (const entry of report._consoleEntries) {
            if (entry.tick === tickNum) {
                consoleLines.push({ level: entry.level, message: entry.message, bot: entry.bot || '' });
            }
        }
    }

    return {
        gameTime: tickNum,
        objects,
        terrain: Object.keys(terrain).length > 0 ? terrain : undefined,
        console: consoleLines.length > 0 ? consoleLines : undefined,
    };
}

/**
 * Clears the terrain cache. Use in test teardown to prevent cross-test pollution.
 */
function clearTerrainCache() {
    for (const key of Object.keys(terrainCache)) {
        delete terrainCache[key];
    }
}

module.exports = { collectSnapshot, clearTerrainCache };
