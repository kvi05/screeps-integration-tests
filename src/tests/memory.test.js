'use strict';

const {
    deepMergeMemory,
    resolveMemorySource,
    normalizePerBotMemoryOption,
    resolveInitialMemoryByBot,
} = require('../lib/builders/memory');

describe('memory builders', () => {
    describe('deepMergeMemory', () => {
        it('сливает два простых объекта', () => {
            const result = deepMergeMemory({ a: 1 }, { b: 2 });
            expect(result).toEqual({ a: 1, b: 2 });
        });

        it('не мутирует исходный объект', () => {
            const a = { a: 1 };
            const b = { b: 2 };
            const result = deepMergeMemory(a, b);
            expect(a).toEqual({ a: 1 });
            expect(result).not.toBe(a);
        });

        it('рекурсивно сливает вложенные объекты', () => {
            const result = deepMergeMemory({ outer: { a: 1 } }, { outer: { b: 2 } });
            expect(result).toEqual({ outer: { a: 1, b: 2 } });
        });

        it('заменяет массивы, а не сливает', () => {
            const result = deepMergeMemory({ arr: [1, 2] }, { arr: [3] });
            expect(result.arr).toEqual([3]);
        });

        it('заменяет примитивы новыми значениями', () => {
            const result = deepMergeMemory({ key: 'old' }, { key: 'new' });
            expect(result.key).toBe('new');
        });

        it('игнорирует undefined в patch', () => {
            const result = deepMergeMemory({ key: 'value' }, { key: undefined, other: 1 });
            expect(result).toEqual({ key: 'value', other: 1 });
        });

        it('обрабатывает несколько источников с приоритетом последнего', () => {
            const result = deepMergeMemory({ a: 1, b: 1 }, { b: 2, c: 2 }, { c: 3 });
            expect(result).toEqual({ a: 1, b: 2, c: 3 });
        });

        it('пропускает nullish источники', () => {
            const result = deepMergeMemory({ a: 1 }, null, undefined, { b: 2 });
            expect(result).toEqual({ a: 1, b: 2 });
        });

        it('глубокий merge трёх уровней', () => {
            const result = deepMergeMemory({ l1: { l2: { a: 1 } } }, { l1: { l2: { b: 2 }, l2b: { c: 3 } } });
            expect(result).toEqual({ l1: { l2: { a: 1, b: 2 }, l2b: { c: 3 } } });
        });

        it('null в patch заменяет поле', () => {
            const result = deepMergeMemory({ key: { nested: 1 } }, { key: null });
            expect(result.key).toBeNull();
        });
    });

    describe('resolveMemorySource', () => {
        it('возвращает null для undefined', () => {
            expect(resolveMemorySource(undefined, 'test')).toBeNull();
        });

        it('возвращает null для null', () => {
            expect(resolveMemorySource(null, 'test')).toBeNull();
        });

        it('возвращает inline-объект как есть', () => {
            const obj = { custom: true };
            expect(resolveMemorySource(obj, 'test')).toBe(obj);
        });

        it('бросает для массива', () => {
            expect(() => resolveMemorySource([], 'test')).toThrow(/ожидается fixture name или object/);
        });

        it('бросает для числа', () => {
            expect(() => resolveMemorySource(42, 'test')).toThrow(/ожидается fixture name или object/);
        });
    });

    describe('normalizePerBotMemoryOption', () => {
        const singleBot = ['bot'];
        const multiBot = ['bot1', 'bot2'];

        it('возвращает {} для undefined', () => {
            expect(normalizePerBotMemoryOption('memory', undefined, singleBot)).toEqual({});
        });

        it('возвращает {} для null', () => {
            expect(normalizePerBotMemoryOption('memory', null, singleBot)).toEqual({});
        });

        it('shorthand: для single-bot оборачивает значение в { name: value }', () => {
            const result = normalizePerBotMemoryOption('memory', 'fixtureName', singleBot);
            expect(result).toEqual({ bot: 'fixtureName' });
        });

        it('shorthand: для single-bot с object', () => {
            const obj = { rooms: { W0N1: {} } };
            const result = normalizePerBotMemoryOption('memory', obj, singleBot);
            expect(result).toEqual({ bot: obj });
        });

        it('map: для multi-bot возвращает как есть', () => {
            const map = { bot1: 'fix1', bot2: 'fix2' };
            const result = normalizePerBotMemoryOption('memory', map, multiBot);
            expect(result).toEqual(map);
        });

        it('бросает для multi-bot если значение не map', () => {
            expect(() => normalizePerBotMemoryOption('memory', 'fix', multiBot)).toThrow(/multi-bot/);
        });

        it('бросает при пустом списке ботов', () => {
            expect(() => normalizePerBotMemoryOption('memory', { test: true }, [])).toThrow(/без bots/);
        });
    });

    describe('resolveInitialMemoryByBot', () => {
        it('возвращает пустой объект если нет memory', () => {
            const result = resolveInitialMemoryByBot(['bot'], undefined, undefined);
            expect(result).toEqual({});
        });

        it('возвращает пустой объект если memory пустой объект', () => {
            const result = resolveInitialMemoryByBot(['bot'], {}, {});
            expect(result).toEqual({});
        });

        it('возвращает пустой объект если memory содержал только пустой объект', () => {
            const result = resolveInitialMemoryByBot(['bot'], { bot: {} }, {});
            expect(result).toEqual({});
        });

        it('возвращает {} для бота без memory', () => {
            const result = resolveInitialMemoryByBot(['bot1', 'bot2'], { bot1: { mem: 'x' } }, undefined);
            expect(result).toEqual({ bot1: { mem: 'x' } });
        });

        it('возвращает {} для бота если memory resolved to {}', () => {
            // memory = {} but override has stuff
            const result = resolveInitialMemoryByBot(['bot'], { bot: {} }, { bot: { key: 'val' } });
            expect(result).toEqual({ bot: { key: 'val' } });
        });

        it('сливает memory и memoryOverrides deep', () => {
            const result = resolveInitialMemoryByBot(
                ['bot'],
                { bot: { base: 1, nested: { a: 1 } } },
                { bot: { over: 2, nested: { b: 2 } } },
            );
            expect(result).toEqual({ bot: { base: 1, over: 2, nested: { a: 1, b: 2 } } });
        });

        it('overrides заменяет примитивы', () => {
            const result = resolveInitialMemoryByBot(['bot'], { bot: { key: 'old' } }, { bot: { key: 'new' } });
            expect(result).toEqual({ bot: { key: 'new' } });
        });
    });
});
