'use strict';

/**
 * Profiler export: triggers profiler finalisation and writes text/callgrind profiles.
 */

const fs = require('fs');
const path = require('path');

/** @type {number} Sequence counter to guarantee unique filenames within the same millisecond. */
let _callgrindSeq = 0;

/**
 * Triggers profiler finalisation for all profiled bots.
 *
 * Sets the `__profileFinalize` flag in each profiled bot's Memory
 * and runs one technical server tick (DIRECTLY via server.tick(), not
 * via the normal tick loop — to avoid incrementing ticksRun and generating
 * metrics/events/predicate noise). The bot's code sees the flag, calls
 * profiler.output()/callgrind() and stores results in
 * Memory.__profileText / __profileCallgrind.
 *
 * Always called — including on premature scenario termination
 * (predicate / maxTicks / exception in doTick).
 *
 * @param {Object<string,{effectiveProfiling?: boolean}>} resolvedBots
 * @param {(username: string, patch: Object) => Promise<void>} writeMemoryFn
 * @param {{ tick: () => Promise<void> }} server
 * @param {{ errors: string[] }} report
 * @returns {Promise<void>}
 */
async function exportProfiles(resolvedBots, writeMemoryFn, server, report) {
    const profilingBots = Object.entries(resolvedBots)
        .filter(([, spec]) => spec && spec.effectiveProfiling)
        .map(([username]) => username);
    if (profilingBots.length === 0) {
        return;
    }
    for (const username of profilingBots) {
        await writeMemoryFn(username, { __profileFinalize: true });
    }
    try {
        await server.tick();
    } catch (e) {
        // Server may have died — profile can no longer be retrieved. Don't suppress the original
        // run error (it will be re-thrown in run() after finalize).
        report.errors.push(`profile export tick failed: ${e.message || String(e)}`);
    }
}

/**
 * Saves a callgrind dump to a local file.
 * @param {string} callgrindData — callgrind-formatted string (treated as a plain string)
 * @param {string} scenarioName — scenario name (used in the filename)
 * @param {string} profilesDir — path to the callgrind output directory
 * @returns {string} path to the created file
 */
function saveCallgrind(callgrindData, scenarioName, profilesDir) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const seq = String(++_callgrindSeq).padStart(3, '0');
    const filename = `${scenarioName}-${timestamp}-${seq}.callgrind`;
    const filePath = path.join(profilesDir, filename);
    fs.mkdirSync(profilesDir, { recursive: true });
    fs.writeFileSync(filePath, callgrindData, 'utf8');
    return filePath;
}

module.exports = { saveCallgrind, exportProfiles };
