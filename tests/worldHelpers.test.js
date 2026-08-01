'use strict';

const { EventEmitter } = require('events');

const { createWorldHelpers } = require('../src/lib/orchestration/worldHelpers');

// Mock materialize to avoid touching the real DB.
jest.mock('../src/lib/builders/materialize', () => ({
    materializeStructure: jest.fn(() => Promise.resolve('mocked_structure_id')),
    materializeCreep: jest.fn(() => Promise.resolve('mocked_creep_id')),
}));

jest.mock('../src/lib/observers/eventLog', () => ({
    readEventLog: jest.fn(),
}));

jest.mock('../src/lib/builders/memory', () => ({
    getBotMemory: jest.fn(),
    setBotMemory: jest.fn(),
    deepMergeMemory: jest.fn(),
}));

// ─── Fake DB collection ──────────────────────────────────────────────────────

function matches(doc, query) {
    for (const key of Object.keys(query)) {
        if (doc[key] !== query[key]) return false;
    }
    return true;
}

function createFakeCollection(docs) {
    const state = docs.map((d) => ({ ...d }));
    return {
        find(query) {
            return Promise.resolve(state.filter((d) => matches(d, query)));
        },
        findOne(query) {
            return Promise.resolve(state.find((d) => matches(d, query)) || null);
        },
        update(query, updateObj) {
            const { $set } = updateObj;
            const target = state.find((d) => matches(d, query));
            if (target) Object.assign(target, $set);
            return Promise.resolve();
        },
        removeWhere(query) {
            const idx = state.findIndex((d) => matches(d, query));
            if (idx >= 0) state.splice(idx, 1);
            return Promise.resolve();
        },
        insert(doc) {
            const newDoc = { _id: `auto_${Date.now()}`, ...doc };
            state.push(newDoc);
            return Promise.resolve(newDoc);
        },
    };
}

// ─── Fake adapter ────────────────────────────────────────────────────────────

