'use strict';

/**
 * @file Imperative helpers for WorldInstance: mutating DB objects, searching,
 * bot memory, and bot operations.
 *
 * Responsibility:
 *   A set of functions that work directly with adapter.db,
 *   `builders/materialize`, and bot runtime. Each helper
 *   performs one atomic operation: set/damage HP, delete
 *   a structure, spawn creeps, find objects, read/write bot memory,
 *   execute bot code.
 *
 * **Available functions:**
 * - `setTicksToDowngrade` — set controller downgrade time
 * - `setHitsStructure` — overwrite structure hits (clamped to hitsMax)
 * - `damageHitsStructure` — subtract damage from hits (not below 0)
 * - `deleteStructure` — delete a structure from `rooms.objects`
 * - `createStructure` — create a structure via materialize (spec object)
 * - `spawn` — create a creep via materialize (spec object)
 * - `getRcl` — read RCL of a room from DB
 * - `eventLog` — read event log for a room
 * - `readMemory` / `writeMemory` — bot memory operations
 * - `exec` — execute JS code in a bot's context
 * - `botId` — get bot _id by username, index, or first bot
 * - `find` / `findOne` / `findIds` / `findId` — search in `rooms.objects`
 *
 * @module orchestration/worldHelpers
 */

const { materializeStructure, materializeCreep } = require('../builders/materialize');
const { getBotMemory, setBotMemory, deepMergeMemory } = require('../builders/memory');
const { readEventLog } = require('../observers/eventLog');
const { resolveDefaultUserId, defaultBot } = require('./resolveDefaults');
const { FrameworkError, BotError } = require('../errors');

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
 * Reads the RCL of a room directly from the adapter's DB.
 * Sole RCL implementation — used by world.js's thin wrapper and
 * by the bound `getRcl` helper on WorldInstance.
 *
 * @param {StorageAdapter} adapter
 * @param {string} roomName
 * @returns {Promise<number>}
 */
async function getRoomRcl(adapter, roomName) {
    const { db } = adapter;
    const controller = await db['rooms.objects'].findOne({ room: roomName, type: 'controller' });
    return controller ? controller.level : 0;
}

/**
 * Creates a set of helpers bound to the adapter, bot user IDs, and bots.
 *
 * @param {StorageAdapter} adapter
 * @param {string} [defaultBotUserId] — _id of the first bot (fallback)
 * @param {Object<string, string>} [roomToBotUserId] — per-room bot user id lookup
 * @param {Object<string, import('../types').Bot>} [bots] — bots by username (for exec, readMemory, writeMemory, botId)
 * @returns {Object}
 */
