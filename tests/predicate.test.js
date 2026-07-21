'use strict';

/**
 * Unit tests for predicate.js — evaluatePredicate + checkStopCondition.
 *
 * Cover:
 * - maxTicks stop condition
 * - predicate callback receives eventLog + getEventLog aliases
 * - predicate return value controls stopping
 * - predicate error handling
 * - Memory signal stop condition
 *
 * @file Unit tests for predicate.js
 */

const { evaluatePredicate, checkStopCondition } = require('../src/lib/observers/predicate');

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeEmptyReport() {
    return {
        ticksRun: 0,
        finalRcl: {},
        errors: [],
        warnings: [],
        logs: [],
        finalMemory: {},
        events: [],
        objectOwners: {},
        metrics: { rooms: {}, colonies: {}, bots: {}, world: [] },
        stopReason: null,
        wallClockMs: 0,
        profileText: {},
        profileCallgrind: {},
    };
}

function makeBasicCtx(overrides = {}) {
    const eventLogMock = jest.fn(async () => []);
    return {
        report: makeEmptyReport(),
        server: {},
        bots: { bot: { id: 'bot_123', username: 'bot' } },
        readMemory: jest.fn(async () => ({})),
        getEventLog: eventLogMock,
        eventLog: eventLogMock,
        ...overrides,
    };
}

// ─── evaluatePredicate ────────────────────────────────────────────────────

describe('evaluatePredicate', () => {
    describe('maxTicks', () => {
        it('stops when ticksRun >= maxTicks', async () => {
            const ctx = makeBasicCtx();
            ctx.report.ticksRun = 10;

            const result = await evaluatePredicate(ctx, { maxTicks: 10 });

            expect(result.shouldStop).toBe(true);
            expect(result.reason).toContain('Tick limit reached');
        });

        it('does not stop when ticksRun < maxTicks', async () => {
            const ctx = makeBasicCtx();
            ctx.report.ticksRun = 5;

            const result = await evaluatePredicate(ctx, { maxTicks: 10 });

            expect(result.shouldStop).toBe(false);
        });

        it('does not stop when maxTicks is not set', async () => {
            const ctx = makeBasicCtx();
            ctx.report.ticksRun = 100;

            const result = await evaluatePredicate(ctx, {});

            expect(result.shouldStop).toBe(false);
        });
    });

    describe('predicate callback', () => {
        it('stops when predicate returns true', async () => {
            const ctx = makeBasicCtx();
            const predicate = jest.fn(async () => true);

            const result = await evaluatePredicate(ctx, { predicate });

            expect(result.shouldStop).toBe(true);
            expect(result.reason).toContain('Predicate resolved');
            expect(predicate).toHaveBeenCalledWith(ctx);
        });

        it('does not stop when predicate returns false', async () => {
            const ctx = makeBasicCtx();
            const predicate = jest.fn(async () => false);

            const result = await evaluatePredicate(ctx, { predicate });

            expect(result.shouldStop).toBe(false);
        });

        it('stops with error when predicate throws', async () => {
            const ctx = makeBasicCtx();
            const predicate = jest.fn(async () => {
                throw new Error('test error');
            });

            const result = await evaluatePredicate(ctx, { predicate });

            expect(result.shouldStop).toBe(true);
            expect(result.reason).toContain('Predicate threw an error');
            expect(result.reason).toContain('test error');
        });

        it('receives eventLog alias in context', async () => {
            const ctx = makeBasicCtx();
            expect(ctx.eventLog).toBeDefined();
            expect(typeof ctx.eventLog).toBe('function');
        });

        it('receives getEventLog alias in context', async () => {
            const ctx = makeBasicCtx();
            expect(ctx.getEventLog).toBeDefined();
            expect(typeof ctx.getEventLog).toBe('function');
        });

        it('eventLog and getEventLog point to the same function', async () => {
            const ctx = makeBasicCtx();
            expect(ctx.eventLog).toBe(ctx.getEventLog);
        });

        it('predicate can call w.eventLog()', async () => {
            const ctx = makeBasicCtx();
            let calledWithEventLog = false;

            const predicate = jest.fn(async (w) => {
                if (typeof w.eventLog === 'function') {
                    await w.eventLog('W0N1');
                    calledWithEventLog = true;
                }
                return false;
            });

            await evaluatePredicate(ctx, { predicate });

            expect(calledWithEventLog).toBe(true);
            expect(ctx.getEventLog).toHaveBeenCalledWith('W0N1');
        });

        it('predicate can call w.getEventLog()', async () => {
            const ctx = makeBasicCtx();
            let calledWithGetEventLog = false;

            const predicate = jest.fn(async (w) => {
                if (typeof w.getEventLog === 'function') {
                    await w.getEventLog('W0N1');
                    calledWithGetEventLog = true;
                }
                return false;
            });

            await evaluatePredicate(ctx, { predicate });

            expect(calledWithGetEventLog).toBe(true);
            expect(ctx.getEventLog).toHaveBeenCalledWith('W0N1');
        });
    });

    describe('Memory signal', () => {
        it('stops when signal field is truthy', async () => {
            const ctx = makeBasicCtx();
            ctx.readMemory = jest.fn(async () => ({ done: true }));

            const result = await evaluatePredicate(ctx, { signal: 'done' });

            expect(result.shouldStop).toBe(true);
            expect(result.reason).toContain('Memory.done');
        });

        it('does not stop when signal field is falsy', async () => {
            const ctx = makeBasicCtx();
            ctx.readMemory = jest.fn(async () => ({ done: false }));

            const result = await evaluatePredicate(ctx, { signal: 'done' });

            expect(result.shouldStop).toBe(false);
        });

        it('checks only signalBot when specified', async () => {
            const ctx = makeBasicCtx({
                bots: { bot1: { id: 'id1', username: 'bot1' }, bot2: { id: 'id2', username: 'bot2' } },
            });
            ctx.readMemory = jest.fn(async (username) => {
                if (username === 'bot1') return { done: true };
                return { done: false };
            });

            const result = await evaluatePredicate(ctx, { signal: 'done', signalBot: 'bot1' });

            expect(result.shouldStop).toBe(true);
        });
    });
});

// ─── checkStopCondition ───────────────────────────────────────────────────

describe('checkStopCondition', () => {
    it('returns not stopped when opts.until is not set', async () => {
        const result = await checkStopCondition({}, makeEmptyReport(), {}, {}, jest.fn(), jest.fn());

        expect(result.shouldStop).toBe(false);
        expect(result.reason).toBe('');
    });

    it('sets report.stopReason when stopping', async () => {
        const report = makeEmptyReport();
        report.ticksRun = 10;

        const result = await checkStopCondition({ until: { maxTicks: 10 } }, report, {}, {}, jest.fn(), jest.fn());

        expect(result.shouldStop).toBe(true);
        expect(report.stopReason).toBe(result.reason);
    });

    it('passes eventLog alias to predicate context', async () => {
        const report = makeEmptyReport();
        const eventLogFn = jest.fn(async () => []);
        let predicateCtx = null;

        await checkStopCondition(
            {
                until: {
                    predicate: async (w) => {
                        predicateCtx = w;
                        return false;
                    },
                },
            },
            report,
            {},
            { bot: { id: 'bot_123', username: 'bot' } },
            jest.fn(async () => ({})),
            eventLogFn,
        );

        expect(predicateCtx).not.toBeNull();
        // Both aliases should exist and point to the same function
        expect(predicateCtx.getEventLog).toBe(eventLogFn);
        expect(predicateCtx.eventLog).toBe(eventLogFn);
    });
});
