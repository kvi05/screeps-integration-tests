'use strict';

/**
 * Unit tests for world subsystem — createWorld, buildCanonicalRoom,
 * and helper functions.
 *
 * Cover:
 * - createWorld: memory fixture validation (missing/existing fixtures,
 *   inline memory, multi-bot fail-fast).
 * - buildCanonicalRoom: neutral structures,
 *   fixture + overrides pipeline, hostiles userId='2',
 *   inline fixture, creeps userId, controller edge cases.
 * - resolveDistDir / resolveCacheBase (pure functions).
 * - observeAllBots: sampling gating and per-bot metrics collection.
 *
 * @file Unit tests for world subsystem
 */

const { createWorld, spec } = require('../src');
const {
    buildCanonicalRoom,
    resolveDistDir,
    resolveCacheBase,
    observeAllBots,
} = require('../src/lib/orchestration/world');
const { FixtureError } = require('../src/lib/errors');
const { collectMemoryFixtureNames } = require('../src/lib/builders/memory');

// ── Mocks for createWorld memory fixture validation ────────────────────────

// Mock hasMemoryFixture for deterministic tests — only 'existing-fixture' is present
jest.mock('../src/lib/builders/memory', () => {
    const actual = jest.requireActual('../src/lib/builders/memory');
    return {
        ...actual,
        hasMemoryFixture: jest.fn((name) => {
            return name === 'existing-fixture';
        }),
    };
});

// Prevent real server startup — createWorld will throw early on fixtures or later on server mock
jest.mock('../src/lib/runtime/runtime', () => ({
    prepareServer: jest.fn().mockRejectedValue(new Error('server blocked by test')),
    addBots: jest.fn().mockRejectedValue(new Error('server blocked by test')),
}));

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
            ).rejects.toThrow("Room fixture 'nonexistent_fixture' not found");
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

// ────────────────────────────────────────────────────────────────────────────
// createWorld memory fixture validation
// ────────────────────────────────────────────────────────────────────────────

describe('createWorld memory fixture validation', () => {
    const BASE_OPTS = {
        rooms: [{ name: 'W0N1', controller: spec.controller({ level: 1 }) }],
    };

    // ── Missing fixtures ──────────────────────────────────────────────

    it('throws FixtureError when `memory` string fixture is missing', async () => {
        await expect(createWorld({ ...BASE_OPTS, memory: 'nonexistent-fixture' })).rejects.toThrow(FixtureError);
    });

    it('throws FixtureError when `memory` object with `.fixture` is missing', async () => {
        await expect(createWorld({ ...BASE_OPTS, memory: { fixture: 'nonexistent-fixture' } })).rejects.toThrow(
            FixtureError,
        );
    });

    it('error has code MISSING_MEMORY_FIXTURE', async () => {
        expect.assertions(2);
        try {
            await createWorld({ ...BASE_OPTS, memory: 'nonexistent-fixture' });
        } catch (e) {
            expect(e).toBeInstanceOf(FixtureError);
            expect(e.code).toBe('MISSING_MEMORY_FIXTURE');
        }
    });

    it('error message includes the fixture name', async () => {
        expect.assertions(1);
        try {
            await createWorld({ ...BASE_OPTS, memory: 'my-special-fixture' });
        } catch (e) {
            expect(e.toString()).toContain('my-special-fixture');
        }
    });

    // ── No fixtures (no error expected from fixture check) ────────────

    it('does NOT throw when `memory` is undefined', async () => {
        await expect(createWorld(BASE_OPTS)).rejects.not.toThrow(FixtureError);
    });

    it('does NOT throw when `memory` is inline (no fixture)', async () => {
        await expect(createWorld({ ...BASE_OPTS, memory: { colonies: { W0N1: { rcl: 1 } } } })).rejects.not.toThrow(
            FixtureError,
        );
    });

    it('does NOT throw when the referenced fixture exists', async () => {
        // 'existing-fixture' is mocked to exist → passes fixture check,
        // then fails on server setup (expected)
        await expect(createWorld({ ...BASE_OPTS, memory: 'existing-fixture' })).rejects.not.toThrow(FixtureError);
    });

    // ── Multi-bot ─────────────────────────────────────────────────────

    it('throws on the FIRST missing fixture (fail-fast)', async () => {
        expect.assertions(1);
        try {
            await createWorld({
                ...BASE_OPTS,
                memory: { bot1: 'existing-fixture', bot2: 'missing-one', bot3: 'missing-two' },
            });
        } catch (e) {
            // Should mention the first missing fixture in the map
            expect(e.toString()).toContain('missing-one');
        }
    });
});

// ────────────────────────────────────────────────────────────────────────────
// collectMemoryFixtureNames — pure function unit tests
// ────────────────────────────────────────────────────────────────────────────

