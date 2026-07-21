'use strict';

/**
 * @file Adapter over screeps-server-mockup: single access point for DB, env,
 * pubsub, and world API.
 *
 * Responsibility:
 *   Encapsulates all direct accesses to `server.common.storage.{db,env,pubsub}`
 *   and `server.world.*`. The adapter passes db, env, and pubsub through as-is
 *   (passthrough), without changing their API — consumers continue to use
 *   `adapter.db['collection'].method()`. This is an intentional simplification:
 *   the goal is centralising the entry point, not a redesign.
 *
 * **Available methods:**
 * - `db` — passthrough to `server.common.storage.db` (LokiJS collections)
 * - `env` — passthrough to `server.common.storage.env` (key-value storage)
 * - `pubsub` — passthrough to `server.common.storage.pubsub`
 * - `world.reset()` — reset the server world
 * - `world.addRoom(name)` — create a room
 * - `world.getTerrain(name)` — get room terrain
 * - `world.setTerrain(name, terrain)` — set room terrain
 * - `world.genRandomBadge()` — generate a random badge
 * - `getProcesses()` — list server child processes (for dispose)
 * - `_server` — raw ScreepsServer (for `world.server` and lifecycle)
 *
 * @module storageAdapter
 */

/**
 * @typedef {import('./types').ScreepsServer} ScreepsServer
 *
 * @typedef {Object} StorageAdapter
 * @property {Object} db — passthrough to server.common.storage.db
 * @property {Object} env — passthrough to server.common.storage.env
 * @property {Object} pubsub — passthrough to server.common.storage.pubsub
 * @property {WorldFacade} world
 * @property {() => import('child_process').ChildProcess[]} getProcesses
 * @property {ScreepsServer} _server — raw ScreepsServer
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
 * Creates a storage adapter around a ScreepsServer instance.
 *
 * @param {ScreepsServer} server
 * @returns {StorageAdapter}
 */
function createStorageAdapter(server) {
    const { db, env, pubsub } = server.common.storage;

    // db, env, pubsub are passed through as-is (passthrough),
    // to avoid breaking the established db['collection'].method() pattern.
    // The adapter encapsulates server.common.storage.* without changing its API.

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
