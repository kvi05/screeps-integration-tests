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

/**
 * Opens an SSE connection to a client.
 * Anti-buffering headers so events flush immediately; a 15s heartbeat
 * keeps the connection alive through idle proxies.
 *
 * Adapted from screeps-dojo (MIT).
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
    }, 15000);

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
 * @property {(frame: Object) => void} broadcast — send a frame to all SSE clients
 * @property {() => Promise<void>} close — stop the server
 */

/**
 * Creates and starts the viewer UI server.
 *
 * @param {Object} [opts]
 * @param {number} [opts.port] — explicit port (default: auto via getFreePort)
 * @param {string} [opts.distDir] — path to ui/dist/ (default: computed relative to this file)
 * @returns {Promise<UiServer>}
 */
async function createUiServer(opts = {}) {
    const port = opts.port || (await getFreePort());

    // Compute the path to ui/dist relative to this file's location
    const distDir = opts.distDir || path.resolve(__dirname, 'dist');

    /** @type {Set<ReturnType<typeof openSse>>} */
    const sseClients = new Set();

    const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${port}`);
        const pathname = url.pathname;

        // SSE endpoint
        if (pathname === '/api/sse') {
            const sse = openSse(res);
            sseClients.add(sse);
            res.on('close', () => sseClients.delete(sse));
            return;
        }

        // REST: list scenarios (Phase 2 stub)
        if (pathname === '/api/scenarios') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ scenarios: [] }));
            return;
        }

        // REST: run scenario (Phase 2 stub)
        if (pathname === '/api/run' && req.method === 'POST') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'not_implemented' }));
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
            console.log(`[viewer] UI server listening at http://127.0.0.1:${port}`);

            /** @type {UiServer} */
            const uiServer = {
                port,

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

                broadcastStart(scenario, maxTicks) {
                    for (const client of sseClients) {
                        client.send('start', { scenario, maxTicks });
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