function createFakeAdapter(objects) {
    const envGet = jest.fn((key) => {
        if (key === 'gameTime') return Promise.resolve('10000');
        return Promise.resolve(null);
    });
    return {
        db: {
            'rooms.objects': createFakeCollection(objects),
        },
        env: {
            keys: { GAMETIME: 'gameTime' },
            get: envGet,
        },
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a mock bot that mimics TestBot's EventEmitter interface:
 * emits `('console', log, results, id, username)` and accepts `console(code)`.
 */
function createMockBot(username, id) {
    const bot = new EventEmitter();
    bot.id = id;
    bot.username = username;
    bot.console = jest.fn(() => Promise.resolve());
    return bot;
}

/** Builds the wrapped command that evalInBot submits to the bot console. */
function wrap(code, id) {
    return (
        `(() => { try { const __r = eval(${JSON.stringify(code)}); ` +
        `try { return JSON.stringify({ __evalInBot: ${id}, result: __r }); } ` +
        `catch (__s) { return JSON.stringify({ __evalInBot: ${id}, serializeError: true, error: String(__s && __s.stack || __s) }); } } ` +
        `catch (__e) { return JSON.stringify({ __evalInBot: ${id}, error: String(__e && __e.stack || __e) }); } })()`
    );
}

/**
 * Builds a console result envelope as the engine would emit it (JSON string).
 * `serializeError` marks the error as a transport failure of the wrapper's
 * own `JSON.stringify` (circular object, BigInt…).
 */
function envelope(id, result, error, serializeError) {
    const obj = { __evalInBot: id };
    if (error !== undefined) {
        obj.error = error;
        if (serializeError) {
            obj.serializeError = true;
        }
    } else {
        obj.result = result;
    }
    return JSON.stringify(obj);
}

describe('createWorldHelpers', () => {
    /** @type {Object} */
    let helpers;
    /** @type {Object} */
    let adapter;

    const defaultBotUserId = 'bot_123';

    // Starting DB objects
    const controller = {
        _id: 'ctrl_1',
        room: 'W0N1',
        type: 'controller',
        level: 3,
        downgradeTime: 15000,
        hits: 5000,
        hitsMax: 5000,
    };
    const wall = {
        _id: 'wall_1',
        room: 'W0N1',
        type: 'constructedWall',
        x: 10,
        y: 10,
        hits: 100000,
        hitsMax: 300000000,
    };
    const tower = {
        _id: 'tower_1',
        room: 'W0N1',
        type: 'tower',
        x: 20,
        y: 20,
        user: defaultBotUserId,
        hits: 3000,
        hitsMax: 3000,
        store: { energy: 1000 },
    };
    const source = {
        _id: 'src_1',
        room: 'W0N1',
        type: 'source',
        x: 15,
        y: 15,
        energy: 3000,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        adapter = createFakeAdapter([controller, wall, tower, source]);
        helpers = createWorldHelpers(adapter, defaultBotUserId);
    });

    // ─── setTicksToDowngrade ────────────────────────────────────────────────

    describe('setTicksToDowngrade', () => {
        it('sets downgradeTime = gameTime + ticks', async () => {
            await helpers.setTicksToDowngrade('W0N1', 4000);
            const ctrl = adapter.db['rooms.objects'].findOne({ _id: 'ctrl_1' });
            await expect(ctrl).resolves.toMatchObject({ downgradeTime: 14000 });
        });

        it('with null resets downgradeTime to null', async () => {
            await helpers.setTicksToDowngrade('W0N1', null);
            const ctrl = adapter.db['rooms.objects'].findOne({ _id: 'ctrl_1' });
            await expect(ctrl).resolves.toMatchObject({ downgradeTime: null });
        });

        it('throws if controller is not found', async () => {
            await expect(helpers.setTicksToDowngrade('W0N2', 1000)).rejects.toThrow(
                'Controller not found in room "W0N2"',
            );
        });

        it('throws on negative ticks', async () => {
            await expect(helpers.setTicksToDowngrade('W0N1', -1)).rejects.toThrow('ticks must be >= 0 or null');
        });
    });

    // ─── setHitsStructure ──────────────────────────────────────────────────

    describe('setHitsStructure', () => {
        it('sets hits (string _id)', async () => {
            await helpers.setHitsStructure('wall_1', 500000);
            const obj = await adapter.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj.hits).toBe(500000);
        });

        it('clamps to hitsMax', async () => {
            await helpers.setHitsStructure('tower_1', 5000);
            const obj = await adapter.db['rooms.objects'].findOne({ _id: 'tower_1' });
            expect(obj.hits).toBe(3000);
        });

        it('accepts object with _id field', async () => {
            await helpers.setHitsStructure({ _id: 'wall_1' }, 777);
            const obj = await adapter.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj.hits).toBe(777);
        });

        it('accepts object with id field', async () => {
            await helpers.setHitsStructure({ id: 'wall_1' }, 888);
            const obj = await adapter.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj.hits).toBe(888);
        });

        it('throws if object is not found', async () => {
            await expect(helpers.setHitsStructure('nonexistent', 100)).rejects.toThrow(
                'Object with _id "nonexistent" not found',
            );
        });

        it('throws if hits is negative', async () => {
            await expect(helpers.setHitsStructure('wall_1', -10)).rejects.toThrow('hits must be >= 0');
        });
    });

    // ─── damageHitsStructure ────────────────────────────────────────────────

    describe('damageHitsStructure', () => {
        it('subtracts amount from hits', async () => {
            await helpers.damageHitsStructure('wall_1', 500);
            const obj = await adapter.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj.hits).toBe(99500);
        });

        it('does not go below 0', async () => {
            await helpers.damageHitsStructure('wall_1', 999999);
            const obj = await adapter.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj.hits).toBe(0);
        });

        it('throws if object is not found', async () => {
            await expect(helpers.damageHitsStructure('nonexistent', 10)).rejects.toThrow('not found');
        });
    });

    // ─── deleteStructure ────────────────────────────────────────────────────

    describe('deleteStructure', () => {
        it('removes object from DB', async () => {
            await helpers.deleteStructure('wall_1');
            const obj = await adapter.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj).toBeNull();
        });

        it('accepts object with id field', async () => {
            await helpers.deleteStructure({ id: 'wall_1' });
            const obj = await adapter.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj).toBeNull();
        });

        it('throws if object is not found', async () => {
            await expect(helpers.deleteStructure('nonexistent')).rejects.toThrow('not found');
        });
    });

    // ─── createStructure ─────────────────────────────────────────────────────

    describe('createStructure', () => {
        it('calls materializeStructure with spec and defaultBotUserId', async () => {
            const { materializeStructure } = require('../src/lib/builders/materialize');
            const spec = { type: 'tower', x: 25, y: 25, roomName: 'W0N1' };
            const id = await helpers.createStructure(spec);
            expect(id).toBe('mocked_structure_id');
            expect(materializeStructure).toHaveBeenCalledWith(
                adapter,
                'W0N1',
                expect.objectContaining({ userId: defaultBotUserId }),
            );
        });

        it('does not override an explicit userId', async () => {
            const { materializeStructure } = require('../src/lib/builders/materialize');
            const spec = { type: 'tower', x: 30, y: 30, roomName: 'W0N1', userId: 'custom' };
            await helpers.createStructure(spec);
            expect(materializeStructure).toHaveBeenCalledWith(
                adapter,
                'W0N1',
                expect.objectContaining({ userId: 'custom' }),
            );
        });

        it('preserves explicit userId: null (no default applied)', async () => {
            const { materializeStructure } = require('../src/lib/builders/materialize');
            const spec = { type: 'tower', x: 30, y: 30, roomName: 'W0N1', userId: null };
            await helpers.createStructure(spec);
            expect(materializeStructure).toHaveBeenCalledWith(
                adapter,
                'W0N1',
                expect.objectContaining({ userId: null }),
            );
        });

        it('throws if roomName is not specified', async () => {
            await expect(helpers.createStructure({ type: 'wall', x: 5, y: 5 })).rejects.toThrow('roomName is required');
        });
    });

    // ─── find / findOne / findIds / findId ────────────────────────────────

    describe('find', () => {
        it('returns array of objects with id (alias _id)', async () => {
            const docs = await helpers.find({ room: 'W0N1' });
            expect(docs.length).toBeGreaterThanOrEqual(4);
            expect(docs[0]).toHaveProperty('id');
            expect(docs[0].id).toBe(docs[0]._id);
        });

        it('maps userId → user', async () => {
            const docs = await helpers.find({ userId: defaultBotUserId });
            expect(docs.length).toBe(1);
            expect(docs[0]._id).toBe('tower_1');
        });
    });

    describe('findOne', () => {
        it('returns the first matching object', async () => {
            const doc = await helpers.findOne({ room: 'W0N1', type: 'tower' });
            expect(doc).not.toBeNull();
            expect(doc._id).toBe('tower_1');
            expect(doc.id).toBe('tower_1');
        });

        it('with index option returns the N-th object', async () => {
            const doc = await helpers.findOne({ room: 'W0N1', type: 'source' }, { index: 0 });
            expect(doc._id).toBe('src_1');
        });

        it('index out of bounds returns null', async () => {
            const doc = await helpers.findOne({ room: 'W0N1', type: 'source' }, { index: 10 });
            expect(doc).toBeNull();
        });

        it('returns null if nothing is found', async () => {
            const doc = await helpers.findOne({ room: 'W0N1', type: 'invalid' });
            expect(doc).toBeNull();
        });
    });

    describe('findIds', () => {
        it('returns array of _id', async () => {
            const ids = await helpers.findIds({ room: 'W0N1', type: 'source' });
            expect(ids).toEqual(['src_1']);
        });

        it('maps id → _id', async () => {
            const ids = await helpers.findIds({ id: 'tower_1' });
            expect(ids).toEqual(['tower_1']);
        });
    });

    describe('findId', () => {
        it('returns _id of the first matching object', async () => {
            const id = await helpers.findId({ room: 'W0N1', type: 'tower' });
            expect(id).toBe('tower_1');
        });

        it('with index option returns the N-th _id', async () => {
            const id = await helpers.findId({ room: 'W0N1', type: 'source' }, { index: 0 });
            expect(id).toBe('src_1');
        });

        it('index out of bounds returns null', async () => {
            const id = await helpers.findId({ room: 'W0N1' }, { index: 100 });
            expect(id).toBeNull();
        });

        it('returns null if nothing is found', async () => {
            const id = await helpers.findId({ room: 'W0N1', type: 'invalid' });
            expect(id).toBeNull();
        });
    });

    // ─── spawnCreep ──────────────────────────────────────────────────────

    describe('spawnCreep', () => {
        it('calls materializeCreep with spec and defaultBotUserId', async () => {
            const { materializeCreep } = require('../src/lib/builders/materialize');
            const spec = { roomName: 'W0N1', x: 20, y: 20, name: 'TestCreep' };
            const id = await helpers.spawnCreep(spec);
            expect(id).toBe('mocked_creep_id');
            expect(materializeCreep).toHaveBeenCalledWith(
                adapter,
                'W0N1',
                expect.objectContaining({ userId: defaultBotUserId }),
            );
        });

        it('does not override an explicit userId', async () => {
            const { materializeCreep } = require('../src/lib/builders/materialize');
            const spec = { roomName: 'W0N1', x: 20, y: 20, name: 'TestCreep', userId: 'custom' };
            await helpers.spawnCreep(spec);
            expect(materializeCreep).toHaveBeenCalledWith(
                adapter,
                'W0N1',
                expect.objectContaining({ userId: 'custom' }),
            );
        });

        it('throws if roomName is not specified', async () => {
            await expect(helpers.spawnCreep({ x: 5, y: 5 })).rejects.toThrow('spawnCreep: roomName is required');
        });
    });

    // ─── getRcl ──────────────────────────────────────────────────────────

    describe('getRcl', () => {
        it('returns controller.level for a room with a controller', async () => {
            const rcl = await helpers.getRcl('W0N1');
            expect(rcl).toBe(3);
        });

        it('returns 0 if room has no controller', async () => {
            const rcl = await helpers.getRcl('W0N2');
            expect(rcl).toBe(0);
        });
    });

    // ─── getEventLog ─────────────────────────────────────────────────────

    describe('getEventLog', () => {
        it('calls readEventLog with adapter and room', async () => {
            const { readEventLog } = require('../src/lib/observers/eventLog');
            readEventLog.mockResolvedValue([{ event: 1, objectId: 'obj_1', data: {} }]);
            const events = await helpers.getEventLog('W0N1');
            expect(events).toEqual([{ event: 1, objectId: 'obj_1', data: {} }]);
            expect(readEventLog).toHaveBeenCalledWith(adapter, 'W0N1');
        });

        it('throws if room is not specified', async () => {
            await expect(helpers.getEventLog()).rejects.toThrow('getEventLog: room is required');
        });
    });
});

