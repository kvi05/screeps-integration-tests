'use strict';

const path = require('path');

/**
 * @file Scenario queue and worker-pool runner for the viewer mode.
 *
 * Responsibility:
 *   Owns the scenario launch mechanics extracted from the CLI entry point:
 *   the pending queue, the running-job registry, concurrency limits
 *   (batch workers in parallel, interactive one-at-a-time), per-scenario
 *   and global stop semantics, the IPC routing the runner itself owns
 *   (`viewer:frame` terrain-once broadcast, suppression of late
 *   `viewer:scenario-result` from stopping jobs), and the synthesized
 *   result broadcast for workers that died without reporting one.
 *
 *   Everything that needs real processes or the real UI server is injected
 *   via `createScenarioRunner(deps)`, which keeps the queue/worker-pool
 *   mechanics unit-testable without forks, HTTP servers or real waits.
 *
 * @module src/tools/viewer/scenarioRunner
 */

/**
 * Grace period (ms) after a `dispose` command before a stopping worker is
 * force-killed. Dispose only lands inside the tick loop; a worker stuck
 * outside it (scenario code between worlds, a long await) gets tree-killed
 * after this window instead of hanging Stop All until the run timeout.
 *
 * Matches the former STOP_GRACE_MS constant in `bin/screeps-integration-tests.js`.
 *
 * @type {number}
 */
const STOP_GRACE_MS = 4000;

/**
 * Worker launcher — runs one scenario in an isolated worker process.
 *
 * Contract (load-bearing, do not change): the worker consumes its
 * configuration as the FIRST IPC message it receives, and `onChild(child)`
 * fires only after that config has been queued — a `dispose` racing the
 * spawn is therefore always delivered after the config.
 *
 * @typedef {(
 *   scenarioPath: string,
 *   opts: Object,
 *   timeout: number,
 *   roomFixturesDir: string|null,
 *   onIpcMessage?: (msg: Object, child: import('child_process').ChildProcess) => void,
 *   onChild?: (child: import('child_process').ChildProcess) => void
 * ) => Promise<import('../../lib/types').WorkerMessage & {time?: number}>} RunScenarioFn
 */

/**
 * A scenario job that has been dequeued and handed to a worker child.
 * Tracked while the worker is alive so `stopAll()` can address every
 * running scenario (interactive and batch alike).
 *
 * @typedef {Object} RunningJob
 * @property {string} name — scenario display name (basename without extension,
 *   or the snapshot's scenario name for snapshot launches)
 * @property {boolean} interactive — whether the job streams to the viewer
 * @property {import('child_process').ChildProcess|null} child — worker process (set on spawn)
 * @property {boolean} stopping — dispose was requested; late results are not broadcast
 * @property {ReturnType<typeof setTimeout>|null} killTimer — force-kill fallback timer
 * @property {boolean} resultReported — the worker sent its `viewer:scenario-result`
 *   message (a worker that died without one gets a synthesized broadcast)
 */

/**
 * A pending scenario queued for execution.
 *
 * @typedef {Object} QueuedScenario
 * @property {string} scenarioPath — absolute path to the `.scenario.js` file
 *   ('' for snapshot launches — the worker detects `restoreSnapshot`)
 * @property {boolean} interactive — whether the job streams to the viewer
 * @property {Object} [snapshotData] — full snapshot object (snapshot launches only)
 */

/**
 * Public surface of the scenario runner.
 *
 * @typedef {Object} ScenarioRunner
 * @property {(scenarioPath: string, interactive?: boolean) => void} launchScenario —
 *   queue a scenario. Interactive launches are an exclusive takeover
 *   (stopAll() first). Batch launches mean "restart this scenario": pending
 *   duplicates are dropped, running instances are disposed and exactly one
 *   fresh run is enqueued.
 * @property {() => void} runAllScenarios — atomically stop everything, then
 *   queue all discovered scenarios.
 * @property {(snapshotData: Object) => void} launchFromSnapshot — atomically
 *   stop everything, then queue an interactive snapshot launch.
 * @property {() => void} stopAll — drop the pending queue and dispose every
 *   running worker.
 * @property {(cmd: Object) => void} sendToInteractive — forward a
 *   live-control command (pause/resume/step/speed/snapshot/dispose) to the
 *   interactive job's worker.
 */

