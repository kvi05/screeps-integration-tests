'use strict';

/**
 * Centralised types for integration tests.
 *
 * All @typedefs are placed here for consistency and reuse.
 * Other files reference them via `import('./types').TypeName`.
 *
 * Type architecture follows the model:
 * - **Multi-room:** one world = N rooms, iterated via `opts.rooms`
 * - **Multi-bot:** one world = M users, accessible via `world.bots`
 * - **Spec-only:** world objects are described via `spec.*` constructors,
 *   which do not write to the DB directly
 * - **Materialize — single writer:** `materialize*` functions convert
 *   specs into actual DB documents
 *
 * @module types
 */

// ─── Server ─────────────────────────────────────────────────────────────────

/**
 * ScreepsServer from @cool-andre/screeps-server-mockup.
 * @typedef {import('@cool-andre/screeps-server-mockup').ScreepsServer} ScreepsServer
 */

/**
 * StorageAdapter — facade for accessing DB, env, pubsub, and world API.
 * @typedef {import('./runtime/storageAdapter').StorageAdapter} StorageAdapter
 */

/**
 * Bot returned by `server.world.addBot()`. Corresponds to a User in the mockup DB.
 * @typedef {Object} Bot
 * @property {string} id          — _id of the user in DB (in spec — `userId`, in DB — `user`)
 * @property {string} username
 * @property {string} room        — room name the bot is attached to on creation
 * @property {Object} [memory]    — get/set bot memory
 * @property {Function} [console] — execute JS code in the bot's context
 * @property {Function} on        — event subscription (console, ...)
 */

// ─── Body part ──────────────────────────────────────────────────────────────

/**
 * A creep body part.
 * @typedef {Object} BodyPart
 * @property {'move'|'work'|'carry'|'attack'|'rangedAttack'|'heal'|'claim'|'tough'|'fatigue'} type
 * @property {number} hits — body part health (usually 100, 150 for boosted)
 */

/**
 * Structure type in the mockup DB.
 * @typedef {'spawn'|'tower'|'extension'|'container'|'storage'|'road'|'constructedWall'|'rampart'|'link'|'terminal'|'observer'|'powerSpawn'|'extractor'|'lab'|'nuker'|'factory'|'invaderCore'|'powerBank'|'portal'|'keeperLair'} StructureType
 */

// ─── Canonical spec types ──────────────────────────────────────────────────

/**
 * Canonical structure specification. Minimum required fields:
 * `type`, `x`, `y`. Others are filled with defaults based on type.
 *
 * `roomName` is usually set via `buildCanonicalRoom` at the orchestration
 * stage — not required to set in spec constructors.
 *
 * `userId` is needed for owner-dependent structures (spawn / tower / extension /
 * storage). If not set, the object will have no owner.
 *
 * `id` — explicit _id, used for matching against memory fixtures.
 * Used as-is (see ID policy in `builders/materialize.js`).
 *
 * @typedef {Object} StructureSpec
 * @property {StructureType} type
 * @property {number} x
 * @property {number} y
 * @property {string} [roomName]           — room name (set automatically)
 * @property {string} [userId]              — owner _id (bot.id); if unset — neutral
 * @property {string} [id]                  — explicit _id (for memory fixtures)
 * @property {string} [name]                — name (for spawn)
 * @property {Object} [store]               — { energy: N } (defaults by type)
 * @property {number} [storeCapacity]       — total capacity (defaults by type, used for all structures with store)
 * @property {Object} [storeCapacityResource] — { energy: N } (only for spawn/tower/extension/link)
 * @property {number} [hits]
 * @property {number} [hitsMax]
 * @property {boolean} [notifyWhenAttacked]
 * @property {number} [nextDecayTime]       — ticks until next decay (road/container/rampart only)
 * @property {Object} [overrides]           — arbitrary fields to merge into the DB document
 */

/**
 * Canonical source specification.
 * @typedef {Object} SourceSpecCanonical
 * @property {number} x
 * @property {number} y
 * @property {string} [roomName]        — room name (set automatically)
 * @property {number} [energy=3000]
 * @property {number} [energyCapacity=3000]
 * @property {number} [ticksToRegeneration=0]
 * @property {string} [id]              — explicit _id (for memory fixtures)
 */

