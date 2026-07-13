'use strict';

/**
 * Helpers для сравнения текущих метрик с baseline (без хранения baseline в отчёте).
 *
 * Этот модуль не делает assert'ов и не знает о файловой системе. Он получает
 * две time-series и возвращает структурированный результат сравнения.
 * Baseline должен быть загружен отдельно (JSON/CSV fixture).
 *
 * @module metricRegression
 */

/**
 * @typedef {import('./types').MetricSeries} MetricSeries
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
 */

const { averageMetric, sumMetric, deltaMetric, getLatestMetric } = require('./metrics');

/**
 * Выбирает подмножество samples из series по окну тиков (включительно).
 *
 * @param {MetricSeries} series
 * @param {Object} [window]
 * @param {number} [window.startTick]
 * @param {number} [window.endTick]
 * @returns {MetricSeries}
 */
function selectWindow(series, window = {}) {
    return series.filter((sample) => {
        if (window.startTick !== undefined && sample.tick < window.startTick) {
            return false;
        }
        if (window.endTick !== undefined && sample.tick > window.endTick) {
            return false;
        }
        return true;
    });
}

/**
 * Агрегирует series по имени метрики заданным способом.
 *
 * @param {MetricSeries} series
 * @param {string} metricName
 * @param {CompareOpts['aggregator']} aggregator
 * @returns {number|undefined}
 */
function aggregate(series, metricName, aggregator) {
    switch (aggregator) {
        case 'average':
            return averageMetric(series, metricName);
        case 'sum':
            return sumMetric(series, metricName);
        case 'delta':
            return deltaMetric(series, metricName);
        case 'latest': {
            const latest = getLatestMetric(
                { metrics: { rooms: {}, colonies: {}, bots: {}, world: series } },
                'world',
                'world',
            );
            const value = latest ? latest[metricName] : undefined;
            return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
        }
        default:
            throw new TypeError(`неизвестный aggregator: ${String(aggregator)}`);
    }
}

/**
 * Сравнивает метрику current series с baseline series.
 *
 * @param {MetricSeries} currentSeries
 * @param {MetricSeries} baselineSeries
 * @param {string} metricName
 * @param {CompareOpts} [opts]
 * @returns {CompareResult}
 */
function compareMetric(currentSeries, baselineSeries, metricName, opts = {}) {
    const aggregator = opts.aggregator || 'average';
    const direction = opts.direction || 'both';
    const tolerance = opts.tolerance || 0;
    const relativeTolerance = opts.relativeTolerance || 0;

    const actual = aggregate(currentSeries, metricName, aggregator);
    const expected = aggregate(baselineSeries, metricName, aggregator);

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

module.exports = {
    selectWindow,
    compareMetric,
};
