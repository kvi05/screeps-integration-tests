# План: рефакторинг метрик-пайплайна в классы

**Статус:** план  
**Дата:** 2026-07-20  
**Цель:** Упростить 5-файловый метрикс-пайплайн, сгруппировав данные + поведение в классы. Повысить читаемость, discoverability (IDE autocomplete) и уменьшить число кросс-импортов.

---

## 1. Обзор текущего состояния

Сегодня метрики живут в 5 файлах и все оперируют «голым» объектом `report.metrics`:

```
observers/metrics.js   → collectMetrics (знает БД), sampleMetrics (→ appendMetricSample)
lib/metrics.js         → createMetricsReport, appendMetricSample, getMetricSeries, getLatestMetric,
                         averageMetric, sumMetric, deltaMetric, rateMetric, getWorldSnapshotAtTick, …
lib/metricAssertions.js → assertLatestMetricAtLeast, assertLatestMetricBelow, assertMetricReached, assertMetricMonotonic
lib/metricExport.js    → (удалён — функциональность в MetricsReport.toCsv())
lib/metricRegression.js→ selectWindow, compareMetric
```

**Проблемы:**

- Данные (`report.metrics`) и операции над ними разнесены по 5 модулям
- Каждый модуль импортирует куски из `metrics.js` — кросс-зависимости
- Потребитель должен помнить, что `getRoomMetrics` в `metrics`, `assertLatestMetricAtLeast` в `metric-assertions`, `toCsv` в `metric-export`
- `report.metrics` — публичный мутабельный объект, нет инкапсуляции

## 2. Целевая архитектура

Три класса, каждый со своей зоной ответственности:

```
┌─────────────────────────────────────────────────┐
│ MetricsReport (lib/metricsReport.js)             │
│ ─────────────────────────────────────────────── │
│ Данные + запись + чтение + агрегация + CSV       │
│ Методы: .append(), .series(), .latest(),         │
│   .average(), .sum(), .delta(), .rate(),         │
│   .toCsv(), .flatten()                           │
│ Внутри: _rooms, _colonies, _bots, _world         │
└──────────────┬──────────────────────────────────┘
               │ использует
┌──────────────▼──────────────────────────────────┐
│ MetricsAssert (lib/metricAssertions.js)           │
│ ─────────────────────────────────────────────── │
│ Принимает MetricsReport в конструктор            │
│ .hasSamples(), .latestAtLeast(),                 │
│   .latestBelow(), .reached(), .monotonic()       │
└──────────────┬──────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────┐
│ MetricsRegression (lib/metricRegression.js)       │
│ ─────────────────────────────────────────────── │
│ Принимает baseline MetricsReport в конструктор   │
│ .compare(currentReport, entityType, …)           │
└─────────────────────────────────────────────────┘

observers/metrics.js — НЕ меняет ответственность:
  collectMetrics(server, room) → plain объект (знает БД)
  sampleMetrics(metricsReport, room, data, tick) → делегирует metricsReport.append()
```

**Границы ответственности сохранены:**

- `collectMetrics` по-прежнему единственный, кто знает о БД/ScreepsServer
- `MetricsReport` не знает о БД — только хранит и обрабатывает данные
- `MetricsAssert`/`MetricsRegression` не знают о БД и не знают о `WorldReport` — только о `MetricsReport`

---

## 3. Детальный план действий

### Этап 1. Подготовка

**1.1.** Убедиться, что все тесты проходят на текущем коде:

```
npm run lint && npm run format:check && npm test && npm run test:integration:smoke
```

**1.2.** Создать ветку `metrics-class-refactor`.

### Этап 2. Создать `src/lib/metricsReport.js` (новый файл — ядро)

**2.1.** Класс `MetricsReport`. Полный список методов:

