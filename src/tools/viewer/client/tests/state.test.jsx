import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import App from '../src/App';

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

describe('state & lifecycle', () => {
    /** @type {Object} */
    let api;

    /** Always read fresh window.__viewerTest — avoids stale closure after re-renders. */
    function getState() {
        return window.__viewerTest.getState();
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        const container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            render(React.createElement(App), { container });
        });
        api = window.__viewerTest;
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    function injectFrames(n) {
        act(() => {
            api.setPlaying(false);
        });
        act(() => {
            for (let i = 0; i < n; i++) {
                api.injectFrames([{ _id: 'obj' + i, type: 'source', x: 25, y: 25, room: 'W0N0' }]);
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // getState structure
    // ═══════════════════════════════════════════════════════════════════

    describe('getState structure', () => {
        it('has all top-level groups', () => {
            const s = getState();
            expect(s).toHaveProperty('mode');
            expect(s).toHaveProperty('server');
            expect(s).toHaveProperty('recording');
            expect(s).toHaveProperty('playback');
            expect(s).toHaveProperty('ui');
        });

        it('server has all expected fields', () => {
            const s = getState().server;
            expect(s).toHaveProperty('connected');
            expect(s).toHaveProperty('state');
            expect(s).toHaveProperty('ended');
            expect(s).toHaveProperty('tick');
            expect(s).toHaveProperty('speed');
            expect(s).toHaveProperty('scenario');
        });

        it('recording has framesCount', () => {
            const s = getState().recording;
            expect(s).toHaveProperty('framesCount');
            expect(typeof s.framesCount).toBe('number');
        });

        it('playback has all expected fields', () => {
            const s = getState().playback;
            expect(s).toHaveProperty('tick');
            expect(s).toHaveProperty('playing');
            expect(s).toHaveProperty('speed');
            expect(s).toHaveProperty('atEdge');
        });

        it('ui has all expected fields', () => {
            const s = getState().ui;
            expect(s).toHaveProperty('showConsole');
            expect(s).toHaveProperty('showMiniMap');
            expect(s).toHaveProperty('showGrid');
            expect(s).toHaveProperty('sidebarTab');
            expect(s).toHaveProperty('sidebarCollapsed');
            expect(s).toHaveProperty('selectedId');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Initial state
    // ═══════════════════════════════════════════════════════════════════

    describe('initial state', () => {
        it('mode starts as scenarios (default)', () => {
            expect(getState().mode).toBe('scenarios');
        });

        it('server starts disconnected', () => {
            const srv = getState().server;
            expect(srv.connected).toBe(false);
            expect(srv.state).toBe('idle');
            expect(srv.ended).toBe(false);
            expect(srv.tick).toBe(0);
        });

        it('recording starts empty', () => {
            expect(getState().recording.framesCount).toBe(0);
        });

        it('playback starts at the edge, playing', () => {
            const pb = getState().playback;
            expect(pb.atEdge).toBe(true);
            expect(pb.playing).toBe(true);
            expect(pb.tick).toBe(0);
        });

        it('ui starts with default values', () => {
            const ui = getState().ui;
            expect(ui.sidebarTab).toBe('inspector');
            expect(ui.sidebarCollapsed).toBe(false);
            expect(ui.selectedId).toBeNull();
            expect(ui.showGrid).toBe(false);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // injectFrames
    // ═══════════════════════════════════════════════════════════════════

    describe('injectFrames', () => {
        it('increases framesCount', () => {
            injectFrames(3);
            expect(getState().recording.framesCount).toBe(3);
        });

        it('injectFrames with terrain records terrain', () => {
            act(() => {
                api.reset();
            });
            api = window.__viewerTest;

            const planeRow = '.'.repeat(50);
            const rows = Array.from({ length: 50 }, () => planeRow);
            act(() => {
                api.injectFrames([{ _id: 'src0', type: 'source', x: 25, y: 25, room: 'W0N0' }], { W0N0: rows });
            });
            expect(getState().recording.framesCount).toBe(1);
        });

        it('tick stays at 0 when playing is false', () => {
            act(() => {
                api.setPlaying(false);
            });
            injectFrames(5);
            // No auto-chase because playing=false
            expect(getState().playback.tick).toBe(0);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // seekTick
    // ═══════════════════════════════════════════════════════════════════

    describe('seekTick', () => {
        it('sets tick to requested value within bounds', () => {
            injectFrames(10);
            act(() => {
                api.seekTick(5);
            });
            expect(getState().playback.tick).toBe(5);
            expect(getState().playback.atEdge).toBe(false);
        });

        it('clamps to 0 for negative values', () => {
            injectFrames(5);
            act(() => {
                api.seekTick(-10);
            });
            expect(getState().playback.tick).toBe(0);
        });

        it('clamps to last frame for out-of-bounds values', () => {
            injectFrames(5);
            act(() => {
                api.seekTick(999);
            });
            expect(getState().playback.tick).toBe(4); // last index = 4
        });

        it('switches away from the edge (atEdge=false)', () => {
            injectFrames(5);
            act(() => {
                api.seekTick(2);
            });
            expect(getState().playback.atEdge).toBe(false);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // setPlaying
    // ═══════════════════════════════════════════════════════════════════

    describe('setPlaying', () => {
        it('changes playing state', () => {
            act(() => {
                api.setPlaying(false);
            });
            expect(getState().playback.playing).toBe(false);

            act(() => {
                api.setPlaying(true);
            });
            expect(getState().playback.playing).toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // reset
    // ═══════════════════════════════════════════════════════════════════

    describe('reset', () => {
        it('clears recording', () => {
            injectFrames(10);
            expect(getState().recording.framesCount).toBe(10);

            act(() => {
                api.reset();
            });
            api = window.__viewerTest;
            expect(getState().recording.framesCount).toBe(0);
        });

        it('resets tick to 0', () => {
            injectFrames(10);
            act(() => {
                api.seekTick(5);
            });
            expect(getState().playback.tick).toBe(5);

            act(() => {
                api.reset();
            });
            api = window.__viewerTest;
            expect(getState().playback.tick).toBe(0);
        });

        it('sets playing to false', () => {
            injectFrames(5);
            act(() => {
                api.setPlaying(true);
            });

            act(() => {
                api.reset();
            });
            api = window.__viewerTest;
            expect(getState().playback.playing).toBe(false);
        });

        it('resets server state', () => {
            act(() => {
                api.reset();
            });
            api = window.__viewerTest;
            const srv = getState().server;
            expect(srv.connected).toBe(false);
            expect(srv.ended).toBe(false);
        });

        it('clears selectedId', () => {
            injectFrames(5);
            act(() => {
                api.reset();
            });
            api = window.__viewerTest;
            expect(getState().ui.selectedId).toBeNull();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Playback edge cases
    // ═══════════════════════════════════════════════════════════════════

    describe('playback edge cases', () => {
        it('tick 0 with empty recording is valid', () => {
            const s = getState();
            expect(s.playback.tick).toBe(0);
            expect(s.recording.framesCount).toBe(0);
        });

        it('large frame injection works', () => {
            injectFrames(500);
            expect(getState().recording.framesCount).toBe(500);
            act(() => {
                api.seekTick(499);
            });
            expect(getState().playback.tick).toBe(499);
        });

        it('seekTick does not change non-tick state unexpectedly', () => {
            injectFrames(5);
            const before = getState().ui;
            act(() => {
                api.seekTick(3);
            });
            const after = getState().ui;
            expect(after.sidebarTab).toBe(before.sidebarTab);
            expect(after.sidebarCollapsed).toBe(before.sidebarCollapsed);
        });

        it('setPlaying does not change tick', () => {
            injectFrames(5);
            act(() => {
                api.seekTick(3);
            });
            const tickBefore = getState().playback.tick;
            act(() => {
                api.setPlaying(false);
            });
            expect(getState().playback.tick).toBe(tickBefore);
        });
    });
});
