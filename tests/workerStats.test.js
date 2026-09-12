'use strict';

/**
 * Unit tests for the worker self-reporting timer in src/runScenario.js
 * (`viewer:worker-stats` IPC messages → viewer Resources panel).
 *
 * The module is required in-process with a mocked `process.send` and fake
 * timers — no real fork needed: the timer is unref'd, so it neither keeps the
 * test process alive nor requires a real IPC channel. This covers the worker
 * side of the stats contract; the server side (setWorkerStats /
 * deleteWorkerStats / GET /api/stats) is covered in viewerServer.test.js and
 * the parent's forward is a guarded pass-through in bin/screeps-integration-tests.js.
 */

describe('runScenario worker stats self-report', () => {
    const originalSend = process.send;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.resetModules();
    });

    afterEach(() => {
        jest.useRealTimers();
        if (originalSend === undefined) {
            delete process.send;
        } else {
            process.send = originalSend;
        }
    });

    /** Require the worker module fresh (fake timers must be installed first). */
    function loadWorker() {
        let mod;
        jest.isolateModules(() => {
            mod = require('../src/runScenario');
        });
        return mod;
    }

    it('sends viewer:worker-stats with resource fields on each interval', () => {
        const sends = [];
        process.send = (msg) => sends.push(msg);

        loadWorker();
        jest.advanceTimersByTime(2000);

        expect(sends).toHaveLength(1);
        const msg = sends[0];
        expect(msg.type).toBe('viewer:worker-stats');
        expect(msg.pid).toBe(process.pid);
        // Default name until the run configuration arrives
        expect(msg.scenario).toBe('snapshot-launch');
        for (const key of ['rss', 'heapUsed', 'heapTotal', 'external', 'cpuUserUsec', 'cpuSystemUsec']) {
            expect(typeof msg[key]).toBe('number');
            expect(msg[key]).toBeGreaterThanOrEqual(0);
        }
        expect(msg.uptimeSec).toBeGreaterThanOrEqual(0);

        // Second interval — re-sent (the parent keeps only the latest report per pid)
        jest.advanceTimersByTime(2000);
        expect(sends).toHaveLength(2);
    });

    it('does nothing without an IPC channel (batch mode safety)', () => {
        delete process.send;

        expect(() => {
            loadWorker();
            jest.advanceTimersByTime(6000);
        }).not.toThrow();
    });

    it('swallows send errors — a closing channel must not crash the worker', () => {
        process.send = () => {
            throw new Error('channel closed');
        };

        expect(() => {
            loadWorker();
            jest.advanceTimersByTime(4000);
        }).not.toThrow();
    });
});
