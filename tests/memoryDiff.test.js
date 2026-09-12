'use strict';

/**
 * Unit tests for memoryDiff.js — JSON Patch computation and application
 * for bot Memory snapshots.
 *
 * Cover:
 * - Empty diff when Memory unchanged
 * - Add new key (nested)
 * - Replace existing value
 * - Remove key
 * - Array changes (add/remove/replace elements)
 * - Type change (string → object)
 * - Apply produces identical result to raw after
 * - Multiple sequential diffs reconstruct correctly
 * - First-tick (before undefined) produces single replace at root
 */

const { computeMemoryDiff, applyMemoryDiff } = require('../src/tools/viewer/memoryDiff');

describe('computeMemoryDiff', () => {
    it('returns empty array when Memory is unchanged', () => {
        const mem = { a: 1, b: 'hello', c: { d: 2 } };
        const diff = computeMemoryDiff(mem, mem);
        expect(diff).toEqual([]);
    });

    it('returns empty array for identical nested objects', () => {
        const mem = { rooms: { W1N1: { creeps: 3 } } };
        const diff = computeMemoryDiff(mem, { ...mem });
        expect(diff).toEqual([]);
    });

    it('detects added key at root level', () => {
        const before = { a: 1 };
        const after = { a: 1, b: 2 };
        const diff = computeMemoryDiff(before, after);
        expect(diff).toContainEqual({ op: 'add', path: '/b', value: 2 });
    });

    it('detects removed key at root level', () => {
        const before = { a: 1, b: 2 };
        const after = { a: 1 };
        const diff = computeMemoryDiff(before, after);
        expect(diff).toContainEqual({ op: 'remove', path: '/b' });
    });

    it('detects replaced value at root level', () => {
        const before = { a: 1 };
        const after = { a: 42 };
        const diff = computeMemoryDiff(before, after);
        expect(diff).toContainEqual({ op: 'replace', path: '/a', value: 42 });
    });

    it('detects nested add', () => {
        const before = { data: { x: 1 } };
        const after = { data: { x: 1, y: 2 } };
        const diff = computeMemoryDiff(before, after);
        expect(diff).toContainEqual({ op: 'add', path: '/data/y', value: 2 });
    });

    it('detects nested remove', () => {
        const before = { data: { x: 1, y: 2 } };
        const after = { data: { x: 1 } };
        const diff = computeMemoryDiff(before, after);
        expect(diff).toContainEqual({ op: 'remove', path: '/data/y' });
    });

    it('detects nested replace', () => {
        const before = { data: { x: 1 } };
        const after = { data: { x: 99 } };
        const diff = computeMemoryDiff(before, after);
        expect(diff).toContainEqual({ op: 'replace', path: '/data/x', value: 99 });
    });

    it('detects type change (string → object)', () => {
        const before = { val: 'hello' };
        const after = { val: { nested: true } };
        const diff = computeMemoryDiff(before, after);
        expect(diff).toContainEqual({ op: 'replace', path: '/val', value: { nested: true } });
    });

    it('detects type change (number → null)', () => {
        const before = { val: 42 };
        const after = { val: null };
        const diff = computeMemoryDiff(before, after);
        expect(diff).toContainEqual({ op: 'replace', path: '/val', value: null });
    });

    it('detects null → object change', () => {
        const before = { val: null };
        const after = { val: { a: 1 } };
        const diff = computeMemoryDiff(before, after);
        expect(diff).toContainEqual({ op: 'replace', path: '/val', value: { a: 1 } });
    });

    it('handles array element addition', () => {
        const before = { arr: [1, 2] };
        const after = { arr: [1, 2, 3] };
        const diff = computeMemoryDiff(before, after);
        expect(diff).toContainEqual({ op: 'add', path: '/arr/2', value: 3 });
    });

    it('handles array element removal from end', () => {
        const before = { arr: [1, 2, 3] };
        const after = { arr: [1, 2] };
        const diff = computeMemoryDiff(before, after);
        expect(diff).toContainEqual({ op: 'remove', path: '/arr/2' });
    });

    it('handles array element replacement', () => {
        const before = { arr: [1, 2, 3] };
        const after = { arr: [1, 99, 3] };
        const diff = computeMemoryDiff(before, after);
        expect(diff).toContainEqual({ op: 'replace', path: '/arr/1', value: 99 });
    });

    it('handles first tick (before undefined) — replace at root', () => {
        const after = { rooms: { W1N1: {} } };
        const diff = computeMemoryDiff(undefined, after);
        expect(diff).toEqual([{ op: 'replace', path: '', value: after }]);
    });

    it('generates minimal diff for large unchanged Memory', () => {
        const mem = {
            rooms: { W1N1: { creeps: 5, structures: 20 } },
            stats: { gcl: 1000000, cpu: 50 },
            tasks: [{ id: 't1', status: 'done' }],
        };
        const diff = computeMemoryDiff(mem, mem);
        expect(diff).toEqual([]);
    });

    it('handles escaped characters in keys (slashes and tildes)', () => {
        const before = { 'a/b': 1 };
        const after = { 'a/b': 2 };
        const diff = computeMemoryDiff(before, after);
        // Path should escape '/' as '~1'
        expect(diff).toContainEqual({ op: 'replace', path: '/a~1b', value: 2 });
    });
});

