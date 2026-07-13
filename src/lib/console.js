'use strict';

/**
 * Паттерны ошибок JavaScript, которые engine может логировать БЕЗ префикса [ERROR].
 * Используются для обнаружения ошибок в lines из report.logs.
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
 * Паттерны ваших предупреждений, которые engine может логировать БЕЗ префикса [WARN].
 * Используются для обнаружения предупреждений в lines из report.logs.
 */
const WARN_PATTERNS = [];

/**
 * Проверяет содержит ли строка признаки ошибки.
 * @param {string} line
 * @returns {boolean}
 */
function looksLikeError(line) {
    return ERROR_PATTERNS.some((p) => p.test(line));
}

/**
 * Проверяет содержит ли строка признаки предупреждения.
 * @param {string} line
 * @returns {boolean}
 */
function looksLikeWarn(line) {
    return WARN_PATTERNS.some((p) => p.test(line));
}

/**
 * Создаёт обработчик console-событий mockup-бота.
 *
 * Логика классификации:
 *   1. '[ERROR]' + ERROR_PATTERNS → report.errors (всегда)
 *   2. '[WARN]' + WARN_PATTERNS → report.warnings (всегда)
 *   3. report.logs - аккамулирует все логи. Порог - opts.logLevel
 *
 * @param {Object} [opts]
 * @param {Object} [opts.report] — внешний report объект (если не передан — создаётся свой)
 * @param {'all'|'error'|'warn'} [opts.logLevel='errors'] — 'errors' (только ошибки) | 'all' (+ предупреждения и логи)
 * @param {number} [opts.maxConsoleLines=10000] — максимум строк в report (защита от спама)
 * @returns {{ handler: Function, report: { errors: string[], warnings: string[], logs: string[] } }}
 */
function createConsoleCapture(opts = {}) {
    const report = opts.report || { errors: [], warnings: [], logs: [] };
    const logLevel = opts.logLevel || 'error';
    const maxConsoleLines = opts.maxConsoleLines || 10000;

    const handler = (logs /*, results, userid, username */) => {
        if (report.errors.length + report.warnings.length + report.logs.length > maxConsoleLines) {
            return;
        }
        for (const line of logs) {
            const isError = line.includes('[ERROR]') || looksLikeError(line);
            const isWarn = line.includes('[WARN]') || looksLikeWarn(line);

            const addLog = (target, level) => {
                report[target].push(line);
                if (logLevel === level) {
                    report.logs.push(line);
                }
            };

            if (isError) {
                addLog('errors', 'error');
            } else if (isWarn) {
                addLog('warnings', 'warn');
            } else if (logLevel === 'all') {
                report.logs.push(line);
            }
        }
    };

    return { handler, report };
}

module.exports = { createConsoleCapture, looksLikeError, ERROR_PATTERNS };
