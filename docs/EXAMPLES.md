# Examples

Reference scenarios and typical usage patterns for the framework.

> **Note:** some recipes (bootstrap, defense) are taken from a personal
> bot and contain bot-specific checks (e.g., expected fields in
> `Memory`). Use them as inspiration, not as ready-made code — adapt
> them to your architecture. Such places are marked with an inline label
> `[example from personal bot]`.

## Table of Contents

- [1. Smoke: minimal startup check](#1-smoke-minimal-startup-check)
- [2. Bootstrap: colony growth to RCL3](#2-bootstrap-colony-growth-to-rcl3)
- [3. Defense: colony with tower](#3-defense-colony-with-tower)
- [4. Defense variation: same colony without tower](#4-defense-variation-same-colony-without-tower)
- [5. Multi-room: main + reserve](#5-multi-room-main--reserve)
- [6. Metrics: multi-room time-series](#6-metrics-multi-room-time-series)
- [7. onTick + events + registerEvent](#7-ontick--events--registerevent)
- [8. memoryOverrides and direct DB access](#8-memoryoverrides-and-direct-db-access)
- [9. Profiling](#9-profiling)
- [10. Multiple worlds in one scenario](#10-multiple-worlds-in-one-scenario)

## 1. Smoke: minimal startup check

Reference file: `examples/scenarios/smoke-empty.scenario.js`

**When to use:** verify that the framework starts and the bot doesn't crash.

**Introduces:** `createWorld`, `world.run()`, basic assertions.

```javascript
const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      controller: spec.controller({ level: 1 }),
      sources: [spec.source(15, 15), spec.source(35, 35)],
      structures: [spec.spawn(25, 25)],
    },
  ],
  bots: [{ username: 'bot', rooms: ['W0N1'] }],
  ticks: 30,
});

await world.run();
assertBotWorked(world.report);
assertNoErrors(world.report);
```

## 2. Bootstrap: colony growth to RCL3

Reference file: _not in the framework repository_ `[example from personal bot]`

**Introduces:** stop by condition (`until.predicate`), RCL checking.

```javascript
const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      controller: spec.controller({ level: 2 }),
      sources: [spec.source(15, 15), spec.source(35, 35)],
      structures: [spec.spawn(25, 25)],
    },
  ],
  bots: [{ username: 'bot', rooms: ['W0N1'] }],
  ticks: maxTicks,
  until: {
    maxTicks,
    predicate: async (w) => {
      const mem = await w.readMemory('bot');
      return mem.rooms?.W0N1?.controller?.level >= 3;
    },
  },
});
```

> `predicate` reads RCL from Memory — the structure of `Memory` depends on your
> bot. `[example from personal bot]`

## 3. Defense: colony with tower

Reference file: _not in the framework repository_ `[example from personal bot]`

**Introduces:** room fixture + memory fixture, runtime spawn, event-driven
completion.

```javascript
const world = await createWorld({
  rooms: [{ name: ROOM_NAME, roomFixture: 'rcl3-stable' }],
  bots: [{ username: 'bot', rooms: [ROOM_NAME] }],
  memory: 'rcl3-stable',
  ticks: maxTicks,
  until: {
    maxTicks,
    predicate: async (w) => {
      const events = await w.eventLog(ROOM_NAME);
      return events.some((e) => e.event === EVENT_OBJECT_DESTROYED);
    },
  },
});

await world.spawnCreep(spec.dummyTarget(10, 10, { roomName: ROOM_NAME }));
await world.tick(10);
await world.spawnCreep(spec.invader(40, 40, { roomName: ROOM_NAME }));
await world.tick(maxTicks - 10);

assertBotWorked(world.report);
assertNoBotObjectDestroyed(world.report);
```

> `rcl3-stable` is an example fixture name; fixtures are not shipped with the package.

## 4. Defense variation: same colony without tower

**Introduces:** `roomOverrides`.

```javascript
const world = await createWorld({
  rooms: [
    {
      name: ROOM_NAME,
      roomFixture: 'rcl3-stable',
      roomOverrides: {
        exclude: ['tower'],
        controller: { safeMode: 20000 },
        structures: [spec.extension(27, 24, { id: '53fca45601fe9dd', energy: 200 })],
      },
    },
  ],
  bots: [{ username: 'bot', rooms: [ROOM_NAME] }],
  memory: 'rcl3-stable',
});
```

## 5. Multi-room: main + reserve

**Introduces:** multiple rooms, per-bot memory map, explicit `userId` in multi-bot.

```javascript
const world = await createWorld({
  rooms: [
    { name: 'W0N1', roomFixture: 'rcl3-stable' },
    {
      name: 'W0N2',
      controller: spec.controller({ level: 4 }),
      sources: [spec.source(20, 20)],
      // userId explicit - otherwise defaultBotUserId
      structures: [spec.container(5, 5, { userId: 'reserveBot' }), spec.spawn(25, 25, { userId: 'reserveBot' })],
    },
  ],
  bots: [
    { username: 'mainBot', rooms: ['W0N1'] },
    { username: 'reserveBot', rooms: ['W0N2'] },
  ],
  memory: {
    mainBot: 'rcl3-stable',
    reserveBot: { colonies: { W0N2: { stage: 'reserve' } } },
  },
  ticks: 100,
});

await world.run();
```

> With `rooms` each bot now automatically owns structures in its claimed rooms.
> More details — [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md).

## 6. Metrics: multi-room time-series

Reference file: `examples/scenarios/metrics-multi-room.scenario.js`

**Introduces:** metric collection, `MetricsReport` / `MetricsAssert` classes, aggregation,
CSV export, regression comparison.

```javascript
const { MetricsAssert } = require('screeps-integration-tests/metric-assertions');
const { MetricsReport, MetricsRegression } = require('screeps-integration-tests/metrics');

const world = await createWorld({
  rooms: [
    { name: 'W0N1', controller: spec.controller({ level: 2 }), sources: [spec.source(15, 15)] },
    { name: 'W0N2', controller: spec.controller({ level: 1 }), sources: [spec.source(20, 20)] },
  ],
  bots: [{ username: 'bot', rooms: ['W0N1'] }],
  ticks: 10,
  metrics: { every: 1, rooms: true },
});

await world.run();

const report = world.report;
const m = report.metrics; // MetricsReport — all methods on a single object

// Rooms are independent — each has its own time-series
const ma = new MetricsAssert(m);
ma.latestAtLeast('rooms', 'W0N1', 'rcl', 2);
ma.latestAtLeast('rooms', 'W0N1', 'energyCapacity', 300);
ma.latestAtLeast('rooms', 'W0N2', 'rcl', 1);

// Snapshot of all rooms at a specific tick
const snapshot = m.snapshotAtTick('rooms', 5);
assert.ok(snapshot.W0N1 && snapshot.W0N2);

// Aggregation (average, sum, delta, rate) — single API for any entity
const r1 = m.room('W0N1');
console.log('avg RCL:', m.average(r1, 'rcl'));
// For bots (when implemented): m.average(m.bot('bot1'), 'cpu')

// CSV in one line (no separate import needed)
const csv = m.toCsv({ entityTypes: ['rooms'] });

// Regression: comparison with baseline
const baseline = MetricsReport.fromJSON(JSON.parse(require('fs').readFileSync('baseline.json', 'utf-8')));
const reg = new MetricsRegression(baseline);
const result = reg.compare(m, 'rooms', 'W0N1', 'rcl', { aggregator: 'average' });
console.log('regression:', result.passed ? 'OK' : 'REGRESSION', result.delta);
```

## 7. onTick + events + registerEvent

**Introduces:** `onTick` callback, declarative `events`, custom
`registerEvent`.

```javascript
let spawned = false;

const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      controller: spec.controller({ level: 3 }),
      sources: [spec.source(15, 15)],
      structures: [spec.spawn(25, 25), spec.tower(26, 24)],
    },
  ],
  bots: [{ username: 'bot', rooms: ['W0N1'] }],
  ticks: 100,
  events: [{ atTick: 20, action: 'spawnInvader', room: 'W0N1', params: { x: 40, y: 40 } }],
  onTick: async (world, tick) => {
    if (tick === 30) {
      await world.spawnCreep(spec.creep(25, 25, { roomName: 'W0N1', name: 'Defender' }));
      spawned = true;
    }
  },
});

// Custom handler: fills tower energy to maximum
world.registerEvent('boostTower', async (server, room, params) => {
  const { db } = server.common.storage;
  const tower = await db['rooms.objects'].findOne({ room, type: 'tower' });
  if (tower) {
    await db['rooms.objects'].update({ _id: tower._id }, { $set: { store: { energy: tower.storeCapacityResource?.energy || 1000 } } });
  }
});

await world.run();
assert.ok(spawned);
```

> `world.spawnCreep()` creates a creep in the DB, but your bot code must control it

## 8. memoryOverrides and direct DB access

**Introduces:** `memoryOverrides`, per-bot memory map, `world.server.common.storage.db`.

```javascript
const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      controller: spec.controller({ level: 2 }),
      sources: [spec.source(15, 15)],
      structures: [spec.spawn(25, 25)],
    },
  ],
  bots: [{ username: 'bot', rooms: ['W0N1'] }],
  memory: 'baseline',
  memoryOverrides: {
    bot: {
      flags: { testMode: true },
      colonies: { W0N1: { spawnQueue: ['harvester'] } },
    },
  },
  ticks: 10,
});

await world.run();

const { db } = world.server.common.storage;
const creeps = await db['rooms.objects'].find({ room: 'W0N1', type: 'creep' });
console.log(`spawned ${creeps.length} creeps`);
```

> `memoryOverrides` is deep-merged on top of `memory`. Arrays and primitives
> are replaced, plain objects are merged recursively.

## 9. Profiling

**Introduces:** `profiling: true`, reading `report.profileCallgrind`.

```javascript
const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      controller: spec.controller({ level: 2 }),
      sources: [spec.source(15, 15)],
      structures: [spec.spawn(25, 25)],
    },
  ],
  bots: [{ username: 'bot', rooms: ['W0N1'] }],
  ticks: 100,
  profiling: true,
});

await world.run();

const callgrind = world.report.profileCallgrind?.bot;
if (callgrind) {
  console.log('Profile captured');
}
```

> Requires that the bot project has `screeps-profiler` installed and
> `loop` is wrapped via `profiler.wrap()`. See details in
> [API-REFERENCE.md](./API-REFERENCE.md#12-profiling).

## 10. Multiple worlds in one scenario

**Introduces:** block-scoped subtests in one file, reuse of room
and bot constants, subtest isolation (each has its own `createWorld` +
`try/finally`).

**Reference files:**

- `examples/scenarios/world-spawn.scenario.js`
- `examples/scenarios/world-lifecycle.scenario.js`

```javascript
const ROOM = 'W0N1';
const BASE_ROOM = {
  name: ROOM,
  controller: spec.controller({ level: 1 }),
  sources: [spec.source(15, 15)],
  structures: [spec.spawn(25, 25)],
};
const BOT_SPEC = [{ username: 'bot', rooms: [ROOM] }];

async function run(opts = {}) {
  // ─── Test 1 ─────────────────────────────────────
  {
    const world = await createWorld({
      rooms: [BASE_ROOM],
      bots: BOT_SPEC,
      ticks: 10,
    });
    try {
      await world.run();
      // ...assertions...
    } finally {
      await world.dispose();
    }
  }

  // ─── Test 2 ─────────────────────────────────────
  {
    const world = await createWorld({
      rooms: [BASE_ROOM],
      bots: BOT_SPEC,
      ticks: 20,
      until: { maxTicks: 15 },
    });
    try {
      await world.tick(5);
      await world.spawnCreep(spec.invader(40, 40, { roomName: ROOM }));
      await world.run();
      // ...assertions...
    } finally {
      await world.dispose();
    }
  }
}
```

> **Key rules**:
>
> - Each subtest **must** be in its own block-scoped `{ }` block with
>   its own `createWorld` and `try/finally dispose`.
> - Without `dispose`, the mockup server leaks between subtests.
> - Constants are reused; per-test variations via copying / spread.

## Related documents

- [GETTING-STARTED.md](./GETTING-STARTED.md) — quick start
- [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md) — fixtures
- [API-REFERENCE.md](./API-REFERENCE.md) — full API
- [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md) — multi-room
