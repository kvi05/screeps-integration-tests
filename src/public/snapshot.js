'use strict';

/**
 * @file Snapshot utilities for CI and programmatic use.
 *
 * Responsibility:
 *   Provides `restoreState` (the unified restore function) and
 *   helpers for reading/validating snapshots outside the viewer.
 *
 * **Available functions:**
 * - `restoreState` — restore world state from a snapshot
 * - `readSnapshot` — read and validate a snapshot from file or object
 *
 * @example
 * const { readSnapshot, restoreState } = require('screeps-integration-tests/snapshot');
 * const snapshot = readSnapshot('./snapshots/my-snapshot.json');
 *
 * @module screeps-integration-tests/snapshot
 */

const { restoreState } = require('../lib/orchestration/restoreState');

/**
 * Reads and validates a snapshot from a file path or object.
 * Throws on invalid format.
 *
 * @param {string|Object} input — file path or parsed JSON
 * @returns {Object} validated snapshot
 */
function readSnapshot(input) {
    let snapshot;
    if (typeof input === 'string') {
        const fs = require('fs');
        snapshot = JSON.parse(fs.readFileSync(input, 'utf-8'));
    } else {
        snapshot = input;
    }
    // Basic validation
    if (!snapshot.db || !snapshot.db['rooms.objects']) {
        throw new Error("Invalid snapshot: missing db['rooms.objects']");
    }
    if (!snapshot.env || snapshot.env.gameTime === undefined) {
        throw new Error('Invalid snapshot: missing env.gameTime');
    }
    return snapshot;
}

module.exports = { restoreState, readSnapshot };
