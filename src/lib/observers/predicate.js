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
 *
 * @typedef {Object} PredicateResult
 * @property {boolean} shouldStop
 * @property {string} reason
 */

/**
 * Оценивает `UntilOpts` (предикат завершения) и возвращает решение —
 * остановить ли прогон сейчас.
 *
 * Алгоритм (порядок проверок):
 * 1. `maxTicks` — если `ticksRun >= maxTicks` → остановить.
 * 2. `predicate` — если задан, выполняется. Sync и async через `Promise.resolve`.
 *    Если бросил ошибку — тест останавливается с ошибкой.
 * 3. `signal` — если `Memory[signal]` truthy → остановить.
 *    Если `signalBot` задан — проверяется только Memory этого бота.
 *    Если `signalBot` не задан — проверяются все боты (остановка если
 *    хотя бы у одного `signal` truthy).
 *
 * Перед вызовами 2 и 3 обновляется `ctx.report.finalMemory` per-bot через
 * `ctx.readMemory(username)`, чтобы predicate и signal видели актуальное
 * состояние, а не устаревший snapshot.
 *
 * @param {PredicateCtx} ctx
 * @param {UntilOpts} until
 * @returns {Promise<PredicateResult>}
 */
async function evaluatePredicate(ctx, until) {
    if (!until) {
        return { shouldStop: false, reason: '' };
    }

    // 1. Проверка maxTicks (без чтения Memory)
    if (until.maxTicks && ctx.report.ticksRun >= until.maxTicks) {
        return {
            shouldStop: true,
            reason: `Достигнут лимит тиков: ${ctx.report.ticksRun}/${until.maxTicks}`,
        };
    }

    // 2. Обновить finalMemory per-bot перед predicate/signal (актуальность)
    if ((until.predicate || until.signal) && ctx.readMemory) {
        for (const username of Object.keys(ctx.bots)) {
            try {
                ctx.report.finalMemory[username] = await ctx.readMemory(username);
            } catch {
                // readMemory может упасть на первых тиках — не критично
            }
        }
    }

    // 3. Проверка predicate (sync и async через Promise.resolve)
    if (until.predicate && typeof until.predicate === 'function') {
        try {
            const result = await Promise.resolve(until.predicate(ctx));
            if (result) {
                return {
                    shouldStop: true,
                    reason: `Predicate выполнился на тике ${ctx.report.ticksRun}`,
                };
            }
        } catch (e) {
            return {
                shouldStop: true,
                reason: `Predicate бросил ошибку: ${e.message}`,
            };
        }
    }

    // 4. Проверка Memory-сигнала
    if (until.signal) {
        // Определяем какие боты проверять
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
                // memory ещё не прочитана — не критично
            }
        }
    }

    return { shouldStop: false, reason: '' };
}

module.exports = { evaluatePredicate };
