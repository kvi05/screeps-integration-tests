'use strict';

/**
 * @file Tests for the worker protocol hardening in `src/runScenario.js`.
 *
 * Each test forks the real worker entry (`src/runScenario.js`) with a
 * temporary scenario file and verifies that failures and large results are
 * delivered as final IPC messages instead of silent worker deaths.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

const RUNNER = path.join(__dirname, '..', 'src', 'runScenario.js');

jest.setTimeout(15000);

/**
 * Writes a scenario module to a fresh temp directory.
 *
 * @param {string} code — scenario source
 * @returns {string} absolute path to the scenario file
 */
function writeScenario(code) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sit-worker-test-'));
    const file = path.join(dir, 'test.scenario.js');
    fs.writeFileSync(file, code);
    return file;
}

/**
 * Forks the worker, sends it the scenario, and resolves with the final
 * message. Rejects if the worker exits without a final message.
 *
 * @param {string} scenarioPath
 * @param {Object} [opts]
 * @param {Function} [afterSend] — runs in the test process right after
 *   sending (e.g. to block the event loop and simulate load)
 * @returns {Promise<Object>} the final worker message
 */
function runWorker(scenarioPath, opts = {}, afterSend = null) {
    return new Promise((resolve, reject) => {
        const child = fork(RUNNER, [], { silent: true });
        let settled = false;

        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            fn(value);
        };

        child.on('message', (msg) => {
            // Typed messages (viewer:*, ...) are intermediate — only messages
            // without a `type` field are final worker results.
            if (msg && !msg.type && (msg.status === 'pass' || msg.status === 'fail' || msg.status === 'skip')) {
                finish(resolve, msg);
            }
        });
        child.on('exit', (code, signal) => {
            finish(reject, new Error(`worker exited (code: ${code}, signal: ${signal}) without a final message`));
        });
        child.on('error', (err) => finish(reject, err));

        child.send({ scenarioPath, opts });
        if (afterSend) {
            afterSend();
        }
    });
}

/**
 * Forks the worker and resolves with both the final message and the
 * intermediate `viewer:scenario-result` IPC message (sent by the worker
 * for the viewer Scenario Manager before the final result).
 *
 * @param {string} scenarioPath
 * @returns {Promise<{resultMessage: Object, scenarioResult: Object|null}>}
 */
function runWorkerCollectingScenarioResult(scenarioPath) {
    return new Promise((resolve, reject) => {
        const child = fork(RUNNER, [], { silent: true });
        let scenarioResult = null;
        let settled = false;

        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            fn(value);
        };

        child.on('message', (msg) => {
            if (msg && msg.type === 'viewer:scenario-result') {
                scenarioResult = msg;
                return;
            }
            if (msg && !msg.type && (msg.status === 'pass' || msg.status === 'fail' || msg.status === 'skip')) {
                finish(resolve, { resultMessage: msg, scenarioResult });
            }
        });
        child.on('exit', (code, signal) => {
            finish(reject, new Error(`worker exited (code: ${code}, signal: ${signal}) without a final message`));
        });
        child.on('error', (err) => finish(reject, err));

        child.send({ scenarioPath, opts: {} });
    });
}

/**
 * Forks the worker for a batch (non-viewer) scenario, waits until the
 * scenario signals it is inside the tick loop (the scenario sends a
 * `test:ticking` message from its onTick hook), then sends a `dispose`
 * command. Resolves with the final message and the collected
 * `viewer:scenario-result`.
 *
 * @param {string} scenarioPath
 * @returns {Promise<{resultMessage: Object, scenarioResult: Object|null}>}
 */
function runWorkerDisposedMidRun(scenarioPath) {
    return new Promise((resolve, reject) => {
        const child = fork(RUNNER, [], { silent: true });
        let scenarioResult = null;
        let disposed = false;
        let settled = false;

        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            fn(value);
        };

        child.on('message', (msg) => {
            if (msg && msg.type === 'viewer:scenario-result') {
                scenarioResult = msg;
                return;
            }
            if (msg && msg.type === 'test:ticking' && !disposed) {
                disposed = true;
                child.send({ type: 'viewer:cmd', action: 'dispose' });
                return;
            }
            if (msg && !msg.type && (msg.status === 'pass' || msg.status === 'fail' || msg.status === 'skip')) {
                finish(resolve, { resultMessage: msg, scenarioResult });
            }
        });
        child.on('exit', (code, signal) => {
            finish(reject, new Error(`worker exited (code: ${code}, signal: ${signal}) without a final message`));
        });
        child.on('error', (err) => finish(reject, err));

        child.send({ scenarioPath, opts: {} });
    });
}

