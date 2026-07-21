'use strict';

const assert = require('node:assert');
const { EVENT_ATTACK, filterByType, filterDestroyed } = require('../observers/eventLog');

const { BOT_STRUCTURE_TYPES } = require('../../constants/screepsConstants');

/**
 * @typedef {import('../types').WorldReport} WorldReport
 * @typedef {import('../types').EventLogEntry} EventLogEntry
 *
 * @typedef {Object} ObjectFilter
 * @property {string|string[]} [types]     — type(s) of object (STRUCTURE_* or TYPE_CREEPS)
 * @property {string} [id]                 — specific _id of an object
 */

/**
 * Returns the user-owner of an object by its `_id` (from `report.objectOwners`,
 * accumulated via `rooms.objects` snapshots — see observers/ownership.js).
 *
 * @param {WorldReport} report
 * @param {string} objectId
 * @returns {string|undefined}
 */
function ownerOf(report, objectId) {
    return report.objectOwners && report.objectOwners[objectId];
}

// ─── Bot health ─────────────────────────────────────────────────────────────

/**
 * Asserts that there are no errors in the bot logs.
 *
 * @param {WorldReport} report
 * @returns {void}
 */
function assertNoErrors(report) {
    assert.strictEqual(report.errors.length, 0, `найдены ошибки:\n${report.errors.join('\n')}`);
}

/**
 * Core assertion that the bot actually ran: Memory is non-empty after the run.
 *
 * Calls `assertNoErrors` at the end.
 *
 * Asserts that ALL bots worked (each bot's Memory is non-empty).
 *
 * @param {WorldReport} report
 * @returns {void}
 */
function assertBotWorked(report) {
    assert.ok(report.ticksRun > 0, 'бот не сделал ни одного тика');
    assert.ok(report.finalMemory, 'Memory не создалась');

    const botNames = Object.keys(report.finalMemory);
    assert.ok(botNames.length > 0, 'нет ни одного бота в finalMemory');

    for (const username of botNames) {
        const mem = report.finalMemory[username];
        const hasContent = mem && (mem.rooms || mem.colonies || mem.creeps || Object.keys(mem).length > 0);
        assert.ok(
            hasContent,
            `Memory бота '${username}' пуста после прогона — бот не работал (ошибка загрузки модуля?)`,
        );
    }

    assertNoErrors(report);
}

// ─── Colony progress (RCL) ──────────────────────────────────────────────────

/**
 * Asserts that room RCL ≥ `minRcl`.
 *
 * @param {WorldReport} report
 * @param {string} roomName
 * @param {number} minRcl
 * @returns {void}
 */
function assertRclAtLeast(report, roomName, minRcl) {
    const actual = report.finalRcl[roomName];

    // -- Data validation checks (for debugging) --
    assert.ok(
        actual !== undefined,
        `комната ${roomName} не найдена в отчёте (finalRcl: ${JSON.stringify(report.finalRcl)})`,
    );
    assert.ok(typeof actual === 'number', `комната ${roomName}: RCL не число (${actual})`);
    assert.ok(actual >= 0, `комната ${roomName}: RCL отрицательное (${actual})`);
    assert.ok(Number.isInteger(actual), `комната ${roomName}: RCL не целое (${actual})`);
    assert.ok(Number.isFinite(actual), `комната ${roomName}: RCL не конечное (${actual})`);

    assert.ok(minRcl >= 0, `minRcl должен быть ≥ 0 (получено ${minRcl})`);
    assert.ok(minRcl <= 8, `minRcl должен быть ≤ 8 (получено ${minRcl})`);

    assert.ok(actual <= 8, `комната ${roomName}: RCL ${actual} > 8 (невозможно)`);

    // -- Main check --
    assert.ok(actual >= minRcl, `комната ${roomName}: RCL ${actual} < ожидаемого ${minRcl}`);
}

/**
 * Asserts that room RCL < `maxRcl`.
 *
 * @param {WorldReport} report
 * @param {string} roomName
 * @param {number} maxRcl
 * @returns {void}
 */