/**
 * Validates that an injected dependency is a function (fail loud, fail early).
 *
 * @param {*} value — dependency value
 * @param {string} name — dependency name for the error message
 * @returns {void}
 * @throws {TypeError} If the dependency is missing or not a function
 */
function assertFunction(value, name) {
    if (typeof value !== 'function') {
        throw new TypeError(
            `createScenarioRunner: deps.${name} must be a function (got ${value === null ? 'null' : typeof value})`,
        );
    }
}

/**
 * Creates a scenario runner — the queue/worker-pool mechanics behind the
 * viewer mode's scenario management (Scenario Manager RUN buttons, Run All,
 * Stop All, snapshot launches, interactive launches).
 *
 * @param {Object} deps — injected dependencies.
 * @param {RunScenarioFn} deps.runScenario — worker launcher. The worker
 *   consumes its configuration as the FIRST IPC message and `onChild(child)`
 *   fires after the config is queued — this ordering is load-bearing for
 *   dispose races, keep it.
 * @param {import('./server').UiServer|null} [deps.ui=null] — the viewer UI
 *   server (SSE broadcasts); `null` runs without a UI (headless embedders).
 * @param {{scenario: string, maxTicks: number, replayBuffer: number}} deps.lastStart —
 *   shared last-start info object: the runner mutates it on interactive
 *   start and the UI server re-sends it to late-connecting SSE clients.
 *   Must be the SAME object that was passed to `createUiServer`.
 * @param {(scenariosDir: string, only: string|null) => string[]} deps.findScenarios —
 *   scenario discovery used by `runAllScenarios`.
 * @param {(pid: number, signal: string, cb: (err?: Error) => void) => void} deps.killProcessTree —
 *   process-tree killer used as the stop fallback (typically a `tree-kill`
 *   wrapper); injectable so tests can assert without real kills.
 * @param {(msg: Object, child: import('child_process').ChildProcess) => void} deps.onIpcMessage —
 *   router for IPC messages the runner does not own (`viewer:status`,
 *   `viewer:memory`, snapshot saving, ...). `viewer:frame` (terrain-once +
 *   frame broadcast) and `viewer:scenario-result` from stopping jobs are
 *   handled by the runner itself and never reach this callback.
 * @param {number} [deps.maxJobs=4] — max concurrent batch workers.
 * @param {number} [deps.maxInteractive=1] — max concurrent interactive jobs.
 * @param {number} [deps.timeout=1800000] — per-scenario timeout in ms,
 *   forwarded to `runScenario` (default matches the config default).
 * @param {boolean} [deps.profiling=false] — enable profiling in scenario opts.
 * @param {string} [deps.snapshotsDir] — snapshots directory forwarded to workers.
 * @param {import('../../lib/types').ViewerOptions} [deps.viewerOptions] —
 *   viewer options forwarded to interactive workers (`paused` decides the
 *   initial status broadcast).
 * @param {string|null} [deps.roomFixturesDir=null] — room fixtures dir
 *   forwarded to workers.
 * @param {string} [deps.scenariosDir=''] — scenarios directory used by
 *   `runAllScenarios` for discovery and queue paths.
 * @param {number} [deps.replayBufferTicks=3000] — replay buffer size
 *   (re-sent to SSE clients via `lastStart.replayBuffer`).
 * @param {number} [deps.stopGraceMs=STOP_GRACE_MS] — grace period before a
 *   stopping worker is force-killed; injectable for fast tests.
 * @returns {ScenarioRunner}
 *
 * @example
 * const runner = createScenarioRunner({
 *     runScenario: runScenarioInWorker,
 *     ui: uiServer,
 *     lastStart,
 *     findScenarios,
 *     killProcessTree: (pid, signal, cb) => treeKill(pid, signal, cb),
 *     onIpcMessage: routeIpcMessage,
 *     maxJobs: config.jobs || 4,
 *     timeout: config.timeout,
 *     scenariosDir: config.scenariosDir,
 * });
 * runner.launchScenario(scenarioPath, false); // Scenario Manager RUN
 */
