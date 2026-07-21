'use strict';

/**
 * Materialize: converts canonical spec objects into actual DB documents.
 *
 * The layer that knows about DB shape (`rooms.objects`, `users.code`).
 * Neither scenarios nor normalize should access the DB directly.
 *
 * ## ID policy
 *
 * `s.id` if set — used as-is. No automatic scoping by `roomName`.
 * Reason: the main consumer of `_id` is memory fixture, which may come
 * from our capture-flow or a copy from a real server.
 * If we rewrite ids, memory fixture will break.
 *
 * Multi-room scenarios must avoid conflicts on their own
 * (e.g., use different fixtures for different rooms, or
 * generate `_id` via `crypto.randomUUID()` inside spec).
 *
 *
 * ## Mapping spec → DB
 *
 * In all spec types, the owner field is called `userId`.
 * In the mockup DB (`rooms.objects`, `users.code`) it's
 * called `user`. Mapping is done only here.
 *
 * @module builders/materialize
 */

/**
 * @typedef {import('../storageAdapter').StorageAdapter} StorageAdapter
 * @typedef {import('../types').StructureSpec} StructureSpec
 * @typedef {import('../types').SourceSpecCanonical} SourceSpecCanonical
 * @typedef {import('../types').ControllerSpec} ControllerSpec
 * @typedef {import('../types').CreepSpecCanonical} CreepSpecCanonical
 * @typedef {import('../types').RoomSpecCanonical} RoomSpecCanonical
 *
 * @typedef {Object} MaterializeBotCodeOpts
 * @property {'default'|'custom'} [code='default']
 * @property {Object} [modules]          — custom modules (for code='custom')
 * @property {string} [distDir]          — path to dist/ (for code='default')
 */

const { STRUCTURE_SPAWN } = require('../../constants/screepsConstants');

// ─── Materialize structures ─────────────────────────────────────────────────

/**
 * Creates a single structure object in `rooms.objects`.
 *
 * @param {StorageAdapter} adapter
 * @param {string} roomName
 * @param {StructureSpec} s
 * @returns {Promise<string>} _id of created object
 */
async function materializeStructure(adapter, roomName, s) {
    const { db } = adapter;

    const doc = {
        room: roomName,
        type: s.type,
        x: s.x,
        y: s.y,
    };

    // owner-dependent
    if (s.userId) {
        doc.user = s.userId;
    }
    if (s.name) {
        doc.name = s.name;
    }

    // store
    if (s.store) {
        doc.store = s.store;
    }
    if (s.storeCapacityResource) {
        doc.storeCapacityResource = s.storeCapacityResource;
    }

    // HP
    if (s.hits !== undefined) {
        doc.hits = s.hits;
    }
    if (s.hitsMax !== undefined) {
        doc.hitsMax = s.hitsMax;
    }

    // notifyWhenAttacked
    if (s.notifyWhenAttacked !== undefined) {
        doc.notifyWhenAttacked = s.notifyWhenAttacked;
    }

    // spawn-specific
    if (s.type === STRUCTURE_SPAWN) {
        doc.spawning = null;
    }

    // custom _id — taken as-is (see ID policy at top of file)
    if (s.id) {
        doc._id = s.id;
    }

    // arbitrary overrides
    if (s.overrides) {
        Object.assign(doc, s.overrides);
    }

    const result = await db['rooms.objects'].insert(doc);
    return result._id;
}

/**
 * Generic batch materializer — calls `materializeFn` for each item.
 *
 * @param {(adapter: StorageAdapter, roomName: string, item: Object) => Promise<string>} materializeFn
 * @param {StorageAdapter} adapter
 * @param {string} roomName
 * @param {Object[]} items
 * @returns {Promise<string[]>}
 */
async function materializeMany(materializeFn, adapter, roomName, items) {
    const ids = [];
    for (const item of items) {
        const id = await materializeFn(adapter, roomName, item);
        ids.push(id);
    }
    return ids;
}

/**
 * Creates multiple structure objects in `rooms.objects`.
 *
 * @param {StorageAdapter} adapter
 * @param {string} roomName
 * @param {StructureSpec[]} structures
 * @returns {Promise<string[]>} _id of created objects
 */
async function materializeStructures(adapter, roomName, structures) {
    return materializeMany(materializeStructure, adapter, roomName, structures);
}

// ─── Materialize sources ────────────────────────────────────────────────────

/**
 * Creates a source in `rooms.objects`.
 *
 * @param {StorageAdapter} adapter
 * @param {string} roomName
 * @param {SourceSpecCanonical} src
 * @returns {Promise<string>} _id
 */
