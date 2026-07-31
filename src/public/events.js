'use strict';

/**
 * @file Screeps game event log constants and helpers.
 *
 * Responsibility:
 *   Provide the numeric constants used by the Screeps engine to identify
 *   game events (attack, destroy, build, harvest, etc.) and helper functions
 *   to read, filter, and accumulate the raw event log from storage.
 *
 *   The event log is ephemeral — it is overwritten every tick.  The framework
 *   automatically calls `accumulateEvents()` inside `createWorld()` at the end
 *   of each tick, so by the time your scenario gains access to `report.events`
 *   all events have already been collected.
 *
 * **Available constants:**
 *
 * | Constant | Value | Event |
 * |---|---|---|
 * | `EVENT_ATTACK` | 1 | Creep/tower attacks |
 * | `EVENT_OBJECT_DESTROYED` | 2 | Object destroyed |
 * | `EVENT_ATTACK_CONTROLLER` | 3 | Controller attack |
 * | `EVENT_BUILD` | 4 | Construction |
 * | `EVENT_HARVEST` | 5 | Harvesting |
 * | `EVENT_HEAL` | 6 | Healing |
 * | `EVENT_REPAIR` | 7 | Repairing |
 * | `EVENT_RESERVE_CONTROLLER` | 8 | Controller reservation |
 * | `EVENT_UPGRADE_CONTROLLER` | 9 | Controller upgrade |
 * | `EVENT_EXIT` | 10 | Creep leaves a room |
 * | `EVENT_POWER` | 11 | Power processing |
 * | `EVENT_TRANSFER` | 12 | Resource transfer |
 *
 * **Available functions:**
 *
 * | Function | Purpose |
 * |---|---|
 * | `readEventLog(server, roomName)` | Read raw event log for a room from storage |
 * | `filterByType(eventLog, eventType)` | Filter events by type |
 * | `filterDestroyed(eventLog, filter?)` | Filter destroyed events by type / ID |
 * | `accumulateEvents(report, eventLog, tick)` | Append events (with tick number) to `report` |
 *
 * @example
 * const { EVENT_OBJECT_DESTROYED } = require('screeps-integration-tests/events');
 * const events = await world.getEventLog('W0N1');
 * const destroyed = events.some(e => e.event === EVENT_OBJECT_DESTROYED);
 *
 * @module screeps-integration-tests/events
 */

const {
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
} = require('../lib/observers/eventLog');

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
