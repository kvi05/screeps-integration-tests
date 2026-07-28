'use strict';

/**
 * @file Centralized error layer for user-facing framework errors.
 *
 * Responsibility:
 *   Provide structured error classes and safe wrapper functions that replace
 *   raw Node.js errors (ENOENT, MODULE_NOT_FOUND, etc.) with actionable,
 *   human-readable messages. Every error answers:
 *   - **WHAT** is missing or wrong
 *   - **WHY** this thing is needed
 *   - **HOW** to fix it
 *
 * Error classes extend `Error` so existing `instanceof Error` checks and
 * `.stack` access continue to work.
 *
 * Helper functions (`assertDir`, `safeReaddir`, `safeRequire`, etc.) wrap
 * common filesystem and module operations, throwing structured errors with
 * contextual information on failure.
 *
 * **Not for public API.** Used internally by the framework.
 *
 * @module lib/errors
 */

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Mapping of error codes to their default context — what, why, how.
 * Each entry provides the template for human-readable error messages.
 *
 * @type {Object<string, { title: string, why: string, how: string, docs?: string }>}
 */
const ERROR_CONTEXTS = {
    MISSING_SCENARIOS_DIR: {
        title: 'Scenarios directory not found',
        why: 'Scenarios are *.scenario.js test files that define integration tests for your Screeps bot. The framework needs a scenarios directory to discover and run your tests.',
        how:
            '1. Create a "scenarios/" directory in your project root.\n' +
            '  2. Copy the template from node_modules/screeps-integration-tests/examples/scenarios/_template.js.\n' +
            '  3. Or specify a custom path: --scenariosDir <path> or set "scenariosDir" in screeps-integration.config.js.',
        docs: 'docs/GETTING-STARTED.md',
    },
    MISSING_DIST_DIR: {
        title: 'Bot dist/ directory not found',
        why: 'Your compiled Screeps bot code (one .js file per module) must be placed in a "dist/" directory. The framework loads these modules and runs them inside the mock server.',
        how:
            '1. Build your bot: usually "npm run build" or "rollup -c".\n' +
            '  2. Make sure the output goes to the "dist/" directory.\n' +
            '  3. Or specify a custom path: --distDir <path> or set "distDir" in screeps-integration.config.js.\n' +
            '  4. Or use --build to run the build command automatically before tests.',
        docs: 'docs/GETTING-STARTED.md',
    },
    MISSING_FIXTURES_DIR: {
        title: 'Fixtures directory not found',
        why: 'Memory fixtures (*.memory.json) provide pre-built bot Memory snapshots for scenarios. They are loaded from the fixtures directory.',
        how:
            '1. Create a "fixtures/" directory in your project root.\n' +
            '  2. Or specify a custom path: --fixturesDir <path> or set "fixturesDir" in screeps-integration.config.js.\n' +
            '  3. Or capture a fixture from a running scenario: npx sit capture.',
        docs: 'docs/FIXTURES-GUIDE.md',
    },
    MISSING_CONFIG: {
        title: 'Config file not found',
        why: 'You specified a custom config file path with --config, but the file does not exist at that location.',
        how:
            '1. Check the path: did you mistype it?\n' +
            '  2. Create the file at the specified location.\n' +
            '  3. Or remove --config to use the default auto-discovery (screeps-integration.config.js in the project root).',
        docs: 'docs/CONFIG.md',
    },
    INVALID_CONFIG: {
        title: 'Invalid config file',
        why: 'The config file must export a plain object or a function returning an object.',
        how:
            'Example:\n' +
            "  module.exports = { scenariosDir: './tests/scenarios', distDir: './dist' };\n" +
            'Or as a function:\n' +
            '  module.exports = () => ({ ... });',
        docs: 'docs/CONFIG.md',
    },
    MISSING_SCENARIO: {
        title: 'Scenario not found',
        why: 'The --only flag filters scenarios by name, but no scenario file matched the given name.',
        how:
            '1. Check the spelling: scenario names are filenames without ".scenario.js".\n' +
            '  2. List available scenarios: remove --only to see all discovered files.\n' +
            '  3. Make sure the file has the ".scenario.js" extension.',
    },
    MISSING_MEMORY_FIXTURE: {
        title: 'Memory fixture not found',
        why: 'Scenarios can load pre-built bot Memory snapshots from *.memory.json files.',
        how:
            '1. Check the fixture name spelling.\n' +
            '  2. Make sure the file exists in the fixtures directory.\n' +
            '  3. Capture a fixture from a running scenario to create one.',
        docs: 'docs/FIXTURES-GUIDE.md',
    },
    MEMORY_FIXTURE_EXISTS: {
        title: 'Memory fixture already exists',
        why: 'You tried to save a fixture but a file with that name already exists.',
        how: 'Use { force: false } to allow overwriting, or choose a different name.',
    },
    MISSING_ROOM_FIXTURE: {
        title: 'Room fixture not found',
        why: 'Scenarios can reference pre-built room layouts (*.room.js files) by name. The referenced fixture was not registered.',
        how:
            '1. Check the fixture name spelling.\n' +
            '  2. Make sure the *.room.js file is in the room fixtures directory.\n' +
            '  3. Register it manually: require("screeps-integration-tests/room-fixtures").registerRoomFixture(name, spec).',
        docs: 'docs/FIXTURES-GUIDE.md',
    },
    MISSING_BOT_MODULE: {
        title: 'Bot module file not found',
        why: 'Each .js file in the dist/ directory is loaded as a bot module. A file that was expected could not be read.',
        how: 'Check that all expected modules exist and are readable. Rebuild your bot if needed.',
    },
    BOT_NOT_FOUND: {
        title: 'Bot not found',
        why: 'The requested bot could not be found among the registered bots.',
        how: 'Check the bot username. Use world.botId() to list available bots.',
    },
    STRUCTURE_NOT_FOUND: {
        title: 'Game object not found',
        why: 'The requested structure, controller, or other game object was not found in the room.',
        how: 'Check the object ID or coordinates. The object may have been destroyed or never created.',
    },
    EMPTY_ROOMS: {
        title: 'No rooms specified',
        why: 'createWorld() requires at least one room. You passed an empty rooms array or omitted the rooms option.',
        how: 'Add at least one room: rooms: [{ name: "W0N1", controller: spec.controller({ level: 1 }) }]',
        docs: 'docs/API-REFERENCE.md',
    },
    INVALID_BOTSPEC_FIELD: {
        title: 'Invalid BotSpec field: "room" (singular)',
        why: 'The BotSpec field was renamed from "room" (singular) to "rooms" (plural) to support multi-room bots.',
        how: 'Replace `room: "W0N1"` with `rooms: ["W0N1"]` in your bot specification.',
    },
    ZERO_BOTS: {
        title: 'Ambiguous bot lookup with no bots',
        why: 'botId() was called without arguments, but no bots are registered in this world.',
        how: 'Pass an explicit bot username: world.botId("bot1"), or make sure bots are registered in createWorld().',
    },
};

