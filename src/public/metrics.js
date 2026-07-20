'use strict';

/**
 * @file Metric time-series storage, query helpers, aggregation, CSV export,
 *   and regression comparison.
 *
 * Responsibility:
 *   Re-exports the `MetricsReport` class (storage, query, aggregation, CSV)
 *   and the `MetricsRegression` class (baseline comparison) from the
 *   internal lib layer.
 *
 * **Available exports:**
 * - `MetricsReport` — storage + query + aggregation + CSV export
 * - `MetricsRegression` — baseline comparison
 *
 * @example
 * const { MetricsReport, MetricsRegression } = require('screeps-integration-tests/metrics');
 * const m = report.metrics; // MetricsReport instance
 * const series = m.room('W0N1');
 * const csv = m.toCsv();
 *
 * @module screeps-integration-tests/metrics
 */

const { MetricsReport } = require('../lib/metricsReport');
const { MetricsRegression } = require('../lib/metricRegression');

module.exports = { MetricsReport, MetricsRegression };
