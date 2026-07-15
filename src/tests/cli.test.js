'use strict';

const { parseArgs, generateHelp, HelpRequested } = require('../lib/cli');

describe('cli parseArgs', () => {
    const schema = {
        positional: [{ name: 'name', required: true, description: 'fixture name' }],
        options: {
            rcl: { type: 'int', default: 3, min: 1, max: 8, description: 'target RCL' },
            force: { type: 'bool', default: false, description: 'overwrite' },
            mode: { type: 'enum', values: ['fast', 'slow'], default: 'fast' },
            label: { type: 'string', description: 'label' },
            ratio: { type: 'float', description: 'ratio' },
            data: { type: 'json', description: 'json data' },
        },
        title: 'test',
        usage: 'test <name> [options]',
    };

    describe('--help', () => {
        it('бросает HelpRequested при --help', () => {
            expect(() => parseArgs(schema, ['--help'])).toThrow(HelpRequested);
        });

        it('бросает HelpRequested при -h', () => {
            expect(() => parseArgs(schema, ['-h'])).toThrow(HelpRequested);
        });
    });

    describe('bool', () => {
        it('--force устанавливает true', () => {
            const { options } = parseArgs(schema, ['testname', '--force']);
            expect(options.force).toBe(true);
        });

        it('без --force остаётся default', () => {
            const { options } = parseArgs(schema, ['testname']);
            expect(options.force).toBe(false);
        });
    });

    describe('int', () => {
        it('парсит --rcl 5', () => {
            const { options } = parseArgs(schema, ['testname', '--rcl', '5']);
            expect(options.rcl).toBe(5);
        });

        it('использует default если не указан', () => {
            const { options } = parseArgs(schema, ['testname']);
            expect(options.rcl).toBe(3);
        });

        it('бросает при значении < min', () => {
            expect(() => parseArgs(schema, ['testname', '--rcl', '0'])).toThrow(/< минимального/);
        });

        it('бросает при значении > max', () => {
            expect(() => parseArgs(schema, ['testname', '--rcl', '9'])).toThrow(/> максимального/);
        });

        it('бросает при невалидном int', () => {
            expect(() => parseArgs(schema, ['testname', '--rcl', 'abc'])).toThrow(/ожидалось число/);
        });
    });

    describe('float', () => {
        it('парсит --ratio 1.5', () => {
            const { options } = parseArgs(schema, ['testname', '--ratio', '1.5']);
            expect(options.ratio).toBe(1.5);
        });
    });

    describe('string', () => {
        it('парсит --label hello', () => {
            const { options } = parseArgs(schema, ['testname', '--label', 'hello']);
            expect(options.label).toBe('hello');
        });
    });

    describe('enum', () => {
        it('парсит --mode slow', () => {
            const { options } = parseArgs(schema, ['testname', '--mode', 'slow']);
            expect(options.mode).toBe('slow');
        });

        it('бросает при недопустимом значении', () => {
            expect(() => parseArgs(schema, ['testname', '--mode', 'medium'])).toThrow(/не входит/);
        });
    });

    describe('json', () => {
        it('парсит --data \'{"key":"value"}\'', () => {
            const { options } = parseArgs(schema, ['testname', '--data', '{"key":"value"}']);
            expect(options.data).toEqual({ key: 'value' });
        });

        it('бросает при невалидном JSON', () => {
            expect(() => parseArgs(schema, ['testname', '--data', '{bad}'])).toThrow(/невалидный JSON/);
        });
    });

    describe('--key=value', () => {
        it('парсит --rcl=7', () => {
            const { options } = parseArgs(schema, ['testname', '--rcl=7']);
            expect(options.rcl).toBe(7);
        });

        it('bool с =', () => {
            const { options } = parseArgs(schema, ['testname', '--force=true']);
            // bool тип игнорирует = и устанавливает true
            expect(options.force).toBe(true);
        });
    });

    describe('positional', () => {
        it('парсит позиционный аргумент', () => {
            const { positional } = parseArgs(schema, ['myname']);
            expect(positional.name).toBe('myname');
        });

        it('бросает при отсутствии обязательного positional', () => {
            expect(() => parseArgs(schema, [])).toThrow(/обязателен/);
        });
    });

    describe('-- separator', () => {
        it('всё после -- считается positional', () => {
            const schema2 = {
                positional: [
                    { name: 'a', required: true },
                    { name: 'b', required: false },
                ],
                options: { verbose: { type: 'bool' } },
            };
            const { positional, options } = parseArgs(schema2, ['--verbose', '--', '--not-a-flag', 'value']);
            expect(options.verbose).toBe(true);
            expect(positional.a).toBe('--not-a-flag');
            expect(positional.b).toBe('value');
        });
    });

    describe('unknown option', () => {
        it('бросает при неизвестной опции', () => {
            expect(() => parseArgs(schema, ['testname', '--unknown'])).toThrow(/Неизвестная опция/);
        });
    });

    describe('missing value', () => {
        it('бросает если значение не указано', () => {
            expect(() => parseArgs(schema, ['testname', '--rcl'])).toThrow(/требует значение/);
        });
    });

    describe('custom cli name', () => {
        it('использует opt.cli для маппинга', () => {
            const schema2 = {
                options: {
                    myOpt: { type: 'string', cli: '--my-opt' },
                },
            };
            const { options } = parseArgs(schema2, ['--my-opt', 'val']);
            expect(options.myOpt).toBe('val');
        });
    });
});

describe('generateHelp', () => {
    it('генерирует текст помощи с title', () => {
        const help = generateHelp({
            title: 'My Tool',
            usage: 'my-tool <name>',
            positional: [{ name: 'name', required: true, description: 'the name' }],
            options: { verbose: { type: 'bool', description: 'be verbose' } },
        });
        expect(help).toContain('My Tool');
        expect(help).toContain('my-tool <name>');
        expect(help).toContain('the name');
        expect(help).toContain('be verbose');
    });

    it('не добавляет секции если их нет', () => {
        const help = generateHelp({});
        expect(help).toBe('');
    });
});