// ─── Base error class ───────────────────────────────────────────────────────

/**
 * Base class for all user-facing framework errors.
 *
 * Extends the native `Error` so existing `instanceof Error` checks,
 * `.stack` access, and error serialisation continue to work.
 *
 * Use the static factory {@link FrameworkError.fromCode} to create
 * instances from predefined error contexts.
 *
 * @example
 * throw new FrameworkError('MISSING_SCENARIOS_DIR', '/abs/path/to/scenarios');
 */
class FrameworkError extends Error {
    /**
     * @param {string} code — machine-readable error code (see {@link ERROR_CONTEXTS})
     * @param {string} [path] — filesystem path relevant to the error
     * @param {Object} [overrides] — override default context fields
     * @param {string} [overrides.title] — override title
     * @param {string} [overrides.why] — override why
     * @param {string} [overrides.how] — override how
     * @param {string} [overrides.docs] — override docs link
     * @param {string[]} [suggestions] — additional specific suggestions
     */
    constructor(code, path, overrides = {}, suggestions = []) {
        const ctx = ERROR_CONTEXTS[code];
        if (!ctx) {
            super(`Unknown error code: ${code}`);
            this.code = 'UNKNOWN';
            this.title = 'Unknown error';
            this.why = '';
            this.how = '';
            this.path = path || '';
            this.docs = '';
            this.suggestions = [];
            this.name = 'FrameworkError';
            Error.captureStackTrace(this, FrameworkError);
            return;
        }

        const title = overrides.title || ctx.title;
        const why = overrides.why || ctx.why;
        const how = overrides.how || ctx.how;
        const docs = overrides.docs || ctx.docs || '';

        // Build a single-line summary for the Error.message (used by tooling)
        const short = path ? `${title}: ${path}` : title;
        super(short);

        this.name = 'FrameworkError';
        /** @type {string} Machine-readable error code */
        this.code = code;
        /** @type {string} Human-readable title */
        this.title = title;
        /** @type {string} Explanation of why this is needed */
        this.why = why;
        /** @type {string} Actionable steps to fix the issue */
        this.how = how;
        /** @type {string} Relevant filesystem path */
        this.path = path || '';
        /** @type {string} Related documentation page (e.g. 'docs/GETTING-STARTED.md') */
        this.docs = docs;
        /** @type {string[]} Additional specific suggestions */
        this.suggestions = suggestions;

        Error.captureStackTrace(this, FrameworkError);
    }

