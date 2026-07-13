# План рефакторинга метрик integration tests

## 1. Цель и границы изменений

Нужно заменить текущую структуру `world.report.metrics`, которая хранит плоский массив сэмплов разных комнат, на расширяемую time-series модель. Модель должна:

- удобно поддерживать анализ одной комнаты во времени;
- позволять добавлять метрики колонии, бота и всего мира;
- не дублировать сэмплы в нескольких индексах;
- сохранять JSON-совместимость отчёта;
- поддерживать assertions, regression checks, экспорт в CSV и будущую интеграцию с Grafana;
- позволять сценарию подключать собственные метрики без изменения общего цикла `world.js`;
- не смешивать получение игровых данных, хранение time-series и проверки assertions.

В первую итерацию не нужно добавлять реальный экспорт в Grafana, подключение внешнего хранилища или автоматическое сравнение с baseline. Нужно заложить API и структуру, на которые эти возможности можно будет добавить позже.

Изменения выполнять только в исходниках и тестах `test/integration/`. Не изменять `dist/`, `coverage/`, `.cache/` и другие автоматически генерируемые каталоги.

---

## 2. Текущее состояние, которое нужно изменить

### 2.1. Текущая запись метрик

Файл: `test/integration/lib/observers/metrics.js`.

Сейчас:

- `collectMetrics(server, roomName)` читает `rooms.objects` и возвращает объект метрик комнаты;
- `sampleMetrics(report, metrics, tick)` создаёт `{ tick, ...metrics }` и добавляет его в `report.metrics`;
- поле `room` объявлено в JSDoc `MetricsSample`, но фактически не записывается;
- один массив содержит сэмплы всех комнат, поэтому потребитель должен самостоятельно фильтровать и группировать записи.

### 2.2. Текущий цикл мира

Файл: `test/integration/lib/world.js`.

Сейчас:

- `report.metrics` инициализируется как `[]`;
- после каждого тика цикл проходит по комнатам;
- при включённом `metricsEvery` вызывает `collectMetrics(server, name)` и `sampleMetrics(report, metrics, tickNum)`;
- после сбора метрик выполняется `onTick`.

Важно сохранить порядок: базовые метрики должны сниматься после `server.tick()` и до пользовательского `onTick`, если это не будет явно изменено отдельным решением.

### 2.3. Текущие типы

Файл: `test/integration/lib/types.js`.

Нужно обновить:

- `WorldReport.metrics`;
- `MetricsSample`;
- типы опций `WorldOpts`;
- добавить типы для индексов сущностей, конфигурации collectors и helper-функций.

Все новые JSDoc-комментарии писать на русском языке согласно правилам проекта.

---

## 3. Целевая архитектура

### 3.1. Основная форма `report.metrics`

Использовать entity-first time series, а не два индекса и не column-oriented представление:

```js
report.metrics = {
  rooms: {
    W0N1: [
      { tick: 100, rcl: 2, energyAvailable: 1200 },
      { tick: 200, rcl: 3, energyAvailable: 1500 },
    ],
    W0N2: [{ tick: 100, rcl: 1, energyAvailable: 300 }],
  },
  colonies: {
    colonyAlpha: [{ tick: 100, roomCount: 2, totalEnergy: 5000 }],
  },
  bots: {
    bot: [{ tick: 100, cpuUsed: 12.4, creepCount: 10 }],
  },
  world: [{ tick: 100, roomCount: 2, totalCreeps: 15 }],
};
```

В первой реализации допускается фактически заполнять только `rooms`. Остальные разделы должны присутствовать как пустые объекты/массивы, чтобы структура отчёта была стабильной:

```js
{
    rooms: {},
    colonies: {},
    bots: {},
    world: [],
}
```

### 3.2. Почему не нужен `byTick`

Не добавлять второй индекс `byTick` в основной отчёт:

- это дублирует данные;
- повышает вероятность рассинхронизации;
- большинство текущих проверок анализирует прогресс конкретной комнаты;
- снимок мира на тике можно получить helper-функцией;
- при необходимости оптимизации сначала измерить производительность, а не добавлять преждевременную денормализацию.

### 3.3. Общая модель сущности

Ввести универсальное понятие metric series:

- `entityType`: `'rooms' | 'colonies' | 'bots' | 'world'`;
- `entityId`: имя комнаты, имя колонии, имя бота или специальный идентификатор мира;
- `sample`: plain object с обязательным `tick` и произвольными числовыми/JSON-полями.

