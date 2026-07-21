# Screeps Integration Tests

An integration framework for testing Screeps bots on a real
[screeps-server-mockup](https://github.com/screepers/screeps-server-mockup).

It runs a compiled bot in a full game world: with a controller,
sources, spawn, creeps, events, and metrics — and lets you verify that
the bot actually grows, defends itself, and doesn't crash.

## Documentation

| File                                           | Purpose                                             |
| ---------------------------------------------- | --------------------------------------------------- |
| [GETTING-STARTED.md](./GETTING-STARTED.md)     | Installation, first run, writing a scenario         |
| [CONFIG.md](./CONFIG.md)                       | `screeps-integration.config.js` and CLI flags       |
| [API-REFERENCE.md](./API-REFERENCE.md)         | Full API reference: `createWorld`, builders, events |
| [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md)       | Room fixtures, memory fixtures, overrides           |
| [EXAMPLES.md](./EXAMPLES.md)                   | Reference scenarios and typical patterns            |
| [INTEGRATION-TESTS.md](./INTEGRATION-TESTS.md) | Architecture and internal mechanisms                |
| [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md)   | Multiple rooms and bots                             |

## What the framework can do

- **Runs your bot as-is** — takes `dist/` (or another folder with
  modules) and loads it into the mockup server.
- **Creates the world declaratively** — rooms, sources, controller, spawns,
  towers, creeps, walls, ramparts — via `spec.*`.
- **Reuses state** — room fixtures and memory fixtures with
  overrides, so you don't copy the same colony into every test.
- **Checks results** — assertions on RCL, errors, destroyed
  objects, combat, damage taken.
- **Collects metrics** — time-series per room (RCL, energyAvailable,
  creepsByRole, towerEnergy, etc.), query helpers, CSV export, regression
  API.
- **Controls test flow** — fixed number of ticks, early
  stop via `predicate` or `signal`, step-by-step `world.tick(n)`,
  runtime creep spawning, `onTick` callback, declarative events.
- **High-level helpers** — object search (`world.find`, `world.findOne`),
  structure creation/deletion/damage (`world.createStructure`,
  `world.setHitsStructure`, `world.damageHitsStructure`), etc.
  downgrade timer setting (`world.setTicksToDowngrade`).
- **Profiling** — built-in support for [screeps-profiler](https://github.com/screepers/screeps-profiler) with
  callgrind file export.
- **Isolates scenarios** — each scenario runs in a separate
  `child_process.fork` with its own server and port.

## Quick start

```bash
npm install --save-dev screeps-integration-tests
```

Create a scenario `scenarios/smoke.scenario.js`:

```js
'use strict';

const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');

async function run() {
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
    ticks: 30,
  });

  try {
    await world.run();
    assertBotWorked(world.report);
    assertNoErrors(world.report);
    console.log(`PASS: ${world.report.ticksRun} ticks`);
    return world.report;
  } finally {
    await world.dispose();
  }
}

module.exports = { run };
```

Run it:

```bash
npx screeps-integration-tests --only smoke
```

More ready-made recipes — in [EXAMPLES.md](./EXAMPLES.md).

## Running inside the repository (self-test)

_For testing the framework itself_

```bash
npm install
npm run test:integration:smoke    # только smoke-empty
npm run test:integration          # все примерные сценарии
```

## CLI

```bash
npx screeps-integration-tests [options]
```

Main flags: `--only`, `--config`, `--scenariosDir`, `--distDir`,
`--profiling`, `--timeout`, `--jobs`, `--bail`. Full list — in
[CONFIG.md](./CONFIG.md).

## Where to start

1. **Install and run the first test** → [GETTING-STARTED.md](./GETTING-STARTED.md)
2. **Look at examples** → [EXAMPLES.md](./EXAMPLES.md)
3. **Understand the API** → [API-REFERENCE.md](./API-REFERENCE.md)
4. **Configure the framework** → [CONFIG.md](./CONFIG.md)
5. **Understand the architecture** → [INTEGRATION-TESTS.md](./INTEGRATION-TESTS.md)

## Known issues

- **Memory leak:** `server.stop()` does not fully release storage. Solved
  via `child_process.fork` + `tree-kill` + `process.exit(0)`.
- **console.log:** the server outputs only one `console.log` per tick.
- **Profiler delay:** recording starts from tick 2 (0 — init,
  1 — startup, 2 — first measurement).
- **Storage-singleton race:** `@screeps/common/lib/storage.js` holds one
  TCP socket per process. When multiple `createWorld` calls happen in a row
  in one scenario (e.g., `world-spawn` with 15 worlds), there is a narrow
  window between `dispose()` and the next `server.start()` where the old
  socket is not yet closed and the new storage process is not yet listening.
  In practice it doesn't manifest: the 1-second reconnect in `storage.js` (Screeps) + the
  duration of the `createWorld` pipeline cover the race. Symptom — `Storage
connection lost` in stderr (filtered in `pipeChildStreams`).
- **User command execution delay:** As in the game, player commands execute on the next tick. But `world.exec()` in the framework looks like this:
  ```javaScript
  await world.exec();
  await world.tick(2); // The command will only execute on the 2nd tick
  ```
