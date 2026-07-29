'use strict';

/**
 * @file Memory snapshot (fixture) load / save / merge helpers.
 *
 * Responsibility:
 *   Manage `*.memory.json` fixture files stored in the directory configured
 *   by `memoryFixturesDir` (default `./fixtures`).  These snapshots capture the
 *   entire `Memory` object of a bot at a given point in time and are used
 *   to set up repeatable test scenarios.
 *
 * **Available functions:**
 *
 * | Function | Purpose |
 * |---|---|
 * | `loadFixture(name)` | Load a memory fixture (throws if missing) |
 * | `hasFixture(name)` | Check whether a memory fixture exists |
 * | `saveFixture(name, memory, opts?)` | Save memory to a fixture file |
 * | `deepMergeMemory(target, ...sources)` | Recursive deep merge of Memory objects |
 * | `resolveMemorySource(source, context)` | Normalise a memory source (string → fixture, object → inline) |
 * | `resolveInitialMemoryByBot(botNames, memory, memoryOverrides)` | Resolve initial Memory per bot |
 * | `setBotMemory(server, userId, memory)` | Write Memory directly to storage (env) |
 * | `getBotMemory(server, userId)` | Read Memory directly from storage (env) |
 *
 * @example
 * const { hasFixture, loadFixture } = require('screeps-integration-tests/memory-fixtures');
 * if (!hasFixture('rcl3-stable')) {
 *     console.log('SKIP: fixture not found');
 *     return { skipped: true };
 * }
 * const memory = loadFixture('rcl3-stable');
 *
 * @module screeps-integration-tests/memory-fixtures
 */

const {
    setBotMemory,
    getBotMemory,
    loadFixture,
    hasFixture,
    saveFixture,
    deepMergeMemory,
    resolveMemorySource,
    resolveInitialMemoryByBot,
} = require('../lib/builders/memory');

module.exports = {
    setBotMemory,
    getBotMemory,
    loadFixture,
    hasFixture,
    saveFixture,
    deepMergeMemory,
    resolveMemorySource,
    resolveInitialMemoryByBot,
};
