# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

PR #44 [Feature/viewer poc](https://github.com/kvi05/screeps-integration-tests/pull/44)

- **Viewer — browser-based room visualisation (PoC).** A new `--viewer` mode that
  streams game state from the mockup server to a browser via SSE, rendering
  rooms on a Canvas 2D stage. Lives under `src/tools/viewer/`; does not affect
  the core framework.
  - **Server & IPC:** `ViewerOpts` / `Frame` / `FrameObject` types, `--viewer`
    CLI flag, `collectSnapshot` observer with terrain cache, `viewer:frame` IPC
    hook in `doTick`, HTTP+SSE server with broadcast API (`broadcast`,
    `broadcastStart`, `broadcastTerrain`, `broadcastEnd`).
  - **Client:** React 18 + Vite SPA with Canvas 2D renderer (adapted from
    screeps-dojo). Multi-room layout engine, sprite prewarming, camera
    (drag/zoom/reset), playback controls (play/pause/seek/speed), SSE
    connection lifecycle, sessionStorage persistence. `npm run viewer:build`
    script.
  - **Test infrastructure (vitest + jsdom):** comprehensive Canvas 2D mock
    with pixel-buffer tracking, transform stack, and path bounding-box
    support. `npm run viewer:test` script.
  - **Unit tests:** `zoomToward` (extracted to pure `canvas/math.js`),
    `roomNameToXY` / `computeStageLayout`, all five drawing primitives.
  - **Component tests:** full `App` mount — canvas rendering with/without
    terrain, keyboard navigation (ArrowRight/Left, Space, input focus
    suppression, camera isolation regression), edge cases.
  - **Integration tests:** `viewer-server.scenario.js` smoke scenario,
    `viewerServer.test.js` (SSE headers, handshake, broadcast, REST stubs).

PR #45 [feat/ui-mvp](https://github.com/kvi05/screeps-integration-tests/pull/45)

- **Phase 2 Browser Viewer (MVP):** bidirectional IPC for live server control
  (pause/resume/step/speed via REST → `child.send()`).
- **Object Inspector:** click on canvas → list of objects on that tile → detailed
  properties. Selected object highlight on canvas. Type filter and search.
- **Console Panel:** dockable panel with bot logs (`frame.console`).
  Level filter (all/error/warn/info), search, click-to-jump tick.
- **Scenario Manager:** list screen with scenario discovery, run single or all,
  interactive mode. Statuses, prefix grouping, name filter.
- **Metrics Graphs:** metric charts (RCL, energy, creeps, tower) via
  Chart.js + react-chartjs-2. Table with latest values.
- **MiniMap:** room overview with click-to-navigate.
- **Ring buffer:** automatic frame limit for accumulated snapshots
  (default 200, configurable via `ViewerOpts.replayBuffer`).

PR #46 [feat/ui-redesign](https://github.com/kvi05/screeps-integration-tests/pull/46)

- **SVG icon library (`Icons.jsx`):** 30+ hand-crafted icons as reusable React
  components with consistent `size`/`className`/`style` props. Replaces inline
  SVGs across all viewer components.
- **Scenario Manager master-detail layout:** left panel — compact scenario
  table (Status, Name, Time, Tickrate, Actions) with batch summary bar; right
  panel — detail view with meta grid, copy-to-clipboard buttons, extension
  sections for metrics history and description.

PR #50 [Feat/memory viewer](https://github.com/kvi05/screeps-integration-tests/pull/50)

