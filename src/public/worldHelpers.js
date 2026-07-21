'use strict';

/**
 * @file Low-level world manipulation helpers for direct DB access.
 *
 * Responsibility:
 *   Provides a `createWorldHelpers(db, defaultBotUserId)` factory that returns
 *   utility functions for querying and mutating the server database during a
 *   scenario: finding objects, modifying hits, deleting/spawning structures,
 *   setting controller downgrade timers, etc.
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
 * - `createStructure(spec, roomName)` — create a structure from a spec
 * - `find(query)` — query `rooms.objects` collection (returns mapped objects)
 * - `findOne(query, opts)` — find first matching object
 * - `findIds(query)` — return array of _id values
 * - `findId(query, opts)` — return first _id
 *
 * @example
 * const { createWorldHelpers } = require('screeps-integration-tests/world-helpers');
 * const { createWorld, spec } = require('screeps-integration-tests');
 * const world = await createWorld({ ... });
 * const helpers = createWorldHelpers(world.db, world.defaultBotUserId);
 * const [spawn] = helpers.find({ type: 'spawn' });
 *
 * @module screeps-integration-tests/world-helpers
 */

const { createWorldHelpers } = require('../lib/orchestration/worldHelpers');

module.exports = { createWorldHelpers };
