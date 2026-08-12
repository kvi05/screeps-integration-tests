'use strict';

/**
 * Unit tests for dbDump.js — full DB dump and restore utilities.
 */

const { collectFullDump, restoreFromDump } = require('../src/tools/viewer/dbDump');

// ═══════════════════════════════════════════════════════════════════════════
// Mocks
// ═══════════════════════════════════════════════════════════════════════════

jest.mock('../src/lib/builders/memory', () => ({
    getBotMemory: jest.fn().mockResolvedValue({ test: 'mem' }),
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
        async hget(key, field) {
            // Simulate hget: key is a prefix, field is appended
            return envStore[key + field] ?? null;
        },
        async hmget(key, fields) {
            // Simulate hmget: key is a prefix, store is a flat map
            const result = {};
            for (const field of fields) {
                result[field] = envStore[key + field] ?? null;
            }
            return result;
        },
        async hmset(key, values) {
            for (const [field, val] of Object.entries(values)) {
                envStore[key + field] = val;
            }
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

// ═══════════════════════════════════════════════════════════════════════════
// Tests — collectFullDump
// ═══════════════════════════════════════════════════════════════════════════

describe('collectFullDump', () => {
    it('returns correct structure with all collections', async () => {
        const { adapter } = createMockAdapter({
            objects: [{ _id: 'c1', type: 'creep', x: 10, y: 10, room: 'W0N1' }],
            terrain: [{ room: 'W0N1', terrain: 'plain' }],
            flags: [{ _id: 'f1', room: 'W0N1', color: 1 }],
            env: { gameTime: '42', roomStatusData: '{"W0N1":{"active":true}}', accessibleRooms: '["W0N1"]' },
        });

        const bots = { bot1: { id: 'uid1' } };
        const roomStatus = { W0N1: { active: true } };

        const dump = await collectFullDump(adapter, bots, roomStatus, '/test.js');

        expect(dump.meta).toBeDefined();
        expect(dump.meta.scenario).toBe('/test.js');
        expect(dump.meta.tick).toBe(42);
        expect(dump.meta.bots).toEqual(['bot1']);
        expect(dump.meta.rooms).toEqual(['W0N1']);
        expect(dump.meta.timestamp).toBeTruthy();
        expect(dump.version).toBe('2.0');
        expect(dump.meta.botConfig).toEqual({ bot1: { username: 'bot1', id: 'uid1', opts: {} } });
        expect(dump.meta.frameworkVersion).toBeTruthy();
        expect(dump.meta.frameworkVersion).toMatch(/^\d+\.\d+\.\d+/);

        expect(dump.db['rooms.objects']).toHaveLength(1);
        expect(dump.db['rooms.objects'][0]._id).toBe('c1');
        expect(dump.db['rooms.terrain']).toHaveLength(1);
        expect(dump.db['rooms.flags']).toHaveLength(1);

        expect(dump.env.gameTime).toBe(42);
        expect(dump.env.roomStatus).toEqual({ W0N1: { active: true } });
        expect(dump.env.accessibleRooms).toEqual(['W0N1']);
    });

    it('includes Memory for all bots', async () => {
        const { getBotMemory } = require('../src/lib/builders/memory');
        getBotMemory.mockResolvedValueOnce({ bot1mem: true }).mockResolvedValueOnce({ bot2mem: true });

        const { adapter } = createMockAdapter({
            env: { gameTime: '0' },
        });

        const bots = { bot1: { id: 'uid1' }, bot2: { id: 'uid2' } };
        const roomStatus = {};

        const dump = await collectFullDump(adapter, bots, roomStatus, '/test.js');

        expect(dump.env.memory.bot1).toEqual({ bot1mem: true });
        expect(dump.env.memory.bot2).toEqual({ bot2mem: true });
    });

    it('handles missing env keys gracefully', async () => {
        const { adapter } = createMockAdapter({
            env: { gameTime: '0' },
        });

        const bots = {};
        const roomStatus = {};

        const dump = await collectFullDump(adapter, bots, roomStatus, '/test.js');

        expect(dump.env.roomStatus).toBeNull();
        expect(dump.env.accessibleRooms).toBeNull();
    });

    it('handles missing rooms.flags collection gracefully', async () => {
        const { adapter } = createMockAdapter({
            env: { gameTime: '0' },
        });
        // Remove flags collection entirely
        delete adapter.db['rooms.flags'];

        const bots = {};
        const roomStatus = {};

        const dump = await collectFullDump(adapter, bots, roomStatus, '/test.js');

        expect(dump.db['rooms.flags']).toEqual([]);
    });

    it('handles getBotMemory failure gracefully (empty Memory)', async () => {
        const { getBotMemory } = require('../src/lib/builders/memory');
        getBotMemory.mockRejectedValueOnce(new Error('Storage error'));

        const { adapter } = createMockAdapter({
            env: { gameTime: '0' },
        });

        const bots = { bot1: { id: 'uid1' } };
        const roomStatus = {};

        const dump = await collectFullDump(adapter, bots, roomStatus, '/test.js');

        expect(dump.env.memory.bot1).toEqual({});
    });

    it('handles gameTime default to 0 when env key is missing', async () => {
        const { adapter } = createMockAdapter({
            env: {},
        });

        const bots = {};
        const roomStatus = {};

        const dump = await collectFullDump(adapter, bots, roomStatus, '/test.js');

        expect(dump.env.gameTime).toBe(0);
        expect(dump.meta.tick).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tests — restoreFromDump
// ═══════════════════════════════════════════════════════════════════════════

describe('restoreFromDump', () => {
    it('throws on missing snapshot.db', async () => {
        const { adapter } = createMockAdapter({ env: { gameTime: '10' } });
        await expect(restoreFromDump(adapter, {}, { env: { gameTime: 5 } }, {})).rejects.toThrow(/missing db or env/);
    });

    it('throws on missing snapshot.env', async () => {
        const { adapter } = createMockAdapter({ env: { gameTime: '10' } });
        await expect(restoreFromDump(adapter, {}, { db: { 'rooms.objects': [] } }, {})).rejects.toThrow(
            /missing db or env/,
        );
    });

    it('overwrites rooms.objects (old objects gone, new inserted)', async () => {
        const { adapter } = createMockAdapter({
            objects: [{ _id: 'old1', type: 'creep', x: 1, y: 1, room: 'W0N1' }],
            env: { gameTime: '10' },
        });

        const snapshot = {
            meta: {
                scenario: '/test.js',
                timestamp: '2021-01-01T00:00:00.000Z',
                tick: 5,
                bots: ['bot1'],
                rooms: ['W0N1'],
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
        };

        const bots = { bot1: { id: 'uid1' } };

        const result = await restoreFromDump(adapter, bots, snapshot);

        expect(result.tick).toBe(5);
        expect(result.rooms).toBe(1);
        expect(result.bots).toBe(1);

        // Verify old objects are gone, new are present
        const objects = await adapter.db['rooms.objects'].find();
        expect(objects).toHaveLength(1);
        expect(objects[0]._id).toBe('new1');
        expect(objects[0].type).toBe('spawn');
    });

    it('restores gameTime and Memory', async () => {
        const { adapter, getEnv } = createMockAdapter({
            env: { gameTime: '99' },
        });

        const snapshot = {
            meta: {
                scenario: '/test.js',
                timestamp: '2021-01-01T00:00:00.000Z',
                tick: 3,
                bots: ['bot1'],
                rooms: ['W0N1'],
            },
            db: {
                'rooms.objects': [],
                'rooms.terrain': [],
                'rooms.flags': [],
            },
            env: {
                gameTime: 3,
                memory: { bot1: { myMemory: 42 } },
                roomStatus: null,
                accessibleRooms: null,
            },
        };

        const bots = { bot1: { id: 'uid1' } };

        await restoreFromDump(adapter, bots, snapshot);

        const env = getEnv();
        expect(env.gameTime).toBe('3');
        // Memory is stored as JSON string
        expect(env['memory:uid1']).toBe('{"myMemory":42}');
    });

    it('truncates roomHistory for each room', async () => {
        const { adapter, getEnv } = createMockAdapter({
            env: {
                gameTime: '10',
                'roomHistory:W0N1': 'some-history',
                'roomHistory:W1N1': 'some-history',
            },
            objects: [],
        });

        const snapshot = {
            meta: {
                scenario: '/test.js',
                timestamp: '2021-01-01T00:00:00.000Z',
                tick: 5,
                bots: [],
                rooms: ['W0N1', 'W1N1'],
            },
            db: {
                'rooms.objects': [],
                'rooms.terrain': [],
                'rooms.flags': [],
            },
            env: {
                gameTime: 5,
                memory: {},
                roomStatus: null,
                accessibleRooms: null,
            },
        };

        const bots = {};

        await restoreFromDump(adapter, bots, snapshot);

        const env = getEnv();
        expect(env['roomHistory:W0N1']).toBeUndefined();
        expect(env['roomHistory:W1N1']).toBeUndefined();
    });

    it('restores roomStatus and accessibleRooms when present', async () => {
        const { adapter, getEnv } = createMockAdapter({
            env: { gameTime: '0' },
        });

        const snapshot = {
            meta: {
                scenario: '/test.js',
                timestamp: '2021-01-01T00:00:00.000Z',
                tick: 0,
                bots: [],
                rooms: ['W0N1'],
            },
            db: {
                'rooms.objects': [],
                'rooms.terrain': [],
                'rooms.flags': [],
            },
            env: {
                gameTime: 0,
                memory: {},
                roomStatus: { W0N1: { active: true, rcl: 3 } },
                accessibleRooms: ['W0N1'],
            },
        };

        const bots = {};

        await restoreFromDump(adapter, bots, snapshot);

        const env = getEnv();
        expect(env.roomStatusData).toBe('{"W0N1":{"active":true,"rcl":3}}');
        expect(env.accessibleRooms).toBe('["W0N1"]');
    });

    it('does not set null roomStatus/accessibleRooms', async () => {
        const { adapter, getEnv } = createMockAdapter({
            env: { gameTime: '0' },
        });

        const snapshot = {
            meta: {
                scenario: '/test.js',
                timestamp: '2021-01-01T00:00:00.000Z',
                tick: 0,
                bots: [],
                rooms: ['W0N1'],
            },
            db: {
                'rooms.objects': [],
                'rooms.terrain': [],
                'rooms.flags': [],
            },
            env: {
                gameTime: 0,
                memory: {},
                roomStatus: null,
                accessibleRooms: null,
            },
        };

        const bots = {};

        await restoreFromDump(adapter, bots, snapshot);

        const env = getEnv();
        expect(env.roomStatusData).toBeUndefined();
        expect(env.accessibleRooms).toBeUndefined();
    });

    it('round-trip: dump → restore → dump produces identical snapshot', async () => {
        const originalObjects = [
            { _id: 'obj1', type: 'spawn', x: 5, y: 5, room: 'W0N1', hits: 5000 },
            { _id: 'obj2', type: 'source', x: 10, y: 10, room: 'W0N1', energy: 3000 },
        ];
        const { adapter } = createMockAdapter({
            objects: originalObjects,
            env: {
                gameTime: '42',
                roomStatusData: '{"W0N1":{"active":true}}',
                accessibleRooms: '["W0N1"]',
            },
        });

        const bots = { bot1: { id: 'uid1' } };
        const roomStatus = { W0N1: { active: true } };

        // Initial dump
        const dump1 = await collectFullDump(adapter, bots, roomStatus, '/test.js');

        // Restore from dump1 (to the same adapter — simulates save/load cycle)
        await restoreFromDump(adapter, bots, dump1);

        // Second dump
        const dump2 = await collectFullDump(adapter, bots, roomStatus, '/test.js');

        // Meta fields differ (timestamp) — compare data fields
        expect(dump2.db['rooms.objects']).toHaveLength(dump1.db['rooms.objects'].length);
        expect(dump2.env.gameTime).toBe(dump1.env.gameTime);
        expect(dump2.env.memory).toEqual(dump1.env.memory);
        expect(dump2.env.roomStatus).toEqual(dump1.env.roomStatus);
        expect(dump2.env.accessibleRooms).toEqual(dump1.env.accessibleRooms);
    });
});
