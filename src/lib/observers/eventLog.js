'use strict';

/**
 * Константы событий из `@screeps/common/lib/constants.js`.
 * @see https://docs.screeps.com/api/#Constants
 */

/**
 * @typedef {import('../storageAdapter').StorageAdapter} StorageAdapter
 * @typedef {import('../types').EventLogEntry} EventLogEntry
 * @typedef {import('../types').WorldReport} WorldReport
 * @typedef {Object} DestroyedFilter
 * @property {string|string[]} [types]
 * @property {string} [id]
 */

/** @constant {number} */
const EVENT_ATTACK = 1;
/** @constant {number} */
const EVENT_OBJECT_DESTROYED = 2;
/** @constant {number} */
const EVENT_ATTACK_CONTROLLER = 3;
/** @constant {number} */
const EVENT_BUILD = 4;
/** @constant {number} */
const EVENT_HARVEST = 5;
/** @constant {number} */
const EVENT_HEAL = 6;
/** @constant {number} */
const EVENT_REPAIR = 7;
/** @constant {number} */
const EVENT_RESERVE_CONTROLLER = 8;
/** @constant {number} */
const EVENT_UPGRADE_CONTROLLER = 9;
/** @constant {number} */
const EVENT_EXIT = 10;
/** @constant {number} */
const EVENT_POWER = 11;
/** @constant {number} */
const EVENT_TRANSFER = 12;

/**
 * Читает event log из storage для указанной комнаты.
 * Event log хранится как hset в `env.keys.ROOM_EVENT_LOG`.
 * Возвращает `[]`, если событий ещё нет или JSON битый.
 *
 * @param {StorageAdapter} adapter
 * @param {string} roomName
 * @returns {Promise<EventLogEntry[]>}
 */
async function readEventLog(adapter, roomName) {
    const { env } = adapter;
    const raw = await env.hget(env.keys.ROOM_EVENT_LOG, roomName);
    if (!raw) {
        return [];
    }
    try {
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

/**
 * Фильтрует event log по типу события.
 *
 * @param {EventLogEntry[]} eventLog
 * @param {number} eventType                — константа (EVENT_OBJECT_DESTROYED, EVENT_ATTACK, ...)
 * @returns {EventLogEntry[]}
 */
function filterByType(eventLog, eventType) {
    return eventLog.filter((e) => e.event === eventType);
}

/**
 * Фильтрует `EVENT_OBJECT_DESTROYED` по типу(ам) объекта и/или по `_id`.
 *
 * @param {EventLogEntry[]} eventLog
 * @param {DestroyedFilter} [filter]
 * @returns {EventLogEntry[]}
 */
function filterDestroyed(eventLog, filter = {}) {
    /** @type {EventLogEntry[]} */
    let destroyed = filterByType(eventLog, EVENT_OBJECT_DESTROYED);
    if (filter.types) {
        const types = Array.isArray(filter.types) ? filter.types : [filter.types];
        destroyed = destroyed.filter((e) => e.data && types.includes(e.data.type));
    }
    if (filter.id) {
        destroyed = destroyed.filter((e) => e.objectId === filter.id);
    }
    return destroyed;
}

/**
 * Накапливает события в `report.events[]`.
 * Event log в engine перезаписывается каждый тик — этот метод
 * единственный способ собрать все события за прогон.
 *
 * @param {WorldReport} report
 * @param {EventLogEntry[]} eventLog         — события за текущий тик
 * @param {number} tick                     — номер тика
 * @returns {void}
 */
function accumulateEvents(report, eventLog, tick) {
    if (!report.events) {
        report.events = [];
    }
    for (const event of eventLog) {
        report.events.push({ tick, ...event });
    }
}

module.exports = {
    EVENT_ATTACK,
    EVENT_OBJECT_DESTROYED,
    EVENT_ATTACK_CONTROLLER,
    EVENT_BUILD,
    EVENT_HARVEST,
    EVENT_HEAL,
    EVENT_REPAIR,
    EVENT_RESERVE_CONTROLLER,
    EVENT_UPGRADE_CONTROLLER,
    EVENT_EXIT,
    EVENT_POWER,
    EVENT_TRANSFER,
    readEventLog,
    filterByType,
    filterDestroyed,
    accumulateEvents,
};
