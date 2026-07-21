'use strict';

const assert = require('node:assert');

/**
 * Assertion helpers for time-series metrics in integration tests.
 *
 * Takes a MetricsReport instance in the constructor. All methods throw
 * assertion errors when conditions are not met.
 *
 * @module metricAssertions
 */

/**
 * @typedef {import('./types').MetricEntityType} MetricEntityType
 * @typedef {import('./types').MetricsReport} MetricsReport
 */

class MetricsAssert {
    /**
     * @param {MetricsReport} metricsReport
     */
    constructor(metricsReport) {
        /** @private */
        this._m = metricsReport;
    }

    /**
     * Asserts that the entity has at least one sample.
     *
     * @param {MetricEntityType} entityType
     * @param {string} entityId
     * @returns {void}
     */
    hasSamples(entityType, entityId) {
        const s = this._m.series(entityType, entityId);
        assert.ok(s.length > 0, `нет сэмплов для ${entityType}/${entityId}`);
    }

    /**
     * Asserts that the latest metric value ≥ `expected`.
     *
     * @param {MetricEntityType} entityType
     * @param {string} entityId
     * @param {string} metricName
     * @param {number} expected
     * @returns {void}
     */
    latestAtLeast(entityType, entityId, metricName, expected) {
        this._assertNumeric(expected, 'expected');

        const latest = this._m.latest(entityType, entityId);
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
     * Asserts that the latest metric value < `expected`.
     *
     * @param {MetricEntityType} entityType
     * @param {string} entityId
     * @param {string} metricName
     * @param {number} expected
     * @returns {void}
     */
    latestBelow(entityType, entityId, metricName, expected) {
        this._assertNumeric(expected, 'expected');

        const latest = this._m.latest(entityType, entityId);
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
     * Asserts that the metric reached `expected` at least once.
     *
     * @param {MetricEntityType} entityType
     * @param {string} entityId
     * @param {string} metricName
     * @param {number} expected
     * @returns {void}
     */
    reached(entityType, entityId, metricName, expected) {
        this._assertNumeric(expected, 'expected');

        const s = this._m.series(entityType, entityId);
        assert.ok(s.length > 0, `нет сэмплов для ${entityType}/${entityId}`);

        const reached = s.some((sample) => {
            const value = sample[metricName];
            return typeof value === 'number' && Number.isFinite(value) && value >= expected;
        });

        assert.ok(reached, `${entityType}/${entityId}: ${metricName} ни разу не достигла ${expected}`);
    }

    /**
     * Asserts that the metric is monotonically non-decreasing across the series.
     * Skips samples with missing or non-numeric values.
     *
     * Only use for metrics that are genuinely expected to be
     * monotonic (e.g., cumulative progress or an accumulated counter).
     *
     * @param {MetricEntityType} entityType
     * @param {string} entityId
     * @param {string} metricName
     * @returns {void}
     */
    monotonic(entityType, entityId, metricName) {
        const s = this._m.series(entityType, entityId);
        assert.ok(s.length > 0, `нет сэмплов для ${entityType}/${entityId}`);

        /** @type {number|undefined} */
        let last;
        for (const sample of s) {
            const value = sample[metricName];
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                continue;
            }
            if (last !== undefined && value < last) {
                assert.fail(
                    `${entityType}/${entityId}: ${metricName} убыла с ${last} до ${value} на tick ${sample.tick}`,
                );
            }
            last = value;
        }
    }

    /** @private */
    _assertNumeric(v, label) {
        assert.strictEqual(typeof v, 'number', `${label} должен быть числом (получено ${String(v)})`);
        assert.ok(Number.isFinite(v), `${label} должен быть конечным числом (получено ${v})`);
    }
}

module.exports = { MetricsAssert };
