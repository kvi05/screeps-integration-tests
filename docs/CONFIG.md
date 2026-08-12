# Configuration

The framework looks for a `screeps-integration.config` file with extensions `.js`, `.json`, `.cjs`, `.mjs` in the current directory. \
The path can be set explicitly: `--config <path>`.

## Setting priority

From lowest to highest:

1. Built-in defaults
2. Config file
3. Environment variables:
   - `BOT_DIST_DIR` → `distDir`
   - `SIT_MEMORY_FIXTURES_DIR` → `memoryFixturesDir` (read by `lib/builders/memory.js`; also set by CLI from config)
   - `SIT_CACHE_DIR` → `cacheDir` (read by `lib/orchestration/world.js` and `src/tools/clean-cache.js`; also set by CLI from config)
   - `SIT_SNAPSHOTS_DIR` → `snapshotsDir` (read by `lib/orchestration/world.js`; set for workers by the CLI from config)
4. CLI arguments
5. Explicit overrides from code

Relative paths are resolved **from the config file's directory**; if there is no config — from `cwd`.

## Schema

```js
module.exports = {
  distDir: './dist', // bot modules; fallback: BOT_DIST_DIR, then ./dist
  scenariosDir: './scenarios', // *.scenario.js
  snapshotsDir: './snapshots', // saved world snapshots (*.json)
  memoryFixturesDir: './fixtures', // *.memory.json
  roomFixturesDir: null, // *.room.js; null = auto-load disabled
  profilesDir: './profiles', // callgrind profiles
  cacheDir: './.cache', // mockup server cache
  cacheKeep: 5, // how many recent caches to keep
  timeout: 30 * 60 * 1000, // timeout per scenario, ms
  jobs: Math.min(4, require('os').cpus().length), // parallel scenarios
  buildCommand: null, // executable shell command; runs only with --build
  require: [], // modules to require before scenarios
  env: {}, // env for worker processes
  viewer: false, // always run in UI mode (--viewer flag)
  viewerOptions: {
    // fine-tuning for viewer mode (partial override ok)
    paused: false, // start paused
    speed: 1000, // ticks/second (1000 = realtime)
    keyframeInterval: 100, // full Memory snapshot every N ticks
    replayBuffer: 3000, // max frames/ticks in ring buffers
  },
};
```

> `keyframeInterval` - _(Most likely there will be no need to change it)_ How often (in ticks) a **full** bot Memory snapshot is sent from the worker to the parent process. \
> Between keyframes only the **diff** (JSON Patch — what changed since the previous tick) is transmitted via IPC. The parent stores both in a ring buffer. When the client requests Memory (`GET /api/memory`), the **server** reconstructs the full Memory by finding the nearest keyframe and replaying deltas forward. The client always receives a complete Memory object — it never processes diffs.

### `distDir`

Path to a **flat directory of compiled bot modules**. The framework reads every
`*.js` file from this directory and uploads each one as a separate Screeps
module, exactly as the game loads them.

**No subdirectories** are supported inside `distDir`; the expected layout is:

```
dist/
  main.js
  role.harvester.js
  utils.js
  ...
```

### `buildCommand`

You can insert **your** **executable shell command** here, which will be executed once before run tests scenarios. \
It was designed to run **your** own bot **build scripts**, but you can use it however you like.

Typical values:

- `npm run build`
- `grunt`
- `node build.js`

#### Working directory

`buildCommand` runs from the directory where you run the CLI command, not from
the directory where the config file is located.

If your config file is in a subdirectory, either run the CLI from that
subdirectory or add a directory change to the command:

```js
buildCommand: 'cd ./my-bot && npm run build',
```

Example workflow:

```bash
# buildCommand is set in the config
npx screeps-integration-tests --build
```

> If you already have a ready `dist/` directory, leave `buildCommand` as
> `null` and run the framework without `--build`.

## CLI flags

| Flag                        | Description                                               |
| --------------------------- | --------------------------------------------------------- |
| `--help`/ `-h`              | -                                                         |
| `--version`/ `-v`           | Print the framework version                               |
| `--config <path>`           | Path to config                                            |
| `--scenariosDir <dir>`      | Directory with scenarios                                  |
| `--distDir <dir>`           | Bot `dist/` directory (flat compiled `.js` modules)       |
| `--memoryFixturesDir <dir>` | Directory with memory fixtures                            |
| `--roomFixturesDir <dir>`   | Directory with room fixtures                              |
| `--profilesDir <dir>`       | Directory for profiles                                    |
| `--cacheDir <dir>`          | Directory for server cache                                |
| `--only <name>`             | Run only one scenario by file name without `.scenario.js` |
| `--profiling`               | Enable callgrind profiling                                |
| `--bail`                    | Stop on first error                                       |
| `--timeout <int>`           | Timeout per scenario, ms                                  |
| `--jobs <int>`              | Number of parallel workers                                |
| `--build`                   | Run the configured `buildCommand` before scenarios        |

The timeout applies to each scenario individually; there is no global timeout.

## Example for a real bot

```js
'use strict';

module.exports = {
  distDir: './dist',
  scenariosDir: './inter_tests/scenarios',
  memoryFixturesDir: './inter_tests/fixtures',
  roomFixturesDir: './inter_tests/room-fixtures',
  cacheDir: './inter_tests/.cache',
  profilesDir: './inter_tests/profiles',
  buildCommand: 'npm run build', // must produce the flat ./dist directory
};
```

## Example for framework self-test

```js
'use strict';

module.exports = {
  distDir: './examples/mock-bot/dist',
  scenariosDir: './examples/scenarios',
  memoryFixturesDir: './examples/fixtures',
  cacheDir: './examples/.cache',
  profilesDir: './examples/profiles',
};
```

See also [GETTING-STARTED.md](GETTING-STARTED.md) and [API-REFERENCE.md](API-REFERENCE.md).
