# Screeps Integration Tests

[![npm version](https://img.shields.io/npm/v/screeps-integration-tests.svg)](https://www.npmjs.com/package/screeps-integration-tests)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/kvi05/screeps-integration-tests/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A522.12-brightgreen.svg)](https://nodejs.org/)

A test framework for [Screeps](https://screeps.com/) bots that builds on
[screeps-server-mockup](https://github.com/screepers/screeps-server-mockup).
Instead of manually assembling rooms, looping ticks, and reading the database
to check behaviour, you declare the world in one call, run it, and assert
against the result — all locally, no game subscription needed.

## Why this over mockup?

`screeps-server-mockup` gives you a local Screeps server and low-level
primitives (`addRoom`, `addRoomObject`, `addBot`, `server.tick()`). What it
doesn't give you is a test layer: you still assemble the world object by
object, drive ticks in a manual loop, inspect the database by hand to verify
behaviour, and call `process.exit()` to clean up a storage leak.

**screeps-integration-tests** adds that layer:

| What        | mockup                                                 | screeps-integration-tests                                |
| ----------- | ------------------------------------------------------ | -------------------------------------------------------- |
| World setup | `addRoom` + `setTerrain` + `addRoomObject` one by one  | `createWorld({ rooms: [...] })` — declarative            |
| Bot code    | inline strings `modules = { main: '…' }`               | loaded from a `dist/` folder — your bot as-is            |
| Tick loop   | `for (i…) await server.tick()` by hand                 | `world.run()` / `world.tick(n)` / `until.predicate`      |
| Checks      | read DB / memory / logs manually                       | `assertBotWorked`, `assertRclAtLeast`, `assertNoErrors`… |
| Run         | your own wrapper script                                | `npx screeps-integration-tests` CLI                      |
| Cleanup     | `server.stop(); process.exit()` (hangs without `exit`) | `await world.dispose()`                                  |

On top of that: reusable fixtures, a metrics pipeline (time-series, CSV,
regression), callgrind profiling, and a parallel worker pool.

## Features

| Feature               | What it gives you                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Declarative world** | `createWorld({ rooms, bots, ticks })` assembles the server, rooms, bots, and objects in one call. `spec.*` builders are pure functions — no manual `addRoomObject` chains. |
| **Bot from a folder** | Point `distDir` at your compiled bot. No inline `modules = { main: '…' }` strings — the bot runs exactly as in production.                                                 |
| **Assertions**        | `assertBotWorked`, `assertNoErrors`, `assertRclAtLeast`, `assertNoBotObjectDestroyed`… check behaviour on the server instead of reading the database by hand.              |
| **Fixtures**          | Reusable room (`*.room.js`) and memory (`*.memory.json`) templates with overrides — stop copy-pasting setup code between tests.                                            |
| **Metrics**           | Time-series collection, query helpers, CSV export, and regression comparison against a baseline.                                                                           |
| **Profiling**         | Built-in callgrind via [screeps-profiler](https://github.com/screepers/screeps-profiler) — find CPU bottlenecks (`--profiling`).                                           |
| **CLI & parallelism** | `npx screeps-integration-tests` runs scenarios; `--jobs N` parallelises them across cores in a worker pool.                                                                |
| **Worker isolation**  | Each scenario gets its own server, port, and cache directory — no leaks between tests. The mockup storage leak is handled via `process.exit(0)` in forked workers.         |

## Examples

Real code reads faster than a full API reference. [EXAMPLES.md](./docs/EXAMPLES.md)
shows most of the framework in action — smoke, defense, metrics, multi-room,
profiling, and more — with minimal, copy-pasteable snippets. If you'd rather
see what the framework can do before reading on, start there.

## Core APIs at a glance

Three APIs do most of the work.

**`createWorld(opts)`** is the entry point — one declarative call that
assembles the server, rooms, bots, objects, and initial memory, then returns
a `world` instance you drive the simulation with. Everything below starts here. \
Full reference: [API-REFERENCE § createWorld](./docs/API-REFERENCE.md#1-main-entry-point-createworld).

**`spec.*`** builds game objects as plain data — `spec.spawn(25, 25)`,
`spec.controller({ level: 3 })`, `spec.creep(10, 10, { hits: 100 })`, and so on.
It fills every field with sane Screeps defaults (`hits`, `hitsMax`, `store`, `energyCapacity`, …)
so you only set what matters for the test. \
You already know the object types — `spec.*` just spares you the boilerplate. \
Full reference: [API-REFERENCE § spec](./docs/API-REFERENCE.md#3-spec-constructors).

**`world.*`** is what `createWorld` returns — it drives the running simulation:

<!-- prettier-ignore-start -->

| Method                                                    | What it does                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| `world.run()` / `world.tick(n)`                           | advance time (to `ticks` or `until.predicate`)               |
| `world.spawn(spec)`                                       | add a creep at runtime                                       |
| `world.exec(code)`                                        | run JS in the bot's context                                  |
| `world.readMemory()` / `world.writeMemory()`              | inspect / patch bot memory (support deep merging)            |
| `world.eventLog(room)`                                    | read **game events** — what happened in a room (`EVENT_ATTACK`, `EVENT_OBJECT_DESTROYED`…) |
| `world.registerEvent(action, fn)`                         | register a handler for **scheduled events** — run your function at a given tick (via `opts.events`) |
| `world.createStructure()` / `world.damageHitsStructure()` | helpers to edit structures mid-test                                    |
| `world.dispose()`                                         | stop the server and clean up                                 |

<!-- prettier-ignore-end -->

Full reference: [API-REFERENCE § world.*](./docs/API-REFERENCE.md#2-worldinstance).

## Quick start

```bash
npm install --save-dev screeps-integration-tests
npx screeps-integration-tests --only smoke-empty
```

For the full path from install to your first `PASS` — including how to point
the framework at your bot's compiled code — \
see [GETTING-STARTED.md](./docs/GETTING-STARTED.md).

## CLI

```bash
npx screeps-integration-tests [options]   # or: npx sit [options]
```

| Flag              | Description                                    | Default             |
| ----------------- | ---------------------------------------------- | ------------------- |
| `--only <name>`   | Run a single scenario (without `.scenario.js`) | —                   |
| `--jobs <n>`      | Parallel scenario workers                      | `min(4, CPU cores)` |
| `--bail`          | Stop on first failure                          | off                 |
| `--timeout <ms>`  | Per-scenario timeout                           | `1800000` (30 min)  |
| `--profiling`     | Enable callgrind profiling                     | off                 |
| `--build`         | Run `buildCommand` before scenarios            | off                 |
| `--distDir <dir>` | Bot build directory                            | `./dist`            |

Full flag list and config file schema — see [CONFIG.md](./docs/CONFIG.md).

## Where to go next

| Guide                                               | What it covers                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| [GETTING-STARTED.md](./docs/GETTING-STARTED.md)     | Install to first `PASS` — the hands-on onboarding                    |
| [CONFIG.md](./docs/CONFIG.md)                       | Config file schema and every CLI flag                                |
| [API-REFERENCE.md](./docs/API-REFERENCE.md)         | Full `createWorld`, `spec`, `world.*`, assertions, metrics reference |
| [FIXTURES-GUIDE.md](./docs/FIXTURES-GUIDE.md)       | Room and memory fixtures, overrides, when to use which               |
| [EXAMPLES.md](./docs/EXAMPLES.md)                   | Ready-made recipes: smoke, defense, metrics, multi-world             |
| [MULTI-ROOM-GUIDE.md](./docs/MULTI-ROOM-GUIDE.md)   | Multiple rooms and bots in one scenario                              |
| [INTEGRATION-TESTS.md](./docs/INTEGRATION-TESTS.md) | Internal architecture (for contributors)                             |

## Acknowledgments

Built on top of **[screeps-server-mockup](https://github.com/screepers/screeps-server-mockup)** —
a community-maintained test harness that runs the official open-source Screeps server locally, one tick at a time.

## Known issues

- **Profiler delay:** recording starts from tick 2 \
  (0 — init, 1 — startup, 2 — first measurement).
- **Command execution delay:** as in the game, player commands execute on the
  next tick:
  ```javascript
  await world.exec();
  await world.tick(2); // The command will only execute on the 2nd tick
  ```
- **`Storage connection lost`:** when many worlds run back-to-back in one
  scenario, you may see `Storage connection lost` in stderr. This is a known
  race in `@screeps/common`'s singleton storage; the framework filters it and
  it does not affect results. \
  Details — [CONTRIBUTING.md Known issues](./CONTRIBUTING.md#known-issues).

## Contributing

Found a bug? Have an idea? Want to improve something?  
Pull requests and issues are always welcome.

For the technical details (setup, conventions, how to run tests), see [CONTRIBUTING.md](./CONTRIBUTING.md).
