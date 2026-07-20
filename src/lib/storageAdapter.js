'use strict';

/**
 * @file Адаптер над screeps-server-mockup: единая точка доступа к БД, env,
 * pubsub и world API.
 *
 * Responsibility:
 *   Инкапсулирует все прямые обращения к `server.common.storage.{db,env,pubsub}`
 *   и `server.world.*`. Адаптер передаёт db, env и pubsub «как есть» (прямой
 *   проход), не меняя их API — потребители продолжают использовать
 *   `adapter.db['коллекция'].метод()`. Это осознанное упрощение: цель —
 *   централизация точки входа, а не редизайн.
 *
 * **Available methods:**
 * - `db` — прямой проход к `server.common.storage.db` (LokiJS-коллекции)
 * - `env` — прямой проход к `server.common.storage.env` (key-value storage)
 * - `pubsub` — прямой проход к `server.common.storage.pubsub`
 * - `world.reset()` — сброс мира сервера
 * - `world.addRoom(name)` — создание комнаты
 * - `world.getTerrain(name)` — получение terrain комнаты
 * - `world.setTerrain(name, terrain)` — установка terrain комнаты
 * - `world.genRandomBadge()` — генерация случайного badge
 * - `getProcesses()` — список дочерних процессов сервера (для dispose)
 * - `_server` — сырой ScreepsServer (для `world.server` и lifecycle)
 *
 * @module storageAdapter
 */

/**
 * @typedef {import('./types').ScreepsServer} ScreepsServer
 *
 * @typedef {Object} StorageAdapter
 * @property {Object} db — прямой проход к server.common.storage.db
 * @property {Object} env — прямой проход к server.common.storage.env
 * @property {Object} pubsub — прямой проход к server.common.storage.pubsub
 * @property {WorldFacade} world
 * @property {() => import('child_process').ChildProcess[]} getProcesses
 * @property {ScreepsServer} _server — сырой ScreepsServer
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
 * @property {(key: string, field: string) => Promise<string|null>} hget
 * @property {Object} keys
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

    // db, env, pubsub передаются «как есть» (прямой проход),
    // чтобы не ломать сложившийся паттерн db['коллекция'].метод().
    // Адаптер инкапсулирует server.common.storage.*, а не меняет API.

    return {
        db,
        env,
        pubsub,

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