| Метод                                        | Сигнатура                                 | Поглощает                                      |
| -------------------------------------------- | ----------------------------------------- | ---------------------------------------------- |
| `constructor()`                              | —                                         | `createMetricsReport()`                        |
| `append(entityType, entityId, tick, values)` | → `MetricsSample`                         | `appendMetricSample()` + `appendWorldSample()` |
| `series(entityType, entityId)`               | → `MetricSeries`                          | `getMetricSeries()`                            |
| `latest(entityType, entityId)`               | → `MetricsSample\|undefined`              | `getLatestMetric()`                            |
| `atTick(entityType, entityId, tick)`         | → `MetricsSample\|undefined`              | `getMetricAtTick()`                            |
| `snapshotAtTick(entityType, tick)`           | → `{[entityId]: MetricsSample}`           | `getWorldSnapshotAtTick()` — теперь обобщённый |
| `values(series, metricName)`                 | → `Array<{tick,value}>`                   | `getMetricValues()`                            |
| `average(series, metricName)`                | → `number\|undefined`                     | `averageMetric()`                              |
| `sum(series, metricName)`                    | → `number`                                | `sumMetric()`                                  |
| `delta(series, metricName)`                  | → `number\|undefined`                     | `deltaMetric()`                                |
| `rate(series, metricName)`                   | → `number\|undefined`                     | `rateMetric()`                                 |
| `flatten(opts?)`                             | → `FlatMetricRow[]`                       | `flattenMetricSeries()`                        |
| `toCsv(opts?)`                               | → `string`                                | `toCsv()`                                      |
| `toCsvRows(opts?)`                           | → `string[]`                              | `toCsvRows()`                                  |
| _static_ `resolveConfig(worldOpts)`          | → `{every, rooms, colonies, bots, world}` | `resolveMetricsConfig()`                       |
| _static_ `fromJSON(json)`                    | → `MetricsReport`                         | новый — десериализация baseline                |
| `toJSON()`                                   | → plain object                            | новый — `JSON.stringify`                       |

**Convenience-обёртки** (симметричны для всех entity-типов; `room()` ≡ `series('rooms', …)` и т.д.):

| Метод                | ≡                          |
| -------------------- | -------------------------- |
| `room(name)`         | `series('rooms', name)`    |
| `colony(name)`       | `series('colonies', name)` |
| `bot(name)`          | `series('bots', name)`     |
| `latestRoom(name)`   | `latest('rooms', name)`    |
| `latestColony(name)` | `latest('colonies', name)` |
| `latestBot(name)`    | `latest('bots', name)`     |

**Архитектурное решение:** методы работы с данными (`series`, `latest`, `average`, …) **едины** для всех типов сущностей. Различаются только **поля** в `values`:

- `rooms`: `rcl`, `energyAvailable`, `creepCount`, `creepsByRole`, … (реализовано)
- `colonies`: `stage`, `creepCount`, … (будет)
- `bots`: `cpu`, `gcl`, … (будет)
- `world`: `roomCount`, … (будет)

Благодаря этому сценарий пишет `m.average(m.room('W0N1'), 'rcl')` для комнат и `m.average(m.bot('bot1'), 'cpu')` для ботов — одинаково, меняется только entityType и имя поля.

Приватные методы:

- `_validateTick(tick)` — tick ≥ 0, целое
- `_validateEntityType(type)` — rooms/colonies/bots/world
- `_flattenSample(entityType, entityId, sample, metricFilter)`
- `_isScalar(v)`
- `_escapeCsv(v)`

**2.2.** Геттеры для доступа к внутренним структурам (нужны `world.js` для `report.metrics.rooms` и обратной совместимости структуры `WorldReport`):

```js
get rooms() { return this._rooms; }
get colonies() { return this._colonies; }
get bots() { return this._bots; }
get world() { return this._world; }
```

**2.3.** JSDoc на каждом публичном методе — на английском.

**2.4.** `'use strict';` в первой строке.

### Этап 3. Переписать `src/lib/metricAssertions.js` → класс `MetricsAssert`

**3.1.** Полностью заменить содержимое файла. Старые функции удалить.

```js
class MetricsAssert {
    constructor(metricsReport) { this._m = metricsReport; }
    hasSamples(entityType, entityId) { … }
    latestAtLeast(entityType, entityId, metricName, expected) { … }
    latestBelow(entityType, entityId, metricName, expected) { … }
    reached(entityType, entityId, metricName, expected) { … }
    monotonic(entityType, entityId, metricName) { … }
    _assertNumeric(v, label) { … }
}
```

**3.2.** Экспортировать только класс:

```js
module.exports = { MetricsAssert };
```

### Этап 4. Переписать `src/lib/metricRegression.js` → класс `MetricsRegression`

**4.1.** Полностью заменить содержимое. Старые функции удалить. `selectWindow` сохранить как приватный метод `_selectWindow` (используется внутри `compare`).

