#!/usr/bin/env node

/**
 * @file CLI runner for `screeps-integration-tests`.
 *
 * Responsibility:
 *   Parse CLI flags → load configuration → discover scenarios →
 *   run each scenario in an isolated child process (fork) with a
 *   configurable job pool → collect results → print summary.
 *
 *   Also handles optional build command execution, profiling data
 *   collection (callgrind), cache pruning, and room fixture preloading.
 *
 * Entry point for the `npx screeps-integration-tests` command.
 *
 * @module bin/screeps-integration-tests
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { fork, spawn } = require('child_process');
const treeKill = require('tree-kill');
const { once } = require('events');

const { resolveConfig, printHelpAndExit, printVersionAndExit } = require('../src/lib/config/config');
const { saveCallgrind } = require('../src/lib/runtime/profile');
const { pruneCache } = require('../src/lib/runtime/cleanup');
const { ensureEngineSnapshotCompat } = require('../src/lib/runtime/engineSnapshot');
const { assertDir, FrameworkError } = require('../src/lib/errors');
const { createUiServer } = require('../src/tools/viewer/server');
const { createMemoryHistory } = require('../src/tools/viewer/memoryHistory');

/** @type {number} Maximum framework warnings to show in summary */
const SUMMARY_WARNINGS_LIMIT = 6;
/** @type {number} Maximum lines of error output in summary */
const SUMMARY_ERROR_LINES = 10;
/**
 * Grace period (ms) after a worker exits to wait for its final IPC message.
 *
 * The worker flushes its final message to the channel before exiting
 * (process.send callback), but the parent has no ordering guarantee between
 * the 'message' and 'exit' events. If 'exit' arrives first, this window lets
 * the already-flushed message resolve the run instead of reporting
 * "Worker exited unexpectedly" for a scenario that actually completed.
 *
 * @type {number}
 */
const WORKER_EXIT_GRACE_MS = 250;

/**
 * @typedef {import('../src/lib/types').WorkerMessage} WorkerMessage
 * @typedef {import('../src/lib/types').SummaryEntry} SummaryEntry
 *
 * @typedef {Object} SnapshotDump — full world snapshot sent by worker via viewer:snapshot-data IPC
 * @property {{scenario:string, timestamp:string, tick:number, bots:string[], rooms:string[]}} meta
 * @property {{'rooms.objects':Object[], 'rooms.terrain':Object[], 'rooms.flags':Object[]}} db
 * @property {{gameTime:number, memory:Object<string,Object>, roomStatus:Object|null, accessibleRooms:string[]|null}} env
 */

const RUNNER_SCRIPT = path.join(__dirname, '..', 'src', 'runScenario.js');

/** @type {import('child_process').ChildProcess|null} Active child for viewer live-control commands */
let activeChild = null;

/** @type {import('../src/tools/viewer/server').UiServer|null} UI server ref for viewer:status updates */
let uiServer = null;

/** @type {ReturnType<typeof createMemoryHistory>|null} Memory history ring buffer */
let memoryHistory = null;

/**
 * Determines if an IPC message is a final scenario result (as opposed to
 * an intermediate tool message like viewer:frame or viewer:status).
 *
 * @param {Object} msg
 * @returns {boolean}
 */
function isFinalMessage(msg) {
    if (!msg) return false;
    // Exclude typed messages (viewer:*, etc.) — they have a `type` field.
    // Only messages with just a `status` are final worker results.
    if (msg.type) return false;
    return msg.status === 'pass' || msg.status === 'skip' || msg.status === 'fail';
}

/**
 * Pipes a child process's stdio streams to the parent, filtering out
 * known `@screeps/common` storage disconnection messages that appear
 * during normal mockup-server shutdown.
 *
 * @param {import('child_process').ChildProcess} child
 */
function pipeChildStreams(child) {
    if (child.stdout) {
        // Forward manually instead of pipe(): `pipe()` registers 4 listeners
        // (unpipe/error/close/finish) on `process.stdout` per worker, which
        // trips MaxListenersExceededWarning once 11+ workers run concurrently.
        child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    }

    if (!child.stderr) {
        return;
    }

    let buffer = '';
    let droppingStorageError = false;

    child.stderr.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop();

        for (const line of lines) {
            if (droppingStorageError) {
                if (/^\s/.test(line) || line === '}') {
                    continue;
                }
                droppingStorageError = false;
            }

            if (line.includes('Storage connection lost')) {
                droppingStorageError = true;
                continue;
            }
            if (line.includes('Connecting to storage')) {
                continue;
            }

            process.stderr.write(`${line}\n`);
        }
    });

    child.stderr.on('end', () => {
        if (!buffer) {
            return;
        }
        if (droppingStorageError && (/^\s/.test(buffer) || buffer === '}')) {
            return;
        }
        if (buffer.includes('Storage connection lost') || buffer.includes('Connecting to storage')) {
            return;
        }
        process.stderr.write(`${buffer}\n`);
    });
}

