'use strict';

/**
 * Unit tests for prepareServer's storage-startup retry.
 *
 * Cover:
 * - retries with a different port after a failed storage startup
 * - no retry when an explicit port is provided
 * - gives up after STORAGE_START_MAX_ATTEMPTS attempts
 *
 * @file Unit tests for prepareServer storage retry
 */

const { prepareServer } = require('../src/lib/runtime/runtime');

jest.mock('@cool-andre/screeps-server-mockup', () => ({
    ScreepsServer: jest.fn(),
}));

jest.mock('../src/lib/runtime/engineSnapshot', () => ({
    ensureEngineSnapshotCompat: jest.fn(async () => {}),
}));

jest.mock('../src/lib/runtime/storageAdapter', () => ({
    createStorageAdapter: jest.fn(() => ({
        world: {
            addRoom: jest.fn(async () => {}),
            getTerrain: jest.fn(async () => ({})),
        },
    })),
}));

const { ScreepsServer } = require('@cool-andre/screeps-server-mockup');

let consoleErrorSpy;

beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    consoleErrorSpy.mockRestore();
});

/**
 * Installs a fake ScreepsServer class whose reset() outcome depends on the
 * construction index (1-based).
 *
 * @param {Object<string, Error|null>} outcomesByAttempt — attempt number → error to throw
 * @returns {void}
 */
function fakeServers(outcomesByAttempt) {
    ScreepsServer.mockImplementation((_opts) => {
        const attempt = ScreepsServer.mock.calls.length;
        const outcome = outcomesByAttempt[attempt];
        const reset = jest.fn();
        if (outcome instanceof Error) {
            reset.mockRejectedValue(outcome);
        } else {
            reset.mockResolvedValue(undefined);
        }
        return {
            world: { reset },
            stop: jest.fn(),
            on: jest.fn(),
            processes: {},
        };
    });
}

describe('prepareServer storage-startup retry', () => {
    test('retries with a different port after a failed storage startup', async () => {
        fakeServers({
            1: new Error('Could not launch the storage process (timeout).'),
            2: null,
        });

        const prepared = await prepareServer({ rooms: ['W0N1'] });

        expect(ScreepsServer).toHaveBeenCalledTimes(2);
        const firstPort = ScreepsServer.mock.calls[0][0].port;
        const secondPort = ScreepsServer.mock.calls[1][0].port;
        expect(firstPort).not.toBe(secondPort);
        expect(prepared.engineWatch).toBeDefined();
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    test('does not retry when an explicit port is provided', async () => {
        fakeServers({ 1: new Error('boom') });

        await expect(prepareServer({ rooms: ['W0N1'], port: 12345 })).rejects.toThrow('boom');

        expect(ScreepsServer).toHaveBeenCalledTimes(1);
        expect(ScreepsServer.mock.calls[0][0].port).toBe(12345);
    });

    test('gives up after three failed attempts and rethrows the last error', async () => {
        fakeServers({
            1: new Error('fail 1'),
            2: new Error('fail 2'),
            3: new Error('fail 3'),
        });

        await expect(prepareServer({ rooms: ['W0N1'] })).rejects.toThrow('fail 3');

        expect(ScreepsServer).toHaveBeenCalledTimes(3);
        expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
    });
});