- **Memory Viewer — per-tick bot Memory inspection in the browser.** Click on
  any creep/structure in the Canvas → Object Inspector now shows Memory for the
  owning bot at the current scrubber tick.
  - **Keyframe + delta storage:** `memoryDiff.js` computes RFC 6902 JSON Patches
    between consecutive Memory snapshots. Keyframes (full Memory) are sent every
    100 ticks; intermediate ticks use deltas for efficient storage.
  - **Ring buffer:** `memoryHistory.js` in the parent process stores per-tick
    Memory entries (up to 5000 ticks), survives worker restarts. Reconstructs
    Memory at any tick by walking forward from the nearest keyframe.
  - **IPC pipeline:** `liveControl.js` reads Memory via `getBotMemory()` and
    sends `viewer:memory` messages to the parent after each tick.
  - **REST endpoint:** `GET /api/memory?tick=N&bot=username` returns
    reconstructed Memory as JSON.
  - **Client UI:** `MemoryTree` collapsible JSON tree component with
    type-based syntax highlighting (strings, numbers, booleans, null).
    `ObjectInspector` auto-fetches Memory when the selected object has an owner.
  - **Unit tests:** `memoryDiff.test.js` (JSON Patch round-trip, edge cases),
    `memoryHistory.test.js` (ring buffer, eviction, multi-bot),
    `liveControl.test.js` (IPC, keyframe/delta logic, error handling),
    `memory.test.jsx` (MemoryTree rendering, API client).

PR #51 [Refactor/improvement of constants](https://github.com/kvi05/screeps-integration-tests/pull/51)

- **`viewerOptions` config key.** A new section in `screeps-integration.config.js`
  for viewer fine-tuning:

  ```js
  viewerOptions: {
    paused: false,          // start paused
    speed: 1000,            // ticks/second (1000 = realtime)
    keyframeInterval: 100,  // full Memory snapshot every N ticks
    replayBuffer: 3000,     // max frames/ticks in ring buffers
  }
  ```

  Partial overrides are supported — only specify the keys you want to change.

PR #54 [Feat/phase 3](https://github.com/kvi05/screeps-integration-tests/pull/54)

- **Snapshot launch — `createWorld({ snapshot })` and time-travel restore.**
  Recreate a full world from a saved snapshot (v2 format) without a scenario
  file — useful for CI debugging and interactive exploration from Scenario
  Manager.
  - `createWorld({ snapshot: filePath | snapshotObject })` — builds rooms/bots
    from snapshot metadata, materializes them, then restores the exact world
    state (objects, terrain, flags, memory, gameTime) via `restoreState`.
  - `screeps-integration-tests/snapshot` sub-path export: `restoreState`,
    `readSnapshot`.
  - REST: `POST /api/run-from-snapshot` (launch from saved file),
    `DELETE /api/snapshots/:file` (delete saved snapshot).
  - `GET /api/snapshots` now returns `tick` and `scenario` metadata per file
    (parsed on the fly — no extra fetch needed).
  - Worker restore mode: when `opts.restoreSnapshot` is set, the worker
    creates a world from snapshot instead of requiring a scenario file.
  - Snapshots directory is now derived from `scenariosDir` (sibling of the
    scenarios folder), not `process.cwd()`.

PR #55 [Feat/phase 4](https://github.com/kvi05/screeps-integration-tests/pull/55)

- **Seamless unified timeline** — a single timeline, no separate Live / Replay
  modes. The scrubber cursor is the single source of truth: at the recorded
  edge the live server is the time source (play/pause/step drive it), in the
  past the client plays through buffered frames and pauses the server
  automatically.
- **Post-end local replay.** The viewer is now notified when an interactive
  scenario finishes (`end` SSE event), so the recorded frames remain playable
  after the worker has exited. Server-only actions (rewind/save/step) are
  correctly disabled once the scenario ends — there is no live DB to restore.
- **`viewerOptions.paused` forwarded in the SSE start handshake** — the viewer
  starts paused when configured.

PR #59 [Feat/viewer timeline redesign](https://github.com/kvi05/screeps-integration-tests/pull/59)

- **Floating frosted-glass transport.** The timeline renders as a floating
  frosted-glass overlay pinned to the top of the canvas: a single full-width
  `transport-row` holds three visually separated groups (back-to-scenarios
  pill, flexible center transport bar, action pills), so the scrubber shrinks
  first instead of the pills overlapping on narrow screens. A shared
  `.glass-panel` utility (backdrop blur, inset depth, shadow) styles the
  transport, the canvas overlays (room label, zoom indicator, toolbar) and the
  minimap. Transport is always mounted — controls work before the first frame
  arrives. A live server-tick indicator (running/paused/stepping dot) shows
  the authoritative time source.
