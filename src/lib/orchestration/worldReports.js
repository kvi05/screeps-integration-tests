'use strict';

/**
 * @file Process-level registry of created worlds, used for cross-world
 *   aggregation of headline counters.
 *
 * Responsibility:
 *   Track every world report created via `createWorld()` so the worker
 *   (`runScenario.js`) can report `totalTicks` / `totalWorlds` summed
 *   across ALL worlds of a scenario. A scenario may create several worlds,
 *   and the world whose report it returns is just the last one — its
 *   `ticksRun` alone misrepresents multi-world scenarios.
 *
 *   `world.js` is the only writer (register on create, freeze on dispose);
 *   `runScenario.js` is the only reader. No layer boundary is crossed —
 *   both sides sit in orchestration / the runner entry, same split as
 *   `tickHooks.js` for the tick interceptor.
 *
 * Lifecycle of a tracked entry:
 *   1. `trackWorldReport(report)` — on `createWorld()` the live report is
 *      kept by reference; `ticksRun` keeps growing while the world runs.
 *   2. `freezeWorldReport(report)` — on `dispose()` the final `ticksRun`
 *      is snapshotted and the report reference is released, so long-lived
 *      processes (in-process test harnesses, unit tests) do not accumulate
 *      disposed worlds' reports (logs, events, metrics, finalMemory, ...).
 *      Freezing instead of removing keeps the totals correct: scenarios
 *      dispose their worlds in `finally` before the worker reads them.
 *
 * Only additive counters are aggregated. Per-world data (errors, warnings,
 * metrics, finalMemory, ...) is intentionally never merged: room names and
 * tick numbers collide across worlds, so a merge would produce garbage.
 *
 * @module lib/orchestration/worldReports
 */

/**
 * A tracked world: live (report by reference, still running) or frozen
 * (disposed — only the final tick count is kept).
 *
 * @typedef {Object} TrackedWorld
 * @property {import('../types').WorldReport|null} report — live report, or null once frozen
 * @property {number} frozenTicks — ticksRun snapshot taken on freeze
 */

/** @type {TrackedWorld[]} Worlds created in this process, in creation order */
const _worlds = [];

/**
 * Register a world report for cross-world aggregation. Called by `world.js`
 * right after a world's report is created.
 *
 * @param {import('../types').WorldReport} report
 * @returns {void}
 */
function trackWorldReport(report) {
    _worlds.push({ report, frozenTicks: 0 });
}

/**
 * Freeze a world's contribution: snapshot the current `ticksRun` and release
 * the report reference. Called by `world.js` from `dispose()`.
 *
 * Idempotent — freezing an already-frozen or unknown report is a no-op, so
 * a double `dispose()` is safe.
 *
 * @param {import('../types').WorldReport} report
 * @returns {void}
 */
function freezeWorldReport(report) {
    const entry = _worlds.find((world) => world.report === report);
    if (!entry) {
        return;
    }
    entry.frozenTicks = entry.report?.ticksRun ?? 0;
    entry.report = null;
}

/**
 * Sum `ticksRun` across all worlds created in this process — live worlds
 * report their current count, disposed worlds their frozen snapshot.
 *
 * A scenario may create several worlds; the sum counts every one of them,
 * including worlds disposed before a completed `run()`.
 *
 * @returns {number} total ticks across all worlds (0 if none were created)
 */
function collectTotalWorldTicks() {
    return _worlds.reduce((sum, world) => sum + (world.report ? world.report.ticksRun || 0 : world.frozenTicks), 0);
}

/**
 * Count the worlds created in this process.
 *
 * @returns {number} number of worlds registered so far (0 if none)
 */
function collectWorldCount() {
    return _worlds.length;
}

/**
 * Forget all tracked worlds (worker shutdown / between runs).
 *
 * @returns {void}
 */
function clearWorldReports() {
    _worlds.length = 0;
}

module.exports = {
    trackWorldReport,
    freezeWorldReport,
    collectTotalWorldTicks,
    collectWorldCount,
    clearWorldReports,
};
