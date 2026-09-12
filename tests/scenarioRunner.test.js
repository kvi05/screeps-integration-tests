'use strict';

/**
 * Unit tests for src/tools/viewer/scenarioRunner.js — the queue/worker-pool
 * mechanics behind the viewer mode's scenario management.
 *
 * Cover:
 * - launchScenario: single fresh run, dedup of pending entries (no second
 *   queue entry), restart of a running job (dispose + kill-timer fallback)
 * - suppression of late `viewer:scenario-result` from stopping jobs
 * - synthesized result broadcast when a worker dies without a final message
 * - live result routing (resultReported → no synthesized broadcast)
 * - `viewer:frame` ownership (terrain once, frames always, router skipped)
 * - concurrency limits (maxJobs, interactive exclusivity)
 * - kill-timer cleanup + deleteWorkerStats on job finish
 * - runAllScenarios / launchFromSnapshot / sendToInteractive / stopAll
 *
 * All dependencies are injected fakes (controllable deferred promises,
 * child stubs, recording ui stub) — no real processes, servers or waits.
 *
 * @file Unit tests for scenarioRunner.js
 */

const path = require('path');

const { createScenarioRunner } = require('../src/tools/viewer/scenarioRunner');

// ─── Helpers ──────────────────────────────────────────────────────────────

const SCENARIOS_DIR = '/fake/scenarios';

function scenarioPath(name) {
    return `${SCENARIOS_DIR}/${name}.scenario.js`;
}

/**
 * Lets promise continuations (the runner's .then/.catch callbacks) run.
 * Promise microtasks are not affected by jest fake timers.
 */
async function flushPromises() {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}

/**
 * Creates a controllable deferred promise.
 *
 * @returns {{promise: Promise<*>, resolve: (v?: *) => void, reject: (e?: *) => void}}
 */
function makeDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/**
 * Creates a fake worker child process stub.
 *
 * @param {Object} [overrides]
 * @returns {{pid: number, connected: boolean, send: jest.Mock}}
 */
function makeChild(overrides = {}) {
    return {
        pid: 1000 + Math.floor(Math.random() * 9000),
        connected: true,
        send: jest.fn(),
        ...overrides,
    };
}

/**
 * Creates a fake UI server recording all broadcast calls.
 *
 * @returns {Object} stub with jest.fn() for every method the runner may call
 */
function makeUi() {
    return {
        broadcastStart: jest.fn(),
        updateStatus: jest.fn(),
        broadcastScenarioStatus: jest.fn(),
        broadcastScenarioResult: jest.fn(),
        broadcastEnd: jest.fn(),
        broadcastTerrain: jest.fn(),
        broadcast: jest.fn(),
        deleteWorkerStats: jest.fn(),
    };
}

/**
 * Creates a fake `runScenario` dependency. Each call records its arguments
 * and a handle to drive the fake worker: `deliver(msg)` feeds an IPC
 * message through the runner's routing wrapper (as a real worker would),
 * `finish(result)` resolves the worker promise, `fail(err)` rejects it.
 * The stub child is handed over via `onChild` right away, mimicking
 * runScenarioInWorker's "config queued → onChild" ordering.
 *
 * @returns {{fn: Function, calls: Array<Object>}}
 */
function makeRunScenarioFake() {
    const calls = [];
    /**
     * @param {string} filePath
     * @param {Object} opts
     * @param {number} timeout
     * @param {string|null} roomFixturesDir
     * @param {Function} onIpcMessage
     * @param {Function} onChild
     */
    const fn = (filePath, opts, timeout, roomFixturesDir, onIpcMessage, onChild) => {
        const deferred = makeDeferred();
        const child = makeChild();
        const call = {
            path: filePath,
            opts,
            timeout,
            roomFixturesDir,
            child,
            deferred,
            deliver: (msg) => onIpcMessage(msg, child),
            finish: (result) => deferred.resolve(result),
            fail: (err) => deferred.reject(err),
        };
        calls.push(call);
        if (onChild) {
            onChild(child);
        }
        return deferred.promise;
    };
    return { fn, calls };
}

