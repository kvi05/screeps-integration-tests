'use strict';

/**
 * Unit tests for finalize.js — world run report finalisation.
 *
 * Cover:
 * - wallClockMs calculation
 * - finalMemory per-bot (success + error handling)
 * - finalRcl per-room
 * - profile extraction (text + callgrind) for profiled bots
 * - profile skipped for non-profiled bots
 *
 * @file Unit tests for finalize.js
 */

const { finalizeReport } = require('../src/lib/orchestration/finalize');

function createMinimalReport() {
    return {
        ticksRun: 0,
        finalRcl: {},
        errors: [],
        warnings: [],
        logs: [],
        finalMemory: {},
        profileText: {},
        profileCallgrind: {},
        wallClockMs: 0,
        events: [],
        metrics: { append: jest.fn() },
        objectOwners: {},
        frameworkWarnings: [],
        stopReason: null,
    };
}

describe('finalizeReport', () => {
    it('sets wallClockMs', async () => {
        const report = createMinimalReport();
        const startTime = Date.now();

        await finalizeReport(report, startTime, {}, {}, {}, {}, jest.fn(), jest.fn());

        expect(report.wallClockMs).toBeGreaterThanOrEqual(0);
    });

    it('reads finalMemory per bot', async () => {
        const report = createMinimalReport();
        const bots = { bot1: { id: 'id1' }, bot2: { id: 'id2' } };
        const getBotMemoryFn = jest
            .fn()
            .mockResolvedValueOnce({ energy: 100 })
            .mockResolvedValueOnce({ energy: 200 });

        await finalizeReport(report, Date.now(), bots, {}, {}, {}, getBotMemoryFn, jest.fn());

        expect(report.finalMemory.bot1).toEqual({ energy: 100 });
        expect(report.finalMemory.bot2).toEqual({ energy: 200 });
        expect(getBotMemoryFn).toHaveBeenCalledTimes(2);
    });

    it('gracefully handles getBotMemoryFn rejection', async () => {
        const report = createMinimalReport();
        const bots = { bot1: { id: 'id1' } };
        const getBotMemoryFn = jest.fn().mockRejectedValue(new Error('DB error'));

        await finalizeReport(report, Date.now(), bots, {}, {}, {}, getBotMemoryFn, jest.fn());

        expect(report.finalMemory.bot1).toEqual({});
    });

    it('reads finalRcl per room', async () => {
        const report = createMinimalReport();
        const roomStatus = { W0N1: { name: 'W0N1' }, W0N2: { name: 'W0N2' } };
        const getRclFn = jest.fn().mockResolvedValue(3);

        await finalizeReport(report, Date.now(), {}, {}, roomStatus, {}, jest.fn(), getRclFn);

        expect(report.finalRcl.W0N1).toBe(3);
        expect(report.finalRcl.W0N2).toBe(3);
        expect(getRclFn).toHaveBeenCalledTimes(2);
    });

    describe('profiler extraction', () => {
        it('extracts __profileText and __profileCallgrind for profiled bots', async () => {
            const report = createMinimalReport();
            const bots = { bot1: { id: 'id1' } };
            const resolvedBots = { bot1: { effectiveProfiling: true } };
            const getBotMemoryFn = jest.fn().mockResolvedValue({
                __profileText: 'text profile',
                __profileCallgrind: 'callgrind data',
                energy: 100,
            });

            await finalizeReport(report, Date.now(), bots, {}, {}, resolvedBots, getBotMemoryFn, jest.fn());

            expect(report.profileText.bot1).toBe('text profile');
            expect(report.profileCallgrind.bot1).toBe('callgrind data');
        });

        it('skips profiler extraction for non-profiled bots', async () => {
            const report = createMinimalReport();
            const bots = { bot1: { id: 'id1' } };
            const resolvedBots = { bot1: { effectiveProfiling: false } };
            const getBotMemoryFn = jest.fn().mockResolvedValue({
                __profileText: 'text profile',
                __profileCallgrind: 'callgrind data',
            });

            await finalizeReport(report, Date.now(), bots, {}, {}, resolvedBots, getBotMemoryFn, jest.fn());

            expect(report.profileText.bot1).toBeUndefined();
            expect(report.profileCallgrind.bot1).toBeUndefined();
        });

        it('extracts __profileText only when present', async () => {
            const report = createMinimalReport();
            const bots = { bot1: { id: 'id1' } };
            const resolvedBots = { bot1: { effectiveProfiling: true } };
            const getBotMemoryFn = jest.fn().mockResolvedValue({
                __profileCallgrind: 'callgrind only',
            });

            await finalizeReport(report, Date.now(), bots, {}, {}, resolvedBots, getBotMemoryFn, jest.fn());

            expect(report.profileText.bot1).toBeUndefined();
            expect(report.profileCallgrind.bot1).toBe('callgrind only');
        });

        it('extracts __profileCallgrind only when present', async () => {
            const report = createMinimalReport();
            const bots = { bot1: { id: 'id1' } };
            const resolvedBots = { bot1: { effectiveProfiling: true } };
            const getBotMemoryFn = jest.fn().mockResolvedValue({
                __profileText: 'text only',
            });

            await finalizeReport(report, Date.now(), bots, {}, {}, resolvedBots, getBotMemoryFn, jest.fn());

            expect(report.profileText.bot1).toBe('text only');
            expect(report.profileCallgrind.bot1).toBeUndefined();
        });
    });

    it('returns the same report object', async () => {
        const report = createMinimalReport();
        const result = await finalizeReport(report, Date.now(), {}, {}, {}, {}, jest.fn(), jest.fn());

        expect(result).toBe(report);
    });
});
