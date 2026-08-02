'use strict';

/**
 * Pure spec-object constructors.
 * Don't depend on DB or server — only create plain objects with defaults.
 *
 * Each object can explicitly specify `roomName` — used by the materialize layer
 * for writing to the DB. If roomName is not set — materialize will throw an error
 * (no hidden defaults).
 *
 * Game constants (structure types, body parts, resources) are taken from
 * `lib/constants/screepsConstants.js` — the single source of framework constants.
 *
 * @module builders/spec
 */

const {
    STRUCTURE_SPAWN,
    STRUCTURE_EXTENSION,
    STRUCTURE_CONTAINER,
    STRUCTURE_STORAGE,
    STRUCTURE_TOWER,
    STRUCTURE_ROAD,
    STRUCTURE_WALL,
    STRUCTURE_RAMPART,
    STRUCTURE_LINK,
    STRUCTURE_TERMINAL,
    STRUCTURE_OBSERVER,
    STRUCTURE_POWER_SPAWN,
    STRUCTURE_EXTRACTOR,
    STRUCTURE_LAB,
    STRUCTURE_NUKER,
    STRUCTURE_FACTORY,
    STRUCTURE_INVADER_CORE,
    STRUCTURE_POWER_BANK,
    STRUCTURE_PORTAL,
    STRUCTURE_KEEPER_LAIR,
    INVADER_USER_ID,
    SOURCE_KEEPER_USER_ID,
    WORK,
    MOVE,
    CARRY,
    ATTACK,
} = require('../../constants/screepsConstants');

const crypto = require('crypto');

/** Ёмкость одного CARRY-сегмента = 50 единиц */
const CARRY_CAPACITY = 50;

/**
 * @typedef {import('../types').BodyPart} BodyPart
 * @typedef {import('../types').StructureType} StructureType
 * @typedef {import('../types').StructureSpec} StructureSpec
 * @typedef {import('../types').SourceSpecCanonical} SourceSpecCanonical
 * @typedef {import('../types').ControllerSpec} ControllerSpec
 * @typedef {import('../types').CreepSpecCanonical} CreepSpecCanonical
 *
 * @typedef {Object} StructureSpecOverrides
 * @property {string} [roomName]
 * @property {string} [id]
 * @property {string} [userId]
 * @property {string} [name]
 * @property {number} [hits]
 * @property {number} [hitsMax]
 * @property {Object} [store]
 * @property {Object} [storeCapacityResource]
 * @property {boolean} [notifyWhenAttacked]
 * @property {number} [nextDecayTime]
 * @property {Object} [overrides]
 *
 * @typedef {Object} SpawnSpecOpts
 * @property {string} [roomName]
 * @property {string} [id]
 * @property {string} [userId]
 * @property {string} [name]
 * @property {number} [energy]
 * @property {number} [storeCapacity]
 * @property {number} [hits]
 *
 * @typedef {Object} CreepSpecOpts
 * @property {string} [roomName]
 * @property {string} [userId]
 * @property {string} [name]
 * @property {BodyPart[]} [body]
 * @property {number} [hits]
 * @property {number} [hitsMax]
 * @property {Object} [store]                  — override the computed store (e.g. { energy: 100 })
 * @property {number} [storeCapacity]           — override the computed storeCapacity (default: CARRY parts × 50)
 * @property {Object} [storeCapacityResource]  — override per-resource capacity limits
 * @property {string} [id]
 */

// ─── Defaults by structure type ─────────────────────────────────────────────

