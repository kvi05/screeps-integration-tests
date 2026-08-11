// Adapted from screeps-dojo (MIT).
// Sprite and static-layer caches for the Canvas renderer.

import { generateCreepSvg, countBodyParts } from './creepSprite';
import { buildTerrainCanvas, buildStructureCanvas, STATIC_RES } from './staticLayers';

/** @type {Set<string>} NPC / invader user IDs (Screeps built-in) */
const NPC_USERS = new Set(['2', '3']);
/** @type {number} Creep sprite size in tiles */
const CREEP_SIZE_TILES = 1.25;
/** @type {number} Creep sprite rasterization size (px) */
const SPRITE_PX = 96;
/** @type {number} Number of store-fill buckets for sprite colour-coding */
const STORE_BUCKETS = 8;

// Invader SVG asset — vendored from screeps-dojo
const INVADER_INNER =
    '<polygon points="24,4 8,12 8,38 24,46 56,25" fill="#e51f36" stroke="#120006" stroke-width="8" stroke-linejoin="miter" stroke-miterlimit="6" paint-order="stroke fill"/>';
/** @type {{width:number, height:number}} Invader sprite SVG viewBox dimensions */
const INVADER_VIEWBOX = { width: 64, height: 50 };

/**
 * Rasterize an SVG string to an HTMLImageElement.
 * @param {string} svg
 * @returns {Promise<HTMLImageElement>}
 */
function svgToImage(svg) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
}

// ─── SpriteCache ────────────────────────────────────────────────────────────

/**
 * Cache for creep and invader sprites, rasterized from SVG.
 */
export class SpriteCache {
    /** @type {Map<string, HTMLImageElement>} */
    creeps = new Map();
    /** @type {HTMLImageElement|null} */
    invader = null;
    /** @type {string|undefined} */
    botUserId;

    /**
     * @param {string} [botUserId]
     */
    constructor(botUserId) {
        this.botUserId = botUserId;
        // Keys already rasterized — persists across prewarm() calls so each
        // distinct creep appearance is rasterized exactly once.
        this.prewarmed = new Set();
    }

    /**
     * Generate a cache key for a creep object.
     * @param {import('../api/types').FrameObject} o
     * @returns {string}
     */
    key(o) {
        const counts = countBodyParts(o.body);
        const body = Object.keys(counts)
            .sort()
            .map((k) => k + counts[k])
            .join('');
        const owner = o.user === this.botUserId ? 'me' : NPC_USERS.has(String(o.user)) ? 'npc' : 'enemy';
        const store = o.store || {};
        let used = 0;
        for (const r of Object.keys(store)) used += store[r];
        const cap = o.storeCapacity || 0;
        const bucket = cap > 0 ? Math.round(Math.min(1, used / cap) * STORE_BUCKETS) : used > 0 ? STORE_BUCKETS : 0;
        const onlyEnergy = Object.keys(store)
            .filter((r) => store[r] > 0)
            .every((r) => r === 'energy');
        return owner + '|' + body + '|' + bucket + '|' + (onlyEnergy ? 'e' : 'x');
    }

    /**
     * Pre-rasterize creep appearances + the invader.
     *
     * Incremental: only the newest frame is scanned — every creep that ever
     * existed was in the newest frame at the moment it arrived — and only keys
     * not seen before are rasterized. `prewarmed` persists across calls, so a
     * distinct creep is rasterized once instead of re-rasterized on every frame.
     * @param {Object} recording — { frames: Frame[] }
     * @returns {Promise<void>}
     */
    async prewarm(recording) {
        const frames = recording.frames || [];
        const last = frames[frames.length - 1];
        if (!last) return;

        const jobs = [];
        for (const o of last.objects || []) {
            if (o.type !== 'creep' || o.spawning) continue;
            if (NPC_USERS.has(String(o.user))) continue;
            const k = this.key(o);
            if (this.prewarmed.has(k)) continue;
            this.prewarmed.add(k);
            jobs.push(this.rasterizeCreep(k, o));
        }
        if (!this.invader) jobs.push(this.rasterizeInvader());
        await Promise.all(jobs);
    }