/**
 * Builds a batch scenario source that runs a real world and signals the
 * parent on the first tick. Used by the dispose tests.
 *
 * @param {string} [afterRun] — code executed once run() returns (e.g. a throw
 *   or a stray rejection); defaults to returning the report
 * @param {number} [maxTicks=500] — tick ceiling for the world
 * @returns {string} absolute path to the written scenario
 */
function writeTickingScenario(afterRun = '') {
    const indexPath = path.join(__dirname, '..', 'src', 'index.js');
    const code = `
        'use strict';
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        const { createWorld } = require(${JSON.stringify(indexPath)});
        const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sit-bot-dist-'));
        fs.writeFileSync(path.join(distDir, 'main.js'), 'module.exports = { loop: function () {} };');
        module.exports = {
            async run() {
                const world = await createWorld({
                    rooms: [{ name: 'W0N1' }],
                    bots: [{ username: 'bot', rooms: ['W0N1'] }],
                    until: { maxTicks: 500 },
                    distDir,
                    onTick: (w, tick) => {
                        if (tick === 0 && process.send) {
                            process.send({ type: 'test:ticking' });
                        }
                    },
                });
                try {
                    const report = await world.run();
                    ${afterRun || 'return report;'}
                } finally {
                    await world.dispose();
                    fs.rmSync(distDir, { recursive: true, force: true });
                }
            },
        };
    `;
    return writeScenario(code);
}

/**
 * Forks the worker and sends the run configuration followed IMMEDIATELY by a
 * dispose command — simulating Stop All racing the spawn, where the parent
 * writes both messages back-to-back and the worker reads them in one burst
 * before any interceptor exists.
 *
 * @param {string} scenarioPath
 * @returns {Promise<{resultMessage: Object}>} the final worker message
 */
function runWorkerWithImmediateDispose(scenarioPath) {
    return new Promise((resolve, reject) => {
        const child = fork(RUNNER, [], { silent: true });
        let settled = false;

        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            fn(value);
        };

        child.on('message', (msg) => {
            if (msg && !msg.type && (msg.status === 'pass' || msg.status === 'fail' || msg.status === 'skip')) {
                finish(resolve, { resultMessage: msg });
            }
        });
        child.on('exit', (code, signal) => {
            finish(reject, new Error(`worker exited (code: ${code}, signal: ${signal}) without a final message`));
        });
        child.on('error', (err) => finish(reject, err));

        child.send({ scenarioPath, opts: {} });
        child.send({ type: 'viewer:cmd', action: 'dispose' });
    });
}

afterAll(() => {
    // Best-effort cleanup of temp scenario dirs.
    const tmp = os.tmpdir();
    for (const entry of fs.readdirSync(tmp)) {
        if (entry.startsWith('sit-worker-test-')) {
            fs.rmSync(path.join(tmp, entry), { recursive: true, force: true });
        }
    }
});