/**
 * Canonical controller specification.
 *
 * Created via `spec.controller({...})`. Inserted into the DB by
 * `materializeController()` as part of the general materializeRoom phase.
 *
 * Controller is not a special case: it is materialised through the same
 * pipeline as spawn, tower, and source. If controller is not in the spec,
 * the room simply has no controller (suited for reserve rooms without a bot).
 *
 * `x`/`y` default to (35, 35) — centre of the map. `id` is set explicitly
 * for compatibility with memory fixtures. `userId` — controller owner;
 * if unset, `defaultBotUserId` is assigned in buildCanonicalRoom.
 *
 * @typedef {Object} ControllerSpec
 * @property {string} [roomName]           — room name (set automatically)
 * @property {number} [x=35]
 * @property {number} [y=35]
 * @property {string} [id]                 — explicit _id (for memory fixtures)
 * @property {number} [level=1]
 * @property {number} [progress=0]
 * @property {string} [userId]              — owner _id (reservation)
 * @property {number|null} [downgradeTime=null]
 * @property {number} [safeMode=0]
 * @property {number} [safeModeAvailable=0]
 * @property {boolean} [isPowerEnabled=false]
 */

/**
 * Canonical creep specification. `userId` is the bot `_id`
 * or the literal `'2'` for Invader. If unset, it is filled
 * by defaultBotUserId in buildCanonicalRoom.
 *
 * @typedef {Object} CreepSpecCanonical
 * @property {number} x
 * @property {number} y
 * @property {string} [roomName]            — room name (set automatically)
 * @property {string} [userId]              — user _id or '2' (Invader)
 * @property {string} [name]                — unique name (auto-generated if not set)
 * @property {BodyPart[]} [body]            — defaults to 3 WORK + 3 MOVE
 * @property {number} [hits]                — auto-sum of body if not set
 * @property {number} [hitsMax]
 * @property {Object} [store]               — { energy: N } (e.g. { energy: 50 } for 1×CARRY)
 * @property {number} [storeCapacity]       — total carry capacity (CARRY parts × 50)
 * @property {Object} [storeCapacityResource] — per-resource capacity limit, { energy: N }
 * @property {string} [id]                  — explicit _id (for memory fixtures)
 */

/**
 * Terrain specification for a room.
 *
 * Supported formats (auto-detected by type):
 * - **Positional** — `{ walls: [{x,y}, ...], swamps: [{x,y}, ...] }`
 * - **Matrix** — `number[][]` 50×50 (0=plain, 1=WALL, 2=SWAMP)
 * - **Callback** — `(terrainMatrix) => void` — full access to TerrainMatrix API
 *
 * Applied via `applyTerrainSpec(terrainMatrix, terrainSpec)`.
 *
 * @typedef {Object|number[][]|Function} TerrainSpec
 */

/**
 * Canonical room specification — assembled after applyRoomOverrides
 * (or directly if no fixture). Used by the materialize layer.
 *
 * @typedef {Object} RoomSpecCanonical
 * @property {string} name                   — room name ('W0N1')
 * @property {ControllerSpec} [controller]
 * @property {SourceSpecCanonical[]} [sources=[]]
 * @property {StructureSpec[]} [structures=[]]
 * @property {CreepSpecCanonical[]} [creeps=[]]
 * @property {CreepSpecCanonical[]} [hostiles=[]]
 * @property {TerrainSpec} [terrain]          — custom terrain (walls, swamps, plains)
 */

// ─── Room fixture ──────────────────────────────────────────────────────────

/**
 * Semantic room description as a reusable fixture.
 *
 * Registered in `lib/fixtures/roomFixture.js`. Used via
 * `createWorld({ rooms: [{ name, roomFixture: '<name>' }] })`.
 *
 * @typedef {Object} RoomFixtureSpec
 * @property {string} name                  — unique fixture name ('rcl3-stable')
 * @property {string} [description]
 * @property {ControllerSpec} [controller]
 * @property {SourceSpecCanonical[]} [sources]
 * @property {StructureSpec[]} [structures]
 * @property {CreepSpecCanonical[]} [creeps]
 * @property {TerrainSpec} [terrain]          — custom terrain (walls, swamps, plains)
 */