function createScenarioRunner(deps) {
    assertFunction(deps.runScenario, 'runScenario');
    assertFunction(deps.findScenarios, 'findScenarios');
    assertFunction(deps.killProcessTree, 'killProcessTree');
    assertFunction(deps.onIpcMessage, 'onIpcMessage');

    const {
        runScenario,
        ui = null,
        lastStart = { scenario: '', maxTicks: 0, replayBuffer: 0 },
        findScenarios,
        killProcessTree,
        onIpcMessage,
        maxJobs = 4,
        maxInteractive = 1,
        timeout = 30 * 60 * 1000,
        profiling = false,
        snapshotsDir,
        viewerOptions,
        roomFixturesDir = null,
        scenariosDir = '',
        replayBufferTicks = 3000,
        stopGraceMs = STOP_GRACE_MS,
    } = deps;

    // Terrain is broadcast once per interactive session — the client caches
    // it between frames and resets its buffer on the next `start` event.
    let terrainSent = false;

    /** @type {QueuedScenario[]} */
    const scenarioQueue = [];
    let activeCount = 0;
    // Interactive scenarios run one-at-a-time to avoid viewer race conditions.
    // Headless scenarios (no viewer frames) can run in parallel up to maxJobs.
    let interactiveRunning = 0;

    /** @type {Set<RunningJob>} */
    const runningJobs = new Set();

    /**
     * Computes the display name of a queued scenario (snapshot-aware).
     *
     * @param {QueuedScenario} item — queued scenario entry
     * @returns {string} basename without extension, the snapshot's scenario
     *   name, or `'snapshot-launch'` when the snapshot carries no scenario
     */
    function computeScenarioName(item) {
        if (item.snapshotData) {
            const metaScenario = item.snapshotData.meta && item.snapshotData.meta.scenario;
            if (metaScenario) {
                return path.basename(metaScenario).replace(/\.scenario\.js$/, '');
            }
            return 'snapshot-launch';
        }
        return path.basename(item.scenarioPath, '.scenario.js');
    }

    /**
     * Marks a job as stopping: sends `dispose` to its worker (if connected)
     * and arms the force-kill fallback timer. Late `viewer:scenario-result`
     * messages from a stopping job are not broadcast (see the routing
     * wrapper in `processQueue`), so a restart does not flicker stale
     * results over the fresh statuses in the Scenario Manager.
     *
     * @param {RunningJob} job — job to stop
     * @returns {void}
     */
    function requestStop(job) {
        if (job.stopping) return;
        job.stopping = true;
        if (job.child && job.child.connected) {
            job.child.send({ type: 'viewer:cmd', action: 'dispose' });
        }
        // Safety net: dispose only lands inside the tick loop. If the
        // worker is stuck elsewhere (scenario code between worlds, a long
        // await), force-kill the process tree after a grace period.
        job.killTimer = setTimeout(() => {
            if (job.child && job.child.pid) {
                console.warn(`[viewer] ${job.name}: did not stop gracefully, killing worker tree`);
                killProcessTree(job.child.pid, 'SIGKILL', () => {});
            }
        }, stopGraceMs);
    }

    /**
     * Gracefully stops ALL running scenarios and drops the pending queue.
     *
     * Every worker (interactive and batch) receives a `dispose` command and
     * stops via its tick interceptor (beforeTick returns true → tick loop
     * exits → worker reports `skip` → exits). The force-kill fallback covers
     * workers stuck outside the tick loop. Late `viewer:scenario-result`
     * messages from stopping jobs are not broadcast, so a restart does not
     * flicker stale results over the fresh statuses in the Scenario Manager.
     *
     * @returns {void}
     */
    function stopAll() {
        // Drop everything that has not started yet
        scenarioQueue.length = 0;

        for (const job of runningJobs) {
            requestStop(job);
        }

        if (ui) {
            ui.updateStatus({ state: 'idle', tick: 0, scenario: '' });
        }
    }

    /** Process scenario queue with concurrency limit */
    function processQueue() {
        while (scenarioQueue.length > 0 && activeCount < maxJobs) {
            // Peek before dequeue: if the next scenario is interactive and one
            // is already running, stall until it finishes. Headless scenarios
            // always pass through.
            const next = scenarioQueue[0];
            if (next.interactive && interactiveRunning >= maxInteractive) {
                break;
            }

            const { scenarioPath, interactive, snapshotData } = scenarioQueue.shift();
            activeCount++;
            if (interactive) interactiveRunning++;
            const scenarioName = computeScenarioName({ scenarioPath, interactive, snapshotData });

            const opts = { profiling, snapshotsDir };

            if (interactive) {
                opts.viewer = true;
                opts.viewerOptions = viewerOptions;
                terrainSent = false;
                lastStart.scenario = scenarioName;
                lastStart.maxTicks = 0;
                lastStart.replayBuffer = replayBufferTicks;
                const startPaused = viewerOptions ? viewerOptions.paused : false;
                if (ui) {
                    ui.broadcastStart(scenarioName, 0, replayBufferTicks, startPaused);
                    // Reflect the actual start (not just the queueing): /api/run
                    // and /api/run-all only enqueue jobs, the status turns
                    // running/paused here when a worker really takes off.
                    ui.updateStatus({
                        state: startPaused ? 'paused' : 'running',
                        scenario: scenarioName,
                    });
                }
                // Snapshot launch: pass snapshot data to worker for restore mode
                if (snapshotData) {
                    opts.restoreSnapshot = snapshotData;
                }
            } else if (ui) {
                // Batch scenario: the worker has actually taken the job off the
                // queue — tell the Scenario Manager it is running now. This is
                // the only place a batch scenario's status becomes 'running'
                // (queued scenarios stay 'pending'). Interactive launches are
                // not part of the Scenario Manager status model — the viewer
                // panel follows `start`/`end` instead.
                ui.broadcastScenarioStatus(scenarioName, 'running');
            }

            // Track the job while its worker is alive so stopAll() can address
            // it (dispose command + hard-kill fallback), regardless of mode.
            /** @type {RunningJob} */
            const job = {
                name: scenarioName,
                interactive,
                child: null,
                stopping: false,
                killTimer: null,
                resultReported: false,
            };
            runningJobs.add(job);

            /** Removes the job from the registry and cancels its fallback timer */
            const finishJob = () => {
                runningJobs.delete(job);
                if (job.killTimer) {
                    clearTimeout(job.killTimer);
                    job.killTimer = null;
                }
                // The worker process is gone — drop its resource stats so
                // /api/stats never reports dead workers.
                if (ui && job.child && job.child.pid) {
                    ui.deleteWorkerStats(job.child.pid);
                }
            };

            runScenario(
                scenarioPath,
                opts,
                timeout,
                roomFixturesDir,
                (msg, child) => {
                    // A job that is being stopped has no newsworthy results —
                    // swallowing them keeps Scenario Manager statuses stable
                    // while the run is being replaced by a fresh one.
                    if (msg.type === 'viewer:scenario-result') {
                        if (job.stopping) return;
                        job.resultReported = true;
                    }
                    if (msg.type === 'viewer:frame') {
                        // Terrain is streamed once per interactive session: the
                        // client caches it and resets on the next `start` event.
                        if (!terrainSent && ui && msg.terrain && Object.keys(msg.terrain).length > 0) {
                            terrainSent = true;
                            ui.broadcastTerrain(msg.terrain);
                        }
                        if (ui) {
                            ui.broadcast(msg);
                        }
                        return;
                    }
                    onIpcMessage(msg, child);
                },
                (child) => {
                    job.child = child;
                    // A stop raced the spawn: the job was marked stopping
                    // before the worker existed. The config is already queued
                    // ahead of this command, and the worker pre-arms a dispose
                    // flag at boot, so the stop is never lost.
                    if (job.stopping && child.connected) {
                        child.send({ type: 'viewer:cmd', action: 'dispose' });
                    }
                },
            )
                .then((result) => {
                    finishJob();
                    activeCount--;
                    if (interactive) interactiveRunning--;
                    // The worker reports its own result via
                    // `viewer:scenario-result`, but a worker that died without
                    // a final message (timeout, hard kill, spawn crash) never
                    // gets to send it — synthesize the broadcast here so the
                    // Scenario Manager does not keep the stale 'running' status.
                    if (ui && !job.resultReported && !job.stopping) {
                        ui.broadcastScenarioResult({
                            scenario: scenarioName,
                            status: result.status === 'pass' ? 'pass' : result.status === 'skip' ? 'skip' : 'fail',
                            time: result.time || 0,
                            totalTicks: result.totalTicks || 0,
                        });
                    }
                    // Tell the viewer the scenario has finished so the client
                    // switches to local replay of the recorded frames.
                    if (interactive && ui) {
                        // totalTicks is summed across all worlds by the worker;
                        // the scenario result holds only the last world's report.
                        ui.broadcastEnd(result.status, result.totalTicks || 0);
                    }
                    if (result.status === 'fail' || result.status === 'timeout') {
                        console.error(`[viewer] ${scenarioName} failed: ${result.error || result.status}`);
                    }
                    processQueue();
                })
                .catch((err) => {
                    finishJob();
                    activeCount--;
                    if (interactive) interactiveRunning--;
                    console.error(`[viewer] ${scenarioName} error: ${String(err?.message || err)}`);
                    if (ui && !job.resultReported && !job.stopping) {
                        ui.broadcastScenarioResult({
                            scenario: scenarioName,
                            status: 'fail',
                            time: 0,
                            totalTicks: 0,
                        });
                    }
                    processQueue();
                });
        }
    }

    /**
     * Launch a scenario (via REST): queue it and start processing.
     *
     * Interactive launches are an exclusive takeover (unchanged semantics):
     * stop every running scenario, drop the queue, then launch this scenario
     * alone.
     *
     * Batch launches mean "restart this scenario": pending duplicates of the
     * same scenario are removed from the queue, running instances of the
     * same scenario are stopped (dispose + force-kill fallback; their late
     * results are not broadcast) and exactly one fresh run is enqueued.
     * Repeated RUN clicks therefore never duplicate the scenario — after the
     * click it has exactly one instance (pending or running), a fresh one.
     *
     * A batch restart only touches batch (Scenario Manager) instances —
     * interactive instances belong to the viewer panel's exclusive
     * single-slot model and are left alone.
     *
     * @param {string} scenarioPath — absolute path to the `.scenario.js` file
     * @param {boolean} [interactive=false] — launch in interactive (viewer) mode
     * @returns {void}
     */
    const launchScenario = (scenarioPath, interactive) => {
        if (interactive) {
            stopAll();
            scenarioQueue.push({ scenarioPath, interactive: true });
            processQueue();
            return;
        }

        const name = path.basename(scenarioPath, '.scenario.js');

        // Drop pending duplicates — a queued scenario must not be queued twice.
        for (let i = scenarioQueue.length - 1; i >= 0; i--) {
            const item = scenarioQueue[i];
            if (!item.interactive && path.basename(item.scenarioPath, '.scenario.js') === name) {
                scenarioQueue.splice(i, 1);
            }
        }

        // Stop running instances of the same scenario; the fresh run queued
        // below replaces them.
        for (const job of runningJobs) {
            if (job.interactive) continue;
            if (job.name === name) {
                requestStop(job);
            }
        }

        scenarioQueue.push({ scenarioPath, interactive: false });
        processQueue();
    };

    /**
     * Run All (via REST): atomically stop everything, then queue all
     * discovered scenarios. A single request performs the whole restart, so
     * repeated Run All clicks can never duplicate queue entries.
     *
     * @returns {void}
     */
    const runAllScenarios = () => {
        stopAll();
        try {
            const files = findScenarios(scenariosDir, null);
            for (const file of files) {
                scenarioQueue.push({
                    scenarioPath: path.join(scenariosDir, file),
                    interactive: false,
                });
            }
        } catch (err) {
            console.error(`[viewer] Run All failed to discover scenarios: ${err.message || err}`);
        }
        processQueue();
    };

    /**
     * Launch a world from a saved snapshot (via REST).
     * Uses the existing worker infrastructure — the worker detects
     * `opts.restoreSnapshot` and creates the world from snapshot meta
     * instead of requiring a scenario file.
     *
     * Interactive takeover: stops all running scenarios (any mode) and drops
     * the pending queue before starting from the snapshot.
     *
     * @param {Object} snapshotData — full snapshot object from disk
     * @returns {void}
     */
    const launchFromSnapshot = (snapshotData) => {
        stopAll();

        // Queue as interactive scenario — processQueue handles the job
        // registry, concurrency, and IPC routing
        scenarioQueue.push({
            scenarioPath: '', // empty — runScenario.js detects restoreSnapshot
            interactive: true,
            snapshotData,
        });
        processQueue();
    };

    /**
     * Forwards a live-control command (pause/resume/step/speed/snapshot/
     * dispose) to the single interactive job's worker.
     *
     * @param {Object} cmd — command object sent to the worker via IPC
     * @returns {void}
     */
    const sendToInteractive = (cmd) => {
        const interactiveJob = Array.from(runningJobs).find((j) => j.interactive);
        if (interactiveJob && interactiveJob.child && interactiveJob.child.connected) {
            interactiveJob.child.send(cmd);
        }
    };

    return { launchScenario, runAllScenarios, launchFromSnapshot, stopAll, sendToInteractive };
}

module.exports = { createScenarioRunner };
