'use strict';

/**
 * Unit tests for memoryHistory.js — ring buffer for per-tick bot Memory.
 *
 * Cover:
 * - Push keyframe → reconstruct returns it
 * - Push keyframe + deltas → reconstruct applies deltas
 * - Ring buffer eviction (push > maxTicks → oldest evicted)
 * - reconstruct returns null for unknown tick
 * - reconstruct returns null for unknown bot
 * - Multiple bots tracked independently
 * - Keyframe interval: deltas between keyframes reconstruct correctly
 * - clear() empties the buffer
 * - size() returns correct count
 */

const { createMemoryHistory } = require('../src/tools/viewer/memoryHistory');
const { computeMemoryDiff } = require('../src/tools/viewer/memoryDiff');

describe('createMemoryHistory', () => {
    it('push keyframe → reconstruct returns it', () => {
        const history = createMemoryHistory({ maxTicks: 100, keyframeInterval: 10 });
        const mem = { rooms: { W1N1: { creeps: 3 } } };

        history.push({ tick: 0, bots: { bot1: { type: 'keyframe', data: mem } } });

        const result = history.reconstruct(0, 'bot1');
        expect(result).toEqual(mem);
        expect(result).not.toBe(mem); // deep clone
    });

    it('push keyframe + deltas → reconstruct applies deltas', () => {
        const history = createMemoryHistory({ maxTicks: 100, keyframeInterval: 10 });

        // Tick 0: keyframe
        history.push({ tick: 0, bots: { bot1: { type: 'keyframe', data: { a: 1 } } } });

        // Tick 1: delta (add key)
        history.push({
            tick: 1,
            bots: { bot1: { type: 'delta', data: [{ op: 'add', path: '/b', value: 2 }] } },
        });

        // Tick 2: delta (replace key)
        history.push({
            tick: 2,
            bots: { bot1: { type: 'delta', data: [{ op: 'replace', path: '/a', value: 99 }] } },
        });

        expect(history.reconstruct(0, 'bot1')).toEqual({ a: 1 });
        expect(history.reconstruct(1, 'bot1')).toEqual({ a: 1, b: 2 });
        expect(history.reconstruct(2, 'bot1')).toEqual({ a: 99, b: 2 });
    });

    it('reconstruct returns keyframe directly when target is keyframe', () => {
        const history = createMemoryHistory({ maxTicks: 100, keyframeInterval: 10 });

        // Tick 0: keyframe
        history.push({ tick: 0, bots: { bot1: { type: 'keyframe', data: { x: 1 } } } });
        // Tick 1: delta
        history.push({
            tick: 1,
            bots: { bot1: { type: 'delta', data: [{ op: 'replace', path: '/x', value: 2 }] } },
        });
        // Tick 10: keyframe
        history.push({ tick: 10, bots: { bot1: { type: 'keyframe', data: { x: 100 } } } });

        // Tick 10 is a keyframe — should return directly
        const result = history.reconstruct(10, 'bot1');
        expect(result).toEqual({ x: 100 });
    });

    it('reconstruct returns null for unknown tick', () => {
        const history = createMemoryHistory();
        history.push({ tick: 0, bots: { bot1: { type: 'keyframe', data: {} } } });
        expect(history.reconstruct(999, 'bot1')).toBeNull();
    });

    it('reconstruct returns null for unknown bot', () => {
        const history = createMemoryHistory();
        history.push({ tick: 0, bots: { bot1: { type: 'keyframe', data: {} } } });
        expect(history.reconstruct(0, 'bot2')).toBeNull();
    });

    it('reconstruct returns null when tick has no keyframe and no prior keyframe', () => {
        const history = createMemoryHistory();
        // Delta at tick 1 without a prior keyframe
        history.push({
            tick: 1,
            bots: { bot1: { type: 'delta', data: [{ op: 'add', path: '/x', value: 1 }] } },
        });
        expect(history.reconstruct(1, 'bot1')).toBeNull();
    });

    it('multiple bots tracked independently', () => {
        const history = createMemoryHistory({ maxTicks: 100, keyframeInterval: 10 });

        // Tick 0: keyframes for both bots
        history.push({
            tick: 0,
            bots: {
                bot1: { type: 'keyframe', data: { name: 'bot1' } },
                bot2: { type: 'keyframe', data: { name: 'bot2' } },
            },
        });

        // Tick 1: deltas for bot1 only
        history.push({
            tick: 1,
            bots: {
                bot1: { type: 'delta', data: [{ op: 'replace', path: '/name', value: 'bot1-updated' }] },
            },
        });

        // Tick 2: deltas for bot2 only
        history.push({
            tick: 2,
            bots: {
                bot2: { type: 'delta', data: [{ op: 'replace', path: '/name', value: 'bot2-updated' }] },
            },
        });

        expect(history.reconstruct(0, 'bot1')).toEqual({ name: 'bot1' });
        expect(history.reconstruct(1, 'bot1')).toEqual({ name: 'bot1-updated' });
        expect(history.reconstruct(2, 'bot1')).toEqual({ name: 'bot1-updated' }); // unchanged from tick1

        expect(history.reconstruct(0, 'bot2')).toEqual({ name: 'bot2' });
        expect(history.reconstruct(1, 'bot2')).toEqual({ name: 'bot2' }); // no delta at tick1
        expect(history.reconstruct(2, 'bot2')).toEqual({ name: 'bot2-updated' });
    });

    it('ring buffer eviction: oldest entries removed when over capacity', () => {
        const history = createMemoryHistory({ maxTicks: 5, keyframeInterval: 3 });

        // Push 7 ticks
        for (let i = 0; i < 7; i++) {
            history.push({ tick: i, bots: { bot1: { type: 'keyframe', data: { tick: i } } } });
        }

        // Buffer should contain only ticks 2-6 (5 entries)
        expect(history.size()).toBe(5);

        // Oldest ticks (0, 1) should be evicted
        expect(history.reconstruct(0, 'bot1')).toBeNull();
        expect(history.reconstruct(1, 'bot1')).toBeNull();
        expect(history.reconstruct(2, 'bot1')).toEqual({ tick: 2 });
        expect(history.reconstruct(6, 'bot1')).toEqual({ tick: 6 });
    });

    it('reconstruct works across keyframe boundaries with deltas', () => {
        const history = createMemoryHistory({ maxTicks: 100, keyframeInterval: 5 });

        // Ticks 0-4: keyframe at 0, deltas at 1,2,3,4
        history.push({ tick: 0, bots: { bot1: { type: 'keyframe', data: { v: 0 } } } });
        history.push({ tick: 1, bots: { bot1: { type: 'delta', data: [{ op: 'replace', path: '/v', value: 1 }] } } });
        history.push({ tick: 2, bots: { bot1: { type: 'delta', data: [{ op: 'replace', path: '/v', value: 2 }] } } });
        history.push({ tick: 3, bots: { bot1: { type: 'delta', data: [{ op: 'replace', path: '/v', value: 3 }] } } });
        history.push({ tick: 4, bots: { bot1: { type: 'delta', data: [{ op: 'replace', path: '/v', value: 4 }] } } });

        // Tick 5: new keyframe
        history.push({ tick: 5, bots: { bot1: { type: 'keyframe', data: { v: 100 } } } });

        // Tick 6-7: deltas from keyframe at 5
        history.push({ tick: 6, bots: { bot1: { type: 'delta', data: [{ op: 'replace', path: '/v', value: 101 }] } } });
        history.push({ tick: 7, bots: { bot1: { type: 'delta', data: [{ op: 'replace', path: '/v', value: 102 }] } } });

        // Reconstruct at various points
        expect(history.reconstruct(0, 'bot1')).toEqual({ v: 0 });
        expect(history.reconstruct(3, 'bot1')).toEqual({ v: 3 });
        expect(history.reconstruct(5, 'bot1')).toEqual({ v: 100 });
        expect(history.reconstruct(7, 'bot1')).toEqual({ v: 102 });
    });

    it('clear() empties the buffer', () => {
        const history = createMemoryHistory();
        history.push({ tick: 0, bots: { bot1: { type: 'keyframe', data: { a: 1 } } } });
        expect(history.size()).toBe(1);

        history.clear();
        expect(history.size()).toBe(0);
        expect(history.reconstruct(0, 'bot1')).toBeNull();
    });

    it('size() returns correct count', () => {
        const history = createMemoryHistory({ maxTicks: 100 });
        expect(history.size()).toBe(0);

        history.push({ tick: 0, bots: {} });
        expect(history.size()).toBe(1);

        history.push({ tick: 1, bots: {} });
        history.push({ tick: 2, bots: {} });
        expect(history.size()).toBe(3);
    });

    it('handles large realistic Memory objects', () => {
        const history = createMemoryHistory({ maxTicks: 50, keyframeInterval: 10 });

        // Create a realistic bot Memory
        const mem = {
            rooms: {},
            creeps: {},
            stats: { gcl: 1000000, gclLevel: 5, cpu: 50, bucket: 10000 },
            tasks: [],
        };
        for (let i = 0; i < 5; i++) {
            const roomName = `W${i}N${i}`;
            mem.rooms[roomName] = {
                sources: [{ id: `src${i}`, pos: { x: 10, y: 10 } }],
                controller: { level: i + 1, progress: 50000 },
                structures: { spawn: 1, extension: 5 * (i + 1) },
            };
            mem.creeps[`harvester${i}`] = {
                role: 'harvester',
                room: roomName,
                body: ['WORK', 'WORK', 'MOVE', 'MOVE'],
                pos: { x: i * 5, y: i * 3 },
            };
        }
        mem.tasks = Array.from({ length: 10 }, (_, j) => ({ id: `t${j}`, status: 'pending', room: 'W0N0' }));

        // Push keyframe
        history.push({ tick: 0, bots: { bot1: { type: 'keyframe', data: mem } } });
        expect(history.reconstruct(0, 'bot1')).toEqual(mem);

        // Modify and push delta
        const modified = JSON.parse(JSON.stringify(mem));
        modified.stats.cpu = 55;
        modified.tasks[0].status = 'done';
        modified.creeps.harvester0.pos = { x: 6, y: 4 };

        // Compute and push delta
        const diff = computeMemoryDiff(mem, modified);
        history.push({ tick: 1, bots: { bot1: { type: 'delta', data: diff } } });

        const reconstructed = history.reconstruct(1, 'bot1');
        expect(reconstructed).toEqual(modified);
    });
});
