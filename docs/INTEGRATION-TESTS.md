# Integration Tests — Architecture Guide

This document describes the **architecture and internal mechanisms** of the framework from
a contributor's perspective. This is not a tutorial — practical guides are in
neighboring files:

- [README.md](../README.md) — documentation navigation
- [GETTING-STARTED.md](./GETTING-STARTED.md) — installation, running, first scenario
- [API-REFERENCE.md](./API-REFERENCE.md) — full public API reference
- [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md) — room fixtures, memory fixtures, overrides
- [EXAMPLES.md](./EXAMPLES.md) — reference scenarios and patterns
- [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md) — multiple rooms and bots

## Table of Contents

1. [Architecture: layers and responsibilities](#1-architecture-layers-and-responsibilities)
2. [Scenario lifecycle](#2-scenario-lifecycle)
3. [Runtime: multi-room + multi-bot](#3-runtime-multi-room--multi-bot)
4. [Stop condition (until)](#4-stop-condition-until)
5. [Observers](#5-observers)
6. [Child processes and data transfer](#6-child-processes-and-data-transfer)
7. [Memory isolation and cache management](#7-memory-isolation-and-cache-management)
8. [Profiling](#8-profiling)
9. [File structure](#9-file-structure)
10. [Best practices](#10-best-practices)
11. [Extending the framework](#11-extending-the-framework)

## 1. Architecture: layers and responsibilities

```
┌──────────────────────────────────────────────────────────────┐
│  bin/screeps-integration-tests.js                            │
│  CLI runner: flag parsing, worker pool, report               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  src/runScenario.js (child_process.fork)               │  │
│  │  Worker: prepare server → execute scenario.run         │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  scenario.run(opts)                              │  │  │
│  │  │  ┌────────────────────────────────────────────┐  │  │  │
│  │  │  │  createWorld(opts)                         │  │  │  │
│  │  │  │  ├─ prepareServer()                        │  │  │  │
│  │  │  │  │   └─ ScreepsServer + rooms + terrain    │  │  │  │
│  │  │  │  ├─ addBots()                              │  │  │  │
│  │  │  │  │   └─ users + code + console handlers    │  │  │  │
│  │  │  │  ├─ materializeRooms()                     │  │  │  │
│  │  │  │  ├─ server.start()                         │  │  │  │
│  │  │  │  └─ initializeBots()                       │  │  │  │
│  │  │  │                                            │  │  │  │
│  │  │  │  world.run() / world.tick(n)               │  │  │  │
│  │  │  │  ├─ doServerTick() + observeAllRooms()     │  │  │  │
│  │  │  │  ├─ dispatchEvents() (declarative)         │  │  │  │
│  │  │  │  ├─ onTick callback                        │  │  │  │
│  │  │  │  └─ checkStopCondition() → stop?           │  │  │  │
│  │  │  └────────────────────────────────────────────┘  │  │  │
│  │  │  assert*() → pass/fail                           │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

Seven layers:

| Layer             | Files                                                                                                                                                                     | Responsibility                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Config**        | `lib/config/config.js`, `lib/config/cli.js`                                                                                                                               | Config loading, CLI parsing                                                                                         |
| **Runtime**       | `lib/runtime/runtime.js`, `lib/runtime/port.js`, `lib/runtime/testBot.js`, `lib/runtime/cleanup.js`                                                                       | Server wrapper, ports, bots, lifecycle                                                                              |
| **Orchestration** | `lib/orchestration/world.js`, `lib/orchestration/worldHelpers.js`, `lib/orchestration/events.js`, `lib/orchestration/finalize.js`, `lib/orchestration/resolveDefaults.js` | `createWorld`, pipeline, imperative DB/bot helpers, event registry, report finalisation, default-resolution helpers |
| **Builders**      | `lib/builders/spec.js`, `lib/builders/materialize.js`, `lib/builders/memory.js`                                                                                           | Spec constructors and DB materialisation                                                                            |
| **Observers**     | `lib/observers/eventLog.js`, `lib/observers/metrics.js`, `lib/observers/ownership.js`, `lib/observers/predicate.js`                                                       | Stateless DB readers                                                                                                |
| **Assertions**    | `lib/assertions/assertions.js`, `lib/assertions/metricAssertions.js`, `lib/assertions/metricRegression.js`                                                                | Bot behaviour assertions                                                                                            |
| **Fixtures**      | `lib/fixtures/roomFixture.js`                                                                                                                                             | Room fixture registry                                                                                               |

### Separation in builders

| Layer         | File                      | Knowledge                            | Purpose                       |
| ------------- | ------------------------- | ------------------------------------ | ----------------------------- |
| `spec`        | `builders/spec.js`        | Object defaults, `roomName`/`userId` | Pure spec-object constructors |
| `materialize` | `builders/materialize.js` | Mockup server DB schema              | Only layer that writes to DB  |

> **Important:** knowledge of the DB schema lives **only** in `materialize`. Scenarios and
> `createWorld()` use it as the only channel for writing to the DB.
>
> **Default resolution helpers:** centralized in `orchestration/resolveDefaults.js` (`resolveDefaultUserId`, `defaultBot`).
> Spec constructors do **not** assign default userId — that is an orchestration-layer concern.

### Separation in observers

| Layer     | File                     | Purpose                             |
| --------- | ------------------------ | ----------------------------------- |
| eventLog  | `observers/eventLog.js`  | Reading and filtering events        |
| metrics   | `observers/metrics.js`   | Collecting game data (room metrics) |
| predicate | `observers/predicate.js` | Checking stop conditions            |
| ownership | `observers/ownership.js` | Tracking object owners              |

Observers only read the DB and return data. They do not mutate state.

### Metrics separation

| Layer      | File                                 | Purpose                                      |
| ---------- | ------------------------------------ | -------------------------------------------- |
| Observer   | `observers/metrics.js`               | Reading world state, returning `RoomMetrics` |
| Recorder   | `lib/assertions/metricsReport.js`    | Writing samples to `report.metrics`          |
| Query      | `lib/assertions/metricsReport.js`    | Reading series, aggregation                  |
| Assertions | `lib/assertions/metricAssertions.js` | Assertions based on time-series              |
| Export     | `lib/assertions/metricsReport.js`    | Conversion to CSV (`toCsv()`)                |
| Regression | `lib/assertions/metricRegression.js` | Comparison of current vs baseline            |

### Constants

`src/constants/screepsConstants.js` contains Screeps game constants
(`STRUCTURE_*`, body parts, `RESOURCE_ENERGY`, `FIND_*`, error codes, etc.).
Used by spec constructors, assertions, and metrics to avoid depending on
the mockup server's global environment.

## 2. Scenario lifecycle

```
1. createWorld(opts)
   ├─ prepareServer()            ← ScreepsServer + rooms + terrain
   ├─ addBots()                  ← users + code + memory + console
   ├─ buildCanonicalRoom()       ← spec + fixture + overrides
   ├─ materializeRoom per room   ← controller / sources / structures / creeps / hostiles
   ├─ server.start()
   ├─ setBotMemory per bot       ← memory fixture (per username)
   └─ install console handlers   ← per bot

2. world.run() / world.tick(n)
   ├─ for each tick:
   │   ├─ server.tick()
   │   ├─ for each room:
   │   │   ├─ readEventLog → accumulate → report.events
   │   │   ├─ snapshotOwners → mergeOwners
   │   │   └─ collectMetrics → sampleMetrics → report.metrics.rooms
   │   ├─ events (declarative spawns)
   │   ├─ onTick callback
   │   ├─ predicate check → shouldStop?
   │   └─ break if shouldStop

3. finalize()
   ├─ finalMemory per bot
   ├─ finalRcl per room
   ├─ profileText / profileCallgrind per bot
   └─ wallClockMs

4. assert*()
5. world.dispose()               ← mandatory in finally
```

### Tick semantics

Ticks are numbered from 0. The bot executes every tick, starting from the first.
Metrics, `eventLog` and `predicate` are collected every tick (or with
period `metrics.every` for metrics).

Tick semantics for the profiler are described in §8.

## 3. Runtime: multi-room + multi-bot

The runtime is split into three independent phases:

- `prepareServer({ rooms, cacheDir })` — starts `ScreepsServer`, creates
  rooms and terrain. **Does not create** controllers, bots or spawns. All room
  objects are created later via `materializeRoom`.
- `addBots({ server, bots, distDir, profiling })` — custom implementation
  for adding bots. Creates a user, empty memory, loads code,
  subscribes to console. Does not touch controller/spawn.
- `materializeRoom(server, canonical)` — creates all room objects from
  the canonical specification.

`createRuntime` is a thin facade: prepareServer → addBots → start.

**Module decomposition:**

- `getFreePort()` → `src/lib/runtime/port.js` — network utility, reusable outside runtime.
- `TestBot` class → `src/lib/runtime/testBot.js` — EventEmitter-based bot with console subscription.
- `waitForProcessExit()` + `createDispose()` → `src/lib/runtime/cleanup.js` — process lifecycle.
- `lib/runtime/runtime.js` now contains only `prepareServer`, `addBots`, `addBot`, `prepareRoom`, `createRuntime`.

```js
// Full pipeline (createWorld) — internal functions, not exported to public API.
// In scenarios, use createWorld().
const prepared = await prepareServer({ rooms, cacheDir });
const { bots } = await addBots({ server: prepared.server, bots, distDir });
const canonical = await buildCanonicalRoom(roomInput, roomName, bots['bot'].id);
const ids = await materializeRoom(server, canonical);
await server.start();
```

### Contract

- `rooms` — array of `RoomSpecInput[]` (name + spec/fixture + overrides);
- `bots` — array of `{ username, rooms, modules?, profiling? }`;
- per-bot profiling: `b.profiling ?? opts.profiling ?? false`.

More about multi-room modeling — [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md).

## 4. Stop condition (until)

```js
until: {
    maxTicks: 20000,
    predicate: async (w) => {
        const mem = await w.readMemory('mainBot');
        return mem.rooms?.W0N1?.controller?.level >= 3;
    },
}
```

The scenario completes when:

- `predicate` returned `true`, **or**
- `ticksRun >= maxTicks`, **or**
- `Memory[until.signal]` is truthy.

> **Important:** `until.maxTicks` is a **hard** limit: it is respected by both `run()` and
> `tick()`. `createWorld({ ticks })` is a **soft** limit, it only affects
> `run()`. If both are set, the test stops on whichever is reached first.

Predicate can be sync or async. If the predicate throws an error — the test
completes with that error.

## 5. Observers

| Layer     | File                     | Purpose                      |
| --------- | ------------------------ | ---------------------------- |
| eventLog  | `observers/eventLog.js`  | Reading and filtering events |
| metrics   | `observers/metrics.js`   | Collecting room metrics      |
| predicate | `observers/predicate.js` | Stop conditions              |
| ownership | `observers/ownership.js` | Tracking object owners       |

The event log is overwritten by the engine every tick, so
`accumulateEvents` is used to accumulate entries in `report.events[]`.

## 6. Child processes and data transfer

### Why `console.log` is visible in the scenario

Scenarios run in separate child processes (`child_process.fork` from
`src/runScenario.js`). Their `stdout`/`stderr` is inherited from the parent, so
`console.log` inside `.scenario.js` goes to the common output.

### Parallel execution

`bin/screeps-integration-tests.js` runs scenarios with a concurrency
limit (`--jobs <N>`, default `min(4, os.cpus().length)`). Each
scenario gets its own free storage port via `getFreePort()`,
so parallel runs don't conflict.

### Ways to transfer data

| Task                      | Method                                             |
| ------------------------- | -------------------------------------------------- |
| Bot error logs            | `report.errors`                                    |
| All bot logs              | `logLevel: 'all'` → `report.logs`                  |
| Final state               | `report.finalMemory[username]`                     |
| Tick-based data           | `onTick` + closure → `report.*`                    |
| Snapshot at specific tick | `world.readMemory(username)` in `onTick`           |
| DB object state           | `world.server.db` + closure                        |
| Profiler                  | `report.profileText` and `report.profileCallgrind` |
| Event log                 | `report.events`                                    |

## 7. Memory isolation and cache management

Each scenario runs in an isolated cache directory:

```
<cacheBase>/w-<timestamp>-<pid>
```

Example: `.cache/w-1700000000000-12345/`. This allows running scenarios
in parallel and avoids conflicts.

After a scenario completes, `world.dispose()` stops the server child processes,
waits for them to finish, and removes the cache directory. On timeout,
`bin/screeps-integration-tests.js` kills the entire process tree via
`tree-kill`.

`pruneCache` is an internal function, not exported to the public API.
Called automatically when CLI starts. It cleans up the `cacheDir`, keeping
the last `cacheKeep` directories (configurable in `screeps-integration.config.js`, default `./.cache`).

### Storage-singleton race

`@screeps/common/lib/storage.js` holds one TCP socket per process. When
multiple `createWorld` calls happen in a row in one scenario (e.g.,
`world-spawn` with 15 worlds), there is a narrow window between `dispose()`
and the next `server.start()` where the old socket is not yet closed and the
new storage process is not yet listening.

In practice it doesn't manifest: the 1-second reconnect in `storage.js`
(Screeps) + the duration of the `createWorld` pipeline cover the race.
Symptom — `Storage connection lost` in stderr (filtered in
`pipeChildStreams`). It does not affect results.

## 8. Profiling

`profiling: true` enables `screeps-profiler` via `lib/runtime/loadBot.js`. Data
goes into separate report fields:

- `report.profileText[username]` — profiler text output;
- `report.profileCallgrind[username]` — callgrind data.

For profiling to work, **the user's bot must install
`screeps-profiler` as a peer dependency** and wrap its `loop` via
`profiler.wrap()`:

```js
const profiler = require('screeps-profiler');
profiler.enable();
module.exports.loop = profiler.wrap(function () {
  // bot code
});
```

The framework only injects the necessary wrappers; if the package is not installed in
the bot's `dist/`, profiling will not work.

### CLI mode

```bash
npm run test:integration -- --profiling
```

When launching with the `--profiling` flag, CLI saves `report.profileCallgrind`
locally:

```
<profilesDir>/<scenario>-<username>-<timestamp>.callgrind
```

Open `.callgrind` with KCachegrind or a similar tool.

### Profiler tick semantics

- **Tick 0** — init;
- **Tick 1** — arm, bot starts executing;
- **Tick 2**+ — working measurements;
- **Final tick** — extra tick for final data collection.

See also [screeps-profiler](https://github.com/screepers/screeps-profiler).

## 9. File structure

```
screeps-integration-tests/
├── bin/
│   └── screeps-integration-tests.js   # CLI runner
├── src/
│   ├── index.js                       # Public API (createWorld, spec, buildCanonicalRoom)
│   ├── public/                        # Sub-path exports
│   │   ├── assertions.js              #   screeps-integration-tests/assertions
│   │   ├── constants.js               #   screeps-integration-tests/constants
│   │   ├── events.js                  #   screeps-integration-tests/events
│   │   ├── memory-fixtures.js         #   screeps-integration-tests/memory-fixtures
│   │   ├── metric-assertions.js       #   screeps-integration-tests/metric-assertions
│   │   ├── metrics.js                 #   screeps-integration-tests/metrics (MetricsReport + MetricsRegression)
│   │   ├── room-fixtures.js           #   screeps-integration-tests/room-fixtures
│   │   └── worldHelpers.js            #   screeps-integration-tests/world-helpers
│   ├── runScenario.js                 # Worker entry (fork target)
│   ├── constants/
│   │   └── screepsConstants.js        # Game constants for spec/assert/metric
│   ├── lib/
│   │   ├── types.js                   # Centralised JSDoc typedefs
│   │   ├── config/
│   │   │   ├── config.js              # Config loader
│   │   │   └── cli.js                 # CLI argument parser
│   │   ├── runtime/
│   │   │   ├── runtime.js             # ScreepsServer wrapper (prepareServer, addBots)
│   │   │   ├── port.js                # Free TCP port allocation
│   │   │   ├── testBot.js             # TestBot class (EventEmitter)
│   │   │   ├── cleanup.js             # pruneCache + waitForProcessExit + createDispose
│   │   │   ├── console.js             # Console capture
│   │   │   ├── loadBot.js             # Bot module loader + profiling inject
│   │   │   ├── profile.js             # saveCallgrind + exportProfiles
│   │   │   └── storageAdapter.js      # DB facade over screeps-server-mockup
│   │   ├── orchestration/
│   │   │   ├── world.js               # createWorld — orchestration lifecycle
│   │   │   ├── worldHelpers.js        # Imperative helpers (find, structures, controller, creeps, bots)
│   │   │   ├── events.js              # Event registry (createEventRegistry, dispatchEvents)
│   │   │   ├── finalize.js            # Report finalisation (finalizeReport)
│   │   │   └── resolveDefaults.js     # Pure helpers for default userId/bot resolution
│   │   ├── assertions/
│   │   │   ├── assertions.js          # Bot behaviour assertions
│   │   │   ├── metricAssertions.js    # Metrics assertions
│   │   │   ├── metricsReport.js       # Metrics recorder + query + CSV export
│   │   │   └── metricRegression.js    # Current vs baseline comparison
│   │   ├── builders/
│   │   │   ├── index.js               # Re-export surface
│   │   │   ├── spec.js                # Spec constructors
│   │   │   ├── materialize.js         # DB-aware layer (DRY: materializeMany)
│   │   │   └── memory.js              # Memory fixture load/save/merge
│   │   ├── fixtures/
│   │   │   └── roomFixture.js         # Room fixture registry
│   │   └── observers/
│   │       ├── eventLog.js            # Event log reader + filters
│   │       ├── metrics.js             # Room metrics collector
│   │       ├── ownership.js           # Owner snapshotting
│   │       └── predicate.js           # Stop condition (checkStopCondition)
│   └── tools/                         # CLI tools
│       ├── capture-fixture.js
│       └── clean-cache.js
├── tests/                             # Unit tests of the framework (Jest)
│   ├── assertions.test.js
│   ├── buildCanonicalRoom.test.js
│   ├── cli.test.js
│   ├── config.test.js
│   ├── console.test.js
│   ├── memory.test.js
│   ├── metricAssertions.test.js
│   ├── metricRegression.test.js
│   ├── metricsReport.test.js
│   ├── roomFixture.test.js
│   ├── spec.test.js
│   ├── storageAdapter.test.js
│   ├── world.test.js
│   └── worldHelpers.test.js
├── examples/                          # Self-test examples
│   ├── screeps-integration.config.js
│   ├── mock-bot/
│   │   └── dist/
│   │       └── main.js
│   ├── scenarios/
│   │   ├── _template.js
│   │   ├── smoke-empty.scenario.js
│   │   ├── metrics-multi-room.scenario.js
│   │   └── world-lifecycle.scenario.js
│   └── fixtures/
├── package.json
└── jest.config.js
```

## 10. Best practices

1. **Idempotence.** Each scenario should work independently of the run order.

2. **Fixtures.** Don't run 10,000 ticks if you need to test an already
   developed colony. Create a room fixture + memory fixture and start the test
   from a ready state.

3. **Naming convention.** `<area>-<subject>.scenario.js`. Example names
   (not necessarily existing scenarios):
   - `defense-invader-rcl3`
   - `logistics-refill`
   - `regression-issue-42`

4. **Negative tests.** Test not only positive scenarios but also
   negative ones — make sure the framework correctly catches errors.

5. **Event log > Memory.** Event log shows what **actually** happened.
   Memory shows what the bot **thinks** happened.

6. **Predicate > hard ticks.** If the scenario goal is to reach a state,
   add `until: { predicate }` in addition to `until.maxTicks`. Don't confuse
   `until.maxTicks` (hard limit for `run()` and `tick()`) with
   `createWorld({ ticks })` (soft limit for `run()` only).

7. **Use `createWorld()`, not the low-level runtime.** The high-level
   API simplifies most tasks. Details — in
   [API-REFERENCE.md](./API-REFERENCE.md).

## 11. Extending the framework

| Task                      | Guide                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------- |
| Add a new scenario        | [GETTING-STARTED.md](./GETTING-STARTED.md#writing-a-scenario)                       |
| Add a new assertion       | [CONTRIBUTING.md](../CONTRIBUTING.md#new-assertion)                                 |
| Add a new metric          | [CONTRIBUTING.md](../CONTRIBUTING.md#new-metric)                                    |
| Add a new sub-path export | [CONTRIBUTING.md](../CONTRIBUTING.md#sub-path-exports-trickle-down-pattern)         |
| Add a new room fixture    | [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md#7-how-to-create-a-room-fixture)             |
| Update a memory fixture   | [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md#8-how-to-create-or-update-a-memory-fixture) |
