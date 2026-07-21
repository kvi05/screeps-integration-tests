# Multi-Room Guide

Working with multiple rooms and bots in a single scenario.

## Table of Contents

- [Minimal multi-room scenario](#minimal-multi-room-scenario)
- [Binding structures to a specific bot](#binding-structures-to-a-specific-bot)
- [Memory and event log](#memory-and-event-log)
- [ID collisions](#id-collisions)

## Minimal multi-room scenario

```javascript
const { createWorld, spec } = require('screeps-integration-tests');

const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      controller: spec.controller({ level: 4 }),
      sources: [spec.source(15, 15), spec.source(35, 35)],
      structures: [spec.spawn(25, 25), spec.tower(26, 24)],
    },
    {
      name: 'W0N2',
      controller: spec.controller({ level: 3 }),
      sources: [spec.source(20, 20)],
    },
  ],
  bots: [
    { username: 'Player1', room: 'W0N1', x: 25, y: 25 },
    { username: 'Player2', room: 'W0N2', x: 25, y: 25 },
  ],
});
```

After world creation:

- `world.rooms` — `Record<roomName, RoomStatus>`.
- `world.bots` — `Record<username, Bot>`. There is **no** `world.bot` field.

See also [`API-REFERENCE.md`](API-REFERENCE.md#createworld).

## Binding structures to a specific bot

`buildCanonicalRoom` automatically assigns `defaultBotUserId` (the first bot from `opts.bots`) to all structures without an explicit `userId`. In single-bot this is convenient, in multi-bot it is dangerous: the second bot will be left without a spawn.

Specify `userId` explicitly:

```javascript
{
  name: 'W0N2',
  controller: spec.controller({ level: 3 }),
  structures: [spec.spawn(25, 25, { userId: 'Player2' })],
}
```

> `world.spawn()` only creates creeps (see [API-REFERENCE.md](API-REFERENCE.md#2-worldinstance)).
> To create a structure after `createWorld()`, you must go directly through the DB:
>
> ```javascript
> const { db } = world.server.common.storage;
> await db['rooms.objects'].insert({
>   room: 'W0N2',
>   type: 'spawn',
>   x: 25,
>   y: 25,
>   user: world.bots['Player2'].id,
>   // ... remaining structure fields
> });
> ```

## Memory and event log

Reading and writing memory is **per bot**, not per room:

```javascript
const main = await world.readMemory('Player1');
await world.writeMemory('Player2', { flag: true });
```

`world.eventLog(room)` requires an explicit room name:

```javascript
const eventsW0N1 = await world.eventLog('W0N1');
const eventsW0N2 = await world.eventLog('W0N2');
```

Details — in [`API-REFERENCE.md`](API-REFERENCE.md#readmemorywritememory) and [`API-REFERENCE.md`](API-REFERENCE.md#eventlog).

## ID collisions

If a Room Fixture or `structures` hardcodes `id`, the same template cannot be used in multiple rooms of a single scenario: the server will reject the duplicate `id`.

Solutions:

- don't set `id` if you want to use a fixture in multiple rooms in one world;
- create separate fixtures for each room;
- generate `id` with a unique prefix if you need determinism.
