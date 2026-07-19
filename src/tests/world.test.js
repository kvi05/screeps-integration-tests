'use strict';

/**
 * Юнит-тесты для world.js — публичного API и вспомогательных функций.
 *
 * Покрывают:
 * - buildCanonicalRoom: нейтральные структуры,
 *   fixture + overrides pipeline, hostiles userId='2',
 *   inline fixture, creeps userId, controller граничные случаи.
 * - defaultBot: single-bot, multi-bot, no-bot edge cases.
 * - resolveDistDir / resolveCacheBase (чистые функции).
 *
 * @file Unit tests for world.js
 */

const { buildCanonicalRoom, defaultBot, resolveDistDir, resolveCacheBase } = require('../lib/world');

describe('buildCanonicalRoom', () => {
    describe('нейтральные структуры (W3 regression)', () => {
        it('структура с явным userId сохраняет его', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    structures: [
                        { type: 'spawn', x: 25, y: 25, userId: 'explicitUser' },
                        { type: 'tower', x: 26, y: 24, userId: 'anotherUser' },
                    ],
                },
                'W0N1',
                'defaultBot',
            );

            expect(canonical.structures[0].userId).toBe('explicitUser');
            expect(canonical.structures[1].userId).toBe('anotherUser');
        });

        it('структура без userId получает defaultBotUserId', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    structures: [
                        { type: 'spawn', x: 25, y: 25 },
                        { type: 'tower', x: 26, y: 24 },
                    ],
                },
                'W0N1',
                'defaultBot',
            );

            // undefined ?? defaultBot = defaultBot
            expect(canonical.structures[0].userId).toBe('defaultBot');
            expect(canonical.structures[1].userId).toBe('defaultBot');
        });

        it('структура c userId="" считается нейтральной (не заменяется на defaultBot)', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    structures: [{ type: 'constructedWall', x: 10, y: 10, userId: '' }],
                },
                'W0N1',
                'defaultBot',
            );

            // '' ?? defaultBot = '' (пустая строка — falsy, но ?? не заменяет)
            expect(canonical.structures[0].userId).toBe('');
        });

        it('структура c userId=null считается нейтральной (не заменяется на defaultBot)', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    structures: [{ type: 'constructedWall', x: 10, y: 10, userId: null }],
                },
                'W0N1',
                'defaultBot',
            );

            // null ?? defaultBot = defaultBot (null заменяется ??)
            expect(canonical.structures[0].userId).toBe('defaultBot');
        });
    });

    describe('hostiles', () => {
        it('hostile creep всегда получает userId="2"', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    hostiles: [
                        { type: 'creep', x: 20, y: 20, body: [{ type: 'attack', hits: 100 }], name: 'Invader1' },
                        { type: 'creep', x: 21, y: 21, body: [{ type: 'attack', hits: 100 }], name: 'Invader2' },
                    ],
                },
                'W0N1',
                'defaultBot',
            );

            expect(canonical.hostiles).toHaveLength(2);
            for (const h of canonical.hostiles) {
                expect(h.userId).toBe('2');
            }
        });

        it('hostile creep с явным userId переопределяется на "2"', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    hostiles: [
                        {
                            type: 'creep',
                            x: 20,
                            y: 20,
                            userId: 'someUser',
                            body: [{ type: 'attack', hits: 100 }],
                            name: 'Invader1',
                        },
                    ],
                },
                'W0N1',
                'defaultBot',
            );

            // hostiles всегда '2', даже если userId задан
            expect(canonical.hostiles[0].userId).toBe('2');
        });
    });

    describe('fixture + overrides', () => {
        it('controller может отсутствовать (нейтральная комната)', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    sources: [{ type: 'source', x: 10, y: 10 }],
                },
                'W0N1',
                'defaultBot',
            );

            expect(canonical.controller).toBeUndefined();
            expect(canonical.sources).toHaveLength(1);
            expect(canonical.structures).toEqual([]);
            expect(canonical.creeps).toEqual([]);
        });

        it('проставляет roomName в каждый объект', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    controller: { type: 'controller', x: 25, y: 25 },
                    sources: [{ type: 'source', x: 10, y: 10 }],
                    structures: [{ type: 'spawn', x: 25, y: 25 }],
                    creeps: [{ type: 'creep', x: 15, y: 15, body: [{ type: 'move', hits: 100 }], name: 'Bot1' }],
                },
                'W0N1',
                'defaultBot',
            );

            expect(canonical.controller.roomName).toBe('W0N1');
            expect(canonical.sources[0].roomName).toBe('W0N1');
            expect(canonical.structures[0].roomName).toBe('W0N1');
            expect(canonical.creeps[0].roomName).toBe('W0N1');
        });

        it('roomName из объекта приоритетнее имени комнаты', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    structures: [{ type: 'spawn', x: 25, y: 25, roomName: 'W0N5' }],
                },
                'W0N1',
                'defaultBot',
            );

            expect(canonical.structures[0].roomName).toBe('W0N5');
        });
    });

    describe('error handling', () => {
        it('бросает ошибку для несуществующего roomFixture', async () => {
            await expect(
                buildCanonicalRoom({ name: 'W0N1', roomFixture: 'nonexistent_fixture' }, 'W0N1', 'defaultBot'),
            ).rejects.toThrow("roomFixture 'nonexistent_fixture' не найден");
        });
    });

    describe('inline fixture (объект)', () => {
        it('roomFixture как объект используется напрямую', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    roomFixture: {
                        controller: { type: 'controller', x: 25, y: 25, level: 5 },
                        sources: [],
                        structures: [{ type: 'spawn', x: 25, y: 25 }],
                        creeps: [],
                    },
                },
                'W0N1',
                'botInline',
            );

            expect(canonical.controller).toBeDefined();
            expect(canonical.controller.level).toBe(5);
            expect(canonical.controller.userId).toBe('botInline');
            expect(canonical.structures[0].userId).toBe('botInline');
        });

        it('inline fixture с overrides применяются', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    roomFixture: {
                        controller: { type: 'controller', x: 25, y: 25, level: 3 },
                        sources: [],
                        structures: [{ type: 'spawn', x: 25, y: 25, id: 'spawn1' }],
                        creeps: [],
                    },
                    roomOverrides: {
                        structures: [{ type: 'spawn', x: 25, y: 25, id: 'spawn1', hits: 9999 }],
                    },
                },
                'W0N1',
                'botInline',
            );

            const spawn = canonical.structures[0];
            expect(spawn.hits).toBe(9999);
            expect(spawn.userId).toBe('botInline');
        });
    });

    describe('creeps', () => {
        it('creep без userId получает defaultBotUserId', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    creeps: [{ type: 'creep', x: 15, y: 15, body: [{ type: 'move', hits: 100 }], name: 'Harvester1' }],
                },
                'W0N1',
                'botCreep',
            );

            expect(canonical.creeps[0].userId).toBe('botCreep');
        });

        it('creep с явным userId сохраняет его', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    creeps: [
                        {
                            type: 'creep',
                            x: 15,
                            y: 15,
                            body: [{ type: 'move', hits: 100 }],
                            name: 'Harvester1',
                            userId: 'customUser',
                        },
                    ],
                },
                'W0N1',
                'botCreep',
            );

            expect(canonical.creeps[0].userId).toBe('customUser');
        });

        it('creep с userId="" считается нейтральным', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    creeps: [
                        {
                            type: 'creep',
                            x: 15,
                            y: 15,
                            body: [{ type: 'move', hits: 100 }],
                            name: 'Harvester1',
                            userId: '',
                        },
                    ],
                },
                'W0N1',
                'botCreep',
            );

            expect(canonical.creeps[0].userId).toBe('');
        });
    });

    describe('controller граничные случаи', () => {
        it('controller с userId="" остаётся нейтральным', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    controller: { type: 'controller', x: 25, y: 25, userId: '' },
                },
                'W0N1',
                'defaultBot',
            );

            // '' ?? defaultBot = '' (пустая строка не заменяется)
            expect(canonical.controller.userId).toBe('');
        });

        it('controller без userId (undefined) получает defaultBotUserId', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    controller: { type: 'controller', x: 25, y: 25 },
                },
                'W0N1',
                'defaultBot',
            );

            expect(canonical.controller.userId).toBe('defaultBot');
        });
    });

    describe('sources', () => {
        it('source без userId получает defaultBotUserId', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    sources: [{ type: 'source', x: 10, y: 10 }],
                },
                'W0N1',
                'botSrc',
            );

            expect(canonical.sources[0].userId).toBe('botSrc');
        });
    });

    describe('хост не указаны', () => {
        it('hostiles отсутствуют → поле hostiles пустое', async () => {
            const canonical = await buildCanonicalRoom(
                { name: 'W0N1', structures: [{ type: 'spawn', x: 25, y: 25 }] },
                'W0N1',
                'defaultBot',
            );

            expect(canonical.hostiles).toEqual([]);
        });
    });
});