- **Robust reconnect.** A late-connecting SSE client (e.g. page reload) now gets
  the last broadcast frame and terrain re-sent right after the `start`
  handshake, plus a `start` event merged with the _current_ paused state — so a
  paused server stays paused and the canvas is never blank. `broadcastStart`
  clears the cached frame/terrain so a new scenario never leaks stale data.
  The client no longer forces `serverState` to `running` on the first frame;
  `status`/`start` events are authoritative.

PR #63 [feat(viewer): open snapshots folder from the UI](https://github.com/kvi05/screeps-integration-tests/pull/63)

- **Open snapshots folder.** New `POST /api/open-snapshots-folder` endpoint
  opens the snapshots directory in the OS file manager (Explorer / Finder /
  `xdg-open`), creating it on demand. Buttons added in the viewer UI: an icon
  button next to the refresh control in the StatePanel "Saved Snapshots"
  section, and an "Open folder" button in the Scenario Manager Snapshots tab
  footer.

PR #64 [Feat/viewer dx](https://github.com/kvi05/screeps-integration-tests/pull/64)

- **`npm run help` — annotated npm-scripts catalog.** `package.json` cannot
  carry comments, so the grouped catalog (daily drivers / quality / viewer /
  tools) lives in `src/tools/help.js`; `tests/scriptsHelp.test.js` fails when
  the catalog and the `scripts` section drift apart.
- **npm scripts regrouped and renamed** for consistency: `build:viewer` →
  `viewer:build`, `test:viewer` → `viewer:test`; new `viewer` (launch the UI),
  `viewer:dev` (Vite dev server with HMR), `fixture:capture`; `smoke` /
  `profiling` variants now delegate to `test:integration` via `--`.
- **`viewerPort` config/CLI option.** Pin the viewer UI server port
  (`--viewerPort 3100` or `viewerPort` in the config) instead of auto-picking
  a free port — required for the Vite dev-server proxy (`SIT_VIEWER_PORT`).
  Invalid values from the config file are rejected early with an actionable
  `INVALID_VIEWER_PORT` error.
- **`VIEWER_NOT_BUILT` fail-fast error.** `--viewer` now checks for the
  prebuilt client bundle at startup and explains how to build it, instead of
  serving 404s to the browser.
- **Grouped `--help` output.** CLI flags render as titled sections
  (General / Paths / Run / Viewer) instead of one flat list.
- **Docs:** new `docs/VIEWER.md` (launch, panels, replay/snapshots, dev mode,
  troubleshooting); README / CONTRIBUTING / CONFIG.md synced with the new
  scripts and flags.

- **Scenario Manager: total ticks per run.** The worker now aggregates
  `ticksRun` across **all** worlds created by a scenario (a scenario may call
  `createWorld()` several times) and sends the sum as `totalTicks` in the
  `viewer:scenario-result` IPC/SSE event instead of the last world's tick
  count. The scenario detail panel shows the aggregated total and uses it for
  the tick-rate calculation.
- **Cross-world totals in the final worker message.** `WorkerMessage` now
  carries `totalTicks` / `totalWorlds` on both the pass and the fail path, so
  multi-world scenarios are not misrepresented by the last world's report
  (`world.report` remains strictly per-world). Only additive counters are
  aggregated — per-world data (`errors`, `metrics`, `finalMemory`, ...) is
  intentionally never merged. The CLI summary shows `N worlds, M ticks` for
  multi-world scenarios, and the viewer `broadcastEnd` now uses the same
  aggregate. Worlds are tracked in the new `orchestration/worldReports.js`
  registry: `dispose()` freezes the world's final `ticksRun` and releases its
  report, so long-lived processes do not accumulate disposed worlds' reports.

### Changed

PR #45 [feat/ui-mvp](https://github.com/kvi05/screeps-integration-tests/pull/45)

- **`createUiServer()`** now accepts `sendCommand`, `scenariosDir`,
  `onRunScenario` options for bidirectional IPC.
- **`runScenario.js`:** worker listens for `viewer:cmd` messages, creates
  `opts.viewer.control` EventEmitter for pause/step.
- **`world.js` `doTick()`:** checks `opts.viewer.paused`, awaits resume,
  supports `stepRequested`. `run()`: throttling via `opts.viewer.speed`.
