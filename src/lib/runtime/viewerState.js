'use strict';

/**
 * @file Shared viewer state for live-control communication between
 *   runScenario.js (worker) and world.js (orchestration).
 *
 * Responsibility:
 *   Holds a mutable reference to viewer control state (EventEmitter for
 *   pause/resume, step counter, speed, status), set by the worker entry
 *   point before `createWorld` and read by `doTick` during the tick loop.
 *
 * This module replaces the previous `process.__viewerState` pattern with
 * an explicit, importable singleton — preserving the ability of `doTick`
 * to access viewer state even when a scenario passes a different `opts`
 * object to `createWorld`.
 *
 * @module lib/runtime/viewerState
 */

/** @type {Object|null} */
let _state = null;

/**
 * Set the shared viewer state. Called once by runScenario.js before the
 * scenario's `run()` entry point.
 *
 * @param {Object} state
 * @param {import('events').EventEmitter} state.control — EventEmitter for pause/resume
 * @param {boolean} state.paused
 * @param {number} state.stepRequested
 * @param {number} state.speed
 * @param {{state:string, tick:number, speed:number, scenario:string}} state.status
 * @param {Object|null} state._adapter — storage adapter ref
 */
function setViewerState(state) {
    _state = state;
}

/**
 * Get the current viewer state. Called by world.js `doTick()` during the
 * tick loop for pause/resume/speed-throttling.
 *
 * @returns {Object|null}
 */
function getViewerState() {
    return _state;
}

/**
 * Clear the viewer state (typically on worker dispose).
 */
function clearViewerState() {
    _state = null;
}

module.exports = { setViewerState, getViewerState, clearViewerState };
