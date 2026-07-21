'use strict';

const path = require('path');

/**
 * Jest-конфиг для unit-тестов integration framework.
 *
 * Тесты инфраструктуры живут в `tests/` и запускаются отдельно
 * от юнит-тестов самого бота.
 *
 * @file Jest configuration for integration test helpers.
 */
module.exports = {
    testEnvironment: 'node',
    rootDir: path.resolve(__dirname),
    testMatch: ['<rootDir>/tests/**/*.test.js'],
    testPathIgnorePatterns: ['/node_modules/', '/.cache/', '/fixtures/', '/profiles/', '/scenarios/', '/tools/'],
    coverageDirectory: '<rootDir>/.coverage',
    testTimeout: 5000,
    verbose: true,
};
