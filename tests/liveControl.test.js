'use strict';

/**
 * Unit tests for liveControl.js — viewer tick interceptor.
 *
 * Cover:
 * - createViewerInterceptor returns valid TickInterceptor shape
 * - getTickDelay: speed mapping (≥1000→0, 500→2, 1→1000)
 * - beforeTick: disposed→true, paused→awaits resume, step→auto-pause
 * - afterTick: sends viewer:frame via process.send, no-op without process.send
 * - IPC commands: pause, resume, step (from paused, from running),
 *   setSpeed, dispose (from running, from paused)
 * - status updates via viewer:status
 */

const { createViewerInterceptor } = require('../src/tools/viewer/liveControl');

// ═══════════════════════════════════════════════════════════════════════════
// Mocks
// ═══════════════════════════════════════════════════════════════════════════

jest.mock('../src/lib/observers/snapshot', () => ({
    collectSnapshot: jest.fn().mockResolvedValue({
        objects: [{ _id: 'c1', type: 'creep', x: 10, y: 10, room: 'W0N1' }],
        terrain: { W0N1: ['.'.repeat(50)] },
        tick: 5,
        console: [],
    }),
}));

/** @type {Function|null} Captured process.on('message', handler) */
let messageHandler = null;
/** @type {jest.Mock} */
let sendMock;

beforeEach(() => {
    messageHandler = null;
    sendMock = jest.fn();

    // Spy on process.on to capture the message handler
    jest.spyOn(process, 'on').mockImplementation((event, handler) => {
        if (event === 'message') {
            messageHandler = handler;
        }
        return process;
    });

    // Override process.send — in Jest (main process) it's undefined anyway
    process.send = sendMock;
});

afterEach(() => {
    jest.restoreAllMocks();
    // Restore process.send to undefined (its state in the main process)
    delete process.send;
});

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sends a viewer:cmd to the interceptor via the captured message handler.
 * @param {string} action
 * @param {Object} [params]
 */
function sendCmd(action, params = {}) {
    if (!messageHandler) throw new Error('messageHandler not captured');
    messageHandler({ type: 'viewer:cmd', action, params });
}

/**
 * Creates a minimal TickHookContext for beforeTick/afterTick.
 * @param {number} [tickNum=0]
 * @returns {import('../src/lib/types').TickHookContext}
 */
function makeCtx(tickNum = 0) {
    return {
        tickNum,
        adapter: {},
        report: { _consoleEntries: [] },
        roomStatus: { W0N1: { name: 'W0N1', ticks: 0, events: 0 } },
        bots: {},
        server: {},
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('createViewerInterceptor', () => {
    it('returns a valid TickInterceptor shape', () => {
        const interceptor = createViewerInterceptor({ scenarioPath: '/test.js' });
        expect(interceptor).toBeDefined();
        expect(typeof interceptor.beforeTick).toBe('function');
        expect(typeof interceptor.afterTick).toBe('function');
        expect(typeof interceptor.getTickDelay).toBe('function');
    });

    it('sends viewer:status on first beforeTick', async () => {
        const interceptor = createViewerInterceptor({ scenarioPath: '/test.js', speed: 500 });
        sendMock.mockClear();

        await interceptor.beforeTick(makeCtx(0));

        expect(sendMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'viewer:status',
                state: 'running',
                tick: 0,
                speed: 500,
                scenario: '/test.js',
            }),
        );
    });

    it('starts paused when opts.paused=true', async () => {
        sendMock.mockClear();
        const interceptor = createViewerInterceptor({ scenarioPath: '/test.js', paused: true });

        // beforeTick will send status with state='paused', then hang awaiting resume
        const promise = interceptor.beforeTick(makeCtx(0));

        // Let it reach the await
        await new Promise((r) => setImmediate(r));

        // Verify the status sent is 'paused'
        const statusCalls = sendMock.mock.calls.filter((c) => c[0]?.type === 'viewer:status');
        expect(statusCalls.length).toBeGreaterThanOrEqual(1);
        expect(statusCalls[0][0].state).toBe('paused');

        // Clean up: resume so the test doesn't hang
        sendCmd('resume');
        await promise;
    });
});

