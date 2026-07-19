'use strict';

/**
 * Централизованные типы для integration tests.
 *
 * Все @typedef размещены здесь для единообразия и переиспользования.
 * Остальные файлы ссылаются через `import('./types').TypeName`.
 *
 * Архитектура типов следует модели:
 * - **Multi-room:** один мир = N комнат, итерируемых по `opts.rooms`
 * - **Multi-bot:** один мир = M пользователей, доступных через `world.bots`
 * - **Spec-only:** объекты мира описываются через `spec.*` конструкторы,
 *   которые не пишут в БД напрямую
 * - **Materialize — единственный writer:** функции `materialize*` превращают
 *   specs в реальные документы БД
 *
 * @module types
 */

// ─── Server ─────────────────────────────────────────────────────────────────

/**
 * ScreepsServer из screeps-server-mockup.
 * @typedef {import('screeps-server-mockup').ScreepsServer} ScreepsServer
 */

/**
 * Бот, возвращаемый `server.world.addBot()`. Соответствует User в БД mockup.
 * @typedef {Object} Bot
 * @property {string} id          — _id пользователя в БД (в spec — `userId`, в БД — `user`)
 * @property {string} username
 * @property {string} room        — имя комнаты, к которой привязан бот при создании
 * @property {Object} [memory]    — get/set памяти бота
 * @property {Function} [console] — выполнение JS-кода в контексте бота
 * @property {Function} on        — подписка на события (console, ...)
 */

// ─── Body part ──────────────────────────────────────────────────────────────

/**
 * Часть тела крипа.
 * @typedef {Object} BodyPart
 * @property {'move'|'work'|'carry'|'attack'|'rangedAttack'|'heal'|'claim'|'tough'|'fatigue'} type
 * @property {number} hits — здоровье части (обычно 100, 150 для boosted)
 */

/**
 * Тип структуры в БД mockup.
 * @typedef {'spawn'|'tower'|'extension'|'container'|'storage'|'road'|'constructedWall'|'rampart'} StructureType
 */

// ─── Canonical spec types ──────────────────────────────────────────────────

/**
 * Каноническая спецификация структуры. Минимум обязательных полей:
 * `type`, `x`, `y`. Остальное подставляется дефолтами по типу.
 *
 * `roomName` обычно устанавливается через `buildCanonicalRoom` на этапе
 * оркестрации — не обязательно задавать в spec-конструкторе.
 *
 * `userId` нужен для owner-dependent структур (spawn / tower / extension /
 * storage). Если не задан — объект будет без владельца.
 *
 * `id` — конкретный _id, используется при сопоставлении с memory fixture.
 * Используется как есть (см. ID policy в `builders/materialize.js`).
 *
 * @typedef {Object} StructureSpec
 * @property {StructureType} type
 * @property {number} x
 * @property {number} y
 * @property {string} [roomName]           — имя комнаты (проставляется автоматически)
 * @property {string} [userId]              — _id владельца (bot.id); без значения — нейтральный
 * @property {string} [id]                  — конкретный _id (для memory fixture)
 * @property {string} [name]                — имя (для spawn)
 * @property {Object} [store]               — { energy: N } (по умолчанию по типу)
 * @property {Object} [storeCapacityResource] — { energy: N }
 * @property {number} [hits]
 * @property {number} [hitsMax]
 * @property {boolean} [notifyWhenAttacked]
 * @property {Object} [overrides]           — произвольные поля для слияния в БД-документ
 */

/**
 * Каноническая спецификация source.
 * @typedef {Object} SourceSpecCanonical
 * @property {number} x
 * @property {number} y
 * @property {string} [roomName]        — имя комнаты (проставляется автоматически)
 * @property {number} [energy=3000]
 * @property {number} [energyCapacity=3000]
 * @property {number} [ticksToRegeneration=0]
 * @property {string} [id]              — конкретный _id (для memory fixture)
 */

