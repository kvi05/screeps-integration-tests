'use strict';

const { applyTerrainSpec } = require('../src/lib/runtime/terrain');
const { TERRAIN_MASK_WALL, TERRAIN_MASK_SWAMP } = require('../src/constants/screepsConstants');

// ─── Mock TerrainMatrix ─────────────────────────────────────────────────────

/**
 * Minimal mock of screeps-server-mockup TerrainMatrix.
 * Tracks all .set() calls for assertions.
 */
function createMockTerrainMatrix() {
    /** @type {Array<{x:number, y:number, type:string}>} */
    const calls = [];
    return {
        calls,
        set(x, y, type) {
            calls.push({ x, y, type });
        },
    };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('applyTerrainSpec', () => {
    describe('positional format', () => {
        it('applies walls from { walls: [...] }', () => {
            const matrix = createMockTerrainMatrix();
            applyTerrainSpec(matrix, {
                walls: [
                    { x: 10, y: 10 },
                    { x: 20, y: 30 },
                ],
            });
            expect(matrix.calls).toEqual([
                { x: 10, y: 10, type: 'wall' },
                { x: 20, y: 30, type: 'wall' },
            ]);
        });

        it('applies swamps from { swamps: [...] }', () => {
            const matrix = createMockTerrainMatrix();
            applyTerrainSpec(matrix, {
                swamps: [
                    { x: 5, y: 5 },
                    { x: 6, y: 5 },
                    { x: 7, y: 5 },
                ],
            });
            expect(matrix.calls).toEqual([
                { x: 5, y: 5, type: 'swamp' },
                { x: 6, y: 5, type: 'swamp' },
                { x: 7, y: 5, type: 'swamp' },
            ]);
        });

        it('applies both walls and swamps together', () => {
            const matrix = createMockTerrainMatrix();
            applyTerrainSpec(matrix, {
                walls: [{ x: 0, y: 0 }],
                swamps: [{ x: 1, y: 1 }],
            });
            expect(matrix.calls).toEqual([
                { x: 0, y: 0, type: 'wall' },
                { x: 1, y: 1, type: 'swamp' },
            ]);
        });

        it('handles empty walls/swamps arrays', () => {
            const matrix = createMockTerrainMatrix();
            applyTerrainSpec(matrix, { walls: [], swamps: [] });
            expect(matrix.calls).toEqual([]);
        });

        it('handles only walls (no swamps key)', () => {
            const matrix = createMockTerrainMatrix();
            applyTerrainSpec(matrix, { walls: [{ x: 1, y: 1 }] });
            expect(matrix.calls).toEqual([{ x: 1, y: 1, type: 'wall' }]);
        });

        it('handles only swamps (no walls key)', () => {
            const matrix = createMockTerrainMatrix();
            applyTerrainSpec(matrix, { swamps: [{ x: 2, y: 2 }] });
            expect(matrix.calls).toEqual([{ x: 2, y: 2, type: 'swamp' }]);
        });
    });

    describe('positional format — validation', () => {
        it('throws on negative x', () => {
            const matrix = createMockTerrainMatrix();
            expect(() => applyTerrainSpec(matrix, { walls: [{ x: -1, y: 0 }] })).toThrow('out of bounds');
        });

        it('throws on x > 49', () => {
            const matrix = createMockTerrainMatrix();
            expect(() => applyTerrainSpec(matrix, { walls: [{ x: 50, y: 0 }] })).toThrow('out of bounds');
        });

        it('throws on negative y', () => {
            const matrix = createMockTerrainMatrix();
            expect(() => applyTerrainSpec(matrix, { swamps: [{ x: 0, y: -1 }] })).toThrow('out of bounds');
        });

        it('throws on y > 49', () => {
            const matrix = createMockTerrainMatrix();
            expect(() => applyTerrainSpec(matrix, { swamps: [{ x: 0, y: 50 }] })).toThrow('out of bounds');
        });

        it('throws on non-number coordinates', () => {
            const matrix = createMockTerrainMatrix();
            expect(() => applyTerrainSpec(matrix, { walls: [{ x: 'abc', y: 0 }] })).toThrow(
                'coordinates must be numbers',
            );
        });
    });

    describe('matrix format', () => {
        it('applies wall values (1) from matrix', () => {
            const matrix = createMockTerrainMatrix();
            const m = Array.from({ length: 50 }, () => new Array(50).fill(0));
            m[10][20] = TERRAIN_MASK_WALL; // 1
            m[30][40] = TERRAIN_MASK_WALL; // 1
            applyTerrainSpec(matrix, m);
            expect(matrix.calls).toEqual([
                { x: 20, y: 10, type: 'wall' },
                { x: 40, y: 30, type: 'wall' },
            ]);
        });

        it('applies swamp values (2) from matrix', () => {
            const matrix = createMockTerrainMatrix();
            const m = Array.from({ length: 50 }, () => new Array(50).fill(0));
            m[5][5] = TERRAIN_MASK_SWAMP; // 2
            applyTerrainSpec(matrix, m);
            expect(matrix.calls).toEqual([{ x: 5, y: 5, type: 'swamp' }]);
        });

        it('skips plain values (0) in matrix', () => {
            const matrix = createMockTerrainMatrix();
            const m = Array.from({ length: 50 }, () => new Array(50).fill(0));
            // all zeros — no calls expected
            applyTerrainSpec(matrix, m);
            expect(matrix.calls).toEqual([]);
        });

        it('throws on non-50 row count', () => {
            const matrix = createMockTerrainMatrix();
            expect(() => applyTerrainSpec(matrix, [[0]])).toThrow('must be 50×50');
        });

        it('throws on non-50 column count', () => {
            const matrix = createMockTerrainMatrix();
            const m = Array.from({ length: 50 }, () => [0]); // 50 rows, 1 col each
            expect(() => applyTerrainSpec(matrix, m)).toThrow('must have 50 columns');
        });

        it('throws on unknown terrain value', () => {
            const matrix = createMockTerrainMatrix();
            const m = Array.from({ length: 50 }, () => new Array(50).fill(0));
            m[0][0] = 99;
            expect(() => applyTerrainSpec(matrix, m)).toThrow('unknown terrain value 99');
        });
    });

    describe('callback format', () => {
        it('calls the function with the terrainMatrix', () => {
            const matrix = createMockTerrainMatrix();
            let receivedMatrix;
            applyTerrainSpec(matrix, (m) => {
                receivedMatrix = m;
                m.set(10, 20, 'wall');
            });
            expect(receivedMatrix).toBe(matrix);
            expect(matrix.calls).toEqual([{ x: 10, y: 20, type: 'wall' }]);
        });

        it('allows complex multi-tile patterns via callback', () => {
            const matrix = createMockTerrainMatrix();
            applyTerrainSpec(matrix, (m) => {
                for (let i = 0; i < 10; i++) {
                    m.set(i, 0, 'wall');
                }
                m.set(5, 5, 'swamp');
            });
            expect(matrix.calls).toHaveLength(11);
            // first 10 are walls
            for (let i = 0; i < 10; i++) {
                expect(matrix.calls[i]).toEqual({ x: i, y: 0, type: 'wall' });
            }
            // last is swamp
            expect(matrix.calls[10]).toEqual({ x: 5, y: 5, type: 'swamp' });
        });

        it('does nothing with a no-op callback', () => {
            const matrix = createMockTerrainMatrix();
            applyTerrainSpec(matrix, () => {
                // no-op
            });
            expect(matrix.calls).toEqual([]);
        });
    });

    describe('edge cases', () => {
        it('no-ops on null/undefined terrainSpec', () => {
            const matrix = createMockTerrainMatrix();
            applyTerrainSpec(matrix, null);
            applyTerrainSpec(matrix, undefined);
            expect(matrix.calls).toEqual([]);
        });

        it('throws on unrecognised format', () => {
            const matrix = createMockTerrainMatrix();
            expect(() => applyTerrainSpec(matrix, 'foo')).toThrow('unrecognised terrainSpec');
            expect(() => applyTerrainSpec(matrix, 42)).toThrow('unrecognised terrainSpec');
        });

        it('accepts boundary coordinates [0,0] and [49,49]', () => {
            const matrix = createMockTerrainMatrix();
            applyTerrainSpec(matrix, {
                walls: [{ x: 0, y: 0 }],
                swamps: [{ x: 49, y: 49 }],
            });
            expect(matrix.calls).toEqual([
                { x: 0, y: 0, type: 'wall' },
                { x: 49, y: 49, type: 'swamp' },
            ]);
        });
    });
});
