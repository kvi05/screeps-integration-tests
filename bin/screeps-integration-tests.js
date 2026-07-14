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

const { resolveConfig, printHelpAndExit } = require('../src/lib/config');
const { saveCallgrind } = require('../src/lib/profile');
const { pruneCache } = require('../src/lib/cleanup');

/**
 * @typedef {import('../src/lib/types').WorkerMessage} WorkerMessage
 * @typedef {import('../src/lib/types').SummaryEntry} SummaryEntry
 */

const RUNNER_SCRIPT = path.join(__dirname, '..', 'src', 'runScenario.js');

/**
 * Pipes a child process's stdio streams to the parent, filtering out
 * known `@screeps/common` storage disconnection messages that appear
 * during normal mockup-server shutdown.
 *
 * @param {import('child_process').ChildProcess} child
 */
function pipeChildStreams(child) {
    if (child.stdout) {
        child.stdout.pipe(process.stdout);
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
 * @throws {never} Exits the process if `only` is set and the scenario is not found
 */
function findScenarios(scenariosDir, only) {
    if (!fs.existsSync(scenariosDir)) {
        console.error(`[runner] Scenarios directory not found: ${scenariosDir}`);
        console.error(`  Create it or specify --scenariosDir / create screeps-integration.config.js`);
        process.exit(1);
    }

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
            console.error(`[runner] scenario "${only}" not found in ${scenariosDir}`);
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
 *   `{ profiling?: boolean }`
 * @param {number} timeout - Per-scenario timeout in ms
 * @param {string|null} roomFixturesDir - Directory to auto-load room fixtures from
 * @returns {Promise<WorkerMessage & {time?: number}>}
 */
async function runScenarioInWorker(scenarioPath, opts, timeout, roomFixturesDir) {
    const child = fork(RUNNER_SCRIPT, [], { silent: true });
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

        const [msg] = await Promise.race([
            once(child, 'message', { signal: ac.signal }),
            once(child, 'error', { signal: ac.signal }).then(([err]) => Promise.reject(err)),
            once(child, 'exit', { signal: ac.signal }).then(([code, signal]) => {
                const reason = code !== null ? `exit code ${code}` : `signal ${signal}`;
                return Promise.reject(new Error(`Worker exited unexpectedly (${reason})`));
            }),
        ]);

        return { ...msg, time: Date.now() - startTime };
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

    for (const { name, status, error, time } of results) {
        const icon = status === 'pass' ? 'PASS' : status === 'skip' ? 'SKIP' : 'FAIL';
        const timeStr = time !== undefined ? ` (${Math.round(time / 1000)}s)` : '';
        console.log(`  ${icon} ${name}${timeStr}`);
        if (error) {
            console.log(`       ${error.split('\n')[0]}`);
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
        console.error('[runner] Config error:', err.message);
        process.exit(1);
    }

    // Injects config env variables into the parent process (inherited by workers).
    process.env.INTEGRATION_TEST = '1';
    process.env.BOT_DIST_DIR = config.distDir;
    process.env.SIT_FIXTURES_DIR = config.fixturesDir;
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

    const scenarioFiles = findScenarios(config.scenariosDir, config.only || null);
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
                { profiling: config.profiling },
                config.timeout,
                config.roomFixturesDir,
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
