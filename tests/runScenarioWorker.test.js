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
