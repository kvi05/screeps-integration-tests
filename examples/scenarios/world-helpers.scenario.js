'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');
const { STRUCTURE_TOWER } = require('screeps-integration-tests/constants');

/**
 * Сценарий: world-helpers.
 *
 * Демонстрирует работу хелперов: setTicksToDowngrade, setHitsStructure,
 * damageHitsStructure, deleteStructure, createStructure, find.
 *
 * Запуск: npm run test:integration -- --only world-helpers
 *
 * @param {Object} [opts]
 * @returns {Promise<Object>} report
 */
async function run(opts = {}) {
    // ─── Создание мира ──────────────────────────────────────────────────────
    const world = await createWorld({
        rooms: [
            {
                name: 'W0N1',
                controller: spec.controller({ level: 3 }),
                sources: [spec.source(15, 15), spec.source(35, 35)],
                structures: [spec.spawn(25, 25)],
            },
        ],
        bots: [{ username: 'bot', room: 'W0N1' }],
        ticks: 5,
        profiling: opts.profiling,
        logLevel: 'error',
    });

    try {
        const { report } = world;

        // ─── setTicksToDowngrade ──────────────────────────────────────────
        // Устанавливаем downgradeTime = gameTime + 5000
        await world.setTicksToDowngrade('W0N1', 5000);

        // ─── createStructure ───────────────────────────────────────────────
        // Создаём башню и стену через spec
        const towerId = await world.createStructure(spec.tower(26, 24, { roomName: 'W0N1' }));
        const wallId = await world.createStructure(spec.wall(30, 30, { roomName: 'W0N1', hits: 500000 }));

        assert.ok(typeof towerId === 'string', 'towerId должен быть строкой');
        assert.ok(typeof wallId === 'string', 'wallId должен быть строкой');

        // ─── find ─────────────────────────────────────────────────────────
        // Ищем все towers
        const towers = await world.find({ room: 'W0N1', type: STRUCTURE_TOWER });
        assert.strictEqual(towers.length, 1, 'должна быть 1 башня');
        assert.strictEqual(towers[0].id, towerId, 'id башни из find совпадает с id из createStructure');

        // Ищем по userId + type (мапится в user)
        const myTower = await world.findOne({ type: STRUCTURE_TOWER, userId: world.botId() });
        assert.ok(myTower, 'должна найтись башня');
        assert.strictEqual(myTower.type, STRUCTURE_TOWER);

        // findId с index=0 для источника
        const sourceId = await world.findId({ room: 'W0N1', type: 'source' }, { index: 0 });
        assert.ok(typeof sourceId === 'string', 'sourceId должен быть строкой');

        // ─── damageHitsStructure ──────────────────────────────────────────
        // Наносим урон стене
        await world.damageHitsStructure(wallId, 10000);
        const wallAfterDamage = await world.findOne({ _id: wallId });
        assert.strictEqual(wallAfterDamage.hits, 490000, 'hits стены должен уменьшиться на 10000');

        // ─── setHitsStructure ─────────────────────────────────────────────
        // Восстанавливаем hits и проверяем clamp по hitsMax
        await world.setHitsStructure(wallId, 999999999);
        const wallAfterRepair = await world.findOne({ _id: wallId });
        assert.strictEqual(wallAfterRepair.hits, 300000000, 'hits не должен превышать hitsMax (300M)');

        // ─── deleteStructure ──────────────────────────────────────────────
        // Удаляем башню
        await world.deleteStructure(towerId);
        const deletedTower = await world.findOne({ _id: towerId });
        assert.strictEqual(deletedTower, null, 'башня должна быть удалена из БД');

        // ─── Прогон ───────────────────────────────────────────────────────
        await world.run();

        // ─── Assertions ───────────────────────────────────────────────────
        assertBotWorked(report);
        assertNoErrors(report);

        console.log(`\nPASS: world-helpers (${report.ticksRun} ticks, ${report.wallClockMs / 1000}s)`);
        return report;
    } finally {
        await world.dispose();
    }
}

module.exports = { run };
