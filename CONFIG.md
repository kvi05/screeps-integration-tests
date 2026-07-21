# Configuration

The framework looks for a `screeps-integration.config` file with extensions `.js`, `.json`, `.cjs`, `.mjs` in the current directory. The path can be set explicitly: `--config <path>`.

## Setting priority

From lowest to highest:

1. Built-in defaults
2. Config file
3. Environment variable `BOT_DIST_DIR` → `distDir`
4. CLI arguments
5. Explicit overrides from code

Relative paths are resolved from the config file's directory; if there is no config — from `cwd`.

## Schema

```js
module.exports = {
  distDir: './dist', // bot build; fallback: BOT_DIST_DIR, then ./dist
  scenariosDir: './scenarios', // *.scenario.js
  fixturesDir: './fixtures', // *.memory.json
  roomFixturesDir: null, // *.room.js; null = auto-load disabled
  profilesDir: './profiles', // callgrind profiles
  cacheDir: './.cache', // mockup server cache
  cacheKeep: 5, // how many recent caches to keep
  timeout: 30 * 60 * 1000, // timeout per scenario, ms
  jobs: Math.min(4, require('os').cpus().length), // parallel scenarios
  buildCommand: null, // only runs with --build
  require: [], // modules to require before scenarios
  env: {}, // env for worker processes
};
```

## CLI flags

| Flag                      | Description                                               |
| ------------------------- | --------------------------------------------------------- |
| `--config <path>`         | Path to config                                            |
| `--scenariosDir <dir>`    | Directory with scenarios                                  |
| `--distDir <dir>`         | Directory with bot build                                  |
| `--fixturesDir <dir>`     | Directory with memory fixtures                            |
| `--roomFixturesDir <dir>` | Directory with room fixtures                              |
| `--profilesDir <dir>`     | Directory for profiles                                    |
| `--cacheDir <dir>`        | Directory for server cache                                |
| `--only <name>`           | Run only one scenario by file name without `.scenario.js` |
| `--profiling`             | Enable callgrind profiling                                |
| `--bail`                  | Stop on first error                                       |
| `--timeout <int>`         | Timeout per scenario, ms                                  |
| `--jobs <int>`            | Number of parallel workers                                |
| `--build`                 | Execute `buildCommand` before running                     |

The timeout applies to each scenario individually; there is no global timeout.

## Example for a real bot

```js
'use strict';

module.exports = {
  distDir: './dist',
  scenariosDir: './inter_tests/scenarios',
  fixturesDir: './inter_tests/fixtures',
  roomFixturesDir: './inter_tests/room-fixtures',
  cacheDir: './inter_tests/.cache',
  profilesDir: './inter_tests/profiles',
  buildCommand: 'npm run build',
};
```

## Example for framework self-test

```js
'use strict';

module.exports = {
  distDir: './examples/mock-bot/dist',
  scenariosDir: './examples/scenarios',
  fixturesDir: './examples/fixtures',
  cacheDir: './examples/.cache',
  profilesDir: './examples/profiles',
};
```

See also [GETTING-STARTED.md](GETTING-STARTED.md) and [API-REFERENCE.md](API-REFERENCE.md).
