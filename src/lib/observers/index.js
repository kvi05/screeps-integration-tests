'use strict';

/**
 * Common export of the observers layer.
 *
 * Observers read the world state and provide simple helpers
 * (event log, metrics, predicate, object owners) for assertions
 * and scenarios.
 *
 * @module observers
 */

const eventLog = require('./eventLog');
const metrics = require('./metrics');
const predicate = require('./predicate');
const ownership = require('./ownership');

module.exports = {
    ...eventLog,
    ...metrics,
    ...predicate,
    ...ownership,
};
