'use strict';

const { MetricsReport } = require('../lib/metricsReport');

describe('MetricsReport', () => {
    describe('constructor', () => {
        it('создаёт пустую структуру', () => {
            const m = new MetricsReport();
            expect(m.rooms).toEqual({});
            expect(m.colonies).toEqual({});
            expect(m.bots).toEqual({});
            expect(m.world).toEqual([]);
        });
    });

    describe('append', () => {
        it('добавляет сэмпл в rooms', () => {
            const m = new MetricsReport();
            const sample = m.append('rooms', 'W0N1', 100, { rcl: 2 });

            expect(sample).toEqual({ tick: 100, rcl: 2 });
            expect(m.rooms.W0N1).toEqual([{ tick: 100, rcl: 2 }]);
        });

        it('не мутирует входной объект values', () => {
            const m = new MetricsReport();
            const values = { rcl: 2 };
            m.append('rooms', 'W0N1', 100, values);
            expect(values).toEqual({ rcl: 2 });
        });

        it('работает для нескольких комнат', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { rcl: 2 });
            m.append('rooms', 'W0N2', 100, { rcl: 1 });

            expect(m.rooms.W0N1).toEqual([{ tick: 100, rcl: 2 }]);
            expect(m.rooms.W0N2).toEqual([{ tick: 100, rcl: 1 }]);
        });

        it('накапливает несколько сэмплов одной комнаты', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { rcl: 2 });
            m.append('rooms', 'W0N1', 200, { rcl: 3 });

            expect(m.rooms.W0N1).toEqual([
                { tick: 100, rcl: 2 },
                { tick: 200, rcl: 3 },
            ]);
        });

        it('записывает в world', () => {
            const m = new MetricsReport();
            m.append('world', 'world', 100, { roomCount: 2 });
            expect(m.world).toEqual([{ tick: 100, roomCount: 2 }]);
        });

        it('сохраняет вложенный объект creepsByRole', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { creepsByRole: { harvester: 2, upgrader: 1 } });
            expect(m.rooms.W0N1[0].creepsByRole).toEqual({ harvester: 2, upgrader: 1 });
        });

        it('бросает при недопустимом entityType', () => {
            const m = new MetricsReport();
            expect(() => m.append('invalid', 'W0N1', 100, {})).toThrow(/entityType/);
        });

        it('бросает при пустом entityId для map-сущности', () => {
            const m = new MetricsReport();
            expect(() => m.append('rooms', '', 100, {})).toThrow(/entityId/);
        });

        it('бросает при отрицательном tick', () => {
            const m = new MetricsReport();
            expect(() => m.append('rooms', 'W0N1', -1, {})).toThrow(/tick/);
        });

        it('бросает при нечисловом tick', () => {
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

        it('series возвращает [] для отсутствующей сущности', () => {
            const m = makeMetrics();
            expect(m.series('rooms', 'W99N99')).toEqual([]);
        });

        it('room() ≡ series("rooms", …)', () => {
            const m = makeMetrics();
            expect(m.room('W0N1')).toBe(m.series('rooms', 'W0N1'));
        });

        it('colony() / bot() — обёртки', () => {
            const m = new MetricsReport();
            m.append('colonies', 'c1', 100, { stage: 1 });
            m.append('bots', 'b1', 100, { cpu: 10 });
            expect(m.colony('c1')).toEqual([{ tick: 100, stage: 1 }]);
            expect(m.bot('b1')).toEqual([{ tick: 100, cpu: 10 }]);
        });

        it('latest() возвращает последний сэмпл', () => {
            const m = makeMetrics();
            expect(m.latest('rooms', 'W0N1')).toEqual({ tick: 200, rcl: 3, energy: 1500 });
        });

        it('latestRoom() / latestColony() / latestBot() — обёртки', () => {
            const m = makeMetrics();
            expect(m.latestRoom('W0N1')).toEqual(m.latest('rooms', 'W0N1'));
        });

        it('atTick() находит сэмпл на конкретном тике', () => {
            const m = makeMetrics();
            expect(m.atTick('rooms', 'W0N1', 100)).toEqual({ tick: 100, rcl: 2, energy: 1200 });
        });

        it('atTick() возвращает undefined для отсутствующего тика', () => {
            const m = makeMetrics();
            expect(m.atTick('rooms', 'W0N1', 999)).toBeUndefined();
        });

        it('snapshotAtTick() собирает снимок всех комнат на тике', () => {
            const m = makeMetrics();
            const snap = m.snapshotAtTick('rooms', 100);
            expect(snap.W0N1).toEqual({ tick: 100, rcl: 2, energy: 1200 });
            expect(snap.W0N2).toEqual({ tick: 100, rcl: 1, energy: 300 });
        });

        it('snapshotAtTick() не включает комнаты без сэмпла на тике', () => {
            const m = makeMetrics();
            const snap = m.snapshotAtTick('rooms', 200);
            expect(snap.W0N1).toBeDefined();
            expect(snap.W0N2).toBeUndefined();
        });
    });

    describe('aggregation', () => {
        it('values() фильтрует только числа', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { rcl: 2, desc: 'hello', flag: true, nest: { a: 1 } });
            const vals = m.values(m.room('W0N1'), 'rcl');
            expect(vals).toEqual([{ tick: 100, value: 2 }]);
        });

        it('average() считает среднее', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { energy: 100 });
            m.append('rooms', 'W0N1', 200, { energy: 200 });
            expect(m.average(m.room('W0N1'), 'energy')).toBe(150);
        });

        it('average() возвращает undefined для пустой series', () => {
            const m = new MetricsReport();
            expect(m.average([], 'energy')).toBeUndefined();
        });

        it('sum() суммирует значения', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { energy: 100 });
            m.append('rooms', 'W0N1', 200, { energy: 200 });
            expect(m.sum(m.room('W0N1'), 'energy')).toBe(300);
        });

        it('delta() = последнее - первое', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { rcl: 2 });
            m.append('rooms', 'W0N1', 200, { rcl: 4 });
            expect(m.delta(m.room('W0N1'), 'rcl')).toBe(2);
        });

        it('delta() возвращает undefined при < 2 сэмплах', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { rcl: 2 });
            expect(m.delta(m.room('W0N1'), 'rcl')).toBeUndefined();
        });

        it('rate() считает изменение на тик', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { rcl: 2 });
            m.append('rooms', 'W0N1', 200, { rcl: 4 });
            // (4 - 2) / (200 - 100) = 0.02
            expect(m.rate(m.room('W0N1'), 'rcl')).toBe(0.02);
        });

        it('rate() возвращает undefined при < 2 сэмплах', () => {
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

        it('flatten возвращает пустой массив для пустого отчёта', () => {
            const m = new MetricsReport();
            expect(m.flatten()).toEqual([]);
        });

        it('flatten возвращает плоские строки для всех сущностей', () => {
            const rows = makeMetrics().flatten();
            expect(rows.length).toBeGreaterThan(0);
            expect(rows.some((r) => r.entityType === 'rooms' && r.entityId === 'W0N1')).toBe(true);
            expect(rows.some((r) => r.entityType === 'world')).toBe(true);
        });

        it('flatten сортирует строки', () => {
            const rows = makeMetrics().flatten();
            const keys = rows.map((r) => `${r.entityType}|${r.entityId}|${r.tick}|${r.metric}`);
            expect(keys).toEqual([...keys].sort());
        });

        it('flatten разворачивает creepsByRole', () => {
            const rows = makeMetrics().flatten();
            expect(rows.some((r) => r.metric === 'creepsByRole.harvester' && r.value === 2)).toBe(true);
            expect(rows.some((r) => r.metric === 'creepsByRole.upgrader' && r.value === 1)).toBe(true);
        });

        it('flatten исключает spawnHits (не scalar)', () => {
            const rows = makeMetrics().flatten();
            expect(rows.some((r) => r.metric === 'spawnHits')).toBe(false);
        });

        it('flatten фильтрует по entityTypes', () => {
            const rows = makeMetrics().flatten({ entityTypes: ['world'] });
            expect(rows.every((r) => r.entityType === 'world')).toBe(true);
        });

        it('flatten фильтрует по metrics', () => {
            const rows = makeMetrics().flatten({ metrics: ['rcl'] });
            expect(rows.every((r) => r.metric === 'rcl')).toBe(true);
        });

        it('toCsvRows включает header', () => {
            const lines = makeMetrics().toCsvRows();
            expect(lines[0]).toBe('entityType,entityId,tick,metric,value');
        });

        it('toCsv возвращает строку с переносами', () => {
            const csv = makeMetrics().toCsv();
            const lines = csv.split('\n');
            expect(lines[0]).toBe('entityType,entityId,tick,metric,value');
            expect(lines.length).toBeGreaterThan(1);
        });

        it('экранирует запятые и кавычки', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { note: 'a,b', quote: 'say "hi"' });
            const csv = m.toCsv();
            expect(csv).toContain('"a,b"');
            expect(csv).toContain('"say ""hi"""');
        });

        it('не мутирует исходные данные', () => {
            const m = makeMetrics();
            const before = JSON.stringify(m.toJSON());
            m.toCsv();
            expect(JSON.stringify(m.toJSON())).toBe(before);
        });
    });

    describe('serialization', () => {
        it('toJSON() возвращает plain-объект', () => {
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

        it('fromJSON() восстанавливает состояние', () => {
            const m1 = new MetricsReport();
            m1.append('rooms', 'W0N1', 100, { rcl: 2 });

            const json = m1.toJSON();
            const m2 = MetricsReport.fromJSON(json);

            expect(m2.series('rooms', 'W0N1')).toEqual([{ tick: 100, rcl: 2 }]);
        });

        it('fromJSON() с частичными данными (только rooms)', () => {
            const m2 = MetricsReport.fromJSON({
                rooms: { W0N1: [{ tick: 100, rcl: 2 }] },
            });

            expect(m2.series('rooms', 'W0N1')).toEqual([{ tick: 100, rcl: 2 }]);
            expect(m2.colonies).toEqual({});
            expect(m2.bots).toEqual({});
            expect(m2.world).toEqual([]);
        });

        it('JSON.stringify использует toJSON()', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { rcl: 2 });
            const str = JSON.stringify(m);
            expect(str).toContain('"rooms"');
            expect(str).toContain('"W0N1"');
        });
    });

    describe('resolveConfig', () => {
        it('возвращает дефолтную конфигурацию', () => {
            const cfg = MetricsReport.resolveConfig({});
            expect(cfg).toEqual({ every: 0, rooms: true, colonies: false, bots: false, world: false });
        });

        it('бросает при нереализованных типах', () => {
            expect(() => MetricsReport.resolveConfig({ metrics: { colonies: true } })).toThrow(/colonies/);
        });
    });

    describe('геттеры', () => {
        it('возвращают внутренние структуры', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, {});
            expect(m.rooms.W0N1).toBeDefined();
            expect(m.colonies).toEqual({});
            expect(m.bots).toEqual({});
            expect(m.world).toEqual([]);
        });
    });
});
