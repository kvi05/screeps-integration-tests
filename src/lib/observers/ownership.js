'use strict';

/**
 * Event log хранит только `objectId` (атакующий/уничтоженный) и `data.targetId`,
 * но НЕ хранит `user` (владельца). Чтобы assertions могли проверять "чей именно
 * объект получил урон/атаковал", нужно связать `_id` объекта с его `user` —
 * это делает снимок `rooms.objects` на каждый тик.
 *
 * Снимок берётся ДО `server.tick()` (см. world.js), чтобы не потерять owner
 * для объектов, уничтоженных в течение этого же тика.
 */

/**
 * @typedef {import('screeps-server-mockup').ScreepsServer} ScreepsServer
 * @typedef {import('../types').WorldReport} WorldReport
 *
 * @typedef {Object<string,string>} OwnersMap
 */

/**
 * Снимает соответствие `_id → user` для всех объектов комнаты, у которых
 * есть владелец (creep, spawn, tower, extension, ...).
 * Объекты без `user` (source, wall, road) пропускаются.
 *
 * @param {ScreepsServer} server
 * @param {string} roomName
 * @returns {Promise<OwnersMap>} — map `{_id: user}`
 */
async function snapshotOwners(server, roomName) {
    const { db } = server.common.storage;
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
 * Мержит снимок владельцев в `report.objectOwners`.
 * Накопительно: раз узнанный owner объекта не может измениться (объект не меняет
 * владельца), поэтому просто дополняем карту без затирания предыдущих записей.
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
