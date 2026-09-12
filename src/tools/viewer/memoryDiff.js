'use strict';

/**
 * @file Memory diff utilities: compute and apply JSON Patches between
 *   bot Memory snapshots. Used by the viewer to store per-tick Memory
 *   history efficiently (keyframe + delta pattern).
 *
 * Responsibility:
 *   - Compute a minimal set of JSON Patch operations (RFC 6902 subset)
 *     between two Memory snapshots
 *   - Apply patches to reconstruct a Memory snapshot from a keyframe
 *
 * Only supports the operations needed for Memory diffs:
 *   - add: { op: 'add', path: '/a/b', value: ... }
 *   - replace: { op: 'replace', path: '/a/b', value: ... }
 *   - remove: { op: 'remove', path: '/a/b' }
 *
 * Arrays are compared by index (no move/copy ops — keeps it simple).
 * Paths use JSON Pointer syntax (/a/b/0/c).
 *
 * @module tools/viewer/memoryDiff
 */

/**
 * Escapes a JSON Pointer reference token.
 * @param {string} token
 * @private
 * @returns {string}
 */
function escapeRef(token) {
    return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Deep-clones a value. Handles objects, arrays, and primitives.
 * Returns the value as-is for primitives and null.
 *
 * @param {*} val
 * @returns {*}
 */
function deepClone(val) {
    if (val === null || typeof val !== 'object') return val;
    if (Array.isArray(val)) return val.map(deepClone);
    /** @type {Object<string,*>} */
    const clone = {};
    for (const key of Object.keys(val)) {
        clone[key] = deepClone(val[key]);
    }
    return clone;
}

/**
 * Computes a JSON Patch (RFC 6902 subset) between two Memory objects.
 *
 * @param {*} before — previous Memory (or undefined if first tick)
 * @param {*} after — current Memory
 * @returns {Array<{op:string, path:string, value?:*}>} JSON Patch operations
 */
function computeMemoryDiff(before, after) {
    /** @type {Array<{op:string, path:string, value?:*}>} */
    const ops = [];

    /**
     * Recursively diff two values at a given path.
     * @param {*} a — before value
     * @param {*} b — after value
     * @param {string} path — JSON Pointer path to current position
     */
    function diff(a, b, path) {
        // Both null or identical reference
        if (a === b) return;

        // Type change or primitive change
        const typeA = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
        const typeB = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;

        if (typeA !== typeB) {
            ops.push({ op: 'replace', path, value: deepClone(b) });
            return;
        }

        // Both primitives (including null)
        if (typeA !== 'object' && typeA !== 'array') {
            if (a !== b) {
                ops.push({ op: 'replace', path, value: b });
            }
            return;
        }

        // Both arrays — compare by index
        if (typeA === 'array') {
            const maxLen = Math.max(a.length, b.length);
            for (let i = 0; i < maxLen; i++) {
                const subPath = path + '/' + i;
                if (i >= a.length) {
                    // New element
                    ops.push({ op: 'add', path: subPath, value: deepClone(b[i]) });
                } else if (i >= b.length) {
                    // Removed element — remove from the end
                    // Collect consecutive removes
                    let removeCount = 1;
                    while (i + removeCount < a.length && i + removeCount >= b.length) {
                        removeCount++;
                    }
                    // We only remove one at a time to keep path stable
                    ops.push({ op: 'remove', path: subPath });
                } else {
                    diff(a[i], b[i], subPath);
                }
            }
            return;
        }

        // Both objects
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        const allKeys = new Set([...keysA, ...keysB]);

        for (const key of [...allKeys].sort()) {
            const subPath = path + '/' + escapeRef(key);
            const hasA = key in a;
            const hasB = key in b;

            if (hasA && hasB) {
                diff(a[key], b[key], subPath);
            } else if (!hasA && hasB) {
                ops.push({ op: 'add', path: subPath, value: deepClone(b[key]) });
            } else if (hasA && !hasB) {
                ops.push({ op: 'remove', path: subPath });
            }
        }
    }

    if (before === undefined) {
        // First tick — the entire after is a single replace at root
        ops.push({ op: 'replace', path: '', value: deepClone(after) });
    } else {
        diff(before, after, '');
    }

    return ops;
}

/**
 * Applies a JSON Patch to a Memory snapshot, returning a new object
 * (does not mutate the input).
 *
 * @param {*} base — starting Memory (keyframe)
 * @param {Array<{op:string, path:string, value?:*}>} deltas — patches to apply
 * @returns {*} reconstructed Memory
 */
function applyMemoryDiff(base, deltas) {
    const obj = deepClone(base);

    for (const op of deltas) {
        // Navigate to the parent of the target path
        const path = op.path;
        const segments =
            path === ''
                ? []
                : path
                      .slice(1)
                      .split('/')
                      .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));

        if (segments.length === 0) {
            // Root-level operation
            if (op.op === 'replace') {
                return deepClone(op.value);
            }
            // add/remove at root — shouldn't happen in practice
            continue;
        }

        // Navigate to parent
        let current = obj;
        for (let i = 0; i < segments.length - 1; i++) {
            const seg = segments[i];
            // If the segment is a number, treat as array index
            if (/^\d+$/.test(seg)) {
                const idx = parseInt(seg, 10);
                if (!Array.isArray(current) || idx >= current.length) {
                    // Path doesn't exist — skip
                    current = null;
                    break;
                }
                current = current[idx];
            } else {
                if (current === null || typeof current !== 'object' || !(seg in current)) {
                    current = null;
                    break;
                }
                current = current[seg];
            }
        }

        if (current === null) continue;

        const lastSeg = segments[segments.length - 1];

        switch (op.op) {
            case 'add':
            case 'replace': {
                const val = deepClone(op.value);
                if (Array.isArray(current) && /^\d+$/.test(lastSeg)) {
                    const idx = parseInt(lastSeg, 10);
                    current[idx] = val;
                } else if (current && typeof current === 'object') {
                    current[lastSeg] = val;
                }
                break;
            }
            case 'remove': {
                if (Array.isArray(current) && /^\d+$/.test(lastSeg)) {
                    const idx = parseInt(lastSeg, 10);
                    current.splice(idx, 1);
                } else if (current && typeof current === 'object') {
                    delete current[lastSeg];
                }
                break;
            }
        }
    }

    return obj;
}

module.exports = { computeMemoryDiff, applyMemoryDiff, deepClone, escapeRef };
