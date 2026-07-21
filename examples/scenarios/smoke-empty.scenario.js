'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');

/**
 * Сценарий: smoke-empty.
 *
 * Минимальный smoke-тест: одна комната (RCL1, 2 source, без крипов), один бот.
 * Проверяет: framework стартует, бот делает N тиков, не падает, нет ошибок.
 *
 * Запуск: npm run test:integration -- --only smoke-empty
 *
 * @param {Object} [opts] — опции из runScenario.js (profiling, ...)
 * @returns {Promise<Object>} report
 */
async function run(opts = {}) {
    const ticks = parseInt(process.env.TEST_TICKS || '30', 10);
    const world = await createWorld({
        rooms: [
            {
                name: 'W0N1',
                controller: spec.controller({ level: 1 }),
                sources: [spec.source(15, 15), spec.source(35, 35)],
                structures: [spec.spawn(25, 25)],
            },
        ],
        bots: [{ username: 'bot', rooms: 'W0N1' }],
        ticks,
        profiling: opts.profiling,
    });

    try {
        await world.run();

        assertBotWorked(world.report);
        assertNoErrors(world.report);
        assert.strictEqual(world.report.ticksRun, ticks, `ожидали ${ticks} тиков, получили ${world.report.ticksRun}`);

        console.log(`PASS: smoke-empty (${world.report.ticksRun} ticks, ${world.report.wallClockMs}ms)`);
        return world.report;
    } finally {
        await world.dispose();
    }
}

module.exports = { run };
