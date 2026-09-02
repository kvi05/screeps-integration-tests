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
 *   Cross-world aggregation lives in the sibling `worldReports.js` module:
 *   `world.js` registers/freezes world reports there, `runScenario.js`
 *   reads the totals for the final worker message.
 *
 * This replaces the old `viewerState.js` singleton, but is tool-agnostic:
 *   any tool (viewer, profiler, debugger) can set the interceptor.
 *
 * Design note — why a module-level singleton instead of passing the
 * interceptor as a parameter:
 *   The interceptor is set by `runScenario.js` (worker entry) before
 *   `scenario.run(opts)` is called. If the scenario's `run()` builds a
 *   fresh `opts` object instead of forwarding the one we pass, the
 *   interceptor would be lost. The singleton guarantees `world.js` can
 *   always find it, regardless of how the scenario constructs opts.
 *   The state is scoped to the worker process (`child_process.fork`),
 *   so there is zero cross-scenario contamination. `clearTickInterceptor`
 *   is called in the worker's `finally` block to reset state between
 *   tests (though in practice each scenario runs in its own process).
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
