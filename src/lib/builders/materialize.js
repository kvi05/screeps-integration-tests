'use strict';

/**
 * Materialize: превращает канонические spec-объекты в реальные документы БД.
 *
 * Слой, который знает о DB shape (`rooms.objects`, `users.code`).
 * Ни сценарии, ни normalize не должны обращаться к БД напрямую.
 *
 * ## ID policy
 *
 * `s.id` если задан — используется как есть. Никакого автоматического
 * скоупинга по `roomName`. Причина: главный потребитель `_id` — это
 * memory fixture, которая может прийти как из нашего capture-flow,
 * так и копией с реального сервера. Если мы будем переписывать id,
 * memory fixture сломается.
 *
 * Multi-room сценарии должны избегать конфликтов самостоятельно
 * (например, использовать разные fixture для разных комнат, либо
 * генерировать `_id` через `crypto.randomUUID()` внутри spec).
 *
 *
 * ## Mapping spec → DB
 *
 * Во всех spec-типах поле владельца называется `userId`.
 * В БД mockup (`rooms.objects`, `users.code`) оно
 * называется `user`. Маппинг выполняется только здесь.
 *
 * @module builders/materialize
 */

/**
 * @typedef {import('screeps-server-mockup').ScreepsServer} ScreepsServer
 * @typedef {import('../types').StructureSpec} StructureSpec
 * @typedef {import('../types').SourceSpecCanonical} SourceSpecCanonical
 * @typedef {import('../types').ControllerSpec} ControllerSpec
 * @typedef {import('../types').CreepSpecCanonical} CreepSpecCanonical
 * @typedef {import('../types').RoomSpecCanonical} RoomSpecCanonical
 *
 * @typedef {Object} MaterializeBotCodeOpts
 * @property {'default'|'custom'} [code='default']
 * @property {Object} [modules]          — кастомные модули (для code='custom')
 * @property {string} [distDir]          — путь к dist/ (для code='default')
 */

const { STRUCTURE_SPAWN } = require('../../constants/screepsConstants');

// ─── Materialize structures ─────────────────────────────────────────────────

/**
 * Создаёт один structure-объект в `rooms.objects`.
 *
 * @param {ScreepsServer} server
 * @param {string} roomName
 * @param {StructureSpec} s
 * @returns {Promise<string>} _id созданного объекта
 */
async function materializeStructure(server, roomName, s) {
    const { db } = server.common.storage;

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

    // custom _id — берётся как есть (см. ID policy в шапке файла)
    if (s.id) {
        doc._id = s.id;
    }

    // произвольные overrides
    if (s.overrides) {
        Object.assign(doc, s.overrides);
    }

    const result = await db['rooms.objects'].insert(doc);
    return result._id;
}

/**
 * Создаёт несколько structure-объектов в `rooms.objects`.
 *
 * @param {ScreepsServer} server
 * @param {string} roomName
 * @param {StructureSpec[]} structures
 * @returns {Promise<string[]>} _id созданных объектов
 */
async function materializeStructures(server, roomName, structures) {
    const ids = [];
    for (const s of structures) {
        const id = await materializeStructure(server, roomName, s);
        ids.push(id);
    }
    return ids;
}

// ─── Materialize sources ────────────────────────────────────────────────────

/**
 * Создаёт source в `rooms.objects`.
 *
 * @param {ScreepsServer} server
 * @param {string} roomName
 * @param {SourceSpecCanonical} src
 * @returns {Promise<string>} _id
 */
async function materializeSource(server, roomName, src) {
    const { db } = server.common.storage;
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
 * Создаёт несколько sources.
 *
 * @param {ScreepsServer} server
 * @param {string} roomName
 * @param {SourceSpecCanonical[]} sources
 * @returns {Promise<string[]>} _id
 */
async function materializeSources(server, roomName, sources) {
    const ids = [];
    for (const src of sources) {
        const id = await materializeSource(server, roomName, src);
        ids.push(id);
    }
    return ids;
}

// ─── Materialize controller ─────────────────────────────────────────────────

/**
 * Материализует controller в `rooms.objects`.
 *
 * Если controller уже существует (например, создан раннее), обновляет его
 * поля; иначе вставляет новый документ. Это безопасно для тиковой среды —
 * повторный вызов не дублирует контроллер.
 *
 * @param {ScreepsServer} server
 * @param {string} roomName
 * @param {ControllerSpec} ctrl
 * @returns {Promise<string>} _id существующего или созданного controller
 */
async function materializeController(server, roomName, ctrl) {
    const { db } = server.common.storage;
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
 * Создаёт creep в `rooms.objects`.
 *
 * @param {ScreepsServer} server
 * @param {string} roomName
 * @param {CreepSpecCanonical} c
 * @returns {Promise<string>} _id
 */
async function materializeCreep(server, roomName, c) {
    const { db } = server.common.storage;
    const crypto = require('crypto');

    if (!c.body || !Array.isArray(c.body) || c.body.length === 0) {
        throw new Error(
            `materializeCreep: spec.body обязателен — массив BodyPart (получено: ${JSON.stringify(c.body)}). ` +
                'Используйте spec.creep() / spec.invader() или передайте body явно.',
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
 * Создаёт нескольких creeps.
 *
 * @param {ScreepsServer} server
 * @param {string} roomName
 * @param {CreepSpecCanonical[]} creeps
 * @returns {Promise<string[]>} _id
 */
async function materializeCreeps(server, roomName, creeps) {
    const ids = [];
    for (const c of creeps) {
        const id = await materializeCreep(server, roomName, c);
        ids.push(id);
    }
    return ids;
}

// ─── Materialize bot code ───────────────────────────────────────────────────

/**
 * Загружает код бота в `users.code`.
 *
 * @param {ScreepsServer} server
 * @param {string} userId                            — _id бота
 * @param {MaterializeBotCodeOpts} [opts]
 * @returns {Promise<void>}
 */
async function materializeBotCode(server, userId, opts = {}) {
    const { db } = server.common.storage;
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

// ─── Materialize room (полный pipeline) ─────────────────────────────────────

/**
 * Materialize всю комнату из канонической спецификации.
 *
 * Порядок:
 * 1. controller (если есть)
 * 2. sources
 * 3. structures
 * 4. creeps (обычные)
 * 5. hostiles
 *
 * @param {ScreepsServer} server
 * @param {RoomSpecCanonical} roomSpec
 * @returns {Promise<{sourceIds: string[], structureIds: string[], creepIds: string[]}>}
 */
async function materializeRoom(server, roomSpec) {
    const results = { sourceIds: [], structureIds: [], creepIds: [] };

    // 1. Controller
    if (roomSpec.controller) {
        await materializeController(server, roomSpec.name, roomSpec.controller);
    }

    // 2. Sources
    if (roomSpec.sources && roomSpec.sources.length > 0) {
        results.sourceIds = await materializeSources(server, roomSpec.name, roomSpec.sources);
    }

    // 3. Structures
    if (roomSpec.structures && roomSpec.structures.length > 0) {
        results.structureIds = await materializeStructures(server, roomSpec.name, roomSpec.structures);
    }

    // 4. Creeps (обычные)
    if (roomSpec.creeps && roomSpec.creeps.length > 0) {
        results.creepIds = await materializeCreeps(server, roomSpec.name, roomSpec.creeps);
    }

    // 5. Hostiles
    if (roomSpec.hostiles && roomSpec.hostiles.length > 0) {
        const hostileIds = await materializeCreeps(server, roomSpec.name, roomSpec.hostiles);
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