/**
 * Runs a single shell build command in a child process with inherited stdio.
 * Supports Windows shells automatically via `shell: true`.
 *
 * @param {string} command - Build command (e.g. `'npm run build'`)
 * @param {string} cwd - Working directory to run the command in
 * @returns {Promise<void>} Resolves on exit code 0, rejects otherwise
 */
async function runBuild(command, cwd) {
    const [cmd, ...args] = command.split(/\s+/);
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, {
            cwd,
            stdio: 'inherit',
            shell: process.platform === 'win32',
        });
        proc.on('error', reject);
        proc.on('exit', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Build command failed with exit code ${code}: ${command}`));
            }
        });
    });
}

/**
 * Finds all `*.scenario.js` files in the given directory.
 * `smoke-*` scenarios come first; the rest are sorted alphabetically.
 *
 * @param {string} scenariosDir - Directory to scan
 * @param {string|null} only - If set, filter to the scenario with this name (no extension)
 * @returns {string[]} Sorted array of filenames (e.g. `['smoke-empty.scenario.js', ...]`)
 * @throws {MissingDirectoryError} If the scenarios directory does not exist
 */
function findScenarios(scenariosDir, only) {
    assertDir(scenariosDir, 'MISSING_SCENARIOS_DIR');

    const files = fs
        .readdirSync(scenariosDir)
        .filter((f) => f.endsWith('.scenario.js'))
        .sort((a, b) => {
            if (a.startsWith('smoke-')) {
                return -1;
            }
            if (b.startsWith('smoke-')) {
                return 1;
            }
            return a.localeCompare(b);
        });

    if (only) {
        const matched = files.find((f) => f.replace('.scenario.js', '') === only);
        if (!matched) {
            const available = files.map((f) => `  - ${f.replace('.scenario.js', '')}`).join('\n');
            console.error(
                `\n  Scenario "${only}" not found in:\n    ${scenariosDir}\n\n` +
                    `  Available scenarios:\n${available || '  (none)'}\n`,
            );
            process.exit(1);
        }
        return [matched];
    }

    return files;
}

/**
 * Runs a single scenario in an isolated child process via `child_process.fork`.
 * Each scenario gets its own `ScreepsServer` instance; the worker handles
 * setup, execution, and disposal.
 *
 * If the worker does not respond within `timeout` ms the process is killed
 * via `tree-kill` (SIGKILL) and a `timeout` status is returned.
 *
 * Intermediate (non-final) IPC messages are forwarded to `onIpcMessage` for
 * tool-specific handling (viewer frames, status updates, etc.).
 *
 * @param {string} scenarioPath - Absolute path to the `.scenario.js` file
 * @param {Object} opts - Options forwarded to the scenario's `run()`
 * @param {number} timeout - Per-scenario timeout in ms
 * @param {string|null} roomFixturesDir - Directory to auto-load room fixtures from
 * @param {Function|null} [onIpcMessage] - Callback for intermediate IPC messages: (msg, child) => void
 * @returns {Promise<WorkerMessage & {time?: number}>}
 */
async function runScenarioInWorker(scenarioPath, opts, timeout, roomFixturesDir, onIpcMessage) {
    // SIT_SNAPSHOTS_DIR is read directly by lib/orchestration/world.js
    // (resolveSnapshotsDir). Passing it via env guarantees the value reaches
    // createWorld even when a scenario does not spread opts into it.
    const child = fork(RUNNER_SCRIPT, [], {
        silent: true,
        env: {
            ...process.env,
            ...(opts && opts.snapshotsDir ? { SIT_SNAPSHOTS_DIR: opts.snapshotsDir } : {}),
        },
    });
    pipeChildStreams(child);
    const startTime = Date.now();

    const ac = new AbortController();
    const timer = setTimeout(() => {
        ac.abort();
        treeKill(child.pid, 'SIGKILL', () => {});
    }, timeout);

    try {
        await once(child, 'spawn', { signal: ac.signal });
        child.send({ scenarioPath, opts, roomFixturesDir });

        /** @type {WorkerMessage & { time?: number }} */
        const result = await new Promise((resolve, reject) => {
            let finalReceived = false;
            /** @type {ReturnType<typeof setTimeout>|null} Timer started when 'exit' beats 'message' */
            let exitGraceTimer = null;

            function onMessage(msg) {
                if (isFinalMessage(msg)) {
                    finalReceived = true;
                    if (exitGraceTimer) {
                        // The worker exited before its final message was
                        // processed — the message was still delivered, so
                        // this is a recovered result, not a failure.
                        console.warn(
                            `[runner] ${path.basename(scenarioPath)}: worker exited before its ` +
                                'final message was processed — recovered the flushed message',
                        );
                    }
                    cleanup();
                    resolve(msg);
                    return;
                }
                // Forward non-final messages to caller for tool-specific handling
                if (onIpcMessage) {
                    try {
                        onIpcMessage(msg, child);
                    } catch {
                        /* non-critical */
                    }
                }
            }

            function onError(err) {
                cleanup();
                reject(err);
            }

            function onExit(code, signal) {
                if (finalReceived) {
                    return; // already resolved via the final message
                }
                // The worker exits right after flushing its final message
                // (send callback). 'exit' may be processed before 'message'
                // — give the flushed message a short window to arrive before
                // declaring the worker dead.
                const reason = code !== null ? `exit code ${code}` : `signal ${signal}`;
                exitGraceTimer = setTimeout(() => {
                    cleanup();
                    reject(new Error(`Worker exited unexpectedly (${reason})`));
                }, WORKER_EXIT_GRACE_MS);
            }

            function onAbort() {
                cleanup();
                reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
            }

            function cleanup() {
                clearTimeout(exitGraceTimer);
                child.removeListener('message', onMessage);
                child.removeListener('error', onError);
                child.removeListener('exit', onExit);
                ac.signal.removeEventListener('abort', onAbort);
            }

            child.on('message', onMessage);
            child.on('error', onError);
            child.on('exit', onExit);
            ac.signal.addEventListener('abort', onAbort);
        });

        return { ...result, time: Date.now() - startTime };
    } catch (err) {
        if (err.name === 'AbortError') {
            return { status: 'timeout', error: `Timeout after ${timeout}ms` };
        }
        if (err instanceof Error) {
            return { status: 'fail', error: err.stack || err.message };
        }
        return { status: 'fail', error: String(err) };
    } finally {
        clearTimeout(timer);
        child.removeAllListeners();
    }
}

/**
 * Prints a summary table of all scenario results to stdout.
 *
 * @param {SummaryEntry[]} results - Array of results from each scenario worker
 * @returns {boolean} `true` if all scenarios passed
 */
function printSummary(results) {
    console.log('\n========== SUMMARY ==========');
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const { name, status, error, time, result } of results) {
        const icon = status === 'pass' ? 'PASS' : status === 'skip' ? 'SKIP' : 'FAIL';
        const timeStr = time !== undefined ? ` (${Math.round(time / 1000)}s)` : '';
        console.log(`  ${icon} ${name}${timeStr}`);
        if (error) {
            // Show the first meaningful lines of the error (up to 10).
            // FrameworkError.toString() produces multi-line formatted messages;
            // raw errors have a stack trace — the first few lines are the most useful.
            const errorLines = error.trim().split('\n');
            const showLines = errorLines.slice(0, SUMMARY_ERROR_LINES);
            for (const line of showLines) {
                console.log(`       ${line.trim()}`);
            }
            if (errorLines.length > SUMMARY_ERROR_LINES) {
                console.log(`       ... (${errorLines.length - SUMMARY_ERROR_LINES} more lines)`);
            }
        }
        if (result?.frameworkWarnings?.length > 0) {
            const limit = SUMMARY_WARNINGS_LIMIT;
            const warnings = result.frameworkWarnings;
            const count = warnings.length;
            console.log(`       ⚠ framework warnings (${count}):`);
            for (let i = 0; i < Math.min(count, limit); i++) {
                console.log(`         - ${warnings[i]}`);
            }
            if (count > limit) {
                console.log(`         ... and ${count - limit} more`);
            }
        }
        if (status === 'pass') {
            passed++;
        } else if (status === 'skip') {
            skipped++;
        } else {
            failed++;
        }
    }

    console.log(`\n  Total: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    return failed === 0;
}

