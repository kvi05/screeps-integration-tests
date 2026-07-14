# Fixtures Guide

Этот документ описывает fixture-модель integration framework: какие бывают fixtures, чем они отличаются, когда какой использовать и как добавлять новые.

## Содержание

- [1. Два типа fixtures](#1-два-типа-fixtures)
- [2. Room fixtures](#2-room-fixtures)
- [3. Room overrides](#3-room-overrides)
- [4. Memory fixtures](#4-memory-fixtures)
- [5. Связь между roomFixture и memoryFixture](#5-связь-между-roomfixture-и-memoryfixture)
- [6. Как выбрать подход](#6-как-выбрать-подход)
- [7. Как добавить новый room fixture](#7-как-добавить-новый-room-fixture)
- [8. Как создать или обновить memory fixture](#8-как-создать-или-обновить-memory-fixture)
- [9. Рекомендации и анти-паттерны](#9-рекомендации-и-анти-паттерны)

## 1. Два типа fixtures

В framework есть **два разных слоя** fixtures, которые покрывают разные потребности.

### Room fixture (семантическая модель комнаты)

Файл: `src/lib/fixtures/roomFixture.js`

Это **семантический spec** — описание состояния комнаты как набора игровых объектов:

- `controller`
- `sources`
- `structures`
- `creeps`

Room fixture отвечает на вопрос:
**"Какой мир должен существовать в комнате к старту сценария?"**

### Memory fixture (snapshot Memory бота)

Файл: `fixtures/*.memory.json`

Это **snapshot `Memory`** бота после прогретого состояния:

- `Memory.rooms`
- `Memory.colonies`
- И все остальные поля Memory вашего бота

Memory fixture отвечает на вопрос:
**"С каким внутренним состоянием бот должен стартовать?"**

### Ключевая разница

| Что                | Room fixture                  | Memory fixture                                                  |
| ------------------ | ----------------------------- | --------------------------------------------------------------- |
| Описывает          | Объекты мира                  | Внутреннее состояние бота                                       |
| Формат             | Canonical spec                | JSON snapshot                                                   |
| Где лежит          | `lib/fixtures/roomFixture.js` | `fixtures/*.memory.json`                                        |
| Основной use case  | Переиспользуемая комната      | "Прогретое" Memory бота                                         |
| Подключается через | `rooms[].roomFixture`         | `createWorld({ memory: 'fixture-name' })` или `memoryOverrides` |

## 2. Room fixtures

### Пример

```javascript
const RCL3_STABLE_ROOM = {
  name: 'rcl3-stable',
  description: 'RCL3 базовая комната: tower, 10 extensions, container, 2 sources',

  controller: spec.controller({
    level: 3,
    progress: 2146,
    progressTotal: 135000,
  }),

  sources: [
    spec.source(15, 15),
    // Для полного контроля можно переоперделять любые поля
    spec.source(35, 35, { id: '4361a44a5fa1c06' }),
  ],

  structures: [
    // Переоперделение полей по умолчанию
    spec.tower(26, 24),
    spec.extension(27, 24, { energy: 500 }),
    spec.container(23, 24, { id: '71faa48c085e889', energy: 1500 }),
    spec.road(24, 24),
  ],

  creeps: [],
};
```

### Использование в сценарии

```javascript
const world = await createWorld({
  rooms: [{ name: 'W0N1', roomFixture: 'rcl3-stable' }],
  bots: [{ username: 'bot', room: 'W0N1' }],
  ticks: 100,
});
```

### Почему это лучше, чем копировать layout в каждый сценарий

- одна комната используется в нескольких тестах;
- изменения layout фиксируются в одном месте;
- сценарий описывает **вариацию поведения**, а не повторяет layout.

## 3. Room overrides

`roomOverrides` позволяет менять fixture локально под конкретный сценарий без полного копирования.

### Поддерживаемые override-поля

| Поле         | Назначение                                    |
| ------------ | --------------------------------------------- |
| `exclude`    | Удалить объекты из fixture по `id` или `type` |
| `structures` | Переопределить поля существующих структур     |
| `controller` | Изменить controller                           |
| `append`     | Добавить новые структуры                      |
| `hostiles`   | Добавить hostile creeps                       |

### Пример 1. Убрать башню

```javascript
const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      roomFixture: 'rcl3-stable',
      roomOverrides: { exclude: ['tower'] },
    },
  ],
  bots: [{ username: 'bot', room: 'W0N1' }],
});
```

### Пример 2. Изменить controller и energy extension

```javascript
const { createWorld, spec } = require('screeps-integration-tests');

const world = await createWorld({
  rooms: [
    {
      name: 'W0N1',
      roomFixture: 'rcl3-stable',
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
      roomFixture: 'rcl3-stable',
      roomOverrides: {
        hostiles: [spec.invader(10, 25, { name: 'Invader_1' })],
      },
    },
  ],
  bots: [{ username: 'bot', room: 'W0N1' }],
});
```

### Когда использовать overrides, а не новую fixture

Используйте `roomOverrides`, если меняется только локальная вариация:

- убрать одну структуру;
- изменить safeMode;
- подправить энергию нескольких объектов;
- добавить одного hostile creep.

Создавайте новую room fixture, если меняется **базовая геометрия комнаты**:

- другой layout комнаты;
- другая стадия развития (например, отдельная RCL5 room);

## 4. Memory fixtures

Memory fixture нужен, когда сценарий должен стартовать с уже прогретого состояния бота.

### Когда memory fixture действительно нужен

- бот должен уже знать комнату (`trackedStructures`);
- в `Memory` должны существовать кэши или состояние задач;
- сценарий начинается **после bootstrap**, а не с чистого старта.

### Когда memory fixture НЕ нужен

- описание только layout комнаты → room fixture;
- сценарий стартует с пустого `Memory` и bootstrap идёт естественно.

### Подключение

```javascript
const world = await createWorld({
  rooms: [{ name: 'W0N1', roomFixture: 'rcl3-stable' }],
  bots: [{ username: 'bot', room: 'W0N1' }],
  memory: 'rcl3-stable',
});
```

### Проверка существования fixture

```javascript
const { hasFixture } = require('screeps-integration-tests/memory-fixtures');

if (!hasFixture('rcl3-stable')) {
  console.log('SKIP: memory fixture не найден');
  return { skipped: true };
}
```

## 5. Связь между roomFixture и memoryFixture

Room fixture и memory fixture могут быть **связаны через `_id` объектов**:

- `spec.source(15, 15, { id: '94e8a44a5fa6113' })` — fixture memory содержит `trackedStructures.source.94e8a44a5fa6113`.
- Если изменить `_id` в room fixture, memory fixture сломается.

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
  rooms: [{ name: 'W0N1', roomFixture: 'rcl3-stable' }],
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
      roomFixture: 'rcl3-stable',
      roomOverrides: { exclude: ['tower'] },
    },
  ],
  bots: [{ username: 'bot', room: 'W0N1' }],
});
```

Подходит для локальных вариаций одной и той же комнаты.

### Подход 4. Fixture + memory

```javascript
createWorld({
  rooms: [{ name: 'W0N1', roomFixture: 'rcl3-stable' }],
  bots: [{ username: 'bot', room: 'W0N1' }],
  memory: 'rcl3-stable',
});
```

Подходит тестов готовой развитой колонии.

## 7. Как добавить новый room fixture

### Шаг 1. Откройте registry

Файл: `src/lib/fixtures/roomFixture.js`

### Шаг 2. Опишите fixture через `spec.*`

Используйте semantic constructors:

- `spec.controller`
- `spec.source`
- `spec.spawn`
- `spec.tower`
- `spec.extension`
- `spec.container`
- `spec.storage`
- `spec.road`
- `spec.wall`
- `spec.creep`
- `spec.invader`

Для каждого объекта задавайте `id?` явно (если хотите ссылаться на него из memory).

### Шаг 3. Если будет memory fixture — зафиксируйте ids

Если планируете тот же `name` использовать для memory fixture (`*.memory.json`),
то `_id` в room fixture и `_id` в memory fixture желательно должны совпадать.

Проще всего: сначала собрать memory через `capture-fixture` — он покажет реальные id, и затем подставить их в room fixture. Но **capture-fixture сам этого не умеет**, поэтому согласованность держится вручную.

### Шаг 4. Зарегистрируйте fixture

```javascript
const ROOM_FIXTURES = {
  'rcl3-stable': RCL3_STABLE_ROOM,
  'my-new-room': MY_NEW_ROOM,
};
```

### Шаг 5. Используйте в сценарии

```javascript
const world = await createWorld({
  rooms: [{ name: 'W0N1', roomFixture: 'my-new-room' }],
  bots: [{ username: 'bot', room: 'W0N1' }],
});
```

## 8. Как создать или обновить memory fixture

Для memory fixtures есть CLI tool `src/tools/capture-fixture.js`.

### Базовый запуск

```bash
# Сначала убедитесь что smoke работает
npm run test:integration:smoke

# Затем создайте / пересоберите fixture
node src/tools/capture-fixture.js rcl3-stable
```

### Что делает tool

1. Запускает мир до целевого RCL.
2. Даёт боту ещё несколько тиков на стабилизацию.
3. Сохраняет итоговое `Memory` в `fixtures/*.memory.json`.

### Основные флаги

| Флаг          | По умолчанию            | Назначение                    |
| ------------- | ----------------------- | ----------------------------- |
| `--from`      | `bootstrap_with_anchor` | Стартовая memory fixture      |
| `--rcl`       | `3`                     | Целевой RCL                   |
| `--ticks`     | `10000`                 | Лимит тиков до достижения RCL |
| `--stabilize` | `2000`                  | Доп. тики на стабилизацию     |
| `--room`      | `W0N1`                  | Имя комнаты                   |
| `--sources`   | 2 source                | Позиции источников            |
| `--force`     | `false`                 | Разрешить перезапись          |

### Примеры

```bash
# RCL3 fixture
node src/tools/capture-fixture.js rcl3-stable

# RCL5 fixture
node src/tools/capture-fixture.js rcl5-stable --rcl 5 --ticks 20000
```

## 9. Рекомендации и анти-паттерны

### Делайте так

- храните layout комнаты в room fixture;
- храните прогретое состояние бота в memory fixture;
- описывайте вариации через `roomOverrides`;

### Не делайте так

- не храните room layout в `*.memory.json`;
- не создавайте новую fixture ради одного маленького изменения, если хватает `roomOverrides`;
- не смешивайте слои: топологию мира и runtime Memory.

## Связанные документы

- [GETTING-STARTED.md](./GETTING-STARTED.md) — быстрый старт
- [API-REFERENCE.md](./API-REFERENCE.md) — полный API
- [EXAMPLES.md](./EXAMPLES.md) — эталонные сценарии
- [MULTI-ROOM-GUIDE.md](./MULTI-ROOM-GUIDE.md) — multi-room и multi-bot
- [fixtures/FIXTURE-CAPTURE.md](./fixtures/FIXTURE-CAPTURE.md) — памятка по capture tool
