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

    describe('resolveConfig priority', () => {
        it('использует встроенные defaults при пустых аргументах', () => {
            const { resolveConfig } = require('../lib/config');
            const { config } = resolveConfig([], tmpDir, {});
            // These are relative to cwd-based resolution since no config file
            expect(config.distDir).toBe(path.resolve(tmpDir, 'dist'));
            expect(config.scenariosDir).toBe(path.resolve(tmpDir, 'scenarios'));
            expect(config.timeout).toBe(30 * 60 * 1000);
        });

        it('overrides переопределяют defaults', () => {
            const { resolveConfig } = require('../lib/config');
            const { config } = resolveConfig([], tmpDir, { distDir: '/custom/dist' });
            expect(config.distDir).toBe(path.resolve('/custom/dist'));
        });

        it('переменная окружения BOT_DIST_DIR имеет приоритет над config file', () => {
            createConfigFile('module.exports = { distDir: "./from-config" };');
            process.env.BOT_DIST_DIR = path.join(tmpDir, 'from-env');
            const { resolveConfig } = require('../lib/config');
            const { config } = resolveConfig([], tmpDir, {});
            expect(config.distDir).toBe(path.resolve(process.env.BOT_DIST_DIR));
        });

        it('CLI аргументы имеют приоритет над env', () => {
            createConfigFile('module.exports = {};');
            process.env.BOT_DIST_DIR = '/from-env';
            const { resolveConfig } = require('../lib/config');
            const { config } = resolveConfig(['--distDir', '/from-cli'], tmpDir, {});
            expect(config.distDir).toBe(path.resolve('/from-cli'));
        });

        it('explicit overrides имеют наивысший приоритет', () => {
            const { resolveConfig } = require('../lib/config');
            const { config } = resolveConfig(['--distDir', '/from-cli'], tmpDir, { distDir: '/from-override' });
            expect(config.distDir).toBe(path.resolve('/from-override'));
        });
    });

    describe('config file loading', () => {
        it('загружает JS конфиг', () => {
            createConfigFile('module.exports = { distDir: "./custom" };');
            const { resolveConfig } = require('../lib/config');
            const { config } = resolveConfig([], tmpDir, {});
            expect(config.distDir).toBe(path.join(tmpDir, 'custom'));
        });

        it('загружает JSON конфиг', () => {
            createConfigFile('{ "distDir": "./json-dist" }', '.json');
            const { resolveConfig } = require('../lib/config');
            const { config } = resolveConfig([], tmpDir, {});
            expect(config.distDir).toBe(path.join(tmpDir, 'json-dist'));
        });

        it('поддерживает функцию, возвращающую объект', () => {
            createConfigFile('module.exports = function() { return { distDir: "./fn-dist" }; };');
            const { resolveConfig } = require('../lib/config');
            const { config } = resolveConfig([], tmpDir, {});
            expect(config.distDir).toBe(path.join(tmpDir, 'fn-dist'));
        });

        it('бросает при невалидном экспорте', () => {
            createConfigFile('module.exports = 42;');
            const { resolveConfig } = require('../lib/config');
            expect(() => resolveConfig([], tmpDir, {})).toThrow(/must export an object/);
        });

        it('конфиг из --config имеет приоритет над авто-поиском', () => {
            createConfigFile('module.exports = { distDir: "./auto" };');
            const explicitPath = createConfigFile('module.exports = { distDir: "./explicit" };', '.js');
            const { resolveConfig } = require('../lib/config');
            const { config, configPath } = resolveConfig(['--config', explicitPath], tmpDir, {});
            expect(configPath).toBe(explicitPath);
            expect(config.distDir).toBe(path.join(tmpDir, 'explicit'));
        });
    });

    describe('resolvePaths', () => {
        it('преобразует относительные пути в абсолютные относительно configDir', () => {
            createConfigFile('module.exports = { cacheDir: "./.cache" };');
            const { resolveConfig } = require('../lib/config');
            const { config } = resolveConfig([], tmpDir, {});
            expect(config.cacheDir).toBe(path.join(tmpDir, '.cache'));
        });

        it('не резолвит абсолютные пути относительно configDir', () => {
            const absPath = path.resolve('/absolute-cache');
            createConfigFile(`module.exports = { cacheDir: "${absPath.replace(/\\/g, '\\\\')}" };`);
            const { resolveConfig } = require('../lib/config');
            const { config } = resolveConfig([], tmpDir, {});
            expect(config.cacheDir).toBe(absPath);
            expect(config.cacheDir.indexOf(tmpDir)).toBe(-1);
        });

        it('не меняет null', () => {
            createConfigFile('module.exports = { roomFixturesDir: null };');
            const { resolveConfig } = require('../lib/config');
            const { config } = resolveConfig([], tmpDir, {});
            expect(config.roomFixturesDir).toBeNull();
        });
    });

    describe('findConfigFile', () => {
        it('находит .js конфиг', () => {
            createConfigFile('module.exports = {};', '.js');
            const { resolveConfig } = require('../lib/config');
            const { configPath } = resolveConfig([], tmpDir, {});
            expect(configPath).toBeTruthy();
            expect(configPath.endsWith('.js')).toBe(true);
        });

        it('находит .json конфиг', () => {
            createConfigFile('{}', '.json');
            const { resolveConfig } = require('../lib/config');
            const { configPath } = resolveConfig([], tmpDir, {});
            expect(configPath).toBeTruthy();
            expect(configPath.endsWith('.json')).toBe(true);
        });

        it('возвращает null если конфига нет', () => {
            const { resolveConfig } = require('../lib/config');
            const { configPath } = resolveConfig([], tmpDir, {});
            expect(configPath).toBeNull();
        });
    });
});

describe('config DEFAULTS', () => {
    it('содержит ожидаемые поля с корректными типами', () => {
        const { DEFAULTS } = require('../lib/config');
        expect(DEFAULTS).toMatchObject({
            distDir: './dist',
            scenariosDir: './scenarios',
            fixturesDir: './fixtures',
            cacheKeep: 5,
            buildCommand: null,
        });
        expect(typeof DEFAULTS.timeout).toBe('number');
        expect(typeof DEFAULTS.jobs).toBe('number');
    });
});

describe('config CLI_SCHEMA', () => {
    it('содержит все ожидаемые опции', () => {
        const { CLI_SCHEMA } = require('../lib/config');
        const optKeys = Object.keys(CLI_SCHEMA.options);
        expect(optKeys).toContain('config');
        expect(optKeys).toContain('scenariosDir');
        expect(optKeys).toContain('distDir');
        expect(optKeys).toContain('fixturesDir');
        expect(optKeys).toContain('roomFixturesDir');
        expect(optKeys).toContain('profiling');
        expect(optKeys).toContain('bail');
        expect(optKeys).toContain('timeout');
        expect(optKeys).toContain('jobs');
        expect(optKeys).toContain('build');
        expect(optKeys).toContain('only');
    });
});