/**
 * Overrides for a room fixture. Allows modifying a fixture locally without
 * full duplication.
 *
 * @typedef {Object} RoomOverrides
 * @property {Array<string|{id?:string,type?:string}>} [exclude]
 *           — remove objects by id / type
 * @property {StructureSpec[]} [structures]
 *           — override fields of existing structures (by id or by type+x+y)
 * @property {Partial<ControllerSpec>} [controller]
 *           — override controller (field merge)
 * @property {StructureSpec[]} [append]
 *           — add new structures
 * @property {CreepSpecCanonical[]} [creeps]
 *           — add a creep for the bot
 * @property {CreepSpecCanonical[]} [hostiles]
 *           — add hostile creeps
 * @property {TerrainSpec} [terrain]
 *           — replace fixture terrain (walls, swamps, plains)
 */

/**
 * @typedef {Object} MemoryFixtureRef
 * @property {string} fixture              — memory fixture name (`*.memory.json` without suffix)
 */

/**
 * Source of initial bot memory.
 *
 * Supported forms:
 * - string with fixture name;
 * - `{ fixture: '<name>', ...overrides }` — loads fixture + merges extra keys;
 * - inline object Memory.
 *
 * **Reserved key:** `fixture` is a framework-level key and is **not** passed
 * through to bot Memory — it is consumed to locate the `*.memory.json` file.
 * If your bot stores data under `Memory.fixture`, inject it via `memoryOverrides`.
 *
 * @typedef {string|MemoryFixtureRef|Object<string,*>} MemoryInput
 */

/**
 * Per-bot map of initial memory / override patches.
 * The key is always `bot.username`.
 *
 * @typedef {Object<string,MemoryInput|Object<string,*>>} MemoryByBot
 */

/**
 * Bot description for createWorld.
 *
 * A bot can claim one or more rooms. The bot will own all structures,
 * controller, sources and creeps in those rooms that don't have an
 * explicit `userId` set on them. If multiple bots claim the same room,
 * the first bot in `opts.bots` order wins.
 *
 * Rooms not claimed by any bot fall back to the first bot's userId
 * (backward compatible with single-bot scenarios).
 *
 * @typedef {Object} BotSpec
 * @property {string} username              — unique bot name (key in `world.bots`)
 * @property {string|string[]} rooms        — room(s) where the bot appears and owns objects
 * @property {number} [x=25]
 * @property {number} [y=25]
 * @property {Object} [modules]             — custom modules (default = from dist/)
 * @property {'all'|'error'|'warn'} [logLevel]  — override global logLevel for this bot
 * @property {boolean} [profiling]              — override global profiling for this bot
 */

/**
 * Bot with resolved (effective) settings. Returned by `createRuntime`.
 *
 * @typedef {Object} ResolvedBotSpec
 * @property {string} username
 * @property {string|string[]} rooms
 * @property {number} [x]
 * @property {number} [y]
 * @property {Object} [modules]
 * @property {'all'|'error'|'warn'} [logLevel]
 * @property {boolean} effectiveProfiling   — final profiling value (per-bot > global > default)
 */

/**
 * Room specification in `createWorld({ rooms: [...] })`.
 *
 * Can be either inline (via `controller`/`sources`/`structures`/`creeps`/`hostiles`),
 * or reference a prebuilt fixture via `roomFixture: '<name>'` or `roomFixture: {...}`.
 *
 * @typedef {Object} RoomSpecInput
 * @property {string} name                  — room name
 *
 * @property {string|Object} [roomFixture]  — registered fixture name or inline object
 *
 * @property {RoomOverrides} [roomOverrides]
 *           — modifications on top of the fixture (exclude / structures / append / creeps / hostiles / controller / terrain)
 *
 * @property {ControllerSpec} [controller]  — (if no fixture) inline controller
 * @property {SourceSpecCanonical[]} [sources]  — (if no fixture) sources
 * @property {StructureSpec[]} [structures]     — (if no fixture) structures
 * @property {CreepSpecCanonical[]} [creeps]     — (if no fixture) bot creeps
 * @property {CreepSpecCanonical[]} [hostiles]   — (if no fixture) hostile creeps
 * @property {TerrainSpec} [terrain]             — custom terrain (walls, swamps, plains)
 */

