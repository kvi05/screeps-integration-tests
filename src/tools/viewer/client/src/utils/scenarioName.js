/**
 * @file Scenario name helpers shared across viewer components.
 *
 * Responsibility:
 *   Normalize scenario paths/names into displayable basenames so App
 *   (reconnect detection) and ResourcesPanel (worker rows) share one
 *   implementation instead of duplicating it.
 */

/**
 * Basename of a scenario path/name: 'C:\\repo\\demo.scenario.js' → 'demo'.
 * Handles both POSIX and Windows separators.
 *
 * Used to:
 * - tag the local recording and compare it with the SSE `start` event
 *   (reconnect detection in App — see the start/frame SSE cases)
 * - label scenario worker rows in ResourcesPanel
 *
 * @param {string} s — scenario path or name, may be empty
 * @returns {string} basename without the `.scenario.js` suffix ('' for empty input)
 */
export function scenarioBasename(s) {
    return (
        (s || '')
            .split(/[/\\]/)
            .pop()
            .replace(/\.scenario\.js$/, '') || ''
    );
}
