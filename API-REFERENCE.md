# API Reference

Полный справочник по публичному API `screeps-integration-tests`. Остальные
документы ссылаются сюда; повторы сведены к минимуму.

## Содержание

- [1. Главная точка входа: createWorld](#1-главная-точка-входа-createworld)
- [2. WorldInstance](#2-worldinstance)
- [3. Spec-конструкторы](#3-spec-конструкторы)
- [4. Materialize](#4-materialize)
- [5. Room fixtures API](#5-room-fixtures-api)
- [6. Memory fixtures API](#6-memory-fixtures-api)
- [7. Assertions API](#7-assertions-api)
- [8. Metrics API](#8-metrics-api)
- [9. onTick, events и registerEvent](#9-ontick-events-и-registerevent)
- [10. Прямое чтение из БД](#10-прямое-чтение-из-бд)
- [11. Отчёт: errors, warnings, logs, events](#11-отчёт-errors-warnings-logs-events)
- [12. Профилирование](#12-профилирование)
- [13. Таймаут](#13-таймаут)
- [14. Основные типы](#14-основные-типы)
- [15. Хелперы модификации и поиска объектов](#15-хелперы-модификации-и-поиска-объектов)

## 1. Главная точка входа: createWorld

`createWorld(opts)` создаёт мир: сервер, комнаты, ботов, объекты, memory и
возвращает `WorldInstance`.

### Минимальный пример

```javascript
const { createWorld, spec } = require('screeps-integration-tests');

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
});
```

### Пример с fixture и overrides

```javascript
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

> `rcl3-stable` — пример имени fixture; в пакете fixtures не поставляются,
> создавайте свои. См. [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md).

### Опции createWorld

| Опция             | Тип                              | Назначение                                                                                       |
| ----------------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `rooms`           | `RoomSpecInput[]`                | Обязательно, минимум 1 комната                                                                   |
| `bots`            | `BotInput[]`                     | Боты: `[{ username, room, x?, y?, modules?, logLevel?, profiling? }]`                            |
| `memory`          | `MemoryInput \| MemoryByBot`     | Стартовая Memory: строка (fixture) или per-bot map                                               |
| `memoryOverrides` | `Object \| MemoryByBot`          | Deep-merge патчи поверх `memory`; без base становятся initial memory                             |
| `ticks`           | `number=100`                     | Мягкий лимит: влияет только на `world.run()`                                                     |
| `profiling`       | `boolean=false`                  | Включить callgrind-профилирование, см. [Profiler](https://github.com/screepers/screeps-profiler) |
| `logLevel`        | `'all' \| 'error' \| 'warn'`     | Порог для `report.logs` (по умолчанию `'all'`)                                                   |
| `maxConsoleLines` | `number=10000`                   | Общий лимит строк `errors + warnings + logs`                                                     |
| `metrics`         | `MetricsOpts`                    | `{ every, rooms }` (только `rooms` реализовано)                                                  |
| `until`           | `UntilOpts`                      | Жёсткое условие остановки                                                                        |
| `onTick`          | `(world, tick) => Promise<void>` | Callback на каждом тике, вызывается после bot-tick и перед predicate                             |
| `events`          | `EventSpec[]`                    | Декларативные события по тикам                                                                   |

### UntilOpts

| Поле        | Тип        | Описание                                                                                 |
| ----------- | ---------- | ---------------------------------------------------------------------------------------- |
| `maxTicks`  | `number`   | Жёсткий лимит. Уважается и `run()`, и `tick()`. Не путать с `opts.ticks` (мягкий лимит). |
| `predicate` | `Function` | `async (world) => boolean`. Проверяется каждый тик.                                      |
| `signal`    | `string`   | Имя поля в Memory бота. Если стало truthy — остановка.                                   |
| `signalBot` | `string`   | Бот для проверки `signal`. Если не указан — проверяются все.                             |

### Memory и memoryOverrides

`memory` может быть:

- строкой — имя memory fixture (single-bot shorthand);
- объектом `{ fixture: 'name', ...overrides }`;
- inline-объектом;
- для multi-bot — обязательно map `{ username: memoryInput }`.

```javascript
// single-bot
const world = await createWorld({
  bots: [{ username: 'bot', room: 'W0N1' }],
  memory: 'rcl3-stable',
});

// multi-bot
const world = await createWorld({
  bots: [
    { username: 'mainBot', room: 'W0N1' },
    { username: 'reserveBot', room: 'W0N2' },
  ],
  memory: {
    mainBot: 'rcl3-stable',
    reserveBot: { fixture: 'rcl3-stable', colonies: { W0N2: { stage: 'reserve' } } },
  },
  memoryOverrides: {
    mainBot: { flags: { defend: true } },
  },
});
```

`memoryOverrides` deep-merge'ится поверх `memory`:

- plain objects рекурсивно мержатся;
- массивы и примитивы заменяются;
  | `undefined` в patch игнорируется (не стирает поле).

## 2. WorldInstance

`createWorld()` возвращает объект со следующими методами и полями.

### Методы

| Метод                                  | Назначение                                                             |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `world.run()`                          | Прогнать сценарий до `opts.ticks` / `until.maxTicks` / predicate       |
| `world.tick(n)`                        | Выполнить `n` тиков; уважает `until.maxTicks`, игнорирует `opts.ticks` |
| `world.exec(code, username?)`          | Выполнить JS-код в контексте бота                                      |
| `world.spawn(spec)`                    | Создать крипа. Подробнее о формате `spec` см. `SpawnSpecInput` (§14).  |
| `world.createStructure(spec)`          | Создать структуру через spec (см. §Хелперы)                            |
| `world.eventLog(room)`                 | Event log комнаты за текущий тик                                       |
| `world.readMemory(username?)`          | Прочитать Memory бота                                                  |
| `world.writeMemory(username, patch)`   | Deep-merge patch в Memory бота                                         |
| `world.registerEvent(action, handler)` | Зарегистрировать обработчик для `opts.events`                          |
| `world.setTicksToDowngrade(room, n)`   | Установить время до даунгрейда контроллера (см. §Хелперы)              |
| `world.setHitsStructure(id, hits)`     | Установить HP структуры (см. §Хелперы)                                 |
| `world.damageHitsStructure(id, dmg)`   | Нанести урон структуре (см. §Хелперы)                                  |
| `world.deleteStructure(id)`            | Удалить структуру из БД (см. §Хелперы)                                 |
| `world.find(query)` / `findOne`/…      | Поиск объектов в `rooms.objects` (см. §Хелперы)                        |
| `world.dispose()`                      | Остановить сервер и удалить cache-директорию                           |

### Поля

| Поле           | Назначение                        |
| -------------- | --------------------------------- |
| `world.report` | Накопленный отчёт (`WorldReport`) |
| `world.server` | Экземпляр `ScreepsServer`         |
| `world.bots`   | `Record<username, Bot>`           |
| `world.rooms`  | `Record<name, RoomStatus>`        |

### Примеры

#### Пошаговый прогон

```javascript
await world.tick(10);
await world.spawn(spec.dummyTarget(10, 10, { roomName: ROOM_NAME }));
await world.tick(40);
```

#### Работа с Memory

```javascript
const memory = await world.readMemory('bot');
await world.writeMemory('bot', { test: { enabled: true } });
```

#### Event log

```javascript
const { EVENT_OBJECT_DESTROYED } = require('screeps-integration-tests/events');
const events = await world.eventLog('W0N1');
const destroyed = events.some((e) => e.event === EVENT_OBJECT_DESTROYED);
```

### Детали

#### `world.run()` / `world.tick(n)`

- `tick()` перед `run()` учитывается в общем лимите: после `tick(3)` вызов `run()` доберёт только до `opts.ticks`.
- Повторный `run()` после достижения `opts.ticks` или `until.maxTicks` **не добавляет** тиков — `stopReason` уже выставлен.
- `tick(n)` после `run()` продолжает тикать (если нет `until`), игнорируя мягкий лимит `opts.ticks`.
- И `run()`, и `tick(n)` уважают `until.maxTicks` — жёсткий лимит, который нельзя превысить.
- `run()` без `until` останавливается при достижении `opts.ticks` (мягкий лимит).

## 3. Spec-конструкторы

```javascript
const { spec } = require('screeps-integration-tests');
```

`spec` — чистые конструкторы plain-объектов. Никаких записей в БД.

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
| `spec.rampart(x, y, opts)`         | Rampart                   |

`opts` для структур:

- `roomName?: string`
- `userId?: string` — владелец (явно; никаких автодефолтов)
- `id?: string` — конкретный `_id` (для memory fixture)
- `name?: string` — имя (для spawn)
- `energy?, energyCapacity?, storeCapacity?, hits?, hitsMax?, notifyWhenAttacked?`
- `overrides?: Object` — произвольные дополнительные поля

Для типов без dedicated helper используйте `spec.structure` с константами из
`screeps-integration-tests/constants`:

```javascript
const { STRUCTURE_RAMPART } = require('screeps-integration-tests/constants');
const rampart = spec.structure(STRUCTURE_RAMPART, 25, 25, { roomName: 'W0N1' });
```

### Источники и controller

```javascript
spec.source(15, 15, { roomName: 'W0N1', energy: 3000 });
spec.controller({ roomName: 'W0N1', level: 3, safeMode: 20000, userId: botId });
```

### Крипы

| Функция                        | Назначение              |
| ------------------------------ | ----------------------- |
| `spec.creep(x, y, opts)`       | Обычный creep           |
| `spec.invader(x, y, opts)`     | Invader (`userId: '2'`) |
| `spec.dummyTarget(x, y, opts)` | Целевой dummy creep     |

### Кастомные spec через `overrides`

`spec.structure()` — единственный конструктор, поддерживающий произвольные
кастомные поля через **вложенное** `overrides`.

```javascript
const { STRUCTURE_LAB } = require('screeps-integration-tests/constants');

const lab = spec.structure(STRUCTURE_LAB, 26, 26, {
  roomName: 'W0N1',
  userId: botId,
  // вложенный overrides — произвольные поля
  overrides: { mineralType: 'X', mineralAmount: 3000 },
});
```

## 4. Materialize

`materialize*` — внутренний слой, знающий форму БД. Обычно не вызывается из
сценариев; `createWorld()` делает это сам. Публичный API не экспортирует
материализаторы.

## 5. Room fixtures API

```javascript
const {
  getRoomFixture,
  hasRoomFixture,
  loadRoomFixture,
  applyRoomOverrides,
  registerRoomFixture,
} = require('screeps-integration-tests/room-fixtures');
```

Room fixture — декларативное описание комнаты. Регистрируйте через
`registerRoomFixture` или авто-загружайте из `roomFixturesDir` (см.
[FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md)).

| Функция                                  | Назначение                                   |
| ---------------------------------------- | -------------------------------------------- |
| `getRoomFixture(name)`                   | Получить fixture по имени                    |
| `hasRoomFixture(name)`                   | Проверить существование                      |
| `loadRoomFixture(name)`                  | Загрузить fixture (возвращает `{ fixture }`) |
| `applyRoomOverrides(fixture, overrides)` | Применить overrides                          |
| `registerRoomFixture(name, fixture)`     | Зарегистрировать fixture в runtime           |

## 6. Memory fixtures API

```javascript
const { loadFixture, hasFixture, saveFixture, deepMergeMemory } = require('screeps-integration-tests/memory-fixtures');
```

| Функция                            | Назначение                         |
| ---------------------------------- | ---------------------------------- |
| `loadFixture(name)`                | Прочитать `*.memory.json`          |
| `hasFixture(name)`                 | Проверить существование            |
| `saveFixture(name, memory, opts?)` | Сохранить snapshot                 |
| `deepMergeMemory(target, ...src)`  | Deep-merge (plain objects recurse) |

## 7. Assertions API

```javascript
const {
  assertNoErrors,
  assertBotWorked,
  assertRclAtLeast,
  assertRclBelow,
  assertObjectDestroyed,
  assertObjectNoDestroyed,
  assertNoBotObjectDestroyed,
  assertObjectAttacking,
  assertObjectNotAttacking,
  assertObjectDamaged,
  assertObjectNotDamaged,
  assertBotUserDamaged,
  assertBotUserNotDamaged,
  assertBotUserAttacking,
  assertBotUserNotAttacking,
} = require('screeps-integration-tests/assertions');
```

| Категория        | Функция                                       | Назначение                      |
| ---------------- | --------------------------------------------- | ------------------------------- |
| Жизнеспособность | `assertNoErrors(report)`                      | Нет ошибок в логах              |
| Жизнеспособность | `assertBotWorked(report)`                     | Бот делал тики, Memory не пуста |
| RCL              | `assertRclAtLeast(report, room, n)`           | `RCL >= n`                      |
| RCL              | `assertRclBelow(report, room, n)`             | `RCL < n`                       |
| Destroyed        | `assertObjectDestroyed(report, opts)`         | Объект(ы) разрушен(ы)           |
| Destroyed        | `assertObjectNoDestroyed(report, opts)`       | Объекты НЕ разрушены            |
| Destroyed        | `assertNoBotObjectDestroyed(report, opts)`    | Здания бота не разрушены        |
| Бой              | `assertObjectAttacking(report, objectId)`     | Атака была                      |
| Бой              | `assertObjectNotAttacking(report, objectId)`  | Атаки не было                   |
| Бой              | `assertObjectDamaged(report, targetId)`       | Урон получен                    |
| Бой              | `assertObjectNotDamaged(report, targetId)`    | Урон не получен                 |
| Бой              | `assertBotUserDamaged(report, username)`      | Объект бота получил урон        |
| Бой              | `assertBotUserNotDamaged(report, username)`   | Объекты бота НЕ получили урон   |
| Бой              | `assertBotUserAttacking(report, username)`    | Бот инициировал атаку           |
| Бой              | `assertBotUserNotAttacking(report, username)` | Бот НЕ атаковал                 |

Metric assertions — см. [§8. Metrics API](#8-metrics-api) (класс `MetricsAssert`).

## 8. Metrics API

Метрики — time-series данные, снимаемые по ходу прогона. Архитектура едина для
всех типов сущностей (`rooms`, `colonies`, `bots`, `world`): методы работы с
series одни и те же, но **набор полей у каждой сущности свой**. Например, у
`rooms` есть `rcl` и `energyAvailable`, у `bots` будут `cpu` и `gcl` и т.д.

Три класса образуют пайплайн:

| Класс               | Sub-path              | Назначение                                |
| ------------------- | --------------------- | ----------------------------------------- |
| `MetricsReport`     | `…/metrics`           | Хранение, запросы, агрегация, CSV-экспорт |
| `MetricsAssert`     | `…/metric-assertions` | Assertions на значениях метрик            |
| `MetricsRegression` | `…/metrics`           | Сравнение с baseline                      |

### Быстрый старт

```javascript
const { MetricsAssert } = require('screeps-integration-tests/metric-assertions');
const { MetricsReport, MetricsRegression } = require('screeps-integration-tests/metrics');

const world = await createWorld({
  // …
  metrics: { every: 10, rooms: true },
});
await world.run();

const m = report.metrics; // MetricsReport

// Запросы (entityType = 'rooms' | 'colonies' | 'bots' | 'world')
const series = m.series('rooms', 'W0N1'); // универсальный доступ
const latest = m.latest('rooms', 'W0N1'); // последний сэмпл
// Краткие обёртки:
const same = m.room('W0N1'); // ≡ series('rooms', …)
const last = m.latestRoom('W0N1'); // ≡ latest('rooms', …)

// Агрегация (работает с любым числовым полем любой сущности)
m.average(series, 'rcl');
m.sum(series, 'energyAvailable');
m.delta(series, 'rclProgress');

// Assertions
const ma = new MetricsAssert(m);
ma.latestAtLeast('rooms', 'W0N1', 'rcl', 3);

// CSV (встроен в MetricsReport)
const csv = m.toCsv({ entityTypes: ['rooms'] });

// Regression
const baseline = MetricsReport.fromJSON(/* … */);
const reg = new MetricsRegression(baseline);
reg.compare(m, 'rooms', 'W0N1', 'rcl', { aggregator: 'average' });
```

### Сбор метрик

```javascript
metrics: { every: 1, rooms: true }
```

| Поле       | Тип       | Назначение                                       |
| ---------- | --------- | ------------------------------------------------ |
| `every`    | `number`  | Интервал сэмплирования в тиках (`0` — выключено) |
| `rooms`    | `boolean` | Собирать метрики комнат (default `true`)         |
| `colonies` | `boolean` | **Не реализовано** — бросает ошибку              |
| `bots`     | `boolean` | **Не реализовано** — бросает ошибку              |
| `world`    | `boolean` | **Не реализовано** — бросает ошибку              |

### CSV экспорт

```javascript
const csv = report.metrics.toCsv({ entityTypes: ['rooms'], metrics: ['rcl', 'energyAvailable'] });
```

Метод `toCsv()` принимает те же опции, что и `flatten()`: `entityTypes` для фильтрации
по типу сущностей и `metrics` для фильтрации по именам метрик.

### Детали

Полный список методов `MetricsReport`, `MetricsAssert` и `MetricsRegression` —
см. JSDoc в `src/lib/metricsReport.js`, `src/lib/metricAssertions.js`,
`src/lib/metricRegression.js`.

Список полей метрик по типам сущностей — см. `src/lib/observers/metrics.js`
(`collectMetrics` для rooms; для остальных — по мере реализации).

## 9. onTick, events и registerEvent

### onTick

Вызывается каждый тик **после** выполнения bot-tick, сбора event log,
metrics и декларативных events, но **до** predicate-проверки.

Сигнатура: `async (world, tick) => void`, где `world` — полный
`WorldInstance`, `tick` — 0-based номер тика.

```javascript
const world = await createWorld({
  // ...
  onTick: async (world, tick) => {
    if (tick === 50) {
      await world.spawn(spec.invader(40, 40, { roomName: 'W0N1' }));
    }
    const mem = await world.readMemory('bot');
    if (mem.emergencyStop) {
      // predicate сработает на следующем шаге
    }
  },
});
```

### opts.events

Декларативные события по тикам. Обрабатываются до `onTick`.

```javascript
const world = await createWorld({
  // ...
  events: [
    { atTick: 10, action: 'spawnInvader', params: { x: 40, y: 40, room: 'W0N1' } },
    { atTick: 20, action: 'spawnCreep', params: { room: 'W0N1', x: 25, y: 25, userId: botId, name: 'Defender' } },
  ],
});
```

`EventSpec`:

| Поле     | Тип      | Описание                                    |
| -------- | -------- | ------------------------------------------- |
| `atTick` | `number` | 0-based номер тика                          |
| `action` | `string` | Имя зарегистрированного обработчика         |
| `params` | `Object` | Параметры; для `spawn*` нужен `params.room` |
| `room`   | `string` | Целевая комната (передаётся в handler)      |

### registerEvent

Регистрирует кастомный обработчик события.

```javascript
world.registerEvent('healAll', async (server, room, params) => {
  const { db } = server.common.storage;
  const creeps = await db['rooms.objects'].find({ room, type: 'creep' });
  for (const creep of creeps) {
    await db['rooms.objects'].update({ _id: creep._id }, { $set: { hits: creep.hitsMax } });
  }
});
```

Handler: `async (server, room, params) => void`.

Встроенные события: `spawnInvader`, `spawnCreep`.

## 10. Прямое чтение из БД

`world.server.common.storage.db` — Loki-style коллекции mockup-сервера.

```javascript
const { db } = world.server.common.storage;

// Все объекты комнаты
const objects = await db['rooms.objects'].find({ room: 'W0N1' });

// Только towers
const towers = await db['rooms.objects'].find({ room: 'W0N1', type: 'tower' });

// Один объект
const controller = await db['rooms.objects'].findOne({ room: 'W0N1', type: 'controller' });
```

Используйте когда публичного API недостаточно.

## 11. Отчёт: errors, warnings, logs, events

`world.report` накапливает:

| Поле          | Тип        | Что содержит                                                             |
| ------------- | ---------- | ------------------------------------------------------------------------ |
| `ticksRun`    | `number`   | Число выполненных тиков                                                  |
| `errors`      | `string[]` | Строки с `[ERROR]` или matching `ERROR_PATTERNS` (ReferenceError и т.п.) |
| `warnings`    | `string[]` | Строки с `[WARN]`                                                        |
| `logs`        | `string[]` | Строки в зависимости от `logLevel` (default `'all'`)                     |
| `events`      | `Object[]` | Аккумулированные event-log entries с `tick`                              |
| `finalRcl`    | `Object`   | `{ [roomName]: number }`                                                 |
| `finalMemory` | `Object`   | `{ [username]: Memory }`                                                 |
| `metrics`     | `Object`   | `{ rooms, colonies, bots, world }`                                       |
| `wallClockMs` | `number`   | Время прогона                                                            |
| `stopReason`  | `string`   | Причина остановки (`maxTicks`, `predicate`, `signal`, ...)               |

Пример парсинга:

```javascript
for (const line of world.report.errors) {
  if (line.includes('TypeError')) {
    throw new Error('Bot crashed with TypeError');
  }
}
```

> `errors`/`warnings`/`logs` — голые строки без привязки к тику. Если нужна
> per-tick информация — используйте `report.events` или `onTick`.

## 12. Профилирование

```javascript
const world = await createWorld({
  // ...
  profiling: true,
});
```

Требования:

1. В проекте бота установлен `screeps-profiler`:
   `npm install --save-dev screeps-profiler`
2. `main.js` бота обёрнут:

```javascript
const profiler = require('screeps-profiler');
profiler.enable();
module.exports.loop = profiler.wrap(function () {
  // bot logic
});
```

При `--profiling` фреймворк:

- tick 0 — инициализация;
- tick 1 — arm profiling;
- tick 2+ — сбор данных;
- после прогона — один extra tick для финализации.

CLI сохраняет `report.profileCallgrind` в
`<profilesDir>/<scenario>-<username>-<timestamp>.callgrind`.

> Ознакомьтесь с репозиторием [Profiler](https://github.com/screepers/screeps-profiler)

## 13. Таймаут

Таймаут задаётся **на один сценарий**:

- в конфиге: `timeout: 30 * 60 * 1000` (default 30 мин);
- в CLI: `--timeout N` (миллисекунды).

Если сценарий не уложился — worker получает `SIGKILL`. Общего таймаута на
весь прогон нет.

## 14. Основные типы

Полные JSDoc-типы — в `src/lib/types.js`. Ниже — выжимка.

### RoomSpecInput

```typescript
{
    name: 'W0N1',
    roomFixture?: 'rcl3-stable' | object,
    roomOverrides?: { exclude, controller, structures, append, hostiles, creeps },
    controller?,           // inline
    sources?,
    structures?,
    creeps?,
    hostiles?,
}
```

### BotInput

```typescript
{
    username: 'bot',
    room: 'W0N1',
    x?: 25, y?: 25,
    modules?: object,     // custom modules (default = из dist/)
    logLevel?: 'all'|'error'|'warn',
    profiling?: boolean,
}
```

### SpawnSpecInput

```typescript
{
    roomName: string,            // обязательно
    x: number,
    y: number,
    name?: string,               // если не указан — генерируется
    body: { type: string, hits: number }[],  // обязательно
    userId?: string,             // fallback к первому боту, если не указан
    hits?: number,               // по умолчанию сумма hits body
    hitsMax?: number,            // по умолчанию hits
    energy?: number,
    energyCapacity?: number,
    overrides?: Object,          // произвольные поля для материализатора
}
```

`spawn()` принимает как plain-объект этого формата, так и результат
`spec.creep()`, `spec.invader()` или `spec.dummyTarget()` — все они
возвращают совместимый `SpawnSpecInput`.

### WorldReport

```typescript
{
    ticksRun: 50,
    finalRcl: { W0N1: 3, W0N2: 1 },
    errors: [],
    warnings: [],
    logs: [],
    events: [{ tick, event, objectId, ... }],
    finalMemory: { bot: { /* Memory */ } },
    wallClockMs: 1200,
    metrics: {
        rooms: { W0N1: [{ tick, rcl, energyAvailable, ... }] },
        colonies: {},
        bots: {},
        world: [],
    },
    stopReason: 'predicate',
}
```

## 15. Хелперы модификации и поиска объектов

Методы, доступные на `WorldInstance`. Работают напрямую с БД Screeps `db['rooms.objects']`.

### Controller

| Метод                                        | Описание                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `world.setTicksToDowngrade(roomName, ticks)` | Установить `downgradeTime = gameTime + ticks`. `ticks >= 0` или `null` для сброса. |

```javascript
await world.setTicksToDowngrade('W0N1', 4000);
await world.setTicksToDowngrade('W0N1', null); // сбросить таймер
```

### Структуры

| Метод                                           | Описание                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| `world.setHitsStructure(idOrObject, hits)`      | Установить HP. `hits >= 0`, clamp по `hitsMax`.                     |
| `world.damageHitsStructure(idOrObject, amount)` | Вычесть `amount` из HP (не ниже 0).                                 |
| `world.deleteStructure(idOrObject)`             | Удалить структуру из `rooms.objects` напрямую (без event log).      |
| `world.createStructure(spec)`                   | Создать структуру из spec-объекта. `userId` по умолч. — первый бот. |

Аргумент `idOrObject` может быть:

- строкой (`_id`);
- объектом с полем `_id` или `id` (например, документ из `world.find`).

```javascript
const wallId = await world.createStructure(spec.wall(10, 20, { roomName: 'W0N1', hits: 500000 }));
await world.damageHitsStructure(wallId, 100);
await world.damageHitsStructure({ id: wallId }, 50);
await world.setHitsStructure(wallId, 2000);

// прямое удаление
await world.deleteStructure(wallId);
```

### Поиск объектов

Универсальные методы вместо прямого обращения к `db['rooms.objects'].find(...)`.

| Метод                         | Назначение                                               |
| ----------------------------- | -------------------------------------------------------- |
| `world.find(query)`           | Массив документов (с полем `id` = `_id`).                |
| `world.findOne(query, opts?)` | Первый документ или `null`. `opts.index` — N-й по счёту. |
| `world.findIds(query)`        | Массив `_id`.                                            |
| `world.findId(query, opts?)`  | `_id` первого или `null`. `opts.index` — N-й.            |

Поля `query`:

- `room`, `type`, `name`, `x`, `y` — как в БД.
- `userId` — автоматически мапится в БД-поле `user`.
- `id` — мапится в `_id`.

```javascript
const { STRUCTURE_TOWER } = require('screeps-integration-tests/constants');

// Все towers комнаты
const towers = await world.find({ room: 'W0N1', type: STRUCTURE_TOWER });

// Первая башня
const tower = await world.findOne({ room: 'W0N1', type: STRUCTURE_TOWER });

// _id первой башни
const towerId = await world.findId({ room: 'W0N1', type: STRUCTURE_TOWER });

// _id первого источника (index=0)
const sourceId = await world.findId({ room: 'W0N1', type: 'source' }, { index: 0 });
```

## Связанные документы

- [GETTING-STARTED.md](./GETTING-STARTED.md) — быстрый старт
- [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md) — fixtures подробно
- [EXAMPLES.md](./EXAMPLES.md) — эталонные сценарии
- [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md) — multi-room + multi-bot
- [INTEGRATION-TESTS.md](./INTEGRATION-TESTS.md) — архитектура