// ─── Bot-dependent helpers (require bots) ────────────────────────────────

describe('createWorldHelpers with bots', () => {
    let helpers;
    let adapter;

    const defaultBotUserId = 'bot_123';
    const bots = {
        myBot: { id: 'bot_123', username: 'myBot', console: jest.fn() },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        adapter = createFakeAdapter([{ _id: 'ctrl_1', room: 'W0N1', type: 'controller', level: 3 }]);

        const { getBotMemory, setBotMemory, deepMergeMemory } = require('../src/lib/builders/memory');
        getBotMemory.mockResolvedValue({ creeps: {}, rooms: {} });
        setBotMemory.mockResolvedValue(undefined);
        deepMergeMemory.mockImplementation((current, patch) => ({ ...current, ...patch }));

        helpers = createWorldHelpers(adapter, defaultBotUserId, {}, bots);
    });

    describe('readMemory', () => {
        it('reads memory for the default bot', async () => {
            const { getBotMemory } = require('../src/lib/builders/memory');
            getBotMemory.mockResolvedValue({ creeps: { Harvester1: {} } });
            const mem = await helpers.readMemory();
            expect(mem).toEqual({ creeps: { Harvester1: {} } });
            expect(getBotMemory).toHaveBeenCalledWith(adapter, 'bot_123');
        });

        it('reads memory for a specific bot by username', async () => {
            const { getBotMemory } = require('../src/lib/builders/memory');
            await helpers.readMemory('myBot');
            expect(getBotMemory).toHaveBeenCalledWith(adapter, 'bot_123');
        });

        it('throws if bots not available', async () => {
            const noBotHelpers = createWorldHelpers(adapter, defaultBotUserId);
            await expect(noBotHelpers.readMemory()).rejects.toThrow('bots not available');
        });
    });

    describe('writeMemory', () => {
        it('deep-merges patch into current memory', async () => {
            const { getBotMemory, setBotMemory, deepMergeMemory } = require('../src/lib/builders/memory');
            getBotMemory.mockResolvedValue({ a: 1 });
            deepMergeMemory.mockReturnValue({ a: 1, b: 2 });
            await helpers.writeMemory('myBot', { b: 2 });
            expect(deepMergeMemory).toHaveBeenCalledWith({ a: 1 }, { b: 2 });
            expect(setBotMemory).toHaveBeenCalledWith(adapter, 'bot_123', { a: 1, b: 2 });
        });

        it('defaults to the only bot if no username given', async () => {
            await helpers.writeMemory(undefined, { key: 'val' });
            const { getBotMemory } = require('../src/lib/builders/memory');
            expect(getBotMemory).toHaveBeenCalledWith(adapter, 'bot_123');
        });
    });

    describe('exec', () => {
        it('calls bot console with code', async () => {
            await helpers.exec('Game.time', 'myBot');
            expect(bots.myBot.console).toHaveBeenCalledWith('Game.time');
        });

        it('uses the only bot if username is omitted', async () => {
            await helpers.exec('42');
            expect(bots.myBot.console).toHaveBeenCalledWith('42');
        });
    });

    describe('botId', () => {
        const multiBots = {
            botA: { id: 'id_a', username: 'botA' },
            botB: { id: 'id_b', username: 'botB' },
        };

        it('returns _id of the only bot by default', () => {
            expect(helpers.botId()).toBe('bot_123');
        });

        it('returns _id by username', () => {
            const multiHelpers = createWorldHelpers(adapter, defaultBotUserId, {}, multiBots);
            expect(multiHelpers.botId('botA')).toBe('id_a');
            expect(multiHelpers.botId('botB')).toBe('id_b');
        });

        it('returns _id by index', () => {
            const multiHelpers = createWorldHelpers(adapter, defaultBotUserId, {}, multiBots);
            expect(multiHelpers.botId(0)).toBe('id_a');
            expect(multiHelpers.botId(1)).toBe('id_b');
        });

        it('throws if index is out of range', () => {
            const multiHelpers = createWorldHelpers(adapter, defaultBotUserId, {}, multiBots);
            expect(() => multiHelpers.botId(5)).toThrow('Bot index 5 out of range');
        });

        it('throws if username is not found', () => {
            expect(() => helpers.botId('nonexistent')).toThrow('not found');
        });

        it('throws if bots is not available', () => {
            const noBotHelpers = createWorldHelpers(adapter, defaultBotUserId);
            expect(() => noBotHelpers.botId()).toThrow('bots not available');
        });
    });
});