    /**
     * Factory: create a FrameworkError from a known error code.
     *
     * @param {string} code — one of the ERROR_CONTEXTS keys
     * @param {string} [path] — filesystem path
     * @param {Object} [overrides] — override fields
     * @param {string[]} [suggestions] — additional suggestions
     * @returns {FrameworkError}
     */
    static fromCode(code, path, overrides = {}, suggestions = []) {
        return new FrameworkError(code, path, overrides, suggestions);
    }

    /**
     * Formats the error as a multi-line, scannable message for terminal output.
     *
     * @returns {string}
     */
    toString() {
        const lines = [`${this.title}`];

        if (this.path) {
            lines.push(`  Path: ${this.path}`);
        }

        if (this.why) {
            lines.push(`\n  → WHY: ${this.why}`);
        }

        if (this.how) {
            // Indent multi-line how instructions
            const howLines = this.how.split('\n');
            lines.push(`\n  → HOW TO FIX:`);
            for (const line of howLines) {
                lines.push(`    ${line.trim()}`);
            }
        }

        if (this.suggestions.length > 0) {
            lines.push(`\n  → SUGGESTIONS:`);
            for (const s of this.suggestions) {
                lines.push(`    - ${s}`);
            }
        }

        if (this.docs) {
            lines.push(`\n  See: ${this.docs}`);
        }

        return lines.join('\n');
    }

    /**
     * Creates a user-friendly error from an arbitrary caught error.
     * If the error is already a FrameworkError, returns it as-is.
     * Otherwise wraps it with a given code and context.
     *
     * @param {unknown} caught — caught error
     * @param {string} code — error code for wrapping
     * @param {string} [path] — relevant path
     * @returns {FrameworkError}
     */
    static wrap(caught, code, path) {
        if (caught instanceof FrameworkError) {
            return caught;
        }
        const msg = caught instanceof Error ? caught.message : String(caught);
        return new FrameworkError(code, path, { title: msg });
    }
}

// ─── Specialised subclasses ─────────────────────────────────────────────────

/**
 * Error for missing directories (scenarios/, dist/, fixtures/).
 */
class MissingDirectoryError extends FrameworkError {
    /**
     * @param {string} code
     * @param {string} dirPath
     * @param {Object} [overrides]
     * @param {string[]} [suggestions]
     */
    constructor(code, dirPath, overrides, suggestions) {
        super(code, dirPath, overrides, suggestions);
        this.name = 'MissingDirectoryError';
        Error.captureStackTrace(this, MissingDirectoryError);
    }
}

/**
 * Error for missing files (config, scenario, fixture, bot module).
 */
class MissingFileError extends FrameworkError {
    /**
     * @param {string} code
     * @param {string} filePath
     * @param {Object} [overrides]
     * @param {string[]} [suggestions]
     */
    constructor(code, filePath, overrides, suggestions) {
        super(code, filePath, overrides, suggestions);
        this.name = 'MissingFileError';
        Error.captureStackTrace(this, MissingFileError);
    }
}

/**
 * Error for invalid configuration.
 */
class ConfigError extends FrameworkError {
    /**
     * @param {string} code
     * @param {string} [configPath]
     * @param {Object} [overrides]
     * @param {string[]} [suggestions]
     */
    constructor(code, configPath, overrides, suggestions) {
        super(code, configPath, overrides, suggestions);
        this.name = 'ConfigError';
        Error.captureStackTrace(this, ConfigError);
    }
}

/**
 * Error for fixture-related issues (not found, already exists).
 */
class FixtureError extends FrameworkError {
    /**
     * @param {string} code
     * @param {string} fixturePath
     * @param {Object} [overrides]
     * @param {string[]} [suggestions]
     */
    constructor(code, fixturePath, overrides, suggestions) {
        super(code, fixturePath, overrides, suggestions);
        this.name = 'FixtureError';
        Error.captureStackTrace(this, FixtureError);
    }
}