/**
 * Каноническая спецификация controller.
 *
 * Создаётся через `spec.controller({...})`. Вставляется в БД функцией
 * `materializeController()` как часть общей фазы materializeRoom.
 *
 * Controller — не special case: он материализуется тем же конвейером, что
 * spawn, tower и source. Если controller не описан в spec — в комнате
 * просто не будет контроллера (подходит для reserve-комнат без бота).
 *
 * `x`/`y` по умолчанию (35, 35) — центр карты. `id` задаётся явно для
 * совместимости с memory fixture. `userId` — владелец конроллера; если
 * не задан — проставляется `defaultBotUserId` в buildCanonicalRoom.
 *
 * @typedef {Object} ControllerSpec
 * @property {string} [roomName]           — имя комнаты (проставляется автоматически)
 * @property {number} [x=35]
 * @property {number} [y=35]
 * @property {string} [id]                 — конкретный _id (для memory fixture)
 * @property {number} [level=1]
 * @property {number} [progress=0]
 * @property {string} [userId]              — _id владельца (reservation)
 * @property {number|null} [downgradeTime=null]
 * @property {number} [safeMode=0]
 * @property {number} [safeModeAvailable=0]
 * @property {boolean} [isPowerEnabled=false]
 */

/**
 * Каноническая спецификация крипа. `userId` — это `_id` бота
 * или литерал `'2'` для Invader. Если не задан — заполняется
 * defaultBotUserId в buildCanonicalRoom.
 *
 * @typedef {Object} CreepSpecCanonical
 * @property {number} x
 * @property {number} y
 * @property {string} [roomName]            — имя комнаты (проставляется автоматически)
 * @property {string} [userId]              — _id пользователя или '2' (Invader)
 * @property {string} [name]                — уникальное имя (auto-generated если не задано)
 * @property {BodyPart[]} [body]            — по умолчанию 3 WORK + 3 MOVE
 * @property {number} [hits]                — авто-сумма body если не задано
 * @property {number} [hitsMax]
 * @property {string} [id]                  — конкретный _id (для memory fixture)
 */

/**
 * Каноническая спецификация комнаты — собранная по итогам applyRoomOverrides
 * (или напрямую, если без fixture). Используется materialize-слоем.
 *
 * @typedef {Object} RoomSpecCanonical
 * @property {string} name                   — имя комнаты ('W0N1')
 * @property {ControllerSpec} [controller]
 * @property {SourceSpecCanonical[]} [sources=[]]
 * @property {StructureSpec[]} [structures=[]]
 * @property {CreepSpecCanonical[]} [creeps=[]]
 * @property {CreepSpecCanonical[]} [hostiles=[]]
 */

// ─── Room fixture ──────────────────────────────────────────────────────────

/**
 * Семантическое описание комнаты как переиспользуемая fixture.
 *
 * Регистрируется в `lib/fixtures/roomFixture.js`. Используется через
 * `createWorld({ rooms: [{ name, roomFixture: '<name>' }] })`.
 *
 * @typedef {Object} RoomFixtureSpec
 * @property {string} name                  — уникальное имя fixture ('rcl3-stable')
 * @property {string} [description]
 * @property {ControllerSpec} [controller]
 * @property {SourceSpecCanonical[]} [sources]
 * @property {StructureSpec[]} [structures]
 * @property {CreepSpecCanonical[]} [creeps]
 */

/**
 * Overrides для room fixture. Позволяют менять fixture локально без
 * полного копирования.
 *
 * @typedef {Object} RoomOverrides
 * @property {Array<string|{id?:string,type?:string}>} [exclude]
 *           — удалить объекты по id / type
 * @property {StructureSpec[]} [structures]
 *           — переопределить поля существующих структур (по id или по type+x+y)
 * @property {Partial<ControllerSpec>} [controller]
 *           — переопределить controller (мерж полей)
 * @property {StructureSpec[]} [append]
 *           — добавить новые структуры
 * @property {CreepSpecCanonical[]} [creeps]
 *           — добавить creep боту
 * @property {CreepSpecCanonical[]} [hostiles]
 *           — добавить hostile creeps
 */

/**
 * @typedef {Object} MemoryFixtureRef
 * @property {string} fixture              — имя memory fixture (`*.memory.json` без суффикса)
 */

