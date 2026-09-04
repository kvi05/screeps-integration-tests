import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import ResourcesPanel from '../src/components/ResourcesPanel';

vi.mock('../src/api/client', () => ({
    getStats: vi.fn(),
}));

// Import the mocked module for per-test setup
import { getStats } from '../src/api/client';

const MB = 1024 * 1024;

/**
 * A realistic /api/stats payload (shape from src/tools/viewer/server.js).
 * @param {Object} [overrides]
 * @returns {Object}
 */
function makeStats(overrides = {}) {
    return {
        process: {
            pid: 4242,
            uptimeSec: 125,
            rss: 150 * MB,
            heapUsed: 40 * MB,
            heapTotal: 80 * MB,
            external: 5 * MB,
            cpuUserUsec: 1_000_000,
            cpuSystemUsec: 500_000,
        },
        system: {
            totalMem: 16 * 1024 * MB,
            freeMem: 8 * 1024 * MB,
            loadavg: [0.1, 0.2, 0.3],
            platform: 'win32/x64',
            cpus: 8,
        },
        viewer: {
            state: 'running',
            scenario: 'demo',
            sseClients: 1,
            memoryHistoryTicks: 500,
            replayBuffer: 3000,
            lastFrameTick: 42,
            workers: [],
        },
        ...overrides,
    };
}

/**
 * Mount the panel with a live-like ref to the frame ring buffer.
 * @param {Object} [opts]
 * @param {Object[]} [opts.frames] — pre-filled ring buffer contents
 * @param {number} [opts.replayBuffer]
 * @returns {{recordingRef: {current: {frames: Object[]}}}}
 */
function mountPanel({ frames = [], replayBuffer = 3000 } = {}) {
    const recordingRef = { current: { frames } };
    render(<ResourcesPanel recordingRef={recordingRef} replayBuffer={replayBuffer} />);
    return { recordingRef };
}

describe('ResourcesPanel', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    afterEach(() => {
        delete window.__viewerPerf;
        vi.useRealTimers();
    });

    it('renders backend stats after the first poll', async () => {
        getStats.mockResolvedValue(makeStats());
        mountPanel();

        expect(await screen.findByText('Memory (RSS)')).toBeInTheDocument();
        expect(screen.getByText('150.0 MB')).toBeInTheDocument();
        expect(screen.getByText('40.0 MB / 80.0 MB')).toBeInTheDocument();
        expect(screen.getByText(/pid 4242 · up 2m 5s/)).toBeInTheDocument();
        expect(screen.getByText('SSE clients')).toBeInTheDocument();
        expect(screen.getByText('500 ticks')).toBeInTheDocument();
        expect(screen.getByText(/8192\.0 MB \/ 16384\.0 MB used · 8 CPUs · win32\/x64/)).toBeInTheDocument();
    });

    it('hides the Workers section while no worker is reporting', async () => {
        getStats.mockResolvedValue(makeStats());
        mountPanel();

        await screen.findByText('Memory (RSS)');
        expect(screen.getByText('UI server (Node)')).toBeInTheDocument();
        expect(screen.queryByText('Σ CPU')).not.toBeInTheDocument();
    });

    it('shows worker rows with the scenario basename and a Σ CPU row', async () => {
        getStats.mockResolvedValue(
            makeStats({
                viewer: {
                    workers: [
                        {
                            pid: 111,
                            scenario: 'C:\\repo\\demo.scenario.js',
                            rss: 250 * MB,
                            cpuUserUsec: 1,
                            cpuSystemUsec: 1,
                        },
                    ],
                },
            }),
        );
        mountPanel();

        await screen.findByText('Σ CPU');
        // Basename without path/extension (shared scenarioBasename helper)
        expect(screen.getByText('demo')).toBeInTheDocument();
        // CPU % is only known from the second poll — shown as em dash first
        expect(screen.getByText('250.0 MB · —')).toBeInTheDocument();
    });

    it('shows an error state when /api/stats is unavailable', async () => {
        getStats.mockRejectedValue(new Error('boom'));
        mountPanel();

        expect(await screen.findByText('Backend stats unavailable')).toBeInTheDocument();
    });

    it('samples the frame buffer from the ref at the poll cadence, not per frame', async () => {
        vi.useFakeTimers();
        getStats.mockResolvedValue(makeStats());
        const { recordingRef } = mountPanel();

        // First poll (mount) — empty buffer
        await vi.waitFor(() => expect(screen.getByText('0 / 3000 (0%)')).toBeInTheDocument());

        // Frames keep arriving into the ref (App mutates it per SSE frame) —
        // the panel must pick them up only on the next poll, not re-render
        // per frame
        recordingRef.current.frames.push({}, {}, {}, {}, {});
        expect(screen.getByText('0 / 3000 (0%)')).toBeInTheDocument();

        await vi.advanceTimersByTimeAsync(2000);
        expect(screen.getByText('5 / 3000 (0%)')).toBeInTheDocument();
    });

    it('renders the SSE frame rate and perf-derived rows from __viewerPerf', async () => {
        window.__viewerPerf = { renderMs: [5], sseLatencyMs: [50, 50], snapshotSize: [1024] };
        getStats.mockResolvedValue(makeStats());
        mountPanel();

        await screen.findByText('Memory (RSS)');
        // fps = 1000 / avg(50ms, 50ms) = 20
        expect(screen.getByText('SSE frame rate')).toBeInTheDocument();
        expect(screen.getByText('20.0/s')).toBeInTheDocument();
        expect(screen.getByText('50.0ms')).toBeInTheDocument();
        expect(screen.getByText('1.0 KB')).toBeInTheDocument();
    });

    it('shows n/a for the JS heap when performance.memory is unavailable (Firefox/jsdom)', async () => {
        getStats.mockResolvedValue(makeStats());
        mountPanel();

        await screen.findByText('Memory (RSS)');
        expect(screen.getByText('n/a')).toBeInTheDocument();
    });
});
