'use strict';

/**
 * @file Assertions on numeric metric values recorded during a scenario run.
 *
 * Responsibility:
 *   These assertions inspect `report.metrics` and require that the scenario
 *   passed `metrics: { every: N, rooms: true }` to `createWorld()`.  Each
 *   function throws on failure (like `node:assert`).
 *
 * **Available functions:**
 *
 * | Function | Purpose |
 * |---|---|
 * | `assertHasMetricSamples(report, type, id)` | At least one sample exists |
 * | `assertLatestMetricAtLeast(report, type, id, metric, expected)` | Last value ≥ expected |
 * | `assertLatestMetricBelow(report, type, id, metric, expected)` | Last value < expected |
 * | `assertMetricReached(report, type, id, metric, expected)` | Value was reached at least once |
 * | `assertMetricMonotonic(report, type, id, metric)` | Series never decreases |
 *
 * @example
 * const { assertLatestMetricAtLeast } = require('screeps-integration-tests/metric-assertions');
 * assertLatestMetricAtLeast(report, 'rooms', 'W0N1', 'rcl', 3);
 *
 * @module screeps-integration-tests/metric-assertions
 */

const {
    assertHasMetricSamples,
    assertLatestMetricAtLeast,
    assertLatestMetricBelow,
    assertMetricReached,
    assertMetricMonotonic,
} = require('../lib/metricAssertions');

module.exports = {
    assertHasMetricSamples,
    assertLatestMetricAtLeast,
    assertLatestMetricBelow,
    assertMetricReached,
    assertMetricMonotonic,
};
