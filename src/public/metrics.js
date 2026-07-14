'use strict';

/**
 * @file Metric query helpers, aggregation, and regression.
 *
 * Responsibility:
 *   Functions that inspect the metrics collected during a scenario run
 *   (`report.metrics`).  Metrics are recorded when `metrics: { every: N, rooms: true }`
 *   is passed to `createWorld()`.
 *
 *   Also includes the regression API (`compareMetric`, `selectWindow`)
 *   for comparing current runs against baseline data.
 *
 * **Available functions:**
 *
 * | Function | Purpose |
 * |---|---|
 * | `getRoomMetrics(report, roomName)` | Full time-series for a room |
 * | `getLatestRoomMetrics(report, roomName)` | Most recent sample for a room |
 * | `getMetricAtTick(report, type, id, tick)` | Exact sample at a given tick |
 * | `getWorldSnapshotAtTick(report, tick)` | `{ [roomName]: sample }` for that tick |
 * | `averageMetric(series, metric)` | Mean of a numeric metric |
 * | `sumMetric(series, metric)` | Sum of a numeric metric |
 * | `deltaMetric(series, metric)` | Last minus first value |
 * | `rateMetric(series, metric)` | Change per tick over the window |
 * | `compareMetric(current, baseline, metric, opts)` | Regression check |
 * | `selectWindow(series, opts)` | Select a tick window from a time-series |
 *
 * @example
 * const { getRoomMetrics, getLatestRoomMetrics } = require('screeps-integration-tests/metrics');
 * const r1 = getRoomMetrics(report, 'W0N1');
 * const latest = getLatestRoomMetrics(report, 'W0N1');
 * console.log(latest.rcl);
 *
 * @module screeps-integration-tests/metrics
 */

const {
    getMetricSeries,
    getRoomMetrics,
    getLatestMetric,
    getLatestRoomMetrics,
    getMetricAtTick,
    getWorldSnapshotAtTick,
    averageMetric,
    sumMetric,
    deltaMetric,
    rateMetric,
} = require('../lib/metrics');

const {
    compareMetric,
    selectWindow,
} = require('../lib/metricRegression');

module.exports = {
    getMetricSeries,
    getRoomMetrics,
    getLatestMetric,
    getLatestRoomMetrics,
    getMetricAtTick,
    getWorldSnapshotAtTick,
    averageMetric,
    sumMetric,
    deltaMetric,
    rateMetric,
    compareMetric,
    selectWindow,
};
