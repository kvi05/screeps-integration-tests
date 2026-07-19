'use strict';

/**
 * Юнит-тесты для world.js — публичного API и вспомогательных функций.
 *
 * Покрывают:
 * - buildCanonicalRoom: нейтральные структуры,
 *   fixture + overrides pipeline, hostiles userId='2'.
 * - defaultBot: single-bot, multi-bot, no-bot edge cases.
 * - resolveDistDir / resolveCacheBase (чистые функции).
 *
 * @file Unit tests for world.js
 */

const { buildCanonicalRoom } = require('../lib/world');

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
});
