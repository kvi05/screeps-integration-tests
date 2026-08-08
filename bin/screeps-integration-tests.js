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
const { assertDir, FrameworkError } = require('../src/lib/errors');
const { createUiServer } = require('../src/tools/viewer/server');

/** @type {number} Maximum framework warnings to show in summary */
const SUMMARY_WARNINGS_LIMIT = 6;

/**
 * @typedef {import('../src/lib/types').WorkerMessage} WorkerMessage
 * @typedef {import('../src/lib/types').SummaryEntry} SummaryEntry
 */

const RUNNER_SCRIPT = path.join(__dirname, '..', 'src', 'runScenario.js');

/** @type {import('child_process').ChildProcess|null} Active child for viewer live-control commands */
let activeChild = null;

/** @type {import('../src/tools/viewer/server').UiServer|null} UI server ref for viewer:status updates */
let uiServer = null;

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
 * @param {string} scenarioPath - Absolute path to the `.scenario.js` file
 * @param {Object} opts - Options forwarded to the scenario's `run()`:
 *   `{ profiling?: boolean, viewer?: boolean }`
 * @param {number} timeout - Per-scenario timeout in ms
 * @param {string|null} roomFixturesDir - Directory to auto-load room fixtures from
 * @param {Function|null} onViewerFrame - Callback for viewer:frame messages (signature: (frame) => void)
 * @param {boolean} [interactive] - If true, this scenario owns the viewer (activeChild, frames broadcast)
 * @returns {Promise<WorkerMessage & {time?: number}>}
 */
