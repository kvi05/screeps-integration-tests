'use strict';

/**
 * @file Императивные хелперы для WorldInstance: мутация объектов БД и поиск.
 *
 * Responsibility:
 *   Набор функций, которые работают напрямую с adapter.db
 *   и `builders/materialize` (только для createStructure). Каждый хелпер
 *   выполняет одну атомарную операцию: установить/уронить HP, удалить
 *   структуру, заспавнить, найти объекты.
 *
 * **Available functions:**
 * - `setTicksToDowngrade` — установить время до даунгрейда контроллера
 * - `setHitsStructure` — перезаписать hits структуры (clamp по hitsMax)
 * - `damageHitsStructure` — вычесть урон из hits (не ниже 0)
 * - `deleteStructure` — удалить структуру из `rooms.objects`
 * - `createStructure` — создать структуру через materialize (spec-объект)
 * - `find` / `findOne` / `findIds` / `findId` — поиск в `rooms.objects`
 *
 * @module helpers/world
 */

const { materializeStructure } = require('./builders/materialize');

/**
 * @typedef {import('./storageAdapter').StorageAdapter} StorageAdapter
 */

// ─── Вспомогательные функции ─────────────────────────────────────────────────

/**
 * Возвращает текущий `gameTime` из env сервера.
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
 * Извлекает `_id` из аргумента: строки (сам _id) или объекта с полем `_id` / `id`.
 *
 * @param {string|Object} idOrObject
 * @returns {string}
 */
function resolveId(idOrObject) {
    if (typeof idOrObject === 'string') return idOrObject;
    if (idOrObject && typeof idOrObject === 'object') {
        return idOrObject._id || idOrObject.id;
    }
    throw new Error('resolveId: ожидается строка (_id) или объект с полем _id/id');
}

/**
 * Нормализует query для `rooms.objects`: `userId` → `user`, `id` → `_id`.
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
 * Добавляет поле `id` (alias _id) к документу.
 *
 * @param {Object} doc
 * @returns {Object}
 */
function addIdAlias(doc) {
    return { ...doc, id: doc._id };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Создаёт набор хелперов, привязанных к адаптеру и первому боту.
 *
 * @param {StorageAdapter} adapter
 * @param {string} [defaultBotUserId] — _id первого бота
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
            throw new Error(`setTicksToDowngrade: контроллер в комнате "${roomName}" не найден`);
        }
        if (ticks === null) {
            await db['rooms.objects'].update({ _id: controller._id }, { $set: { downgradeTime: null } });
            return;
        }
        if (typeof ticks !== 'number' || ticks < 0 || !Number.isFinite(ticks)) {
            throw new Error(`setTicksToDowngrade: ticks должен быть >= 0 или null, получено ${ticks}`);
        }
        const gameTime = await getGameTime(adapter);
        const downgradeTime = gameTime + ticks;
        await db['rooms.objects'].update({ _id: controller._id }, { $set: { downgradeTime } });
    }

    // ─── Структуры ─────────────────────────────────────────────────────────

    /** @type {import('./types').SetHitsStructureFn} */
    async function setHitsStructure(idOrObject, hits) {
        const _id = resolveId(idOrObject);
        if (typeof hits !== 'number' || !Number.isFinite(hits) || hits < 0) {
            throw new Error(`setHitsStructure: hits должен быть >= 0, получено ${hits}`);
        }
        const obj = await db['rooms.objects'].findOne({ _id });
        if (!obj) {
            throw new Error(`setHitsStructure: объект с _id "${_id}" не найден`);
        }
        const clamped = Math.min(hits, obj.hitsMax || hits);
        await db['rooms.objects'].update({ _id }, { $set: { hits: clamped } });
    }

    /** @type {import('./types').DamageHitsStructureFn} */
    async function damageHitsStructure(idOrObject, amount) {
        const _id = resolveId(idOrObject);
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
            throw new Error(`damageHitsStructure: amount должен быть >= 0, получено ${amount}`);
        }
        const obj = await db['rooms.objects'].findOne({ _id });
        if (!obj) {
            throw new Error(`damageHitsStructure: объект с _id "${_id}" не найден`);
        }
        const newHits = Math.max(0, obj.hits - amount);
        await db['rooms.objects'].update({ _id }, { $set: { hits: newHits } });
    }

    /** @type {import('./types').DeleteStructureFn} */
    async function deleteStructure(idOrObject) {
        const _id = resolveId(idOrObject);
        const obj = await db['rooms.objects'].findOne({ _id });
        if (!obj) {
            throw new Error(`deleteStructure: объект с _id "${_id}" не найден`);
        }
        await db['rooms.objects'].removeWhere({ _id });
    }

    /** @type {import('./types').SpawnStructureFn} */
    async function createStructure(spec) {
        if (!spec.roomName) {
            throw new Error('createStructure: spec.roomName обязателен в spec-объекте');
        }
        const merged = { ...spec };
        if (merged.userId === undefined && defaultBotUserId) {
            merged.userId = defaultBotUserId;
        }
        return materializeStructure(adapter, spec.roomName, merged);
    }

    // ─── Поиск ─────────────────────────────────────────────────────────────

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
