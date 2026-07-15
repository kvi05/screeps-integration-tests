'use strict';

const assert = require('node:assert');
const { EVENT_ATTACK, filterByType, filterDestroyed } = require('./observers/eventLog');

const { BOT_STRUCTURE_TYPES } = require('../constants/screepsConstants');

/**
 * @typedef {import('./types').WorldReport} WorldReport
 * @typedef {import('./types').EventLogEntry} EventLogEntry
 *
 * @typedef {Object} ObjectFilter
 * @property {string|string[]} [types]     — тип(ы) объекта (STRUCTURE_* или TYPE_CREEPS)
 * @property {string} [id]                 — конкретный _id объекта
 */

/**
 * Возвращает user-владельца объекта по его `_id` (из `report.objectOwners`,
 * накопленного снимками `rooms.objects` — см. observers/ownership.js).
 *
 * @param {WorldReport} report
 * @param {string} objectId
 * @returns {string|undefined}
 */
function ownerOf(report, objectId) {
    return report.objectOwners && report.objectOwners[objectId];
}

// ─── Жизнеспособность бота ──────────────────────────────────────────────────

/**
 * Проверяет, что нет ошибок в логах бота.
 *
 * @param {WorldReport} report
 * @returns {void}
 */
function assertNoErrors(report) {
    assert.strictEqual(report.errors.length, 0, `найдены ошибки:\n${report.errors.join('\n')}`);
}

/**
 * Основная проверка, что бот реально работал: Memory не пуста после прогона.
 *
 * Ловит ошибки загрузки модулей (ReferenceError, SyntaxError и т.п.),
 * которые engine перехватывает молча — они не попадают в console.
 * Если Memory пуста — значит `loop()` не отработал нормально.
 *
 * Проверяет что ВСЕ боты работали (Memory каждого бота непуста).
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

// ─── Прогресс колонии (RCL) ─────────────────────────────────────────────────

/**
 * Проверяет, что RCL комнаты ≥ `minRcl`.
 *
 * @param {WorldReport} report
 * @param {string} roomName
 * @param {number} minRcl
 * @returns {void}
 */
function assertRclAtLeast(report, roomName, minRcl) {
    const actual = report.finalRcl[roomName];

    // -- Проверки на корректность данных (для отладки) --
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

    // -- Основная проверка --
    assert.ok(actual >= minRcl, `комната ${roomName}: RCL ${actual} < ожидаемого ${minRcl}`);
}

/**
 * Проверяет, что RCL комнаты < `maxRcl`.
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

// ─── Здания / объекты (destroyed) ───────────────────────────────────────────

/**
 * Проверяет, что объект(ы) РАЗРУШЕН.
 * Без опций — проверяет, что произошло любое `EVENT_OBJECT_DESTROYED`.
 *
 * @param {WorldReport} report
 * @param {ObjectFilter} [opts]
 * @param {string} [opts.id]            - конкретный _id объекта
 * @param {Array<string>} [opts.types]  - типы объектов (STRUCTURE_* или TYPE_CREEPS)
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
 * Проверяет, что объект(ы) НЕ разрушены (симметрична `assertObjectDestroyed`).
 *
 * @param {WorldReport} report
 * @param {ObjectFilter} [opts]
 * @param {string} [opts.id]            - конкретный _id объекта
 * @param {Array<string>} [opts.types]  - типы объектов (STRUCTURE_* или TYPE_CREEPS)
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
 * Проверяет, что здания бота НЕ разрушены. Специализированная обёртка над
 * `assertObjectNoDestroyed` с дефолтным набором типов "здания бота"
 * (spawn, tower, extension, constructedWall, container, storage).
 *
 * @param {WorldReport} report
 * @param {ObjectFilter} [opts]
 * @returns {void}
 */
function assertNoBotObjectDestroyed(report, opts = {}) {
    assertObjectNoDestroyed(report, { types: opts.types || BOT_STRUCTURE_TYPES, id: opts.id });
}

// ─── Бой (атака / урон) ─────────────────────────────────────────────────────

/**
 * Проверяет, что объект с указанным `_id` инициировал `EVENT_ATTACK`.
 *
 * @param {WorldReport} report
 * @param {string} objectId              — _id атакующего объекта
 * @returns {void}
 */