/**
 * Options for `createWorld`.
 *
 * @typedef {Object} WorldOpts
 * @property {RoomSpecInput[]} rooms                                — required, at least 1
 * @property {BotSpec[]} [bots=[]]                                 — bots (empty = botless scenario)
 * @property {MemoryInput|MemoryByBot} [memory]                    — initial Memory: shorthand for single-bot or explicit map by username.
 *                                                                   **Important:** the `fixture` key is reserved (see {@link MemoryInput}).
 *                                                                   Missing fixtures are validated early — before the server starts.
 * @property {Object<string,*>|MemoryByBot} [memoryOverrides]      — deep-merge patches on top of `memory`; without base memory, they become the initial memory themselves
 *
 * @property {number} [ticks=100]                                  — tick limit (unless `until.maxTicks` is set)
 * @property {boolean} [profiling=false]                           — enable profiling (screeps-profiler + callgrind)
 *
 * @property {'all'|'error'|'warn'} [logLevel='all']             — log threshold for world.report.logs
 * @property {number} [maxConsoleLines=10000]
 * @property {MetricsOpts} [metrics]                               — metrics collection settings
 *
 * @property {UntilOpts} [until]                                   — early termination condition
 * @property {OnTickCallback} [onTick]                             — callback on each tick
 * @property {EventSpec[]} [events]                                 — declarative spawns by tick
 * @property {boolean} [viewer=false]                   — enable browser viewer. When `true`,
 *   the worker attaches a tick interceptor for live streaming.
 * @property {ViewerOptions} [viewerOptions]            — fine-tuning for viewer behaviour
 *   (paused, speed, keyframeInterval, replayBuffer). The CLI passes
 *   `config.viewerOptions` through to the worker; missing keys fall back to
 *   their defaults at the interceptor creation site.
 * @property {TickInterceptor} [tickInterceptor]                   — optional tick lifecycle hook.
 *   Injected by tooling (viewer, profiler, debugger). Core never knows what the hook does.
 */

/**
 * Tick lifecycle interceptor — extension point for tools (viewer, profiler, debugger).
 *
 * Injected via `WorldOpts.tickInterceptor`. `createWorld` calls the hooks at the
 * appropriate points in the tick loop, without knowing what the interceptor does.
 * The interceptor is self-contained and owns its own state.
 *
 * @typedef {Object} TickInterceptor
 * @property {(ctx: TickHookContext) => Promise<boolean|void>} beforeTick
 *           — called at the start of each tick, before any observations.
 *             Return `true` to request early stop of the tick loop.
 * @property {(ctx: TickHookContext) => Promise<void>} afterTick
 *           — called after observations + events + onTick, before predicate check.
 * @property {() => number} getTickDelay
 *           — returns delay in ms to wait AFTER the tick (0 = no delay, >0 = throttle).
 */

/**
 * Context passed to {@link TickInterceptor} hooks.
 *
 * @typedef {Object} TickHookContext
 * @property {number} tickNum
 * @property {StorageAdapter} adapter
 * @property {WorldReport} report
 * @property {Object<string, RoomStatus>} roomStatus
 * @property {Object<string, Bot>} bots
 * @property {ScreepsServer} server
 */

/**
 * Viewer fine-tuning options.
 *
 * Mirrors `config.viewerOptions` — users set these in
 * `screeps-integration.config.js` once and the CLI passes them through.
 *
 * @typedef {Object} ViewerOptions
 * @property {boolean} [paused=false]         — start the tick loop paused
 * @property {number} [speed=1000]            — ticks per second (1000 = realtime, higher = faster)
 * @property {number} [keyframeInterval=100]  — send full Memory snapshot every N ticks
 * @property {number} [replayBuffer=3000]     — max frames/ticks retained in client + server ring buffers
 */

// ─── Viewer data types ──────────────────────────────────────────────────────

