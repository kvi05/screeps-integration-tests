'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const ORIGINAL_BOT_DIST_DIR = process.env.BOT_DIST_DIR;

/**
 * Baseline viewerOptions expected across tests.
 * Variations are expressed as `{ ...DEFAULT_VIEWER_OPTIONS, key: value }`.
 */
const DEFAULT_VIEWER_OPTIONS = {
    paused: false,
    speed: 1000,
    keyframeInterval: 100,
    replayBuffer: 3000,
};

describe('config resolveConfig', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
        delete process.env.BOT_DIST_DIR;
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        process.env.BOT_DIST_DIR = ORIGINAL_BOT_DIST_DIR;
    });

    function createConfigFile(content, ext = '.js') {
        const filePath = path.join(tmpDir, `screeps-integration.config${ext}`);
        fs.writeFileSync(filePath, content, 'utf8');
        return filePath;
    }

    describe('resolveConfig --version', () => {
        it('throws VersionRequested when --version is present', () => {
            const { resolveConfig } = require('../src/lib/config/config');
            expect(() => resolveConfig(['--version'], tmpDir, {})).toThrow(
                expect.objectContaining({ name: 'VersionRequested' }),
            );
        });
    });

    describe('resolveConfig priority', () => {
        it('uses built-in defaults with empty arguments', () => {
            const { resolveConfig } = require('../src/lib/config/config');
            const { config } = resolveConfig([], tmpDir, {});
            // These are relative to cwd-based resolution since no config file
            expect(config.distDir).toBe(path.resolve(tmpDir, 'dist'));
            expect(config.scenariosDir).toBe(path.resolve(tmpDir, 'scenarios'));
            expect(config.timeout).toBe(30 * 60 * 1000);
        });

        it('overrides override defaults', () => {
            const { resolveConfig } = require('../src/lib/config/config');
            const { config } = resolveConfig([], tmpDir, { distDir: '/custom/dist' });
            expect(config.distDir).toBe(path.resolve('/custom/dist'));
        });

        it('BOT_DIST_DIR env variable has priority over config file', () => {
            createConfigFile('module.exports = { distDir: "./from-config" };');
            process.env.BOT_DIST_DIR = path.join(tmpDir, 'from-env');
            const { resolveConfig } = require('../src/lib/config/config');
            const { config } = resolveConfig([], tmpDir, {});
            expect(config.distDir).toBe(path.resolve(process.env.BOT_DIST_DIR));
        });

        it('CLI arguments have priority over env', () => {
            createConfigFile('module.exports = {};');
            process.env.BOT_DIST_DIR = '/from-env';
            const { resolveConfig } = require('../src/lib/config/config');
            const { config } = resolveConfig(['--distDir', '/from-cli'], tmpDir, {});
            expect(config.distDir).toBe(path.resolve('/from-cli'));
        });

        it('explicit overrides have highest priority', () => {
            const { resolveConfig } = require('../src/lib/config/config');
            const { config } = resolveConfig(['--distDir', '/from-cli'], tmpDir, { distDir: '/from-override' });
            expect(config.distDir).toBe(path.resolve('/from-override'));
        });
    });

    describe('config file loading', () => {
        it('loads JS config', () => {
            createConfigFile('module.exports = { distDir: "./custom" };');
            const { resolveConfig } = require('../src/lib/config/config');
            const { config } = resolveConfig([], tmpDir, {});
            expect(config.distDir).toBe(path.join(tmpDir, 'custom'));
        });

        it('loads JSON config', () => {
            createConfigFile('{ "distDir": "./json-dist" }', '.json');
            const { resolveConfig } = require('../src/lib/config/config');
            const { config } = resolveConfig([], tmpDir, {});
            expect(config.distDir).toBe(path.join(tmpDir, 'json-dist'));
        });

        it('supports function returning an object', () => {
            createConfigFile('module.exports = function() { return { distDir: "./fn-dist" }; };');
            const { resolveConfig } = require('../src/lib/config/config');
            const { config } = resolveConfig([], tmpDir, {});
            expect(config.distDir).toBe(path.join(tmpDir, 'fn-dist'));
        });

        it('throws on invalid export', () => {
            createConfigFile('module.exports = 42;');
            const { resolveConfig } = require('../src/lib/config/config');
            expect(() => resolveConfig([], tmpDir, {})).toThrow(/Invalid config file/);
        });

        it('config from --config has priority over auto-discovery', () => {
            createConfigFile('module.exports = { distDir: "./auto" };');
            const explicitPath = createConfigFile('module.exports = { distDir: "./explicit" };', '.js');
            const { resolveConfig } = require('../src/lib/config/config');
            const { config, configPath } = resolveConfig(['--config', explicitPath], tmpDir, {});
            expect(configPath).toBe(explicitPath);
            expect(config.distDir).toBe(path.join(tmpDir, 'explicit'));
        });
    });

    describe('resolvePaths', () => {
        it('converts relative paths to absolute relative to configDir', () => {
            createConfigFile('module.exports = { cacheDir: "./.cache" };');
            const { resolveConfig } = require('../src/lib/config/config');
            const { config } = resolveConfig([], tmpDir, {});
            expect(config.cacheDir).toBe(path.join(tmpDir, '.cache'));
        });

        it('resolves snapshotsDir default relative to configDir', () => {
            const { resolveConfig } = require('../src/lib/config/config');
            const { config } = resolveConfig([], tmpDir, {});
            expect(config.snapshotsDir).toBe(path.resolve(tmpDir, 'snapshots'));
        });

        it('resolves snapshotsDir from config file relative to configDir', () => {
            createConfigFile('module.exports = { snapshotsDir: "./custom-snapshots" };');
            const { resolveConfig } = require('../src/lib/config/config');
            const { config } = resolveConfig([], tmpDir, {});
            expect(config.snapshotsDir).toBe(path.join(tmpDir, 'custom-snapshots'));
        });

        it('does not resolve absolute paths relative to configDir', () => {
            const absPath = path.resolve('/absolute-cache');
            createConfigFile(`module.exports = { cacheDir: "${absPath.replace(/\\/g, '\\\\')}" };`);
            const { resolveConfig } = require('../src/lib/config/config');
            const { config } = resolveConfig([], tmpDir, {});
            expect(config.cacheDir).toBe(absPath);
            expect(config.cacheDir.indexOf(tmpDir)).toBe(-1);
        });

        it('does not change null', () => {
            createConfigFile('module.exports = { roomFixturesDir: null };');
            const { resolveConfig } = require('../src/lib/config/config');
            const { config } = resolveConfig([], tmpDir, {});
            expect(config.roomFixturesDir).toBeNull();
        });
    });

    describe('findConfigFile', () => {
        it('finds .js config', () => {
            createConfigFile('module.exports = {};', '.js');
            const { resolveConfig } = require('../src/lib/config/config');
            const { configPath } = resolveConfig([], tmpDir, {});
            expect(configPath).toBeTruthy();
            expect(configPath.endsWith('.js')).toBe(true);
        });

        it('finds .json config', () => {
            createConfigFile('{}', '.json');
            const { resolveConfig } = require('../src/lib/config/config');
            const { configPath } = resolveConfig([], tmpDir, {});
            expect(configPath).toBeTruthy();
            expect(configPath.endsWith('.json')).toBe(true);
        });

        it('returns null if no config exists', () => {
            const { resolveConfig } = require('../src/lib/config/config');
            const { configPath } = resolveConfig([], tmpDir, {});
            expect(configPath).toBeNull();
        });
    });
});

