'use strict';

/**
 * Общий парсер CLI-аргументов для integration tools.
 *
 * Поддержка:
 *   --flag          (bool, true если присутствует)
 *   --key value     (string, int, float, enum, json)
 *   --key=value     (то же самое)
 *   позиционные     (по порядку)
 *   --help          (автогенерация из schema)
 *
 * Валидация типов, диапазонов (min/max), неизвестных опций — fail-fast.
 *
 * Пример:
 *   const { parseArgs } = require('./cli');
 *   const schema = {
 *       positional: [{ name: 'name', required: true, description: 'имя fixture' }],
 *       options: {
 *           rcl:   { type: 'int', default: 3, min: 1, max: 8, description: 'целевой RCL' },
 *           force: { type: 'bool', default: false, description: 'перезаписать' },
 *       },
 *       title: 'capture-fixture',
 *       usage: 'node capture-fixture.js <name> [options]',
 *   };
 *   const { positional, options } = parseArgs(schema, process.argv.slice(2));
 */

class HelpRequested extends Error {
    constructor(helpText) {
        super(helpText);
        this.name = 'HelpRequested';
        this.helpText = helpText;
    }
}

/**
 * Форматирует значение для вывода в help.
 * @param {*} value
 * @returns {string}
 */
function formatDefault(value) {
    if (value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return `"${value}"`;
    }
    if (Array.isArray(value)) {
        return JSON.stringify(value);
    }
    return String(value);
}

/**
 * Генерирует текст help из schema.
 * @param {Object} schema
 * @returns {string}
 */
