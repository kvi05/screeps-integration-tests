'use strict';

/**
 * Unit tests for buildCanonicalRoom — verify correct assembly of
 * canonical room spec from fixture + overrides.
 *
 * Cover regressions:
 * - `.map(applyDefaults)` without passing array index to userInvader
 *   (index 1 → truthy → userId='2' for regular structures)
 * - hostiles get userId='2' (Invader), others — defaultBotUserId
 * - roomName is set on every object
 *
 * @file Unit tests for buildCanonicalRoom.
 */

const { buildCanonicalRoom } = require('../src/lib/world');
const { applyRoomOverrides, registerRoomFixture } = require('../src/lib/fixtures/roomFixture');
const spec = require('../src/lib/builders/spec');

// Test room fixture replacing bot-specific rcl3-stable.
registerRoomFixture('rcl3-stable', {
    name: 'rcl3-stable',
    description: 'Test fixture replacing bot-specific rcl3-stable',
    controller: spec.controller({ level: 3 }),
    sources: [spec.source(15, 15), spec.source(35, 35)],
    structures: [
        spec.spawn(25, 25),
        spec.tower(26, 24),
        spec.extension(27, 24),
        spec.extension(27, 25),
        spec.extension(28, 25),
        spec.extension(29, 26),
        spec.extension(29, 27),
        spec.extension(28, 28),
        spec.extension(27, 27),
        spec.extension(27, 29),
        spec.extension(26, 29),
        spec.extension(26, 28),
    ],
    creeps: [],
});

