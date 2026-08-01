'use strict';

/**
 * Single source of truth for Screeps game constants.
 *
 * Used simultaneously:
 *  - in `src/lib/builders/spec.js` — for structure types in defaults
 *  - in `src/lib/builders/materialize.js` — for 'spawn' type in spec
 *  - in `src/lib/observers/metrics.js` — for object filters
 *  - in `src/lib/assertions.js` — for `BOT_STRUCTURE_TYPES`
 *
 * Values match `@types/screeps` and what `screeps-server-mockup` sets.
 *
 * **Principle:** to introduce a new constant, add it here
 * in one line and it is automatically picked up by all consumers.
 *
 * @file Common game constants for unit, integration and perf tests
 * @module test/setup/screepsConstants
 */

// ─── FIND_* (object search) ────────────────────────────────────────────────────

/** @type {number} */
const FIND_SOURCES = 105;
/** @type {number} */
const FIND_SOURCES_ACTIVE = 106;
/** @type {number} */
const FIND_STRUCTURES = 107;
/** @type {number} */
const FIND_MY_STRUCTURES = 108;
/** @type {number} */
const FIND_HOSTILE_STRUCTURES = 109;
/** @type {number} */
const FIND_CONSTRUCTION_SITES = 110;
/** @type {number} */
const FIND_MY_SPAWNS = 111;
/** @type {number} */
const FIND_HOSTILE_CREEPS = 112;
/** @type {number} */
const FIND_CREEPS = 113;
/** @type {number} */
const FIND_MY_CREEPS = 114;
/** @type {number} */
const FIND_DROPPED_RESOURCES = 116;
/** @type {number} */
const FIND_MINERALS = 117;
/** @type {number} */
const FIND_TOMBSTONES = 119;
/** @type {number} */
const FIND_RUINS = 120;
/** @type {number} */
const FIND_HOSTILE_POWER_CREEPS = 122;

// ─── STRUCTURE_* ───────────────────────────────────────────────────────────

/** @type {string} */
const STRUCTURE_SPAWN = 'spawn';
/** @type {string} */
const STRUCTURE_EXTENSION = 'extension';
/** @type {string} */
const STRUCTURE_CONTAINER = 'container';
/** @type {string} */
const STRUCTURE_STORAGE = 'storage';
/** @type {string} */
const STRUCTURE_TOWER = 'tower';
/** @type {string} */
const STRUCTURE_ROAD = 'road';
/** @type {string} */
const STRUCTURE_WALL = 'constructedWall';
/** @type {string} */
const STRUCTURE_RAMPART = 'rampart';
/** @type {string} */
const STRUCTURE_LINK = 'link';
/** @type {string} */
const STRUCTURE_TERMINAL = 'terminal';
/** @type {string} */
const STRUCTURE_CONTROLLER = 'controller';
/** @type {string} */
const STRUCTURE_OBSERVER = 'observer';
/** @type {string} */
const STRUCTURE_POWER_SPAWN = 'powerSpawn';
/** @type {string} */
const STRUCTURE_EXTRACTOR = 'extractor';
/** @type {string} */
const STRUCTURE_LAB = 'lab';
/** @type {string} */
const STRUCTURE_NUKER = 'nuker';
/** @type {string} */
const STRUCTURE_FACTORY = 'factory';
/** @type {string} */
const STRUCTURE_INVADER_CORE = 'invaderCore';
/** @type {string} */
const STRUCTURE_POWER_BANK = 'powerBank';
/** @type {string} */
const STRUCTURE_PORTAL = 'portal';
/** @type {string} */
const STRUCTURE_KEEPER_LAIR = 'keeperLair';
/** @type {string} */
const STRUCTURE_CONSTRUCTION_SITE = 'constructionSite';

/** @type {string[]} */
const BOT_STRUCTURE_TYPES = [
    STRUCTURE_SPAWN,
    STRUCTURE_TOWER,
    STRUCTURE_EXTENSION,
    STRUCTURE_WALL,
    STRUCTURE_CONTAINER,
    STRUCTURE_STORAGE,
    STRUCTURE_LINK,
    STRUCTURE_TERMINAL,
    STRUCTURE_OBSERVER,
    STRUCTURE_POWER_SPAWN,
    STRUCTURE_EXTRACTOR,
    STRUCTURE_LAB,
    STRUCTURE_NUKER,
    STRUCTURE_FACTORY,
];

// ─── RESOURCE_* ─────────────────────────────────────────────────────────────

/** @type {string} */
const RESOURCE_ENERGY = 'energy';
/** @type {string} */
const RESOURCE_POWER = 'power';

// ─── Body parts ─────────────────────────────────────────────────────────────

/** @type {string} */
const WORK = 'work';
/** @type {string} */
const CARRY = 'carry';
/** @type {string} */
const MOVE = 'move';
/** @type {string} */
const ATTACK = 'attack';
/** @type {string} */
const RANGED_ATTACK = 'rangedAttack';
/** @type {string} */
const HEAL = 'heal';
/** @type {string} */
const TOUGH = 'tough';
/** @type {string} */
const CLAIM = 'claim';

// ─── Error codes ────────────────────────────────────────────────────────────

