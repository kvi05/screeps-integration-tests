'use strict';

/**
 * Unit tests for worldReports.js — the process-level registry of created
 * worlds used by the worker for cross-world aggregation (`totalTicks` /
 * `totalWorlds` in the final worker message and the viewer scenario-result
 * event).
 *
 * Cover:
 * - empty registry: 0 ticks, 0 worlds
 * - live worlds: ticks counted by reference, growth after registration is visible
 * - malformed ticksRun values are skipped
 * - freezeWorldReport: contribution snapshotted, report reference released
 * - freeze is idempotent and ignores unknown reports
 * - live and frozen worlds are summed together
 * - clearWorldReports resets everything
 */

const {
    trackWorldReport,
    freezeWorldReport,
    collectTotalWorldTicks,
    collectWorldCount,
    clearWorldReports,
} = require('../src/lib/orchestration/worldReports');

describe('worldReports', () => {
    afterEach(() => {
        clearWorldReports();
    });

    it('empty registry reports 0 ticks and 0 worlds', () => {
        expect(collectTotalWorldTicks()).toBe(0);
        expect(collectWorldCount()).toBe(0);
    });

    it('sums ticksRun across multiple tracked worlds', () => {
        trackWorldReport({ ticksRun: 100 });
        trackWorldReport({ ticksRun: 250 });
        trackWorldReport({ ticksRun: 17 });
        expect(collectTotalWorldTicks()).toBe(367);
        expect(collectWorldCount()).toBe(3);
    });

    it('counts live reports — ticks that run after registration are included', () => {
        const report = { ticksRun: 0 };
        trackWorldReport(report);
        expect(collectTotalWorldTicks()).toBe(0);

        report.ticksRun = 42; // world ran ticks after being registered
        expect(collectTotalWorldTicks()).toBe(42);
    });

    it('skips reports without a numeric ticksRun', () => {
        trackWorldReport(undefined);
        trackWorldReport({});
        trackWorldReport({ ticksRun: 5 });
        expect(collectTotalWorldTicks()).toBe(5);
        expect(collectWorldCount()).toBe(3);
    });

    it('freezeWorldReport snapshots the contribution and releases the report', () => {
        const report = { ticksRun: 7 };
        trackWorldReport(report);
        freezeWorldReport(report);

        // The report reference is released: later mutations are ignored,
        // only the frozen snapshot counts.
        report.ticksRun = 1000;
        expect(collectTotalWorldTicks()).toBe(7);
        expect(collectWorldCount()).toBe(1); // the world is still counted
    });

    it('freezeWorldReport is idempotent and ignores unknown reports', () => {
        const report = { ticksRun: 5 };
        trackWorldReport(report);
        freezeWorldReport(report);
        freezeWorldReport(report); // double dispose
        freezeWorldReport({ ticksRun: 999 }); // unknown report
        expect(collectTotalWorldTicks()).toBe(5);
        expect(collectWorldCount()).toBe(1);
    });

    it('sums live and frozen worlds together', () => {
        const disposed = { ticksRun: 10 };
        trackWorldReport(disposed);
        freezeWorldReport(disposed);

        const running = { ticksRun: 0 };
        trackWorldReport(running);
        running.ticksRun = 4;

        expect(collectTotalWorldTicks()).toBe(14);
        expect(collectWorldCount()).toBe(2);
    });

    it('clearWorldReports resets the registry', () => {
        trackWorldReport({ ticksRun: 10 });
        clearWorldReports();
        expect(collectTotalWorldTicks()).toBe(0);
        expect(collectWorldCount()).toBe(0);
    });

    it('clearWorldReports is idempotent', () => {
        clearWorldReports();
        clearWorldReports();
        expect(collectWorldCount()).toBe(0);
    });
});
