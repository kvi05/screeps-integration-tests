'use strict';

const { once } = require('events');

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
        const result = await scenario.run(opts);

        /** @type {WorkerMessage} */
        const message = result?.skipped ? { status: 'skip', result } : { status: 'pass', result };

        process.send(message);
    } catch (e) {
        /** @type {WorkerMessage} */
        const message = {
            status: 'fail',
            error: e.stack || String(e),
        };
        process.send(message);
    } finally {
        // Terminate worker process.
        // server.stop() does not fully release storage — process.exit() is necessary.
        // Small delay (100ms) to ensure the message is delivered to the parent.
        setTimeout(() => process.exit(0), 100);
    }
})();