Для `world` можно использовать массив напрямую, потому что у мира один логический entity. Для единообразного API query-helper должен уметь работать и с `world`, и с map-разделами.

---

## 4. Размещение модулей и ответственность

Не складывать все helpers в `assertions.js` или в `metrics.js`. Разделить ответственность по слоям.

### 4.1. `test/integration/lib/observers/metrics.js`

Оставить только сбор игровых данных и совместимый orchestration API:

- `collectMetrics(server, roomName)` — получить метрики одной комнаты;
- `sampleMetrics(report, roomName, metrics, tick)` — записать room sample в report;
- в будущем collectors для colony/bot/world, если им нужен доступ к серверу или игровым объектам.

Этот модуль не должен содержать `node:assert`, CSV-форматирование или baseline-сравнение.

### 4.2. Новый модуль `test/integration/lib/metrics.js`

Создать доменные helpers для чтения и обработки уже собранного отчёта. Предпочтительно назвать файл именно `metrics.js`, потому что `observers/metrics.js` отвечает за чтение мира, а новый модуль — за работу с результатом.

Планируемые функции:

- `getMetricSeries(report, entityType, entityId)` — получить массив сэмплов с понятной ошибкой при неправильной структуре;
- `getRoomMetrics(report, roomName)` — короткая специализированная обёртка;
- `getLatestMetric(report, entityType, entityId)` — последний сэмпл или `undefined`;
- `getLatestRoomMetrics(report, roomName)` — специализированная обёртка;
- `getMetricAtTick(report, entityType, entityId, tick)` — получить сэмпл ровно на тике;
- `getWorldSnapshotAtTick(report, tick)` — собрать `{ [roomName]: sample }` из room series;
- `getMetricValues(series, metricName)` — получить значения конкретного поля с сохранением тиков;
- `averageMetric(series, metricName, options)` — среднее значение с проверкой отсутствующих/нечисловых значений;
- `sumMetric(series, metricName)` — сумма числовых значений;
- `deltaMetric(series, metricName)` — разница между первым и последним значением;
- `rateMetric(series, metricName)` — изменение значения на тик между первым и последним сэмплом.

Не добавлять функции, которые нужны только одному сценарию. Сценарийные вычисления должны оставаться в самом сценарии либо в отдельном scenario-specific helper.

### 4.3. Новый модуль `test/integration/lib/metricAssertions.js`

Создать assertions, зависящие от структуры метрик, отдельно от общих object/event assertions:

- `assertHasMetricSamples(report, entityType, entityId)`;
- `assertLatestMetricAtLeast(report, entityType, entityId, metricName, expected)`;
- `assertLatestMetricBelow(report, entityType, entityId, metricName, expected)`;
- `assertMetricReached(report, entityType, entityId, metricName, expected)`;
- `assertMetricMonotonic(report, entityType, entityId, metricName)` — использовать только для метрик, которые действительно должны быть монотонными;
- `assertMetricRegression(currentReport, baselineReport, spec)` — добавить только после определения контракта baseline и допусков.

На первом шаге включить только assertions без baseline, чтобы не смешивать структурный рефакторинг и проектирование формата исторических данных.

`test/integration/lib/assertions.js` не должен импортировать весь новый модуль через циклическую зависимость. Варианты интеграции:

1. оставить `assertions.js` для текущих assertions, а сценарии импортируют `metricAssertions.js` напрямую;
2. реэкспортировать функции из `assertions.js`, если это не создаёт циклических зависимостей.

Предпочтительный вариант — прямой импорт `metricAssertions.js` в сценариях и отсутствие скрытого агрегирующего API до тех пор, пока набор не стабилизирован.

### 4.4. Новый модуль `test/integration/lib/metricExport.js`

Заложить отдельный модуль для преобразования данных, но не подключать запись файлов автоматически:

- `flattenMetricSeries(report)` — вернуть строки унифицированного вида `{ entityType, entityId, tick, metric, value }`;
- `toCsvRows(report, options)` — подготовить табличные строки;
- `toCsv(report, options)` — вернуть CSV-строку;
- `writeMetricsCsv(report, filePath, options)` — добавить только если текущие правила проекта и потребность в сохранении подтверждены.

