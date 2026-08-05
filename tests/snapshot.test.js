'use strict';

/**
 * Unit tests for snapshot.js — collectSnapshot.
 *
 * Cover:
 * - Objects from all rooms are collected
 * - Optional fields are serialized
 * - Terrain is collected and cached (not re-fetched)
 * - Empty rooms produce empty frames
 *
 * @file Unit tests for observers/snapshot.js
 */

const { collectSnapshot, clearTerrainCache } = require('../src/lib/observers/snapshot');

// ─── Fake DB ──────────────────────────────────────────────────────────────

function createFakeCollection(initialDocs) {
    const state = initialDocs.map((d) => ({ ...d }));
    return {
        find(query) {
            return Promise.resolve(state.filter((d) => matches(d, query)));
        },
    };
}

function matches(doc, query) {
    for (const key of Object.keys(query)) {
        if (doc[key] !== query[key]) return false;
    }
    return true;
}

/**
 * @param {Object[]} objects
 * @param {Object<string, string[]>} [terrainForRoom]
 * @returns {Object} fake adapter
 */
function createFakeAdapter(objects, terrainForRoom = {}) {
    return {
        db: {
            'rooms.objects': createFakeCollection(objects),
        },
        world: {
            getTerrain(name) {
                const rows = terrainForRoom[name];
                if (!rows) {
                    const err = new Error('no terrain');
                    err.name = 'NotFoundError';
                    return Promise.reject(err);
                }
                return Promise.resolve({
                    get(x, y) {
                        const ch = rows[y] ? rows[y][x] : '.';
                        if (ch === '#') return 1;
                        if (ch === '~') return 2;
                        return 0;
                    },
                });
            },
        },
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Generate default terrain rows (50×50 all plain).
 * @returns {string[]}
 */
function plainsTerrain() {
    const rows = [];
    for (let y = 0; y < 50; y++) {
        rows.push('.'.repeat(50));
    }
    return rows;
}

function makeRoomStatus(roomNames) {
    /** @type {Object<string, *>} */
    const status = {};
    for (const name of roomNames) {
        status[name] = { name, ticks: 0, events: 0, ids: {}, canonical: { name } };
    }
    return status;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('collectSnapshot', () => {
    beforeEach(() => {
        clearTerrainCache();
    });

    afterAll(() => {
        clearTerrainCache();
    });
    it('collects objects from a single room', async () => {
        const adapter = createFakeAdapter(
            [
                {
                    _id: 'spawn_1',
                    type: 'spawn',
                    x: 10,
                    y: 10,
                    room: 'W0N1',
                    user: 'bot_123',
                    hits: 5000,
                    hitsMax: 5000,
                },
                { _id: 'src_1', type: 'source', x: 5, y: 20, room: 'W0N1', energy: 3000, energyCapacity: 3000 },
            ],
            { W0N1: plainsTerrain() },
        );

        const roomStatus = makeRoomStatus(['W0N1']);
        const frame = await collectSnapshot(adapter, roomStatus, {}, 42);

        expect(frame.gameTime).toBe(42);
        expect(frame.objects).toHaveLength(2);

        const spawn = frame.objects.find((o) => o.type === 'spawn');
        expect(spawn).toBeDefined();
        expect(spawn._id).toBe('spawn_1');
        expect(spawn.user).toBe('bot_123');
        expect(spawn.hits).toBe(5000);
        expect(spawn.hitsMax).toBe(5000);

        const source = frame.objects.find((o) => o.type === 'source');
        expect(source).toBeDefined();
        expect(source.energy).toBe(3000);
        expect(source.energyCapacity).toBe(3000);
        expect(source.user).toBeUndefined();

        expect(frame.terrain).toBeDefined();
        expect(Object.keys(frame.terrain)).toHaveLength(1);
        expect(frame.terrain.W0N1).toHaveLength(50);
    });

    it('collects objects from multiple rooms', async () => {
        const adapter = createFakeAdapter(
            [
                { _id: 'spawn_1', type: 'spawn', x: 10, y: 10, room: 'W0N1' },
                { _id: 'spawn_2', type: 'spawn', x: 10, y: 10, room: 'W0N2' },
                { _id: 'src_1', type: 'source', x: 5, y: 20, room: 'W0N1' },
                { _id: 'src_2', type: 'source', x: 25, y: 30, room: 'W0N2' },
            ],
            { W0N1: plainsTerrain(), W0N2: plainsTerrain() },
        );

        const roomStatus = makeRoomStatus(['W0N1', 'W0N2']);
        const frame = await collectSnapshot(adapter, roomStatus, {}, 0);

        expect(frame.objects).toHaveLength(4);
        expect(frame.terrain).toBeDefined();
        expect(Object.keys(frame.terrain)).toHaveLength(2);
    });

    it('returns empty objects array for room with no objects', async () => {
        const adapter = createFakeAdapter([], { W0N1: plainsTerrain() });

        const roomStatus = makeRoomStatus(['W0N1']);
        const frame = await collectSnapshot(adapter, roomStatus, {}, 0);

        expect(frame.objects).toHaveLength(0);
        expect(frame.gameTime).toBe(0);
        expect(frame.terrain).toBeDefined();
    });

    it('omits terrain key when no rooms have terrain', async () => {
        const adapter = createFakeAdapter([], {});

        const roomStatus = makeRoomStatus(['W0N1']);
        const frame = await collectSnapshot(adapter, roomStatus, {}, 0);

        expect(frame.terrain).toBeUndefined();
    });

    it('serialises all optional fields on a creep', async () => {
        const adapter = createFakeAdapter(
            [
                {
                    _id: 'creep_1',
                    type: 'creep',
                    x: 15,
                    y: 15,
                    room: 'W0N1',
                    user: 'bot_123',
                    hits: 700,
                    hitsMax: 700,
                    store: { energy: 50 },
                    storeCapacity: 50,
                    storeCapacityResource: { energy: 50 },
                    body: [
                        { type: 'work', hits: 100 },
                        { type: 'move', hits: 100 },
                    ],
                    name: 'harvester1',
                    actionLog: { harvest: { x: 5, y: 20 } },
                    spawning: false,
                    ticksToSpawn: undefined,
                    ageTime: 1500,
                    decayTime: undefined,
                },
            ],
            { W0N1: plainsTerrain() },
        );

        const roomStatus = makeRoomStatus(['W0N1']);
        const frame = await collectSnapshot(adapter, roomStatus, {}, 1);

        const creep = frame.objects[0];
        expect(creep.type).toBe('creep');
        expect(creep.user).toBe('bot_123');
        expect(creep.hits).toBe(700);
        expect(creep.store).toEqual({ energy: 50 });
        expect(creep.body).toEqual([
            { type: 'work', hits: 100 },
            { type: 'move', hits: 100 },
        ]);
        expect(creep.name).toBe('harvester1');
        expect(creep.actionLog).toEqual({ harvest: { x: 5, y: 20 } });
        expect(creep.spawning).toBe(false);
        expect(creep.ageTime).toBe(1500);
        // Fields that are undefined on the object should NOT appear
        expect(creep.ticksToSpawn).toBeUndefined();
        expect(creep.decayTime).toBeUndefined();
    });

    it('uses obj.id as fallback when _id is missing', async () => {
        const adapter = createFakeAdapter([{ id: 'legacy_1', type: 'road', x: 5, y: 5, room: 'W0N1' }], {
            W0N1: plainsTerrain(),
        });

        const roomStatus = makeRoomStatus(['W0N1']);
        const frame = await collectSnapshot(adapter, roomStatus, {}, 0);

        expect(frame.objects[0]._id).toBe('legacy_1');
    });

    // ── Terrain caching ──────────────────────────────────────────────────────

    it('caches terrain — getTerrain called once per room across two calls', async () => {
        let getTerrainCalls = 0;
        const adapter = {
            db: {
                'rooms.objects': createFakeCollection([]),
            },
            world: {
                getTerrain(_name) {
                    getTerrainCalls++;
                    return Promise.resolve({
                        get(_x, _y) {
                            return 0;
                        },
                    });
                },
            },
        };

        const roomStatus = makeRoomStatus(['W0N1']);

        // First call — terrain is fetched
        await collectSnapshot(adapter, roomStatus, {}, 0);
        expect(getTerrainCalls).toBe(1);

        // Second call — terrain is from cache
        await collectSnapshot(adapter, roomStatus, {}, 1);
        expect(getTerrainCalls).toBe(1); // still 1 — cached!
    });

    it('does not include terrain for rooms where getTerrain throws', async () => {
        const adapter = createFakeAdapter(
            [{ _id: 'src_1', type: 'source', x: 5, y: 20, room: 'W0N1' }],
            {}, // No terrain for W0N1
        );

        const roomStatus = makeRoomStatus(['W0N1']);
        const frame = await collectSnapshot(adapter, roomStatus, {}, 0);

        expect(frame.objects).toHaveLength(1);
        expect(frame.terrain).toBeUndefined();
    });
});
