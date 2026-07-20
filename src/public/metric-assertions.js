'use strict';

/**
 * @file Assertions on time-series metric values.
 *
 * Responsibility:
 *   Re-exports the `MetricsAssert` class for assertions on metrics
 *   collected during a scenario run.
 *
 * **Available exports:**
 * - `MetricsAssert` — assertion class (accepts MetricsReport in constructor)
 *
 * @example
 * const { MetricsAssert } = require('screeps-integration-tests/metric-assertions');
 * const ma = new MetricsAssert(report.metrics);
 * ma.latestAtLeast('rooms', 'W0N1', 'rcl', 3);
 *
 * @module screeps-integration-tests/metric-assertions
 */

const { MetricsAssert } = require('../lib/metricAssertions');

module.exports = { MetricsAssert };
