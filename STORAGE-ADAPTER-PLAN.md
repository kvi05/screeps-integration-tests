# Storage Adapter — план изоляции `screeps-server-mockup`

## 1. Цель

Свести все обращения к внутренностям `screeps-server-mockup` (БД, env, pubsub,
world API) в **один файл-адаптер**. Все остальные модули фреймворка
(`materialize`, `observers`, `worldHelpers`, `memory`, `world`) перестают
знать о `server.common.storage.*` и `server.world.*` — они работают только
через адаптер.

**Что НЕ трогаем:**

- Глубокий импорт `TerrainMatrix` (`screeps-server-mockup/dist/src/terrainMatrix`) — остаётся в `runtime.js` как есть.
- `server.start()` / `server.tick()` — остаются в `runtime.js` / `world.js`, это методы жизненного цикла, а не data access.
- `world.server` — публичное поле `WorldInstance`, остаётся для обратной совместимости (пользовательские сценарии могут ссылаться на него).

**Дополнительно:**

- Пин зависимости в `package.json`: `#master` → `#703645f` (фиксация конкретного коммита).

---

## 2. Текущее состояние: кто и как обращается к `screeps-server-mockup`

### 2.1. Прямые `require('screeps-server-mockup')`

| Файл         | Строка | Что делает                                                                    |
| ------------ | ------ | ----------------------------------------------------------------------------- |
| `runtime.js` | 7      | `const { ScreepsServer } = require(...)` — конструктор                        |
| `runtime.js` | 263    | `require('.../dist/src/terrainMatrix').default` — **deep import, не трогаем** |

### 2.2. Доступ к `server.common.storage.db`

| Файл                     | Операции                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `runtime.js`             | `db.users.insert`, `db.rooms.update`, `db['users.code'].insert`, `db['users.console'].insert` |
| `materialize.js`         | `db['rooms.objects'].insert`, `.findOne`, `.update` (8 функций)                               |
| `observers/metrics.js`   | `db['rooms.objects'].find`                                                                    |
| `observers/ownership.js` | `db['rooms.objects'].find`                                                                    |
| `world.js` (getRcl)      | `db['rooms.objects'].findOne`                                                                 |
| `worldHelpers.js`        | `db['rooms.objects'].findOne`, `.update`, `.remove`, `.insert`, `.find`                       |

### 2.3. Доступ к `server.common.storage.env`

| Файл                    | Операции                                                          |
| ----------------------- | ----------------------------------------------------------------- |
| `runtime.js`            | `env.set`, `env.sadd`, `env.keys.MEMORY`, `env.keys.ACTIVE_ROOMS` |
| `TestBot` (runtime.js)  | `env.get(env.keys.MEMORY + userId)`                               |
| `observers/eventLog.js` | `env.get(env.keys.ROOM_EVENT_LOG)`                                |
| `builders/memory.js`    | `env.set`, `env.get` (Memory read/write)                          |
| `worldHelpers.js`       | `env.get(env.keys.GAMETIME)`                                      |

### 2.4. Доступ к `server.common.storage.pubsub`

| Файл                          | Операции                                 |
| ----------------------------- | ---------------------------------------- |
| `TestBot.init()` (runtime.js) | `pubsub.subscribe` — подписка на console |

### 2.5. Доступ к `server.world.*`

