'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CACHE_DIR = path.join(__dirname, '..', '.cache');
const DEFAULT_KEEP = 5;

/**
 * Prunes .cache/, keeping the N most recent directories.
 * @param {Object} [opts]
 * @param {number} [opts.keep=5] — number of directories to keep
 * @param {string} [opts.cacheDir] — path to .cache/
 * @returns {{ removed: number, kept: number, errors: string[] }}
 */
function pruneCache(opts = {}) {
    const keep = opts.keep || DEFAULT_KEEP;
    const cacheDir = opts.cacheDir || DEFAULT_CACHE_DIR;
    const result = { removed: 0, kept: 0, errors: [] };

    if (!fs.existsSync(cacheDir)) {
        return result;
    }

    const entries = fs
        .readdirSync(cacheDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => ({
            name: e.name,
            fullPath: path.join(cacheDir, e.name),
            mtime: fs.statSync(path.join(cacheDir, e.name)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime); // newest first

    const toRemove = entries.slice(keep);
    for (const entry of toRemove) {
        try {
            fs.rmSync(entry.fullPath, { recursive: true, force: true });
            result.removed++;
        } catch (e) {
            result.errors.push(`Failed to remove ${entry.name}: ${e.message}`);
        }
    }

    result.kept = Math.min(entries.length, keep);
    return result;
}

/**
 * Waits for a child process to exit with a timeout.
 *
 * @param {import('child_process').ChildProcess} proc
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
async function waitForProcessExit(proc, timeoutMs) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
        return;
    }

    const { once } = require('events');
    const ac = new AbortController();
    const timer = setTimeout(() => {
        ac.abort();
        try {
            proc.kill('SIGKILL');
        } catch {
            // ignore
        }
    }, timeoutMs);

    try {
        await once(proc, 'exit', { signal: ac.signal });
    } catch {
        // AbortError — process already killed by timer
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Creates a single safe dispose function for runtime phases.
 *
 * Stops server child processes, waits for them to exit, and
 * removes the cache directory. This prevents storage/engine
 * process leaks and port conflicts between sequential runs.
 *
 * @param {import('../types').ScreepsServer} server
 * @param {import('./storageAdapter').StorageAdapter} adapter
 * @param {string} cacheDir
 * @returns {import('../types').DisposeFn}
 */
function createDispose(server, adapter, cacheDir) {
    return async () => {
        const processes = adapter.getProcesses();

        for (const proc of processes) {
            try {
                proc.kill();
            } catch {
                // ignore
            }
        }

        await Promise.all(processes.map((proc) => waitForProcessExit(proc, 5000)));

        try {
            fs.rmSync(cacheDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    };
}

module.exports = { pruneCache, waitForProcessExit, createDispose };
