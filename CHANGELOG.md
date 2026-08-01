# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

PR #31 [Refactor/inconsistent pairs](https://github.com/kvi05/screeps-integration-tests/pull/31)

- **`spec.controller()` positional overload:** now accepts `spec.controller(x, y, opts)`
  in addition to `spec.controller(opts)` — same signature as every other `spec.*`
  constructor. Backward compatible; explicit `opts.x`/`opts.y` win over positional args.

PR #32 [Feat/understandable mistake if not 'memory fixture'](https://github.com/kvi05/screeps-integration-tests/pull/32)

- **Early memory fixture validation:** `createWorld` now checks that memory
  fixtures referenced in the `memory` option exist **before** starting the server
  (fail-early). Missing fixture → a clear `FixtureError` with the expected file
  path and fix instructions is thrown before any server resources are allocated.
  No extra options needed — the framework infers fixture names from the `memory`
  field itself.
  - New helper `collectMemoryFixtureNames()` extracts fixture names from any
    valid `memory` shape (string, `{ fixture }`, per-bot map).
  - Eliminates the manual `hasMemoryFixture` + `return { skipped: true }`
    boilerplate in scenarios.

PR #33 [Feat/eval in bot](https://github.com/kvi05/screeps-integration-tests/pull/33)

- **`world.evalInBot(code, username?)`:** evaluate JS code in a bot's context
  and resolve with the result. The code runs via the bot console on the next
  server tick, so the pattern is `const p = world.evalInBot('Game.time'); await
world.tick(1); const data = await p;`. Results are transported as a
  JSON envelope matched by a unique id (order-independent), and JSON-encoded
  strings are parsed back into values. Errors thrown by the expression reject
  the promise; pending calls time out after 10s with a hint to call
  `world.tick(n)`.

PR #34 [Chore/docs jsdoc cleanup](https://github.com/kvi05/screeps-integration-tests/pull/34)

- Added one-line comments to files that did not have a description

PR #35 [Fix/scenario contract and test coverage](https://github.com/kvi05/screeps-integration-tests/pull/35)

- **New example scenario: `examples/scenarios/metrics-regression.scenario.js`**
  — end-to-end demo of baseline regression checking with `MetricsReport` +
  `MetricsRegression`: an identical baseline passes, a perturbed baseline
  fails, and an absolute tolerance absorbs the difference.

### Changed

PR #29 [Fix/eliminating cyclic dependencies](https://github.com/kvi05/screeps-integration-tests/pull/29)

- **Cyclic dependency eliminated:** `terrain.js` moved from `builders/` to `runtime/`
  layer — it operates on `TerrainMatrix` (server abstraction), not on spec objects.
  Breaks the bottom-up `runtime → builders` dependency.
- **Dead code removed:** `materializeBotCode()` — never called, was a leftover from
  early designs. Bot code loading is handled entirely in `runtime/addBots`.
  Removing it breaks the `builders → runtime` dependency.

PR #30 [Fix/switch-to-prebuilt-server-mockup](https://github.com/kvi05/screeps-integration-tests/pull/30)

- **`screeps-server-mockup` replaced with pre-built npm package:**
  `@cool-andre/screeps-server-mockup@^1.5.2`. The new package ships with
  pre-compiled `dist/` and no `prepare` script — **TypeScript is no longer
  required** to install `screeps-integration-tests`.
- All internal `require()` and JSDoc `@typedef` imports updated from
  `screeps-server-mockup` to `@cool-andre/screeps-server-mockup`.

PR #31 [Refactor/inconsistent pairs](https://github.com/kvi05/screeps-integration-tests/pull/31)

- **BREAKING:** `world.eventLog(room)` renamed to `world.getEventLog(room)` —
  aligned with `getRcl` naming and the predicate-context method name. Predicate
  callbacks keep `eventLog` as a **deprecated alias** for backward compatibility.
- **Docs fixed:** JSDoc in `screeps-integration-tests/world-helpers` now documents
  `spawnCreep(spec)` (was stale `spawn(spec)`).

### Fixed

PR #35 [Fix/scenario contract and test coverage](https://github.com/kvi05/screeps-integration-tests/pull/35)

