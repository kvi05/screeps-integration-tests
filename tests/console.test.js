'use strict';

const {
    classifyConsoleLine,
    createConsoleCapture,
    looksLikeError,
    ERROR_PATTERNS,
} = require('../src/lib/runtime/console');

describe('console capture', () => {
    describe('looksLikeError', () => {
        it('detects ReferenceError', () => {
            expect(looksLikeError('ReferenceError: foo is not defined')).toBe(true);
        });

        it('detects SyntaxError', () => {
            expect(looksLikeError('SyntaxError: Unexpected token')).toBe(true);
        });

        it('detects TypeError', () => {
            expect(looksLikeError('TypeError: Cannot read property')).toBe(true);
        });

        it('detects "is not defined"', () => {
            expect(looksLikeError('Something is not defined')).toBe(true);
        });

        it('detects "Maximum call stack"', () => {
            expect(looksLikeError('Maximum call stack size exceeded')).toBe(true);
        });

        it('does not trigger on a normal string', () => {
            expect(looksLikeError('Harvester moving to source')).toBe(false);
        });

        it('does not trigger on empty string', () => {
            expect(looksLikeError('')).toBe(false);
        });
    });

    describe('classifyConsoleLine', () => {
        it('classifies [ERROR] line as error and strips the marker', () => {
            expect(classifyConsoleLine('[ERROR] Something went wrong')).toEqual({
                level: 'error',
                message: 'Something went wrong',
            });
        });

        it('classifies [WARN] line as warn and strips the marker', () => {
            expect(classifyConsoleLine('[WARN] Low energy')).toEqual({
                level: 'warn',
                message: 'Low energy',
            });
        });

        it('classifies unprefixed engine error (TypeError) as error', () => {
            const line = "TypeError: Cannot read property 'x' of undefined";
            expect(classifyConsoleLine(line)).toEqual({ level: 'error', message: line });
        });

        it('classifies ReferenceError pattern as error', () => {
            expect(classifyConsoleLine('ReferenceError: foo is not defined').level).toBe('error');
        });

        it('detects the marker anywhere in the line, not only at the start', () => {
            expect(classifyConsoleLine('bot [ERROR] boom').level).toBe('error');
            expect(classifyConsoleLine('bot [WARN] careful').level).toBe('warn');
        });

        it('classifies normal line as info with message unchanged', () => {
            expect(classifyConsoleLine('Harvester moving to source')).toEqual({
                level: 'info',
                message: 'Harvester moving to source',
            });
        });
    });

    // createConsoleCapture (report.errors/warnings) and classifyConsoleLine
    // (viewer entries) must classify identically — the UI Error/Warn tabs
    // depend on it.
    describe('classification consistency', () => {
        it('createConsoleCapture and classifyConsoleLine agree on every line', () => {
            const lines = [
                '[ERROR] boom',
                '[WARN] careful',
                'TypeError: Cannot read property x of undefined',
                'Harvester moving to source',
            ];
            const { handler, report } = createConsoleCapture({ logLevel: 'all' });
            handler(lines);
            for (const line of lines) {
                const { level } = classifyConsoleLine(line);
                expect(report.errors.includes(line)).toBe(level === 'error');
                expect(report.warnings.includes(line)).toBe(level === 'warn');
            }
        });

        it('createConsoleCapture keeps full lines in report.errors (marker included)', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'all' });
            handler(['[ERROR] boom', 'TypeError: nope', '[WARN] careful', 'all good']);
            expect(report.errors).toEqual(['[ERROR] boom', 'TypeError: nope']);
            expect(report.warnings).toEqual(['[WARN] careful']);
            expect(report.logs).toEqual(['[ERROR] boom', 'TypeError: nope', '[WARN] careful', 'all good']);
        });
    });

    describe('createConsoleCapture', () => {
        // logLevel semantics:
        //   'all'   — errors → errors + logs; warnings → warnings + logs; normal → logs
        //   'error' — errors → errors + logs; warnings → warnings; normal → nowhere
        //   'warn'  — errors → errors + logs; warnings → warnings + logs; normal → nowhere

        it('classifies [ERROR] string as error (logLevel=all: errors + logs)', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'all' });
            handler(['[ERROR] Something went wrong']);
            expect(report.errors).toEqual(['[ERROR] Something went wrong']);
            expect(report.logs).toEqual(['[ERROR] Something went wrong']);
        });

        it('classifies [ERROR] string as error (logLevel=error: errors + logs)', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'error' });
            handler(['[ERROR] Something went wrong']);
            expect(report.errors).toEqual(['[ERROR] Something went wrong']);
            expect(report.logs).toEqual(['[ERROR] Something went wrong']);
        });

        it('classifies string with ERROR_PATTERNS as error', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'all' });
            handler(['ReferenceError: x is not defined']);
            expect(report.errors).toEqual(['ReferenceError: x is not defined']);
        });

        it('classifies [WARN] string as warning (logLevel=all: warnings + logs)', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'all' });
            handler(['[WARN] Low energy']);
            expect(report.warnings).toEqual(['[WARN] Low energy']);
            expect(report.logs).toEqual(['[WARN] Low energy']);
        });

        it('classifies [WARN] string as warning (logLevel=warn: warnings + logs)', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'warn' });
            handler(['[WARN] Low energy']);
            expect(report.warnings).toEqual(['[WARN] Low energy']);
            expect(report.logs).toEqual(['[WARN] Low energy']);
        });

        it('with logLevel=error normal logs do not go to report.logs', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'error' });
            handler(['Upgrader working']);
            expect(report.logs).toEqual([]);
        });

        it('with logLevel=warn normal logs do NOT go to logs', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'warn' });
            handler(['Normal log']);
            expect(report.logs).toEqual([]);
        });

        it('maxConsoleLines truncates logs (limit on total line count)', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'all', maxConsoleLines: 2 });
            handler(['line1']);
            handler(['line2']);
            handler(['line3']);
            // After line1: total=1, line2: total=2, line3: total=2 (2>2? false → adds)
            // line4 would be blocked
            expect(report.logs).toEqual(['line1', 'line2', 'line3']);
        });

        it('maxConsoleLines blocks the next batch after exceeding limit', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'all', maxConsoleLines: 2 });
            handler(['line1', 'line2']);
            handler(['line3']);
            // After 1st call: total=2, 2nd call: total=2, 2>2? false → adds line3
            expect(report.logs).toEqual(['line1', 'line2', 'line3']);
            // 3rd call: total=3, 3>2? true → blocked
            handler(['line4']);
            expect(report.logs).toEqual(['line1', 'line2', 'line3']);
        });

        it('maxConsoleLines truncates total errors+warnings+logs', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'all', maxConsoleLines: 2 });
            handler(['line1']);
            handler(['[ERROR] err']);
            expect(report.errors).toEqual(['[ERROR] err']);
            expect(report.logs).toEqual(['line1', '[ERROR] err']);
        });

        it('creates its own report if no external report provided', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'all' });
            handler(['test']);
            expect(report.logs).toEqual(['test']);
            expect(report.errors).toEqual([]);
            expect(report.warnings).toEqual([]);
        });

        it('accepts external report', () => {
            const external = { errors: [], warnings: [], logs: [] };
            const { handler, report } = createConsoleCapture({ report: external, logLevel: 'all' });
            handler(['test']);
            expect(report).toBe(external);
            expect(external.logs).toEqual(['test']);
        });

        it('empty log array does not change report', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'all' });
            handler([]);
            expect(report.logs).toEqual([]);
        });

        it('default logLevel is "all" (info messages go to logs)', () => {
            const { handler, report } = createConsoleCapture();
            handler(['message']);
            expect(report.logs).toEqual(['message']);
        });

        describe('logLevel validation', () => {
            it('throws TypeError on logLevel="errors"', () => {
                expect(() => createConsoleCapture({ logLevel: 'errors' })).toThrow('Invalid logLevel');
            });

            it('throws TypeError on logLevel="silent"', () => {
                expect(() => createConsoleCapture({ logLevel: 'silent' })).toThrow('Invalid logLevel');
            });

            it('throws TypeError on logLevel="unknown"', () => {
                expect(() => createConsoleCapture({ logLevel: 'unknown' })).toThrow('Invalid logLevel');
            });

            it('does not throw on logLevel="all"', () => {
                expect(() => createConsoleCapture({ logLevel: 'all' })).not.toThrow();
            });

            it('does not throw on logLevel="warn"', () => {
                expect(() => createConsoleCapture({ logLevel: 'warn' })).not.toThrow();
            });

            it('does not throw on logLevel="error"', () => {
                expect(() => createConsoleCapture({ logLevel: 'error' })).not.toThrow();
            });
        });
    });

    describe('ERROR_PATTERNS exports', () => {
        it('contains all expected patterns', () => {
            expect(ERROR_PATTERNS).toBeInstanceOf(Array);
            expect(ERROR_PATTERNS.length).toBeGreaterThan(0);
        });
    });
});
