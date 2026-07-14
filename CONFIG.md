# Конфигурация: `screeps-integration.config.js`

Фреймворк ищет конфиг в текущей директории (откуда запущен CLI) по именам:

- `screeps-integration.config.js`
- `screeps-integration.config.json`
- `screeps-integration.config.cjs`
- `screeps-integration.config.mjs`

Можно явно указать путь через `--config <path>`.

## Приоритет настроек

От низшего к высшему:

1. Встроенные defaults
2. Файл конфига
3. Переменные окружения (`BOT_DIST_DIR` → `distDir`)
4. CLI-аргументы

Относительные пути в конфиге резолвятся относительно **директории файла конфига**.
Если конфига нет — относительно `cwd`.

## Схема

```js
module.exports = {
    // Путь к dist/ бота (результат npm run build).
    // Fallback: переменная окружения BOT_DIST_DIR, затем ./dist.
    distDir: './dist',

    // Папка со сценариями *.scenario.js.
    scenariosDir: './scenarios',

    // Папка с memory fixtures (*.memory.json).
    fixturesDir: './fixtures',

    // Папка с пользовательскими room fixtures (*.room.js).
    // Каждый файл должен либо вызвать registerRoomFixture,
    // либо экспортировать { name, fixture }.
    // По умолчанию null — авто-загрузка выключена.
    roomFixturesDir: null,

    // Папка для callgrind-профилей.
    profilesDir: './profiles',

    // Базовая папка для кэша mockup-сервера.
    cacheDir: './.cache',

    // Сколько последних кэшей хранить.
    cacheKeep: 5,

    // Таймаут на один сценарий (мс).
    timeout: 30 * 60 * 1000,

    // Максимальное число параллельных сценариев.
    jobs: Math.min(4, require('os').cpus().length),

    // Ваша команда собирающая бота в плоский вид (если есть). Запускается только при --build.
    buildCommand: null,

    // Модули для require перед запуском сценариев (глобальный сетап).
    require: [],

    // Переменные окружения, пробрасываемые в worker-процессы сценариев.
    env: {},
};
```

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