- **Example scenarios now follow the scenario contract** — each `world.run()`
  is validated with `assertBotWorked`:
  - `room-exits` — all 4 case blocks validate the run; the inline bot writes
    `Memory` every tick so the baseline assertion actually checks something
    (an empty loop left `Memory` as `{}`, so the runs were effectively
    unvalidated).
  - `world-lifecycle` — final log corrected from `5/5` to `2/2` tests passed.
  - `world-control-flow` — `world.registerEvent()` is now really exercised:
    a custom event is scheduled via `opts.events` and asserted to fire
    exactly once with the expected `room` and `params`.

## [2.0.0] - 2026-07-31

### Added

PR #26 [Feat/add custom terrain](https://github.com/kvi05/screeps-integration-tests/pull/26)

- **Custom terrain support:** rooms can now specify terrain via the optional `terrain` field
  in `RoomSpecInput`, `RoomFixtureSpec`, or `RoomOverrides`. Three formats supported:
  positional `{ walls, swamps }`, matrix `number[][]` 50×50, and callback `(matrix) => void`.
  Border walls are automatically applied for correct multi-room exit behaviour.
  - New scenario: `examples/scenarios/terrain-custom.scenario.js` — 5 sub-tests
    covering all terrain formats and fixture overrides
  - New room fixture: `examples/fixtures/terrain-walls.room.js`

PR #27 [feat/add-unregister-room-fixture](https://github.com/kvi05/screeps-integration-tests/pull/27)

- **`unregisterRoomFixture(name)`** — public counterpart to `registerRoomFixture`.
  Removes a fixture from the global registry. Returns `true` if the fixture
  existed and was removed, `false` (silent no-op) for non-existent names.
  Exposed via `screeps-integration-tests/room-fixtures`.

PR #28 [feat/adding-the-remaining-game-structures](https://github.com/kvi05/screeps-integration-tests/pull/28)

- **10 new structure type constants** (`screeps-integration-tests/constants`):
  `STRUCTURE_OBSERVER`, `STRUCTURE_POWER_SPAWN`, `STRUCTURE_EXTRACTOR`,
  `STRUCTURE_LAB`, `STRUCTURE_NUKER`, `STRUCTURE_FACTORY`,
  `STRUCTURE_INVADER_CORE`, `STRUCTURE_POWER_BANK`, `STRUCTURE_PORTAL`,
  `STRUCTURE_KEEPER_LAIR`.
- **10 new spec constructors** (`spec.observer`, `spec.powerSpawn`,
  `spec.extractor`, `spec.lab`, `spec.nuker`, `spec.factory`,
  `spec.invaderCore`, `spec.powerBank`, `spec.portal`, `spec.keeperLair`).
  Each handles type-specific fields (`observeRoom`, `power`, `mineralType`,
  `cooldown`, `level`, `ticksToDeploy`, `ticksToDecay`, `destination`,
  `unstableDate`) via the `overrides` mechanism.
- NPC structures (`invaderCore`, `keeperLair`) default to their faction
  userIds; neutral structures (`powerBank`, `portal`) explicitly set
  `userId: null`.
- `materializeStructure` now treats `powerSpawn` and `invaderCore` as
  spawn-like (sets `spawning: null`).
- `BOT_STRUCTURE_TYPES` updated to include new bot-owned types.
- `buildOverrides()` now propagates `opts.overrides` for all constructors.

### Changed

PR #22 [refavtor/rename-variables](https://github.com/kvi05/screeps-integration-tests/pull/22)

- **BREAKING:** `world.spawn(spec)` renamed to `world.spawnCreep(spec)`.
- **BREAKING:** Config key `fixturesDir` renamed to `memoryFixturesDir`
  (env: `SIT_MEMORY_FIXTURES_DIR`, CLI: `--memoryFixturesDir`).
- **BREAKING:** `loadFixture` / `hasFixture` / `saveFixture` renamed to
  `loadMemoryFixture` / `hasMemoryFixture` / `saveMemoryFixture`
  (`screeps-integration-tests/memory-fixtures` sub-path).

PR #23 [feat/per-tick-finalizeReport](https://github.com/kvi05/screeps-integration-tests/pull/23)

- `world.report.wallClockMs`, `finalMemory`, and `finalRcl` are now updated
  after every tick (via `finalizeReport` inside `doTick`), not only at the
  end of `world.run()`. This means these fields are always current and can be
  inspected between `tick()` / `run()` calls. The final call after
  `exportProfiles` still captures `__profileText` / `__profileCallgrind`.

