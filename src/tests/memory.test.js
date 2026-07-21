'use strict';

const {
    deepMergeMemory,
    resolveMemorySource,
    normalizePerBotMemoryOption,
    resolveInitialMemoryByBot,
} = require('../lib/builders/memory');

describe('memory builders', () => {
    describe('deepMergeMemory', () => {
        it('merges two simple objects', () => {
            const result = deepMergeMemory({ a: 1 }, { b: 2 });
            expect(result).toEqual({ a: 1, b: 2 });
        });

        it('does not mutate the source object', () => {
            const a = { a: 1 };
            const b = { b: 2 };
            const result = deepMergeMemory(a, b);
            expect(a).toEqual({ a: 1 });
            expect(result).not.toBe(a);
        });

        it('recursively merges nested objects', () => {
            const result = deepMergeMemory({ outer: { a: 1 } }, { outer: { b: 2 } });
            expect(result).toEqual({ outer: { a: 1, b: 2 } });
        });

        it('replaces arrays, does not merge', () => {
            const result = deepMergeMemory({ arr: [1, 2] }, { arr: [3] });
            expect(result.arr).toEqual([3]);
        });

        it('replaces primitives with new values', () => {
            const result = deepMergeMemory({ key: 'old' }, { key: 'new' });
            expect(result.key).toBe('new');
        });

        it('ignores undefined in patch', () => {
            const result = deepMergeMemory({ key: 'value' }, { key: undefined, other: 1 });
            expect(result).toEqual({ key: 'value', other: 1 });
        });

        it('handles multiple sources with last having priority', () => {
            const result = deepMergeMemory({ a: 1, b: 1 }, { b: 2, c: 2 }, { c: 3 });
            expect(result).toEqual({ a: 1, b: 2, c: 3 });
        });

        it('skips nullish sources', () => {
            const result = deepMergeMemory({ a: 1 }, null, undefined, { b: 2 });
            expect(result).toEqual({ a: 1, b: 2 });
        });

        it('deep merge of three levels', () => {
            const result = deepMergeMemory({ l1: { l2: { a: 1 } } }, { l1: { l2: { b: 2 }, l2b: { c: 3 } } });
            expect(result).toEqual({ l1: { l2: { a: 1, b: 2 }, l2b: { c: 3 } } });
        });

        it('null in patch replaces the field', () => {
            const result = deepMergeMemory({ key: { nested: 1 } }, { key: null });
            expect(result.key).toBeNull();
        });
    });

    describe('resolveMemorySource', () => {
        it('returns null for undefined', () => {
            expect(resolveMemorySource(undefined, 'test')).toBeNull();
        });

        it('returns null for null', () => {
            expect(resolveMemorySource(null, 'test')).toBeNull();
        });

        it('returns inline object as-is', () => {
            const obj = { custom: true };
            expect(resolveMemorySource(obj, 'test')).toBe(obj);
        });

        it('throws for array', () => {
            expect(() => resolveMemorySource([], 'test')).toThrow(/expected fixture name or object/);
        });

        it('throws for number', () => {
            expect(() => resolveMemorySource(42, 'test')).toThrow(/expected fixture name or object/);
        });
    });

    describe('normalizePerBotMemoryOption', () => {
        const singleBot = ['bot'];
        const multiBot = ['bot1', 'bot2'];

        it('returns {} for undefined', () => {
            expect(normalizePerBotMemoryOption('memory', undefined, singleBot)).toEqual({});
        });

        it('returns {} for null', () => {
            expect(normalizePerBotMemoryOption('memory', null, singleBot)).toEqual({});
        });

        it('shorthand: for single-bot wraps value in { name: value }', () => {
            const result = normalizePerBotMemoryOption('memory', 'fixtureName', singleBot);
            expect(result).toEqual({ bot: 'fixtureName' });
        });

        it('shorthand: for single-bot with object', () => {
            const obj = { rooms: { W0N1: {} } };
            const result = normalizePerBotMemoryOption('memory', obj, singleBot);
            expect(result).toEqual({ bot: obj });
        });

        it('map: for multi-bot returns as-is', () => {
            const map = { bot1: 'fix1', bot2: 'fix2' };
            const result = normalizePerBotMemoryOption('memory', map, multiBot);
            expect(result).toEqual(map);
        });

        it('throws for multi-bot if value is not a map', () => {
            expect(() => normalizePerBotMemoryOption('memory', 'fix', multiBot)).toThrow(/multi-bot/);
        });

        it('throws with empty bot list', () => {
            expect(() => normalizePerBotMemoryOption('memory', { test: true }, [])).toThrow(
                /cannot be set without bots/,
            );
        });
    });

    describe('resolveInitialMemoryByBot', () => {
        it('returns empty object if no memory', () => {
            const result = resolveInitialMemoryByBot(['bot'], undefined, undefined);
            expect(result).toEqual({});
        });

        it('returns empty object if memory is empty object', () => {
            const result = resolveInitialMemoryByBot(['bot'], {}, {});
            expect(result).toEqual({});
        });

        it('returns empty object if memory only contained empty object', () => {
            const result = resolveInitialMemoryByBot(['bot'], { bot: {} }, {});
            expect(result).toEqual({});
        });

        it('returns {} for bot without memory', () => {
            const result = resolveInitialMemoryByBot(['bot1', 'bot2'], { bot1: { mem: 'x' } }, undefined);
            expect(result).toEqual({ bot1: { mem: 'x' } });
        });

        it('returns {} for bot if memory resolved to {}', () => {
            // memory = {} but override has stuff
            const result = resolveInitialMemoryByBot(['bot'], { bot: {} }, { bot: { key: 'val' } });
            expect(result).toEqual({ bot: { key: 'val' } });
        });

        it('merges memory and memoryOverrides deep', () => {
            const result = resolveInitialMemoryByBot(
                ['bot'],
                { bot: { base: 1, nested: { a: 1 } } },
                { bot: { over: 2, nested: { b: 2 } } },
            );
            expect(result).toEqual({ bot: { base: 1, over: 2, nested: { a: 1, b: 2 } } });
        });

        it('overrides replace primitives', () => {
            const result = resolveInitialMemoryByBot(['bot'], { bot: { key: 'old' } }, { bot: { key: 'new' } });
            expect(result).toEqual({ bot: { key: 'new' } });
        });
    });
});
