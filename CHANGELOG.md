# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **BREAKING:** `world.spawn(spec)` renamed to `world.spawnCreep(spec)`.
- **BREAKING:** Config key `fixturesDir` renamed to `memoryFixturesDir`
  (env: `SIT_MEMORY_FIXTURES_DIR`, CLI: `--memoryFixturesDir`).
- **BREAKING:** `loadFixture` / `hasFixture` / `saveFixture` renamed to
  `loadMemoryFixture` / `hasMemoryFixture` / `saveMemoryFixture`
  (`screeps-integration-tests/memory-fixtures` sub-path).
- `world.report.wallClockMs`, `finalMemory`, and `finalRcl` are now updated
  after every tick (via `finalizeReport` inside `doTick`), not only at the
  end of `world.run()`. This means these fields are always current and can be
  inspected between `tick()` / `run()` calls. The final call after
  `exportProfiles` still captures `__profileText` / `__profileCallgrind`.
- New scenario: 'examples/scenarios/harvest-no-carry-drop.scenario.js' \
  Documents mock server limitation: when a creep without CARRY body part
  (or with full store) calls .harvest(), energy is lost rather than
  dropped to the ground as on the official Screeps server.

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

[Unreleased]: https://github.com/kvi05/screeps-integration-tests/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/kvi05/screeps-integration-tests/releases/tag/v1.1.0
[1.0.0]: https://github.com/kvi05/screeps-integration-tests/releases/tag/v1.0.0
