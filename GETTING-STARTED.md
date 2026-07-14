# Getting Started

Этот гайд проведёт от установки пакета до написания собственного сценария.

## Содержание

- [Установка и первый запуск](#установка-и-первый-запуск)
- [Запуск готовых сценариев](#запуск-готовых-сценариев)
- [Написание сценария](#написание-сценария)
- [Что дальше](#что-дальше)

## Установка и первый запуск

### 1. Требования

- Node.js >= 22.12.0
- npm >= 10.8.2

### 2. Установка пакета

В репозитории бота:

```bash
npm install --save-dev screeps-integration-tests
```

### 3. (Опционально) Создайте конфиг

Если хотите изменить пути по умолчанию, создайте `screeps-integration.config.js`
в корне репозитория бота:

```js
'use strict';

module.exports = {
  distDir: './dist',
  scenariosDir: './scenarios',
  fixturesDir: './fixtures',
};
```

_Без конфига фреймворк использует те же дефолты._

### 4. Соберите бота

```bash
npm run build
```

Или запустите с флагом `--build` (если задан `buildCommand` в конфиге):

```bash
npx screeps-integration-tests --build
```

### 5. Проверка работоспособности

Скопируйте smoke-сценарий из примеров:

```bash
mkdir -p scenarios
cp node_modules/screeps-integration-tests/examples/scenarios/smoke-empty.scenario.js \
   scenarios/smoke-empty.scenario.js
```

Запустите:

```bash
npx screeps-integration-tests --only smoke-empty
```

Если видите `PASS: smoke-empty` — всё готово.

## Запуск готовых сценариев

### Запуск всех сценариев

```bash
npx screeps-integration-tests
```

### Запуск одного сценария

```bash
npx screeps-integration-tests --only defense-invader-rcl3
```

Имя сценария — это имя файла без расширения `.scenario.js`.

### Полезные флаги

| Флаг          | Описание                                           |
| ------------- | -------------------------------------------------- |
| `--only NAME` | Запустить только сценарий NAME                     |
| `--profiling` | Включить callgrind-профилирование                  |
| `--bail`      | Остановиться при первом падении                    |
| `--timeout N` | Тайм-аут в миллисекундах (по умолчанию 30 минут)   |
| `--jobs N`    | Число параллельных сценариев                       |
| `--build`     | Запустить `buildCommand` из конфига перед прогоном |

```bash
# Smoke + профилирование
npx screeps-integration-tests --only smoke-empty --profiling

# Жёсткий режим с тайм-аутом
npx screeps-integration-tests --bail --timeout 600000
```

## Написание сценария

### Шаг 1. Скопируйте шаблон

```bash
cp node_modules/screeps-integration-tests/examples/scenarios/_template.js \
   scenarios/my-test.scenario.js
```

### Шаг 2. Заполните сценарий

Минимальный сценарий состоит из трёх частей:

1. **Создание мира** через `createWorld()`
2. **Действия** (spawn крипов, ticks)
3. **Assertions** (проверки)

Все импорты — из пакета:

```javascript
'use strict';

const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertRclAtLeast } = require('screeps-integration-tests/assertions');

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

### Шаг 3. Запустите

```bash
npx screeps-integration-tests --only my-test
```

## Что дальше

- **Хочу настроить конфиг** → [CONFIG.md](./CONFIG.md)
- **Хочу переиспользовать комнату в нескольких сценариях** → [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md)
- **Хочу несколько комнат** → [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md)
- **Хочу узнать все доступные API** → [API-REFERENCE.md](./API-REFERENCE.md)
- **Хочу увидеть больше примеров** → [EXAMPLES.md](./EXAMPLES.md)
- **Хочу понять архитектуру фреймворка** → [INTEGRATION-TESTS.md](./INTEGRATION-TESTS.md)
