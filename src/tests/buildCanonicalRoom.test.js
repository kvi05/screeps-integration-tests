'use strict';

/**
 * Юнит-тесты для buildCanonicalRoom — проверяют корректность сборки
 * канонической спецификации комнаты из fixture + overrides.
 *
 * Покрывают регрессии:
 * - `.map(applyDefaults)` без передачи индекса массива в userInvader
 *   (index 1 → truthy → userId='2' для обычных структур)
 * - hostiles получают userId='2' (Invader), остальные — defaultBotUserId
 * - roomName проставляется в каждый объект
 *
 * @file Unit tests for buildCanonicalRoom.
 */

const { buildCanonicalRoom } = require('../lib/world');
const { applyRoomOverrides } = require('../lib/fixtures/roomFixture');
const spec = require('../lib/builders/spec');

describe('buildCanonicalRoom', () => {
    describe('inline-поля (без fixture)', () => {
        it('проставляет roomName и defaultBotUserId в структуры', async () => {
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

        it('не подставляет индекс массива в userInvader (регрессия .map)', async () => {
            // Баг: .map(applyDefaults) передаёт (item, index, array) в applyDefaults.
            // index=1 (truthy) → userInvader=1 → userId='2' для tower (элемент #2).
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    structures: [spec.spawn(25, 25), spec.tower(26, 24), spec.extension(27, 24)],
                },
                'W0N1',
                'bot456',
            );

            // Все структуры должны иметь userId бота, не '2' (Invader)
            for (const s of canonical.structures) {
                expect(s.userId).toBe('bot456');
            }
        });

        it('проставляет userId=2 для hostiles', async () => {
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
            // structures не заражаются userId='2'
            expect(canonical.structures[0].userId).toBe('bot789');
        });

        it('controller без userId получает defaultBotUserId', async () => {
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
        it('сохраняет level контроллера из fixture', async () => {
            const canonical = await buildCanonicalRoom(
                { name: 'W0N1', roomFixture: 'rcl3-stable' },
                'W0N1',
                'botFixture',
            );

            expect(canonical.controller).toBeDefined();
            expect(canonical.controller.level).toBe(3);
            expect(canonical.structures.length).toBeGreaterThan(10);
        });

        it('tower из fixture получает bot userId, не Invader', async () => {
            const canonical = await buildCanonicalRoom({ name: 'W0N1', roomFixture: 'rcl3-stable' }, 'W0N1', 'botFix2');

            const tower = canonical.structures.find((s) => s.type === 'tower');
            expect(tower).toBeDefined();
            expect(tower.userId).toBe('botFix2');
        });

        it('overrides.hostiles добавляет invader с userId=2', async () => {
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
            // structures остаются с bot userId
            const tower = canonical.structures.find((s) => s.type === 'tower');
            expect(tower.userId).toBe('botOver');
        });
    });

    describe('applyRoomOverrides', () => {
        it('возвращает новый объект при пустых overrides', () => {
            const fixture = {
                controller: spec.controller({ level: 3 }),
                sources: [spec.source(15, 15)],
                structures: [spec.spawn(25, 25)],
                creeps: [],
            };

            const result = applyRoomOverrides(fixture, {});

            // новый объект
            expect(result).not.toBe(fixture);
            // новый массив structures
            expect(result.structures).not.toBe(fixture.structures);
            // новый массив creeps
            expect(result.creeps).not.toBe(fixture.creeps);
            // но controller — та же ссылка (не переопределён)
            expect(result.controller).toBe(fixture.controller);
            // sources — та же ссылка (не копируется)
            expect(result.sources).toBe(fixture.sources);
        });

        it('возвращает новый объект при undefined overrides', () => {
            const fixture = { structures: [spec.spawn(25, 25)], creeps: [] };
            const result = applyRoomOverrides(fixture);

            expect(result).not.toBe(fixture);
            expect(result.structures).not.toBe(fixture.structures);
            expect(result.creeps).not.toBe(fixture.creeps);
        });

        it('копия не мутирует исходный fixture при мутации результата', () => {
            const fixture = {
                structures: [spec.spawn(25, 25)],
                creeps: [],
            };

            const result = applyRoomOverrides(fixture, {});
            result.structures.push(spec.tower(26, 24));

            expect(fixture.structures).toHaveLength(1);
            expect(result.structures).toHaveLength(2);
        });

        it('сохраняет id и x/y контроллера после overrides', () => {
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

    describe('controller в canonical', () => {
        it('передаёт id контроллера из inline spec', async () => {
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

        it('контроллер optional — может отсутствовать', async () => {
            const canonical = await buildCanonicalRoom(
                { name: 'W0N1', structures: [spec.spawn(25, 25)] },
                'W0N1',
                'botId',
            );

            expect(canonical.controller).toBeUndefined();
        });

        it('id контроллера не влияет на привязку userId (userId !== undefined)', async () => {
            const canonical = await buildCanonicalRoom(
                {
                    name: 'W0N1',
                    controller: spec.controller({ id: 'ctrl_1', level: 1, userId: undefined }),
                },
                'W0N1',
                'defaultBot',
            );

            // При undefined userId — fallback на defaultBotUserId
            expect(canonical.controller.userId).toBe('defaultBot');
        });
    });
});