function createWorldHelpers(adapter, defaultBotUserId, roomToBotUserId, bots = undefined) {
    const { db } = adapter;

    // ─── Controller ────────────────────────────────────────────────────────

    /** @type {import('../types').SetTicksToDowngradeFn} */
    async function setTicksToDowngrade(roomName, ticks) {
        const controller = await db['rooms.objects'].findOne({
            room: roomName,
            type: 'controller',
        });
        if (!controller) {
            throw new FrameworkError('STRUCTURE_NOT_FOUND', roomName, {
                title: `Controller not found in room "${roomName}"`,
                why: 'setTicksToDowngrade requires a controller in the room.',
                how: 'Make sure the room has a controller. Use spec.controller({ level: N }) in your room spec.',
            });
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

    /** @type {import('../types').SetHitsStructureFn} */
    async function setHitsStructure(idOrObject, hits) {
        const _id = resolveId(idOrObject);
        if (typeof hits !== 'number' || !Number.isFinite(hits) || hits < 0) {
            throw new Error(`setHitsStructure: hits must be >= 0, got ${hits}`);
        }
        const obj = await db['rooms.objects'].findOne({ _id });
        if (!obj) {
            throw new FrameworkError('STRUCTURE_NOT_FOUND', _id, {
                title: `Object with _id "${_id}" not found`,
                why: 'setHitsStructure needs an existing object to modify its hit points.',
                how: 'Check the _id. The object may have been destroyed or was never created.',
            });
        }
        const clamped = Math.min(hits, obj.hitsMax || hits);
        await db['rooms.objects'].update({ _id }, { $set: { hits: clamped } });
    }

    /** @type {import('../types').DamageHitsStructureFn} */
    async function damageHitsStructure(idOrObject, amount) {
        const _id = resolveId(idOrObject);
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
            throw new Error(`damageHitsStructure: amount must be >= 0, got ${amount}`);
        }
        const obj = await db['rooms.objects'].findOne({ _id });
        if (!obj) {
            throw new FrameworkError('STRUCTURE_NOT_FOUND', _id, {
                title: `Object with _id "${_id}" not found`,
                why: 'damageHitsStructure needs an existing object to apply damage to.',
                how: 'Check the _id. The object may have been destroyed or was never created.',
            });
        }
        const newHits = Math.max(0, obj.hits - amount);
        await db['rooms.objects'].update({ _id }, { $set: { hits: newHits } });
    }

    /** @type {import('../types').DeleteStructureFn} */
    async function deleteStructure(idOrObject) {
        const _id = resolveId(idOrObject);
        const obj = await db['rooms.objects'].findOne({ _id });
        if (!obj) {
            throw new FrameworkError('STRUCTURE_NOT_FOUND', _id, {
                title: `Object with _id "${_id}" not found`,
                why: 'deleteStructure needs an existing object to delete.',
                how: 'Check the _id. The object may have been already deleted or was never created.',
            });
        }
        await db['rooms.objects'].removeWhere({ _id });
    }

    /** @type {import('../types').CreateStructureFn} */
    async function createStructure(spec) {
        if (!spec.roomName) {
            throw new Error('createStructure: roomName is required');
        }
        const merged = { ...spec };
        // default applied only if userId is not explicitly specified
        if (merged.userId === undefined) {
            merged.userId = resolveDefaultUserId(spec.roomName, roomToBotUserId, defaultBotUserId);
        }
        if (merged.userId === undefined) {
            throw new Error('createStructure: userId is required (no default bot available)');
        }
        return materializeStructure(adapter, spec.roomName, merged);
    }

    // ─── Creeps ────────────────────────────────────────────────────────────

    /** @type {import('../types').SpawnCreepFn} */
    async function spawnCreep(creepSpec) {
        if (!creepSpec.roomName) {
            throw new Error('spawnCreep: roomName is required');
        }
        // explicit userId: undefined is preserved; default applied only if userId is not specified
        const userId =
            creepSpec.userId !== undefined
                ? creepSpec.userId
                : resolveDefaultUserId(creepSpec.roomName, roomToBotUserId, defaultBotUserId);
        if (userId === undefined) {
            throw new Error('spawnCreep: userId is required (no default bot available)');
        }
        return materializeCreep(adapter, creepSpec.roomName, { ...creepSpec, userId });
    }

    // ─── Event log ─────────────────────────────────────────────────────────

    /** @type {import('../types').EventLogFn} */
    async function getEventLog(room) {
        if (!room) {
            throw new Error('eventLog: room is required');
        }
        return readEventLog(adapter, room);
    }

    // ─── Bot memory & execution ─────────────────────────────────────────────

    /**
     * Reads bot memory.
     * @param {string} [botUsername]
     * @returns {Promise<Object>}
     */
    async function readMemory(botUsername) {
        if (!bots) {
            throw new Error('readMemory: bots not available (pass bots to createWorldHelpers)');
        }
        const username = botUsername || defaultBot(bots);
        return getBotMemory(adapter, bots[username].id);
    }

    /**
     * Updates bot Memory via canonical deep merge.
     *
     * patch is merged over current memory: plain objects are recursively
     * merged, arrays/primitives are replaced, `undefined` does not
     * overwrite anything. This is symmetric to initial load via explicit memory pipeline.
     *
     * @param {string} [botUsername]
     * @param {Object} patch
     * @returns {Promise<void>}
     */
    async function writeMemory(botUsername, patch) {
        if (!bots) {
            throw new Error('writeMemory: bots not available (pass bots to createWorldHelpers)');
        }
        const username = botUsername || defaultBot(bots);
        const current = await getBotMemory(adapter, bots[username].id);
        const next = deepMergeMemory(current, patch || {});
        await setBotMemory(adapter, bots[username].id, next);
    }

    /**
     * Executes JS code in the bot's context via console.
     * @param {string} code
     * @param {string} [botUsername] — if omitted, uses the only bot (single-bot scenario)
     * @returns {Promise<void>}
     */
    async function exec(code, botUsername) {
        if (!bots) {
            throw new Error('exec: bots not available (pass bots to createWorldHelpers)');
        }
        const username = botUsername || defaultBot(bots);
        await bots[username].console(code);
    }

    /**
     * Returns bot _id by username, index, or the first bot.
     *
     * @param {string|number} [bot] — bot username (string) or index (number, 0-based)
     *   If omitted — returns _id of the only bot (single-bot scenario).
     * @returns {string} bot _id
     * @throws {Error} if bot not found or (with empty argument) bots ≠ 1
     */
    function botId(bot) {
        if (!bots) {
            throw new Error('botId: bots not available (pass bots to createWorldHelpers)');
        }
        if (bot === undefined) {
            if (!bots || Object.keys(bots).length === 0) {
                throw new BotError('ZERO_BOTS', undefined, {
                    title: 'botId() called with no bots registered',
                    why: 'botId() without arguments returns the only bot, but no bots are registered.',
                    how: 'Register at least one bot in createWorld({ bots: [...] }) or pass an explicit username.',
                });
            }
            return bots[defaultBot(bots)].id;
        }
        if (typeof bot === 'number') {
            const entries = Object.values(bots);
            if (bot < 0 || bot >= entries.length) {
                throw new BotError('BOT_NOT_FOUND', String(bot), {
                    title: `Bot index ${bot} out of range`,
                    why: `Valid range: 0..${entries.length - 1}.`,
                    how:
                        entries.length > 0
                            ? `Available bots: ${Object.keys(bots).join(', ')}`
                            : 'No bots are registered.',
                });
            }
            return entries[bot].id;
        }
        if (typeof bot === 'string') {
            if (!bots[bot]) {
                throw new BotError(
                    'BOT_NOT_FOUND',
                    bot,
                    {
                        title: `Bot "${bot}" not found`,
                    },
                    [`Available bots: ${Object.keys(bots).join(', ') || '(none)'}`],
                );
            }
            return bots[bot].id;
        }
        throw new BotError('INVALID_BOTID_ARG', typeof bot, {
            title: `Invalid botId() argument type: ${typeof bot}`,
            why: 'botId() accepts a username (string), an index (number), or undefined (for default bot).',
            how: `Pass a valid argument. Received type: ${typeof bot}.`,
        });
    }

    // ─── Find ─────────────────────────────────────────────────────────────

    /** @type {import('../types').WorldFindFn} */
    async function find(query, _opts = {}) {
        const q = normalizeQuery(query);
        const docs = await db['rooms.objects'].find(q);
        return docs.map(addIdAlias);
    }

    /** @type {import('../types').WorldFindOneFn} */
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

    /** @type {import('../types').WorldFindIdsFn} */
    async function findIds(query) {
        const q = normalizeQuery(query);
        const docs = await db['rooms.objects'].find(q);
        return docs.map((d) => d._id);
    }

    /** @type {import('../types').WorldFindIdFn} */
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
        // Creeps
        spawnCreep,
        // Room queries
        getRcl: (roomName) => getRoomRcl(adapter, roomName),
        // Event log
        eventLog: getEventLog,
        // Bot memory & execution
        readMemory,
        writeMemory,
        exec,
        botId,
        // find
        find,
        findOne,
        findIds,
        findId,
    };
}

module.exports = { createWorldHelpers, getRoomRcl };
