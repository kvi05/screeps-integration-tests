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
 * - `spawnCreep` — create a creep via materialize (spec object)
 * - `getRcl` — read RCL of a room from DB
 * - `getEventLog` — read event log for a room
 * - `readMemory` / `writeMemory` — bot memory operations
 * - `exec` — execute JS code in a bot's context
 * - `evalInBot` — evaluate JS code in a bot and resolve with the result
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
 * Default timeout for `evalInBot` (ms). Guards against a promise that never
 * resolves when the caller forgets to tick the world after submitting.
 */
const DEFAULT_EVAL_IN_BOT_TIMEOUT_MS = 10000;

/**
 * The engine serializes every console result via `String()` (see
 * `@screeps/engine` `game/console.js`). Try to restore the original value:
 * `JSON.parse` when possible, otherwise return the raw string. `undefined`
 * results (statements without a value) map back to `undefined`.
 *
 * @param {string} raw
 * @returns {any}
 */
function parseConsoleResult(raw) {
    if (typeof raw !== 'string') return raw;
    if (raw === 'undefined') return undefined;
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

/**
 * Shortens a string for error messages.
 * @param {string} str
 * @param {number} [max=80]
 * @returns {string}
 */
function truncate(str, max = 80) {
    return str.length > max ? `${str.slice(0, max)}...` : str;
}

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

    /**
     * Per-bot state for `evalInBot`: pending promises keyed by a unique
     * per-command id, plus a lazily-attached `console` listener. Each command
     * is wrapped so its result carries its id — results are matched by id,
     * so they stay correct regardless of the order the engine reports them.
     * @type {Map<string, {pendings: Map<number, Object>, listener: Function|null}>}
     */
    const evalInBotState = new Map();

    /** Monotonic id generator for evalInBot commands (per world instance). */
    let evalInBotSeq = 0;

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
            throw new Error('getEventLog: room is required');
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
     * Evaluates JS code in the bot's context and resolves with the result —
     * `exec` + result transport. The code runs on the **next server tick**,
     * so create the promise first, tick the world, then await:
     *
     * @example
     * const promise = world.evalInBot('Game.time');
     * await world.tick(1);
     * const gameTime = await promise; // number — data from the sandbox
     *
     * Extract live game state the test doesn't know upfront, using the bot's
     * own logic (Game objects, find, Memory…):
     *
     * @example
     * const promise = world.evalInBot('Game.rooms.W0N1.controller.level');
     * await world.tick(1);
     * const level = await promise; // 1
     *
     * @example
     * const promise = world.evalInBot(
     *     'JSON.stringify(Game.rooms.W0N1.find(FIND_MY_CREEPS).map(c => c.pos))',
     * );
     * await world.tick(1);
     * const creeps = await promise; // array of creep positions
     *
     * The engine serializes console results to strings, so `evalInBot` tries
     * `JSON.parse` (parsed value, otherwise the raw string). To transport
     * objects/arrays back, use `JSON.stringify(...)` in the expression. If
     * the expression throws, the promise rejects with the actual error. If
     * no result arrives within `DEFAULT_EVAL_IN_BOT_TIMEOUT_MS`, the promise
     * rejects with a hint to tick the world.
     *
     * @param {string} code
     * @param {string} [botUsername] — if omitted, uses the only bot (single-bot scenario)
     * @returns {Promise<any>} result of the expression
     */
    function evalInBot(code, botUsername) {
        if (!bots) {
            throw new Error('evalInBot: bots not available (pass bots to createWorldHelpers)');
        }
        const username = botUsername || defaultBot(bots);
        const bot = bots[username];
        if (!bot) {
            throw new Error(`evalInBot: bot "${username}" not found`);
        }

        let entry = evalInBotState.get(username);
        if (!entry) {
            entry = { pendings: new Map(), listener: null };
            evalInBotState.set(username, entry);
        }
        if (!entry.listener) {
            entry.listener = (log, results) => {
                // Bot's own console.log output carries no REPL results —
                // only submitted console commands do. Skip those events.
                if (!results || results.length === 0) {
                    return;
                }
                for (const raw of results) {
                    let envelope;
                    try {
                        envelope = JSON.parse(raw);
                    } catch {
                        // Not one of our wrapped commands (raw `exec` result).
                        continue;
                    }
                    if (!envelope || typeof envelope !== 'object' || envelope.__evalInBot === undefined) {
                        continue;
                    }
                    const pending = entry.pendings.get(envelope.__evalInBot);
                    if (!pending) {
                        continue;
                    }
                    entry.pendings.delete(envelope.__evalInBot);
                    clearTimeout(pending.timer);
                    if (envelope.error !== undefined) {
                        const detail = envelope.serializeError
                            ? `the expression returned a value that cannot be transported (${truncate(String(envelope.error))}) — use JSON.stringify(...) in the expression to send objects/arrays`
                            : truncate(String(envelope.error));
                        pending.reject(new Error(`evalInBot: expression failed: ${detail}`));
                    } else {
                        pending.resolve(parseConsoleResult(envelope.result));
                    }
                }
            };
            bot.on('console', entry.listener);
        }

        // Wrap the user code so that the result (or error) travels back
        // tagged with a unique id. This keeps results correct even when the
        // engine reports console results out of submission order, and it
        // captures expression errors in-band instead of relying on the
        // engine's separate error channel. `eval` is used so that both
        // expressions and statements (e.g. `throw ...`) are supported. The
        // wrapper's own `JSON.stringify` is guarded separately, so an
        // unserializable value (circular object, BigInt…) is reported with a
        // transport hint instead of a raw, confusing error.
        const id = ++evalInBotSeq;
        const wrappedCode =
            `(() => { try { const __r = eval(${JSON.stringify(code)}); ` +
            `try { return JSON.stringify({ __evalInBot: ${id}, result: __r }); } ` +
            `catch (__s) { return JSON.stringify({ __evalInBot: ${id}, serializeError: true, error: String(__s && __s.stack || __s) }); } } ` +
            `catch (__e) { return JSON.stringify({ __evalInBot: ${id}, error: String(__e && __e.stack || __e) }); } })()`;

        const promise = new Promise((resolve, reject) => {
            const pending = {
                resolve,
                reject,
                // `unref()` — a pending timer must not keep the process alive
                // after the world is disposed (worker isolation already calls
                // process.exit, this is a belt-and-suspenders measure).
                timer: setTimeout(() => {
                    entry.pendings.delete(id);
                    reject(
                        new Error(
                            `evalInBot: timed out waiting for the result of "${truncate(code)}". ` +
                                'The expression runs on the next tick — call `world.tick(n)` after evalInBot.',
                        ),
                    );
                }, DEFAULT_EVAL_IN_BOT_TIMEOUT_MS).unref(),
            };
            entry.pendings.set(id, pending);
            bot.console(wrappedCode).catch((err) => {
                entry.pendings.delete(id);
                clearTimeout(pending.timer);
                reject(err);
            });
        });
        // The promise may reject during world.tick(n) — before the caller has
        // a chance to await it. Attach a no-op handler to avoid Node's
        // "unhandled rejection" crash; the caller still observes the rejection.
        promise.catch(() => {});
        return promise;
    }

    /**
     * Releases `evalInBot` resources: removes the lazily-attached console
     * listener from each bot and rejects any still-pending promises (their
     * internal no-op `.catch` already swallows the rejection). Called from
     * `world.dispose()`.
     *
     * Exposed as a non-enumerable property so `...helpers` spread in
     * `world.js` does not leak it onto the public `world` object.
     */
    function disposeEvalInBot() {
        for (const [username, entry] of evalInBotState) {
            if (entry.listener) {
                const bot = bots && bots[username];
                if (bot && typeof bot.off === 'function') {
                    bot.off('console', entry.listener);
                }
            }
            for (const pending of entry.pendings.values()) {
                clearTimeout(pending.timer);
                pending.reject(
                    new Error(
                        'evalInBot: world disposed before the result arrived — call world.tick(n) and await the promise before dispose.',
                    ),
                );
            }
            entry.pendings.clear();
        }
        evalInBotState.clear();
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

    const helpers = {
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
        getEventLog,
        // Bot memory & execution
        readMemory,
        writeMemory,
        exec,
        evalInBot,
        botId,
        // find
        find,
        findOne,
        findIds,
        findId,
    };

    // Internal lifecycle hook — hidden from `...helpers` spread (and thus
    // from the public `world` object), but reachable by world.js's dispose().
    Object.defineProperty(helpers, 'disposeEvalInBot', {
        value: disposeEvalInBot,
        enumerable: false,
        writable: true,
        configurable: true,
    });
    return helpers;
}

module.exports = { createWorldHelpers, getRoomRcl };
