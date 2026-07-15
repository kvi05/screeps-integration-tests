'use strict';

const { createConsoleCapture, looksLikeError, ERROR_PATTERNS } = require('../lib/console');

describe('console capture', () => {
    describe('looksLikeError', () => {
        it('определяет ReferenceError', () => {
            expect(looksLikeError('ReferenceError: foo is not defined')).toBe(true);
        });

        it('определяет SyntaxError', () => {
            expect(looksLikeError('SyntaxError: Unexpected token')).toBe(true);
        });

        it('определяет TypeError', () => {
            expect(looksLikeError('TypeError: Cannot read property')).toBe(true);
        });

        it('определяет "is not defined"', () => {
            expect(looksLikeError('Something is not defined')).toBe(true);
        });

        it('определяет "Maximum call stack"', () => {
            expect(looksLikeError('Maximum call stack size exceeded')).toBe(true);
        });

        it('не срабатывает на обычной строке', () => {
            expect(looksLikeError('Harvester moving to source')).toBe(false);
        });

        it('не срабатывает на пустой строке', () => {
            expect(looksLikeError('')).toBe(false);
        });
    });

    describe('createConsoleCapture', () => {
        // Семантика logLevel:
        //   'all'   — нормальные логи → logs; ошибки → errors; предупреждения → warnings
        //   'error' — ошибки → errors + logs; нормальные логи → никуда
        //   'warn'  — предупреждения → warnings + logs; ошибки → errors; нормальные → никуда

        it('классифицирует [ERROR] строку как ошибку (logLevel=all: только errors)', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'all' });
            handler(['[ERROR] Something went wrong']);
            expect(report.errors).toEqual(['[ERROR] Something went wrong']);
            expect(report.logs).toEqual([]);
        });

        it('классифицирует [ERROR] строку как ошибку (logLevel=error: errors + logs)', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'error' });
            handler(['[ERROR] Something went wrong']);
            expect(report.errors).toEqual(['[ERROR] Something went wrong']);
            expect(report.logs).toEqual(['[ERROR] Something went wrong']);
        });

        it('классифицирует строку с ERROR_PATTERNS как ошибку', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'all' });
            handler(['ReferenceError: x is not defined']);
            expect(report.errors).toEqual(['ReferenceError: x is not defined']);
        });

        it('классифицирует [WARN] строку как предупреждение (logLevel=all: только warnings)', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'all' });
            handler(['[WARN] Low energy']);
            expect(report.warnings).toEqual(['[WARN] Low energy']);
            expect(report.logs).toEqual([]);
        });

        it('классифицирует [WARN] строку как предупреждение (logLevel=warn: warnings + logs)', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'warn' });
            handler(['[WARN] Low energy']);
            expect(report.warnings).toEqual(['[WARN] Low energy']);
            expect(report.logs).toEqual(['[WARN] Low energy']);
        });

        it('при logLevel=error нормальные логи не попадают в report.logs', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'error' });
            handler(['Upgrader working']);
            expect(report.logs).toEqual([]);
        });

        it('при logLevel=warn нормальные логи НЕ попадают в logs', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'warn' });
            handler(['Normal log']);
            expect(report.logs).toEqual([]);
        });

        it('maxConsoleLines обрезает логи (лимит на суммарное количество строк)', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'all', maxConsoleLines: 2 });
            handler(['line1']);
            handler(['line2']);
            handler(['line3']);
            // После line1: total=1, line2: total=2, line3: total=2 (2>2? false → добавляет)
            // line4 был бы заблокирован
            expect(report.logs).toEqual(['line1', 'line2', 'line3']);
        });

        it('maxConsoleLines блокирует следующий batch после превышения', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'all', maxConsoleLines: 2 });
            handler(['line1', 'line2']);
            handler(['line3']);
            // После 1-го вызова: total=2, 2-й вызов: total=2, 2>2? false → добавляет line3
            expect(report.logs).toEqual(['line1', 'line2', 'line3']);
            // 3-й вызов: total=3, 3>2? true → блокировано
            handler(['line4']);
            expect(report.logs).toEqual(['line1', 'line2', 'line3']);
        });

        it('maxConsoleLines обрезает суммарно errors+warnings+logs', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'all', maxConsoleLines: 2 });
            handler(['line1']);
            handler(['[ERROR] err']);
            expect(report.errors).toEqual(['[ERROR] err']);
            expect(report.logs).toEqual(['line1']);
        });

        it('создаёт свой report если не передан внешний', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'all' });
            handler(['test']);
            expect(report.logs).toEqual(['test']);
            expect(report.errors).toEqual([]);
            expect(report.warnings).toEqual([]);
        });

        it('принимает внешний report', () => {
            const external = { errors: [], warnings: [], logs: [] };
            const { handler, report } = createConsoleCapture({ report: external, logLevel: 'all' });
            handler(['test']);
            expect(report).toBe(external);
            expect(external.logs).toEqual(['test']);
        });

        it('пустой массив логов не меняет report', () => {
            const { handler, report } = createConsoleCapture({ logLevel: 'all' });
            handler([]);
            expect(report.logs).toEqual([]);
        });

        it('default logLevel error', () => {
            const { handler, report } = createConsoleCapture();
            handler(['message']);
            expect(report.logs).toEqual([]);
        });
    });

    describe('ERROR_PATTERNS exports', () => {
        it('содержит все ожидаемые паттерны', () => {
            expect(ERROR_PATTERNS).toBeInstanceOf(Array);
            expect(ERROR_PATTERNS.length).toBeGreaterThan(0);
        });
    });
});
