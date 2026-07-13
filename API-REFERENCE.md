# API Reference

Справочник по основным API integration framework.

## Содержание

- [1. Главная точка входа: createWorld](#1-главная-точка-входа-createworld)
- [2. WorldInstance: что умеет созданный мир](#2-worldinstance-что-умеет-созданный-мир)
- [3. Preferred API: builders/spec](#3-preferred-api-buildersspec)
- [4. Preferred API: materialize](#4-preferred-api-materialize)
- [5. Room fixtures API](#5-room-fixtures-api)
- [6. Memory fixtures API](#6-memory-fixtures-api)
- [7. Assertions API](#7-assertions-api)
- [8. Metrics API](#8-metrics-api)
- [9. Основные типы](#9-основные-типы)

## 1. Главная точка входа: createWorld

`createWorld(opts)` — главный orchestration API. Создаёт multi-room runtime с произвольным числом ботов, materialize-ит объекты (контроллер, источники, структуры, крипы), загружает bot code, записывает per-bot memory.

> **Важно:** spawn — обычная структура комнаты. Если сценарию нужен spawn — укажите его в `structures: [spec.spawn(25, 25)]`.

### Минимальный пример

```javascript
const { createWorld } = require('../lib/world');
const spec = require('../lib/builders/spec');

const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      controller: spec.controller({ level: 2 }),
      sources: [spec.source(15, 15)],
      // spawn — обычная структура, указывается явно:
      structures: [spec.spawn(25, 25)],
    },
  ],
  bots: [{ username: 'bot', room: 'W0N1' }],
  ticks: 100,
  profiling: false,
  logLevel: 'errors',
});
```

### Полный пример с fixture

```javascript
const { createWorld } = require('../lib/world');
const spec = require('../lib/builders/spec');

const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      roomFixture: 'rcl3-stable',
      roomOverrides: {
        exclude: ['tower'],
        controller: { safeMode: 20000 },
      },
    },
  ],
  bots: [{ username: 'bot', room: 'W0N1' }],
  memory: 'rcl3-stable',
  ticks: 200,
});
```

> _Используется заранее описанная колония/комната c перезаписью отдельный объектов_

### Опции createWorld

| Опция             | Тип                         | Назначение                                                                              |
| ----------------- | --------------------------- | --------------------------------------------------------------------------------------- |
| `rooms`           | `RoomSpecInput[]`           | Спецификации комнат (обязательно, минимум 1)                                            |
| `bots`            | `BotInput[]`                | Боты: `[{ username, room, x?, y?, modules? }]`                                          |
| `memory`          | `MemoryInput\|MemoryByBot`  | Базовая стартовая Memory: shorthand для single-bot или map по username                  |
| `memoryOverrides` | `Object\|MemoryByBot`       | Deep-merge патчи поверх `memory`; без базы становятся initial memory сами               |
| `ticks`           | `number=100`                | Мягкий лимит: `run()` не превышает его, `tick()` игнорирует                             |
| `profiling`       | `boolean=false`             | Включить screeps-profiler. Сделать профилирование см.                                   |
| `logLevel`        | `'silent'\|'errors'\|'all'` | Собираемые логи                                                                         |
| `metricsEvery`    | `number=0`                  | Устаревший shorthand для `metrics.every`                                                |
| `metrics`         | `MetricsOpts`               | Настройки сбора метрик `{ every, rooms, colonies, bots, world }`                        |
| `until`           | `UntilOpts`                 | Жёсткое условие досрочного завершения. `until.maxTicks` уважается и `run()`, и `tick()` |
| `onTick`          | `Function`                  | Callback на каждом тике                                                                 |
| `events`          | `EventSpec[]`               | Декларативные события по тикам                                                          |

### UntilOpts (жёсткое условие)

| Поле        | Тип        | Описание                                                                                                                                                              |
| ----------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxTicks`  | `number`   | Жёсткий лимит тиков. `ticksRun >= maxTicks` → остановка. Уважается и `run()`, и `tick()`. Не путать с `createWorld().ticks` (мягкий лимит, влияет только на `run()`). |
| `predicate` | `Function` | `async (world) => boolean`. Выполняется на каждом тике. Если вернула `true` → остановка.                                                                              |
| `signal`    | `string`   | Имя поля в Memory бота. Если стало truthy → остановка.                                                                                                                |
| `signalBot` | `string`   | Имя бота для проверки `signal`. Если не указан — проверяются все боты.                                                                                                |

Подробнее про multi-room паттерны — [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md).

## 2. WorldInstance: что умеет созданный мир

_`createWorld()` возвращает `WorldInstance`._

### Методы

| Метод                                                 | Назначение                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `world.run()`                                         | Прогнать сценарий до конца и вернуть report                                                              |
| `world.tick(n)`                                       | Выполнить `n` тиков. Уважает `until.maxTicks` (жёсткий лимит), игнорирует `createWorld().ticks` (мягкий) |
| `world.exec(code, username?)`                         | Выполнить JS-код в боте (по username)                                                                    |
| `world.spawn({ roomName, x, y, userId, name, body })` | Создать крипа (roomName обязателен, userId по умолч. первый бот)                                         |
| `world.eventLog(room)`                                | Прочитать event log комнаты                                                                              |
| `world.readMemory(username)`                          | Прочитать Memory бота по username                                                                        |
| `world.writeMemory(username, patch)`                  | Обновить Memory бота                                                                                     |
| `world.registerEvent(action, handler)`                | Зарегистрировать обработчик события                                                                      |
| `world.dispose()`                                     | Остановить сервер и освободить ресурсы                                                                   |

### Поля

| Поле             | Назначение                                           |
| ---------------- | ---------------------------------------------------- |
| `world.report`   | Накопленный отчёт о прогоне                          |
| `world.server`   | Экземпляр ScreepsServer                              |
| `world.bots`     | Боты по `username` (`Record<username, Bot>`)         |
| `world.rooms`    | Статус комнат по `name` (`Record<name, RoomStatus>`) |
| `world.disposed` | disposed?                                            |

### Примеры

#### Пошаговый прогон

```javascript
await world.tick(10);
// await world.spawn({ roomName: 'W0N1', x: 10, y: 10, userId: world.bots.bot.id, name: 'DummyTarget' });
await world.spawn(spec.dummyTarget(10, 10, { roomName: ROOM_NAME }));
await world.tick(40);
```

#### Работа с Memory

```javascript
const memory = await world.readMemory('bot');
await world.writeMemory('bot', { test: { enabled: true } });
```

#### Event log для конкретной комнаты

```javascript
const events = await world.eventLog('W0N1');
const destroyed = events.some((e) => e.event === 2);
```

## 3. Preferred API: builders/spec

`spec` — набор чистых конструкторов canonical spec-объектов. **Не знают** о БД и сервере — только создают plain objects с дефолтами.

```javascript
const spec = require('../lib/builders/spec');
```

Все конструкторы принимают `roomName` (опционально) — чтобы материализатор знал, куда положить объект. По умолчанию `roomName = undefined` и его нужно установить явно (либо из room-петли, либо через `applyColonyOverrides`-подобные помощники).

### Структуры

| Функция                            | Назначение                |
| ---------------------------------- | ------------------------- |
| `spec.structure(type, x, y, opts)` | Универсальный конструктор |
| `spec.spawn(x, y, opts)`           | Spawn                     |
| `spec.tower(x, y, opts)`           | Tower                     |
| `spec.extension(x, y, opts)`       | Extension                 |
| `spec.container(x, y, opts)`       | Container                 |
| `spec.storage(x, y, opts)`         | Storage                   |
| `spec.road(x, y, opts)`            | Road                      |
| `spec.wall(x, y, opts)`            | Constructed wall          |

`opts` для структур:

- `roomName?: string` — имя комнаты
- `userId?: string` — владелец (явно; **никаких автодефолтов**)
- `id?: string` — конкретный `_id` (для memory fixture)
- `name?: string` — имя (для spawn)
- `energy?, energyCapacity?, storeCapacity?, hits?, hitsMax?, notifyWhenAttacked?`
- `overrides?: Object` — произвольные дополнительные поля для БД

```javascript
spec.spawn(25, 25, { roomName: 'W0N1', name: 'MySpawn', userId: botId, energy: 300 });
spec.tower(26, 24, { roomName: 'W0N1', userId: botId, energy: 1000, energyCapacity: 1000 });
spec.road(24, 24, { roomName: 'W0N1' });
```

### Источники и controller

```javascript
spec.source(15, 15, { roomName: 'W0N1', energy: 3000 });
spec.controller({ roomName: 'W0N1', level: 3, safeMode: 20000, userId: botId });
```

### Крипы

| Функция                        | Назначение                      |
| ------------------------------ | ------------------------------- |
| `spec.creep(x, y, opts)`       | Обычный creep                   |
| `spec.invader(x, y, opts)`     | Invader (`userId: '2'`)         |
| `spec.dummyTarget(x, y, opts)` | Dummy target для defense-тестов |

`opts` для крипов:

- `roomName?: string`
- `userId?: string` — `_id` бота или `'2'` для invader
- `name?: string`
- `body?: BodyPart[]`

```javascript
spec.creep(10, 10, { roomName: 'W0N1', userId: botId, name: 'Harvester1' });
spec.invader(40, 41, { roomName: 'W0N1', name: 'Invader_1' });
spec.dummyTarget(12, 12, { roomName: 'W0N1', name: 'DummyTarget' });
```

## 4. Preferred API: materialize

`materialize*` — единственный слой, знающий DB shape (`rooms.objects`, `users.code`).

```javascript
const {
  materializeStructure,
  materializeStructures,
  materializeSource,
  materializeSources,
  materializeController,
  materializeCreep,
  materializeCreeps,
  materializeBotCode,
  materializeRoom,
  setBotMemory,
  getBotMemory,
  loadFixture,
  hasFixture,
  saveFixture,
} = require('../lib/builders');
```

Обычно **не нужно** вызывать из сценариев — этим управляет `createWorld()`.

## 5. Room fixtures API

Room fixture — это **семантическое** описание комнаты (controller, sources, structures, creeps).

```javascript
const { getRoomFixture, hasRoomFixture, loadRoomFixture, applyRoomOverrides } = require('../lib/fixtures/roomFixture');
```

| Функция                                  | Назначение                         |
| ---------------------------------------- | ---------------------------------- |
| `getRoomFixture(name)`                   | Получить fixture по имени          |
| `hasRoomFixture(name)`                   | Проверить существование fixture    |
| `loadRoomFixture(name)`                  | Загрузить только room fixture      |
| `applyRoomOverrides(fixture, overrides)` | Применить overrides поверх fixture |

Подробнее — [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md).

## 6. Memory fixtures API

Memory fixture — snapshot `Memory` бота. Подключается через `memory: 'fixture-name'`, `memory: { fixture: 'fixture-name' }` или per-bot map в multi-bot сценариях.

```javascript
const { loadFixture, hasFixture, saveFixture } = require('../lib/builders/memory');
```

| Функция                            | Назначение                |
| ---------------------------------- | ------------------------- |
| `loadFixture(name)`                | Прочитать `*.memory.json` |
| `hasFixture(name)`                 | Проверить существование   |
| `saveFixture(name, memory, opts?)` | Сохранить snapshot        |

Подробнее — [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md#memory-fixtures).

## 7. Assertions API

```javascript
const {
  assertNoErrors,
  assertBotWorked,
  assertRclAtLeast,
  assertRclBelow,
  assertObjectDestroyed,
  assertNoObjectDestroyed,
  assertNoBotObjectDestroyed,
  assertInvaderKilled,
  assertObjectAttacking,
  assertObjectNotAttacking,
  assertObjectDamaged,
  assertObjectNotDamaged,
  assertBotUserDamaged,
  assertBotUserNotDamaged,
} = require('../lib/assertions');

const {
  assertHasMetricSamples,
  assertLatestMetricAtLeast,
  assertLatestMetricBelow,
  assertMetricReached,
  assertMetricMonotonic,
} = require('../lib/metricAssertions');
```

| Категория        | Функция                                      | Назначение                      |
| ---------------- | -------------------------------------------- | ------------------------------- |
| Жизнеспособность | `assertNoErrors(report)`                     | Нет ошибок в логах              |
| Жизнеспособность | `assertBotWorked(report)`                    | Бот делал тики, Memory не пуста |
| RCL              | `assertRclAtLeast(report, room, n)`          | `RCL >= n`                      |
| RCL              | `assertRclBelow(report, room, n)`            | `RCL < n`                       |
| Destroyed        | `assertObjectDestroyed(report, opts)`        | Объект(ы) разрушен              |
| Destroyed        | `assertNoObjectDestroyed(report, opts)`      | Объекты НЕ разрушены            |
| Destroyed        | `assertNoBotObjectDestroyed(report, opts)`   | Здания бота не разрушены        |
| Destroyed        | `assertInvaderKilled(report, invaderId)`     | Invader уничтожен               |
| Бой              | `assertObjectAttacking(report, objectId)`    | Атака была                      |
| Бой              | `assertObjectNotAttacking(report, objectId)` | Атаки не было                   |
| Бой              | `assertObjectDamaged(report, targetId)`      | Урон получен                    |
| Бой              | `assertObjectNotDamaged(report, targetId)`   | Урон не получен                 |
| Бой              | `assertBotUserDamaged(report, userId)`       | Объект бота получил урон        |
| Бой              | `assertBotUserNotDamaged(report, userId)`    | Объекты бота НЕ получили урон   |
| Метрики          | `assertHasMetricSamples(report, type, id)`   | Есть сэмплы для сущности        |
| Метрики          | `assertLatestMetricAtLeast(...)`             | Последнее значение ≥ expected   |
| Метрики          | `assertLatestMetricBelow(...)`               | Последнее значение < expected   |
| Метрики          | `assertMetricReached(...)`                   | Значение достигалось            |
| Метрики          | `assertMetricMonotonic(...)`                 | Метрика не убывает              |

## 9. Основные типы

Полные JSDoc-типы находятся в `lib/types.js`. Ниже — практическая выжимка.

### RoomSpecInput

```typescript
{
    name: 'W0N1',
    roomFixture: 'rcl3-stable' | {/* inline */},
    roomOverrides: { exclude, controller, structures, append, hostiles },
    controller,           // (если без fixture)
    sources,              // (если без fixture)
    structures,           // (если без fixture)
    creeps,               // (если без fixture)
    hostiles,             // (если без fixture)
}
```

### BotInput

```typescript
{
    username: 'bot',
    room: 'W0N1',
    x?: 25, y?: 25,
    modules?: Object,     // custom modules (default = из dist/)
}
```

### RoomSpecCanonical

```typescript
{
    name: 'W0N1',
    controller: spec.controller(...),
    sources: [spec.source(...)],
    structures: [spec.spawn(...), spec.tower(...)],
    creeps: [spec.creep(...)],
    hostiles: [spec.invader(...)],
}
```

### RoomOverrides

```typescript
{
    exclude: ['tower'],
    controller: { safeMode: 20000 },
    structures: [spec.extension(...)],
    append: [spec.road(...)],
    hostiles: [spec.invader(...)],
}
```

### WorldReport

```typescript
{
    ticksRun: 50,
    finalRcl: { W0N1: 3, W0N2: 1 },
    errors: [],
    warnings: [],
    logs: [],
    finalMemory: {                          // per-bot
        bot: { /* Memory */ },
        reserve: { /* Memory */ },
    },
    wallClockMs: 1200,
    events: [...],
    metrics: {
        rooms: { W0N1: [{ tick, rcl, energyAvailable, ... }], ... },
        colonies: {},
        bots: {},
        world: [],
    },
    stopReason: 'predicate',
}
```

## 8. Metrics API

### Query / aggregation helpers

```javascript
const {
  getRoomMetrics,
  getLatestRoomMetrics,
  getMetricAtTick,
  getWorldSnapshotAtTick,
  averageMetric,
  deltaMetric,
  rateMetric,
} = require('../lib/metrics');
```

| Функция                                            | Назначение                                        |
| -------------------------------------------------- | ------------------------------------------------- |
| `getRoomMetrics(report, roomName)`                 | Вернуть time-series комнаты                       |
| `getLatestRoomMetrics(report, roomName)`           | Последний сэмпл комнаты                           |
| `getMetricAtTick(report, 'rooms', roomName, tick)` | Сэмпл ровно на указанном тике                     |
| `getWorldSnapshotAtTick(report, tick)`             | `{ [roomName]: sample }` для тика                 |
| `averageMetric(series, 'energyAvailable')`         | Среднее по числовым значениям                     |
| `sumMetric(series, 'containerEnergy')`             | Сумма числовых значений                           |
| `deltaMetric(series, 'rclProgress')`               | Последнее − первое значение                       |
| `rateMetric(series, 'rclProgress')`                | Изменение на тик между первым и последним сэмплом |

### Metric assertions

```javascript
const {
  assertHasMetricSamples,
  assertLatestMetricAtLeast,
  assertLatestMetricBelow,
  assertMetricReached,
  assertMetricMonotonic,
} = require('../lib/metricAssertions');
```

| Функция                                                           | Назначение                       |
| ----------------------------------------------------------------- | -------------------------------- |
| `assertHasMetricSamples(report, 'rooms', 'W0N1')`                 | Есть хотя бы один сэмпл          |
| `assertLatestMetricAtLeast(report, 'rooms', 'W0N1', 'rcl', 3)`    | Последнее значение ≥ expected    |
| `assertLatestMetricBelow(report, 'rooms', 'W0N1', 'cpu', 20)`     | Последнее значение < expected    |
| `assertMetricReached(report, 'rooms', 'W0N1', 'rcl', 3)`          | Значение достигалось хотя бы раз |
| `assertMetricMonotonic(report, 'rooms', 'W0N1', 'totalProgress')` | Метрика не убывает               |

### Export

```javascript
const { toCsv, flattenMetricSeries } = require('../lib/metricExport');

const csv = toCsv(report, { entityTypes: ['rooms'], metrics: ['rcl', 'energyAvailable'] });
```

`toCsv` возвращает CSV-строку с колонками `entityType,entityId,tick,metric,value`.
Объекты `spawnHits` не экспортируются; `creepsByRole` разворачивается в `creepsByRole.<role>`.

### Regression (без baseline-файлов)

```javascript
const { compareMetric, selectWindow } = require('../lib/metricRegression');

const current = selectWindow(report.metrics.rooms.W0N1, { startTick: 100, endTick: 200 });
const baseline = loadBaselineSomehow(); // JSON/CSV fixture (НЕ реализованно)
const result = compareMetric(current, baseline, 'cpuUsed', { tolerance: 5, direction: 'increase' });
// { passed, actual, expected, delta, relativeDelta }
```

## Связанные документы

- [GETTING-STARTED.md](./GETTING-STARTED.md) — быстрый старт
- [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md) — fixtures подробно
- [EXAMPLES.md](./EXAMPLES.md) — эталонные сценарии
- [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md) — multi-room + multi-bot паттерны
