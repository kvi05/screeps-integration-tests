'use strict';

/**
 * Сравнение текущих метрик с baseline (без хранения baseline в отчёте).
 *
 * Этот модуль не делает assert'ов и не знает о файловой системе. Он получает
 * два MetricsReport (current + baseline) и возвращает структурированный
 * результат сравнения.
 *
 * @module metricRegression
 */

/**
 * @typedef {import('./types').MetricSeries} MetricSeries
 * @typedef {import('./types').MetricEntityType} MetricEntityType
 */

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
 * @property {number} [tolerance=0] — абсолютный допуск
 * @property {number} [relativeTolerance=0] — относительный допуск (доля)
 * @property {RegressionDirection} [direction='both'] — направление регрессии
 * @property {'average'|'latest'|'sum'|'delta'} [aggregator='average'] — способ агрегации series
 * @property {{startTick?:number, endTick?:number}} [window] — окно тиков для сравнения
 */

class MetricsRegression {
    /**
     * @param {import('./types').MetricsReport} baselineMetricsReport — эталонный отчёт
     */
    constructor(baselineMetricsReport) {
        /** @private */
        this._baseline = baselineMetricsReport;
    }

    /**
     * Сравнивает метрику между текущим отчётом и baseline.
     *
     * @param {import('./types').MetricsReport} currentReport — текущий отчёт
     * @param {MetricEntityType} entityType
     * @param {string} entityId
     * @param {string} metricName
     * @param {CompareOpts} [opts]
     * @returns {CompareResult}
     */
    compare(currentReport, entityType, entityId, metricName, opts = {}) {
        const aggregator = opts.aggregator || 'average';
        const direction = opts.direction || 'both';
        const tolerance = opts.tolerance || 0;
        const relativeTolerance = opts.relativeTolerance || 0;

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
     * Выбирает подмножество сэмплов по окну тиков.
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
     * Агрегирует series по имени метрики.
     *
     * @private
     * @param {MetricSeries} series
     * @param {string} metricName
     * @param {CompareOpts['aggregator']} aggregator
     * @param {import('./types').MetricsReport} metricsReport — для вызова average/sum/delta
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
                throw new TypeError(`неизвестный aggregator: ${String(aggregator)}`);
        }
    }
}

module.exports = { MetricsRegression };