/**
 * Источник стартовой памяти бота.
 *
 * Поддерживаемые формы:
 * - строка с именем fixture;
 * - `{ fixture: '<name>' }`;
 * - inline object Memory.
 *
 * @typedef {string|MemoryFixtureRef|Object<string,*>} MemoryInput
 */

/**
 * Per-bot map стартовой памяти / override-патчей.
 * Ключ всегда равен `bot.username`.
 *
 * @typedef {Object<string,MemoryInput|Object<string,*>>} MemoryByBot
 */

/**
 * Описание бота для createWorld.
 *
 * @typedef {Object} BotSpec
 * @property {string} username              — уникальное имя бота (ключ в `world.bots`)
 * @property {string} room                  — имя комнаты, в которой бот появится
 * @property {number} [x=25]
 * @property {number} [y=25]
 * @property {Object} [modules]             — кастомные модули (default = из dist/)
 * @property {'all'|'error'|'warn'} [logLevel]  — переопределение глобального logLevel для этого бота
 * @property {boolean} [profiling]              — переопределение глобального profiling для этого бота
 */

/**
 * Бот с resolved (effective) настройками. Возвращается `createRuntime`.
 *
 * @typedef {Object} ResolvedBotSpec
 * @property {string} username
 * @property {string} room
 * @property {number} [x]
 * @property {number} [y]
 * @property {Object} [modules]
 * @property {'all'|'error'|'warn'} [logLevel]
 * @property {boolean} effectiveProfiling   — итоговый profiling (per-bot > global > default)
 */

/**
 * Спецификация комнаты в `createWorld({ rooms: [...] })`.
 *
 * Может быть либо inline (через `controller`/`sources`/`structures`/`creeps`/`hostiles`),
 * либо указывать готовый fixture через `roomFixture: '<name>'` или `roomFixture: {...}`.
 *
 * @typedef {Object} RoomSpecInput
 * @property {string} name                  — имя комнаты
 *
 * @property {string|Object} [roomFixture]  — имя зарегистрированной fixture или inline-объект
 *
 * @property {RoomOverrides} [roomOverrides]
 *           — модификации поверх fixture (exclude / structures / append / hostiles / controller)
 *
 * @property {ControllerSpec} [controller]  — (если без fixture) inline controller
 * @property {SourceSpecCanonical[]} [sources]  — (если без fixture) источники
 * @property {StructureSpec[]} [structures]     — (если без fixture) структуры
 * @property {CreepSpecCanonical[]} [creeps]     — (если без fixture) крипы бота
 * @property {CreepSpecCanonical[]} [hostiles]   — (если без fixture) hostile крипы
 */

/**
 * Опции `createWorld`.
 *
 * @typedef {Object} WorldOpts
 * @property {RoomSpecInput[]} rooms                                — обязательно, минимум 1
 * @property {BotSpec[]} [bots=[]]                                 — боты (если пусто — сценарий без ботов)
 * @property {MemoryInput|MemoryByBot} [memory]                    — стартовая Memory: shorthand для single-bot или явная map по username
 * @property {Object<string,*>|MemoryByBot} [memoryOverrides]      — deep-merge патчи поверх `memory`; без base memory становятся initial memory сами
 *
 * @property {number} [ticks=100]                                  — лимит тиков (если не задан `until.maxTicks`)
 * @property {boolean} [profiling=false]                           — включить профилирование (screeps-profiler + callgrind)
 *
 * @property {'all'|'error'|'warn'} [logLevel='all']             - Порог логов в world.report.logs
 * @property {number} [maxConsoleLines=10000]
 * @property {MetricsOpts} [metrics]                               — настройки сбора метрик
 *
 * @property {UntilOpts} [until]                                   — условие досрочного завершения
 * @property {OnTickCallback} [onTick]                             — callback на каждом тике
 * @property {EventSpec[]} [events]                                 — декларативные спавны по тикам
 */

