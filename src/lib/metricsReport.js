'use strict';

/**
 * Time-series метрики integration-теста: запись, чтение, агрегация, CSV-экспорт.
 *
 * Не знает о ScreepsServer и не делает assert'ов. Принимает сырые данные
 * от `observers/metrics.js`.
 *
 * ## Entity-типы
 *
 * Метрики организованы по типам сущностей. Каждый тип хранит time-series
 * (`MetricSeries[]`) по идентификатору (имя комнаты, имя колонии, имя бота).
 * Исключение — `world` (единая плоская series, без разбивки по id).
 *
 * | Entity-тип | Хранилище | Идентификатор |
 * |---|---|---|
 * | `rooms` | `{[roomName]: MetricSeries}` | `roomName` (`'W0N1'`) |
 * | `colonies` | `{[colonyName]: MetricSeries}` | `colonyName` |
 * | `bots` | `{[botName]: MetricSeries}` | `botName` |
 * | `world` | `MetricSeries[]` | — |
 *
 * Набор полей в сэмплах различается в зависимости от entity-типа. Методы
 * работы одни и те же (series, latest, average, …).
 *
 * @module metricsReport
 */

/**
 * @typedef {import('./types').MetricEntityType} MetricEntityType
 * @typedef {import('./types').MetricsSample} MetricsSample
 * @typedef {import('./types').MetricSeries} MetricSeries
 * @typedef {import('./types').WorldReport} WorldReport
 * @typedef {import('./types').WorldOpts} WorldOpts
 */

const VALID_ENTITY_TYPES = ['rooms', 'colonies', 'bots', 'world'];
const MAP_ENTITY_TYPES = ['rooms', 'colonies', 'bots'];

class MetricsReport {
    constructor() {
        /** @private */
        this._rooms = {};
        /** @private */
        this._colonies = {};
        /** @private */
        this._bots = {};
        /** @private */
        this._world = [];
    }

    // ── Static ───────────────────────────────────────────────────

    /**
     * Разрешает настройки сбора метрик из `WorldOpts`.
     *
     * Флаги `colonies`, `bots`, `world` пока не поддерживаются.
     *
     * @param {WorldOpts} opts
     * @returns {{every:number, rooms:boolean, colonies:boolean, bots:boolean, world:boolean}}
     */
    static resolveConfig(opts) {
        const metricsOpts = opts.metrics || {};
        const every = metricsOpts.every !== undefined ? metricsOpts.every : 0;
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

        return { every, rooms, colonies: false, bots: false, world: false };
    }

    // ── Геттеры (для доступа из world.report.metrics.rooms и toJSON) ──

    /** @returns {Object<string, MetricSeries>} */
    get rooms() {
        return this._rooms;
    }

    /** @returns {Object<string, MetricSeries>} */
    get colonies() {
        return this._colonies;
    }

    /** @returns {Object<string, MetricSeries>} */
    get bots() {
        return this._bots;
    }

    /** @returns {MetricSeries} */
    get world() {
        return this._world;
    }

    // ── Запись ──────────────────────────────────────────────────────

    /**
     * Добавляет сэмпл в time-series указанной сущности.
     *
     * Не мутирует входной `values`: создаёт новый plain-объект `{ tick, ...values }`.
     *
     * @param {MetricEntityType} entityType — `'rooms'` | `'colonies'` | `'bots'` | `'world'`
     * @param {string} entityId — идентификатор сущности (для `'world'` игнорируется)
     * @param {number} tick — номер тика (≥ 0, целое)
     * @param {Object<string,*>} values — произвольные JSON-совместимые поля метрики
     * @returns {MetricsSample}
     * @throws {TypeError} при недопустимых параметрах
     */
    append(entityType, entityId, tick, values) {
        this._validateTick(tick);
        this._validateEntityType(entityType);

        const sample = { tick, ...values };

        if (entityType === 'world') {
            this._world.push(sample);
        } else {
            if (typeof entityId !== 'string' || entityId.length === 0) {
                throw new TypeError(
                    `entityId для '${entityType}' должен быть непустой строкой (получено ${String(entityId)})`,
                );
            }
            if (!this[`_${entityType}`][entityId]) {
                this[`_${entityType}`][entityId] = [];
            }
            this[`_${entityType}`][entityId].push(sample);
        }

        return sample;
    }

    // ── Чтение ──────────────────────────────────────────────────────

    /**
     * Возвращает time-series сущности.
     *
     * @param {MetricEntityType} entityType
     * @param {string} entityId
     * @returns {MetricSeries} — пустой массив, если сущность не найдена
     */
    series(entityType, entityId) {
        this._validateEntityType(entityType);
        if (entityType === 'world') {
            return this._world;
        }
        return this[`_${entityType}`][entityId] || [];
    }