describe('config DEFAULTS', () => {
    it('contains expected fields with correct types', () => {
        const { DEFAULTS } = require('../src/lib/config/config');
        expect(DEFAULTS).toMatchObject({
            distDir: './dist',
            scenariosDir: './scenarios',
            memoryFixturesDir: './fixtures',
            cacheKeep: 5,
            buildCommand: null,
        });
        expect(typeof DEFAULTS.timeout).toBe('number');
        expect(typeof DEFAULTS.jobs).toBe('number');
    });

    it('viewerOptions has all keys with correct defaults', () => {
        const { DEFAULTS } = require('../src/lib/config/config');
        expect(DEFAULTS.viewerOptions).toEqual(DEFAULT_VIEWER_OPTIONS);
    });

    it('viewer default is false', () => {
        const { DEFAULTS } = require('../src/lib/config/config');
        expect(DEFAULTS.viewer).toBe(false);
    });

    it('viewerOptions is a plain object (not shared reference across configs)', () => {
        const { DEFAULTS } = require('../src/lib/config/config');
        // Sanity: the default itself is an object
        expect(typeof DEFAULTS.viewerOptions).toBe('object');
        expect(DEFAULTS.viewerOptions).not.toBeNull();
    });
});

describe('config viewerOptions partial override', () => {
    /** @type {string} */
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-viewer-'));
        delete process.env.BOT_DIST_DIR;
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        process.env.BOT_DIST_DIR = ORIGINAL_BOT_DIST_DIR;
    });

    it('merges partial viewerOptions — non-overridden keys keep defaults', () => {
        const filePath = path.join(tmpDir, 'screeps-integration.config.js');
        fs.writeFileSync(filePath, 'module.exports = { viewerOptions: { speed: 2000 } };', 'utf8');
        const { resolveConfig } = require('../src/lib/config/config');
        const { config } = resolveConfig([], tmpDir, {});
        expect(config.viewerOptions).toEqual({ ...DEFAULT_VIEWER_OPTIONS, speed: 2000 });
    });

    it('merges viewerOptions toggles correctly', () => {
        const filePath = path.join(tmpDir, 'screeps-integration.config.js');
        fs.writeFileSync(filePath, 'module.exports = { viewerOptions: { paused: true, replayBuffer: 5000 } };', 'utf8');
        const { resolveConfig } = require('../src/lib/config/config');
        const { config } = resolveConfig([], tmpDir, {});
        expect(config.viewerOptions).toEqual({ ...DEFAULT_VIEWER_OPTIONS, paused: true, replayBuffer: 5000 });
    });

    it('full viewerOptions override works', () => {
        const filePath = path.join(tmpDir, 'screeps-integration.config.js');
        fs.writeFileSync(
            filePath,
            'module.exports = { viewerOptions: { paused: true, speed: 500, keyframeInterval: 50, replayBuffer: 1000 } };',
            'utf8',
        );
        const { resolveConfig } = require('../src/lib/config/config');
        const { config } = resolveConfig([], tmpDir, {});
        expect(config.viewerOptions).toEqual({
            paused: true,
            speed: 500,
            keyframeInterval: 50,
            replayBuffer: 1000,
        });
    });

    it('empty viewerOptions {} keeps all defaults', () => {
        const filePath = path.join(tmpDir, 'screeps-integration.config.js');
        fs.writeFileSync(filePath, 'module.exports = { viewerOptions: {} };', 'utf8');
        const { resolveConfig } = require('../src/lib/config/config');
        const { config } = resolveConfig([], tmpDir, {});
        expect(config.viewerOptions).toEqual(DEFAULT_VIEWER_OPTIONS);
    });

    it('config without viewerOptions key keeps defaults intact', () => {
        const filePath = path.join(tmpDir, 'screeps-integration.config.js');
        fs.writeFileSync(filePath, 'module.exports = { distDir: "./bot-dist" };', 'utf8');
        const { resolveConfig } = require('../src/lib/config/config');
        const { config } = resolveConfig([], tmpDir, {});
        expect(config.viewerOptions).toEqual(DEFAULT_VIEWER_OPTIONS);
    });

    it('no config file → viewerOptions is defaults', () => {
        const { resolveConfig } = require('../src/lib/config/config');
        const { config } = resolveConfig([], tmpDir, {});
        expect(config.viewerOptions).toEqual(DEFAULT_VIEWER_OPTIONS);
    });

    it('viewerOptions includes unknown keys from user config (forward-compat)', () => {
        const filePath = path.join(tmpDir, 'screeps-integration.config.js');
        fs.writeFileSync(
            filePath,
            'module.exports = { viewerOptions: { speed: 2000, customFutureKey: "hello" } };',
            'utf8',
        );
        const { resolveConfig } = require('../src/lib/config/config');
        const { config } = resolveConfig([], tmpDir, {});
        expect(config.viewerOptions).toEqual({ ...DEFAULT_VIEWER_OPTIONS, speed: 2000, customFutureKey: 'hello' });
    });
});

