'use strict';

/**
 * Unit tests for attachEngineWatch — fail-fast on engine process death.
 *
 * Cover:
 * - engine child signal-death rejects `death` (the silent Linux hang path)
 * - engine child exit code 0 mid-run is fatal too (engine stopped → hang)
 * - mockup 'error' event is a warning, not fatal (storage restarts recover)
 * - non-engine child crash is a warning, not fatal
 * - only the first fatal failure settles the promise
 * - dispose() stops recording
 * - race(): resolves normally, rejects on engine death, pre-handles the loser
 * - activate(): attaches listeners, wraps dispose (watch stopped first)
 *
 * @file Unit tests for attachEngineWatch
 */

const { EventEmitter } = require('events');

const { attachEngineWatch } = require('../src/lib/runtime/runtime');

let consoleErrorSpy;

beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    consoleErrorSpy.mockRestore();
});

/**
 * Creates a fake server EventEmitter with the given child processes.
 *
 * @param {Object<string, EventEmitter>} processes
 * @returns {EventEmitter}
 */
function fakeServer(processes = {}) {
    const server = new EventEmitter();
    server.processes = processes;
    return server;
}

/**
 * Whether `death` has settled (resolved or rejected).
 *
 * @param {Promise<never>} death
 * @returns {Promise<boolean>}
 */
async function isSettled(death) {
    let settled = false;
    death.then(
        () => {
            settled = true;
        },
        () => {
            settled = true;
        },
    );
    await new Promise((resolve) => setImmediate(resolve));
    return settled;
}

describe('attachEngineWatch', () => {
    test("treats the mockup 'error' event as a warning, not a fatal failure", async () => {
        const server = fakeServer();
        const watch = attachEngineWatch(server);

        server.emit('error', 'storage exploded');

        expect(watch.errors).toHaveLength(0);
        expect(watch.warnings).toHaveLength(1);
        expect(await isSettled(watch.death)).toBe(false);
    });

    test('records an engine_runner signal-death — the silent hang path', async () => {
        const child = new EventEmitter();
        child.pid = 4242;
        const server = fakeServer({ engine_runner: child });

        const watch = attachEngineWatch(server);
        watch.attachChildren();

        child.emit('exit', null, 'SIGABRT');

        await expect(watch.death).rejects.toMatchObject({ code: 'ENGINE_CRASH' });
        expect(watch.errors[0]).toContain('engine_runner');
        expect(watch.errors[0]).toContain('SIGABRT');
    });

    test('records an engine_processor exit with code 0 mid-run as fatal', async () => {
        const child = new EventEmitter();
        child.pid = 4243;
        const server = fakeServer({ engine_processor: child });

        const watch = attachEngineWatch(server);
        watch.attachChildren();

        child.emit('exit', 0, null);

        await expect(watch.death).rejects.toMatchObject({ code: 'ENGINE_CRASH' });
        expect(watch.errors[0]).toContain('engine_processor');
    });

    test('records a non-engine crash as a warning, not a fatal failure', async () => {
        const child = new EventEmitter();
        child.pid = 4244;
        const server = fakeServer({ storage: child });

        const watch = attachEngineWatch(server);
        watch.attachChildren();

        child.emit('exit', 1, null);

        expect(watch.errors).toHaveLength(0);
        expect(watch.warnings).toHaveLength(1);
        expect(watch.warnings[0]).toContain('storage');
        expect(await isSettled(watch.death)).toBe(false);
    });

    test('records only the first fatal failure', async () => {
        const runner = new EventEmitter();
        const server = fakeServer({ engine_runner: runner });
        const watch = attachEngineWatch(server);
        watch.attachChildren();

        runner.emit('exit', null, 'SIGABRT');
        runner.emit('exit', null, 'SIGSEGV');

        expect(watch.errors).toHaveLength(1);
    });

    test('dispose() stops recording', async () => {
        const runner = new EventEmitter();
        const server = fakeServer({ engine_runner: runner });
        const watch = attachEngineWatch(server);
        watch.attachChildren();

        watch.dispose();
        runner.emit('exit', null, 'SIGABRT');
        server.emit('error', 'late');

        expect(watch.errors).toHaveLength(0);
        expect(watch.warnings).toHaveLength(0);
    });
});

describe('engineWatch.race', () => {
    test('resolves with the promise result while the engine stays alive', async () => {
        const server = fakeServer();
        const watch = attachEngineWatch(server);

        await expect(watch.race(Promise.resolve('tick ok'))).resolves.toBe('tick ok');
    });

    test('rejects with ENGINE_CRASH when the engine dies while a tick is pending', async () => {
        const child = new EventEmitter();
        const server = fakeServer({ engine_runner: child });
        const watch = attachEngineWatch(server);
        watch.attachChildren();

        const raced = watch.race(new Promise(() => {}));
        child.emit('exit', null, 'SIGABRT');

        await expect(raced).rejects.toMatchObject({ code: 'ENGINE_CRASH' });
    });

    test('pre-handles the losing promise — no unhandled rejection after the race settles', async () => {
        const child = new EventEmitter();
        const server = fakeServer({ engine_runner: child });
        const watch = attachEngineWatch(server);
        watch.attachChildren();

        const unhandled = [];
        const onUnhandled = (reason) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);
        try {
            let rejectTick;
            const slowTick = new Promise((_, reject) => {
                rejectTick = reject;
            });
            const raced = watch.race(slowTick);
            child.emit('exit', null, 'SIGABRT');
            await expect(raced).rejects.toMatchObject({ code: 'ENGINE_CRASH' });

            // The tick promise rejects long after the race has settled —
            // race() must have attached a no-op handler to it.
            rejectTick(new Error('late tick failure'));
            await new Promise((resolve) => setImmediate(resolve));
            await new Promise((resolve) => setImmediate(resolve));
        } finally {
            process.removeListener('unhandledRejection', onUnhandled);
        }
        expect(unhandled).toHaveLength(0);
    });
});

describe('engineWatch.activate', () => {
    test('attaches child listeners — engine deaths are recorded after activate', async () => {
        const child = new EventEmitter();
        const server = fakeServer({ engine_runner: child });
        const watch = attachEngineWatch(server);
        watch.activate(async () => {});

        child.emit('exit', null, 'SIGABRT');

        await expect(watch.death).rejects.toMatchObject({ code: 'ENGINE_CRASH' });
    });

    test('wrapped dispose stops the watch first, then runs the base dispose', async () => {
        const child = new EventEmitter();
        const server = fakeServer({ engine_runner: child });
        const watch = attachEngineWatch(server);

        const order = [];
        const wrapped = watch.activate(async () => {
            order.push('base-dispose');
        });

        await wrapped();
        expect(order).toEqual(['base-dispose']);

        // The watch is stopped by the wrapped dispose — the expected
        // shutdown must not be recorded as an engine death.
        child.emit('exit', null, 'SIGABRT');
        expect(watch.errors).toHaveLength(0);
        expect(await isSettled(watch.death)).toBe(false);
    });
});
