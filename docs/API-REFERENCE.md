# API Reference

Complete reference for the public API of `screeps-integration-tests`. Other
documents reference this one; duplication is kept to a minimum.

## Table of Contents

- [1. Main entry point: createWorld](#1-main-entry-point-createworld)
- [2. WorldInstance](#2-worldinstance)
- [3. Spec constructors](#3-spec-constructors)
- [4. Materialize](#4-materialize)
- [5. Room fixtures API](#5-room-fixtures-api)
- [6. Memory fixtures API](#6-memory-fixtures-api)
- [7. Assertions API](#7-assertions-api)
- [8. Metrics API](#8-metrics-api)
- [9. onTick, events and registerEvent](#9-ontick-events-and-registerevent)
- [10. Direct database access](#10-direct-database-access)
- [11. report](#11-report)
- [12. Profiling](#12-profiling)
- [13. Timeout](#13-timeout)
- [14. Core types](#14-core-types)
- [15. Object modification and search helpers](#15-object-modification-and-search-helpers)

## 1. Main entry point: createWorld

`createWorld(opts)` creates a world: server, rooms, bots, objects, memory and
returns a `WorldInstance`.

### Minimal example

```javascript
const { createWorld, spec } = require('screeps-integration-tests');

const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      controller: spec.controller({ level: 2 }),
      sources: [spec.source(15, 15)],
      structures: [spec.spawn(25, 25)],
    },
  ],
  bots: [{ username: 'bot', rooms: 'W0N1' }],
  ticks: 100,
});
```

### Example with fixture and overrides

```javascript
const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      roomFixture: 'rcl3-stable',
      roomOverrides: {
        exclude: ['tower'],
        controller: { safeMode: 20000 },
      },
    },
  ],
  bots: [{ username: 'bot', rooms: 'W0N1' }],
  memory: 'rcl3-stable',
  ticks: 200,
});
```

> `rcl3-stable` is an example fixture name; fixtures are not shipped with the package,
> create your own. See [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md).

### createWorld options

| Option            | Type                             | Purpose                                                                                   |
| ----------------- | -------------------------------- | ----------------------------------------------------------------------------------------- |
| `rooms`           | `RoomSpecInput[]`                | Required, at least 1 room                                                                 |
| `bots`            | `BotInput[]`                     | Bots: `[{ username, rooms, x?, y?, modules?, logLevel?, profiling? }]`                    |
| `memory`          | `MemoryInput \| MemoryByBot`     | Initial Memory: string (fixture) or per-bot map                                           |
| `memoryOverrides` | `Object \| MemoryByBot`          | Deep-merge patches on top of `memory`; without base become initial memory                 |
| `ticks`           | `number=100`                     | Soft limit: only affects `world.run()`                                                    |
| `profiling`       | `boolean=false`                  | Enable callgrind profiling, see [Profiler](https://github.com/screepers/screeps-profiler) |
| `logLevel`        | `'all' \| 'error' \| 'warn'`     | Threshold for `report.logs` (default `'all'`)                                             |
| `maxConsoleLines` | `number=10000`                   | Total limit of `errors + warnings + logs` lines                                           |
| `metrics`         | `MetricsOpts`                    | `{ every, rooms }` (only `rooms` implemented)                                             |
| `until`           | `UntilOpts`                      | Hard stop condition                                                                       |
| `onTick`          | `(world, tick) => Promise<void>` | Callback on each tick, called after bot-tick and before predicate                         |
| `events`          | `EventSpec[]`                    | Declarative events by tick                                                                |

### UntilOpts

| Field       | Type       | Description                                                                                            |
| ----------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `maxTicks`  | `number`   | Hard limit. Respected by both `run()` and `tick()`. Not to be confused with `opts.ticks` (soft limit). |
| `predicate` | `Function` | `async (world) => boolean`. Checked every tick.                                                        |
| `signal`    | `string`   | Field name in bot Memory. If truthy — stop.                                                            |
| `signalBot` | `string`   | Bot to check `signal` on. If not specified — checks all.                                               |

### Memory and memoryOverrides

`memory` can be:

- a string — memory fixture name (single-bot shorthand);
- an object `{ fixture: 'name', ...overrides }`;
- an inline object;
- for multi-bot — must be a map `{ username: memoryInput }`.

```javascript
// single-bot
const world = await createWorld({
  bots: [{ username: 'bot', rooms: 'W0N1' }],
  memory: 'rcl3-stable',
});

// multi-bot
const world = await createWorld({
  bots: [
    { username: 'mainBot', rooms: 'W0N1' },
    { username: 'reserveBot', rooms: 'W0N2' },
  ],
  memory: {
    mainBot: 'rcl3-stable',
    reserveBot: { fixture: 'rcl3-stable', colonies: { W0N2: { stage: 'reserve' } } },
  },
  memoryOverrides: {
    mainBot: { flags: { defend: true } },
  },
});
```

`memoryOverrides` deep-merge over `memory`:

- plain objects are merged recursively;
- arrays and primitives are replaced;
  | `undefined` is ignored in patch (does not erase the field).

## 2. WorldInstance

`createWorld()` returns an object with the following methods and fields.

### Methods

| Method                                 | Purpose                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `world.run()`                          | Run the scenario until `opts.ticks` / `until.maxTicks` / predicate |
| `world.tick(n)`                        | Execute `n` ticks; respects `until.maxTicks`, ignores `opts.ticks` |
| `world.exec(code, username?)`          | Execute JS code in bot context                                     |
| `world.spawn(spec)`                    | Create a creep. See `SpawnSpecInput` (§14) for spec format.        |
| `world.createStructure(spec)`          | Create a structure via spec (see §Helpers)                         |
| `world.eventLog(room)`                 | Event log for the room for the current tick                        |
| `world.readMemory(username?)`          | Read bot Memory                                                    |
| `world.writeMemory(username, patch)`   | Deep-merge patch into bot Memory                                   |
| `world.registerEvent(action, handler)` | Register a handler for `opts.events`                               |
| `world.setTicksToDowngrade(room, n)`   | Set controller downgrade timer (see §Helpers)                      |
| `world.setHitsStructure(id, hits)`     | Set structure HP (see §Helpers)                                    |
| `world.damageHitsStructure(id, dmg)`   | Damage a structure (see §Helpers)                                  |
| `world.deleteStructure(id)`            | Delete a structure from DB (see §Helpers)                          |
| `world.find(query)` / `findOne`/…      | Search objects in `rooms.objects` (see §Helpers)                   |
| `world.dispose()`                      | Stop the server and remove the cache directory                     |

### Fields

| Field          | Purpose                            |
| -------------- | ---------------------------------- |
| `world.report` | Accumulated report (`WorldReport`) |
| `world.server` | `ScreepsServer` instance           |
| `world.bots`   | `Record<username, Bot>`            |
| `world.rooms`  | `Record<name, RoomStatus>`         |

### Examples

#### Step-by-step run

```javascript
await world.tick(10);
await world.spawn(spec.dummyTarget(10, 10, { roomName: ROOM_NAME }));
await world.tick(40);
```

#### Working with Memory

```javascript
const memory = await world.readMemory('bot');
await world.writeMemory('bot', { test: { enabled: true } });
```

#### Event log

```javascript
const { EVENT_OBJECT_DESTROYED } = require('screeps-integration-tests/events');
const events = await world.eventLog('W0N1');
const destroyed = events.some((e) => e.event === EVENT_OBJECT_DESTROYED);
```

### Details

#### `world.run()` / `world.tick(n)`

- `tick()` before `run()` counts toward the total limit: after `tick(3)`, calling `run()` will only run up to `opts.ticks`.
- A second `run()` after reaching `opts.ticks` or `until.maxTicks` **does not add** ticks — `stopReason` is already set.
- `tick(n)` after `run()` continues ticking (if no `until`), ignoring the soft limit `opts.ticks`.
- Both `run()` and `tick(n)` respect `until.maxTicks` — a hard limit that cannot be exceeded.

## 3. Spec constructors

```javascript
const { spec } = require('screeps-integration-tests');
```

`spec` — pure plain-object constructors. No database writes.

### Structures

| Function                           | Purpose               |
| ---------------------------------- | --------------------- |
| `spec.structure(type, x, y, opts)` | Universal constructor |
| `spec.spawn(x, y, opts)`           | Spawn                 |
| `spec.tower(x, y, opts)`           | Tower                 |
| `spec.extension(x, y, opts)`       | Extension             |
| `spec.container(x, y, opts)`       | Container             |
| `spec.storage(x, y, opts)`         | Storage               |
| `spec.road(x, y, opts)`            | Road                  |
| `spec.wall(x, y, opts)`            | Constructed wall      |
| `spec.rampart(x, y, opts)`         | Rampart               |

`opts` for structures:

- `roomName?: string`
- `userId?: string` — owner (explicit; no auto-defaults)
- `id?: string` — specific `_id` (for memory fixture)
- `name?: string` — name (for spawn)
- `energy?, energyCapacity?, storeCapacity?, hits?, hitsMax?, notifyWhenAttacked?`
- `overrides?: Object` — arbitrary additional fields

For types without a dedicated helper, use `spec.structure` with constants from
`screeps-integration-tests/constants`:

```javascript
const { STRUCTURE_RAMPART } = require('screeps-integration-tests/constants');
const rampart = spec.structure(STRUCTURE_RAMPART, 25, 25, { roomName: 'W0N1' });
```

### Sources and controller

```javascript
spec.source(15, 15, { roomName: 'W0N1', energy: 3000 });
spec.controller({ roomName: 'W0N1', level: 3, safeMode: 20000, userId: botId });
```

### Creeps

| Function                       | Purpose                 |
| ------------------------------ | ----------------------- |
| `spec.creep(x, y, opts)`       | Normal creep            |
| `spec.invader(x, y, opts)`     | Invader (`userId: '2'`) |
| `spec.dummyTarget(x, y, opts)` | Target dummy creep      |

### Custom specs via `overrides`

`spec.structure()` is the only constructor that supports arbitrary
custom fields via **nested** `overrides`.

```javascript
const { STRUCTURE_LAB } = require('screeps-integration-tests/constants');

const lab = spec.structure(STRUCTURE_LAB, 26, 26, {
  roomName: 'W0N1',
  userId: botId,
  // nested overrides — arbitrary fields
  overrides: { mineralType: 'X', mineralAmount: 3000 },
});
```

## 4. Materialize

`materialize*` is an internal layer that knows the DB schema. It is not usually called from
scenarios; `createWorld()` does it automatically. The public API does not export
materializers.

## 5. Room fixtures API

```javascript
const {
  getRoomFixture,
  hasRoomFixture,
  loadRoomFixture,
  applyRoomOverrides,
  registerRoomFixture,
} = require('screeps-integration-tests/room-fixtures');
```

A room fixture is a declarative description of a room. Register via
`registerRoomFixture` or auto-load from `roomFixturesDir` (see
[FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md)).

| Function                                 | Purpose                                |
| ---------------------------------------- | -------------------------------------- |
| `getRoomFixture(name)`                   | Get a fixture by name                  |
| `hasRoomFixture(name)`                   | Check if it exists                     |
| `loadRoomFixture(name)`                  | Load a fixture (returns `{ fixture }`) |
| `applyRoomOverrides(fixture, overrides)` | Apply overrides                        |
| `registerRoomFixture(name, fixture)`     | Register a fixture at runtime          |

## 6. Memory fixtures API

```javascript
const { loadFixture, hasFixture, saveFixture, deepMergeMemory } = require('screeps-integration-tests/memory-fixtures');
```

| Function                           | Purpose                            |
| ---------------------------------- | ---------------------------------- |
| `loadFixture(name)`                | Read `*.memory.json`               |
| `hasFixture(name)`                 | Check existence                    |
| `saveFixture(name, memory, opts?)` | Save a snapshot                    |
| `deepMergeMemory(target, ...src)`  | Deep-merge (plain objects recurse) |

## 7. Assertions API

```javascript
const {
  assertNoErrors,
  assertBotWorked,
  assertRclAtLeast,
  assertRclBelow,
  assertObjectDestroyed,
  assertObjectNoDestroyed,
  assertNoBotObjectDestroyed,
  assertObjectAttacking,
  assertObjectNotAttacking,
  assertObjectDamaged,
  assertObjectNotDamaged,
  assertBotUserDamaged,
  assertBotUserNotDamaged,
  assertBotUserAttacking,
  assertBotUserNotAttacking,
} = require('screeps-integration-tests/assertions');
```

| Category  | Function                                      | Purpose                         |
| --------- | --------------------------------------------- | ------------------------------- |
| Viability | `assertNoErrors(report)`                      | No errors in logs               |
| Viability | `assertBotWorked(report)`                     | Bot ran ticks, Memory not empty |
| RCL       | `assertRclAtLeast(report, room, n)`           | `RCL >= n`                      |
| RCL       | `assertRclBelow(report, room, n)`             | `RCL < n`                       |
| Destroyed | `assertObjectDestroyed(report, opts)`         | Object(s) destroyed             |
| Destroyed | `assertObjectNoDestroyed(report, opts)`       | Objects NOT destroyed           |
| Destroyed | `assertNoBotObjectDestroyed(report, opts)`    | Bot structures not destroyed    |
| Combat    | `assertObjectAttacking(report, objectId)`     | Attack occurred                 |
| Combat    | `assertObjectNotAttacking(report, objectId)`  | No attack occurred              |
| Combat    | `assertObjectDamaged(report, targetId)`       | Damage received                 |
| Combat    | `assertObjectNotDamaged(report, targetId)`    | No damage received              |
| Combat    | `assertBotUserDamaged(report, username)`      | Bot object took damage          |
| Combat    | `assertBotUserNotDamaged(report, username)`   | Bot objects did NOT take damage |
| Combat    | `assertBotUserAttacking(report, username)`    | Bot initiated an attack         |
| Combat    | `assertBotUserNotAttacking(report, username)` | Bot did NOT attack              |

## 8. Metrics API

Metrics are time-series data collected during a run. The architecture is uniform across
all entity types (`rooms`, `colonies`, `bots`, `world`): the methods for working with
series are the same, but **the set of fields differs per entity**. For example,
`rooms` has `rcl` and `energyAvailable`, `bots` will have `cpu` and `gcl`, etc.

Three classes form the pipeline:

| Class               | Sub-path              | Purpose                                   |
| ------------------- | --------------------- | ----------------------------------------- |
| `MetricsReport`     | `…/metrics`           | Storage, queries, aggregation, CSV export |
| `MetricsAssert`     | `…/metric-assertions` | Assertions on metric values               |
| `MetricsRegression` | `…/metrics`           | Comparison with baseline                  |

### Quick start

```javascript
const { MetricsAssert } = require('screeps-integration-tests/metric-assertions');
const { MetricsReport, MetricsRegression } = require('screeps-integration-tests/metrics');

const world = await createWorld({
  // …
  metrics: { every: 10, rooms: true },
});
await world.run();

const m = report.metrics; // MetricsReport

// Запросы (entityType = 'rooms' | 'colonies' | 'bots' | 'world')
const series = m.series('rooms', 'W0N1'); // универсальный доступ
const latest = m.latest('rooms', 'W0N1'); // последний сэмпл
// Краткие обёртки:
const same = m.room('W0N1'); // ≡ series('rooms', …)
const last = m.latestRoom('W0N1'); // ≡ latest('rooms', …)

// Агрегация (работает с любым числовым полем любой сущности)
m.average(series, 'rcl');
m.sum(series, 'energyAvailable');
m.delta(series, 'rclProgress');

// Assertions
const ma = new MetricsAssert(m);
ma.latestAtLeast('rooms', 'W0N1', 'rcl', 3);

// CSV
const csv = m.toCsv({ entityTypes: ['rooms'] });

// Regression
const baseline = MetricsReport.fromJSON(/* … */);
const reg = new MetricsRegression(baseline);
reg.compare(m, 'rooms', 'W0N1', 'rcl', { aggregator: 'average' });
```

### Metrics collection

```javascript
metrics: { every: 1, rooms: true }
```

| Field      | Type      | Purpose                                     |
| ---------- | --------- | ------------------------------------------- |
| `every`    | `number`  | Sampling interval in ticks (`0` — disabled) |
| `rooms`    | `boolean` | Collect room metrics (default `true`)       |
| `colonies` | `boolean` | **Not implemented** — throws an error       |
| `bots`     | `boolean` | **Not implemented** — throws an error       |
| `world`    | `boolean` | **Not implemented** — throws an error       |

### CSV export

```javascript
const csv = report.metrics.toCsv({ entityTypes: ['rooms'], metrics: ['rcl', 'energyAvailable'] });
```

The `toCsv()` method accepts the same options as `flatten()`: `entityTypes` for filtering
by entity type and `metrics` for filtering by metric names.

### Method reference

#### MetricsReport

Time-series metrics storage. The instance is available as `report.metrics`.

**Writing:**

| Method                                         | Purpose                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| `m.append(entityType, entityId, tick, values)` | Add a sample. `values` is a plain object with metric fields (not mutated). |

**Reading series:**

| Method                           | Purpose                                          |
| -------------------------------- | ------------------------------------------------ |
| `m.series(entityType, entityId)` | Get entity time-series. Empty `[]` if not found. |
| `m.room(roomName)`               | ≡ `series('rooms', roomName)`                    |
| `m.colony(colonyName)`           | ≡ `series('colonies', colonyName)`               |
| `m.bot(botName)`                 | ≡ `series('bots', botName)`                      |

**Reading latest sample:**

| Method                           | Purpose                            |
| -------------------------------- | ---------------------------------- |
| `m.latest(entityType, entityId)` | Latest sample or `undefined`.      |
| `m.latestRoom(roomName)`         | ≡ `latest('rooms', roomName)`      |
| `m.latestColony(colonyName)`     | ≡ `latest('colonies', colonyName)` |
| `m.latestBot(botName)`           | ≡ `latest('bots', botName)`        |

**Reading by tick:**

| Method                                 | Purpose                                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `m.atTick(entityType, entityId, tick)` | Sample exactly at tick `tick` or `undefined`. No interpolation.                                                       |
| `m.snapshotAtTick(entityType, tick)`   | Snapshot of all entities of a type at a tick: `{[entityId]: sample}`. Only for map-types (`rooms`/`colonies`/`bots`). |

**Aggregation:**

| Method                          | Purpose                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `m.values(series, metricName)`  | Array of `[{ tick, value }]` — only finite numbers.                                           |
| `m.average(series, metricName)` | Average over series or `undefined`.                                                           |
| `m.sum(series, metricName)`     | Sum over series.                                                                              |
| `m.delta(series, metricName)`   | Difference between last and first values. `undefined` if <2 samples.                          |
| `m.rate(series, metricName)`    | Average change per tick: `delta / tickDelta`. `undefined` if <2 samples or `tickDelta === 0`. |

**Export:**

| Method               | Purpose                                                                      |
| -------------------- | ---------------------------------------------------------------------------- |
| `m.flatten(opts?)`   | Flat array `[{entityType, entityId, tick, metric, value}]`.                  |
| `m.toCsvRows(opts?)` | Array of CSV strings (with header).                                          |
| `m.toCsv(opts?)`     | CSV string. `opts.entityTypes` — filter by types, `opts.metrics` — by names. |

**Serialization:**

| Method                         | Purpose                                       |
| ------------------------------ | --------------------------------------------- |
| `m.toJSON()`                   | Plain object for `JSON.stringify`.            |
| `MetricsReport.fromJSON(json)` | Restore from JSON (e.g., baseline from file). |

**Getters (for backward compatibility with `report.metrics.rooms` etc.):**

| Getter       | Type                     |
| ------------ | ------------------------ |
| `m.rooms`    | `{[roomName]: series}`   |
| `m.colonies` | `{[colonyName]: series}` |
| `m.bots`     | `{[botName]: series}`    |
| `m.world`    | `MetricSeries` (flat)    |

#### MetricsAssert

Assertion helpers for metrics (see `screeps-integration-tests/metric-assertions`).

Constructor: `new MetricsAssert(metricsReport)`.

| Method                                                         | Purpose                                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------------- |
| `ma.hasSamples(entityType, entityId)`                          | At least one sample exists for the entity.                        |
| `ma.latestAtLeast(entityType, entityId, metricName, expected)` | Latest value ≥ `expected`.                                        |
| `ma.latestBelow(entityType, entityId, metricName, expected)`   | Latest value < `expected`.                                        |
| `ma.reached(entityType, entityId, metricName, expected)`       | Metric reached `expected` at least once over the entire series.   |
| `ma.monotonic(entityType, entityId, metricName)`               | Metric is monotonically non-decreasing (for cumulative counters). |

```javascript
const { MetricsAssert } = require('screeps-integration-tests/metric-assertions');
const ma = new MetricsAssert(report.metrics);
ma.hasSamples('rooms', 'W0N1');
ma.latestAtLeast('rooms', 'W0N1', 'rcl', 3);
ma.latestBelow('rooms', 'W0N1', 'rclProgress', 1_000_000);
ma.reached('rooms', 'W0N1', 'energyAvailable', 2000);
ma.monotonic('rooms', 'W0N1', 'rcl');
```

#### MetricsRegression

Comparison with a baseline report.

Constructor: `new MetricsRegression(baselineMetricsReport)`.

| Method                                                                | Purpose                       |
| --------------------------------------------------------------------- | ----------------------------- |
| `reg.compare(currentReport, entityType, entityId, metricName, opts?)` | Compare metric with baseline. |

**CompareOpts:**

| Field               | Type                                  | Default     | Description                                      |
| ------------------- | ------------------------------------- | ----------- | ------------------------------------------------ |
| `aggregator`        | `'average'\|'latest'\|'sum'\|'delta'` | `'average'` | How to aggregate series before comparison.       |
| `tolerance`         | `number`                              | `0`         | Absolute tolerance.                              |
| `relativeTolerance` | `number`                              | `0`         | Relative tolerance (fraction, e.g. `0.05` = 5%). |
| `direction`         | `'increase'\|'decrease'\|'both'`      | `'both'`    | Regression direction.                            |
| `window`            | `{startTick?, endTick?}`              | —           | Tick window for comparison.                      |

**CompareResult:**

| Field           | Type      | Description               |
| --------------- | --------- | ------------------------- |
| `passed`        | `boolean` | Test passed.              |
| `actual`        | `number`  | Current aggregated value. |
| `expected`      | `number`  | Baseline value.           |
| `delta`         | `number`  | `actual - expected`.      |
| `relativeDelta` | `number`  | `delta / abs(expected)`.  |

```javascript
const { MetricsReport, MetricsRegression } = require('screeps-integration-tests/metrics');
const baseline = MetricsReport.fromJSON(/* loaded baseline */);
const reg = new MetricsRegression(baseline);
const result = reg.compare(report.metrics, 'rooms', 'W0N1', 'energyAvailable', {
  aggregator: 'average',
  direction: 'decrease',
  tolerance: 500,
});
if (!result.passed) {
  console.error(`Regression: ${result.actual} vs baseline ${result.expected}`);
}
```

### Room metrics fields (`rooms`)

Collected by the observer every `metrics.every` ticks. Field names are used
in aggregation methods, assertions, and CSV export.

| Field             | Type                      | Description                                    |
| ----------------- | ------------------------- | ---------------------------------------------- |
| `rcl`             | `number`                  | Controller level (0–8).                        |
| `rclProgress`     | `number`                  | Progress to the next level.                    |
| `energyAvailable` | `number`                  | Energy in spawns + extensions.                 |
| `energyCapacity`  | `number`                  | Total capacity of spawns and extensions.       |
| `spawnCount`      | `number`                  | Number of spawns in the room.                  |
| `spawnHits`       | `{name, hits, hitsMax}[]` | HP of each spawn.                              |
| `towerCount`      | `number`                  | Number of towers.                              |
| `towerEnergy`     | `number`                  | Total energy in towers.                        |
| `towerCapacity`   | `number`                  | Total capacity of towers.                      |
| `extensionCount`  | `number`                  | Number of extensions.                          |
| `creepCount`      | `number`                  | Total number of creeps in the room.            |
| `creepsByRole`    | `{[role]: count}`         | Creeps by role (from name: `role_N` → `role`). |
| `storageEnergy`   | `number`                  | Energy in storage.                             |
| `containerEnergy` | `number`                  | Total energy in containers.                    |
| `totalHits`       | `number`                  | Total HP of all room objects.                  |

> `creepsByRole` in CSV expands into separate columns `creepsByRole.<role>`.

## 9. onTick, events and registerEvent

### onTick

Called every tick **after** bot-tick execution, event log collection,
metrics and declarative events, but **before** the predicate check.

Signature: `async (world, tick) => void`, where `world` is the full
`WorldInstance`, `tick` is 0-based tick number.

```javascript
const world = await createWorld({
  // ...
  onTick: async (world, tick) => {
    if (tick === 50) {
      await world.spawn(spec.invader(40, 40, { roomName: 'W0N1' }));
    }
    const mem = await world.readMemory('bot');
    if (mem.emergencyStop) {
      // predicate will trigger on the next step
    }
  },
});
```

### opts.events

Declarative events by tick. Processed before `onTick`.

```javascript
const world = await createWorld({
  // ...
  events: [
    { atTick: 10, action: 'spawnInvader', params: { x: 40, y: 40, room: 'W0N1' } },
    { atTick: 20, action: 'spawnCreep', params: { room: 'W0N1', x: 25, y: 25, userId: botId, name: 'Defender' } },
  ],
});
```

`EventSpec`:

| Field    | Type     | Description                                  |
| -------- | -------- | -------------------------------------------- |
| `atTick` | `number` | 0-based tick number                          |
| `action` | `string` | Name of the registered handler               |
| `params` | `Object` | Parameters; for `spawn*` needs `params.room` |
| `room`   | `string` | Target room (passed to handler)              |

### registerEvent

Registers a custom event handler.

```javascript
world.registerEvent('healAll', async (server, room, params) => {
  const { db } = server.common.storage;
  const creeps = await db['rooms.objects'].find({ room, type: 'creep' });
  for (const creep of creeps) {
    await db['rooms.objects'].update({ _id: creep._id }, { $set: { hits: creep.hitsMax } });
  }
});
```

Handler: `async (server, room, params) => void`.

Built-in events: `spawnInvader`, `spawnCreep`.

## 10. Direct database access

`world.server.common.storage.db` — Loki-style collections of the mockup server.

```javascript
const { db } = world.server.common.storage;

// All room objects
const objects = await db['rooms.objects'].find({ room: 'W0N1' });

// Only towers
const towers = await db['rooms.objects'].find({ room: 'W0N1', type: 'tower' });

// Single object
const controller = await db['rooms.objects'].findOne({ room: 'W0N1', type: 'controller' });
```

````

Use when the public API is insufficient.

## 11. report

`world.report` accumulates:

| Field         | Type        | Contents                                                              |
| ------------- | ----------- | --------------------------------------------------------------------- |
| `ticksRun`    | `number`    | Number of ticks executed                                             |
| `errors`      | `string[]`  | Lines with `[ERROR]` or matching `ERROR_PATTERNS` (ReferenceError etc.) |
| `warnings`    | `string[]`  | Lines with `[WARN]`                                                  |
| `logs`        | `string[]`  | Lines depending on `logLevel` (default `'all'`)                       |
| `events`      | `Object[]`  | Accumulated event-log entries with `tick`                             |
| `finalRcl`    | `Object`    | `{ [roomName]: number }`                                             |
| `finalMemory` | `Object`    | `{ [username]: Memory }`                                             |
| `metrics`     | `Object`    | `{ rooms, colonies, bots, world }`                                   |
| `wallClockMs` | `number`    | Wall clock time of the run                                           |
| `stopReason`  | `string`    | Stop reason (`maxTicks`, `predicate`, `signal`, ...)                  |

Parsing example:

```javascript
for (const line of world.report.errors) {
  if (line.includes('TypeError')) {
    throw new Error('Bot crashed with TypeError');
  }
}
````

> `errors`/`warnings`/`logs` are raw strings without tick binding. If you need
> per-tick information — use `report.events` or `onTick`.

## 12. Profiling

```javascript
const world = await createWorld({
  // ...
  profiling: true,
});
```

Requirements:

1. The bot project has `screeps-profiler` installed:
   `npm install --save-dev screeps-profiler`
2. The bot's `main.js` is wrapped:

```javascript
const profiler = require('screeps-profiler');
profiler.enable();
module.exports.loop = profiler.wrap(function () {
  // bot logic
});
```

With `--profiling` the framework:

- tick 0 — initialization;
- tick 1 — arm profiling;
- tick 2+ — data collection;
- after the run — one extra tick for finalization.

CLI saves `report.profileCallgrind` to
`<profilesDir>/<scenario>-<username>-<timestamp>.callgrind`.

> See the [Profiler](https://github.com/screepers/screeps-profiler) repository

## 13. Timeout

Timeout is set **per scenario**:

- in config: `timeout: 30 * 60 * 1000` (default 30 min);
- in CLI: `--timeout N` (milliseconds).

If a scenario doesn't finish in time — the worker receives `SIGKILL`. There is no global timeout for
the entire run.

## 14. Core types

Below is a summary of key types. Full JSDoc definitions — in `src/lib/types.js`.

### RoomSpecInput

```typescript
{
    name: 'W0N1',
    roomFixture?: 'rcl3-stable' | object,
    roomOverrides?: { exclude, controller, structures, append, hostiles, creeps },
    controller?,           // inline
    sources?,
    structures?,
    creeps?,
    hostiles?,
}
```

### BotInput

```typescript
{
    username: 'bot',
    rooms: 'W0N1',        // string | string[] — one or more rooms
    x?: 25, y?: 25,
    modules?: object,     // custom modules (default = from dist/)
    logLevel?: 'all'|'error'|'warn',
    profiling?: boolean,
}
```

### SpawnSpecInput

```typescript
{
    roomName: string,            // required
    x: number,
    y: number,
    name?: string,               // if not specified — generated
    body: { type: string, hits: number }[],  // required
    userId?: string,             // fallback to first bot if not specified
    hits?: number,               // default is sum of body hits
    hitsMax?: number,            // default is hits
    energy?: number,
    energyCapacity?: number,
    overrides?: Object,          // arbitrary fields for materializer
}
```

`spawn()` accepts both a plain object of this format and the result of
`spec.creep()`, `spec.invader()` or `spec.dummyTarget()` — all of them
return a compatible `SpawnSpecInput`.

### WorldReport

```typescript
{
    ticksRun: 50,
    finalRcl: { W0N1: 3, W0N2: 1 },
    errors: [],
    warnings: [],
    logs: [],
    events: [{ tick, event, objectId, ... }],
    finalMemory: { bot: { /* Memory */ } },
    wallClockMs: 1200,
    metrics: {
        rooms: { W0N1: [{ tick, rcl, energyAvailable, ... }] },
        colonies: {},
        bots: {},
        world: [],
    },
    stopReason: 'predicate',
}
```

### MetricsOpts

```typescript
{
    every?: number,       // sampling interval (0 = disabled, default 0)
    rooms?: boolean,      // collect room metrics (default true)
    colonies?: boolean,   // not yet supported — throws an error
    bots?: boolean,       // not yet supported — throws an error
    world?: boolean,      // not yet supported — throws an error
}
```

### MetricEntityType

```typescript
type MetricEntityType = 'rooms' | 'colonies' | 'bots' | 'world';
```

### MetricsSample

```typescript
{
    tick: number,                      // tick number
    // ... arbitrary metric fields (rcl, energyAvailable, ...)
}
```

### RoomMetrics

Room metrics sample fields (without `tick`):

```typescript
{
    rcl: number,
    rclProgress: number,
    energyAvailable: number,
    energyCapacity: number,
    spawnCount: number,
    spawnHits: { name: string, hits: number, hitsMax: number }[],
    towerCount: number,
    towerEnergy: number,
    towerCapacity: number,
    extensionCount: number,
    creepCount: number,
    creepsByRole: { [role: string]: number },
    storageEnergy: number,
    containerEnergy: number,
    totalHits: number,
}
```

### CompareOpts (MetricsRegression)

```typescript
{
    aggregator?: 'average' | 'latest' | 'sum' | 'delta',  // default 'average'
    tolerance?: number,                                      // default 0
    relativeTolerance?: number,                              // default 0
    direction?: 'increase' | 'decrease' | 'both',           // default 'both'
    window?: { startTick?: number, endTick?: number },
}
```

### CompareResult (MetricsRegression)

```typescript
{
    passed: boolean,
    actual?: number,
    expected?: number,
    delta?: number,
    relativeDelta?: number,
}
```

## 15. Object modification and search helpers

Methods available on `WorldInstance`. Work directly with Screeps DB `db['rooms.objects']`.

### Controller

| Method                                       | Description                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `world.setTicksToDowngrade(roomName, ticks)` | Set `downgradeTime = gameTime + ticks`. `ticks >= 0` or `null` to reset. |

```javascript
await world.setTicksToDowngrade('W0N1', 4000);
await world.setTicksToDowngrade('W0N1', null); // reset timer
```

### Structures

| Method                                          | Description                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| `world.setHitsStructure(idOrObject, hits)`      | Set HP. `hits >= 0`, clamped to `hitsMax`.                             |
| `world.damageHitsStructure(idOrObject, amount)` | Subtract `amount` from HP (not below 0).                               |
| `world.deleteStructure(idOrObject)`             | Delete structure from `rooms.objects` directly (no event log).         |
| `world.createStructure(spec)`                   | Create a structure from a spec object. `userId` defaults to first bot. |

The `idOrObject` argument can be:

- a string (`_id`);
- an object with `_id` or `id` field (e.g., a document from `world.find`).

```javascript
const wallId = await world.createStructure(spec.wall(10, 20, { roomName: 'W0N1', hits: 500000 }));
await world.damageHitsStructure(wallId, 100);
await world.damageHitsStructure({ id: wallId }, 50);
await world.setHitsStructure(wallId, 2000);

// direct deletion
await world.deleteStructure(wallId);
```

### Object search

Universal methods instead of direct access to `db['rooms.objects'].find(...)`.

| Method                        | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| `world.find(query)`           | Array of documents (with field `id` = `_id`).      |
| `world.findOne(query, opts?)` | First document or `null`. `opts.index` — Nth item. |
| `world.findIds(query)`        | Array of `_id`.                                    |
| `world.findId(query, opts?)`  | `_id` of first or `null`. `opts.index` — Nth.      |

`query` fields:

- `room`, `type`, `name`, `x`, `y` — as in DB.
- `userId` — automatically mapped to DB field `user`.
- `id` — mapped to `_id`.

```javascript
const { STRUCTURE_TOWER } = require('screeps-integration-tests/constants');

// All towers in the room
const towers = await world.find({ room: 'W0N1', type: STRUCTURE_TOWER });

// First tower
const tower = await world.findOne({ room: 'W0N1', type: STRUCTURE_TOWER });

// _id of the first tower
const towerId = await world.findId({ room: 'W0N1', type: STRUCTURE_TOWER });

// _id of the first source (index=0)
const sourceId = await world.findId({ room: 'W0N1', type: 'source' }, { index: 0 });
```

## Related documents

- [GETTING-STARTED.md](./GETTING-STARTED.md) — quick start
- [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md) — fixtures in detail
- [EXAMPLES.md](./EXAMPLES.md) — reference scenarios
- [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md) — multi-room + multi-bot
- [INTEGRATION-TESTS.md](./INTEGRATION-TESTS.md) — architecture