/** @type {number} */
const OK = 0;
/** @type {number} */
const ERR_NOT_OWNER = -1;
/** @type {number} */
const ERR_NO_PATH = -2;
/** @type {number} */
const ERR_NAME_EXISTS = -3;
/** @type {number} */
const ERR_BUSY = -4;
/** @type {number} */
const ERR_NOT_FOUND = -5;
/** @type {number} */
const ERR_NOT_ENOUGH_RESOURCES = -6;
/** @type {number} */
const ERR_INVALID_TARGET = -7;
/** @type {number} */
const ERR_FULL = -8;
/** @type {number} */
const ERR_NOT_IN_RANGE = -9;
/** @type {number} */
const ERR_INVALID_ARGS = -10;
/** @type {number} */
const ERR_TIRED = -11;
/** @type {number} */
const ERR_NO_BODYPART = -12;
/** @type {number} */
const ERR_RCL_NOT_ENOUGH = -14;
/** @type {number} */
const ERR_GCL_NOT_ENOUGH = -15;

// ─── LOOK_* ─────────────────────────────────────────────────────────────────

/** @type {string} */
const LOOK_STRUCTURES = 'structure';
/** @type {string} */
const LOOK_CREEPS = 'creep';
/** @type {string} */
const LOOK_TERRAIN = 'terrain';
/** @type {string} */
const LOOK_CONSTRUCTION_SITES = 'constructionSite';
/** @type {string} */
const LOOK_RESOURCES = 'resource';
/** @type {string} */
const LOOK_ENERGY = 'energy';
/** @type {string} */
const LOOK_TOMBSTONES = 'tombstone';
/** @type {string} */
const LOOK_POWER_CREEPS = 'powerCreep';
/** @type {string} */
const LOOK_RUINS = 'ruin';

// ─── TERRAIN_MASK_* ─────────────────────────────────────────────────────────

/** @type {number} */
const TERRAIN_MASK_WALL = 1;
/** @type {number} */
const TERRAIN_MASK_SWAMP = 2;
/** @type {number} */
const TERRAIN_MASK_LAVA = 4;

// ─── Framework-specific constants ──────────────────────────────────────────────

/** @type {string} */
const INVADER_USER_ID = '2';
/** @type {string} */
const SOURCE_KEEPER_USER_ID = '3';

// ─── Type names (used as object type in `rooms.objects`) ───────────────────────

/** @type {string} */
const TYPE_CREEPS = 'creep';
/** @type {string} */
const TYPE_POWER_CREEPS = 'powerCreep';

// ─── Object export ──────────────────────────────────────────────────────────

module.exports = {
    // FIND
    FIND_SOURCES,
    FIND_SOURCES_ACTIVE,
    FIND_STRUCTURES,
    FIND_MY_STRUCTURES,
    FIND_HOSTILE_STRUCTURES,
    FIND_CONSTRUCTION_SITES,
    FIND_MY_SPAWNS,
    FIND_HOSTILE_CREEPS,
    FIND_CREEPS,
    FIND_MY_CREEPS,
    FIND_DROPPED_RESOURCES,
    FIND_MINERALS,
    FIND_TOMBSTONES,
    FIND_RUINS,
    FIND_HOSTILE_POWER_CREEPS,

    // STRUCTURE
    STRUCTURE_SPAWN,
    STRUCTURE_EXTENSION,
    STRUCTURE_CONTAINER,
    STRUCTURE_STORAGE,
    STRUCTURE_TOWER,
    STRUCTURE_ROAD,
    STRUCTURE_WALL,
    STRUCTURE_RAMPART,
    STRUCTURE_LINK,
    STRUCTURE_TERMINAL,
    STRUCTURE_CONTROLLER,
    STRUCTURE_OBSERVER,
    STRUCTURE_POWER_SPAWN,
    STRUCTURE_EXTRACTOR,
    STRUCTURE_LAB,
    STRUCTURE_NUKER,
    STRUCTURE_FACTORY,
    STRUCTURE_INVADER_CORE,
    STRUCTURE_POWER_BANK,
    STRUCTURE_PORTAL,
    STRUCTURE_KEEPER_LAIR,
    STRUCTURE_CONSTRUCTION_SITE,
    BOT_STRUCTURE_TYPES,

    // RESOURCE
    RESOURCE_ENERGY,
    RESOURCE_POWER,

    // Body parts
    WORK,
    CARRY,
    MOVE,
    ATTACK,
    RANGED_ATTACK,
    HEAL,
    TOUGH,
    CLAIM,

    // Framework-specific
    INVADER_USER_ID,
    SOURCE_KEEPER_USER_ID,

    // Type names (for type === ... in filters)
    TYPE_CREEPS,
    TYPE_POWER_CREEPS,

    // Error codes
    OK,
    ERR_NOT_OWNER,
    ERR_NO_PATH,
    ERR_NAME_EXISTS,
    ERR_BUSY,
    ERR_NOT_FOUND,
    ERR_NOT_ENOUGH_RESOURCES,
    ERR_INVALID_TARGET,
    ERR_FULL,
    ERR_NOT_IN_RANGE,
    ERR_INVALID_ARGS,
    ERR_TIRED,
    ERR_NO_BODYPART,
    ERR_RCL_NOT_ENOUGH,
    ERR_GCL_NOT_ENOUGH,

    // LOOK
    LOOK_STRUCTURES,
    LOOK_CREEPS,
    LOOK_TERRAIN,
    LOOK_CONSTRUCTION_SITES,
    LOOK_RESOURCES,
    LOOK_ENERGY,
    LOOK_TOMBSTONES,
    LOOK_POWER_CREEPS,
    LOOK_RUINS,

    // TERRAIN_MASK
    TERRAIN_MASK_WALL,
    TERRAIN_MASK_SWAMP,
    TERRAIN_MASK_LAVA,
};