describe('collectMemoryFixtureNames', () => {
    it('returns [name] for a string', () => {
        expect(collectMemoryFixtureNames('rcl3-stable')).toEqual(['rcl3-stable']);
    });

    it('returns [name] for an object with .fixture string', () => {
        expect(collectMemoryFixtureNames({ fixture: 'rcl3-stable' })).toEqual(['rcl3-stable']);
    });

    it('returns [name] for an object with .fixture + overrides', () => {
        expect(collectMemoryFixtureNames({ fixture: 'rcl3-stable', colonies: { W0N1: {} } })).toEqual(['rcl3-stable']);
    });

    it('returns [] for an inline memory object (no .fixture)', () => {
        expect(collectMemoryFixtureNames({ colonies: { W0N1: { rcl: 1 } } })).toEqual([]);
    });

    it('returns [] for undefined', () => {
        expect(collectMemoryFixtureNames(undefined)).toEqual([]);
    });

    it('returns [] for null', () => {
        expect(collectMemoryFixtureNames(null)).toEqual([]);
    });

    it('extracts fixture names from a per-bot map', () => {
        expect(
            collectMemoryFixtureNames({
                bot1: 'fix-a',
                bot2: { fixture: 'fix-b' },
            }),
        ).toEqual(['fix-a', 'fix-b']);
    });

    it('ignores inline entries in a per-bot map', () => {
        expect(
            collectMemoryFixtureNames({
                bot1: 'fix-a',
                bot2: { colonies: { W0N1: {} } },
            }),
        ).toEqual(['fix-a']);
    });

    it('returns [] for an empty object', () => {
        expect(collectMemoryFixtureNames({})).toEqual([]);
    });

    it('returns [] for an array (invalid shape)', () => {
        expect(collectMemoryFixtureNames(['something'])).toEqual([]);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// observeAllBots — per-tick bot metrics sampling
// ────────────────────────────────────────────────────────────────────────────

describe('observeAllBots', () => {
    const bots = { bot1: { id: 'u1' }, bot2: { id: 'u2' } };

    function createReport() {
        return { metrics: { append: jest.fn() }, frameworkWarnings: [] };
    }

    function createAdapter(users) {
        return {
            db: {
                users: {
                    findOne: jest.fn(async (query) => users.find((u) => u._id === query._id) || null),
                },
            },
        };
    }

    it('does nothing when metrics.bots is false', async () => {
        const report = createReport();
        await observeAllBots({}, bots, report, { bots: false, every: 1 }, 5);
        expect(report.metrics.append).not.toHaveBeenCalled();
    });

    it('does nothing when every is 0 or tick is not a sampling tick', async () => {
        const report = createReport();
        await observeAllBots({}, bots, report, { bots: true, every: 0 }, 5);
        await observeAllBots({}, bots, report, { bots: true, every: 2 }, 5);
        expect(report.metrics.append).not.toHaveBeenCalled();
    });

    it('samples bot metrics for each bot on a sampling tick', async () => {
        const adapter = createAdapter([
            { _id: 'u1', username: 'bot1', lastUsedCpu: 1, cpuAvailable: 10000, cpu: 100 },
            { _id: 'u2', username: 'bot2', lastUsedCpu: 2, cpuAvailable: 9000, cpu: 100 },
        ]);
        const report = createReport();
        await observeAllBots(adapter, bots, report, { bots: true, every: 1 }, 5);
        expect(adapter.db.users.findOne).toHaveBeenCalledWith({ _id: 'u1' });
        expect(adapter.db.users.findOne).toHaveBeenCalledWith({ _id: 'u2' });
        expect(report.metrics.append).toHaveBeenCalledWith('bots', 'bot1', 5, {
            cpuUsage: 1,
            bucket: 10000,
            cpuLimit: 100,
        });
        expect(report.metrics.append).toHaveBeenCalledWith('bots', 'bot2', 5, {
            cpuUsage: 2,
            bucket: 9000,
            cpuLimit: 100,
        });
    });

    it('skips a bot whose user row is missing', async () => {
        const adapter = createAdapter([{ _id: 'u1', username: 'bot1' }]);
        const report = createReport();
        await observeAllBots(adapter, bots, report, { bots: true, every: 1 }, 5);
        expect(report.metrics.append).toHaveBeenCalledTimes(1);
        expect(report.metrics.append).toHaveBeenCalledWith('bots', 'bot1', 5, {
            cpuUsage: 0,
            bucket: 0,
            cpuLimit: 0,
        });
    });

    it('records a frameworkWarning and continues when collection fails', async () => {
        const adapter = {
            db: { users: { findOne: jest.fn().mockRejectedValue(new Error('boom')) } },
        };
        const report = createReport();
        await observeAllBots(adapter, bots, report, { bots: true, every: 1 }, 5);
        expect(report.metrics.append).not.toHaveBeenCalled();
        expect(report.frameworkWarnings).toHaveLength(2);
        expect(report.frameworkWarnings[0]).toContain('metrics bot bot1 tick 5');
        expect(report.frameworkWarnings[1]).toContain('metrics bot bot2 tick 5');
    });
});