Экспорт не должен находиться в observer-модуле или assertions-модуле. Он получает готовый JSON-отчёт и ничего не знает о Screeps server.

Отдельно решить вопрос с вложенными значениями:

- числовые scalar-поля экспортировать напрямую;
- `creepsByRole` и другие объекты либо сериализовать JSON-строкой, либо разворачивать в отдельные metric names;
- `spawnHits` не считать scalar-метрикой по умолчанию.

В плане реализации зафиксировать детерминированный порядок колонок и экранирование CSV.

### 4.5. Новый модуль `test/integration/lib/metricCollectors.js` (вторая фаза)

Для расширяемых стандартных и пользовательских collectors не перегружать `observers/metrics.js`. Во второй фазе создать registry:

```js
const collectors = {
  room: [collectRoomMetrics],
  colony: [],
  bot: [],
  world: [],
};
```

Collector должен иметь явный контракт:

```js
async function collector(context) {
  return {
    metricName: 'containerEnergyLoss',
    value: 10,
  };
}
```

Либо, предпочтительно для batch-сэмпла:

```js
async function collector(context) {
  return { containerEnergyLoss: 10 };
}
```

Контекст должен быть read-only по смыслу и содержать только явно необходимые зависимости (`server`, `roomName`, `tick`, `report`, `bots`, `rooms`). Collector не должен напрямую менять `report`.

Пользовательские collectors задавать через `WorldOpts.metrics`, например:

```js
metrics: {
    every: 10,
    room: [collectContainerOverflow],
    world: [collectWorldCpu],
},
```

Не использовать функцию `customMetrics(world, report)` с произвольной мутацией отчёта: это нарушает границы и затрудняет проверку формата. Collector должен вернуть данные, а общий recorder должен записать их в нужную series.

---

## 5. Детальный порядок реализации

### Этап 1. Зафиксировать типы и контракт

Изменить `test/integration/lib/types.js`:

1. Добавить JSDoc-типы:
   - `MetricEntityType`;
   - `MetricSample` или обновлённый `MetricsSample`;
   - `RoomMetrics` как тип метрик без поля `tick` и без `room`;
   - `MetricSeries`;
   - `MetricEntityMap`;
   - `MetricsReport`;
   - `MetricCollectorContext`;
   - `MetricCollector`;
   - `MetricsOpts`.
2. Заменить `WorldReport.metrics: MetricsSample[]` на `WorldReport.metrics: MetricsReport`.
3. Явно описать обязательное поле `tick` у samples.
4. Удалить inconsistency: не оставлять в `MetricsSample` поле `room`, если имя комнаты уже является ключом `report.metrics.rooms`.
5. Решить совместимость с пустыми/старыми report: query helpers должны корректно обработать `undefined` и старый массив, либо явно выбросить ошибку с сообщением о необходимости нового формата. Предпочтительно не поддерживать старый массив в production API после миграции, но добавить временный диагностический error.
6. Обновить JSDoc `WorldOpts`: сохранить `metricsEvery` как backward-compatible shorthand или заменить на `metrics.every`; выбрать один вариант и зафиксировать его в плане реализации. Рекомендуемый переходный контракт: `metricsEvery` оставить рабочим, а `metrics.every` добавить как новый вариант; при конфликте использовать `metrics.every` и выдавать предупреждение только в тестовой инфраструктуре.

### Этап 2. Ввести recorder для series

В `test/integration/lib/metrics.js` реализовать низкоуровневый recorder:

- `createMetricsReport()` возвращает пустую структуру `rooms/colonies/bots/world`;
- `appendMetricSample(metricsReport, entityType, entityId, tick, values)` добавляет plain object;
- для map-сущностей создавать массив автоматически;
- для world-сэмплов использовать `appendMetricSample(metricsReport, 'world', 'world', ...)` либо отдельную обёртку — выбрать единый вариант;
- запрещать мутировать входной `values`;
- проверять, что `tick` — конечное неотрицательное число;
- гарантировать, что sample содержит `tick` ровно один раз;
- не сортировать массив при каждом append: основной цикл добавляет данные по возрастанию тика, а helper для валидации проверит порядок отдельно.

Добавить unit tests на:

- создание пустой структуры;
- первую запись в новую room series;
- несколько комнат;
- несколько сэмплов одной комнаты;
- не мутацию входного объекта;
- invalid entity type/id/tick;
- сохранение вложенного `creepsByRole` как plain JSON data.

