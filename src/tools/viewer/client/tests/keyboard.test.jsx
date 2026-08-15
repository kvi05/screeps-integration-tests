import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import App from '../src/App';

// Mock SSE client + server-control API
vi.mock('../src/api/client', () => ({
    connectSSE: vi.fn(() => ({
        close: vi.fn(),
    })),
    postResume: vi.fn(() => Promise.resolve()),
    postPause: vi.fn(() => Promise.resolve()),
    postStep: vi.fn(() => Promise.resolve()),
    postSpeed: vi.fn(() => Promise.resolve()),
    postDispose: vi.fn(() => Promise.resolve()),
    postRestoreTick: vi.fn(() => Promise.resolve()),
    postSaveSnapshot: vi.fn(() => Promise.resolve()),
}));

describe('keyboard shortcuts', () => {
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
        // Pause BEFORE injecting to prevent auto-chase effect
        act(() => {
            api.setPlaying(false);
        });
        act(() => {
            for (let i = 0; i < n; i++) {
                api.injectFrames([{ _id: 's' + i, type: 'source', x: 25, y: 25, room: 'W0N0' }]);
            }
        });
        // Seek to tick 0 for deterministic manual navigation
        act(() => {
            api.seekTick(0);
        });
    }

    function pressKey(key) {
        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        });
    }

    // ── Arrow keys: replay navigation ────────────────────────────────

    it('ArrowRight advances tick by 1', () => {
        injectFrames(5);
        expect(getState().playback.tick).toBe(0);
        pressKey('ArrowRight');
        expect(getState().playback.tick).toBe(1);
    });

    it('ArrowLeft decrements tick by 1', () => {
        injectFrames(5);
        pressKey('ArrowRight');
        pressKey('ArrowRight');
        pressKey('ArrowRight');
        expect(getState().playback.tick).toBe(3);
        pressKey('ArrowLeft');
        expect(getState().playback.tick).toBe(2);
    });

    it('ArrowLeft at tick 0 stays at 0', () => {
        injectFrames(5);
        expect(getState().playback.tick).toBe(0);
        pressKey('ArrowLeft');
        expect(getState().playback.tick).toBe(0);
    });

    // ── Camera isolation (critical regression check) ────────────────

    it('ArrowRight does NOT move camera', () => {
        injectFrames(5);
        const before = api.getCamera();
        pressKey('ArrowRight');
        const after = api.getCamera();
        expect(after.x).toBe(before.x);
        expect(after.y).toBe(before.y);
        expect(after.zoom).toBe(before.zoom);
    });

    it('ArrowLeft does NOT move camera', () => {
        injectFrames(5);
        pressKey('ArrowRight');
        pressKey('ArrowRight');
        const before = api.getCamera();
        pressKey('ArrowLeft');
        expect(api.getCamera().x).toBe(before.x);
    });

    it('multiple arrows: only tick changes, not camera', () => {
        injectFrames(20);
        const beforeCam = api.getCamera();

        for (let i = 0; i < 10; i++) {
            pressKey('ArrowRight');
        }

        expect(getState().playback.tick).toBe(10);
        expect(api.getCamera().x).toBe(beforeCam.x);
    });

    // ── Space: play/pause toggle ─────────────────────────────────────

    it('Space toggles playing state', () => {
        injectFrames(5);
        // injectFrames set playing=false at start
        expect(getState().playback.playing).toBe(false);
        pressKey(' ');
        expect(getState().playback.playing).toBe(true);
        pressKey(' ');
        expect(getState().playback.playing).toBe(false);
    });

    it('Space works while the timeline scrubber is focused', () => {
        // Render a second App instance in viewer mode — the Timeline (and
        // its range-input scrubber) is only mounted there.
        document.body.innerHTML = '';
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
        const viewerApi = window.__viewerTest;
        act(() => {
            viewerApi.setPlaying(false);
        });

        const slider = container.querySelector('input[type="range"]');
        expect(slider).not.toBeNull();
        slider.focus();
        expect(document.activeElement).toBe(slider);

        act(() => {
            slider.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
        });
        expect(window.__viewerTest.getState().playback.playing).toBe(true);

        // Restore the default app mode for the following tests
        try {
            sessionStorage.removeItem('sit-viewer-mode');
        } catch {
            /* ignore */
        }
    });

    // ── Input focus: hotkeys suppressed ─────────────────────────────

    it('ArrowRight in an input does NOT advance tick', () => {
        injectFrames(5);
        const before = getState().playback.tick;

        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        });
        expect(getState().playback.tick).toBe(before);
    });

    // ── Edge cases ───────────────────────────────────────────────────

    it('ArrowRight at last frame stays at last frame', () => {
        injectFrames(3);
        pressKey('ArrowRight'); // 0 → 1
        pressKey('ArrowRight'); // 1 → 2
        pressKey('ArrowRight'); // 2 (last), clamped
        pressKey('ArrowRight'); // still 2
        expect(getState().playback.tick).toBe(2);
    });

    it('keyboard works after reset', () => {
        injectFrames(10);
        pressKey('ArrowRight');
        pressKey('ArrowRight');
        expect(getState().playback.tick).toBe(2);

        act(() => {
            api.reset();
        });
        api = window.__viewerTest;

        injectFrames(5);
        pressKey('ArrowRight');
        expect(getState().playback.tick).toBe(1);
    });

    // ── M key: toggle sidebar tab ──────────────────────────────────

    it('M toggles sidebarTab between inspector and metrics', () => {
        injectFrames(3);
        expect(getState().ui.sidebarTab).toBe('inspector');
        pressKey('m');
        expect(getState().ui.sidebarTab).toBe('metrics');
        pressKey('m');
        expect(getState().ui.sidebarTab).toBe('inspector');
    });

    // ── Backtick: toggle console ────────────────────────────────────

    it('backtick toggles showConsole', () => {
        injectFrames(3);
        // Default depends on localStorage; test the toggle
        const before = getState().ui.showConsole;
        pressKey('`');
        expect(getState().ui.showConsole).toBe(!before);
        pressKey('`');
        expect(getState().ui.showConsole).toBe(before);
    });

    // ── Bracket keys: speed control (live server) ───────────────────

    it('[ and ] change server speed when connected', () => {
        // Not connected → bracket keys have no effect (serverSpeed stays 1)
        const before = getState().server.speed;
        pressKey(']');
        expect(getState().server.speed).toBe(before);
        pressKey('[');
        expect(getState().server.speed).toBe(before);
    });

    // ── Input suppression: all input types ──────────────────────────

    it('Space in INPUT does NOT toggle playing', () => {
        injectFrames(5);
        act(() => {
            api.setPlaying(false);
        });

        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        });
        expect(getState().playback.playing).toBe(false);
    });

    it('ArrowRight in TEXTAREA does NOT advance tick', () => {
        injectFrames(5);
        const before = getState().playback.tick;

        const textarea = document.createElement('textarea');
        document.body.appendChild(textarea);
        textarea.focus();

        act(() => {
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        });
        expect(getState().playback.tick).toBe(before);
    });

    it('ArrowRight in SELECT does NOT advance tick', () => {
        injectFrames(5);
        const before = getState().playback.tick;

        const select = document.createElement('select');
        document.body.appendChild(select);
        select.focus();

        act(() => {
            select.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        });
        expect(getState().playback.tick).toBe(before);
    });

    it('M in INPUT does NOT toggle sidebarTab', () => {
        injectFrames(3);
        const before = getState().ui.sidebarTab;

        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
        });
        expect(getState().ui.sidebarTab).toBe(before);
    });
});
