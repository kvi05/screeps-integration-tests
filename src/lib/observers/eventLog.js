'use strict';

/**
 * Event constants from `@screeps/common/lib/constants.js`.
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
 * Reads event log from storage for the specified room.
 * Event log is stored as an hset in `env.keys.ROOM_EVENT_LOG`.
 * Returns `[]` if no events yet or JSON is corrupted.
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
 * Filters event log by event type.
 *
 * @param {EventLogEntry[]} eventLog
 * @param {number} eventType                — constant (EVENT_OBJECT_DESTROYED, EVENT_ATTACK, ...)
 * @returns {EventLogEntry[]}
 */
function filterByType(eventLog, eventType) {
    return eventLog.filter((e) => e.event === eventType);
}

/**
 * Filters `EVENT_OBJECT_DESTROYED` by object type(s) and/or `_id`.
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
 * Accumulates events in `report.events[]`.
 * The event log in engine is overwritten each tick — this method
 * is the only way to collect all events for a run.
 *
 * @param {WorldReport} report
 * @param {EventLogEntry[]} eventLog         — events for current tick
 * @param {number} tick                     — tick number
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
