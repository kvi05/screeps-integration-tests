'use strict';

/**
 * Terrain builder — converts a {@link TerrainSpec} into calls on a TerrainMatrix.
 *
 * Responsibility:
 *   Pure helper that takes a TerrainMatrix instance from screeps-server-mockup
 *   and applies a user-provided terrain spec. Does not touch the DB — only
 *   mutates the matrix via `.set(x, y, type)`.
 *
 *   The orchestration layer (`materializeRooms` in world.js) is responsible
 *   for loading the matrix from `adapter.world`, calling this helper, and
 *   writing it back via `adapter.world.setTerrain`.
 *
 * Supported terrain spec formats (auto-detected by type):
 *
 * | Format      | JS type          | Example |
 * |-------------|------------------|---------|
 * | Positional  | `{ walls, swamps }` | `{ walls: [{x:10,y:10}], swamps: [{x:20,y:20}] }` |
 * | Matrix      | `number[][]`     | 50×50 array (0=plain, 1=WALL, 2=SWAMP) |
 * | Callback    | `Function`       | `(matrix) => { matrix.set(5, 5, 'wall'); }` |
 *
 * Border walls (exit-aware) are applied AFTER this helper by the runtime layer.
 * Custom terrain takes precedence over the plain default, but border walls
 * overwrite edge tiles to ensure correct exits between adjacent rooms.
 *
 * @module runtime/terrain
 */

const { TERRAIN_MASK_WALL, TERRAIN_MASK_SWAMP } = require('../../constants/screepsConstants');

/**
 * @typedef {import('../types').TerrainSpec} TerrainSpec
 */

// ─── Terrain type mapping ───────────────────────────────────────────────────

/**
 * Maps terrain mask constants to TerrainMatrix string types.
 * @type {Object<number, string>}
 */
const MASK_TO_TYPE = {
    [TERRAIN_MASK_WALL]: 'wall',
    [TERRAIN_MASK_SWAMP]: 'swamp',
};

// ─── Main API ───────────────────────────────────────────────────────────────

/**
 * Applies a terrain spec to an existing TerrainMatrix.
 *
 * The matrix is mutated in-place. Caller is responsible for obtaining
 * the matrix (`adapter.world.getTerrain`) and saving it back
 * (`adapter.world.setTerrain`).
 *
 * @param {Object} terrainMatrix — TerrainMatrix instance from screeps-server-mockup
 * @param {TerrainSpec} terrainSpec — terrain description
 * @returns {void}
 */
function applyTerrainSpec(terrainMatrix, terrainSpec) {
    if (!terrainSpec) {
        return;
    }

    // ── Format 1: Callback ──────────────────────────────────────────────
    if (typeof terrainSpec === 'function') {
        terrainSpec(terrainMatrix);
        return;
    }

    // ── Format 2: Positional { walls: [...], swamps: [...] } ────────────
    if (_isPositionalSpec(terrainSpec)) {
        _applyPositional(terrainMatrix, terrainSpec);
        return;
    }

    // ── Format 3: Matrix number[][] ─────────────────────────────────────
    if (Array.isArray(terrainSpec)) {
        _applyMatrix(terrainMatrix, terrainSpec);
        return;
    }

    throw new Error(
        'applyTerrainSpec: unrecognised terrainSpec format. ' +
            'Expected { walls, swamps }, number[][], or (matrix) => void. ' +
            `Got: ${typeof terrainSpec}`,
    );
}

// ─── Format detection ───────────────────────────────────────────────────────

/**
 * Checks if a value looks like a positional terrain spec.
 *
 * @param {Object} spec
 * @returns {boolean}
 * @private
 */
function _isPositionalSpec(spec) {
    return spec && typeof spec === 'object' && !Array.isArray(spec) && ('walls' in spec || 'swamps' in spec);
}

// ─── Positional format ──────────────────────────────────────────────────────

/**
 * Applies positional terrain: walls and swamps arrays.
 *
 * @param {Object} terrainMatrix
 * @param {{ walls?: Array<{x:number, y:number}>, swamps?: Array<{x:number, y:number}> }} spec
 * @returns {void}
 * @private
 */
function _applyPositional(terrainMatrix, spec) {
    if (spec.walls && spec.walls.length > 0) {
        for (const { x, y } of spec.walls) {
            _validateCoord(x, y);
            terrainMatrix.set(x, y, 'wall');
        }
    }
    if (spec.swamps && spec.swamps.length > 0) {
        for (const { x, y } of spec.swamps) {
            _validateCoord(x, y);
            terrainMatrix.set(x, y, 'swamp');
        }
    }
}

// ─── Matrix format ──────────────────────────────────────────────────────────

/**
 * Applies a 50×50 numeric matrix as terrain.
 * Only tiles with non-zero values are set (0 = plain, leave as-is).
 *
 * @param {Object} terrainMatrix
 * @param {number[][]} matrix — 50×50 array (TERRAIN_MASK_WALL=1, TERRAIN_MASK_SWAMP=2)
 * @returns {void}
 * @private
 */
function _applyMatrix(terrainMatrix, matrix) {
    if (matrix.length !== 50) {
        throw new Error(`applyTerrainSpec: matrix must be 50×50, got ${matrix.length} rows`);
    }
    for (let y = 0; y < 50; y++) {
        if (!Array.isArray(matrix[y]) || matrix[y].length !== 50) {
            throw new Error(
                `applyTerrainSpec: matrix row ${y} must have 50 columns, got ${matrix[y]?.length ?? 'non-array'}`,
            );
        }
        for (let x = 0; x < 50; x++) {
            const val = matrix[y][x];
            if (val !== 0 && val !== undefined && val !== null) {
                const type = MASK_TO_TYPE[val];
                if (!type) {
                    throw new Error(
                        `applyTerrainSpec: unknown terrain value ${val} at (${x},${y}). ` +
                            `Expected 0 (plain), 1 (wall), 2 (swamp).`,
                    );
                }
                terrainMatrix.set(x, y, type);
            }
        }
    }
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validates that x and y are within [0, 49].
 *
 * @param {number} x
 * @param {number} y
 * @returns {void}
 * @private
 */
function _validateCoord(x, y) {
    if (typeof x !== 'number' || typeof y !== 'number') {
        throw new Error(`applyTerrainSpec: coordinates must be numbers, got (${x}, ${y})`);
    }
    if (x < 0 || x > 49 || y < 0 || y > 49) {
        throw new Error(`applyTerrainSpec: coordinates out of bounds (0-49), got (${x}, ${y})`);
    }
}

// ─── TerrainMatrix class accessor ───────────────────────────────────────────

/**
 * Returns the TerrainMatrix class from screeps-server-mockup.
 * Cached after first call to avoid repeated internal-path requires.
 *
 * @returns {typeof import('screeps-server-mockup/dist/src/terrainMatrix').default}
 */
function getTerrainMatrixClass() {
    if (!_terrainMatrixClass) {
        _terrainMatrixClass = require('screeps-server-mockup/dist/src/terrainMatrix').default;
    }
    return _terrainMatrixClass;
}
let _terrainMatrixClass = null;

module.exports = { applyTerrainSpec, getTerrainMatrixClass };
