'use strict';

/**
 * Generic CLI argument parser for integration tools.
 *
 * Supports:
 *   --flag          (bool, true if present)
 *   --key value     (string, int, float, enum, json)
 *   --key=value     (same)
 *   positional      (in order)
 *   --help          (auto-generated from schema)
 *   --version|-v       (print version and exit)
 *
 * Type validation, range checks (min/max), unknown options — fail-fast.
 *
 * Example:
 *   const { parseArgs } = require('./cli');
 *   const schema = {
 *       positional: [{ name: 'name', required: true, description: 'fixture name' }],
 *       options: {
 *           rcl:   { type: 'int', default: 3, min: 1, max: 8, description: 'target RCL' },
 *           force: { type: 'bool', default: false, description: 'overwrite' },
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
 * Signals that the CLI version was requested via `--version`.
 *
 * Thrown before any parsing happens, mirroring `HelpRequested` for `--help`.
 * The CLI runner catches this to print the package version and exit 0.
 */
class VersionRequested extends Error {
    constructor() {
        super('Version requested');
        this.name = 'VersionRequested';
    }
}

/**
 * Formats a value for help output.
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
 * Generates help text from a schema.
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
        lines.push(`Usage: ${schema.usage}`);
        lines.push('');
    }

    // Positional
    if (schema.positional && schema.positional.length > 0) {
        lines.push('Positional arguments:');
        for (const p of schema.positional) {
            const req = p.required ? '(required)' : '(optional)';
            lines.push(`  ${p.name.padEnd(20)} ${req}  ${p.description || ''}`);
        }
        lines.push('');
    }

    // Options
    const optEntries = Object.entries(schema.options || {});
    if (optEntries.length > 0) {
        lines.push('Options:');
        for (const [key, opt] of optEntries) {
            const cliName = opt.cli || `--${key}`;
            const typeTag = opt.type === 'enum' ? `enum(${opt.values.join('|')})` : opt.type;
            const range =
                opt.type === 'int' || opt.type === 'float'
                    ? opt.min !== undefined || opt.max !== undefined
                        ? ` [${opt.min ?? '—'}..${opt.max ?? '—'}]`
                        : ''
                    : '';
            const def = opt.default !== undefined ? ` [default: ${formatDefault(opt.default)}]` : '';
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
 * Parses a JSON string or throws an error.
 * @param {string} raw
 * @param {string} key — argument name (for error messages)
 * @returns {*}
 */
function parseJson(raw, key) {
    try {
        return JSON.parse(raw);
    } catch {
        throw new Error(`Option --${key}: invalid JSON: ${raw}`);
    }
}

/**
 * Validates a numeric value.
 * @param {string} key
 * @param {number} value
 * @param {Object} opt — schema option definition
 */
function validateNumber(key, value, opt) {
    if (Number.isNaN(value)) {
        throw new Error(`Option --${key}: expected a number, got "${value}"`);
    }
    if (opt.min !== undefined && value < opt.min) {
        throw new Error(`Option --${key}: ${value} < min ${opt.min}`);
    }
    if (opt.max !== undefined && value > opt.max) {
        throw new Error(`Option --${key}: ${value} > max ${opt.max}`);
    }
}

/**
 * Parses CLI arguments according to a schema.
 *
 * @param {Object} schema
 * @param {Array<{name:string, required?:boolean, description?:string}>} [schema.positional]
 * @param {Object<string, {type:string, default?:*, min?:number, max?:number, values?:string[], description?:string, cli?:string}>} schema.options
 * @param {string} [schema.title]
 * @param {string} [schema.usage]
 * @param {string[]} argv — process.argv.slice(2)
 * @returns {{ positional: Object<string,*>, options: Object<string,*> }}
 * @throws {HelpRequested|VersionRequested|Error}
 */
function parseArgs(schema, argv) {
    if (argv.includes('--help') || argv.includes('-h')) {
        throw new HelpRequested(generateHelp(schema));
    }
    if (argv.includes('--version') || argv.includes('-v')) {
        throw new VersionRequested();
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
                throw new Error(`Unknown option: ${cliName}\nUse --help for usage.`);
            }

            const opt = optionDefs[key];

            if (opt.type === 'bool') {
                options[key] = true;
                i++;
            } else {
                // Need next token
                if (rawValue === undefined) {
                    if (i + 1 >= argv.length) {
                        throw new Error(`Option ${cliName} requires a value.\nUse --help for usage.`);
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
                                `Option ${cliName}: "${rawValue}" is not a valid value. Allowed: ${opt.values.join(', ')}`,
                            );
                        }
                        options[key] = rawValue;
                        break;
                    case 'json':
                        options[key] = parseJson(rawValue, key);
                        break;
                    default:
                        throw new Error(`Option ${cliName}: unknown type "${opt.type}"`);
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
            throw new Error(`Positional argument "${def.name}" is required.\nUse --help for usage.`);
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

module.exports = { parseArgs, generateHelp, HelpRequested, VersionRequested };
