'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CACHE_DIR = path.join(__dirname, '..', '.cache');
const DEFAULT_KEEP = 5;

/**
 * Очищает .cache/, храня N последних директорий.
 * @param {Object} [opts]
 * @param {number} [opts.keep=5] — количество директорий для хранения
 * @param {string} [opts.cacheDir] — путь к .cache/
 * @returns {{ removed: number, kept: number, errors: string[] }}
 */
function pruneCache(opts = {}) {
    const keep = opts.keep || DEFAULT_KEEP;
    const cacheDir = opts.cacheDir || DEFAULT_CACHE_DIR;
    const result = { removed: 0, kept: 0, errors: [] };

    if (!fs.existsSync(cacheDir)) {
        return result;
    }

    const entries = fs
        .readdirSync(cacheDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => ({
            name: e.name,
            fullPath: path.join(cacheDir, e.name),
            mtime: fs.statSync(path.join(cacheDir, e.name)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime); // свежие первые

    const toRemove = entries.slice(keep);
    for (const entry of toRemove) {
        try {
            fs.rmSync(entry.fullPath, { recursive: true, force: true });
            result.removed++;
        } catch (e) {
            result.errors.push(`Не удалось удалить ${entry.name}: ${e.message}`);
        }
    }

    result.kept = Math.min(entries.length, keep);
    return result;
}

module.exports = { pruneCache };