// ─── evalInBot ────────────────────────────────────────────────────────────────

describe('evalInBot', () => {
    let helpers;
    let adapter;
    let bot;

    beforeEach(() => {
        jest.clearAllMocks();
        adapter = createFakeAdapter([]);
        bot = createMockBot('myBot', 'bot_123');
        helpers = createWorldHelpers(adapter, 'bot_123', {}, { myBot: bot });
    });

    it('submits the wrapped code via bot.console', async () => {
        const promise = helpers.evalInBot('Game.time');
        expect(bot.console).toHaveBeenCalledWith(wrap('Game.time', 1));
        bot.emit('console', [], [envelope(1, 12345)]);
        await expect(promise).resolves.toBe(12345);
    });

    it('defaults to the only bot if username is omitted', async () => {
        const promise = helpers.evalInBot('Game.time');
        expect(bot.console).toHaveBeenCalledWith(wrap('Game.time', 1));
        bot.emit('console', [], [envelope(1, 7)]);
        await expect(promise).resolves.toBe(7);
    });

    it('parses JSON-encoded results (objects/arrays)', async () => {
        const promise = helpers.evalInBot('JSON.stringify({ ok: true, n: 3 })');
        bot.emit('console', [], [envelope(1, '{"ok":true,"n":3}')]);
        await expect(promise).resolves.toEqual({ ok: true, n: 3 });
    });

    it('returns the raw string when the result is not valid JSON', async () => {
        const promise = helpers.evalInBot('"hello world"');
        bot.emit('console', [], [envelope(1, 'hello world')]);
        await expect(promise).resolves.toBe('hello world');
    });

    it('coerces a result string that is itself valid JSON (number/bool/null)', async () => {
        // The engine String()-serializes results, so the string `'123'`
        // travels as the value "123" — parseConsoleResult must coerce it
        // back to a number (same for 'true' -> true, 'null' -> null).
        const pNumber = helpers.evalInBot('"123"');
        const pBool = helpers.evalInBot('"true"');
        const pNull = helpers.evalInBot('"null"');
        bot.emit('console', [], [envelope(1, '123'), envelope(2, 'true'), envelope(3, 'null')]);
        await expect(pNumber).resolves.toBe(123);
        await expect(pBool).resolves.toBe(true);
        await expect(pNull).resolves.toBeNull();
    });

    it('maps a missing result back to undefined', async () => {
        const promise = helpers.evalInBot('undefined');
        bot.emit('console', [], [envelope(1, undefined)]);
        await expect(promise).resolves.toBeUndefined();
    });

    it('resolves multiple pending calls by id, regardless of result order', async () => {
        const p1 = helpers.evalInBot('1');
        const p2 = helpers.evalInBot('2');
        const p3 = helpers.evalInBot('3');
        // Results arrive out of submission order — ids still match correctly.
        bot.emit('console', [], [envelope(3, 30), envelope(1, 10), envelope(2, 20)]);
        await expect(p1).resolves.toBe(10);
        await expect(p2).resolves.toBe(20);
        await expect(p3).resolves.toBe(30);
    });

    it('routes results per bot and ignores envelopes from other bots', async () => {
        const botA = createMockBot('alpha', 'bot_a');
        const botB = createMockBot('beta', 'bot_b');
        const multiHelpers = createWorldHelpers(adapter, 'bot_a', {}, { alpha: botA, beta: botB });

        const pA = multiHelpers.evalInBot('1', 'alpha'); // id 1
        const pB = multiHelpers.evalInBot('2', 'beta'); // id 2

        expect(botA.console).toHaveBeenCalledWith(wrap('1', 1));
        expect(botB.console).toHaveBeenCalledWith(wrap('2', 2));

        // Envelopes arriving on the wrong bot's console must be ignored;
        // each bot's listener only resolves its own pending calls.
        botA.emit('console', [], [envelope(2, 20), envelope(1, 10)]);
        botB.emit('console', [], [envelope(1, 10), envelope(2, 20)]);

        await expect(pA).resolves.toBe(10);
        await expect(pB).resolves.toBe(20);
    });

    it('ignores console events without results (bot log noise)', async () => {
        const promise = helpers.evalInBot('Game.time');
        bot.emit('console', ['tick log'], []);
        bot.emit('console', [], [envelope(1, 99)]);
        await expect(promise).resolves.toBe(99);
    });

    it('ignores extra results that are not evalInBot envelopes (raw exec)', async () => {
        const promise = helpers.evalInBot('Game.time');
        bot.emit('console', [], ['1', '2']);
        bot.emit('console', [], [envelope(1, 99)]);
        await expect(promise).resolves.toBe(99);
    });

    it('rejects with a hint when the result does not arrive in time', async () => {
        jest.useFakeTimers();
        try {
            const promise = helpers.evalInBot('Game.time');
            jest.advanceTimersByTime(10001);
            await expect(promise).rejects.toThrow('call `world.tick(n)` after evalInBot');
        } finally {
            jest.useRealTimers();
        }
    });

    it('rejects with the engine error when the expression throws', async () => {
        const promise = helpers.evalInBot('throw new Error("boom")');
        bot.emit('console', [], [envelope(1, undefined, 'Error: boom')]);
        await expect(promise).rejects.toThrow('evalInBot: expression failed: Error: boom');
    });

    it('rejects with a transport hint when the result cannot be serialized', async () => {
        const promise = helpers.evalInBot('Game.spawns');
        bot.emit('console', [], [envelope(1, undefined, 'TypeError: Converting circular structure to JSON', true)]);
        await expect(promise).rejects.toThrow('cannot be transported');
        await expect(promise).rejects.toThrow('use JSON.stringify(...)');
    });

    it('rejects with the error when submitting to the bot console fails', async () => {
        bot.console.mockRejectedValueOnce(new Error('console transport down'));
        const promise = helpers.evalInBot('Game.time');
        // The submit failure must reject the promise and clean up the
        // pending entry (no stray timer / listener state).
        await expect(promise).rejects.toThrow('console transport down');
    });

    it('disposeEvalInBot is safe to call when nothing is pending (idempotent)', () => {
        expect(() => helpers.disposeEvalInBot()).not.toThrow();
        expect(() => helpers.disposeEvalInBot()).not.toThrow();
    });

    it('disposeEvalInBot tolerates bots without an off() method', async () => {
        // Minimal bots may only implement on() — dispose must not throw and
        // must still reject pending calls.
        const rawBot = createMockBot('myBot', 'bot_123');
        rawBot.off = undefined;
        const rawHelpers = createWorldHelpers(adapter, 'bot_123', {}, { myBot: rawBot });

        const promise = rawHelpers.evalInBot('Game.time');
        expect(() => rawHelpers.disposeEvalInBot()).not.toThrow();
        await expect(promise).rejects.toThrow('world disposed before the result arrived');
    });

    it('supports new evalInBot calls after disposeEvalInBot', async () => {
        helpers.disposeEvalInBot();
        // Fresh state: the listener is re-attached lazily and ids restart.
        const promise = helpers.evalInBot('Game.time');
        bot.emit('console', [], [envelope(1, 42)]);
        await expect(promise).resolves.toBe(42);
    });

    it('does not leak disposeEvalInBot through the helpers spread', () => {
        expect(typeof helpers.disposeEvalInBot).toBe('function');
        // Non-enumerable, so `...helpers` spread in world.js stays clean.
        expect(Object.keys(helpers)).not.toContain('disposeEvalInBot');
    });

    it('disposeEvalInBot removes the console listener and rejects pending calls', async () => {
        const promise = helpers.evalInBot('Game.time');
        helpers.disposeEvalInBot();
        // Listener is gone: emitting the envelope must not resolve the promise.
        bot.emit('console', [], [envelope(1, 99)]);
        await expect(promise).rejects.toThrow('world disposed before the result arrived');
    });

    it('throws synchronously if bots are not available', () => {
        const noBotHelpers = createWorldHelpers(adapter, 'bot_123');
        expect(() => noBotHelpers.evalInBot('Game.time')).toThrow('bots not available');
    });

    it('throws synchronously if the bot username is not found', () => {
        expect(() => helpers.evalInBot('Game.time', 'ghost')).toThrow('bot "ghost" not found');
    });
});
