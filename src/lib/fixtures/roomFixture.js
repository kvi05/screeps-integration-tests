'use strict';

/**
 * Room fixtures — semantic descriptions of prebuilt rooms.
 *
 * Name chosen deliberately: in Screeps, a bot's colony can span multiple
 * rooms (main + reserve). Our fixture describes exactly a ROOM (controller,
 * sources, structures, creeps) — not a colony. The name "roomFixture" is more precise.
 *
 * @module fixtures/roomFixture
 */

const fs = require('fs');
const path = require('path');

/**
 * @typedef {import('../types').RoomFixtureSpec} RoomFixtureSpec
 * @typedef {import('../types').RoomOverrides} RoomOverrides
 */

// ─── Registry ───────────────────────────────────────────────────────────────

/** @type {Object<string,RoomFixtureSpec>} */
const ROOM_FIXTURES = {};

// ─── API ────────────────────────────────────────────────────────────────────

/**
 * Get a room fixture by name.
 * @param {string} name
 * @returns {RoomFixtureSpec|null}
 */
function getRoomFixture(name) {
    return ROOM_FIXTURES[name] || null;
}

/**
 * Check if a room fixture exists.
 * @param {string} name
 * @returns {boolean}
 */
function hasRoomFixture(name) {
    return name in ROOM_FIXTURES;
}

/**
 * Load a room fixture.
 *
 * @param {string} name — fixture name ('rcl3-stable')
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
 * Apply overrides to a room fixture.
 * Returns a new object, doesn't mutate the original.
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
            terrain: fixture.terrain ? { ...fixture.terrain } : undefined,
        };
    }

    const result = {
        ...fixture,
        controller: overrides.controller ? { ...fixture.controller, ...overrides.controller } : fixture.controller,
        structures: [...(fixture.structures || [])],
        creeps: [...(fixture.creeps || [])],
        terrain: fixture.terrain ? { ...fixture.terrain } : undefined,
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

    // overrides.structures — override fields of existing structures
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

    // terrain — overrides replace fixture terrain
    if (overrides.terrain !== undefined) {
        result.terrain = overrides.terrain;
    }

    return result;
}

/**
 * Registers a custom room fixture.
 *
 * @param {string} name
 * @param {RoomFixtureSpec} fixture
 */
function registerRoomFixture(name, fixture) {
    ROOM_FIXTURES[name] = fixture;
}

/**
 * Removes a room fixture from the registry.
 *
 * Safe to call with a non-existent name — no error, silent no-op.
 * Main use case: cleanup in scenarios that register fixtures inline
 * (worker isolation makes this optional; see I2 in review notes).
 *
 * @param {string} name
 * @returns {boolean} — true if the fixture existed and was removed
 */
function unregisterRoomFixture(name) {
    if (name in ROOM_FIXTURES) {
        delete ROOM_FIXTURES[name];
        return true;
    }
    return false;
}

/**
 * Auto-load room fixtures from SIT_ROOM_FIXTURES_DIR.
 * Each *.room.js file must either call registerRoomFixture as a side-effect
 * or export { name, fixture }.
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
    unregisterRoomFixture,
    loadRoomFixturesFromDir,
};
