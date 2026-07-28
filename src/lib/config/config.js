'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs, HelpRequested } = require('./cli');
const { safeRequire, safeReadFile, ConfigError, MissingFileError } = require('../errors');

/**
 * @file Configuration loader for `screeps-integration-tests`.
 *
 * Responsibility:
 *   Discover, load, and merge the `screeps-integration.config.js` file
 *   with built-in defaults, environment variables (`BOT_DIST_DIR`), and
 *   CLI arguments. The result is a normalised `FrameworkConfig` object
 *   with all relative paths resolved against the config file's directory
 *   (or `process.cwd()` if no config file is found).
 *
 * Resolution order (lowest to highest priority):
 *   1. Built-in defaults
 *   2. Config file (screeps-integration.config.{js,json,cjs,mjs})
 *   3. Environment variables (`BOT_DIST_DIR` → `distDir`; `SIT_FIXTURES_DIR` and
 *      `SIT_CACHE_DIR` are read directly by library modules, not by this function)
 *   4. CLI flags (`--scenariosDir`, `--distDir`, …)
 *
 * @module lib/config
 */

/**
 * @typedef {Object} FrameworkConfig
 * @property {string} distDir           — Path to the bot's compiled `dist/` directory
 * @property {string} scenariosDir      — Directory containing `*.scenario.js` test files
 * @property {string} fixturesDir       — Directory containing `*.memory.json` snapshot files
 * @property {string|null} roomFixturesDir — Directory containing user room fixture files (`*.room.js`)
 * @property {string} profilesDir       — Output directory for callgrind profiling data
 * @property {string} cacheDir          — Base directory for the mockup server cache
 * @property {number} cacheKeep         — Number of recent cache runs to keep during cleanup
 * @property {number} timeout           — Per-scenario timeout in milliseconds
 * @property {number} jobs              — Maximum number of parallel scenario workers
 * @property {string|null} buildCommand — Shell command to run before tests (e.g. `npm run build`)
 * @property {string[]} require         — Module paths to pre-load before any scenario
 * @property {Object<string,string>} env — Environment variables passed to worker processes
 */

/** @type {FrameworkConfig} */
const DEFAULTS = {
    distDir: './dist',
    scenariosDir: './scenarios',
    fixturesDir: './fixtures',
    roomFixturesDir: null,
    profilesDir: './profiles',
    cacheDir: './.cache',
    cacheKeep: 5,
    timeout: 30 * 60 * 1000, // 30 minutes
    jobs: Math.min(4, os.cpus().length),
    buildCommand: null,
    require: [],
    env: {},
};

const CLI_SCHEMA = {
    title: 'screeps-integration-tests',
    usage: 'screeps-integration-tests [options]',
    options: {
        config: { type: 'string', description: 'Path to screeps-integration.config.js' },
        scenariosDir: { type: 'string', description: 'Scenarios directory (*.scenario.js)' },
        distDir: { type: 'string', description: 'Bot dist/ directory (compiled modules)' },
        fixturesDir: { type: 'string', description: 'Memory fixtures directory (*.memory.json)' },
        roomFixturesDir: { type: 'string', description: 'Room fixtures directory (*.room.js)' },
        profilesDir: { type: 'string', description: 'Callgrind profiles output directory' },
        cacheDir: { type: 'string', description: 'Mockup server cache base directory' },
        only: { type: 'string', description: 'Run only the specified scenario' },
        profiling: { type: 'bool', description: 'Enable profiling (callgrind output)' },
        bail: { type: 'bool', description: 'Stop on first failure' },
        timeout: { type: 'int', min: 1, description: 'Per-scenario timeout (ms)' },
        jobs: { type: 'int', min: 1, description: 'Number of parallel scenario workers' },
        build: { type: 'bool', description: 'Run buildCommand before scenarios' },
    },
};

const CONFIG_FILE_NAMES = [
    'screeps-integration.config.js',
    'screeps-integration.config.json',
    'screeps-integration.config.cjs',
    'screeps-integration.config.mjs',
];

/**
 * Searches for a config file (`screeps-integration.config.*`) in the given directory.
 *
 * @param {string} cwd - Directory to scan
 * @returns {string|null} Absolute path to the first matching config file, or null
 */
