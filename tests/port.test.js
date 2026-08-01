'use strict';

/**
 * Unit tests for port.js — getFreePort.
 *
 * Cover:
 * - getFreePort resolves to a valid TCP port (1-65535)
 * - the returned port is actually bindable on 127.0.0.1
 * - consecutive calls return distinct, bindable ports
 *
 * @file Unit tests for port.js
 */

const net = require('net');
const { getFreePort } = require('../src/lib/runtime/port');

// ─── Helpers ──────────────────────────────────────────────────────────────

function canBind(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.listen(port, '127.0.0.1', () => {
            server.close(() => resolve(true));
        });
    });
}

// ─── getFreePort ──────────────────────────────────────────────────────────

describe('getFreePort', () => {
    it('resolves to a valid port number', async () => {
        const port = await getFreePort();
        expect(port).toEqual(expect.any(Number));
        expect(port).toBeGreaterThanOrEqual(1);
        expect(port).toBeLessThanOrEqual(65535);
    });

    it('returns a port bindable on 127.0.0.1', async () => {
        const port = await getFreePort();
        expect(await canBind(port)).toBe(true);
    });

    it('returns distinct ports across consecutive calls', async () => {
        const [a, b, c] = await Promise.all([getFreePort(), getFreePort(), getFreePort()]);
        const unique = new Set([a, b, c]);
        expect(unique.size).toBe(3);
    });
});
