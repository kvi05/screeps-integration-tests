'use strict';

/**
 * Unit tests for the centralized error layer (src/lib/errors.js).
 */

const {
    FrameworkError,
    MissingDirectoryError,
    MissingFileError,
    ConfigError,
    FixtureError,
    BotError,
    assertDir,
    assertFile,
    safeReaddir,
    safeReadFile,
    safeRequire,
    dirExists,
    ERROR_CONTEXTS,
} = require('../src/lib/errors');

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Creates a temporary directory. Returns its path. Caller must clean up.
 * @param {string} prefix
 * @returns {string}
 */
function tmpDir(prefix = 'errors-test-') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    return dir;
}

// ─── FrameworkError ─────────────────────────────────────────────────────────

describe('FrameworkError', () => {
    describe('constructor', () => {
        it('creates an error with known code', () => {
            const err = new FrameworkError('MISSING_SCENARIOS_DIR', '/some/path');
            expect(err).toBeInstanceOf(Error);
            expect(err).toBeInstanceOf(FrameworkError);
            expect(err.name).toBe('FrameworkError');
            expect(err.code).toBe('MISSING_SCENARIOS_DIR');
            expect(err.path).toBe('/some/path');
            expect(err.message).toContain('Scenarios directory not found');
        });

        it('preserves stack trace', () => {
            const err = new FrameworkError('MISSING_SCENARIOS_DIR', '/some/path');
            expect(err.stack).toBeDefined();
            expect(err.stack).toContain('FrameworkError');
        });

        it('falls back to UNKNOWN for unknown code', () => {
            const err = new FrameworkError('NONEXISTENT_CODE');
            expect(err.code).toBe('UNKNOWN');
        });

        it('accepts overrides for context fields', () => {
            const err = new FrameworkError('MISSING_SCENARIOS_DIR', '/p', {
                title: 'Custom title',
                why: 'Custom why',
                how: 'Custom how',
            });
            expect(err.title).toBe('Custom title');
            expect(err.why).toBe('Custom why');
            expect(err.how).toBe('Custom how');
        });

        it('accepts suggestions array', () => {
            const err = new FrameworkError('MISSING_SCENARIOS_DIR', '/p', {}, ['Suggestion 1', 'Suggestion 2']);
            expect(err.suggestions).toEqual(['Suggestion 1', 'Suggestion 2']);
        });
    });

    describe('fromCode factory', () => {
        it('creates error from code string', () => {
            const err = FrameworkError.fromCode('MISSING_DIST_DIR', '/dist');
            expect(err.code).toBe('MISSING_DIST_DIR');
            expect(err.path).toBe('/dist');
        });
    });

    describe('toString', () => {
        it('formats a multi-line readable message', () => {
            const err = new FrameworkError('MISSING_SCENARIOS_DIR', '/p');
            const str = err.toString();
            expect(str).toContain('Scenarios directory not found');
            expect(str).toContain('Path: /p');
            expect(str).toContain('WHY:');
            expect(str).toContain('HOW TO FIX:');
        });

        it('includes docs link when present', () => {
            const err = new FrameworkError('MISSING_SCENARIOS_DIR', '/p');
            expect(err.toString()).toContain('docs/GETTING-STARTED.md');
        });

        it('includes suggestions when present', () => {
            const err = new FrameworkError('MISSING_SCENARIOS_DIR', '/p', {}, ['Hint 1']);
            expect(err.toString()).toContain('SUGGESTIONS:');
            expect(err.toString()).toContain('Hint 1');
        });

        it('omits path line when path is empty', () => {
            const err = new FrameworkError('EMPTY_ROOMS');
            expect(err.toString()).not.toContain('Path:');
        });
    });

    describe('wrap', () => {
        it('returns FrameworkError as-is', () => {
            const original = new FrameworkError('MISSING_SCENARIOS_DIR', '/p');
            const wrapped = FrameworkError.wrap(original, 'MISSING_DIST_DIR', '/d');
            expect(wrapped).toBe(original);
        });

        it('wraps a plain Error', () => {
            const raw = new Error('Something broke');
            const wrapped = FrameworkError.wrap(raw, 'MISSING_DIST_DIR', '/d');
            expect(wrapped).toBeInstanceOf(FrameworkError);
            expect(wrapped.code).toBe('MISSING_DIST_DIR');
        });

        it('wraps a non-Error value', () => {
            const wrapped = FrameworkError.wrap('plain string', 'MISSING_DIST_DIR', '/d');
            expect(wrapped).toBeInstanceOf(FrameworkError);
            expect(wrapped.message).toContain('plain string');
        });
    });
});

// ─── Subclasses ─────────────────────────────────────────────────────────────

