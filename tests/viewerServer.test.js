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
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { createUiServer, getOpenCommand } = require('../src/tools/viewer/server');

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * @param {number} port
 * @returns {Promise<string>} response body
 */
function httpGet(port, urlPath = '/') {
    return new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
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
function collectSseEvents(port, timeout = 300) {
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
function httpPost(port, urlPath, body) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : '';
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path: urlPath,
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
        const { headers } = await collectSseEvents(server.port, 50);
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
                }, 100);
            });
            req.on('error', reject);
        });

        expect(raw).toContain(': connected');
    });

    it('broadcast sends frame to SSE client', async () => {
        server = await createUiServer({ port: 0 });

        // Connect SSE client and wait for the handshake
        const ssePromise = collectSseEvents(server.port, 300);
        await new Promise((r) => setTimeout(r, 30)); // let SSE handshake complete

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

        const ssePromise = collectSseEvents(server.port, 300);
        await new Promise((r) => setTimeout(r, 30));
        server.broadcastStart('my-scenario', 100);

        const { events } = await ssePromise;
        const startEvent = events.find((e) => e.type === 'start');
        expect(startEvent).toBeDefined();
        expect(startEvent.data.scenario).toBe('my-scenario');
        expect(startEvent.data.maxTicks).toBe(100);
    });

    it('broadcastTerrain sends terrain event', async () => {
        server = await createUiServer({ port: 0 });

        const ssePromise = collectSseEvents(server.port, 300);
        await new Promise((r) => setTimeout(r, 30));
        server.broadcastTerrain({ W0N1: plainsRows() });

        const { events } = await ssePromise;
        const terrainEvent = events.find((e) => e.type === 'terrain');
        expect(terrainEvent).toBeDefined();
        expect(terrainEvent.data.W0N1).toHaveLength(50);
    });

    it('broadcastEnd sends end event', async () => {
        server = await createUiServer({ port: 0 });

        const ssePromise = collectSseEvents(server.port, 300);
        await new Promise((r) => setTimeout(r, 30));
        server.broadcastEnd('pass', 42);

        const { events } = await ssePromise;
        const endEvent = events.find((e) => e.type === 'end');
        expect(endEvent).toBeDefined();
        expect(endEvent.data.reason).toBe('pass');
        expect(endEvent.data.ticksRun).toBe(42);
    });

    it('broadcast to multiple SSE clients', async () => {
        server = await createUiServer({ port: 0 });

        const p1 = collectSseEvents(server.port, 300);
        const p2 = collectSseEvents(server.port, 300);

        // Wait for both SSE connections to establish
        await new Promise((r) => setTimeout(r, 30));
        server.broadcast({ gameTime: 99, objects: [] });

        const [{ events: e1 }, { events: e2 }] = await Promise.all([p1, p2]);
        expect(e1.find((e) => e.type === 'frame')).toBeDefined();
        expect(e2.find((e) => e.type === 'frame')).toBeDefined();
    });

    it('/api/scenarios returns empty list when no dir set', async () => {
        server = await createUiServer({ port: 0 });
        const body = await httpGet(server.port, '/api/scenarios');
        const parsed = JSON.parse(body);
        expect(parsed).toEqual({ scenarios: [] });
    });

    it('/api/run POST returns ok for implemented endpoint', async () => {
        server = await createUiServer({ port: 0 });
        const result = await httpPost(server.port, '/api/run', { scenario: 'test', interactive: true });
        expect(result.status).toBe(200);
        const parsed = JSON.parse(result.body);
        expect(parsed).toEqual({ ok: true, scenario: 'test', interactive: true });
    });

    it('/api/run POST does not mark the status running — queueing is not running', async () => {
        // The parent flips the status when a worker actually starts
        // (processQueue), not when a run request is merely queued.
        server = await createUiServer({ port: 0 });
        await httpPost(server.port, '/api/run', { scenario: 'test', interactive: true });
        const status = JSON.parse(await httpGet(server.port, '/api/status'));
        expect(status.state).toBe('idle');
        expect(status.scenario).toBe('');
    });

    it('/api/run-all POST calls onRunAll and returns ok', async () => {
        const onRunAll = jest.fn();
        server = await createUiServer({ port: 0, onRunAll });
        const result = await httpPost(server.port, '/api/run-all');
        expect(result.status).toBe(200);
        expect(JSON.parse(result.body)).toEqual({ ok: true });
        expect(onRunAll).toHaveBeenCalledTimes(1);
    });

    it('/api/stop-all POST calls onStopAll and resets the status to idle', async () => {
        const onStopAll = jest.fn();
        server = await createUiServer({ port: 0, onStopAll });
        // Make the cached status non-idle first, as if a scenario were running
        server.updateStatus({ state: 'running', tick: 42, scenario: 'demo' });
        const result = await httpPost(server.port, '/api/stop-all');
        expect(result.status).toBe(200);
        expect(JSON.parse(result.body)).toEqual({ ok: true });
        expect(onStopAll).toHaveBeenCalledTimes(1);
        const status = JSON.parse(await httpGet(server.port, '/api/status'));
        expect(status).toEqual({ state: 'idle', tick: 0, speed: 1000, scenario: '' });
    });

    it('/api/dispose POST returns ok', async () => {
        server = await createUiServer({ port: 0 });
        const result = await httpPost(server.port, '/api/dispose');
        expect(result.status).toBe(200);
        const parsed = JSON.parse(result.body);
        expect(parsed).toEqual({ ok: true });
    });

    it('/api/status GET returns initial state', async () => {
        server = await createUiServer({ port: 0 });
        const result = await httpGet(server.port, '/api/status');
        const parsed = JSON.parse(result);
        expect(parsed).toEqual({ state: 'idle', tick: 0, speed: 1000, scenario: '' });
    });

    it('/api/status GET reflects updates after pause command', async () => {
        let lastCommand = null;
        server = await createUiServer({
            port: 0,
            sendCommand: (cmd) => {
                lastCommand = cmd;
            },
        });
        // Send pause → serverStatus should update
        await httpPost(server.port, '/api/pause');
        const result = await httpGet(server.port, '/api/status');
        const parsed = JSON.parse(result);
        expect(parsed.state).toBe('paused');
        expect(lastCommand).toEqual({ type: 'viewer:cmd', action: 'pause' });
    });

    it('/api/stats GET returns process, system and viewer resource stats', async () => {
        const memoryHistory = {
            size: () => 42,
            reconstruct: () => null,
        };
        server = await createUiServer({
            port: 0,
            memoryHistory,
            lastStart: { scenario: 'demo', maxTicks: 100, replayBuffer: 1234 },
        });
        const parsed = JSON.parse(await httpGet(server.port, '/api/stats'));

        // Process section — real numbers from this very process
        expect(typeof parsed.process.pid).toBe('number');
        expect(parsed.process.uptimeSec).toBeGreaterThan(0);
        for (const key of ['rss', 'heapUsed', 'heapTotal', 'external', 'cpuUserUsec', 'cpuSystemUsec']) {
            expect(typeof parsed.process[key]).toBe('number');
            expect(parsed.process[key]).toBeGreaterThanOrEqual(0);
        }

        // System section
        expect(parsed.system.totalMem).toBeGreaterThan(0);
        expect(parsed.system.freeMem).toBeGreaterThan(0);
        expect(typeof parsed.system.cpus).toBe('number');
        expect(Array.isArray(parsed.system.loadavg)).toBe(true);

        // Viewer section — wired to the passed opts
        expect(parsed.viewer.state).toBe('idle');
        expect(parsed.viewer.scenario).toBe('');
        expect(parsed.viewer.sseClients).toBe(0);
        expect(parsed.viewer.memoryHistoryTicks).toBe(42);
        expect(parsed.viewer.replayBuffer).toBe(1234);
        expect(parsed.viewer.lastFrameTick).toBe(null);
    });

    it('/api/stats GET without memoryHistory reports null memoryHistoryTicks', async () => {
        server = await createUiServer({ port: 0 });
        const parsed = JSON.parse(await httpGet(server.port, '/api/stats'));
        expect(parsed.viewer.memoryHistoryTicks).toBe(null);
        expect(parsed.viewer.replayBuffer).toBe(null);
    });

    it('/api/stats GET reports scenario workers via setWorkerStats/deleteWorkerStats', async () => {
        server = await createUiServer({ port: 0 });
        // Empty before any worker reports
        expect(JSON.parse(await httpGet(server.port, '/api/stats')).viewer.workers).toEqual([]);

        // Worker self-reports — the payload is stored per pid
        server.setWorkerStats({
            pid: 111,
            scenario: 'demo-scenario',
            rss: 123,
            heapUsed: 45,
            cpuUserUsec: 1000,
            cpuSystemUsec: 500,
        });
        // Same pid reports again — overwritten in place, not duplicated
        server.setWorkerStats({ pid: 111, scenario: 'demo-scenario', rss: 222, cpuUserUsec: 2000 });
        server.setWorkerStats({ pid: 222, scenario: 'smoke-empty', rss: 99, cpuUserUsec: 10 });

        const parsed = JSON.parse(await httpGet(server.port, '/api/stats'));
        expect(parsed.viewer.workers).toHaveLength(2);
        const w111 = parsed.viewer.workers.find((w) => w.pid === 111);
        expect(w111.scenario).toBe('demo-scenario');
        expect(w111.rss).toBe(222); // latest report wins
        expect(parsed.viewer.workers.find((w) => w.pid === 222).scenario).toBe('smoke-empty');

        // Worker exits — its stats disappear
        server.deleteWorkerStats(111);
        const after = JSON.parse(await httpGet(server.port, '/api/stats'));
        expect(after.viewer.workers).toHaveLength(1);
        expect(after.viewer.workers[0].pid).toBe(222);
    });

    it('setWorkerStats ignores payloads without a numeric pid', async () => {
        server = await createUiServer({ port: 0 });
        server.setWorkerStats({ scenario: 'no-pid' });
        server.setWorkerStats(null);
        const parsed = JSON.parse(await httpGet(server.port, '/api/stats'));
        expect(parsed.viewer.workers).toEqual([]);
    });

    it('/api/scenarios returns real scenarios when scenariosDir is set', async () => {
        // Point to the examples directory which has real scenarios
        const scenariosDir = path.resolve(__dirname, '..', 'examples', 'scenarios');
        server = await createUiServer({ port: 0, scenariosDir });
        const body = await httpGet(server.port, '/api/scenarios');
        const parsed = JSON.parse(body);
        expect(parsed.scenarios).toBeDefined();
        expect(Array.isArray(parsed.scenarios)).toBe(true);
        // Should find at least the smoke-empty scenario
        const names = parsed.scenarios.map((s) => s.name);
        expect(names).toContain('smoke-empty');
    });

    it('broadcastStart sends SSE start event', async () => {
        server = await createUiServer({ port: 0 });
        // Start SSE connection, then broadcast after a small delay
        const ssePromise = collectSseEvents(server.port, 300);
        await new Promise((r) => setTimeout(r, 100));
        server.broadcastStart('test-scenario', 200);
        const { events } = await ssePromise;
        const startEvent = events.find((e) => e.type === 'start');
        expect(startEvent).toBeDefined();
        expect(startEvent.data).toEqual({ scenario: 'test-scenario', maxTicks: 200 });
    });

    it('broadcastStart forwards replayBuffer in SSE start event', async () => {
        server = await createUiServer({ port: 0 });
        const ssePromise = collectSseEvents(server.port, 300);
        await new Promise((r) => setTimeout(r, 100));
        server.broadcastStart('test-scenario', 200, 1500);
        const { events } = await ssePromise;
        const startEvent = events.find((e) => e.type === 'start');
        expect(startEvent).toBeDefined();
        expect(startEvent.data).toEqual({ scenario: 'test-scenario', maxTicks: 200, replayBuffer: 1500 });
    });

    it('broadcastScenarioResult sends SSE scenario-result event', async () => {
        server = await createUiServer({ port: 0 });
        const ssePromise = collectSseEvents(server.port, 300);
        await new Promise((r) => setTimeout(r, 100));
        server.broadcastScenarioResult({ scenario: 'test', status: 'pass', time: 100, totalTicks: 30 });
        const { events } = await ssePromise;
        const resultEvent = events.find((e) => e.type === 'scenario-result');
        expect(resultEvent).toBeDefined();
        expect(resultEvent.data).toEqual({ scenario: 'test', status: 'pass', time: 100, totalTicks: 30 });
    });

    it('updateStatus broadcasts SSE status event', async () => {
        server = await createUiServer({ port: 0 });
        const ssePromise = collectSseEvents(server.port, 300);
        await new Promise((r) => setTimeout(r, 100));
        server.updateStatus({ state: 'running', tick: 42, speed: 5 });
        const { events } = await ssePromise;
        const statusEvents = events.filter((e) => e.type === 'status');
        // First event is re-send on connect (idle), last event is the update
        const lastStatus = statusEvents[statusEvents.length - 1];
        expect(lastStatus).toBeDefined();
        expect(lastStatus.data).toEqual({ state: 'running', tick: 42, speed: 5, scenario: '' });

        const getResult = await httpGet(server.port, '/api/status');
        const parsed = JSON.parse(getResult);
        expect(parsed.state).toBe('running');
        expect(parsed.tick).toBe(42);
        expect(parsed.speed).toBe(5);
    });

    it('new SSE client gets current status on connect', async () => {
        server = await createUiServer({ port: 0 });
        server.updateStatus({ state: 'running', tick: 10, speed: 3 });
        const { events } = await collectSseEvents(server.port, 300);
        const statusEvents = events.filter((e) => e.type === 'status');
        expect(statusEvents.length).toBeGreaterThanOrEqual(1);
        const lastStatus = statusEvents[statusEvents.length - 1];
        expect(lastStatus.data.state).toBe('running');
    });

    it('new SSE client gets the last frame re-sent on connect', async () => {
        server = await createUiServer({ port: 0 });
        server.broadcast({ gameTime: 42, objects: [], console: [] });
        const { events } = await collectSseEvents(server.port, 300);
        const frameEvents = events.filter((e) => e.type === 'frame');
        expect(frameEvents.length).toBeGreaterThanOrEqual(1);
        expect(frameEvents[frameEvents.length - 1].data.gameTime).toBe(42);
    });

    it('new SSE client gets the last terrain re-sent on connect', async () => {
        server = await createUiServer({ port: 0 });
        server.broadcastTerrain({ W0N1: plainsRows() });
        const { events } = await collectSseEvents(server.port, 300);
        const terrainEvents = events.filter((e) => e.type === 'terrain');
        expect(terrainEvents.length).toBeGreaterThanOrEqual(1);
        expect(terrainEvents[terrainEvents.length - 1].data.W0N1).toHaveLength(50);
    });

    it('broadcastStart clears stale cached frames for late clients', async () => {
        // lastStart mimics interactive mode: a late client gets a fresh
        // `start`, but must NOT get the previous scenario's frame/terrain
        server = await createUiServer({ port: 0, lastStart: { scenario: 'new-scenario', maxTicks: 100 } });
        server.broadcast({ gameTime: 1, objects: [], console: [] });
        server.broadcastStart('new-scenario', 100);
        const { events } = await collectSseEvents(server.port, 300);
        expect(events.find((e) => e.type === 'frame')).toBeUndefined();
        expect(events.find((e) => e.type === 'terrain')).toBeUndefined();
        const startEvent = events.find((e) => e.type === 'start');
        expect(startEvent).toBeDefined();
        expect(startEvent.data.scenario).toBe('new-scenario');
    });

    it('re-sent start event carries the current paused state (page reload while paused)', async () => {
        server = await createUiServer({ port: 0, lastStart: { scenario: 'test', maxTicks: 0, replayBuffer: 100 } });
        server.updateStatus({ state: 'paused', tick: 42 });
        const { events } = await collectSseEvents(server.port, 300);
        const startEvent = events.find((e) => e.type === 'start');
        expect(startEvent).toBeDefined();
        expect(startEvent.data.paused).toBe(true);
    });

    it('re-sent start event is not paused while the server is running', async () => {
        server = await createUiServer({ port: 0, lastStart: { scenario: 'test', maxTicks: 0, replayBuffer: 100 } });
        server.updateStatus({ state: 'running', tick: 42 });
        const { events } = await collectSseEvents(server.port, 300);
        const startEvent = events.find((e) => e.type === 'start');
        expect(startEvent).toBeDefined();
        expect(startEvent.data.paused).toBe(false);
    });

    // ─── Snapshot file serving ───────────────────────────────────────────

    it('GET /snapshots/:file serves a saved .json snapshot', async () => {
        // Set up a temp snapshots directory with a test file
        const snapshotsDir = path.join(process.cwd(), 'snapshots');
        fs.mkdirSync(snapshotsDir, { recursive: true });
        const testFile = path.join(snapshotsDir, '_test-serve.json');
        fs.writeFileSync(testFile, JSON.stringify({ meta: { tick: 42 }, db: { 'rooms.objects': [] } }));

        server = await createUiServer({ port: 0 });

        try {
            const result = await new Promise((resolve, reject) => {
                http.get(`http://127.0.0.1:${server.port}/snapshots/_test-serve.json`, (res) => {
                    const chunks = [];
                    res.on('data', (chunk) => chunks.push(chunk));
                    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
                }).on('error', reject);
            });

            expect(result.status).toBe(200);
            const parsed = JSON.parse(result.body);
            expect(parsed.meta.tick).toBe(42);
        } finally {
            fs.unlinkSync(testFile);
            try {
                fs.rmdirSync(snapshotsDir);
            } catch {
                /* not empty — ignore */
            }
        }
    });

    it('GET /snapshots/:file returns 404 for non-.json file', async () => {
        server = await createUiServer({ port: 0 });

        const result = await new Promise((resolve, reject) => {
            http.get(`http://127.0.0.1:${server.port}/snapshots/not-json.txt`, (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
            }).on('error', reject);
        });

        expect(result.status).toBe(404);
    });

    it('GET /snapshots/:file returns 404 for non-existent file', async () => {
        server = await createUiServer({ port: 0 });

        const result = await new Promise((resolve, reject) => {
            http.get(`http://127.0.0.1:${server.port}/snapshots/nonexistent-file.json`, (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
            }).on('error', reject);
        });

        expect(result.status).toBe(404);
    });

    it('GET /snapshots/ with path traversal is neutralized by URL normalization', async () => {
        server = await createUiServer({ port: 0 });

        const result = await new Promise((resolve, reject) => {
            // URL parser normalizes '/../' out — request becomes '/malicious.json' (not under /snapshots/)
            http.get(`http://127.0.0.1:${server.port}/snapshots/../malicious.json`, (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
            }).on('error', reject);
        });

        // URL normalization strips '../' → pathname becomes '/malicious.json'
        // which falls through to SPA fallback → 200 (serves index.html)
        expect(result.status).toBe(200);
        expect(result.body).toContain('<div id="root">');
    });

    // ─── Snapshot launch ─────────────────────────────────────────────────

    it('POST /api/run-from-snapshot with inline data launches without writing to disk', async () => {
        /** @type {Array<Object>} */
        const launched = [];
        const snapshotsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sit-launch-'));
        server = await createUiServer({
            port: 0,
            snapshotsDir,
            onRunFromSnapshot: (snapshot) => launched.push(snapshot),
        });

        try {
            const snapshot = { version: '2.0', meta: { tick: 42 }, db: { 'rooms.objects': [] }, env: { gameTime: 42 } };
            const result = await httpPost(server.port, '/api/run-from-snapshot', { data: snapshot });

            expect(result.status).toBe(200);
            expect(JSON.parse(result.body)).toEqual({ ok: true });
            expect(launched).toHaveLength(1);
            expect(launched[0].meta.tick).toBe(42);
            // Nothing persisted — the snapshots dir stays empty
            expect(fs.readdirSync(snapshotsDir)).toHaveLength(0);
        } finally {
            fs.rmSync(snapshotsDir, { recursive: true, force: true });
        }
    });

    it('POST /api/run-from-snapshot reads from disk when snapshotFile is given', async () => {
        /** @type {Array<Object>} */
        const launched = [];
        const snapshotsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sit-launch-'));
        fs.writeFileSync(
            path.join(snapshotsDir, 'saved.json'),
            JSON.stringify({ meta: { tick: 7 }, db: { 'rooms.objects': [] }, env: { gameTime: 7 } }),
        );
        server = await createUiServer({
            port: 0,
            snapshotsDir,
            onRunFromSnapshot: (snapshot) => launched.push(snapshot),
        });

        try {
            const result = await httpPost(server.port, '/api/run-from-snapshot', { snapshotFile: 'saved.json' });
            expect(result.status).toBe(200);
            expect(launched).toHaveLength(1);
            expect(launched[0].meta.tick).toBe(7);
        } finally {
            fs.rmSync(snapshotsDir, { recursive: true, force: true });
        }
    });

    it('POST /api/run-from-snapshot returns 400 without snapshotFile or data', async () => {
        server = await createUiServer({ port: 0 });

        const result = await httpPost(server.port, '/api/run-from-snapshot', {});
        expect(result.status).toBe(400);
    });

    it('POST /api/run-from-snapshot rejects malformed inline data with 400', async () => {
        /** @type {Array<Object>} */
        const launched = [];
        server = await createUiServer({
            port: 0,
            onRunFromSnapshot: (snapshot) => launched.push(snapshot),
        });

        // Missing db['rooms.objects'] / env.gameTime
        const incomplete = await httpPost(server.port, '/api/run-from-snapshot', { data: { version: '2.0' } });
        expect(incomplete.status).toBe(400);
        expect(launched).toHaveLength(0);

        // Arrays are not valid snapshots
        const arrayData = await httpPost(server.port, '/api/run-from-snapshot', { data: [] });
        expect(arrayData.status).toBe(400);
        expect(launched).toHaveLength(0);
    });

    // ─── Open snapshots folder ───────────────────────────────────────────

    it('getOpenCommand maps every platform to the right file manager command', () => {
        expect(getOpenCommand('win32')).toBe('explorer');
        expect(getOpenCommand('darwin')).toBe('open');
        // Everything non-win32/darwin falls back to the freedesktop standard
        expect(getOpenCommand('linux')).toBe('xdg-open');
        expect(getOpenCommand('freebsd')).toBe('xdg-open');
        expect(getOpenCommand('openbsd')).toBe('xdg-open');
    });

    it('POST /api/open-snapshots-folder spawns the OS file manager and creates the dir', async () => {
        const snapshotsDir = path.join(os.tmpdir(), `sit-open-folder-${Date.now()}`);
        fs.rmSync(snapshotsDir, { recursive: true, force: true });
        server = await createUiServer({ port: 0, snapshotsDir });

        const spawnSpy = jest
            .spyOn(cp, 'spawn')
            .mockReturnValue(/** @type {any} */ ({ on: jest.fn(), unref: jest.fn() }));

        try {
            const result = await httpPost(server.port, '/api/open-snapshots-folder');
            expect(result.status).toBe(200);
            const parsed = JSON.parse(result.body);
            expect(parsed.ok).toBe(true);
            expect(parsed.path).toBe(snapshotsDir);

            // The command matches the platform the test runs on; all three
            // branches are covered by the pure getOpenCommand test above.
            expect(spawnSpy).toHaveBeenCalledWith(getOpenCommand(process.platform), [snapshotsDir], expect.any(Object));

            // Directory was created on demand
            expect(fs.existsSync(snapshotsDir)).toBe(true);
        } finally {
            spawnSpy.mockRestore();
            fs.rmSync(snapshotsDir, { recursive: true, force: true });
        }
    });

    it('POST /api/open-snapshots-folder returns 500 when the file manager cannot be spawned', async () => {
        const snapshotsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sit-open-folder-err-'));
        server = await createUiServer({ port: 0, snapshotsDir });

        // Simulate an async spawn failure (e.g. ENOENT on headless Linux
        // without xdg-utils): the mock invokes the 'error' handler right
        // after registration — before the success setImmediate fires, which
        // mirrors the real process.nextTick ordering of spawn errors.
        const spawnSpy = jest.spyOn(cp, 'spawn').mockReturnValue(
            /** @type {any} */ ({
                on: (event, handler) => {
                    if (event === 'error') handler(new Error('spawn xdg-open ENOENT'));
                },
                unref: jest.fn(),
            }),
        );

        try {
            const result = await httpPost(server.port, '/api/open-snapshots-folder');
            expect(result.status).toBe(500);
            const parsed = JSON.parse(result.body);
            expect(parsed.error).toContain('ENOENT');
        } finally {
            spawnSpy.mockRestore();
            fs.rmSync(snapshotsDir, { recursive: true, force: true });
        }
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
