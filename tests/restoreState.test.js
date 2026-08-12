'use strict';

/**
 * Unit tests for restoreState.js — unified world state restoration.
 */

const { restoreState, clearAndRefill } = require('../src/lib/orchestration/restoreState');

// ═══════════════════════════════════════════════════════════════════════════
// Mocks
// ═══════════════════════════════════════════════════════════════════════════

/** @type {jest.Mock} */
const mockGetBotMemory = jest.fn().mockResolvedValue({ current: 'memory' });

jest.mock('../src/lib/builders/memory', () => ({
    getBotMemory: (...args) => mockGetBotMemory(...args),
}));

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates a mock adapter with in-memory collections and env.
 *
 * @param {Object} [initialState]
 * @returns {{ adapter: Object, getState: () => Object, getEnv: () => Object }}
 */
function createMockAdapter(initialState = {}) {
    /** @type {Object[]} */
    const objects = (initialState.objects || []).map((o) => ({ ...o }));
    /** @type {Object[]} */
    const terrain = (initialState.terrain || []).map((t) => ({ ...t }));
    /** @type {Object[]} */
    const flags = (initialState.flags || []).map((f) => ({ ...f }));
    /** @type {Object<string, string>} */
    const envStore = { ...(initialState.env || {}) };

    const env = {
        keys: {
            GAMETIME: 'gameTime',
            MEMORY: 'memory:',
            ROOM_HISTORY: 'roomHistory:',
            ROOM_STATUS_DATA: 'roomStatusData',
            ACCESSIBLE_ROOMS: 'accessibleRooms',
            ACTIVE_ROOMS: 'activeRooms',
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
        async sadd(key, value) {
            /** @type {string[]} */
            let members = [];
            try {
                members = JSON.parse(envStore[key] || '[]');
            } catch {
                members = [];
            }
            if (!members.includes(value)) members.push(value);
            envStore[key] = JSON.stringify(members);
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
        'rooms.terrain': {
            async find() {
                return [...terrain];
            },
            async insert(doc) {
                terrain.push(doc);
                return doc;
            },
            async clear() {
                terrain.length = 0;
            },
        },
        'rooms.flags': {
            async find() {
                return [...flags];
            },
            async insert(doc) {
                flags.push(doc);
                return doc;
            },
            async clear() {
                flags.length = 0;
            },
        },
    };

    return {
        adapter: { db, env },
        getState: () => ({ objects: [...objects], terrain: [...terrain], flags: [...flags] }),
        getEnv: () => ({ ...envStore }),
    };
}

/**
 * Creates a minimal valid snapshot for testing.
 *
 * @param {Object} [overrides]
 * @returns {Object}
 */
function createSnapshot(overrides = {}) {
    return {
        version: '2.0',
        meta: {
            scenario: '/test.js',
            timestamp: '2021-01-01T00:00:00.000Z',
            tick: 5,
            bots: ['bot1'],
            rooms: ['W0N1'],
            botConfig: { bot1: { username: 'bot1', opts: {} } },
            frameworkVersion: '3.0.0',
        },
        db: {
            'rooms.objects': [{ _id: 'new1', type: 'spawn', x: 5, y: 5, room: 'W0N1' }],
            'rooms.terrain': [],
            'rooms.flags': [],
        },
        env: {
            gameTime: 5,
            memory: { bot1: { test: true } },
            roomStatus: { W0N1: { active: true } },
            accessibleRooms: ['W0N1'],
        },
        ...overrides,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests — clearAndRefill
// ═══════════════════════════════════════════════════════════════════════════

describe('clearAndRefill', () => {
    it('clears and repopulates a collection', async () => {
        const { adapter } = createMockAdapter({
            objects: [{ _id: 'old1', type: 'creep', x: 1, y: 1, room: 'W0N1' }],
        });

        const newDocs = [{ _id: 'new1', type: 'spawn', x: 5, y: 5, room: 'W0N1' }];

        await clearAndRefill(adapter.db['rooms.objects'], newDocs, 'rooms.objects');

        const objects = await adapter.db['rooms.objects'].find();
        expect(objects).toHaveLength(1);
        expect(objects[0]._id).toBe('new1');
        expect(objects[0].type).toBe('spawn');
    });

    it('strips LokiJS internals before inserting', async () => {
        const { adapter } = createMockAdapter({ objects: [] });

        const docsWithLoki = [{ _id: 'doc1', type: 'creep', $loki: 1, meta: {}, x: 1, y: 1, room: 'W0N1' }];

        await clearAndRefill(adapter.db['rooms.objects'], docsWithLoki, 'rooms.objects');

        const objects = await adapter.db['rooms.objects'].find();
        expect(objects).toHaveLength(1);
        expect(objects[0].$loki).toBeUndefined();
        expect(objects[0].meta).toBeUndefined();
        expect(objects[0]._id).toBe('doc1');
    });

    it('uses removeWhere fallback when clear is not available', async () => {
        const docs = [];
        const collection = {
            removeWhere: jest.fn(async () => {}),
            async find() {
                return [...docs];
            },
            async insert(doc) {
                docs.push(doc);
                return doc;
            },
        };

        await clearAndRefill(collection, [{ _id: 'd1' }], 'test');

        expect(collection.removeWhere).toHaveBeenCalledWith({});
    });

    it('throws on insert failure', async () => {
        const collection = {
            async clear() {},
            async find() {
                return [];
            },
            async insert() {
                throw new Error('Insert failed');
            },
        };

        await expect(clearAndRefill(collection, [{ _id: 'd1' }], 'test')).rejects.toThrow(
            /Failed to insert document 0\/1 into test/,
        );
    });

    it('throws on count mismatch after refill', async () => {
        const collection = {
            async clear() {},
            async find() {
                return []; // Should have 1 but returns 0
            },
            async insert(doc) {
                return doc;
            },
        };

        await expect(clearAndRefill(collection, [{ _id: 'd1' }], 'test')).rejects.toThrow(/Refill mismatch for test/);
    });

    it('throws when verify find() fails', async () => {
        const collection = {
            async clear() {},
            async find() {
                throw new Error('Collection broken');
            },
            async insert(doc) {
                return doc;
            },
        };

        await expect(clearAndRefill(collection, [{ _id: 'd1' }], 'test')).rejects.toThrow(
            /Failed to verify test after refill/,
        );
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tests — restoreState
// ═══════════════════════════════════════════════════════════════════════════

describe('restoreState', () => {
    beforeEach(() => {
        mockGetBotMemory.mockClear();
        mockGetBotMemory.mockResolvedValue({ current: 'memory' });
    });

    // ── Basic restore ─────────────────────────────────────────────────────

    it('overwrites rooms.objects from snapshot', async () => {
        const { adapter } = createMockAdapter({
            objects: [{ _id: 'old1', type: 'creep', x: 1, y: 1, room: 'W0N1' }],
            env: { gameTime: '10' },
        });

        const snapshot = createSnapshot();
        const bots = { bot1: { id: 'uid1' } };

        const result = await restoreState(adapter, bots, snapshot);

        expect(result.tick).toBe(5);
        expect(result.rooms).toBe(1);
        expect(result.bots).toBe(1);

        const objects = await adapter.db['rooms.objects'].find();
        expect(objects).toHaveLength(1);
        expect(objects[0]._id).toBe('new1');
    });

    it('overwrites rooms.terrain only when snapshot has terrain data', async () => {
        const { adapter } = createMockAdapter({
            terrain: [{ room: 'W0N1', terrain: 'old' }],
            env: { gameTime: '10' },
        });

        const snapshot = createSnapshot({
            db: {
                'rooms.objects': [],
                'rooms.terrain': [{ room: 'W0N1', terrain: 'new' }],
                'rooms.flags': [],
            },
        });

        await restoreState(adapter, {}, snapshot);

        const terrain = await adapter.db['rooms.terrain'].find();
        expect(terrain).toHaveLength(1);
        expect(terrain[0].terrain).toBe('new');
    });

    it('skips terrain when snapshot lacks rooms.terrain key (rewind)', async () => {
        const { adapter } = createMockAdapter({
            terrain: [{ room: 'W0N1', terrain: 'original' }],
            env: { gameTime: '10' },
        });

        // Snapshot WITHOUT terrain key (like rewind produces)
        const snapshot = createSnapshot();
        delete snapshot.db['rooms.terrain'];

        await restoreState(adapter, {}, snapshot);

        // Original terrain should remain untouched
        const terrain = await adapter.db['rooms.terrain'].find();
        expect(terrain).toHaveLength(1);
        expect(terrain[0].terrain).toBe('original');
    });

    it('overwrites rooms.flags only when snapshot has flags data', async () => {
        const { adapter } = createMockAdapter({
            flags: [{ _id: 'f1', room: 'W0N1', color: 1 }],
            env: { gameTime: '10' },
        });

        const snapshot = createSnapshot({
            db: {
                'rooms.objects': [],
                'rooms.terrain': [],
                'rooms.flags': [{ _id: 'f2', room: 'W0N1', color: 2 }],
            },
        });

        await restoreState(adapter, {}, snapshot);

        const flags = await adapter.db['rooms.flags'].find();
        expect(flags).toHaveLength(1);
        expect(flags[0]._id).toBe('f2');
    });

    it('skips flags when snapshot lacks rooms.flags key (rewind)', async () => {
        const { adapter } = createMockAdapter({
            flags: [{ _id: 'f1', room: 'W0N1', color: 1 }],
            env: { gameTime: '10' },
        });

        const snapshot = createSnapshot();
        delete snapshot.db['rooms.flags'];

        await restoreState(adapter, {}, snapshot);

        const flags = await adapter.db['rooms.flags'].find();
        expect(flags).toHaveLength(1);
        expect(flags[0]._id).toBe('f1');
    });

    // ── gameTime ──────────────────────────────────────────────────────────

    it('reads currentTick BEFORE overwriting gameTime (truncation works)', async () => {
        const { adapter, getEnv } = createMockAdapter({
            env: {
                gameTime: '10',
                'sit:snap:6': 'future-data',
                'sit:snap:7': 'future-data-2',
                'sit:snap:9': 'future-data-3',
            },
        });

        const snapshot = createSnapshot({ env: { ...createSnapshot().env, gameTime: 5 } });

        await restoreState(adapter, {}, snapshot);

        // Future sit:snap keys (6,7,8,9,10) should be truncated
        const envAfter = getEnv();
        expect(envAfter['sit:snap:6']).toBeUndefined();
        expect(envAfter['sit:snap:7']).toBeUndefined();
        expect(envAfter['sit:snap:9']).toBeUndefined();
    });

    it('sets gameTime from snapshot', async () => {
        const { adapter, getEnv } = createMockAdapter({
            env: { gameTime: '99' },
        });

        const snapshot = createSnapshot({
            env: { ...createSnapshot().env, gameTime: 3 },
        });

        await restoreState(adapter, {}, snapshot);

        const env = getEnv();
        expect(env.gameTime).toBe('3');
    });

    // ── Memory priority ───────────────────────────────────────────────────

    it('sets Memory for each bot from snapshot.env.memory', async () => {
        const { adapter, getEnv } = createMockAdapter({
            env: { gameTime: '10' },
        });

        const snapshot = createSnapshot({
            env: {
                ...createSnapshot().env,
                memory: { bot1: { myData: 42 } },
            },
        });

        const bots = { bot1: { id: 'uid1' } };

        await restoreState(adapter, bots, snapshot);

        const env = getEnv();
        expect(env['memory:uid1']).toBe('{"myData":42}');
    });

    it('uses extras.memories when provided (rewind)', async () => {
        const { adapter, getEnv } = createMockAdapter({
            env: { gameTime: '10' },
        });

        const snapshot = createSnapshot({
            env: {
                ...createSnapshot().env,
                memory: { bot1: { fromSnapshot: true } },
            },
        });

        const bots = { bot1: { id: 'uid1' } };
        const extras = {
            memories: { bot1: { fromRewind: true } },
        };

        await restoreState(adapter, bots, snapshot, extras);

        const env = getEnv();
        // extras.memories takes priority over snapshot.env.memory
        expect(env['memory:uid1']).toBe('{"fromRewind":true}');
    });

    it('uses snapshot.env.memory when extras.memories absent (load)', async () => {
        const { adapter, getEnv } = createMockAdapter({
            env: { gameTime: '10' },
        });

        const snapshot = createSnapshot({
            env: {
                ...createSnapshot().env,
                memory: { bot1: { fromSnapshot: true } },
            },
        });

        const bots = { bot1: { id: 'uid1' } };

        // No extras.memories
        await restoreState(adapter, bots, snapshot, {});

        const env = getEnv();
        expect(env['memory:uid1']).toBe('{"fromSnapshot":true}');
    });

    it('falls back to current memory when neither provided', async () => {
        mockGetBotMemory.mockResolvedValue({ fallback: 'mem' });

        const { adapter, getEnv } = createMockAdapter({
            env: { gameTime: '10' },
        });

        const snapshot = createSnapshot({
            env: {
                ...createSnapshot().env,
                memory: {}, // no bot1 memory
            },
        });

        const bots = { bot1: { id: 'uid1' } };

        await restoreState(adapter, bots, snapshot, {});

        const env = getEnv();
        expect(env['memory:uid1']).toBe('{"fallback":"mem"}');
    });

    it('skips Memory when bot has null memory in snapshot and fallback fails', async () => {
        mockGetBotMemory.mockRejectedValue(new Error('Storage error'));

        const { adapter, getEnv } = createMockAdapter({
            env: { gameTime: '10', 'memory:uid1': '"original-mem"' },
        });

        const snapshot = createSnapshot({
            env: {
                ...createSnapshot().env,
                memory: {}, // no bot1
            },
        });

        const bots = { bot1: { id: 'uid1' } };

        await restoreState(adapter, bots, snapshot, {});

        // getBotMemory fails → no memory set → original stays
        const env = getEnv();
        expect(env['memory:uid1']).toBe('"original-mem"');
    });

    // ── roomStatus / accessibleRooms ──────────────────────────────────────

    it('sets roomStatus and accessibleRooms from snapshot', async () => {
        const { adapter, getEnv } = createMockAdapter({
            env: { gameTime: '10' },
        });

        const snapshot = createSnapshot();

        await restoreState(adapter, {}, snapshot);

        const env = getEnv();
        expect(env.roomStatusData).toBe('{"W0N1":{"active":true}}');
        expect(env.accessibleRooms).toBe('["W0N1"]');
    });

    it('does not set null roomStatus/accessibleRooms', async () => {
        const { adapter, getEnv } = createMockAdapter({
            env: { gameTime: '10' },
        });

        const snapshot = createSnapshot({
            env: {
                ...createSnapshot().env,
                roomStatus: null,
                accessibleRooms: null,
            },
        });

        await restoreState(adapter, {}, snapshot);

        const env = getEnv();
        expect(env.roomStatusData).toBeUndefined();
        expect(env.accessibleRooms).toBeUndefined();
    });

    // ── Truncation ────────────────────────────────────────────────────────

    it('truncates sit:snap keys > target tick', async () => {
        const { adapter, getEnv } = createMockAdapter({
            env: {
                gameTime: '10',
                'sit:snap:5': 'keep-me',
                'sit:snap:6': 'delete-me',
                'sit:snap:7': 'delete-me-too',
                'sit:snap:9': 'delete-also',
            },
        });

        const snapshot = createSnapshot({
            env: { ...createSnapshot().env, gameTime: 5 },
        });

        await restoreState(adapter, {}, snapshot);

        const env = getEnv();
        // sit:snap:5 should remain
        expect(env['sit:snap:5']).toBe('keep-me');
        // future ticks should be deleted
        expect(env['sit:snap:6']).toBeUndefined();
        expect(env['sit:snap:7']).toBeUndefined();
        expect(env['sit:snap:9']).toBeUndefined();
    });

    it('truncates roomHistory for each snapshot room', async () => {
        const { adapter, getEnv } = createMockAdapter({
            env: {
                gameTime: '10',
                'roomHistory:W0N1': 'old-history',
                'roomHistory:W1N1': 'old-history-2',
            },
        });

        const snapshot = createSnapshot({
            meta: { ...createSnapshot().meta, rooms: ['W0N1', 'W1N1'] },
            db: { 'rooms.objects': [], 'rooms.terrain': [], 'rooms.flags': [] },
        });

        await restoreState(adapter, {}, snapshot);

        const env = getEnv();
        expect(env['roomHistory:W0N1']).toBeUndefined();
        expect(env['roomHistory:W1N1']).toBeUndefined();
    });

    it('handles missing roomHistory gracefully during truncation', async () => {
        const { adapter } = createMockAdapter({
            env: { gameTime: '10' },
        });

        const snapshot = createSnapshot({
            db: { 'rooms.objects': [], 'rooms.terrain': [], 'rooms.flags': [] },
        });

        // Should not throw — del on non-existent key silently succeeds
        await expect(restoreState(adapter, {}, snapshot)).resolves.toBeDefined();
    });

    // ── Report update ─────────────────────────────────────────────────────

    it('updates report.ticksRun when extras.report present', async () => {
        const { adapter } = createMockAdapter({
            env: { gameTime: '10' },
        });

        const snapshot = createSnapshot({
            db: { 'rooms.objects': [], 'rooms.terrain': [], 'rooms.flags': [] },
            env: { ...createSnapshot().env, gameTime: 5 },
        });

        const report = { ticksRun: 10, stopReason: 'something' };
        const extras = { report };

        await restoreState(adapter, {}, snapshot, extras);

        expect(report.ticksRun).toBe(5);
        expect(report.stopReason).toBeNull();
    });

    it('does not fail when extras.report is absent', async () => {
        const { adapter } = createMockAdapter({
            env: { gameTime: '10' },
        });

        const snapshot = createSnapshot({
            db: { 'rooms.objects': [], 'rooms.terrain': [], 'rooms.flags': [] },
        });

        await expect(restoreState(adapter, {}, snapshot)).resolves.toBeDefined();
    });

    // ── Return value ──────────────────────────────────────────────────────

    it('returns correct tick, rooms, bots counts', async () => {
        const { adapter } = createMockAdapter({
            env: { gameTime: '10' },
        });

        const snapshot = createSnapshot({
            meta: { ...createSnapshot().meta, tick: 7, bots: ['b1', 'b2'], rooms: ['W0N1', 'W1N1'] },
            db: { 'rooms.objects': [], 'rooms.terrain': [], 'rooms.flags': [] },
            env: { ...createSnapshot().env, gameTime: 7 },
        });

        const bots = { b1: { id: 'u1' }, b2: { id: 'u2' } };

        const result = await restoreState(adapter, bots, snapshot);

        expect(result.tick).toBe(7);
        expect(result.rooms).toBe(2);
        expect(result.bots).toBe(2);
    });

    // ── Room activation ───────────────────────────────────────────────────

    it('activates snapshot rooms via ACTIVE_ROOMS', async () => {
        const { adapter, getEnv } = createMockAdapter({
            env: { gameTime: '10' },
        });

        const snapshot = createSnapshot({
            meta: { ...createSnapshot().meta, rooms: ['W0N1', 'W1N1'] },
            db: { 'rooms.objects': [], 'rooms.terrain': [], 'rooms.flags': [] },
        });

        await restoreState(adapter, {}, snapshot);

        const env = getEnv();
        expect(JSON.parse(env.activeRooms)).toEqual(['W0N1', 'W1N1']);
    });

    it('re-activates a room already present in ACTIVE_ROOMS without duplicates', async () => {
        const { adapter, getEnv } = createMockAdapter({
            env: { gameTime: '10', activeRooms: '["W0N1"]' },
        });

        const snapshot = createSnapshot({
            db: { 'rooms.objects': [], 'rooms.terrain': [], 'rooms.flags': [] },
        });

        await restoreState(adapter, {}, snapshot);

        const env = getEnv();
        expect(JSON.parse(env.activeRooms)).toEqual(['W0N1']);
    });

    // ── Ownership remap ───────────────────────────────────────────────────

    it('remaps object user fields via extras.userIdMap', async () => {
        const { adapter, getState } = createMockAdapter({
            env: { gameTime: '10' },
        });

        const snapshot = createSnapshot({
            db: {
                'rooms.objects': [
                    { _id: 'o1', type: 'spawn', room: 'W0N1', user: 'oldId' },
                    { _id: 'o2', type: 'controller', room: 'W0N1', user: 'oldId' },
                    { _id: 'o3', type: 'source', room: 'W0N1' },
                ],
                'rooms.terrain': [],
                'rooms.flags': [],
            },
        });

        await restoreState(adapter, { bot1: { id: 'newBotId' } }, snapshot, {
            userIdMap: { oldId: 'newBotId' },
        });

        const { objects } = getState();
        expect(objects.find((o) => o._id === 'o1').user).toBe('newBotId');
        expect(objects.find((o) => o._id === 'o2').user).toBe('newBotId');
        expect(objects.find((o) => o._id === 'o3').user).toBeUndefined();
    });

    it('does not mutate the original snapshot docs when remapping', async () => {
        const { adapter } = createMockAdapter({
            env: { gameTime: '10' },
        });

        /** @type {Object[]} */
        const docs = [{ _id: 'o1', type: 'spawn', room: 'W0N1', user: 'oldId' }];
        const snapshot = createSnapshot({
            db: { 'rooms.objects': docs, 'rooms.terrain': [], 'rooms.flags': [] },
        });

        await restoreState(adapter, { bot1: { id: 'newBotId' } }, snapshot, {
            userIdMap: { oldId: 'newBotId' },
        });

        expect(docs[0].user).toBe('oldId');
    });

    it('leaves user fields untouched without extras.userIdMap', async () => {
        const { adapter, getState } = createMockAdapter({
            env: { gameTime: '10' },
        });

        const snapshot = createSnapshot({
            db: {
                'rooms.objects': [{ _id: 'o1', type: 'spawn', room: 'W0N1', user: 'someId' }],
                'rooms.terrain': [],
                'rooms.flags': [],
            },
        });

        await restoreState(adapter, { bot1: { id: 'newBotId' } }, snapshot, {});

        const { objects } = getState();
        expect(objects[0].user).toBe('someId');
    });

    it('remaps flag user fields via extras.userIdMap', async () => {
        const { adapter, getState } = createMockAdapter({
            env: { gameTime: '10' },
        });

        const snapshot = createSnapshot({
            db: {
                'rooms.objects': [],
                'rooms.terrain': [],
                'rooms.flags': [
                    { _id: 'f1', room: 'W0N1', user: 'oldId' },
                    { _id: 'f2', room: 'W0N1', user: 'otherId' },
                ],
            },
        });

        await restoreState(adapter, { bot1: { id: 'newBotId' } }, snapshot, {
            userIdMap: { oldId: 'newBotId' },
        });

        const { flags } = getState();
        expect(flags.find((f) => f._id === 'f1').user).toBe('newBotId');
        expect(flags.find((f) => f._id === 'f2').user).toBe('otherId');
    });
});
