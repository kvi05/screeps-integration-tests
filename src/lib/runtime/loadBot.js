'use strict';

/**
 * Loads a bot's `dist/*.js` files into a module map for `addBot`.
 */

const path = require('path');
const { safeReaddir, safeReadFile } = require('../errors');

/**
 * @typedef {import('../types').LoadBotOpts} LoadBotOpts
 */

/**
 * Collects dist/*.js files into a module map for addBot({ modules }).
 * Key is the filename without .js, value is the file contents.
 * @param {string} distDir — path to dist/ (result of build.js)
 * @param {LoadBotOpts} [opts]
 * @returns {Object<string,string>}
 */
function loadBotModules(distDir, opts = {}) {
    const modules = {};
    const entries = safeReaddir(distDir, 'MISSING_DIST_DIR');
    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.js')) {
            const name = entry.name.replace(/\.js$/, '');
            const filePath = path.join(distDir, entry.name);
            let code = safeReadFile(filePath, 'MISSING_BOT_MODULE');

            // Profiler injection into main.js (loop wrapper).
            // Profiler runs in infinite (background) mode: disableTick=false,
            // so timer-based termination is not reachable. The final output()/callgrind()
            // export is controlled by the harness via the Memory.__profileFinalize flag
            // (see world.exportProfiles).
            //
            // Tick ordering MATTERS: __origLoop (the bot's original loop) calls
            // profiler.wrap() → setupProfiler(), which CREATES Game.profiler. Therefore
            // Game.profiler.background() must be called AFTER __origLoop, otherwise
            // Game.profiler doesn't exist yet on that tick.
            //
            // Flow:
            //   tick 0 — __origLoop → profiler.wrap → setupProfiler → Game.profiler created;
            //   tick 1 — __origLoop (data collection), then Game.profiler.background() →
            //     creates Memory.profiler with enabledTick = Game.time + 1;
            //   tick 2+ — __origLoop (profiler collects data via Profiler.endTick);
            //   finalisation tick — wrapper sees __profileFinalize, exports
            //     output()/callgrind() to Memory and does NOT call __origLoop so as not
            //     to skew statistics with an extra bot tick.
            if (opts.profiling && name === 'main') {
                code += `
const __origLoop = module.exports.loop;
module.exports.loop = function() {
    if (Memory.__profileFinalize) {
        delete Memory.__profileFinalize;
        if (Memory.profiler && Memory.profiler.enabledTick) {
            try {
                var profiler = require('screeps-profiler');
                Memory.__profileCallgrind = profiler.callgrind();
                Memory.__profileText = profiler.output();
            } catch (e) { /* profiler export failed */ }
        }
        return;
    }

    __origLoop.call(this);

    if (Game.time === 1 && Game.profiler) {
        Game.profiler.background();
    }
};`;
            }

            modules[name] = code;
        }
    }
    return modules;
}

module.exports = { loadBotModules };
