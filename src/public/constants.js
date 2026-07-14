'use strict';

/**
 * @file Re-export of Screeps structure type constants.
 *
 * Responsibility:
 *   Makes `STRUCTURE_*` constants available so users can use the generic
 *   `spec.structure(type, x, y, ...)` builder for structure types that do not
 *   have a dedicated helper yet (for example `STRUCTURE_RAMPART`).
 *
 * **Available constants:**
 * - `STRUCTURE_SPAWN`
 * - `STRUCTURE_EXTENSION`
 * - `STRUCTURE_CONTAINER`
 * - `STRUCTURE_STORAGE`
 * - `STRUCTURE_TOWER`
 * - `STRUCTURE_ROAD`
 * - `STRUCTURE_WALL`
 * - `STRUCTURE_RAMPART`
 * - `STRUCTURE_CONTROLLER`
 *
 * @example
 * const { STRUCTURE_RAMPART } = require('screeps-integration-tests/constants');
 * const { spec } = require('screeps-integration-tests');
 *
 * const rampart = spec.structure(STRUCTURE_RAMPART, 25, 25, { roomName: 'W0N1' });
 *
 * @module screeps-integration-tests/constants
 */

const {
    STRUCTURE_SPAWN,
    STRUCTURE_EXTENSION,
    STRUCTURE_CONTAINER,
    STRUCTURE_STORAGE,
    STRUCTURE_TOWER,
    STRUCTURE_ROAD,
    STRUCTURE_WALL,
    STRUCTURE_RAMPART,
    STRUCTURE_CONTROLLER,
} = require('../constants/screepsConstants');

module.exports = {
    STRUCTURE_SPAWN,
    STRUCTURE_EXTENSION,
    STRUCTURE_CONTAINER,
    STRUCTURE_STORAGE,
    STRUCTURE_TOWER,
    STRUCTURE_ROAD,
    STRUCTURE_WALL,
    STRUCTURE_RAMPART,
    STRUCTURE_CONTROLLER,
};
