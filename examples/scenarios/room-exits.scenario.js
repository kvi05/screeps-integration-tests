'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');

/**
 * Сценарий: room-exits.
 *
 * Эмпирический тест межкомнатных соединений для разных топологий:
 *  - вертикально-смежные (W0N1 ↔ W0N2)
 *  - горизонтально-смежные (W0N1 ↔ W1N1)
 *  - не-смежные (W0N1 и W5N5 не имеют прямого exit-соседа)
 *
 * Запуск: npm run test:integration -- --only room-exits
 *
 * @param {Object} [opts] — опции из runScenario.js
 * @returns {Promise<Object>} report
 */
async function run(opts = {}) {
    const ticks = parseInt(process.env.TEST_TICKS || '3', 10);

    async function buildWorld(roomsInput) {
        return createWorld({
            rooms: roomsInput,
            bots: [
                {
                    username: 'bot',
                    rooms: roomsInput[0].name,
                    modules: { main: 'module.exports.loop = function() {};' },
                },
            ],
            ticks,
            profiling: opts.profiling,
            logLevel: 'all',
        });
    }

    // Шлёт все запросы describeExits одним батчем, затем один run().
    // Возвращает map { roomName -> parsed exits | null | '<NOT_FOUND>' }.
    async function readExits(world, roomNames) {
        const code = roomNames
            .map((r) => `console.log('__EX_${r}__=' + JSON.stringify(Game.map.describeExits('${r}')));`)
            .join('\n');
        await world.exec(code);
        await world.run();
        const logs = (world.report.logs || []).map((l) => l.message || l).join('\n');
        const joined = logs.replace(/&#x22;/g, '"');
        const result = {};
        for (const r of roomNames) {
            const m = joined.match(new RegExp(`__EX_${r}__=(\\{.*?\\}|null|undefined)`));
            if (!m) {
                result[r] = '<NOT_FOUND>';
                continue;
            }
            try {
                result[r] = m[1] === 'undefined' || m[1] === 'null' ? null : JSON.parse(m[1]);
            } catch {
                result[r] = m[1];
            }
        }
        return result;
    }

    const TOP = 1;
    const BOTTOM = 5;
    const LEFT = 7;
    const RIGHT = 3;

    // ─── Кейс 1: вертикально-смежные W0N1 (снизу) ↔ W0N2 (сверху) ─────────
    {
        const world = await buildWorld([
            {
                name: 'W0N1',
                controller: spec.controller({ level: 1 }),
                sources: [spec.source(15, 15)],
                structures: [spec.spawn(25, 25)],
            },
            {
                name: 'W0N2',
                controller: spec.controller({ level: 1 }),
                sources: [spec.source(20, 20)],
            },
        ]);
        try {
            const ex = await readExits(world, ['W0N1', 'W0N2']);
            assert.strictEqual(ex['W0N1'][TOP], 'W0N2', 'W0N1.TOP -> W0N2');
            assert.strictEqual(ex['W0N2'][BOTTOM], 'W0N1', 'W0N2.BOTTOM -> W0N1');
            // No phantom exits on other borders
            assert.strictEqual(ex['W0N1'][BOTTOM], undefined, 'W0N1.BOTTOM should not exist');
            assert.strictEqual(ex['W0N1'][LEFT], undefined, 'W0N1.LEFT should not exist');
            assert.strictEqual(ex['W0N1'][RIGHT], undefined, 'W0N1.RIGHT should not exist');
            assert.strictEqual(ex['W0N2'][TOP], undefined, 'W0N2.TOP should not exist');
            assert.strictEqual(ex['W0N2'][LEFT], undefined, 'W0N2.LEFT should not exist');
            assert.strictEqual(ex['W0N2'][RIGHT], undefined, 'W0N2.RIGHT should not exist');
        } finally {
            await world.dispose();
        }
    }

    // ─── Кейс 2: горизонтально-смежные W0N1 ↔ W1N1 ───────────────────────
    {
        const world = await buildWorld([
            {
                name: 'W0N1',
                controller: spec.controller({ level: 1 }),
                sources: [spec.source(15, 15)],
                structures: [spec.spawn(25, 25)],
            },
            {
                name: 'W1N1',
                controller: spec.controller({ level: 1 }),
                sources: [spec.source(20, 20)],
            },
        ]);
        try {
            const ex = await readExits(world, ['W0N1', 'W1N1']);
            assert.strictEqual(ex['W0N1'][LEFT], 'W1N1', 'W0N1.LEFT -> W1N1');
            assert.strictEqual(ex['W1N1'][RIGHT], 'W0N1', 'W1N1.RIGHT -> W0N1');
            // No phantom exits on other borders
            assert.strictEqual(ex['W0N1'][TOP], undefined, 'W0N1.TOP should not exist');
            assert.strictEqual(ex['W0N1'][BOTTOM], undefined, 'W0N1.BOTTOM should not exist');
            assert.strictEqual(ex['W0N1'][RIGHT], undefined, 'W0N1.RIGHT should not exist');
            assert.strictEqual(ex['W1N1'][TOP], undefined, 'W1N1.TOP should not exist');
            assert.strictEqual(ex['W1N1'][BOTTOM], undefined, 'W1N1.BOTTOM should not exist');
            assert.strictEqual(ex['W1N1'][LEFT], undefined, 'W1N1.LEFT should not exist');
        } finally {
            await world.dispose();
        }
    }

    // ─── Кейс 3: не-смежные W0N1 и W5N5 — нет прямого exit между ними ──────
    {
        const world = await buildWorld([
            {
                name: 'W0N1',
                controller: spec.controller({ level: 1 }),
                sources: [spec.source(15, 15)],
                structures: [spec.spawn(25, 25)],
            },
            {
                name: 'W5N5',
                controller: spec.controller({ level: 1 }),
                sources: [spec.source(20, 20)],
            },
        ]);
        try {
            const ex = await readExits(world, ['W0N1', 'W5N5']);
            // Both rooms are isolated — no exits at all
            assert.deepStrictEqual(ex['W0N1'], {}, 'W0N1 should have no exits');
            assert.deepStrictEqual(ex['W5N5'], {}, 'W5N5 should have no exits');
        } finally {
            await world.dispose();
        }
    }

    // ─── Кейс 4: findRoute между смежными комнатами (для expansion-to-source) ──
    {
        const world = await buildWorld([
            {
                name: 'W0N1',
                controller: spec.controller({ level: 1 }),
                sources: [spec.source(15, 15)],
                structures: [spec.spawn(25, 25)],
            },
            {
                name: 'W0N2',
                controller: spec.controller({ level: 1 }),
                sources: [spec.source(20, 20)],
            },
        ]);
        try {
            await world.exec("console.log('__ROUTE_V__=' + JSON.stringify(Game.map.findRoute('W0N1','W0N2')));");
            await world.exec(
                "console.log('__ROUTE_FIND_EX__=' + JSON.stringify(Game.rooms['W0N1'].findExitTo('W0N2')));",
            );
            await world.run();
            const logs = (world.report.logs || []).map((l) => l.message || l).join('\n');
            const joined = logs.replace(/&#x22;/g, '"');
            const mRoute = joined.match(/__ROUTE_V__=(\[.*?\]|null|-?\d+|undefined)/);
            const route = mRoute ? mRoute[1] : '<NOT_FOUND>';
            // findRoute возвращает массив ходов [{exit, room}] или ERR_NO_PATH (-2)
            assert.ok(route.startsWith('['), `findRoute должен вернуть array ходов, получил: ${route}`);
        } finally {
            await world.dispose();
        }
    }

    console.log('PASS: room-exits (all topologies)');
    return { ticksRun: ticks * 4 };
}

module.exports = { run };
