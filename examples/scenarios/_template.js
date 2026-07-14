'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked } = require('screeps-integration-tests/assertions');

/**
 * Сценарий: <имя файла без .scenario.js>.
 *
 * <описание>
 *
 * Ожидаемое поведение: <опционально>
 *
 * Проверяет: <--->
 *
 * Запуск: npm run test:integration -- --only <имя-файла-без-.scenario.js>
 *
 * @param {Object} [opts] — опции из runScenario.js (profiling, ...)
 * @returns {Promise<Object>} report
 */
async function run(opts = {}) {
    const ticks = parseInt(process.env.TEST_TICKS || '100', 10);

    // ─── Создание мира ──────────────────────────────────────────────────────
    // Multi-room + multi-bot. Минимум 1 бот.
    const world = await createWorld({
        rooms: [
            {
                name: 'W0N1',
                controller: spec.controller({ level: 1 }),
                sources: [spec.source(15, 15), spec.source(35, 35)],
            },
        ],
        bots: [{ username: 'bot', room: 'W0N1' }],
        ticks,
        profiling: opts.profiling,
        logLevel: 'errors',
    });

    try {
        // ─── Действия ────────────────────────────────────────────────────────
        await world.run();

        // ─── Assertions ──────────────────────────────────────────────────────
        assertBotWorked(world.report);
        assert.ok(true, 'описание если тест провалился');

        console.log(`\nPASS: <Имя сценария> (${world.report.ticksRun} ticks, ${world.report.wallClockMs / 1000}s)`);
        return world.report;
    } finally {
        await world.dispose();
    }
}

module.exports = { run };
