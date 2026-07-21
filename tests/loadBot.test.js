'use strict';

/**
 * Unit tests for loadBot.js — bot module loading and profiling injection.
 *
 * Cover:
 * - loadBotModules: reads .js files from distDir, strips .js extension,
 *   returns module map, skips non-js files, handles empty dir
 * - profiling injection: adds __origLoop wrapper with profiler
 *   finalisation logic
 *
 * @file Unit tests for loadBot.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { loadBotModules } = require('../src/lib/runtime/loadBot');

describe('loadBotModules', () => {
    /** @type {string} */
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadbot-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns an object with module names as keys and contents as values', () => {
        fs.writeFileSync(path.join(tmpDir, 'main.js'), 'module.exports = { loop: () => {} };');
        fs.writeFileSync(path.join(tmpDir, 'utils.js'), 'module.exports = { helper: () => 1 };');

        const modules = loadBotModules(tmpDir);

        expect(Object.keys(modules)).toEqual(['main', 'utils']);
        expect(modules.main).toContain('module.exports');
        expect(modules.utils).toContain('module.exports');
    });

    it('skips non-js files', () => {
        fs.writeFileSync(path.join(tmpDir, 'main.js'), 'module.exports = {};');
        fs.writeFileSync(path.join(tmpDir, 'data.json'), '{"key": "value"}');
        fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Docs');

        const modules = loadBotModules(tmpDir);

        expect(Object.keys(modules)).toEqual(['main']);
    });

    it('returns empty object for empty directory', () => {
        const modules = loadBotModules(tmpDir);
        expect(modules).toEqual({});
    });

    it('strips .js extension from keys', () => {
        fs.writeFileSync(path.join(tmpDir, 'my-bot-module.js'), 'module.exports = {};');

        const modules = loadBotModules(tmpDir);

        expect(modules).toHaveProperty('my-bot-module');
        expect(modules).not.toHaveProperty('my-bot-module.js');
    });

    describe('profiling injection', () => {
        it('injects profiler wrapper into main.js when profiling=true', () => {
            fs.writeFileSync(path.join(tmpDir, 'main.js'), 'const x = 1;\nmodule.exports.loop = function() {};');

            const modules = loadBotModules(tmpDir, { profiling: true });

            expect(modules.main).toContain('__origLoop');
            expect(modules.main).toContain('__profileFinalize');
            expect(modules.main).toContain('profiler');
            // Original code preserved
            expect(modules.main).toContain('const x = 1;');
        });

        it('does NOT inject profiler wrapper when profiling=false', () => {
            fs.writeFileSync(tmpDir + '/main.js', 'module.exports.loop = function() {};');

            const modules = loadBotModules(tmpDir, { profiling: false });

            expect(modules.main).not.toContain('__origLoop');
            expect(modules.main).not.toContain('profiler');
        });

        it('does NOT inject profiler wrapper into non-main files', () => {
            fs.writeFileSync(path.join(tmpDir, 'main.js'), 'module.exports.loop = function() {};');
            fs.writeFileSync(path.join(tmpDir, 'utils.js'), 'module.exports = { helper: () => 1 };');

            const modules = loadBotModules(tmpDir, { profiling: true });

            expect(modules.main).toContain('__origLoop');
            expect(modules.utils).not.toContain('__origLoop');
        });
    });
});
