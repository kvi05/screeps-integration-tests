# Contributing to screeps-integration-tests

Thanks for your interest in contributing! This document covers how to set up your
environment, follow conventions, and submit changes.

## Development setup

**Prerequisites:** Node.js ≥ 22.12, git.

```bash
git clone https://github.com/kvi05/screeps-integration-tests.git
cd screeps-integration-tests
npm ci          # use ci, not install — we track package-lock.json
```

## Project structure at a glance

```
bin/                      # CLI entry points
src/
├── lib/                  # Framework implementation (7 layers)
│   ├── config/           #   Config loading, CLI parsing
│   ├── runtime/          #   ScreepsServer wrapper, ports, bots
│   ├── orchestration/    #   createWorld, helpers, events, finalisation
│   ├── builders/         #   spec constructors (pure) + materialize (DB-aware)
│   ├── observers/        #   Stateless DB readers
│   ├── assertions/       #   Bot-behaviour assertions + metrics
│   └── fixtures/         #   Room fixture registry
├── public/               # Sub-path re-exports (zero logic — see §Sub-path exports)
├── tools/                # Capture and cache utilities
├── index.js              # Main entry point
├── runScenario.js        #   Worker entry for child_process.fork
└── constants/            # Screeps game constants
profiles/                 # Performance profiles
tests/                    # Jest unit tests of the framework itself
examples/
├── scenarios/            # Integration test scenarios (*.scenario.js)
├── mock-bot/             # Minimal bot used by self-test scenarios
└── fixtures/             # Example room/memory fixtures
docs/                     # Detailed guides (architecture, API reference, fixtures)
```

For a deep dive into the architecture, see
[docs/INTEGRATION-TESTS.md](./docs/INTEGRATION-TESTS.md).

## Development workflow

The `npm run check` command runs the full pipeline:

```
lint → format:check → unit tests → integration tests
```

| Command                              | What it does                           |
| ------------------------------------ | -------------------------------------- |
| `npm run lint`                       | ESLint across all JS files             |
| `npm run lint:fix`                   | ESLint with auto-fixes                 |
| `npm run format`                     | Prettier — write                       |
| `npm run format:check`               | Prettier — check only                  |
| `npm test`                           | Jest unit tests (`tests/**/*.test.js`) |
| `npm run test:integration`           | All integration scenarios              |
| `npm run test:integration:smoke`     | Smoke test only (`--only smoke-empty`) |
| `npm run test:integration:profiling` | Scenarios with callgrind profiling     |
| `npm run test:integration:capture`   | Capture fixture                        |
| `npm run check`                      | Full CI pipeline                       |

### Known issues

**Storage-singleton race.** `@screeps/common/lib/storage.js` holds one TCP
socket per process. When multiple `createWorld` calls happen in a row in
one scenario (e.g. `world-spawn` with 15 worlds), there is a narrow window
between `dispose()` and the next `server.start()` where the old socket is
not yet closed and the new storage process is not yet listening.

In practice it doesn't manifest: the 1-second reconnect in `storage.js`
(Screeps) + the duration of the `createWorld` pipeline cover the race.
Symptom — `Storage connection lost` in stderr (filtered in
`pipeChildStreams`). It does not affect results.

## Code conventions

### Module system

- **CommonJS only.** Every file starts with `'use strict';`. No ESM
  `import`/`export`.
- `"type": "commonjs"` in `package.json`.

### Typedefs

- **Reusable** `@typedef` declarations → `src/lib/types.js`.
- **Local-only** typedefs (used in a single file) → declare in that file.
- Reference centralised types via `import('./types').TypeName`.

### File naming

| Pattern         | Purpose               |
| --------------- | --------------------- |
| `camelCase.js`  | Source files          |
| `*.test.js`     | Jest unit tests       |
| `*.scenario.js` | Integration scenarios |
| `*.room.js`     | Room fixtures         |
| `*.memory.json` | Memory fixtures       |

### JSDoc for `src/public/*.js`

Every public re-export file follows a strict template. Use
`src/public/assertions.js` as the canonical reference. The template requires:

- `@file` — one-line description
- `Responsibility:` — 1–3 sentences
- `**Available functions:**` — markdown table of exports
- `@example` — minimal usage example
- `@module screeps-integration-tests/<subpath>`

## Sub-path exports (trickle-down pattern)

