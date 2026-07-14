# Integration Tests — Architecture Guide

Этот документ описывает **архитектуру и внутренние механизмы** integration framework.

Если вы ищете практическое "как начать" — сначала загляните в соседние файлы:

- [README.md](./README.md) — навигация по документации
- [GETTING-STARTED.md](./GETTING-STARTED.md) — установка, запуск, написание первого сценария
- [API-REFERENCE.md](./API-REFERENCE.md) — полный справочник API
- [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md) — room fixtures, memory fixtures, overrides
- [EXAMPLES.md](./EXAMPLES.md) — эталонные сценарии и приёмы
- [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md) — multi-room и multi-bot

## Содержание

1. [Архитектура: слои и ответственность](#1-архитектура-слои-и-ответственность)
2. [Жизненный цикл сценария](#2-жизненный-цикл-сценария)
3. [Runtime: multi-room + multi-bot](#3-runtime-multi-room--multi-bot)
4. [Predicate-based termination](#4-predicate-based-termination)
5. [Observers](#5-observers)
6. [Дочерние процессы и передача данных](#6-дочерние-процессы-и-передача-данных)
7. [Изоляция памяти](#7-изоляция-памяти)
8. [Профилирование](#8-профилирование)
9. [Cleanup и cache management](#9-cleanup-и-cache-management)
10. [Структура файлов framework](#10-структура-файлов-framework)
11. [Best practices](#11-best-practices)
12. [Расширение framework](#12-расширение-framework)

## 1. Архитектура: слои и ответственность

```
┌─────────────────────────────────────────────────────────┐
│  bin/screeps-integration-tests.js (CLI runner)                                │
│  ┌───────────────────────────────────────────────────┐  │
│  │  runScenario.js (child_process.fork)              │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │  scenario.run(opts)                         │  │  │
│  │  │  ┌───────────────────────────────────────┐  │  │  │
│  │  │  │  createWorld(opts)                    │  │  │  │
│  │  │  │  ├─ prepareServer()                   │  │  │  │
│  │  │  │  │   ├─ ScreepsServer + N rooms       │  │  │  │
│  │  │  │  │   └─ terrain                       │  │  │  │
│  │  │  │  ├─ addBots()                         │  │  │  │
│  │  │  │  │   └─ N×addBot (user+code+console)  │  │  │  │
│  │  │  │  ├─ builders/spec → materializeRoom   │  │  │  │
│  │  │  │  │   ├─ controller (optional)         │  │  │  │
│  │  │  │  │   ├─ sources / structures          │  │  │  │
│  │  │  │  │   └─ creeps / hostiles             │  │  │  │
│  │  │  │  ├─ fixtures/roomFixture              │  │  │  │
│  │  │  │  ├─ setBotMemory + console handlers   │  │  │  │
│  │  │  │  └─ world.run()                       │  │  │  │
│  │  │  │      ├─ tick loop (N rooms)           │  │  │  │
│  │  │  │      ├─ onTick callback               │  │  │  │
│  │  │  │      ├─ events (declarative)          │  │  │  │
│  │  │  │      ├─ predicate check               │  │  │  │
│  │  │  │      └─ finalize → report             │  │  │  │
│  │  │  └───────────────────────────────────────┘  │  │  │
│  │  │  assert*() → pass/fail                      │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Разделение в builders

| Слой          | Файл                      | Что знает                              | Назначение                        |
| ------------- | ------------------------- | -------------------------------------- | --------------------------------- |
| `spec`        | `builders/spec.js`        | Дефолты объектов + `roomName`/`userId` | Чистые конструкторы spec-объектов |
| `materialize` | `builders/materialize.js` | DB shape                               | Единственный слой, пишущий в БД   |

> **Важно:** знание DB shape живёт **только** в `materialize`. Сценарии и `createWorld()` используют его как единственный канал к БД.

### Разделение в observers

| Слой      | Файл                     | Назначение                         |
| --------- | ------------------------ | ---------------------------------- |
| eventLog  | `observers/eventLog.js`  | Чтение и фильтрация событий        |
| metrics   | `observers/metrics.js`   | Сбор игровых данных (room metrics) |
| predicate | `observers/predicate.js` | Условия остановки теста            |

### Разделение метрик

| Слой       | Файл                   | Назначение                                   |
| ---------- | ---------------------- | -------------------------------------------- |
| Observer   | `observers/metrics.js` | Чтение состояния мира, возврат `RoomMetrics` |
| Recorder   | `metrics.js`           | Запись сэмплов в `report.metrics` по entity  |
| Query      | `metrics.js`           | Чтение series, агрегация                     |
| Assertions | `metricAssertions.js`  | Assert'ы на основе time-series               |
| Export     | `metricExport.js`      | Преобразование в CSV                         |
| Regression | `metricRegression.js`  | Сравнение current vs baseline (без хранения) |

## 2. Жизненный цикл сценария

```
1. createWorld(opts)
   ├─ prepareServer()            ← ScreepsServer + N комнат + terrain
   ├─ addBots()                  ← N×addBot (user+code+memory+console)
   ├─ buildCanonicalRoom()       ← нормализация spec + fixture + overrides
   ├─ materializeRoom per room   ← controller / sources / structures / creeps / hostiles
   ├─ setBotMemory per bot       ← memory (по username)
   └─ install console handlers per bot

2. world.run() или world.tick(n)
   ├─ for each tick:
   │   ├─ server.tick()
   │   ├─ for each room:
   │   │   ├─ readEventLog → accumulate → report.events
   │   │   ├─ snapshotOwners → mergeOwners
   │   │   └─ (если metrics.enabled) collectMetrics → sampleMetrics → report.metrics.rooms
   │   ├─ events (declarative spawns)
   │   ├─ onTick callback
   │   ├─ predicate check → shouldStop?
   │   └─ break если shouldStop

3. finalize()
   ├─ finalMemory per bot
   ├─ finalRcl per room
   ├─ profileText / profileCallgrind (раздельные поля отчёта)
   └─ wallClockMs

4. assertions
5. world.dispose()                ← в finally обязателен
```

## 3. Runtime: multi-room + multi-bot

Runtime разделён на три независимые фазы:

- `prepareServer({ rooms, cacheDir })` — поднимает `ScreepsServer`, создаёт
  комнаты и terrain. **Не создаёт** ни controller, ни ботов, ни spawn.
  Никаких дефолтов: все объекты комнаты — через `materializeRoom`.
- `addBots({ server, bots, distDir, profiling })` — собственная реализация
  `addBot` per bot, не трогающая controller и spawn. Создаёт пользователя,
  пустую memory, загружает код, подписывается на console.
- `materializeRoom(server, canonical)` — создаёт все объекты комнаты
  (controller, источники, структуры, крипы, hostiles) из канонической
  спецификации.

`createRuntime` сохранён как тонкий facade (prepareServer → addBots → start).

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

## 4. Predicate-based termination

```js
until: {
    maxTicks: 20000,
    predicate: async (w) => {
        const mem = await w.readMemory('mainBot');
        return mem.rooms?.W0N1?.controller?.level >= 3;
    },
}
```

Сценарий завершается когда:

- `predicate` вернул `true`, ИЛИ
- `ticksRun >= maxTicks`, ИЛИ
- `Memory[until.signal]` truthy.

> **Важно:** `until.maxTicks` — **жёсткий** лимит: он уважается и `run()`, и `tick()`. `createWorld({ ticks })` — **мягкий** лимит, он влияет только на `run()`. Если заданы оба — тест остановится по первому достигнутому.

Поддерживается sync/async predicate. Если predicate бросает ошибку — тест завершается с этой ошибкой.

## 5. Observers

| Слой      | Файл                     | Назначение                  |
| --------- | ------------------------ | --------------------------- |
| eventLog  | `observers/eventLog.js`  | Чтение и фильтрация событий |
| metrics   | `observers/metrics.js`   | Сбор room metrics           |
| predicate | `observers/predicate.js` | Условия остановки           |

Event log перезаписывается engine'ом каждый тик → используется `accumulateEvents` для накопления в `report.events[]`.

## 6. Дочерние процессы и передача данных

### Почему `console.log` в сценарии виден

Сценарии выполняются в отдельных дочерних процессах (`child_process.fork` из
`runScenario.js`). Их stdout/stderr по умолчанию наследуется от родителя, поэтому
`console.log` внутри `.scenario.js` попадает в общий вывод.

### Параллельный запуск

`bin/screeps-integration-tests.js` запускает сценарии с ограничением concurrency (`--jobs <N>`, по
умолчанию `min(4, os.cpus().length)`). Каждый сценарий получает собственный
свободный порт storage через `getFreePort()`, поэтому параллельные запуски не
конфликтуют.

### Способы передать данные

| Задача                  | Способ                                           |
| ----------------------- | ------------------------------------------------ |
| Логи ошибок бота        | `report.errors`                                  |
| Все логи бота           | `logLevel: 'all'` → `report.logs`                |
| Финальное состояние     | `report.finalMemory[username]` (per-bot)         |
| Данные по тикам         | `onTick` + замыкание → `report.*`                |
| Снимок в конкретный тик | `world.readMemory(username)` в `onTick`          |
| Состояние объектов в БД | `world.server.db` + замыкание                    |
| Профайлер               | `report.profileText` и `report.profileCallgrind` |
| Event log               | `report.events`                                  |

## 7. Изоляция памяти

Каждый сценарий работает в изолированной cache-директории
`.cache/<pid>-<ts>/`. Это позволяет запускать сценарии
параллельно и избегать конфликтов.

После завершения сценария `runtime.dispose()` останавливает дочерние процессы
сервера, дожидается их завершения и удаляет cache-директорию. При timeout
`bin/screeps-integration-tests.js` убивает всё дерево процессов через `tree-kill`. Это сознательный
компромисс в пользу чистоты каждого прогона.

## 8. Профилирование

`profiling: true` включает `screeps-profiler` через `lib/loadBot.js`. \
Данные попадают в `report.profileText` и `report.profileCallgrind`. \
Если сценарий запускается с флагом `--profiling` - данные в `report.profileCallgrind` также сохраняются локалько в `profiles/<scenario>.callgrind`

```bash
npm run test:integration -- --profiling
```

Открывайте .callgrind через KCachegrind.

см. подробнее: [screeps-profiler](https://github.com/screepers/screeps-profiler)

## 9. Cleanup и cache management

`pruneCache` — внутренняя функция; не экспортируется в публичный API.
Вызывается автоматически при старте `bin/screeps-integration-tests.js`.

Очищает `.cache/`, храня N последних директорий. N настраивается через
`cacheKeep` в `screeps-integration.config.js`. Путь к кэшу задаётся через
`cacheDir` в конфиге (по умолчанию `./.cache`).

## 10. Структура файлов framework

```
screeps-integration-tests/
├── bin/
│   └── screeps-integration-tests.js   # CLI runner
├── src/
│   ├── index.js                       # Public API (createWorld, spec)
│   ├── public/                        # Sub-path exports
│   │   ├── assertions.js              #   screeps-integration-tests/assertions
│   │   ├── metrics.js                 #   screeps-integration-tests/metrics
│   │   ├── metric-assertions.js       #   screeps-integration-tests/metric-assertions
│   │   ├── metric-export.js           #   screeps-integration-tests/metric-export
│   │   ├── memory-fixtures.js         #   screeps-integration-tests/memory-fixtures
│   │   ├── room-fixtures.js           #   screeps-integration-tests/room-fixtures
│   │   └── events.js                  #   screeps-integration-tests/events
│   ├── runScenario.js                 # Worker entry (fork target)
│   ├── lib/
│   │   ├── config.js                  # Config loader (screeps-integration.config.js)
│   │   ├── world.js                   # createWorld — orchestration API
│   │   ├── runtime.js                 # ScreepsServer wrapper
│   │   ├── loadBot.js                 # Загрузка dist/*.js + profiling inject
│   │   ├── console.js                 # Console capture
│   │   ├── cli.js                     # parseArgs
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
│   ├── mock-bot/dist/
│   │   └── main.js
│   ├── scenarios/
│   │   ├── _template.js
│   │   ├── smoke-empty.scenario.js
│   │   ├── world-lifecycle.scenario.js
│   │   └── metrics-multi-room.scenario.js
│   └── fixtures/
├── tests/                             # Unit-тесты framework
├── package.json
└── jest.config.js
```

## 11. Best practices

1. **Идемпотентность.** Каждый сценарий должен работать независимо от порядка запуска.

2. **Fixtures.** Не прогоняйте 10000 тиков каждый раз, когда надо протестировать поведение на уже развитой колонии. \
   Создайте room fixture + memory fixture и сразу запускайте тест на своей готовой развитой колонии.

3. **Naming convention.** `<область>-<сюжет>.scenario.js`:
   - `defense-invader-rcl3`
   - `logistics-refill`
   - `regression-issue-42`

4. **Negative tests.** Проверяйте не только положительные сценарии, но и негативные, чтобы удостоверится что площядка работает.

5. **Event log > Memory.** Event log показывает, что РЕАЛЬНО произошло. Memory — что бот ДУМАЕТ.

6. **Predicate > жёсткие ticks.** Если цель сценария — достижение состояния, добавляйте в тест `until: { predicate }`, в дополнении к `until.maxTicks: 15000`. Не путайте `until.maxTicks` (жёсткий лимит для `run()` и `tick()`) с `createWorld({ ticks })` (мягкий лимит только для `run()`).

7. **Через `createWorld()`, не через низкоуровневый runtime.** Высокоуровневый API упрощает многие действия.

## 12. Расширение framework

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

1. Добавь поле в `collectMetrics()` (`observers/metrics.js`).
2. Если метрика scalar — она автоматически попадёт в CSV экспорт.
3. Для не-scalar полей (например, `creepsByRole`) обработай формат в `metricExport.js`.
4. Добавь unit-тесты в `src/tests/`.

### Как добавить новый room fixture (заготовка комнаты)

См. [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md#7-как-добавить-новый-room-fixture).

### Как обновить memory fixture (готовый Memory)

См. [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md#8-как-создать-или-обновить-memory-fixture).
