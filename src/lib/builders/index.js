'use strict';

/**
 * Builders — world object factories for integration tests.
 *
 * API is split into two layers:
 *
 * - `spec` — pure spec-object constructors (no DB, no server)
 * - `materialize*` — the only layer aware of DB shape (mockup)
 *
 * Materialize functions are parameterized by `roomName` and `userId`,
 * so one roomFixture can be reused across different rooms.
 * `s.id` is used as-is — the main consumer of `_id` is
 * memory fixture, and automatic id rewriting would break it.
 *
 * @module builders
 */

// ─── Spec constructors (pure, no DB) ─────────────────────────────────────

const spec = require('./spec');

const {
    materializeStructure,
    materializeStructures,
    materializeSource,
    materializeSources,
    materializeController,
    materializeCreep,
    materializeCreeps,
    materializeRoom,
} = require('./materialize');

const {
    setBotMemory,
    getBotMemory,
    loadMemoryFixture,
    hasMemoryFixture,
    saveMemoryFixture,
    deepMergeMemory,
    resolveMemorySource,
    normalizePerBotMemoryOption,
    resolveInitialMemoryByBot,
} = require('./memory');

/**
 * @typedef {import('../types').StructureSpec} StructureSpec
 * @typedef {import('../types').SourceSpecCanonical} SourceSpecCanonical
 * @typedef {import('../types').ControllerSpec} ControllerSpec
 * @typedef {import('../types').CreepSpecCanonical} CreepSpecCanonical
 * @typedef {import('../types').RoomSpecCanonical} RoomSpecCanonical
 * @typedef {import('../storageAdapter').StorageAdapter} StorageAdapter
 */

module.exports = {
    spec,

    materializeStructure,
    materializeStructures,
    materializeSource,
    materializeSources,
    materializeController,
    materializeCreep,
    materializeCreeps,
    materializeRoom,

    setBotMemory,
    getBotMemory,
    loadMemoryFixture,
    hasMemoryFixture,
    saveMemoryFixture,
    deepMergeMemory,
    resolveMemorySource,
    normalizePerBotMemoryOption,
    resolveInitialMemoryByBot,
};
