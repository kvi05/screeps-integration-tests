'use strict';

const { MetricsReport } = require('../src/lib/assertions/metricsReport');
const { MetricsAssert } = require('../src/lib/assertions/metricAssertions');

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
        it('passes if there are samples', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.hasSamples('rooms', 'W0N1')).not.toThrow();
        });

        it('fails if there are no samples', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.hasSamples('rooms', 'W99N99')).toThrow(/no samples for/);
        });
    });

    describe('latestAtLeast', () => {
        it('passes when actual >= expected', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.latestAtLeast('rooms', 'W0N1', 'rcl', 3)).not.toThrow();
        });

        it('fails when actual < expected', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.latestAtLeast('rooms', 'W0N1', 'rcl', 4)).toThrow(/rcl=3.*< expected 4/);
        });

        it('fails if expected is not a number', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.latestAtLeast('rooms', 'W0N1', 'rcl', '3')).toThrow(/must be a number/);
        });

        it('fails if there are no samples', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.latestAtLeast('rooms', 'W99N99', 'rcl', 1)).toThrow(/no samples for/);
        });
    });

    describe('latestBelow', () => {
        it('passes when actual < expected', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.latestBelow('rooms', 'W0N1', 'energy', 2000)).not.toThrow();
        });

        it('fails when actual >= expected', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.latestBelow('rooms', 'W0N1', 'energy', 1500)).toThrow(/energy=1500.*>= expected 1500/);
        });
    });

    describe('reached', () => {
        it('passes if metric reached the value', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.reached('rooms', 'W0N1', 'rcl', 3)).not.toThrow();
        });

        it('fails if metric never reached the value', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.reached('rooms', 'W0N2', 'rcl', 2)).toThrow(/never reached 2/);
        });
    });

    describe('monotonic', () => {
        it('passes for monotonically non-decreasing metric', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.monotonic('rooms', 'W0N1', 'rcl')).not.toThrow();
        });

        it('fails if metric decreases', () => {
            const m = new MetricsReport();
            m.append('rooms', 'W0N1', 100, { energy: 2000 });
            m.append('rooms', 'W0N1', 200, { energy: 1000 });
            const ma = new MetricsAssert(m);
            expect(() => ma.monotonic('rooms', 'W0N1', 'energy')).toThrow(/decreased from 2000 to 1000/);
        });

        it('fails if there are no samples', () => {
            const ma = new MetricsAssert(makeMetrics());
            expect(() => ma.monotonic('rooms', 'W99N99', 'rcl')).toThrow(/no samples for/);
        });
    });
});
