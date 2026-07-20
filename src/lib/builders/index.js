'use strict';

/**
 * Builders — фабрики объектов мира для integration tests.
 *
 * API разделено на два слоя:
 *
 * - `spec` — чистые конструкторы spec-объектов (без БД, без сервера)
 * - `materialize*` — единственный слой, знающий DB shape (mockup)
 *
 * Materialize-функции параметризованы по `roomName` и `userId`,
 * так что один roomFixture можно переиспользовать в разных комнатах.
 * `s.id` используется как есть — главный потребитель `_id` это
 * memory fixture, и автоматическое переписывание id её сломало бы.
 *
 * @module builders
 */

// ─── Spec constructors (чистые, без БД) ─────────────────────────────────────

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
    loadFixture,
    hasFixture,
    saveFixture,
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
    loadFixture,
    hasFixture,
    saveFixture,
    deepMergeMemory,
    resolveMemorySource,
    normalizePerBotMemoryOption,
    resolveInitialMemoryByBot,
};