function assertObjectAttacking(report, objectId) {
    /** @type {EventLogEntry[]} */
    const attackingEvents = filterByType(report.events, EVENT_ATTACK);
    const attacking = attackingEvents.some((e) => e.objectId === objectId);
    assert.ok(attacking, `объект с id ${objectId} никого не аттаковал`);
}

/**
 * Проверяет, что объект с указанным `_id` НЕ инициировал `EVENT_ATTACK`.
 *
 * @param {WorldReport} report
 * @param {string} objectId              — _id объекта
 * @returns {void}
 */
function assertObjectNotAttacking(report, objectId) {
    /** @type {EventLogEntry[]} */
    const attackingEvents = filterByType(report.events, EVENT_ATTACK);
    const attacking = attackingEvents.some((e) => e.objectId === objectId);
    assert.ok(!attacking, `объект с id ${objectId} аттаковал (не ожидалось)`);
}

/**
 * Проверяет, что объект с указанным `_id` получил урон (`EVENT_ATTACK`).
 *
 * @param {WorldReport} report
 * @param {string} targetId              — _id объекта-цели
 * @returns {void}
 */
function assertObjectDamaged(report, targetId) {
    /** @type {EventLogEntry[]} */
    const attacks = filterByType(report.events, EVENT_ATTACK);
    const damaged = attacks.some((e) => e.data && e.data.targetId === targetId);
    assert.ok(damaged, `объект с id ${targetId} НЕ получил урона (EVENT_ATTACK с targetId не найден)`);
}

/**
 * Проверяет, что объект с указанным `_id` НЕ ПОЛУЧИЛ урон.
 *
 * @param {WorldReport} report
 * @param {string} targetId              — _id объекта-цели
 * @returns {void}
 */
function assertObjectNotDamaged(report, targetId) {
    /** @type {EventLogEntry[]} */
    const attacks = filterByType(report.events, EVENT_ATTACK);
    const damaged = attacks.some((e) => e.data && e.data.targetId === targetId);
    assert.ok(!damaged, `объект с id ${targetId} получил урон (не ожидалось)`);
}

// По id user ────────────────────────────

/**
 * Проверяет, что объект (любой), принадлежащий боту, ПОЛУЧИЛ урон.
 * Удобно, когда известен не конкретный `_id`, а достаточно факта
 * "какой-то объект бота атакован".
 *
 * @param {WorldReport} report
 * @param {string} botUserName  - Имя бота
 * @returns {void}
 */
function assertBotUserDamaged(report, botUserName) {
    /** @type {EventLogEntry[]} */
    const attacks = filterByType(report.events, EVENT_ATTACK);
    const damaged = attacks.some((e) => e.data && e.data.targetId && ownerOf(report, e.data.targetId) === botUserName);
    assert.ok(damaged, `ни один объект пользователя '${botUserName}' НЕ получил урона (EVENT_ATTACK не найден)`);
}

/**
 * Проверяет, что НИ ОДИН объект бота не ПОЛУЧИЛ урон.
 *
 * @param {WorldReport} report
 * @param {string} botUserName  - Имя бота
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
 * Проверяет, что объект (любой), принадлежащий боту, НАНЕС урон.
 *
 * @param {WorldReport} report
 * @param {string} botUserName  - Имя бота
 * @returns {void}
 */
function assertBotUserAttacking(report, botUserName) {
    /** @type {EventLogEntry[]} */
    const attackingEvents = filterByType(report.events, EVENT_ATTACK);
    const attacking = attackingEvents.some((e) => e && e.objectId && ownerOf(report, e.objectId) === botUserName);
    assert.ok(attacking, `ни один объект пользователя '${botUserName}' НЕ нанес урона (EVENT_ATTACK не найден)`);
}

/**
 * Проверяет, что объект (любой), принадлежащий боту, НЕ НАНЕС урон.
 *
 * @param {WorldReport} report
 * @param {string} botUserName  - Имя бота
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
    // Жизнеспособность бота
    assertNoErrors,
    assertBotWorked,
    // Прогресс колонии
    assertRclAtLeast,
    assertRclBelow,
    // Здания / объекты
    assertObjectDestroyed,
    assertObjectNoDestroyed,
    assertNoBotObjectDestroyed,
    // -- Бой --
    // По id объекта
    assertObjectAttacking,
    assertObjectNotAttacking,
    assertObjectDamaged,
    assertObjectNotDamaged,
    // По id user
    assertBotUserDamaged,
    assertBotUserNotDamaged,
    assertBotUserAttacking,
    assertBotUserNotAttacking,
};