- **`snapshot.js` `collectSnapshot()`:** includes `report.logs` in
  `frame.console` (filtered by tickNum).
- **`ViewerOpts`** extended: `paused`, `speed`, `replayBuffer`, `control`,
  `stepRequested`, `status`.

PR #46 [feat/ui-redesign](https://github.com/kvi05/screeps-integration-tests/pull/46)

- **Complete visual redesign:** new design system in `global.css` — CSS custom
  properties for all tokens (teal accent palette `#2dd4bf`, Inter + JetBrains
  Mono fonts, warm-neutral surface palette, spacing/radius/shadow/z-index
  scale). Dark theme throughout.
- **All viewer components refined:** CanvasStage (loading overlay, zoom
  indicator, canvas toolbar), ConsolePanel (collapsed/expanded states, severity
  filters, search), ObjectInspector (type filter chips, detail table),
  MetricsPanel, MiniMap, LiveControls, ReplayControls, StatusBar.
- **Color palette:** shifted to more pastel tones — less saturated, warmer
  neutrals, reduced visual harshness.

PR #51 [Refactor/improvement of constants](https://github.com/kvi05/screeps-integration-tests/pull/51)

- **Unified console log-level defaults.** `DEFAULT_LOG_LEVEL` now lives in
  `console.js` only (single source of truth); world.js imports it instead of
  defining a duplicate `DEFAULT_WORLD_LOG_LEVEL`. Value raised from `'error'`
  to `'all'` — the default that `createWorld` has always passed in practice.
- **Named all hardcoded constants across the codebase.**
  `DEFAULT_MAX_CONSOLE_LINES`, `DEFAULT_MAX_TICKS`, `DEFAULT_EVAL_IN_BOT_TIMEOUT_MS`,
  `SSE_HEARTBEAT_MS`, `DEFAULT_VIEWER_SPEED`, `SUMMARY_ERROR_LINES`,
  `REPLAY_BUFFER_DEFAULT`, `REPLAY_SLIDER_FALLBACK_MAX`, canvas rendering
  constants (`STORE_BUCKETS`, `MAX_BODY_PARTS`, `TILE_COLORS`, …) — every
  formerly-bare number now has a named `const` with JSDoc.
- **Extracted viewer defaults from inline function calls.**
  `runScenario.js` no longer computes `paused`, `speed`, `keyframeInterval`
  inside the `createViewerInterceptor` call site — they are resolved first
  and passed as variables.
- **`keyframeInterval` now reachable from user config.**
  Previously hardcoded to 100 inside `liveControl.js` with no way to override;
  now flows through `config.viewerOptions.keyframeInterval`.
- **Unified ring-buffer capacities.** `REPLAY_BUFFER_DEFAULT` (client, App.jsx,
  3000 frames) and `memoryHistory` maxTicks (server, 5000 ticks) were separate
  values with the same purpose. Both now use a single
  `config.viewerOptions.replayBuffer` (default 3000).

### Added dependencies

PR #45 [feat/ui-mvp](https://github.com/kvi05/screeps-integration-tests/pull/45)

- `chart.js`, `react-chartjs-2`, `react-router-dom` (viewer client)

### Fixed

PR #56 [Fix/engine snapshot node24](https://github.com/kvi05/screeps-integration-tests/pull/56)

- **Engine snapshot auto-regeneration after Node.js upgrades.** `@screeps/driver`
  ships a prebuilt V8 snapshot (`build/runtime.snapshot.bin`) that only works
  with the exact V8 version it was created with. After a Node.js patch upgrade
  the engine child processes crashed (Windows) or hung integration tests
  forever (Linux CI). The CLI runner now regenerates the snapshot with the
  vendor's own `make-runtime-snapshot.js` eagerly — once per run, before any
  worker is forked (`ensureEngineSnapshotCompat`; stamp-guarded,
  lock-serialised across concurrent runs). `prepareServer` keeps the same
  check as an idempotent safety net for direct `createWorld` usage outside
  the CLI (fast path: a single stamp-file read).
