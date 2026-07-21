'use strict';

/**
 * Event log stores only `objectId` (attacker/destroyed) and `data.targetId`,
 * but does NOT store `user` (owner). So that assertions can check "which exact
 * object took damage/attacked", we need to link the object's `_id` to its `user` —
 * this is done by snapshotting `rooms.objects` each tick.
 *
 * Snapshot is taken BEFORE `server.tick()` (see world.js), so as not to lose
 * the owner for objects destroyed during this same tick.
 */

/**
 * @typedef {import('../storageAdapter').StorageAdapter} StorageAdapter
 * @typedef {import('../types').WorldReport} WorldReport
 *
 * @typedef {Object<string,string>} OwnersMap
 */

/**
 * Captures the `_id → user` mapping for all room objects that have
 * an owner (creep, spawn, tower, extension, ...).
 * Objects without `user` (source, wall, road) are skipped.
 *
 * @param {StorageAdapter} adapter
 * @param {string} roomName
 * @returns {Promise<OwnersMap>} — map `{_id: user}`
 */
async function snapshotOwners(adapter, roomName) {
    const { db } = adapter;
    const objects = await db['rooms.objects'].find({ room: roomName });
    /** @type {OwnersMap} */
    const owners = {};
    for (const obj of objects) {
        if (obj.user) {
            owners[obj._id] = obj.user;
        }
    }
    return owners;
}

/**
 * Merges owners snapshot into `report.objectOwners`.
 * Accumulative: once an object's owner is known it cannot change (objects don't
 * change owner), so we simply extend the map without overwriting previous entries.
 *
 * @param {WorldReport} report
 * @param {OwnersMap} owners
 * @returns {void}
 */
function mergeOwners(report, owners) {
    if (!report.objectOwners) {
        report.objectOwners = {};
    }
    Object.assign(report.objectOwners, owners);
}

module.exports = { snapshotOwners, mergeOwners };