function findConfigFile(cwd) {
    for (const name of CONFIG_FILE_NAMES) {
        const candidate = path.join(cwd, name);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

/**
 * Loads a config file (JSON or CJS) and purges its require cache entry to allow
 * hot-reloading during development.
 *
 * Supports both plain objects and functions returning an object.
 *
 * @param {string} configPath - Absolute path to the config file
 * @returns {Partial<FrameworkConfig>}
 * @throws {MissingFileError|ConfigError|FrameworkError}
 */
function loadConfigFile(configPath) {
    const ext = path.extname(configPath).toLowerCase();
    if (ext === '.json') {
        let raw;
        try {
            raw = safeReadFile(configPath, 'MISSING_CONFIG');
        } catch (e) {
            // Re-throw MissingFileError as-is; wrap other FS errors
            if (e instanceof MissingFileError) {
                throw e;
            }
            throw new ConfigError('MISSING_CONFIG', configPath, {
                title: `Cannot read config file: ${configPath}`,
                why: 'The config file exists but could not be read (permissions or I/O error).',
            });
        }
        try {
            return JSON.parse(raw);
        } catch {
            throw new ConfigError('INVALID_CONFIG', configPath, {
                title: `Invalid JSON in config file: ${configPath}`,
                why: 'The config file contains malformed JSON.',
                how: 'Validate the JSON syntax (trailing commas, unquoted keys, etc.).',
            });
        }
    }

    // CJS / MJS — purge cache, then require with friendly error wrapping
    try {
        delete require.cache[require.resolve(configPath)];
    } catch {
        // File not resolvable — let safeRequire produce the friendly error
    }
    let raw;
    try {
        raw = safeRequire(configPath, 'MISSING_CONFIG');
    } catch (e) {
        if (e instanceof MissingFileError) {
            throw e;
        }
        // Syntax error or other runtime error in the config file
        throw new ConfigError('CONFIG_SYNTAX_ERROR', configPath, {
            title: e.message,
            why: 'The config file exists but could not be loaded. Check for JavaScript syntax errors.',
        });
    }
    const cfg = typeof raw === 'function' ? raw() : raw;
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
        throw new ConfigError('INVALID_CONFIG', configPath);
    }
    return cfg;
}

/**
 * Resolves all relative path properties in the config against a base directory.
 *
 * Affected keys: `distDir`, `scenariosDir`, `fixturesDir`, `roomFixturesDir`,
 * `profilesDir`, `cacheDir`.  If a value is already absolute or null it is left untouched.
 *
 * @param {FrameworkConfig} cfg
 * @param {string} baseDir - Base directory (usually the config file's directory or cwd)
 * @returns {FrameworkConfig}
 */
function resolvePaths(cfg, baseDir) {
    const pathKeys = ['distDir', 'scenariosDir', 'fixturesDir', 'roomFixturesDir', 'profilesDir', 'cacheDir'];
    for (const key of pathKeys) {
        const value = cfg[key];
        if (value !== null && typeof value === 'string') {
            cfg[key] = path.resolve(baseDir, value);
        }
    }
    return cfg;
}

/**
 * Merges built-in defaults, config file, environment variables, CLI args, and
 * explicit overrides into a single `FrameworkConfig`.  Relative paths are
 * resolved against the config file's directory (or `cwd` if no config file exists).
 *
 * Resolution order (lowest to highest priority):
 *   1. Built-in `DEFAULTS`
 *   2. Config file (`screeps-integration.config.js`)
 *   3. Environment variables (`BOT_DIST_DIR` → `distDir`)
 *   4. CLI arguments (`--scenariosDir`, …)
 *   5. Explicit `overrides` map (for unit testing)
 *
 * @param {string[]} [argv] - CLI args (e.g. `process.argv.slice(2)`)
 * @param {string} [cwd] - Working directory (default `process.cwd()`)
 * @param {Partial<FrameworkConfig>} [overrides] - Explicit overrides for testing
 * @returns {{ config: FrameworkConfig, configPath: string|null }}
 * @throws {HelpRequested} When `--help` is present in argv
 * @throws {MissingFileError} When `--config` points to a non-existent file
 * @throws {ConfigError} When CLI args are invalid, config file has syntax errors, or config is malformed
 * @throws {FrameworkError} When config loading fails for other reasons
 */
function resolveConfig(argv = process.argv.slice(2), cwd = process.cwd(), overrides = {}) {
    /** @type {FrameworkConfig} */
    const cfg = { ...DEFAULTS };

    // 1. config file
    let cliOptions;
    try {
        ({ options: cliOptions } = parseArgs(CLI_SCHEMA, argv));
    } catch (err) {
        if (err instanceof HelpRequested) {
            throw err;
        }
        throw new ConfigError('CLI_PARSE_ERROR', null, {
            title: 'CLI parse error',
            why: err.message,
        });
    }

    const configPath = cliOptions.config ? path.resolve(cwd, cliOptions.config) : findConfigFile(cwd);
    const baseDir = configPath ? path.dirname(configPath) : cwd;

    if (configPath) {
        const fileCfg = loadConfigFile(configPath);
        Object.assign(cfg, fileCfg);
    }

    // 2. env (backward compatibility with BOT_DIST_DIR)
    if (process.env.BOT_DIST_DIR) {
        cfg.distDir = process.env.BOT_DIST_DIR;
    }

    // 3. CLI
    for (const [key, value] of Object.entries(cliOptions)) {
        if (value !== undefined && key !== 'config') {
            cfg[key] = value;
        }
    }

    // 4. explicit overrides (for unit tests and self-test mode)
    Object.assign(cfg, overrides);

    return {
        config: resolvePaths(cfg, baseDir),
        configPath,
    };
}

/**
 * Prints the CLI help text (generated from `CLI_SCHEMA`) and exits the process.
 *
 * @returns {never}
 */
function printHelpAndExit() {
    try {
        parseArgs(CLI_SCHEMA, ['--help']);
    } catch (err) {
        if (err instanceof HelpRequested) {
            console.log(err.helpText);
            process.exit(0);
        }
    }
    process.exit(0);
}

module.exports = {
    DEFAULTS,
    CLI_SCHEMA,
    resolveConfig,
    printHelpAndExit,
};