| Файл         | Операции                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime.js` | `server.world.reset()`, `server.world.addRoom()`, `server.world.getTerrain()`, `server.world.setTerrain()`, `server.world.genRandomBadge()` |

### 2.6. Доступ к `server.processes`

| Файл                         | Операции                        |
| ---------------------------- | ------------------------------- |
| `runtime.js` (createDispose) | `Object.values(server.processes |     | {})` |

### 2.7. Типы (`@typedef`)

| Файл                                                        | Что                                                        |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| `types.js`, `materialize.js`, `memory.js`, `observers/*.js` | `@typedef {import('screeps-server-mockup').ScreepsServer}` |

---

## 3. Целевая архитектура

```
┌──────────────────────────────────────────────────────────┐
│  runtime.js                                              │
│  ┌────────────────────────────────────────────────────┐  │
│  │  const { ScreepsServer } = require('ssm');  ←─┐    │  │
│  │  const server = new ScreepsServer({...});      │    │  │
│  │                                                │    │  │
│  │  const adapter = createStorageAdapter(server); │    │  │
│  │  // adapter — единственный выход наружу         │    │  │
│  │  return { server, adapter, dispose };          │    │  │
│  └────────────────────────────────────────────────────┘  │
│                         │                                │
│                         ▼                                │
│  ┌────────────────────────────────────────────────────┐  │
│  │  storageAdapter.js  (НОВЫЙ ФАЙЛ)                   │  │
│  │                                                    │  │
│  │  createStorageAdapter(server) → {                  │  │
│  │    // DB                                            │  │
│  │    db: { find, findOne, insert, update, remove },   │  │
│  │    // Env                                            │  │
│  │    env: { get, set, sadd, keys },                   │  │
│  │    // Pubsub                                         │  │
│  │    pubsub: { subscribe },                           │  │
│  │    // World                                         │  │
│  │    world: { reset, addRoom, genRandomBadge },       │  │
│  │    // Processes (для dispose)                       │  │
│  │    getProcesses(),                                  │  │
│  │    // Raw server (на переходный период)             │  │
│  │    _server                                           │  │
│  │  }                                                  │  │
│  └──────────────┬─────────────────────────────────────┘  │
│                 │                                        │
│                 ▼                                        │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Все потребители:                                  │  │
│  │  materialize.js, observers/*.js, memory.js,        │  │
│  │  worldHelpers.js, world.js                         │  │
│  │                                                    │  │
│  │  Работают ТОЛЬКО через adapter,                    │  │
│  │  не требуют 'screeps-server-mockup'                │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**Ключевое правило:** `require('screeps-server-mockup')` встречается **ровно в двух местах**:

1. `runtime.js` — конструктор `ScreepsServer` + `TerrainMatrix` deep import.
2. `storageAdapter.js` — оборачивает server в адаптер.

Все остальные файлы импортируют адаптер (или получают его через аргументы) и **не знают** о `screeps-server-mockup`.

---

## 4. Интерфейс `StorageAdapter`

### 4.1. Файл: `src/lib/storageAdapter.js`

```js
'use strict';

/**
 * @file Адаптер над screeps-server-mockup: единая точка доступа к БД, env,
 * pubsub и world API. Все операции с хранилищем проходят только через этот файл.
 *
 * @module storageAdapter
 */

/**
 * @typedef {import('./types').ScreepsServer} ScreepsServer
 *
 * @typedef {Object} StorageAdapter
 * @property {DBFacade} db
 * @property {EnvFacade} env
 * @property {PubsubFacade} pubsub
 * @property {WorldFacade} world
 * @property {() => Object<string,import('child_process').ChildProcess>} getProcesses
 * @property {ScreepsServer} _server — сырой сервер (только для world.server + переходного периода)
 */

/**
 * @typedef {Object} DBFacade
 * @property {(collection: string, query: Object) => Promise<Object[]>} find
 * @property {(collection: string, query: Object) => Promise<Object|null>} findOne
 * @property {(collection: string, doc: Object) => Promise<Object>} insert
 * @property {(collection: string, query: Object, update: Object) => Promise<void>} update
 * @property {(collection: string, query: Object) => Promise<void>} remove
 */

/**
 * @typedef {Object} EnvFacade
 * @property {(key: string) => Promise<string|null>} get
 * @property {(key: string, value: string) => Promise<void>} set
 * @property {(key: string, member: string) => Promise<void>} sadd
 * @property {Object} keys — env.keys из mockup
 */

/**
 * @typedef {Object} PubsubFacade
 * @property {(channel: string, handler: Function) => Promise<void>} subscribe
 */

/**
 * @typedef {Object} WorldFacade
 * @property {() => Promise<void>} reset
 * @property {(roomName: string) => Promise<void>} addRoom
 * @property {(roomName: string) => Promise<Object>} getTerrain
 * @property {(roomName: string, terrain: Object) => Promise<void>} setTerrain
 * @property {() => Object} genRandomBadge
 */

/**
 * Создаёт адаптер хранилища вокруг экземпляра ScreepsServer.
 *
 * @param {ScreepsServer} server
 * @returns {StorageAdapter}
 */
