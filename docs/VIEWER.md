# Viewer

Browser UI for watching and driving integration scenarios in real time:
Canvas 2D room rendering, live server controls, per-tick Memory inspection,
snapshots, and a Scenario Manager for launching runs.

The viewer is served by the CLI process itself (`--viewer`) — no extra
services. It lives under `src/tools/viewer/` and does not affect headless
runs.

## Launch

```bash
npx screeps-integration-tests --viewer                    # Scenario Manager
npx screeps-integration-tests --viewer --only smoke-empty # auto-launch one scenario
```

In this repository the same runs are wrapped as npm scripts:

```bash
npm run viewer                       # Scenario Manager (examples config)
npm run viewer -- --only smoke-empty # auto-launch one scenario
```

The CLI prints the URL (a free port is picked automatically; pin it with
`--viewerPort 3100` or `viewerPort` in the config) and blocks until
`Ctrl+C`.

> **First run fails with "Viewer UI is not built"?** The UI is a prebuilt
> Vite bundle in `src/tools/viewer/dist/`, and the bundle is **not** published
> to npm — it is built on the user side. In a repo checkout:
> `npm run viewer:build`. From the npm package, build the client inside
> `node_modules/screeps-integration-tests/src/tools/viewer/client`
> (`npm install && npm run build`) — the exact commands are printed by the
> error.

## Screens and panels

| Panel                | What it does                                                                        |
| -------------------- | ----------------------------------------------------------------------------------- |
| **Canvas stage**     | Rooms rendered per tick. Drag to pan, scroll to zoom, click a tile to select it.    |
| **Object Inspector** | Objects on the selected tile with full properties; type filter and search.          |
| **Console**          | Bot logs (`console` output) with level filter, search, and click-to-jump-to-tick.   |
| **Metrics**          | Metric charts (RCL, energy, creeps, tower…) via Chart.js + latest-values table.     |
| **MiniMap**          | Room overview; click to navigate between rooms.                                     |
| **Scenario Manager** | Lists `*.scenario.js` from `scenariosDir`; run one or all, headless or interactive. |

## Timeline, replay, snapshots

- The client keeps a **ring buffer** of recent frames (`viewerOptions.replayBuffer`,
  default 3000 ticks) — after a scenario ends (or crashes) you can still scrub
  and replay locally.
- **Rewind** restarts the server from an earlier tick within the buffered zone.
- **Save snapshot** writes the full world state to `snapshotsDir`
  (`--snapshotsDir` / config). Snapshots can be re-launched later from the
  Scenario Manager ("run from snapshot") — no scenario file needed.
- **Memory viewer** shows any bot's Memory at any buffered tick; the server
  reconstructs full Memory from keyframes + diffs, the client never sees diffs.

## Configuration

```js
// screeps-integration.config.js
module.exports = {
  viewer: false, // always start in viewer mode
  viewerPort: null, // fixed UI server port; null = auto
  viewerOptions: {
    paused: false, // start paused
    speed: 1000, // ticks per second (1000 ≈ max)
    keyframeInterval: 100, // full Memory snapshot every N ticks
    replayBuffer: 3000, // ticks kept in the replay ring buffer
  },
};
```

## Client development (HMR)

The viewer client is a separate Vite package (`src/tools/viewer/client/`).
To work on it with hot reload:

```bash
# terminal 1 — UI server on a pinned port
SIT_VIEWER_PORT=3100 npm run viewer -- --viewerPort 3100

# terminal 2 — Vite dev server on :5173, proxying /api and /snapshots
npm run viewer:dev
```

Open `http://localhost:5173`. The proxy target comes from `SIT_VIEWER_PORT`
(default `3100`).

## Troubleshooting

| Symptom                                | Fix                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `Viewer UI is not built` on `--viewer` | Build the client: `npm run viewer:build` (repo) or inside node_modules |
| Browser shows 404 / blank page         | Same — the prebuilt bundle is missing                                  |
| Dev server loads but no data           | `SIT_VIEWER_PORT` doesn't match the UI server port                     |
| Port already in use                    | Pass `--viewerPort <free-port>` or clear `viewerPort`                  |
