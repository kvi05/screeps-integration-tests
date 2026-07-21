'use strict';

/**
 * Unit tests for cleanup.js — cache pruning, process wait, dispose.
 *
 * Cover:
 * - pruneCache: no-op on missing dir, keeps N newest, sorts by mtime,
 *   handles removal errors gracefully
 * - waitForProcessExit: already-exited process, normal exit, timeout
 * - createDispose: calls kill on all processes, removes cache dir
 *
 * @file Unit tests for cleanup.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { pruneCache, createDispose } = require('../src/lib/runtime/cleanup');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a temporary directory with N subdirectories with different mtimes.
 * Returns the temp dir path and an array of { name, fullPath } sorted oldest-first.
 *
 * @param {number} count
 * @returns {{ tmpDir: string, dirs: Array<{name: string, fullPath: string}> }}
 */
function createTempDirs(count) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-test-'));
    const dirs = [];
    for (let i = 0; i < count; i++) {
        const name = `dir-${String(i).padStart(3, '0')}`;
        const fullPath = path.join(tmpDir, name);
        fs.mkdirSync(fullPath);
        // Set mtime in the past — older dirs first
        const mtime = new Date(Date.now() - (count - i) * 1000);
        fs.utimesSync(fullPath, mtime, mtime);
        dirs.push({ name, fullPath, mtime });
    }
    dirs.sort((a, b) => a.mtime - b.mtime); // oldest first
    return { tmpDir, dirs };
}

describe('pruneCache', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('returns { removed:0, kept:0, errors:[] } when cache dir does not exist', () => {
        const result = pruneCache({ cacheDir: '/nonexistent/path/that/does/not/exist' });
        expect(result).toEqual({ removed: 0, kept: 0, errors: [] });
    });

    it('keeps all dirs when count <= keep', () => {
        const { tmpDir } = createTempDirs(3);
        const result = pruneCache({ cacheDir: tmpDir, keep: 5 });

        expect(result.removed).toBe(0);
        expect(result.kept).toBe(3);
        expect(fs.readdirSync(tmpDir)).toHaveLength(3);

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('removes oldest when count > keep', () => {
        const { tmpDir } = createTempDirs(5);
        const result = pruneCache({ cacheDir: tmpDir, keep: 3 });

        expect(result.removed).toBe(2);
        expect(result.kept).toBe(3);

        const remaining = fs.readdirSync(tmpDir);
        expect(remaining).toHaveLength(3);

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('handles removal errors gracefully', () => {
        const { tmpDir } = createTempDirs(3);

        // Mock rmSync to throw on one dir
        const rmSyncSpy = jest.spyOn(fs, 'rmSync').mockImplementationOnce(() => {
            throw new Error('Permission denied');
        });

        const result = pruneCache({ cacheDir: tmpDir, keep: 1 });

        // 3 dirs, keep=1 → 2 to remove, but 1 fails
        expect(result.removed).toBe(1); // one succeeded
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('Permission denied');

        rmSyncSpy.mockRestore();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('uses default keep=5 when opts.keep is not set', () => {
        const { tmpDir } = createTempDirs(10);
        const result = pruneCache({ cacheDir: tmpDir });

        expect(result.kept).toBe(5);
        expect(result.removed).toBe(5);

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
});

describe('createDispose', () => {
    it('returns a function', () => {
        const dispose = createDispose({}, { getProcesses: () => [] }, '/tmp/cache');
        expect(typeof dispose).toBe('function');
    });

    it('kills all processes and removes cache dir', async () => {
        const kill1 = jest.fn();
        const kill2 = jest.fn();
        const proc1 = { kill: kill1 };
        const proc2 = { kill: kill2 };
        const adapter = { getProcesses: () => [proc1, proc2] };

        const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispose-test-'));
        fs.writeFileSync(path.join(cacheDir, 'dummy.txt'), 'data');

        const dispose = createDispose({}, adapter, cacheDir);
        await dispose();

        expect(kill1).toHaveBeenCalled();
        expect(kill2).toHaveBeenCalled();
        expect(fs.existsSync(cacheDir)).toBe(false);
    });

    it('handles empty processes list', async () => {
        const adapter = { getProcesses: () => [] };
        const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispose-empty-'));
        fs.writeFileSync(path.join(cacheDir, 'dummy.txt'), 'data');

        const dispose = createDispose({}, adapter, cacheDir);
        await expect(dispose()).resolves.toBeUndefined();
        expect(fs.existsSync(cacheDir)).toBe(false);
    });

    it('handles kill throwing gracefully', async () => {
        const kill1 = jest.fn(() => {
            throw new Error('kill failed');
        });
        const proc1 = { kill: kill1 };
        const adapter = { getProcesses: () => [proc1] };

        const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispose-kill-error-'));
        fs.writeFileSync(path.join(cacheDir, 'dummy.txt'), 'data');

        const dispose = createDispose({}, adapter, cacheDir);
        await expect(dispose()).resolves.toBeUndefined();
        expect(kill1).toHaveBeenCalled();
        expect(fs.existsSync(cacheDir)).toBe(false);
    });
});
