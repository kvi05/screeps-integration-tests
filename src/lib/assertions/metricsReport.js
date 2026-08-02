'use strict';

/**
 * Time-series metrics for an integration test: recording, reading, aggregation, CSV export.
 *
 * Knows nothing about ScreepsServer and does not make assertions. Takes raw data
 * from `observers/metrics.js`.
 *
 * ## Entity types
 *
 * Metrics are organised by entity type. Each type stores time-series
 * (`MetricSeries[]`) keyed by an identifier (room name, colony name, bot name).
 * The exception is `world` (a single flat series, not split by id).
 *
 * | Entity type | Storage | Identifier |
 * |---|---|---|
 * | `rooms` | `{[roomName]: MetricSeries}` | `roomName` (`'W0N1'`) |
 * | `colonies` | `{[colonyName]: MetricSeries}` | `colonyName` |
 * | `bots` | `{[botName]: MetricSeries}` | `botName` |
 * | `world` | `MetricSeries[]` | — |
 *
 * The set of fields in samples differs by entity type. The API methods
 * are the same for all (series, latest, average, …).
 *
 * @module metricsReport
 */

/**
 * @typedef {import('../types').MetricEntityType} MetricEntityType
 * @typedef {import('../types').MetricsSample} MetricsSample
 * @typedef {import('../types').MetricSeries} MetricSeries
 * @typedef {import('../types').WorldReport} WorldReport
 * @typedef {import('../types').WorldOpts} WorldOpts
 */

const VALID_ENTITY_TYPES = ['rooms', 'colonies', 'bots', 'world'];
const MAP_ENTITY_TYPES = ['rooms', 'colonies', 'bots'];

// ─── Framework defaults ──────────────────────────────────────────────────────────

