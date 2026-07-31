'use strict';

/**
 * @typedef {import('../types').ScreepsServer} ScreepsServer
 * @typedef {import('../types').WorldInstance} WorldInstance
 * @typedef {import('../types').WorldReport} WorldReport
 * @typedef {import('../types').WorldOpts} WorldOpts
 * @typedef {import('../types').UntilOpts} UntilOpts
 * @typedef {import('../types').PredicateFn} PredicateFn
 *
 * @typedef {Object} PredicateCtx
 * @property {WorldReport} report
 * @property {ScreepsServer} server
 * @property {Object<string,import('../types').Bot>} bots
 * @property {(username?: string) => Promise<Object>} readMemory
 * @property {(room: string) => Promise<Object[]>} getEventLog
 * @property {(room: string) => Promise<Object[]>} eventLog — deprecated alias for getEventLog (for backward compatibility in predicate callbacks)
 *
 * @typedef {Object} PredicateResult
 * @property {boolean} shouldStop
 * @property {string} reason
 */

/**
 * Evaluates `UntilOpts` (completion predicate) and returns a decision —
 * whether to stop the run now.
 *
 * Algorithm (check order):
 * 1. `maxTicks` — if `ticksRun >= maxTicks` → stop.
 * 2. `predicate` — if set, executes it. Sync and async via `Promise.resolve`.
 *    If it throws — the test stops with an error.
 * 3. `signal` — if `Memory[signal]` is truthy → stop.
 *    If `signalBot` is set — only that bot's Memory is checked.
 *    If `signalBot` is not set — all bots are checked (stop if
 *    any bot has truthy `signal`).
 *
 * Before calls 2 and 3, `ctx.report.finalMemory` is updated per-bot via
 * `ctx.readMemory(username)`, so that predicate and signal see the current
 * state, not a stale snapshot.
 *
 * @param {PredicateCtx} ctx
 * @param {UntilOpts} until
 * @returns {Promise<PredicateResult>}
 */
async function evaluatePredicate(ctx, until) {
    if (!until) {
        return { shouldStop: false, reason: '' };
    }

    // 1. Check maxTicks (no Memory read)
    if (until.maxTicks && ctx.report.ticksRun >= until.maxTicks) {
        return {
            shouldStop: true,
            reason: `Tick limit reached: ${ctx.report.ticksRun}/${until.maxTicks}`,
        };
    }

    // 2. Update finalMemory per-bot before predicate/signal (freshness)
    if ((until.predicate || until.signal) && ctx.readMemory) {
        for (const username of Object.keys(ctx.bots)) {
            try {
                ctx.report.finalMemory[username] = await ctx.readMemory(username);
            } catch {
                // readMemory may fail on early ticks — not critical
            }
        }
    }

    // 3. Check predicate (sync and async via Promise.resolve)
    if (until.predicate && typeof until.predicate === 'function') {
        try {
            const result = await Promise.resolve(until.predicate(ctx));
            if (result) {
                return {
                    shouldStop: true,
                    reason: `Predicate resolved on tick ${ctx.report.ticksRun}`,
                };
            }
        } catch (e) {
            return {
                shouldStop: true,
                reason: `Predicate threw an error: ${e.message}`,
            };
        }
    }

    // 4. Check Memory signal
    if (until.signal) {
        // Determine which bots to check
        const botsToCheck = until.signalBot ? { [until.signalBot]: ctx.bots[until.signalBot] } : ctx.bots;

        for (const [username, bot] of Object.entries(botsToCheck)) {
            if (!bot) {
                continue;
            }
            try {
                const mem = ctx.report.finalMemory[username] || {};
                const signal = mem[until.signal];
                if (signal) {
                    return {
                        shouldStop: true,
                        reason: `Memory.${until.signal} = ${JSON.stringify(signal)} (bot: ${username})`,
                    };
                }
            } catch {
                // memory not read yet — not critical
            }
        }
    }

    return { shouldStop: false, reason: '' };
}

/**
 * Convenience wrapper around `evaluatePredicate` used by the tick loop.
 *
 * Builds the context from the tick loop's available references and
 * returns `{ shouldStop, reason }`. Sets `report.stopReason` if stopping.
 *
 * @param {import('../types').WorldOpts} opts
 * @param {WorldReport} report
 * @param {ScreepsServer} server
 * @param {Object<string,import('../types').Bot>} bots
 * @param {Function} readMemory
 * @param {Function} getEventLog
 * @returns {Promise<{ shouldStop: boolean, reason: string }>}
 */
async function checkStopCondition(opts, report, server, bots, readMemory, getEventLog) {
    if (!opts.until) {
        return { shouldStop: false, reason: '' };
    }

    const { shouldStop, reason } = await evaluatePredicate(
        { report, server, bots, readMemory, getEventLog, eventLog: getEventLog },
        opts.until,
    );
    if (shouldStop) {
        report.stopReason = reason;
    }
    return { shouldStop, reason };
}

module.exports = { evaluatePredicate, checkStopCondition };