```js
class MetricsRegression {
    constructor(baselineMetricsReport) { this._baseline = baselineMetricsReport; }
    compare(currentReport, entityType, entityId, metricName, opts?) → CompareResult
    _selectWindow(series, window) { … }
    _aggregate(series, metricName, aggregator, report) { … }
}
```

**4.2.** Экспортировать только класс:

```js
module.exports = { MetricsRegression };
```

### Этап 5. Обновить `src/lib/observers/metrics.js`

**5.1.** `collectMetrics` — без изменений (знает БД, не в классе).

**5.2.** `sampleMetrics` — обновить сигнатуру: первый аргумент теперь `MetricsReport`, а не `WorldReport`:

```js
// БЫЛО:
function sampleMetrics(report, roomName, metrics, tick) {
  appendMetricSample(report.metrics, 'rooms', roomName, tick, metrics);
}
// СТАЛО:
function sampleMetrics(metricsReport, roomName, roomMetrics, tick) {
  metricsReport.append('rooms', roomName, tick, roomMetrics);
}
```

### Этап 6. Удалить `src/lib/metrics.js`

**6.1.** `resolveMetricsConfig` перенесён в `MetricsReport.resolveConfig` (этап 2).

**6.2.** Все остальные функции поглощены классом `MetricsReport`.

**6.3.** Файл удаляется полностью.

### Этап 7. Удалить `src/lib/metricExport.js`

**7.1.** `flattenMetricSeries` → `MetricsReport.prototype.flatten`.

**7.2.** `toCsv` / `toCsvRows` → `MetricsReport.prototype.toCsv` / `toCsvRows`.

**7.3.** Файл удаляется полностью.

### Этап 8. Обновить `src/lib/world.js`

**8.1.** Импорт:

```js
// БЫЛО:
const { createMetricsReport, resolveMetricsConfig } = require('./metrics');
// СТАЛО:
const { MetricsReport } = require('./metricsReport');
```

**8.2.** `resolveMetricsConfig(opts)` → `MetricsReport.resolveConfig(opts)`. Статический метод теперь возвращает конфиг для всех entity-типов: `{every, rooms, colonies, bots, world}` (нереализованные типы пока `false`).

**8.3.** Создание отчёта:

```js
// БЫЛО:
report.metrics = createMetricsReport();
// СТАЛО:
report.metrics = new MetricsReport();
```

**8.4.** В `doTick`, вызов `sampleMetrics`:

```js
// БЫЛО:
sampleMetrics(report, name, metrics, tickNum);
// СТАЛО:
sampleMetrics(report.metrics, name, metrics, tickNum);
```

**8.5.** Удалить импорт `collectMetrics, sampleMetrics` из `./observers/metrics` (если они импортируются отдельно) — они уже импортируются строкой `const { collectMetrics, sampleMetrics } = require('./observers/metrics');`. Проверить, что импорт корректен после изменений.

### Этап 9. Обновить публичный API (sub-path exports)

**9.1.** `src/public/metrics.js` — полностью переписать:

```js
'use strict';

/**
 * @file Metric time-series storage, query helpers, aggregation, CSV export,
 *   and regression comparison.
 *
 * **Available exports:**
 * - `MetricsReport` — storage + query + aggregation + CSV export
 * - `MetricsRegression` — baseline comparison
 *
 * @example
 * const { MetricsReport, MetricsRegression } = require('screeps-integration-tests/metrics');
 * const m = report.metrics; // MetricsReport instance
 * const series = m.room('W0N1');
 * const csv = m.toCsv();
 *
 * @module screeps-integration-tests/metrics
 */

const { MetricsReport } = require('../lib/metricsReport');
const { MetricsRegression } = require('../lib/metricRegression');

module.exports = { MetricsReport, MetricsRegression };
```

**9.2.** `src/public/metric-assertions.js` — полностью переписать:

```js
'use strict';

/**
 * @file Assertions on time-series metric values.
 *
 * **Available exports:**
 * - `MetricsAssert` — assertion class (accepts MetricsReport in constructor)
 *
 * @example
 * const { MetricsAssert } = require('screeps-integration-tests/metric-assertions');
 * const ma = new MetricsAssert(report.metrics);
 * ma.latestAtLeast('rooms', 'W0N1', 'rcl', 3);
 *
 * @module screeps-integration-tests/metric-assertions
 */

const { MetricsAssert } = require('../lib/metricAssertions');

module.exports = { MetricsAssert };
```