function assertRclBelow(report, roomName, maxRcl) {
    const actual = report.finalRcl[roomName] || 0;
    assert.ok(actual < maxRcl, `комната ${roomName}: RCL ${actual} >= ожидаемого ${maxRcl}`);
}

// ─── Structures / objects (destroyed) ───────────────────────────────────────

/**
 * Asserts that object(s) are DESTROYED.
 * Without options — checks that any `EVENT_OBJECT_DESTROYED` occurred.
 *
 * @param {WorldReport} report
 * @param {ObjectFilter} [opts]
 * @param {string} [opts.id]            — specific _id of an object
 * @param {Array<string>} [opts.types]  — types of objects (STRUCTURE_* or TYPE_CREEPS)
 * @returns {void}
 */
function assertObjectDestroyed(report, opts = {}) {
    /** @type {EventLogEntry[]} */
    const destroyed = filterDestroyed(report.events, opts);
    const typesDesc = opts.types ? ` типа "${Array.isArray(opts.types) ? opts.types.join('/') : opts.types}"` : '';
    const idDesc = opts.id ? ` с id ${opts.id}` : '';
    assert.ok(destroyed.length > 0, `объект${typesDesc}${idDesc} НЕ был разрушен (ожидалось разрушение)`);
}

/**
 * Asserts that object(s) were NOT destroyed (symmetric to `assertObjectDestroyed`).
 *
 * @param {WorldReport} report
 * @param {ObjectFilter} [opts]
 * @param {string} [opts.id]            — specific _id of an object
 * @param {Array<string>} [opts.types]  — types of objects (STRUCTURE_* or TYPE_CREEPS)
 * @returns {void}
 */
function assertObjectNoDestroyed(report, opts = {}) {
    /** @type {EventLogEntry[]} */
    const destroyed = filterDestroyed(report.events, opts);
    assert.strictEqual(
        destroyed.length,
        0,
        `объекты разрушены: ${destroyed.map((e) => (e.data && e.data.type) || e.objectId).join(', ')} ` +
            `(${destroyed.length} EVENT_OBJECT_DESTROYED)`,
    );
}

/**
 * Asserts that bot structures are NOT destroyed. Specialised wrapper around
 * `assertObjectNoDestroyed` with a default set of "bot structure" types
 * (spawn, tower, extension, constructedWall, container, storage).
 *
 * @param {WorldReport} report
 * @param {ObjectFilter} [opts]
 * @returns {void}
 */
function assertNoBotObjectDestroyed(report, opts = {}) {
    assertObjectNoDestroyed(report, { types: opts.types || BOT_STRUCTURE_TYPES, id: opts.id });
}

// ─── Combat (attack / damage) ────────────────────────────────────────────────

/**
 * Asserts that the object with the given `_id` initiated `EVENT_ATTACK`.
 *
 * @param {WorldReport} report
 * @param {string} objectId              — _id of the attacking object
 * @returns {void}
 */
function assertObjectAttacking(report, objectId) {
    /** @type {EventLogEntry[]} */
    const attackingEvents = filterByType(report.events, EVENT_ATTACK);
    const attacking = attackingEvents.some((e) => e.objectId === objectId);
    assert.ok(attacking, `объект с id ${objectId} никого не аттаковал`);
}

/**
 * Asserts that the object with the given `_id` did NOT initiate `EVENT_ATTACK`.
 *
 * @param {WorldReport} report
 * @param {string} objectId              — _id of the object
 * @returns {void}
 */
function assertObjectNotAttacking(report, objectId) {
    /** @type {EventLogEntry[]} */
    const attackingEvents = filterByType(report.events, EVENT_ATTACK);
    const attacking = attackingEvents.some((e) => e.objectId === objectId);
    assert.ok(!attacking, `объект с id ${objectId} аттаковал (не ожидалось)`);
}

/**
 * Asserts that the object with the given `_id` received damage (`EVENT_ATTACK`).
 *
 * @param {WorldReport} report
 * @param {string} targetId              — _id of the target object
 * @returns {void}
 */