/**
 * Условие завершения прогона. Тест завершается, если:
 * - `ticksRun >= maxTicks`, ИЛИ
 * - `predicate` вернул `true`, ИЛИ
 * - `Memory[until.signal]` стал truthy (у указанного бота или у всех).
 *
 * @typedef {Object} UntilOpts
 * @property {number} [maxTicks]
 * @property {PredicateFn} [predicate]   — async (world) => boolean
 * @property {string} [signal]           — имя поля в Memory бота
 * @property {string} [signalBot]        — имя бота для проверки signal (если не указано — все боты)
 */

/**
 * Предикат для остановки теста.
 * @callback PredicateFn
 * @param {WorldInstance} w
 * @returns {boolean|Promise<boolean>}
 */

/**
 * Callback на каждом тике. Срабатывает после `server.tick()`,
 * сбора event log / metrics, перед predicate-проверкой.
 *
 * @callback OnTickCallback
 * @param {WorldInstance} w
 * @param {number} tick                   — номер тика (0-based)
 * @returns {void|Promise<void>}
 */

/**
 * Декларативное событие по тику. `atTick` отсчитывается с 0.
 *
 * @typedef {Object} EventSpec
 * @property {number} atTick
 * @property {string} action              — имя действия ('spawnInvader', ...)
 * @property {Object} [params]             — параметры действия
 * @property {string} [params.room]        — целевая комната (обязателен для spawn*)
 */

// ─── World Report ──────────────────────────────────────────────────────────

/**
 * Статус одной комнаты в `world.rooms`.
 *
 * @typedef {Object} RoomStatus
 * @property {string} name
 * @property {RoomSpecCanonical} canonical  — итоговый spec, по которому комната materialize-илась
 * @property {{sourceIds:string[],structureIds:string[],creepIds:string[]}} ids  — _id в БД
 * @property {number} ticks                 — кол-во тиков, отработанных в этой комнате
 * @property {number} events                — кол-во событий, накопленных из этой комнаты
 */

/**
 * Итоговый отчёт о прогоне.
 *
 * @typedef {Object} WorldReport
 * @property {number} ticksRun                          — общее кол-во тиков
 *
 * @property {Object<string,number>} finalRcl           — RCL per room: { W0N1: 3, W0N2: 1 }
 *
 * @property {string[]} errors                          — ошибки бота из console ('[ERROR]')
 * @property {string[]} warnings                        — предупреждения ('[WARN]')
 * @property {string[]} logs                            — прочие логи (если `logLevel: 'all'`)
 *
 * @property {Object<string,Object>} finalMemory        — память per bot по username
 * @property {Object<string,string|null>} profileText   — текст screeps-profiler per bot
 * @property {Object<string,Object>} profileCallgrind   — callgrind-данные per bot
 *
 * @property {number} wallClockMs                       — общее время прогона (ms)
 *
 * @property {EventLogEntry[]} events                   — накопленный event log (по всем комнатам)
 * @property {MetricsReport} metrics                    — time-series метрик по сущностям
 * @property {Object<string,string>} objectOwners       — _id → user (owner)
 *
 * @property {string[]} frameworkWarnings               — технические предупреждения фреймворка (не ошибки бота)
 *
 * @property {string|null} stopReason                   — причина остановки (predicate / signal / maxTicks)
 */

/**
 * Запись в накопленном event log.
 * @typedef {Object} EventLogEntry
 * @property {number} tick                    — номер тика
 * @property {number} event                   — тип события (EVENT_ATTACK=1, EVENT_OBJECT_DESTROYED=2, ...)
 * @property {string} objectId                — _id объекта-инициатора
 * @property {Object} data                    — зависит от типа (targetId, damage, type, ...)
 */

/**
 * Тип сущности для time-series метрик.
 * @typedef {'rooms'|'colonies'|'bots'|'world'} MetricEntityType
 */

/**
 * Сэмпл метрик сущности. Обязательно содержит `tick`.
 *
 * @typedef {Object} MetricsSample
 * @property {number} tick
 * @property {Object<string,*>} [values]     — произвольные JSON-совместимые значения
 */

