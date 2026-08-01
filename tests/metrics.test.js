'use strict';

/**
 * Unit tests for metrics.js — collectMetrics, groupCreepsByRole, sampleMetrics.
 *
 * Cover:
 * - collectMetrics: computes all room metrics from rooms.objects
 * - collectMetrics: energyAvailable/energyCapacity sums across extensions + spawns
 * - collectMetrics: handles rooms without a controller (rcl = 0)
 * - collectMetrics: creepsByRole strips numeric suffixes, keeps internal underscores,
 *   and groups unnamed creeps as unknown
 * - sampleMetrics: appends a room sample to MetricsReport
 *
 * @file Unit tests for metrics.js
 */

const { collectMetrics, sampleMetrics } = require('../src/lib/observers/metrics');

const STRUCTURE_SPAWN = 'spawn';
const STRUCTURE_TOWER = 'tower';
const STRUCTURE_EXTENSION = 'extension';
const STRUCTURE_CONTROLLER = 'controller';
const STRUCTURE_STORAGE = 'storage';
const STRUCTURE_CONTAINER = 'container';
const TYPE_CREEPS = 'creep';

// ─── Fake DB ──────────────────────────────────────────────────────────────

function createFakeAdapter(objects) {
    return {
        db: {
            'rooms.objects': {
                find: jest.fn(async (query) => objects.filter((o) => o.room === query.room)),
            },
        },
    };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────

const ROOM_OBJECTS = [
    { room: 'W0N1', type: STRUCTURE_CONTROLLER, level: 3, progress: 500, hits: 1000 },
    {
        room: 'W0N1',
        type: STRUCTURE_SPAWN,
        name: 'S1',
        hits: 5000,
        hitsMax: 5000,
        store: { energy: 100 },
        storeCapacityResource: { energy: 300 },
    },
    {
        room: 'W0N1',
        type: STRUCTURE_SPAWN,
        name: 'S2',
        hits: 4000,
        hitsMax: 5000,
        store: { energy: 50 },
        storeCapacityResource: { energy: 300 },
    },
    {
        room: 'W0N1',
        type: STRUCTURE_EXTENSION,
        hits: 100,
        store: { energy: 25 },
        storeCapacityResource: { energy: 50 },
    },
    { room: 'W0N1', type: STRUCTURE_EXTENSION, hits: 100, store: { energy: 0 }, storeCapacityResource: { energy: 50 } },
    {
        room: 'W0N1',
        type: STRUCTURE_TOWER,
        hits: 3000,
        hitsMax: 3000,
        store: { energy: 200 },
        storeCapacityResource: { energy: 1000 },
    },
    { room: 'W0N1', type: STRUCTURE_STORAGE, store: { energy: 700 } },
    { room: 'W0N1', type: STRUCTURE_CONTAINER, store: { energy: 80 } },
    { room: 'W0N1', type: TYPE_CREEPS, name: 'harvester_1', hits: 300 },
    { room: 'W0N1', type: TYPE_CREEPS, name: 'harvester_2', hits: 300 },
    { room: 'W0N1', type: TYPE_CREEPS, name: 'builder', hits: 300 },
    { room: 'W0N1', type: TYPE_CREEPS, name: 'mine_carrier_1', hits: 300 },
    { room: 'W0N1', type: TYPE_CREEPS, hits: 300 },
    { room: 'OTHER', type: STRUCTURE_SPAWN, store: { energy: 999 } },
];

// ─── collectMetrics ───────────────────────────────────────────────────────

describe('collectMetrics', () => {
    it('computes room metrics from rooms.objects', async () => {
        const adapter = createFakeAdapter(ROOM_OBJECTS);
        const m = await collectMetrics(adapter, 'W0N1');

        expect(adapter.db['rooms.objects'].find).toHaveBeenCalledWith({ room: 'W0N1' });
        expect(m.rcl).toBe(3);
        expect(m.rclProgress).toBe(500);
        expect(m.spawnCount).toBe(2);
        expect(m.towerCount).toBe(1);
        expect(m.extensionCount).toBe(2);
        expect(m.creepCount).toBe(5);
        expect(m.storageEnergy).toBe(700);
        expect(m.containerEnergy).toBe(80);
        // energyAvailable = extensions (25 + 0) + spawns (100 + 50)
        expect(m.energyAvailable).toBe(175);
        // energyCapacity = extensions (50 + 50) + spawns (300 + 300)
        expect(m.energyCapacity).toBe(700);
        expect(m.towerEnergy).toBe(200);
        expect(m.towerCapacity).toBe(1000);
        expect(m.spawnHits).toEqual([
            { name: 'S1', hits: 5000, hitsMax: 5000 },
            { name: 'S2', hits: 4000, hitsMax: 5000 },
        ]);
        expect(m.totalHits).toBe(1000 + 5000 + 4000 + 100 + 100 + 3000 + 300 * 5);
        // harvester_1/_2 -> harvester, mine_carrier_1 -> mine_carrier,
        // builder stays, unnamed -> unknown
        expect(m.creepsByRole).toEqual({ harvester: 2, builder: 1, unknown: 1, mine_carrier: 1 });
    });

    it('handles a room without a controller (rcl = 0)', async () => {
        const adapter = createFakeAdapter([{ room: 'W0N1', type: TYPE_CREEPS, name: 'x' }]);
        const m = await collectMetrics(adapter, 'W0N1');
        expect(m.rcl).toBe(0);
        expect(m.rclProgress).toBe(0);
        expect(m.energyAvailable).toBe(0);
        expect(m.energyCapacity).toBe(0);
        expect(m.creepCount).toBe(1);
    });
});

// ─── sampleMetrics ────────────────────────────────────────────────────────

describe('sampleMetrics', () => {
    it('appends a room sample to MetricsReport', () => {
        const metricsReport = { append: jest.fn() };
        const metrics = { rcl: 2 };
        sampleMetrics(metricsReport, 'W0N1', metrics, 5);
        expect(metricsReport.append).toHaveBeenCalledWith('rooms', 'W0N1', 5, metrics);
    });
});
