'use strict';

const fs = require('fs');
const path = require('path');

function resolveFixturesDir() {
    return process.env.SIT_FIXTURES_DIR || path.resolve(process.cwd(), 'fixtures');
}

/**
 * @typedef {import('../storageAdapter').StorageAdapter} StorageAdapter
 * @typedef {Object<string,*>} BotMemory
 */

/**
 * Writes bot Memory directly to storage.
 *
 * @param {StorageAdapter} adapter
 * @param {string} userId              — user _id from DB
 * @param {BotMemory} memory           — Memory object
 * @returns {Promise<void>}
 */
async function setBotMemory(adapter, userId, memory) {
    const { env } = adapter;
    await env.set(env.keys.MEMORY + userId, JSON.stringify(memory));
}

/**
 * Reads bot Memory from storage.
 *
 * @param {StorageAdapter} adapter
 * @param {string} userId
 * @returns {Promise<BotMemory>}
 */
async function getBotMemory(adapter, userId) {
    const { env } = adapter;
    const raw = await env.get(env.keys.MEMORY + userId);
    return JSON.parse(raw || '{}');
}

/**
 * Loads a memory fixture file by name.
 *
 * @param {string} fixtureName              — filename without `.memory.json` (e.g. 'rcl3-stable')
 * @returns {BotMemory}
 * @throws {Error} if file not found
 */
function loadFixture(fixtureName) {
    const fixturePath = path.join(resolveFixturesDir(), `${fixtureName}.memory.json`);
    if (!fs.existsSync(fixturePath)) {
        throw new Error(
            `Fixture "${fixtureName}" not found: ${fixturePath}\n` +
                'Create a fixture per the guide: docs/FIXTURES-GUIDE.md',
        );
    }
    return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

/**
 * Checks if a memory fixture exists.
 *
 * @param {string} fixtureName
 * @returns {boolean}
 */
function hasFixture(fixtureName) {
    const fixturePath = path.join(resolveFixturesDir(), `${fixtureName}.memory.json`);
    return fs.existsSync(fixturePath);
}

/**
 * Saves Memory as a fixture.
 *
 * @param {string} fixtureName
 * @param {BotMemory} memory
 * @param {Object} [opts]
 * @param {boolean} [opts.force=true]     — allow overwriting existing fixture
 * @returns {{ path: string, size: number, existed: boolean }}
 * @throws {Error} if file already exists and `opts.force === false`
 */
function saveFixture(fixtureName, memory, opts = {}) {
    const force = opts.force !== false;
    const fixturePath = path.join(resolveFixturesDir(), `${fixtureName}.memory.json`);
    const existed = fs.existsSync(fixturePath);

    if (existed && !force) {
        throw new Error(`Fixture "${fixtureName}" already exists: ${fixturePath}\n` + 'Use --force to overwrite.');
    }

    const json = JSON.stringify(memory, null, 2);
    fs.mkdirSync(resolveFixturesDir(), { recursive: true });
    fs.writeFileSync(fixturePath, json, 'utf8');

    return { path: fixturePath, size: Buffer.byteLength(json, 'utf8'), existed };
}

/**
 * Deep merge of Memory objects.
 *
 * Semantics: plain objects are merged recursively, arrays and primitives
 * are replaced by the value from patch. `undefined` in patch is ignored
 * (does not overwrite existing data). This is the expected memory override
 * semantics used by `createWorld()` and `world.writeMemory()`.
 *
 * Priority: later sources take precedence. `deepMergeMemory(a, b)` =
 * `a` overlaid with `b`.
 *
 * @param {Object} target — base object (not mutated)
 * @param {...Object} sources — patches, merged in order
 * @returns {Object} new result object
 */
function deepMergeMemory(target, ...sources) {
    const result = { ...target };
    for (const source of sources) {
        if (!source) {
            continue;
        }
        for (const key of Object.keys(source)) {
            const value = source[key];
            if (value === undefined) {
                continue;
            }
            if (
                value &&
                typeof value === 'object' &&
                !Array.isArray(value) &&
                result[key] &&
                typeof result[key] === 'object' &&
                !Array.isArray(result[key])
            ) {
                result[key] = deepMergeMemory(result[key], value);
            } else {
                result[key] = value;
            }
        }
    }
    return result;
}

/**
 * Normalizes a single bot's initial memory source.
 *
 * Supported forms:
 * - `'fixture-name'`
 * - `{ fixture: 'fixture-name' }`
 * - inline object Memory
 *
 * @param {string|BotMemory|undefined|null} source
 * @param {string} contextLabel
 * @returns {BotMemory|null}
 */
function resolveMemorySource(source, contextLabel) {
    if (source === undefined || source === null) {
        return null;
    }
    if (typeof source === 'string') {
        return loadFixture(source);
    }
    if (typeof source !== 'object' || Array.isArray(source)) {
        throw new Error(`${contextLabel}: expected fixture name or object, got ${typeof source}`);
    }
    if (typeof source.fixture === 'string') {
        const { fixture, ...inlineOverrides } = source;
        const base = loadFixture(fixture);
        return Object.keys(inlineOverrides).length > 0 ? deepMergeMemory(base, inlineOverrides) : base;
    }
    return source;
}

/**
 * Returns true if the value looks like a map by username rather than a Memory object.
 *
 * @param {Object<string,*>|undefined|null} value
 * @param {string[]} botNames
 * @returns {boolean}
 */
function isPerBotMemoryMap(value, botNames) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (botNames.length === 0) {
        return false;
    }
    return Object.keys(value).some((key) => botNames.includes(key));
}

/**
 * Normalizes `memory` / `memoryOverrides` to a per-bot map.
 *
 * For single-bot scenarios, a shorthand without username is allowed.
 * For multi-bot, an explicit username map is required.
 *
 * @param {string} optionName
 * @param {string|BotMemory|Object<string,*>|undefined|null} value
 * @param {string[]} botNames
 * @returns {Object<string,*>}
 */
function normalizePerBotMemoryOption(optionName, value, botNames) {
    if (value === undefined || value === null) {
        return {};
    }

    if (isPerBotMemoryMap(value, botNames)) {
        return value;
    }

    if (botNames.length === 1) {
        return { [botNames[0]]: value };
    }

    if (botNames.length === 0) {
        throw new Error(`createWorld: ${optionName} cannot be set without bots`);
    }

    throw new Error(
        `createWorld: for multi-bot ${optionName} must be an object of the form { username: memory }, bots: ${botNames.join(', ')}`,
    );
}

/**
 * Resolves initial memory for all bots by explicit contract `memory` + `memoryOverrides`.
 *
 * @param {string[]} botNames
 * @param {string|BotMemory|Object<string,*>|undefined|null} memory
 * @param {BotMemory|Object<string,*>|undefined|null} memoryOverrides
 * @returns {Object<string,BotMemory>}
 */
function resolveInitialMemoryByBot(botNames, memory, memoryOverrides) {
    const baseByBot = normalizePerBotMemoryOption('memory', memory, botNames);
    const overridesByBot = normalizePerBotMemoryOption('memoryOverrides', memoryOverrides, botNames);

    /** @type {Object<string,BotMemory>} */
    const resolved = {};
    for (const username of botNames) {
        const base = resolveMemorySource(baseByBot[username], `createWorld.memory.${username}`);
        const patch = overridesByBot[username];
        const merged = deepMergeMemory(base || {}, patch || {});
        if (Object.keys(merged).length > 0) {
            resolved[username] = merged;
        }
    }
    return resolved;
}

module.exports = {
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
