'use strict';

/**
 * Helpers для экспорта time-series метрик в плоский CSV.
 *
 * Модуль не знает о ScreepsServer и не пишет файлы. Он получает готовый
 * JSON-отчёт и преобразует его в детерминированный CSV.
 *
 * @module metricExport
 */

/**
 * @typedef {import('./types').MetricEntityType} MetricEntityType
 * @typedef {import('./types').MetricsReport} MetricsReport
 * @typedef {import('./types').WorldReport} WorldReport
 */

/**
 * @typedef {Object} FlatMetricRow
 * @property {MetricEntityType} entityType
 * @property {string} entityId
 * @property {number} tick
 * @property {string} metric
 * @property {string|number|boolean} value
 */

/**
 * @typedef {Object} ExportOpts
 * @property {MetricEntityType[]} [entityTypes] — ограничить набор entity types
 * @property {string[]} [metrics] — ограничить набор имён метрик
 */

/** @type {MetricEntityType[]} */
const ENTITY_TYPES = ['rooms', 'colonies', 'bots', 'world'];

/** @type {string[]} */
const CSV_HEADER = ['entityType', 'entityId', 'tick', 'metric', 'value'];

/**
 * Проверяет, что значение является скаляром, пригодным для CSV.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isScalar(value) {
    const type = typeof value;
    return type === 'number' || type === 'string' || type === 'boolean';
}

/**
 * Превращает один sample в плоские строки.
 *
 * @param {MetricEntityType} entityType
 * @param {string} entityId
 * @param {Object<string,*>} sample
 * @param {string[]|undefined} metricFilter
 * @returns {FlatMetricRow[]}
 */
function flattenSample(entityType, entityId, sample, metricFilter) {
    const tick = sample.tick;
    /** @type {FlatMetricRow[]} */
    const rows = [];

    for (const [key, rawValue] of Object.entries(sample)) {
        if (key === 'tick') {
            continue;
        }
        if (metricFilter && !metricFilter.includes(key)) {
            continue;
        }

        // Вложенный creepsByRole разворачиваем в отдельные метрики.
        if (key === 'creepsByRole' && rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
            for (const [role, count] of Object.entries(rawValue)) {
                if (typeof count === 'number') {
                    rows.push({ entityType, entityId, tick, metric: `creepsByRole.${role}`, value: count });
                }
            }
            continue;
        }

        // spawnHits и прочие объекты/массивы не экспортируем как scalar.
        if (!isScalar(rawValue)) {
            continue;
        }

        rows.push({ entityType, entityId, tick, metric: key, value: rawValue });
    }

    return rows;
}

/**
 * Возвращает плоские строки для всего отчёта.
 *
 * @param {WorldReport} report
 * @param {ExportOpts} [opts]
 * @returns {FlatMetricRow[]}
 */
function flattenMetricSeries(report, opts = {}) {
    /** @type {FlatMetricRow[]} */
    const rows = [];
    const metricsReport = report.metrics;
    if (!metricsReport) {
        return rows;
    }

    const entityTypes = opts.entityTypes || ENTITY_TYPES;
    const metricFilter = opts.metrics;

    for (const entityType of entityTypes) {
        if (entityType === 'world') {
            for (const sample of metricsReport.world || []) {
                rows.push(...flattenSample(entityType, 'world', sample, metricFilter));
            }
            continue;
        }

        const map = metricsReport[entityType] || {};
        for (const [entityId, series] of Object.entries(map)) {
            for (const sample of series) {
                rows.push(...flattenSample(entityType, entityId, sample, metricFilter));
            }
        }
    }

    rows.sort((a, b) => {
        if (a.entityType !== b.entityType) {
            return a.entityType.localeCompare(b.entityType);
        }
        if (a.entityId !== b.entityId) {
            return a.entityId.localeCompare(b.entityId);
        }
        if (a.tick !== b.tick) {
            return a.tick - b.tick;
        }
        return a.metric.localeCompare(b.metric);
    });

    return rows;
}

/**
 * Экранирует одно CSV-значение.
 *
 * @param {string|number|boolean} value
 * @returns {string}
 */
function escapeCsv(value) {
    const str = String(value);
    if (
        str.includes(',') ||
        str.includes('"') ||
        str.includes(String.fromCharCode(10)) ||
        str.includes(String.fromCharCode(13))
    ) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

/**
 * Возвращает массив CSV-строк (включая header).
 *
 * @param {WorldReport} report
 * @param {ExportOpts} [opts]
 * @returns {string[]}
 */
function toCsvRows(report, opts = {}) {
    const rows = flattenMetricSeries(report, opts);
    const lines = [CSV_HEADER.join(',')];
    for (const row of rows) {
        lines.push([row.entityType, row.entityId, row.tick, row.metric, escapeCsv(row.value)].join(','));
    }
    return lines;
}

/**
 * Возвращает CSV-строку.
 *
 * @param {WorldReport} report
 * @param {ExportOpts} [opts]
 * @returns {string}
 */
function toCsv(report, opts = {}) {
    return toCsvRows(report, opts).join(String.fromCharCode(10));
}

module.exports = {
    flattenMetricSeries,
    toCsvRows,
    toCsv,
};
