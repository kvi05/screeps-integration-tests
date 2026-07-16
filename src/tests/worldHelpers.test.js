'use strict';

const { createWorldHelpers } = require('../lib/worldHelpers');

// Мокаем materializeStructure, чтобы не трогать реальную БД.
jest.mock('../lib/builders/materialize', () => ({
    materializeStructure: jest.fn(() => Promise.resolve('mocked_structure_id')),
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

// ─── Fake server ─────────────────────────────────────────────────────────────

function createFakeServer(objects) {
    const envGet = jest.fn((key) => {
        if (key === 'gameTime') return Promise.resolve('10000');
        return Promise.resolve(null);
    });
    return {
        common: {
            storage: {
                db: {
                    'rooms.objects': createFakeCollection(objects),
                },
                env: {
                    keys: { GAMETIME: 'gameTime' },
                    get: envGet,
                },
            },
        },
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

describe('createWorldHelpers', () => {
    /** @type {Object} */
    let helpers;
    /** @type {ScreepsServer} */
    let server;

    const defaultBotUserId = 'bot_123';

    // Стартовые объекты БД
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
        server = createFakeServer([controller, wall, tower, source]);
        helpers = createWorldHelpers(server, defaultBotUserId);
    });

    // ─── setTicksToDowngrade ────────────────────────────────────────────────

    describe('setTicksToDowngrade', () => {
        it('устанавливает downgradeTime = gameTime + ticks', async () => {
            await helpers.setTicksToDowngrade('W0N1', 4000);
            const ctrl = server.common.storage.db['rooms.objects'].findOne({ _id: 'ctrl_1' });
            await expect(ctrl).resolves.toMatchObject({ downgradeTime: 14000 });
        });

        it('при null сбрасывает downgradeTime в null', async () => {
            await helpers.setTicksToDowngrade('W0N1', null);
            const ctrl = server.common.storage.db['rooms.objects'].findOne({ _id: 'ctrl_1' });
            await expect(ctrl).resolves.toMatchObject({ downgradeTime: null });
        });

        it('бросает ошибку если контроллер не найден', async () => {
            await expect(helpers.setTicksToDowngrade('W0N2', 1000)).rejects.toThrow(
                'контроллер в комнате "W0N2" не найден',
            );
        });

        it('бросает ошибку при отрицательном ticks', async () => {
            await expect(helpers.setTicksToDowngrade('W0N1', -1)).rejects.toThrow('ticks должен быть >= 0 или null');
        });
    });

    // ─── setHitsStructure ──────────────────────────────────────────────────

    describe('setHitsStructure', () => {
        it('устанавливает hits (строка _id)', async () => {
            await helpers.setHitsStructure('wall_1', 500000);
            const obj = await server.common.storage.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj.hits).toBe(500000);
        });

        it('clamp по hitsMax', async () => {
            await helpers.setHitsStructure('tower_1', 5000);
            const obj = await server.common.storage.db['rooms.objects'].findOne({ _id: 'tower_1' });
            expect(obj.hits).toBe(3000);
        });

        it('принимает объект с полем _id', async () => {
            await helpers.setHitsStructure({ _id: 'wall_1' }, 777);
            const obj = await server.common.storage.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj.hits).toBe(777);
        });

        it('принимает объект с полем id', async () => {
            await helpers.setHitsStructure({ id: 'wall_1' }, 888);
            const obj = await server.common.storage.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj.hits).toBe(888);
        });

        it('бросает ошибку если объект не найден', async () => {
            await expect(helpers.setHitsStructure('nonexistent', 100)).rejects.toThrow(
                'объект с _id "nonexistent" не найден',
            );
        });

        it('бросает ошибку если hits отрицательный', async () => {
            await expect(helpers.setHitsStructure('wall_1', -10)).rejects.toThrow('hits должен быть >= 0');
        });
    });

    // ─── damageHitsStructure ────────────────────────────────────────────────

    describe('damageHitsStructure', () => {
        it('вычитает amount из hits', async () => {
            await helpers.damageHitsStructure('wall_1', 500);
            const obj = await server.common.storage.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj.hits).toBe(99500);
        });

        it('не опускается ниже 0', async () => {
            await helpers.damageHitsStructure('wall_1', 999999);
            const obj = await server.common.storage.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj.hits).toBe(0);
        });

        it('бросает ошибку если объект не найден', async () => {
            await expect(helpers.damageHitsStructure('nonexistent', 10)).rejects.toThrow('не найден');
        });
    });

    // ─── deleteStructure ────────────────────────────────────────────────────

    describe('deleteStructure', () => {
        it('удаляет объект из БД', async () => {
            await helpers.deleteStructure('wall_1');
            const obj = await server.common.storage.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj).toBeNull();
        });

        it('принимает объект с полем id', async () => {
            await helpers.deleteStructure({ id: 'wall_1' });
            const obj = await server.common.storage.db['rooms.objects'].findOne({ _id: 'wall_1' });
            expect(obj).toBeNull();
        });

        it('бросает ошибку если объект не найден', async () => {
            await expect(helpers.deleteStructure('nonexistent')).rejects.toThrow('не найден');
        });
    });

    // ─── createStructure ─────────────────────────────────────────────────────

    describe('createStructure', () => {
        it('вызывает materializeStructure с spec и defaultBotUserId', async () => {
            const { materializeStructure } = require('../lib/builders/materialize');
            const spec = { type: 'tower', x: 25, y: 25, roomName: 'W0N1' };
            const id = await helpers.createStructure(spec);
            expect(id).toBe('mocked_structure_id');
            expect(materializeStructure).toHaveBeenCalledWith(
                server,
                'W0N1',
                expect.objectContaining({ userId: defaultBotUserId }),
            );
        });

        it('не переопределяет явный userId', async () => {
            const { materializeStructure } = require('../lib/builders/materialize');
            const spec = { type: 'tower', x: 30, y: 30, roomName: 'W0N1', userId: 'custom' };
            await helpers.createStructure(spec);
            expect(materializeStructure).toHaveBeenCalledWith(
                server,
                'W0N1',
                expect.objectContaining({ userId: 'custom' }),
            );
        });

        it('бросает ошибку если roomName не указан', async () => {
            await expect(helpers.createStructure({ type: 'wall', x: 5, y: 5 })).rejects.toThrow(
                'createStructure: spec.roomName обязателен',
            );
        });
    });

    // ─── find / findOne / findIds / findId ────────────────────────────────

    describe('find', () => {
        it('возвращает массив объектов с id (alias _id)', async () => {
            const docs = await helpers.find({ room: 'W0N1' });
            expect(docs.length).toBeGreaterThanOrEqual(4);
            expect(docs[0]).toHaveProperty('id');
            expect(docs[0].id).toBe(docs[0]._id);
        });

        it('мапит userId → user', async () => {
            const docs = await helpers.find({ userId: defaultBotUserId });
            expect(docs.length).toBe(1);
            expect(docs[0]._id).toBe('tower_1');
        });
    });

    describe('findOne', () => {
        it('возвращает первый подходящий объект', async () => {
            const doc = await helpers.findOne({ room: 'W0N1', type: 'tower' });
            expect(doc).not.toBeNull();
            expect(doc._id).toBe('tower_1');
            expect(doc.id).toBe('tower_1');
        });

        it('с опцией index возвращает N-й объект', async () => {
            const doc = await helpers.findOne({ room: 'W0N1', type: 'source' }, { index: 0 });
            expect(doc._id).toBe('src_1');
        });

        it('index вне границ возвращает null', async () => {
            const doc = await helpers.findOne({ room: 'W0N1', type: 'source' }, { index: 10 });
            expect(doc).toBeNull();
        });

        it('возвращает null если ничего не найдено', async () => {
            const doc = await helpers.findOne({ room: 'W0N1', type: 'invalid' });
            expect(doc).toBeNull();
        });
    });

    describe('findIds', () => {
        it('возвращает массив _id', async () => {
            const ids = await helpers.findIds({ room: 'W0N1', type: 'source' });
            expect(ids).toEqual(['src_1']);
        });

        it('мапит id → _id', async () => {
            const ids = await helpers.findIds({ id: 'tower_1' });
            expect(ids).toEqual(['tower_1']);
        });
    });

    describe('findId', () => {
        it('возвращает _id первого подходящего объекта', async () => {
            const id = await helpers.findId({ room: 'W0N1', type: 'tower' });
            expect(id).toBe('tower_1');
        });

        it('с опцией index возвращает N-й _id', async () => {
            const id = await helpers.findId({ room: 'W0N1', type: 'source' }, { index: 0 });
            expect(id).toBe('src_1');
        });

        it('index вне границ возвращает null', async () => {
            const id = await helpers.findId({ room: 'W0N1' }, { index: 100 });
            expect(id).toBeNull();
        });

        it('возвращает null если ничего не найдено', async () => {
            const id = await helpers.findId({ room: 'W0N1', type: 'invalid' });
            expect(id).toBeNull();
        });
    });
});
