// Adapted from screeps-dojo (MIT).
// Room name → grid position computation for multi-room layout.

const ROOM_NAME_PATTERN = /^([WE])(\d+)([NS])(\d+)$/;

/**
 * Convert a Screeps room name to world coordinates.
 * W rooms are negative, E positive; N negative, S positive.
 *
 * @param {string} name — e.g. 'W0N1'
 * @returns {{x:number, y:number}}
 */
export function roomNameToXY(name) {
    const m = ROOM_NAME_PATTERN.exec(name);
    if (!m) return { x: 0, y: 0 };
    const x = m[1] === 'W' ? -Number(m[2]) - 1 : Number(m[2]);
    const y = m[3] === 'N' ? -Number(m[4]) - 1 : Number(m[4]);
    return { x, y };
}

/**
 * Linear interpolation.
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
export function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * @typedef {Object} StageLayout
 * @property {string[]} rooms
 * @property {Object<string,{col:number, row:number}>} offsets
 * @property {number} pixelsPerRoom
 * @property {number} width
 * @property {number} height
 */

/**
 * Build a layout from a list of room names.
 *
 * @param {string[]} rooms
 * @param {number} [pixelsPerRoom=600]
 * @returns {StageLayout}
 */
export function computeStageLayout(rooms, pixelsPerRoom = 600) {
    const positions = rooms.map((name) => ({ name, ...roomNameToXY(name) }));
    const minX = positions.length ? Math.min(...positions.map((p) => p.x)) : 0;
    const minY = positions.length ? Math.min(...positions.map((p) => p.y)) : 0;
    /** @type {Object<string,{col:number, row:number}>} */
    const offsets = {};
    let columns = 1,
        rows = 1;
    for (const p of positions) {
        const col = p.x - minX,
            row = p.y - minY;
        offsets[p.name] = { col, row };
        columns = Math.max(columns, col + 1);
        rows = Math.max(rows, row + 1);
    }
    return { rooms, offsets, pixelsPerRoom, width: columns * pixelsPerRoom, height: rows * pixelsPerRoom };
}

/**
 * Half-tick split: creep holds at base for the first half, glides over the second.
 * @param {number} s — sub-frame [0, 1)
 * @returns {number}
 */
export function tPos(s) {
    return Math.max(0, 2 * s - 1);
}

/**
 * Actions/effects animate over the first half, gone by mid-tick.
 * @param {number} s — sub-frame [0, 1)
 * @returns {number}
 */
export function tFx(s) {
    return s < 0.5 ? s / 0.5 : 0;
}

/**
 * Next position expressed in the BASE room's local space (cross-room seam glide).
 *
 * @param {import('../api/types').FrameObject} base
 * @param {import('../api/types').FrameObject} next
 * @param {StageLayout} layout
 * @returns {{x:number, y:number}}
 */
export function nextLocal(base, next, layout) {
    if (next.room === base.room) return { x: next.x, y: next.y };
    const o = layout.offsets;
    if (!o[next.room] || !o[base.room]) return { x: next.x, y: next.y };
    return {
        x: next.x + (o[next.room].col - o[base.room].col) * 50,
        y: next.y + (o[next.room].row - o[base.room].row) * 50,
    };
}

const ACTION_KEYS = ['harvest', 'attack', 'upgradeController', 'heal', 'rangedAttack', 'rangedHeal', 'build'];

/**
 * Compute the facing angle of a creep.
 *
 * @param {Object[]} frames
 * @param {number} frameIndex
 * @param {string} objectId
 * @param {StageLayout} layout
 * @param {number} [fallbackAngle=0]
 * @returns {number} angle in degrees
 */
export function creepFacing(frames, frameIndex, objectId, layout, fallbackAngle = 0) {
    const offsets = layout ? layout.offsets : null;
    const posAt = (fi) => {
        const frame = frames[fi];
        if (!frame) return null;
        for (let i = 0; i < frame.objects.length; i++) if (frame.objects[i]._id === objectId) return frame.objects[i];
        return null;
    };
    const worldDelta = (a, b) => {
        let dx, dy;
        if (a.room === b.room) {
            dx = b.x - a.x;
            dy = b.y - a.y;
        } else {
            if (!offsets || !offsets[a.room] || !offsets[b.room]) return null;
            dx = b.x + offsets[b.room].col * 50 - (a.x + offsets[a.room].col * 50);
            dy = b.y + offsets[b.room].row * 50 - (a.y + offsets[a.room].row * 50);
        }
        return dx !== 0 || dy !== 0 ? { dx, dy } : null;
    };
    const curr = posAt(frameIndex);
    const next = posAt(frameIndex + 1);
    if (curr && next && next.actionLog) {
        for (const key of ACTION_KEYS) {
            const target = next.actionLog[key];
            if (target && typeof target.x === 'number' && typeof target.y === 'number') {
                const delta = worldDelta(curr, { room: next.room, x: target.x, y: target.y });
                if (delta) return (Math.atan2(delta.dy, delta.dx) * 180) / Math.PI;
            }
        }
    }
    if (curr && next) {
        const delta = worldDelta(curr, next);
        if (delta) return (Math.atan2(delta.dy, delta.dx) * 180) / Math.PI;
    }
    for (let k = frameIndex; k >= 1; k--) {
        const a = posAt(k - 1);
        const b = posAt(k);
        if (a && b) {
            const delta = worldDelta(a, b);
            if (delta) return (Math.atan2(delta.dy, delta.dx) * 180) / Math.PI;
        }
    }
    return fallbackAngle;
}