describe('config viewer + viewerOptions interaction', () => {
    /** @type {string} */
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-viewer-int-'));
        delete process.env.BOT_DIST_DIR;
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        process.env.BOT_DIST_DIR = ORIGINAL_BOT_DIST_DIR;
    });

    it('--viewer CLI flag sets viewer=true, leaves viewerOptions untouched', () => {
        const { resolveConfig } = require('../src/lib/config/config');
        const { config } = resolveConfig(['--viewer'], tmpDir, {});
        expect(config.viewer).toBe(true);
        expect(config.viewerOptions).toEqual(DEFAULT_VIEWER_OPTIONS);
    });

    it('--viewer + config file with viewerOptions merges correctly', () => {
        const filePath = path.join(tmpDir, 'screeps-integration.config.js');
        fs.writeFileSync(filePath, 'module.exports = { viewerOptions: { paused: true, speed: 500 } };', 'utf8');
        const { resolveConfig } = require('../src/lib/config/config');
        const { config } = resolveConfig(['--viewer'], tmpDir, {});
        // CLI --viewer sets viewer=true (overwrites config file's viewer if any)
        expect(config.viewer).toBe(true);
        // viewerOptions from config file, merged with defaults
        expect(config.viewerOptions).toEqual({ ...DEFAULT_VIEWER_OPTIONS, paused: true, speed: 500 });
    });

    it('explicit overrides viewerOptions replaces entirely (highest priority)', () => {
        const filePath = path.join(tmpDir, 'screeps-integration.config.js');
        fs.writeFileSync(filePath, 'module.exports = { viewerOptions: { paused: true, speed: 500 } };', 'utf8');
        const { resolveConfig } = require('../src/lib/config/config');
        const { config } = resolveConfig([], tmpDir, {
            viewerOptions: { speed: 9999, replayBuffer: 1 },
        });
        // Explicit overrides are highest priority — they replace the whole
        // viewerOptions object (not a shallow merge).
        expect(config.viewerOptions).toEqual({
            speed: 9999,
            replayBuffer: 1,
        });
    });

    it('DEFAULTS.viewerOptions is not mutated after resolveConfig calls', () => {
        const { DEFAULTS, resolveConfig } = require('../src/lib/config/config');
        const frozen = { ...DEFAULTS.viewerOptions };

        const filePath = path.join(tmpDir, 'screeps-integration.config.js');
        fs.writeFileSync(filePath, 'module.exports = { viewerOptions: { paused: true } };', 'utf8');
        resolveConfig([], tmpDir, {});
        resolveConfig(['--viewer'], tmpDir, {});

        // DEFAULTS must remain pristine — every resolveConfig call works
        // from a fresh copy.
        expect(DEFAULTS.viewerOptions).toEqual(frozen);
    });

    it('resolveConfig clones viewerOptions — returned config does not share reference with DEFAULTS', () => {
        const { DEFAULTS, resolveConfig } = require('../src/lib/config/config');
        const { config } = resolveConfig([], tmpDir, {});

        // Mutate the returned config's viewerOptions
        config.viewerOptions.paused = true;
        config.viewerOptions.customInjected = 'oops';

        // DEFAULTS must be unaffected
        expect(DEFAULTS.viewerOptions.paused).toBe(false);
        expect(DEFAULTS.viewerOptions.customInjected).toBeUndefined();
    });
});

describe('config CLI_SCHEMA', () => {
    it('contains all expected options', () => {
        const { CLI_SCHEMA } = require('../src/lib/config/config');
        const optKeys = Object.keys(CLI_SCHEMA.options);
        expect(optKeys).toContain('config');
        expect(optKeys).toContain('scenariosDir');
        expect(optKeys).toContain('distDir');
        expect(optKeys).toContain('memoryFixturesDir');
        expect(optKeys).toContain('roomFixturesDir');
        expect(optKeys).toContain('profiling');
        expect(optKeys).toContain('bail');
        expect(optKeys).toContain('timeout');
        expect(optKeys).toContain('jobs');
        expect(optKeys).toContain('build');
        expect(optKeys).toContain('only');
    });
});
