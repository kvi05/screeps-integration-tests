'use strict';

/**
 * @file Finalisation of the world run report.
 *
 * Responsibility:
 *   After the tick loop ends (for any reason — limit, predicate, or error),
 *   this module collects the final state snapshot: wall clock time, per-bot
 *   Memory, per-room RCL, and profiler output (text + callgrind).
 *
 *   The function is stateless — it takes all dependencies explicitly.
 *
 * @module finalize
 */

/**
 * @typedef {import('./types').ScreepsServer} ScreepsServer
 * @typedef {import('./types').WorldReport} WorldReport
 * @typedef {import('./types').RoomStatus} RoomStatus
 * @typedef {import('./types').Bot} Bot
 * @typedef {import('./types').ResolvedBotSpec} ResolvedBotSpec
 */

/**
 * Collects the final state after the tick loop finishes.
 *
 * Reads per-bot Memory from storage, per-room RCL from the DB, and
 * extracts profiler output (text + callgrind) from profiled bots.
 *
 * @param {WorldReport} report       — in-place mutation; fields wallClockMs,
 *   finalMemory, finalRcl, profileText, profileCallgrind are filled
 * @param {number} startTime         — Date.now() captured at world creation
 * @param {Object<string,Bot>} bots  — bot instances keyed by username
 * @param {import('./storageAdapter').StorageAdapter} adapter
 * @param {Object<string,RoomStatus>} roomStatus
 * @param {Object<string,ResolvedBotSpec>} resolvedBots
 * @param {(adapter: import('./storageAdapter').StorageAdapter, username: string) => Promise<Object>} getBotMemoryFn
 * @param {(adapter: import('./storageAdapter').StorageAdapter, roomName: string) => Promise<number>} getRclFn
 * @returns {Promise<WorldReport>}
 */
async function finalizeReport(report, startTime, bots, adapter, roomStatus, resolvedBots, getBotMemoryFn, getRclFn) {
    report.wallClockMs = Date.now() - startTime;

    // finalMemory per-bot
    for (const [username, bot] of Object.entries(bots)) {
        try {
            report.finalMemory[username] = await getBotMemoryFn(adapter, bot.id);
        } catch {
            report.finalMemory[username] = {};
        }
    }

    // finalRcl per-room
    /** @type {string[]} */
    const roomNames = Object.keys(roomStatus);
    for (const name of roomNames) {
        report.finalRcl[name] = await getRclFn(adapter, name);
    }

    // Profiler per-bot (text + callgrind)
    for (const [username, mem] of Object.entries(report.finalMemory)) {
        const botSpec = resolvedBots[username];

        if (botSpec?.effectiveProfiling) {
            if (mem.__profileText) {
                report.profileText[username] = mem.__profileText || null;
            }
            if (mem.__profileCallgrind) {
                report.profileCallgrind[username] = mem.__profileCallgrind;
            }
        }
    }

    return report;
}

module.exports = {
    finalizeReport,
};
