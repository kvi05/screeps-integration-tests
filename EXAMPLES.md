# Examples

Этот документ показывает эталонные сценарии и типовые способы проверки поведения бота.

> **Note:** после выноса фреймворка в отдельный npm-пакет bot-специфичные сценарии
> (bootstrap, defense) переехали в репозиторий бота (`inter_tests/scenarios/`).
> В этом репозитории остались универсальные примеры (`examples/scenarios/`),
> на которых фреймворк самотестируется.

## Содержание

- [1. Smoke: минимальная проверка запуска](#1-smoke-минимальная-проверка-запуска)
- [2. Bootstrap: рост колонии до RCL3](#2-bootstrap-рост-колонии-до-rcl3)
- [3. Defense: реальная колония с tower](#3-defense-реальная-колония-с-tower)
- [4. Defense variation: та же колония без tower](#4-defense-variation-та-же-колония-без-tower)
- [5. Multi-room: main + reserve](#5-multi-room-main--reserve)
- [6. Multi-bot: два игрока в одной комнате](#6-multi-bot-два-игрока-в-одной-комнате)
- [7. Metrics: multi-room time-series](#7-metrics-multi-room-time-series)
- [8. Каких паттернов придерживаться](#8-каких-паттернов-придерживаться)

## 1. Smoke: минимальная проверка запуска

Эталонный файл: `examples/scenarios/smoke-empty.scenario.js`

### Когда использовать

- проверить, что framework вообще стартует;
- проверить, что бот делает тики и не падает;
- быстро валидировать окружение.

### Что демонстрирует

- минимальный `createWorld()` с одной комнатой и одним ботом;
- простой `world.run()`;
- базовые assertions.

### Ключевой паттерн

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

### Почему это эталон

Самый короткий сценарий, который показывает полный happy path:

- создать мир (multi-room-ready, но с одной комнатой);
- прогнать тики;
- проверить, что бот работает.

## 2. Bootstrap: рост колонии до RCL3

Эталонный файл: `test/integration/scenarios/bootstrap-rcl2-to-rcl3.scenario.js`

### Когда использовать

- проверить прогресс колонии;
- протестировать bootstrap-логику;
- завершать сценарий не по фиксированному числу тиков, а по условию.

### Что демонстрирует

- predicate-based termination;
- проверку `RCL >= N`;

### Ключевой паттерн

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

> Учесть: в `predicate` читает уровень контроллера из Memory, а не из реального объекта.

## 3. Defense: реальная колония с tower

Эталонный файл: `test/integration/scenarios/defense-invader-rcl3.scenario.js`

### Когда использовать

- нужен почти реальный боевой сценарий;
- хочется переиспользовать готовую комнату;
- важно протестировать связку room fixture + memory fixture.

### Что демонстрирует

- `roomFixture: 'rcl3-stable'`;
- `memory: 'rcl3-stable'`;
- поэтапный `world.tick()`;
- runtime spawn hostile creep;
- event-driven завершение;
- assertions для боевого сценария.

### Ключевой паттерн

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
assertInvaderKilled(world.report, invaderId);
assertNoBotObjectDestroyed(world.report);
assertBotUserNotDamaged(world.report, world.bots.bot.id);
```

Это пример сценария высокого уровня:

- setup описан декларативно;
- действия читаются последовательно;
- проверки отражают смысл сценария;
- нет прямых DB-записей.

> Про загрузку заранее подготовленной колонии: [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md)

## 4. Defense variation: та же колония без tower

Эталонный файл: `test/integration/scenarios/defense-invader-rcl3-no-tower.scenario.js`

### Когда использовать

- нужен тот же baseline, но с локальными вариациями;
- не хочется копировать всю room spec заново.

### Что демонстрирует

- `roomOverrides.exclude`;
- `roomOverrides.controller`;
- `roomOverrides.structures`;
- reuse одной room fixture для нескольких сценариев.

### Ключевой паттерн

```javascript
const world = await createWorld({
  rooms: [
    {
      name: ROOM_NAME,
      roomFixture: 'rcl3-stable',
      // Вносим изменения в заренее подготовленную комнату
      roomOverrides: {
        exclude: ['tower'],
        controller: { safeMode: 20000 },
        structures: [spec.extension(27, 24, { id: '53fca45601fe9dd', energy: 500 })],
      },
    },
  ],
  bots: [{ username: 'bot', room: ROOM_NAME }],
  memory: 'rcl3-stable',
});
```

## 5. Multi-room: main + reserve

```javascript
const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      roomFixture: 'rcl3-stable',
      // контроллер и объекты — из fixture
    },
    {
      name: 'W0N2', // reserve room
      controller: spec.controller({ level: 4, userId: 'reserveBot' }),
      sources: [spec.source(20, 20)],
      structures: [spec.container(5, 5, { userId: 'reserveBot' })],
    },
  ],
  bots: [
    { username: 'mainBot', room: 'W0N1' },
    { username: 'reserveBot', room: 'W0N2' },
  ],
  ticks: 100,
});

await world.run();
```

## 6. Multi-bot: два игрока в одной комнате

```javascript
const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      controller: spec.controller({ level: 3 }),
      sources: [spec.source(15, 15), spec.source(35, 35)],
    },
  ],
  bots: [
    { username: 'player1', room: 'W0N1' },
    { username: 'player2', room: 'W0N1' },
  ],
});

const { bots } = world;

await world.spawn(spec.creep(10, 10, { roomName: 'W0N1', userId: bots['player1'].id, name: 'P1_Harvester' }));

await world.spawn(spec.creep(20, 20, { roomName: 'W0N1', userId: bots['player2'].id, name: 'P2_Harvester' }));
```

## 7. Metrics: multi-room time-series

Эталонный файл: `examples/scenarios/metrics-multi-room.scenario.js`

### Когда использовать

- проверить, что метрики двух комнат не смешиваются;
- проверить структуру `report.metrics`;
- убедиться, что `getWorldSnapshotAtTick` корректно собирает снимок мира.

### Ключевой паттерн

```javascript
const { assertLatestMetricAtLeast } = require('screeps-integration-tests/metric-assertions');
const { getWorldSnapshotAtTick, getRoomMetrics } = require('screeps-integration-tests/metrics');

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

// Series комнат независимы.
assert.strictEqual(getRoomMetrics(world.report, 'W0N1').length, 10);
assert.strictEqual(getRoomMetrics(world.report, 'W0N2').length, 10);

assertLatestMetricAtLeast(world.report, 'rooms', 'W0N1', 'rcl', 2);

// Снимок мира на конкретном тике.
const snapshot = getWorldSnapshotAtTick(world.report, 5);
assert.ok(snapshot.W0N1 && snapshot.W0N2);
```

## 8. Каких паттернов придерживаться

- использовать `createWorld()` как единую точку setup;
- не писать напрямую в БД mockup, если это не low-level framework test;
- описывать комнату через `roomFixture` или inline spec;
- использовать `roomOverrides`, если сценарий отличается локально;
- обязательно вызывать `world.dispose()` в `finally`;
- явно указывать `roomName` и `userId` для `world.spawn()`, `room` для `world.eventLog()`, `username` для `world.readMemory()`;
- не полагаться на `world.bot` (singular) — теперь только `world.bots`.

## Связанные документы

- [GETTING-STARTED.md](./GETTING-STARTED.md) — быстрый старт
- [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md) — fixtures подробно
- [API-REFERENCE.md](./API-REFERENCE.md) — полный API
- [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md) — multi-room и multi-bot паттерны
