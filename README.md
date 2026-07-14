# Screeps Integration Tests

Независимый интеграционный тестовый фреймворк для Screeps ботов.
Запускает скомпилированного бота в полноценной игровой среде через
[screeps-server-mockup](https://github.com/screepers/screeps-server-mockup).

Фреймворк поставляется как npm-пакет и не зависит от исходного кода бота.
Работает с любым ботом, который предоставляет `dist/` со скомпилированными
модулями Screeps.

## Документация

| Файл                                           | Назначение                                               |
| ---------------------------------------------- | -------------------------------------------------------- |
| [GETTING-STARTED.md](./GETTING-STARTED.md)     | Установка, запуск, написание первого сценария            |
| [CONFIG.md](./CONFIG.md)                       | Описание `screeps-integration.config.js`                 |
| [API-REFERENCE.md](./API-REFERENCE.md)         | Полный справочник API: createWorld, builders, assertions |
| [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md)       | Room fixtures, memory fixtures, overrides                |
| [EXAMPLES.md](./EXAMPLES.md)                   | Эталонные сценарии и приёмы                              |
| [INTEGRATION-TESTS.md](./INTEGRATION-TESTS.md) | Архитектура и внутренние механизмы                       |
| [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md)   | Работа с несколькими комнатами и ботами                  |

## Возможности

- **Пакет + CLI:** устанавливается как `devDependency`, запускается через
  `npx screeps-integration-tests`.
- **Файл конфигурации:** `screeps-integration.config.js`.
- **Сценарии в репозитории бота:** пользователь не трогает файлы фреймворка.
- **Multi-room:** один `createWorld()` описывает N комнат.
- **Multi-bot:** несколько ботов в одном мире (свои + вражеские, разные user).
- **Spec API:** декларативное описание мира (`spec.spawn(...)`, `spec.tower(...)`).
- **Room fixtures:** переиспользуемые описания комнат + overrides.
- **Memory fixtures:** удобная работа со снапшотами Memory + overrides.
- **Predicate-based termination:** Можно задать условия для преждевременного завершения теста.
- **Assertions:** готовые проверки (RCL, destroyed, attack, damage).
- **Metrics:** метрики разных сущностей (room/colony/user/world), query helpers,
  CSV export, regression API.

## Требования

- **Node.js** >= 22.12.0
- **npm** >= 10.8.2
- **Скомпилированный бот:** каталог (по умолчанию ищет: `dist/`) с модулями Screeps

## Быстрый старт

```bash
# 1. Установить пакет
npm install --save-dev screeps-integration-tests

# 2. Создать конфиг (опционально — есть разумные дефолты)
cat > screeps-integration.config.js <<'EOF'
module.exports = {
    distDir: './dist',
    scenariosDir: './scenarios',
    fixturesDir: './fixtures',
};
EOF

# 3. Создать сценарий (команда для копирования шаблона)
mkdir -p scenarios
cp node_modules/screeps-integration-tests/examples/scenarios/_template.js \
   scenarios/my-test.scenario.js

# 4. Запустить
npx screeps-integration-tests
npx screeps-integration-tests --only my-test
```

В сценариях используется публичный API пакета:

```js
const { createWorld, spec } = require('screeps-integration-tests');
const { assertBotWorked } = require('screeps-integration-tests/assertions');
```

## Запуск в этом репозитории (self-test)

В самом репозитории фреймворка есть примеры и минимальный mock-бот. Служат для проверки самого фреймворка:

```bash
npm install
npm run test:integration          # примерные сценарии
npm run test:integration:smoke    # только smoke-empty
npm run test:integration:unit     # unit-тесты framework
```

## CLI

```bash
npx screeps-integration-tests [options]
```

| Флаг                | Описание                                           |
| ------------------- | -------------------------------------------------- |
| `--config`          | Путь к `screeps-integration.config.js`             |
| `--scenariosDir`    | Папка со сценариями (`*.scenario.js`)              |
| `--distDir`         | Путь к `dist/` бота                                |
| `--fixturesDir`     | Папка с memory fixtures (`*.memory.json`)          |
| `--roomFixturesDir` | Папка с room fixtures (`*.room.js`)                |
| `--profilesDir`     | Папка для callgrind-профилей                       |
| `--cacheDir`        | Базовая папка кэша mockup-сервера                  |
| `--only NAME`       | Запустить только один сценарий                     |
| `--profiling`       | Включить callgrind-профилирование                  |
| `--bail`            | Остановиться при первом падении                    |
| `--timeout N`       | Таймаут на сценарий (мс, по умолчанию 30 минут)    |
| `--jobs N`          | Число параллельных сценариев                       |
| `--roomFixturesDir` | Папка с room fixtures (`*.room.js`)                |
| `--build`           | Запустить `buildCommand` из конфига перед прогоном |

## Структура файлов

```
screeps-integration-tests/
├── bin/
│   └── screeps-integration-tests.js   # CLI runner
├── src/
│   ├── index.js                       # Публичный API пакета (основной)
│   ├── public/                        # Sub-path exports (assertions, metrics, …)
│   ├── runScenario.js                 # Worker entry
│   ├── lib/
│   │   ├── world.js                   # createWorld — главный orchestration API
│   │   ├── runtime.js                 # ScreepsServer wrapper
│   │   ├── config.js                  # Загрузка screeps-integration.config.js
│   │   ├── builders/                  # spec + materialize
│   │   ├── fixtures/roomFixture.js    # Room fixtures registry
│   │   ├── observers/                 # eventLog, metrics, predicate, ownership
│   │   ├── assertions.js              # assertBotWorked, assertRclAtLeast...
│   │   ├── metricAssertions.js
│   │   ├── metrics.js
│   │   ├── metricExport.js
│   │   ├── metricRegression.js
│   │   └── tests/                     # Unit-тесты framework
│   ├── constants/
│   │   └── screepsConstants.js        # Игровые константы Screeps
│   └── tools/                         # CLI tools (capture-fixture, clean-cache)
├── examples/                          # Самотестирование фреймворка
│   ├── screeps-integration.config.js
│   ├── mock-bot/dist/
│   └── scenarios/
├── package.json
└── jest.config.js
```

## С чего начать

1. **Хочу запустить готовый тест** → [GETTING-STARTED.md](./GETTING-STARTED.md#запуск-готовых-сценариев)
2. **Хочу написать свой сценарий** → [GETTING-STARTED.md](./GETTING-STARTED.md#написание-сценария)
3. **Хочу настроить конфиг** → [CONFIG.md](./CONFIG.md)
4. **Хочу переиспользовать комнату** → [FIXTURES-GUIDE.md](./FIXTURES-GUIDE.md)
5. **Хочу понять API** → [API-REFERENCE.md](./API-REFERENCE.md)
6. **Хочу увидеть примеры** → [EXAMPLES.md](./EXAMPLES.md)
7. **Хочу несколько комнат / ботов** → [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md)

## Известные проблемы

- **Memory leak:** `server.stop()` не полностью освобождает storage. Решается через
  `child_process.fork` + `tree-kill` + `process.exit(0)`.
- **Порты:** каждый сервер получает свой свободный порт через `getFreePort()`,
  поэтому конфликтов `21025` больше нет.
- **console.log():** выводится только один console.log за тик сервера. _нужно уточнить_
- **Задержка profiler:** profiler начинает запись со 2-го тика. 0 - инициализация,
  1 - запуск, 2 - первый замер