/** @type {Object<string, {store?: Object, storeCapacity?: number, storeCapacityResource?: Object, hits: number, hitsMax: number, notifyWhenAttacked?: boolean, nextDecayTime?: number}>} */
const STRUCTURE_DEFAULTS = {
    [STRUCTURE_SPAWN]: {
        store: { energy: 300 },
        storeCapacity: 300,
        storeCapacityResource: { energy: 300 },
        hits: 15000,
        hitsMax: 15000,
        notifyWhenAttacked: true,
    },
    [STRUCTURE_TOWER]: {
        store: { energy: 1000 },
        storeCapacity: 1000,
        storeCapacityResource: { energy: 1000 },
        hits: 3000,
        hitsMax: 3000,
        notifyWhenAttacked: true,
    },
    [STRUCTURE_EXTENSION]: {
        store: { energy: 50 },
        storeCapacity: 50,
        storeCapacityResource: { energy: 50 },
        hits: 1000,
        hitsMax: 1000,
        notifyWhenAttacked: true,
    },
    [STRUCTURE_CONTAINER]: {
        store: { energy: 2000 },
        storeCapacity: 2000,
        hits: 250000,
        hitsMax: 250000,
        notifyWhenAttacked: true,
        nextDecayTime: 100,
    },
    [STRUCTURE_STORAGE]: {
        store: { energy: 10000 },
        storeCapacity: 1000000,
        hits: 10000,
        hitsMax: 10000,
        notifyWhenAttacked: true,
    },
    [STRUCTURE_ROAD]: {
        hits: 5000,
        hitsMax: 5000,
        nextDecayTime: 1000,
    },
    [STRUCTURE_WALL]: {
        hits: 10000,
        hitsMax: 300000000,
    },
    [STRUCTURE_RAMPART]: {
        hits: 10000,
        hitsMax: 300000000,
        notifyWhenAttacked: true,
        nextDecayTime: 100,
    },
    [STRUCTURE_LINK]: {
        store: { energy: 800 },
        storeCapacity: 800,
        storeCapacityResource: { energy: 800 },
        hits: 1000,
        hitsMax: 1000,
        notifyWhenAttacked: true,
    },
    [STRUCTURE_TERMINAL]: {
        store: { energy: 0 },
        storeCapacity: 300000,
        hits: 3000,
        hitsMax: 3000,
        notifyWhenAttacked: true,
    },
    [STRUCTURE_OBSERVER]: {
        hits: 500,
        hitsMax: 500,
        notifyWhenAttacked: true,
    },
    [STRUCTURE_POWER_SPAWN]: {
        store: { energy: 5000, power: 100 },
        storeCapacity: 5000,
        hits: 5000,
        hitsMax: 5000,
        notifyWhenAttacked: true,
    },
    [STRUCTURE_EXTRACTOR]: {
        hits: 500,
        hitsMax: 500,
        notifyWhenAttacked: true,
    },
    [STRUCTURE_LAB]: {
        store: {},
        storeCapacity: 3000,
        hits: 500,
        hitsMax: 500,
        notifyWhenAttacked: true,
    },
    [STRUCTURE_NUKER]: {
        store: { energy: 0, G: 0 },
        storeCapacity: 300000,
        hits: 1000,
        hitsMax: 1000,
        notifyWhenAttacked: true,
    },
    [STRUCTURE_FACTORY]: {
        store: {},
        storeCapacity: 50000,
        hits: 1000,
        hitsMax: 1000,
        notifyWhenAttacked: true,
    },
    [STRUCTURE_INVADER_CORE]: {
        hits: 100000,
        hitsMax: 100000,
    },
    [STRUCTURE_POWER_BANK]: {
        hits: 2000000,
        hitsMax: 2000000,
    },
    [STRUCTURE_PORTAL]: {
        // indestructible — no hits/hitsMax
    },
    [STRUCTURE_KEEPER_LAIR]: {
        hits: 10000,
        hitsMax: 10000,
    },
};

/** @type {BodyPart[]} */
const DEFAULT_CREEP_BODY = [
    { type: WORK, hits: 150 },
    { type: WORK, hits: 150 },
    { type: WORK, hits: 150 },
    { type: MOVE, hits: 150 },
    { type: MOVE, hits: 150 },
    { type: MOVE, hits: 150 },
];

/** @type {BodyPart[]} */
const DEFAULT_INVADER_BODY = [
    { type: ATTACK, hits: 150 },
    { type: ATTACK, hits: 150 },
    { type: ATTACK, hits: 150 },
    { type: MOVE, hits: 150 },
    { type: MOVE, hits: 150 },
    { type: MOVE, hits: 150 },
];

// ─── Internal helpers ───────────────────────────────────────────────────────

