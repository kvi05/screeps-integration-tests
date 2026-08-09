import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import App from '../src/App';
import CanvasStage from '../src/components/CanvasStage';

// Mock SSE client
vi.mock('../src/api/client', () => ({
    connectSSE: vi.fn(() => ({ close: vi.fn() })),
}));

describe('canvas rendering', () => {
    beforeEach(() => {
        document.body.innerHTML = '';

        // Set viewer mode so the canvas is rendered (default is 'scenarios')
        try {
            sessionStorage.setItem('sit-viewer-mode', 'viewer');
        } catch {
            /* ignore */
        }

        const container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            render(React.createElement(App), { container });
        });
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    function injectFrames(n) {
        act(() => {
            window.__viewerTest.setPlaying(false);
        });
        act(() => {
            for (let i = 0; i < n; i++) {
                window.__viewerTest.injectFrames([{ _id: 'src' + i, type: 'source', x: 25, y: 25, room: 'W0N0' }]);
            }
        });
    }

    /** Inject frames with terrain — needed for StaticLayers to render. */
    function injectWithTerrain(n) {
        // 50×50 plain terrain for W0N0
        const planeRow = '.'.repeat(50);
        const rows = Array.from({ length: 50 }, () => planeRow);
        const terrainMap = { W0N0: rows };

        // Inject terrain FIRST so StaticLayers can build terrain canvas.
        // Then inject frames.
        act(() => {
            window.__viewerTest.setPlaying(false);
        });
        act(() => {
            // Single call: terrain + 1 frame WITH terrain
            window.__viewerTest.injectFrames([{ _id: 'src0', type: 'source', x: 25, y: 25, room: 'W0N0' }], terrainMap);
        });
        // Inject remaining frames
        act(() => {
            for (let i = 1; i < n; i++) {
                window.__viewerTest.injectFrames([{ _id: 'src' + i, type: 'source', x: 25, y: 25, room: 'W0N0' }]);
            }
        });
    }

    it('canvas element exists and getContext works before frames', () => {
        const canvas = document.querySelector('canvas');
        expect(canvas).toBeInTheDocument();
        const ctx = canvas.getContext('2d');
        expect(ctx).toBeDefined();
        expect(typeof ctx.drawImage).toBe('function');
    });

    it('canvas element exists after rendering a frame with terrain', () => {
        injectWithTerrain(1);
        act(() => {
            window.__viewerTest.seekTick(0);
        });

        const canvas = document.querySelector('canvas');
        expect(canvas).toBeInTheDocument();
        expect(canvas.width).toBeGreaterThan(0);
        expect(canvas.height).toBeGreaterThan(0);
    });

    it('canvas dimensions are set after rendering', () => {
        injectWithTerrain(1);
        act(() => {
            window.__viewerTest.seekTick(0);
        });

        const canvas = document.querySelector('canvas');
        // After renderCurrentFrame sets canvas.width/height via getBoundingClientRect
        expect(canvas.width).toBeGreaterThan(0);
        expect(canvas.height).toBeGreaterThan(0);
    });

    it('canvas survives multiple renders without errors', () => {
        injectWithTerrain(3);

        act(() => {
            window.__viewerTest.seekTick(0);
        });
        expect(document.querySelector('canvas')).toBeInTheDocument();

        act(() => {
            window.__viewerTest.seekTick(2);
        });
        expect(document.querySelector('canvas')).toBeInTheDocument();
        expect(document.querySelector('canvas').width).toBeGreaterThan(0);
    });

    it('canvas without terrain renders without errors (graceful blank)', () => {
        injectFrames(1);
        act(() => {
            window.__viewerTest.seekTick(0);
        });

        const canvas = document.querySelector('canvas');
        expect(canvas).toBeInTheDocument();
        // Without terrain, drawFrame still runs — just with empty static layers
    });

    it('re-renders when a new frame arrives while the buffer length stays constant', () => {
        // Regression: a redraw must be driven by the newest frame, not by
        // frames.length — once the ring buffer is full, length no longer
        // changes on arrival.
        const makeRecording = (n) => ({
            terrain: { W0N0: Array.from({ length: 50 }, () => '.'.repeat(50)) },
            frames: Array.from({ length: n }, (_, i) => ({
                gameTime: i,
                objects: [{ _id: 'src' + i, type: 'source', x: 25, y: 25, room: 'W0N0' }],
                console: [],
            })),
        });

        // Count full renders: renderCurrentFrame calls clearRect once per draw.
        // getContext returns a fresh mock each call, so instrument the method.
        const origGetContext = HTMLCanvasElement.prototype.getContext;
        const clearCount = { n: 0 };
        HTMLCanvasElement.prototype.getContext = function (type) {
            const ctx = origGetContext.call(this, type);
            const origClear = ctx.clearRect.bind(ctx);
            ctx.clearRect = (...args) => {
                clearCount.n++;
                return origClear(...args);
            };
            return ctx;
        };

        try {
            const { rerender } = render(
                <CanvasStage recording={makeRecording(200)} tick={199} sub={null} playing={false} />,
            );
            act(() => {}); // flush effects

            const baseline = clearCount.n;
            expect(baseline).toBeGreaterThan(0); // rendered at least once

            // New recording: same length (200) but a brand-new last frame —
            // exactly what happens once the ring buffer is full.
            rerender(<CanvasStage recording={makeRecording(200)} tick={199} sub={null} playing={false} />);

            expect(clearCount.n).toBeGreaterThan(baseline);
        } finally {
            HTMLCanvasElement.prototype.getContext = origGetContext;
        }
    });
});
