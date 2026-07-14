'use strict';

/**
 * @file Public API — main entry point of the `screeps-integration-tests` package.
 *
 * Responsibility:
 *   Exposes the three fundamental building blocks of every test scenario:
 *   `createWorld` (orchestration), `spec` (declarative world description),
 *   and `buildCanonicalRoom` (low-level room builder, rarely needed).
 *
 *   All other helpers are grouped by domain and accessed via sub-path exports:
 *
 * | Sub-path | Contents |
 * |---|---|
 * | `screeps-integration-tests/assertions` | Bot behaviour and battle assertions |
 * | `screeps-integration-tests/metrics` | Metric query helpers and regression |
 * | `screeps-integration-tests/metric-assertions` | Assertions on metric values |
 * | `screeps-integration-tests/metric-export` | CSV export utilities |
 * | `screeps-integration-tests/memory-fixtures` | Memory snapshot load / save / merge |
 * | `screeps-integration-tests/room-fixtures` | Room fixture registry and overrides |
 * | `screeps-integration-tests/events` | Event log constants (`EVENT_ATTACK`, …) and filters |
 * | `screeps-integration-tests/constants` | Screeps structure type constants (`STRUCTURE_*`) |
 *
 * Design note:
 *   The package deliberately keeps the main entry small. Users pick exactly
 *   what they need via sub-paths, which improves discoverability (IDE autocomplete
 *   shows the list of sub-paths after typing `require('screeps-integration-tests/`)`.
 *
 * @example
 * const { createWorld, spec } = require('screeps-integration-tests');
 * const { assertBotWorked } = require('screeps-integration-tests/assertions');
 * const { hasFixture } = require('screeps-integration-tests/memory-fixtures');
 *
 * @module screeps-integration-tests
 */

const { createWorld, buildCanonicalRoom } = require('./lib/world');
const { spec } = require('./lib/builders');

module.exports = {
    createWorld,
    buildCanonicalRoom,
    spec,
};