PR #24 [feat/harvest-no-carry-drop-scenario](https://github.com/kvi05/screeps-integration-tests/pull/24)

- New scenario: 'examples/scenarios/harvest-no-carry-drop.scenario.js' \
  Documents mock server limitation: when a creep without CARRY body part
  (or with full store) calls .harvest(), energy is lost rather than
  dropped to the ground as on the official Screeps server.

PR #25 [docs/audit-fixes](https://github.com/kvi05/screeps-integration-tests/pull/25)

- **BREAKING:** `assertObjectNoDestroyed` renamed to `assertObjectNotDestroyed`
  for naming consistency with the rest of the assertion family
  (`assertObjectNotAttacking`, `assertObjectNotDamaged`, etc.).
- `EventSpec` typedef — documented top-level `room` field (dispatch has always
  used `event.room`; `params.room` was a docs-only inaccuracy).

### Documentation

PR #25 [Docs/audit fixes](https://github.com/kvi05/screeps-integration-tests/pull/25)

- Full audit of all documentation files (README, docs/*.md, CONTRIBUTING).
  - Fixed 3 broken anchor links in MULTI-ROOM-GUIDE pointing to API-REFERENCE.
  - Removed orphan ToC entry `10. Patterns` in EXAMPLES.
  - Simplified the `spec.*` structures table in API-REFERENCE to 3 examples.
  - Fixed malformed `memoryOverrides` merge-semantics list in API-REFERENCE.
  - Removed incomplete «When to use memoryOverrides vs a new fixture» section
    in FIXTURES-GUIDE.
  - Fixed events examples in API-REFERENCE and EXAMPLES — `room` is now at
    the top level of `EventSpec`, matching the dispatch implementation.
  - Added `const report = world.report` to metrics examples
    (was: undefined variable `report`).
  - Documented `SIT_MEMORY_FIXTURES_DIR` and `SIT_CACHE_DIR` env vars in CONFIG.
  - Unified `bots[].rooms` syntax to array form `['W0N1']` across all examples.
  - Added consolidated sub-path exports table to API-REFERENCE.
  - Fixed `cacheKeep`/`cacheDir` ambiguity in INTEGRATION-TESTS.
  - Marked file structure tree in INTEGRATION-TESTS as abbreviated.
  - Clarified that `report.metrics` is a `MetricsReport` instance.

## [1.1.0] - 2026-07-29

### Added

PR #21 [Feat/user friendly errors](https://github.com/kvi05/screeps-integration-tests/pull/21)

- Centralized user-friendly error layer (`src/lib/errors.js`):
  - `FrameworkError` base class with structured output (WHAT → WHY → HOW → docs link)
  - Subclasses: `MissingDirectoryError`, `MissingFileError`, `ConfigError`, `FixtureError`, `BotError`
  - Safe wrappers: `assertDir`, `assertFile`, `safeReaddir`, `safeReadFile`, `safeRequire`
  - 16 predefined error contexts with actionable fix instructions
  - 38 unit tests (`tests/errors.test.js`)
- `screeps-integration-tests/errors` sub-path export (`src/public/errors.js`) —
  scenario authors can now `instanceof`-check error classes
- New error contexts: `CLI_PARSE_ERROR`, `CONFIG_SYNTAX_ERROR`, `AMBIGUOUS_BOT`, `INVALID_BOTID_ARG`

### Changed

PR #20 [Docs/fix docs - #20](https://github.com/kvi05/screeps-integration-tests/pull/20)

- `capture-fixture.js`: `--from` now defaults to `undefined` (no starting
  memory fixture required). Previously defaulted to `bootstrap_with_anchor`.

PR #21 [Feat/user friendly errors](https://github.com/kvi05/screeps-integration-tests/pull/21)

- **`loadBot.js`:** replaced raw `fs.readdirSync(distDir)` with `safeReaddir` —
  missing `dist/` now produces a friendly message explaining what the dist
  directory is, why it's needed, and how to build the bot (was: `ENOENT: no
such file or directory, scandir`)
- **`bin/screeps-integration-tests.js`:** `findScenarios()` uses `assertDir`
  with context about what scenarios are; `--only` not found now lists all
  available scenarios in the error output; summary shows up to 6 error lines
- **`config.js`:** `loadConfigFile()` uses `safeRequire`/`safeReadFile` with
  friendly errors for missing config, malformed JSON, and syntax errors;
  CLI parse errors now throw `ConfigError` instead of raw `Error`
- **`builders/memory.js`:** `loadFixture()` and `saveFixture()` use
  `FixtureError` for consistent error formatting
- **`orchestration/world.js`:** `buildCanonicalRoom()` lists available room
  fixtures when a referenced fixture is not found; `createWorld()` validation
  errors (empty rooms, old `room` field) use `FrameworkError`/`BotError`
- **`orchestration/worldHelpers.js`:** `botId()`, `setTicksToDowngrade()`,
  `setHitsStructure()`, `damageHitsStructure()`, `deleteStructure()` all use
  structured error classes with contextual fix suggestions
- **`orchestration/resolveDefaults.js`:** `defaultBot()` now throws `BotError`
  instead of raw `Error` for no-bots and multi-bot cases
- **`runScenario.js`:** worker preserves `FrameworkError.toString()`
  formatting when serialising errors across IPC
- Updated test assertions in `worldHelpers.test.js`, `world.test.js`,
  `config.test.js`, `resolveDefaults.test.js`, and `world-spawn.scenario.js`
  for new error messages

### Fixed

PR #21 [Feat/user friendly errors](https://github.com/kvi05/screeps-integration-tests/pull/21)

- Config syntax errors no longer misreported as "Config file not found" —
  now use `CONFIG_SYNTAX_ERROR` context
- JSDoc `@throws` corrected for `findScenarios()` (was `{never}`, now `{MissingDirectoryError}`)
  and `resolveConfig()` (now lists all thrown error types)

### Documentation

PR #20 [Docs/fix docs - #20](https://github.com/kvi05/screeps-integration-tests/pull/20)

- Clarified that `buildCommand` runs from the directory where the CLI is
  invoked, not from the config file's directory
- Restructured `docs/GETTING-STARTED.md`: added Project layout section,
  split "Bot code format" into subsections, fixed example scenario
  (RCL 1→2, `rooms` syntax), added bash/Linux/macOS note, expanded TOC
- Restructured `docs/FIXTURES-GUIDE.md`: enriched §4 (Memory fixtures) with
  `memoryOverrides` docs, merge semantics, and all `memory` option forms;
  moved "Creating or updating" to §5 for TOC discoverability; trimmed
  room overrides examples and removed redundant subsections
- Fixed broken anchor links to FIXTURES-GUIDE.md in `CONTRIBUTING.md` and
  `docs/INTEGRATION-TESTS.md`.
- Updated `docs/EXAMPLES.md`: unified `bots[].rooms` syntax to array form
  (`['W0N1']` instead of `'W0N1'`) for clarity
- Restructured `docs/INTEGRATION-TESTS.md`: removed duplicate Observers section,
  collapsed sub-tables in §1, merged child-process and cache-isolation sections,
  moved storage-singleton race note to `CONTRIBUTING.md`

## [1.0.0] — 2026-07-26

### Added

- First public release of `screeps-integration-tests`.
- Created `CHANGELOG.md` to track changes.
- Added CI (GitHub Actions workflow).
- Integration test framework for Screeps bots based on `screeps-server-mockup`.
- CLI launch via `npx screeps-integration-tests` / `npx sit`.
- Multi-layer architecture: Config → Runtime → Orchestration → Builders → Observers → Assertions.
- `createWorld()` API with methods for world management, creep spawning, structures, and bot memory.
- Spec constructors (`spec.*`) for declarative description of game objects.
- Sub-path exports: `assertions`, `metrics`, `events`, `constants`, `room-fixtures`, `memory-fixtures`, `world-helpers`.
- Room fixtures with auto-loading and overrides.
- Metrics pipeline: collect → report → assert → regression (CSV + baseline compare).
- Worker isolation via `child_process.fork` for each scenario.
- Profiling via callgrind.
- Husky + lint-staged for pre-commit checks.
- GitHub Actions CI with caching.
- Full set of unit tests (Jest) and integration scenarios.

[Unreleased]: https://github.com/kvi05/screeps-integration-tests/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/kvi05/screeps-integration-tests/releases/tag/v2.0.0
[1.1.0]: https://github.com/kvi05/screeps-integration-tests/releases/tag/v1.1.0
[1.0.0]: https://github.com/kvi05/screeps-integration-tests/releases/tag/v1.0.0
