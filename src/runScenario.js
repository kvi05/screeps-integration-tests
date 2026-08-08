'use strict';

const { once, EventEmitter } = require('events');
const { setViewerState, clearViewerState } = require('./lib/runtime/viewerState');

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
 * When viewer is enabled, the worker also listens for viewer:cmd messages
 * from the parent process, enabling bidirectional IPC:
 * - viewer:frame (worker → parent): per-tick snapshots for SSE broadcast
 * - viewer:cmd  (parent → worker): live server control (pause/resume/step/speed)
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

        // ★ Create control channel for live viewer management.
        // Store on process so createWorld/doTick can access it even if the scenario
        // passes a different opts object to createWorld.
        if (opts.viewer) {
            const viewer = {
                control: new EventEmitter(),
                paused: false,
                stepRequested: 0,
                speed: (typeof opts.viewer === 'object' ? opts.viewer.speed : undefined) || 1000,
                status: { state: 'running', tick: 0, speed: 1000, scenario: msg.scenarioPath },
                _adapter: null,
            };
            if (typeof opts.viewer === 'object') {
                viewer.paused = opts.viewer.paused !== undefined ? opts.viewer.paused : false;
            }
            viewer.status.speed = viewer.speed;
            setViewerState(viewer);

            /** Send a viewer:status message to parent */
            const sendStatus = () => {
                if (!process.send) return;
                try {
                    process.send({
                        type: 'viewer:status',
                        state: viewer.status.state,
                        tick: viewer.status.tick,
                        speed: viewer.speed,
                        scenario: msg.scenarioPath,
                    });
                } catch {
                    /* non-critical */
                }
            };

            process.on('message', (cmd) => {
                if (cmd && cmd.type === 'viewer:cmd') {
                    const { action, params } = cmd;
                    switch (action) {
                        case 'pause':
                            viewer.paused = true;
                            viewer.status.state = 'paused';
                            sendStatus();
                            break;
                        case 'resume':
                            viewer.paused = false;
                            viewer.status.state = 'running';
                            viewer.control.emit('resume');
                            sendStatus();
                            break;
                        case 'step':
                            viewer.stepRequested += params?.n || 1;
                            viewer.status.state = 'stepping';
                            if (viewer.paused) {
                                viewer.paused = false;
                                viewer.control.emit('resume');
                            }
                            sendStatus();
                            break;
                        case 'setSpeed':
                            viewer.speed = params?.speed || 1;
                            viewer.status.speed = viewer.speed;
                            sendStatus();
                            break;
                        case 'saveSnapshot':
                            // Save adapter.db as JSON snapshot
                            if (viewer._adapter && process.send) {
                                try {
                                    const dbDump = JSON.parse(JSON.stringify(viewer._adapter.db));
                                    const snapshot = {
                                        meta: {
                                            scenario: msg.scenarioPath,
                                            timestamp: new Date().toISOString(),
                                            ticks: viewer.status.tick,
                                        },
                                        db: dbDump,
                                    };
                                    process.send({ type: 'viewer:snapshot', data: snapshot });
                                } catch {
                                    /* serialization error — ignore */
                                }
                            }
                            break;
                        case 'dispose':
                            // Stop the worker immediately
                            clearViewerState();
                            if (process.send) {
                                process.send({ type: 'viewer:disposed', scenario: msg.scenarioPath });
                            }
                            setTimeout(() => process.exit(0), 50);
                            return; // Don't process further commands
                    }
                }
            });
        }

        const result = await scenario.run(opts);

        // Send scenario result for viewer ScenarioManager
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
        // Terminate worker process.
        // server.stop() does not fully release storage — process.exit() is necessary.
        // Small delay (100ms) to ensure the message is delivered to the parent.
        setTimeout(() => process.exit(0), 100);
    }
})();