/**
 * A single object in a viewer frame snapshot.
 * Mirrors the dojo-compatible format used by the SSE transport and canvas renderer.
 *
 * @typedef {Object} FrameObject
 * @property {string} _id
 * @property {string} type       — 'creep', 'spawn', 'source', etc.
 * @property {number} x
 * @property {number} y
 * @property {string} room
 * @property {string} [user]
 * @property {number} [hits]
 * @property {number} [hitsMax]
 * @property {Object<string,number>} [store]
 * @property {number} [storeCapacity]
 * @property {Object<string,number>} [storeCapacityResource]
 * @property {Array<{type:string,hits:number}>} [body]
 * @property {string} [name]
 * @property {number} [level]
 * @property {number} [progress]
 * @property {number} [progressTotal]
 * @property {number} [energy]
 * @property {number} [energyCapacity]
 * @property {Object} [actionLog]
 * @property {Object} [spawning]
 * @property {boolean} [spawning] // simple boolean variant
 * @property {number} [ticksToSpawn]
 * @property {number} [amount]
 * @property {string} [resourceType]
 * @property {number} [downgradeTime]
 * @property {number} [safeMode]
 * @property {number} [ageTime]
 * @property {number} [decayTime]
 * @property {boolean} [isPowerEnabled]
 */

/**
 * A single tick snapshot for the viewer.
 *
 * @typedef {Object} Frame
 * @property {number} gameTime
 * @property {FrameObject[]} objects
 * @property {Object<string,string[]>} [terrain]  — roomName → terrain rows
 * @property {Array<{level:string, message:string, bot:string}>} [console] — structured console entries for this tick
 */

/**
 * Run termination condition. The test stops if:
 * - `ticksRun >= maxTicks`, OR
 * - `predicate` returned `true`, OR
 * - `Memory[until.signal]` became truthy (for the specified bot or all bots).
 *
 * @typedef {Object} UntilOpts
 * @property {number} [maxTicks]
 * @property {PredicateFn} [predicate]   — async (world) => boolean
 * @property {string} [signal]           — field name in bot Memory
 * @property {string} [signalBot]        — bot name to check signal (if unset — all bots)
 */

/**
 * Predicate for stopping the test.
 * @callback PredicateFn
 * @param {WorldInstance} w
 * @returns {boolean|Promise<boolean>}
 */

/**
 * Callback on each tick. Fires after `server.tick()`,
 * event log / metrics collection, before the predicate check.
 *
 * @callback OnTickCallback
 * @param {WorldInstance} w
 * @param {number} tick                   — tick number (0-based)
 * @returns {void|Promise<void>}
 */

/**
 * Declarative event by tick. `atTick` is 0-based.
 *
 * @typedef {Object} EventSpec
 * @property {number} atTick
 * @property {string} action              — action name ('spawnInvader', ...)
 * @property {string} room                — target room name (passed to handler)
 * @property {Object} [params]             — action parameters
 */

// ─── World Report ──────────────────────────────────────────────────────────

/**
 * Status of a single room in `world.rooms`.
 *
 * @typedef {Object} RoomStatus
 * @property {string} name
 * @property {RoomSpecCanonical} canonical  — final spec the room was materialised from
 * @property {{sourceIds:string[],structureIds:string[],creepIds:string[]}} ids  — _ids in DB
 * @property {number} ticks                 — number of ticks processed in this room
 * @property {number} events                — number of events accumulated from this room
 */

/**
 * Final run report.
 *
 * @typedef {Object} WorldReport
 * @property {number} ticksRun                          — total number of ticks
 *
 * @property {Object<string,number>} finalRcl           — RCL per room: { W0N1: 3, W0N2: 1 }
 *
 * @property {string[]} errors                          — bot console errors ('[ERROR]')
 * @property {string[]} warnings                        — warnings ('[WARN]')
 * @property {string[]} logs                            — other logs (if `logLevel: 'all'`)
 *
 * @property {Object<string,Object>} finalMemory        — memory per bot by username
 * @property {Object<string,string|null>} profileText   — screeps-profiler text per bot
 * @property {Object<string,Object>} profileCallgrind   — callgrind data per bot
 *
 * @property {number} wallClockMs                       — total run time (ms)
 *
 * @property {EventLogEntry[]} events                   — accumulated event log (across all rooms)
 * @property {MetricsReport} metrics                    — time-series metrics by entity
 * @property {Object<string,string>} objectOwners       — _id → user (owner)
 *
 * @property {string[]} frameworkWarnings               — technical framework warnings (not bot errors)
 *
 * @property {Array<{level:string, message:string, bot:string, tick:number}>} [_consoleEntries]
 *           — @internal structured console entries for viewer snapshots
 *
 * @property {string|null} stopReason                   — stop reason (predicate / signal / maxTicks)
 */