async function runScenarioInWorker(scenarioPath, opts, timeout, roomFixturesDir, onViewerFrame, interactive) {
    const child = fork(RUNNER_SCRIPT, [], { silent: true });
    pipeChildStreams(child);
    const startTime = Date.now();

    // Only interactive scenarios receive viewer control commands
    if (interactive) {
        activeChild = child;
    }

    const ac = new AbortController();
    const timer = setTimeout(() => {
        ac.abort();
        treeKill(child.pid, 'SIGKILL', () => {});
    }, timeout);

    try {
        await once(child, 'spawn', { signal: ac.signal });
        child.send({ scenarioPath, opts, roomFixturesDir });
        // Listen for ALL messages: viewer:frame → broadcast, otherwise → result
        /** @type {WorkerMessage & { time?: number }} */
        const result = await new Promise((resolve, reject) => {
            function onMessage(msg) {
                if (msg && msg.type === 'viewer:frame') {
                    // Forward to SSE clients via the broadcast callback
                    if (onViewerFrame) {
                        try {
                            onViewerFrame(msg);
                        } catch {
                            // Non-critical
                        }
                    }
                    return; // Keep listening for the final result
                }
                if (msg && msg.type === 'viewer:status') {
                    // Update server status in UI server
                    if (uiServer) {
                        try {
                            uiServer.updateStatus(msg);
                        } catch {
                            // Non-critical
                        }
                    }
                    return; // Keep listening
                }
                if (msg && msg.type === 'viewer:snapshot') {
                    // Save snapshot to file
                    if (msg.data) {
                        try {
                            const dir = path.join(process.cwd(), 'snapshots');
                            fs.mkdirSync(dir, { recursive: true });
                            const filename = `snapshot-${Date.now()}.json`;
                            fs.writeFileSync(path.join(dir, filename), JSON.stringify(msg.data, null, 2));
                            console.log(`[viewer] Snapshot saved: ${path.join(dir, filename)}`);
                        } catch (err) {
                            console.error(`[viewer] Failed to save snapshot: ${err.message}`);
                        }
                    }
                    return; // Keep listening
                }
                if (msg && msg.type === 'viewer:scenario-result') {
                    // Forward scenario result to SSE clients
                    if (uiServer) {
                        try {
                            uiServer.broadcastScenarioResult(msg);
                        } catch {
                            // Non-critical
                        }
                    }
                    return; // Keep listening
                }
                if (msg && msg.type === 'viewer:disposed') {
                    // Worker disposed — clear active child
                    if (activeChild === child) {
                        activeChild = null;
                    }
                    return; // Keep listening
                }
                // This is the final result (pass/skip/fail)
                cleanup();
                resolve(msg);
            }

            function onError(err) {
                cleanup();
                reject(err);
            }

            function onExit(code, signal) {
                cleanup();
                const reason = code !== null ? `exit code ${code}` : `signal ${signal}`;
                reject(new Error(`Worker exited unexpectedly (${reason})`));
            }

            function onAbort() {
                cleanup();
                reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
            }

            function cleanup() {
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
        if (activeChild === child) {
            activeChild = null;
        }
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
            const showLines = errorLines.slice(0, 10);
            for (const line of showLines) {
                console.log(`       ${line.trim()}`);
            }
            if (errorLines.length > 10) {
                console.log(`       ... (${errorLines.length - 10} more lines)`);
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

    // ★ Start UI server if viewer is enabled
    /** @type {Function|null} */
    let onViewerFrame = null;
    if (config.viewer) {
        /** @type {boolean} */
        let terrainSent = false;
        /** @type {{scenario:string, maxTicks:number}|null} */
        const lastStart = { scenario: '', maxTicks: 0 };
        /** @type {Array<{scenarioPath:string, interactive:boolean}>} */
        const scenarioQueue = [];
        let activeCount = 0;
        const maxJobs = config.jobs || 4;

        onViewerFrame = (frame) => {
            if (!terrainSent && uiServer && frame.terrain && Object.keys(frame.terrain).length > 0) {
                terrainSent = true;
                uiServer.broadcastTerrain(frame.terrain);
            }
            uiServer.broadcast(frame);
        };

        /** Process scenario queue with concurrency limit */
        function processQueue() {
            while (scenarioQueue.length > 0 && activeCount < maxJobs) {
                const { scenarioPath, interactive } = scenarioQueue.shift();
                activeCount++;
                console.log(`[viewer] Launching: ${scenarioPath} (active=${activeCount}/${maxJobs})`);
                const scenarioName = path.basename(scenarioPath, '.scenario.js');

                const opts = {
                    profiling: config.profiling || false,
                };

                // Interactive scenarios: show in viewer, start paused.
                // Headless scenarios: run silently, only final status reported.
                if (interactive) {
                    opts.viewer = { port: uiServer?.port, paused: false };
                    terrainSent = false;
                    lastStart.scenario = scenarioName;
                    lastStart.maxTicks = 0;
                    if (uiServer) {
                        uiServer.broadcastStart(scenarioName, 0);
                    }
                }

                runScenarioInWorker(
                    scenarioPath,
                    opts,
                    config.timeout,
                    config.roomFixturesDir,
                    onViewerFrame,
                    interactive,
                )
                    .then((result) => {
                        activeCount--;
                        if (result.status === 'fail' || result.status === 'timeout') {
                            console.error(`[viewer] ${scenarioName} failed: ${result.error || result.status}`);
                        }
                        processQueue(); // start next queued scenario
                    })
                    .catch((err) => {
                        activeCount--;
                        console.error(`[viewer] ${scenarioName} error: ${err.message}`);
                        processQueue();
                    });
            }
        }

        /** Launch a scenario (via REST): queue it and start processing */
        const launchScenario = (scenarioPath, _interactive) => {
            scenarioQueue.push({ scenarioPath, interactive: !!_interactive });
            processQueue();
        };

        try {
            uiServer = await createUiServer({
                scenariosDir: config.scenariosDir,
                lastStart,
                sendCommand: (cmd) => {
                    if (activeChild && activeChild.connected) {
                        activeChild.send(cmd);
                    }
                },
                onRunScenario: launchScenario,
            });
        } catch (err) {
            console.error('[runner] Failed to start UI server:', err.message);
            process.exit(1);
        }

        // Viewer mode: keep process alive for interactive commands, no batch scenarios
        const viewerUrl = `http://127.0.0.1:${uiServer.port}`;

        // If --only was specified, auto-launch that scenario
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

            // ★ Signal viewer: scenario started
            if (uiServer) {
                uiServer.broadcastStart(name, 0);
            }

            const result = await runScenarioInWorker(
                scenarioPath,
                { profiling: config.profiling, viewer: config.viewer },
                config.timeout,
                config.roomFixturesDir,
                onViewerFrame,
            );

            // ★ Signal viewer: scenario ended
            if (uiServer) {
                const ticksRun = result.result?.ticksRun || 0;
                uiServer.broadcastEnd(result.status, ticksRun);
            }

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

    // ★ Keep UI server alive so the user can scrub through the finished scenario
    if (uiServer) {
        console.log(
            `[viewer] All scenarios finished. UI server at http://127.0.0.1:${uiServer.port} — press Ctrl+C to stop.`,
        );
    }

    const allPassed = printSummary(results);
    // Don't exit — keep the process alive for the UI server
    if (!uiServer) {
        process.exit(allPassed ? 0 : 1);
    }
}

main().catch((e) => {
    console.error('[runner] Fatal error:', e);
    process.exit(1);
});
