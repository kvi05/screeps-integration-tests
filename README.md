# Screeps Integration Tests

Независимый интеграционный тестовый фреймворк для Screeps ботов.
Запускает скомпилированного бота в полноценной игровой среде через
[screeps-server-mockup](https://github.com/screepers/screeps-server-mockup).

Фреймворк не зависит от исходного кода бота и работает с любым ботом,
который предоставляет `dist/` со скомпилированными модулями Screeps.

## Документация

| Файл                                           | Назначение                                               |
| ---------------------------------------------- | -------------------------------------------------------- |
| [GETTING-STARTED.md](./GETTING-STARTED.md)     | Установка, запуск, написание первого сценария            |
| [API-REFERENCE.md](./API-REFERENCE.md)         | Полный справочник API: createWorld, builders, assertions |
| [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md)       | Room fixtures, memory fixtures, overrides                |
| [EXAMPLES.md](./EXAMPLES.md)                   | Эталонные сценарии и приёмы                              |
| [INTEGRATION-TESTS.md](./INTEGRATION-TESTS.md) | Архитектура и внутренние механизмы                       |
| [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md)   | Работа с несколькими комнатами и ботами                  |

## Возможности

- **Multi-room:** один `createWorld()` описывает N комнат.
- **Multi-bot:** несколько ботов в одном мире (свои + вражеские, разные user).
- **Spec API:** декларативное описание мира (`spec.room(roomName).spawn(...).tower(...)`).
- **Room fixtures:** переиспользуемые описания комнат + overrides.
- **Memory fixtures:** удобная работа со снапшотами Memory + overrides.
- **Predicate-based termination:** Можно задать условия для завершения теста.
- **Assertions:** готовые проверки (RCL, destroyed, attack, damage).
- **Metrics:** метрики разных сущностей (room/colony/user/world), query helpers, CSV export, regression API.

## Требования

- **Node.js** >= 22.12.0
- **npm** >= 10.8.2
- **Скомпилированный бот:** каталог `dist/` с модулями Screeps (обычно результат `npm run build` в репозитории бота).

## Установка

```bash
npm install
```

## Запуск

По умолчанию фреймворк ищет код бота в `dist/` относительно корня репозитория.
Для тестирования произвольного бота укажите путь к его `dist/` через переменную
окружения `BOT_DIST_DIR`.

```bash
# Все сценарии (dist/ в корне репозитория)
npm run test:integration

# С произвольным ботом
BOT_DIST_DIR=/path/to/bot/dist npm run test:integration

# Smoke-only (< 1 минуты)
npm run test:integration:smoke

# Unit-тесты integration framework
npm run test:integration:unit

# Один сценарий
npm run test:integration -- --only defense-invader-rcl3

# С profiling-профилированием
npm run test:integration -- --profiling

# Остановка при первом падении
npm run test:integration -- --bail

# Тайм-аут (по умолчанию 30 минут)
npm run test:integration -- --timeout 600000

# Параллельных запусков (по умолчанию min(4, cpu count))
npm run test:integration -- --jobs 2

# Создание memory fixture
npm run test:integration:capture -- rcl3-stable
```

## Структура файлов

```
screeps-integration-tests/
├── src/
│   ├── run-all.js                 # CLI runner
│   ├── runScenario.js             # Worker entry
│   ├── lib/
│   │   ├── world.js               # createWorld — главный orchestration API
│   │   ├── runtime.js             # createRuntime — multi-room + multi-bot
│   │   ├── builders/
│   │   │   ├── spec.js            # Canonical spec constructors
│   │   │   ├── materialize.js     # DB-aware слой (единственный writer)
│   │   │   ├── memory.js          # loadFixture / hasFixture / saveFixture
│   │   │   └── index.js           # re-export surface
│   ├── constants/
│   │   └── screepsConstants.js    # Игровые константы Screeps
│   ├── lib/
│   │   ├── fixtures/
│   │   │   └── roomFixture.js     # Семантические описания комнат
│   │   ├── observers/
│   │   │   ├── eventLog.js
│   │   │   ├── metrics.js
│   │   │   ├── ownership.js
│   │   │   └── predicate.js
│   │   ├── assertions.js
│   │   ├── metricAssertions.js    # Assert'ы для метрик
│   │   ├── metrics.js             # Recorder + query + aggregation
│   │   ├── metricExport.js        # CSV export
│   │   ├── metricRegression.js    # Current vs baseline
│   │   ├── types.js
│   │   └── tests/                 # Unit-тесты framework
│   │       ├── buildCanonicalRoom.test.js
│   │       ├── metrics.test.js
│   │       ├── metricAssertions.test.js
│   │       ├── metricExport.test.js
│   │       └── metricRegression.test.js
│   ├── scenarios/                 # Сценарии (*.scenario.js)
│   ├── fixtures/                  # Memory snapshots (*.memory.json)
│   ├── tools/                     # CLI tools
│   │   ├── capture-fixture.js
│   │   └── clean-cache.js
│   └── .cache/                    # Автоочистка (5 последних)
├── package.json
├── jest.config.js
└── .github/workflows/integration.yml
```

## С чего начать

1. **Хочу запустить готовый тест** → [GETTING-STARTED.md](./GETTING-STARTED.md#запуск-готовых-сценариев)
2. **Хочу написать свой сценарий** → [GETTING-STARTED.md](./GETTING-STARTED.md#написание-сценария)
3. **Хочу переиспользовать комнату** → [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md)
4. **Хочу понять API** → [API-REFERENCE.md](./API-REFERENCE.md)
5. **Хочу увидеть примеры** → [EXAMPLES.md](./EXAMPLES.md)
6. **Хочу несколько комнат / ботов** → [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md)

## Известные проблемы

- **Memory leak:** `server.stop()` не полностью освобождает storage. Решается через `child_process.fork` + `tree-kill` + `process.exit(0)`.
- **Порты:** каждый сервер получает свой свободный порт через `getFreePort()`, поэтому конфликтов `21025` больше нет.
- **console.log():** выводится только один console.log за тик сервера. _нужно уточнить_
- **Задержка profiler:** profiler начинает запись со 2-го тика. 0 - инициализация, 1 - запуск, 2 - первый замер
