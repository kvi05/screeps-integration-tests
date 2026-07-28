'use strict';

/**
 * @file User-facing error classes for structured error handling in scenarios.
 *
 * Responsibility:
 *   Re-export the framework's error classes so that scenario authors can
 *   catch and handle specific error types with `instanceof` checks.
 *   Each error provides structured output (WHAT → WHY → HOW → docs link).
 *
 * **Available classes:**
 * - `FrameworkError` — base class for all framework errors
 * - `MissingDirectoryError` — a required directory is missing
 * - `MissingFileError` — a required file is missing
 * - `ConfigError` — configuration is invalid or missing
 * - `FixtureError` — a fixture (memory or room) is not found or already exists
 * - `BotError` — a bot-related runtime error (not found, module missing, etc.)
 *
 * @example
 * const { BotError, ConfigError } = require('screeps-integration-tests/errors');
 * try {
 *   const world = await createWorld({ ... });
 * } catch (err) {
 *   if (err instanceof ConfigError) {
 *     console.error('Config issue:', err.toString());
 *   }
 *   throw err;
 * }
 *
 * @module screeps-integration-tests/errors
 */

const {
    FrameworkError,
    MissingDirectoryError,
    MissingFileError,
    ConfigError,
    FixtureError,
    BotError,
} = require('../lib/errors');

module.exports = {
    FrameworkError,
    MissingDirectoryError,
    MissingFileError,
    ConfigError,
    FixtureError,
    BotError,
};
