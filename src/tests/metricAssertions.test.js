'use strict';

const { createMetricsReport, appendMetricSample } = require('../lib/metrics');
const {
    assertHasMetricSamples,
    assertLatestMetricAtLeast,
    assertLatestMetricBelow,
    assertMetricReached,
    assertMetricMonotonic,
} = require('../lib/metricAssertions');

describe('metricAssertions', () => {
    /** @returns {import('../lib/types').WorldReport} */
    function makeReport() {
        const metrics = createMetricsReport();
        appendMetricSample(metrics, 'rooms', 'W0N1', 100, { rcl: 2, energy: 1200 });
        appendMetricSample(metrics, 'rooms', 'W0N1', 200, { rcl: 3, energy: 1500 });
        appendMetricSample(metrics, 'rooms', 'W0N2', 100, { rcl: 1, energy: 300 });
        return { metrics };
    }

    describe('assertHasMetricSamples', () => {
        it('проходит, если есть сэмплы', () => {
            expect(() => assertHasMetricSamples(makeReport(), 'rooms', 'W0N1')).not.toThrow();
        });

        it('падает, если сэмплов нет', () => {
            expect(() => assertHasMetricSamples(makeReport(), 'rooms', 'W99N99')).toThrow(/нет сэмплов/);
        });
    });

    describe('assertLatestMetricAtLeast', () => {
        it('проходит, когда actual >= expected', () => {
            expect(() => assertLatestMetricAtLeast(makeReport(), 'rooms', 'W0N1', 'rcl', 3)).not.toThrow();
        });

        it('падает, когда actual < expected', () => {
            expect(() => assertLatestMetricAtLeast(makeReport(), 'rooms', 'W0N1', 'rcl', 4)).toThrow(
                /rcl=3.*< ожидаемого 4/,
            );
        });

        it('падает, если expected не число', () => {
            expect(() => assertLatestMetricAtLeast(makeReport(), 'rooms', 'W0N1', 'rcl', '3')).toThrow(
                /должен быть числом/,
            );
        });

        it('падает, если сэмплов нет', () => {
            expect(() => assertLatestMetricAtLeast(makeReport(), 'rooms', 'W99N99', 'rcl', 1)).toThrow(/нет сэмплов/);
        });
    });

    describe('assertLatestMetricBelow', () => {
        it('проходит, когда actual < expected', () => {
            expect(() => assertLatestMetricBelow(makeReport(), 'rooms', 'W0N1', 'energy', 2000)).not.toThrow();
        });

        it('падает, когда actual >= expected', () => {
            expect(() => assertLatestMetricBelow(makeReport(), 'rooms', 'W0N1', 'energy', 1500)).toThrow(
                /energy=1500.*>= ожидаемого 1500/,
            );
        });
    });

    describe('assertMetricReached', () => {
        it('проходит, если метрика достигла значения', () => {
            expect(() => assertMetricReached(makeReport(), 'rooms', 'W0N1', 'rcl', 3)).not.toThrow();
        });

        it('падает, если метрика не достигала значения', () => {
            expect(() => assertMetricReached(makeReport(), 'rooms', 'W0N2', 'rcl', 2)).toThrow(/ни разу не достигла 2/);
        });
    });

    describe('assertMetricMonotonic', () => {
        it('проходит для монотонно неубывающей метрики', () => {
            expect(() => assertMetricMonotonic(makeReport(), 'rooms', 'W0N1', 'rcl')).not.toThrow();
        });

        it('падает при убывании метрики', () => {
            const metrics = createMetricsReport();
            appendMetricSample(metrics, 'rooms', 'W0N1', 100, { energy: 2000 });
            appendMetricSample(metrics, 'rooms', 'W0N1', 200, { energy: 1000 });
            expect(() => assertMetricMonotonic({ metrics }, 'rooms', 'W0N1', 'energy')).toThrow(/убыла с 2000 до 1000/);
        });

        it('падает, если сэмплов нет', () => {
            expect(() => assertMetricMonotonic(makeReport(), 'rooms', 'W99N99', 'rcl')).toThrow(/нет сэмплов/);
        });
    });
});