describe('buildCanonicalRoom', () => {
    describe('inline fields (without fixture)', () => {
        it('sets roomName and defaultBotUserId on structures', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    controller: spec.controller({ level: 3 }),
                    sources: [spec.source(15, 15)],
                    structures: [spec.spawn(25, 25), spec.tower(26, 24)],
                },
                'W0N1',
                'bot123',
            );

            expect(canonical.name).toBe('W0N1');
            expect(canonical.structures).toHaveLength(2);
            expect(canonical.structures[0]).toMatchObject({ type: 'spawn', roomName: 'W0N1', userId: 'bot123' });
            expect(canonical.structures[1]).toMatchObject({ type: 'tower', roomName: 'W0N1', userId: 'bot123' });
        });

        it('does not pass array index to userInvader (.map regression)', async () => {
            // Bug: .map(applyDefaults) passes (item, index, array) to applyDefaults.
            // index=1 (truthy) → userInvader=1 → userId='2' for tower (element #2).
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    structures: [spec.spawn(25, 25), spec.tower(26, 24), spec.extension(27, 24)],
                },
                'W0N1',
                'bot456',
            );

            // All structures should have bot userId, not '2' (Invader)
            for (const s of canonical.structures) {
                expect(s.userId).toBe('bot456');
            }
        });

        it('sets userId=2 for hostiles', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    structures: [spec.spawn(25, 25)],
                    hostiles: [spec.invader(40, 40)],
                },
                'W0N1',
                'bot789',
            );

            expect(canonical.hostiles).toHaveLength(1);
            expect(canonical.hostiles[0]).toMatchObject({ roomName: 'W0N1', userId: '2' });
            // structures are not infected with userId='2'
            expect(canonical.structures[0].userId).toBe('bot789');
        });

        it('controller without userId gets defaultBotUserId', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    controller: spec.controller({ level: 3 }),
                },
                'W0N1',
                'botCtrl',
            );

            expect(canonical.controller).toMatchObject({ level: 3, roomName: 'W0N1', userId: 'botCtrl' });
        });
    });

    describe('fixture-based', () => {
        it('preserves controller level from fixture', async () => {
            const canonical = await buildCanonicalRoom(
                { name: 'W0N1', roomFixture: 'rcl3-stable' },
                'W0N1',
                'botFixture',
            );

            expect(canonical.controller).toBeDefined();
            expect(canonical.controller.level).toBe(3);
            expect(canonical.structures.length).toBeGreaterThan(10);
        });

        it('tower from fixture gets bot userId, not Invader', async () => {
            const canonical = await buildCanonicalRoom({ name: 'W0N1', roomFixture: 'rcl3-stable' }, 'W0N1', 'botFix2');

            const tower = canonical.structures.find((s) => s.type === 'tower');
            expect(tower).toBeDefined();
            expect(tower.userId).toBe('botFix2');
        });

        it('overrides.hostiles adds invader with userId=2', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    roomFixture: 'rcl3-stable',
                    roomOverrides: {
                        hostiles: [spec.invader(40, 40)],
                    },
                },
                'W0N1',
                'botOver',
            );

            expect(canonical.hostiles).toHaveLength(1);
            expect(canonical.hostiles[0].userId).toBe('2');
            // structures remain with bot userId
            const tower = canonical.structures.find((s) => s.type === 'tower');
            expect(tower.userId).toBe('botOver');
        });
    });

    describe('applyRoomOverrides', () => {
        it('returns a new object with empty overrides', () => {
            const fixture = {
                controller: spec.controller({ level: 3 }),
                sources: [spec.source(15, 15)],
                structures: [spec.spawn(25, 25)],
                creeps: [],
            };

            const result = applyRoomOverrides(fixture, {});

            // new object
            expect(result).not.toBe(fixture);
            // new structures array
            expect(result.structures).not.toBe(fixture.structures);
            // new creeps array
            expect(result.creeps).not.toBe(fixture.creeps);
            // but controller — same reference (not overridden)
            expect(result.controller).toBe(fixture.controller);
            // sources — same reference (not copied)
            expect(result.sources).toBe(fixture.sources);
        });

        it('returns a new object with undefined overrides', () => {
            const fixture = { structures: [spec.spawn(25, 25)], creeps: [] };
            const result = applyRoomOverrides(fixture);

            expect(result).not.toBe(fixture);
            expect(result.structures).not.toBe(fixture.structures);
            expect(result.creeps).not.toBe(fixture.creeps);
        });

        it('copy does not mutate original fixture when result is mutated', () => {
            const fixture = {
                structures: [spec.spawn(25, 25)],
                creeps: [],
            };

            const result = applyRoomOverrides(fixture, {});
            result.structures.push(spec.tower(26, 24));

            expect(fixture.structures).toHaveLength(1);
            expect(result.structures).toHaveLength(2);
        });

        it('preserves controller id and x/y after overrides', () => {
            const fixture = {
                controller: spec.controller({ id: 'ctrl_1', level: 3, x: 10, y: 10 }),
                structures: [],
                creeps: [],
            };

            const result = applyRoomOverrides(fixture, {});
            expect(result.controller.id).toBe('ctrl_1');
            expect(result.controller.x).toBe(10);
            expect(result.controller.y).toBe(10);
            expect(result.controller.level).toBe(3);
        });
    });

    describe('controller in canonical', () => {
        it('passes controller id from inline spec', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    controller: spec.controller({ id: 'ctrl_42', level: 3, x: 15, y: 20 }),
                },
                'W0N1',
                'botId',
            );

            expect(canonical.controller).toMatchObject({
                id: 'ctrl_42',
                level: 3,
                x: 15,
                y: 20,
                roomName: 'W0N1',
                userId: 'botId',
            });
        });

        it('controller is optional — may be absent', async () => {
            const canonical = await buildCanonicalRoom(
                { name: 'W0N1', structures: [spec.spawn(25, 25)] },
                'W0N1',
                'botId',
            );

            expect(canonical.controller).toBeUndefined();
        });

        it('controller id does not affect userId binding (userId !== undefined)', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    controller: spec.controller({ id: 'ctrl_1', level: 1, userId: undefined }),
                },
                'W0N1',
                'defaultBot',
            );

            // If userId is undefined — fallback to defaultBotUserId
            expect(canonical.controller.userId).toBe('defaultBot');
        });
    });
});