describe('runScenario worker crash guards', () => {
    test('uncaught exception is reported as a fail message with the real stack', async () => {
        const scenarioPath = writeScenario(`
            'use strict';
            module.exports = {
                async run() {
                    setImmediate(() => { throw new Error('guard-sync-boom'); });
                    await new Promise((r) => setTimeout(r, 500));
                    return { ticksRun: 1 };
                },
            };
        `);

        const msg = await runWorker(scenarioPath);
        expect(msg.status).toBe('fail');
        expect(msg.error).toContain('guard-sync-boom');
        expect(msg.error).toContain('Uncaught exception');
    });

    test('unhandled rejection is reported as a fail message with the real stack', async () => {
        const scenarioPath = writeScenario(`
            'use strict';
            module.exports = {
                async run() {
                    setImmediate(() => { Promise.reject(new Error('guard-rejection-boom')); });
                    await new Promise((r) => setTimeout(r, 500));
                    return { ticksRun: 1 };
                },
            };
        `);

        const msg = await runWorker(scenarioPath);
        expect(msg.status).toBe('fail');
        expect(msg.error).toContain('guard-rejection-boom');
        expect(msg.error).toContain('Uncaught rejection');
    });

    test('unserializable result is reported as a readable failure, not a bare exit', async () => {
        const scenarioPath = writeScenario(`
            'use strict';
            module.exports = {
                async run() {
                    const cycle = {};
                    cycle.self = cycle; // circular — the IPC serializer throws
                    return { ticksRun: 1, bad: cycle };
                },
            };
        `);

        const msg = await runWorker(scenarioPath);
        expect(msg.status).toBe('fail');
        expect(msg.error).toContain('not serializable');
    });

    test('large final message is delivered intact even when the parent briefly blocks', async () => {
        const scenarioPath = writeScenario(`
            'use strict';
            module.exports = {
                async run() {
                    return { ticksRun: 1, big: 'x'.repeat(1024 * 1024) };
                },
            };
        `);

        const msg = await runWorker(scenarioPath, {}, () => {
            // Simulate a busy parent: block this process while the worker
            // finishes and flushes a message larger than the IPC pipe buffer.
            const end = Date.now() + 500;
            while (Date.now() < end) {
                /* busy wait */
            }
        });

        expect(msg.status).toBe('pass');
        expect(msg.result.big).toHaveLength(1024 * 1024);
    });
});

describe('runScenario viewer scenario-result message', () => {
    test('totalTicks sums ticksRun across ALL worlds created by the scenario', async () => {
        const worldReportsPath = path.join(__dirname, '..', 'src', 'lib', 'orchestration', 'worldReports');
        const scenarioPath = writeScenario(`
            'use strict';
            // Simulate a multi-world scenario: two worlds with 10 and 5 ticks.
            // A scenario returns only the last world's report — the worker must
            // aggregate the tick count across all worlds it created.
            const { trackWorldReport } = require(${JSON.stringify(worldReportsPath)});
            module.exports = {
                async run() {
                    trackWorldReport({ ticksRun: 10 });
                    trackWorldReport({ ticksRun: 5 });
                    return { ticksRun: 5, wallClockMs: 1234 };
                },
            };
        `);

        const { resultMessage, scenarioResult } = await runWorkerCollectingScenarioResult(scenarioPath);
        expect(resultMessage.status).toBe('pass');
        expect(resultMessage.totalTicks).toBe(15); // 10 + 5, not just the last world
        expect(resultMessage.totalWorlds).toBe(2);
        expect(scenarioResult.type).toBe('viewer:scenario-result');
        expect(scenarioResult.status).toBe('pass');
        expect(scenarioResult.totalTicks).toBe(15);
        expect(scenarioResult.time).toBe(1234);
    });

    test('totalTicks falls back to the scenario result when no worlds were tracked', async () => {
        const scenarioPath = writeScenario(`
            'use strict';
            module.exports = {
                async run() {
                    return { ticksRun: 7 };
                },
            };
        `);

        const { resultMessage, scenarioResult } = await runWorkerCollectingScenarioResult(scenarioPath);
        expect(scenarioResult.type).toBe('viewer:scenario-result');
        expect(scenarioResult.totalTicks).toBe(7); // fallback: no worlds tracked
        expect(resultMessage.totalTicks).toBe(7);
        expect(resultMessage.totalWorlds).toBe(0);
    });

    test('fail message carries cross-world totals when the scenario throws', async () => {
        const worldReportsPath = path.join(__dirname, '..', 'src', 'lib', 'orchestration', 'worldReports');
        const scenarioPath = writeScenario(`
            'use strict';
            // The scenario crashes after a world has run 42 ticks — the fail
            // message must still report how far the scenario got. The totals
            // are computed by the worker, since world.report belongs to a
            // single world.
            const { trackWorldReport } = require(${JSON.stringify(worldReportsPath)});
            module.exports = {
                async run() {
                    trackWorldReport({ ticksRun: 42 });
                    throw new Error('boom after 42 ticks');
                },
            };
        `);

        const msg = await runWorker(scenarioPath);
        expect(msg.status).toBe('fail');
        expect(msg.error).toContain('boom after 42 ticks');
        expect(msg.totalTicks).toBe(42);
        expect(msg.totalWorlds).toBe(1);
    });

    test('disposed worlds are still counted — dispose freezes the contribution', async () => {
        const indexPath = path.join(__dirname, '..', 'src', 'index.js');
        const scenarioPath = writeScenario(`
            'use strict';
            // Real createWorld flow: the scenario disposes its world before
            // returning (the usual try/finally pattern). The worker must
            // still count its ticks — dispose() freezes the contribution
            // into the registry instead of dropping it.
            const fs = require('fs');
            const os = require('os');
            const path = require('path');
            const { createWorld } = require(${JSON.stringify(indexPath)});

            // Minimal bot: one module in a temp dist dir (opts.distDir has
            // priority over the resolved default).
            const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sit-bot-dist-'));
            fs.writeFileSync(path.join(distDir, 'main.js'), 'module.exports = { loop: function () {} };');

            module.exports = {
                async run() {
                    const world = await createWorld({
                        rooms: [{ name: 'W0N1' }],
                        bots: [{ username: 'bot', rooms: ['W0N1'] }],
                        ticks: 2,
                        distDir,
                    });
                    try {
                        await world.run();
                    } finally {
                        await world.dispose();
                        fs.rmSync(distDir, { recursive: true, force: true });
                    }
                    return {}; // totals must come from the registry, not this result
                },
            };
        `);

        const msg = await runWorker(scenarioPath);
        expect(msg.status).toBe('pass');
        expect(msg.totalWorlds).toBe(1);
        expect(msg.totalTicks).toBe(2);
    });
});

