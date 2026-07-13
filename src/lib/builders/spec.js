'use strict';

/**
 * Чистые конструкторы spec-объектов.
 * Не зависят от БД и сервера — только создают plain objects с дефолтами.
 *
 * Каждый объект может явно указать `roomName` — это используется materialize-слоем
 * для записи в БД. Если roomName не задан — materialize упадёт с ошибкой (никаких
 * скрытых дефолтов).
 *
 * Игровые константы (типы структур, body parts, ресурсы) берутся из
 * `lib/constants/screepsConstants.js` — единого источника констант фреймворка.
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
    WORK,
    MOVE,
    ATTACK,
} = require('../../constants/screepsConstants');

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
 * @property {string} [id]
 */

// ─── Defaults по типам структур ─────────────────────────────────────────────

/** @type {Object<string, {store: Object, storeCapacityResource: Object, hits: number, hitsMax: number, notifyWhenAttacked?: boolean}>} */
const STRUCTURE_DEFAULTS = {
    [STRUCTURE_SPAWN]: {
        store: { energy: 300 },
        storeCapacityResource: { energy: 300 },
        hits: 15000,
        hitsMax: 15000,
        notifyWhenAttacked: true,
    },
    [STRUCTURE_TOWER]: {
        store: { energy: 1000 },
        storeCapacityResource: { energy: 1000 },
        hits: 3000,
        hitsMax: 3000,
        notifyWhenAttacked: true,
    },
    [STRUCTURE_EXTENSION]: {
        store: { energy: 50 },
        storeCapacityResource: { energy: 50 },
        hits: 1000,
        hitsMax: 1000,
        notifyWhenAttacked: true,
    },
    [STRUCTURE_CONTAINER]: {
        store: { energy: 2000 },
        storeCapacityResource: { energy: 2000 },
        hits: 250000,
        hitsMax: 250000,
        notifyWhenAttacked: true,
    },
    [STRUCTURE_STORAGE]: {
        store: { energy: 10000 },
        storeCapacityResource: { energy: 1000000 },
        hits: 10000,
        hitsMax: 10000,
        notifyWhenAttacked: true,
    },
    [STRUCTURE_ROAD]: {
        hits: 5000,
        hitsMax: 5000,
    },
    [STRUCTURE_WALL]: {
        hits: 10000,
        hitsMax: 300000000,
    },
    [STRUCTURE_RAMPART]: {
        hits: 10000,
        hitsMax: 300000000,
        notifyWhenAttacked: true,
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

// ─── Spec-конструкторы ──────────────────────────────────────────────────────

/**
 * Создаёт каноническую спецификацию структуры.
 * Минимум: type + x + y. Остальное подставляется по типу.
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

    // явная привязка к комнате
    if (overrides.roomName) {
        spec.roomName = overrides.roomName;
    }

    // явное владение
    if (overrides.userId) {
        spec.userId = overrides.userId;
    }

    // store/storeCapacityResource — мерж с дефолтами
    if (overrides.store || defaults.store) {
        spec.store = { ...(defaults.store || {}), ...(overrides.store || {}) };
    }
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

    // опциональные поля
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
 * Создаёт спецификацию spawn.
 *
 * @param {number} x
 * @param {number} y
 * @param {SpawnSpecOpts} [opts]
 * @returns {StructureSpec}
 */
function spawn(x, y, opts = {}) {
    const overrides = {
        roomName: opts.roomName,
        id: opts.id,
        userId: opts.userId,
        name: opts.name || `Spawn_${crypto.randomUUID()}`,
    };
    if (opts.energy !== undefined || opts.storeCapacity !== undefined) {
        overrides.store = { energy: opts.energy || STRUCTURE_DEFAULTS.spawn.store.energy };
        overrides.storeCapacityResource = {
            energy: opts.storeCapacity || STRUCTURE_DEFAULTS.spawn.storeCapacityResource.energy,
        };
    }
    if (opts.hits !== undefined) {
        overrides.hits = opts.hits;
        overrides.hitsMax = opts.hits;
    }
    return structure(STRUCTURE_SPAWN, x, y, overrides);
}

/**
 * Создаёт спецификацию tower.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId?, energy?, energyCapacity?, hits? }
 */
function tower(x, y, opts = {}) {
    const overrides = { roomName: opts.roomName, id: opts.id, userId: opts.userId };
    if (opts.energy !== undefined || opts.energyCapacity !== undefined) {
        overrides.store = { energy: opts.energy || STRUCTURE_DEFAULTS.tower.store.energy };
        overrides.storeCapacityResource = {
            energy: opts.energyCapacity || STRUCTURE_DEFAULTS.tower.storeCapacityResource.energy,
        };
    }
    if (opts.hits !== undefined) {
        overrides.hits = opts.hits;
        overrides.hitsMax = opts.hits;
    }
    return structure(STRUCTURE_TOWER, x, y, overrides);
}

/**
 * Создаёт спецификацию extension.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId?, energy?, energyCapacity? }
 */
function extension(x, y, opts = {}) {
    const overrides = { roomName: opts.roomName, id: opts.id, userId: opts.userId };
    if (opts.energy !== undefined || opts.energyCapacity !== undefined) {
        overrides.store = { energy: opts.energy || 0 };
        overrides.storeCapacityResource = {
            energy: opts.energyCapacity || STRUCTURE_DEFAULTS.extension.storeCapacityResource.energy,
        };
    }
    return structure(STRUCTURE_EXTENSION, x, y, overrides);
}

/**
 * Создаёт спецификацию container.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId?, energy?, storeCapacity?, hits? }
 */
function container(x, y, opts = {}) {
    const overrides = { roomName: opts.roomName, id: opts.id, userId: opts.userId };
    if (opts.energy !== undefined || opts.storeCapacity !== undefined) {
        overrides.store = { energy: opts.energy || 0 };
        overrides.storeCapacityResource = {
            energy: opts.storeCapacity || STRUCTURE_DEFAULTS.container.storeCapacityResource.energy,
        };
    }
    if (opts.hits !== undefined) {
        overrides.hits = opts.hits;
        overrides.hitsMax = opts.hits;
    }
    return structure(STRUCTURE_CONTAINER, x, y, overrides);
}

/**
 * Создаёт спецификацию storage.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId?, energy?, storeCapacity? }
 */
function storage(x, y, opts = {}) {
    const overrides = { roomName: opts.roomName, id: opts.id, userId: opts.userId };
    if (opts.energy !== undefined || opts.storeCapacity !== undefined) {
        overrides.store = { energy: opts.energy || 0 };
        overrides.storeCapacityResource = {
            energy: opts.storeCapacity || STRUCTURE_DEFAULTS.storage.storeCapacityResource.energy,
        };
    }
    return structure(STRUCTURE_STORAGE, x, y, overrides);
}

/**
 * Создаёт спецификацию road.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, userId? }
 */
function road(x, y, opts = {}) {
    return structure(STRUCTURE_ROAD, x, y, { roomName: opts.roomName, id: opts.id, userId: opts.userId });
}

/**
 * Создаёт спецификацию wall (constructedWall).
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, id?, hits? }
 */
function wall(x, y, opts = {}) {
    const overrides = { roomName: opts.roomName, id: opts.id };
    if (opts.hits !== undefined) {
        overrides.hits = opts.hits;
    }
    return structure(STRUCTURE_WALL, x, y, overrides);
}

/**
 * Создаёт каноническую спецификацию source.
 *
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
 * Создаёт каноническую спецификацию controller.
 *
 * Если `x`/`y` не заданы — используется (35, 35).
 *
 * @param {Object} [opts] — { x?, y?, id?, roomName?, level?, progress?, userId?, safeMode?, safeModeAvailable?, isPowerEnabled?, downgradeTime? }
 * @returns {ControllerSpec}
 */
function controller(opts = {}) {
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
    if (opts.userId) {
        spec.userId = opts.userId;
    }
    if (opts.roomName) {
        spec.roomName = opts.roomName;
    }
    return spec;
}

/**
 * Создаёт каноническую спецификацию крипа.
 *
 * @param {number} x
 * @param {number} y
 * @param {CreepSpecOpts} [opts]
 * @returns {CreepSpecCanonical}
 */
function creep(x, y, opts = {}) {
    const body = opts.body || DEFAULT_CREEP_BODY;
    const hits = opts.hits || body.reduce((sum, p) => sum + p.hits, 0);
    const spec = {
        x,
        y,
        userId: opts.userId,
        name: opts.name,
        body,
        hits,
        hitsMax: opts.hitsMax || hits,
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
 * Создаёт каноническую спецификацию invader.
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts] — { roomName?, name?, body? }
 * @returns {import('../types').CreepSpecCanonical}
 */
function invader(x, y, opts = {}) {
    return creep(x, y, {
        roomName: opts.roomName,
        userId: '2',
        name: opts.name || 'Invader_1',
        body: opts.body || DEFAULT_INVADER_BODY,
        id: opts.id,
    });
}

/**
 * Создаёт спецификацию dummy target крипа (для defense тестов).
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
    source,
    controller,
    creep,
    invader,
    dummyTarget,
    STRUCTURE_DEFAULTS,
    DEFAULT_CREEP_BODY,
    DEFAULT_INVADER_BODY,
};
