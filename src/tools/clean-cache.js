'use strict';

/**
 * CLI tool for cleaning the .cache/ directory.
 *
 * Usage:
 *   node src/tools/clean-cache.js [--keep 5]
 *
 * Removes all directories in .cache/ except the N most recent by modification time.
 * Defaults to keeping the last 5.
 */

const { pruneCache } = require('../lib/cleanup');
const { parseArgs, HelpRequested } = require('../lib/cli');

const schema = {
    title: 'clean-cache',
    usage: 'node src/tools/clean-cache.js [options]',
    options: {
        keep: { type: 'int', default: 5, min: 0, description: 'how many recent caches to keep' },
        cacheDir: { type: 'string', description: 'path to .cache directory (default src/.cache)' },
    },
};

try {
    const { options } = parseArgs(schema, process.argv.slice(2));

    const cacheDir = options.cacheDir || process.env.SIT_CACHE_DIR || undefined;
    console.log(`[clean-cache] Очистка .cache/, хранить ${options.keep} последних...`);
    const result = pruneCache({ keep: options.keep, cacheDir });
    console.log(`[clean-cache] Удалено: ${result.removed}, оставлено: ${result.kept}`);
    if (result.errors.length > 0) {
        console.error('[clean-cache] Ошибки:', result.errors);
    }
} catch (e) {
    if (e instanceof HelpRequested) {
        console.log(e.helpText);
    } else {
        console.error(`[clean-cache] ${e.message}`);
        process.exit(1);
    }
}
