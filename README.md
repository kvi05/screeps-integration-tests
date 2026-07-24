# Screeps Integration Tests

[![npm version](https://img.shields.io/npm/v/screeps-integration-tests.svg)](https://www.npmjs.com/package/screeps-integration-tests)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/kvi05/screeps-integration-tests/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A522.12-brightgreen.svg)](https://nodejs.org/)

Portable integration test framework for [Screeps](https://screeps.com/) bots.
Run your bot against a full game server, verify behavior, collect metrics —
all locally, no game subscription needed.

## Why?

Testing a Screeps bot is hard. Unit tests with mocks can't reproduce real
server behavior: room controller upgrades, game events (`EVENT_ATTACK`,
`EVENT_BUILD`), object destruction, memory persistence across ticks.

**screeps-integration-tests** gives you a complete local game server
powered by [screeps-server-mockup](https://github.com/screepers/screeps-server-mockup).
Your bot runs exactly as it would in production — same APIs, same tick
mechanics, same memory model. You get:

- **Confidence** — catch regressions before uploading to the live game.
- **Speed** — run dozens of scenarios in seconds, not hours.
- **Automation** — plug into CI/CD; every commit is verified.

## Features at a glance

| Feature                       | Description                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 🎮 **Full game server**       | Runs the official open-source Screeps server locally — real game mechanics.                                             |
| 🏗️ **Declarative world**      | Build rooms, structures, creeps via `spec.*` — pure functions, clean and composable.                                    |
| 📦 **Fixtures**               | Reusable room and memory templates with overrides. Don't copy-paste setup code.                                         |
| ✅ **assertions**             | Handy helpers to check bot behavior on the server: RCL progress, errors, destroyed objects, combat damage, and more.    |
| 📊 **Metrics pipeline**       | Time-series collection, query helpers, CSV export, regression comparison.                                               |
| ⚡ **Profiling**              | Built-in callgrind support via [screeps-profiler](https://github.com/screepers/screeps-profiler). Find CPU bottlenecks. |
| 🌐 **Multi-room / multi-bot** | Multiple rooms, multiple bots, cross-room interactions — all in one scenario.                                           |
| 🔀 **Parallel workers**       | `--jobs N` runs scenarios in parallel in a `child_process` pool. Uses all your cores.                                   |
| 🛡️ **Worker isolation**       | Each scenario gets its own server, port, and cache directory. No leaks between tests.                                   |

## Quick start

```bash
npm install --save-dev screeps-integration-tests
```

Create `scenarios/smoke.scenario.js`:

```js
'use strict';

// Import the framework core and assertion helpers
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');

async function run() {
  // Build a world: one room with controller, sources, and a spawn
  const world = await createWorld({
    rooms: [
      {
        name: 'W0N1',
        controller: spec.controller({ level: 1 }), // RCL 1 controller at default position
        sources: [spec.source(15, 15), spec.source(35, 35)], // Two energy sources
        structures: [spec.spawn(25, 25)], // A spawn for your creeps
      },
    ],
    bots: [{ username: 'bot', rooms: 'W0N1' }], // Your bot, placed in W0N1
    ticks: 30, // Run simulation for 30 ticks
  });

  try {
    // Execute the simulation
    await world.run();

    // Assertions: did the bot survive without errors?
    assertBotWorked(world.report); // ticks > 0, memory is populated, no errors
    assertNoErrors(world.report); // no [ERROR] lines in console output

    console.log(`PASS: ${world.report.ticksRun} ticks`);
    return world.report;
  } finally {
    // Always clean up — stops the server and frees resources
    await world.dispose();
  }
}

module.exports = { run };
```

Run it:

```bash
npx screeps-integration-tests --only smoke
```

More ready-made recipes — in [EXAMPLES.md](./docs/EXAMPLES.md).

## How it works

### Four-layer architecture

1. **Config** — merges defaults, config file, environment variables, and
   CLI flags into a single configuration.
2. **Runtime** — wraps `screeps-server-mockup`: server setup, port
   management, bot code loading, `TestBot` instances, and lifecycle utilities.
3. **World** — the main API (`createWorld`). Orchestrates the full pipeline:
   prepare server → add bots → materialize rooms → start → initialize bots.
   Returns a `WorldInstance` with methods for control, inspection, and cleanup.
4. **Builders & Observers** — `spec.*` builders are pure functions that return
   plain objects (never touch the DB). `materialize*` is the only layer that
   knows the DB schema. Observers are stateless: they read the world state
   and return data.

### Scenario contract

Each `*.scenario.js` file exports an async `run(opts)` function.
The contract is simple:

```js
async function run() {
  const world = await createWorld({/* ... */});
  try {
    await world.run();
    // ... assertions ...
  } finally {
    await world.dispose(); // mandatory cleanup
  }
}
module.exports = { run };
```

### Worker isolation & parallelism

Every scenario runs in its own `child_process.fork`. This gives you:

- **No shared state.** Each scenario gets its own `ScreepsServer` on a
  random free port.
- **Parallel execution.** The CLI uses a worker pool (`--jobs N`, default:
  `min(4, CPU cores)`). Scenarios are pulled dynamically — no fixed
  assignment, no idle workers.

```
Scenario files ──→ Worker pool (N concurrent) ──→ Results
                      │
                      ├── Worker 1: smoke-empty.scenario.js
                      ├── Worker 2: combat.scenario.js
                      └── Worker 3: metrics.scenario.js
```

## CLI quick reference

```
npx screeps-integration-tests [options]
# or the short alias:
npx sit [options]
```

| Flag                   | Description                                    | Default             |
| ---------------------- | ---------------------------------------------- | ------------------- |
| `--only <name>`        | Run a single scenario (without `.scenario.js`) | —                   |
| `--jobs <n>`           | Parallel scenario workers                      | `min(4, CPU cores)` |
| `--timeout <ms>`       | Per-scenario timeout                           | `1800000` (30 min)  |
| `--bail`               | Stop on first failure                          | off                 |
| `--profiling`          | Enable callgrind profiling                     | off                 |
| `--build`              | Run build command before scenarios             | off                 |
| `--config <path>`      | Path to config file                            | auto-detect         |
| `--distDir <dir>`      | Bot build directory                            | `./dist`            |
| `--scenariosDir <dir>` | Scenario files directory                       | `./scenarios`       |
| `--fixturesDir <dir>`  | Memory fixtures directory                      | `./fixtures`        |
| and more               |                                                |                     |

Configuration is merged from multiple sources (lowest to highest priority):
**defaults → config file → env → CLI flags → code overrides**.

Full config reference — see [CONFIG.md](./docs/CONFIG.md).

## Documentation

| File                                                | Purpose                                             |
| --------------------------------------------------- | --------------------------------------------------- |
| [GETTING-STARTED.md](./docs/GETTING-STARTED.md)     | Installation, first run, writing a scenario         |
| [CONFIG.md](./docs/CONFIG.md)                       | `screeps-integration.config.js` and CLI flags       |
| [API-REFERENCE.md](./docs/API-REFERENCE.md)         | Full API reference: `createWorld`, builders, events |
| [FIXTURES-GUIDE.md](./docs/FIXTURES-GUIDE.md)       | Room fixtures, memory fixtures, overrides           |
| [EXAMPLES.md](./docs/EXAMPLES.md)                   | Reference scenarios and typical patterns            |
| [INTEGRATION-TESTS.md](./docs/INTEGRATION-TESTS.md) | Architecture and internal mechanisms                |
| [MULTI-ROOM-GUIDE.md](./docs/MULTI-ROOM-GUIDE.md)   | Multiple rooms and bots                             |

## Running inside the repository (for contributors)

_For testing the framework itself_

```bash
npm install
npm run test:integration:smoke    # smoke test only
npm run test:integration          # all example scenarios
```

Useful commands:

```bash
npm run lint           # ESLint
npm run format:check   # Prettier check
npm test               # Jest unit tests
npm run check          # Full check: lint → format → unit → integration
```

## Acknowledgments

Built on top of **[screeps-server-mockup](https://github.com/screepers/screeps-server-mockup)** —
a community-maintained test harness that runs the official open-source Screeps server locally, one tick at a time.

## Known issues

- **Profiler delay:** recording starts from tick 2 (0 — init,
  1 — startup, 2 — first measurement).
- **User command execution delay:** As in the game, player commands execute
  on the next tick. But `world.exec()` in the framework looks like this:
  ```js
  await world.exec();
  await world.tick(2); // The command will only execute on the 2nd tick
  ```
- **Storage-singleton race:** `@screeps/common/lib/storage.js` holds one
  TCP socket per process. When multiple `createWorld` calls happen in a row
  in one scenario (e.g., `world-spawn` with 15 worlds), there is a narrow
  window between `dispose()` and the next `server.start()` where the old
  socket is not yet closed and the new storage process is not yet listening. \
  In practice it doesn't manifest: the 1-second reconnect in `storage.js`
  (Screeps) + the duration of the `createWorld` pipeline cover the race.
  Symptom — `Storage connection lost` in stderr (filtered in
  `pipeChildStreams`).
