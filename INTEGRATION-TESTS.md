# Integration Tests — Architecture Guide

Этот документ описывает **архитектуру и внутренние механизмы** фреймворка со
стороны контрибьютора. Здесь нет tutorial — практические руководства находятся в
соседних файлах:

- [README.md](./README.md) — навигация по документации
- [GETTING-STARTED.md](./GETTING-STARTED.md) — установка, запуск, первый сценарий
- [API-REFERENCE.md](./API-REFERENCE.md) — полный справочник публичного API
- [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md) — room fixtures, memory fixtures, overrides
- [EXAMPLES.md](./EXAMPLES.md) — эталонные сценарии и приёмы
- [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md) — несколько комнат и ботов

## Содержание

1. [Архитектура: слои и ответственность](#1-архитектура-слои-и-ответственность)
2. [Жизненный цикл сценария](#2-жизненный-цикл-сценария)
3. [Runtime: multi-room + multi-bot](#3-runtime-multi-room--multi-bot)
4. [Условие остановки (until)](#4-условие-остановки-until)
5. [Observers](#5-observers)
6. [Дочерние процессы и передача данных](#6-дочерние-процессы-и-передача-данных)
7. [Изоляция памяти и cache management](#7-изоляция-памяти-и-cache-management)
8. [Профилирование](#8-профилирование)
9. [Структура файлов](#9-структура-файлов)
10. [Best practices](#10-best-practices)
11. [Расширение framework](#11-расширение-framework)

## 1. Архитектура: слои и ответственность

```
┌──────────────────────────────────────────────────────────────┐
│  bin/screeps-integration-tests.js                            │
│  CLI runner: разбор флагов, пул воркеров, отчёт              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  src/runScenario.js (child_process.fork)               │  │
│  │  Воркер: подготовить сервер → выполнить scenario.run   │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  scenario.run(opts)                              │  │  │
│  │  │  ┌────────────────────────────────────────────┐  │  │  │
│  │  │  │  createWorld(opts)                         │  │  │  │
│  │  │  │  ├─ prepareServer()                        │  │  │  │
│  │  │  │  │   └─ ScreepsServer + rooms + terrain    │  │  │  │
│  │  │  │  ├─ addBots()                              │  │  │  │
│  │  │  │  │   └─ users + code + console handlers    │  │  │  │
│  │  │  │  ├─ buildCanonicalRoom()                   │  │  │  │
│  │  │  │  │   └─ spec + fixture + overrides         │  │  │  │
│  │  │  │  ├─ materializeRoom() per room             │  │  │  │
│  │  │  │  │   └─ controller / sources / structures  │  │  │  │
│  │  │  │  │       / creeps / hostiles               │  │  │  │
│  │  │  │  ├─ setBotMemory() per bot                 │  │  │  │
│  │  │  │  └─ server.start()                         │  │  │  │
│  │  │  │                                            │  │  │  │
│  │  │  │  world.run() / world.tick(n)               │  │  │  │
│  │  │  │  ├─ server.tick()                          │  │  │  │
│  │  │  │  ├─ observers (eventLog, metrics)          │  │  │  │
│  │  │  │  ├─ events (declarative spawns)            │  │  │  │
│  │  │  │  ├─ onTick callback                        │  │  │  │
│  │  │  │  └─ predicate check → stop?                │  │  │  │
│  │  │  └────────────────────────────────────────────┘  │  │  │
│  │  │  assert*() → pass/fail                           │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

Четыре слоя:

1. **Config** (`lib/config.js`, `lib/cli.js`) — загрузка
   `screeps-integration.config.js`, слияние defaults → файл → env → CLI →
   overrides.
2. **Runtime** (`lib/runtime.js`) — обёртка над `screeps-server-mockup`:
   `prepareServer`, `addBots`, `createRuntime`. Класс `TestBot` (EventEmitter).
3. **World orchestration** (`lib/world.js`) — `createWorld(opts)`. Pipeline:
   prepareServer → addBots → materializeRoom → setBotMemory → server.start →
   `WorldInstance` с методами `run/tick/exec/spawn/eventLog/readMemory/…`.
4. **Builders & Observers** (`lib/builders/`, `lib/observers/`) — чистые
   spec-конструкторы и stateless DB-readers.

### Разделение в builders

| Слой          | Файл                      | Что знает                             | Назначение                        |
| ------------- | ------------------------- | ------------------------------------- | --------------------------------- |
| `spec`        | `builders/spec.js`        | Дефолты объектов, `roomName`/`userId` | Чистые конструкторы spec-объектов |
| `materialize` | `builders/materialize.js` | Форма БД mockup-сервера               | Единственный слой, пишущий в БД   |

> **Важно:** знание формы БД живёт **только** в `materialize`. Сценарии и
> `createWorld()` используют его как единственный канал записи в БД.

### Разделение в observers

| Слой      | Файл                     | Назначение                         |
| --------- | ------------------------ | ---------------------------------- |
| eventLog  | `observers/eventLog.js`  | Чтение и фильтрация событий        |
| metrics   | `observers/metrics.js`   | Сбор игровых данных (room metrics) |
| predicate | `observers/predicate.js` | Проверка условий остановки         |
| ownership | `observers/ownership.js` | Слежение за владельцами объектов   |

Observers только читают БД и возвращают данные. Они не мутируют состояние.

### Разделение метрик

| Слой       | Файл                      | Назначение                                   |
| ---------- | ------------------------- | -------------------------------------------- |
| Observer   | `observers/metrics.js`    | Чтение состояния мира, возврат `RoomMetrics` |
| Recorder   | `lib/metrics.js`          | Запись сэмплов в `report.metrics`            |
| Query      | `lib/metrics.js`          | Чтение series, агрегация                     |
| Assertions | `lib/metricAssertions.js` | Assert'ы на основе time-series               |
| Export     | `lib/metricExport.js`     | Преобразование в CSV                         |
| Regression | `lib/metricRegression.js` | Сравнение current vs baseline                |

### Константы

`src/constants/screepsConstants.js` содержит игровые константы Screeps
(`STRUCTURE_*`, body parts, `RESOURCE_ENERGY`, `FIND_*`, error codes и др.).
Используются spec-конструкторами, assert'ами и метриками, чтобы не зависеть от
глобального окружения mockup-сервера.

## 2. Жизненный цикл сценария

```
1. createWorld(opts)
   ├─ prepareServer()            ← ScreepsServer + rooms + terrain
   ├─ addBots()                  ← users + code + memory + console
   ├─ buildCanonicalRoom()       ← spec + fixture + overrides
   ├─ materializeRoom per room   ← controller / sources / structures / creeps / hostiles
   ├─ setBotMemory per bot       ← memory fixture (по username)
   ├─ install console handlers   ← per bot
   └─ server.start()

2. world.run() / world.tick(n)
   ├─ for each tick:
   │   ├─ server.tick()
   │   ├─ for each room:
   │   │   ├─ readEventLog → accumulate → report.events
   │   │   ├─ snapshotOwners → mergeOwners
   │   │   └─ collectMetrics → sampleMetrics → report.metrics.rooms
   │   ├─ events (declarative spawns)
   │   ├─ onTick callback
   │   ├─ predicate check → shouldStop?
   │   └─ break if shouldStop

3. finalize()
   ├─ finalMemory per bot
   ├─ finalRcl per room
   ├─ profileText / profileCallgrind per bot
   └─ wallClockMs

4. assert*()
5. world.dispose()               ← обязателен в finally
```

### Семантика тиков

Тики нумеруются с 0. Бот выполняется каждый тик, начиная с первого.
Метрики, `eventLog` и `predicate` собираются на каждом тике (или с
периодом `metrics.every` для метрик).

Семантика тиков для профилировщика описана в §8.

## 3. Runtime: multi-room + multi-bot

Runtime разделён на три независимые фазы:

- `prepareServer({ rooms, cacheDir })` — поднимает `ScreepsServer`, создаёт
  комнаты и terrain. **Не создаёт** контроллер, ботов и спавны. Все объекты
  комнаты создаются позже через `materializeRoom`.
- `addBots({ server, bots, distDir, profiling })` — собственная реализация
  добавления ботов. Создаёт пользователя, пустую память, загружает код,
  подписывается на консоль. Не трогает controller/spawn.
- `materializeRoom(server, canonical)` — создаёт все объекты комнаты из
  канонической спецификации.

`createRuntime` — тонкий facade: prepareServer → addBots → start.

```js
// Полный pipeline (createWorld) — внутренние функции, не экспортируются в public API.
// В сценариях используйте createWorld().
const prepared = await prepareServer({ rooms, cacheDir });
const { bots } = await addBots({ server: prepared.server, bots, distDir });
const canonical = await buildCanonicalRoom(roomInput, roomName, bots['bot'].id);
const ids = await materializeRoom(server, canonical);
await server.start();
```

### Контракт

- `rooms` — массив `RoomSpecInput[]` (имя + spec/fixture + overrides);
- `bots` — массив `{ username, room, modules?, profiling? }`;
- per-bot profiling: `b.profiling ?? opts.profiling ?? false`.

Подробнее про multi-room моделирование — [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md).

## 4. Условие остановки (until)

```js
until: {
    maxTicks: 20000,
    predicate: async (w) => {
        const mem = await w.readMemory('mainBot');
        return mem.rooms?.W0N1?.controller?.level >= 3;
    },
}
```

Сценарий завершается, когда:

- `predicate` вернул `true`, **или**
- `ticksRun >= maxTicks`, **или**
- `Memory[until.signal]` truthy.

> **Важно:** `until.maxTicks` — **жёсткий** лимит: он уважается и `run()`, и
> `tick()`. `createWorld({ ticks })` — **мягкий** лимит, он влияет только на
> `run()`. Если заданы оба — тест остановится по первому достигнутому.

Predicate может быть sync или async. Если predicate бросает ошибку — тест
завершается с этой ошибкой.

## 5. Observers

| Слой      | Файл                     | Назначение                       |
| --------- | ------------------------ | -------------------------------- |
| eventLog  | `observers/eventLog.js`  | Чтение и фильтрация событий      |
| metrics   | `observers/metrics.js`   | Сбор room metrics                |
| predicate | `observers/predicate.js` | Условия остановки                |
| ownership | `observers/ownership.js` | Слежение за владельцами объектов |

Event log перезаписывается engine'ом каждый тик, поэтому используется
`accumulateEvents` для накопления в `report.events[]`.

## 6. Дочерние процессы и передача данных

### Почему `console.log` в сценарии виден

Сценарии выполняются в отдельных дочерних процессах (`child_process.fork` из
`src/runScenario.js`). Их `stdout`/`stderr` наследуется от родителя, поэтому
`console.log` внутри `.scenario.js` попадает в общий вывод.

### Параллельный запуск

`bin/screeps-integration-tests.js` запускает сценарии с ограничением
concurrency (`--jobs <N>`, по умолчанию `min(4, os.cpus().length)`). Каждый
сценарий получает собственный свободный порт storage через `getFreePort()`,
поэтому параллельные запуски не конфликтуют.

### Способы передать данные

| Задача                  | Способ                                           |
| ----------------------- | ------------------------------------------------ |
| Логи ошибок бота        | `report.errors`                                  |
| Все логи бота           | `logLevel: 'all'` → `report.logs`                |
| Финальное состояние     | `report.finalMemory[username]`                   |
| Данные по тикам         | `onTick` + замыкание → `report.*`                |
| Снимок в конкретный тик | `world.readMemory(username)` в `onTick`          |
| Состояние объектов в БД | `world.server.db` + замыкание                    |
| Профайлер               | `report.profileText` и `report.profileCallgrind` |
| Event log               | `report.events`                                  |

## 7. Изоляция памяти и cache management

Каждый сценарий работает в изолированной cache-директории:

```
<cacheBase>/w-<timestamp>-<pid>
```

Например: `.cache/w-1700000000000-12345/`. Это позволяет запускать сценарии
параллельно и избегать конфликтов.

После завершения сценария `world.dispose()` останавливает дочерние процессы
сервера, дожидается их завершения и удаляет cache-директорию. При timeout
`bin/screeps-integration-tests.js` убивает всё дерево процессов через
`tree-kill`.

`pruneCache` — внутренняя функция, не экспортируется в публичный API.
Вызывается автоматически при старте CLI. Очищает `cacheDir`, храня `cacheKeep`
последних директорий (настраивается в `screeps-integration.config.js`, по
умолчанию `./.cache`).

## 8. Профилирование

`profiling: true` включает `screeps-profiler` через `lib/loadBot.js`. Данные
попадают в отдельные поля отчёта:

- `report.profileText[username]` — текстовый вывод профайлера;
- `report.profileCallgrind[username]` — callgrind-данные.

Для работы профилирования **бот пользователя должен установить
`screeps-profiler` как peer dependency** и обернуть свой `loop` через
`profiler.wrap()`:

```js
const profiler = require('screeps-profiler');
profiler.enable();
module.exports.loop = profiler.wrap(function () {
  // код бота
});
```

Фреймворк только инжектирует необходимые обёртки; без установленного пакета в
`dist/` бота профилирование не заработает.

### CLI-режим

```bash
npm run test:integration -- --profiling
```

При запуске с флагом `--profiling` CLI сохраняет `report.profileCallgrind`
локально:

```
<profilesDir>/<scenario>-<username>-<timestamp>.callgrind
```

Открывайте `.callgrind` через KCachegrind или аналогичный инструмент.

### Семантика тиков профайлера

- **Тик 0** — init;
- **Тик 1** — arm, бот начинает выполняться;
- **Тик 2+** — рабочие замеры;
- **Финальный тик** — дополнительный тик для сбора итоговых данных.

См. также [screeps-profiler](https://github.com/screepers/screeps-profiler).

## 9. Структура файлов

```
screeps-integration-tests/
├── bin/
│   └── screeps-integration-tests.js   # CLI runner
├── src/
│   ├── index.js                       # Public API (createWorld, spec)
│   ├── public/                        # Sub-path exports
│   │   ├── assertions.js              #   screeps-integration-tests/assertions
│   │   ├── events.js                  #   screeps-integration-tests/events
│   │   ├── memory-fixtures.js         #   screeps-integration-tests/memory-fixtures
│   │   ├── metric-assertions.js       #   screeps-integration-tests/metric-assertions
│   │   ├── metrics.js                 #   screeps-integration-tests/metrics (MetricsReport + MetricsRegression)
│   │   └── room-fixtures.js           #   screeps-integration-tests/room-fixtures
│   ├── runScenario.js                 # Worker entry (fork target)
│   ├── constants/
│   │   └── screepsConstants.js        # Игровые константы для spec/assert/metrics
│   ├── tests/                         # Unit-тесты фреймворка (Jest)
│   │   ├── buildCanonicalRoom.test.js
│   │   ├── metrics.test.js
│   │   ├── metricAssertions.test.js
│   │   ├── metricExport.test.js
│   │   └── metricRegression.test.js
│   ├── lib/
│   │   ├── config.js                  # Config loader
│   │   ├── cli.js                     # Парсинг CLI-аргументов
│   │   ├── world.js                   # createWorld — orchestration API
│   │   ├── runtime.js                 # ScreepsServer wrapper
│   │   ├── loadBot.js                 # Загрузка dist/*.js + profiling inject
│   │   ├── console.js                 # Console capture
│   │   ├── assertions.js              # assert* (internal)
│   │   ├── metricAssertions.js        # assert* для метрик (internal)
│   │   ├── metrics.js                 # Recorder + query + aggregation
│   │   ├── metricExport.js            # CSV export
│   │   ├── metricRegression.js        # Current vs baseline
│   │   ├── profile.js                 # saveCallgrind
│   │   ├── cleanup.js                 # pruneCache
│   │   ├── types.js                   # JSDoc-типы
│   │   ├── builders/
│   │   │   ├── index.js               # Re-export surface
│   │   │   ├── spec.js                # Spec constructors
│   │   │   ├── materialize.js         # DB-aware layer
│   │   │   └── memory.js              # load/save/hasFixture
│   │   ├── fixtures/
│   │   │   └── roomFixture.js         # Room fixture registry
│   │   └── observers/
│   │       ├── eventLog.js
│   │       ├── metrics.js
│   │       ├── ownership.js
│   │       └── predicate.js
│   └── tools/                         # CLI tools
│       ├── capture-fixture.js
│       └── clean-cache.js
├── examples/                          # Self-test examples
│   ├── screeps-integration.config.js
│   ├── mock-bot/
│   │   └── dist/
│   │       └── main.js
│   ├── scenarios/
│   │   ├── _template.js
│   │   ├── smoke-empty.scenario.js
│   │   ├── metrics-multi-room.scenario.js
│   │   └── world-lifecycle.scenario.js
│   └── fixtures/
├── package.json
└── jest.config.js
```

## 10. Best practices

1. **Идемпотентность.** Каждый сценарий должен работать независимо от порядка
   запуска.

2. **Fixtures.** Не прогоняйте 10000 тиков, если нужно протестировать уже
   развитую колонию. Создайте room fixture + memory fixture и запускайте тест
   с готового состояния.

3. **Naming convention.** `<область>-<сюжет>.scenario.js`. Примеры названий
   (не обязательно существующих сценариев):
   - `defense-invader-rcl3`
   - `logistics-refill`
   - `regression-issue-42`

4. **Negative tests.** Проверяйте не только положительные сценарии, но и
   негативные — убедитесь, что площадка корректно ловит ошибки.

5. **Event log > Memory.** Event log показывает, что **реально** произошло.
   Memory — что бот **думает**.

6. **Predicate > жёсткие ticks.** Если цель сценария — достижение состояния,
   добавляйте `until: { predicate }` в дополнение к `until.maxTicks`. Не путайте
   `until.maxTicks` (жёсткий лимит для `run()` и `tick()`) с
   `createWorld({ ticks })` (мягкий лимит только для `run()`).

7. **Используйте `createWorld()`, а не низкоуровневый runtime.** Высокоуровневый
   API упрощает большинство действий. Подробности — в
   [API-REFERENCE.md](./API-REFERENCE.md).

## 11. Расширение framework

### Как добавить новый сценарий

См. [GETTING-STARTED.md](./GETTING-STARTED.md#написание-сценария).

### Как добавить новую проверку (`assert`)

```js
// lib/assertions.js
function assertMyCondition(report, opts) {
    // ... специфичная логика
    assert.ok(condition, 'описание если тест провалился');
}

module.exports = { ..., assertMyCondition };
```

### Как добавить новую метрику

1. Добавьте поле в `collectMetrics()` (`observers/metrics.js`).
2. Если метрика scalar — она автоматически попадёт в CSV-экспорт.
3. Для не-scalar полей (например, `creepsByRole`) обработайте формат в
   `metricExport.js`.
4. Добавьте unit-тесты в `src/tests/`.

### Как добавить новый room fixture

См. [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md#7-как-добавить-новый-room-fixture).

### Как обновить memory fixture

См. [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md#8-как-создать-или-обновить-memory-fixture).