**9.3.** `src/public/metric-export.js` — **удалить**, функциональность полностью покрыта `MetricsReport.toCsv()`.

```js
'use strict';

/**
 * @file CSV export re-exports from MetricsReport.
 *
 * Preferred: use `metricsReport.toCsv()` directly on the MetricsReport instance.
 * This sub-path is kept for discoverability.
 *
 * @module screeps-integration-tests/metric-export
 */

const { MetricsReport } = require('../lib/metricsReport');

/**
 * @param {import('../lib/types').WorldReport} report
 * @param {Object} [opts]
 * @returns {string}
 */
function toCsv(report, opts) {
  return report.metrics.toCsv(opts);
}

/**
 * @param {import('../lib/types').WorldReport} report
 * @param {Object} [opts]
 * @returns {import('../lib/types').FlatMetricRow[]}
 */
function flattenMetricSeries(report, opts) {
  return report.metrics.flatten(opts);
}

/**
 * @param {import('../lib/types').WorldReport} report
 * @param {Object} [opts]
 * @returns {string[]}
 */
function toCsvRows(report, opts) {
  return report.metrics.toCsvRows(opts);
}

module.exports = { flattenMetricSeries, toCsvRows, toCsv };
```

**9.4.** `package.json` — `exports` **не меняются** (пути те же, файлы на месте).

### Этап 10. Обновить/создать тесты

#### 10.1. Создать `src/tests/metricsReport.test.js` (новый)

Полный набор тестов для `MetricsReport`:

- [x] `constructor` — пустая структура
- [x] `append()` — добавляет сэмпл в rooms/colonies/bots/world
- [x] `append()` — не мутирует входной `values`
- [x] `append()` — накапливает несколько сэмплов
- [x] `append()` — бросает при недопустимом entityType / пустом entityId / отрицательном tick
- [x] `series()` — возвращает `[]` для отсутствующей сущности
- [x] `room()` / `colony()` / `bot()` — convenience-обёртки ≡ `series(entityType, …)`
- [x] `latest()` / `latestRoom()` / `latestColony()` / `latestBot()` — последний сэмпл
- [x] `atTick()` — точный сэмпл на тике
- [x] `snapshotAtTick(entityType, tick)` — снимок всех entityId указанного типа
- [x] `values()` — фильтрует только конечные числа
- [x] `average()` / `sum()` / `delta()` / `rate()` — агрегация
- [x] `flatten()` — сортировка, фильтр по entityTypes/metrics, разворот creepsByRole
- [x] `toCsv()` / `toCsvRows()` — header, экранирование, неизменность данных
- [x] `toJSON()` / `fromJSON()` — roundtrip
- [x] `resolveConfig()` — статический метод
- [x] Геттеры `rooms`/`colonies`/`bots`/`world` — возвращают внутренние структуры

#### 10.2. Переписать `src/tests/metricAssertions.test.js`

- [x] Полностью переписать: тестировать класс `MetricsAssert`
- [x] `makeReport()` helper → `new MetricsReport()`
- [x] Те же кейсы, но через `new MetricsAssert(m).latestAtLeast(…)` вместо `assertLatestMetricAtLeast(report, …)`

#### 10.3. Удалить `src/tests/metricExport.test.js`

- [x] Файл удалён — тесты `MetricsReport.flatten/toCsv/toCsvRows` уже покрыты в `metricsReport.test.js`.

#### 10.4. Переписать `src/tests/metricRegression.test.js`

- [x] Тестировать класс `MetricsRegression`
- [x] `selectWindow` → приватный метод, тестируется через `compare` или отдельно через доступ к `_selectWindow` (на усмотрение)

#### 10.5. Удалить `src/tests/metrics.test.js`

- [x] Все функции, которые он тестировал, теперь методы `MetricsReport`. Тесты перенесены в `metricsReport.test.js`.

### Этап 11. Обновить интеграционный сценарий

**11.1.** `examples/scenarios/metrics-multi-room.scenario.js` — перевести на новый API:

```js
const { MetricsAssert } = require('screeps-integration-tests/metric-assertions');
// больше не нужно импортировать getRoomMetrics, getWorldSnapshotAtTick из metrics

const m = report.metrics; // MetricsReport
const r1 = m.room(ROOM_1);
const r2 = m.room(ROOM_2);

const ma = new MetricsAssert(m);
ma.latestAtLeast('rooms', ROOM_1, 'rcl', 2);
ma.reached('rooms', ROOM_2, 'rcl', 1);

const snapshot = m.snapshotAtTick('rooms', 5);

// Структура отчёта: m.colonies, m.bots, m.world — геттеры для всех типов
```

