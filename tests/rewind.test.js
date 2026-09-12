'use strict';

/**
 * Unit tests for rewind.js — rewind-to-tick utility.
 *
 * Since `rewindToTick` is now a thin wrapper over `restoreState`,
 * these tests verify:
 *   - Validation (tickN >= currentTick, missing snapshot)
 *   - Snapshot assembly from sit:snap data
 *   - Delegation to `restoreState` with correct arguments
 */

const { rewindToTick } = require('../src/tools/viewer/rewind');

// ═══════════════════════════════════════════════════════════════════════════
// Mocks
// ═══════════════════════════════════════════════════════════════════════════

// Mock restoreState to track calls and verify rewind assembles the right snapshot
const mockRestoreState = jest.fn(async (_adapter, _bots, _snapshot, _extras) => {
    return {
        tick: _snapshot.env.gameTime,
        rooms: _snapshot.meta.rooms.length,
        bots: Object.keys(_bots).length,
    };
});

jest.mock('../src/lib/orchestration/restoreState', () => ({
    restoreState: (...args) => mockRestoreState(...args),
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
        mockRestoreState.mockClear();
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

    it('overwrites rooms.objects with snapshot data via restoreState', async () => {
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
        expect(mockRestoreState).toHaveBeenCalled();
        const callArgs = mockRestoreState.mock.calls[0];
        // restoreState(adapter, bots, snapshot, extras)
        expect(callArgs[2].db['rooms.objects']).toEqual(snapObjects);
        expect(callArgs[2].env.gameTime).toBe(5);
    });

    it('passes extras.memories to restoreState (IPC round-trip)', async () => {
        const { adapter } = createMockAdapter({
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

        // Verify restoreState received extras with memories + report
        expect(mockRestoreState).toHaveBeenCalled();
        const callArgs = mockRestoreState.mock.calls[0];
        expect(callArgs[3].memories).toEqual({ bot1: { myMem: 'past' } });
    });

    it('passes empty memories to restoreState when no extras.memories', async () => {
        const { adapter } = createMockAdapter({
            env: {
                gameTime: '10',
                'sit:snap:5': JSON.stringify([{ _id: 'o1', type: 'source', x: 1, y: 1, room: 'W0N1' }]),
            },
        });

        const bots = { bot1: { id: 'uid1' } };

        await rewindToTick(adapter, bots, { W0N1: {} }, 5, {});

        // rewindToTick passes extras.memories || {} as snapshot.env.memory
        expect(mockRestoreState).toHaveBeenCalled();
        const callArgs = mockRestoreState.mock.calls[0];
        // snapshot.env.memory should be {} (empty)
        expect(callArgs[2].env.memory).toEqual({});
    });

    it('sets gameTime in snapshot passed to restoreState', async () => {
        const { adapter } = createMockAdapter({
            env: {
                gameTime: '10',
                'sit:snap:3': JSON.stringify([]),
            },
        });

        await rewindToTick(adapter, {}, { W0N1: {} }, 3, {});

        expect(mockRestoreState).toHaveBeenCalled();
        const callArgs = mockRestoreState.mock.calls[0];
        expect(callArgs[2].env.gameTime).toBe(3);
    });

    it('truncates roomHistory after rewind (via restoreState)', async () => {
        const { adapter } = createMockAdapter({
            env: {
                gameTime: '10',
                'sit:snap:5': JSON.stringify([{ _id: 'c1', type: 'creep', x: 10, y: 10, room: 'W0N1' }]),
                'roomHistory:W0N1': 'should-be-gone',
            },
        });

        await rewindToTick(adapter, {}, { W0N1: {} }, 5, {});

        // restoreState should be called with snapshot.meta.rooms containing 'W0N1'
        expect(mockRestoreState).toHaveBeenCalled();
        const callArgs = mockRestoreState.mock.calls[0];
        expect(callArgs[2].meta.rooms).toEqual(['W0N1']);
    });

    it('does not truncate future sit:snap keys in thin wrapper (handled by restoreState)', async () => {
        const { adapter } = createMockAdapter({
            env: {
                gameTime: '10',
                'sit:snap:5': JSON.stringify([{ _id: 'o1', type: 'spawn', x: 5, y: 5, room: 'W0N1' }]),
                'sit:snap:6': 'should-be-gone',
            },
        });

        await rewindToTick(adapter, {}, { W0N1: {} }, 5, {});

        // The thin wrapper delegates truncation to restoreState.
        // Verify restoreState is called — truncation is tested in restoreState.test.js
        expect(mockRestoreState).toHaveBeenCalled();
    });

    it('builds snapshot with all rooms from one sit:snap key', async () => {
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
        expect(mockRestoreState).toHaveBeenCalled();
        const callArgs = mockRestoreState.mock.calls[0];
        expect(callArgs[2].db['rooms.objects']).toHaveLength(2);
        expect(callArgs[2].meta.rooms).toEqual(['W0N1', 'W1N1']);
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

    it('passes report to restoreState via extras', async () => {
        const { adapter } = createMockAdapter({
            env: {
                gameTime: '10',
                'sit:snap:5': JSON.stringify([{ _id: 'o1', type: 'creep', x: 1, y: 1, room: 'W0N1' }]),
            },
        });

        const report = { ticksRun: 10, stopReason: 'something' };
        const extras = { report };

        await rewindToTick(adapter, {}, { W0N1: {} }, 5, extras);

        // Verify restoreState was called with extras.report
        expect(mockRestoreState).toHaveBeenCalled();
        const callArgs = mockRestoreState.mock.calls[0];
        expect(callArgs[3].report).toBe(report);
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
        expect(mockRestoreState).toHaveBeenCalled();
    });

    it('handles missing sit:snap keys gracefully during truncation', async () => {
        const { adapter } = createMockAdapter({
            env: {
                gameTime: '10',
                'sit:snap:5': JSON.stringify([{ _id: 'o1', type: 'creep', x: 1, y: 1, room: 'W0N1' }]),
            },
        });

        // No sit:snap:6+9 — restoreState handles truncation gracefully
        await rewindToTick(adapter, {}, { W0N1: {} }, 5, {});

        expect(mockRestoreState).toHaveBeenCalled();
    });
});
