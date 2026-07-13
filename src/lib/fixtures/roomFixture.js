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

const spec = require('../builders/spec');

/**
 * @typedef {import('../types').RoomFixtureSpec} RoomFixtureSpec
 * @typedef {import('../types').RoomOverrides} RoomOverrides
 */

// ─── RCL3 Stable Room ───────────────────────────────────────────────────────

/**
 * RCL3 базовая комната: tower, 10 extensions, container, дороги, 2 source.
 *
 * Используется defense-сценариями.
 *
 * IDs привязаны к rcl3-stable.memory.json — при смене fixture пересоберите memory fixture.
 *
 * @type {RoomFixtureSpec}
 */
const RCL3_STABLE_ROOM = {
    name: 'rcl3-stable',
    description: 'RCL3 базовая комната: tower, 10 extensions, container, 2 sources, дороги',

    controller: spec.controller({
        id: '0dcfa44a5b9e0e0',
        level: 3,
        progress: 2146,
        safeMode: 0,
        safeModeAvailable: 0,
        isPowerEnabled: false,
    }),

    sources: [
        spec.source(15, 15, { id: '94e8a44a5fa6113', energy: 2232, energyCapacity: 3000, ticksToRegeneration: 108 }),
        spec.source(35, 35, { id: '4361a44a5fa1c06', energy: 872, energyCapacity: 3000, ticksToRegeneration: 47 }),
    ],

    structures: [
        // Spawn (требуется для spawning и claimcontroller defence)
        spec.spawn(25, 25, { id: 'spawn_main_1', energy: 300 }),

        // Tower
        spec.tower(26, 24, { id: '9a73a4971e07bb4', energy: 1000, energyCapacity: 1000 }),

        // 10 extensions
        spec.extension(27, 24, { id: '53fca45601fe9dd', energy: 50 }),
        spec.extension(27, 25, { id: '5e44a458d227534', energy: 50 }),
        spec.extension(28, 25, { id: '51f0a45cffed46c', energy: 50 }),
        spec.extension(29, 26, { id: 'b5dda4623ec7a6c', energy: 50 }),
        spec.extension(29, 27, { id: 'c663a466cf22c10', energy: 50 }),
        spec.extension(28, 28, { id: '8951a46c186c086', energy: 50 }),
        spec.extension(27, 27, { id: '59c7a47160c4513', energy: 50 }),
        spec.extension(27, 29, { id: 'e836a475d43c500', energy: 50 }),
        spec.extension(26, 29, { id: '7d45a47d29b176a', energy: 50 }),
        spec.extension(26, 28, { id: 'd865a48247ad5d5', energy: 50 }),

        // Container (anchor position)
        spec.container(23, 24, { id: '71faa48c085e889', energy: 1500, storeCapacity: 2000 }),

        // Roads (main paths from sources to anchor)
        spec.road(24, 24),
        spec.road(25, 24),
        spec.road(15, 15),
        spec.road(16, 15),
        spec.road(17, 15),
        spec.road(18, 15),
        spec.road(19, 15),
        spec.road(20, 15),
        spec.road(21, 15),
        spec.road(22, 15),
        spec.road(23, 15),
        spec.road(23, 16),
        spec.road(23, 17),
        spec.road(23, 18),
        spec.road(23, 19),
        spec.road(23, 20),
        spec.road(23, 21),
        spec.road(23, 22),
        spec.road(23, 23),
        spec.road(35, 35),
        spec.road(34, 35),
        spec.road(33, 35),
        spec.road(32, 35),
        spec.road(31, 35),
        spec.road(30, 35),
        spec.road(29, 35),
        spec.road(28, 35),
        spec.road(27, 35),
        spec.road(26, 35),
        spec.road(25, 35),
        spec.road(24, 35),
        spec.road(23, 35),
        spec.road(23, 34),
        spec.road(23, 33),
        spec.road(23, 32),
        spec.road(23, 31),
        spec.road(23, 30),
        spec.road(23, 29),
        spec.road(23, 28),
        spec.road(23, 27),
        spec.road(23, 26),
        spec.road(23, 25),
    ],

    creeps: [],
};

// ─── Registry ───────────────────────────────────────────────────────────────

/** @type {Object<string,RoomFixtureSpec>} */
const ROOM_FIXTURES = {
    'rcl3-stable': RCL3_STABLE_ROOM,
};

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
                if (override.type && s.type === override.type && override.x === s.x && override.y === s.y) {
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

module.exports = {
    RCL3_STABLE_ROOM,
    ROOM_FIXTURES,
    getRoomFixture,
    hasRoomFixture,
    loadRoomFixture,
    applyRoomOverrides,
};