    /**
     * @param {string} key
     * @param {import('../api/types').FrameObject} o
     */
    async rasterizeCreep(key, o) {
        const counts = countBodyParts(o.body);
        const inner = o.user === this.botUserId ? '#5577ff' : '#ff5555';
        const S = CREEP_SIZE_TILES;
        const innerSvg = generateCreepSvg(S / 2, S / 2, S, counts, o.store, 1, inner, o.storeCapacity);
        const svg =
            '<svg xmlns="http://www.w3.org/2000/svg" width="' +
            SPRITE_PX +
            '" height="' +
            SPRITE_PX +
            '" viewBox="0 0 ' +
            S +
            ' ' +
            S +
            '">' +
            innerSvg +
            '</svg>';
        try {
            this.creeps.set(key, await svgToImage(svg));
        } catch {
            /* skip */
        }
    }

    async rasterizeInvader() {
        const svg =
            '<svg xmlns="http://www.w3.org/2000/svg" width="' +
            SPRITE_PX +
            '" height="' +
            SPRITE_PX +
            '" viewBox="0 0 ' +
            INVADER_VIEWBOX.width +
            ' ' +
            INVADER_VIEWBOX.height +
            '">' +
            INVADER_INNER +
            '</svg>';
        try {
            this.invader = await svgToImage(svg);
        } catch {
            /* skip */
        }
    }

    /**
     * @param {import('../api/types').FrameObject} o
     * @returns {HTMLImageElement|null}
     */
    creepSprite(o) {
        return this.creeps.get(this.key(o)) || null;
    }

    /**
     * @returns {HTMLImageElement|null}
     */
    invaderSprite() {
        return this.invader;
    }

    /**
     * @param {import('../api/types').FrameObject} o
     * @returns {boolean}
     */
    isBot(o) {
        return !!this.botUserId && o.user === this.botUserId;
    }

    /**
     * @param {import('../api/types').FrameObject} o
     * @returns {boolean}
     */
    isNpc(o) {
        return NPC_USERS.has(String(o.user));
    }
}

// ─── StaticLayers ───────────────────────────────────────────────────────────

const STRUCT_TYPES = new Set([
    'spawn',
    'extension',
    'tower',
    'storage',
    'terminal',
    'link',
    'lab',
    'factory',
    'observer',
    'nuker',
    'powerSpawn',
    'container',
    'road',
    'rampart',
    'constructedWall',
    'controller',
    'invaderCore',
    'keeperLair',
    'extractor',
    'source',
    'mineral',
    'constructionSite',
]);

/**
 * Compute an epoch key for a frame — excludes energy/progress.
 * @param {Object} frame
 * @returns {string}
 */
export function epochKey(frame) {
    const parts = [];
    for (const o of frame.objects || []) {
        if (!STRUCT_TYPES.has(o.type)) continue;
        parts.push(o.type + ',' + o.room + ',' + o.x + ',' + o.y + ',' + (o.level ?? '') + ',' + (o.user ?? ''));
    }
    parts.sort();
    return parts.join('|');
}

/**
 * Static offscreen layers: terrain (unchanging) + structures (epoch-based).
 */
export class StaticLayers {
    /** @type {HTMLCanvasElement} */
    terrain;
    /** @type {HTMLCanvasElement} */
    structure;
    /** @type {string} */
    key;
    /** @type {import('./layout').StageLayout} */
    layout;
    /** @type {number} */
    res;

    /**
     * @param {Object} recording — { terrain, frames }
     * @param {import('./layout').StageLayout} layout
     * @param {number} [res]
     */
    constructor(recording, layout, res = STATIC_RES) {
        this.layout = layout;
        this.res = res;
        this.terrain = buildTerrainCanvas(recording.terrain || {}, layout, res);
        const firstFrame = recording.frames && recording.frames.length > 0 ? recording.frames[0] : { objects: [] };
        this.structure = buildStructureCanvas(firstFrame, layout, res);
        this.key = epochKey(firstFrame);
    }

    /**
     * Update structure canvas if the epoch has changed.
     * @param {Object} frame
     * @returns {boolean} true if updated
     */
    updateIfNeeded(frame) {
        const newKey = epochKey(frame);
        if (newKey === this.key) return false;
        this.structure = buildStructureCanvas(frame, this.layout, this.res);
        this.key = newKey;
        return true;
    }

    /**
     * @param {Object} recording
     * @returns {boolean}
     */
    static hasTerrain(recording) {
        return recording.terrain && Object.keys(recording.terrain).length > 0;
    }
}