/**
 * Builds overrides object for structure specs.
 * Centralizes common logic for spawn/tower/extension/etc.
 *
 * @param {Object} opts — user-provided options
 * @param {Object} cfg — configuration flags
 * @param {boolean} [cfg.withUserId] — include userId
 * @param {string|Function} [cfg.name] — static name or factory function
 * @param {boolean|'simple'} [cfg.withStore] — true (full store), 'simple' (no storeCapacityResource)
 * @param {boolean|'noMax'} [cfg.withHits] — true (hits+hitsMax), 'noMax' (hits only)
 * @returns {Object}
 */
function buildOverrides(opts, cfg = {}) {
    const o = { roomName: opts.roomName, id: opts.id };
    if (cfg.withUserId) o.userId = opts.userId;
    if (cfg.name) o.name = typeof cfg.name === 'function' ? cfg.name(opts) : opts.name || cfg.name;

    if (cfg.withStore) {
        const hasEnergy = opts.energy !== undefined;
        const hasCap = opts.storeCapacity !== undefined;
        const hasCapRes = cfg.withStore !== 'simple' && opts.storeCapacityResource !== undefined;
        if (hasEnergy || hasCap || hasCapRes) {
            if (hasEnergy) o.store = { energy: opts.energy };
            if (hasCap) o.storeCapacity = opts.storeCapacity;
            if (hasCapRes) o.storeCapacityResource = opts.storeCapacityResource;
        }
    }

    if (cfg.withHits && opts.hits !== undefined) {
        o.hits = opts.hits;
        if (cfg.withHits !== 'noMax') o.hitsMax = opts.hits;
    }
    if (opts.overrides) {
        o.overrides = opts.overrides;
    }
    return o;
}

// ─── Spec constructors ──────────────────────────────────────────────────────

/**
 * Creates a canonical structure spec.
 * Minimum: type + x + y. The rest is filled by type.
 *
 * @param {StructureType} type
 * @param {number} x
 * @param {number} y
 * @param {StructureSpecOverrides} [overrides]
 * @returns {StructureSpec}
 */
function structure(type, x, y, overrides = {}) {
    const defaults = STRUCTURE_DEFAULTS[type] || {};
    const spec = { type, x, y };

    // explicit room binding
    if (overrides.roomName) {
        spec.roomName = overrides.roomName;
    }

    // explicit ownership
    if (overrides.userId !== undefined) {
        spec.userId = overrides.userId;
    }

    // store — merge with defaults
    if (overrides.store || defaults.store) {
        spec.store = { ...(defaults.store || {}), ...(overrides.store || {}) };
    }
    // storeCapacity — override or default
    // Note: storeCapacity (number) and storeCapacityResource (object) are both legacy Screeps API fields.
    // storeCapacity is the total capacity value, storeCapacityResource is used only for spawn/tower/extension/link
    // to specify per-resource capacity limits in the old API format.
    if (defaults.storeCapacity !== undefined) {
        spec.storeCapacity = overrides.storeCapacity !== undefined ? overrides.storeCapacity : defaults.storeCapacity;
    }
    // storeCapacityResource — merge with defaults (only for spawn/tower/extension/link)
    if (overrides.storeCapacityResource || defaults.storeCapacityResource) {
        spec.storeCapacityResource = {
            ...(defaults.storeCapacityResource || {}),
            ...(overrides.storeCapacityResource || {}),
        };
    }

    // hits/hitsMax
    spec.hits = overrides.hits !== undefined ? overrides.hits : defaults.hits;
    spec.hitsMax = overrides.hitsMax !== undefined ? overrides.hitsMax : defaults.hitsMax;

    // notifyWhenAttacked
    if (defaults.notifyWhenAttacked !== undefined) {
        spec.notifyWhenAttacked =
            overrides.notifyWhenAttacked !== undefined ? overrides.notifyWhenAttacked : defaults.notifyWhenAttacked;
    }

    // nextDecayTime (used by road/container/rampart)
    if (defaults.nextDecayTime !== undefined || overrides.nextDecayTime !== undefined) {
        spec.nextDecayTime = overrides.nextDecayTime !== undefined ? overrides.nextDecayTime : defaults.nextDecayTime;
    }

    // optional fields
    if (overrides.id) {
        spec.id = overrides.id;
    }
    if (overrides.name) {
        spec.name = overrides.name;
    }
    if (overrides.overrides) {
        spec.overrides = overrides.overrides;
    }

    return spec;
}