describe('Error subclasses', () => {
    it('MissingDirectoryError extends FrameworkError', () => {
        const err = new MissingDirectoryError('MISSING_SCENARIOS_DIR', '/p');
        expect(err).toBeInstanceOf(FrameworkError);
        expect(err).toBeInstanceOf(MissingDirectoryError);
        expect(err.name).toBe('MissingDirectoryError');
    });

    it('MissingFileError extends FrameworkError', () => {
        const err = new MissingFileError('MISSING_CONFIG', '/f');
        expect(err).toBeInstanceOf(FrameworkError);
        expect(err).toBeInstanceOf(MissingFileError);
        expect(err.name).toBe('MissingFileError');
    });

    it('ConfigError extends FrameworkError', () => {
        const err = new ConfigError('INVALID_CONFIG', '/f');
        expect(err).toBeInstanceOf(FrameworkError);
        expect(err).toBeInstanceOf(ConfigError);
        expect(err.name).toBe('ConfigError');
    });

    it('FixtureError extends FrameworkError', () => {
        const err = new FixtureError('MISSING_MEMORY_FIXTURE', '/f');
        expect(err).toBeInstanceOf(FrameworkError);
        expect(err).toBeInstanceOf(FixtureError);
        expect(err.name).toBe('FixtureError');
    });

    it('BotError extends FrameworkError', () => {
        const err = new BotError('BOT_NOT_FOUND', 'bot1');
        expect(err).toBeInstanceOf(FrameworkError);
        expect(err).toBeInstanceOf(BotError);
        expect(err.name).toBe('BotError');
    });
});

// ─── Safe wrappers ──────────────────────────────────────────────────────────

describe('safeReadir', () => {
    it('reads an existing directory', () => {
        const dir = tmpDir();
        try {
            fs.writeFileSync(path.join(dir, 'test.js'), '');
            const entries = safeReaddir(dir, 'MISSING_DIST_DIR');
            expect(Array.isArray(entries)).toBe(true);
            expect(entries.some((e) => e.name === 'test.js')).toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('throws MissingDirectoryError for missing dir', () => {
        expect(() => safeReaddir('/nonexistent/path/xyz', 'MISSING_DIST_DIR')).toThrow(MissingDirectoryError);
    });
});

describe('safeReadFile', () => {
    it('reads an existing file', () => {
        const dir = tmpDir();
        try {
            const fp = path.join(dir, 'test.txt');
            fs.writeFileSync(fp, 'hello');
            const content = safeReadFile(fp, 'MISSING_CONFIG');
            expect(content).toBe('hello');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('throws MissingFileError for missing file', () => {
        expect(() => safeReadFile('/nonexistent/file.txt', 'MISSING_CONFIG')).toThrow(MissingFileError);
    });
});

describe('safeRequire', () => {
    it('requires an existing module', () => {
        const dir = tmpDir();
        try {
            const fp = path.join(dir, 'mod.js');
            fs.writeFileSync(fp, 'module.exports = { ok: true };');
            const mod = safeRequire(fp, 'MISSING_CONFIG');
            expect(mod.ok).toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('throws MissingFileError for missing module', () => {
        expect(() => safeRequire('/nonexistent/module.js', 'MISSING_CONFIG')).toThrow(MissingFileError);
    });
});

describe('assertDir', () => {
    it('does not throw for existing directory', () => {
        const dir = tmpDir();
        try {
            expect(() => assertDir(dir, 'MISSING_SCENARIOS_DIR')).not.toThrow();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('throws MissingDirectoryError for missing directory', () => {
        expect(() => assertDir('/nonexistent/dir', 'MISSING_SCENARIOS_DIR')).toThrow(MissingDirectoryError);
    });
});

describe('assertFile', () => {
    it('does not throw for existing file', () => {
        const dir = tmpDir();
        try {
            const fp = path.join(dir, 'f.txt');
            fs.writeFileSync(fp, '');
            expect(() => assertFile(fp, 'MISSING_CONFIG')).not.toThrow();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('throws MissingFileError for missing file', () => {
        expect(() => assertFile('/nonexistent/file.js', 'MISSING_CONFIG')).toThrow(MissingFileError);
    });
});

describe('dirExists', () => {
    it('returns true for existing directory', () => {
        const dir = tmpDir();
        try {
            expect(dirExists(dir)).toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('returns false for missing directory', () => {
        expect(dirExists('/nonexistent/directory')).toBe(false);
    });
});

// ─── ERROR_CONTEXTS ─────────────────────────────────────────────────────────

describe('ERROR_CONTEXTS', () => {
    it('all known codes have title, why, and how', () => {
        for (const [_code, ctx] of Object.entries(ERROR_CONTEXTS)) {
            expect(ctx.title).toBeDefined();
            expect(typeof ctx.title).toBe('string');
            expect(ctx.why).toBeDefined();
            expect(typeof ctx.why).toBe('string');
            expect(ctx.how).toBeDefined();
            expect(typeof ctx.how).toBe('string');
        }
    });

    it('MISSING_SCENARIOS_DIR has helpful content', () => {
        const ctx = ERROR_CONTEXTS['MISSING_SCENARIOS_DIR'];
        expect(ctx.title).toContain('Scenarios');
        expect(ctx.why).toContain('scenario.js');
        expect(ctx.how).toContain('scenarios');
    });

    it('MISSING_DIST_DIR has helpful content', () => {
        const ctx = ERROR_CONTEXTS['MISSING_DIST_DIR'];
        expect(ctx.title).toContain('dist');
        expect(ctx.why).toContain('module');
        expect(ctx.how).toContain('distDir');
    });
});
