'use strict';

/**
 * Collects and samples time-series metrics from room state each tick.
 */

const {
    STRUCTURE_SPAWN,
    STRUCTURE_TOWER,
    STRUCTURE_EXTENSION,
    STRUCTURE_CONTROLLER,
    STRUCTURE_STORAGE,
    STRUCTURE_CONTAINER,
    TYPE_CREEPS,
} = require('../../constants/screepsConstants');

/**
 * @typedef {import('../storageAdapter').StorageAdapter} StorageAdapter
 * @typedef {import('../types').RoomMetrics} RoomMetrics
 * @typedef {import('../types').MetricsReport} MetricsReport
 */

/**
 * Collects room state metrics.
 *
 * @param {StorageAdapter} adapter
 * @param {string} roomName
 * @returns {Promise<RoomMetrics>}
 */
async function collectMetrics(adapter, roomName) {
    const { db } = adapter;
    const objects = await db['rooms.objects'].find({ room: roomName });

    const controller = objects.find((o) => o.type === STRUCTURE_CONTROLLER);
    const spawns = objects.filter((o) => o.type === STRUCTURE_SPAWN);
    const towers = objects.filter((o) => o.type === STRUCTURE_TOWER);
    const extensions = objects.filter((o) => o.type === STRUCTURE_EXTENSION);
    const creeps = objects.filter((o) => o.type === TYPE_CREEPS);
    const storages = objects.filter((o) => o.type === STRUCTURE_STORAGE);
    const containers = objects.filter((o) => o.type === STRUCTURE_CONTAINER);

    const energyAvailable =
        extensions.reduce((sum, e) => sum + (e.store?.energy || 0), 0) +
        spawns.reduce((sum, s) => sum + (s.store?.energy || 0), 0);

    const energyCapacity =
        extensions.reduce((sum, e) => sum + (e.storeCapacityResource?.energy || 0), 0) +
        spawns.reduce((sum, s) => sum + (s.storeCapacityResource?.energy || 0), 0);

    return {
        rcl: controller?.level || 0,
        rclProgress: controller?.progress || 0,
        energyAvailable,
        energyCapacity,
        spawnCount: spawns.length,
        spawnHits: spawns.map((s) => ({ name: s.name, hits: s.hits, hitsMax: s.hitsMax })),
        towerCount: towers.length,
        towerEnergy: towers.reduce((sum, t) => sum + (t.store?.energy || 0), 0),
        towerCapacity: towers.reduce((sum, t) => sum + (t.storeCapacityResource?.energy || 0), 0),
        extensionCount: extensions.length,
        creepCount: creeps.length,
        creepsByRole: groupCreepsByRole(creeps),
        storageEnergy: storages.reduce((sum, s) => sum + (s.store?.energy || 0), 0),
        containerEnergy: containers.reduce((sum, c) => sum + (c.store?.energy || 0), 0),
        totalHits: objects.reduce((sum, o) => sum + (o.hits || 0), 0),
    };
}

/**
 * Groups creeps by role from name (`role_X` → `X`).
 *
 * @param {Array<{name?: string}>} creeps
 * @returns {Object<string, number>}
 */
function groupCreepsByRole(creeps) {
    /** @type {Object<string,number>} */
    const roles = {};
    for (const creep of creeps) {
        const name = creep.name || '';
        const match = name.match(/^(\w+?)(?:_\d+)?$/);
        const role = match ? match[1] : 'unknown';
        roles[role] = (roles[role] || 0) + 1;
    }
    return roles;
}

/**
 * Adds a room metrics sample to MetricsReport.
 *
 * @param {import('../types').MetricsReport} metricsReport
 * @param {string} roomName
 * @param {RoomMetrics} metrics
 * @param {number} tick
 * @returns {void}
 */
function sampleMetrics(metricsReport, roomName, metrics, tick) {
    metricsReport.append('rooms', roomName, tick, metrics);
}

module.exports = { collectMetrics, sampleMetrics };
