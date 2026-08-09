'use strict';

/**
 * @file Holds the current {@link TickInterceptor} for the tick loop.
 *
 * Responsibility:
 *   Provide a simple set/get/clear for the optional tick interceptor,
 *   scoped within the orchestration layer. Both `world.js` (reader) and
 *   `runScenario.js` (writer) import from this module — no layer boundary
 *   is crossed.
 *
 * This replaces the old `viewerState.js` singleton, but is tool-agnostic:
 *   any tool (viewer, profiler, debugger) can set the interceptor.
 *
 * @module lib/orchestration/tickHooks
 */

/**
 * @typedef {import('../types').TickInterceptor} TickInterceptor
 */

/** @type {TickInterceptor|null} */
let _interceptor = null;

/**
 * Set the tick interceptor. Called by `runScenario.js` before `scenario.run()`.
 * @param {TickInterceptor} interceptor
 */
function setTickInterceptor(interceptor) {
    _interceptor = interceptor;
}

/**
 * Get the current tick interceptor. Called by `world.js` in `doTick()`.
 * @returns {TickInterceptor|null}
 */
function getTickInterceptor() {
    return _interceptor;
}

/**
 * Clear the tick interceptor (typically on worker dispose / scenario end).
 */
function clearTickInterceptor() {
    _interceptor = null;
}

module.exports = { setTickInterceptor, getTickInterceptor, clearTickInterceptor };