async function materializeSource(adapter, roomName, src) {
    const { db } = adapter;
    if (src.x === undefined) throw new Error('materializeSource: x is required');
    if (src.y === undefined) throw new Error('materializeSource: y is required');

    const doc = {
        room: roomName,
        type: 'source',
        x: src.x,
        y: src.y,
    };
    if (src.energy !== undefined) doc.energy = src.energy;
    if (src.energyCapacity !== undefined) doc.energyCapacity = src.energyCapacity;
    if (src.ticksToRegeneration !== undefined) doc.ticksToRegeneration = src.ticksToRegeneration;
    if (src.id) {
        doc._id = src.id;
    }
    const result = await db['rooms.objects'].insert(doc);
    return result._id;
}

/**
 * Creates multiple sources.
 *
 * @param {StorageAdapter} adapter
 * @param {string} roomName
 * @param {SourceSpecCanonical[]} sources
 * @returns {Promise<string[]>} _id
 */
async function materializeSources(adapter, roomName, sources) {
    return materializeMany(materializeSource, adapter, roomName, sources);
}

// ─── Materialize controller ─────────────────────────────────────────────────

/**
 * Materializes controller in `rooms.objects`.
 *
 * If controller already exists (e.g., created earlier), updates its
 * fields; otherwise inserts a new document. This is safe for tick-based environment —
 * calling again doesn't duplicate the controller.
 *
 * @param {StorageAdapter} adapter
 * @param {string} roomName
 * @param {ControllerSpec} ctrl
 * @returns {Promise<string>} _id of existing or created controller
 */
/**
 * Inserts a new controller into `rooms.objects`.
 *
 * @param {StorageAdapter} adapter
 * @param {string} roomName
 * @param {ControllerSpec} ctrl
 * @returns {Promise<string>} _id of created controller
 */
async function _insertController(adapter, roomName, ctrl) {
    const { db } = adapter;

    if (ctrl.x === undefined) throw new Error('materializeController: x is required');
    if (ctrl.y === undefined) throw new Error('materializeController: y is required');
    if (ctrl.level === undefined) throw new Error('materializeController: level is required');

    const doc = {
        room: roomName,
        type: 'controller',
        x: ctrl.x,
        y: ctrl.y,
        level: ctrl.level,
    };
    if (ctrl.progress !== undefined) doc.progress = ctrl.progress;
    if (ctrl.downgradeTime !== undefined) doc.downgradeTime = ctrl.downgradeTime;
    if (ctrl.safeMode !== undefined) doc.safeMode = ctrl.safeMode;
    if (ctrl.safeModeAvailable !== undefined) doc.safeModeAvailable = ctrl.safeModeAvailable;
    if (ctrl.isPowerEnabled !== undefined) doc.isPowerEnabled = ctrl.isPowerEnabled;
    if (ctrl.userId !== undefined) doc.user = ctrl.userId;
    if (ctrl.id) doc._id = ctrl.id;

    const result = await db['rooms.objects'].insert(doc);
    return result._id;
}

/**
 * Updates an existing controller in `rooms.objects`.
 * Only sets fields that are explicitly provided in `ctrl`.
 *
 * @param {StorageAdapter} adapter
 * @param {string} roomName
 * @param {ControllerSpec} ctrl
 * @returns {Promise<void>}
 */
async function _updateController(adapter, roomName, ctrl) {
    const { db } = adapter;

    const update = {};
    if (ctrl.x !== undefined) update.x = ctrl.x;
    if (ctrl.y !== undefined) update.y = ctrl.y;
    if (ctrl.level !== undefined) update.level = ctrl.level;
    if (ctrl.progress !== undefined) update.progress = ctrl.progress;
    if (ctrl.userId !== undefined) update.user = ctrl.userId;
    if (ctrl.downgradeTime !== undefined) update.downgradeTime = ctrl.downgradeTime;
    if (ctrl.safeMode !== undefined) update.safeMode = ctrl.safeMode;
    if (ctrl.safeModeAvailable !== undefined) update.safeModeAvailable = ctrl.safeModeAvailable;
    if (ctrl.isPowerEnabled !== undefined) update.isPowerEnabled = ctrl.isPowerEnabled;

    if (Object.keys(update).length > 0) {
        await db['rooms.objects'].update({ room: roomName, type: 'controller' }, { $set: update });
    }
}

/**
 * Materializes controller in `rooms.objects`.
 *
 * If controller already exists (e.g., created earlier), updates its
 * fields; otherwise inserts a new document. This is safe for tick-based environment —
 * calling again doesn't duplicate the controller.
 *
 * @param {StorageAdapter} adapter
 * @param {string} roomName
 * @param {ControllerSpec} ctrl
 * @returns {Promise<string>} _id of existing or created controller
 */
