'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');

/**
 * Сценарий: world-lifecycle.
 *
 * Проверяет корректное взаимодействие `world.run()` и `world.tick()`.
 * Сценарий сознательно использует минимальное число серверов (2), потому что
 * `@screeps/common/lib/storage.js` — синглтон, и частая смена storage-порта
 * внутри одного процесса приводит к race между старым сокетом и reconnect.
 *
 * Покрытые проверки:
 * - tick() перед run() учитывается в общем лимите ticks
 * - run() не превышает opts.ticks
 * - повторный run() не добавляет тиков
 * - tick() после run() без until продолжает тикать
 * - run()/tick(N) уважают until (maxTicks)
 *
 * Запуск: npm run test:integration -- --only world-lifecycle
 *
 * @param {Object} [opts] — опции из runScenario.js (profiling, ...)
 * @returns {Promise<Object>} report
 */
async function run(opts = {}) {
    // ─── Test A: поведение без until ───────────────────────────────────────
    {
        const world = await createWorld({
            rooms: [
                {
                    name: 'W0N1',
                    controller: spec.controller({ level: 1 }),
                    sources: [spec.source(15, 15), spec.source(35, 35)],
                    structures: [spec.spawn(25, 25)],
                },
            ],
            bots: [{ username: 'bot', room: 'W0N1' }],
            ticks: 10,
            profiling: opts.profiling,
        });

        try {
            // tick() перед run() — run() учитывает уже сделанные тики
            await world.tick(3);
            assert.strictEqual(world.report.ticksRun, 3, 'tick(3) должен сделать 3 тика');

            // последовательные tick()
            await world.tick(2);
            assert.strictEqual(world.report.ticksRun, 5, 'tick(2) после tick(3) должен дать 5');

            // run() добирает до opts.ticks и не превышает лимит
            await world.run();
            assert.strictEqual(world.report.ticksRun, 10, 'run() должен добрать до 10 тиков');

            // повторный run() не добавляет тиков
            await world.run();
            assert.strictEqual(world.report.ticksRun, 10, 'повторный run() не должен добавлять тиков');

            // tick() после run() без until продолжает тикать
            await world.tick(2);
            assert.strictEqual(world.report.ticksRun, 12, 'tick(2) после run() должен дать 12');

            // run() снова не тикает — ticksRun >= opts.ticks
            await world.run();
            assert.strictEqual(world.report.ticksRun, 12, 'run() после tick(2) не должен добавлять тиков');

            assertBotWorked(world.report);
            assertNoErrors(world.report);
        } finally {
            await world.dispose();
        }
    }

    // ─── Test B: поведение с until.maxTicks ────────────────────────────────
    {
        const world = await createWorld({
            rooms: [
                {
                    name: 'W0N1',
                    controller: spec.controller({ level: 1 }),
                    structures: [spec.spawn(25, 25)],
                },
            ],
            bots: [{ username: 'bot', room: 'W0N1' }],
            ticks: 20,
            until: { maxTicks: 10 },
            profiling: opts.profiling,
        });

        try {
            // run() останавливается на maxTicks
            await world.run();
            assert.strictEqual(world.report.ticksRun, 10, 'run() должен остановиться на maxTicks=10');
            assert.ok(world.report.stopReason, 'должен быть stopReason');

            // повторный run() не добавляет тиков
            await world.run();
            assert.strictEqual(
                world.report.ticksRun,
                10,
                'повторный run() не должен добавлять тиков при наличии stopReason',
            );

            // tick(N) в пределах N тиков уважает until
            await world.tick(15);
            assert.strictEqual(
                world.report.ticksRun,
                10,
                `tick(15) с until.maxTicks=10 должен дать 10, а вернул ${world.report.ticksRun}`,
            );

            // run() после остановки не добавляет тиков
            await world.run();
            assert.strictEqual(world.report.ticksRun, 10, 'run() после остановки не добавляет тиков');
        } finally {
            await world.dispose();
        }
    }

    console.log('PASS: world-lifecycle (5/5 tests passed)');
    return {};
}

module.exports = { run };
