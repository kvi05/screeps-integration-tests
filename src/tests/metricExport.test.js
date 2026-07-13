'use strict';

const { createMetricsReport, appendMetricSample, appendWorldSample } = require('../lib/metrics');
const { flattenMetricSeries, toCsvRows, toCsv } = require('../lib/metricExport');

describe('metricExport', () => {
    /** @returns {import('../lib/types').WorldReport} */
    function makeReport() {
        const metrics = createMetricsReport();
        appendMetricSample(metrics, 'rooms', 'W0N1', 200, {
            rcl: 3,
            energy: 1500,
            creepsByRole: { harvester: 2, upgrader: 1 },
            spawnHits: [{ name: 'Spawn1', hits: 3000, hitsMax: 3000 }],
        });
        appendMetricSample(metrics, 'rooms', 'W0N1', 100, {
            rcl: 2,
            energy: 1200,
            creepsByRole: { harvester: 1 },
        });
        appendMetricSample(metrics, 'rooms', 'W0N2', 100, { rcl: 1, energy: 300 });
        appendWorldSample(metrics, 100, { roomCount: 2 });
        return { metrics };
    }

    describe('flattenMetricSeries', () => {
        it('возвращает пустой массив для пустого отчёта', () => {
            expect(flattenMetricSeries({ metrics: createMetricsReport() })).toEqual([]);
        });

        it('возвращает плоские строки для всех сущностей', () => {
            const rows = flattenMetricSeries(makeReport());
            expect(rows.length).toBeGreaterThan(0);
            expect(rows.some((r) => r.entityType === 'rooms' && r.entityId === 'W0N1')).toBe(true);
            expect(rows.some((r) => r.entityType === 'world')).toBe(true);
        });

        it('сортирует строки по entityType, entityId, tick, metric', () => {
            const rows = flattenMetricSeries(makeReport());
            const keys = rows.map((r) => `${r.entityType}|${r.entityId}|${r.tick}|${r.metric}`);
            expect(keys).toEqual([...keys].sort());
        });

        it('разворачивает creepsByRole в отдельные метрики', () => {
            const rows = flattenMetricSeries(makeReport());
            expect(rows.some((r) => r.metric === 'creepsByRole.harvester' && r.value === 2)).toBe(true);
            expect(rows.some((r) => r.metric === 'creepsByRole.upgrader' && r.value === 1)).toBe(true);
        });

        it('исключает spawnHits из scalar export', () => {
            const rows = flattenMetricSeries(makeReport());
            expect(rows.some((r) => r.metric === 'spawnHits')).toBe(false);
        });

        it('фильтрует по entityTypes', () => {
            const rows = flattenMetricSeries(makeReport(), { entityTypes: ['world'] });
            expect(rows.every((r) => r.entityType === 'world')).toBe(true);
        });

        it('фильтрует по metrics', () => {
            const rows = flattenMetricSeries(makeReport(), { metrics: ['rcl'] });
            expect(rows.every((r) => r.metric === 'rcl')).toBe(true);
        });
    });

    describe('toCsvRows / toCsv', () => {
        it('toCsvRows включает header', () => {
            const lines = toCsvRows(makeReport());
            expect(lines[0]).toBe('entityType,entityId,tick,metric,value');
        });

        it('toCsv возвращает строку с переносами строк', () => {
            const csv = toCsv(makeReport());
            const lines = csv.split('\n');
            expect(lines[0]).toBe('entityType,entityId,tick,metric,value');
            expect(lines.length).toBeGreaterThan(1);
        });

        it('экранирует запятые и кавычки', () => {
            const metrics = createMetricsReport();
            appendMetricSample(metrics, 'rooms', 'W0N1', 100, { note: 'a,b', quote: 'say "hi"' });
            const csv = toCsv({ metrics });
            expect(csv).toContain('"a,b"');
            expect(csv).toContain('"say ""hi"""');
        });

        it('не мутирует report', () => {
            const report = makeReport();
            const before = JSON.stringify(report);
            toCsv(report);
            expect(JSON.stringify(report)).toBe(before);
        });
    });
});
