'use strict';

/**
 * Room-name parsing and adjacency computation.
 *
 * Responsibility:
 *   Convert Screeps room names (e.g. "W0N1") to numeric coordinates
 *   and determine which borders of a room face another declared room.
 *   Used by runtime layer to generate exit-aware terrain borders.
 *
 * **Available functions:**
 * - `parseRoomName` — Convert room name to {x, y} coordinates
 * - `computeAdjacentBorders` — Determine which borders face adjacent rooms
 *
 * @example
 * const { computeAdjacentBorders } = require('./roomUtils');
 * const adjacent = computeAdjacentBorders(['W0N1', 'W0N2']);
 * // adjacent['W0N1'] = { top: true, bottom: false, left: false, right: false }
 *
 * @module runtime/roomUtils
 */

/**
 * Parses a Screeps room name into numeric {x, y} coordinates.
 *
 * Uses the same convention as the engine's `roomNameToXY`:
 *   W → x = -number - 1,  E → x = +number
 *   N → y = -number - 1,  S → y = +number
 *
 * @param {string} name — room name (e.g. "W0N1", "E12S3")
 * @returns {{x: number, y: number}}
 */
function parseRoomName(name) {
    const m = name.match(/^(W|E)(\d+)(N|S)(\d+)$/);
    if (!m) {
        throw new Error(`Invalid room name: ${name}`);
    }
    const [, hor, xStr, ver, yStr] = m;
    const x = hor === 'W' ? -Number(xStr) - 1 : Number(xStr);
    const y = ver === 'N' ? -Number(yStr) - 1 : Number(yStr);
    return { x, y };
}

/**
 * For each room name, determines which borders (top/bottom/left/right)
 * face another room present in the same array.
 *
 * Adjacency rule: two rooms share a border when their coordinates
 * differ by exactly 1 along one axis and are equal along the other.
 *
 *   top    → room at (x, y-1) exists  (north neighbour)
 *   bottom → room at (x, y+1) exists  (south neighbour)
 *   left   → room at (x-1, y) exists  (west neighbour)
 *   right  → room at (x+1, y) exists  (east neighbour)
 *
 * @param {string[]} roomNames
 * @returns {Object<string, {top: boolean, bottom: boolean, left: boolean, right: boolean}>}
 */
function computeAdjacentBorders(roomNames) {
    /** @type {Map<string, string>} key = "x,y" → roomName */
    const coordMap = new Map();
    /** @type {Array<{name: string, x: number, y: number}>} */
    const parsed = [];

    for (const name of roomNames) {
        const { x, y } = parseRoomName(name);
        coordMap.set(`${x},${y}`, name);
        parsed.push({ name, x, y });
    }

    /** @type {Object<string, {top: boolean, bottom: boolean, left: boolean, right: boolean}>} */
    const result = {};

    for (const { name, x, y } of parsed) {
        result[name] = {
            top: coordMap.has(`${x},${y - 1}`),
            bottom: coordMap.has(`${x},${y + 1}`),
            left: coordMap.has(`${x - 1},${y}`),
            right: coordMap.has(`${x + 1},${y}`),
        };
    }

    return result;
}

module.exports = { parseRoomName, computeAdjacentBorders };
