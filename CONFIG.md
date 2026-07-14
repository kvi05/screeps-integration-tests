# Конфигурация

Фреймворк ищет файл `screeps-integration.config` с расширениями `.js`, `.json`, `.cjs`, `.mjs` в текущей директории. Путь можно задать явно: `--config <path>`.

## Приоритет настроек

От низшего к высшему:

1. Встроенные defaults
2. Файл конфига
3. Переменная окружения `BOT_DIST_DIR` → `distDir`
4. CLI-аргументы
5. Явные overrides из кода

Относительные пути резолвятся от директории файла конфига; если конфига нет — от `cwd`.

## Схема

```js
module.exports = {
  distDir: './dist', // билд бота; fallback: BOT_DIST_DIR, затем ./dist
  scenariosDir: './scenarios', // *.scenario.js
  fixturesDir: './fixtures', // *.memory.json
  roomFixturesDir: null, // *.room.js; null = авто-загрузка выключена
  profilesDir: './profiles', // callgrind-профили
  cacheDir: './.cache', // кэш mockup-сервера
  cacheKeep: 5, // сколько последних кэшей хранить
  timeout: 30 * 60 * 1000, // таймаут на один сценарий, мс
  jobs: Math.min(4, require('os').cpus().length), // параллельные сценарии
  buildCommand: null, // запускается только при --build
  require: [], // модули для require перед сценариями
  env: {}, // env для worker-процессов
};
```

## CLI-флаги

| Флаг                      | Описание                                                         |
| ------------------------- | ---------------------------------------------------------------- |
| `--config <path>`         | Путь к конфигу                                                   |
| `--scenariosDir <dir>`    | Папка со сценариями                                              |
| `--distDir <dir>`         | Папка с билдом бота                                              |
| `--fixturesDir <dir>`     | Папка с memory fixtures                                          |
| `--roomFixturesDir <dir>` | Папка с room fixtures                                            |
| `--profilesDir <dir>`     | Папка для профилей                                               |
| `--cacheDir <dir>`        | Папка для кэша сервера                                           |
| `--only <name>`           | Запустить только один сценарий по имени файла без `.scenario.js` |
| `--profiling`             | Включить callgrind-профилирование                                |
| `--bail`                  | Остановиться при первой ошибке                                   |
| `--timeout <int>`         | Таймаут на один сценарий, мс                                     |
| `--jobs <int>`            | Число параллельных worker'ов                                     |
| `--build`                 | Выполнить `buildCommand` перед запуском                          |

Таймаут применяется к каждому сценарию в отдельности; общего таймаута нет.

## Пример для реального бота

```js
'use strict';

module.exports = {
  distDir: './dist',
  scenariosDir: './inter_tests/scenarios',
  fixturesDir: './inter_tests/fixtures',
  roomFixturesDir: './inter_tests/room-fixtures',
  cacheDir: './inter_tests/.cache',
  profilesDir: './inter_tests/profiles',
  buildCommand: 'npm run build',
};
```

## Пример self-test фреймворка

```js
'use strict';

module.exports = {
  distDir: './examples/mock-bot/dist',
  scenariosDir: './examples/scenarios',
  fixturesDir: './examples/fixtures',
  cacheDir: './examples/.cache',
  profilesDir: './examples/profiles',
};
```

См. также [GETTING-STARTED.md](GETTING-STARTED.md) и [API-REFERENCE.md](API-REFERENCE.md).
