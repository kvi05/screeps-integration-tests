'use strict';

/**
 * @file Metric-to-CSV export utilities.
 *
 * Responsibility:
 *   Convert the time-series data in `report.metrics` into flat CSV rows
 *   that can be written to a file, imported into a spreadsheet, or used
 *   as regression baselines.
 *
 * **Available functions:**
 *
 * | Function | Purpose |
 * |---|---|
 * | `flattenMetricSeries(report, opts)` | Array of `{ entityType, entityId, tick, metric, value }` |
 * | `toCsvRows(report, opts)` | Rows with header (array of arrays) |
 * | `toCsv(report, opts)` | Ready-to-write CSV string |
 *
 * @example
 * const { toCsv } = require('screeps-integration-tests/metric-export');
 * const csv = toCsv(report, { entityTypes: ['rooms'], metrics: ['rcl', 'energyAvailable'] });
 * fs.writeFileSync('metrics.csv', csv);
 *
 * @module screeps-integration-tests/metric-export
 */

const { flattenMetricSeries, toCsvRows, toCsv } = require('../lib/metricExport');

module.exports = {
    flattenMetricSeries,
    toCsvRows,
    toCsv,
};