### Этап 3. Переподключить observer и world loop

Изменить `test/integration/lib/observers/metrics.js`:

1. `collectMetrics()` оставить источником room data.
2. Убрать поле `room` из возвращаемого объекта `RoomMetrics`.
3. Изменить сигнатуру `sampleMetrics(report, roomName, metrics, tick)`.
4. Записывать данные через `appendMetricSample(report.metrics, 'rooms', roomName, tick, metrics)`.
5. Обновить JSDoc и экспорт.

Изменить `test/integration/lib/world.js`:

1. Инициализировать `metrics: createMetricsReport()` вместо `metrics: []`.
2. Передавать `name` в `sampleMetrics`.
3. Сохранить существующий цикл комнат и обработку ошибок.
4. Не добавлять custom collectors в этот этап, чтобы сначала стабилизировать базовую структуру.
5. Проверить, что при `metricsEvery = 0` структура всё равно существует и содержит пустые разделы.
6. Не менять semantics `ticksRun`, `finalRcl`, event log и profile export.

### Этап 4. Добавить query helpers

Создать `test/integration/lib/metrics.js` с полным JSDoc и unit tests.

Обязательные контракты:

- неизвестная room/entity должна возвращать `[]` для `getMetricSeries` либо выбрасывать ошибку; выбрать один стиль и использовать его везде. Рекомендуется `[]` для query-функций и отдельный assert для обязательного наличия;
- `getLatestMetric` возвращает `undefined`, если series пустая;
- `getMetricAtTick` не интерполирует и не выбирает ближайший тик;
- `averageMetric` не считает `undefined`, `null` и нечисловые значения; если валидных значений нет — возвращает `undefined`;
- `rateMetric` возвращает `undefined`, если меньше двух валидных samples или одинаковые ticks;
- `getWorldSnapshotAtTick` не добавляет комнаты без sample на указанном тике;
- helpers не меняют report и returned samples.

Добавить экспорт удобного `getRoomMetrics(report, roomName)` для типичного запроса.

### Этап 5. Добавить metric assertions

Создать `test/integration/lib/metricAssertions.js`.

1. Использовать `node:assert`.
2. Все сообщения об ошибках должны включать entity type/id, metric name и tick, где это полезно.
3. Не дублировать вычисления из `metrics.js`.
4. Проверять входные аргументы (например, ожидаемый RCL/threshold должен быть числом).
5. Добавить unit tests на pass/fail cases.
6. Обновить один существующий сценарий, например `bootstrap-rcl2-to-rcl3.scenario.js`, чтобы при включённом sampling он использовал новую структуру и assertion. Не включать sampling во все сценарии без необходимости — это увеличит время и размер отчётов.

### Этап 6. Добавить стандартные настройки sampling

Выбрать и документировать API:

```js
metrics: {
    every: 10,
    rooms: true,
    colonies: false,
    bots: false,
    world: false,
}
```

На первом этапе реально реализовать только `every` и rooms. Остальные флаги либо валидировать и явно не поддерживать, либо реализовать отдельным коммитом. Не создавать поля, которые молча не работают.

Рекомендуемый backward compatibility:

- `metricsEvery` продолжает работать;
- `metrics: { every }` — новый API;
- если заданы оба, использовать `metrics.every`;
- описать приоритет в `API-REFERENCE.md` и `GETTING-STARTED.md` после проверки поведения.

### Этап 7. Подготовить custom collectors

После стабилизации базового API:

1. Добавить collector contract и registry.
2. Добавить room collector для сценарного примера «потери энергии из-за переполненного контейнера».
3. Collector должен считать только наблюдаемое состояние mock-сервера и возвращать числовую метрику.
4. Не пытаться вычислять историческую потерю энергии по одному snapshot, если mock-сервер не хранит факт выброшенного ресурса. Для корректной метрики определить семантику:
   - instantaneous: заполненность контейнера сейчас;
   - delta: изменение энергии между samples;
   - accumulated loss: отдельный счётчик, который бот или observer поддерживает явно.
5. В плане реализации выбрать `instantaneous` для первой демонстрации и не называть её `lostEnergy`, пока факт потери не измеряется напрямую.
6. Добавить scenario-specific collector через `metrics.room` и проверить, что базовые observers не знают о нём.

