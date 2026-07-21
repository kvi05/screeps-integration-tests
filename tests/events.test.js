'use strict';

/**
 * Unit tests for events.js — event registry factory and default handlers.
 *
 * Cover:
 * - createEventRegistry: register + dispatch lifecycle
 * - registerDefaultEvents: spawnInvader, spawnCreep
 * - dispatch: matching tick, non-matching tick, missing action
 * - handler receives (adapter, room, params)
 *
 * @file Unit tests for events.js
 */

const { createEventRegistry, registerDefaultEvents } = require('../src/lib/orchestration/events');

describe('createEventRegistry', () => {
    it('returns { register, dispatch }', () => {
        const registry = createEventRegistry();
        expect(registry).toHaveProperty('register');
        expect(registry).toHaveProperty('dispatch');
        expect(typeof registry.register).toBe('function');
        expect(typeof registry.dispatch).toBe('function');
    });

    describe('register + dispatch', () => {
        it('calls handler when atTick matches tickNum', async () => {
            const { register, dispatch } = createEventRegistry();
            const handler = jest.fn();

            register('testAction', handler);
            await dispatch([{ action: 'testAction', atTick: 5, room: 'W0N1' }], 5, {});

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith({}, 'W0N1', {});
        });

        it('does NOT call handler when atTick does NOT match tickNum', async () => {
            const { register, dispatch } = createEventRegistry();
            const handler = jest.fn();

            register('testAction', handler);
            await dispatch([{ action: 'testAction', atTick: 5, room: 'W0N1' }], 10, {});

            expect(handler).not.toHaveBeenCalled();
        });

        it('does NOT call handler for unknown action', async () => {
            const { dispatch } = createEventRegistry();
            // No handler registered for 'unknown'

            // Should not throw
            await expect(
                dispatch([{ action: 'unknown', atTick: 3, room: 'W0N1' }], 3, {}),
            ).resolves.toBeUndefined();
        });

        it('passes params to handler', async () => {
            const { register, dispatch } = createEventRegistry();
            const handler = jest.fn();

            register('testAction', handler);
            await dispatch(
                [{ action: 'testAction', atTick: 7, room: 'W1N1', params: { x: 15, y: 20 } }],
                7,
                { db: {} },
            );

            expect(handler).toHaveBeenCalledWith({ db: {} }, 'W1N1', { x: 15, y: 20 });
        });

        it('handles multiple events in the same tick', async () => {
            const { register, dispatch } = createEventRegistry();
            const handlerA = jest.fn();
            const handlerB = jest.fn();

            register('actionA', handlerA);
            register('actionB', handlerB);
            await dispatch(
                [
                    { action: 'actionA', atTick: 3, room: 'W0N1' },
                    { action: 'actionB', atTick: 3, room: 'W0N2' },
                ],
                3,
                {},
            );

            expect(handlerA).toHaveBeenCalledTimes(1);
            expect(handlerB).toHaveBeenCalledTimes(1);
        });

        it('handles multiple events — only matching tick fires', async () => {
            const { register, dispatch } = createEventRegistry();
            const handler = jest.fn();

            register('testAction', handler);
            await dispatch(
                [
                    { action: 'testAction', atTick: 5, room: 'W0N1' },
                    { action: 'testAction', atTick: 10, room: 'W0N2' },
                ],
                5,
                {},
            );

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith({}, 'W0N1', {});
        });

        it('does nothing when scheduledEvents is undefined', async () => {
            const { dispatch } = createEventRegistry();
            await expect(dispatch(undefined, 0, {})).resolves.toBeUndefined();
        });

        it('does nothing when scheduledEvents is null', async () => {
            const { dispatch } = createEventRegistry();
            await expect(dispatch(null, 0, {})).resolves.toBeUndefined();
        });
    });
});

describe('registerDefaultEvents', () => {
    it('registers spawnInvader and spawnCreep', () => {
        const { register } = createEventRegistry();
        const mockRegister = jest.fn(register);

        registerDefaultEvents({ register: mockRegister });

        expect(mockRegister).toHaveBeenCalledWith('spawnInvader', expect.any(Function));
        expect(mockRegister).toHaveBeenCalledWith('spawnCreep', expect.any(Function));
    });

    it('spawnInvader handler is callable via dispatch (integration-ready)', async () => {
        const registry = createEventRegistry();
        registerDefaultEvents(registry);

        // Minimal adapter so materializeCreep can insert
        const adapter = {
            db: {
                'rooms.objects': {
                    insert: jest.fn().mockResolvedValue({ _id: 'invader-1' }),
                },
            },
        };

        await expect(
            registry.dispatch(
                [{ action: 'spawnInvader', atTick: 1, room: 'W0N1', params: { body: [{ type: 'attack', hits: 100 }] } }],
                1,
                adapter,
            ),
        ).resolves.toBeUndefined();

        // Verify that materializeCreep was called (insert into rooms.objects)
        expect(adapter.db['rooms.objects'].insert).toHaveBeenCalled();
    });
});
