import { describe, it, expect } from 'vitest';
import { roomNameToXY, computeStageLayout } from '../src/canvas/layout';

describe('roomNameToXY', () => {
    it('W0N0 → (-1, -1)', () => {
        expect(roomNameToXY('W0N0')).toEqual({ x: -1, y: -1 });
    });

    it('E0S0 → (0, 0)', () => {
        expect(roomNameToXY('E0S0')).toEqual({ x: 0, y: 0 });
    });

    it('W1N1 → (-2, -2)', () => {
        expect(roomNameToXY('W1N1')).toEqual({ x: -2, y: -2 });
    });

    it('E1S1 → (1, 1)', () => {
        expect(roomNameToXY('E1S1')).toEqual({ x: 1, y: 1 });
    });

    it('mixed directions: W0S0 → (-1, 0)', () => {
        expect(roomNameToXY('W0S0')).toEqual({ x: -1, y: 0 });
    });

    it('mixed directions: E0N0 → (0, -1)', () => {
        expect(roomNameToXY('E0N0')).toEqual({ x: 0, y: -1 });
    });

    it('invalid name returns {0,0}', () => {
        expect(roomNameToXY('INVALID')).toEqual({ x: 0, y: 0 });
    });

    it('empty string returns {0,0}', () => {
        expect(roomNameToXY('')).toEqual({ x: 0, y: 0 });
    });
});

describe('computeStageLayout', () => {
    it('single room: 1×1', () => {
        const layout = computeStageLayout(['W0N0']);
        expect(layout.offsets['W0N0']).toEqual({ col: 0, row: 0 });
        expect(layout.width).toBe(600);
        expect(layout.height).toBe(600);
    });

    it('two rooms E-W: 2×1', () => {
        const layout = computeStageLayout(['W0N0', 'E0N0']);
        expect(layout.offsets['W0N0'].col).toBe(0);
        expect(layout.offsets['E0N0'].col).toBe(1);
        expect(layout.width).toBe(1200);
    });

    it('two rooms N-S: 1×2', () => {
        const layout = computeStageLayout(['W0N0', 'W0S0']);
        expect(layout.offsets['W0N0'].row).toBe(0);
        expect(layout.offsets['W0S0'].row).toBe(1);
        expect(layout.height).toBe(1200);
    });

    it('2×2 grid', () => {
        const layout = computeStageLayout(['W0N0', 'E0N0', 'W0S0', 'E0S0']);
        expect(layout.width).toBe(1200);
        expect(layout.height).toBe(1200);
    });

    it('non-contiguous rooms', () => {
        const layout = computeStageLayout(['W0N0', 'E5S5']);
        expect(layout.offsets['E5S5']).toEqual({ col: 6, row: 6 });
    });

    it('custom pixelsPerRoom', () => {
        const layout = computeStageLayout(['W0N0', 'E0N0'], 800);
        expect(layout.pixelsPerRoom).toBe(800);
        expect(layout.width).toBe(1600);
    });

    it('empty rooms array', () => {
        const layout = computeStageLayout([]);
        expect(layout.rooms).toEqual([]);
        expect(layout.offsets).toEqual({});
    });
});
