import { describe, it, expect, beforeEach } from 'vitest';
import { roomNameToXY, computeStageLayout, creepFacing, resetFacingMemo, FACING_LOOKBACK } from '../src/canvas/layout';

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

// ─── creepFacing ────────────────────────────────────────────────────────────

/** Frames for a creep that MOVES at `moveTick` (to `to`) and stays there. */
function makeMovedFrames(moveTick, to, count) {
    return Array.from({ length: count }, (_, i) => ({
        gameTime: i,
        objects: [
            {
                _id: 'c1',
                type: 'creep',
                room: 'W0N0',
                x: i >= moveTick ? to[0] : 10,
                y: i >= moveTick ? to[1] : 10,
            },
        ],
    }));
}

/**
 * Build a single-creep frame list: frames[i] places the creep at (x, y).
 * Use makeMovedFrames for "moved once and stayed" scenarios (a one-frame
 * excursion also produces a return movement, which is a facing source too).
 */
function makeFrames(positions, { id = 'c1', actionLog = null } = {}) {
    return positions.map((pos, i) => ({
        gameTime: i,
        objects: [
            {
                _id: id,
                type: 'creep',
                room: 'W0N0',
                x: pos[0],
                y: pos[1],
                ...(i === positions.length - 1 && actionLog ? { actionLog } : {}),
            },
        ],
    }));
}

const singleRoomLayout = computeStageLayout(['W0N0']);

describe('creepFacing', () => {
    beforeEach(() => {
        resetFacingMemo();
    });

    it('path 1: actionLog target of the next frame wins over movement', () => {
        // Moved WEST, but actionLog targets EAST — facing must be EAST (0°).
        const frames = makeFrames(
            [
                [10, 10],
                [9, 10],
            ],
            { actionLog: { harvest: { x: 15, y: 10 } } },
        );
        expect(creepFacing(frames, 0, 'c1', singleRoomLayout)).toBeCloseTo(0);
    });

    it('path 2: movement delta i→i+1 (moved south = 90°)', () => {
        const frames = makeFrames([
            [10, 10],
            [10, 12],
        ]);
        expect(creepFacing(frames, 0, 'c1', singleRoomLayout)).toBeCloseTo(90);
    });

    it('path 3: finds last movement within the lookback window', () => {
        // Creep moved at tick 50→51 (EAST) and stayed; observer at tick 100.
        const frames = makeMovedFrames(51, [12, 10], 101);
        // Movement is inside the [40, 100] scan window of tick 100 — the
        // facing is found, NOT the fallback (123).
        expect(creepFacing(frames, 100, 'c1', singleRoomLayout, 123)).toBeCloseTo(0);
    });

    it('path 3 is bounded: movement older than FACING_LOOKBACK falls back', () => {
        // Creep moved once at tick 0→1, then stood still far beyond the window.
        const positions = Array.from({ length: FACING_LOOKBACK + 10 }, (_, i) => (i <= 1 ? [10 + i, 10] : [11, 10]));
        const frames = makeFrames(positions);
        const last = frames.length - 1;
        // Old (unbounded) code found the ancient movement; the bounded scan must
        // NOT scan past FACING_LOOKBACK frames — returns the fallback angle.
        expect(creepFacing(frames, last, 'c1', singleRoomLayout, 123)).toBe(123);
    });

    it('memoizes per (id, gameTime): second call at the same tick is a cache hit', () => {
        // Moved at tick 1→2 (EAST), stayed; observer at tick 29.
        const frames = makeMovedFrames(2, [13, 10], 30);
        const first = creepFacing(frames, 29, 'c1', singleRoomLayout, 7);
        expect(first).toBeCloseTo(0);
        // Same tick, different sub-frame — memo hit returns the same angle.
        expect(creepFacing(frames, 29, 'c1', singleRoomLayout, 7)).toBe(first);
    });

    it('memo is keyed by gameTime, not array index — buffer shift does not serve stale angles', () => {
        // Moved at tick 0→1 (EAST) and stayed; observer at index 9 (gameTime 9).
        const frames = makeMovedFrames(1, [14, 10], 10);
        expect(creepFacing(frames, 9, 'c1', singleRoomLayout)).toBeCloseTo(0);
        // Ring buffer evicts the oldest frame — index 9 now maps to gameTime 10
        // with a fresh WEST movement. Memo must miss and recompute.
        const shifted = frames
            .slice(1)
            .concat([{ gameTime: 10, objects: [{ _id: 'c1', type: 'creep', room: 'W0N0', x: 6, y: 10 }] }]);
        expect(creepFacing(shifted, 9, 'c1', singleRoomLayout)).toBeCloseTo(180);
    });

    it('resetFacingMemo clears cached angles', () => {
        // Moved at tick 0→1 (EAST) and stayed; observer at tick 9.
        const frames = makeMovedFrames(1, [14, 10], 10);
        expect(creepFacing(frames, 9, 'c1', singleRoomLayout, 5)).toBeCloseTo(0);
        resetFacingMemo();
        // After reset the angle is recomputed from history (same result).
        expect(creepFacing(frames, 9, 'c1', singleRoomLayout, 5)).toBeCloseTo(0);
    });

    it('stationary creep with no history at all returns the fallback angle', () => {
        const frames = makeFrames([
            [10, 10],
            [10, 10],
        ]);
        expect(creepFacing(frames, 1, 'c1', singleRoomLayout, 42)).toBe(42);
    });

    it('perf: bounded scan does not walk a huge buffer for a stationary creep', () => {
        // 2000 frames, creep stationary everywhere except an ancient move at
        // tick 1 — far outside the lookback window. Must complete fast and
        // return the fallback instead of scanning all 2000 frames.
        const positions = Array.from({ length: 2000 }, () => [10, 10]);
        positions[1] = [11, 10];
        const frames = makeFrames(positions);
        const t0 = performance.now();
        const angle = creepFacing(frames, 1999, 'c1', singleRoomLayout, 9);
        const dt = performance.now() - t0;
        expect(angle).toBe(9);
        expect(dt).toBeLessThan(50);
    });
});
