# Run modes: batch vs live

The framework runs scenarios in two modes that share the same world-building
and assertion APIs:

- **Batch (headless)** — `npx screeps-integration-tests` runs scenarios
  without any UI: ticks advance as fast as the server can, results land in a
  report, the process exits with a green/red code. This is the mode for
  **automated testing**: CI pipelines, regression suites, metrics baselines.
- **Live (viewer)** — `--viewer` starts a browser UI on top of the same
  runner: rooms render on a Canvas stage tick by tick, and you control the
  server in real time. This is the mode for **debugging a bot and
  constructing test situations by hand**: pause, inspect, rewind, save what
  you built.

## When to use which

| Situation                                                 | Mode                 |
| --------------------------------------------------------- | -------------------- |
| CI / automated regression runs                            | batch                |
| "Does my bot survive 500 ticks with two rooms?"           | batch                |
| "Why did my bot stop harvesting around tick 200?"         | live                 |
| Reproduce a specific world state as a permanent test case | live → batch (below) |
| CPU profiling (`--profiling`)                             | batch                |

A typical workflow moves between the two: reproduce a problem in the
viewer, pin it down with manual state edits and snapshots, then encode it as
a scenario with assertions and let CI guard it.

## What live mode adds over batch

- **Realtime controls** — pause, step a single tick, change speed, jump
  between buffered ticks.
- **Visualisation** — Canvas 2D room rendering, object inspector, minimap,
  and the bot console with level filter, search, and click-to-jump-to-tick.
- **History** — the client keeps a ring buffer of recent ticks
  (`viewerOptions.replayBuffer`, default 3000): after a scenario ends you can
  still scrub and replay it. Batch mode keeps only the final report.
- **Memory at any tick** — the server reconstructs full bot Memory for any
  buffered tick from keyframes + diffs; the client never sees diffs.
- **Rewind** — restart the server from an earlier tick within the buffered
  zone and take a different path ("what if the tower had been repaired?").
- **Save snapshot** — write the full world state (objects, terrain, flags,
  `gameTime`, Memory) to `snapshotsDir` as a `*.json` file. Batch runs
  cannot **save** snapshots — there is no UI to trigger it — but they can
  **use** them (see below).

## What batch mode adds over live

- **Parallel workers** — `--jobs N` runs scenarios across cores; the viewer
  executes them one at a time in the foreground.
- **CI-friendly exit codes** — green/red exit for pipelines; `--bail` stops
  on the first failure.
- **Profiling** — `--profiling` callgrind output for CPU bottleneck analysis.
- **Metrics reports** — CSV export and regression comparison against a
  baseline. (Collection itself works in both modes; the reports are a batch
  artifact.)

## Snapshots: saved in live, used everywhere

Snapshots are the bridge between the modes:

1. Run a scenario in the viewer and get the world into the state you need —
   let the bot work, or stage the situation directly with
   `world.spawnCreep()`, `world.damageHitsStructure()`, …
2. **Save snapshot** — the full state goes to `snapshotsDir`.
3. Use it without a scenario file: **Run from snapshot** in the Scenario
   Manager relaunches the server exactly at that tick.
4. Or embed it into a test: `createWorld({ snapshot: 'my-state.json' })`
   builds the world from the snapshot — rooms and bots are derived from the
   snapshot metadata, `report.ticksRun` starts at `snapshot.env.gameTime`,
   and `run()` continues from that point. Assert against it like any other
   world.

This is the intended loop: **explore live, lock as a test.**

## See also

- [VIEWER.md](./VIEWER.md) — viewer UI in depth: panels, configuration, HMR dev mode
- [CONFIG.md](./CONFIG.md) — `--viewer` / `--jobs` / `--profiling` flags, config schema
- [EXAMPLES.md](./EXAMPLES.md) — ready-made scenarios
