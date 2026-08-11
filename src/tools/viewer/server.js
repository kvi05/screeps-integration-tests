'use strict';

/**
 * @file HTTP + SSE server for the browser viewer.
 *
 * Responsibility:
 *   Serves the viewer UI (static files from ui/dist/), provides an SSE endpoint
 *   for streaming per-tick snapshots from the running scenario, and REST
 *   endpoints for future scenario management (Phase 2).
 *
 * Architecture:
 *   The server runs in the parent process (bin/screeps-integration-tests.js),
 *   surviving worker process.exit(0). Workers send viewer:frame messages via
 *   IPC, which the parent broadcasts to all SSE clients.
 *
 * @module tools/viewer/server
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { getFreePort } = require('../../lib/runtime/port');

// ─── SSE helpers ────────────────────────────────────────────────────────────

/** @type {number} SSE heartbeat interval (ms) — keeps connection alive through idle proxies */
const SSE_HEARTBEAT_MS = 15000;
/** @type {number} Default viewer speed (ticks/second; 1000 = realtime) */
const DEFAULT_VIEWER_SPEED = 1000;

/**
 * Opens an SSE connection to a client.
 * Anti-buffering headers so events flush immediately; a 15s heartbeat
 * keeps the connection alive through idle proxies.
 *
 * @param {http.ServerResponse} res
 * @returns {{ send: (type:string, data?:*) => void, close: () => void }}
 */
function openSse(res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    const heartbeat = setInterval(() => {
        try {
            res.write(': hb\n\n');
        } catch {
            /* connection gone */
        }
    }, SSE_HEARTBEAT_MS);

    let closed = false;

    function close() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try {
            res.end();
        } catch {
            /* already ended */
        }
    }

    res.on('close', close);

    return {
        send(type, data) {
            if (closed) return;
            try {
                res.write(`event: ${type}\n`);
                res.write(`data: ${JSON.stringify(data === undefined ? null : data)}\n\n`);
            } catch {
                close();
            }
        },
        close,
    };
}

// ─── MIME types ─────────────────────────────────────────────────────────────

/** @type {Object<string,string>} */
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};

/**
 * Serves a static file with the correct MIME type using streaming I/O.
 *
 * @param {http.ServerResponse} res
 * @param {string} filePath
 * @returns {boolean} true if the file was found and served
 */
function serveStatic(res, filePath) {
    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch {
        return false;
    }
    if (stat.isDirectory()) {
        return false;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';

    try {
        const stream = fs.createReadStream(filePath);
        res.writeHead(200, { 'Content-Type': mime });
        stream.pipe(res);
        stream.on('error', () => {
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error');
            }
        });
        return true;
    } catch {
        return false;
    }
}

// ─── UiServer class ─────────────────────────────────────────────────────────

/**
 * Manages the HTTP server for the viewer UI.
 *
 * @typedef {Object} UiServer
 * @property {number} port — the port the server is listening on
 * @property {(scenario:string, maxTicks:number, replayBuffer?:number) => void} broadcastStart — send start event to all SSE clients
 * @property {(frame: Object) => void} broadcast — send a frame to all SSE clients
 * @property {(terrain: Object) => void} broadcastTerrain — send terrain data to all SSE clients
 * @property {(result: {scenario:string, status:string, time:number, ticks:number}) => void} broadcastScenarioResult — send scenario result to all SSE clients
 * @property {(status: {state?:string, tick?:number, speed?:number, scenario?:string}) => void} updateStatus — update cached status and broadcast to SSE
 * @property {() => Promise<void>} close — stop the server
 */

/**
 * Creates and starts the viewer UI server.
 *
 * @param {Object} [opts]
 * @param {number} [opts.port] — explicit port (default: auto via getFreePort)
 * @param {string} [opts.distDir] — path to ui/dist/ (default: computed relative to this file)
 * @param {Function} [opts.sendCommand] — callback to forward commands to worker: (cmd) => void
 * @param {string} [opts.scenariosDir] — directory containing *.scenario.js files
 * @param {Function} [opts.onRunScenario] — callback to run a scenario: (scenarioPath, interactive) => void
 * @param {{scenario:string, maxTicks:number, replayBuffer:number}} [opts.lastStart] — last start info to re-send to late-connecting SSE clients
 * @param {Object} [opts.memoryHistory] — Memory history ring buffer for /api/memory endpoint
 * @returns {Promise<UiServer>}
 */
