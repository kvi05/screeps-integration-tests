# Fixtures Guide

Guide to the `screeps-integration-tests` fixture model: room fixtures and memory fixtures.

## Table of Contents

- [1. Two types of fixtures](#1-two-types-of-fixtures)
- [2. Room fixtures](#2-room-fixtures)
- [3. Room overrides](#3-room-overrides)
- [4. Memory fixtures](#4-memory-fixtures)
- [5. Creating or updating a memory fixture](#5-creating-or-updating-a-memory-fixture)
- [6. Relationship between room fixture and memory fixture](#6-relationship-between-room-fixture-and-memory-fixture)
- [7. How to choose an approach](#7-how-to-choose-an-approach)

## 1. Two types of fixtures

### Room fixture

A declarative spec of a room: controller, sources, structures, creeps. Answers the question: **"What world should exist in the room by scenario start?"** Stored as a JS object built with `spec.*` constructors and registered by name.

### Memory fixture

A JSON snapshot of the bot's `Memory`. Answers the question: **"What internal state should the bot start with?"** Stored as a `*.memory.json` file and referenced by name.

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

See [API-REFERENCE.md '5. Room fixtures API'](./API-REFERENCE.md#5-room-fixtures-api) for function details.

### Example of a custom fixture

```javascript
// fixtures/rooms/my-room.room.js
const { spec } = require('screeps-integration-tests');

const myRoomFixture = {
  controller: spec.controller({ level: 3, progress: 2146 }),
  sources: [spec.source(15, 15), spec.source(35, 35, { id: '4361a44a5fa1c06' })],
  structures: [
    spec.tower(26, 24),
    spec.extension(27, 24, { energy: 50 }),
    spec.container(23, 24, { id: '71faa48c085e889', energy: 1500 }),
    spec.road(24, 24),
  ],
  creeps: [],
};
```

Register it via side-effect or export — both work, and you can even combine them (the loader simply calls `registerRoomFixture` twice with the same data, which is harmless):

```javascript
const { registerRoomFixture } = require('screeps-integration-tests/room-fixtures');
registerRoomFixture('my-room', myRoomFixture); // side-effect
module.exports = { name: 'my-room', fixture: myRoomFixture }; // export
```

### Auto-loading from a directory

Register fixtures automatically via config:

```javascript
// screeps-integration.config.js
module.exports = {
  roomFixturesDir: './fixtures/rooms',
};
```

All *.room.js files in that directory are loaded before the scenario runs \
and can be used immediately in the scenario.

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
  bots: [{ username: 'bot', rooms: ['W0N1'] }],
  ticks: 100,
});
```

### Usage in a scenario

```javascript
const world = await createWorld({
  rooms: [{ name: 'W0N1', roomFixture: 'my-room' }],
  bots: [{ username: 'bot', rooms: ['W0N1'] }],
  ticks: 100,
});
```

### Why this is better than copying the layout

- one room is reused across multiple tests;
- layout changes are fixed in one place;

## 3. Room overrides

`roomOverrides` allows you to modify a fixture locally for a specific scenario without full copying.

### Supported override fields

| Field        | Purpose                                                                                 |
| ------------ | --------------------------------------------------------------------------------------- |
| `exclude`    | Remove objects by `id`, `type` or template object                                       |
| `controller` | Modify controller (merge)                                                               |
| `structures` | Override fields of existing structures                                                  |
| `append`     | Add new structures                                                                      |
| `creeps`     | Add own creeps                                                                          |
| `hostiles`   | Add hostile creeps                                                                      |
| `terrain`    | Replace fixture terrain (see [Terrain](./API-REFERENCE.md#terrain) in API-REFERENCE.md) |

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
  bots: [{ username: 'bot', rooms: ['W0N1'] }],
});
```

`exclude` supports a string (`id` or `type`) or an object (`{ id }` / `{ type }`).

### Example 2. Modify controller and an extension

Only the `roomOverrides` object is shown — drop it into a `createWorld` call shaped like Example 1:

```javascript
roomOverrides: {
  controller: { safeMode: 20000 },
  structures: [spec.extension(27, 24, { id: '53fca45601fe9dd', energy: 200 })],
}
```

### Example 3. Add hostile creeps

```javascript
roomOverrides: {
  hostiles: [spec.invader(10, 25, { name: 'Invader_1' })],
}
```

### Example 4. Custom terrain

```javascript
roomOverrides: {
  terrain: { walls: [{ x: 5, y: 5 }], swamps: [] },
}
```

Terrain can also be set in the fixture itself — see [Terrain](./API-REFERENCE.md#terrain) in API-REFERENCE.md for all supported formats.

## 4. Memory fixtures

The framework **does not ship ready-made memory fixtures**. Create them yourself.

A memory fixture is a `*.memory.json` file containing a JSON snapshot of a bot's `Memory` — whatever your bot stores in `Memory`. The exact shape is bot-specific; a minimal illustrative fragment:

```json
{
  "rooms": {
    "W0N1": { "stage": "rcl3", "harvesters": 3 }
  }
}
```

### Public API

```javascript
const { loadMemoryFixture, hasMemoryFixture, saveMemoryFixture, deepMergeMemory } = require('screeps-integration-tests/memory-fixtures');
```

See [API-REFERENCE.md '6. Memory fixtures API'](./API-REFERENCE.md#6-memory-fixtures-api) for function details.

### Using a memory fixture in createWorld

The `memory` option accepts several forms:

- a **string** — fixture name (single-bot shorthand);
- an **object** `{ fixture: 'name', ...overrides }` — load a fixture and deep-merge inline overrides on top;
- an **inline object** — used directly as `Memory`;
- a **per-bot map** `{ username: <any of the above> }` — required for multi-bot scenarios.

```javascript
// single-bot: fixture name
const world = await createWorld({
  rooms: [{ name: 'W0N1', roomFixture: 'my-room' }],
  bots: [{ username: 'bot', rooms: ['W0N1'] }],
  memory: 'my-memory',
});

// single-bot: fixture + inline overrides
const world2 = await createWorld({
  rooms: [{ name: 'W0N1', roomFixture: 'my-room' }],
  bots: [{ username: 'bot', rooms: ['W0N1'] }],
  memory: { fixture: 'my-memory', flags: { testMode: true } },
});
```

For multi-bot, use a per-bot map — see [EXAMPLES.md §5](./EXAMPLES.md#5-multi-room-main--reserve) for a full example.

> Guard with `hasMemoryFixture(name)` before `createWorld` if the fixture may not exist:
>
> ```javascript
> const { hasMemoryFixture } = require('screeps-integration-tests/memory-fixtures');
> if (!hasMemoryFixture('my-memory')) {
>   console.log('SKIP: memory fixture not found');
>   return { skipped: true };
> }
> ```

### When to use a memory fixture

- the bot should start with an already known room and caches;
- you want reproducible runs without re-warming the bot from scratch.

### Memory overrides

`memoryOverrides` deep-merges on top of `memory`, letting you tweak a fixture locally for one scenario without copying it. For multi-bot, `memoryOverrides` is a per-bot map `{ username: patch }`.

Merge semantics (same as `deepMergeMemory`):

- plain objects are merged recursively;
- arrays and primitives are **replaced** by the patch value;
- `undefined` in the patch is **ignored** (does not erase the field);
- `null` in the patch **replaces** the field.

```javascript
const world = await createWorld({
  rooms: [{ name: 'W0N1', roomFixture: 'my-room' }],
  bots: [{ username: 'bot', rooms: ['W0N1'] }],
  memory: 'baseline',
  memoryOverrides: {
    bot: { flags: { testMode: true }, colonies: { W0N1: { spawnQueue: ['harvester'] } } },
  },
  ticks: 10,
});
```

See [EXAMPLES.md §8](./EXAMPLES.md#8-memoryoverrides-and-direct-db-access) for a full example with direct DB access.

#### When to use memoryOverrides vs a new fixture

Use `memoryOverrides` for local variations:

- flip a flag or toggle a mode;

## 5. Creating or updating a memory fixture

A memory fixture is just a JSON snapshot of a bot's `Memory`. The most flexible way to create one is to run a scenario, let the bot work, and save the resulting `Memory` to a file.

### Manual creation via scenario (recommended)

Use `world.readMemory()` to extract the bot's state at any point, then `saveMemoryFixture()` to persist it:

```javascript
// your.scenario.js
const { saveMemoryFixture } = require('screeps-integration-tests/memory-fixtures');

const memory = await world.readMemory('bot');
saveMemoryFixture('my-bot-rcl3', memory);
```

`saveMemoryFixture` overwrites by default; pass `{ force: false }` to refuse overwriting an existing file.

This approach gives you full control:

- use any room fixture, overrides, or multi-room setup;
- stop at a custom predicate instead of a fixed RCL;
- save multiple fixtures for different bots in one run.

### CLI tool (convenience wrapper)

For simple cases, `src/tools/capture-fixture.js` provides a ready-made scenario that does exactly what the manual approach does, but with pre-set defaults:

1. Runs the world until the target RCL is reached.
2. Gives the bot extra ticks for stabilization.
3. Saves the final `Memory` to `fixtures/<name>.memory.json`.

It is essentially a CLI wrapper around the manual workflow. It works well for a quick snapshot from a single-room, single-bot run with standard sources, but it is narrow:

- room is hard-coded to `W0N1` (or overridden via `--room`);
- only one bot is supported;
- no custom room fixtures or overrides;
- no arbitrary stop conditions beyond RCL.

The CLI accepts flags for the target RCL (`--rcl`), tick limits (`--ticks`, `--stabilize`), room (`--room`), source positions (`--sources`), and logging (`--progress`, `--log-level`). Run `node src/tools/capture-fixture.js --help` for the full list.

```bash
node src/tools/capture-fixture.js my-memory

node src/tools/capture-fixture.js my-memory --rcl 5 --ticks 20000
```

## 6. Relationship between room fixture and memory fixture

Room fixtures and memory fixtures can be linked via `_id` of objects:

```javascript
spec.source(15, 15, { id: '94e8a44a5fa6113' });
```

If the memory fixture stores references to objects by `_id`, changing the `_id` in the room fixture will break those references.

> When needed, fix `_id` in the room fixture explicitly and keep them in sync with the memory fixture.

## 7. How to choose an approach

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
  bots: [{ username: 'bot', rooms: ['W0N1'] }],
});
```

### Approach 2. Room fixture

```javascript
createWorld({
  rooms: [{ name: 'W0N1', roomFixture: 'my-room' }],
  bots: [{ username: 'bot', rooms: ['W0N1'] }],
});
```

### Approach 3. Room fixture + overrides + memory

```javascript
createWorld({
  rooms: [
    {
      name: 'W0N1',
      roomFixture: 'my-room',
      roomOverrides: { exclude: ['tower'] },
    },
  ],
  bots: [{ username: 'bot', rooms: ['W0N1'] }],
  memory: 'my-memory',
});
```

> For several bots, use a per-bot map: `memory: { bot: 'my-memory', ... }` — see [§4](#4-memory-fixtures).

## Related documents

- [API-REFERENCE.md](./API-REFERENCE.md) — full API reference
- [EXAMPLES.md](./EXAMPLES.md) — reference scenarios and patterns
- [CONFIG.md](./CONFIG.md) — config file and CLI flags (incl. `memoryFixturesDir`, `roomFixturesDir`)
- [GETTING-STARTED.md](./GETTING-STARTED.md) — quick start
- [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md) — multi-room and multi-bot
