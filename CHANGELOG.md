# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `capture-fixture.js`: `--from` now defaults to `undefined` (no starting
  memory fixture required). Previously defaulted to `bootstrap_with_anchor`.

### Documentation

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

[Unreleased]: https://github.com/kvi05/screeps-integration-tests/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/kvi05/screeps-integration-tests/releases/tag/v1.0.0
