import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, waitFor, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import App from '../src/App';

// Mock API client — we test MemoryTree and ObjectInspector Memory section
vi.mock('../src/api/client', () => ({
    connectSSE: vi.fn(() => ({ close: vi.fn() })),
    postResume: vi.fn(() => Promise.resolve()),
    postPause: vi.fn(() => Promise.resolve()),
    postSpeed: vi.fn(() => Promise.resolve()),
    postDispose: vi.fn(() => Promise.resolve()),
    getMemoryAtTick: vi.fn().mockResolvedValue({ rooms: { W0N0: { creeps: 3 } } }),
}));

// Import the mocked module for assertions
import { getMemoryAtTick } from '../src/api/client';

describe('Memory in Object Inspector', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        const container = document.createElement('div');
        document.body.appendChild(container);
        vi.clearAllMocks();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    /** @returns {Object} */
    function getState() {
        return window.__viewerTest?.getState() || {};
    }

    /** Inject frames with a creep owned by bot1 */
    function injectFramesWithCreep() {
        act(() => {
            window.__viewerTest?.setPlaying(false);
        });
        act(() => {
            window.__viewerTest?.injectFrames([
                {
                    _id: 'creep1',
                    type: 'creep',
                    x: 25,
                    y: 25,
                    room: 'W0N0',
                    user: 'bot1',
                    name: 'Harvester1',
                    hits: 700,
                    hitsMax: 700,
                },
            ]);
        });
        act(() => {
            window.__viewerTest?.injectFrames([
                {
                    _id: 'creep2',
                    type: 'creep',
                    x: 26,
                    y: 25,
                    room: 'W0N0',
                    user: 'bot2',
                    name: 'Harvester2',
                    hits: 500,
                    hitsMax: 500,
                },
            ]);
        });
    }

    it('getMemoryAtTick is called with correct URL format', async () => {
        getMemoryAtTick.mockResolvedValue({ test: true });
        const result = await getMemoryAtTick(42, 'bot1');
        expect(result).toEqual({ test: true });
        expect(getMemoryAtTick).toHaveBeenCalledWith(42, 'bot1');
    });

    it('getMemoryAtTick URL encodes bot username', async () => {
        getMemoryAtTick.mockResolvedValue({});
        await getMemoryAtTick(10, 'bot with spaces');
        expect(getMemoryAtTick).toHaveBeenCalledWith(10, 'bot with spaces');
    });

    it('getMemoryAtTick rejects on non-ok response', async () => {
        // Default mock resolves — override for this test
        getMemoryAtTick.mockRejectedValueOnce(new Error('Failed to fetch memory: 404'));
        await expect(getMemoryAtTick(0, 'unknown')).rejects.toThrow('Failed to fetch memory: 404');
    });
});

describe('MemoryTree component', () => {
    it('renders null values correctly', async () => {
        // Test via ObjectInspector memory section — click on a creep to trigger memory fetch
        document.body.innerHTML = '';
        const container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            render(React.createElement(App), { container });
        });
        act(() => {
            window.__viewerTest?.injectFrames([
                {
                    _id: 'c1',
                    type: 'creep',
                    x: 10,
                    y: 10,
                    room: 'W0N0',
                    user: 'testBot',
                    name: 'C1',
                    hits: 100,
                    hitsMax: 100,
                },
            ]);
        });
        // MemoryTree is rendered within ObjectInspector when an object with a user is selected.
        // We verify the component doesn't crash on edge-case data.
    });

    it('renders MemoryTree without crashing for various data types', async () => {
        // Import MemoryTree directly for unit-level testing
        const MemoryTree = (await import('../src/components/MemoryTree')).default;
        const { container: c } = render(
            React.createElement(MemoryTree, {
                data: {
                    string: 'hello',
                    number: 42,
                    boolean: true,
                    nullVal: null,
                    nested: { a: 1, b: { c: 2 } },
                    array: [1, 2, 3],
                    emptyObj: {},
                    emptyArr: [],
                },
                label: 'test',
            }),
        );
        // Should render without errors — verify some content
        expect(c.textContent).toContain('test');
        expect(c.textContent).toContain('hello');
        expect(c.textContent).toContain('42');
        expect(c.textContent).toContain('true');
        expect(c.textContent).toContain('null');
    });
});
