'use strict';

const { MetricsReport } = require('../lib/metricsReport');
const { MetricsAssert } = require('../lib/metricAssertions');

describe('MetricsAssert', () => {
    /** @returns {MetricsReport} */
    function makeMetrics() {
        const m = new MetricsReport();
        m.append('rooms', 'W0N1', 100, { rcl: 2, energy: 1200 });
        m.append('rooms', 'W0N1', 200, { rcl: 3, energy: 1500 });
        m.append('rooms', 'W0N2', 100, { rcl: 1, energy: 300 });
        return m;
    }

    describe('hasSamples', () => {
        it('проходит, если есть сэмплы', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.hasSamples('rooms', 'W0N1')).not.toThrow();
        });

        it('падает, если сэмплов нет', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.hasSamples('rooms', 'W99N99')).toThrow(/нет сэмплов/);
        });
    });

    describe('latestAtLeast', () => {
        it('проходит, когда actual >= expected', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.latestAtLeast('rooms', 'W0N1', 'rcl', 3)).not.toThrow();
        });

        it('падает, когда actual < expected', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.latestAtLeast('rooms', 'W0N1', 'rcl', 4)).toThrow(/rcl=3.*< ожидаемого 4/);
        });

        it('падает, если expected не число', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.latestAtLeast('rooms', 'W0N1', 'rcl', '3')).toThrow(/должен быть числом/);
        });

        it('падает, если сэмплов нет', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.latestAtLeast('rooms', 'W99N99', 'rcl', 1)).toThrow(/нет сэмплов/);
        });
    });

    describe('latestBelow', () => {
        it('проходит, когда actual < expected', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.latestBelow('rooms', 'W0N1', 'energy', 2000)).not.toThrow();
        });

        it('падает, когда actual >= expected', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.latestBelow('rooms', 'W0N1', 'energy', 1500)).toThrow(/energy=1500.*>= ожидаемого 1500/);
        });
    });

    describe('reached', () => {
        it('проходит, если метрика достигла значения', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.reached('rooms', 'W0N1', 'rcl', 3)).not.toThrow();
        });

        it('падает, если метрика не достигала значения', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.reached('rooms', 'W0N2', 'rcl', 2)).toThrow(/ни разу не достигла 2/);
        });
    });

    describe('monotonic', () => {
        it('проходит для монотонно неубывающей метрики', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.monotonic('rooms', 'W0N1', 'rcl')).not.toThrow();
        });

        it('падает при убывании метрики', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { energy: 2000 });
            m.append('rooms', 'W0N1', 200, { energy: 1000 });
            const ma = new MetricsAssert(m);
            expect(() => ma.monotonic('rooms', 'W0N1', 'energy')).toThrow(/убыла с 2000 до 1000/);
        });

        it('падает, если сэмплов нет', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.monotonic('rooms', 'W99N99', 'rcl')).toThrow(/нет сэмплов/);
        });
    });
});