/** @type {number} */
const DEFAULT_METRICS_EVERY = 0;
/** @type {boolean} */
const DEFAULT_METRICS_ROOMS = true;
/** @type {boolean} */
const DEFAULT_METRICS_BOTS = false;

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
     * Resolves metrics collection settings from `WorldOpts`.
     *
     * The `colonies` and `world` flags are not yet supported.
     *
     * @param {WorldOpts} opts
     * @returns {{every:number, rooms:boolean, colonies:boolean, bots:boolean, world:boolean}}
     */
    static resolveConfig(opts) {
        const metricsOpts = opts.metrics || {};
        const every = metricsOpts.every !== undefined ? metricsOpts.every : DEFAULT_METRICS_EVERY;
        const rooms = metricsOpts.rooms !== undefined ? metricsOpts.rooms : DEFAULT_METRICS_ROOMS;
        const bots = metricsOpts.bots !== undefined ? metricsOpts.bots : DEFAULT_METRICS_BOTS;

        const unsupported = [];
        if (metricsOpts.colonies) {
            unsupported.push('colonies');
        }
        if (metricsOpts.world) {
            unsupported.push('world');
        }
        if (unsupported.length > 0) {
            throw new Error(`metrics.${unsupported.join(', ')} not yet supported in the integration framework`);
        }

        return { every, rooms, colonies: false, bots, world: false };
    }

    // ── Getters (for access via world.report.metrics.rooms and toJSON) ──

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

    // ── Recording ────────────────────────────────────────────────────

    /**
     * Appends a sample to the time-series of the specified entity.
     *
     * Does not mutate the input `values`: creates a new plain object `{ tick, ...values }`.
     *
     * @param {MetricEntityType} entityType — `'rooms'` | `'colonies'` | `'bots'` | `'world'`
     * @param {string} entityId — entity identifier (ignored for `'world'`)
     * @param {number} tick — tick number (≥ 0, integer)
     * @param {Object<string,*>} values — arbitrary JSON-compatible metric fields
     * @returns {MetricsSample}
     * @throws {TypeError} on invalid parameters
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
                    `entityId for '${entityType}' must be a non-empty string (got ${String(entityId)})`,
                );
            }
            if (!this[`_${entityType}`][entityId]) {
                this[`_${entityType}`][entityId] = [];
            }
            this[`_${entityType}`][entityId].push(sample);
        }

        return sample;
    }

    // ── Reading ─────────────────────────────────────────────────────

    /**
     * Returns the time-series for an entity.
     *
     * @param {MetricEntityType} entityType
     * @param {string} entityId
     * @returns {MetricSeries} — empty array if entity not found
     */
    series(entityType, entityId) {
        this._validateEntityType(entityType);
        if (entityType === 'world') {
            return this._world;
        }
        return this[`_${entityType}`][entityId] || [];
    }

    /**
     * Returns the time-series for a room.
     * @param {string} roomName
     * @returns {MetricSeries}
     */
    room(roomName) {
        return this.series('rooms', roomName);
    }

    /**
     * Returns the time-series for a colony.
     * @param {string} colonyName
     * @returns {MetricSeries}
     */
    colony(colonyName) {
        return this.series('colonies', colonyName);
    }

    /**
     * Returns the time-series for a bot.
     * @param {string} botName
     * @returns {MetricSeries}
     */
    bot(botName) {
        return this.series('bots', botName);
    }

    /**
     * Returns the latest sample for an entity.
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
     * Returns the sample at the exact specified tick.
     * Does not interpolate or pick the nearest.
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
     * Collects a snapshot of all entities of the given type at a tick.
     *
     * @param {MetricEntityType} entityType — only map-type (`rooms`/`colonies`/`bots`)
     * @param {number} tick
     * @returns {Object<string, MetricsSample>}
     */
    snapshotAtTick(entityType, tick) {
        this._validateTick(tick);
        if (!MAP_ENTITY_TYPES.includes(entityType)) {
            throw new TypeError(`snapshotAtTick: entityType must be a map-type (${MAP_ENTITY_TYPES.join(', ')})`);
        }

        /** @type {Object<string, MetricsSample>} */
        const snapshot = {};
        for (const [id, series] of Object.entries(this[`_${entityType}`])) {
            const sample = series.find((s) => s.tick === tick);
            if (sample) snapshot[id] = sample;
        }
        return snapshot;
    }

    // ── Aggregation ─────────────────────────────────────────────────

    /**
     * Extracts numeric `{ tick, value }` pairs for a given field from a series.
     * Skips missing, `null`, and non-numeric values.
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
     * Average value of a metric across a series.
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
     * Sum of numeric values of a metric across a series.
     * @param {MetricSeries} series
     * @param {string} metricName
     * @returns {number}
     */
    sum(series, metricName) {
        return this.values(series, metricName).reduce((acc, { value }) => acc + value, 0);
    }

    /**
     * Difference between the last and first numeric value of a metric.
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
     * Average change of a metric per tick between the first and last sample.
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

    // ── Export ─────────────────────────────────────────────────────

    /**
     * Flattens the entire report into flat rows for CSV.
     *
     * @param {Object} [opts]
     * @param {MetricEntityType[]} [opts.entityTypes] — restrict entity types
     * @param {string[]} [opts.metrics] — restrict metric names
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
     * Returns an array of CSV strings (including header).
     *
     * @param {Object} [opts] — same options as `flatten()`
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
     * Returns a CSV string.
     *
     * @param {Object} [opts] — same options as `flatten()`
     * @returns {string}
     */
    toCsv(opts = {}) {
        return this.toCsvRows(opts).join('\n');
    }

    // ── Serialisation ──────────────────────────────────────────────

    /**
     * Returns a plain object for `JSON.stringify()`.
     * Preserves data only, no methods.
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
     * Restores a MetricsReport from a plain object (e.g., from a JSON baseline).
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

    // ── Private ──────────────────────────────────────────────────

    /** @private */
    _validateTick(tick) {
        if (typeof tick !== 'number' || !Number.isFinite(tick) || !Number.isInteger(tick) || tick < 0) {
            throw new TypeError(`tick must be an integer ≥ 0 (got ${String(tick)})`);
        }
    }

    /** @private */
    _validateEntityType(type) {
        if (!VALID_ENTITY_TYPES.includes(type)) {
            throw new TypeError(`entityType must be one of ${VALID_ENTITY_TYPES.join(', ')} (got '${String(type)}')`);
        }
    }

    /** @private */
    _flattenSample(entityType, entityId, sample, metricFilter) {
        const tick = sample.tick;
        const rows = [];

        for (const [key, rawValue] of Object.entries(sample)) {
            if (key === 'tick') continue;
            if (metricFilter && !metricFilter.includes(key)) continue;

            // creepsByRole is expanded into separate metrics
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
