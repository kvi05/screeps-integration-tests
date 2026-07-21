'use strict';

const { MetricsReport } = require('../lib/metricsReport');
const { MetricsRegression } = require('../lib/metricRegression');

describe('MetricsRegression', () => {
    /** @type {import('../lib/types').MetricSeries} */
    const seriesData = [
        { tick: 100, cpu: 10 },
        { tick: 200, cpu: 12 },
        { tick: 300, cpu: 14 },
    ];

    /** Creates a MetricsReport with one entity from seriesData */
    function makeBaseline(series) {
        const m = new MetricsReport();
        for (const s of series) {
            m.append('bots', 'bot1', s.tick, { cpu: s.cpu });
        }
        return m;
    }

    describe('compare', () => {
        it('returns passed=true when matching', () => {
            const baseline = makeBaseline(seriesData);
            const current = makeBaseline(seriesData);
            const reg = new MetricsRegression(baseline);

            const result = reg.compare(current, 'bots', 'bot1', 'cpu');
            expect(result.passed).toBe(true);
            expect(result.delta).toBe(0);
        });

        it('respects absolute tolerance', () => {
            const baseline = makeBaseline([{ tick: 100, cpu: 10 }]);
            const current = makeBaseline([{ tick: 100, cpu: 12 }]);
            const reg = new MetricsRegression(baseline);

            expect(reg.compare(current, 'bots', 'bot1', 'cpu', { tolerance: 5 }).passed).toBe(true);
            expect(reg.compare(current, 'bots', 'bot1', 'cpu', { tolerance: 1 }).passed).toBe(false);
        });

        it('respects relative tolerance', () => {
            const baseline = makeBaseline([{ tick: 100, cpu: 100 }]);
            const current = makeBaseline([{ tick: 100, cpu: 110 }]);
            const reg = new MetricsRegression(baseline);

            expect(reg.compare(current, 'bots', 'bot1', 'cpu', { relativeTolerance: 0.15 }).passed).toBe(true);
            expect(reg.compare(current, 'bots', 'bot1', 'cpu', { relativeTolerance: 0.05 }).passed).toBe(false);
        });

        it('direction=increase only allows growth', () => {
            const baseline = makeBaseline([{ tick: 100, cpu: 10 }]);
            const reg = new MetricsRegression(baseline);

            const up = makeBaseline([{ tick: 100, cpu: 12 }]);
            const down = makeBaseline([{ tick: 100, cpu: 8 }]);

            expect(reg.compare(up, 'bots', 'bot1', 'cpu', { direction: 'increase' }).passed).toBe(true);
            expect(reg.compare(down, 'bots', 'bot1', 'cpu', { direction: 'increase' }).passed).toBe(false);
        });

        it('direction=decrease only allows decline', () => {
            const baseline = makeBaseline([{ tick: 100, cpu: 10 }]);
            const reg = new MetricsRegression(baseline);

            const down = makeBaseline([{ tick: 100, cpu: 8 }]);
            const up = makeBaseline([{ tick: 100, cpu: 12 }]);

            expect(reg.compare(down, 'bots', 'bot1', 'cpu', { direction: 'decrease' }).passed).toBe(true);
            expect(reg.compare(up, 'bots', 'bot1', 'cpu', { direction: 'decrease' }).passed).toBe(false);
        });

        it('aggregator=latest compares the latest values', () => {
            const baseline = makeBaseline([
                { tick: 100, cpu: 10 },
                { tick: 200, cpu: 20 },
            ]);
            const current = makeBaseline([
                { tick: 100, cpu: 100 },
                { tick: 200, cpu: 21 },
            ]);
            const reg = new MetricsRegression(baseline);

            const result = reg.compare(current, 'bots', 'bot1', 'cpu', { aggregator: 'latest', tolerance: 5 });
            expect(result.passed).toBe(true);
            expect(result.actual).toBe(21);
            expect(result.expected).toBe(20);
        });

        it('returns passed=false if there are no valid values', () => {
            const baseline = makeBaseline([{ tick: 100 }]);
            const current = makeBaseline([{ tick: 100 }]);
            const reg = new MetricsRegression(baseline);

            const result = reg.compare(current, 'bots', 'bot1', 'cpu');
            expect(result.passed).toBe(false);
            expect(result.actual).toBeUndefined();
        });

        it('supports window (selectWindow)', () => {
            const baseline = makeBaseline(seriesData);
            const current = makeBaseline(seriesData);
            const reg = new MetricsRegression(baseline);

            const result = reg.compare(current, 'bots', 'bot1', 'cpu', {
                aggregator: 'average',
                window: { startTick: 150, endTick: 250 },
            });
            expect(result.passed).toBe(true);
            expect(result.actual).toBe(12); // average of [{tick:200, cpu:12}]
        });
    });
});
