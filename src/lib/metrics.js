'use strict';

/**
 * Доменные helpers для работы с time-series метриками integration tests.
 *
 * Ответственность этого модуля — только чтение и обработка уже собранного
 * отчёта. Он не знает о ScreepsServer, не делает assert'ов и не форматирует CSV.
 *
 * Recorder (`createMetricsReport`, `appendMetricSample`) создаёт стабильную
 * структуру отчёта. Query helpers читают series по entity. Aggregation helpers
 * считают статистику по одной series.
 *
 * @module metrics
 */

/**
 * @typedef {import('./types').MetricEntityType} MetricEntityType
 * @typedef {import('./types').MetricsSample} MetricsSample
 * @typedef {import('./types').MetricsReport} MetricsReport
 * @typedef {import('./types').MetricSeries} MetricSeries
 * @typedef {import('./types').WorldReport} WorldReport
 */

/** @type {MetricEntityType[]} */
const MAP_ENTITY_TYPES = ['rooms', 'colonies', 'bots'];

/** @type {MetricEntityType[]} */
const VALID_ENTITY_TYPES = [...MAP_ENTITY_TYPES, 'world'];

/** @typedef {import('./types').MetricsOpts} MetricsOpts */
/** @typedef {import('./types').WorldOpts} WorldOpts */

/**
 * Разрешает effective настройки сбора метрик из `WorldOpts`.
 *
 * Поддерживает backward-совместимый `metricsEvery` и новый `metrics.every`.
 * При конфликте побеждает `metrics.every`. Флаги `colonies`, `bots`, `world`
 * пока не поддерживаются и вызывают ошибку, чтобы не было скрытого поведения.
 *
 * @param {WorldOpts} opts
 * @returns {{every:number, rooms:boolean}}
 */
function resolveMetricsConfig(opts) {
    const metricsOpts = opts.metrics || {};
    const every =
        metricsOpts.every !== undefined ? metricsOpts.every : opts.metricsEvery !== undefined ? opts.metricsEvery : 0;
    const rooms = metricsOpts.rooms !== undefined ? metricsOpts.rooms : true;

    const unsupported = [];
    if (metricsOpts.colonies) {
        unsupported.push('colonies');
    }
    if (metricsOpts.bots) {
        unsupported.push('bots');
    }
    if (metricsOpts.world) {
        unsupported.push('world');
    }
    if (unsupported.length > 0) {
        throw new Error(`metrics.${unsupported.join(', ')} пока не поддерживаются в integration framework`);
    }

    return { every, rooms };
}

/**
 * Создаёт пустой отчёт метрик со стабильной структурой.
 *
 * @returns {MetricsReport}
 */
function createMetricsReport() {
    return {
        rooms: {},
        colonies: {},
        bots: {},
        world: [],
    };
}

/**
 * Проверяет, что значение является конечным неотрицательным целым числом.
 *
 * @param {*} value
 * @param {string} name — имя параметра для сообщения об ошибке
 * @returns {void}
 */
