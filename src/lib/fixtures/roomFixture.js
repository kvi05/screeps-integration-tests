'use strict';

/**
 * Room fixtures — семантические описания готовых комнат.
 *
 * Название выбрано осознанно: в Screeps colony бота может занимать несколько
 * комнат (main + reserve). Наша fixture описывает именно КОМНАТУ (controller,
 * sources, structures, creeps) — не колонию. Имя "roomFixture" точнее.
 *
 * @module fixtures/roomFixture
 */

const fs = require('fs');
const path = require('path');
const spec = require('../builders/spec');

/**
 * @typedef {import('../types').RoomFixtureSpec} RoomFixtureSpec
 * @typedef {import('../types').RoomOverrides} RoomOverrides
 */

// ─── Registry ───────────────────────────────────────────────────────────────

/** @type {Object<string,RoomFixtureSpec>} */
const ROOM_FIXTURES = {};

// ─── API ────────────────────────────────────────────────────────────────────

/**
 * Получить room fixture по имени.
 * @param {string} name
 * @returns {RoomFixtureSpec|null}
 */
function getRoomFixture(name) {
    return ROOM_FIXTURES[name] || null;
}

/**
 * Проверить существует ли room fixture.
 * @param {string} name
 * @returns {boolean}
 */
function hasRoomFixture(name) {
    return name in ROOM_FIXTURES;
}

/**
 * Загрузить room fixture.
 *
 * @param {string} name — имя fixture ('rcl3-stable')
 * @returns {{ fixture: RoomFixtureSpec }|null}
 */
function loadRoomFixture(name) {
    const fixture = getRoomFixture(name);
    if (!fixture) {
        return null;
    }

    return { fixture };
}

/**
 * Применить overrides к room fixture.
 * Возвращает новый объект, не мутирует оригинал.
 *
 * @param {RoomFixtureSpec} fixture
 * @param {RoomOverrides} [overrides]
 * @returns {RoomFixtureSpec}
 */
function applyRoomOverrides(fixture, overrides = {}) {
    if (!overrides || Object.keys(overrides).length === 0) {
        return {
            ...fixture,
            structures: [...(fixture.structures || [])],
            creeps: [...(fixture.creeps || [])],
        };
    }

    const result = {
        ...fixture,
        controller: overrides.controller ? { ...fixture.controller, ...overrides.controller } : fixture.controller,
        structures: [...(fixture.structures || [])],
        creeps: [...(fixture.creeps || [])],
    };

    // exclude
    if (overrides.exclude && overrides.exclude.length > 0) {
        result.structures = result.structures.filter((s) => {
            return !overrides.exclude.some((ex) => {
                if (typeof ex === 'string') {
                    return s.id === ex || s.type === ex;
                }
                if (ex.id) {
                    return s.id === ex.id;
                }
                if (ex.type) {
                    return s.type === ex.type;
                }
                return false;
            });
        });
    }

    // overrides.structures — переопределение полей существующих структур
    if (overrides.structures && overrides.structures.length > 0) {
        for (const override of overrides.structures) {
            const idx = result.structures.findIndex((s) => {
                if (override.id && s.id === override.id) {
                    return true;
                }
                if (override.type && override.type === s.type && override.x === s.x && override.y === s.y) {
                    return true;
                }
                return false;
            });
            if (idx >= 0) {
                result.structures[idx] = { ...result.structures[idx], ...override };
            }
        }
    }

    // append
    if (overrides.append && overrides.append.length > 0) {
        result.structures.push(...overrides.append);
    }

    // creeps
    if (overrides.creeps && overrides.creeps.length > 0) {
        result.creeps = [...(fixture.creeps || []), ...overrides.creeps];
    }

    // hostiles
    if (overrides.hostiles && overrides.hostiles.length > 0) {
        result.hostiles = [...(fixture.hostiles || []), ...overrides.hostiles];
    }

    return result;
}

/**
 * Регистрирует пользовательский room fixture.
 *
 * @param {string} name
 * @param {RoomFixtureSpec} fixture
 */
function registerRoomFixture(name, fixture) {
    ROOM_FIXTURES[name] = fixture;
}

/**
 * Автозагрузка room fixtures из SIT_ROOM_FIXTURES_DIR.
 * Каждый *.room.js файл должен через side-effect вызвать registerRoomFixture
 * либо экспортировать { name, fixture }.
 *
 * @param {string} dir
 */
function loadRoomFixturesFromDir(dir) {
    if (!fs.existsSync(dir)) {
        return;
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.room.js'));
    for (const file of files) {
        const filePath = path.join(dir, file);
        delete require.cache[require.resolve(filePath)];
        const mod = require(filePath);
        if (mod && mod.name && mod.fixture) {
            registerRoomFixture(mod.name, mod.fixture);
        }
    }
}

module.exports = {
    ROOM_FIXTURES,
    getRoomFixture,
    hasRoomFixture,
    loadRoomFixture,
    applyRoomOverrides,
    registerRoomFixture,
    loadRoomFixturesFromDir,
};