### Этап 12. Обновить документацию

#### 12.1. `API-REFERENCE.md` — секция «8. Metrics API»

- [x] Заменить таблицы старых функций на описание трёх классов
- [x] Добавить упоминание о CSV-экспорте и regression-сравнении
- [x] Пример использования в новом стиле
- [x] Сохранить секцию про `metrics: { every, rooms }` в `createWorld` opts

#### 12.2. `EXAMPLES.md` — секция «6. Metrics: multi-room time-series»

- [x] Обновить пример на классовый API
- [x] Показать `MetricsAssert`, `m.room()`, `m.snapshotAtTick()`
- [x] Показать CSV-экспорт одной строкой: `m.toCsv()`
- [x] Показать regression (кратко): `new MetricsRegression(baseline).compare(m, …)`

#### 12.3. `METRICS-REFACTOR-PLAN.md`

- [x] Добавить ссылку на этот документ в начало
- [x] Пометить статус: «заменён на METRICS-CLASS-REFACTOR.md»

#### 12.3. `METRICS-FINALIZATION.md`

- [x] Актуализировать: добавлено предупреждение об устаревании

#### 12.5. `src/index.js`

- [x] Обновить таблицу sub-path exports (упоминание классов `MetricsReport`, `MetricsAssert`, `MetricsRegression`)

### Этап 13. Обновить `src/lib/types.js`

**13.1.** Тип `MetricsReport` больше не plain-объект, а класс. Обновить JSDoc:

```js
/**
 * @class MetricsReport
 * @property {Object<string, MetricSeries>} rooms
 * @property {Object<string, MetricSeries>} colonies
 * @property {Object<string, MetricSeries>} bots
 * @property {MetricSeries} world
 */
```

**13.2.** Тип `WorldReport.metrics` теперь ссылается на класс, а не на plain-объект.

### Этап 14. Проверка и финализация

**14.1.** Пройти полный цикл:

```
npm run lint && npm run format:check && npm test && npm run test:integration
```

**14.2.** Убедиться, что `JSON.stringify(report)` работает (метод `toJSON()` на `MetricsReport`).

**14.3.** Убедиться, что `report.metrics.rooms.W0N1` работает (геттер).

---

## 4. Совместимость

### Обратная совместимость не требуется

Пользователь явно указал: обратная совместимость не нужна. Старые функции удаляются, публичный API меняется полностью. Единственный сценарий, использующий метрики (`metrics-multi-room.scenario.js`), обновляется в рамках этапа 11.

### Совместимость структуры WorldReport

- `report.metrics` — теперь экземпляр `MetricsReport`
- Геттеры `rooms`, `colonies`, `bots`, `world` обеспечивают доступ `report.metrics.rooms.W0N1` (используется в assertions и при прямом чтении)
- `toJSON()` обеспечивает `JSON.stringify(report)` для логирования/отладки

### Сериализация

- [x] `toJSON()` → `{rooms, colonies, bots, world}` — встроен в класс
- [x] `MetricsReport.fromJSON(json)` — статический метод для загрузки baseline

---

## 5. Порядок выполнения

```
Этап 1    ✓ Прогнать все тесты на текущем коде
Этап 2    □ Создать src/lib/metricsReport.js (новый класс)
Этап 10.1 □ Создать src/tests/metricsReport.test.js (новые тесты)
          □ npm test -- metricsReport  ← ПРОВЕРИТЬ новый класс изолированно
Этап 3    □ Переписать src/lib/metricAssertions.js → класс MetricsAssert
Этап 4    □ Переписать src/lib/metricRegression.js → класс MetricsRegression
Этап 5    □ Обновить src/lib/observers/metrics.js (сигнатура sampleMetrics)
Этап 6    □ Удалить src/lib/metrics.js
Этап 7    □ Удалить src/lib/metricExport.js
Этап 8    □ Обновить src/lib/world.js (импорт MetricsReport)
          □ npm test  ← ПРОВЕРИТЬ все unit-тесты
Этап 9    □ Переписать src/public/metrics.js, metric-assertions.js; удалить metric-export.js
Этап 10.2 □ Переписать src/tests/metricAssertions.test.js
Этап 10.3 □ Удалить src/tests/metricExport.test.js (покрыт в metricsReport.test.js)
Этап 10.4 □ Переписать src/tests/metricRegression.test.js
Этап 10.5 □ Удалить src/tests/metrics.test.js
          □ npm test  ← ПРОВЕРИТЬ
Этап 11   □ Обновить examples/scenarios/metrics-multi-room.scenario.js
          □ npm run test:integration:smoke  ← ПРОВЕРИТЬ
Этап 12   □ Обновить API-REFERENCE.md, EXAMPLES.md, src/index.js
Этап 13   □ Обновить src/lib/types.js (JSDoc для MetricsReport)
Этап 14   □ npm run check  ← ФИНАЛЬНАЯ ПРОВЕРКА
```