/**
 * Creates a spawn spec.
 *
 * @param {number} x
 * @param {number} y
 * @param {SpawnSpecOpts} [opts]
 * @returns {StructureSpec}
 */
function spawn(x, y, opts = {}) {
    return structure(
        STRUCTURE_SPAWN,
        x,
        y,
        buildOverrides(opts, {
            withUserId: true,
            name: (o) => o.name || `Spawn_${crypto.randomUUID()}`,
            withStore: true,
            withHits: true,
        }),
    );
}

/**
 * Creates a tower spec.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId?, energy?, storeCapacity?, storeCapacityResource?, hits? }
 */
function tower(x, y, opts = {}) {
    return structure(
        STRUCTURE_TOWER,
        x,
        y,
        buildOverrides(opts, {
            withUserId: true,
            withStore: true,
            withHits: true,
        }),
    );
}

/**
 * Creates an extension spec.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId?, energy?, storeCapacity?, storeCapacityResource?, hits? }
 */
function extension(x, y, opts = {}) {
    return structure(
        STRUCTURE_EXTENSION,
        x,
        y,
        buildOverrides(opts, {
            withUserId: true,
            withStore: true,
            withHits: true,
        }),
    );
}

/**
 * Creates a container spec.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId?, energy?, storeCapacity?, hits? }
 */
function container(x, y, opts = {}) {
    return structure(
        STRUCTURE_CONTAINER,
        x,
        y,
        buildOverrides(opts, {
            withUserId: true,
            withStore: 'simple',
            withHits: true,
        }),
    );
}

/**
 * Creates a storage spec.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId?, energy?, storeCapacity?, hits? }
 */
function storage(x, y, opts = {}) {
    return structure(
        STRUCTURE_STORAGE,
        x,
        y,
        buildOverrides(opts, {
            withUserId: true,
            withStore: 'simple',
            withHits: true,
        }),
    );
}

/**
 * Creates a road spec.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId?, hits? }
 */
function road(x, y, opts = {}) {
    return structure(STRUCTURE_ROAD, x, y, buildOverrides(opts, { withUserId: true, withHits: true }));
}

/**
 * Creates a wall spec (constructedWall).
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, hits? }
 */
function wall(x, y, opts = {}) {
    return structure(STRUCTURE_WALL, x, y, buildOverrides(opts, { withHits: 'noMax' }));
}

/**
 * Creates a rampart spec.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId?, hits? }
 */
function rampart(x, y, opts = {}) {
    return structure(
        STRUCTURE_RAMPART,
        x,
        y,
        buildOverrides(opts, {
            withUserId: true,
            withHits: 'noMax',
        }),
    );
}

/**
 * Creates a link spec.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId?, energy?, storeCapacity?, storeCapacityResource?, hits? }
 */
function link(x, y, opts = {}) {
    return structure(
        STRUCTURE_LINK,
        x,
        y,
        buildOverrides(opts, {
            withUserId: true,
            withStore: true,
            withHits: true,
        }),
    );
}

/**
 * Creates a terminal spec.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId?, energy?, storeCapacity?, hits? }
 */
function terminal(x, y, opts = {}) {
    return structure(
        STRUCTURE_TERMINAL,
        x,
        y,
        buildOverrides(opts, {
            withUserId: true,
            withStore: 'simple',
            withHits: true,
        }),
    );
}

/**
 * Creates an observer spec.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId?, hits?, observeRoom?, overrides? }
 * @returns {StructureSpec}
 */
function observer(x, y, opts = {}) {
    const merged = { ...opts };
    if (opts.observeRoom !== undefined) {
        merged.overrides = { ...(opts.overrides || {}), observeRoom: opts.observeRoom };
    }
    return structure(STRUCTURE_OBSERVER, x, y, buildOverrides(merged, { withUserId: true, withHits: true }));
}

/**
 * Creates a power spawn spec.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId?, energy?, power?, storeCapacity?, hits?, overrides? }
 * @returns {StructureSpec}
 */
function powerSpawn(x, y, opts = {}) {
    const merged = { ...opts };
    if (opts.power !== undefined) {
        merged.overrides = { ...(opts.overrides || {}), power: opts.power };
    }
    return structure(
        STRUCTURE_POWER_SPAWN,
        x,
        y,
        buildOverrides(merged, { withUserId: true, withStore: 'simple', withHits: true }),
    );
}