    /**
     * Возвращает time-series комнаты.
     * @param {string} roomName
     * @returns {MetricSeries}
     */
    room(roomName) {
        return this.series('rooms', roomName);
    }

    /**
     * Возвращает time-series колонии.
     * @param {string} colonyName
     * @returns {MetricSeries}
     */
    colony(colonyName) {
        return this.series('colonies', colonyName);
    }

    /**
     * Возвращает time-series бота.
     * @param {string} botName
     * @returns {MetricSeries}
     */
    bot(botName) {
        return this.series('bots', botName);
    }

    /**
     * Возвращает последний сэмпл для сущности.
     * @param {MetricEntityType} entityType
     * @param {string} entityId
     * @returns {MetricsSample|undefined}
     */
    latest(entityType, entityId) {
        const s = this.series(entityType, entityId);
        return s.length > 0 ? s[s.length - 1] : undefined;
    }

    /** @param {string} roomName */
    latestRoom(roomName) {
        return this.latest('rooms', roomName);
    }

    /** @param {string} colonyName */
    latestColony(colonyName) {
        return this.latest('colonies', colonyName);
    }

    /** @param {string} botName */
    latestBot(botName) {
        return this.latest('bots', botName);
    }

    /**
     * Возвращает сэмпл ровно на указанном тике.
     * Не интерполирует и не выбирает ближайший.
     *
     * @param {MetricEntityType} entityType
     * @param {string} entityId
     * @param {number} tick
     * @returns {MetricsSample|undefined}
     */
    atTick(entityType, entityId, tick) {
        this._validateTick(tick);
        return this.series(entityType, entityId).find((s) => s.tick === tick);
    }

    /**
     * Собирает снимок всех сущностей указанного типа на тике.
     *
     * @param {MetricEntityType} entityType — только map-тип (`rooms`/`colonies`/`bots`)
     * @param {number} tick
     * @returns {Object<string, MetricsSample>}
     */
    snapshotAtTick(entityType, tick) {
        this._validateTick(tick);
        if (!MAP_ENTITY_TYPES.includes(entityType)) {
            throw new TypeError(`snapshotAtTick: entityType должен быть map-типом (${MAP_ENTITY_TYPES.join(', ')})`);
        }

        /** @type {Object<string, MetricsSample>} */
        const snapshot = {};
        for (const [id, series] of Object.entries(this[`_${entityType}`])) {
            const sample = series.find((s) => s.tick === tick);
            if (sample) snapshot[id] = sample;
        }
        return snapshot;
    }

    // ── Агрегация ───────────────────────────────────────────────────

    /**
     * Извлекает числовые `{ tick, value }` для указанного поля series.
     * Пропускает отсутствующие, `null` и нечисловые значения.
     *
     * @param {MetricSeries} series
     * @param {string} metricName
     * @returns {Array<{tick:number, value:number}>}
     */
    values(series, metricName) {
        const result = [];
        for (const sample of series) {
            const v = sample[metricName];
            if (typeof v === 'number' && Number.isFinite(v)) {
                result.push({ tick: sample.tick, value: v });
            }
        }
        return result;
    }

    /**
     * Среднее значение метрики по series.
     * @param {MetricSeries} series
     * @param {string} metricName
     * @returns {number|undefined}
     */
    average(series, metricName) {
        const vals = this.values(series, metricName);
        if (vals.length === 0) {
            return undefined;
        }
        return vals.reduce((acc, { value }) => acc + value, 0) / vals.length;
    }

    /**
     * Сумма числовых значений метрики по series.
     * @param {MetricSeries} series
     * @param {string} metricName
     * @returns {number}
     */
    sum(series, metricName) {
        return this.values(series, metricName).reduce((acc, { value }) => acc + value, 0);
    }

    /**
     * Разница между последним и первым числовым значением метрики.
     * @param {MetricSeries} series
     * @param {string} metricName
     * @returns {number|undefined}
     */
    delta(series, metricName) {
        const vals = this.values(series, metricName);
        if (vals.length < 2) return undefined;
        return vals[vals.length - 1].value - vals[0].value;
    }

    /**
     * Среднее изменение метрики на один тик между первым и последним сэмплом.
     * @param {MetricSeries} series
     * @param {string} metricName
     * @returns {number|undefined}
     */
    rate(series, metricName) {
        const vals = this.values(series, metricName);
        if (vals.length < 2) return undefined;
        const tickDelta = vals[vals.length - 1].tick - vals[0].tick;
        if (tickDelta === 0) return undefined;
        return (vals[vals.length - 1].value - vals[0].value) / tickDelta;
    }

    // ── Экспорт ─────────────────────────────────────────────────────