Every public sub-path export follows a **three-point trickle-down** pattern.
When adding a new API surface, you must synchronise all three:

```
src/lib/X.js          ← implementation (contains the actual logic)
    ↓
src/public/X.js       ← thin re-export (no logic, only require + module.exports)
    ↓
package.json "exports"  ← package entry mapping
```

The rule: **`public/*.js` contains zero implementation logic** — only
`require()` and `module.exports`. This keeps the public API layer
auditable and prevents accidental coupling to internal modules.

### Step 1 — Implementation (`src/lib/X.js`)

Create the module in the appropriate subdirectory under `src/lib/`. See the
[project structure](#project-structure-at-a-glance) for guidance on which
directory fits your feature.

### Step 2 — Public re-export (`src/public/X.js`)

Create a thin re-export file following the JSDoc template:

```js
'use strict';

/**
 * @file <one-line description of what this sub-path exports>
 *
 * Responsibility:
 *   <1–3 sentences about the module's purpose>
 *
 * **Available functions:**
 *
 * | Function | Purpose |
 * |---|---|
 * | `doSomething()` | Brief description |
 *
 * @example
 * const { doSomething } = require('screeps-integration-tests/<subpath>');
 * doSomething(...);
 *
 * @module screeps-integration-tests/<subpath>
 */

const { doSomething } = require('../lib/<path>/X');
module.exports = { doSomething };
```

Use `src/public/assertions.js` as a reference — it is the canonical
example of the template.

### Step 3 — `package.json` `"exports"`

Add a new entry:

```json
"./<subpath>": "./src/public/X.js"
```

The key must match the `@module` tag and the `require()` path consumers use.

## Testing

### Unit tests

Jest, in `tests/`. Run with `npm test`. Each `src/lib/<layer>/X.js` should have
a corresponding `tests/X.test.js`.

### Integration scenarios

Run with `npm run test:integration`. Scenarios live in `examples/scenarios/`
(self-tests) or a consumer-configured `scenariosDir`. The runner discovers
`*.scenario.js` files automatically.

**Scenario contract:** every scenario exports `{ run(opts) }` where `run` is
async. Always wrap the body in `try { ... } finally { await world.dispose(); }`.

**Naming:** `<area>-<subject>.scenario.js` (e.g. `defense-invader-rcl3`,
`logistics-refill`, `regression-issue-42`).

See [docs/GETTING-STARTED.md](./docs/GETTING-STARTED.md) for a step-by-step
walkthrough and `examples/scenarios/_template.js` for a ready-to-copy template.

### Fixtures

Room and memory fixtures let you reuse setup across scenarios instead of
repeating spec calls. See [docs/FIXTURES-GUIDE.md](./docs/FIXTURES-GUIDE.md).

## Adding new features

### New assertion

```js
// src/lib/assertions/assertions.js
function assertMyCondition(report, opts) {
    // ... specific logic
    assert.ok(condition, 'description if test fails');
}
module.exports = { ..., assertMyCondition };
```

Re-export via `src/public/assertions.js` (if public). Add a test in `tests/assertions.test.js`.

### New metric

1. Add the field to `collectMetrics()` in `src/lib/observers/metrics.js`.
2. Scalar fields automatically appear in CSV export.
3. Non-scalar fields (e.g. `creepsByRole`) need format handling in
   `src/lib/assertions/metricsReport.js`.
4. Add a unit test in `tests/`.

### New room fixture

See [docs/FIXTURES-GUIDE.md](./docs/FIXTURES-GUIDE.md#2-room-fixtures).

### New memory fixture

See [docs/FIXTURES-GUIDE.md](./docs/FIXTURES-GUIDE.md#7-how-to-create-or-update-a-memory-fixture).

### New scenario

See [docs/GETTING-STARTED.md](./docs/GETTING-STARTED.md#writing-a-scenario).

## Pull request checklist

- [ ] `npm run check` passes locally
- [ ] Public API has NOT changed — or changes are documented in the PR
      description
- [ ] New public exports follow the [trickle-down pattern](#sub-path-exports-trickle-down-pattern)
- [ ] New code has test coverage (unit test or scenario)
- [ ] Breaking changes are described explicitly

## License

By contributing to this project, you agree that your contributions will be licensed under the [MIT License](./LICENSE).

## Issue reporting

Found a bug or have a feature request? Please open an issue with a clear description, steps to reproduce (for bugs), and the expected vs. actual behavior.