function createStorageAdapter(server) {
  const { db, env, pubsub } = server.common.storage;

  return {
    db: {
      find: (collection, query) => db[collection].find(query),
      findOne: (collection, query) => db[collection].findOne(query),
      insert: (collection, doc) => db[collection].insert(doc),
      update: (collection, query, update) => db[collection].update(query, update),
      remove: (collection, query) => db[collection].remove(query),
    },

    env: {
      get: (key) => env.get(key),
      set: (key, value) => env.set(key, value),
      sadd: (key, member) => env.sadd(key, member),
      keys: env.keys,
    },

    pubsub: {
      subscribe: (channel, handler) => pubsub.subscribe(channel, handler),
    },

    world: {
      reset: () => server.world.reset(),
      addRoom: (roomName) => server.world.addRoom(roomName),
      getTerrain: (roomName) => server.world.getTerrain(roomName),
      setTerrain: (roomName, terrain) => server.world.setTerrain(roomName, terrain),
      genRandomBadge: () => server.world.genRandomBadge(),
    },

    getProcesses: () => Object.values(server.processes || {}),

    _server: server,
  };
}

module.exports = { createStorageAdapter };
```

### 4.2. Сигнатуры методов — соответствие текущему API

| Метод адаптера                      | Аналог в mockup                    | Примечание                                            |
| ----------------------------------- | ---------------------------------- | ----------------------------------------------------- |
| `adapter.db.find(col, q)`           | `db[col].find(q)`                  |                                                       |
| `adapter.db.findOne(col, q)`        | `db[col].findOne(q)`               |                                                       |
| `adapter.db.insert(col, doc)`       | `db[col].insert(doc)`              |                                                       |
| `adapter.db.update(col, q, upd)`    | `db[col].update(q, upd)`           |                                                       |
| `adapter.db.remove(col, q)`         | `db[col].remove(q)`                |                                                       |
| `adapter.env.get(key)`              | `env.get(key)`                     |                                                       |
| `adapter.env.set(key, val)`         | `env.set(key, val)`                |                                                       |
| `adapter.env.sadd(key, member)`     | `env.sadd(key, member)`            |                                                       |
| `adapter.env.keys`                  | `env.keys`                         | ссылка, не функция                                    |
| `adapter.pubsub.subscribe(ch, fn)`  | `pubsub.subscribe(ch, fn)`         |                                                       |
| `adapter.world.reset()`             | `server.world.reset()`             |                                                       |
| `adapter.world.addRoom(name)`       | `server.world.addRoom(name)`       |                                                       |
| `adapter.world.getTerrain(name)`    | `server.world.getTerrain(name)`    | для prepareRoom                                       |
| `adapter.world.setTerrain(name, t)` | `server.world.setTerrain(name, t)` | для prepareRoom                                       |
| `adapter.world.genRandomBadge()`    | `server.world.genRandomBadge()`    |                                                       |
| `adapter.getProcesses()`            | `Object.values(server.processes)`  | для dispose                                           |
| `adapter._server`                   | сам `server`                       | для `world.server` и `server.start()`/`server.tick()` |

---

## 5. Пошаговый план миграции

### Шаг 1: Пин версии `screeps-server-mockup`

**Файл:** `package.json`

Заменить:

```json
"screeps-server-mockup": "screepers/screeps-server-mockup#master"
```

На:

```json
"screeps-server-mockup": "screepers/screeps-server-mockup#703645f"
```

Выполнить `npm install` для фиксации `package-lock.json`.

**Риск:** нулевой. Если коммит `703645f` недоступен — ошибка при `npm install`, а не в рантайме.

---

### Шаг 2: Создать `src/lib/storageAdapter.js`

Создать файл с кодом из секции 4.1. Подключить JSDoc по конвенциям проекта.

**Новых зависимостей:** нет (только `screeps-server-mockup`, уже есть).

**Тесты:** на этом этапе не требуются — адаптер является чистой обёрткой (delegation), тестировать delegation нет смысла. Покрытие обеспечивается существующими unit- и integration-тестами.

---

### Шаг 3: Перевести `runtime.js` на адаптер

**Файл:** `src/lib/runtime.js`

Изменения:

1. Добавить `const { createStorageAdapter } = require('./storageAdapter');`
2. В `prepareServer()`: после `new ScreepsServer(...)` → создать адаптер, включить в `PreparedServer`.
3. В `addBot()`: заменить `server.common.storage.{db,env}` → `adapter.db.*`, `adapter.env.*`.
4. В `TestBot`: заменить `this._server.common.storage.{env,db,pubsub}` → `this._adapter.*`.
5. В `prepareRoom()`: заменить `server.world.*` → `adapter.world.*`.
6. В `createDispose()`: заменить `server.processes` → `adapter.getProcesses()`.
7. `TerrainMatrix` deep import — **не трогаем**.

**Изменения в сигнатурах:**

- `prepareServer()` возвращает `{ server, adapter, dispose }` (было `{ server, dispose }`).
- `PreparedServer` typedef обновляется: добавляется поле `adapter`.
- `TestBot` конструктор принимает `adapter` вместо `server`.

**Риск:** средний. `runtime.js` — ядро фреймворка. После изменений прогнать `npm test` + `npm run test:integration:smoke`.

---

### Шаг 4: Перевести `builders/materialize.js` на адаптер

**Файл:** `src/lib/builders/materialize.js`

Изменения:

1. Убрать `@typedef {import('screeps-server-mockup').ScreepsServer}` — заменить на `@typedef {import('../storageAdapter').StorageAdapter}`.
2. Все функции (`materializeStructure`, `materializeController`, `materializeCreep`, etc.):
   - Первый аргумент `server` → `adapter`.
   - `server.common.storage.db` → `adapter.db`.
3. `materializeRoom()` вызывает подфункции с адаптером.

**Риск:** низкий. Механическая замена. 8 функций, все одинакового паттерна.

---

### Шаг 5: Перевести `observers/` на адаптер

**Файлы:** `observers/metrics.js`, `observers/eventLog.js`, `observers/ownership.js`

Изменения:

1. Убрать `@typedef {import('screeps-server-mockup').ScreepsServer}` → `StorageAdapter`.
2. В сигнатурах: `server` → `adapter`.
3. `server.common.storage.db` → `adapter.db`.
4. `server.common.storage.env` → `adapter.env`.

**Риск:** низкий. Observers — stateless readers, замена механическая.

---

### Шаг 6: Перевести `builders/memory.js` на адаптер

**Файл:** `src/lib/builders/memory.js`

Изменения:

1. `setBotMemory(server, userId, memory)` → `setBotMemory(adapter, userId, memory)`.
2. `getBotMemory(server, userId)` → `getBotMemory(adapter, userId)`.
3. `server.common.storage.env` → `adapter.env`.

**Риск:** низкий. Две функции, простой паттерн.

---

### Шаг 7: Перевести `worldHelpers.js` на адаптер

**Файл:** `src/lib/worldHelpers.js`

Изменения:

1. `createWorldHelpers(server, defaultBotUserId)` → `createWorldHelpers(adapter, defaultBotUserId)`.
2. `const { db } = server.common.storage` → `const { db } = adapter`.
3. `getGameTime(server)` → `getGameTime(adapter)`, внутри `server.common.storage.env` → `adapter.env`.

**Риск:** низкий. Много операций, но все однотипные.

---

### Шаг 8: Перевести `world.js` на адаптер

**Файл:** `src/lib/world.js`

Изменения:

1. `createWorld()`:
   - После `prepareServer()` получаем `adapter` из `prepared`.
   - Прокидываем `adapter` во все вызовы: `addBots`, `materializeRoom`, `setBotMemory`, `readEventLog`, `snapshotOwners`, `collectMetrics`, `getRcl`, `createWorldHelpers`.
2. `getRcl(server, roomName)` → `getRcl(adapter, roomName)`.
3. `server.start()` / `server.tick()` — остаются через `adapter._server` или через сохранённую ссылку на `server`. Рекомендация: сохранить `server` как локальную переменную для `start()`/`tick()`, а для data-операций использовать `adapter`.
4. `world.server` в возвращаемом `WorldInstance` → `adapter._server` (обратная совместимость).

**Риск:** средний. `world.js` — самый большой файл, много вызовов. После изменений — полный прогон `npm run test:integration`.

---

### Шаг 9: Обновить `types.js`

**Файл:** `src/lib/types.js`

Изменения:

1. Оставить `@typedef {import('screeps-server-mockup').ScreepsServer}` — он всё ещё нужен для `world.server`.
2. Добавить `@typedef {import('./storageAdapter').StorageAdapter}` — для использования в сигнатурах.
3. `PreparedServer` — добавить поле `adapter: StorageAdapter`.

---

### Шаг 10: Обновить `src/index.js` и `src/public/*`

**Файлы:** `src/index.js`, `src/public/worldHelpers.js`

Изменения:

1. Убедиться, что публичные re-exports не протаскивают `ScreepsServer` напрямую.
2. Если `worldHelpers.js` публично экспортирует что-то с сигнатурой `server` — обновить на `adapter`.

**Риск:** низкий. Публичные файлы — thin re-exports.

---

### Шаг 11: Прогон тестов

```bash
npm run lint
npm run format:check
npm test
npm run test:integration:smoke
npm run test:integration
```

---

## 6. Сводка изменений по файлам

| Файл                              | Тип изменения                                                  | Сложность  |
| --------------------------------- | -------------------------------------------------------------- | ---------- |
| `package.json`                    | Пин `#master` → `#703645f`                                     | Тривиально |
| **`src/lib/storageAdapter.js`**   | **Новый файл**                                                 | ~70 строк  |
| `src/lib/runtime.js`              | `require` адаптера, замена `server.common.storage` → `adapter` | Средняя    |
| `src/lib/types.js`                | Добавить `StorageAdapter` typedef, обновить `PreparedServer`   | Тривиально |
| `src/lib/builders/materialize.js` | `server` → `adapter` в 8 функциях                              | Низкая     |
| `src/lib/builders/memory.js`      | `server` → `adapter` в 2 функциях                              | Тривиально |
| `src/lib/observers/metrics.js`    | `server` → `adapter` в `collectMetrics`                        | Тривиально |
| `src/lib/observers/eventLog.js`   | `server` → `adapter` в `readEventLog`                          | Тривиально |
| `src/lib/observers/ownership.js`  | `server` → `adapter` в `snapshotOwners`                        | Тривиально |
| `src/lib/worldHelpers.js`         | `server` → `adapter` в `createWorldHelpers` + `getGameTime`    | Низкая     |
| `src/lib/world.js`                | Прокидывание `adapter` во все вызовы                           | Средняя    |
| `src/index.js` + `src/public/*`   | Проверка сигнатур                                              | Тривиально |

---

## 7. Что изменится для конечного пользователя

**Ничего.** Публичное API (`createWorld`, `spec`, observers, assertions) не меняется.
`world.server` остаётся доступен (через `adapter._server`).

Единственное видимое изменение — `package.json`: пин на конкретный коммит. Пользователи,
которые ссылаются на пакет через Git, получат детерминированную версию `screeps-server-mockup`.

---

## 8. Риски и смягчение

| Риск                                                         | Смягчение                                                                                                                          |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Ошибка при массовой замене `server` → `adapter` в `world.js` | Пошаговая миграция (шаги 3–8), прогон smoke-теста после каждого шага                                                               |
| `adapter._server` ломает обратную совместимость              | Сохраняем ссылку, `world.server === adapter._server`                                                                               |
| Изменение API `screeps-server-mockup` в будущем              | При обновлении коммита меняем ТОЛЬКО `storageAdapter.js` + `runtime.js` (конструктор), а не 9 файлов                               |
| Deep import `TerrainMatrix` остаётся уязвимым                | Принято осознанно. При поломке — чинится в одном месте (`runtime.js`). В будущем можно запросить публичный экспорт у мейнтейнеров. |

---

## 9. Оценка трудозатрат

- **Создание адаптера:** 30 мин
- **Миграция runtime.js:** 1 час
- **Миграция materialize.js + observers + memory + worldHelpers:** 2 часа
- **Миграция world.js:** 1.5 часа
- **Тестирование и отладка:** 2 часа
- **Итого:** ~7 часов (1 рабочий день)

---

## 10. Критерий успеха

После миграции `grep -r "server\.common\.storage" src/` не находит ни одного
вхождения **вне** `storageAdapter.js` и `runtime.js`.

```bash
# ДО:
grep -r "server\.common\.storage" src/lib/ | wc -l   # ~30+ вхождений

# ПОСЛЕ:
grep -r "server\.common\.storage" src/lib/ | wc -l   # 0 (в идеале)
```
