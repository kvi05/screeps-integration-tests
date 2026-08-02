'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const ORIGINAL_BOT_DIST_DIR = process.env.BOT_DIST_DIR;

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
