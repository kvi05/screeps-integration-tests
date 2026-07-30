'use strict';

/**
 * @file Room fixture registry and override helpers.
 *
 * Responsibility:
 *   Room fixtures are reusable declarative descriptions of a room
 *   (controller, sources, structures, creeps).  They are registered
 *   programmatically via `registerRoomFixture()` or auto-loaded from
 *   the directory configured by `roomFixturesDir`.
 *
 *   Each fixture is a plain object built with `spec.*` constructors.
 *   Overrides can apply patches (exclude / append / modify) without
 *   mutating the original fixture.
 *
 * **Available functions:**
 *
 * | Function | Purpose |
 * |---|---|
 * | `registerRoomFixture(name, fixture)` | Register a new room fixture |
 * | `unregisterRoomFixture(name)` | Remove a fixture from the registry |
 * | `loadRoomFixture(name)` | Load a fixture by name (returns `{ fixture }` or `null`) |
 * | `hasRoomFixture(name)` | Check whether a fixture exists |
 * | `getRoomFixture(name)` | Get the fixture object (or `null`) |
 * | `applyRoomOverrides(fixture, overrides)` | Apply structural overrides to a fixture |
 *
 * @example
 * // In a file inside roomFixturesDir:
 * const { spec } = require('screeps-integration-tests');
 * const { registerRoomFixture } = require('screeps-integration-tests/room-fixtures');
 * registerRoomFixture('my-room', {
 *     controller: spec.controller({ level: 3 }),
 *     sources: [spec.source(15, 15)],
 *     structures: [spec.spawn(25, 25)],
 *     creeps: [],
 * });
 *
 * @module screeps-integration-tests/room-fixtures
 */

const {
    getRoomFixture,
    hasRoomFixture,
    loadRoomFixture,
    applyRoomOverrides,
    registerRoomFixture,
    unregisterRoomFixture,
} = require('../lib/fixtures/roomFixture');

module.exports = {
    getRoomFixture,
    hasRoomFixture,
    loadRoomFixture,
    applyRoomOverrides,
    registerRoomFixture,
    unregisterRoomFixture,
};
