# Examples

Эталонные сценарии и типовые приёмы использования фреймворка.

> **Примечание:** некоторые рецепты (bootstrap, defense) взяты из личного
> бота и содержат bot-специфичные проверки (например, ожидаемые поля в
> `Memory`). Используйте их как идею, а не как готовый код — адаптируйте
> под свою архитектуру. Такие места помечены inline-меткой
> `[пример из личного бота]`.

## Содержание

- [1. Smoke: минимальная проверка запуска](#1-smoke-минимальная-проверка-запуска)
- [2. Bootstrap: рост колонии до RCL3](#2-bootstrap-рост-колонии-до-rcl3)
- [3. Defense: колония с tower](#3-defense-колония-с-tower)
- [4. Defense variation: та же колония без tower](#4-defense-variation-та-же-колония-без-tower)
- [5. Multi-room: main + reserve](#5-multi-room-main--reserve)
- [6. Metrics: multi-room time-series](#6-metrics-multi-room-time-series)
- [7. onTick + events + registerEvent](#7-ontick--events--registerevent)
- [8. memoryOverrides и прямое чтение БД](#8-memoryoverrides-и-прямое-чтение-бд)
- [9. Профилирование](#9-профилирование)
- [10. Паттерны](#10-паттерны)

## 1. Smoke: минимальная проверка запуска

Эталонный файл: `examples/scenarios/smoke-empty.scenario.js`

**Когда использовать:** проверить, что framework стартует и бот не падает.

**Вводит:** `createWorld`, `world.run()`, базовые assertions.

```javascript
const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      controller: spec.controller({ level: 1 }),
      sources: [spec.source(15, 15), spec.source(35, 35)],
      structures: [spec.spawn(25, 25)],
    },
  ],
  bots: [{ username: 'bot', room: 'W0N1' }],
  ticks: 30,
});

await world.run();
assertBotWorked(world.report);
assertNoErrors(world.report);
```

## 2. Bootstrap: рост колонии до RCL3

Эталонный файл: _отсутствует в репозитории фреймворка_ `[пример из личного бота]`

**Вводит:** остановка по условию (`until.predicate`), проверка RCL.

```javascript
const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      controller: spec.controller({ level: 2 }),
      sources: [spec.source(15, 15), spec.source(35, 35)],
      structures: [spec.spawn(25, 25)],
    },
  ],
  bots: [{ username: 'bot', room: 'W0N1' }],
  ticks: maxTicks,
  until: {
    maxTicks,
    predicate: async (w) => {
      const mem = await w.readMemory('bot');
      return mem.rooms?.W0N1?.controller?.level >= 3;
    },
  },
});
```

> `predicate` читает RCL из Memory — структура `Memory` зависит от вашего
> бота. `[пример из личного бота]`

## 3. Defense: колония с tower

Эталонный файл: _отсутствует в репозитории фреймворка_ `[пример из личного бота]`

**Вводит:** room fixture + memory fixture, runtime spawn, event-driven
завершение.

```javascript
const world = await createWorld({
  rooms: [{ name: ROOM_NAME, roomFixture: 'rcl3-stable' }],
  bots: [{ username: 'bot', room: ROOM_NAME }],
  memory: 'rcl3-stable',
  ticks: maxTicks,
  until: {
    maxTicks,
    predicate: async (w) => {
      const events = await w.eventLog(ROOM_NAME);
      return events.some((e) => e.event === EVENT_OBJECT_DESTROYED);
    },
  },
});

await world.spawn(spec.dummyTarget(10, 10, { roomName: ROOM_NAME }));
await world.tick(10);
await world.spawn(spec.invader(40, 40, { roomName: ROOM_NAME }));
await world.tick(maxTicks - 10);

assertBotWorked(world.report);
assertNoBotObjectDestroyed(world.report);
```

> `rcl3-stable` — пример имени fixture; в пакете fixtures не поставляются.

## 4. Defense variation: та же колония без tower

**Вводит:** `roomOverrides`.

```javascript
const world = await createWorld({
  rooms: [
    {
      name: ROOM_NAME,
      roomFixture: 'rcl3-stable',
      roomOverrides: {
        exclude: ['tower'],
        controller: { safeMode: 20000 },
        structures: [spec.extension(27, 24, { id: '53fca45601fe9dd', energy: 200 })],
      },
    },
  ],
  bots: [{ username: 'bot', room: ROOM_NAME }],
  memory: 'rcl3-stable',
});
```

## 5. Multi-room: main + reserve

**Вводит:** несколько комнат, per-bot memory map, явный `userId` в multi-bot.

```javascript
const world = await createWorld({
  rooms: [
    { name: 'W0N1', roomFixture: 'rcl3-stable' },
    {
      name: 'W0N2',
      controller: spec.controller({ level: 4 }),
      sources: [spec.source(20, 20)],
      // userId явно — иначе defaultBotUserId (первый бот)
      structures: [spec.container(5, 5, { userId: 'reserveBot' }), spec.spawn(25, 25, { userId: 'reserveBot' })],
    },
  ],
  bots: [
    { username: 'mainBot', room: 'W0N1' },
    { username: 'reserveBot', room: 'W0N2' },
  ],
  memory: {
    mainBot: 'rcl3-stable',
    reserveBot: { colonies: { W0N2: { stage: 'reserve' } } },
  },
  ticks: 100,
});

await world.run();
```

> В multi-bot всегда указывайте `userId` явно — иначе структуры привяжутся к
> первому боту. Подробнее — [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md).

## 6. Metrics: multi-room time-series

Эталонный файл: `examples/scenarios/metrics-multi-room.scenario.js`

**Вводит:** сбор метрик, query helpers, metric assertions.

```javascript
const { assertLatestMetricAtLeast } = require('screeps-integration-tests/metric-assertions');
const { getRoomMetrics, getWorldSnapshotAtTick } = require('screeps-integration-tests/metrics');

const world = await createWorld({
  rooms: [
    { name: 'W0N1', controller: spec.controller({ level: 2 }), sources: [spec.source(15, 15)] },
    { name: 'W0N2', controller: spec.controller({ level: 1 }), sources: [spec.source(20, 20)] },
  ],
  bots: [{ username: 'bot', room: 'W0N1' }],
  ticks: 10,
  metrics: { every: 1, rooms: true },
});

await world.run();

// Комнаты независимы — у каждой свои метрики
assertLatestMetricAtLeast(world.report, 'rooms', 'W0N1', 'rcl', 2);
assertLatestMetricAtLeast(world.report, 'rooms', 'W0N1', 'energyCapacity', 300);
assertLatestMetricAtLeast(world.report, 'rooms', 'W0N2', 'rcl', 1);

// Снимок мира на конкретном тике
const snapshot = getWorldSnapshotAtTick(world.report, 5);
assert.ok(snapshot.W0N1 && snapshot.W0N2);
```

## 7. onTick + events + registerEvent

**Вводит:** `onTick` callback, декларативные `events`, кастомный
`registerEvent`.

```javascript
let spawned = false;

const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      controller: spec.controller({ level: 3 }),
      sources: [spec.source(15, 15)],
      structures: [spec.spawn(25, 25), spec.tower(26, 24)],
    },
  ],
  bots: [{ username: 'bot', room: 'W0N1' }],
  ticks: 100,
  events: [{ atTick: 20, action: 'spawnInvader', params: { x: 40, y: 40, room: 'W0N1' } }],
  onTick: async (world, tick) => {
    if (tick === 30) {
      await world.spawn(spec.creep(25, 25, { roomName: 'W0N1', name: 'Defender' }));
      spawned = true;
    }
  },
});

// Кастомный обработчик: заполняет энергию турели до максимума
world.registerEvent('boostTower', async (server, room, params) => {
  const { db } = server.common.storage;
  const tower = await db['rooms.objects'].findOne({ room, type: 'tower' });
  if (tower) {
    await db['rooms.objects'].update({ _id: tower._id }, { $set: { store: { energy: tower.storeCapacityResource?.energy || 1000 } } });
  }
});

await world.run();
assert.ok(spawned);
```

> `world.spawn()` создаёт крипа в БД, но управлять им должен код вашего бота

## 8. memoryOverrides и прямое чтение БД

**Вводит:** `memoryOverrides`, per-bot memory map, `world.server.common.storage.db`.

```javascript
const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      controller: spec.controller({ level: 2 }),
      sources: [spec.source(15, 15)],
      structures: [spec.spawn(25, 25)],
    },
  ],
  bots: [{ username: 'bot', room: 'W0N1' }],
  memory: 'baseline',
  memoryOverrides: {
    bot: {
      flags: { testMode: true },
      colonies: { W0N1: { spawnQueue: ['harvester'] } },
    },
  },
  ticks: 10,
});

await world.run();

const { db } = world.server.common.storage;
const creeps = await db['rooms.objects'].find({ room: 'W0N1', type: 'creep' });
console.log(`spawned ${creeps.length} creeps`);
```

> `memoryOverrides` deep-merge'ится поверх `memory`. Массивы и примитивы
> заменяются, plain objects мержатся рекурсивно.

## 9. Профилирование

**Вводит:** `profiling: true`, чтение `report.profileCallgrind`.

```javascript
const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      controller: spec.controller({ level: 2 }),
      sources: [spec.source(15, 15)],
      structures: [spec.spawn(25, 25)],
    },
  ],
  bots: [{ username: 'bot', room: 'W0N1' }],
  ticks: 100,
  profiling: true,
});

await world.run();

const callgrind = world.report.profileCallgrind?.bot;
if (callgrind) {
  console.log('Profile captured');
}
```

> Требуется, чтобы в проекте бота был установлен `screeps-profiler` и
> `loop` обёрнут через `profiler.wrap()`. См. подробности в
> [API-REFERENCE.md](./API-REFERENCE.md#12-профилирование).

## 10. Паттерны

- `createWorld()` — единая точка setup.
- `try { ... } finally { await world.dispose(); }` — обязательно.
- `roomFixture` + `roomOverrides` — переиспользуйте комнаты локально.
- `world.bots[username]` — доступ к боту; singular `world.bot` не
  существует.
- `world.eventLog(room)` требует явную комнату.

## Связанные документы

- [GETTING-STARTED.md](./GETTING-STARTED.md) — быстрый старт
- [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md) — fixtures
- [API-REFERENCE.md](./API-REFERENCE.md) — полный API
- [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md) — multi-room
