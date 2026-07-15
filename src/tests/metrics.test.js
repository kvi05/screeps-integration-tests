'use strict';

const {
    createMetricsReport,
    appendMetricSample,
    appendWorldSample,
    resolveMetricsConfig,
    getMetricSeries,
    getRoomMetrics,
    getLatestMetric,
    getLatestRoomMetrics,
    getMetricAtTick,
    getWorldSnapshotAtTick,
    getMetricValues,
    averageMetric,
    sumMetric,
    deltaMetric,
    rateMetric,
} = require('../lib/metrics');

describe('metrics (recorder + query + aggregation)', () => {
    describe('recorder', () => {
        it('createMetricsReport возвращает стабильную пустую структуру', () => {
            const report = createMetricsReport();
            expect(report).toEqual({
                rooms: {},
                colonies: {},
                bots: {},
                world: [],
            });
        });

        it('appendMetricSample создаёт series для новой комнаты', () => {
            const metrics = createMetricsReport();
            const sample = appendMetricSample(metrics, 'rooms', 'W0N1', 100, { rcl: 2 });

            expect(sample).toEqual({ tick: 100, rcl: 2 });
            expect(metrics.rooms.W0N1).toEqual([{ tick: 100, rcl: 2 }]);
        });

        it('appendMetricSample не мутирует входной объект values', () => {
            const metrics = createMetricsReport();
            const values = { rcl: 2 };
            appendMetricSample(metrics, 'rooms', 'W0N1', 100, values);

            expect(values).toEqual({ rcl: 2 });
        });

        it('appendMetricSample работает для нескольких комнат', () => {
            const metrics = createMetricsReport();
            appendMetricSample(metrics, 'rooms', 'W0N1', 100, { rcl: 2 });
            appendMetricSample(metrics, 'rooms', 'W0N2', 100, { rcl: 1 });

            expect(metrics.rooms.W0N1).toEqual([{ tick: 100, rcl: 2 }]);
            expect(metrics.rooms.W0N2).toEqual([{ tick: 100, rcl: 1 }]);
        });

        it('appendMetricSample накапливает несколько сэмплов одной комнаты', () => {
            const metrics = createMetricsReport();
            appendMetricSample(metrics, 'rooms', 'W0N1', 100, { rcl: 2 });
            appendMetricSample(metrics, 'rooms', 'W0N1', 200, { rcl: 3 });

            expect(metrics.rooms.W0N1).toEqual([
                { tick: 100, rcl: 2 },
                { tick: 200, rcl: 3 },
            ]);
        });

        it('appendWorldSample записывает в report.world', () => {
            const metrics = createMetricsReport();
            appendWorldSample(metrics, 100, { roomCount: 2 });

            expect(metrics.world).toEqual([{ tick: 100, roomCount: 2 }]);
        });

        it('appendMetricSample сохраняет вложенный объект creepsByRole', () => {
            const metrics = createMetricsReport();
            appendMetricSample(metrics, 'rooms', 'W0N1', 100, {
                creepsByRole: { harvester: 2, upgrader: 1 },
            });

            expect(metrics.rooms.W0N1[0].creepsByRole).toEqual({ harvester: 2, upgrader: 1 });
        });

        it('appendMetricSample бросает при недопустимом entityType', () => {
            const metrics = createMetricsReport();
            expect(() => appendMetricSample(metrics, 'invalid', 'W0N1', 100, {})).toThrow(/entityType/);
        });

        it('appendMetricSample бросает при пустом entityId для map-сущности', () => {
            const metrics = createMetricsReport();
            expect(() => appendMetricSample(metrics, 'rooms', '', 100, {})).toThrow(/entityId/);
        });

        it('appendMetricSample бросает при отрицательном tick', () => {
            const metrics = createMetricsReport();
            expect(() => appendMetricSample(metrics, 'rooms', 'W0N1', -1, {})).toThrow(/tick/);
        });

        it('appendMetricSample бросает при нечисловом tick', () => {
            const metrics = createMetricsReport();
            expect(() => appendMetricSample(metrics, 'rooms', 'W0N1', '100', {})).toThrow(/tick/);
        });
    });

    describe('resolveMetricsConfig', () => {
        it('возвращает defaults, если metrics не заданы', () => {
            expect(resolveMetricsConfig({})).toEqual({ every: 0, rooms: true });
        });

        it('rooms=false отключает сбор комнат', () => {
            expect(resolveMetricsConfig({ metrics: { every: 10, rooms: false } })).toEqual({ every: 10, rooms: false });
        });

        it('бросает при неподдерживаемом флаге colonies', () => {
            expect(() => resolveMetricsConfig({ metrics: { colonies: true } })).toThrow(/colonies/);
        });

        it('бросает при неподдерживаемом флаге bots', () => {
            expect(() => resolveMetricsConfig({ metrics: { bots: true } })).toThrow(/bots/);
        });

        it('бросает при неподдерживаемом флаге world', () => {
            expect(() => resolveMetricsConfig({ metrics: { world: true } })).toThrow(/world/);
        });
    });

    describe('query helpers', () => {
        /** @type {import('../lib/types').WorldReport} */
        let report;

        beforeEach(() => {
            const metrics = createMetricsReport();
            appendMetricSample(metrics, 'rooms', 'W0N1', 100, { rcl: 2, energy: 1200 });
            appendMetricSample(metrics, 'rooms', 'W0N1', 200, { rcl: 3, energy: 1500 });
            appendMetricSample(metrics, 'rooms', 'W0N2', 100, { rcl: 1, energy: 300 });
            appendWorldSample(metrics, 100, { totalRooms: 2 });

            report = { metrics };
        });

        it('getMetricSeries возвращает пустой массив для неизвестной комнаты', () => {
            expect(getMetricSeries(report, 'rooms', 'W99N99')).toEqual([]);
        });

        it('getRoomMetrics возвращает series комнаты', () => {
            expect(getRoomMetrics(report, 'W0N1')).toHaveLength(2);
        });

        it('getLatestMetric возвращает последний сэмпл', () => {
            const latest = getLatestMetric(report, 'rooms', 'W0N1');
            expect(latest).toEqual({ tick: 200, rcl: 3, energy: 1500 });
        });

        it('getLatestMetric возвращает undefined для пустой series', () => {
            expect(getLatestMetric(report, 'rooms', 'W99N99')).toBeUndefined();
        });

        it('getLatestRoomMetrics — обёртка для комнаты', () => {
            expect(getLatestRoomMetrics(report, 'W0N1')).toEqual({ tick: 200, rcl: 3, energy: 1500 });
        });

        it('getMetricAtTick находит сэмпл ровно на тике', () => {
            expect(getMetricAtTick(report, 'rooms', 'W0N1', 100)).toEqual({ tick: 100, rcl: 2, energy: 1200 });
        });

        it('getMetricAtTick не выбирает ближайший тик', () => {
            expect(getMetricAtTick(report, 'rooms', 'W0N1', 150)).toBeUndefined();
        });

        it('getWorldSnapshotAtTick собирает снимок комнат на тике', () => {
            const snapshot = getWorldSnapshotAtTick(report, 100);
            expect(snapshot).toEqual({
                W0N1: { tick: 100, rcl: 2, energy: 1200 },
                W0N2: { tick: 100, rcl: 1, energy: 300 },
            });
        });

        it('getWorldSnapshotAtTick не включает комнаты без sample на тике', () => {
            const snapshot = getWorldSnapshotAtTick(report, 200);
            expect(snapshot).toEqual({
                W0N1: { tick: 200, rcl: 3, energy: 1500 },
            });
        });

        it('query helpers не мутируют report', () => {
            const before = JSON.stringify(report);
            getMetricSeries(report, 'rooms', 'W0N1');
            getLatestMetric(report, 'rooms', 'W0N1');
            getMetricAtTick(report, 'rooms', 'W0N1', 100);
            getWorldSnapshotAtTick(report, 100);
            expect(JSON.stringify(report)).toBe(before);
        });
    });

    describe('aggregation helpers', () => {
        /** @type {import('../lib/types').MetricSeries} */
        let series;

        beforeEach(() => {
            series = [
                { tick: 100, rcl: 2, energy: 1000, broken: 'x' },
                { tick: 200, rcl: 3, energy: 1500 },
                { tick: 300, rcl: 3, energy: null },
                { tick: 400, rcl: 4, energy: 2000 },
            ];
        });

        it('averageMetric пропускает отсутствующие и нечисловые значения', () => {
            expect(averageMetric(series, 'energy')).toBe(1500);
        });

        it('averageMetric возвращает undefined, если нет валидных значений', () => {
            expect(averageMetric(series, 'missing')).toBeUndefined();
            expect(averageMetric(series, 'broken')).toBeUndefined();
        });

        it('sumMetric суммирует числовые значения', () => {
            expect(sumMetric(series, 'energy')).toBe(4500);
        });

        it('deltaMetric — разница последнего и первого значения', () => {
            expect(deltaMetric(series, 'energy')).toBe(1000);
        });

        it('deltaMetric возвращает undefined при менее двух валидных значений', () => {
            expect(deltaMetric([{ tick: 100, energy: 1000 }], 'energy')).toBeUndefined();
        });

        it('rateMetric считает изменение на тик', () => {
            expect(rateMetric(series, 'energy')).toBe(1000 / 300);
        });

        it('rateMetric возвращает undefined при одинаковых ticks', () => {
            const sameTickSeries = [
                { tick: 100, energy: 1000 },
                { tick: 100, energy: 2000 },
            ];
            expect(rateMetric(sameTickSeries, 'energy')).toBeUndefined();
        });

        it('rateMetric возвращает undefined при менее двух валидных значений', () => {
            expect(rateMetric([{ tick: 100, energy: 1000 }], 'energy')).toBeUndefined();
        });

        it('getMetricValues сохраняет тики', () => {
            expect(getMetricValues(series, 'energy')).toEqual([
                { tick: 100, value: 1000 },
                { tick: 200, value: 1500 },
                { tick: 400, value: 2000 },
            ]);
        });
    });
});
