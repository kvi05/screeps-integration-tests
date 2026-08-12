'use strict';

/**
 * Unit tests for rewind.js — rewind-to-tick utility.
 */

const { rewindToTick } = require('../src/tools/viewer/rewind');

// ═══════════════════════════════════════════════════════════════════════════
// Mocks
// ═══════════════════════════════════════════════════════════════════════════

jest.mock('../src/lib/builders/memory', () => ({
    getBotMemory: jest.fn().mockResolvedValue({ current: 'memory' }),
}));

// Mock clearAndRefill to track calls and verify it works
const mockClearAndRefill = jest.fn(async (_col, _docs, _label) => {
    // Simulate: replace collection content with docs
});

jest.mock('../src/tools/viewer/dbDump', () => ({
    clearAndRefill: (...args) => mockClearAndRefill(...args),
}));

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates a mock adapter with in-memory collections and env.
 * @param {Object} [initialState]
 * @returns {{ adapter: Object, getState: () => Object, getEnv: () => Object }}
 */
function createMockAdapter(initialState = {}) {
    /** @type {Object[]} */
    const objects = (initialState.objects || []).map((o) => ({ ...o }));
    /** @type {Object<string, string>} */
    const envStore = { ...(initialState.env || {}) };

    const env = {
        keys: {
            GAMETIME: 'gameTime',
            MEMORY: 'memory:',
            ROOM_HISTORY: 'roomHistory:',
            ROOM_STATUS_DATA: 'roomStatusData',
            ACCESSIBLE_ROOMS: 'accessibleRooms',
        },
        async get(key) {
            return envStore[key] ?? null;
        },
        async set(key, value) {
            envStore[key] = value;
        },
        async del(key) {
            delete envStore[key];
        },
    };

    const db = {
        'rooms.objects': {
            async find() {
                return [...objects];
            },
            async insert(doc) {
                objects.push(doc);
                return doc;
            },
            async clear() {
                objects.length = 0;
            },
        },
    };

    return {
        adapter: { db, env },
        getState: () => ({ objects: [...objects] }),
        getEnv: () => ({ ...envStore }),
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests — rewindToTick
// ═══════════════════════════════════════════════════════════════════════════

describe('rewindToTick', () => {
    beforeEach(() => {
        mockClearAndRefill.mockClear();
        jest.clearAllMocks();
    });

    it('throws if tickN >= current gameTime', async () => {
        const { adapter } = createMockAdapter({
            env: { gameTime: '10' },
        });

        await expect(rewindToTick(adapter, {}, { W0N1: {} }, 10, {})).rejects.toThrow(/Cannot rewind to tick 10/);

        await expect(rewindToTick(adapter, {}, { W0N1: {} }, 11, {})).rejects.toThrow(/Cannot rewind to tick 11/);
    });

    it('throws if no sit:snap snapshot at tickN', async () => {
        const { adapter } = createMockAdapter({
            env: { gameTime: '10' },
        });

        // No sit:snap:5 key
        await expect(rewindToTick(adapter, {}, { W0N1: {} }, 5, {})).rejects.toThrow(/No snapshot at tick 5/);
    });

    it('overwrites rooms.objects with snapshot data', async () => {
        const snapObjects = [{ _id: 'past1', type: 'creep', x: 10, y: 10, room: 'W0N1' }];
        const { adapter } = createMockAdapter({
            objects: [{ _id: 'current1', type: 'creep', x: 20, y: 20, room: 'W0N1' }],
            env: {
                gameTime: '10',
                'sit:snap:5': JSON.stringify(snapObjects),
            },
        });

        const result = await rewindToTick(adapter, {}, { W0N1: {} }, 5, {});

        expect(result.tick).toBe(5);
        expect(mockClearAndRefill).toHaveBeenCalled();
        const clearArgs = mockClearAndRefill.mock.calls[0];
        expect(clearArgs[1]).toEqual(snapObjects);
        expect(clearArgs[2]).toBe('rooms.objects');
    });

    it('restores Memory from extras.memories (IPC round-trip)', async () => {
        const { adapter, getEnv } = createMockAdapter({
            env: {
                gameTime: '10',
                'sit:snap:5': JSON.stringify([]),
            },
        });

        const bots = { bot1: { id: 'uid1' } };
        const extras = {
            memories: { bot1: { myMem: 'past' } },
        };

        await rewindToTick(adapter, bots, { W0N1: {} }, 5, extras);

        const env = getEnv();
        expect(env['memory:uid1']).toBe('{"myMem":"past"}');
    });

    it('falls back to current Memory if extras.memories is empty', async () => {
        const { getBotMemory } = require('../src/lib/builders/memory');
        getBotMemory.mockResolvedValue({ current: 'fallback' });

        const { adapter, getEnv } = createMockAdapter({
            env: {
                gameTime: '10',
                'sit:snap:5': JSON.stringify([{ _id: 'o1', type: 'source', x: 1, y: 1, room: 'W0N1' }]),
            },
        });

        const bots = { bot1: { id: 'uid1' } };

        await rewindToTick(adapter, bots, { W0N1: {} }, 5, {});

        const env = getEnv();
        expect(env['memory:uid1']).toBe('{"current":"fallback"}');
    });

    it('falls back to current Memory if extras.memories has null for a bot', async () => {
        const { getBotMemory } = require('../src/lib/builders/memory');
        getBotMemory.mockResolvedValue({ current: 'fallback2' });

        const { adapter, getEnv } = createMockAdapter({
            env: {
                gameTime: '10',
                'sit:snap:5': JSON.stringify([]),
            },
        });

        const bots = { bot1: { id: 'uid1' } };
        const extras = { memories: { bot1: null } };

        await rewindToTick(adapter, bots, { W0N1: {} }, 5, extras);

        const env = getEnv();
        expect(env['memory:uid1']).toBe('{"current":"fallback2"}');
    });

    it('sets gameTime to tickN', async () => {
        const { adapter, getEnv } = createMockAdapter({
            env: {
                gameTime: '10',
                'sit:snap:3': JSON.stringify([]),
            },
        });

        await rewindToTick(adapter, {}, { W0N1: {} }, 3, {});

        const env = getEnv();
        expect(env.gameTime).toBe('3');
    });

    it('truncates roomHistory after rewind', async () => {
        const { adapter, getEnv } = createMockAdapter({
            env: {
                gameTime: '10',
                'sit:snap:5': JSON.stringify([{ _id: 'c1', type: 'creep', x: 10, y: 10, room: 'W0N1' }]),
                'roomHistory:W0N1': 'should-be-gone',
            },
        });

        await rewindToTick(adapter, {}, { W0N1: {} }, 5, {});

        const env = getEnv();
        expect(env['roomHistory:W0N1']).toBeUndefined();
    });

    it('truncates future sit:snap keys after rewind', async () => {
        const { adapter, getEnv } = createMockAdapter({
            env: {
                gameTime: '10',
                'sit:snap:5': JSON.stringify([{ _id: 'o1', type: 'spawn', x: 5, y: 5, room: 'W0N1' }]),
                'sit:snap:6': 'should-be-gone',
                'sit:snap:7': 'should-also-be-gone',
                'sit:snap:9': 'should-be-gone-too',
            },
        });

        await rewindToTick(adapter, {}, { W0N1: {} }, 5, {});

        const env = getEnv();
        // sit:snap:5 should remain
        expect(env['sit:snap:5']).toBeDefined();
        // future ticks should be deleted
        expect(env['sit:snap:6']).toBeUndefined();
        expect(env['sit:snap:7']).toBeUndefined();
        expect(env['sit:snap:9']).toBeUndefined();
    });

    it('handles multiple rooms (all objects in one sit:snap key)', async () => {
        const snapObjects = [
            { _id: 'o1', type: 'spawn', x: 5, y: 5, room: 'W0N1' },
            { _id: 'o2', type: 'source', x: 10, y: 10, room: 'W1N1' },
        ];
        const { adapter } = createMockAdapter({
            env: {
                gameTime: '10',
                'sit:snap:5': JSON.stringify(snapObjects),
            },
        });

        const result = await rewindToTick(adapter, {}, { W0N1: {}, W1N1: {} }, 5, {});

        expect(result.rooms).toBe(2);
        expect(mockClearAndRefill).toHaveBeenCalled();
        const clearArgs = mockClearAndRefill.mock.calls[0];
        expect(clearArgs[1]).toHaveLength(2);
    });

    it('handles missing roomHistory gracefully during truncation', async () => {
        const { adapter } = createMockAdapter({
            env: {
                gameTime: '10',
                'sit:snap:5': JSON.stringify([{ _id: 'o1', type: 'creep', x: 1, y: 1, room: 'W0N1' }]),
            },
        });

        // env.del on a non-existent key should silently succeed (our mock just does `delete`)
        await expect(rewindToTick(adapter, {}, { W0N1: {} }, 5, {})).resolves.toBeDefined();
    });

    it('updates report.ticksRun when extras.report is provided', async () => {
        const { adapter } = createMockAdapter({
            env: {
                gameTime: '10',
                'sit:snap:5': JSON.stringify([{ _id: 'o1', type: 'creep', x: 1, y: 1, room: 'W0N1' }]),
            },
        });

        const report = { ticksRun: 10, stopReason: 'something' };
        const extras = { report };

        await rewindToTick(adapter, {}, { W0N1: {} }, 5, extras);

        expect(report.ticksRun).toBe(5);
        expect(report.stopReason).toBeNull();
    });

    it('does not fail when extras.report is absent', async () => {
        const { adapter } = createMockAdapter({
            env: {
                gameTime: '10',
                'sit:snap:5': JSON.stringify([]),
            },
        });

        // No extras at all — should not throw
        await expect(rewindToTick(adapter, {}, { W0N1: {} }, 5)).resolves.toBeDefined();
    });

    it('handles missing sit:snap keys gracefully during truncation', async () => {
        const { adapter, getEnv } = createMockAdapter({
            env: {
                gameTime: '10',
                'sit:snap:5': JSON.stringify([{ _id: 'o1', type: 'creep', x: 1, y: 1, room: 'W0N1' }]),
            },
        });

        // No sit:snap:6+9 — del should silently succeed
        await rewindToTick(adapter, {}, { W0N1: {} }, 5, {});

        const env = getEnv();
        expect(env['sit:snap:5']).toBeDefined();
    });
});
