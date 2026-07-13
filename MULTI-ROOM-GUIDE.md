# Multi-Room Guide

Этот документ описывает, как описывать и работать с **несколькими комнатами** и **несколькими ботами** в integration framework.

## Содержание

- [Модель: комнаты и боты — отдельные сущности](#модель-комнаты-и-боты-отдельные-сущности)
- [Минимальный multi-room сценарий](#минимальный-multi-room-сценарий)
- [Минимальный multi-bot сценарий](#минимальный-multi-bot-сценарий)
- [Multi-room + multi-bot](#multi-room--multi-bot)
- [Управление памятью по ботам](#управление-памятью-по-ботам)
- [Spawn и event log](#spawn-и-event-log)
- [Ограничение: ID коллизии](#ограничение-id-коллизии)
- [Anti-patterns](#anti-patterns)

## Модель: комнаты и боты — отдельные сущности

В Screeps-онтологии:

| Screeps                                           | Framework                               |
| ------------------------------------------------- | --------------------------------------- |
| World (несколько комнат)                          | `world.rooms: Record<name, RoomStatus>` |
| Бот (один user, может жить в нескольких комнатах) | `world.bots: Record<username, Bot>`     |
| Creep конкретного бота                            | `creep.user === bots[username].id`      |
| Hostile creep                                     | `creep.user === '2'` (Invader)          |

## Минимальный multi-bot сценарий

```javascript
const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      controller: spec.controller({ level: 4 }),
      sources: [spec.source(15, 15), spec.source(35, 35)],
      structures: [spec.spawn(25, 25, { userId: bots.botMain.id }), spec.tower(26, 24, { userId: bots.botMain.id })],
    },
    {
      name: 'W0N2', // reserve room
      controller: spec.controller({ level: 3, userId: bots.botReserve.id }),
      sources: [spec.source(20, 20)],
    },
  ],
  bots: [
    { username: 'Player1', room: 'W0N1', x: 25, y: 25 },
    { username: 'Player2', room: 'W0N2', x: 25, y: 25 },
  ],
});
```

## Управление памятью по ботам

```javascript
const memory = await world.readMemory('mainBot');
const otherMemory = await world.readMemory('reserveBot');
```

Чтение памяти всех ботов сразу:

```javascript
for (const [username, bot] of Object.entries(world.bots)) {
  const mem = await world.readMemory(username);
}
```

`world.eventLog()` требует явную `room`:

```javascript
const eventsW0N1 = await world.eventLog('W0N1');
const eventsW0N2 = await world.eventLog('W0N2');

const allDestroyed = eventsW0N1.concat(eventsW0N2).filter((e) => e.event === EVENT_OBJECT_DESTROYED);
```

## Ограничение: ID коллизии

Если Memory Fixture содержит id объекта - нам нужно создать сценарий где будет объект с тем же id \
Если мы создаем Room Fixture в котором жестко кодируем id хотя бы у одного объекта - мы не можем использовать этот шаблон в нескольких комнатах в одном сценарии из-за коллизии id

## Anti-patterns

### Не полагайся на автопривязку userId в multi-bot

`buildCanonicalRoom` автоматически проставляет `defaultBotUserId` (первый бот из `opts.bots`) в структуры без явного `userId`. Это удобно для single-bot, но в multi-bot у каждого бота должен быть свой spawn/tower. Указывайте `userId` явно:

### Spawn — часть structures

Spawn — обычная структура комнаты. Указывается в `structures` через `spec.spawn()`. Если spawn не описан — он не появится.
