import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import React from 'react';
import App from '../src/App';
import CanvasStage from '../src/components/CanvasStage';

// Mock SSE client
vi.mock('../src/api/client', () => ({
    connectSSE: vi.fn(() => ({ close: vi.fn() })),
    postResume: vi.fn(() => Promise.resolve()),
    postPause: vi.fn(() => Promise.resolve()),
    postStep: vi.fn(() => Promise.resolve()),
    postSpeed: vi.fn(() => Promise.resolve()),
    postDispose: vi.fn(() => Promise.resolve()),
    postRestoreTick: vi.fn(() => Promise.resolve()),
    postSaveSnapshot: vi.fn(() => Promise.resolve()),
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

    it('does not reallocate the canvas backing store when the size is unchanged', () => {
        // Regression: assigning canvas.width/height always reallocates the
        // backing store and resets the context state. The resize guard must
        // only assign when the pixel size actually changes.
        const makeRecording = (n) => ({
            terrain: { W0N0: Array.from({ length: 50 }, () => '.'.repeat(50)) },
            frames: Array.from({ length: n }, (_, i) => ({
                gameTime: i,
                objects: [{ _id: 'src' + i, type: 'source', x: 25, y: 25, room: 'W0N0' }],
                console: [],
            })),
        });

        // Render into an isolated container (beforeEach already mounted App).
        const container = document.createElement('div');
        document.body.appendChild(container);
        const { rerender } = render(<CanvasStage recording={makeRecording(1)} tick={0} sub={null} playing={false} />, {
            container,
        });
        act(() => {}); // flush effects

        const canvas = container.querySelector('canvas');
        const stage = canvas.parentElement;

        // Instrument width/height setters to count backing-store reallocs.
        let widthValue = canvas.width;
        let heightValue = canvas.height;
        let widthSets = 0;
        let heightSets = 0;
        Object.defineProperty(canvas, 'width', {
            configurable: true,
            get() {
                return widthValue;
            },
            set(v) {
                widthSets++;
                widthValue = v;
            },
        });
        Object.defineProperty(canvas, 'height', {
            configurable: true,
            get() {
                return heightValue;
            },
            set(v) {
                heightSets++;
                heightValue = v;
            },
        });

        // Change the container size (setup mock default is 1024×768).
        Object.defineProperty(stage, 'clientWidth', { value: 400, configurable: true });
        Object.defineProperty(stage, 'clientHeight', { value: 300, configurable: true });

        // Size changed → reallocate exactly once.
        rerender(<CanvasStage recording={makeRecording(2)} tick={1} sub={null} playing={false} />);
        expect(widthSets).toBe(1);
        expect(heightSets).toBe(1);
        expect(canvas.width).toBe(400);
        expect(canvas.height).toBe(300);

        // Same size, new frame → must NOT reallocate again.
        rerender(<CanvasStage recording={makeRecording(3)} tick={2} sub={null} playing={false} />);
        expect(widthSets).toBe(1);
        expect(heightSets).toBe(1);
    });

    it('runs the animation loop only while sub-frame interpolation is active', () => {
        // Regression: with sub===null (the normal case — no interpolation),
        // the 60fps loop used to redraw the identical static frame forever.
        const makeRecording = (n) => ({
            terrain: { W0N0: Array.from({ length: 50 }, () => '.'.repeat(50)) },
            frames: Array.from({ length: n }, (_, i) => ({
                gameTime: i,
                objects: [{ _id: 'src' + i, type: 'source', x: 25, y: 25, room: 'W0N0' }],
                console: [],
            })),
        });

        // Replace the setTimeout-based rAF mock so no real timers fire.
        const origRaf = window.requestAnimationFrame;
        const origCancelRaf = window.cancelAnimationFrame;
        const raf = vi.fn(() => 1);
        const cancelRaf = vi.fn();
        window.requestAnimationFrame = raf;
        window.cancelAnimationFrame = cancelRaf;

        try {
            const container = document.createElement('div');
            document.body.appendChild(container);
            const { rerender } = render(
                <CanvasStage recording={makeRecording(1)} tick={0} sub={null} playing={true} />,
                { container },
            );
            act(() => {});

            // No interpolation → no loop, even while playing.
            expect(raf).not.toHaveBeenCalled();

            // Interpolation active → the loop starts.
            rerender(<CanvasStage recording={makeRecording(1)} tick={0} sub={0.5} playing={true} />);
            act(() => {});
            expect(raf).toHaveBeenCalledTimes(1);

            // Interpolation stops → the loop is cancelled, nothing re-scheduled.
            rerender(<CanvasStage recording={makeRecording(1)} tick={0} sub={null} playing={true} />);
            act(() => {});
            expect(cancelRaf).toHaveBeenCalled();
            expect(raf).toHaveBeenCalledTimes(1);
        } finally {
            window.requestAnimationFrame = origRaf;
            window.cancelAnimationFrame = origCancelRaf;
        }
    });

    it('coalesces camera drag into one paint per frame and commits state at gesture end', () => {
        // Regression: live camera gestures must paint straight from the camera
        // ref, coalesced to at most one canvas redraw per animation frame —
        // NOT a React state update + full redraw per mousemove. React state
        // (and onCameraChange consumers like MiniMap) is committed once, at
        // gesture end.
        const makeRecording = (n) => ({
            terrain: { W0N0: Array.from({ length: 50 }, () => '.'.repeat(50)) },
            frames: Array.from({ length: n }, (_, i) => ({
                gameTime: i,
                objects: [{ _id: 'src' + i, type: 'source', x: 25, y: 25, room: 'W0N0' }],
                console: [],
            })),
        });

        // Count paints: renderCurrentFrame calls clearRect exactly once per draw.
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

        // Manual rAF queue — callbacks run only when flushed explicitly.
        const origRaf = window.requestAnimationFrame;
        const origCancelRaf = window.cancelAnimationFrame;
        const queue = [];
        let rafSeq = 0;
        window.requestAnimationFrame = vi.fn((cb) => {
            queue.push(cb);
            return ++rafSeq;
        });
        window.cancelAnimationFrame = vi.fn();

        const onCameraChange = vi.fn();

        try {
            const container = document.createElement('div');
            document.body.appendChild(container);
            render(
                <CanvasStage
                    recording={makeRecording(1)}
                    tick={0}
                    sub={null}
                    playing={false}
                    onCameraChange={onCameraChange}
                />,
                { container },
            );
            act(() => {}); // flush mount effects (initial fit + paint)

            const canvas = container.querySelector('canvas');
            const paintsAtStart = clearCount.n;
            const commitsAtStart = onCameraChange.mock.calls.length;
            const before = onCameraChange.mock.calls[commitsAtStart - 1][0];

            // Drag: right-button down + three moves inside one frame window.
            fireEvent.mouseDown(canvas, { button: 2, clientX: 100, clientY: 100 });
            fireEvent.mouseMove(canvas, { clientX: 120, clientY: 90 });
            fireEvent.mouseMove(canvas, { clientX: 140, clientY: 80 });
            fireEvent.mouseMove(canvas, { clientX: 160, clientY: 70 });

            // No synchronous paints, exactly one rAF scheduled for the whole
            // batch, and no React state commits during the gesture.
            expect(clearCount.n).toBe(paintsAtStart);
            expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
            expect(onCameraChange.mock.calls.length).toBe(commitsAtStart);

            // Flushing the frame → exactly ONE paint for the whole batch.
            act(() => {
                const pending = queue.splice(0);
                for (const cb of pending) cb();
            });
            expect(clearCount.n).toBe(paintsAtStart + 1);

            // Gesture end → single commit carrying the final camera position
            // (dx = +60, dy = −30 from the three moves; zoom unchanged).
            fireEvent.mouseUp(canvas, { clientX: 160, clientY: 70 });
            expect(onCameraChange.mock.calls.length).toBe(commitsAtStart + 1);
            expect(onCameraChange).toHaveBeenLastCalledWith({
                x: before.x + 60,
                y: before.y - 30,
                zoom: before.zoom,
            });
        } finally {
            HTMLCanvasElement.prototype.getContext = origGetContext;
            window.requestAnimationFrame = origRaf;
            window.cancelAnimationFrame = origCancelRaf;
        }
    });

    // ─── Idle keep-warm + visibility warm-up ────────────────────────────────
    // Regression guard for the "first interaction after an idle period
    // stutters" bug: while visible-but-idle the browser evicts decoded
    // sprite bitmaps and the canvas' GPU backing store; the stage must keep
    // its caches warm and repaint immediately when the tab returns.

    const makeRecording = (n) => ({
        terrain: { W0N0: Array.from({ length: 50 }, () => '.'.repeat(50)) },
        frames: Array.from({ length: n }, (_, i) => ({
            gameTime: i,
            objects: [{ _id: 'src' + i, type: 'source', x: 25, y: 25, room: 'W0N0' }],
            console: [],
        })),
    });

    /** Count full paints: renderCurrentFrame calls clearRect exactly once per draw. */
    function instrumentPaints() {
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
        return {
            clearCount,
            restore() {
                HTMLCanvasElement.prototype.getContext = origGetContext;
            },
        };
    }

    /** Override document visibility (jsdom defaults to visible); returns a restore fn. */
    function setVisibility(state) {
        Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
        Object.defineProperty(document, 'hidden', { value: state === 'hidden', configurable: true });
        return () => {
            delete document.visibilityState;
            delete document.hidden;
        };
    }

    it('keep-warm: repaints an idle visible stage at most once per interval', () => {
        // Date is faked so the staleness check (Date.now() vs last paint)
        // advances together with the interval.
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        const { clearCount, restore } = instrumentPaints();
        try {
            const container = document.createElement('div');
            document.body.appendChild(container);
            const { unmount } = render(
                <CanvasStage recording={makeRecording(1)} tick={0} sub={null} playing={false} />,
                { container },
            );
            act(() => {}); // flush mount effects (initial paint)

            const baseline = clearCount.n;
            expect(baseline).toBeGreaterThan(0);

            // Idle for a full interval → exactly one warm repaint.
            act(() => {
                vi.advanceTimersByTime(4000);
            });
            expect(clearCount.n).toBe(baseline + 1);

            // The repaint refreshed the timestamp — an interval fire just
            // before the next interval must NOT paint again.
            act(() => {
                vi.advanceTimersByTime(3999);
            });
            expect(clearCount.n).toBe(baseline + 1);

            act(() => {
                vi.advanceTimersByTime(1);
            });
            expect(clearCount.n).toBe(baseline + 2);

            unmount();
        } finally {
            restore();
            vi.useRealTimers();
        }
    });

    it('repaints immediately when the tab becomes visible again', () => {
        const { clearCount, restore } = instrumentPaints();
        try {
            const container = document.createElement('div');
            document.body.appendChild(container);
            render(<CanvasStage recording={makeRecording(1)} tick={0} sub={null} playing={false} />, {
                container,
            });
            act(() => {});

            const baseline = clearCount.n;
            expect(baseline).toBeGreaterThan(0);

            // visibilitychange while hidden → no paint.
            const hide = setVisibility('hidden');
            act(() => {
                document.dispatchEvent(new Event('visibilitychange'));
            });
            expect(clearCount.n).toBe(baseline);
            hide();

            // Back to visible → immediate warm-up repaint.
            const show = setVisibility('visible');
            act(() => {
                document.dispatchEvent(new Event('visibilitychange'));
            });
            expect(clearCount.n).toBe(baseline + 1);
            show();
        } finally {
            restore();
        }
    });

    it('skips data-driven paints while hidden and covers the return with a warm-up', () => {
        const { clearCount, restore } = instrumentPaints();
        try {
            const container = document.createElement('div');
            document.body.appendChild(container);
            const { rerender } = render(
                <CanvasStage recording={makeRecording(1)} tick={0} sub={null} playing={false} />,
                { container },
            );
            act(() => {});

            const baseline = clearCount.n;

            // Hide the tab, then deliver a new frame — the paint is skipped
            // (nothing is composited while hidden).
            const hide = setVisibility('hidden');
            rerender(<CanvasStage recording={makeRecording(2)} tick={1} sub={null} playing={false} />);
            act(() => {});
            expect(clearCount.n).toBe(baseline);
            hide();

            // Return to visible → warm-up repaint with the latest state.
            const show = setVisibility('visible');
            act(() => {
                document.dispatchEvent(new Event('visibilitychange'));
            });
            expect(clearCount.n).toBe(baseline + 1);
            show();
        } finally {
            restore();
        }
    });
});
