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
 * Creates multiple structure objects in `rooms.objects`.
 *
 * @param {StorageAdapter} adapter
 * @param {string} roomName
 * @param {StructureSpec[]} structures
 * @returns {Promise<string[]>} _id of created objects
 */
async function materializeStructures(adapter, roomName, structures) {
    const ids = [];
    for (const s of structures) {
        const id = await materializeStructure(adapter, roomName, s);
        ids.push(id);
    }
    return ids;
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
    const doc = {
        room: roomName,
        type: 'source',
        x: src.x,
        y: src.y,
        energy: src.energy !== undefined ? src.energy : 3000,
        energyCapacity: src.energyCapacity !== undefined ? src.energyCapacity : 3000,
        ticksToRegeneration: src.ticksToRegeneration || 0,
    };
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
    const ids = [];
    for (const src of sources) {
        const id = await materializeSource(adapter, roomName, src);
        ids.push(id);
    }
    return ids;
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
async function materializeController(adapter, roomName, ctrl) {
    const { db } = adapter;
    const existing = await db['rooms.objects'].findOne({ room: roomName, type: 'controller' });

    if (!existing) {
        const doc = {
            room: roomName,
            type: 'controller',
            x: ctrl.x ?? 35,
            y: ctrl.y ?? 35,
            level: ctrl.level ?? 1,
            progress: ctrl.progress ?? 0,
            downgradeTime: ctrl.downgradeTime ?? null,
            safeMode: ctrl.safeMode ?? 0,
            safeModeAvailable: ctrl.safeModeAvailable ?? 0,
            isPowerEnabled: ctrl.isPowerEnabled ?? false,
        };

        if (ctrl.userId !== undefined) {
            doc.user = ctrl.userId;
        }
        if (ctrl.id) {
            doc._id = ctrl.id;
        }

        const result = await db['rooms.objects'].insert(doc);
        return result._id;
    }

    const update = {};
    if (ctrl.x !== undefined) {
        update.x = ctrl.x;
    }
    if (ctrl.y !== undefined) {
        update.y = ctrl.y;
    }
    if (ctrl.level !== undefined) {
        update.level = ctrl.level;
    }
    if (ctrl.progress !== undefined) {
        update.progress = ctrl.progress;
    }
    if (ctrl.userId !== undefined) {
        update.user = ctrl.userId;
    }
    if (ctrl.downgradeTime !== undefined) {
        update.downgradeTime = ctrl.downgradeTime;
    }
    if (ctrl.safeMode !== undefined) {
        update.safeMode = ctrl.safeMode;
    }
    if (ctrl.safeModeAvailable !== undefined) {
        update.safeModeAvailable = ctrl.safeModeAvailable;
    }
    if (ctrl.isPowerEnabled !== undefined) {
        update.isPowerEnabled = ctrl.isPowerEnabled;
    }

    if (Object.keys(update).length > 0) {
        await db['rooms.objects'].update({ room: roomName, type: 'controller' }, { $set: update });
    }
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
    const ids = [];
    for (const c of creeps) {
        const id = await materializeCreep(adapter, roomName, c);
        ids.push(id);
    }
    return ids;
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
        const { loadBotModules } = require('../loadBot');
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