/**
 * Метрики комнаты без поля `tick` (добавляется recorder'ом).
 *
 * @typedef {Object} RoomMetrics
 * @property {number} rcl
 * @property {number} rclProgress
 * @property {number} energyAvailable
 * @property {number} energyCapacity
 * @property {number} spawnCount
 * @property {SpawnHitInfo[]} spawnHits
 * @property {number} towerCount
 * @property {number} towerEnergy
 * @property {number} towerCapacity
 * @property {number} extensionCount
 * @property {number} creepCount
 * @property {Object<string,number>} creepsByRole
 * @property {number} storageEnergy
 * @property {number} containerEnergy
 * @property {number} totalHits
 */

/**
 * @typedef {Object} SpawnHitInfo
 * @property {string} name
 * @property {number} hits
 * @property {number} hitsMax
 */

/**
 * Time-series одной сущности.
 * @typedef {MetricsSample[]} MetricSeries
 */

/**
 * Карта сущностей одного типа: entityId → series.
 * @typedef {Object<string, MetricSeries>} MetricEntityMap
 */

/**
 * Отчёт метрик по всем сущностям.
 *
 * @typedef {Object} MetricsReport
 * @property {MetricEntityMap} rooms     — time-series по комнатам
 * @property {MetricEntityMap} colonies  — time-series по колониям
 * @property {MetricEntityMap} bots      — time-series по ботам
 * @property {MetricSeries} world        — time-series по миру
 */

/**
 * Опции сбора метрик.
 *
 * @typedef {Object} MetricsOpts
 * @property {number} [every=0]        — сэмплировать каждые N тиков (0 = off)
 * @property {boolean} [rooms=true]    — собирать метрики комнат
 * @property {boolean} [colonies=false] — собирать метрики колоний (пока не поддерживается)
 * @property {boolean} [bots=false]    — собирать метрики ботов (пока не поддерживается)
 * @property {boolean} [world=false]   — собирать метрики мира (пока не поддерживается)
 */

/**
 * Контекст collector'а метрик.
 *
 * @typedef {Object} MetricCollectorContext
 * @property {ScreepsServer} server
 * @property {number} tick
 * @property {string} [roomName]
 * @property {string} [botUsername]
 * @property {WorldReport} report
 */

/**
 * Collector метрик возвращает plain object с метриками.
 *
 * @callback MetricCollector
 * @param {MetricCollectorContext} context
 * @returns {Object<string, number>|Promise<Object<string, number>>}
 */

// ─── World Instance ────────────────────────────────────────────────────────

/**
 * Мир, возвращаемый `createWorld()`. Все методы, требующие контекст
 * конкретной комнаты или бота, теперь требуют явный аргумент.
 *
 * @typedef {Object} WorldInstance
 * @property {RunFn} run                          — основной прогон, возвращает WorldReport
 * @property {TickFn} tick                        — выполнить `n` тиков
 * @property {ExecFn} exec                        — выполнить JS-код в боте
 * @property {SpawnFn} spawn                      — создать крипа (room обязателен)
 * @property {EventLogFn} getEventLog                — прочитать event log комнаты
 * @property {ReadMemoryFn} readMemory            — прочитать Memory бота (по username)
 * @property {WriteMemoryFn} writeMemory          — обновить Memory (мерж)
 * @property {RegisterEventFn} registerEvent      — зарегистрировать обработчик события
 *
 * @property {SetTicksToDowngradeFn} setTicksToDowngrade — установить время до даунгрейда контроллера
 * @property {SetHitsStructureFn} setHitsStructure       — установить HP структуры
 * @property {DamageHitsStructureFn} damageHitsStructure — нанести урон структуре (вычесть HP)
 * @property {DeleteStructureFn} deleteStructure         — удалить структуру из БД
 * @property {CreateStructureFn} createStructure          — создать структуру через spec (userId по умолч. — первый бот)
 * @property {WorldFindFn} find                          — найти объекты в `rooms.objects` (query c userId/id)
 * @property {WorldFindOneFn} findOne                    — найти один объект
 * @property {WorldFindIdsFn} findIds                    — найти _id объектов
 * @property {WorldFindIdFn} findId                      — найти _id одного объекта
 *
 * @property {WorldReport} report                 — накопленный отчёт
 * @property {ScreepsServer} server               — экземпляр ScreepsServer
 * @property {Object<string,Bot>} bots            — боты по `username`
 * @property {Object<string,RoomStatus>} rooms    — статус комнат по `name`
 *
 * @property {DisposeFn} dispose                  — остановить сервер
 */

