'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');

// ─── Константы комнат ────────────────────────────────────────────────────────
// Выносите часто используемые конфиги в переменные наверх сценария,
// чтобы не дублировать spec-вызовы в каждом createWorld.
const ROOM = 'W0N1';

const BASE_ROOM = {
    name: ROOM,
    controller: spec.controller({ level: 1 }),
    sources: [spec.source(15, 15), spec.source(35, 35)],
    structures: [spec.spawn(25, 25)],
};

/** @type {import('screeps-integration-tests').BotSpec[]} */
const BOT_SPEC = [{ username: 'bot', room: ROOM }];

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
    const world = await createWorld({
        rooms: [BASE_ROOM],
        bots: BOT_SPEC,
        ticks: ticks,
        profiling: opts.profiling,
        logLevel: 'error',
    });

    try {
        // ─── High-level хелперы (всегда доступны) ──────────────────────────
        //   world.botId()                    — _id первого (единственного) бота
        //   world.botId('bot')               — _id бота по username
        //   world.botId(0)                   — _id бота по индексу (0-based)
        //   world.find(query)                — поиск объектов в rooms.objects
        //   world.findOne(query)             — один объект или null
        //   world.createStructure(spec)      — создать структуру
        //   world.setHitsStructure(id, hits) — установить HP (0 - если нужно штатно разрушить)
        //   world.damageHitsStructure(id,dmg)— нанести урон
        //   world.deleteStructure(id)        — удалить структуру (напрямую из БД, в обход стандартных механизмов)
        //   world.eventLog(room)             — события комнаты за тик
        //   world.readMemory(user?)          — прочитать Memory бота
        //   world.writeMemory(user, patch)   — обновить Memory

        // ─── Действия ──────────────────────────────────────────────────────
        await world.run();

        // ─── Assertions ────────────────────────────────────────────────────
        assertBotWorked(world.report);
        assertNoErrors(world.report);
        assert.ok(true, 'описание если тест провалился');

        console.log(`\nPASS: <Имя сценария> (${world.report.ticksRun} ticks, ${world.report.wallClockMs / 1000}s)`);
        return world.report;
    } finally {
        await world.dispose();
    }
}

module.exports = { run };