/**
 * Builds a runner with fake dependencies.
 *
 * @param {Object} [overrides] — deps overrides for this test
 * @returns {Object} `{ runner, runScenario, ui, lastStart, findScenarios, killProcessTree, onIpcMessage }`
 */
function makeRunner(overrides = {}) {
    const runScenario = makeRunScenarioFake();
    const ui = makeUi();
    const lastStart = { scenario: '', maxTicks: 0, replayBuffer: 0 };
    const findScenarios = jest.fn(() => ['a.scenario.js']);
    const killProcessTree = jest.fn();
    const onIpcMessage = jest.fn();

    const deps = {
        runScenario: runScenario.fn,
        ui,
        lastStart,
        findScenarios,
        killProcessTree,
        onIpcMessage,
        maxJobs: 4,
        maxInteractive: 1,
        timeout: 1234,
        profiling: false,
        snapshotsDir: '/fake/snapshots',
        viewerOptions: { paused: false, speed: 1000, replayBuffer: 500 },
        roomFixturesDir: '/fake/room-fixtures',
        scenariosDir: SCENARIOS_DIR,
        replayBufferTicks: 500,
        stopGraceMs: 100,
        ...overrides,
    };
    const runner = createScenarioRunner(deps);
    return { runner, runScenario, ui, lastStart, findScenarios, killProcessTree, onIpcMessage, deps };
}

const DISPOSE_CMD = { type: 'viewer:cmd', action: 'dispose' };

// ─── Tests ────────────────────────────────────────────────────────────────