/**
 * Creates an extractor spec.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId?, hits?, cooldown?, overrides? }
 * @returns {StructureSpec}
 */
function extractor(x, y, opts = {}) {
    const merged = { ...opts };
    if (opts.cooldown !== undefined) {
        merged.overrides = { ...(opts.overrides || {}), cooldown: opts.cooldown };
    }
    return structure(STRUCTURE_EXTRACTOR, x, y, buildOverrides(merged, { withUserId: true, withHits: true }));
}

/**
 * Creates a lab spec.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId?, energy?, storeCapacity?, mineralType?, cooldown?, hits?, overrides? }
 * @returns {StructureSpec}
 */
function lab(x, y, opts = {}) {
    const merged = { ...opts };
    const extra = { ...(opts.overrides || {}) };
    if (opts.cooldown !== undefined) extra.cooldown = opts.cooldown;
    if (opts.mineralType !== undefined) extra.mineralType = opts.mineralType;
    if (Object.keys(extra).length > 0) merged.overrides = extra;
    return structure(
        STRUCTURE_LAB,
        x,
        y,
        buildOverrides(merged, { withUserId: true, withStore: 'simple', withHits: true }),
    );
}

/**
 * Creates a nuker spec.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId?, energy?, G?, storeCapacity?, cooldown?, hits?, overrides? }
 * @returns {StructureSpec}
 */
function nuker(x, y, opts = {}) {
    const merged = { ...opts };
    const extra = { ...(opts.overrides || {}) };
    if (opts.cooldown !== undefined) extra.cooldown = opts.cooldown;
    if (Object.keys(extra).length > 0) merged.overrides = extra;
    return structure(
        STRUCTURE_NUKER,
        x,
        y,
        buildOverrides(merged, { withUserId: true, withStore: 'simple', withHits: true }),
    );
}

/**
 * Creates a factory spec.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId?, energy?, storeCapacity?, level?, cooldown?, hits?, overrides? }
 * @returns {StructureSpec}
 */
function factory(x, y, opts = {}) {
    const merged = { ...opts };
    const extra = { ...(opts.overrides || {}) };
    if (opts.cooldown !== undefined) extra.cooldown = opts.cooldown;
    if (opts.level !== undefined) extra.level = opts.level;
    if (Object.keys(extra).length > 0) merged.overrides = extra;
    return structure(
        STRUCTURE_FACTORY,
        x,
        y,
        buildOverrides(merged, { withUserId: true, withStore: 'simple', withHits: true }),
    );
}

/**
 * Creates an invader core spec (NPC structure, owned by Invader faction).
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId?, hits?, level?, ticksToDeploy?, overrides? }
 * @returns {StructureSpec}
 */
function invaderCore(x, y, opts = {}) {
    // NPC structure, defaults to Invader userId ('2')
    const merged = { ...opts, userId: opts.userId !== undefined ? opts.userId : INVADER_USER_ID };
    const extra = { ...(opts.overrides || {}) };
    if (opts.level !== undefined) extra.level = opts.level;
    if (opts.ticksToDeploy !== undefined) extra.ticksToDeploy = opts.ticksToDeploy;
    if (Object.keys(extra).length > 0) merged.overrides = extra;
    return structure(STRUCTURE_INVADER_CORE, x, y, buildOverrides(merged, { withUserId: true, withHits: true }));
}

/**
 * Creates a power bank spec (NPC structure, neutral — no owner).
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, hits?, power?, ticksToDecay?, overrides? }
 * @returns {StructureSpec}
 */
function powerBank(x, y, opts = {}) {
    // Neutral NPC structure — explicit null userId prevents default bot assignment
    const merged = { ...opts, userId: opts.userId !== undefined ? opts.userId : null };
    const extra = { ...(opts.overrides || {}) };
    if (opts.power !== undefined) extra.power = opts.power;
    if (opts.ticksToDecay !== undefined) extra.ticksToDecay = opts.ticksToDecay;
    if (Object.keys(extra).length > 0) merged.overrides = extra;
    return structure(STRUCTURE_POWER_BANK, x, y, buildOverrides(merged, { withUserId: true, withHits: true }));
}

