'use strict';

/**
 * Integration tests for the viewer UI server.
 *
 * Cover:
 * - SSE endpoint sends correct headers
 * - broadcast sends events to connected clients
 * - Static file serving (index.html)
 * - 404 for unknown routes
 *
 * @file Integration tests for viewer/server.js
 */

const http = require('http');
const { createUiServer } = require('../src/tools/viewer/server');

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * @param {number} port
 * @returns {Promise<string>} response body
 */
function httpGet(port, path = '/') {
    return new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}${path}`, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).toString()));
        }).on('error', reject);
    });
}

/**
 * Connect to the SSE endpoint and collect events.
 *
 * @param {number} port
 * @param {number} [timeout=1000]
 * @returns {Promise<{headers: Object, events: Array<{type:string,data:*}>}>}
 */
function collectSseEvents(port, timeout = 1000) {
    return new Promise((resolve, reject) => {
        const events = [];
        const req = http.get(`http://127.0.0.1:${port}/api/sse`, (res) => {
            let buf = '';
            let currentEvent = '';

            res.on('data', (chunk) => {
                buf += chunk.toString();
                const lines = buf.split('\n');
                buf = lines.pop() || ''; // keep incomplete line

                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        currentEvent = line.slice(7).trim();
                    } else if (line.startsWith('data: ')) {
                        const raw = line.slice(6);
                        try {
                            events.push({ type: currentEvent, data: JSON.parse(raw) });
                        } catch {
                            events.push({ type: currentEvent, data: raw });
                        }
                    }
                }
            });

            const timer = setTimeout(() => {
                req.destroy();
                resolve({ headers: res.headers, events });
            }, timeout);

            res.on('end', () => {
                clearTimeout(timer);
                resolve({ headers: res.headers, events });
            });
        });

        req.on('error', reject);
    });
}

/**
 * Perform an HTTP POST request.
 *
 * @param {number} port
 * @param {string} path
 * @param {Object} [body]
 * @returns {Promise<{status: number, body: string, headers: Object}>}
 */
