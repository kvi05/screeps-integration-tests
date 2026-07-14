# Getting Started

От установки пакета до собственного сценария.

## Содержание

- [Установка и первый запуск](#установка-и-первый-запуск)
- [Запуск готовых сценариев](#запуск-готовых-сценариев)
- [Написание сценария](#написание-сценария)
- [Что дальше](#что-дальше)

## Установка и первый запуск

### 1. Требования

- Node.js >= 22.12.0
- npm >= 10.8.2
- Скомпилированный бот: папка с модулями Screeps (обычно `dist/`)

### 2. Установка пакета

В репозитории бота:

```bash
npm install --save-dev screeps-integration-tests
```

### 3. (Опционально) Создайте конфиг

Если пути по умолчанию не подходят, создайте
`screeps-integration.config.js` в корне:

```js
'use strict';

module.exports = {
  distDir: './dist',
  scenariosDir: './scenarios',
  fixturesDir: './fixtures',
};
```

Без конфига используются те же значения. Полная схема — в
[CONFIG.md](./CONFIG.md).

### 4. Соберите бота

```bash
npm run build
```

Или запустите с флагом `--build` (если задан `buildCommand` в конфиге):

```bash
npx screeps-integration-tests --build
```

### 5. Проверка работоспособности

Скопируйте smoke-сценарий из примеров пакета:

```bash
mkdir -p scenarios
cp node_modules/screeps-integration-tests/examples/scenarios/smoke-empty.scenario.js \
   scenarios/smoke-empty.scenario.js
```

Запустите:

```bash
npx screeps-integration-tests --only smoke-empty
```

Если видите `PASS: smoke-empty` — фреймворк готов.

## Запуск готовых сценариев

Запуск всех сценариев:

```bash
npx screeps-integration-tests
```

Запуск одного:

```bash
npx screeps-integration-tests --only smoke-empty
```

Имя — это имя файла без `.scenario.js`.

Основные флаги: `--only`, `--profiling`, `--bail`, `--timeout`, `--jobs`,
`--build`. Полный список и значения по умолчанию — в
[CONFIG.md](./CONFIG.md).

> **Профилирование:** флаг `--profiling` требует, чтобы в проекте бота был
> установлен `screeps-profiler` и `loop` обёрнут через
> `profiler.wrap(module.exports.loop)`. Иначе данные не соберутся. см. [Profiler](https://github.com/screepers/screeps-profiler)

## Написание сценария

### Шаг 1. Скопируйте шаблон

```bash
cp node_modules/screeps-integration-tests/examples/scenarios/_template.js \
   scenarios/my-test.scenario.js
```

Шаблон уже содержит `createWorld → run → assertBotWorked` и
`try/finally world.dispose()`.

### Шаг 2. Заполните сценарий

Минимальный сценарий состоит из трёх частей:

1. **Создание мира** через `createWorld()`
2. **Действия** — `world.run()`, `world.tick(n)`, `world.spawn(...)`
3. **Assertions** — `assertBotWorked`, `assertRclAtLeast` и др.

```javascript
'use strict';

const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertRclAtLeast } = require('screeps-integration-tests/assertions');

const ROOM_NAME = 'W0N1';

async function run(opts = {}) {
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
    ticks: 1000,
  });

  try {
    await world.run();

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

> `opts` пробрасывается из CLI, обычно содержит `profiling`.

### Шаг 3. Запустите

```bash
npx screeps-integration-tests --only my-test
```

## Что дальше

- **Настроить конфиг** → [CONFIG.md](./CONFIG.md)
- **Переиспользовать комнату** → [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md)
- **Несколько комнат / ботов** → [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md)
- **Полный API** → [API-REFERENCE.md](./API-REFERENCE.md)
- **Готовые рецепты** → [EXAMPLES.md](./EXAMPLES.md)
- **Архитектура фреймворка** → [INTEGRATION-TESTS.md](./INTEGRATION-TESTS.md)
