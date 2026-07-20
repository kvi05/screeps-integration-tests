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
 * Записывает Memory бота напрямую в storage.
 *
 * @param {StorageAdapter} adapter
 * @param {string} userId              — _id пользователя из БД
 * @param {BotMemory} memory           — объект Memory
 * @returns {Promise<void>}
 */
async function setBotMemory(adapter, userId, memory) {
    const { env } = adapter;
    await env.set(env.keys.MEMORY + userId, JSON.stringify(memory));
}

/**
 * Читает Memory бота из storage.
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
 * Загружает memory fixture-файл по имени.
 *
 * @param {string} fixtureName              — имя файла без `.memory.json` (например 'rcl3-stable')
 * @returns {BotMemory}
 * @throws {Error} если файл не найден
 */
function loadFixture(fixtureName) {
    const fixturePath = path.join(resolveFixturesDir(), `${fixtureName}.memory.json`);
    if (!fs.existsSync(fixturePath)) {
        throw new Error(
            `Fixture "${fixtureName}" не найден: ${fixturePath}\n` +
                'Создайте fixture по инструкции: src/fixtures/FIXTURES-GUIDE.md',
        );
    }
    return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

/**
 * Проверяет существует ли memory fixture.
 *
 * @param {string} fixtureName
 * @returns {boolean}
 */
function hasFixture(fixtureName) {
    const fixturePath = path.join(resolveFixturesDir(), `${fixtureName}.memory.json`);
    return fs.existsSync(fixturePath);
}

/**
 * Сохраняет Memory как fixture.
 *
 * @param {string} fixtureName
 * @param {BotMemory} memory
 * @param {Object} [opts]
 * @param {boolean} [opts.force=true]     — разрешить перезапись существующего fixture
 * @returns {{ path: string, size: number, existed: boolean }}
 * @throws {Error} если файл уже существует и `opts.force === false`
 */
function saveFixture(fixtureName, memory, opts = {}) {
    const force = opts.force !== false;
    const fixturePath = path.join(resolveFixturesDir(), `${fixtureName}.memory.json`);
    const existed = fs.existsSync(fixturePath);

    if (existed && !force) {
        throw new Error(
            `Fixture "${fixtureName}" уже существует: ${fixturePath}\n` + 'Используйте --force для перезаписи.',
        );
    }

    const json = JSON.stringify(memory, null, 2);
    fs.mkdirSync(resolveFixturesDir(), { recursive: true });
    fs.writeFileSync(fixturePath, json, 'utf8');

    return { path: fixturePath, size: Buffer.byteLength(json, 'utf8'), existed };
}

/**
 * Глубокое слияние (deep merge) объектов Memory.
 *
 * Семантика: plain objects мерджатся рекурсивно, массивы и примитивы —
 * заменяются значением из patch. `undefined` в patch игнорируется
 * (не затирает существующие данные). Это и есть ожидаемое memory override
 * semantics, которым пользуются `createWorld()` и `world.writeMemory()`.
 *
 * Приоритет: чем позже источник — тем выше. `deepMergeMemory(a, b)` =
 * `a` + наложенный `b`.
 *
 * @param {Object} target — базовый объект (не мутируется)
 * @param {...Object} sources — патчи, мерджатся в порядке передачи
 * @returns {Object} новый объект-результат
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
 * Нормализует источник стартовой памяти одного бота.
 *
 * Поддерживаемые формы:
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
        throw new Error(`${contextLabel}: ожидается fixture name или object, получено ${typeof source}`);
    }
    if (typeof source.fixture === 'string') {
        const { fixture, ...inlineOverrides } = source;
        const base = loadFixture(fixture);
        return Object.keys(inlineOverrides).length > 0 ? deepMergeMemory(base, inlineOverrides) : base;
    }
    return source;
}

/**
 * Возвращает true, если значение похоже на map по username, а не на объект Memory.
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
 * Нормализует `memory` / `memoryOverrides` к per-bot map.
 *
 * Для single-bot сценариев допускается shorthand без username.
 * Для multi-bot требуется явная map по username.
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
        throw new Error(`createWorld: ${optionName} нельзя задавать без bots`);
    }

    throw new Error(
        `createWorld: для multi-bot ${optionName} должен быть объектом вида { username: memory }, боты: ${botNames.join(', ')}`,
    );
}

/**
 * Резолвит initial memory для всех ботов по явному контракту `memory` + `memoryOverrides`.
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
