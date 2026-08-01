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
    STRUCTURE_CONSTRUCTION_SITE,
    TYPE_CREEPS,
    TYPE_POWER_CREEPS,
} = require('../../constants/screepsConstants');

/**
 * @typedef {import('../storageAdapter').StorageAdapter} StorageAdapter
 * @typedef {import('../types').RoomMetrics} RoomMetrics
 * @typedef {import('../types').BotMetrics} BotMetrics
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
    const constructionSites = objects.filter((o) => o.type === STRUCTURE_CONSTRUCTION_SITE);

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
        constructionSiteCount: constructionSites.length,
        constructionSiteTotalLeftProgress: constructionSites.reduce(
            (sum, s) => sum + ((s.progressTotal || 0) - (s.progress || 0)),
            0,
        ),
        totalEnergy: sumEnergyInRoom(objects),
        totalHits: objects.reduce((sum, o) => sum + (o.hits || 0), 0),
    };
}

/**
 * Sums the energy stored in all non-creep room objects with a store.
 *
 * Creeps (and power creeps) are excluded — their energy is mobile and
 * would make the room metric noisy. Tombstones, ruins and other objects
 * with a store are included.
 *
 * @param {Array<{type?: string, store?: Object}>} objects
 * @returns {number}
 */
function sumEnergyInRoom(objects) {
    return objects.reduce((sum, o) => {
        if (o.type === TYPE_CREEPS || o.type === TYPE_POWER_CREEPS) {
            return sum;
        }
        return sum + (o.store?.energy || 0);
    }, 0);
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

/**
 * Collects bot state metrics (CPU usage, bucket, limit) from the `users` collection.
 *
 * The engine updates `users.lastUsedCpu` (CPU used in the last tick),
 * `users.cpuAvailable` (CPU bucket) and `users.cpu` (CPU limit) after every tick,
 * so the observer stays stateless — it only reads the DB.
 *
 * @param {StorageAdapter} adapter
 * @param {string} userId — bot user `_id`
 * @returns {Promise<BotMetrics|null>} — `null` if the user row is not found
 */
async function collectBotMetrics(adapter, userId) {
    const { db } = adapter;
    const user = await db.users.findOne({ _id: userId });
    if (!user) {
        return null;
    }
    return {
        cpuUsage: user.lastUsedCpu || 0,
        bucket: user.cpuAvailable || 0,
        cpuLimit: user.cpu || 0,
    };
}

/**
 * Adds a bot metrics sample to MetricsReport.
 *
 * @param {import('../types').MetricsReport} metricsReport
 * @param {string} username
 * @param {BotMetrics} metrics
 * @param {number} tick
 * @returns {void}
 */
function sampleBotMetrics(metricsReport, username, metrics, tick) {
    metricsReport.append('bots', username, tick, metrics);
}

module.exports = { collectMetrics, sampleMetrics, collectBotMetrics, sampleBotMetrics };
