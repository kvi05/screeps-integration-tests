'use strict';

/**
 * Unit tests for engineSnapshot.js — snapshot auto-regeneration and
 * lock serialisation.
 *
 * Cover:
 * - ensureEngineSnapshotCompat: regeneration on missing/mismatched stamp,
 *   no-op on matching stamp, FrameworkError on script failure/missing output,
 *   lock contention timeout, early return on stale lock + matching stamp
 *
 * @file Unit tests for engineSnapshot.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { ensureEngineSnapshotCompat } = require('../src/lib/runtime/engineSnapshot');
const { FrameworkError } = require('../src/lib/errors');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Marker file the fake generator appends to on every execution */
const EXECUTIONS_LOG = 'executions.log';

/**
 * Creates a fake @screeps/driver package directory.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.includeMakeScript] — write the fake generator script
 * @param {boolean} [opts.failingScript] — generator exits with code 1
 * @param {boolean} [opts.writeSnapshot] — pre-create the snapshot blob
 * @param {Object|null} [opts.stamp] — pre-write a stamp (null = none)
 * @param {boolean} [opts.writeLock] — pre-create a lock file
 * @returns {{ dir: string, buildDir: string }}
 */
function setupDriverDir(opts = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sit-engine-snapshot-'));
    const buildDir = path.join(dir, 'build');
    fs.mkdirSync(buildDir);

    if (opts.includeMakeScript) {
        const body = opts.failingScript
            ? "console.error('fake regeneration failure'); process.exit(1);\n"
            : [
                  "const fs = require('fs');",
                  "const path = require('path');",
                  `fs.appendFileSync(path.join(__dirname, 'build', '${EXECUTIONS_LOG}'), process.pid + '\\n');`,
                  "fs.writeFileSync(path.join(__dirname, 'build', 'runtime.snapshot.bin'), 'fake-snapshot');",
              ].join('\n');
        fs.writeFileSync(path.join(dir, 'make-runtime-snapshot.js'), body);
    }

    if (opts.writeSnapshot) {
        fs.writeFileSync(path.join(buildDir, 'runtime.snapshot.bin'), 'fake-snapshot');
    }
    if (opts.stamp !== undefined && opts.stamp !== null) {
        fs.writeFileSync(
            path.join(buildDir, 'runtime.snapshot.stamp.json'),
            `${JSON.stringify(opts.stamp, null, 2)}\n`,
        );
    }
    if (opts.writeLock) {
        fs.writeFileSync(path.join(buildDir, 'runtime.snapshot.lock'), '99999');
    }

    return { dir, buildDir };
}

/**
 * Current runtime stamp — mirrors `currentStamp()` in engineSnapshot.js.
 *
 * @returns {{node: string, v8: string, modules: string}}
 */
function currentStamp() {
    return {
        node: process.version,
        v8: process.versions.v8,
        modules: process.versions.modules,
    };
}

/**
 * Number of generator executions recorded in the marker file.
 *
 * @param {string} buildDir
 * @returns {number}
 */
function executions(buildDir) {
    const logPath = path.join(buildDir, EXECUTIONS_LOG);
    if (!fs.existsSync(logPath)) {
        return 0;
    }
    return fs.readFileSync(logPath, 'utf8').trim().split(/\n+/).filter(Boolean).length;
}

/** @type {string|null} Temp driver dir for cleanup */
let tmpDir = null;

afterEach(() => {
    if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = null;
    }
});

// ─── ensureEngineSnapshotCompat ───────────────────────────────────────────────

describe('ensureEngineSnapshotCompat', () => {
    test('regenerates the snapshot and writes a stamp when neither exists', () => {
        const { dir, buildDir } = setupDriverDir({ includeMakeScript: true });
        tmpDir = dir;

        ensureEngineSnapshotCompat({ driverDir: dir });

        const stamp = JSON.parse(fs.readFileSync(path.join(buildDir, 'runtime.snapshot.stamp.json'), 'utf8'));
        expect(stamp).toEqual(currentStamp());
        expect(fs.existsSync(path.join(buildDir, 'runtime.snapshot.bin'))).toBe(true);
        expect(executions(buildDir)).toBe(1);
        expect(fs.existsSync(path.join(buildDir, 'runtime.snapshot.lock'))).toBe(false);
    });

    test('is a no-op when the snapshot and stamp match the current runtime', () => {
        const { dir, buildDir } = setupDriverDir({
            includeMakeScript: true,
            writeSnapshot: true,
            stamp: currentStamp(),
        });
        tmpDir = dir;

        ensureEngineSnapshotCompat({ driverDir: dir });

        expect(executions(buildDir)).toBe(0);
    });

    test('regenerates when the stamp belongs to another Node/V8 version', () => {
        const { dir, buildDir } = setupDriverDir({
            includeMakeScript: true,
            writeSnapshot: true,
            stamp: { node: 'v0.0.0', v8: '0.0.0', modules: '0' },
        });
        tmpDir = dir;

        ensureEngineSnapshotCompat({ driverDir: dir });

        expect(executions(buildDir)).toBe(1);
        const stamp = JSON.parse(fs.readFileSync(path.join(buildDir, 'runtime.snapshot.stamp.json'), 'utf8'));
        expect(stamp).toEqual(currentStamp());
    });

    test('throws FrameworkError when the generator script is missing', () => {
        const { dir } = setupDriverDir({ includeMakeScript: false });
        tmpDir = dir;

        let caught = null;
        try {
            ensureEngineSnapshotCompat({ driverDir: dir });
        } catch (e) {
            caught = e;
        }

        expect(caught).toBeInstanceOf(FrameworkError);
        expect(caught.code).toBe('ENGINE_SNAPSHOT_MISMATCH');
        // The lock must be released even on failure.
        expect(fs.existsSync(path.join(dir, 'build', 'runtime.snapshot.lock'))).toBe(false);
    });

    test('throws FrameworkError when the generator exits non-zero and writes no stamp', () => {
        const { dir, buildDir } = setupDriverDir({ includeMakeScript: true, failingScript: true });
        tmpDir = dir;

        expect(() => ensureEngineSnapshotCompat({ driverDir: dir })).toThrow(FrameworkError);
        expect(fs.existsSync(path.join(buildDir, 'runtime.snapshot.stamp.json'))).toBe(false);
        expect(fs.existsSync(path.join(buildDir, 'runtime.snapshot.lock'))).toBe(false);
    });

    test('times out with a FrameworkError when another process holds the lock', () => {
        const { dir } = setupDriverDir({ includeMakeScript: true, writeLock: true });
        tmpDir = dir;

        const start = Date.now();
        expect(() => ensureEngineSnapshotCompat({ driverDir: dir, timeoutMs: 100 })).toThrow(FrameworkError);
        expect(Date.now() - start).toBeGreaterThanOrEqual(100);
    });

    test('returns immediately when a stale lock exists but snapshot and stamp already match', () => {
        const { dir, buildDir } = setupDriverDir({
            includeMakeScript: true,
            writeSnapshot: true,
            stamp: currentStamp(),
            writeLock: true,
        });
        tmpDir = dir;

        ensureEngineSnapshotCompat({ driverDir: dir });

        expect(executions(buildDir)).toBe(0);
    });
});
