import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import App from '../src/App';

// Mock SSE client — App tries to connect on mount, we prevent that.
vi.mock('../src/api/client', () => ({
    connectSSE: vi.fn(() => ({
        close: vi.fn(),
    })),
}));

describe('keyboard shortcuts', () => {
    /** @type {Object} */
    let api;

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
        expect(api.getState().tick).toBe(0);
        pressKey('ArrowRight');
        expect(api.getState().tick).toBe(1);
    });

    it('ArrowLeft decrements tick by 1', () => {
        injectFrames(5);
        pressKey('ArrowRight');
        pressKey('ArrowRight');
        pressKey('ArrowRight');
        expect(api.getState().tick).toBe(3);
        pressKey('ArrowLeft');
        expect(api.getState().tick).toBe(2);
    });

    it('ArrowLeft at tick 0 stays at 0', () => {
        injectFrames(5);
        expect(api.getState().tick).toBe(0);
        pressKey('ArrowLeft');
        expect(api.getState().tick).toBe(0);
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

        expect(api.getState().tick).toBe(10);
        expect(api.getCamera().x).toBe(beforeCam.x);
    });

    // ── Space: play/pause toggle ─────────────────────────────────────

    it('Space toggles playing state', () => {
        injectFrames(5);
        // injectFrames set playing=false at start
        expect(api.getState().playing).toBe(false);
        pressKey(' ');
        expect(api.getState().playing).toBe(true);
        pressKey(' ');
        expect(api.getState().playing).toBe(false);
    });

    // ── Input focus: hotkeys suppressed ─────────────────────────────

    it('ArrowRight in an input does NOT advance tick', () => {
        injectFrames(5);
        const before = api.getState().tick;

        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        });
        expect(api.getState().tick).toBe(before);
    });

    // ── Edge cases ───────────────────────────────────────────────────

    it('ArrowRight at last frame stays at last frame', () => {
        injectFrames(3);
        pressKey('ArrowRight'); // 0 → 1
        pressKey('ArrowRight'); // 1 → 2
        pressKey('ArrowRight'); // 2 (last), clamped
        pressKey('ArrowRight'); // still 2
        expect(api.getState().tick).toBe(2);
    });

    it('keyboard works after reset', () => {
        injectFrames(10);
        pressKey('ArrowRight');
        pressKey('ArrowRight');
        expect(api.getState().tick).toBe(2);

        act(() => {
            api.reset();
        });
        api = window.__viewerTest;

        injectFrames(5);
        pressKey('ArrowRight');
        expect(api.getState().tick).toBe(1);
    });
});
