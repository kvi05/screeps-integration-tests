'use strict';

const { once } = require('events');
const { setTickInterceptor, clearTickInterceptor } = require('./lib/orchestration/tickHooks');

/**
 * @typedef {import('./lib/types').ScenarioOutput} ScenarioOutput
 * @typedef {import('./lib/types').WorkerMessage} WorkerMessage
 */

/**
 * Worker entry point for running a single scenario.
 *
 * Each scenario is isolated in a separate child process (`child_process.fork`).
 * This ensures that the mockup server and its child processes (storage,
 * engine_runner, engine_processor) do not share state between scenarios,
 * and when the worker terminates/is killed, the OS can properly clean up
 * the entire process tree.
 *
 * Supports three statuses:
 * - pass — scenario passed successfully
 * - skip — scenario skipped (result.skipped === true)
 * - fail — scenario failed with an error
 *
 * Tools (viewer, profiler) connect via `opts.tickInterceptor` — an optional
 * {@link TickInterceptor} injected before `scenario.run()`. The interceptor
 * is self-contained and owns its own IPC/state. The worker itself is tool-agnostic.
 *
 * process.exit(0) is called after sending the message,
 * because server.stop() does not fully release storage (file descriptor leak).
 *
 * @example
 * // Run from bin/screeps-integration-tests.js:
 * const cp = require('child_process');
 * const child = cp.fork('src/runScenario.js');
 * child.send({ scenarioPath: './scenarios/smoke-empty.scenario.js', opts: { profiling: false } });
 * child.on('message', (msg) => console.log(msg.status)); // 'pass'
 */

(async () => {
    try {
        const [msg] = await once(process, 'message');

        // Load user room fixtures BEFORE requiring the scenario,
        // so they are available through the public API.
        if (msg.roomFixturesDir) {
            const { loadRoomFixturesFromDir } = require('./lib/fixtures/roomFixture');
            loadRoomFixturesFromDir(msg.roomFixturesDir);
        }

        const scenario = require(msg.scenarioPath);
        const opts = msg.opts || {};

        // ── Tool injection: viewer tick interceptor ──────────────────────
        // Attach before scenario.run() so createWorld receives it via opts.
        // The interceptor is self-contained — core never knows it's a viewer.
        if (opts.viewer) {
            const { createViewerInterceptor } = require('./tools/viewer/liveControl');
            const viewerOpts = typeof opts.viewer === 'object' ? opts.viewer : {};
            opts.tickInterceptor = createViewerInterceptor({
                scenarioPath: msg.scenarioPath,
                paused: viewerOpts.paused || false,
                speed: viewerOpts.speed || 1000,
            });
            // Also set via tickHooks — ensures createWorld() finds the
            // interceptor even if the scenario's run() builds a fresh opts
            // object instead of forwarding the one we pass here.
            setTickInterceptor(opts.tickInterceptor);
        }

        const result = await scenario.run(opts);

        // Send scenario result for viewer ScenarioManager.
        // Always send when running in a forked process (headless or interactive).
        if (process.send) {
            try {
                process.send({
                    type: 'viewer:scenario-result',
                    scenario: msg.scenarioPath,
                    status: result?.skipped ? 'skip' : 'pass',
                    time: result?.wallClockMs || 0,
                    ticks: result?.ticksRun || 0,
                });
            } catch {
                /* non-critical */
            }
        }

        /** @type {WorkerMessage} */
        const message = result?.skipped ? { status: 'skip', result } : { status: 'pass', result };

        process.send(message);
    } catch (e) {
        // Preserve FrameworkError formatting across IPC.
        // FrameworkError.toString() provides the user-friendly multi-line message;
        // fall back to stack / String for non-framework errors.
        const { FrameworkError: FE } = require('./lib/errors');
        const formatted = e instanceof FE ? e.toString() : null;

        /** @type {WorkerMessage} */
        const message = {
            status: 'fail',
            error: formatted ? `${formatted}\n\n${e.stack || ''}` : e.stack || String(e),
        };
        process.send(message);
    } finally {
        clearTickInterceptor();
        // Terminate worker process.
        // server.stop() does not fully release storage — process.exit() is necessary.
        // Small delay (100ms) to ensure the message is delivered to the parent.
        setTimeout(() => process.exit(0), 100);
    }
})();
