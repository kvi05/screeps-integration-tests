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

        const opts = msg.opts || {};

        // ── Tool injection: viewer tick interceptor ──────────────────────
        // Attach before scenario.run() so createWorld receives it via opts.
        // The interceptor is self-contained — core never knows it's a viewer.
        if (opts.viewer) {
            const { createViewerInterceptor } = require('./tools/viewer/liveControl');
            /** @type {import('./lib/types').ViewerOptions} */
            const viewerOpts = opts.viewerOptions || {};

            opts.tickInterceptor = createViewerInterceptor({
                scenarioPath: msg.scenarioPath,
                paused: viewerOpts.paused,
                speed: viewerOpts.speed,
                keyframeInterval: viewerOpts.keyframeInterval,
                replayBuffer: viewerOpts.replayBuffer,
            });
            // Also set via tickHooks — ensures createWorld() finds the
            // interceptor even if the scenario's run() builds a fresh opts
            // object instead of forwarding the one we pass here.
            setTickInterceptor(opts.tickInterceptor);
        }

        /** @type {import('./lib/types').ScenarioOutput} */
        let result;

        // ── Branching: snapshot launch vs normal scenario ──────────────
        if (opts.restoreSnapshot) {
            // ── Snapshot launch mode ───────────────────────────────────
            // No scenario file — createWorld builds world from snapshot meta.
            const { createWorld } = require('./lib/orchestration/world');

            const snapshot = opts.restoreSnapshot;
            const world = await createWorld({
                snapshot,
                viewer: true,
                viewerOptions: opts.viewerOptions,
                // tickInterceptor already set above via opts + setTickInterceptor
            });

            // createWorld has:
            //   1. Built room/bot specs from snapshot.meta
            //   2. Materialized rooms + bots
            //   3. Called restoreState() — DB overwritten from snapshot
            //   4. Set report.ticksRun = snapshot.env.gameTime
            // Now world.run() starts ticking from the snapshot tick.

            result = await world.run();
        } else {
            // ── Normal scenario mode ──────────────────────────────────
            const scenario = require(msg.scenarioPath);
            result = await scenario.run(opts);
        }

        // ── Send scenario result (common for both paths) ──────────────
        // Send scenario result for viewer ScenarioManager.
        // Always send when running in a forked process (headless or interactive).
        if (process.send) {
            try {
                process.send({
                    type: 'viewer:scenario-result',
                    scenario: /** @type {string} */ (
                        opts.restoreSnapshot?.meta?.scenario || msg.scenarioPath || 'snapshot-launch'
                    ),
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
