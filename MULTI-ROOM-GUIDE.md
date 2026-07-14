# Multi-Room Guide

Работа с несколькими комнатами и ботами в одном сценарии.

## Содержание

- [Минимальный multi-room сценарий](#минимальный-multi-room-сценарий)
- [Привязка структур к конкретному боту](#привязка-структур-к-конкретному-боту)
- [Память и event log](#память-и-event-log)
- [ID коллизии](#id-коллизии)

## Минимальный multi-room сценарий

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

После создания мира:

- `world.rooms` — `Record<roomName, RoomStatus>`.
- `world.bots` — `Record<username, Bot>`. Поля `world.bot` **нет**.

См. также [`API-REFERENCE.md`](API-REFERENCE.md#createworld).

## Привязка структур к конкретному боту

`buildCanonicalRoom` автоматически назначает `defaultBotUserId` (первый бот из `opts.bots`) всем структурам без явного `userId`. В single-bot это удобно, в multi-bot — опасно: второй бот останется без spawn.

Указывайте `userId` явно:

```javascript
{
  name: 'W0N2',
  controller: spec.controller({ level: 3 }),
  structures: [spec.spawn(25, 25, { userId: 'Player2' })],
}
```

> `world.spawn()` создаёт только крипов (см. [API-REFERENCE.md](API-REFERENCE.md#2-worldinstance)).
> Создать структуру после `createWorld()` можно только напрямую через БД:
>
> ```javascript
> const { db } = world.server.common.storage;
> await db['rooms.objects'].insert({
>   room: 'W0N2',
>   type: 'spawn',
>   x: 25,
>   y: 25,
>   user: world.bots['Player2'].id,
>   // ... остальные поля структуры
> });
> ```

## Память и event log

Чтение и запись памяти — **по боту**, не по комнате:

```javascript
const main = await world.readMemory('Player1');
await world.writeMemory('Player2', { flag: true });
```

`world.eventLog(room)` требует явного имени комнаты:

```javascript
const eventsW0N1 = await world.eventLog('W0N1');
const eventsW0N2 = await world.eventLog('W0N2');
```

Детали — в [`API-REFERENCE.md`](API-REFERENCE.md#readmemorywritememory) и [`API-REFERENCE.md`](API-REFERENCE.md#eventlog).

## ID коллизии

Если Room Fixture или `structures` жёстко кодируют `id`, один и тот же шаблон нельзя использовать в нескольких комнатах одного сценария: сервер отклонит дублирующийся `id`.

Решения:

- не задавайте `id` если хотите использовать fixture в нескольких комнатах в одном мире;
- создавайте отдельные fixture для каждой комнаты;
- генерируйте `id` с уникальным префиксом, если нужен детерминизм.