describe('applyMemoryDiff', () => {
    it('returns cloned base when deltas are empty', () => {
        const base = { a: 1, b: { c: 2 } };
        const result = applyMemoryDiff(base, []);
        expect(result).toEqual(base);
        expect(result).not.toBe(base); // deep clone
    });

    it('applies a single add operation', () => {
        const base = { a: 1 };
        const deltas = [{ op: 'add', path: '/b', value: 2 }];
        const result = applyMemoryDiff(base, deltas);
        expect(result).toEqual({ a: 1, b: 2 });
    });

    it('applies a single remove operation', () => {
        const base = { a: 1, b: 2 };
        const deltas = [{ op: 'remove', path: '/b' }];
        const result = applyMemoryDiff(base, deltas);
        expect(result).toEqual({ a: 1 });
    });

    it('applies a single replace operation', () => {
        const base = { a: 1 };
        const deltas = [{ op: 'replace', path: '/a', value: 99 }];
        const result = applyMemoryDiff(base, deltas);
        expect(result).toEqual({ a: 99 });
    });

    it('applies nested add', () => {
        const base = { data: { x: 1 } };
        const deltas = [{ op: 'add', path: '/data/y', value: 2 }];
        const result = applyMemoryDiff(base, deltas);
        expect(result).toEqual({ data: { x: 1, y: 2 } });
    });

    it('applies nested replace', () => {
        const base = { data: { x: 1 } };
        const deltas = [{ op: 'replace', path: '/data/x', value: 99 }];
        const result = applyMemoryDiff(base, deltas);
        expect(result).toEqual({ data: { x: 99 } });
    });

    it('applies array add', () => {
        const base = { arr: [1, 2] };
        const deltas = [{ op: 'add', path: '/arr/2', value: 3 }];
        const result = applyMemoryDiff(base, deltas);
        expect(result).toEqual({ arr: [1, 2, 3] });
    });

    it('applies array remove', () => {
        const base = { arr: [1, 2, 3] };
        const deltas = [{ op: 'remove', path: '/arr/1' }];
        const result = applyMemoryDiff(base, deltas);
        expect(result).toEqual({ arr: [1, 3] });
    });

    it('applies array replace', () => {
        const base = { arr: [1, 2, 3] };
        const deltas = [{ op: 'replace', path: '/arr/1', value: 99 }];
        const result = applyMemoryDiff(base, deltas);
        expect(result).toEqual({ arr: [1, 99, 3] });
    });

    it('applies root replace (first tick)', () => {
        const base = {};
        const deltas = [{ op: 'replace', path: '', value: { rooms: { W1N1: {} } } }];
        const result = applyMemoryDiff(base, deltas);
        expect(result).toEqual({ rooms: { W1N1: {} } });
    });

    it('does not mutate the base object', () => {
        const base = { a: 1 };
        const deltas = [{ op: 'replace', path: '/a', value: 99 }];
        applyMemoryDiff(base, deltas);
        expect(base.a).toBe(1);
    });

    it('reconstructs Memory after multiple sequential diffs', () => {
        const tick0 = { rooms: { W1N1: { creeps: 0 } } };
        const tick1 = { rooms: { W1N1: { creeps: 1 } } };
        const tick2 = { rooms: { W1N1: { creeps: 2 }, tasks: [] } };
        const tick3 = { rooms: { W1N1: { creeps: 3 }, tasks: ['harvest'] } };

        const diff1 = computeMemoryDiff(tick0, tick1);
        const diff2 = computeMemoryDiff(tick1, tick2);
        const diff3 = computeMemoryDiff(tick2, tick3);

        let reconstructed = applyMemoryDiff(tick0, diff1);
        expect(reconstructed).toEqual(tick1);

        reconstructed = applyMemoryDiff(reconstructed, diff2);
        expect(reconstructed).toEqual(tick2);

        reconstructed = applyMemoryDiff(reconstructed, diff3);
        expect(reconstructed).toEqual(tick3);
    });

    it('round-trip: diff then apply produces identical result', () => {
        const before = {
            rooms: { W1N1: { creeps: 3, structures: { spawn: 1, extension: 5 } } },
            stats: { gcl: 100000, cpu: 50 },
            tasks: [
                { id: 't1', status: 'pending' },
                { id: 't2', status: 'done' },
            ],
        };
        const after = {
            rooms: { W1N1: { creeps: 4, structures: { spawn: 1, extension: 6 } } },
            stats: { gcl: 100100, cpu: 48 },
            tasks: [
                { id: 't1', status: 'done' },
                { id: 't2', status: 'done' },
            ],
        };

        const diff = computeMemoryDiff(before, after);
        const reconstructed = applyMemoryDiff(before, diff);
        expect(reconstructed).toEqual(after);
    });

    it('handles escaped slashes in paths', () => {
        const base = { 'a/b': 1 };
        const deltas = [{ op: 'replace', path: '/a~1b', value: 2 }];
        const result = applyMemoryDiff(base, deltas);
        expect(result).toEqual({ 'a/b': 2 });
    });
});