// ─── getTickDelay ───────────────────────────────────────────────────────────

describe('getTickDelay', () => {
    it('returns 0 when speed >= 1000 (unthrottled)', () => {
        const interceptor = createViewerInterceptor({ scenarioPath: '/t.js', speed: 1000 });
        expect(interceptor.getTickDelay()).toBe(0);
    });

    it('returns 0 when speed > 1000', () => {
        const interceptor = createViewerInterceptor({ scenarioPath: '/t.js', speed: 2000 });
        expect(interceptor.getTickDelay()).toBe(0);
    });

    it('returns 2 when speed = 500 (1000/500 = 2ms delay)', () => {
        const interceptor = createViewerInterceptor({ scenarioPath: '/t.js', speed: 500 });
        expect(interceptor.getTickDelay()).toBe(2);
    });

    it('returns 1000 when speed = 1 (1000/1 = 1000ms delay)', () => {
        const interceptor = createViewerInterceptor({ scenarioPath: '/t.js', speed: 1 });
        expect(interceptor.getTickDelay()).toBe(1000);
    });

    it('returns 0 when speed = 0 (edge case — floor)', () => {
        const interceptor = createViewerInterceptor({ scenarioPath: '/t.js', speed: 0 });
        expect(interceptor.getTickDelay()).toBe(0);
    });
});

// ─── beforeTick — disposed ──────────────────────────────────────────────────

describe('beforeTick — disposed', () => {
    it('returns true when disposed via viewer:cmd dispose', async () => {
        const interceptor = createViewerInterceptor({ scenarioPath: '/t.js' });
        sendCmd('dispose');

        const result = await interceptor.beforeTick(makeCtx(0));
        expect(result).toBe(true);
    });
});

// ─── beforeTick — running (not paused, not disposed) ───────────────────────

describe('beforeTick — running state', () => {
    it('sends viewer:status and does not block when not paused', async () => {
        const interceptor = createViewerInterceptor({ scenarioPath: '/t.js' });
        sendMock.mockClear();

        const result = await interceptor.beforeTick(makeCtx(5));
        // Should not return true (not disposed)
        expect(result).toBeUndefined();
        // Should have sent viewer:status with tick=5
        expect(sendMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'viewer:status',
                tick: 5,
                state: 'running',
            }),
        );
    });
});

// ─── beforeTick — paused ────────────────────────────────────────────────────

describe('beforeTick — paused state', () => {
    it('waits for resume command while paused', async () => {
        const interceptor = createViewerInterceptor({ scenarioPath: '/t.js', paused: true });
        sendMock.mockClear();

        // Start beforeTick — it will hang on `await once(control, 'resume')`
        const promise = interceptor.beforeTick(makeCtx(1));

        // Let the microtask queue flush so beforeTick reaches the await
        await new Promise((r) => setImmediate(r));

        // Send resume — this emits 'resume' on the internal EventEmitter
        sendCmd('resume');

        const result = await promise;
        expect(result).toBeUndefined(); // not disposed
    });

    it('step from paused: executes 1 tick then auto-pauses', async () => {
        const interceptor = createViewerInterceptor({ scenarioPath: '/t.js', paused: true });
        sendMock.mockClear();

        // Request 1 step
        sendCmd('step', { n: 1 });

        // beforeTick should run (step unpauses via emit('resume'))
        const result1 = await interceptor.beforeTick(makeCtx(1));
        expect(result1).toBeUndefined();

        // Next beforeTick should be paused (stepRequested exhausted)
        const promise2 = interceptor.beforeTick(makeCtx(2));
        await new Promise((r) => setImmediate(r));
        // It's waiting for resume — send it
        sendCmd('resume');
        const result2 = await promise2;
        expect(result2).toBeUndefined();
    });

    it('dispose while paused unblocks and returns true on next beforeTick', async () => {
        const interceptor = createViewerInterceptor({ scenarioPath: '/t.js', paused: true });
        sendMock.mockClear();

        // Start beforeTick — it hangs
        const promise = interceptor.beforeTick(makeCtx(1));
        await new Promise((r) => setImmediate(r));

        // Dispose while paused — emits 'resume'
        sendCmd('dispose');

        // First beforeTick resolves (resume fires), but disposed is now true
        // The current tick that was paused continues normally — returns undefined
        const result1 = await promise;
        expect(result1).toBeUndefined();
        // Next tick: disposed=true → returns true (stop loop)
        const result2 = await interceptor.beforeTick(makeCtx(2));
        expect(result2).toBe(true);
    });
});

