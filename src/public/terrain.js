'use strict';

/**
 * @file Terrain helpers — apply custom terrain to a room.
 *
 * Responsibility:
 *   Provides `applyTerrainSpec` — a pure helper that takes a TerrainMatrix
 *   instance from screeps-server-mockup and applies a user-provided terrain
 *   specification (walls, swamps, plains).
 *
 *   Custom terrain can be specified in room fixtures (`terrain` field),
 *   `RoomSpecInput` (inline), or `RoomOverrides` (to replace fixture terrain).
 *   The framework applies it automatically during `createWorld` — this export
 *   is for advanced users who need to apply terrain programmatically.
 *
 * **Available functions:**
 * - `applyTerrainSpec(terrainMatrix, terrainSpec)` — apply terrain (walls, swamps) to a TerrainMatrix instance
 *
 * **Supported terrain spec formats** (auto-detected):
 * - `{ walls: [{x,y}, ...], swamps: [{x,y}, ...] }` — positional
 * - `number[][]` — 50×50 matrix (0=plain, 1=WALL, 2=SWAMP)
 * - `(terrainMatrix) => void` — callback with full TerrainMatrix access
 *
 * @example
 * const { createWorld, spec } = require('screeps-integration-tests');
 *
 * // Inline terrain via RoomSpecInput
 * const world = await createWorld({
 *     rooms: [{
 *         name: 'W0N1',
 *         terrain: { walls: [{ x: 10, y: 10 }, { x: 11, y: 10 }] },
 *         controller: spec.controller({ level: 1 }),
 *     }],
 *     bots: [{ username: 'bot', rooms: ['W0N1'] }],
 * });
 *
 * @example
 * // Manual terrain application (advanced)
 * const { applyTerrainSpec } = require('screeps-integration-tests/terrain');
 * const TerrainMatrix = require('screeps-server-mockup/dist/src/terrainMatrix').default;
 * const matrix = new TerrainMatrix();
 * applyTerrainSpec(matrix, {
 *     walls: [{ x: 0, y: 0 }],
 *     swamps: [{ x: 5, y: 5 }, { x: 6, y: 5 }],
 * });
 * // matrix is now mutated in-place
 *
 * @module screeps-integration-tests/terrain
 */

const { applyTerrainSpec } = require('../lib/builders/terrain');

module.exports = { applyTerrainSpec };
