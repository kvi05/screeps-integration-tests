'use strict';

/**
 * Compares current metrics against a baseline (without storing baseline in the report).
 *
 * This module does not make assertions and knows nothing about the filesystem. It
 * receives two MetricsReport instances (current + baseline) and returns a structured
 * comparison result.
 *
 * @module metricRegression
 */

/**
 * @typedef {import('../types').MetricSeries} MetricSeries
 * @typedef {import('../types').MetricEntityType} MetricEntityType
 */

// ─── Framework defaults ──────────────────────────────────────────────────────────

/** @type {number} */
const DEFAULT_TOLERANCE = 0;
/** @type {number} */
const DEFAULT_RELATIVE_TOLERANCE = 0;
/** @type {RegressionDirection} */
const DEFAULT_REGRESSION_DIRECTION = 'both';
/** @type {'average'|'latest'|'sum'|'delta'} */
const DEFAULT_AGGREGATOR = 'average';

/**
 * @typedef {'increase'|'decrease'|'both'} RegressionDirection
 */

/**
 * @typedef {Object} CompareResult
 * @property {boolean} passed
 * @property {number|undefined} actual
 * @property {number|undefined} expected
 * @property {number|undefined} delta
 * @property {number|undefined} relativeDelta
 */

/**
 * @typedef {Object} CompareOpts
 * @property {number} [tolerance=0] — absolute tolerance
 * @property {number} [relativeTolerance=0] — relative tolerance (fraction)
 * @property {RegressionDirection} [direction='both'] — regression direction
 * @property {'average'|'latest'|'sum'|'delta'} [aggregator='average'] — series aggregation method
 * @property {{startTick?:number, endTick?:number}} [window] — tick window for comparison
 */

class MetricsRegression {
    /**
     * @param {import('../types').MetricsReport} baselineMetricsReport — baseline report
     */
    constructor(baselineMetricsReport) {
        /** @private */
        this._baseline = baselineMetricsReport;
    }

    /**
     * Compares a metric between the current report and baseline.
     *
     * @param {import('../types').MetricsReport} currentReport — current report
     * @param {MetricEntityType} entityType
     * @param {string} entityId
     * @param {string} metricName
     * @param {CompareOpts} [opts]
     * @returns {CompareResult}
     */
    compare(currentReport, entityType, entityId, metricName, opts = {}) {
        const aggregator = opts.aggregator || DEFAULT_AGGREGATOR;
        const direction = opts.direction || DEFAULT_REGRESSION_DIRECTION;
        const tolerance = opts.tolerance || DEFAULT_TOLERANCE;
        const relativeTolerance = opts.relativeTolerance || DEFAULT_RELATIVE_TOLERANCE;

        const currentSeries = this._selectWindow(currentReport.series(entityType, entityId), opts.window);
        const baselineSeries = this._selectWindow(this._baseline.series(entityType, entityId), opts.window);

        const actual = this._aggregate(currentSeries, metricName, aggregator, currentReport);
        const expected = this._aggregate(baselineSeries, metricName, aggregator, this._baseline);

        if (actual === undefined || expected === undefined) {
            return { passed: false, actual, expected, delta: undefined, relativeDelta: undefined };
        }

        const delta = actual - expected;
        const relativeDelta = expected !== 0 ? delta / Math.abs(expected) : delta === 0 ? 0 : Infinity;

        let passed;
        if (direction === 'increase') {
            passed = delta >= -tolerance || relativeDelta >= -relativeTolerance;
        } else if (direction === 'decrease') {
            passed = delta <= tolerance || relativeDelta <= relativeTolerance;
        } else {
            passed = Math.abs(delta) <= tolerance || Math.abs(relativeDelta) <= relativeTolerance;
        }

        return { passed, actual, expected, delta, relativeDelta };
    }

    /**
     * Selects a subset of samples by tick window.
     *
     * @private
     * @param {MetricSeries} series
     * @param {{startTick?:number, endTick?:number}} [window]
     * @returns {MetricSeries}
     */
    _selectWindow(series, window) {
        if (!window) {
            return series;
        }
        return series.filter((sample) => {
            if (window.startTick !== undefined && sample.tick < window.startTick) return false;
            if (window.endTick !== undefined && sample.tick > window.endTick) return false;
            return true;
        });
    }

    /**
     * Aggregates a series by metric name.
     *
     * @private
     * @param {MetricSeries} series
     * @param {string} metricName
     * @param {CompareOpts['aggregator']} aggregator
     * @param {import('../types').MetricsReport} metricsReport — for calling average/sum/delta
     * @returns {number|undefined}
     */
    _aggregate(series, metricName, aggregator, metricsReport) {
        switch (aggregator) {
            case 'average':
                return metricsReport.average(series, metricName);
            case 'sum':
                return metricsReport.sum(series, metricName);
            case 'delta':
                return metricsReport.delta(series, metricName);
            case 'latest': {
                if (series.length === 0) {
                    return undefined;
                }
                const last = series[series.length - 1];
                const val = last[metricName];
                return typeof val === 'number' && Number.isFinite(val) ? val : undefined;
            }
            default:
                throw new TypeError(`unknown aggregator: ${String(aggregator)}`);
        }
    }
}

module.exports = { MetricsRegression };
