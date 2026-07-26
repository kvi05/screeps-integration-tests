# Getting Started

From package installation to your own scenario.

## Table of Contents

- [Installation and first run](#installation-and-first-run)
- [Running existing scenarios](#running-existing-scenarios)
- [Writing a scenario](#writing-a-scenario)
- [What's next](#whats-next)

## Installation and first run

### 1. Requirements

- Node.js >= 22.12.0
- npm >= 10.8.2
- Compiled bot: a folder with Screeps modules (usually `dist/`)

### 2. Install the package

In the bot's repository:

```bash
npm install --save-dev screeps-integration-tests
```

### 3. (Optional) Create a config

If the default paths don't work for you, create
`screeps-integration.config.js` in the root:

```js
'use strict';

module.exports = {
  distDir: './dist',
  scenariosDir: './scenarios',
  fixturesDir: './fixtures',
};
```

Without a config, the same defaults are used. Full schema — in
[CONFIG.md](./CONFIG.md).

### 4. Bot code format

The framework expects bot code as a **flat directory of `.js` files** — one
file per Screeps module (e.g. `main.js`, `role.harvester.js`). No
subdirectories, no bundled output — exactly as the Screeps game loads them.

Point `distDir` (default: `./dist`) to this directory. If your bot requires
a build step (TypeScript compilation, bundling to flat structure, etc.), run
it yourself or set `buildCommand` in the config and pass `--build`:

```bash
npx screeps-integration-tests --build
```

> **No bot yet?** Create a minimal `dist/main.js` so the sanity check below
> passes — it keeps `Memory` non-empty, which is all `assertBotWorked` needs:
>
> ```js
> 'use strict';
> module.exports.loop = function () {
>   Memory.tick = Game.time;
> };
> ```

### 5. Sanity check

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

Run all scenarios:

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
> `profiler.wrap(module.exports.loop)`. Otherwise data won't be collected. See [Profiler](https://github.com/screepers/screeps-profiler)

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
2. **Actions** — `world.run()`, `world.tick(n)`, `world.spawn(...)`
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
        controller: spec.controller({ level: 2 }),
        sources: [spec.source(15, 15), spec.source(35, 35)],
        structures: [spec.spawn(25, 25)],
      },
    ],
    bots: [{ username: 'bot', rooms: ROOM_NAME }],
    ticks: 1000,
  });

  try {
    await world.run();

    assertBotWorked(world.report);
    assertRclAtLeast(world.report, ROOM_NAME, 3);

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
npx screeps-integration-tests --only my-test
```

## What's next

- **Configure the framework** → [CONFIG.md](./CONFIG.md)
- **Reuse a room** → [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md)
- **Multiple rooms / bots** → [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md)
- **Full API** → [API-REFERENCE.md](./API-REFERENCE.md)
- **Ready-made recipes** → [EXAMPLES.md](./EXAMPLES.md)
- **Framework architecture** → [INTEGRATION-TESTS.md](./INTEGRATION-TESTS.md)