/**
 * Creates a portal spec (neutral, indestructible — no owner).
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, destination?, unstableDate?, overrides? }
 * @returns {StructureSpec}
 */
function portal(x, y, opts = {}) {
    // Neutral — explicit null userId prevents default bot assignment
    const merged = { ...opts, userId: opts.userId !== undefined ? opts.userId : null };
    const extra = { ...(opts.overrides || {}) };
    if (opts.destination !== undefined) extra.destination = opts.destination;
    if (opts.unstableDate !== undefined) extra.unstableDate = opts.unstableDate;
    if (Object.keys(extra).length > 0) merged.overrides = extra;
    return structure(STRUCTURE_PORTAL, x, y, buildOverrides(merged, { withUserId: true }));
}

/**
 * Creates a keeper lair spec (NPC structure, owned by Source Keeper faction).
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId?, hits?, ticksToSpawn?, overrides? }
 * @returns {StructureSpec}
 */
function keeperLair(x, y, opts = {}) {
    // NPC structure, defaults to Source Keeper userId ('3')
    const merged = { ...opts, userId: opts.userId !== undefined ? opts.userId : SOURCE_KEEPER_USER_ID };
    if (opts.ticksToSpawn !== undefined) {
        merged.overrides = { ...(opts.overrides || {}), ticksToSpawn: opts.ticksToSpawn };
    }
    return structure(STRUCTURE_KEEPER_LAIR, x, y, buildOverrides(merged, { withUserId: true, withHits: true }));
}

/**
 * Creates a canonical source spec.

 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, energy?, energyCapacity?, ticksToRegeneration? }
 * @returns {SourceSpecCanonical}
 */
function source(x, y, opts = {}) {
    const spec = {
        x,
        y,
        energy: opts.energy !== undefined ? opts.energy : 3000,
        energyCapacity: opts.energyCapacity !== undefined ? opts.energyCapacity : 3000,
        ticksToRegeneration: opts.ticksToRegeneration || 0,
    };
    if (opts.id) {
        spec.id = opts.id;
    }
    if (opts.roomName) {
        spec.roomName = opts.roomName;
    }
    return spec;
}

/**
 * Creates a canonical controller spec.
 *
 * Supports two call signatures:
 *   `controller(opts)`          — single options object (x/y default to 35,35)
 *   `controller(x, y, opts?)`   — positional x/y with optional opts override
 *
 * If `x`/`y` are not set — defaults to (35, 35).
 * When both positional args and `opts.x`/`opts.y` are provided,
 * the explicit opts fields take priority.
 *
 * @param {number|Object} [x]      — x coordinate, or full options object
 * @param {number} [y]             — y coordinate (only when x is a number)
 * @param {Object} [optsArg]       — { x?, y?, id?, roomName?, level?, progress?, userId?, safeMode?, safeModeAvailable?, isPowerEnabled?, downgradeTime? }
 * @returns {ControllerSpec}
 *
 * @example
 * // Positional form (like other spec.* constructors)
 * spec.controller(10, 20, { level: 3 });
 *
 * @example
 * // Options form (backward compatible)
 * spec.controller({ level: 1 });
 */
function controller(x, y, optsArg) {
    // Overload detection: if first arg is a number → positional (x, y, opts)
    /** @type {Object} */
    let opts;
    if (typeof x === 'number') {
        opts = optsArg !== undefined ? { ...optsArg } : {};
        // Positional args set defaults, but explicit opts.x/opts.y win
        if (opts.x === undefined) opts.x = x;
        if (opts.y === undefined && typeof y === 'number') opts.y = y;
    } else {
        opts = x || {};
    }

    const spec = {
        x: opts.x !== undefined ? opts.x : 35,
        y: opts.y !== undefined ? opts.y : 35,
        level: opts.level !== undefined ? opts.level : 1,
        progress: opts.progress !== undefined ? opts.progress : 0,
        downgradeTime: opts.downgradeTime !== undefined ? opts.downgradeTime : null,
        safeMode: opts.safeMode || 0,
        safeModeAvailable: opts.safeModeAvailable || 0,
        isPowerEnabled: opts.isPowerEnabled || false,
    };
    if (opts.id) {
        spec.id = opts.id;
    }
    if (opts.userId !== undefined) {
        spec.userId = opts.userId;
    }
    if (opts.roomName) {
        spec.roomName = opts.roomName;
    }
    return spec;
}

