'use strict';

const { materializeCreep } = require('../builders');
const { INVADER_USER_ID } = require('../../constants/screepsConstants');

// ─── Defaults ──────────────────────────────────────────────────────────────────

/** @type {number} */
const DEFAULT_INVADER_SPAWN_X = 10;
/** @type {number} */
const DEFAULT_INVADER_SPAWN_Y = 25;

/**
 * @typedef {import('../runtime/storageAdapter').StorageAdapter} StorageAdapter
 */

// ─── Event registry factory ──────────────────────────────────────────────────

/**
 * Creates an event registry — a map of named event actions to async handlers.
 *
 * Returns `{ register, dispatch }` where:
 * - `register(action, handler)` — stores a handler for the given action name
 * - `dispatch(scheduledEvents, tickNum, adapter)` — runs all handlers whose
 *   `atTick` matches the current tick
 *
 * @returns {{ register: (action:string, handler:Function) => void, dispatch: (scheduledEvents:Array<{action:string, atTick:number, room:string, params?:Object}>, tickNum:number, adapter:StorageAdapter) => Promise<void> }}
 */
function createEventRegistry() {
    /** @type {Object<string, Function>} */
    const handlers = {};

    /**
     * Registers an event handler.
     * @param {string} action
     * @param {Function} handler — async (adapter, room, params) => Promise<void>
     */
    function register(action, handler) {
        handlers[action] = handler;
    }

    /**
     * Dispatches events whose `atTick` matches the current tick.
     * @param {Array<{action:string, atTick:number, room:string, params?:Object}>} scheduledEvents
     * @param {number} tickNum
     * @param {StorageAdapter} adapter
     */
    async function dispatch(scheduledEvents, tickNum, adapter) {
        if (!scheduledEvents) return;

        for (const event of scheduledEvents) {
            if (event.atTick === tickNum && handlers[event.action]) {
                await handlers[event.action](adapter, event.room, event.params || {});
            }
        }
    }

    return { register, dispatch };
}

// ─── Default event handlers ─────────────────────────────────────────────────

/**
 * Registers the default built-in event handlers.
 *
 * Currently provides:
 * - `spawnInvader` — creates an invader creep in a room
 * - `spawnCreep` — creates a creep from a full spec
 *
 * @param {{ register: (action:string, handler:Function) => void }} registry
 * @param {StorageAdapter} adapter
 */
function registerDefaultEvents(registry) {
    registry.register('spawnInvader', async (adpt, room, params) => {
        await materializeCreep(adpt, room, {
            x: params.x ?? DEFAULT_INVADER_SPAWN_X,
            y: params.y ?? DEFAULT_INVADER_SPAWN_Y,
            name: params.name || `Invader_${Date.now()}`,
            body: params.body,
            userId: INVADER_USER_ID,
        });
    });

    registry.register('spawnCreep', async (adpt, room, params) => {
        await materializeCreep(adpt, room, params);
    });
}

module.exports = {
    createEventRegistry,
    registerDefaultEvents,
};