function assertNonNegativeFiniteInteger(value, name) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${name} должен быть конечным числом (получено ${String(value)})`);
    }
    if (!Number.isInteger(value)) {
        throw new TypeError(`${name} должен быть целым числом (получено ${value})`);
    }
    if (value < 0) {
        throw new RangeError(`${name} должен быть ≥ 0 (получено ${value})`);
    }
}

/**
 * Проверяет тип сущности и возвращает нормализованный entityId.
 *
 * @param {MetricsReport} metricsReport
 * @param {MetricEntityType} entityType
 * @param {string} entityId
 * @returns {{ map: boolean, normalizedId: string }}
 */
function resolveEntity(metricsReport, entityType, entityId) {
    if (!VALID_ENTITY_TYPES.includes(entityType)) {
        throw new TypeError(
            `entityType должен быть одним из ${VALID_ENTITY_TYPES.join(', ')} (получено '${String(entityType)}')`,
        );
    }

    const isMap = MAP_ENTITY_TYPES.includes(entityType);
    if (isMap && (typeof entityId !== 'string' || entityId.length === 0)) {
        throw new TypeError(`entityId для '${entityType}' должен быть непустой строкой (получено ${String(entityId)})`);
    }

    const normalizedId = entityType === 'world' ? 'world' : entityId;
    return { map: isMap, normalizedId };
}

/**
 * Добавляет сэмпл в time-series указанной сущности.
 *
 * Не мутирует входной `values`: создаёт новый plain object `{ tick, ...values }`.
 * Для `world` entityId игнорируется и заменяется на `'world'`.
 *
 * @param {MetricsReport} metricsReport
 * @param {MetricEntityType} entityType
 * @param {string} entityId
 * @param {number} tick
 * @param {Object<string,*>} values
 * @returns {MetricsSample}
 */
function appendMetricSample(metricsReport, entityType, entityId, tick, values) {
    assertNonNegativeFiniteInteger(tick, 'tick');

    const { map, normalizedId } = resolveEntity(metricsReport, entityType, entityId);

    /** @type {MetricsSample} */
    const sample = { tick, ...values };

    if (map) {
        if (!metricsReport[entityType][normalizedId]) {
            metricsReport[entityType][normalizedId] = [];
        }
        metricsReport[entityType][normalizedId].push(sample);
    } else {
        metricsReport.world.push(sample);
    }

    return sample;
}

/**
 * Специализированная обёртка для записи world-сэмпла.
 *
 * @param {MetricsReport} metricsReport
 * @param {number} tick
 * @param {Object<string,*>} values
 * @returns {MetricsSample}
 */
function appendWorldSample(metricsReport, tick, values) {
    return appendMetricSample(metricsReport, 'world', 'world', tick, values);
}

/**
 * Возвращает time-series сущности. Для отсутствующей entity возвращает `[]`.
 *
 * @param {WorldReport} report
 * @param {MetricEntityType} entityType
 * @param {string} entityId
 * @returns {MetricSeries}
 */
function getMetricSeries(report, entityType, entityId) {
    const { map, normalizedId } = resolveEntity(report.metrics, entityType, entityId);
    if (!map) {
        return report.metrics.world || [];
    }
    return report.metrics[entityType][normalizedId] || [];
}

/**
 * Короткая обёртка для получения series комнаты.
 *
 * @param {WorldReport} report
 * @param {string} roomName
 * @returns {MetricSeries}
 */
function getRoomMetrics(report, roomName) {
    return getMetricSeries(report, 'rooms', roomName);
}

/**
 * Возвращает последний сэмпл series или `undefined`.
 *
 * @param {WorldReport} report
 * @param {MetricEntityType} entityType
 * @param {string} entityId
 * @returns {MetricsSample|undefined}
 */
function getLatestMetric(report, entityType, entityId) {
    const series = getMetricSeries(report, entityType, entityId);
    return series.length > 0 ? series[series.length - 1] : undefined;
}

/**
 * Короткая обёртка для получения последнего сэмпла комнаты.
 *
 * @param {WorldReport} report
 * @param {string} roomName
 * @returns {MetricsSample|undefined}
 */
function getLatestRoomMetrics(report, roomName) {
    return getLatestMetric(report, 'rooms', roomName);
}

/**
 * Возвращает сэмпл, снятый ровно на указанном тике, или `undefined`.
 * Не интерполирует и не выбирает ближайший тик.
 *
 * @param {WorldReport} report
 * @param {MetricEntityType} entityType
 * @param {string} entityId
 * @param {number} tick
 * @returns {MetricsSample|undefined}
 */
function getMetricAtTick(report, entityType, entityId, tick) {
    assertNonNegativeFiniteInteger(tick, 'tick');
    const series = getMetricSeries(report, entityType, entityId);
    return series.find((sample) => sample.tick === tick);
}

/**
 * Собирает снимок всех комнат на указанном тике.
 *
 * Возвращает `{ [roomName]: sample }` только для комнат, у которых есть sample
 * ровно на этом тике.
 *
 * @param {WorldReport} report
 * @param {number} tick
 * @returns {Object<string,MetricsSample>}
 */
function getWorldSnapshotAtTick(report, tick) {
    assertNonNegativeFiniteInteger(tick, 'tick');

    /** @type {Object<string,MetricsSample>} */
    const snapshot = {};
    const rooms = report.metrics && report.metrics.rooms ? report.metrics.rooms : {};

    for (const [roomName, series] of Object.entries(rooms)) {
        const sample = series.find((s) => s.tick === tick);
        if (sample) {
            snapshot[roomName] = sample;
        }
    }

    return snapshot;
}

/**
 * Проверяет, что значение является числом (не `NaN`, не `Infinity`).
 *
 * @param {*} value
 * @returns {boolean}
 */
function isNumeric(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Возвращает массив `{ tick, value }` для указанного поля series.
 * Пропускает отсутствующие (`undefined`/`null`) и нечисловые значения.
 *
 * @param {MetricSeries} series
 * @param {string} metricName
 * @returns {Array<{tick:number,value:number}>}
 */
function getMetricValues(series, metricName) {
    /** @type {Array<{tick:number,value:number}>} */
    const result = [];
    for (const sample of series) {
        const value = sample[metricName];
        if (isNumeric(value)) {
            result.push({ tick: sample.tick, value });
        }
    }
    return result;
}

/**
 * Считает среднее значение метрики по series.
 * Пропускает отсутствующие и нечисловые значения.
 *
 * @param {MetricSeries} series
 * @param {string} metricName
 * @returns {number|undefined}
 */
function averageMetric(series, metricName) {
    const values = getMetricValues(series, metricName);
    if (values.length === 0) {
        return undefined;
    }
    const sum = values.reduce((acc, { value }) => acc + value, 0);
    return sum / values.length;
}

/**
 * Суммирует числовые значения метрики по series.
 *
 * @param {MetricSeries} series
 * @param {string} metricName
 * @returns {number}
 */
function sumMetric(series, metricName) {
    const values = getMetricValues(series, metricName);
    return values.reduce((acc, { value }) => acc + value, 0);
}

/**
 * Разница между последним и первым числовым значением метрики.
 *
 * @param {MetricSeries} series
 * @param {string} metricName
 * @returns {number|undefined}
 */
function deltaMetric(series, metricName) {
    const values = getMetricValues(series, metricName);
    if (values.length < 2) {
        return undefined;
    }
    return values[values.length - 1].value - values[0].value;
}

/**
 * Среднее изменение метрики на один тик между первым и последним сэмплом.
 *
 * @param {MetricSeries} series
 * @param {string} metricName
 * @returns {number|undefined}
 */
function rateMetric(series, metricName) {
    const values = getMetricValues(series, metricName);
    if (values.length < 2) {
        return undefined;
    }
    const first = values[0];
    const last = values[values.length - 1];
    const tickDelta = last.tick - first.tick;
    if (tickDelta === 0) {
        return undefined;
    }
    return (last.value - first.value) / tickDelta;
}

module.exports = {
    // Config
    resolveMetricsConfig,

    // Recorder
    createMetricsReport,
    appendMetricSample,
    appendWorldSample,

    // Query helpers
    getMetricSeries,
    getRoomMetrics,
    getLatestMetric,
    getLatestRoomMetrics,
    getMetricAtTick,
    getWorldSnapshotAtTick,

    // Aggregation helpers
    getMetricValues,
    averageMetric,
    sumMetric,
    deltaMetric,
    rateMetric,
};
