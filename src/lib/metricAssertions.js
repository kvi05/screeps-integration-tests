'use strict';

const assert = require('node:assert');
const { getMetricSeries, getLatestMetric } = require('./metrics');

/**
 * Assertion helpers для time-series метрик integration tests.
 *
 * Этот модуль зависит от структуры `report.metrics` и использует `node:assert`.
 * Общие object/event assertions остаются в `lib/assertions.js`.
 *
 * @module metricAssertions
 */

/**
 * @typedef {import('./types').MetricEntityType} MetricEntityType
 * @typedef {import('./types').WorldReport} WorldReport
 */

/**
 * Проверяет, что ожидаемое значение — конечное число.
 *
 * @param {*} expected
 * @param {string} label
 * @returns {void}
 */
function assertNumericExpected(expected, label) {
    assert.strictEqual(typeof expected, 'number', `${label} должен быть числом (получено ${String(expected)})`);
    assert.ok(Number.isFinite(expected), `${label} должен быть конечным числом (получено ${expected})`);
}

/**
 * Проверяет, что для сущности есть хотя бы один сэмпл.
 *
 * @param {WorldReport} report
 * @param {MetricEntityType} entityType
 * @param {string} entityId
 * @returns {void}
 */
function assertHasMetricSamples(report, entityType, entityId) {
    const series = getMetricSeries(report, entityType, entityId);
    assert.ok(series.length > 0, `нет сэмплов для ${entityType}/${entityId}`);
}

/**
 * Проверяет, что последнее значение метрики ≥ `expected`.
 *
 * @param {WorldReport} report
 * @param {MetricEntityType} entityType
 * @param {string} entityId
 * @param {string} metricName
 * @param {number} expected
 * @returns {void}
 */
function assertLatestMetricAtLeast(report, entityType, entityId, metricName, expected) {
    assertNumericExpected(expected, 'expected');

    const latest = getLatestMetric(report, entityType, entityId);
    assert.ok(latest, `нет сэмплов для ${entityType}/${entityId}, не удалось проверить ${metricName}`);

    const actual = latest[metricName];
    assert.strictEqual(
        typeof actual,
        'number',
        `${entityType}/${entityId}: ${metricName} в последнем сэмпле (tick ${latest.tick}) не число (${String(actual)})`,
    );
    assert.ok(
        actual >= expected,
        `${entityType}/${entityId}: ${metricName}=${actual} на tick ${latest.tick} < ожидаемого ${expected}`,
    );
}

/**
 * Проверяет, что последнее значение метрики < `expected`.
 *
 * @param {WorldReport} report
 * @param {MetricEntityType} entityType
 * @param {string} entityId
 * @param {string} metricName
 * @param {number} expected
 * @returns {void}
 */
function assertLatestMetricBelow(report, entityType, entityId, metricName, expected) {
    assertNumericExpected(expected, 'expected');

    const latest = getLatestMetric(report, entityType, entityId);
    assert.ok(latest, `нет сэмплов для ${entityType}/${entityId}, не удалось проверить ${metricName}`);

    const actual = latest[metricName];
    assert.strictEqual(
        typeof actual,
        'number',
        `${entityType}/${entityId}: ${metricName} в последнем сэмпле (tick ${latest.tick}) не число (${String(actual)})`,
    );
    assert.ok(
        actual < expected,
        `${entityType}/${entityId}: ${metricName}=${actual} на tick ${latest.tick} >= ожидаемого ${expected}`,
    );
}

/**
 * Проверяет, что метрика хотя бы раз достигла значения `expected`.
 *
 * @param {WorldReport} report
 * @param {MetricEntityType} entityType
 * @param {string} entityId
 * @param {string} metricName
 * @param {number} expected
 * @returns {void}
 */
function assertMetricReached(report, entityType, entityId, metricName, expected) {
    assertNumericExpected(expected, 'expected');

    const series = getMetricSeries(report, entityType, entityId);
    assert.ok(series.length > 0, `нет сэмплов для ${entityType}/${entityId}`);

    const reached = series.some((sample) => {
        const value = sample[metricName];
        return typeof value === 'number' && Number.isFinite(value) && value >= expected;
    });

    assert.ok(reached, `${entityType}/${entityId}: ${metricName} ни разу не достигла ${expected}`);
}

/**
 * Проверяет, что метрика монотонно не убывает по series.
 * Пропускает сэмплы с отсутствующим или нечисловым значением.
 *
 * Использовать только для метрик, которые действительно должны быть монотонными
 * (например, суммарный прогресс или накопленный счётчик).
 *
 * @param {WorldReport} report
 * @param {MetricEntityType} entityType
 * @param {string} entityId
 * @param {string} metricName
 * @returns {void}
 */
function assertMetricMonotonic(report, entityType, entityId, metricName) {
    const series = getMetricSeries(report, entityType, entityId);
    assert.ok(series.length > 0, `нет сэмплов для ${entityType}/${entityId}`);

    /** @type {number|undefined} */
    let last;
    for (const sample of series) {
        const value = sample[metricName];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            continue;
        }
        if (last !== undefined && value < last) {
            assert.fail(`${entityType}/${entityId}: ${metricName} убыла с ${last} до ${value} на tick ${sample.tick}`);
        }
        last = value;
    }
}

module.exports = {
    assertHasMetricSamples,
    assertLatestMetricAtLeast,
    assertLatestMetricBelow,
    assertMetricReached,
    assertMetricMonotonic,
};