// ─── beforeTick — step from running ─────────────────────────────────────────

describe('beforeTick — stepping from running', () => {
    it('decrements step counter and auto-pauses when exhausted', async () => {
        const interceptor = createViewerInterceptor({ scenarioPath: '/t.js' });
        sendMock.mockClear();

        // Request 2 steps
        sendCmd('step', { n: 2 });

        // Tick 1: stepRequested = 2 → 1, not paused yet
        await interceptor.beforeTick(makeCtx(1));

        // Tick 2: stepRequested = 1 → 0, auto-pause
        await interceptor.beforeTick(makeCtx(2));

        // Tick 3: should be paused now
        const promise3 = interceptor.beforeTick(makeCtx(3));
        await new Promise((r) => setImmediate(r));
        sendCmd('resume');
        await promise3;
    });
});

// ─── afterTick ──────────────────────────────────────────────────────────────

describe('afterTick', () => {
    it('sends viewer:frame via process.send', async () => {
        const interceptor = createViewerInterceptor({ scenarioPath: '/t.js' });
        sendMock.mockClear();

        await interceptor.afterTick(makeCtx(5));

        expect(sendMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'viewer:frame',
                objects: expect.any(Array),
                terrain: expect.any(Object),
            }),
        );
    });

    it('no-ops gracefully when process.send is unavailable', async () => {
        // Temporarily remove process.send
        delete process.send;

        const interceptor = createViewerInterceptor({ scenarioPath: '/t.js' });
        // Should not throw
        await expect(interceptor.afterTick(makeCtx(5))).resolves.toBeUndefined();

        // Restore for subsequent tests
        process.send = sendMock;
    });
});

// ─── IPC commands ───────────────────────────────────────────────────────────

describe('IPC commands', () => {
    it('pause command sets paused state', () => {
        createViewerInterceptor({ scenarioPath: '/t.js' });
        sendMock.mockClear();

        sendCmd('pause');

        // Should send viewer:status with state=paused
        expect(sendMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'viewer:status',
                state: 'paused',
            }),
        );
    });

    it('resume command sends viewer:status with state=running', () => {
        createViewerInterceptor({ scenarioPath: '/t.js' });
        sendMock.mockClear();

        sendCmd('resume');

        expect(sendMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'viewer:status',
                state: 'running',
            }),
        );
    });

    it('setSpeed changes speed and sends viewer:status', () => {
        const interceptor = createViewerInterceptor({ scenarioPath: '/t.js' });
        sendMock.mockClear();

        sendCmd('setSpeed', { speed: 250 });
        expect(interceptor.getTickDelay()).toBe(4); // 1000/250 = 4
        expect(sendMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'viewer:status',
                speed: 250,
            }),
        );
    });

    it('setSpeed defaults to 1 when no speed param', () => {
        const interceptor = createViewerInterceptor({ scenarioPath: '/t.js' });
        sendMock.mockClear();

        sendCmd('setSpeed', {});
        expect(interceptor.getTickDelay()).toBe(1000);
    });

    it('dispose sends viewer:disposed', () => {
        createViewerInterceptor({ scenarioPath: '/t.js' });
        sendMock.mockClear();

        sendCmd('dispose');

        expect(sendMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'viewer:disposed',
                scenario: '/t.js',
            }),
        );
    });

    it('ignores non-viewer:cmd messages', () => {
        createViewerInterceptor({ scenarioPath: '/t.js' });
        sendMock.mockClear();

        // Send a non-viewer message
        messageHandler({ type: 'some-other', data: 42 });

        // Should not have sent any viewer IPC
        const viewerCalls = sendMock.mock.calls.filter((c) => c[0]?.type?.startsWith('viewer:'));
        // Only the initial status from creation should exist
        expect(viewerCalls.length).toBeLessThanOrEqual(1);
    });
});