/**
 * Viewer mode: starts the UI server, manages scenario queue with
 * concurrency control, routes IPC messages to SSE clients.
 *
 * This function owns ALL viewer-specific logic: UI server lifecycle,
 * IPC routing (viewer:frame → SSE, viewer:status → status update, etc.),
 * active child tracking for live commands, and scenario queue management.
 *
 * Blocks indefinitely — the process stays alive for interactive use.
 *
 * @param {import('../src/lib/config').FrameworkConfig} config
 * @returns {Promise<void>}
 */
async function runViewerMode(config) {
    /** @type {boolean} */
    let terrainSent = false;
    /** @type {{scenario:string, maxTicks:number, replayBuffer:number}} */
    const lastStart = { scenario: '', maxTicks: 0, replayBuffer: 0 };
    /** @type {Array<{scenarioPath:string, interactive:boolean, snapshotData?:Object}>} */
    const scenarioQueue = [];
    let activeCount = 0;
    // Interactive scenarios run one-at-a-time to avoid viewer race conditions.
    // Headless scenarios (no viewer frames) can run in parallel up to maxJobs.
    const maxJobs = config.jobs || 4;
    const maxInteractive = 1;
    let interactiveRunning = 0;

    // Create Memory history ring buffer — capacity matches viewer replay buffer
    // so client-side and server-side ring buffers stay in sync.
    const replayBufferTicks = config.viewerOptions.replayBuffer;
    memoryHistory = createMemoryHistory({
        maxTicks: replayBufferTicks,
    });

    /**
     * Sends a dispose command to the currently running interactive scenario.
     * The scenario will stop gracefully via its tick interceptor (beforeTick
     * returns true → tick loop exits → worker sends final result → exits).
     */
    function disposeActiveScenario() {
        if (activeChild && activeChild.connected) {
            activeChild.send({ type: 'viewer:cmd', action: 'dispose' });
            // activeChild is cleared when viewer:disposed IPC arrives
            // or when the scenario finishes naturally (see processQueue .then/.catch)
        }
    }

    /**
     * Routes intermediate IPC messages from workers to SSE clients.
     * @param {Object} msg
     * @param {import('child_process').ChildProcess} child
     */
    function routeIpcMessage(msg, child) {
        switch (msg.type) {
            case 'viewer:frame':
                if (!terrainSent && uiServer && msg.terrain && Object.keys(msg.terrain).length > 0) {
                    terrainSent = true;
                    uiServer.broadcastTerrain(msg.terrain);
                }
                if (uiServer) uiServer.broadcast(msg);
                break;
            case 'viewer:status':
                if (uiServer) uiServer.updateStatus(msg);
                break;
            case 'viewer:snapshot':
                if (msg.data) {
                    try {
                        const dir = config.snapshotsDir;
                        fs.mkdirSync(dir, { recursive: true });
                        const filename = `snapshot-${Date.now()}.json`;
                        fs.writeFileSync(path.join(dir, filename), JSON.stringify(msg.data, null, 2));
                        console.log(`[viewer] Snapshot saved: ${path.join(dir, filename)}`);
                    } catch (err) {
                        console.error(`[viewer] Failed to save snapshot: ${err.message}`);
                    }
                }
                break;
            case 'viewer:snapshot-data':
                if (msg.dump) {
                    /** @type {SnapshotDump} */
                    const dump = msg.dump;
                    try {
                        const dir = config.snapshotsDir;
                        fs.mkdirSync(dir, { recursive: true });
                        // Extract scenario name from path: /path/to/my-scenario.scenario.js → my-scenario
                        const scenarioRaw = dump.meta.scenario || '';
                        const scenarioName =
                            path
                                .basename(scenarioRaw)
                                .replace(/\.scenario\.js$/, '')
                                .replace(/[<>:"/\\|?*]/g, '_') || 'unknown';

                        // Human-readable timestamp: YYYY-MM-DD_HH-mm
                        const now = new Date();
                        const pad = (n) => String(n).padStart(2, '0');
                        const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
                        const filename = `snapshot-${scenarioName}-tick${dump.meta.tick}-${ts}.json`;
                        const filepath = path.join(dir, filename);
                        fs.writeFileSync(filepath, JSON.stringify(dump));
                        console.log(`[viewer] Snapshot saved: ${filepath}`);
                        if (activeChild && activeChild.connected) {
                            activeChild.send({
                                type: 'viewer:snapshot-saved',
                                path: filepath,
                            });
                        }
                    } catch (err) {
                        console.error(`[viewer] Failed to save snapshot: ${err.message}`);
                    }
                }
                break;
            case 'viewer:snapshot-error':
                console.error(`[viewer] Snapshot save failed: ${msg.error}`);
                break;
            case 'viewer:restored':
                if (uiServer) {
                    uiServer.updateStatus({
                        state: 'running',
                        tick: msg.tick,
                    });
                    // Tell clients to reset their local frame buffer
                    uiServer.broadcastRestored(msg.tick);
                }
                break;
            case 'viewer:restore-error':
                console.error(`[viewer] Restore failed: ${msg.error}`);
                if (uiServer) {
                    // Broadcast error to SSE clients so UI can display it.
                    // Do NOT call updateStatus here — the worker already sends
                    // the correct state via viewer:status (preserving wasPaused).
                    uiServer.broadcastError('restore', msg.error || 'Unknown restore error');
                }
                break;
            case 'viewer:scenario-result':
                if (uiServer) uiServer.broadcastScenarioResult(msg);
                break;
            case 'viewer:disposed':
                if (activeChild === child) activeChild = null;
                break;
            case 'viewer:memory':
                if (memoryHistory) {
                    memoryHistory.push({
                        tick: msg.tick,
                        bots: msg.bots,
                    });
                }
                break;
            case 'viewer:memory-request':
                if (memoryHistory && msg.tick !== undefined && msg.bots) {
                    /** @type {Object<string, Object>} */
                    const memories = {};
                    for (const username of msg.bots) {
                        const mem = memoryHistory.reconstruct(msg.tick, username);
                        if (mem !== null) {
                            memories[username] = mem;
                        }
                    }
                    if (child && child.connected) {
                        child.send({
                            type: 'viewer:memory-reconstruct',
                            tick: msg.tick,
                            memories,
                        });
                    }
                }
                break;
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
            const scenarioName = snapshotData
                ? snapshotData.meta && snapshotData.meta.scenario
                    ? path.basename(snapshotData.meta.scenario).replace(/\.scenario\.js$/, '')
                    : 'snapshot-launch'
                : path.basename(scenarioPath, '.scenario.js');

            const opts = { profiling: config.profiling || false, snapshotsDir: config.snapshotsDir };

            if (interactive) {
                opts.viewer = true;
                opts.viewerOptions = config.viewerOptions;
                terrainSent = false;
                lastStart.scenario = scenarioName;
                lastStart.maxTicks = 0;
                lastStart.replayBuffer = replayBufferTicks;
                if (uiServer) {
                    uiServer.broadcastStart(
                        scenarioName,
                        0,
                        replayBufferTicks,
                        config.viewerOptions ? config.viewerOptions.paused : false,
                    );
                }
                activeChild = null; // Will be set inside runScenarioInWorker via routeIpcMessage
                // Snapshot launch: pass snapshot data to worker for restore mode
                if (snapshotData) {
                    opts.restoreSnapshot = snapshotData;
                }
            }

            // For interactive scenarios, we need to track activeChild.
            // We wrap runScenarioInWorker to capture the child ref.
            runScenarioInWorker(scenarioPath, opts, config.timeout, config.roomFixturesDir, (msg, child) => {
                if (interactive && msg.type === 'viewer:status') {
                    // Track the active child for live commands
                    if (!activeChild) activeChild = child;
                }
                routeIpcMessage(msg, child);
            })
                .then((result) => {
                    activeCount--;
                    if (interactive) interactiveRunning--;
                    // Clear active child if this was our interactive scenario
                    if (interactive) activeChild = null;
                    // Tell the viewer the scenario has finished so the client
                    // switches to local replay of the recorded frames.
                    if (interactive && uiServer) {
                        uiServer.broadcastEnd(result.status, result.result?.ticksRun || 0);
                    }
                    if (result.status === 'fail' || result.status === 'timeout') {
                        console.error(`[viewer] ${scenarioName} failed: ${result.error || result.status}`);
                    }
                    processQueue();
                })
                .catch((err) => {
                    activeCount--;
                    if (interactive) interactiveRunning--;
                    if (interactive) activeChild = null;
                    console.error(`[viewer] ${scenarioName} error: ${String(err?.message || err)}`);
                    processQueue();
                });
        }
    }

    /** Launch a scenario (via REST): queue it and start processing */
    const launchScenario = (scenarioPath, interactive) => {
        if (interactive) {
            // Kill any currently-running interactive scenario before starting a new one.
            // The old scenario will stop gracefully through its tick interceptor.
            disposeActiveScenario();
        }
        scenarioQueue.push({ scenarioPath, interactive: !!interactive });
        processQueue();
    };

    /**
     * Launch a world from a saved snapshot (via REST).
     * Uses the existing worker infrastructure — the worker detects
     * `opts.restoreSnapshot` and creates the world from snapshot meta
     * instead of requiring a scenario file.
     *
     * @param {Object} snapshotData — full snapshot object from disk
     */
    const launchFromSnapshot = (snapshotData) => {
        // Dispose existing interactive scenario if any
        disposeActiveScenario();

        // Queue as interactive scenario — processQueue handles activeChild,
        // concurrency, and IPC routing (routeIpcMessage)
        scenarioQueue.push({
            scenarioPath: '', // empty — runScenario.js detects restoreSnapshot
            interactive: true,
            snapshotData,
        });
        processQueue();
    };

    try {
        uiServer = await createUiServer({
            scenariosDir: config.scenariosDir,
            snapshotsDir: config.snapshotsDir,
            lastStart,
            memoryHistory,
            sendCommand: (cmd) => {
                if (activeChild && activeChild.connected) {
                    activeChild.send(cmd);
                }
            },
            onRunScenario: launchScenario,
            onRunFromSnapshot: launchFromSnapshot,
        });
    } catch (err) {
        console.error('[runner] Failed to start UI server:', err.message);
        process.exit(1);
    }

    const viewerUrl = `http://127.0.0.1:${uiServer.port}`;

    if (config.only) {
        const scenarioPath = path.join(config.scenariosDir, `${config.only}.scenario.js`);
        console.log(`[runner] Auto-launching: ${config.only}`);
        launchScenario(scenarioPath, true);
        console.log(`[runner] Viewer mode — ${config.only} at ${viewerUrl}?viewer`);
    } else {
        console.log(`[runner] Viewer mode — Scenario Manager at ${viewerUrl}`);
    }

    console.log('[runner] Press Ctrl+C to stop.');
    await new Promise(() => {});
}

/**
 * Main entry point of the CLI runner.
 *
 * Lifecycle:
 *   1. Load / resolve configuration
 *   2. Merge config `env` into `process.env`
 *   3. Pre-load user modules (`config.require`)
 *   4. Optionally run `buildCommand` (if `--build` and `buildCommand` is set)
 *   5. Clean stale cache directories
 *   6. Discover scenario files
 *   7. Run scenarios in parallel with a job-limiting pool (`config.jobs`)
 *   8. Save profiling data (callgrind) if enabled
 *   9. Print summary and exit with 0 (all pass) or 1 (any failure)
 */
async function main() {
    /** @type {import('../src/lib/config').FrameworkConfig} */
    let config;
    try {
        ({ config } = resolveConfig());
    } catch (err) {
        if (err.name === 'HelpRequested') {
            printHelpAndExit();
        }
        if (err.name === 'VersionRequested') {
            printVersionAndExit();
        }
        if (err instanceof FrameworkError) {
            console.error(`\n${err.toString()}`);
        } else {
            console.error('[runner] Config error:', err.message);
        }
        process.exit(1);
    }

    // Injects config env variables into the parent process (inherited by workers).
    process.env.INTEGRATION_TEST = '1';
    process.env.BOT_DIST_DIR = config.distDir;
    process.env.SIT_MEMORY_FIXTURES_DIR = config.memoryFixturesDir;
    process.env.SIT_CACHE_DIR = config.cacheDir;
    for (const [key, value] of Object.entries(config.env || {})) {
        process.env[key] = String(value);
    }

    // require preload-модулей (глобальный сетап).
    for (const mod of config.require || []) {
        require(path.resolve(process.cwd(), mod));
    }

    // Сборка бота по запросу.
    if (config.build && config.buildCommand) {
        console.log(`[runner] Building bot: ${config.buildCommand}`);
        try {
            await runBuild(config.buildCommand, process.cwd());
        } catch (err) {
            console.error('[runner] Build failed:', err.message);
            process.exit(1);
        }
    }

    // Очистка кэша.
    const cleanupResult = pruneCache({ keep: config.cacheKeep, cacheDir: config.cacheDir });
    if (cleanupResult.removed > 0) {
        console.log(`[runner] Cache cleanup: removed ${cleanupResult.removed}, kept ${cleanupResult.kept}`);
    }

    // ── Engine snapshot compatibility ──────────────────────────────────
    // `@screeps/driver` ships a prebuilt V8 snapshot that breaks after every
    // Node.js upgrade. Regenerate it eagerly, ONCE per run, BEFORE any
    // worker is forked — workers then hit only the stamp fast path in
    // prepareServer (a single file read, no lock contention).
    try {
        ensureEngineSnapshotCompat();
    } catch (err) {
        if (err instanceof FrameworkError) {
            console.error(`\n${err.toString()}`);
        } else {
            console.error('[runner] Engine snapshot check failed:', err.stack || err.message);
        }
        process.exit(1);
    }

    // ── Viewer mode ────────────────────────────────────────────────────
    // When --viewer is active, delegate to the viewer runner which owns
    // its own IPC routing, queue management, and SSE broadcasting.
    if (config.viewer) {
        await runViewerMode(config);
        // runViewerMode blocks indefinitely (await new Promise(() => {}))
        return;
    }

    // ── Batch mode ──────────────────────────────────────────────────────
    const scenarioFiles = (() => {
        try {
            return findScenarios(config.scenariosDir, config.only || null);
        } catch (err) {
            if (err instanceof FrameworkError) {
                console.error(`\n${err.toString()}`);
            } else {
                console.error('[runner]', err.message);
            }
            process.exit(1);
        }
    })();
    /** @type {SummaryEntry[]} */
    const results = new Array(scenarioFiles.length);

    console.log(
        `\n[runner] Found ${scenarioFiles.length} scenario(s), jobs: ${config.jobs}, timeout: ${config.timeout}ms`,
    );
    console.log(`[runner] distDir: ${config.distDir}`);
    console.log(`[runner] scenariosDir: ${config.scenariosDir}`);

    let interrupted = false;
    const onSigInt = () => {
        interrupted = true;
        console.log('\n[runner] SIGINT received, stopping...');
    };
    process.on('SIGINT', onSigInt);

    let failed = false;
    const iterator = scenarioFiles.entries();

    const workers = Array.from({ length: config.jobs }, async () => {
        for (const [index, file] of iterator) {
            if (interrupted || (config.bail && failed)) {
                break;
            }

            const name = file.replace('.scenario.js', '');
            const scenarioPath = path.join(config.scenariosDir, file);
            const start = Date.now();

            process.stdout.write(`  Running ${name}...\n`);

            const result = await runScenarioInWorker(
                scenarioPath,
                { profiling: config.profiling, viewer: config.viewer, snapshotsDir: config.snapshotsDir },
                config.timeout,
                config.roomFixturesDir,
                null, // no IPC routing in batch mode
            );

            const time = Date.now() - start;
            results[index] = { name, ...result, time };

            if (result.status !== 'pass' && result.status !== 'skip') {
                failed = true;
            }

            if (config.profiling && result.status === 'pass' && result.result && result.result.profileCallgrind) {
                try {
                    for (const [username, data] of Object.entries(result.result.profileCallgrind)) {
                        const filePath = saveCallgrind(data, `${name}-${username}`, config.profilesDir);
                        console.log(`       callgrind (${username}): ${filePath}`);
                    }
                } catch (e) {
                    console.log(`       callgrind save failed: ${e.message}`);
                }
            }

            if (result.status === 'pass') {
                console.log(` PASS (${Math.round(time / 1000)}s)`);
            } else if (result.status === 'skip') {
                console.log(` SKIP`);
            } else {
                console.log(` FAIL (${Math.round(time / 1000)}s)`);
                if (result.error) {
                    console.log(`       ${result.error.split('\n').slice(0, 3).join('\n       ')}`);
                }
                if (config.bail) {
                    console.log('[runner] --bail: stopping on first failure');
                }
            }
        }
    });

    await Promise.all(workers);

    process.removeListener('SIGINT', onSigInt);

    const allPassed = printSummary(results);
    process.exit(allPassed ? 0 : 1);
}

main().catch((e) => {
    console.error('[runner] Fatal error:', e);
    process.exit(1);
});
