'use strict';

/**
 * JavaScript error patterns that the engine may log WITHOUT an [ERROR] prefix.
 * Used to detect errors in lines from report.logs.
 */
const ERROR_PATTERNS = [
    /ReferenceError:\s/,
    /SyntaxError:\s/,
    /TypeError:\s/,
    /RangeError:\s/,
    /URIError:\s/,
    /EvalError:\s/,
    /is not defined/,
    /is not a function/,
    /Cannot read propert/,
    /Cannot call propert/,
    /Assignment to constant/,
    /Unexpected token/,
    /Unexpected end of input/,
    /Maximum call stack/,
    /Out of memory/,
];

/**
 * Warning patterns that the engine may log WITHOUT a [WARN] prefix.
 * Used to detect warnings in lines from report.logs.
 *
 * Currently empty, you can insert your patterns
 *
 * The `looksLikeWarn` function always returns `false` today.
 */
const WARN_PATTERNS = [];

const DEFAULT_LOG_LEVEL = 'error';
const DEFAULT_MAX_CONSOLE_LINES = 10000;
const VALID_LOG_LEVELS = ['all', 'error', 'warn'];

/**
 * Checks if a line looks like an error.
 * @param {string} line
 * @returns {boolean}
 */
function looksLikeError(line) {
    return ERROR_PATTERNS.some((p) => p.test(line));
}

/**
 * Checks if a line looks like a warning.
 * @param {string} line
 * @returns {boolean}
 */
function looksLikeWarn(line) {
    return WARN_PATTERNS.some((p) => p.test(line));
}

/**
 * Creates a console event handler for a mockup bot.
 *
 * Classification logic:
 *   1. '[ERROR]' + ERROR_PATTERNS → report.errors (always)
 *   2. '[WARN]' + WARN_PATTERNS → report.warnings (always)
 *   3. report.logs — accumulates all logs. Threshold is opts.logLevel
 *
 * @param {Object} [opts]
 * @param {Object} [opts.report] — external report object (created internally if not provided)
 * @param {'all'|'error'|'warn'} [opts.logLevel='error'] — threshold for report.logs: 'all' — all logs, 'warn' — errors and warnings, 'error' — errors only
 * @param {number} [opts.maxConsoleLines=10000] — max lines in report (spam protection)
 * @returns {{ handler: Function, report: { errors: string[], warnings: string[], logs: string[] } }}
 */
function createConsoleCapture(opts = {}) {
    const report = opts.report || { errors: [], warnings: [], logs: [] };
    const logLevel = opts.logLevel || DEFAULT_LOG_LEVEL;
    if (!VALID_LOG_LEVELS.includes(logLevel)) {
        throw new Error(
            `Invalid logLevel "${logLevel}". Valid values: ${VALID_LOG_LEVELS.map((v) => `"${v}"`).join(', ')}`,
        );
    }
    const maxConsoleLines = opts.maxConsoleLines || DEFAULT_MAX_CONSOLE_LINES;

    const handler = (logs /*, results, userid, username */) => {
        if (report.errors.length + report.warnings.length + report.logs.length > maxConsoleLines) {
            return;
        }
        for (const line of logs) {
            const isError = line.includes('[ERROR]') || looksLikeError(line);
            const isWarn = line.includes('[WARN]') || looksLikeWarn(line);

            if (isError) {
                report.errors.push(line);
                report.logs.push(line);
            } else if (isWarn) {
                report.warnings.push(line);
                if (logLevel !== 'error') {
                    report.logs.push(line);
                }
            } else if (logLevel === 'all') {
                report.logs.push(line);
            }
        }
    };

    return { handler, report };
}

module.exports = { createConsoleCapture, looksLikeError, ERROR_PATTERNS, DEFAULT_LOG_LEVEL, DEFAULT_MAX_CONSOLE_LINES };
