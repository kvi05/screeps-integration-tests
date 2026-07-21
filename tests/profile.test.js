'use strict';

/**
 * Unit tests for profile.js — profiler finalisation and callgrind export.
 *
 * Cover:
 * - exportProfiles: sets __profileFinalize, runs server.tick(),
 *   handles errors, empty profiling bots list
 * - saveCallgrind: creates file with correct name, writes data,
 *   creates profiles dir if needed
 *
 * @file Unit tests for profile.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { exportProfiles, saveCallgrind } = require('../src/lib/runtime/profile');

describe('exportProfiles', () => {
    it('does nothing when no profiled bots', async () => {
        const writeMemoryFn = jest.fn();
        const server = { tick: jest.fn() };
        const report = { errors: [] };

        await exportProfiles({}, writeMemoryFn, server, report);

        expect(writeMemoryFn).not.toHaveBeenCalled();
        expect(server.tick).not.toHaveBeenCalled();
    });

    it('sets __profileFinalize and calls server.tick() for profiled bots', async () => {
        const writeMemoryFn = jest.fn().mockResolvedValue(undefined);
        const server = { tick: jest.fn().mockResolvedValue(undefined) };
        const report = { errors: [] };

        const resolvedBots = {
            bot1: { effectiveProfiling: true },
            bot2: { effectiveProfiling: false }, // non-profiled — skipped
            bot3: { effectiveProfiling: true },
        };

        await exportProfiles(resolvedBots, writeMemoryFn, server, report);

        expect(writeMemoryFn).toHaveBeenCalledTimes(2);
        expect(writeMemoryFn).toHaveBeenCalledWith('bot1', { __profileFinalize: true });
        expect(writeMemoryFn).toHaveBeenCalledWith('bot3', { __profileFinalize: true });
        expect(server.tick).toHaveBeenCalledTimes(1);
    });

    it('pushes error to report.errors when server.tick() fails', async () => {
        const writeMemoryFn = jest.fn().mockResolvedValue(undefined);
        const server = { tick: jest.fn().mockRejectedValue(new Error('tick failed')) };
        const report = { errors: [] };

        const resolvedBots = {
            bot1: { effectiveProfiling: true },
        };

        await exportProfiles(resolvedBots, writeMemoryFn, server, report);

        expect(report.errors).toHaveLength(1);
        expect(report.errors[0]).toContain('tick failed');
    });
});

describe('saveCallgrind', () => {
    /** @type {string} */
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'callgrind-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates a file with the correct name pattern and content', () => {
        const data = 'callgrind data here';
        const filePath = saveCallgrind(data, 'my-scenario', tmpDir);

        expect(filePath).toContain('my-scenario');
        expect(filePath).toMatch(/\.callgrind$/);
        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readFileSync(filePath, 'utf8')).toBe(data);
    });

    it('creates the profiles directory if it does not exist', () => {
        const nestedDir = path.join(tmpDir, 'nested', 'profiles');
        const data = 'test data';

        const filePath = saveCallgrind(data, 'test-scenario', nestedDir);

        expect(fs.existsSync(nestedDir)).toBe(true);
        expect(fs.existsSync(filePath)).toBe(true);
    });

    it('returns the absolute file path', () => {
        const data = 'data';
        const filePath = saveCallgrind(data, 'abc', tmpDir);

        expect(path.isAbsolute(filePath)).toBe(true);
    });

    it('generates unique filenames on each call (timestamp differs)', () => {
        const data1 = 'first version';
        const data2 = 'second version';

        const filePath1 = saveCallgrind(data1, 'unique-test', tmpDir);
        const filePath2 = saveCallgrind(data2, 'unique-test', tmpDir);

        // Timestamp in the name ensures unique paths
        expect(filePath1).not.toBe(filePath2);
        expect(fs.readFileSync(filePath1, 'utf8')).toBe(data1);
        expect(fs.readFileSync(filePath2, 'utf8')).toBe(data2);
    });
});
