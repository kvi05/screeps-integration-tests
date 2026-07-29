# Getting Started

From package installation to your own scenario.

## Table of Contents

- [Installation and first run](#installation-and-first-run)
  - [Project layout](#project-layout)
  - [Requirements](#requirements)
  - [Install the package](#install-the-package)
  - [Create a config (optional)](#create-a-config-optional)
  - [Bot code format](#bot-code-format)
  - [Build command](#build-command)
  - [Minimal bot example](#minimal-bot-example)
  - [Sanity check](#sanity-check)
- [Running existing scenarios](#running-existing-scenarios)
- [Writing a scenario](#writing-a-scenario)
  - [Step 1. Copy the template](#step-1-copy-the-template)
  - [Step 2. Fill in the scenario](#step-2-fill-in-the-scenario)
  - [Step 3. Run it](#step-3-run-it)
- [What's next](#whats-next)

## Installation and first run

> **Note:** The shell commands (`mkdir`, `cp`, etc.) below are examples for
> bash/Linux/macOS.

### Project layout

The framework expects two directories:

- `distDir` (default: `./dist`) — your bot code, one `.js` file per Screeps
  module.
- `scenariosDir` (default: `./scenarios`) — your `*.scenario.js` test files.

These are the defaults used when no config is present. You can override them
in `screeps-integration.config.js`. Full schema — in
[CONFIG.md](./CONFIG.md).

### Requirements

- Node.js >= 22.12.0
- npm >= 10.8.2
- Your bot code: a folder with Screeps modules

### Install the package

In the bot's repository:

```bash
npm install --save-dev screeps-integration-tests
```

### Create a config (optional)

If the default paths don't work for you, create
`screeps-integration.config.js` in the root:

```js
'use strict';

module.exports = {
  distDir: './dist',
  scenariosDir: './scenarios',
  // etc.
};
```

Without a config, the same defaults are used. Full schema — in
[CONFIG.md](./CONFIG.md).

### Bot code format

The framework expects bot code as a **flat directory of `.js` files** — one
file per Screeps module (e.g. `main.js`, `role.harvester.js`). This should
match the flat module structure the Screeps game loads.

### Build command

If your bot requires a build step (TypeScript compilation, bundling to a flat
structure, etc.), run it yourself before the framework, or set
`buildCommand` in the **config** and pass `--build`:

```bash
npx screeps-integration-tests --build
```

> **Working directory:** `buildCommand` runs from the directory where you run
> the CLI, not from the config file's directory.

### Minimal bot example

> **No bot yet?** Create a minimal `dist/main.js` so the sanity check below
> passes — it keeps `Memory` non-empty, which is all `assertBotWorked` needs:
>
> ```js
> module.exports.loop = function () {
>   Memory.tick = Game.time;
> };
> ```

### Sanity check

Copy the smoke scenario from the package examples:

```bash
mkdir -p scenarios
cp node_modules/screeps-integration-tests/examples/scenarios/smoke-empty.scenario.js \
   scenarios/smoke-empty.scenario.js
```

Run it:

```bash
npx screeps-integration-tests --only smoke-empty
```

If you see `PASS: smoke-empty` — the framework is ready.

## Running existing scenarios

Run all scenarios from the `scenariosDir` directory:

```bash
npx screeps-integration-tests
```

Run a single one:

```bash
npx screeps-integration-tests --only smoke-empty
```

The name is the file name without `.scenario.js`.

Main flags: `--only`, `--profiling`, `--bail`, `--timeout`, `--jobs`,
`--build`. Full list and defaults — in
[CONFIG.md](./CONFIG.md).

> **Profiling:** the `--profiling` flag requires that the bot project has
> `screeps-profiler` installed and `loop` is wrapped via
> `profiler.wrap(module.exports.loop)`. Otherwise data won't be collected. See the
> [screeps-profiler](https://github.com/screepers/screeps-profiler) repository

## Writing a scenario

### Step 1. Copy the template

```bash
cp node_modules/screeps-integration-tests/examples/scenarios/_template.js \
   scenarios/my-test.scenario.js
```

The template already contains `createWorld → run → assertBotWorked` and
`try/finally world.dispose()`.

### Step 2. Fill in the scenario

A minimal scenario consists of three parts:

1. **Creating the world** via `createWorld()`
2. **Actions** — `world.run()`, `world.tick(n)`, `world.spawnCreep(...)`
3. **Assertions** — `assertBotWorked`, `assertRclAtLeast`, etc.

```javascript
'use strict';

const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertRclAtLeast } = require('screeps-integration-tests/assertions');

const ROOM_NAME = 'W0N1';

async function run(opts = {}) {
  const world = await createWorld({
    rooms: [
      {
        name: ROOM_NAME,
        controller: spec.controller({ level: 1 }),
        sources: [spec.source(15, 15), spec.source(35, 35)],
        structures: [spec.spawn(25, 25)],
      },
    ],
    bots: [{ username: 'bot', rooms: [ROOM_NAME] }],
    ticks: 1000,
  });

  try {
    await world.run();

    assertBotWorked(world.report);

    // This checks whether the bot upgraded the controller from RCL 1 to RCL 2
    // within the 1000 ticks.
    assertRclAtLeast(world.report, ROOM_NAME, 2);

    console.log(`PASS: my-test (RCL ${world.report.finalRcl[ROOM_NAME]})`);
    return world.report;
  } finally {
    await world.dispose();
  }
}

module.exports = { run };
```

> `opts` is passed from the CLI, usually contains `profiling`.

### Step 3. Run it

```bash
npx screeps-integration-tests
```

Your new scenario is now picked up automatically alongside the smoke test.

## What's next

- **Configure the framework** → [CONFIG.md](./CONFIG.md)
- **Reuse a room** → [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md)
- **Multiple rooms / bots** → [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md)
- **Full API** → [API-REFERENCE.md](./API-REFERENCE.md)
- **Ready-made recipes** → [EXAMPLES.md](./EXAMPLES.md)
- **Framework architecture** → [INTEGRATION-TESTS.md](./INTEGRATION-TESTS.md)
