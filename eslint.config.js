'use strict';

const globals = require('globals');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-console': 'off',
            'no-undef': 'error',
            'prefer-const': 'warn',
            'no-var': 'error',
            eqeqeq: ['error', 'always'],
            curly: ['error', 'all'],
            'no-shadow': 'warn',
            'no-implicit-globals': 'error',
            'no-trailing-spaces': 'warn',
            'eol-last': ['warn', 'always'],
            'no-multiple-empty-lines': ['warn', { max: 1 }],
        },
    },
    {
        files: ['tests/**/*.test.js'],
        languageOptions: {
            globals: {
                ...globals.jest,
            },
        },
    },
    {
        ignores: [
            'node_modules/',
            '.cache/',
            '.coverage/',
            'server/',
            'logs/',
            'profiles/',
            'examples/mock-bot/dist/',
            'src/tools/viewer/client/',
            'src/tools/viewer/dist/',
        ],
    },
    prettierConfig,
];
