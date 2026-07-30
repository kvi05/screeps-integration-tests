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
    unregisterRoomFixture,
    loadRoomFixturesFromDir,
    ROOM_FIXTURES,
} = require('../src/lib/fixtures/roomFixture');

const spec = require('../src/lib/builders/spec');

describe('roomFixture', () => {
    beforeEach(() => {
        // Clear registry between tests
        Object.keys(ROOM_FIXTURES).forEach((k) => delete ROOM_FIXTURES[k]);
    });

    describe('registry', () => {
        it('registerRoomFixture adds to registry', () => {
            registerRoomFixture('test1', { controller: spec.controller(), structures: [], creeps: [] });
            expect(hasRoomFixture('test1')).toBe(true);
            expect(getRoomFixture('test1')).toBeDefined();
        });

        it('getRoomFixture returns null for unknown name', () => {
            expect(getRoomFixture('nonexistent')).toBeNull();
        });

        it('hasRoomFixture returns false for unknown name', () => {
            expect(hasRoomFixture('nonexistent')).toBe(false);
        });

        it('loadRoomFixture returns { fixture } or null', () => {
            registerRoomFixture('test2', { controller: spec.controller(), structures: [], creeps: [] });
            const loaded = loadRoomFixture('test2');
            expect(loaded).toEqual({ fixture: expect.any(Object) });
            expect(loadRoomFixture('nonexistent')).toBeNull();
        });
    });

    describe('unregisterRoomFixture', () => {
        it('removes a registered fixture', () => {
            registerRoomFixture('temp', { controller: spec.controller(), structures: [], creeps: [] });
            expect(hasRoomFixture('temp')).toBe(true);

            const result = unregisterRoomFixture('temp');
            expect(result).toBe(true);
            expect(hasRoomFixture('temp')).toBe(false);
            expect(getRoomFixture('temp')).toBeNull();
        });

        it('returns true when fixture existed', () => {
            registerRoomFixture('temp', { controller: spec.controller(), structures: [], creeps: [] });
            expect(unregisterRoomFixture('temp')).toBe(true);
        });

        it('returns false for unknown name (silent no-op)', () => {
            expect(unregisterRoomFixture('nonexistent')).toBe(false);
        });

        it('does not throw for unknown name', () => {
            expect(() => unregisterRoomFixture('nonexistent')).not.toThrow();
        });

        it('does not affect other registered fixtures', () => {
            registerRoomFixture('keep', { controller: spec.controller(), structures: [], creeps: [] });
            registerRoomFixture('remove', { controller: spec.controller(), structures: [], creeps: [] });

            unregisterRoomFixture('remove');

            expect(hasRoomFixture('keep')).toBe(true);
            expect(hasRoomFixture('remove')).toBe(false);
        });

        it('double unregister is safe (returns false on second call)', () => {
            registerRoomFixture('once', { controller: spec.controller(), structures: [], creeps: [] });
            expect(unregisterRoomFixture('once')).toBe(true);
            expect(unregisterRoomFixture('once')).toBe(false);
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

        it('returns a new object with empty overrides', () => {
            const f = baseFixture();
            const result = applyRoomOverrides(f, {});
            expect(result).not.toBe(f);
            expect(result.structures).not.toBe(f.structures);
            expect(result.creeps).not.toBe(f.creeps);
        });

        it('does not mutate the original fixture', () => {
            const f = baseFixture();
            applyRoomOverrides(f, { exclude: ['spawn1'] });
            expect(f.structures).toHaveLength(3);
        });

        describe('exclude', () => {
            it('removes structure by id (string)', () => {
                const result = applyRoomOverrides(baseFixture(), { exclude: ['tower1'] });
                expect(result.structures).toHaveLength(2);
                expect(result.structures.find((s) => s.type === 'tower')).toBeUndefined();
            });

            it('removes structure by type (string)', () => {
                const result = applyRoomOverrides(baseFixture(), { exclude: ['extension'] });
                expect(result.structures).toHaveLength(2);
                expect(result.structures.find((s) => s.type === 'extension')).toBeUndefined();
            });

            it('removes structure by object { id }', () => {
                const result = applyRoomOverrides(baseFixture(), { exclude: [{ id: 'spawn1' }] });
                expect(result.structures).toHaveLength(2);
            });

            it('removes structure by object { type }', () => {
                const result = applyRoomOverrides(baseFixture(), { exclude: [{ type: 'spawn' }] });
                expect(result.structures).toHaveLength(2);
            });

            it('removes multiple structures', () => {
                const result = applyRoomOverrides(baseFixture(), { exclude: ['tower1', 'ext1'] });
                expect(result.structures).toHaveLength(1);
                expect(result.structures[0].id).toBe('spawn1');
            });
        });

        describe('controller overrides', () => {
            it('merges controller', () => {
                const result = applyRoomOverrides(baseFixture(), { controller: { safeMode: 20000 } });
                expect(result.controller.safeMode).toBe(20000);
                expect(result.controller.level).toBe(3);
            });

            it('does not change controller if override is empty', () => {
                const f = baseFixture();
                const result = applyRoomOverrides(f, {});
                expect(result.controller).toBe(f.controller);
            });
        });

        describe('structures overrides', () => {
            it('overrides by id', () => {
                const result = applyRoomOverrides(baseFixture(), {
                    structures: [spec.tower(26, 24, { id: 'tower1', hits: 1000 })],
                });
                const tower = result.structures.find((s) => s.id === 'tower1');
                expect(tower.hits).toBe(1000);
            });

            it('overrides by type+x+y', () => {
                const result = applyRoomOverrides(baseFixture(), {
                    structures: [spec.structure('extension', 27, 24, { hits: 500 })],
                });
                const ext = result.structures.find((s) => s.id === 'ext1');
                expect(ext.hits).toBe(500);
            });

            it('does not add a new structure when no match', () => {
                const result = applyRoomOverrides(baseFixture(), {
                    structures: [spec.extension(99, 99, { hits: 100 })],
                });
                expect(result.structures).toHaveLength(3);
            });
        });

        describe('append', () => {
            it('adds new structures', () => {
                const result = applyRoomOverrides(baseFixture(), {
                    append: [spec.container(30, 30), spec.road(29, 29)],
                });
                expect(result.structures).toHaveLength(5);
            });
        });

        describe('creeps', () => {
            it('adds creeps to empty creeps', () => {
                const f = baseFixture();
                const result = applyRoomOverrides(f, {
                    creeps: [spec.creep(10, 10)],
                });
                expect(result.creeps).toHaveLength(1);
            });

            it('adds creeps to existing ones', () => {
                const f = baseFixture();
                f.creeps = [spec.creep(10, 10)];
                const result = applyRoomOverrides(f, {
                    creeps: [spec.creep(20, 20)],
                });
                expect(result.creeps).toHaveLength(2);
            });
        });

        describe('hostiles', () => {
            it('adds hostiles', () => {
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

        it('registers fixture from file with registerRoomFixture', () => {
            const filePath = path.join(tmpDir, 'my-room.room.js');
            const roomFixturePath = require.resolve('../src/lib/fixtures/roomFixture');
            const specPath = require.resolve('../src/lib/builders/spec');
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

        it('skips non-js files', () => {
            fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# ignore');
            expect(() => loadRoomFixturesFromDir(tmpDir)).not.toThrow();
        });

        it('does nothing if directory does not exist', () => {
            expect(() => loadRoomFixturesFromDir(path.join(tmpDir, 'nonexistent'))).not.toThrow();
        });
    });
});