async function materializeController(adapter, roomName, ctrl) {
    const { db } = adapter;
    const existing = await db['rooms.objects'].findOne({ room: roomName, type: 'controller' });

    if (!existing) {
        return _insertController(adapter, roomName, ctrl);
    }

    await _updateController(adapter, roomName, ctrl);
    return existing._id;
}

// ─── Materialize creeps ─────────────────────────────────────────────────────

/**
 * Creates a creep in `rooms.objects`.
 *
 * @param {StorageAdapter} adapter
 * @param {string} roomName
 * @param {CreepSpecCanonical} c
 * @returns {Promise<string>} _id
 */
async function materializeCreep(adapter, roomName, c) {
    const { db } = adapter;
    const crypto = require('crypto');

    if (!c.body || !Array.isArray(c.body) || c.body.length === 0) {
        throw new Error(
            `materializeCreep: spec.body is required — array of BodyPart (got: ${JSON.stringify(c.body)}). ` +
                'Use spec.creep() / spec.invader() or pass body explicitly.',
        );
    }

    const body = c.body;
    const hits = c.hits || body.reduce((sum, p) => sum + p.hits, 0);

    const doc = {
        room: roomName,
        type: 'creep',
        x: c.x,
        y: c.y,
        user: c.userId,
        name: c.name || `Creep_${crypto.randomUUID()}`,
        body,
        hits,
        hitsMax: c.hitsMax || hits,
        spawning: null,
        fatigue: 0,
        notifyWhenAttacked: true,
    };
    if (c.id) {
        doc._id = c.id;
    }

    const result = await db['rooms.objects'].insert(doc);
    return result._id;
}

/**
 * Creates multiple creeps.
 *
 * @param {StorageAdapter} adapter
 * @param {string} roomName
 * @param {CreepSpecCanonical[]} creeps
 * @returns {Promise<string[]>} _id
 */
async function materializeCreeps(adapter, roomName, creeps) {
    return materializeMany(materializeCreep, adapter, roomName, creeps);
}

// ─── Materialize bot code ───────────────────────────────────────────────────

/**
 * Loads bot code into `users.code`.
 *
 * @param {import('../storageAdapter').StorageAdapter} adapter
 * @param {string} userId                            — bot _id
 * @param {MaterializeBotCodeOpts} [opts]
 * @returns {Promise<void>}
 */
async function materializeBotCode(adapter, userId, opts = {}) {
    const { db } = adapter;
    const strategy = opts.code || 'default';

    let modules;
    if (strategy === 'custom' && opts.modules) {
        modules = opts.modules;
    } else {
        const path = require('path');
        const { loadBotModules } = require('../runtime/loadBot');
        const distDir = opts.distDir || process.env.BOT_DIST_DIR || path.join(__dirname, '..', '..', '..', 'dist');
        modules = loadBotModules(distDir);
    }

    await db['users.code'].insert({
        user: userId,
        branch: 'default',
        modules,
        activeWorld: true,
    });
}

// ─── Materialize room (full pipeline) ─────────────────────────────────────

/**
 * Materialize the entire room from the canonical spec.
 *
 * Order:
 * 1. controller (if present)
 * 2. sources
 * 3. structures
 * 4. creeps (friendly)
 * 5. hostiles
 *
 * @param {import('../storageAdapter').StorageAdapter} adapter
 * @param {RoomSpecCanonical} roomSpec
 * @returns {Promise<{sourceIds: string[], structureIds: string[], creepIds: string[]}>}
 */
async function materializeRoom(adapter, roomSpec) {
    const results = { sourceIds: [], structureIds: [], creepIds: [] };

    // 1. Controller
    if (roomSpec.controller) {
        await materializeController(adapter, roomSpec.name, roomSpec.controller);
    }

    // 2. Sources
    if (roomSpec.sources && roomSpec.sources.length > 0) {
        results.sourceIds = await materializeSources(adapter, roomSpec.name, roomSpec.sources);
    }

    // 3. Structures
    if (roomSpec.structures && roomSpec.structures.length > 0) {
        results.structureIds = await materializeStructures(adapter, roomSpec.name, roomSpec.structures);
    }

    // 4. Creeps (friendly)
    if (roomSpec.creeps && roomSpec.creeps.length > 0) {
        results.creepIds = await materializeCreeps(adapter, roomSpec.name, roomSpec.creeps);
    }

    // 5. Hostiles
    if (roomSpec.hostiles && roomSpec.hostiles.length > 0) {
        const hostileIds = await materializeCreeps(adapter, roomSpec.name, roomSpec.hostiles);
        results.creepIds.push(...hostileIds);
    }

    return results;
}

module.exports = {
    materializeStructure,
    materializeStructures,
    materializeSource,
    materializeSources,
    materializeController,
    materializeCreep,
    materializeCreeps,
    materializeBotCode,
    materializeRoom,
};
