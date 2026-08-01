'use strict';

/**
 * Unit tests for testBot.js — TestBot class.
 *
 * Cover:
 * - id / username getters
 * - memory getter reads env.keys.MEMORY + id
 * - console() inserts an expression into db['users.console']
 * - init() subscribes to the `user:<id>/console` pubsub channel
 * - console events: log + results emitted; console errors appended to log
 *
 * @file Unit tests for testBot.js
 */

const { TestBot } = require('../src/lib/runtime/testBot');

// ─── Fake adapter ─────────────────────────────────────────────────────────

function createFakeAdapter() {
    const handlers = {};
    return {
        env: {
            keys: { MEMORY: 'memory:' },
            get: jest.fn(() => '{"hello":"world"}'),
        },
        db: {
            'users.console': {
                insert: jest.fn(async (doc) => ({ _id: 'console_1', ...doc })),
            },
        },
        pubsub: {
            subscribe: jest.fn(async (channel, cb) => {
                handlers[channel] = cb;
            }),
        },
        handlers,
    };
}

function makeBot(adapter) {
    return new TestBot(adapter, { _id: 'bot_1', username: 'bot' });
}

// ─── TestBot ──────────────────────────────────────────────────────────────

describe('TestBot', () => {
    it('exposes id and username', () => {
        const bot = makeBot(createFakeAdapter());
        expect(bot.id).toBe('bot_1');
        expect(bot.username).toBe('bot');
    });

    it('reads memory via env.get(keys.MEMORY + id)', () => {
        const adapter = createFakeAdapter();
        const bot = makeBot(adapter);
        expect(bot.memory).toBe('{"hello":"world"}');
        expect(adapter.env.get).toHaveBeenCalledWith('memory:bot_1');
    });

    it('console() inserts an expression into users.console', async () => {
        const adapter = createFakeAdapter();
        const bot = makeBot(adapter);
        await bot.console('Game.time');
        expect(adapter.db['users.console'].insert).toHaveBeenCalledWith({
            user: 'bot_1',
            expression: 'Game.time',
            hidden: false,
        });
    });

    it('init() subscribes to the bot console channel', async () => {
        const adapter = createFakeAdapter();
        const bot = makeBot(adapter);
        await bot.init();
        expect(adapter.pubsub.subscribe).toHaveBeenCalledWith('user:bot_1/console', expect.any(Function));
    });

    it('emits a console event with log and results', async () => {
        const adapter = createFakeAdapter();
        const bot = makeBot(adapter);
        const listener = jest.fn();
        bot.on('console', listener);
        await bot.init();

        const cb = adapter.handlers['user:bot_1/console'];
        expect(cb).toBeDefined();
        cb(JSON.stringify({ messages: { log: ['hello'], results: ['1'] } }));

        expect(listener).toHaveBeenCalledWith(['hello'], ['1'], 'bot_1', 'bot');
    });

    it('appends console errors to the log', async () => {
        const adapter = createFakeAdapter();
        const bot = makeBot(adapter);
        const listener = jest.fn();
        bot.on('console', listener);
        await bot.init();

        const cb = adapter.handlers['user:bot_1/console'];
        cb(JSON.stringify({ messages: { log: ['x'], results: [] }, error: 'boom' }));

        expect(listener).toHaveBeenCalledWith(['x', 'boom'], [], 'bot_1', 'bot');
    });
});
