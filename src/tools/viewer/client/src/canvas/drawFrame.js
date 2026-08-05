// Adapted from screeps-dojo (MIT).
// Per-frame render orchestration. Draws terrain → structures → creeps → effects.
// Works in TILE coordinates — the caller applies the world→screen transform.

import { lerp, tPos, tFx, nextLocal, creepFacing } from './layout';
import { circle, poly } from './primitives';

const CREEP_SIZE_TILES = 1.25;

/**
 * Draw a creep sprite at world tile coords.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLImageElement} img
 * @param {number} wx
 * @param {number} wy
 * @param {number} angleDeg
 * @param {number} opacity
 * @param {boolean} isNpc
 */
function drawSprite(ctx, img, wx, wy, angleDeg, opacity, isNpc) {
    const S = isNpc ? 0.95 : CREEP_SIZE_TILES;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(wx, wy);
    if (angleDeg) ctx.rotate((angleDeg * Math.PI) / 180);
    ctx.drawImage(img, -S / 2, -S / 2, S, S);
    ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} obj
 * @param {number} wx
 * @param {number} wy
 * @param {number} opacity
 */
function drawHpBar(ctx, obj, wx, wy, opacity) {
    if (!obj.hitsMax || obj.hitsMax <= 0) return;
    const frac = Math.max(0, Math.min(1, (obj.hits || 0) / obj.hitsMax));
    if (frac >= 1) return;
    ctx.save();
    ctx.globalAlpha = opacity;
    const barW = 0.8,
        barH = 0.08,
        barY = wy - 0.7;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(wx - barW / 2, barY, barW, barH);
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(wx - barW / 2, barY, barW * frac, barH);
    ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} actionSrc
 * @param {number} wx
 * @param {number} wy
 * @param {number|null} sub
 * @param {Object} off
 * @param {string} room
 */
function drawEffects(ctx, actionSrc, wx, wy, sub, off, room) {
    if (sub === null || !actionSrc.actionLog) return;

    const log = actionSrc.actionLog;

    // Attack — red flash
    if (log.attack && typeof log.attack.x === 'number') {
        const fxT = tFx(sub);
        if (fxT > 0) {
            const tx = log.attack.x + (off[room]?.col || 0) * 50;
            const ty = log.attack.y + (off[room]?.row || 0) * 50;
            ctx.save();
            ctx.globalAlpha = 0.6 * (1 - fxT);
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 0.1;
            ctx.beginPath();
            ctx.moveTo(wx, wy);
            ctx.lineTo(tx + 0.5, ty + 0.5);
            ctx.stroke();
            ctx.restore();
        }
    }

    // Harvest — yellow pulse
    if (log.harvest && typeof log.harvest.x === 'number') {
        const fxT = tFx(sub);
        if (fxT > 0) {
            const tx = log.harvest.x + (off[room]?.col || 0) * 50;
            const ty = log.harvest.y + (off[room]?.row || 0) * 50;
            ctx.save();
            ctx.globalAlpha = 0.5 * (1 - fxT);
            ctx.fillStyle = '#FFE87B';
            circle(ctx, tx + 0.5, ty + 0.5, { radius: 0.3 * fxT, fill: '#FFE87B' });
            ctx.restore();
        }
    }
}

/**
 * Index objects by _id.
 * @param {Object[]} objects
 * @returns {Object<string,Object>}
 */
function indexById(objects) {
    /** @type {Object<string,Object>} */
    const idx = {};
    for (const o of objects) {
        idx[o._id] = o;
    }
    return idx;
}

/**
 * Draw one frame at sub-frame `sub`.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} recording — { terrain, frames }
 * @param {number} tick — tick index
 * @param {number|null} sub — sub-frame [0,1) or null for static
 * @param {{sprites: SpriteCache, layers: StaticLayers, layout: StageLayout, showVisuals: boolean}} opts
 */
export function drawFrame(ctx, recording, tick, sub, opts) {
    const { sprites, layers, layout } = opts;
    const frames = recording.frames;
    const count = frames.length;
    const i = Math.max(0, Math.min(count - 1, tick));
    const base = frames[i];
    const next = sub !== null && i + 1 < count ? frames[i + 1] : null;
    const off = layout.offsets;
    const colsTiles = (layout.width / layout.pixelsPerRoom) * 50;
    const rowsTiles = (layout.height / layout.pixelsPerRoom) * 50;

    if (!base) return;

    // 1) Static layers
    ctx.drawImage(layers.terrain, 0, 0, colsTiles, rowsTiles);
    ctx.drawImage(layers.structure, 0, 0, colsTiles, rowsTiles);

    // World tile coords for the CENTER of a room-local tile
    const wpos = (room, x, y) => {
        const o = off[room];
        return o ? { wx: o.col * 50 + x + 0.5, wy: o.row * 50 + y + 0.5 } : null;
    };

    const baseById = indexById(base.objects);
    const nextById = next ? indexById(next.objects) : null;

    // 2) Creeps (interpolated) + HP
    for (const obj of base.objects) {
        if (obj.type !== 'creep') continue;
        if (obj.spawning) {
            const p = wpos(obj.room, obj.x, obj.y);
            if (!p) continue;
            const sprite = sprites.isNpc(obj) ? sprites.invaderSprite() : sprites.creepSprite(obj);
            if (sprite) drawSprite(ctx, sprite, p.wx, p.wy, 0, 1, sprites.isNpc(obj));
            continue;
        }
        let x = obj.x,
            y = obj.y,
            room = obj.room,
            opacity = 1;
        let actionSrc = obj;
        if (next && sub !== null) {
            const n = nextById ? nextById[obj._id] : null;
            if (n && (n.room === obj.room || off[n.room])) {
                const nl = nextLocal(obj, n, layout);
                const tp = tPos(sub);
                x = lerp(obj.x, nl.x, tp);
                y = lerp(obj.y, nl.y, tp);
                actionSrc = n;
            } else {
                opacity = 1 - sub;
            }
        }
        const p = wpos(room, x, y);
        if (!p) continue;
        const facing = creepFacing(frames, i, obj._id, layout);
        const sprite = sprites.isNpc(obj) ? sprites.invaderSprite() : sprites.creepSprite(obj);
        if (sprite) drawSprite(ctx, sprite, p.wx, p.wy, facing, opacity, sprites.isNpc(obj));
        drawHpBar(ctx, obj, p.wx, p.wy, opacity);
        drawEffects(ctx, actionSrc, p.wx, p.wy, sub, off, room);
    }

    // Creeps that appear only next frame (spawned): fade in
    if (next && sub !== null) {
        for (const n of next.objects) {
            if (n.type !== 'creep' || n.spawning || baseById[n._id]) continue;
            const p = wpos(n.room, n.x, n.y);
            if (!p) continue;
            const sprite = sprites.isNpc(n) ? sprites.invaderSprite() : sprites.creepSprite(n);
            if (sprite)
                drawSprite(ctx, sprite, p.wx, p.wy, creepFacing(frames, i + 1, n._id, layout), sub, sprites.isNpc(n));
        }
    }
}
