'use strict';

/**
 * Общий экспорт observers-слоя.
 *
 * Observers читают состояние мира и предоставляют простые helpers
 * (event log, метрики, predicate, владельцы объектов) для assertions
 * и сценариев.
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