/**
 * Creates a standard RCL1 base room spec.
 *
 * Returns a ready-to-use room input for `createWorld({ rooms: [...] })`:
 * a controller at level 1 (32,32), two sources at (15,15)/(35,35) and one
 * spawn at (25,25). Customise via `opts` — a `RoomOverrides` object applied
 * through the existing `roomOverrides` mechanism (same vocabulary as room
 * fixtures), so only the fields that differ from the defaults are specified.
 *
 * @param {string} name — room name ('W0N1')
 * @param {import('../types').RoomOverrides} [opts] — overrides on top of the defaults
 * @returns {import('../types').RoomSpecInput}
 *
 * @example
 * // Standard room, nothing customised
 * rooms: [spec.baseRoom('W0N1')]
 *
 * @example
 * // RCL2 + a tower + a bot creep
 * rooms: [spec.baseRoom('W0N1', {
 *   controller: { level: 2 },
 *   append: [spec.tower(20, 20)],
 *   creeps: [spec.creep(25, 24, { name: 'harvester1' })],
 * })]
 */
function baseRoom(name = 'W0N1', opts = {}) {
    const room = {
        name,
        controller: controller({ level: 1, x: 32, y: 32 }),
        sources: [source(15, 15), source(35, 35)],
        structures: [spawn(25, 25)],
    };

    if (opts && Object.keys(opts).length > 0) {
        room.roomOverrides = opts;
    }

    return room;
}

/**
 * Creates a canonical creep spec.
 *
 * @param {number} x
 * @param {number} y
 * @param {CreepSpecOpts} [opts]
 * @returns {CreepSpecCanonical}
 */
function creep(x, y, opts = {}) {
    const body = opts.body || DEFAULT_CREEP_BODY;
    const hits = opts.hits || body.reduce((sum, p) => sum + p.hits, 0);
    // Рассчитываем storeCapacity из CARRY-частей тела
    const carryCapacity = body.filter((p) => p.type === CARRY).reduce((sum) => sum + CARRY_CAPACITY, 0);
    const effectiveCapacity = opts.storeCapacity ?? carryCapacity;
    const spec = {
        x,
        y,
        userId: opts.userId,
        name: opts.name,
        body,
        hits,
        hitsMax: opts.hitsMax || hits,
        store: { energy: 0 },
        storeCapacity: effectiveCapacity,
    };
    if (opts.store) {
        spec.store = { ...spec.store, ...opts.store };
    }
    if (opts.storeCapacityResource) {
        spec.storeCapacityResource = { ...opts.storeCapacityResource };
    }
    if (opts.id) {
        spec.id = opts.id;
    }
    if (opts.roomName) {
        spec.roomName = opts.roomName;
    }
    return spec;
}

/**
 * Creates a canonical invader spec.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, name?, body? }
 * @returns {import('../types').CreepSpecCanonical}
 */
function invader(x, y, opts = {}) {
    return creep(x, y, {
        roomName: opts.roomName,
        userId: INVADER_USER_ID,
        name: opts.name || 'Invader_1',
        body: opts.body || DEFAULT_INVADER_BODY,
        id: opts.id,
    });
}

/**
 * Creates a dummy target creep spec (for defense tests).
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, name? }
 * @returns {import('../types').CreepSpecCanonical}
 */
function dummyTarget(x, y, opts = {}) {
    return creep(x, y, {
        roomName: opts.roomName,
        name: opts.name || 'DummyTarget',
    });
}

module.exports = {
    structure,
    spawn,
    tower,
    extension,
    container,
    storage,
    road,
    wall,
    rampart,
    link,
    terminal,
    observer,
    powerSpawn,
    extractor,
    lab,
    nuker,
    factory,
    invaderCore,
    powerBank,
    portal,
    keeperLair,
    source,
    controller,
    baseRoom,
    creep,
    invader,
    dummyTarget,
    STRUCTURE_DEFAULTS,
    DEFAULT_CREEP_BODY,
    DEFAULT_INVADER_BODY,
};
