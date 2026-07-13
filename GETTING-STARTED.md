# Getting Started

Этот гайд проведёт от запуска готового теста до написания собственного сценария.

## Содержание

- [Установка и первый запуск](#установка-и-первый-запуск)
- [Запуск готовых сценариев](#запуск-готовых-сценариев)
- [Написание сценария](#написание-сценария)
- [Что дальше](#что-дальше)

## Установка и первый запуск

### 1. Требования

- Node.js >= 22.12.0
- npm >= 10.8.2

### 2. Установка зависимостей

```bash
npm install
```

### 3. Сборка бота

Интеграционный фреймворк запускает бота из `dist/`. Перед запуском тестов:

```bash
npm run build
```

Или одной командой (соберёт автоматически):

```bash
npm run test:integration
```

### 4. Проверка работоспособности

Запустите smoke-сценарий — это быстрый тест, который проверяет, что фреймворк вообще работает:

```bash
npm run test:integration:smoke
```

Если видите `PASS: smoke-empty` — всё готово.

## Запуск готовых сценариев

### Запуск всех сценариев

```bash
npm run test:integration
```

### Запуск одного сценария

```bash
npm run test:integration -- --only defense-invader-rcl3
```

Имя сценария — это имя файла без расширения `.scenario.js`.

### Полезные флаги

| Флаг          | Описание                                                     |
| ------------- | ------------------------------------------------------------ |
| `--only NAME` | Запустить только сценарий NAME                               |
| `--smoke`     | Запустить только smoke-сценарии                              |
| `--profiling` | Включить callgrind-профилирование (функционал от `Profiler`) |
| `--bail`      | Остановиться при первом падении                              |
| `--timeout N` | Тайм-аут в миллисекундах (по умолчанию 30 минут)             |

```bash
# Smoke + профилирование
npm run test:integration:smoke -- --profiling

# Жёсткий режим с тайм-аутом
npm run test:integration -- --bail --timeout 600000
```

## Написание сценария

### Шаг 1. Скопируйте шаблон

```bash
cp test/integration/scenarios/_template.js test/integration/scenarios/my-test.scenario.js
```

### Шаг 2. Заполните сценарий

Минимальный сценарий состоит из трёх частей:

1. **Создание мира** через `createWorld()`
2. **Действия** (spawn крипов, ticks)
3. **Assertions** (проверки)

#### Пример: пустой мир, бот сам строит колонию

```javascript
'use strict';

const { createWorld } = require('../lib/world');
const { assertBotWorked, assertRclAtLeast } = require('../lib/assertions');
const spec = require('../lib/builders/spec');

const ROOM_NAME = 'W0N1';

async function run(opts = {}) {
  const maxTicks = 15000;

  const world = await createWorld({
    rooms: [
      {
        name: ROOM_NAME,
        controller: spec.controller({ level: 2 }),
        sources: [spec.source(15, 15), spec.source(35, 35)],
        structures: [spec.spawn(25, 25)],
      },
    ],
    bots: [{ username: 'bot', room: ROOM_NAME }],
    ticks: maxTicks,
  });

  try {
    // 2. Действия
    // Запускаем мир — `run()` остановится по мягкому лимиту ticks
    await world.run();

    // 3. Assertions
    // Проверяем, что все отработало как надо
    assertBotWorked(world.report);
    assertRclAtLeast(world.report, ROOM_NAME, 3);

    console.log(`PASS: my-test (RCL ${world.report.finalRcl[ROOM_NAME]})`);
    return world.report;
  } finally {
    await world.dispose();
  }
}

module.exports = { run };
```

#### Пример: защита от инвейдера (использует fixture)

```javascript
'use strict';

const { createWorld } = require('../lib/world');
const { hasFixture } = require('../lib/builders/memory');
const { assertBotWorked, assertInvaderKilled } = require('../lib/assertions');

const ROOM_NAME = 'W0N1';

async function run(opts = {}) {
  if (!hasFixture('rcl3-stable')) {
    console.log('SKIP: memory fixture rcl3-stable не найден');
    return { skipped: true };
  }

  const maxTicks = 50;

  const world = await createWorld({
    rooms: [{ name: ROOM_NAME, roomFixture: 'rcl3-stable' }],
    bots: [{ username: 'bot', room: ROOM_NAME }],
    memory: 'rcl3-stable',
    ticks: maxTicks,

    until: {
      maxTicks,
      predicate: async (w) => {
        const events = await w.eventLog(ROOM_NAME);
        return events.some((e) => e.event === 2); // EVENT_OBJECT_DESTROYED
      },
    },
  });

  try {
    await world.spawn(spec.dummyTarget(10, 10, { roomName: ROOM_NAME }));

    await world.tick(10);

    await world.spawn(spec.inveder(40, 40, { roomName: ROOM_NAME }));

    await world.tick(maxTicks - 10);

    assertBotWorked(world.report);
    assertInvaderKilled(world.report, invaderId);

    console.log(`PASS: defense-test (invader killed)`);
    return world.report;
  } finally {
    await world.dispose();
  }
}

module.exports = { run };
```

В данном примере запускается заранее подготовленная связка `roomFixture: 'rcl3-stable'` + `memory: 'rcl3-stable'`. Делаем 10 тиков (не обязательно), спавним Invader и продолжаем тикать сервер. \
Здесь в функцию `createWorld` передается параметр `predicate` — условие, по которому мир преждевременно останавливается. \
После остановки мира проверяем `Assertions` - утверждения: бот(user) работает, Invader был убит.

### Шаг 3. Запустите

```bash
npm run test:integration -- --only my-test
```

## Структура типичного сценария

```
┌─────────────────────────────────────────┐
│ 1. createWorld({                       │
│      rooms: [{ name, controller, ... }],│
│      bots: [{ username, room }],      │
│      until: { ... },                   │
│    })                                  │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 2. Actions                             │
│    - world.tick(n)                     │
│    - world.spawn({ roomName, userId, ... })  │
│    - world.readMemory(username)        │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 3. Assertions                          │
│    - assertBotWorked(report)           │
│    - assertRclAtLeast(report, room, n) │
│    - assertInvaderKilled(report, id)   │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 4. world.dispose()                     │
│    (в finally обязательно)             │
└─────────────────────────────────────────┘
```

\> **Мягкий vs жёсткий лимит:** `createWorld({ ticks })` — мягкий, влияет только на `run()`. `until.maxTicks` — жёсткий, уважается и `run()`, и `tick()`. Если заданы оба — тест остановится по первому достигнутому.

#### Пример: сбор метрик и CSV экспорт

```javascript
const { getLatestRoomMetrics, getWorldSnapshotAtTick } = require('../lib/metrics');
const { assertLatestMetricAtLeast } = require('../lib/metricAssertions');
const { toCsv } = require('../lib/metricExport');

const world = await createWorld({
  rooms: [
    { name: 'W0N1', controller: spec.controller({ level: 2 }), sources: [spec.source(15, 15)] },
    { name: 'W0N2', controller: spec.controller({ level: 1 }), sources: [spec.source(20, 20)] },
  ],
  bots: [{ username: 'bot', room: 'W0N1' }],
  ticks: 50,
  metrics: { every: 10, rooms: true },
});

await world.run();

assertLatestMetricAtLeast(world.report, 'rooms', 'W0N1', 'rcl', 2);
const snapshot = getWorldSnapshotAtTick(world.report, 20);
console.log(toCsv(world.report, { entityTypes: ['rooms'], metrics: ['rcl', 'energyAvailable'] }));
```

## Что дальше

- **Хочу переиспользовать комнату в нескольких сценариях** → [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md)
- **Хочу несколько комнат** → [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md)
- **Хочу узнать все доступные API** → [API-REFERENCE.md](./API-REFERENCE.md)
- **Хочу увидеть больше примеров** → [EXAMPLES.md](./EXAMPLES.md)
- **Хочу понять архитектуру фреймворка** → [INTEGRATION-TESTS.md](./INTEGRATION-TESTS.md)