    /**
     * Превращает весь отчёт в плоские строки для CSV.
     *
     * @param {Object} [opts]
     * @param {MetricEntityType[]} [opts.entityTypes] — ограничить набор entity-типов
     * @param {string[]} [opts.metrics] — ограничить набор имён метрик
     * @returns {Array<{entityType:string, entityId:string, tick:number, metric:string, value:string|number|boolean}>}
     */
    flatten(opts = {}) {
        const rows = [];
        const entityTypes = opts.entityTypes || VALID_ENTITY_TYPES;
        const metricFilter = opts.metrics;

        for (const entityType of entityTypes) {
            if (entityType === 'world') {
                for (const sample of this._world) {
                    rows.push(...this._flattenSample(entityType, 'world', sample, metricFilter));
                }
                continue;
            }

            const map = this[`_${entityType}`] || {};
            for (const [entityId, series] of Object.entries(map)) {
                for (const sample of series) {
                    rows.push(...this._flattenSample(entityType, entityId, sample, metricFilter));
                }
            }
        }

        rows.sort((a, b) => {
            if (a.entityType !== b.entityType) return a.entityType.localeCompare(b.entityType);
            if (a.entityId !== b.entityId) return a.entityId.localeCompare(b.entityId);
            if (a.tick !== b.tick) return a.tick - b.tick;
            return a.metric.localeCompare(b.metric);
        });

        return rows;
    }

    /**
     * Возвращает массив CSV-строк (включая header).
     *
     * @param {Object} [opts] — те же опции, что у `flatten()`
     * @returns {string[]}
     */
    toCsvRows(opts = {}) {
        const rows = this.flatten(opts);
        const header = ['entityType', 'entityId', 'tick', 'metric', 'value'];
        const lines = [header.join(',')];
        for (const row of rows) {
            lines.push([row.entityType, row.entityId, row.tick, row.metric, this._escapeCsv(row.value)].join(','));
        }
        return lines;
    }

    /**
     * Возвращает CSV-строку.
     *
     * @param {Object} [opts] — те же опции, что у `flatten()`
     * @returns {string}
     */
    toCsv(opts = {}) {
        return this.toCsvRows(opts).join('\n');
    }

    // ── Сериализация ────────────────────────────────────────────────

    /**
     * Возвращает plain-объект для `JSON.stringify()`.
     * Сохраняет только данные, без методов.
     *
     * @returns {{rooms: Object<string,MetricSeries>, colonies: Object<string,MetricSeries>, bots: Object<string,MetricSeries>, world: MetricSeries}}
     */
    toJSON() {
        return {
            rooms: this._rooms,
            colonies: this._colonies,
            bots: this._bots,
            world: this._world,
        };
    }

    /**
     * Восстанавливает MetricsReport из plain-объекта (например, из JSON baseline).
     *
     * @param {{rooms?: Object<string,MetricSeries>, colonies?: Object<string,MetricSeries>, bots?: Object<string,MetricSeries>, world?: MetricSeries}} json
     * @returns {MetricsReport}
     */
    static fromJSON(json) {
        const m = new MetricsReport();
        if (json.rooms) m._rooms = json.rooms;
        if (json.colonies) m._colonies = json.colonies;
        if (json.bots) m._bots = json.bots;
        if (json.world) m._world = json.world;
        return m;
    }

    // ── Приватные ───────────────────────────────────────────────────

    /** @private */
    _validateTick(tick) {
        if (typeof tick !== 'number' || !Number.isFinite(tick) || !Number.isInteger(tick) || tick < 0) {
            throw new TypeError(`tick должен быть целым числом ≥ 0 (получено ${String(tick)})`);
        }
    }

    /** @private */
    _validateEntityType(type) {
        if (!VALID_ENTITY_TYPES.includes(type)) {
            throw new TypeError(
                `entityType должен быть одним из ${VALID_ENTITY_TYPES.join(', ')} (получено '${String(type)}')`,
            );
        }
    }

    /** @private */
    _flattenSample(entityType, entityId, sample, metricFilter) {
        const tick = sample.tick;
        const rows = [];

        for (const [key, rawValue] of Object.entries(sample)) {
            if (key === 'tick') continue;
            if (metricFilter && !metricFilter.includes(key)) continue;

            // creepsByRole разворачиваем в отдельные метрики
            if (key === 'creepsByRole' && rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
                for (const [role, count] of Object.entries(rawValue)) {
                    if (typeof count === 'number') {
                        rows.push({ entityType, entityId, tick, metric: `creepsByRole.${role}`, value: count });
                    }
                }
                continue;
            }

            if (!this._isScalar(rawValue)) continue;
            rows.push({ entityType, entityId, tick, metric: key, value: rawValue });
        }

        return rows;
    }

    /** @private */
    _isScalar(v) {
        const t = typeof v;
        return t === 'number' || t === 'string' || t === 'boolean';
    }

    /** @private */
    _escapeCsv(v) {
        const s = String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }
}

module.exports = { MetricsReport };