describe('createScenarioRunner', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    describe('dependency validation', () => {
        it('fails loud when a required function dependency is missing', () => {
            expect(() => createScenarioRunner({})).toThrow(TypeError);
            expect(() => createScenarioRunner({})).toThrow(/deps\.runScenario/);
        });

        it('fails loud when a required function dependency is not a function', () => {
            const { deps } = makeRunner();
            expect(() => createScenarioRunner({ ...deps, killProcessTree: null })).toThrow(/deps\.killProcessTree/);
        });
    });

    describe('launchScenario (batch)', () => {
        it('queues exactly one run for a fresh scenario', () => {
            const { runner, runScenario, ui } = makeRunner();

            runner.launchScenario(scenarioPath('a'), false);

            expect(runScenario.calls).toHaveLength(1);
            expect(runScenario.calls[0].path).toBe(scenarioPath('a'));
            expect(runScenario.calls[0].opts.profiling).toBe(false);
            expect(runScenario.calls[0].opts.snapshotsDir).toBe('/fake/snapshots');
            expect(runScenario.calls[0].timeout).toBe(1234);
            expect(runScenario.calls[0].roomFixturesDir).toBe('/fake/room-fixtures');
            expect(ui.broadcastScenarioStatus).toHaveBeenCalledWith('a', 'running');
            // Batch jobs are not interactive
            expect(runScenario.calls[0].opts.viewer).toBeUndefined();
        });

        it('does not create a second queue entry for a pending scenario (dedup)', async () => {
            const { runner, runScenario } = makeRunner({ maxJobs: 1 });

            runner.launchScenario(scenarioPath('a'), false); // running, blocked
            runner.launchScenario(scenarioPath('b'), false); // pending (no free slot)
            runner.launchScenario(scenarioPath('b'), false); // repeated RUN while pending

            // Only `a` started so far — the pending `b` was not started twice
            expect(runScenario.calls).toHaveLength(1);

            runScenario.calls[0].finish({ status: 'pass', time: 1, totalTicks: 1 });
            await flushPromises();

            // Exactly one fresh `b` run after the slot freed up
            expect(runScenario.calls).toHaveLength(2);
            expect(runScenario.calls[1].path).toBe(scenarioPath('b'));

            runScenario.calls[1].finish({ status: 'pass', time: 1, totalTicks: 1 });
            await flushPromises();

            // No duplicate `b` run
            expect(runScenario.calls).toHaveLength(2);
        });

        it('restarts a running scenario: dispose, fresh run, no duplicates', async () => {
            const { runner, runScenario } = makeRunner({ maxJobs: 2 });

            runner.launchScenario(scenarioPath('a'), false);
            const first = runScenario.calls[0];

            runner.launchScenario(scenarioPath('a'), false); // repeated RUN while running

            // The running worker got dispose
            expect(first.child.send).toHaveBeenCalledWith(DISPOSE_CMD);
            // A fresh run was enqueued (slot available with maxJobs=2)
            expect(runScenario.calls).toHaveLength(2);

            first.finish({ status: 'skip', time: 1, totalTicks: 1 });
            await flushPromises();

            // Old job resolved — nothing else was started
            expect(runScenario.calls).toHaveLength(2);
        });

        it('queues the fresh run behind the stopping job when no slot is free', async () => {
            const { runner, runScenario } = makeRunner({ maxJobs: 1 });

            runner.launchScenario(scenarioPath('a'), false);
            const first = runScenario.calls[0];

            runner.launchScenario(scenarioPath('a'), false);
            // No free slot yet — fresh run waits
            expect(runScenario.calls).toHaveLength(1);

            first.finish({ status: 'skip', time: 1, totalTicks: 1 });
            await flushPromises();

            expect(runScenario.calls).toHaveLength(2);
            expect(runScenario.calls[1].path).toBe(scenarioPath('a'));
        });

        it('does not stop or dedup interactive instances on a batch restart', () => {
            const { runner, runScenario } = makeRunner({ maxJobs: 4 });

            // Interactive instance of the same scenario is running
            runner.launchScenario(scenarioPath('live'), true);
            const interactiveJob = runScenario.calls[0];

            runner.launchScenario(scenarioPath('live'), false); // batch RUN on same name

            // The interactive worker was NOT touched
            expect(interactiveJob.child.send).not.toHaveBeenCalled();
        });
    });

    describe('stop semantics', () => {
        it('force-kills a stopping worker that does not exit within the grace period', () => {
            const { runner, runScenario, killProcessTree } = makeRunner({ stopGraceMs: 100 });

            runner.launchScenario(scenarioPath('a'), false);
            const job = runScenario.calls[0];

            runner.stopAll();
            expect(job.child.send).toHaveBeenCalledWith(DISPOSE_CMD);

            jest.advanceTimersByTime(99);
            expect(killProcessTree).not.toHaveBeenCalled();

            jest.advanceTimersByTime(1);
            expect(killProcessTree).toHaveBeenCalledWith(job.child.pid, 'SIGKILL', expect.any(Function));
        });

        it('does not arm a second kill timer for an already stopping job', () => {
            const { runner, killProcessTree } = makeRunner({ stopGraceMs: 100 });

            runner.launchScenario(scenarioPath('a'), false);

            runner.stopAll();
            runner.stopAll();
            jest.advanceTimersByTime(1000);

            // tree-kill armed exactly once
            expect(killProcessTree).toHaveBeenCalledTimes(1);
        });

        it('clears the kill timer and drops worker stats when a stopping job finishes', async () => {
            const { runner, runScenario, ui, killProcessTree } = makeRunner({ stopGraceMs: 50 });

            runner.launchScenario(scenarioPath('a'), false);
            const job = runScenario.calls[0];

            runner.stopAll();
            job.finish({ status: 'skip', time: 5, totalTicks: 7 });
            await flushPromises();

            jest.advanceTimersByTime(1000);
            expect(killProcessTree).not.toHaveBeenCalled();
            expect(ui.deleteWorkerStats).toHaveBeenCalledWith(job.child.pid);
        });

        it('stopAll drops the pending queue and resets the viewer status', async () => {
            const { runner, runScenario, ui } = makeRunner({ maxJobs: 1 });

            runner.launchScenario(scenarioPath('a'), false); // running
            runner.launchScenario(scenarioPath('b'), false); // pending
            runner.launchScenario(scenarioPath('c'), false); // pending

            runner.stopAll();

            // Pending scenarios never start
            runScenario.calls[0].finish({ status: 'pass', time: 1, totalTicks: 1 });
            await flushPromises();

            expect(runScenario.calls).toHaveLength(1);
            expect(ui.updateStatus).toHaveBeenCalledWith({ state: 'idle', tick: 0, scenario: '' });
        });

        it('stopAll works without a ui server (headless)', () => {
            const { runner, runScenario } = makeRunner({ ui: null });

            runner.launchScenario(scenarioPath('a'), false);
            runner.stopAll();

            expect(runScenario.calls[0].child.send).toHaveBeenCalledWith(DISPOSE_CMD);
        });
    });

    describe('result routing', () => {
        it('synthesizes a result broadcast when a worker dies without reporting one', async () => {
            const { runner, runScenario, ui } = makeRunner();

            runner.launchScenario(scenarioPath('a'), false);
            runScenario.calls[0].finish({ status: 'fail', error: 'boom', time: 42, totalTicks: 9 });
            await flushPromises();

            expect(ui.broadcastScenarioResult).toHaveBeenCalledWith({
                scenario: 'a',
                status: 'fail',
                time: 42,
                totalTicks: 9,
            });
        });

        it('maps worker statuses to synthesized result statuses', async () => {
            const { runner, runScenario, ui } = makeRunner();

            runner.launchScenario(scenarioPath('a'), false);
            runScenario.calls[0].finish({ status: 'pass', time: 1, totalTicks: 1 });
            await flushPromises();
            expect(ui.broadcastScenarioResult).toHaveBeenLastCalledWith(
                expect.objectContaining({ scenario: 'a', status: 'pass' }),
            );

            runner.launchScenario(scenarioPath('b'), false);
            runScenario.calls[1].finish({ status: 'skip', time: 1, totalTicks: 1 });
            await flushPromises();
            expect(ui.broadcastScenarioResult).toHaveBeenLastCalledWith(
                expect.objectContaining({ scenario: 'b', status: 'skip' }),
            );

            runner.launchScenario(scenarioPath('c'), false);
            runScenario.calls[2].finish({ status: 'timeout', error: 'Timeout after 1234ms' });
            await flushPromises();
            expect(ui.broadcastScenarioResult).toHaveBeenLastCalledWith(
                expect.objectContaining({ scenario: 'c', status: 'fail' }),
            );
        });

        it('does not synthesize a broadcast when the worker reported its own result', async () => {
            const { runner, runScenario, ui, onIpcMessage } = makeRunner();

            runner.launchScenario(scenarioPath('a'), false);
            const job = runScenario.calls[0];

            // Live worker reports its result — routed to the parent's router
            job.deliver({ type: 'viewer:scenario-result', scenario: 'a', status: 'pass', time: 3, totalTicks: 5 });
            expect(onIpcMessage).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'viewer:scenario-result', status: 'pass' }),
                job.child,
            );

            job.finish({ status: 'pass', time: 3, totalTicks: 5 });
            await flushPromises();

            // resultReported → no synthesized broadcast on top of the real one
            expect(ui.broadcastScenarioResult).not.toHaveBeenCalled();
        });

        it('swallows late scenario-result from a stopping worker (no router, no broadcast)', async () => {
            const { runner, runScenario, ui, onIpcMessage } = makeRunner();

            runner.launchScenario(scenarioPath('a'), false);
            const job = runScenario.calls[0];

            runner.stopAll();

            job.deliver({ type: 'viewer:scenario-result', scenario: 'a', status: 'pass', time: 3, totalTicks: 5 });
            expect(onIpcMessage).not.toHaveBeenCalled();
            expect(ui.broadcastScenarioResult).not.toHaveBeenCalled();

            job.finish({ status: 'pass', time: 3, totalTicks: 5 });
            await flushPromises();

            // A stopping job gets no synthesized result either
            expect(ui.broadcastScenarioResult).not.toHaveBeenCalled();
        });

        it('synthesizes a fail broadcast when runScenario rejects', async () => {
            const { runner, runScenario, ui } = makeRunner();

            runner.launchScenario(scenarioPath('a'), false);
            runScenario.calls[0].fail(new Error('spawn crash'));
            await flushPromises();

            expect(ui.broadcastScenarioResult).toHaveBeenCalledWith({
                scenario: 'a',
                status: 'fail',
                time: 0,
                totalTicks: 0,
            });
        });

        it('synthesizes nothing for a stopping job whose runScenario rejects', async () => {
            const { runner, runScenario, ui } = makeRunner();

            runner.launchScenario(scenarioPath('a'), false);
            const job = runScenario.calls[0];

            runner.stopAll();
            job.fail(new Error('killed'));
            await flushPromises();

            expect(ui.broadcastScenarioResult).not.toHaveBeenCalled();
        });
    });

    describe('viewer:frame ownership', () => {
        it('broadcasts every frame but terrain only once per interactive session', () => {
            const { runner, runScenario, ui, onIpcMessage } = makeRunner();

            runner.launchScenario(scenarioPath('live'), true);
            const job = runScenario.calls[0];

            job.deliver({ type: 'viewer:frame', tick: 1, terrain: { W1N1: '111\n222' } });
            job.deliver({ type: 'viewer:frame', tick: 2 });

            expect(ui.broadcastTerrain).toHaveBeenCalledTimes(1);
            expect(ui.broadcastTerrain).toHaveBeenCalledWith({ W1N1: '111\n222' });
            expect(ui.broadcast).toHaveBeenCalledTimes(2);
            // Frames are owned by the runner — the injected router never sees them
            expect(onIpcMessage).not.toHaveBeenCalled();
        });

        it('resets terrain state on each interactive start', async () => {
            const { runner, runScenario, ui } = makeRunner();

            runner.launchScenario(scenarioPath('live1'), true);
            runScenario.calls[0].deliver({ type: 'viewer:frame', tick: 1, terrain: { A: 'a' } });
            runScenario.calls[0].finish({ status: 'pass', time: 1, totalTicks: 1 });
            await flushPromises();

            runner.launchScenario(scenarioPath('live2'), true);
            runScenario.calls[1].deliver({ type: 'viewer:frame', tick: 1, terrain: { B: 'b' } });

            expect(ui.broadcastTerrain).toHaveBeenCalledTimes(2);
            expect(ui.broadcastTerrain).toHaveBeenLastCalledWith({ B: 'b' });
        });

        it('skips terrain broadcast when the frame carries no terrain', () => {
            const { runner, runScenario, ui } = makeRunner();

            runner.launchScenario(scenarioPath('live'), true);
            runScenario.calls[0].deliver({ type: 'viewer:frame', tick: 1 });

            expect(ui.broadcastTerrain).not.toHaveBeenCalled();
            expect(ui.broadcast).toHaveBeenCalledTimes(1);
        });
    });

    describe('concurrency', () => {
        it('respects maxJobs for batch scenarios', async () => {
            const { runner, runScenario } = makeRunner({ maxJobs: 2 });

            runner.launchScenario(scenarioPath('a'), false);
            runner.launchScenario(scenarioPath('b'), false);
            runner.launchScenario(scenarioPath('c'), false);

            expect(runScenario.calls).toHaveLength(2);

            runScenario.calls[0].finish({ status: 'pass', time: 1, totalTicks: 1 });
            await flushPromises();

            expect(runScenario.calls).toHaveLength(3);
            expect(runScenario.calls[2].path).toBe(scenarioPath('c'));
        });

        it('stalls the next interactive scenario while one is running', async () => {
            const { runner, runScenario } = makeRunner();

            runner.launchScenario(scenarioPath('live1'), true);
            runner.launchScenario(scenarioPath('live2'), true);

            // live2 queued behind live1 (maxInteractive = 1)
            expect(runScenario.calls).toHaveLength(1);

            runScenario.calls[0].finish({ status: 'pass', time: 1, totalTicks: 1 });
            await flushPromises();

            expect(runScenario.calls).toHaveLength(2);
            expect(runScenario.calls[1].opts.viewer).toBe(true);
        });

        it('a queued batch scenario starts while an interactive one is running', async () => {
            const { runner, runScenario } = makeRunner({ maxJobs: 4 });

            runner.launchScenario(scenarioPath('live1'), true);
            runner.launchScenario(scenarioPath('a'), false); // batch — passes through
            runner.launchScenario(scenarioPath('live2'), true); // stalls behind live1

            expect(runScenario.calls.map((c) => c.path)).toEqual([scenarioPath('live1'), scenarioPath('a')]);

            runScenario.calls[0].finish({ status: 'pass', time: 1, totalTicks: 1 });
            await flushPromises();

            // Once the interactive slot freed up, live2 starts
            expect(runScenario.calls).toHaveLength(3);
            expect(runScenario.calls[2].path).toBe(scenarioPath('live2'));
        });
    });

    describe('interactive launch', () => {
        it('takes over exclusively: stops everything, drops the queue, launches alone', async () => {
            const { runner, runScenario, ui, lastStart } = makeRunner({ maxJobs: 2 });

            runner.launchScenario(scenarioPath('a'), false); // running (b is not queued)

            runner.launchScenario(scenarioPath('live'), true);

            // Running worker got dispose; the free slot starts the takeover at once
            expect(runScenario.calls[0].child.send).toHaveBeenCalledWith(DISPOSE_CMD);
            expect(runScenario.calls).toHaveLength(2);
            expect(runScenario.calls[1].path).toBe(scenarioPath('live'));
            expect(runScenario.calls[1].opts.viewer).toBe(true);
            expect(runScenario.calls[1].opts.viewerOptions).toEqual(
                expect.objectContaining({ paused: false, replayBuffer: 500 }),
            );

            // Viewer got the start event and the status reflects the real start
            expect(ui.broadcastStart).toHaveBeenCalledWith('live', 0, 500, false);
            expect(ui.updateStatus).toHaveBeenCalledWith({ state: 'idle', tick: 0, scenario: '' });
            expect(ui.updateStatus).toHaveBeenCalledWith({ state: 'running', scenario: 'live' });

            // Shared lastStart is mutated for late SSE clients
            expect(lastStart.scenario).toBe('live');
            expect(lastStart.maxTicks).toBe(0);
            expect(lastStart.replayBuffer).toBe(500);
        });

        it('drops the pending queue even when the takeover itself must wait for a slot', async () => {
            const { runner, runScenario } = makeRunner({ maxJobs: 1 });

            runner.launchScenario(scenarioPath('a'), false); // running, holds the only slot
            runner.launchScenario(scenarioPath('b'), false); // pending

            runner.launchScenario(scenarioPath('live'), true);

            // The pending batch job was dropped; the stopping worker still
            // holds the only slot, so the interactive job stays queued
            expect(runScenario.calls[0].child.send).toHaveBeenCalledWith(DISPOSE_CMD);
            expect(runScenario.calls).toHaveLength(1);

            runScenario.calls[0].finish({ status: 'skip', time: 1, totalTicks: 1 });
            await flushPromises();

            expect(runScenario.calls).toHaveLength(2);
            expect(runScenario.calls[1].path).toBe(scenarioPath('live'));
            expect(runScenario.calls[1].opts.viewer).toBe(true);
        });

        it('starts paused when viewerOptions.paused is set', () => {
            const { runner, ui } = makeRunner({
                viewerOptions: { paused: true, speed: 1000, replayBuffer: 500 },
            });

            runner.launchScenario(scenarioPath('live'), true);

            expect(ui.broadcastStart).toHaveBeenCalledWith('live', 0, 500, true);
            expect(ui.updateStatus).toHaveBeenCalledWith({ state: 'paused', scenario: 'live' });
        });

        it('broadcasts end for an interactive job even when it was stopping', async () => {
            const { runner, runScenario, ui } = makeRunner();

            runner.launchScenario(scenarioPath('live'), true);
            const job = runScenario.calls[0];

            runner.stopAll();
            job.finish({ status: 'skip', time: 1, totalTicks: 3 });
            await flushPromises();

            expect(ui.broadcastEnd).toHaveBeenCalledWith('skip', 3);
            // ...but no scenario result is synthesized for a stopping job
            expect(ui.broadcastScenarioResult).not.toHaveBeenCalled();
        });
    });

    describe('runAllScenarios', () => {
        it('stops everything and queues all discovered scenarios atomically', async () => {
            const { runner, runScenario, ui, findScenarios } = makeRunner({ maxJobs: 4 });
            findScenarios.mockReturnValue(['a.scenario.js', 'b.scenario.js']);

            runner.launchScenario(scenarioPath('a'), false); // running from a previous click
            expect(runScenario.calls).toHaveLength(1);

            runner.runAllScenarios();

            // Old `a` worker got dispose
            expect(runScenario.calls[0].child.send).toHaveBeenCalledWith(DISPOSE_CMD);
            // Fresh `a` + `b` were enqueued and started
            expect(runScenario.calls).toHaveLength(3);
            expect(runScenario.calls[1].path).toBe(path.join(SCENARIOS_DIR, 'a.scenario.js'));
            expect(runScenario.calls[2].path).toBe(path.join(SCENARIOS_DIR, 'b.scenario.js'));
            expect(ui.broadcastScenarioStatus).toHaveBeenCalledWith('a', 'running');
            expect(ui.broadcastScenarioStatus).toHaveBeenCalledWith('b', 'running');
        });

        it('survives scenario discovery failure without throwing', async () => {
            const { runner, runScenario, findScenarios } = makeRunner({ maxJobs: 4 });
            findScenarios.mockImplementation(() => {
                throw new Error('missing dir');
            });

            expect(() => runner.runAllScenarios()).not.toThrow();
            await flushPromises();
            expect(runScenario.calls).toHaveLength(0);
        });
    });

    describe('launchFromSnapshot', () => {
        it('stops everything and queues an interactive restore run', async () => {
            const { runner, runScenario, ui } = makeRunner();

            runner.launchScenario(scenarioPath('a'), false);
            const snapshotData = { meta: { scenario: 'my-scenario.scenario.js', tick: 5 }, env: {} };

            runner.launchFromSnapshot(snapshotData);

            // Previous worker got dispose
            expect(runScenario.calls[0].child.send).toHaveBeenCalledWith(DISPOSE_CMD);
            expect(runScenario.calls).toHaveLength(2);

            const snapCall = runScenario.calls[1];
            expect(snapCall.path).toBe('');
            expect(snapCall.opts.restoreSnapshot).toBe(snapshotData);
            expect(snapCall.opts.viewer).toBe(true);
            // Snapshot launches carry a scenario name in lastStart
            expect(ui.broadcastStart).toHaveBeenCalledWith('my-scenario', 0, 500, false);
        });

        it('falls back to the snapshot-launch name when meta has no scenario', () => {
            const { runner, runScenario, ui } = makeRunner();

            runner.launchFromSnapshot({ meta: {}, env: {} });

            expect(runScenario.calls[0].opts.restoreSnapshot).toEqual({ meta: {}, env: {} });
            expect(ui.broadcastStart).toHaveBeenCalledWith('snapshot-launch', 0, 500, false);
        });
    });

    describe('sendToInteractive', () => {
        it('forwards commands to the interactive job only', () => {
            const { runner, runScenario } = makeRunner({ maxJobs: 4 });

            runner.launchScenario(scenarioPath('a'), false);
            runner.launchScenario(scenarioPath('live'), true);

            const cmd = { type: 'viewer:cmd', action: 'pause' };
            runner.sendToInteractive(cmd);

            expect(runScenario.calls[0].child.send).not.toHaveBeenCalledWith(cmd);
            expect(runScenario.calls[1].child.send).toHaveBeenCalledWith(cmd);
        });

        it('does nothing when there is no interactive job', () => {
            const { runner } = makeRunner();

            runner.launchScenario(scenarioPath('a'), false);
            expect(() => runner.sendToInteractive({ type: 'viewer:cmd', action: 'pause' })).not.toThrow();
        });

        it('does nothing when the interactive worker is disconnected', () => {
            const { runner, runScenario } = makeRunner();

            runner.launchScenario(scenarioPath('live'), true);
            const job = runScenario.calls[0];
            job.child.connected = false;

            runner.sendToInteractive({ type: 'viewer:cmd', action: 'pause' });
            expect(job.child.send).not.toHaveBeenCalled();
        });

        it('does nothing when the interactive worker has not spawned yet', () => {
            const blocked = makeDeferred();
            const runner = createScenarioRunner({
                runScenario: () => blocked.promise,
                ui: makeUi(),
                lastStart: { scenario: '', maxTicks: 0, replayBuffer: 0 },
                findScenarios: jest.fn(() => []),
                killProcessTree: jest.fn(),
                onIpcMessage: jest.fn(),
                scenariosDir: SCENARIOS_DIR,
                stopGraceMs: 100,
            });

            runner.launchScenario(scenarioPath('live'), true);
            expect(() => runner.sendToInteractive({ type: 'viewer:cmd', action: 'pause' })).not.toThrow();
        });
    });
});
