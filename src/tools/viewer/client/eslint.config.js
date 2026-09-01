import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
    {
        settings: {
            react: { version: '18.3' },
        },
    },
    js.configs.recommended,
    react.configs.flat.recommended,
    {
        // Root-level config files (vite.config.js, vitest.config.js,
        // eslint.config.js) run in Node — they need Node globals, which the
        // browser-oriented blocks below do not provide.
        files: ['*.config.js'],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
    {
        files: ['src/**/*.{js,jsx}', 'tests/**/*.{js,jsx}'],
        plugins: {
            'react-hooks': reactHooks,
        },
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: {
                ecmaFeatures: { jsx: true },
            },
            globals: {
                ...globals.browser,
                ...globals.vitest,
                global: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'no-console': 'off',
            'prefer-const': 'warn',
            'no-var': 'error',
            'react/jsx-uses-react': 'off',
            'react/react-in-jsx-scope': 'off',
            'react/prop-types': 'off',
        },
    },
    {
        ignores: ['dist/', 'node_modules/'],
    },
];
