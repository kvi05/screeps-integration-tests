'use strict';

const { createStorageAdapter } = require('../lib/storageAdapter');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a mock ScreepsServer with a minimal set of methods.
 *
 * @param {Object} [overrides]
 * @returns {Object} — mock server
 */
function createMockServer(overrides = {}) {
    const mockDbCollection = {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
        insert: jest.fn().mockResolvedValue({ _id: 'mock-id' }),
        update: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
    };

    const mockEnv = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        sadd: jest.fn().mockResolvedValue(undefined),
        hget: jest.fn().mockResolvedValue(null),
        keys: {
            MEMORY: 'memory_',
            ACTIVE_ROOMS: 'activeRooms',
            ROOM_EVENT_LOG: 'roomEventLog',
            GAMETIME: 'gameTime',
        },
    };

    const mockPubsub = {
        subscribe: jest.fn().mockResolvedValue(undefined),
    };

    const mockWorld = {
        reset: jest.fn().mockResolvedValue(undefined),
        addRoom: jest.fn().mockResolvedValue(undefined),
        getTerrain: jest.fn().mockResolvedValue(null),
        setTerrain: jest.fn().mockResolvedValue(undefined),
        genRandomBadge: jest.fn().mockReturnValue({ type: 1, color1: '#fff' }),
    };

    return {
        common: {
            storage: {
                db: {
                    'rooms.objects': { ...mockDbCollection },
                    users: { ...mockDbCollection },
                    rooms: { ...mockDbCollection },
                    'users.code': { ...mockDbCollection },
                    'users.console': { ...mockDbCollection },
                },
                env: mockEnv,
                pubsub: mockPubsub,
            },
        },
        world: mockWorld,
        processes: { proc1: { kill: jest.fn() }, proc2: { kill: jest.fn() } },
        ...overrides,
    };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