/**
 * Entry in the accumulated event log.
 * @typedef {Object} EventLogEntry
 * @property {number} tick                    — tick number
 * @property {number} event                   — event type (EVENT_ATTACK=1, EVENT_OBJECT_DESTROYED=2, ...)
 * @property {string} objectId                — _id of the initiating object
 * @property {Object} data                    — depends on type (targetId, damage, type, ...)
 */

/**
 * Filter for destroyed-object assertions.
 * @typedef {Object} DestroyedFilter
 * @property {string|string[]} [types]     — object type(s) (STRUCTURE_* or TYPE_CREEPS)
 * @property {string} [id]                 — specific _id
 */

/**
 * Entity type for time-series metrics.
 * @typedef {'rooms'|'colonies'|'bots'|'world'} MetricEntityType
 */

/**
 * Entity metrics sample. Always contains `tick`.
 *
 * @typedef {Object} MetricsSample
 * @property {number} tick
 * @property {Object<string,*>} [values]     — arbitrary JSON-compatible values
 */

/**
 * Room metrics without the `tick` field (added by the recorder).
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
 * @property {number} constructionSiteCount
 * @property {number} constructionSiteTotalLeftProgress
 * @property {number} totalEnergy — energy in all non-creep objects with a `store` (incl. tombstones, ruins)
 * @property {number} totalHits
 */

/**
 * @typedef {Object} SpawnHitInfo
 * @property {string} name
 * @property {number} hits
 * @property {number} hitsMax
 */

/**
 * Bot metrics without the `tick` field (added by the recorder).
 *
 * Collected from the `users` collection, which the engine updates after
 * every tick: `lastUsedCpu` (CPU used in the last tick), `cpuAvailable`
 * (CPU bucket) and `cpu` (CPU limit).
 *
 * @typedef {Object} BotMetrics
 * @property {number} cpuUsage       — CPU used by the bot in the last tick
 * @property {number} bucket         — CPU bucket (available CPU)
 * @property {number} cpuLimit       — CPU limit per tick
 */

/**
 * Time-series of one entity.
 * @typedef {MetricsSample[]} MetricSeries
 */

/**
 * Map of entities of one type: entityId → series.
 * @typedef {Object<string, MetricSeries>} MetricEntityMap
 */

/**
 * Data structure of a `MetricsReport` instance (see lib/metricsReport.js).
 *
 * Class getters mirror this structure. Used for JSDoc references
 * (e.g., `@property {MetricsReport} metrics` in WorldReport).
 *
 * @typedef {Object} MetricsReport
 * @property {MetricEntityMap} rooms     — time-series by room
 * @property {MetricEntityMap} colonies  — time-series by colony
 * @property {MetricEntityMap} bots      — time-series by bot
 * @property {MetricSeries} world        — time-series for the world
 */

/**
 * Metrics collection options.
 *
 * @typedef {Object} MetricsOpts
 * @property {number} [every=0]        — sample every N ticks (0 = off)
 * @property {boolean} [rooms=true]    — collect room metrics
 * @property {boolean} [colonies=false] — collect colony metrics (not yet supported)
 * @property {boolean} [bots=false]    — collect bot metrics (default false)
 * @property {boolean} [world=false]   — collect world metrics (not yet supported)
 */

// ─── World Instance ────────────────────────────────────────────────────────

