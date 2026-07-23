# Fixtures Guide

Guide to the `screeps-integration-tests` fixture model: room fixtures and memory fixtures.

## Table of Contents

- [1. Two types of fixtures](#1-two-types-of-fixtures)
- [2. Room fixtures](#2-room-fixtures)
- [3. Room overrides](#3-room-overrides)
- [4. Memory fixtures](#4-memory-fixtures)
- [5. Relationship between room fixture and memory fixture](#5-relationship-between-room-fixture-and-memory-fixture)
- [6. How to choose an approach](#6-how-to-choose-an-approach)
- [7. How to create a room fixture](#7-how-to-create-a-room-fixture)
- [8. How to create or update a memory fixture](#8-how-to-create-or-update-a-memory-fixture)
- [9. Recommendations and anti-patterns](#9-recommendations-and-anti-patterns)

## 1. Two types of fixtures

### Room fixture

Semantic spec of a room: controller, sources, structures, creeps. Answers the question: **"What world should exist in the room by scenario start?"**

### Memory fixture

JSON snapshot of the bot's `Memory`. Answers the question: **"What internal state should the bot start with?"**

### Key difference

| What          | Room fixture               | Memory fixture                                         |
| ------------- | -------------------------- | ------------------------------------------------------ |
| Describes     | World objects              | Bot's internal state                                   |
| Format        | Canonical spec             | JSON snapshot                                          |
| Where stored  | `*.room.js` (user-defined) | `fixtures/*.memory.json`                               |
| Main use case | Reusable room              | "Warmed up" bot state                                  |
| Connected via | `rooms[].roomFixture`      | `createWorld({ memory: 'name' })` or `memoryOverrides` |

## 2. Room fixtures

The framework **does not ship ready-made room fixtures**. The registry starts empty (`ROOM_FIXTURES = {}`), and `examples/fixtures/` only contains `.gitkeep`. Names like `rcl3-stable` in examples are illustrative.

### Public API

```javascript
const {
  registerRoomFixture,
  getRoomFixture,
  hasRoomFixture,
  loadRoomFixture,
  applyRoomOverrides,
} = require('screeps-integration-tests/room-fixtures');
```

See [API-REFERENCE.md](./API-REFERENCE.md#5-room-fixtures-api) for function details.

### Example of a custom fixture

```javascript
// fixtures/rooms/my-room.room.js
const { spec } = require('screeps-integration-tests');
const { registerRoomFixture } = require('screeps-integration-tests/room-fixtures');

registerRoomFixture('my-room', {
  controller: spec.controller({ level: 3, progress: 2146 }),
  sources: [spec.source(15, 15), spec.source(35, 35, { id: '4361a44a5fa1c06' })],
  structures: [
    spec.tower(26, 24),
    spec.extension(27, 24, { energy: 50 }),
    spec.container(23, 24, { id: '71faa48c085e889', energy: 1500 }),
    spec.road(24, 24),
  ],
  creeps: [],
});
```

`spec.controller` accepts `progress` but **does not** accept `progressTotal`.

### Auto-loading from a directory

Register fixtures automatically via config:

```javascript
// screeps-integration.config.js
module.exports = {
  roomFixturesDir: './fixtures/rooms',
};
```

Each `*.room.js` in that directory either calls `registerRoomFixture` or exports `{ name, fixture }`. Loading happens before the scenario runs.

### Manual registration in a scenario

```javascript
const { createWorld, spec } = require('screeps-integration-tests');
const { registerRoomFixture } = require('screeps-integration-tests/room-fixtures');

registerRoomFixture('quick-room', {
  controller: spec.controller({ level: 2 }),
  sources: [spec.source(15, 15)],
  structures: [spec.spawn(25, 25)],
});

const world = await createWorld({
  rooms: [{ name: 'W0N1', roomFixture: 'quick-room' }],
  bots: [{ username: 'bot', rooms: 'W0N1' }],
  ticks: 100,
});
```

### Usage in a scenario

```javascript
const world = await createWorld({
  rooms: [{ name: 'W0N1', roomFixture: 'my-room' }],
  bots: [{ username: 'bot', rooms: 'W0N1' }],
  ticks: 100,
});
```

### Why this is better than copying the layout

- one room is reused across multiple tests;
- layout changes are fixed in one place;
- the scenario describes a variation of behavior, not repeats the layout.

## 3. Room overrides

`roomOverrides` allows you to modify a fixture locally for a specific scenario without full copying.

### Supported override fields

| Field        | Purpose                                           |
| ------------ | ------------------------------------------------- |
| `exclude`    | Remove objects by `id`, `type` or template object |
| `controller` | Modify controller (merge)                         |
| `structures` | Override fields of existing structures            |
| `append`     | Add new structures                                |
| `creeps`     | Add own creeps                                    |
| `hostiles`   | Add hostile creeps                                |

### Example 1. Remove a tower

```javascript
const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      roomFixture: 'my-room',
      roomOverrides: { exclude: ['tower'] },
    },
  ],
  bots: [{ username: 'bot', rooms: 'W0N1' }],
});
```

`exclude` supports a string (`id` or `type`) or an object (`{ id }` / `{ type }`).

### Example 2. Modifying controller and energy extension

```javascript
const { createWorld, spec } = require('screeps-integration-tests');

const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      roomFixture: 'my-room',
      roomOverrides: {
        controller: { safeMode: 20000 },
        structures: [spec.extension(27, 24, { id: '53fca45601fe9dd', energy: 200 })],
      },
    },
  ],
  bots: [{ username: 'bot', rooms: 'W0N1' }],
});
```

### Example 3. Adding hostile creeps

```javascript
const { createWorld, spec } = require('screeps-integration-tests');

const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      roomFixture: 'my-room',
      roomOverrides: {
        hostiles: [spec.invader(10, 25, { name: 'Invader_1' })],
      },
    },
  ],
  bots: [{ username: 'bot', rooms: 'W0N1' }],
});
```

### When to use overrides instead of a new fixture

Use `roomOverrides` for local variations:

- remove one structure;
- change `safeMode`;
- tweak energy of a few objects;
- add one hostile creep.

Create a new room fixture if the base geometry of the room changes: a different layout or a different stage of development.

## 4. Memory fixtures

The framework **does not ship ready-made memory fixtures**. Create them yourself.

### Public API

```javascript
const { loadFixture, hasFixture, saveFixture, deepMergeMemory } = require('screeps-integration-tests/memory-fixtures');
```

See [API-REFERENCE.md](./API-REFERENCE.md#6-memory-fixtures-api) for details.

### When a memory fixture is needed

- the bot should start with an already known room and caches;
- task state must exist in `Memory`;
- the scenario starts after bootstrap, not from scratch.

### When a memory fixture is not needed

- you only need to describe the room layout — use a room fixture;
- the scenario starts with empty `Memory` and bootstrap runs naturally.

### Connection

```javascript
const world = await createWorld({
  rooms: [{ name: 'W0N1', roomFixture: 'my-room' }],
  bots: [{ username: 'bot', rooms: 'W0N1' }],
  memory: 'my-memory',
});
```

### Checking existence

```javascript
const { hasFixture } = require('screeps-integration-tests/memory-fixtures');

if (!hasFixture('my-memory')) {
  console.log('SKIP: memory fixture not found');
  return { skipped: true };
}
```

### Saving from code

```javascript
const { saveFixture } = require('screeps-integration-tests/memory-fixtures');

const memory = await world.readMemory('bot');
saveFixture('my-memory', memory, { force: true });
```

`saveFixture(name, memory, { force = true })`. By default overwrites existing file. \
This will save the Memory to the file specified in `screeps-integration.config`

## 5. Relationship between room fixture and memory fixture

Room fixtures and memory fixtures can be linked via `_id` of objects:

```javascript
spec.source(15, 15, { id: '94e8a44a5fa6113' });
```

If the memory fixture stores references to objects by `_id` (e.g., structure cache), changing the `_id` in the room fixture will break those references.

Tip: when needed, fix `_id` in the room fixture explicitly and keep them in sync with the memory fixture.

## 6. How to choose an approach

### Approach 1. Only spec (no fixture)

```javascript
createWorld({
  rooms: [
    {
      name: 'W0N1',
      controller: spec.controller({ level: 2 }),
      sources: [spec.source(15, 15)],
      structures: [spec.spawn(25, 25)],
    },
  ],
  bots: [{ username: 'bot', rooms: 'W0N1' }],
});
```

Suitable for quick tests without reuse.

### Approach 2. Room fixture

```javascript
createWorld({
  rooms: [{ name: 'W0N1', roomFixture: 'my-room' }],
  bots: [{ username: 'bot', rooms: 'W0N1' }],
});
```

Suitable if you reuse the same room.

### Approach 3. Room fixture + overrides

```javascript
createWorld({
  rooms: [
    {
      name: 'W0N1',
      roomFixture: 'my-room',
      roomOverrides: { exclude: ['tower'] },
    },
  ],
  bots: [{ username: 'bot', rooms: 'W0N1' }],
});
```

Suitable for local variations of one room.

### Approach 4. Fixture + memory

```javascript
createWorld({
  rooms: [{ name: 'W0N1', roomFixture: 'my-room' }],
  bots: [{ username: 'bot', rooms: 'W0N1' }],
  memory: 'my-memory',
});
```

Suitable for testing a fully developed colony.

## 7. How to create a room fixture

1. Create a `*.room.js` file in `roomFixturesDir` (or anywhere if registering manually).
2. Describe the room using `spec.*` constructors:
   - `spec.controller`
   - `spec.source`
   - `spec.spawn`
   - `spec.tower`
   - `spec.extension`
   - `spec.container`
   - `spec.storage`
   - `spec.road`
   - `spec.wall`
   - `spec.rampart`
   - `spec.creep`
   - `spec.invader`
   - `spec.dummyTarget`
3. Set `id` explicitly if needed to reference from a memory fixture.
4. Call `registerRoomFixture(name, fixture)` or export `{ name, fixture }`.
5. Use `roomFixture: 'name'` in `createWorld`.

## 8. How to create or update a memory fixture

To create memory fixtures, use the CLI tool `src/tools/capture-fixture.js`.

### Basic run

```bash
# First make sure smoke works
npm run test:integration:smoke

# Then create / rebuild the fixture
node src/tools/capture-fixture.js my-memory
```

### What the tool does

1. Runs the world until the target RCL.
2. Gives the bot extra ticks for stabilization.
3. Saves the final `Memory` to `fixtures/<name>.memory.json`.

### Flags

| Flag          | Default                                               | Purpose                        |
| ------------- | ----------------------------------------------------- | ------------------------------ |
| `--from`      | `bootstrap_with_anchor` (example from a personal bot) | Starting memory fixture        |
| `--rcl`       | `3`                                                   | Target RCL                     |
| `--ticks`     | `10000`                                               | Tick limit to reach RCL        |
| `--stabilize` | `2000`                                                | Extra ticks for stabilization  |
| `--room`      | `W0N1`                                                | Room name                      |
| `--sources`   | `[{"x":15,"y":15},{"x":35,"y":35}]`                   | Source positions (JSON)        |
| `--progress`  | `0`                                                   | Log every N ticks (0 = off)    |
| `--log-level` | `error`                                               | `all` / `error` / `warn`       |
| `--warn-size` | `50000`                                               | Size warning threshold (bytes) |
| `--force`     | `false`                                               | Allow overwrite                |

### Examples

```bash
node src/tools/capture-fixture.js my-memory

node src/tools/capture-fixture.js my-memory --rcl 5 --ticks 20000

node src/tools/capture-fixture.js my-memory --room W1N1 --force
```

## 9. Recommendations and anti-patterns

### Do this

- store room layout in a room fixture;
- store warmed-up bot state in a memory fixture;
- describe variations via `roomOverrides`;
- fix `_id` of objects if room fixture and memory fixture are linked.

### Don't do this

- don't store room layout in `*.memory.json`;
- don't create a new fixture for one small change if `roomOverrides` suffices;
- don't mix layers: world topology and runtime Memory.

## Related documents

- [API-REFERENCE.md](./API-REFERENCE.md) — full API reference
- [EXAMPLES.md](./EXAMPLES.md) — reference scenarios and patterns
- [GETTING-STARTED.md](./GETTING-STARTED.md) — quick start
- [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md) — multi-room and multi-bot