async function createUiServer(opts = {}) {
    const port = opts.port || (await getFreePort());

    // Compute the path to ui/dist relative to this file's location
    const distDir = opts.distDir || path.resolve(__dirname, 'dist');

    /** @type {Set<ReturnType<typeof openSse>>} */
    const sseClients = new Set();

    /** @type {{ state: string, tick: number, speed: number, scenario: string }} */
    const serverStatus = { state: 'idle', tick: 0, speed: DEFAULT_VIEWER_SPEED, scenario: '' };

    /**
     * Reads and parses a JSON request body.
     * @param {http.IncomingMessage} req
     * @returns {Promise<Object>}
     */
    function readBody(req) {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', (chunk) => (body += chunk));
            req.on('end', () => {
                try {
                    resolve(body ? JSON.parse(body) : {});
                } catch {
                    reject(new Error('Invalid JSON'));
                }
            });
            req.on('error', reject);
        });
    }

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${port}`);
        const pathname = url.pathname;

        // SSE endpoint
        if (pathname === '/api/sse') {
            const sse = openSse(res);
            sseClients.add(sse);
            res.on('close', () => sseClients.delete(sse));
            // Re-send last known status to new client
            sse.send('status', {
                state: serverStatus.state,
                tick: serverStatus.tick,
                speed: serverStatus.speed,
                scenario: serverStatus.scenario,
            });
            // Re-send last start if available (for late-connecting clients in interactive mode)
            if (opts.lastStart) {
                sse.send('start', opts.lastStart);
            }
            return;
        }

        // ─── REST: Live Server Control ─────────────────────────────────────

        // POST /api/pause — pause the server
        if (pathname === '/api/pause' && req.method === 'POST') {
            if (opts.sendCommand) {
                opts.sendCommand({ type: 'viewer:cmd', action: 'pause' });
            }
            serverStatus.state = 'paused';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, state: 'paused' }));
            return;
        }

        // POST /api/resume — resume the server
        if (pathname === '/api/resume' && req.method === 'POST') {
            if (opts.sendCommand) {
                opts.sendCommand({ type: 'viewer:cmd', action: 'resume' });
            }
            serverStatus.state = 'running';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, state: 'running' }));
            return;
        }

        // POST /api/step — execute N ticks then pause
        if (pathname === '/api/step' && req.method === 'POST') {
            let body;
            try {
                body = await readBody(req);
            } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                return;
            }
            const n = body.n || 1;
            if (opts.sendCommand) {
                opts.sendCommand({ type: 'viewer:cmd', action: 'step', params: { n } });
            }
            serverStatus.state = 'stepping';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, steps: n }));
            return;
        }

        // POST /api/speed — set server speed
        if (pathname === '/api/speed' && req.method === 'POST') {
            let body;
            try {
                body = await readBody(req);
            } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                return;
            }
            const speed = body.speed || 1;
            if (opts.sendCommand) {
                opts.sendCommand({ type: 'viewer:cmd', action: 'setSpeed', params: { speed } });
            }
            serverStatus.speed = speed;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, speed }));
            return;
        }

        // GET /api/status — current server status
        if (pathname === '/api/status' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(serverStatus));
            return;
        }

        // GET /api/memory?tick=N&bot=username — reconstruct bot Memory at tick N
        if (pathname === '/api/memory' && req.method === 'GET') {
            const tick = parseInt(url.searchParams.get('tick') || '0', 10);
            const bot = url.searchParams.get('bot') || '';
            if (!opts.memoryHistory) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Memory history not available' }));
                return;
            }
            const mem = opts.memoryHistory.reconstruct(tick, bot);
            if (mem === null) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'No Memory data for this tick/bot' }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(mem));
            return;
        }

        // ─── REST: Scenario Management ────────────────────────────────────

        // GET /api/scenarios — list *.scenario.js files
        if (pathname === '/api/scenarios' && req.method === 'GET') {
            const scenarios = [];
            if (opts.scenariosDir) {
                try {
                    const entries = fs.readdirSync(opts.scenariosDir);
                    for (const entry of entries) {
                        if (entry.endsWith('.scenario.js')) {
                            const name = entry.replace('.scenario.js', '');
                            const stat = fs.statSync(path.join(opts.scenariosDir, entry));
                            scenarios.push({
                                name,
                                file: entry,
                                size: stat.size,
                                modified: stat.mtime.toISOString(),
                            });
                        }
                    }
                    // smoke-* first, then alphabetical
                    scenarios.sort((a, b) => {
                        if (a.name.startsWith('smoke-') && !b.name.startsWith('smoke-')) return -1;
                        if (!a.name.startsWith('smoke-') && b.name.startsWith('smoke-')) return 1;
                        return a.name.localeCompare(b.name);
                    });
                } catch {
                    // Directory doesn't exist — return empty list
                }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ scenarios }));
            return;
        }

        // POST /api/run — launch a scenario
        if (pathname === '/api/run' && req.method === 'POST') {
            let body;
            try {
                body = await readBody(req);
            } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                return;
            }
            const scenarioName = body.scenario;
            const interactive = body.interactive !== undefined ? body.interactive : true;
            if (!scenarioName) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing "scenario" field' }));
                return;
            }
            if (opts.onRunScenario) {
                const scenarioPath = opts.scenariosDir
                    ? path.join(opts.scenariosDir, `${scenarioName}.scenario.js`)
                    : scenarioName;
                opts.onRunScenario(scenarioPath, interactive);
                serverStatus.state = 'running';
                serverStatus.scenario = scenarioName;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, scenario: scenarioName, interactive }));
            return;
        }

        // ─── REST: Save/Load Snapshot ─────────────────────────────────────

        // POST /api/save-snapshot — save current state
        if (pathname === '/api/save-snapshot' && req.method === 'POST') {
            // Forward to worker for serialization
            // if (opts.sendCommand) {
            //     opts.sendCommand({ type: 'viewer:cmd', action: 'saveSnapshot' });
            // }
            res.writeHead(501, { 'Content-Type': 'application/json' });
            res.end(
                JSON.stringify({
                    ok: false,
                    status: 'not_implemented',
                    message: 'Snapshot saving is not yet implemented',
                }),
            );
            return;
        }

        // POST /api/load-snapshot — load saved state
        if (pathname === '/api/load-snapshot' && req.method === 'POST') {
            res.writeHead(501, { 'Content-Type': 'application/json' });
            res.end(
                JSON.stringify({
                    ok: false,
                    status: 'not_implemented',
                    message: 'Snapshot loading is not yet implemented',
                }),
            );
            return;
        }

        // POST /api/dispose — stop current interactive scenario
        if (pathname === '/api/dispose' && req.method === 'POST') {
            if (opts.sendCommand) {
                opts.sendCommand({ type: 'viewer:cmd', action: 'dispose' });
            }
            serverStatus.state = 'idle';
            serverStatus.tick = 0;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        // Static files
        let filePath;
        // Strip leading '/' so path.join doesn't treat pathname as absolute (Windows)
        const rel = pathname.replace(/^\//, '');
        if (pathname === '/') {
            filePath = path.join(distDir, 'index.html');
        } else if (pathname.startsWith('/assets/')) {
            filePath = path.join(distDir, rel);
        } else {
            // Try as a direct file path under dist
            filePath = path.join(distDir, rel);
        }

        if (serveStatic(res, filePath)) {
            return;
        }

        // Fallback: SPA — serve index.html for any unknown route
        const indexPath = path.join(distDir, 'index.html');
        if (serveStatic(res, indexPath)) {
            return;
        }

        // Nothing found
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    });

    return new Promise((resolve, reject) => {
        server.listen(port, '127.0.0.1', () => {
            /** @type {UiServer} */
            const uiServer = {
                port,

                /**
                 * Update the cached server status (called by parent on viewer:status IPC).
                 * @param {{state?:string, tick?:number, speed?:number, scenario?:string}} status
                 */
                updateStatus(status) {
                    if (status.state !== undefined) serverStatus.state = status.state;
                    if (status.tick !== undefined) serverStatus.tick = status.tick;
                    if (status.speed !== undefined) serverStatus.speed = status.speed;
                    if (status.scenario !== undefined) serverStatus.scenario = status.scenario;
                    // Broadcast status to all SSE clients
                    for (const client of sseClients) {
                        client.send('status', {
                            state: serverStatus.state,
                            tick: serverStatus.tick,
                            speed: serverStatus.speed,
                            scenario: serverStatus.scenario,
                        });
                    }
                },

                /**
                 * Broadcast a frame to all connected SSE clients.
                 *
                 * @param {Object} frame — the snapshot Frame
                 */
                broadcast(frame) {
                    // Forward all frame fields to SSE clients (including _sentAt, _size for metrics)
                    for (const client of sseClients) {
                        client.send('frame', frame);
                    }
                },

                broadcastStart(scenario, maxTicks, replayBuffer) {
                    for (const client of sseClients) {
                        client.send('start', { scenario, maxTicks, replayBuffer });
                    }
                },

                broadcastTerrain(terrain) {
                    for (const client of sseClients) {
                        client.send('terrain', terrain);
                    }
                },

                broadcastEnd(reason, ticksRun) {
                    for (const client of sseClients) {
                        client.send('end', { reason, ticksRun });
                    }
                },

                /**
                 * Broadcast scenario result to all SSE clients.
                 * @param {{scenario:string, status:string, time:number, ticks:number}} result
                 */
                broadcastScenarioResult(result) {
                    for (const client of sseClients) {
                        client.send('scenario-result', result);
                    }
                },

                async close() {
                    for (const client of sseClients) {
                        client.close();
                    }
                    sseClients.clear();
                    return new Promise((res) => server.close(() => res()));
                },
            };

            resolve(uiServer);
        });

        server.on('error', reject);
    });
}

module.exports = { createUiServer };
