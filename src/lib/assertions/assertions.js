'use strict';

/**
 * Assertion helpers for bot behaviour: RCL, errors, and event-log checks.
 */

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
    assert.strictEqual(report.errors.length, 0, `errors found:\n${report.errors.join('\n')}`);
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
    assert.ok(report.ticksRun > 0, 'bot did not make a single tick');
    assert.ok(report.finalMemory, 'Memory was not created');

    const botNames = Object.keys(report.finalMemory);
    assert.ok(botNames.length > 0, 'no bots in finalMemory');

    for (const username of botNames) {
        const mem = report.finalMemory[username];
        const hasContent = mem && (mem.rooms || mem.colonies || mem.creeps || Object.keys(mem).length > 0);
        assert.ok(hasContent, `bot '${username}' Memory is empty after run — bot did not work (module load error?)`);
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
        `room ${roomName} not found in report (finalRcl: ${JSON.stringify(report.finalRcl)})`,
    );
    assert.ok(typeof actual === 'number', `room ${roomName}: RCL is not a number (${actual})`);
    assert.ok(actual >= 0, `room ${roomName}: RCL is negative (${actual})`);
    assert.ok(Number.isInteger(actual), `room ${roomName}: RCL is not an integer (${actual})`);
    assert.ok(Number.isFinite(actual), `room ${roomName}: RCL is not finite (${actual})`);

    assert.ok(minRcl >= 0, `minRcl must be ≥ 0 (got ${minRcl})`);
    assert.ok(minRcl <= 8, `minRcl must be ≤ 8 (got ${minRcl})`);

    assert.ok(actual <= 8, `room ${roomName}: RCL ${actual} > 8 (impossible)`);

    // -- Main check --
    assert.ok(actual >= minRcl, `room ${roomName}: RCL ${actual} < expected ${minRcl}`);
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
    assert.ok(actual < maxRcl, `room ${roomName}: RCL ${actual} >= expected ${maxRcl}`);
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
    const typesDesc = opts.types ? ` of type "${Array.isArray(opts.types) ? opts.types.join('/') : opts.types}"` : '';
    const idDesc = opts.id ? ` with id ${opts.id}` : '';
    assert.ok(destroyed.length > 0, `object${typesDesc}${idDesc} was NOT destroyed (destruction expected)`);
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
function assertObjectNotDestroyed(report, opts = {}) {
    /** @type {EventLogEntry[]} */
    const destroyed = filterDestroyed(report.events, opts);
    assert.strictEqual(
        destroyed.length,
        0,
        `objects destroyed: ${destroyed.map((e) => (e.data && e.data.type) || e.objectId).join(', ')} ` +
            `(${destroyed.length} EVENT_OBJECT_DESTROYED)`,
    );
}

/**
 * Asserts that bot structures are NOT destroyed. Specialised wrapper around
 * `assertObjectNotDestroyed` with a default set of "bot structure" types
 * (spawn, tower, extension, constructedWall, container, storage).
 *
 * @param {WorldReport} report
 * @param {ObjectFilter} [opts]
 * @returns {void}
 */
function assertNoBotObjectDestroyed(report, opts = {}) {
    assertObjectNotDestroyed(report, { types: opts.types || BOT_STRUCTURE_TYPES, id: opts.id });
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
    assert.ok(attacking, `object with id ${objectId} did not attack anyone`);
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
    assert.ok(!attacking, `object with id ${objectId} attacked (not expected)`);
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
    assert.ok(damaged, `object with id ${targetId} did NOT receive damage (EVENT_ATTACK with targetId not found)`);
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
    assert.ok(!damaged, `object with id ${targetId} received damage (not expected)`);
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
    assert.ok(damaged, `no objects of user '${botUserName}' received damage (EVENT_ATTACK not found)`);
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
        `objects of user ${botUserName} received damage (${damaged.length} EVENT_ATTACK)`,
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
    assert.ok(attacking, `no objects of user '${botUserName}' dealt damage (EVENT_ATTACK not found)`);
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
        `objects of user ${botUserName} dealt damage (${attacking.length} EVENT_ATTACK)`,
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
    assertObjectNotDestroyed,
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
