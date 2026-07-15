# Screeps Integration Tests

Интеграционный фреймворк для тестирования Screeps-ботов на реальном
[screeps-server-mockup](https://github.com/screepers/screeps-server-mockup).

Запускает скомпилированного бота в полноценном игровом мире: с контроллером,
источниками, спавном, крипами, событиями и метриками — и даёт проверить, что
бот действительно растёт, защищается и не падает.

## Документация

| Файл                                           | Назначение                                             |
| ---------------------------------------------- | ------------------------------------------------------ |
| [GETTING-STARTED.md](./GETTING-STARTED.md)     | Установка, первый запуск, написание сценария           |
| [CONFIG.md](./CONFIG.md)                       | `screeps-integration.config.js` и CLI-флаги            |
| [API-REFERENCE.md](./API-REFERENCE.md)         | Полный справочник API: `createWorld`, builders, events |
| [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md)       | Room fixtures, memory fixtures, overrides              |
| [EXAMPLES.md](./EXAMPLES.md)                   | Эталонные сценарии и типовые приёмы                    |
| [INTEGRATION-TESTS.md](./INTEGRATION-TESTS.md) | Архитектура и внутренние механизмы                     |
| [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md)   | Несколько комнат и ботов                               |

## Что умеет фреймворк

- **Запускает вашего бота как есть** — берёт `dist/` (или другую папку с
  модулями) и загружает в mockup-сервер.
- **Создаёт мир декларативно** — комнаты, источники, контроллер, спавны,
  турели, крипы, стены, ramparts — через `spec.*`.
- **Переиспользует состояние** — room fixtures и memory fixtures с
  overrides, чтобы не копировать одну и ту же колонию в каждый тест.
- **Проверяет результаты** — assertions на RCL, ошибки, уничтоженные
  объекты, бой, полученный урон.
- **Собирает метрики** — time-series по комнатам (RCL, energyAvailable,
  creepsByRole, towerEnergy и др.), query helpers, CSV export, regression
  API.
- **Управляет ходом теста** — фиксированное число тиков, досрочная
  остановка по `predicate` или `signal`, пошаговый `world.tick(n)`,
  runtime-спавн крипов, `onTick` callback, декларативные события.
- **Профилирует** — встроенная поддержка [screeps-profiler](https://github.com/screepers/screeps-profiler) с выгрузкой
  callgrind-файлов.
- **Изолирует сценарии** — каждый сценарий работает в отдельном
  `child_process.fork` со своим сервером и портом.

## Быстрый старт

```bash
npm install --save-dev screeps-integration-tests
```

Создайте сценарий `scenarios/smoke.scenario.js`:

```js
'use strict';

const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked, assertNoErrors } = require('screeps-integration-tests/assertions');

async function run() {
  const world = await createWorld({
    rooms: [
      {
        name: 'W0N1',
        controller: spec.controller({ level: 1 }),
        sources: [spec.source(15, 15), spec.source(35, 35)],
        structures: [spec.spawn(25, 25)],
      },
    ],
    bots: [{ username: 'bot', room: 'W0N1' }],
    ticks: 30,
  });

  try {
    await world.run();
    assertBotWorked(world.report);
    assertNoErrors(world.report);
    console.log(`PASS: ${world.report.ticksRun} ticks`);
    return world.report;
  } finally {
    await world.dispose();
  }
}

module.exports = { run };
```

Запустите:

```bash
npx screeps-integration-tests --only smoke
```

Больше готовых рецептов — в [EXAMPLES.md](./EXAMPLES.md).

## Запуск внутри репозитория (self-test)

_Для теста самого фреймворка_

```bash
npm install
npm run test:integration:smoke    # только smoke-empty
npm run test:integration          # все примерные сценарии
```

## CLI

```bash
npx screeps-integration-tests [options]
```

Основные флаги: `--only`, `--config`, `--scenariosDir`, `--distDir`,
`--profiling`, `--timeout`, `--jobs`, `--bail`. Полный список — в
[CONFIG.md](./CONFIG.md).

## С чего начать

1. **Установить и запустить первый тест** → [GETTING-STARTED.md](./GETTING-STARTED.md)
2. **Посмотреть примеры** → [EXAMPLES.md](./EXAMPLES.md)
3. **Разобраться в API** → [API-REFERENCE.md](./API-REFERENCE.md)
4. **Настроить конфиг** → [CONFIG.md](./CONFIG.md)
5. **Понять архитектуру** → [INTEGRATION-TESTS.md](./INTEGRATION-TESTS.md)

## Известные проблемы

- **Memory leak:** `server.stop()` не полностью освобождает storage. Решается
  через `child_process.fork` + `tree-kill` + `process.exit(0)`.
- **console.log:** сервер выводит только один `console.log` за тик.
- **Задержка profiler:** запись начинается со 2-го тика (0 — init,
  1 — запуск, 2 — первый замер).
- **Задержка исполнения пользовательских команд:** Как и в игре, команды игрока исполняются в следующем тике. Но `world.exec()` в фреймворке выглядит так:
  ```javaScript
  await world.exec();
  await world.tick(2); // Только на 2-ром тике исполнится команда
  ```