---

## 6. Риски

| Риск                                                                         | Вероятность | Митигация                                                    |
| ---------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------ |
| `report.metrics.rooms` — прямой доступ к полю ломается                       | Низкая      | Геттеры `get rooms()` в классе                               |
| `JSON.stringify(report)` ломается — класс не сериализуется                   | Средняя     | `toJSON()` в классе, покрыть тестом                          |
| `report.metrics` — не plain-объект, ломает код, который ожидает `{rooms:{}}` | Средняя     | Геттеры + `toJSON()`. Проверить `world.js` и все assertions  |
| Интеграционный сценарий `metrics-multi-room` падает                          | Средняя     | Обновить сценарий (этап 11)                                  |
| Удаление `metrics.js` ломает неожиданных потребителей                        | Низкая      | `grep_search` по всему репозиторию перед удалением           |
| `MetricsReport` не копируется через `{...report.metrics}`                    | Низкая      | Документировать: использовать `fromJSON(toJSON())` для копий |

---

## 7. Пример использования после рефакторинга

```js
const { createWorld, spec } = require('screeps-integration-tests');
const { MetricsAssert } = require('screeps-integration-tests/metric-assertions');
const { MetricsRegression } = require('screeps-integration-tests/metrics');

async function run() {
  const world = await createWorld({
    rooms: [{ name: 'W0N1', controller: spec.controller({ level: 2 }) }],
    bots: [{ username: 'bot', room: 'W0N1' }],
    ticks: 100,
    metrics: { every: 10, rooms: true },
  });

  try {
    await world.run();
    const { report } = world;
    const m = report.metrics; // MetricsReport

    // ── Чтение ──────────────────────────────
    const series = m.room('W0N1'); // time-series
    const latest = m.latestRoom('W0N1'); // последний сэмпл
    const avgRcl = m.average(series, 'rcl'); // средний RCL

    // ── Assertions ──────────────────────────
    const ma = new MetricsAssert(m);
    ma.hasSamples('rooms', 'W0N1');
    ma.latestAtLeast('rooms', 'W0N1', 'rcl', 2);

    // ── CSV ─────────────────────────────────
    const csv = m.toCsv({ entityTypes: ['rooms'] });
    require('fs').writeFileSync('metrics.csv', csv);

    // ── Regression ──────────────────────────
    const baselineJson = JSON.parse(require('fs').readFileSync('baseline.json', 'utf-8'));
    const baseline = MetricsReport.fromJSON(baselineJson);
    const reg = new MetricsRegression(baseline);
    const result = reg.compare(m, 'rooms', 'W0N1', 'rcl', {
      aggregator: 'average',
      tolerance: 0.5,
    });
    console.log('Regression:', result.passed ? 'OK' : 'FAIL', result);
  } finally {
    await world.dispose();
  }
}
```

---

## 8. Метрики успеха

- [x] Число файлов метрик-пайплайна: 5 → 3 (удалены `metrics.js`, `metricExport.js`; создан `metricsReport.js`)
- [x] Удалены также `metric-export.js` (public), `metricExport.test.js`, `metrics.test.js`
- [x] Число импортов в сценарии: 3–4 → 1–2
- [x] `npm test` — все unit-тесты проходят
- [x] `npm run test:integration` — интеграционные сценарии проходят
- [x] `npm run lint && npm run format:check` — чисто
- [x] `JSON.stringify(report)` работает (сериализация через `toJSON()`)
- [x] `report.metrics.rooms.W0N1` работает (геттер)
- [x] IDE autocomplete показывает методы `.append()`, `.series()`, `.toCsv()` при вводе `report.metrics.`
