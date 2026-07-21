'use strict';

const { createWorldHelpers } = require('../src/lib/orchestration/worldHelpers');

// Mock materializeStructure to avoid touching the real DB.
jest.mock('../src/lib/builders/materialize', () => ({
    materializeStructure: jest.fn(() => Promise.resolve('mocked_structure_id')),
}));

// ─── Fake DB collection ──────────────────────────────────────────────────────

function matches(doc, query) {
    for (const key of Object.keys(query)) {
        if (doc[key] !== query[key]) return false;
    }
    return true;
}

function createFakeCollection(docs) {
    const state = docs.map((d) => ({ ...d }));
    return {
        find(query) {
            return Promise.resolve(state.filter((d) => matches(d, query)));
        },
        findOne(query) {
            return Promise.resolve(state.find((d) => matches(d, query)) || null);
        },
        update(query, updateObj) {
            const { $set } = updateObj;
            const target = state.find((d) => matches(d, query));
            if (target) Object.assign(target, $set);
            return Promise.resolve();
        },
        removeWhere(query) {
            const idx = state.findIndex((d) => matches(d, query));
            if (idx >= 0) state.splice(idx, 1);
            return Promise.resolve();
        },
        insert(doc) {
            const newDoc = { _id: `auto_${Date.now()}`, ...doc };
            state.push(newDoc);
            return Promise.resolve(newDoc);
        },
    };
}

// ─── Fake adapter ────────────────────────────────────────────────────────────