### Этап 8. Добавить экспорт CSV

Создать unit-tested `metricExport.js`:

1. Преобразовать room/colony/bot/world series в плоские строки.
2. Для каждой строки хранить минимум:
   - `entityType`;
   - `entityId`;
   - `tick`;
   - `metric`;
   - `value`.
3. Стабильно сортировать строки по `entityType`, `entityId`, `tick`, `metric`.
4. Корректно экранировать запятые, кавычки и переносы строк.
5. Объекты и массивы сериализовать через `JSON.stringify` в одной колонке или явно исключить из scalar export.
6. Не писать файлы из `world.js` автоматически.
7. Если будет нужен CLI, добавить его отдельной задачей в `scripts/` только после чтения `CI-CD.md` и `scripts/README.md`, как требуют правила проекта.

### Этап 9. Подготовить regression API, но не смешивать его с recorder

В отдельном модуле, например `test/integration/lib/metricRegression.js`, предусмотреть:

- выбор окна samples по тикам;
- сравнение scalar metric current vs baseline;
- абсолютный и относительный tolerance;
- направление регрессии (`increase`, `decrease`, `both`);
- понятный результат `{ passed, actual, expected, delta, relativeDelta }` вместо немедленного assert.

Assertion-обёртка может использовать этот результат. Не хранить baseline внутри `report`; baseline — отдельный загруженный JSON/CSV fixture.

Не внедрять baseline-файлы в этот рефакторинг, пока не определены:

- стабильность seed/окружения mock-сервера;
- допустимое колебание runtime и CPU;
- единицы измерения тиков и времени;
- политика обновления baseline.

---

## 6. Рекомендуемые helpers и их назначение

### Query helpers

```js
getMetricSeries(report, 'rooms', 'W0N1');
getRoomMetrics(report, 'W0N1');
getLatestRoomMetrics(report, 'W0N1');
getMetricAtTick(report, 'rooms', 'W0N1', 100);
getWorldSnapshotAtTick(report, 100);
```

### Aggregation helpers

```js
averageMetric(series, 'energyAvailable');
sumMetric(series, 'containerEnergy');
deltaMetric(series, 'rclProgress');
rateMetric(series, 'rclProgress');
```

### Assertion helpers

```js
assertHasMetricSamples(report, 'rooms', 'W0N1');
assertLatestMetricAtLeast(report, 'rooms', 'W0N1', 'rcl', 3);
assertMetricReached(report, 'rooms', 'W0N1', 'rcl', 3);
```

### Export helpers

```js
const rows = flattenMetricSeries(report);
const csv = toCsv(report, { entityTypes: ['rooms'], metrics: ['rcl', 'energyAvailable'] });
```

Все helpers должны быть чистыми функциями, кроме явно названного `writeMetricsCsv`, если он будет добавлен позже.

---

## 7. Тестовая стратегия

### 7.1. Unit tests

Создать или обновить тесты в `test/unit/` по существующему соглашению проекта. Рекомендуемые файлы:

- `test/unit/integration.metrics.test.js` — recorder/query/aggregation;
- `test/unit/integration.metricAssertions.test.js` — assertions;
- `test/unit/integration.metricExport.test.js` — CSV flattening/escaping;
- при необходимости `test/unit/integration.observers.metrics.test.js` — `collectMetrics` и запись room samples.

Проверить:

- структура пустого report;
- multi-room запись;
- отсутствие поля `room` внутри sample;
- tick сохраняется корректно;
- комнаты не смешиваются;
- query helpers не мутируют report;
- snapshots с пропущенными room samples;
- invalid values и пустые series;
- CSV с вложенными объектами и кавычками;
- assertions с корректными и ошибочными входами.

### 7.2. Integration tests

Добавить отдельный небольшой сценарий или расширить smoke-сценарий:

- две комнаты;
- `metricsEvery: 1` или небольшой `metrics.every`;
- разные начальные RCL/объекты;
- assert, что `report.metrics.rooms.W0N1` и `report.metrics.rooms.W0N2` независимы;
- assert, что `getWorldSnapshotAtTick` возвращает обе комнаты;
- проверить, что при отсутствии metrics sampling report содержит пустую структуру.

Не использовать `console.log` в production modules; диагностический вывод в сценариях допустим только в существующем стиле integration tests и не должен быть необходим для функциональности.

### 7.3. Полная проверка

