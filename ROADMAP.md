# Roadmap

This is the public statement of where the project is heading. It is the
**course**, not the task list: tasks live in `backlog/` (the SSOT, see
`backlog/README.md`), this file explains _why_ and _in what order_. Epics are
referenced by id (`E01`…). Changing the course is a human decision; agents
treat this file as read-only context.

## Current state

The framework is published on npm (`screeps-integration-tests`) and covers the
full loop: config → world creation (`createWorld`) → spec builders →
materialization → tick loop → observers → assertions → reports. On top of that:

- **Viewer UI** — browser Scenario Manager + interactive world view
  (React 18 + Vite, Canvas 2D, SSE), live controls, replay, snapshots.
- **Metrics pipeline** — collect → report → assertions → CSV export.
- **Fixtures** — room fixtures with overrides, memory fixtures.
- **Agent workflow** — backlog convention, conductor/implementer/reviewer
  roles, skills (`.github/skills/`).

## Now — active epics

The current focus is the UI cycle: it was just merged from `feat/UI` and needs
stabilization before wider exposure.

| Epic         | Theme                  | Why now                                                                                                                    |
| ------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `E04`, `E06` | UI bugs (two waves)    | Broken basics block everything else: wrong scenario statuses, queue/failed not shown, inline memory, timeline-console sync |
| `E05`        | Split CLI and UI       | `createWorld` still carries viewer-specific options; the CLI/UI boundary must be clean before new UI features              |
| `E07`        | UI polish              | Small readability fixes (minimap, hotkey hints)                                                                            |
| `E03`        | UI global requirements | The big rocks: full history/rewind/snapshot, memory viewer, map editor, settings, Object Inspector                         |
| `E01`        | Framework code cleanup | Debt accumulated during the UI push; keep architecture boundaries intact                                                   |
| `E02`        | Statistics             | More accurate carrier-coefficient scenarios, more rooms/ticks                                                              |
| `E08`        | Public release prep    | Docs update, demo examples, gifs — before announcing in the official Discord                                               |

Order within "Now": bug waves (`E04`, `E06`) and the CLI/UI split (`E05`)
first — they unblock everything else; then `E03` features; `E01`/`E02` run in
parallel as hygiene; `E08` is the exit gate of this cycle.

## Next — mid-term

Pulled from the pre-UI roadmap and the architecture analysis (`road/analysis.md`):

- **Ergonomics of waiting** — `until.*` predicate helpers
  (`until.destroyed(room)`, `until.eventOccurred(...)`) to remove copy-pasted
  predicate bodies across scenarios.
- **Sampling helpers** — `world.sampleEvery(n, fn)` / metric collection
  helpers on top of the existing `onTick` hook; document the pattern in
  `docs/EXAMPLES.md`.
- **`capture` as a subcommand** — `npx screeps-integration-tests capture <name>`
  instead of the standalone `src/tools/capture-fixture.js`.
- **Multi-bot flexibility** — load different AI per bot in one world.
- **Test groups** — group scenarios and run by group.
- **Multi-room fixtures** — fixture support spanning several rooms; resolve
  ID collisions when fixtures are used across rooms.
- **Per-entity metrics** — metrics below the room level (per creep, per structure).
- **Bot code flattening** — a script to convert bot code into a flat
  structure for easier analysis.
- **Metrics tooling** — Excel export, better downstream comparison; improved
  bot metric regression control in scenarios (external/game domain — not a
  framework CI gate).
- **More standard events** — extend the event constants surface.

## Later — ideas

Directionally interesting, not scheduled:

- **World import from a real server** — copy rooms/objects from a live
  Screeps server into the mockup DB for realistic scenarios (high value,
  high complexity; see `road/analysis.md` §5.3).
- **Deeper replay** — compressed per-tick snapshots, replay sharing.
- **Debug console window** — richer interactive debugging beyond the
  current console panel (see backlog `0080`).

## Completed milestones

- npm publication, CI, branch protection
- Docs overhaul: GETTING-STARTED / API-REFERENCE / FIXTURES-GUIDE / EXAMPLES /
  INTEGRATION-TESTS / MULTI-ROOM-GUIDE / RUN-MODES / VIEWER
- `spec.*` builder rework, structure coverage, terrain customization
- Metrics pipeline with regression baselines
- Viewer UI: Scenario Manager, interactive world view, replay, snapshots
  (merged from `feat/UI`)
- Agent workflow: `backlog/` SSOT, conductor/implementer/reviewer roles,
  weeek.net retired (imported into `backlog/`)