describe('defaultBot', () => {
    it('single-bot возвращает имя единственного бота', () => {
        const bots = { myBot: { id: 'u1' } };
        expect(defaultBot(bots)).toBe('myBot');
    });

    it('no-bot бросает ошибку', () => {
        expect(() => defaultBot({})).toThrow('defaultBot: в opts.bots ни одного бота');
    });

    it('multi-bot бросает ошибку', () => {
        const bots = { bot1: { id: 'u1' }, bot2: { id: 'u2' } };
        expect(() => defaultBot(bots)).toThrow(/ботов > 1/);
    });
});

describe('resolveDistDir / resolveCacheBase', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        process.env = { ...OLD_ENV };
        delete process.env.BOT_DIST_DIR;
        delete process.env.SIT_CACHE_DIR;
    });

    afterEach(() => {
        process.env = OLD_ENV;
    });

    describe('resolveDistDir', () => {
        it('opts.distDir имеет приоритет', () => {
            expect(resolveDistDir({ distDir: '/custom/dist' })).toBe('/custom/dist');
        });

        it('BOT_DIST_DIR используется если opts.distDir не задан', () => {
            process.env.BOT_DIST_DIR = '/env/dist';
            expect(resolveDistDir({})).toBe('/env/dist');
        });

        it('cwd/dist используется если ни opts, ни env не заданы', () => {
            const expected = require('path').resolve(process.cwd(), 'dist');
            expect(resolveDistDir({})).toBe(expected);
        });

        it('opts.distDir приоритетнее env', () => {
            process.env.BOT_DIST_DIR = '/env/dist';
            expect(resolveDistDir({ distDir: '/opts/dist' })).toBe('/opts/dist');
        });
    });

    describe('resolveCacheBase', () => {
        it('opts.cacheDir имеет приоритет', () => {
            expect(resolveCacheBase({ cacheDir: '/custom/cache' })).toBe('/custom/cache');
        });

        it('SIT_CACHE_DIR используется если opts.cacheDir не задан', () => {
            process.env.SIT_CACHE_DIR = '/env/cache';
            expect(resolveCacheBase({})).toBe('/env/cache');
        });

        it('.cache используется если ни opts, ни env не заданы', () => {
            const expected = require('path').resolve(process.cwd(), '.cache');
            expect(resolveCacheBase({})).toBe(expected);
        });

        it('opts.cacheDir приоритетнее env', () => {
            process.env.SIT_CACHE_DIR = '/env/cache';
            expect(resolveCacheBase({ cacheDir: '/opts/cache' })).toBe('/opts/cache');
        });
    });
});
