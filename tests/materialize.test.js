'use strict';

const { materializeCreep } = require('../src/lib/builders/materialize');

describe('materializeCreep', () => {
    /** @type {import('../src/lib/runtime/storageAdapter').StorageAdapter} */
    let adapter;

    beforeEach(() => {
        adapter = {
            db: {
                'rooms.objects': {
                    insert: jest.fn().mockResolvedValue({ _id: 'creep-1' }),
                },
            },
        };
    });

    it('writes store, storeCapacity and storeCapacityResource from spec', async () => {
        const spec = {
            x: 10,
            y: 20,
            userId: 'bot1',
            body: [
                { type: 'carry', hits: 100 },
                { type: 'move', hits: 100 },
            ],
            hits: 200,
            hitsMax: 200,
            store: { energy: 50 },
            storeCapacity: 50,
            storeCapacityResource: { energy: 50 },
        };

        await materializeCreep(adapter, 'W0N1', spec);

        expect(adapter.db['rooms.objects'].insert).toHaveBeenCalledWith(
            expect.objectContaining({
                room: 'W0N1',
                type: 'creep',
                x: 10,
                y: 20,
                user: 'bot1',
                body: [
                    { type: 'carry', hits: 100 },
                    { type: 'move', hits: 100 },
                ],
                hits: 200,
                hitsMax: 200,
                store: { energy: 50 },
                storeCapacity: 50,
                storeCapacityResource: { energy: 50 },
                spawning: null,
                fatigue: 0,
                notifyWhenAttacked: true,
            }),
        );
    });

    it('does not set storeCapacityResource when spec has none', async () => {
        const spec = {
            x: 5,
            y: 5,
            userId: 'bot1',
            body: [{ type: 'work', hits: 150 }],
            hits: 150,
            hitsMax: 150,
            store: { energy: 0 },
            storeCapacity: 0,
        };

        await materializeCreep(adapter, 'W0N1', spec);

        const callArg = adapter.db['rooms.objects'].insert.mock.calls[0][0];
        expect(callArg.storeCapacityResource).toBeUndefined();
        expect(callArg.store).toEqual({ energy: 0 });
        expect(callArg.storeCapacity).toBe(0);
    });

    it('writes custom _id when spec.id is set', async () => {
        const spec = {
            x: 10,
            y: 10,
            userId: 'bot1',
            body: [{ type: 'move', hits: 100 }],
            hits: 100,
            hitsMax: 100,
            store: { energy: 0 },
            storeCapacity: 0,
            id: 'my-custom-creep-id',
        };

        await materializeCreep(adapter, 'W0N1', spec);

        expect(adapter.db['rooms.objects'].insert).toHaveBeenCalledWith(
            expect.objectContaining({ _id: 'my-custom-creep-id' }),
        );
    });

    it('generates a name when none is provided', async () => {
        const spec = {
            x: 10,
            y: 10,
            userId: 'bot1',
            body: [{ type: 'move', hits: 100 }],
            hits: 100,
            hitsMax: 100,
            store: { energy: 0 },
            storeCapacity: 0,
        };

        await materializeCreep(adapter, 'W0N1', spec);

        const callArg = adapter.db['rooms.objects'].insert.mock.calls[0][0];
        expect(callArg.name).toBeDefined();
        expect(typeof callArg.name).toBe('string');
        expect(callArg.name).toMatch(/^Creep_/);
    });

    it('throws if body is missing or empty', async () => {
        const spec = {
            x: 10,
            y: 10,
            userId: 'bot1',
            hits: 100,
            hitsMax: 100,
            store: { energy: 0 },
            storeCapacity: 0,
        };

        await expect(materializeCreep(adapter, 'W0N1', spec)).rejects.toThrow(/spec.body is required/);

        await expect(materializeCreep(adapter, 'W0N1', { ...spec, body: [] })).rejects.toThrow(/spec.body is required/);
    });
});