/**
 * Error for bot-related runtime issues (bot not found, module missing).
 */
class BotError extends FrameworkError {
    /**
     * @param {string} code
     * @param {string} [detail]
     * @param {Object} [overrides]
     * @param {string[]} [suggestions]
     */
    constructor(code, detail, overrides, suggestions) {
        super(code, detail, overrides, suggestions);
        this.name = 'BotError';
        Error.captureStackTrace(this, BotError);
    }
}

// ─── Safe wrapper helpers ───────────────────────────────────────────────────

const fs = require('fs');

/**
 * Asserts that a directory exists. Throws {@link MissingDirectoryError} if not.
 *
 * @param {string} dirPath — absolute path to the directory
 * @param {string} code — error code from {@link ERROR_CONTEXTS}
 * @param {Object} [overrides] — override context fields
 * @param {string[]} [suggestions] — additional suggestions
 * @throws {MissingDirectoryError}
 */
function assertDir(dirPath, code, overrides = {}, suggestions = []) {
    if (!fs.existsSync(dirPath)) {
        throw new MissingDirectoryError(code, dirPath, overrides, suggestions);
    }
}

/**
 * Asserts that a file exists. Throws {@link MissingFileError} if not.
 *
 * @param {string} filePath — absolute path to the file
 * @param {string} code — error code from {@link ERROR_CONTEXTS}
 * @param {Object} [overrides] — override context fields
 * @param {string[]} [suggestions] — additional suggestions
 * @throws {MissingFileError}
 */
function assertFile(filePath, code, overrides = {}, suggestions = []) {
    if (!fs.existsSync(filePath)) {
        throw new MissingFileError(code, filePath, overrides, suggestions);
    }
}

/**
 * Wraps `fs.readdirSync` with a friendly error on failure.
 *
 * @param {string} dirPath — absolute path to the directory
 * @param {string} code — error code for the wrapping error
 * @param {Object} [overrides] — override context fields
 * @param {string[]} [suggestions] — additional suggestions
 * @returns {fs.Dirent[]}
 * @throws {MissingDirectoryError}
 */
function safeReaddir(dirPath, code, overrides = {}, suggestions = []) {
    try {
        return fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (e) {
        if (e.code === 'ENOENT') {
            throw new MissingDirectoryError(code, dirPath, overrides, suggestions);
        }
        throw FrameworkError.wrap(e, code, dirPath);
    }
}

/**
 * Wraps `fs.readFileSync` with a friendly error on failure.
 *
 * @param {string} filePath — absolute path to the file
 * @param {string} code — error code for the wrapping error
 * @param {Object} [overrides] — override context fields
 * @param {string[]} [suggestions] — additional suggestions
 * @returns {string}
 * @throws {MissingFileError|FrameworkError}
 */
function safeReadFile(filePath, code, overrides = {}, suggestions = []) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        if (e.code === 'ENOENT') {
            throw new MissingFileError(code, filePath, overrides, suggestions);
        }
        throw FrameworkError.wrap(e, code, filePath);
    }
}

/**
 * Wraps `require()` with a friendly error on MODULE_NOT_FOUND.
 *
 * @param {string} modulePath — absolute path to the module
 * @param {string} code — error code for the wrapping error
 * @param {Object} [overrides] — override context fields
 * @param {string[]} [suggestions] — additional suggestions
 * @returns {any}
 * @throws {MissingFileError|ConfigError|FrameworkError}
 */
function safeRequire(modulePath, code, overrides = {}, suggestions = []) {
    try {
        return require(modulePath);
    } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND') {
            throw new MissingFileError(code, modulePath, overrides, suggestions);
        }
        throw FrameworkError.wrap(e, code, modulePath);
    }
}

/**
 * Checks if a path is a valid, readable directory. Returns true/false, no throw.
 *
 * @param {string} dirPath
 * @returns {boolean}
 */
function dirExists(dirPath) {
    try {
        return fs.existsSync(dirPath);
    } catch {
        return false;
    }
}

module.exports = {
    // Error classes
    FrameworkError,
    MissingDirectoryError,
    MissingFileError,
    ConfigError,
    FixtureError,
    BotError,

    // Helpers
    assertDir,
    assertFile,
    safeReaddir,
    safeReadFile,
    safeRequire,
    dirExists,

    // Context map (for unit tests and diagnostics)
    ERROR_CONTEXTS,
};