/**
 * @callback RunFn
 * @returns {Promise<WorldReport>}
 */

/**
 * @callback TickFn
 * @param {number} [n=1]
 * @returns {Promise<void>}
 */

/**
 * @callback ExecFn
 * @param {string} code
 * @param {string} [username]
 * @returns {Promise<void>}
 */

/**
 * @callback SpawnFn
 * @param {SpawnSpecInput} spec
 * @returns {Promise<string>}     _id созданного крипа
 */

/**
 * @callback EventLogFn
 * @param {string} room                            — имя комнаты (обязательно)
 * @returns {Promise<EventLogEntry[]>}
 */

/**
 * @callback ReadMemoryFn
 * @param {string} [username]                      — если не указан при multi-bot — ошибка
 * @returns {Promise<Object>}
 */

/**
 * @callback WriteMemoryFn
 * @param {string} [username]
 * @param {Object} patch
 * @returns {Promise<void>}
 */

/**
 * @callback RegisterEventFn
 * @param {string} action
 * @param {Function} handler                       — async (server, room, params) => void
 * @returns {void}
 */

/**
 * @callback SetTicksToDowngradeFn
 * @param {string} roomName
 * @param {number|null} ticks — число тиков (>=0) или null для сброса
 * @returns {Promise<void>}
 */

/**
 * @callback SetHitsStructureFn
 * @param {string|Object} idOrObject — _id строкой или объект с полем _id/id
 * @param {number} hits — новое значение hits (>=0, clamp по hitsMax)
 * @returns {Promise<void>}
 */

/**
 * @callback DamageHitsStructureFn
 * @param {string|Object} idOrObject
 * @param {number} amount — количество урона (>=0)
 * @returns {Promise<void>}
 */

/**
 * @callback DeleteStructureFn
 * @param {string|Object} idOrObject
 * @returns {Promise<void>}
 */

/**
 * @callback CreateStructureFn
 * @param {import('./types').StructureSpec} spec — spec-объект структуры (type, x, y, roomName обязательны)
 * @returns {Promise<string>} _id созданной структуры
 */

/**
 * @callback WorldFindFn
 * @param {Object} query — фильтр (room, type, userId — мапится в user, id — в _id)
 * @param {Object} [opts]
 * @returns {Promise<Object[]>} документы с полем id (alias _id)
 */

/**
 * @callback WorldFindOneFn
 * @param {Object} query
 * @param {Object} [opts]
 * @param {number} [opts.index] — N-й объект (по порядку вставки)
 * @returns {Promise<Object|null>}
 */

/**
 * @callback WorldFindIdsFn
 * @param {Object} query
 * @returns {Promise<string[]>} массив _id
 */

/**
 * @callback WorldFindIdFn
 * @param {Object} query
 * @param {Object} [opts]
 * @param {number} [opts.index]
 * @returns {Promise<string|null>}
 */

/**
 * @callback DisposeFn
 * @returns {Promise<void>}
 */

/**
 * Спецификация крипа для `world.spawn()`. В multi-room моде все
 * параметры, зависящие от контекста, должны быть переданы явно.
 *
 * @typedef {Object} SpawnSpecInput
 * @property {string} roomName                     — целевая комната (обязательно)
 * @property {number} x
 * @property {number} y
 * @property {string} [userId]                     — _id бота-владельца или '2' (Invader); по умолч. первый бот
 * @property {string} [name]
 * @property {BodyPart[]} [body]
 */

// ─── Runtime ───────────────────────────────────────────────────────────────

/**
 * Опции `createRuntime`.
 *
 * @typedef {Object} RuntimeOpts
 * @property {string[]} rooms                                     — имена комнат (минимум 1)
 * @property {BotSpec[]} [bots=[]]                                — боты (per-bot settings резолвятся внутри)
 * @property {string} distDir                                     — путь к dist/
 * @property {boolean} [profiling=false]                           — глобальный fallback для per-bot profiling
 * @property {number} [ticks=100]                                 — лимит тиков (передаётся в createWorld для run-loop)
 * @property {string} [cacheDir]                                  — путь к кэшу mockup
 * @property {number} [port]                                      — порт storage (если не задан — выбирается свободный)
 */