describe('createStorageAdapter', () => {
    it('returns an object with the correct structure', () => {
        const server = createMockServer();
        const adapter = createStorageAdapter(server);

        expect(adapter).toHaveProperty('db');
        expect(adapter).toHaveProperty('env');
        expect(adapter).toHaveProperty('pubsub');
        expect(adapter).toHaveProperty('world');
        expect(adapter).toHaveProperty('getProcesses');
        expect(adapter).toHaveProperty('_server');
        expect(adapter._server).toBe(server);
    });

    it('adapter.db — is server.common.storage.db (direct pass-through)', () => {
        const server = createMockServer();
        const adapter = createStorageAdapter(server);

        expect(adapter.db).toBe(server.common.storage.db);
    });

    it('adapter.env — is server.common.storage.env (direct pass-through)', () => {
        const server = createMockServer();
        const adapter = createStorageAdapter(server);

        expect(adapter.env).toBe(server.common.storage.env);
    });

    it('adapter.pubsub — is server.common.storage.pubsub (direct pass-through)', () => {
        const server = createMockServer();
        const adapter = createStorageAdapter(server);

        expect(adapter.pubsub).toBe(server.common.storage.pubsub);
    });

    it('db[collection].find works via direct pass-through', async () => {
        const server = createMockServer();
        const adapter = createStorageAdapter(server);
        const query = { room: 'W0N1' };

        await adapter.db['rooms.objects'].find(query);

        expect(server.common.storage.db['rooms.objects'].find).toHaveBeenCalledWith(query);
    });

    it('db[collection].findOne works via direct pass-through', async () => {
        const server = createMockServer();
        const adapter = createStorageAdapter(server);

        await adapter.db['rooms.objects'].findOne({ room: 'W0N1', type: 'controller' });

        expect(server.common.storage.db['rooms.objects'].findOne).toHaveBeenCalledWith({
            room: 'W0N1',
            type: 'controller',
        });
    });

    it('db[collection].insert works via direct pass-through', async () => {
        const server = createMockServer();
        const adapter = createStorageAdapter(server);
        const doc = { type: 'spawn', x: 10, y: 10 };

        await adapter.db['rooms.objects'].insert(doc);

        expect(server.common.storage.db['rooms.objects'].insert).toHaveBeenCalledWith(doc);
    });

    it('db[collection].update works via direct pass-through', async () => {
        const server = createMockServer();
        const adapter = createStorageAdapter(server);

        await adapter.db.rooms.update({ _id: 'abc' }, { $set: { active: true } });

        expect(server.common.storage.db.rooms.update).toHaveBeenCalledWith({ _id: 'abc' }, { $set: { active: true } });
    });

    it('env.get works via direct pass-through', async () => {
        const server = createMockServer();
        const adapter = createStorageAdapter(server);

        await adapter.env.get('memory_user123');

        expect(server.common.storage.env.get).toHaveBeenCalledWith('memory_user123');
    });

    it('env.set works via direct pass-through', async () => {
        const server = createMockServer();
        const adapter = createStorageAdapter(server);

        await adapter.env.set('memory_user123', '{}');

        expect(server.common.storage.env.set).toHaveBeenCalledWith('memory_user123', '{}');
    });

    it('env.keys — is a reference to the original env.keys', () => {
        const server = createMockServer();
        const adapter = createStorageAdapter(server);

        expect(adapter.env.keys).toBe(server.common.storage.env.keys);
    });

    it('pubsub.subscribe works via direct pass-through', async () => {
        const server = createMockServer();
        const adapter = createStorageAdapter(server);
        const handler = jest.fn();

        await adapter.pubsub.subscribe('user:42/console', handler);

        expect(server.common.storage.pubsub.subscribe).toHaveBeenCalledWith('user:42/console', handler);
    });

    it('world.reset delegates to server.world.reset', async () => {
        const server = createMockServer();
        const adapter = createStorageAdapter(server);

        await adapter.world.reset();

        expect(server.world.reset).toHaveBeenCalled();
    });

    it('world.addRoom delegates to server.world.addRoom', async () => {
        const server = createMockServer();
        const adapter = createStorageAdapter(server);

        await adapter.world.addRoom('W0N1');

        expect(server.world.addRoom).toHaveBeenCalledWith('W0N1');
    });

    it('world.genRandomBadge delegates to server.world.genRandomBadge', () => {
        const server = createMockServer();
        const adapter = createStorageAdapter(server);

        const result = adapter.world.genRandomBadge();

        expect(server.world.genRandomBadge).toHaveBeenCalled();
        expect(result).toEqual({ type: 1, color1: '#fff' });
    });

    it('getProcesses returns an array of child processes', () => {
        const server = createMockServer();
        const adapter = createStorageAdapter(server);

        const processes = adapter.getProcesses();

        expect(Array.isArray(processes)).toBe(true);
        expect(processes).toHaveLength(2);
        expect(processes[0]).toHaveProperty('kill');
    });

    it('getProcesses returns empty array if processes is absent', () => {
        const server = createMockServer({ processes: undefined });
        const adapter = createStorageAdapter(server);

        const processes = adapter.getProcesses();

        expect(Array.isArray(processes)).toBe(true);
        expect(processes).toHaveLength(0);
    });

    it('different collections via db work independently', async () => {
        const server = createMockServer();
        const adapter = createStorageAdapter(server);
        const userDoc = { username: 'testBot' };

        await adapter.db.users.insert(userDoc);
        await adapter.db['rooms.objects'].insert({ type: 'spawn' });

        expect(server.common.storage.db.users.insert).toHaveBeenCalledWith(userDoc);
        expect(server.common.storage.db['rooms.objects'].insert).toHaveBeenCalledWith({ type: 'spawn' });
    });

    it('db returns result from delegate', async () => {
        const server = createMockServer();
        const expected = [{ _id: '1', type: 'spawn' }];
        server.common.storage.db['rooms.objects'].find.mockResolvedValue(expected);
        const adapter = createStorageAdapter(server);

        const result = await adapter.db['rooms.objects'].find({});

        expect(result).toEqual(expected);
    });

    it('env.get returns result from delegate', async () => {
        const server = createMockServer();
        server.common.storage.env.get.mockResolvedValue('{"rcl":5}');
        const adapter = createStorageAdapter(server);

        const result = await adapter.env.get('memory_user123');

        expect(result).toBe('{"rcl":5}');
    });

    it('hget is accessible via env (for eventLog)', async () => {
        const server = createMockServer();
        server.common.storage.env.hget = jest.fn().mockResolvedValue('[{"event":1}]');
        const adapter = createStorageAdapter(server);

        const result = await adapter.env.hget('roomEventLog', 'W0N1');

        expect(server.common.storage.env.hget).toHaveBeenCalledWith('roomEventLog', 'W0N1');
        expect(result).toBe('[{"event":1}]');
    });

    it('throws if collection is missing (delegate error is not caught)', async () => {
        const server = createMockServer();
        const error = new Error('Collection not found');
        server.common.storage.db.objects = {
            find: jest.fn().mockRejectedValue(error),
        };
        const adapter = createStorageAdapter(server);

        await expect(adapter.db.objects.find({})).rejects.toThrow('Collection not found');
    });
});