describe('runScenario batch dispose (parent-initiated stop)', () => {
    test('dispose command stops a batch scenario mid-run and it is reported as skip', async () => {
        const { resultMessage, scenarioResult } = await runWorkerDisposedMidRun(writeTickingScenario());

        expect(resultMessage.status).toBe('skip');
        // The run was stopped before maxTicks — the tick loop exited early.
        expect(resultMessage.totalTicks).toBeLessThan(500);
        // The Scenario Manager event carries the same user-stop status.
        expect(scenarioResult).not.toBeNull();
        expect(scenarioResult.status).toBe('skip');
    });

    test('a disposed run that throws afterwards is still reported as skip, not fail', async () => {
        // Scenario-side assertions on partial data are an artifact of the
        // stop, not a real regression — the user asked to stop the run.
        const { resultMessage, scenarioResult } = await runWorkerDisposedMidRun(
            writeTickingScenario("throw new Error('assert-after-dispose-boom');"),
        );

        expect(resultMessage.status).toBe('skip');
        expect(resultMessage.error).toContain('assert-after-dispose-boom');
        expect(scenarioResult.status).toBe('skip');
    });

    test('a disposed run crashing in the global guards is still reported as skip', async () => {
        // A stray async failure racing the teardown fires the crash guard
        // (unhandledRejection) while the run is already disposed — the user
        // stop must win over the crash. The scenario never returns: the guard
        // sends the only final message the worker produces.
        const afterRun = `
            setImmediate(() => { Promise.reject(new Error('teardown-rejection-boom')); });
            await new Promise(() => {}); // never resolves — the guard exits the worker
        `;
        const { resultMessage, scenarioResult } = await runWorkerDisposedMidRun(writeTickingScenario(afterRun));

        expect(resultMessage.status).toBe('skip');
        expect(resultMessage.error).toContain('teardown-rejection-boom');
        expect(scenarioResult.status).toBe('skip');
    });

    test('a stop racing the worker boot is still honored (dispose seeded at startup)', async () => {
        // Stop All can fire while the worker is still forking: the parent
        // queues the run config and the dispose back-to-back, so the worker
        // reads both in one burst before any interceptor exists. The
        // module-level pre-armed dispose flag must preserve the stop.
        const { resultMessage } = await runWorkerWithImmediateDispose(writeTickingScenario());

        expect(resultMessage.status).toBe('skip');
        expect(resultMessage.totalTicks).toBeLessThan(500);
    });
});