/**
 * World returned by `createWorld()`. All methods that require a specific
 * room or bot context now take an explicit argument.
 *
 * @typedef {Object} WorldInstance
 * @property {RunFn} run                          — main run, returns WorldReport
 * @property {TickFn} tick                        — execute `n` ticks
 * @property {ExecFn} exec                        — execute JS code in a bot
 * @property {EvalInBotFn} evalInBot              — evaluate JS code in a bot and resolve with the result
 * @property {SpawnCreepFn} spawnCreep            — spawn a creep (room required)
 * @property {BotIdFn} botId                      — _id of a bot by username/index/first
 * @property {EventLogFn} getEventLog                — read room event log
 * @property {ReadMemoryFn} readMemory            — read bot Memory (by username)
 * @property {WriteMemoryFn} writeMemory          — update Memory (merge)
 * @property {RegisterEventFn} registerEvent      — register an event handler
 *
 * @property {SetTicksToDowngradeFn} setTicksToDowngrade — set ticks until controller downgrade
 * @property {SetHitsStructureFn} setHitsStructure       — set structure HP
 * @property {DamageHitsStructureFn} damageHitsStructure — damage a structure (subtract HP)
 * @property {DeleteStructureFn} deleteStructure         — delete a structure from DB
 * @property {CreateStructureFn} createStructure          — create a structure via spec (default userId — first bot)
 * @property {WorldFindFn} find                          — find objects in `rooms.objects` (query with userId/id)
 * @property {WorldFindOneFn} findOne                    — find one object
 * @property {WorldFindIdsFn} findIds                    — find _ids of objects
 * @property {WorldFindIdFn} findId                      — find _id of one object
 *
 * @property {WorldReport} report                 — accumulated report
 * @property {ScreepsServer} server               — ScreepsServer instance
 * @property {Object<string,Bot>} bots            — bots by `username`
 * @property {Object<string,RoomStatus>} rooms    — room status by `name`
 *
 * @property {DisposeFn} dispose                  — stop the server
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
 * @throws {BotError} if `username` is provided but no such bot is registered
 */

/**
 * @callback EvalInBotFn
 * @param {string} code
 * @param {string} [username]
 * @returns {Promise<any>}
 * @throws {BotError} if `username` is provided but no such bot is registered
 */

/**
 * @callback SpawnCreepFn
 * @param {CreepSpecCanonical} spec   — complete creep spec (use spec.creep() / spec.invader() / spec.dummyTarget())
 * @returns {Promise<string>}          _id of the created creep
 */

/**
 * @callback EventLogFn
 * @param {string} room                            — room name (required)
 * @returns {Promise<EventLogEntry[]>}
 */

/**
 * @callback ReadMemoryFn
 * @param {string} [username]                      — error if omitted in multi-bot mode
 * @returns {Promise<Object>}
 * @throws {BotError} if `username` is provided but no such bot is registered
 */

/**
 * @callback WriteMemoryFn
 * @param {string} [username]
 * @param {Object} patch
 * @returns {Promise<void>}
 * @throws {BotError} if `username` is provided but no such bot is registered
 */

/**
 * @callback RegisterEventFn
 * @param {string} action
 * @param {(adapter: import('./runtime/storageAdapter').StorageAdapter, room: string, params: Object) => Promise<void>} handler
 * @returns {void}
 */

/**
 * @callback SetTicksToDowngradeFn
 * @param {string} roomName
 * @param {number|null} ticks — number of ticks (>=0) or null to reset
 * @returns {Promise<void>}
 */

/**
 * @callback SetHitsStructureFn
 * @param {string|Object} idOrObject — _id as string or object with _id/id field
 * @param {number} hits — new hits value (>=0, clamped to hitsMax)
 * @returns {Promise<void>}
 */

/**
 * @callback DamageHitsStructureFn
 * @param {string|Object} idOrObject
 * @param {number} amount — damage amount (>=0)
 * @returns {Promise<void>}
 */

/**
 * @callback DeleteStructureFn
 * @param {string|Object} idOrObject
 * @returns {Promise<void>}
 */

/**
 * @callback CreateStructureFn
 * @param {import('./types').StructureSpec} spec — spec structure object (type, x, y, roomName required)
 * @returns {Promise<string>} _id of the created structure
 */

/**
 * @callback WorldFindFn
 * @param {Object} query — filter (room, type, userId — mapped to user, id — to _id)
 * @param {Object} [opts]
 * @returns {Promise<Object[]>} documents with id field (alias _id)
 */

/**
 * @callback WorldFindOneFn
 * @param {Object} query
 * @param {Object} [opts]
 * @param {number} [opts.index] — N-th object (by insertion order)
 * @returns {Promise<Object|null>}
 */

/**
 * @callback WorldFindIdsFn
 * @param {Object} query
 * @returns {Promise<string[]>} array of _ids
 */

/**
 * @callback WorldFindIdFn
 * @param {Object} query
 * @param {Object} [opts]
 * @param {number} [opts.index]
 * @returns {Promise<string|null>}
 */