/**
 * Результат `createRuntime`.
 *
 * @typedef {Object} RuntimeResult
 * @property {ScreepsServer} server
 * @property {Object<string,Bot>} bots                            — боты по username
 * @property {Object<string,ResolvedBotSpec>} resolvedBots        — боты с effective настройками
 * @property {DisposeFn} dispose
 */

/**
 * Опции `prepareServer` (только сервер + комнаты + terrain).
 *
 * @typedef {Object} PrepareServerOpts
 * @property {string[]} rooms                          — имена комнат (минимум 1)
 * @property {string} [cacheDir]                       — путь к кэшу mockup
 * @property {number} [port]                           — порт storage (если не задан — выбирается свободный)
 */

/**
 * Результат `prepareServer`.
 *
 * @typedef {Object} PreparedServer
 * @property {ScreepsServer} server
 * @property {DisposeFn} dispose
 */

/**
 * Опции `addBots` (вызывается после `prepareServer`).
 *
 * @typedef {Object} AddBotsOpts
 * @property {ScreepsServer} server                    — из `prepareServer`
 * @property {BotSpec[]} bots                          — боты для addBot
 * @property {string} distDir                          — путь к dist/
 * @property {boolean} [profiling]                    — глобальный fallback
 */

/**
 * Результат `addBots`.
 *
 * @typedef {Object} AddedBots
 * @property {Object<string,Bot>} bots                 — боты по username
 * @property {Object<string,ResolvedBotSpec>} resolvedBots
 */

/**
 * Опции `loadBotModules`.
 *
 * @typedef {Object} LoadBotOpts
 * @property {boolean} [profiling=false]   — инжектить обёртку screeps-profiler в main.js
 */

// ─── Cleanup ──────────────────────────────────────────────────────────────

/**
 * Опции `pruneCache`.
 * @typedef {Object} PruneCacheOpts
 * @property {number} [keep=5]            — сколько директорий кэша оставить
 * @property {string} [cacheDir]           — путь к `.cache/`
 */

/**
 * @typedef {Object} PruneCacheResult
 * @property {number} removed
 * @property {number} kept
 * @property {string[]} errors
 */

// ─── Worker ───────────────────────────────────────────────────────────────

/**
 * Результат прогона сценария (выход из worker).
 * @typedef {Object} ScenarioOutput
 * @property {boolean} [skipped]
 * @property {Object<string,string|null>} [profileText]     — per-bot profiler output
 * @property {Object<string,Object>} [profileCallgrind]     — per-bot callgrind data
 * @property {number} [ticksRun]
 * @property {Object<string,Object>} [finalMemory]          — per-bot map: { username: Memory }
 * @property {Object<string,number>} [finalRcl]
 * @property {string[]} [errors]
 * @property {string[]} [warnings]
 */

/**
 * Сообщение, которое worker передаёт через `process.send`.
 *
 * @typedef {Object} WorkerMessage
 * @property {'pass'|'skip'|'fail'|'timeout'} status
 * @property {ScenarioOutput} [result]
 * @property {string} [error]
 */

// ─── CLI ──────────────────────────────────────────────────────────────────

/**
 * CLI-аргументы `bin/screeps-integration-tests.js`.
 *
 * @typedef {Object} CliOpts
 * @property {string|null} only       — имя одного сценария
 * @property {boolean} profiling      — включить профилирование
 * @property {boolean} bail           — остановка при первом падении
 * @property {number} timeout         — тайм-аут на сценарий (ms)
 * @property {number} jobs            — максимальное число параллельных сценариев
 */

/**
 * Запись в сводке результатов.
 * @typedef {Object} SummaryEntry
 * @property {string} name
 * @property {'pass'|'skip'|'fail'|'timeout'} status
 * @property {string} [error]
 * @property {number} [time]
 */

module.exports = {};