После изменений JavaScript-файлов выполнить:

```powershell
npm run check
npm run test:integration:smoke
npm run test:integration -- --only <новый-сценарий>
```

Если менялись JSDoc-типы или документация:

```powershell
npm run docs
```

`npm run docs` только генерирует docs; не редактировать `docs/` вручную.

---

## 8. Документация, которую нужно обновить

После рабочего изменения обновить документацию integration tests:

1. `test/integration/API-REFERENCE.md`
   - новая форма `report.metrics`;
   - `metricsEvery` и новый `metrics` API;
   - examples query/assertion helpers.
2. `test/integration/INTEGRATION-TESTS.md`
   - раздел observers/metrics;
   - архитектурное разделение collector/query/assertion/export.
3. `test/integration/EXAMPLES.md` или `GETTING-STARTED.md`
   - минимальный multi-room example;
   - получение последнего room sample;
   - экспорт CSV в память.
4. При необходимости обновить `test/integration/INTEGRATION-TESTS-PLAN.md`, если он описывает старую структуру `metrics[]`.

Не менять автоматически генерируемую папку `docs/` вручную.

---

## 9. Порядок миграции и обратная совместимость

1. Сначала добавить типы и чистые helpers без изменения world loop.
2. Добавить unit tests для helpers.
3. Перевести `metrics.js` и `world.js` на новую структуру.
4. Обновить существующие упоминания `report.metrics` через поиск по всему `test/integration/`.
5. Обновить документацию и сценарии.
6. После подтверждения всех потребителей удалить старые предположения о `report.metrics[]`.

Исполнитель обязан выполнить поиск:

```powershell
rg -n "report\.metrics|\.metrics\b|sampleMetrics|MetricsSample|metricsEvery" test/integration test/unit
```

Каждое найденное использование классифицировать:

- writer — запись данных;
- query — чтение данных;
- assertion — проверка;
- documentation — описание API;
- unrelated — другой тип метрик.

Не делать автоматический глобальный replace без проверки контекста.

На время миграции можно добавить диагностическую функцию `isLegacyMetricsArray`, но не оставлять два формата в обычном результате после завершения перехода.

---

## 10. Критерии готовности

Рефакторинг считать завершённым только когда выполнены все пункты:

- `report.metrics` имеет стабильную структуру `rooms/colonies/bots/world`;
- room samples хранятся в `report.metrics.rooms[roomName]`;
- каждый sample содержит `tick` и не содержит дублирующего `room`;
- `collectMetrics` не знает о query/assertion/export слоях;
- query helpers находятся в отдельном модуле и покрыты тестами;
- metric assertions находятся отдельно от event/object assertions;
- CSV export не мутирует report и имеет детерминированный результат;
- минимум один multi-room integration test подтверждает разделение series;
- старые потребители `report.metrics[]` обновлены или явно удалены;
- JSDoc в `types.js` соответствует реальному runtime shape;
- `npm run check` проходит;
- integration smoke проходит;
- документация не описывает старый плоский массив;
- нет изменений в запрещённых генерируемых/секретных файлах.

---

## 11. Что сознательно не делать в первой версии

Не включать в первый PR:

- dual index `byTick`;
- column-oriented storage;
- автоматическую отправку в Grafana/Prometheus;
- baseline-файлы и обязательную regression policy;
- CPU regression checks с жёсткими порогами;
- запись CSV на каждом запуске;
- автоматическое измерение «потерянной энергии», если observer не видит факт потери;
- хранение игровых объектов в `Memory` или report;
- произвольные callback-и, которые напрямую мутируют `report.metrics`.

Эти функции можно реализовать следующими отдельными задачами после стабилизации формата и измерения реальной потребности.

---

## 12. Итоговая последовательность коммитов

Рекомендуемый порядок небольших коммитов:

1. `Define integration metrics report types and recorder API`
2. `Store integration metrics by entity series`
3. `Add metric query and aggregation helpers`
4. `Add metric assertions`
5. `Add integration metrics export helpers`
6. `Document integration metrics API`
7. Отдельно: `Add configurable custom metric collectors`
8. Отдельно: `Add metric baseline regression checks`

Каждый коммит должен оставлять тесты проходящими. Не смешивать в одном коммите реструктуризацию runtime, CSV export и baseline regression, если это не требуется для промежуточной совместимости.
