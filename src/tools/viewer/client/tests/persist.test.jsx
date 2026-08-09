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
    postSpeed: vi.fn(() => Promise.resolve()),
    postDispose: vi.fn(() => Promise.resolve()),
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

    it('persists the current recording on pagehide', () => {
        injectFrames(2);
        act(() => {
            window.dispatchEvent(new Event('pagehide'));
        });

        const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
        expect(saved).toBeTruthy();
        expect(saved.frames).toHaveLength(2);
    });

    it('persists the current recording on visibilitychange', () => {
        injectFrames(2);
        act(() => {
            window.dispatchEvent(new Event('visibilitychange'));
        });

        const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
        expect(saved.frames).toHaveLength(2);
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

    it('caps the live recording ring buffer at 200 frames', () => {
        act(() => {
            for (let i = 0; i < 205; i++) {
                mocks.sseHandler('frame', {
                    gameTime: i,
                    objects: [{ _id: 'o' + i, type: 'source', x: 25, y: 25, room: 'W0N0' }],
                    console: [],
                });
            }
        });

        expect(getState().recording.framesCount).toBe(200);
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