function createFakeAdapter(objects) {
    const envGet = jest.fn((key) => {
        if (key === 'gameTime') return Promise.resolve('10000');
        return Promise.resolve(null);
    });
    return {
        db: {
            'rooms.objects': createFakeCollection(objects),
        },
        env: {
            keys: { GAMETIME: 'gameTime' },
            get: envGet,
        },
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

describe('createWorldHelpers', () => {
    /** @type {Object} */
    let helpers;
    /** @type {Object} */
    let adapter;

    const defaultBotUserId = 'bot_123';

    // Starting DB objects
    const controller = {
        _id: 'ctrl_1',
        room: 'W0N1',
        type: 'controller',
        level: 3,
        downgradeTime: 15000,
        hits: 5000,
        hitsMax: 5000,
    };
    const wall = {
        _id: 'wall_1',
        room: 'W0N1',
        type: 'constructedWall',
        x: 10,
        y: 10,
        hits: 100000,
        hitsMax: 300000000,
    };
    const tower = {
        _id: 'tower_1',
        room: 'W0N1',
        type: 'tower',
        x: 20,
        y: 20,
        user: defaultBotUserId,
        hits: 3000,
        hitsMax: 3000,
        store: { energy: 1000 },
    };
    const source = {
        _id: 'src_1',
        room: 'W0N1',
        type: 'source',
        x: 15,
        y: 15,
        energy: 3000,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        adapter = createFakeAdapter([controller, wall, tower, source]);
        helpers = createWorldHelpers(adapter, defaultBotUserId);
    });

    // ─── setTicksToDowngrade ────────────────────────────────────────────────

    describe('setTicksToDowngrade', () => {
        it('sets downgradeTime = gameTime + ticks', async () => {
            await helpers.setTicksToDowngrade('W0N1', 4000);
            const ctrl = adapter.db['rooms.objects'].findOne({ _id: 'ctrl_1' });
            await expect(ctrl).resolves.toMatchObject({ downgradeTime: 14000 });
        });

        it('with null resets downgradeTime to null', async () => {
            await helpers.setTicksToDowngrade('W0N1', null);
            const ctrl = adapter.db['rooms.objects'].findOne({ _id: 'ctrl_1' });
            await expect(ctrl).resolves.toMatchObject({ downgradeTime: null });
        });

        it('throws if controller is not found', async () => {
            await expect(helpers.setTicksToDowngrade('W0N2', 1000)).rejects.toThrow(
                'controller in room "W0N2" not found',
            );
        });

        it('throws on negative ticks', async () => {
            await expect(helpers.setTicksToDowngrade('W0N1', -1)).rejects.toThrow('ticks must be >= 0 or null');
        });
    });

    // ─── setHitsStructure ──────────────────────────────────────────────────

    describe('setHitsStructure', () => {
        it('sets hits (string _id)', async () => {
            await helpers.setHitsStructure('wall_1', 500000);
            const obj = await adapter.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj.hits).toBe(500000);
        });

        it('clamps to hitsMax', async () => {
            await helpers.setHitsStructure('tower_1', 5000);
            const obj = await adapter.db['rooms.objects'].findOne({ _id: 'tower_1' });
            expect(obj.hits).toBe(3000);
        });

        it('accepts object with _id field', async () => {
            await helpers.setHitsStructure({ _id: 'wall_1' }, 777);
            const obj = await adapter.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj.hits).toBe(777);
        });

        it('accepts object with id field', async () => {
            await helpers.setHitsStructure({ id: 'wall_1' }, 888);
            const obj = await adapter.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj.hits).toBe(888);
        });

        it('throws if object is not found', async () => {
            await expect(helpers.setHitsStructure('nonexistent', 100)).rejects.toThrow(
                'object with _id "nonexistent" not found',
            );
        });

        it('throws if hits is negative', async () => {
            await expect(helpers.setHitsStructure('wall_1', -10)).rejects.toThrow('hits must be >= 0');
        });
    });

    // ─── damageHitsStructure ────────────────────────────────────────────────

    describe('damageHitsStructure', () => {
        it('subtracts amount from hits', async () => {
            await helpers.damageHitsStructure('wall_1', 500);
            const obj = await adapter.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj.hits).toBe(99500);
        });

        it('does not go below 0', async () => {
            await helpers.damageHitsStructure('wall_1', 999999);
            const obj = await adapter.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj.hits).toBe(0);
        });

        it('throws if object is not found', async () => {
            await expect(helpers.damageHitsStructure('nonexistent', 10)).rejects.toThrow('not found');
        });
    });

    // ─── deleteStructure ────────────────────────────────────────────────────

    describe('deleteStructure', () => {
        it('removes object from DB', async () => {
            await helpers.deleteStructure('wall_1');
            const obj = await adapter.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj).toBeNull();
        });

        it('accepts object with id field', async () => {
            await helpers.deleteStructure({ id: 'wall_1' });
            const obj = await adapter.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj).toBeNull();
        });

        it('throws if object is not found', async () => {
            await expect(helpers.deleteStructure('nonexistent')).rejects.toThrow('not found');
        });
    });

    // ─── createStructure ─────────────────────────────────────────────────────

    describe('createStructure', () => {
        it('calls materializeStructure with spec and defaultBotUserId', async () => {
            const { materializeStructure } = require('../src/lib/builders/materialize');
            const spec = { type: 'tower', x: 25, y: 25, roomName: 'W0N1' };
            const id = await helpers.createStructure(spec);
            expect(id).toBe('mocked_structure_id');
            expect(materializeStructure).toHaveBeenCalledWith(
                adapter,
                'W0N1',
                expect.objectContaining({ userId: defaultBotUserId }),
            );
        });

        it('does not override an explicit userId', async () => {
            const { materializeStructure } = require('../src/lib/builders/materialize');
            const spec = { type: 'tower', x: 30, y: 30, roomName: 'W0N1', userId: 'custom' };
            await helpers.createStructure(spec);
            expect(materializeStructure).toHaveBeenCalledWith(
                adapter,
                'W0N1',
                expect.objectContaining({ userId: 'custom' }),
            );
        });

        it('throws if roomName is not specified', async () => {
            await expect(helpers.createStructure({ type: 'wall', x: 5, y: 5 })).rejects.toThrow(
                'spec.roomName is required',
            );
        });
    });

    // ─── find / findOne / findIds / findId ────────────────────────────────

    describe('find', () => {
        it('returns array of objects with id (alias _id)', async () => {
            const docs = await helpers.find({ room: 'W0N1' });
            expect(docs.length).toBeGreaterThanOrEqual(4);
            expect(docs[0]).toHaveProperty('id');
            expect(docs[0].id).toBe(docs[0]._id);
        });

        it('maps userId → user', async () => {
            const docs = await helpers.find({ userId: defaultBotUserId });
            expect(docs.length).toBe(1);
            expect(docs[0]._id).toBe('tower_1');
        });
    });

    describe('findOne', () => {
        it('returns the first matching object', async () => {
            const doc = await helpers.findOne({ room: 'W0N1', type: 'tower' });
            expect(doc).not.toBeNull();
            expect(doc._id).toBe('tower_1');
            expect(doc.id).toBe('tower_1');
        });

        it('with index option returns the N-th object', async () => {
            const doc = await helpers.findOne({ room: 'W0N1', type: 'source' }, { index: 0 });
            expect(doc._id).toBe('src_1');
        });

        it('index out of bounds returns null', async () => {
            const doc = await helpers.findOne({ room: 'W0N1', type: 'source' }, { index: 10 });
            expect(doc).toBeNull();
        });

        it('returns null if nothing is found', async () => {
            const doc = await helpers.findOne({ room: 'W0N1', type: 'invalid' });
            expect(doc).toBeNull();
        });
    });

    describe('findIds', () => {
        it('returns array of _id', async () => {
            const ids = await helpers.findIds({ room: 'W0N1', type: 'source' });
            expect(ids).toEqual(['src_1']);
        });

        it('maps id → _id', async () => {
            const ids = await helpers.findIds({ id: 'tower_1' });
            expect(ids).toEqual(['tower_1']);
        });
    });

    describe('findId', () => {
        it('returns _id of the first matching object', async () => {
            const id = await helpers.findId({ room: 'W0N1', type: 'tower' });
            expect(id).toBe('tower_1');
        });

        it('with index option returns the N-th _id', async () => {
            const id = await helpers.findId({ room: 'W0N1', type: 'source' }, { index: 0 });
            expect(id).toBe('src_1');
        });

        it('index out of bounds returns null', async () => {
            const id = await helpers.findId({ room: 'W0N1' }, { index: 100 });
            expect(id).toBeNull();
        });

        it('returns null if nothing is found', async () => {
            const id = await helpers.findId({ room: 'W0N1', type: 'invalid' });
            expect(id).toBeNull();
        });
    });
});