function assertObjectDamaged(report, targetId) {
    /** @type {EventLogEntry[]} */
    const attacks = filterByType(report.events, EVENT_ATTACK);
    const damaged = attacks.some((e) => e.data && e.data.targetId === targetId);
    assert.ok(damaged, `объект с id ${targetId} НЕ получил урона (EVENT_ATTACK с targetId не найден)`);
}

/**
 * Asserts that the object with the given `_id` did NOT receive damage.
 *
 * @param {WorldReport} report
 * @param {string} targetId              — _id of the target object
 * @returns {void}
 */
function assertObjectNotDamaged(report, targetId) {
    /** @type {EventLogEntry[]} */
    const attacks = filterByType(report.events, EVENT_ATTACK);
    const damaged = attacks.some((e) => e.data && e.data.targetId === targetId);
    assert.ok(!damaged, `объект с id ${targetId} получил урон (не ожидалось)`);
}

// By user id ───────────────────────────

/**
 * Asserts that any of the bot's objects received damage.
 * Useful when the specific `_id` is unknown and just the fact
 * "some bot object was attacked" suffices.
 *
 * @param {WorldReport} report
 * @param {string} botUserName  — Bot username
 * @returns {void}
 */
function assertBotUserDamaged(report, botUserName) {
    /** @type {EventLogEntry[]} */
    const attacks = filterByType(report.events, EVENT_ATTACK);
    const damaged = attacks.some((e) => e.data && e.data.targetId && ownerOf(report, e.data.targetId) === botUserName);
    assert.ok(damaged, `ни один объект пользователя '${botUserName}' НЕ получил урона (EVENT_ATTACK не найден)`);
}

/**
 * Asserts that NONE of the bot's objects received damage.
 *
 * @param {WorldReport} report
 * @param {string} botUserName  — Bot username
 * @returns {void}
 */
function assertBotUserNotDamaged(report, botUserName) {
    /** @type {EventLogEntry[]} */
    const attacks = filterByType(report.events, EVENT_ATTACK);
    const damaged = attacks.filter(
        (e) => e.data && e.data.targetId && ownerOf(report, e.data.targetId) === botUserName,
    );
    assert.strictEqual(
        damaged.length,
        0,
        `объекты пользователя ${botUserName} получили урон (${damaged.length} EVENT_ATTACK)`,
    );
}

/**
 * Asserts that any of the bot's objects dealt damage.
 *
 * @param {WorldReport} report
 * @param {string} botUserName  — Bot username
 * @returns {void}
 */
function assertBotUserAttacking(report, botUserName) {
    /** @type {EventLogEntry[]} */
    const attackingEvents = filterByType(report.events, EVENT_ATTACK);
    const attacking = attackingEvents.some((e) => e && e.objectId && ownerOf(report, e.objectId) === botUserName);
    assert.ok(attacking, `ни один объект пользователя '${botUserName}' НЕ нанес урона (EVENT_ATTACK не найден)`);
}

/**
 * Asserts that none of the bot's objects dealt damage.
 *
 * @param {WorldReport} report
 * @param {string} botUserName  — Bot username
 * @returns {void}
 */
function assertBotUserNotAttacking(report, botUserName) {
    /** @type {EventLogEntry[]} */
    const attackingEvents = filterByType(report.events, EVENT_ATTACK);
    const attacking = attackingEvents.filter((e) => e && e.objectId && ownerOf(report, e.objectId) === botUserName);
    assert.strictEqual(
        attacking.length,
        0,
        `объекты пользователя ${botUserName} нанесли урон (${attacking.length} EVENT_ATTACK)`,
    );
}

module.exports = {
    // Bot health
    assertNoErrors,
    assertBotWorked,
    // Colony progress
    assertRclAtLeast,
    assertRclBelow,
    // Structures / objects
    assertObjectDestroyed,
    assertObjectNoDestroyed,
    assertNoBotObjectDestroyed,
    // -- Combat --
    // By object id
    assertObjectAttacking,
    assertObjectNotAttacking,
    assertObjectDamaged,
    assertObjectNotDamaged,
    // By user id
    assertBotUserDamaged,
    assertBotUserNotDamaged,
    assertBotUserAttacking,
    assertBotUserNotAttacking,
};
