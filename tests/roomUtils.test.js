'use strict';

/**
 * Unit tests for roomUtils.js — parseRoomName + computeAdjacentBorders.
 *
 * Cover:
 * - parseRoomName: W/E and N/S coordinate conversion (engine convention)
 * - parseRoomName: throws on invalid names
 * - computeAdjacentBorders: vertical / horizontal / non-adjacent rooms
 *
 * @file Unit tests for roomUtils.js
 */

const { parseRoomName, computeAdjacentBorders } = require('../src/lib/runtime/roomUtils');

// ─── parseRoomName ────────────────────────────────────────────────────────

describe('parseRoomName', () => {
    it('converts W0N1 to {-1, -2}', () => {
        expect(parseRoomName('W0N1')).toEqual({ x: -1, y: -2 });
    });

    it('converts W0N0 to {-1, -1}', () => {
        expect(parseRoomName('W0N0')).toEqual({ x: -1, y: -1 });
    });

    it('converts W1N1 to {-2, -2}', () => {
        expect(parseRoomName('W1N1')).toEqual({ x: -2, y: -2 });
    });

    it('converts E0S0 to {0, 0}', () => {
        expect(parseRoomName('E0S0')).toEqual({ x: 0, y: 0 });
    });

    it('converts E50S50 to {50, 50}', () => {
        expect(parseRoomName('E50S50')).toEqual({ x: 50, y: 50 });
    });

    it('converts E0N1 to {0, -2}', () => {
        expect(parseRoomName('E0N1')).toEqual({ x: 0, y: -2 });
    });

    it('throws on an invalid room name', () => {
        expect(() => parseRoomName('invalid')).toThrow(/Invalid room name/);
        expect(() => parseRoomName('N0W1')).toThrow();
        expect(() => parseRoomName('W0X1')).toThrow();
    });
});

// ─── computeAdjacentBorders ───────────────────────────────────────────────

describe('computeAdjacentBorders', () => {
    it('marks vertical neighbours (W0N1 north of W0N2)', () => {
        const adjacent = computeAdjacentBorders(['W0N1', 'W0N2']);
        expect(adjacent['W0N1']).toEqual({ top: true, bottom: false, left: false, right: false });
        expect(adjacent['W0N2']).toEqual({ top: false, bottom: true, left: false, right: false });
    });

    it('marks horizontal neighbours (W1N1 west of W0N1)', () => {
        const adjacent = computeAdjacentBorders(['W0N1', 'W1N1']);
        expect(adjacent['W0N1']).toEqual({ top: false, bottom: false, left: true, right: false });
        expect(adjacent['W1N1']).toEqual({ top: false, bottom: false, left: false, right: true });
    });

    it('marks no borders for non-adjacent rooms', () => {
        const adjacent = computeAdjacentBorders(['W0N1', 'W5N5']);
        expect(adjacent['W0N1']).toEqual({ top: false, bottom: false, left: false, right: false });
        expect(adjacent['W5N5']).toEqual({ top: false, bottom: false, left: false, right: false });
    });
});
