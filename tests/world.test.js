'use strict';

/**
 * Unit tests for world.js — public API and helper functions.
 *
 * Cover:
 * - buildCanonicalRoom: neutral structures,
 *   fixture + overrides pipeline, hostiles userId='2',
 *   inline fixture, creeps userId, controller edge cases.
 * - defaultBot: single-bot, multi-bot, no-bot edge cases.
 * - resolveDistDir / resolveCacheBase (pure functions).
 *
 * @file Unit tests for world.js
 */

const { buildCanonicalRoom, defaultBot, resolveDistDir, resolveCacheBase } = require('../src/lib/orchestration/world');

describe('buildCanonicalRoom', () => {
    describe('neutral structures (W3 regression)', () => {
        it('structure with explicit userId preserves it', async () => {
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

        it('structure without userId gets defaultBotUserId', async () => {
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

        it('structure with userId="" is considered neutral (not replaced with defaultBot)', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    structures: [{ type: 'constructedWall', x: 10, y: 10, userId: '' }],
                },
                'W0N1',
                'defaultBot',
            );

            // '' ?? defaultBot = '' (empty string is falsy, but ?? does not replace)
            expect(canonical.structures[0].userId).toBe('');
        });

        it('structure with userId=null preserves null (explicit neutral)', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    structures: [{ type: 'constructedWall', x: 10, y: 10, userId: null }],
                },
                'W0N1',
                'defaultBot',
            );

            // null is preserved as explicit "no owner"
            expect(canonical.structures[0].userId).toBeNull();
        });
    });

    describe('hostiles', () => {
        it('hostile creep always gets userId="2"', async () => {
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

        it('hostile creep with explicit userId is overridden to "2"', async () => {
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

            // hostiles always '2', even if userId is set
            expect(canonical.hostiles[0].userId).toBe('2');
        });
    });

    describe('fixture + overrides', () => {
        it('controller may be absent (neutral room)', async () => {
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

        it('sets roomName on each object', async () => {
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

        it('roomName from object takes precedence over room name', async () => {
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
        it('throws for non-existent roomFixture', async () => {
            await expect(
                buildCanonicalRoom({ name: 'W0N1', roomFixture: 'nonexistent_fixture' }, 'W0N1', 'defaultBot'),
            ).rejects.toThrow("roomFixture 'nonexistent_fixture' not found");
        });
    });

    describe('inline fixture (object)', () => {
        it('roomFixture as object is used directly', async () => {
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

        it('inline fixture with overrides is applied', async () => {
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
        it('creep without userId gets defaultBotUserId', async () => {
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

        it('creep with explicit userId preserves it', async () => {
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

        it('creep with userId="" is considered neutral', async () => {
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

    describe('controller edge cases', () => {
        it('controller with userId="" stays neutral', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    controller: { type: 'controller', x: 25, y: 25, userId: '' },
                },
                'W0N1',
                'defaultBot',
            );

            // '' ?? defaultBot = '' (empty string is not replaced)
            expect(canonical.controller.userId).toBe('');
        });

        it('controller without userId (undefined) gets defaultBotUserId', async () => {
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
        it('source without userId gets defaultBotUserId', async () => {
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

    describe('hostiles not specified', () => {
        it('hostiles absent → hostiles field is empty', async () => {
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
    it('single-bot returns the only bot name', () => {
        const bots = { myBot: { id: 'u1' } };
        expect(defaultBot(bots)).toBe('myBot');
    });

    it('no-bot throws an error', () => {
        expect(() => defaultBot({})).toThrow('defaultBot: no bots in opts.bots');
    });

    it('multi-bot throws an error', () => {
        const bots = { bot1: { id: 'u1' }, bot2: { id: 'u2' } };
        expect(() => defaultBot(bots)).toThrow(/more than 1 bot/);
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
        it('opts.distDir has priority', () => {
            expect(resolveDistDir({ distDir: '/custom/dist' })).toBe('/custom/dist');
        });

        it('BOT_DIST_DIR is used if opts.distDir is not set', () => {
            process.env.BOT_DIST_DIR = '/env/dist';
            expect(resolveDistDir({})).toBe('/env/dist');
        });

        it('cwd/dist is used if neither opts nor env are set', () => {
            const expected = require('path').resolve(process.cwd(), 'dist');
            expect(resolveDistDir({})).toBe(expected);
        });

        it('opts.distDir takes precedence over env', () => {
            process.env.BOT_DIST_DIR = '/env/dist';
            expect(resolveDistDir({ distDir: '/opts/dist' })).toBe('/opts/dist');
        });
    });

    describe('resolveCacheBase', () => {
        it('opts.cacheDir has priority', () => {
            expect(resolveCacheBase({ cacheDir: '/custom/cache' })).toBe('/custom/cache');
        });

        it('SIT_CACHE_DIR is used if opts.cacheDir is not set', () => {
            process.env.SIT_CACHE_DIR = '/env/cache';
            expect(resolveCacheBase({})).toBe('/env/cache');
        });

        it('.cache is used if neither opts nor env are set', () => {
            const expected = require('path').resolve(process.cwd(), '.cache');
            expect(resolveCacheBase({})).toBe(expected);
        });

        it('opts.cacheDir takes precedence over env', () => {
            process.env.SIT_CACHE_DIR = '/env/cache';
            expect(resolveCacheBase({ cacheDir: '/opts/cache' })).toBe('/opts/cache');
        });
    });
});