function generateHelp(schema) {
    const lines = [];

    if (schema.title) {
        lines.push(schema.title);
        lines.push('');
    }
    if (schema.usage) {
        lines.push(`Использование: ${schema.usage}`);
        lines.push('');
    }

    // Positional
    if (schema.positional && schema.positional.length > 0) {
        lines.push('Позиционные аргументы:');
        for (const p of schema.positional) {
            const req = p.required ? '(обязательный)' : '(необязательный)';
            lines.push(`  ${p.name.padEnd(20)} ${req}  ${p.description || ''}`);
        }
        lines.push('');
    }

    // Options
    const optEntries = Object.entries(schema.options || {});
    if (optEntries.length > 0) {
        lines.push('Опции:');
        for (const [key, opt] of optEntries) {
            const cliName = opt.cli || `--${key}`;
            const typeTag = opt.type === 'enum' ? `enum(${opt.values.join('|')})` : opt.type;
            const range =
                opt.type === 'int' || opt.type === 'float'
                    ? opt.min !== undefined || opt.max !== undefined
                        ? ` [${opt.min ?? '—'}..${opt.max ?? '—'}]`
                        : ''
                    : '';
            const def = opt.default !== undefined ? ` [по умолчанию: ${formatDefault(opt.default)}]` : '';
            lines.push(`  ${cliName.padEnd(22)} ${typeTag}${range}${def}`);
            if (opt.description) {
                lines.push(`${''.padEnd(26)} ${opt.description}`);
            }
        }
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Парсит строку JSON или кидает ошибку.
 * @param {string} raw
 * @param {string} key — имя аргумента (для сообщения об ошибке)
 * @returns {*}
 */
function parseJson(raw, key) {
    try {
        return JSON.parse(raw);
    } catch {
        throw new Error(`Опция --${key}: невалидный JSON: ${raw}`);
    }
}

/**
 * Валидирует числовое значение.
 * @param {string} key
 * @param {number} value
 * @param {Object} opt — schema опции
 */
function validateNumber(key, value, opt) {
    if (Number.isNaN(value)) {
        throw new Error(`Опция --${key}: ожидалось число, получено "${value}"`);
    }
    if (opt.min !== undefined && value < opt.min) {
        throw new Error(`Опция --${key}: ${value} < минимального ${opt.min}`);
    }
    if (opt.max !== undefined && value > opt.max) {
        throw new Error(`Опция --${key}: ${value} > максимального ${opt.max}`);
    }
}

/**
 * Парсит CLI аргументы по схеме.
 *
 * @param {Object} schema
 * @param {Array<{name:string, required?:boolean, description?:string}>} [schema.positional]
 * @param {Object<string, {type:string, default?:*, min?:number, max?:number, values?:string[], description?:string, cli?:string}>} schema.options
 * @param {string} [schema.title]
 * @param {string} [schema.usage]
 * @param {string[]} argv — process.argv.slice(2)
 * @returns {{ positional: Object<string,*>, options: Object<string,*> }}
 * @throws {HelpRequested|Error}
 */
function parseArgs(schema, argv) {
    if (argv.includes('--help') || argv.includes('-h')) {
        throw new HelpRequested(generateHelp(schema));
    }

    const positional = {};
    const options = {};
    const positionalDefs = schema.positional || [];
    const optionDefs = schema.options || {};

    // Build cli-to-key map for custom cli names
    const cliToKey = {};
    for (const [key, opt] of Object.entries(optionDefs)) {
        const cliName = opt.cli || `--${key}`;
        cliToKey[cliName] = key;
    }

    let posIdx = 0;
    let i = 0;

    while (i < argv.length) {
        const arg = argv[i];

        if (arg === '--') {
            // Everything after -- is positional
            i++;
            while (i < argv.length && posIdx < positionalDefs.length) {
                positional[positionalDefs[posIdx].name] = argv[i];
                posIdx++;
                i++;
            }
            break;
        }

        if (arg.startsWith('--') || arg.startsWith('-')) {
            // Option
            const eqIdx = arg.indexOf('=');
            let cliName, rawValue;

            if (eqIdx !== -1) {
                cliName = arg.slice(0, eqIdx);
                rawValue = arg.slice(eqIdx + 1);
            } else {
                cliName = arg;
                rawValue = undefined;
            }

            const key = cliToKey[cliName];
            if (!key) {
                throw new Error(`Неизвестная опция: ${cliName}\nВведите --help для справки.`);
            }

            const opt = optionDefs[key];

            if (opt.type === 'bool') {
                options[key] = true;
                i++;
            } else {
                // Need next token
                if (rawValue === undefined) {
                    if (i + 1 >= argv.length) {
                        throw new Error(`Опция ${cliName} требует значение.\nВведите --help для справки.`);
                    }
                    rawValue = argv[i + 1];
                    i += 2;
                } else {
                    i++;
                }

                switch (opt.type) {
                    case 'string':
                        options[key] = rawValue;
                        break;
                    case 'int': {
                        const v = parseInt(rawValue, 10);
                        validateNumber(key, v, opt);
                        options[key] = v;
                        break;
                    }
                    case 'float': {
                        const v = parseFloat(rawValue);
                        validateNumber(key, v, opt);
                        options[key] = v;
                        break;
                    }
                    case 'enum':
                        if (!opt.values || !opt.values.includes(rawValue)) {
                            throw new Error(
                                `Опция ${cliName}: "${rawValue}" не входит в допустимые значения: ${opt.values.join(', ')}`,
                            );
                        }
                        options[key] = rawValue;
                        break;
                    case 'json':
                        options[key] = parseJson(rawValue, key);
                        break;
                    default:
                        throw new Error(`Опция ${cliName}: неизвестный тип "${opt.type}"`);
                }
            }
        } else {
            // Positional
            if (posIdx < positionalDefs.length) {
                positional[positionalDefs[posIdx].name] = arg;
                posIdx++;
            }
            i++;
        }
    }

    // Validate required positional
    for (let j = 0; j < positionalDefs.length; j++) {
        const def = positionalDefs[j];
        if (def.required && positional[def.name] === undefined) {
            throw new Error(`Позиционный аргумент "${def.name}" обязателен.\nВведите --help для справки.`);
        }
    }

    // Fill defaults for missing options
    for (const [key, opt] of Object.entries(optionDefs)) {
        if (options[key] === undefined && opt.default !== undefined) {
            options[key] = opt.default;
        }
    }

    return { positional, options };
}

module.exports = { parseArgs, generateHelp, HelpRequested };