function httpPost(port, path, body) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : '';
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
            },
            (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () =>
                    resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString(), headers: res.headers }),
                );
            },
        );
        req.on('error', reject);
        req.end(data);
    });
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('UiServer', () => {
    /** @type {import('../src/tools/viewer/server').UiServer} */
    let server;

    afterEach(async () => {
        if (server) {
            await server.close();
            server = null;
        }
    });

    it('starts and listens on the given port', async () => {
        server = await createUiServer({ port: 0 });
        expect(server.port).toBeGreaterThan(0);
        expect(typeof server.port).toBe('number');
    });

    it('serves index.html at GET /', async () => {
        server = await createUiServer({ port: 0 });
        const body = await httpGet(server.port, '/');
        // Should contain the HTML root div
        expect(body).toContain('<div id="root">');
        expect(body).toContain('Screeps Integration Tests');
    });

    it('serves index.html as SPA fallback for unknown routes', async () => {
        server = await createUiServer({ port: 0 });
        const body = await httpGet(server.port, '/some-deep/nested/route');
        expect(body).toContain('<div id="root">');
    });

    it('returns 404 for non-existent static files', async () => {
        server = await createUiServer({ port: 0 });
        const body = await new Promise((resolve, reject) => {
            http.get(`http://127.0.0.1:${server.port}/nonexistent.file`, (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
            }).on('error', reject);
        });
        // Falls back to SPA index.html
        expect(body.status).toBe(200);
    });

    it('SSE endpoint returns correct headers', async () => {
        server = await createUiServer({ port: 0 });
        const { headers } = await collectSseEvents(server.port, 100);
        expect(headers['content-type']).toBe('text/event-stream; charset=utf-8');
        expect(headers['cache-control']).toBe('no-cache, no-transform');
        expect(headers['connection']).toBe('keep-alive');
    });

    it('SSE endpoint sends initial handshake comment', async () => {
        server = await createUiServer({ port: 0 });

        // Collect raw SSE output before any events
        const raw = await new Promise((resolve, reject) => {
            let output = '';
            const req = http.get(`http://127.0.0.1:${server.port}/api/sse`, (res) => {
                res.on('data', (chunk) => {
                    output += chunk.toString();
                    if (output.includes(': connected')) {
                        req.destroy();
                    }
                });
                setTimeout(() => {
                    req.destroy();
                    resolve(output);
                }, 500);
            });
            req.on('error', reject);
        });

        expect(raw).toContain(': connected');
    });

    it('broadcast sends frame to SSE client', async () => {
        server = await createUiServer({ port: 0 });

        // Connect SSE client and wait for the handshake
        const ssePromise = collectSseEvents(server.port, 800);
        await new Promise((r) => setTimeout(r, 200)); // let SSE handshake complete

        // Send a frame via broadcast
        server.broadcast({ gameTime: 1, objects: [{ _id: 'test', type: 'spawn', x: 0, y: 0, room: 'W0N1' }] });

        const { events } = await ssePromise;
        expect(events.length).toBeGreaterThanOrEqual(1);
        const frameEvent = events.find((e) => e.type === 'frame');
        expect(frameEvent).toBeDefined();
        expect(frameEvent.data.gameTime).toBe(1);
        expect(frameEvent.data.objects).toHaveLength(1);
    });

    it('broadcastStart sends start event', async () => {
        server = await createUiServer({ port: 0 });

        const ssePromise = collectSseEvents(server.port, 800);
        await new Promise((r) => setTimeout(r, 200));
        server.broadcastStart('my-scenario', 100);

        const { events } = await ssePromise;
        const startEvent = events.find((e) => e.type === 'start');
        expect(startEvent).toBeDefined();
        expect(startEvent.data.scenario).toBe('my-scenario');
        expect(startEvent.data.maxTicks).toBe(100);
    });

    it('broadcastTerrain sends terrain event', async () => {
        server = await createUiServer({ port: 0 });

        const ssePromise = collectSseEvents(server.port, 800);
        await new Promise((r) => setTimeout(r, 200));
        server.broadcastTerrain({ W0N1: plainsRows() });

        const { events } = await ssePromise;
        const terrainEvent = events.find((e) => e.type === 'terrain');
        expect(terrainEvent).toBeDefined();
        expect(terrainEvent.data.W0N1).toHaveLength(50);
    });

    it('broadcastEnd sends end event', async () => {
        server = await createUiServer({ port: 0 });

        const ssePromise = collectSseEvents(server.port, 800);
        await new Promise((r) => setTimeout(r, 200));
        server.broadcastEnd('pass', 42);

        const { events } = await ssePromise;
        const endEvent = events.find((e) => e.type === 'end');
        expect(endEvent).toBeDefined();
        expect(endEvent.data.reason).toBe('pass');
        expect(endEvent.data.ticksRun).toBe(42);
    });

    it('broadcast to multiple SSE clients', async () => {
        server = await createUiServer({ port: 0 });

        const p1 = collectSseEvents(server.port, 1000);
        const p2 = collectSseEvents(server.port, 1000);

        // Wait for both SSE connections to establish
        await new Promise((r) => setTimeout(r, 250));
        server.broadcast({ gameTime: 99, objects: [] });

        const [{ events: e1 }, { events: e2 }] = await Promise.all([p1, p2]);
        expect(e1.find((e) => e.type === 'frame')).toBeDefined();
        expect(e2.find((e) => e.type === 'frame')).toBeDefined();
    });

    it('/api/scenarios returns empty list (Phase 2 stub)', async () => {
        server = await createUiServer({ port: 0 });
        const body = await httpGet(server.port, '/api/scenarios');
        const parsed = JSON.parse(body);
        expect(parsed).toEqual({ scenarios: [] });
    });

    it('/api/run POST returns not_implemented (Phase 2 stub)', async () => {
        server = await createUiServer({ port: 0 });
        const result = await httpPost(server.port, '/api/run', { scenario: 'test' });
        expect(result.status).toBe(200);
        const parsed = JSON.parse(result.body);
        expect(parsed).toEqual({ status: 'not_implemented' });
    });
});

// ─── Helpers ──────────────────────────────────────────────────────────────

function plainsRows() {
    const rows = [];
    for (let y = 0; y < 50; y++) {
        rows.push('.'.repeat(50));
    }
    return rows;
}
