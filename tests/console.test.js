'use strict';

const { createConsoleCapture, looksLikeError, ERROR_PATTERNS } = require('../src/lib/console');

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

        it('default logLevel error', () => {
            const { handler, report } = createConsoleCapture();
            handler(['message']);
            expect(report.logs).toEqual([]);
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
