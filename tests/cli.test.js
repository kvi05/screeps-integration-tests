'use strict';

const { parseArgs, generateHelp, HelpRequested, VersionRequested } = require('../src/lib/config/cli');

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
        it('throws HelpRequested on --help', () => {
            expect(() => parseArgs(schema, ['--help'])).toThrow(HelpRequested);
        });

        it('throws HelpRequested on -h', () => {
            expect(() => parseArgs(schema, ['-h'])).toThrow(HelpRequested);
        });
    });

    describe('--version', () => {
        it('throws VersionRequested on --version', () => {
            expect(() => parseArgs(schema, ['--version'])).toThrow(VersionRequested);
        });

        it('throws VersionRequested on -v', () => {
            expect(() => parseArgs(schema, ['-v'])).toThrow(VersionRequested);
        });
    });

    describe('bool', () => {
        it('--force sets true', () => {
            const { options } = parseArgs(schema, ['testname', '--force']);
            expect(options.force).toBe(true);
        });

        it('without --force stays default', () => {
            const { options } = parseArgs(schema, ['testname']);
            expect(options.force).toBe(false);
        });
    });

    describe('int', () => {
        it('parses --rcl 5', () => {
            const { options } = parseArgs(schema, ['testname', '--rcl', '5']);
            expect(options.rcl).toBe(5);
        });

        it('uses default if not specified', () => {
            const { options } = parseArgs(schema, ['testname']);
            expect(options.rcl).toBe(3);
        });

        it('throws when value < min', () => {
            expect(() => parseArgs(schema, ['testname', '--rcl', '0'])).toThrow(/< min/);
        });

        it('throws when value > max', () => {
            expect(() => parseArgs(schema, ['testname', '--rcl', '9'])).toThrow(/> max/);
        });

        it('throws on invalid int', () => {
            expect(() => parseArgs(schema, ['testname', '--rcl', 'abc'])).toThrow(/expected a number/);
        });
    });

    describe('float', () => {
        it('parses --ratio 1.5', () => {
            const { options } = parseArgs(schema, ['testname', '--ratio', '1.5']);
            expect(options.ratio).toBe(1.5);
        });
    });

    describe('string', () => {
        it('parses --label hello', () => {
            const { options } = parseArgs(schema, ['testname', '--label', 'hello']);
            expect(options.label).toBe('hello');
        });
    });

    describe('enum', () => {
        it('parses --mode slow', () => {
            const { options } = parseArgs(schema, ['testname', '--mode', 'slow']);
            expect(options.mode).toBe('slow');
        });

        it('throws on invalid value', () => {
            expect(() => parseArgs(schema, ['testname', '--mode', 'medium'])).toThrow(/not a valid value/);
        });
    });

    describe('json', () => {
        it('parses --data \'{"key":"value"}\'', () => {
            const { options } = parseArgs(schema, ['testname', '--data', '{"key":"value"}']);
            expect(options.data).toEqual({ key: 'value' });
        });

        it('throws on invalid JSON', () => {
            expect(() => parseArgs(schema, ['testname', '--data', '{bad}'])).toThrow(/invalid JSON/);
        });
    });

    describe('--key=value', () => {
        it('parses --rcl=7', () => {
            const { options } = parseArgs(schema, ['testname', '--rcl=7']);
            expect(options.rcl).toBe(7);
        });

        it('bool with =', () => {
            const { options } = parseArgs(schema, ['testname', '--force=true']);
            // bool type ignores = and sets true
            expect(options.force).toBe(true);
        });
    });

    describe('positional', () => {
        it('parses positional argument', () => {
            const { positional } = parseArgs(schema, ['myname']);
            expect(positional.name).toBe('myname');
        });

        it('throws when required positional is missing', () => {
            expect(() => parseArgs(schema, [])).toThrow(/is required/);
        });
    });

    describe('-- separator', () => {
        it('everything after -- is treated as positional', () => {
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
        it('throws on unknown option', () => {
            expect(() => parseArgs(schema, ['testname', '--unknown'])).toThrow(/Unknown option/);
        });
    });

    describe('missing value', () => {
        it('throws if value is missing', () => {
            expect(() => parseArgs(schema, ['testname', '--rcl'])).toThrow(/requires a value/);
        });
    });

    describe('custom cli name', () => {
        it('uses opt.cli for mapping', () => {
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
    it('generates help text with title', () => {
        const help = generateHelp({
            title: 'My Tool',
            usage: 'my-tool <name>',
            positional: [{ name: 'name', required: true, description: 'the name' }],
            options: {
                verbose: { type: 'bool', description: 'be verbose' },
                version: { type: 'bool', description: 'print version' },
            },
        });
        expect(help).toContain('My Tool');
        expect(help).toContain('my-tool <name>');
        expect(help).toContain('the name');
        expect(help).toContain('be verbose');
        expect(help).toContain('--version');
    });

    it('does not add sections if they are absent', () => {
        const help = generateHelp({});
        expect(help).toBe('');
    });
});
