'use strict';

/**
 * @file Imperative helpers for WorldInstance: mutating DB objects and searching.
 *
 * Responsibility:
 *   A set of functions that work directly with adapter.db
 *   and `builders/materialize` (only for createStructure). Each helper
 *   performs one atomic operation: set/damage HP, delete
 *   a structure, spawn, find objects.
 *
 * **Available functions:**
 * - `setTicksToDowngrade` — set controller downgrade time
 * - `setHitsStructure` — overwrite structure hits (clamped to hitsMax)
 * - `damageHitsStructure` — subtract damage from hits (not below 0)
 * - `deleteStructure` — delete a structure from `rooms.objects`
 * - `createStructure` — create a structure via materialize (spec object)
 * - `find` / `findOne` / `findIds` / `findId` — search in `rooms.objects`
 *
 * @module helpers/world
 */

const { materializeStructure } = require('../builders/materialize');

/**
 * @typedef {import('../runtime/storageAdapter').StorageAdapter} StorageAdapter
 */

// ─── Helper functions ─────────────────────────────────────────────────

/**
 * Returns the current `gameTime` from server env.
 *
 * @param {StorageAdapter} adapter
 * @returns {Promise<number>}
 */
async function getGameTime(adapter) {
    const { env } = adapter;
    const raw = await env.get(env.keys.GAMETIME);
    return parseInt(raw, 10);
}

/**
 * Extracts `_id` from an argument: a string (the _id itself) or an object with `_id` / `id` field.
 *
 * @param {string|Object} idOrObject
 * @returns {string}
 */
function resolveId(idOrObject) {
    if (typeof idOrObject === 'string') return idOrObject;
    if (idOrObject && typeof idOrObject === 'object') {
        return idOrObject._id || idOrObject.id;
    }
    throw new Error('resolveId: expected a string (_id) or an object with _id/id field');
}

/**
 * Normalizes query for `rooms.objects`: `userId` → `user`, `id` → `_id`.
 *
 * @param {Object} query
 * @returns {Object}
 */
function normalizeQuery(query) {
    const q = { ...query };
    if (q.userId !== undefined) {
        q.user = q.userId;
        delete q.userId;
    }
    if (q.id !== undefined) {
        q._id = q.id;
        delete q.id;
    }
    return q;
}

/**
 * Adds an `id` field (alias for _id) to the document.
 *
 * @param {Object} doc
 * @returns {Object}
 */
function addIdAlias(doc) {
    return { ...doc, id: doc._id };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Creates a set of helpers bound to the adapter and the first bot.
 *
 * @param {StorageAdapter} adapter
 * @param {string} [defaultBotUserId] — _id of the first bot
 * @returns {Object}
 */
function createWorldHelpers(adapter, defaultBotUserId) {
    const { db } = adapter;

    // ─── Controller ────────────────────────────────────────────────────────

    /** @type {import('./types').SetTicksToDowngradeFn} */
    async function setTicksToDowngrade(roomName, ticks) {
        const controller = await db['rooms.objects'].findOne({
            room: roomName,
            type: 'controller',
        });
        if (!controller) {
            throw new Error(`setTicksToDowngrade: controller in room "${roomName}" not found`);
        }
        if (ticks === null) {
            await db['rooms.objects'].update({ _id: controller._id }, { $set: { downgradeTime: null } });
            return;
        }
        if (typeof ticks !== 'number' || ticks < 0 || !Number.isFinite(ticks)) {
            throw new Error(`setTicksToDowngrade: ticks must be >= 0 or null, got ${ticks}`);
        }
        const gameTime = await getGameTime(adapter);
        const downgradeTime = gameTime + ticks;
        await db['rooms.objects'].update({ _id: controller._id }, { $set: { downgradeTime } });
    }

    // ─── Structures ─────────────────────────────────────────────────────────

    /** @type {import('./types').SetHitsStructureFn} */
    async function setHitsStructure(idOrObject, hits) {
        const _id = resolveId(idOrObject);
        if (typeof hits !== 'number' || !Number.isFinite(hits) || hits < 0) {
            throw new Error(`setHitsStructure: hits must be >= 0, got ${hits}`);
        }
        const obj = await db['rooms.objects'].findOne({ _id });
        if (!obj) {
            throw new Error(`setHitsStructure: object with _id "${_id}" not found`);
        }
        const clamped = Math.min(hits, obj.hitsMax || hits);
        await db['rooms.objects'].update({ _id }, { $set: { hits: clamped } });
    }

    /** @type {import('./types').DamageHitsStructureFn} */
    async function damageHitsStructure(idOrObject, amount) {
        const _id = resolveId(idOrObject);
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
            throw new Error(`damageHitsStructure: amount must be >= 0, got ${amount}`);
        }
        const obj = await db['rooms.objects'].findOne({ _id });
        if (!obj) {
            throw new Error(`damageHitsStructure: object with _id "${_id}" not found`);
        }
        const newHits = Math.max(0, obj.hits - amount);
        await db['rooms.objects'].update({ _id }, { $set: { hits: newHits } });
    }

    /** @type {import('./types').DeleteStructureFn} */
    async function deleteStructure(idOrObject) {
        const _id = resolveId(idOrObject);
        const obj = await db['rooms.objects'].findOne({ _id });
        if (!obj) {
            throw new Error(`deleteStructure: object with _id "${_id}" not found`);
        }
        await db['rooms.objects'].removeWhere({ _id });
    }

    /** @type {import('./types').SpawnStructureFn} */
    async function createStructure(spec) {
        if (!spec.roomName) {
            throw new Error('createStructure: spec.roomName is required in spec object');
        }
        const merged = { ...spec };
        if (merged.userId === undefined && defaultBotUserId) {
            merged.userId = defaultBotUserId;
        }
        return materializeStructure(adapter, spec.roomName, merged);
    }

    // ─── Find ─────────────────────────────────────────────────────────────

    /** @type {import('./types').WorldFindFn} */
    async function find(query, _opts = {}) {
        const q = normalizeQuery(query);
        const docs = await db['rooms.objects'].find(q);
        return docs.map(addIdAlias);
    }

    /** @type {import('./types').WorldFindOneFn} */
    async function findOne(query, opts = {}) {
        if (opts.index !== undefined) {
            const docs = await find(query);
            if (opts.index < 0 || opts.index >= docs.length) return null;
            return docs[opts.index];
        }
        const q = normalizeQuery(query);
        const doc = await db['rooms.objects'].findOne(q);
        return doc ? addIdAlias(doc) : null;
    }

    /** @type {import('./types').WorldFindIdsFn} */
    async function findIds(query) {
        const q = normalizeQuery(query);
        const docs = await db['rooms.objects'].find(q);
        return docs.map((d) => d._id);
    }

    /** @type {import('./types').WorldFindIdFn} */
    async function findId(query, opts = {}) {
        if (opts.index !== undefined) {
            const ids = await findIds(query);
            if (opts.index < 0 || opts.index >= ids.length) return null;
            return ids[opts.index];
        }
        const q = normalizeQuery(query);
        const doc = await db['rooms.objects'].findOne(q);
        return doc ? doc._id : null;
    }

    return {
        // Controller
        setTicksToDowngrade,
        // Structures
        setHitsStructure,
        damageHitsStructure,
        deleteStructure,
        createStructure,
        // find
        find,
        findOne,
        findIds,
        findId,
    };
}

module.exports = { createWorldHelpers };
