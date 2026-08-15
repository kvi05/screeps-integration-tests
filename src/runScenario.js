'use strict';

const { once } = require('events');
const { setTickInterceptor, clearTickInterceptor } = require('./lib/orchestration/tickHooks');

/**
 * @typedef {import('./lib/types').ScenarioOutput} ScenarioOutput
 * @typedef {import('./lib/types').WorkerMessage} WorkerMessage
 */

/** @type {boolean} A final message was already scheduled — the first one wins */
let finalMessageScheduled = false;

/**
 * Sends the final worker message and exits once it is flushed to the IPC
 * channel.
 *
 * A fixed sleep before process.exit() is a heuristic: under load the parent
 * may be slow to read, the message stays queued in the pipe, and exit(0)
 * truncates it — the parent then reports "Worker exited unexpectedly
 * (exit code 0)". The send callback fires only after the message has been
 * handed to the channel, which makes the exit safe.
 *
 * Idempotent at module level: the first final message wins. Later calls
 * (e.g. from the global crash guards after the scenario has already
 * finished) are ignored — the worker is already on its way out.
 *
 * process.exit() is still necessary: server.stop() does not fully release
 * storage (file descriptor leak).
 *
 * @param {WorkerMessage} message
 * @returns {void}
 */
function sendFinalMessage(message) {
    if (finalMessageScheduled) {
        return;
    }
    finalMessageScheduled = true;

    if (!process.send) {
        process.exit(0);
        return;
    }
    let exited = false;
    const exitNow = (code) => {
        if (exited) {
            return;
        }
        exited = true;
        process.exit(code);
    };
    // Safety net: never hang the worker if the send callback is lost.
    const fallback = setTimeout(() => exitNow(1), 5000);

    try {
        process.send(message, (err) => {
            clearTimeout(fallback);
            if (err) {
                console.error(`[worker] failed to deliver the final message: ${err.message ?? err}`);
            }
            exitNow(err ? 1 : 0);
        });
    } catch (serializeError) {
        // The result is not serializable (BigInt, circular structure, ...).
        // Report a readable failure instead of losing the result entirely.
        const detail = serializeError.message ?? String(serializeError);
        console.error(`[worker] final message is not serializable: ${detail}`);
        try {
            process.send({ status: 'fail', error: `Worker result is not serializable: ${detail}` }, (err) => {
                clearTimeout(fallback);
                exitNow(err ? 1 : 0);
            });
        } catch {
            clearTimeout(fallback);
            exitNow(1);
        }
    }
}

/**
 * Installs last-resort process guards so a crash inside the worker never
 * leaves the parent with a bare "Worker exited unexpectedly (exit code 1)".
 *
 * The try/catch around scenario.run() only covers awaited failures. Errors
 * escaping it — exceptions in event-loop callbacks, promises without
 * handlers, tool (viewer interceptor) bugs — used to kill the worker with a
 * non-zero exit code and no final message. The guards convert the first such
 * error into a `fail` WorkerMessage carrying the real stack, then terminate
 * the worker through sendFinalMessage().
 *
 * @returns {void}
 */
function installGlobalGuards() {
    let reported = false;

    /**
     * @param {string} kind — 'exception' or 'rejection'
     * @param {*} error
     * @returns {void}
     */
    const report = (kind, error) => {
        if (reported) {
            return;
        }
        reported = true;
        const detail = error && error.stack ? error.stack : String(error);
        console.error(`[worker] uncaught ${kind}: ${detail}`);
        if (!process.send) {
            process.exit(1);
            return;
        }
        try {
            sendFinalMessage({
                status: 'fail',
                error: `Uncaught ${kind} in the worker process:\n${detail}`,
            });
        } catch {
            process.exit(1);
        }
    };

    process.on('uncaughtException', (err) => report('exception', err));
    process.on('unhandledRejection', (reason) => report('rejection', reason));
}

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
 * The worker terminates itself via sendFinalMessage(): the process exits in
 * the send callback, once the final message is flushed to the IPC channel.
 * process.exit() is still necessary, because server.stop() does not fully
 * release storage (file descriptor leak). Global guards convert any uncaught
 * error into a `fail` message with a real stack instead of a bare exit.
 *
 * @example
 * // Run from bin/screeps-integration-tests.js:
 * const cp = require('child_process');
 * const child = cp.fork('src/runScenario.js');
 * child.send({ scenarioPath: './scenarios/smoke-empty.scenario.js', opts: { profiling: false } });
 * child.on('message', (msg) => console.log(msg.status)); // 'pass'
 */

(async () => {
    installGlobalGuards();
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

        sendFinalMessage(message);
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
        sendFinalMessage(message);
    } finally {
        clearTickInterceptor();
        // The worker terminates itself inside sendFinalMessage() once the
        // final message is flushed to the IPC channel.
    }
})();
