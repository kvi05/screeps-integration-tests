import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import App from '../src/App';
import { postPause, postResume, postRestoreTick, postSaveSnapshot, postStep } from '../src/api/client';

// Captured SSE callback — lets tests drive server events (frame/start/status).
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
    getSnapshots: vi.fn(() => Promise.resolve({ snapshots: [] })),
}));

describe('seamless playback (no modes)', () => {
    let api;

    function getState() {
        return window.__viewerTest.getState();
    }

    function pressKey(key, modifiers = {}) {
        act(() => {
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key,
                    bubbles: true,
                    cancelable: true,
                    ...modifiers,
                }),
            );
        });
    }

    function injectFrames(n) {
        act(() => {
            for (let i = 0; i < n; i++) {
                api.injectFrames([{ _id: 'o' + i, type: 'source', x: 25, y: 25, room: 'W0N0' }]);
            }
        });
    }

    /** Connect to a live running server and feed N frames over SSE. */
    function goLive(n, opts = {}) {
        act(() => {
            mocks.sseHandler('start', { scenario: 'demo.scenario.js', paused: opts.paused || false });
        });
        act(() => {
            mocks.sseHandler('status', { state: opts.paused ? 'paused' : 'running', tick: 0 });
        });
        act(() => {
            for (let i = 0; i < n; i++) {
                mocks.sseHandler('frame', {
                    gameTime: i,
                    objects: [{ _id: 'o' + i, type: 'source', x: 25, y: 25, room: 'W0N0' }],
                    console: [],
                });
            }
        });
    }

    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        mocks.sseHandler = null;
        document.body.innerHTML = '';
        const container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            render(React.createElement(App), { container });
        });
        api = window.__viewerTest;
        postPause.mockClear();
        postResume.mockClear();
        postStep.mockClear();
        postRestoreTick.mockClear();
        postSaveSnapshot.mockClear();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('scrubbing back while live pauses the server', () => {
        goLive(5);
        expect(getState().playback.tick).toBe(4); // chased the live frames
        act(() => {
            api.seekTick(2);
        });
        expect(getState().playback.tick).toBe(2);
        expect(getState().playback.playing).toBe(false);
        expect(postPause).toHaveBeenCalledTimes(1);
    });

    it('step back from the live edge pauses the server', () => {
        goLive(5);
        pressKey('ArrowLeft');
        expect(getState().playback.tick).toBe(3);
        expect(postPause).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+S saves a snapshot while connected to a live server', () => {
        goLive(5);
        pressKey('s', { ctrlKey: true });
        expect(postSaveSnapshot).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Z rewinds the server to the scrubber tick', () => {
        goLive(5);
        act(() => {
            api.seekTick(2);
        });
        pressKey('z', { ctrlKey: true });
        expect(postRestoreTick).toHaveBeenCalledWith(2);
    });

    it('Ctrl+S in an input does NOT save', () => {
        goLive(5);
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
        });
        expect(postSaveSnapshot).not.toHaveBeenCalled();
    });

    it('Ctrl+Z in an input does NOT rewind', () => {
        goLive(5);
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
        });
        expect(postRestoreTick).not.toHaveBeenCalled();
    });

    it('pausing stops the live server', () => {
        goLive(3);
        act(() => {
            api.setPlaying(false);
        });
        expect(postPause).toHaveBeenCalledTimes(1);
    });

    it('playing at the edge resumes the paused server', () => {
        act(() => {
            mocks.sseHandler('start', { scenario: 'demo.scenario.js' });
        });
        act(() => {
            api.setPlaying(false);
        });
        act(() => {
            mocks.sseHandler('status', { state: 'paused', tick: 0 });
        });
        injectFrames(3);
        act(() => {
            api.seekTick(2); // cursor to the edge
        });
        postResume.mockClear();
        act(() => {
            api.setPlaying(true);
        });
        expect(postResume).toHaveBeenCalledTimes(1);
    });

    it('replay reaches the edge and seamlessly resumes the live server', () => {
        vi.useFakeTimers();
        try {
            act(() => {
                mocks.sseHandler('start', { scenario: 'demo.scenario.js' });
            });
            act(() => {
                api.setPlaying(false);
            });
            act(() => {
                mocks.sseHandler('status', { state: 'paused', tick: 0 });
            });
            injectFrames(10);
            act(() => {
                api.seekTick(5);
            });

            postResume.mockClear();
            act(() => {
                api.setPlaying(true);
            });
            // Pressing play in the past must NOT jump to the latest frame —
            // the client timer ticks through the buffer one frame at a time.
            expect(getState().playback.tick).toBe(5);
            expect(postResume).not.toHaveBeenCalled();
            // Client timer: default speed 1000 → 9ms per tick
            act(() => {
                vi.advanceTimersByTime(9);
            });
            expect(getState().playback.tick).toBe(6);

            act(() => {
                vi.advanceTimersByTime(9);
            });
            expect(getState().playback.tick).toBe(7);

            act(() => {
                vi.advanceTimersByTime(18);
            });
            expect(getState().playback.tick).toBe(9); // reached the edge

            expect(getState().playback.playing).toBe(true); // keeps playing
            expect(postResume).toHaveBeenCalledTimes(1); // seamless handover
        } finally {
            vi.useRealTimers();
        }
    });

    it('chase follows a stepped frame while the cursor sits at the edge', () => {
        act(() => {
            mocks.sseHandler('start', { scenario: 'demo.scenario.js' });
        });
        act(() => {
            api.setPlaying(false);
        });
        act(() => {
            mocks.sseHandler('status', { state: 'paused', tick: 0 });
        });
        injectFrames(3);
        act(() => {
            api.seekTick(2); // cursor to the edge
        });
        // Server steps: status 'stepping', then the new frame arrives
        act(() => {
            mocks.sseHandler('status', { state: 'stepping', tick: 3 });
            mocks.sseHandler('frame', {
                gameTime: 3,
                objects: [{ _id: 'o3', type: 'source', x: 25, y: 25, room: 'W0N0' }],
                console: [],
            });
        });
        expect(getState().playback.tick).toBe(3); // cursor followed the stepped frame
        expect(getState().playback.playing).toBe(false);
    });

    it('step forward at the edge steps the server', () => {
        act(() => {
            mocks.sseHandler('start', { scenario: 'demo.scenario.js' });
        });
        act(() => {
            api.setPlaying(false);
        });
        act(() => {
            mocks.sseHandler('status', { state: 'paused', tick: 0 });
        });
        injectFrames(3);
        act(() => {
            api.seekTick(2); // cursor to the edge
        });
        pressKey('ArrowRight');
        expect(postStep).toHaveBeenCalledWith(1);
        expect(getState().playback.tick).toBe(2); // cursor stays at the edge
    });

    it('step forward in the past moves the cursor without touching the server', () => {
        act(() => {
            mocks.sseHandler('start', { scenario: 'demo.scenario.js' });
        });
        act(() => {
            api.setPlaying(false);
        });
        act(() => {
            mocks.sseHandler('status', { state: 'paused', tick: 0 });
        });
        injectFrames(5);
        act(() => {
            api.seekTick(1);
        });
        pressKey('ArrowRight');
        expect(getState().playback.tick).toBe(2);
        expect(postStep).not.toHaveBeenCalled();
    });

    it('paused start (viewerOptions.paused) keeps the server paused', () => {
        goLive(0, { paused: true });
        expect(getState().playback.playing).toBe(false);
        expect(postResume).not.toHaveBeenCalled();
    });

    it('reload while paused: status → start(paused) → cached frame, no resume', () => {
        // A late-connecting client gets status first, then the re-sent start
        // (with merged paused=true) and the cached last frame. The button must
        // reflect the real paused state and the frame must render.
        act(() => {
            mocks.sseHandler('status', { state: 'paused', tick: 7 });
        });
        act(() => {
            mocks.sseHandler('start', { scenario: 'demo.scenario.js', paused: true });
        });
        act(() => {
            mocks.sseHandler('frame', {
                gameTime: 7,
                objects: [{ _id: 'o7', type: 'source', x: 25, y: 25, room: 'W0N0' }],
                console: [],
            });
        });
        expect(getState().server.state).toBe('paused');
        expect(getState().playback.playing).toBe(false);
        expect(getState().recording.framesCount).toBe(1);
        expect(postResume).not.toHaveBeenCalled();
        expect(postPause).not.toHaveBeenCalled();
    });

    it('restored event resets the buffer and pauses playback', () => {
        goLive(5);
        expect(getState().recording.framesCount).toBe(5);
        act(() => {
            mocks.sseHandler('restored', { tick: 2 });
        });
        expect(getState().recording.framesCount).toBe(0);
        expect(getState().playback.tick).toBe(0);
        expect(getState().playback.playing).toBe(false);
    });

    it('after end, local replay plays through buffered frames', () => {
        vi.useFakeTimers();
        try {
            goLive(5);
            expect(getState().playback.tick).toBe(4);

            act(() => {
                mocks.sseHandler('end', {});
            });
            expect(getState().playback.playing).toBe(false);
            expect(getState().playback.tick).toBe(4);

            act(() => {
                api.seekTick(1); // cursor into the past
            });
            postResume.mockClear();
            act(() => {
                api.setPlaying(true);
            });

            // No live server left — must NOT try to resume it
            expect(postResume).not.toHaveBeenCalled();

            // Client timer ticks through the buffered frames (9ms per tick)
            act(() => {
                vi.advanceTimersByTime(9);
            });
            expect(getState().playback.tick).toBe(2);

            act(() => {
                vi.advanceTimersByTime(18);
            });
            expect(getState().playback.tick).toBe(4); // reached the edge

            // At the edge after end there is no server — playback stops
            act(() => {
                vi.advanceTimersByTime(9);
            });
            expect(getState().playback.playing).toBe(false);
            expect(postResume).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
});
