'use strict';

const assert = require('node:assert');
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked } = require('screeps-integration-tests/assertions');

const ROOM = 'W0N1';
const BOT = 'bot';

/**
 * Scenario: eval-in-bot.
 *
 * Verifies: world.evalInBot — evaluates JS code in the bot's context and
 * resolves with the result on the next tick (promise is created BEFORE the
 * tick and awaited AFTER it), JSON transport for objects/arrays, multiple
 * pending calls resolved by a unique id (order-independent), error
 * propagation for throwing expressions, a transport hint for unserializable
 * (cyclic) results, `undefined` mapping, and noise immunity — `console.log`
 * commands submitted via `world.exec` on the same tick must not affect the
 * returned value.
 *
 * Run: npm run test:integration -- --only eval-in-bot
 *
 * @param {Object} [opts]
 * @returns {Promise<Object>}
 */
async function run(opts = {}) {
    const world = await createWorld({
        rooms: [
            {
                name: ROOM,
                controller: spec.controller({ level: 1 }),
                sources: [spec.source(15, 15)],
                structures: [spec.spawn(25, 25)],
            },
        ],
        bots: [{ username: BOT, rooms: ROOM }],
        ticks: 30,
        profiling: opts.profiling,
    });

    try {
        // ─── Basic: promise + tick pattern ────────────────────
        // The expression runs on the NEXT tick, so world.tick(n)
        // must be called after evalInBot.
        const timePromise = world.evalInBot('Game.time');
        // Noise: a plain console.log command submitted on the same tick must
        // not leak into evalInBot's result (log-only console events are skipped).
        await world.exec("console.log('noise #1: this log must not affect evalInBot')");
        await world.tick(1);
        const gameTime = await timePromise;
        assert.strictEqual(typeof gameTime, 'number', 'evalInBot returns a number for Game.time');

        // ─── JSON transport: objects/arrays ──────────────────
        const dataPromise = world.evalInBot('JSON.stringify({ tick: Game.time, rooms: Object.keys(Game.rooms) })');
        // Noise: log + an `undefined` REPL result on the same tick as the
        // envelope — must not be mistaken for it or mixed into it.
        await world.exec("console.log('noise #2: ' + JSON.stringify({ fake: true }))");
        await world.tick(1);
        const data = await dataPromise;
        assert.strictEqual(typeof data, 'object', 'evalInBot parses JSON-encoded objects');
        assert.strictEqual(data.tick, gameTime + 1, 'data matches the tick it ran on');
        assert.ok(Array.isArray(data.rooms), 'rooms is an array');
        assert.ok(data.rooms.includes(ROOM), `room ${ROOM} is visible to the bot`);

        // ─── Multiple pending calls: results matched by id ────
        const p1 = world.evalInBot('JSON.stringify([1, 2, 3])');
        // Noise: submitted between two evalInBot calls on the same tick.
        await world.exec("console.log('noise #3: between pending evalInBot calls')");
        const p2 = world.evalInBot('Game.time');
        await world.tick(1);
        const arr = await p1;
        const time2 = await p2;
        assert.deepStrictEqual(arr, [1, 2, 3], 'array JSON transport');
        assert.strictEqual(typeof time2, 'number', 'second pending call resolves');

        // ─── Errors: throwing expression rejects ─────────────
        const errPromise = world.evalInBot('throw new Error("eval boom")');
        await world.tick(1);
        await assert.rejects(errPromise, /evalInBot: expression failed/, 'throwing expression rejects');

        // ─── Transport failure: unserializable result gets a hint ─
        // The wrapper transports results via JSON.stringify, so a cyclic
        // value (here a self-referencing object) cannot be transported and
        // the promise must reject with a hint to use JSON.stringify(...).
        const circularPromise = world.evalInBot('(() => { const o = {}; o.self = o; return o; })()');
        await world.tick(1);
        // The embedded engine stack trace contains newlines, so match across
        // line boundaries ([\s\S] instead of .).
        await assert.rejects(
            circularPromise,
            /cannot be transported[\s\S]*use JSON\.stringify/,
            'cyclic result produces a transport hint',
        );

        // ─── Undefined result maps back to undefined ─────────
        const undefPromise = world.evalInBot('undefined');
        await world.tick(1);
        assert.strictEqual(await undefPromise, undefined, 'undefined result maps back to undefined');

        // Let the bot run a few more ticks for a healthy report.
        await world.tick(2);

        assertBotWorked(world.report);
        return world.report;
    } finally {
        await world.dispose();
    }
}

module.exports = { run };
