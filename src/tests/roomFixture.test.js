'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const {
    getRoomFixture,
    hasRoomFixture,
    loadRoomFixture,
    applyRoomOverrides,
    registerRoomFixture,
    loadRoomFixturesFromDir,
    ROOM_FIXTURES,
} = require('../lib/fixtures/roomFixture');

const spec = require('../lib/builders/spec');

describe('roomFixture', () => {
    beforeEach(() => {
        // Очистка registry между тестами
        Object.keys(ROOM_FIXTURES).forEach((k) => delete ROOM_FIXTURES[k]);
    });

    describe('registry', () => {
        it('registerRoomFixture добавляет в registry', () => {
            registerRoomFixture('test1', { controller: spec.controller(), structures: [], creeps: [] });
            expect(hasRoomFixture('test1')).toBe(true);
            expect(getRoomFixture('test1')).toBeDefined();
        });

        it('getRoomFixture возвращает null для неизвестного имени', () => {
            expect(getRoomFixture('nonexistent')).toBeNull();
        });

        it('hasRoomFixture возвращает false для неизвестного имени', () => {
            expect(hasRoomFixture('nonexistent')).toBe(false);
        });

        it('loadRoomFixture возвращает { fixture } или null', () => {
            registerRoomFixture('test2', { controller: spec.controller(), structures: [], creeps: [] });
            const loaded = loadRoomFixture('test2');
            expect(loaded).toEqual({ fixture: expect.any(Object) });
            expect(loadRoomFixture('nonexistent')).toBeNull();
        });
    });

    describe('applyRoomOverrides', () => {
        const baseFixture = () => ({
            controller: spec.controller({ level: 3, id: 'ctrl1' }),
            sources: [spec.source(15, 15), spec.source(35, 35)],
            structures: [
                spec.spawn(25, 25, { id: 'spawn1' }),
                spec.tower(26, 24, { id: 'tower1' }),
                spec.extension(27, 24, { id: 'ext1' }),
            ],
            creeps: [],
        });

        it('возвращает новый объект при пустых overrides', () => {
            const f = baseFixture();
            const result = applyRoomOverrides(f, {});
            expect(result).not.toBe(f);
            expect(result.structures).not.toBe(f.structures);
            expect(result.creeps).not.toBe(f.creeps);
        });

        it('не мутирует исходный fixture', () => {
            const f = baseFixture();
            applyRoomOverrides(f, { exclude: ['spawn1'] });
            expect(f.structures).toHaveLength(3);
        });

        describe('exclude', () => {
            it('удаляет структуру по id (строка)', () => {
                const result = applyRoomOverrides(baseFixture(), { exclude: ['tower1'] });
                expect(result.structures).toHaveLength(2);
                expect(result.structures.find((s) => s.type === 'tower')).toBeUndefined();
            });

            it('удаляет структуру по type (строка)', () => {
                const result = applyRoomOverrides(baseFixture(), { exclude: ['extension'] });
                expect(result.structures).toHaveLength(2);
                expect(result.structures.find((s) => s.type === 'extension')).toBeUndefined();
            });

            it('удаляет структуру по объекту { id }', () => {
                const result = applyRoomOverrides(baseFixture(), { exclude: [{ id: 'spawn1' }] });
                expect(result.structures).toHaveLength(2);
            });

            it('удаляет структуру по объекту { type }', () => {
                const result = applyRoomOverrides(baseFixture(), { exclude: [{ type: 'spawn' }] });
                expect(result.structures).toHaveLength(2);
            });

            it('удаляет несколько структур', () => {
                const result = applyRoomOverrides(baseFixture(), { exclude: ['tower1', 'ext1'] });
                expect(result.structures).toHaveLength(1);
                expect(result.structures[0].id).toBe('spawn1');
            });
        });

        describe('controller overrides', () => {
            it('мержит controller', () => {
                const result = applyRoomOverrides(baseFixture(), { controller: { safeMode: 20000 } });
                expect(result.controller.safeMode).toBe(20000);
                expect(result.controller.level).toBe(3);
            });

            it('не меняет controller если override пустой', () => {
                const f = baseFixture();
                const result = applyRoomOverrides(f, {});
                expect(result.controller).toBe(f.controller);
            });
        });

        describe('structures overrides', () => {
            it('переопределяет по id', () => {
                const result = applyRoomOverrides(baseFixture(), {
                    structures: [spec.tower(26, 24, { id: 'tower1', hits: 1000 })],
                });
                const tower = result.structures.find((s) => s.id === 'tower1');
                expect(tower.hits).toBe(1000);
            });

            it('переопределяет по type+x+y', () => {
                const result = applyRoomOverrides(baseFixture(), {
                    structures: [spec.structure('extension', 27, 24, { hits: 500 })],
                });
                const ext = result.structures.find((s) => s.id === 'ext1');
                expect(ext.hits).toBe(500);
            });

            it('не добавляет новую структуру при отсутствии совпадения', () => {
                const result = applyRoomOverrides(baseFixture(), {
                    structures: [spec.extension(99, 99, { hits: 100 })],
                });
                expect(result.structures).toHaveLength(3);
            });
        });

        describe('append', () => {
            it('добавляет новые структуры', () => {
                const result = applyRoomOverrides(baseFixture(), {
                    append: [spec.container(30, 30), spec.road(29, 29)],
                });
                expect(result.structures).toHaveLength(5);
            });
        });

        describe('creeps', () => {
            it('добавляет крипов к пустым creeps', () => {
                const f = baseFixture();
                const result = applyRoomOverrides(f, {
                    creeps: [spec.creep(10, 10)],
                });
                expect(result.creeps).toHaveLength(1);
            });

            it('добавляет крипов к существующим', () => {
                const f = baseFixture();
                f.creeps = [spec.creep(10, 10)];
                const result = applyRoomOverrides(f, {
                    creeps: [spec.creep(20, 20)],
                });
                expect(result.creeps).toHaveLength(2);
            });
        });

        describe('hostiles', () => {
            it('добавляет hostiles', () => {
                const result = applyRoomOverrides(baseFixture(), {
                    hostiles: [spec.invader(40, 40)],
                });
                expect(result.hostiles).toHaveLength(1);
                expect(result.hostiles[0].userId).toBe('2');
            });
        });
    });

    describe('loadRoomFixturesFromDir', () => {
        let tmpDir;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roomfixture-test-'));
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('регистрирует fixture из файла с registerRoomFixture', () => {
            const filePath = path.join(tmpDir, 'my-room.room.js');
            const roomFixturePath = require.resolve('../lib/fixtures/roomFixture');
            const specPath = require.resolve('../lib/builders/spec');
            fs.writeFileSync(
                filePath,
                `
'use strict';
const spec = require('${specPath.replace(/\\/g, '/')}');
const { registerRoomFixture } = require('${roomFixturePath.replace(/\\/g, '/')}');
registerRoomFixture('auto-room', {
    controller: spec.controller({ level: 2 }),
    sources: [spec.source(15, 15)],
    structures: [spec.spawn(25, 25)],
    creeps: [],
});
`,
            );

            loadRoomFixturesFromDir(tmpDir);
            expect(hasRoomFixture('auto-room')).toBe(true);
        });

        it('пропускает не-js файлы', () => {
            fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# ignore');
            expect(() => loadRoomFixturesFromDir(tmpDir)).not.toThrow();
        });

        it('ничего не делает если директории нет', () => {
            expect(() => loadRoomFixturesFromDir(path.join(tmpDir, 'nonexistent'))).not.toThrow();
        });
    });
});
