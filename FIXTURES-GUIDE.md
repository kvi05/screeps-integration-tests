# Fixtures Guide

Руководство по fixture-модели `screeps-integration-tests`: room fixtures и memory fixtures.

## Содержание

- [1. Два типа fixtures](#1-два-типа-fixtures)
- [2. Room fixtures](#2-room-fixtures)
- [3. Room overrides](#3-room-overrides)
- [4. Memory fixtures](#4-memory-fixtures)
- [5. Связь между room fixture и memory fixture](#5-связь-между-room-fixture-и-memory-fixture)
- [6. Как выбрать подход](#6-как-выбрать-подход)
- [7. Как создать room fixture](#7-как-создать-room-fixture)
- [8. Как создать или обновить memory fixture](#8-как-создать-или-обновить-memory-fixture)
- [9. Рекомендации и анти-паттерны](#9-рекомендации-и-анти-паттерны)

## 1. Два типа fixtures

### Room fixture

Семантический spec комнаты: controller, sources, structures, creeps. Отвечает на вопрос: **"Какой мир должен существовать в комнате к старту сценария?"**

### Memory fixture

JSON-snapshot `Memory` бота. Отвечает на вопрос: **"С каким внутренним состоянием бот должен стартовать?"**

### Ключевая разница

| Что                | Room fixture                   | Memory fixture                                          |
| ------------------ | ------------------------------ | ------------------------------------------------------- |
| Описывает          | Объекты мира                   | Внутреннее состояние бота                               |
| Формат             | Canonical spec                 | JSON snapshot                                           |
| Где хранится       | `*.room.js` (пользовательские) | `fixtures/*.memory.json`                                |
| Основной use case  | Переиспользуемая комната       | "Прогретое" состояние бота                              |
| Подключается через | `rooms[].roomFixture`          | `createWorld({ memory: 'name' })` или `memoryOverrides` |

## 2. Room fixtures

Фреймворк **не поставляет готовых room fixtures**. Реестр стартует пустым (`ROOM_FIXTURES = {}`), а `examples/fixtures/` содержит только `.gitkeep`. Имена вроде `rcl3-stable` в примерах — иллюстративные.

### Публичный API

```javascript
const {
  registerRoomFixture,
  getRoomFixture,
  hasRoomFixture,
  loadRoomFixture,
  applyRoomOverrides,
} = require('screeps-integration-tests/room-fixtures');
```

Подробное описание функций см. в [API-REFERENCE.md](./API-REFERENCE.md#5-room-fixtures-api).

### Пример собственного fixture

```javascript
// fixtures/rooms/my-room.room.js
const { spec } = require('screeps-integration-tests');
const { registerRoomFixture } = require('screeps-integration-tests/room-fixtures');

registerRoomFixture('my-room', {
  controller: spec.controller({ level: 3, progress: 2146 }),
  sources: [spec.source(15, 15), spec.source(35, 35, { id: '4361a44a5fa1c06' })],
  structures: [
    spec.tower(26, 24),
    spec.extension(27, 24, { energy: 50 }),
    spec.container(23, 24, { id: '71faa48c085e889', energy: 1500 }),
    spec.road(24, 24),
  ],
  creeps: [],
});
```

`spec.controller` принимает `progress`, но **не** принимает `progressTotal`.

### Авто-загрузка из директории

Зарегистрируйте fixture автоматически через конфиг:

```javascript
// screeps-integration.config.js
module.exports = {
  roomFixturesDir: './fixtures/rooms',
};
```

Каждый `*.room.js` в этой директории либо вызывает `registerRoomFixture`, либо экспортирует `{ name, fixture }`. Загрузка происходит перед запуском сценария.

### Ручная регистрация в сценарии

```javascript
const { createWorld, spec } = require('screeps-integration-tests');
const { registerRoomFixture } = require('screeps-integration-tests/room-fixtures');

registerRoomFixture('quick-room', {
  controller: spec.controller({ level: 2 }),
  sources: [spec.source(15, 15)],
  structures: [spec.spawn(25, 25)],
});

const world = await createWorld({
  rooms: [{ name: 'W0N1', roomFixture: 'quick-room' }],
  bots: [{ username: 'bot', room: 'W0N1' }],
  ticks: 100,
});
```

### Использование в сценарии

```javascript
const world = await createWorld({
  rooms: [{ name: 'W0N1', roomFixture: 'my-room' }],
  bots: [{ username: 'bot', room: 'W0N1' }],
  ticks: 100,
});
```

### Почему это лучше, чем копировать layout

- одна комната используется в нескольких тестах;
- изменения layout фиксируются в одном месте;
- сценарий описывает вариацию поведения, а не повторяет layout.

## 3. Room overrides

`roomOverrides` позволяет менять fixture локально под конкретный сценарий без полного копирования.

### Поддерживаемые override-поля

| Поле         | Назначение                                          |
| ------------ | --------------------------------------------------- |
| `exclude`    | Удалить объекты по `id`, `type` или объекту-шаблону |
| `controller` | Изменить controller (merge)                         |
| `structures` | Переопределить поля существующих структур           |
| `append`     | Добавить новые структуры                            |
| `creeps`     | Добавить собственных крипов                         |
| `hostiles`   | Добавить hostile creeps                             |

### Пример 1. Убрать башню

```javascript
const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      roomFixture: 'my-room',
      roomOverrides: { exclude: ['tower'] },
    },
  ],
  bots: [{ username: 'bot', room: 'W0N1' }],
});
```

`exclude` поддерживает строку (`id` или `type`) и объект (`{ id }` / `{ type }`).

### Пример 2. Изменить controller и energy extension

```javascript
const { createWorld, spec } = require('screeps-integration-tests');

const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      roomFixture: 'my-room',
      roomOverrides: {
        controller: { safeMode: 20000 },
        structures: [spec.extension(27, 24, { id: '53fca45601fe9dd', energy: 200 })],
      },
    },
  ],
  bots: [{ username: 'bot', room: 'W0N1' }],
});
```

### Пример 3. Добавить hostile creeps

```javascript
const { createWorld, spec } = require('screeps-integration-tests');

const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      roomFixture: 'my-room',
      roomOverrides: {
        hostiles: [spec.invader(10, 25, { name: 'Invader_1' })],
      },
    },
  ],
  bots: [{ username: 'bot', room: 'W0N1' }],
});
```

### Когда использовать overrides, а не новую fixture

Используйте `roomOverrides` для локальных вариаций:

- убрать одну структуру;
- изменить `safeMode`;
- подправить энергию нескольких объектов;
- добавить одного hostile creep.

Создавайте новую room fixture, если меняется базовая геометрия комнаты: другой layout или другая стадия развития.

## 4. Memory fixtures

Фреймворк **не поставляет готовых memory fixtures**. Создавайте их самостоятельно.

### Публичный API

```javascript
const { loadFixture, hasFixture, saveFixture, deepMergeMemory } = require('screeps-integration-tests/memory-fixtures');
```

Подробное описание см. в [API-REFERENCE.md](./API-REFERENCE.md#6-memory-fixtures-api).

### Когда memory fixture нужен

- бот должен стартовать с уже известной комнатой и кэшами;
- в `Memory` должно существовать состояние задач;
- сценарий начинается после bootstrap, а не с чистого старта.

### Когда memory fixture не нужен

- нужно описать только layout комнаты — используйте room fixture;
- сценарий стартует с пустого `Memory` и bootstrap идет естественно.

### Подключение

```javascript
const world = await createWorld({
  rooms: [{ name: 'W0N1', roomFixture: 'my-room' }],
  bots: [{ username: 'bot', room: 'W0N1' }],
  memory: 'my-memory',
});
```

### Проверка существования

```javascript
const { hasFixture } = require('screeps-integration-tests/memory-fixtures');

if (!hasFixture('my-memory')) {
  console.log('SKIP: memory fixture не найден');
  return { skipped: true };
}
```

### Сохранение из кода

```javascript
const { saveFixture } = require('screeps-integration-tests/memory-fixtures');

const memory = await world.readMemory('bot');
saveFixture('my-memory', memory, { force: true });
```

`saveFixture(name, memory, { force = true })`. По умолчанию перезаписывает существующий файл.

## 5. Связь между room fixture и memory fixture

Room fixture и memory fixture могут быть связаны через `_id` объектов:

```javascript
spec.source(15, 15, { id: '94e8a44a5fa6113' });
```

Если в memory fixture хранятся ссылки на объекты по `_id` (например, кэш структур), изменение `id` в room fixture сломает эти ссылки.

Совет: при необходимости фиксируйте `_id` в room fixture явно и синхронизируйте их с memory fixture.

## 6. Как выбрать подход

### Подход 1. Только spec (без fixture)

```javascript
createWorld({
  rooms: [
    {
      name: 'W0N1',
      controller: spec.controller({ level: 2 }),
      sources: [spec.source(15, 15)],
      structures: [spec.spawn(25, 25)],
    },
  ],
  bots: [{ username: 'bot', room: 'W0N1' }],
});
```

Подходит для быстрых тестов без переиспользования.

### Подход 2. Room fixture

```javascript
createWorld({
  rooms: [{ name: 'W0N1', roomFixture: 'my-room' }],
  bots: [{ username: 'bot', room: 'W0N1' }],
});
```

Подходит, если переиспользуете одну и ту же комнату.

### Подход 3. Room fixture + overrides

```javascript
createWorld({
  rooms: [
    {
      name: 'W0N1',
      roomFixture: 'my-room',
      roomOverrides: { exclude: ['tower'] },
    },
  ],
  bots: [{ username: 'bot', room: 'W0N1' }],
});
```

Подходит для локальных вариаций одной комнаты.

### Подход 4. Fixture + memory

```javascript
createWorld({
  rooms: [{ name: 'W0N1', roomFixture: 'my-room' }],
  bots: [{ username: 'bot', room: 'W0N1' }],
  memory: 'my-memory',
});
```

Подходит для тестов готовой развитой колонии.

## 7. Как создать room fixture

1. Создайте файл `*.room.js` в `roomFixturesDir` (или в любом месте, если регистрируете вручную).
2. Опишите комнату через `spec.*` constructors:
   - `spec.controller`
   - `spec.source`
   - `spec.spawn`
   - `spec.tower`
   - `spec.extension`
   - `spec.container`
   - `spec.storage`
   - `spec.road`
   - `spec.wall`
   - `spec.rampart`
   - `spec.creep`
   - `spec.invader`
   - `spec.dummyTarget`
3. При необходимости задайте `id` явно, чтобы ссылаться из memory fixture.
4. Вызовите `registerRoomFixture(name, fixture)` либо экспортируйте `{ name, fixture }`.
5. Используйте `roomFixture: 'name'` в `createWorld`.

## 8. Как создать или обновить memory fixture

Для создания memory fixtures используйте CLI tool `src/tools/capture-fixture.js`.

### Базовый запуск

```bash
# Сначала убедитесь, что smoke работает
npm run test:integration:smoke

# Затем создайте / пересоберите fixture
node src/tools/capture-fixture.js my-memory
```

### Что делает tool

1. Запускает мир до целевого RCL.
2. Даёт боту дополнительные тики на стабилизацию.
3. Сохраняет итоговое `Memory` в `fixtures/<name>.memory.json`.

### Флаги

| Флаг          | По умолчанию                                           | Назначение                              |
| ------------- | ------------------------------------------------------ | --------------------------------------- |
| `--from`      | `bootstrap_with_anchor` (пример имени из личного бота) | Стартовая memory fixture                |
| `--rcl`       | `3`                                                    | Целевой RCL                             |
| `--ticks`     | `10000`                                                | Лимит тиков до достижения RCL           |
| `--stabilize` | `2000`                                                 | Доп. тики на стабилизацию               |
| `--room`      | `W0N1`                                                 | Имя комнаты                             |
| `--sources`   | `[{"x":15,"y":15},{"x":35,"y":35}]`                    | Позиции источников (JSON)               |
| `--progress`  | `0`                                                    | Логировать каждые N тиков (0 = выкл.)   |
| `--log-level` | `errors`                                               | `silent` / `errors` / `all`             |
| `--warn-size` | `50000`                                                | Порог предупреждения по размеру (байты) |
| `--force`     | `false`                                                | Разрешить перезапись                    |

### Примеры

```bash
node src/tools/capture-fixture.js my-memory

node src/tools/capture-fixture.js my-memory --rcl 5 --ticks 20000

node src/tools/capture-fixture.js my-memory --room W1N1 --force
```

## 9. Рекомендации и анти-паттерны

### Делайте так

- храните layout комнаты в room fixture;
- храните прогретое состояние бота в memory fixture;
- описывайте вариации через `roomOverrides`;
- фиксируйте `_id` объектов, если room fixture и memory fixture связаны.

### Не делайте так

- не храните room layout в `*.memory.json`;
- не создавайте новую fixture ради одного маленького изменения, если хватает `roomOverrides`;
- не смешивайте слои: топологию мира и runtime Memory.

## Связанные документы

- [API-REFERENCE.md](./API-REFERENCE.md) — полный справочник API
- [EXAMPLES.md](./EXAMPLES.md) — эталонные сценарии и приёмы
- [GETTING-STARTED.md](./GETTING-STARTED.md) — быстрый старт
- [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md) — multi-room и multi-bot
