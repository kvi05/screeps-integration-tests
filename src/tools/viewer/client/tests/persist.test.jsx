import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import App from '../src/App';

// Captured SSE callback — lets tests drive server events (frame/start/end).
const mocks = vi.hoisted(() => ({ sseHandler: null }));

vi.mock('../src/api/client', () => ({
    connectSSE: vi.fn((onEvent) => {
        mocks.sseHandler = onEvent;
        return { close: vi.fn() };
    }),
    postResume: vi.fn(() => Promise.resolve()),
    postPause: vi.fn(() => Promise.resolve()),
    postStep: vi.fn(() => Promise.resolve()),
    postSpeed: vi.fn(() => Promise.resolve()),
    postDispose: vi.fn(() => Promise.resolve()),
    postRestoreTick: vi.fn(() => Promise.resolve()),
    postSaveSnapshot: vi.fn(() => Promise.resolve()),
}));

const STORAGE_KEY = 'sit-viewer-recording';

function renderApp() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
        render(React.createElement(App), { container });
    });
    return window.__viewerTest;
}

/**
 * Recording is persisted to sessionStorage only on scenario end / page hide,
 * not on every frame (the old debounced 500ms JSON.stringify of up to 200
 * frames blocked the main thread during a live run).
 */
describe('recording persistence', () => {
    let api;

    /** Always read fresh window.__viewerTest — avoids stale closure after re-renders. */
    function getState() {
        return window.__viewerTest.getState();
    }

    beforeEach(() => {
        sessionStorage.clear();
        mocks.sseHandler = null;
        document.body.innerHTML = '';
        try {
            sessionStorage.setItem('sit-viewer-mode', 'viewer');
        } catch {
            /* ignore */
        }
        api = renderApp();
    });

    afterEach(() => {
        document.body.innerHTML = '';
        sessionStorage.clear();
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

    it('does not persist to sessionStorage during a live run', () => {
        injectFrames(3);
        expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('persists the current recording on pagehide (always, regardless of visibilityState)', () => {
        injectFrames(2);
        act(() => {
            window.dispatchEvent(new Event('pagehide'));
        });

        const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
        expect(saved).toBeTruthy();
        expect(saved.frames).toHaveLength(2);
    });

    it('does NOT persist on visibilitychange (hidden) — minimize must not stringify the full buffer', () => {
        // Removed deliberately (2026-09-04): the only consumer of the persist
        // is a page RELOAD, and reloads always fire `pagehide`. Closing the
        // tab kills sessionStorage regardless, so a hidden-persist only cost
        // a full-buffer JSON.stringify (~190 MB measured) on every minimize.
        injectFrames(2);
        Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            configurable: true,
        });
        try {
            act(() => {
                window.dispatchEvent(new Event('visibilitychange'));
            });
            expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
        } finally {
            delete document.visibilityState; // restore the jsdom getter
        }
    });

    it('persists the recording when the scenario ends', () => {
        injectFrames(2);
        act(() => {
            mocks.sseHandler('end', {});
        });

        const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
        expect(saved.frames).toHaveLength(2);
        expect(getState().server.ended).toBe(true);
    });

    it('clears the persisted recording when a new scenario starts', () => {
        injectFrames(2);
        act(() => {
            window.dispatchEvent(new Event('pagehide'));
        });
        expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();

        act(() => {
            mocks.sseHandler('start', { scenario: 'demo.scenario.js' });
        });

        expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(getState().recording.framesCount).toBe(0);
    });

    // ─── Recording survives a page reload (reconnect) ───────────────────
    // The server re-sends the SSE `start` event to late-connecting clients —
    // i.e. right after a page reload while a scenario runs. The local buffer
    // must survive that: the reload is the only copy of the history.

    /** Send N frames with real gameTime values through the SSE handler. */
    function streamFrames(from, to) {
        act(() => {
            for (let i = from; i <= to; i++) {
                mocks.sseHandler('frame', { gameTime: i, objects: [], console: [] });
            }
        });
    }

    it('keeps accumulated frames when start re-arrives for the same scenario (reload during a run)', () => {
        act(() => {
            mocks.sseHandler('start', { scenario: 'demo.scenario.js' });
        });
        streamFrames(0, 9);
        expect(getState().recording.framesCount).toBe(10);

        // Page reload → SSE reconnect → the server re-sends `start`
        act(() => {
            mocks.sseHandler('start', { scenario: 'demo.scenario.js' });
        });
        expect(getState().recording.framesCount).toBe(10); // NOT wiped

        // The server continues from tick 10 — history + new frames
        streamFrames(10, 12);
        expect(getState().recording.framesCount).toBe(13);
    });

    it('does not duplicate the latest frame re-sent by the server on reconnect', () => {
        act(() => {
            mocks.sseHandler('start', { scenario: 'demo.scenario.js' });
        });
        streamFrames(0, 9);
        act(() => {
            mocks.sseHandler('start', { scenario: 'demo.scenario.js' });
        });
        // Late-connect re-send of the latest frame (same gameTime)
        act(() => {
            mocks.sseHandler('frame', { gameTime: 9, objects: [], console: [] });
        });
        expect(getState().recording.framesCount).toBe(10);
    });

    it('drops the held history when the same scenario restarts from tick 0', () => {
        act(() => {
            mocks.sseHandler('start', { scenario: 'demo.scenario.js' });
        });
        streamFrames(0, 9);
        act(() => {
            mocks.sseHandler('start', { scenario: 'demo.scenario.js' }); // reconnect suspected
        });
        expect(getState().recording.framesCount).toBe(10);
        // …but the first frame is tick 0 — a fresh run of the same scenario
        act(() => {
            mocks.sseHandler('frame', { gameTime: 0, objects: [], console: [] });
        });
        expect(getState().recording.framesCount).toBe(1);
    });

    it('wipes the buffer immediately when a different scenario starts', () => {
        act(() => {
            mocks.sseHandler('start', { scenario: 'demo.scenario.js' });
        });
        streamFrames(0, 9);
        act(() => {
            mocks.sseHandler('start', { scenario: 'other.scenario.js' });
        });
        expect(getState().recording.framesCount).toBe(0);
    });

    it('caps the live recording ring buffer at REPLAY_BUFFER_FALLBACK frames', () => {
        // REPLAY_BUFFER_FALLBACK = 3000 — inject 3005 to verify the cap
        act(() => {
            for (let i = 0; i < 3005; i++) {
                mocks.sseHandler('frame', {
                    gameTime: i,
                    objects: [{ _id: 'o' + i, type: 'source', x: 25, y: 25, room: 'W0N0' }],
                    console: [],
                });
            }
        });

        expect(getState().recording.framesCount).toBe(3000);
    });

    it('on QuotaExceededError keeps shrinking until the newest frames fit', () => {
        // Spy on the PROTOTYPE: jsdom hands out Storage instances that share
        // backing data but are separate JS objects — an instance-level spy does
        // not intercept App-module calls. Real quotas are ~5MB; simulate with an
        // absurdly small one to force the shrink loop.
        const realSet = Storage.prototype.setItem;
        const QUOTA = 1024;
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
            if (key === STORAGE_KEY && String(value).length > QUOTA) {
                const e = new Error('quota');
                e.name = 'QuotaExceededError';
                throw e;
            }
            return realSet.call(this, key, value);
        });

        try {
            injectFrames(64); // with the mocked 1KB quota, only a few frames fit
            act(() => {
                window.dispatchEvent(new Event('pagehide'));
            });

            const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
            // Shrunk to the newest frames — at least one frame must survive.
            expect(saved).toBeTruthy();
            expect(saved.frames.length).toBeGreaterThan(0);
            expect(saved.frames.length).toBeLessThanOrEqual(64);
        } finally {
            spy.mockRestore();
        }
    });

    it('saves nothing when even one frame does not fit the quota', () => {
        const realSet = Storage.prototype.setItem;
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
            if (key === STORAGE_KEY) {
                const e = new Error('quota');
                e.name = 'QuotaExceededError';
                throw e;
            }
            return realSet.call(this, key, value);
        });

        try {
            injectFrames(4);
            act(() => {
                window.dispatchEvent(new Event('pagehide'));
            });

            expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
        } finally {
            spy.mockRestore();
        }
    });
});

describe('recording restore on mount', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        sessionStorage.clear();
    });

    it('restores a persisted recording from sessionStorage', () => {
        sessionStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                terrain: {},
                frames: [
                    { gameTime: 0, objects: [], console: [] },
                    { gameTime: 1, objects: [], console: [] },
                    { gameTime: 2, objects: [], console: [] },
                ],
            }),
        );

        const api = renderApp();
        expect(api.getState().recording.framesCount).toBe(3);
    });

    it('starts with an empty recording when nothing is persisted', () => {
        const api = renderApp();
        expect(api.getState().recording.framesCount).toBe(0);
    });

    it('starts fresh when persisted data is corrupted', () => {
        sessionStorage.setItem(STORAGE_KEY, 'not-json{');
        const api = renderApp();
        expect(api.getState().recording.framesCount).toBe(0);
    });
});