/**
 * @callback BotIdFn
 * @param {string|number} [bot] — bot username (string) or index (number, 0-based).
 *   If unset — _id of the only bot.
 * @returns {string} _id of the bot
 * @throws {Error} if bot not found
 */

/**
 * @callback DisposeFn
 * @returns {Promise<void>}
 */

// ─── Runtime ───────────────────────────────────────────────────────────────

/**
 * Options for `createRuntime`.
 *
 * @typedef {Object} RuntimeOpts
 * @property {string[]} rooms                                     — room names (at least 1)
 * @property {BotSpec[]} [bots=[]]                                — bots (per-bot settings resolved internally)
 * @property {string} distDir                                     — path to dist/
 * @property {boolean} [profiling=false]                           — global fallback for per-bot profiling
 * @property {number} [ticks=100]                                 — tick limit (passed to createWorld for run-loop)
 * @property {string} [cacheDir]                                  — path to mockup cache
 * @property {number} [port]                                      — storage port (if unset — a free port is chosen)
 */

/**
 * Result of `createRuntime`.
 *
 * @typedef {Object} RuntimeResult
 * @property {ScreepsServer} server
 * @property {Object<string,Bot>} bots                            — bots by username
 * @property {Object<string,ResolvedBotSpec>} resolvedBots        — bots with effective settings
 * @property {DisposeFn} dispose
 */

/**
 * Options for `prepareServer` (server + rooms + terrain only).
 *
 * @typedef {Object} PrepareServerOpts
 * @property {string[]} rooms                          — room names (at least 1)
 * @property {string} [cacheDir]                       — path to mockup cache
 * @property {number} [port]                           — storage port (if unset — a free port is chosen)
 */

/**
 * Result of `prepareServer`.
 *
 * @typedef {Object} PreparedServer
 * @property {ScreepsServer} server
 * @property {StorageAdapter} adapter
 * @property {DisposeFn} dispose
 */

/**
 * Options for `addBots` (called after `prepareServer`).
 *
 * @typedef {Object} AddBotsOpts
 * @property {StorageAdapter} adapter                  — from `prepareServer`
 * @property {BotSpec[]} bots                          — bots to add
 * @property {string} distDir                          — path to dist/
 * @property {boolean} [profiling]                    — global fallback
 */

/**
 * Result of `addBots`.
 *
 * @typedef {Object} AddedBots
 * @property {Object<string,Bot>} bots                 — bots by username
 * @property {Object<string,ResolvedBotSpec>} resolvedBots
 */

/**
 * Options for `loadBotModules`.
 *
 * @typedef {Object} LoadBotOpts
 * @property {boolean} [profiling=false]   — inject screeps-profiler wrapper into main.js
 */

// ─── Cleanup ──────────────────────────────────────────────────────────────

/**
 * Options for `pruneCache`.
 * @typedef {Object} PruneCacheOpts
 * @property {number} [keep=5]            — number of cache directories to keep
 * @property {string} [cacheDir]           — path to `.cache/`
 */

/**
 * @typedef {Object} PruneCacheResult
 * @property {number} removed
 * @property {number} kept
 * @property {string[]} errors
 */

// ─── Worker ───────────────────────────────────────────────────────────────

/**
 * Scenario run result (exit from worker).
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
 * Message sent by the worker via `process.send`.
 *
 * @typedef {Object} WorkerMessage
 * @property {'pass'|'skip'|'fail'|'timeout'} status
 * @property {ScenarioOutput} [result]
 * @property {string} [error]
 */

// ─── CLI ──────────────────────────────────────────────────────────────────

/**
 * CLI arguments for `bin/screeps-integration-tests.js`.
 *
 * @typedef {Object} CliOpts
 * @property {string|null} only       — single scenario name
 * @property {boolean} profiling      — enable profiling
 * @property {boolean} bail           — stop on first failure
 * @property {number} timeout         — per-scenario timeout (ms)
 * @property {number} jobs            — max number of parallel scenarios
 */

/**
 * Entry in the results summary.
 * @typedef {Object} SummaryEntry
 * @property {string} name
 * @property {'pass'|'skip'|'fail'|'timeout'} status
 * @property {string} [error]
 * @property {number} [time]
 */

module.exports = {};
