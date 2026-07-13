# METRICS-FINALIZATION

Список действий, необходимых для доведения рефакторинга метрик integration tests до конечного, стабильного состояния.

Все изменения — в `test/integration/` (кроме явно указанных).

---

## 1. Стабилизация API и версионирование

- [ ] Зафиксировать семантику `appendMetricSample`: обязана ли ошибка при unknown entityType быть `TypeError` или может быть `RangeError`? Сейчас `TypeError`. Если контракт устраивает — покрыть тестом контракта.
- [ ] Проверить, что `getMetricSeries` для несуществующей комнаты возвращает `[]`, а не бросает ошибку. Это текущее поведение — зафиксировать тестом.
- [ ] Определить и документировать политику backward compatibility для `report.metrics`:
  - Старый плоский массив не поддерживается — query helpers бросают ошибку (сейчас `TypeError` от `resolveEntity`). Написать тест, что старый `{ metrics: [] }` вызывает понятную ошибку.
  - `metricsEvery` оставить рабочим, deprecated, без warning.

- [ ] Убедиться, что `MetricsSample` в JSDoc `types.js` не имеет поля `room`. Сейчас нет — проверить.

---

## 2. Custom metric collectors (registry contract)

Определить и реализовать registry collectors в отдельном модуле `test/integration/lib/metricCollectors.js`.

- [ ] Создать модуль с контрактом:

```js
async function collector(context) {
  // read-only: { server, roomName, tick, report }
  return { containerEnergyLoss: 10 };
}
```

- [ ] Реализовать стандартный `room` collector (instantaneous fill level контейнера).
- [ ] Поддержать `WorldOpts.metrics.room: [collectorFn, ...]`.
- [ ] Проверить, что базовые observers (`observers/metrics.js`) не знают о custom collectors.
- [ ] Добавить unit-тесты для registry + execution.
- [ ] Добавить scenario-specific collector через `metrics.room`.

---

## 3. Regression API — интеграционный тест

`metricRegression.js` сейчас покрыт unit-тестами, но ни один сценарий не использует `compareMetric` или `selectWindow`.

- [ ] Создать сценарий или дополнить существующий (например, `metrics-multi-room`), который:
  - Собирает метрики двух прогонов (или два окна одного прогона).
  - Сравнивает `energyCapacity` между первой и второй половиной тиков — ожидается монотонный рост.
  - Использует `compareMetric` с `direction: 'increase'`.
- [ ] Убедиться, что сценарий работает с `--bail`.

---

## 4. CLI-экспорт CSV

В `scripts/` (или `test/integration/tools/`) добавить CLI-скрипт для экспорта метрик из JSON-отчёта в CSV.

- [ ] Создать `test/integration/tools/export-metrics.js` с JSDoc-шапкой и `--help`.
- [ ] Читать JSON из stdin или файла.
- [ ] Выводить CSV в stdout.
- [ ] Пример:

```bash
cat report.json | node test/integration/tools/export-metrics.js > metrics.csv
```

- [ ] Проверить, что перед изменением `scripts/` прочитаны `CI-CD.md` и `scripts/README.md`.

---

## 5. Автоматическая проверка на старый формат

- [ ] Добавить хелпер `assertMetricsFormat(report)` или свойство `report.metrics.__format` со значением `'entity-series-v1'`.
- [ ] Проверять формат при первом обращении query-helper'ов (сейчас `resolveEntity` бросает TypeError, если `entityType` невалидный — но для старого пустого массива это неочевидно). Либо добавить явную проверку:

```js
function assertValidMetricsReport(report) {
  if (Array.isArray(report.metrics)) {
    throw new Error('report.metrics имеет старый формат (Array). Используйте createMetricsReport().');
  }
}
```

- [ ] Покрыть unit-тестом.

---

## 6. Cleanup legacy

В процессе рефакторинга могли остаться артефакты старого кода.

- [ ] `test/integration/lib/observers/index.js` реэкспортирует `...metrics`. Сейчас `metrics.js` экспортирует `{ collectMetrics, sampleMetrics }`. Новая `sampleMetrics` имеет другую сигнатуру. Проверить, что ни один импорт не использует старую сигнатуру. Команда:

```powershell
rg -n "sampleMetrics\(report," test/integration test/unit
```

Если найдены вызовы с 3 аргументами (без `roomName`) — обновить.

- [ ] `test/integration/lib/types.js` — удалить оставшиеся typedefs, если какие-то перестали быть нужны (например, старый `MetricsSample` с полем `room` — сейчас он переопределён без `room`). Проверить, что `MetricsSample` используется только как `{ tick, ... }` и не ссылается на `room`.

- [ ] Проверить, что `INTEGRATION-TESTS-PLAN.md` не описывает старый формат `report.metrics[]`. Частично обновлено, проверить остальные упоминания.

---

## 7. Интеграция в CI pipeline

- [ ] Добавить в `.github/workflows/ci.yml` шаг для `npm run test:integration:unit` (если CI запускает `npm test` — он не включает `test:integration:unit`).
- [ ] Рассмотреть, стоит ли добавить `npm run test:integration -- --only metrics-multi-room` как fast-feedback проверку перед deploy.

---

## 8. Документация — финальная сверка

- [ ] `API-REFERENCE.md` проверить:
  - [ ] `MetricsOpts` table описана правильно.
  - [ ] Примеры CSV export работают (выполнить code block как тест).
  - [ ] `computeDifference` не опечатка (было в плане, сейчас в коде нет такой функции — удалить из документации).
- [ ] `METRICS-REFACTOR-PLAN.md` — удалить или пометить как `(done)`. Либо перенести невыполненные этапы (custom collectors, baseline) в этот файл.
- [ ] `EXAMPLES.md` — убедиться, что пример metrics-multi-room синхронизирован с реальным сценарием.

---

## 9. Полная проверка перед commit

Перед финальным commit выполнить:

```powershell
npm run check
npm run test:integration:unit
npm run test:integration:smoke
npm run test:integration -- --only metrics-multi-room
npm run docs
```

Пропустить `bootstrap-rcl2-to-rcl3` (известная проблема до рефакторинга).

---

## 10. Что сознательно не делать (сейчас)

- Baseline-файлы и `assertMetricRegression` — до стабилизации seed окружения.
- Автоматическая запись CSV при каждом запуске — до CLI.
- Внешнее хранилище (Grafana / Prometheus).
- CPU regression checks с жёсткими порогами.
- `byTick` dual index — до измерения производительности.
- Custom collectors для colony / bot / world — только room в первой фазе.
