'use strict';

/**
 * @file Low-level world manipulation helpers for direct DB access and bot operations.
 *
 * Responsibility:
 *   Provides a `createWorldHelpers(db, defaultBotUserId, roomToBotUserId, bots)` factory
 *   that returns utility functions for querying and mutating the server database,
 *   as well as bot memory/execution operations during a scenario.
 *
 * **Available functions:**
 *
 * | Function | Purpose |
 * |---|---|
 * | `createWorldHelpers(...)` | Factory returning a helper object |
 *
 * The returned helper object exposes the following methods:
 * - `setTicksToDowngrade(roomName, ticks)` — set controller downgrade timer
 * - `setHitsStructure(id, hits)` — set structure hits (clamped to hitsMax)
 * - `damageHitsStructure(id, amount)` — subtract hits (clamped to 0)
 * - `deleteStructure(id)` — remove a structure from the DB
 * - `createStructure(spec)` — create a structure from a spec
 * - `spawnCreep(spec)` — create a creep via materialize (spec object)
 * - `getRcl(roomName)` — read RCL of a room from DB
 * - `getEventLog(room)` — read event log for a room
 * - `readMemory(botUsername?)` — read bot memory
 * - `writeMemory(botUsername?, patch)` — deep-merge patch into bot memory
 * - `exec(code, botUsername?)` — execute JS code in a bot's context
 * - `evalInBot(code, botUsername?)` — evaluate JS code in a bot's context and resolve with the result
 * - `botId(bot?)` — get bot _id by username, index, or first bot
 * - `find(query)` — query `rooms.objects` collection (returns mapped objects)
 * - `findOne(query, opts)` — find first matching object
 * - `findIds(query)` — return array of _id values
 * - `findId(query, opts)` — return first _id
 *
 * @example
 * const { createWorldHelpers } = require('screeps-integration-tests/world-helpers');
 * const { createWorld, spec } = require('screeps-integration-tests');
 * const world = await createWorld({ ... });
 * // helpers are already exposed on world via ...helpers spread
 * const [spawn] = world.find({ type: 'spawn' });
 * const rcl = await world.getRcl('W0N1');
 *
 * @module screeps-integration-tests/world-helpers
 */

const { createWorldHelpers } = require('../lib/orchestration/worldHelpers');

module.exports = { createWorldHelpers };