- **Fail fast on engine process death.** An `engineWatch` attached to the mock
  server converts engine crashes — including signal-deaths that
  screeps-server-mockup only reports as `info` — into an actionable
  `ENGINE_CRASH` error instead of an endless `server.tick()` hang. Crashes of
  non-engine processes (e.g. storage) that the mockup restarts automatically
  are logged as warnings and no longer kill the worker through an unhandled
  `error` event.
- **Worker final message is flushed before exit.** `runScenario.js` used a
  fixed 100ms delay before `process.exit(0)`, which could lose the final IPC
  message under load (`Worker exited unexpectedly (exit code 0)`). The worker
  now exits via the `process.send` callback once the message is flushed to
  the channel.
- **Storage startup retry on port collisions.** Parallel workers could pick
  the same ephemeral port (probe→release window in `getFreePort`) and crash
  each other's storage process. `prepareServer` now retries with a fresh port
  up to 3 times before failing.
- **CI cache key includes the resolved Node version.** Native modules cached
  under `24.x` were reused across Node patch upgrades with a different V8,
  masking the snapshot mismatch; the cache key now uses
  `steps.setup-node.outputs.node-version`.

## [3.0.0] — 2026-08-06

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

PR #36 [Feat: bot metrics (CPU/bucket/limit) + construction-site & total-energy room metrics](https://github.com/kvi05/screeps-integration-tests/pull/36)

- **New room metrics:** `constructionSiteCount` (number of construction
  sites), `constructionSiteTotalLeftProgress` (total `progressTotal - progress`
  across all construction sites) and `totalEnergy` (energy stored in all
  non-creep objects — spawns, extensions, towers, storage, containers, links,
  …).
- **New `bots` metric entity (opt-in):** `metrics.bots: true` collects a
  per-bot time-series with `cpuUsage` (CPU used in the last tick), `bucket`
  (CPU bucket, capped) and `cpuLimit` (CPU limit per tick) from the `users`
  collection written by the engine. Works with the existing `MetricsReport`
  API (`m.bot(name)`, `m.bots`, `latestBot`, CSV export, assertions) —
  previously `bots: true` threw an error.
- **New `TYPE_POWER_CREEPS` constant:** `'powerCreep'` — object type of power
  creeps in `rooms.objects` (exported from `screeps-integration-tests/constants`).

PR #37 [Feat/add flag version](https://github.com/kvi05/screeps-integration-tests/pull/37)

- **CLI `--version` (-v) flag:** `screeps-integration-tests --version` prints the
  package version. The flag is also listed in the `--help` output.

PR #38 [Feat/add spec.baseRoom](https://github.com/kvi05/screeps-integration-tests/pull/38)

- **`spec.baseRoom(name, opts)`:** returns a ready-to-use standard RCL1 base
  room (controller level 1, two sources, one spawn) for
  `createWorld({ rooms: [...] })` — available out of the box via the main
  `spec` export, no extra import. Customise via the same `RoomOverrides`
  vocabulary used by room fixtures (`controller` merge, `append`, `exclude`,
  `creeps`, `hostiles`, `terrain`) — only the fields that differ from the
  defaults need to be specified.

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

PR #40 [fix: clear BotError for unknown bot in world.exec/evalInBot/readMemor…](https://github.com/kvi05/screeps-integration-tests/pull/40)

- **Unknown bot in bot-targeted world methods fails with a clear error** —
  `world.exec`, `world.evalInBot`, `world.readMemory` and `world.writeMemory`
  throw a `BotError` (code `BOT_NOT_FOUND`) listing the available bots when the
  passed `username` is not registered, instead of a cryptic `TypeError`
  (`Cannot read properties of undefined`). The optional `username` override
  keeps working as before.

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

[Unreleased]: https://github.com/kvi05/screeps-integration-tests/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/kvi05/screeps-integration-tests/releases/tag/v3.0.0
[2.0.0]: https://github.com/kvi05/screeps-integration-tests/releases/tag/v2.0.0
[1.1.0]: https://github.com/kvi05/screeps-integration-tests/releases/tag/v1.1.0
[1.0.0]: https://github.com/kvi05/screeps-integration-tests/releases/tag/v1.0.0
