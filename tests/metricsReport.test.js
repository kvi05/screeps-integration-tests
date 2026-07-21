'use strict';

const { MetricsReport } = require('../src/lib/metricsReport');

describe('MetricsReport', () => {
    describe('constructor', () => {
        it('creates an empty structure', () => {
            const m = new MetricsReport();
            expect(m.rooms).toEqual({});
            expect(m.colonies).toEqual({});
            expect(m.bots).toEqual({});
            expect(m.world).toEqual([]);
        });
    });

    describe('append', () => {
        it('appends a sample to rooms', () => {
            const m = new MetricsReport();
            const sample = m.append('rooms', 'W0N1', 100, { rcl: 2 });

            expect(sample).toEqual({ tick: 100, rcl: 2 });
            expect(m.rooms.W0N1).toEqual([{ tick: 100, rcl: 2 }]);
        });

        it('does not mutate the input values object', () => {
            const m = new MetricsReport();
            const values = { rcl: 2 };
            m.append('rooms', 'W0N1', 100, values);
            expect(values).toEqual({ rcl: 2 });
        });

        it('works for multiple rooms', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { rcl: 2 });
            m.append('rooms', 'W0N2', 100, { rcl: 1 });

            expect(m.rooms.W0N1).toEqual([{ tick: 100, rcl: 2 }]);
            expect(m.rooms.W0N2).toEqual([{ tick: 100, rcl: 1 }]);
        });

        it('accumulates multiple samples for one room', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { rcl: 2 });
            m.append('rooms', 'W0N1', 200, { rcl: 3 });

            expect(m.rooms.W0N1).toEqual([
                { tick: 100, rcl: 2 },
                { tick: 200, rcl: 3 },
            ]);
        });

        it('writes to world', () => {
            const m = new MetricsReport();
            m.append('world', 'world', 100, { roomCount: 2 });
            expect(m.world).toEqual([{ tick: 100, roomCount: 2 }]);
        });

        it('preserves nested object creepsByRole', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { creepsByRole: { harvester: 2, upgrader: 1 } });
            expect(m.rooms.W0N1[0].creepsByRole).toEqual({ harvester: 2, upgrader: 1 });
        });

        it('throws on invalid entityType', () => {
            const m = new MetricsReport();
            expect(() => m.append('invalid', 'W0N1', 100, {})).toThrow(/entityType/);
        });

        it('throws on empty entityId for map entity', () => {
            const m = new MetricsReport();
            expect(() => m.append('rooms', '', 100, {})).toThrow(/entityId/);
        });

        it('throws on negative tick', () => {
            const m = new MetricsReport();
            expect(() => m.append('rooms', 'W0N1', -1, {})).toThrow(/tick/);
        });

        it('throws on non-numeric tick', () => {
            const m = new MetricsReport();
            expect(() => m.append('rooms', 'W0N1', NaN, {})).toThrow(/tick/);
        });
    });

    describe('query helpers', () => {
        /** @returns {MetricsReport} */
        function makeMetrics() {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { rcl: 2, energy: 1200 });
            m.append('rooms', 'W0N1', 200, { rcl: 3, energy: 1500 });
            m.append('rooms', 'W0N2', 100, { rcl: 1, energy: 300 });
            m.append('world', 'world', 100, { roomCount: 2 });
            return m;
        }

        it('series returns [] for missing entity', () => {
            const m = makeMetrics();
            expect(m.series('rooms', 'W99N99')).toEqual([]);
        });

        it('room() ≡ series("rooms", …)', () => {
            const m = makeMetrics();
            expect(m.room('W0N1')).toBe(m.series('rooms', 'W0N1'));
        });

        it('colony() / bot() — wrappers', () => {
            const m = new MetricsReport();
            m.append('colonies', 'c1', 100, { stage: 1 });
            m.append('bots', 'b1', 100, { cpu: 10 });
            expect(m.colony('c1')).toEqual([{ tick: 100, stage: 1 }]);
            expect(m.bot('b1')).toEqual([{ tick: 100, cpu: 10 }]);
        });

        it('latest() returns the last sample', () => {
            const m = makeMetrics();
            expect(m.latest('rooms', 'W0N1')).toEqual({ tick: 200, rcl: 3, energy: 1500 });
        });

        it('latestRoom() / latestColony() / latestBot() — wrappers', () => {
            const m = makeMetrics();
            expect(m.latestRoom('W0N1')).toEqual(m.latest('rooms', 'W0N1'));
        });

        it('atTick() finds a sample at a specific tick', () => {
            const m = makeMetrics();
            expect(m.atTick('rooms', 'W0N1', 100)).toEqual({ tick: 100, rcl: 2, energy: 1200 });
        });

        it('atTick() returns undefined for missing tick', () => {
            const m = makeMetrics();
            expect(m.atTick('rooms', 'W0N1', 999)).toBeUndefined();
        });

        it('snapshotAtTick() collects a snapshot of all rooms at tick', () => {
            const m = makeMetrics();
            const snap = m.snapshotAtTick('rooms', 100);
            expect(snap.W0N1).toEqual({ tick: 100, rcl: 2, energy: 1200 });
            expect(snap.W0N2).toEqual({ tick: 100, rcl: 1, energy: 300 });
        });

        it('snapshotAtTick() does not include rooms without a sample at tick', () => {
            const m = makeMetrics();
            const snap = m.snapshotAtTick('rooms', 200);
            expect(snap.W0N1).toBeDefined();
            expect(snap.W0N2).toBeUndefined();
        });
    });

    describe('aggregation', () => {
        it('values() filters only numbers', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { rcl: 2, desc: 'hello', flag: true, nest: { a: 1 } });
            const vals = m.values(m.room('W0N1'), 'rcl');
            expect(vals).toEqual([{ tick: 100, value: 2 }]);
        });

        it('average() calculates the mean', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { energy: 100 });
            m.append('rooms', 'W0N1', 200, { energy: 200 });
            expect(m.average(m.room('W0N1'), 'energy')).toBe(150);
        });

        it('average() returns undefined for empty series', () => {
            const m = new MetricsReport();
            expect(m.average([], 'energy')).toBeUndefined();
        });

        it('sum() adds up values', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { energy: 100 });
            m.append('rooms', 'W0N1', 200, { energy: 200 });
            expect(m.sum(m.room('W0N1'), 'energy')).toBe(300);
        });

        it('delta() = last - first', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { rcl: 2 });
            m.append('rooms', 'W0N1', 200, { rcl: 4 });
            expect(m.delta(m.room('W0N1'), 'rcl')).toBe(2);
        });

        it('delta() returns undefined with < 2 samples', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { rcl: 2 });
            expect(m.delta(m.room('W0N1'), 'rcl')).toBeUndefined();
        });

        it('rate() calculates change per tick', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { rcl: 2 });
            m.append('rooms', 'W0N1', 200, { rcl: 4 });
            // (4 - 2) / (200 - 100) = 0.02
            expect(m.rate(m.room('W0N1'), 'rcl')).toBe(0.02);
        });

        it('rate() returns undefined with < 2 samples', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { rcl: 2 });
            expect(m.rate(m.room('W0N1'), 'rcl')).toBeUndefined();
        });
    });

    describe('CSV export', () => {
        /** @returns {MetricsReport} */
        function makeMetrics() {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 200, {
                rcl: 3,
                energy: 1500,
                creepsByRole: { harvester: 2, upgrader: 1 },
                spawnHits: [{ name: 'Spawn1', hits: 3000, hitsMax: 3000 }],
            });
            m.append('rooms', 'W0N1', 100, {
                rcl: 2,
                energy: 1200,
                creepsByRole: { harvester: 1 },
            });
            m.append('rooms', 'W0N2', 100, { rcl: 1, energy: 300 });
            m.append('world', 'world', 100, { roomCount: 2 });
            return m;
        }

        it('flatten returns empty array for empty report', () => {
            const m = new MetricsReport();
            expect(m.flatten()).toEqual([]);
        });

        it('flatten returns flat rows for all entities', () => {
            const rows = makeMetrics().flatten();
            expect(rows.length).toBeGreaterThan(0);
            expect(rows.some((r) => r.entityType === 'rooms' && r.entityId === 'W0N1')).toBe(true);
            expect(rows.some((r) => r.entityType === 'world')).toBe(true);
        });

        it('flatten sorts rows', () => {
            const rows = makeMetrics().flatten();
            const keys = rows.map((r) => `${r.entityType}|${r.entityId}|${r.tick}|${r.metric}`);
            expect(keys).toEqual([...keys].sort());
        });

        it('flatten expands creepsByRole', () => {
            const rows = makeMetrics().flatten();
            expect(rows.some((r) => r.metric === 'creepsByRole.harvester' && r.value === 2)).toBe(true);
            expect(rows.some((r) => r.metric === 'creepsByRole.upgrader' && r.value === 1)).toBe(true);
        });

        it('flatten excludes spawnHits (not scalar)', () => {
            const rows = makeMetrics().flatten();
            expect(rows.some((r) => r.metric === 'spawnHits')).toBe(false);
        });

        it('flatten filters by entityTypes', () => {
            const rows = makeMetrics().flatten({ entityTypes: ['world'] });
            expect(rows.every((r) => r.entityType === 'world')).toBe(true);
        });

        it('flatten filters by metrics', () => {
            const rows = makeMetrics().flatten({ metrics: ['rcl'] });
            expect(rows.every((r) => r.metric === 'rcl')).toBe(true);
        });

        it('toCsvRows includes header', () => {
            const lines = makeMetrics().toCsvRows();
            expect(lines[0]).toBe('entityType,entityId,tick,metric,value');
        });

        it('toCsv returns a string with newlines', () => {
            const csv = makeMetrics().toCsv();
            const lines = csv.split('\n');
            expect(lines[0]).toBe('entityType,entityId,tick,metric,value');
            expect(lines.length).toBeGreaterThan(1);
        });

        it('escapes commas and quotes', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { note: 'a,b', quote: 'say "hi"' });
            const csv = m.toCsv();
            expect(csv).toContain('"a,b"');
            expect(csv).toContain('"say ""hi"""');
        });

        it('does not mutate the original data', () => {
            const m = makeMetrics();
            const before = JSON.stringify(m.toJSON());
            m.toCsv();
            expect(JSON.stringify(m.toJSON())).toBe(before);
        });
    });

    describe('serialization', () => {
        it('toJSON() returns a plain object', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { rcl: 2 });
            const json = m.toJSON();
            expect(json).toEqual({
                rooms: { W0N1: [{ tick: 100, rcl: 2 }] },
                colonies: {},
                bots: {},
                world: [],
            });
        });

        it('fromJSON() restores state', () => {
            const m1 = new MetricsReport();
            m1.append('rooms', 'W0N1', 100, { rcl: 2 });

            const json = m1.toJSON();
            const m2 = MetricsReport.fromJSON(json);

            expect(m2.series('rooms', 'W0N1')).toEqual([{ tick: 100, rcl: 2 }]);
        });

        it('fromJSON() with partial data (rooms only)', () => {
            const m2 = MetricsReport.fromJSON({
                rooms: { W0N1: [{ tick: 100, rcl: 2 }] },
            });

            expect(m2.series('rooms', 'W0N1')).toEqual([{ tick: 100, rcl: 2 }]);
            expect(m2.colonies).toEqual({});
            expect(m2.bots).toEqual({});
            expect(m2.world).toEqual([]);
        });

        it('JSON.stringify uses toJSON()', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { rcl: 2 });
            const str = JSON.stringify(m);
            expect(str).toContain('"rooms"');
            expect(str).toContain('"W0N1"');
        });
    });

    describe('resolveConfig', () => {
        it('returns default configuration', () => {
            const cfg = MetricsReport.resolveConfig({});
            expect(cfg).toEqual({ every: 0, rooms: true, colonies: false, bots: false, world: false });
        });

        it('throws on unimplemented types', () => {
            expect(() => MetricsReport.resolveConfig({ metrics: { colonies: true } })).toThrow(/colonies/);
        });
    });

    describe('getters', () => {
        it('return internal structures', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, {});
            expect(m.rooms.W0N1).toBeDefined();
            expect(m.colonies).toEqual({});
            expect(m.bots).toEqual({});
            expect(m.world).toEqual([]);
        });
    });
});
