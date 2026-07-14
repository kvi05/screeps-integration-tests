'use strict';

/**
 * Self-test configuration for the screeps-integration-tests framework.
 *
 * Used by `npm run test:integration` in this repository.
 * It points the runner at the minimal mock bot and the generic example
 * scenarios that validate the framework itself.
 */
module.exports = {
    distDir: './mock-bot/dist',
    scenariosDir: './scenarios',
    fixturesDir: './fixtures',
    cacheDir: './.cache',
    profilesDir: './profiles',
};
