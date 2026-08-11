'use strict';

/**
 * @file In-memory ring buffer for per-tick bot Memory history.
 *   Stores keyframes (full Memory) + deltas (JSON Patches) per bot.
 *   Survives worker exit — lives in the parent process.
 *
 * Responsibility:
 *   - Store per-tick Memory entries in a capped ring buffer
 *   - Reconstruct bot Memory at any tick by finding the nearest keyframe
 *     and applying deltas forward
 *   - Evict oldest entries when the buffer exceeds capacity
 *
 * @module tools/viewer/memoryHistory
 */

const { applyMemoryDiff, deepClone } = require('./memoryDiff');

/**
 * @typedef {Object} MemoryEntry
 * @property {number} tick
 * @property {Object<string, {type: 'keyframe'|'delta', data: *}>} bots
 *   — map of username → { type, data }
 *   — keyframe: data = full Memory object
 *   — delta: data = JSON Patch array
 */

/**
 * Creates a Memory history ring buffer.
 *
 * @param {Object} [opts]
 * @param {number} [opts.maxTicks=3000] — max ticks to retain
 * @returns {{
 *   push: (entry: MemoryEntry) => void,
 *   reconstruct: (tick: number, bot: string) => Object|null,
 *   clear: () => void,
 *   size: () => number,
 * }}
 */
function createMemoryHistory(opts = {}) {
    const maxTicks = opts.maxTicks || 3000;

    /** @type {MemoryEntry[]} Ring buffer */
    const buffer = [];

    /**
     * Appends a Memory entry to the ring buffer.
     * Evicts oldest entries if the buffer exceeds maxTicks.
     *
     * @param {MemoryEntry} entry
     */
    function push(entry) {
        buffer.push(entry);

        // Evict oldest entries if over capacity.
        // Keyframes evicted from the front don't affect reconstruct —
        // it always walks backward from the target tick to find the
        // nearest keyframe still in the buffer.
        while (buffer.length > maxTicks) {
            const _evicted = buffer.shift();
        }
    }

    /**
     * Reconstructs bot Memory at a given tick.
     *
     * Algorithm:
     *   1. Find the buffer entry at `tick`
     *   2. If not found: return null
     *   3. Walk backward to find the last keyframe for this bot
     *   4. If the entry at `tick` is itself a keyframe: return data directly
     *   5. Else: start from keyframe, collect deltas forward through `tick`,
     *      apply them in order, return reconstructed Memory
     *
     * @param {number} tick — the tick to reconstruct Memory at
     * @param {string} bot — username of the bot
     * @returns {Object|null} reconstructed Memory, or null if not available
     */
    function reconstruct(tick, bot) {
        // Find the entry at exact tick
        let targetIndex = -1;
        for (let i = 0; i < buffer.length; i++) {
            if (buffer[i].tick === tick) {
                targetIndex = i;
                break;
            }
        }
        if (targetIndex === -1) return null;

        // Walk backward from targetIndex to find the nearest keyframe for this bot
        let keyframeIndex = -1;
        for (let i = targetIndex; i >= 0; i--) {
            const entry = buffer[i];
            if (entry.bots && entry.bots[bot] && entry.bots[bot].type === 'keyframe') {
                keyframeIndex = i;
                break;
            }
        }
        if (keyframeIndex === -1) return null;

        // Start from keyframe data (deep clone to avoid mutating stored data)
        let memory = deepClone(buffer[keyframeIndex].bots[bot].data);

        // Apply deltas forward from keyframe+1 through targetIndex.
        // Skip ticks that don't have data for this bot (Memory didn't change).
        for (let i = keyframeIndex + 1; i <= targetIndex; i++) {
            const entry = buffer[i];
            if (entry.bots && entry.bots[bot] && entry.bots[bot].type === 'delta') {
                memory = applyMemoryDiff(memory, entry.bots[bot].data);
            }
        }

        return memory;
    }

    /**
     * Clears the entire buffer.
     */
    function clear() {
        buffer.length = 0;
    }

    /**
     * Returns the number of entries in the buffer.
     * @returns {number}
     */
    function size() {
        return buffer.length;
    }

    return { push, reconstruct, clear, size };
}

module.exports = { createMemoryHistory };
