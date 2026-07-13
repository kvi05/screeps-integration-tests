'use strict';

const { selectWindow, compareMetric } = require('../lib/metricRegression');

describe('metricRegression', () => {
    /** @type {import('../lib/types').MetricSeries} */
    const series = [
        { tick: 100, cpu: 10 },
        { tick: 200, cpu: 12 },
        { tick: 300, cpu: 14 },
    ];

    describe('selectWindow', () => {
        it('выбирает samples внутри окна', () => {
            expect(selectWindow(series, { startTick: 150, endTick: 250 })).toEqual([{ tick: 200, cpu: 12 }]);
        });

        it('возвращает всё, если окно не задано', () => {
            expect(selectWindow(series)).toEqual(series);
        });
    });

    describe('compareMetric', () => {
        it('возвращает passed=true при совпадении', () => {
            const result = compareMetric(series, series, 'cpu');
            expect(result.passed).toBe(true);
            expect(result.delta).toBe(0);
        });

        it('учитывает абсолютный tolerance', () => {
            const baseline = [{ tick: 100, cpu: 10 }];
            const current = [{ tick: 100, cpu: 12 }];
            expect(compareMetric(current, baseline, 'cpu', { tolerance: 5 }).passed).toBe(true);
            expect(compareMetric(current, baseline, 'cpu', { tolerance: 1 }).passed).toBe(false);
        });

        it('учитывает относительный tolerance', () => {
            const baseline = [{ tick: 100, cpu: 100 }];
            const current = [{ tick: 100, cpu: 110 }];
            expect(compareMetric(current, baseline, 'cpu', { relativeTolerance: 0.15 }).passed).toBe(true);
            expect(compareMetric(current, baseline, 'cpu', { relativeTolerance: 0.05 }).passed).toBe(false);
        });

        it('direction=increase разрешает только рост', () => {
            const baseline = [{ tick: 100, cpu: 10 }];
            const currentUp = [{ tick: 100, cpu: 12 }];
            const currentDown = [{ tick: 100, cpu: 8 }];
            expect(compareMetric(currentUp, baseline, 'cpu', { direction: 'increase' }).passed).toBe(true);
            expect(compareMetric(currentDown, baseline, 'cpu', { direction: 'increase' }).passed).toBe(false);
        });

        it('direction=decrease разрешает только падение', () => {
            const baseline = [{ tick: 100, cpu: 10 }];
            const currentDown = [{ tick: 100, cpu: 8 }];
            const currentUp = [{ tick: 100, cpu: 12 }];
            expect(compareMetric(currentDown, baseline, 'cpu', { direction: 'decrease' }).passed).toBe(true);
            expect(compareMetric(currentUp, baseline, 'cpu', { direction: 'decrease' }).passed).toBe(false);
        });

        it('aggregator=latest сравнивает последние значения', () => {
            const baseline = [
                { tick: 100, cpu: 10 },
                { tick: 200, cpu: 20 },
            ];
            const current = [
                { tick: 100, cpu: 100 },
                { tick: 200, cpu: 21 },
            ];
            const result = compareMetric(current, baseline, 'cpu', { aggregator: 'latest', tolerance: 5 });
            expect(result.passed).toBe(true);
            expect(result.actual).toBe(21);
            expect(result.expected).toBe(20);
        });

        it('возвращает passed=false, если нет валидных значений', () => {
            const empty = [{ tick: 100 }];
            const result = compareMetric(empty, empty, 'cpu');
            expect(result.passed).toBe(false);
            expect(result.actual).toBeUndefined();
        });
    });
});
