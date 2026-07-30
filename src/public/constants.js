'use strict';

/**
 * @file Re-export of all Screeps game constants.
 *
 * Responsibility:
 *   Makes the full set of Screeps constants available to test scenarios
 *   so users can reference structure types, body parts, error codes,
 *   FIND and LOOK constants, resource types, and framework-specific
 *   constants (`INVADER_USER_ID`, `TYPE_CREEPS`, `BOT_STRUCTURE_TYPES`).
 *
 * **Available constants by category:**
 * - `STRUCTURE_*` — structure type strings
 * - `WORK`, `MOVE`, `CARRY`, `ATTACK`, `RANGED_ATTACK`, `HEAL`, `TOUGH`, `CLAIM` — body parts
 * - `OK`, `ERR_NOT_OWNER`, `ERR_*` — error codes
 * - `FIND_*` — object search constants
 * - `LOOK_*` — look constants
 * - `RESOURCE_ENERGY`, `RESOURCE_POWER` — resource types
 * - `INVADER_USER_ID` — Screeps invader user ID (`'2'`)
 * - `SOURCE_KEEPER_USER_ID` — Source Keeper user ID (`'3'`)
 * - `TYPE_CREEPS` — `'creep'` (used in filters)
 * - `BOT_STRUCTURE_TYPES` — framework array of bot-owned structure types
 * - `TERRAIN_MASK_WALL`, `TERRAIN_MASK_SWAMP`, `TERRAIN_MASK_LAVA`
 *
 * @example
 * const { STRUCTURE_RAMPART, WORK, MOVE, OK } = require('screeps-integration-tests/constants');
 * const { spec } = require('screeps-integration-tests');
 *
 * const rampart = spec.structure(STRUCTURE_RAMPART, 25, 25, { roomName: 'W0N1' });
 * const body = [WORK, MOVE, CARRY, MOVE];
 *
 * @module screeps-integration-tests/constants
 */

const {
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
} = require('../constants/screepsConstants');

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
