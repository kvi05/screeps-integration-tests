// Adapted from screeps-dojo (MIT).
// Offscreen canvas layers: terrain + static structures. Cached until the
// structure layout changes (epoch-based invalidation).

import { drawStructureShell, connectRoads } from './structures';
import { circle, text } from './primitives';

export const STATIC_RES = 24; // px per tile for offscreen layers

/** @type {Object<string, string>} Terrain tile → fill colour */
const TILE_COLORS = { '.': '#2b2b2b', '~': '#23311e', '#': '#111111' };
/** @type {string} Default room background colour */
const ROOM_BG = '#2b2b2b';

/**
 * Draw one room's terrain at room-local integer tile coords.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string[]} rows — 50 strings of 50 chars each
 */
export function drawTerrain(ctx, rows) {
    ctx.save();
    ctx.fillStyle = ROOM_BG;
    ctx.fillRect(0, 0, 50, 50);
    for (let y = 0; y < 50; y++) {
        const row = rows[y] || '';
        for (let x = 0; x < 50; x++) {
            const ch = row[x];
            if (ch === '.' || ch === undefined) continue;
            ctx.fillStyle = TILE_COLORS[ch] || ROOM_BG;
            ctx.fillRect(x, y, 1, 1);
        }
    }
    // Faint tile grid
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    for (let i = 1; i < 50; i++) {
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 50);
        ctx.moveTo(0, i);
        ctx.lineTo(50, i);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Exit chevrons on walkable border tiles
    ctx.strokeStyle = '#9bd49b';
    ctx.lineWidth = 0.08;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    const chevron = (tileX, tileY, dirX, dirY) => {
        const cx = tileX + 0.5,
            cy = tileY + 0.5;
        const px = -dirY,
            py = dirX;
        const ax = cx - 0.15 * dirX + 0.25 * px,
            ay = cy - 0.15 * dirY + 0.25 * py;
        const tipX = cx + 0.3 * dirX,
            tipY = cy + 0.3 * dirY;
        const bx = cx - 0.15 * dirX - 0.25 * px,
            by = cy - 0.15 * dirY - 0.25 * py;
        ctx.moveTo(ax, ay);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(bx, by);
    };
    for (let i = 1; i < 49; i++) {
        if (rows[i] && rows[i][0] !== '#') chevron(0, i, -1, 0);
        if (rows[i] && rows[i][49] !== '#') chevron(49, i, 1, 0);
        if (rows[0] && rows[0][i] !== '#') chevron(i, 0, 0, -1);
        if (rows[49] && rows[49][i] !== '#') chevron(i, 49, 0, 1);
    }
    ctx.stroke();
    ctx.restore();
}

/**
 * Build the terrain offscreen canvas for all rooms.
 *
 * @param {Object<string,string[]>} terrain — roomName → rows
 * @param {import('./layout').StageLayout} layout
 * @param {number} [res]
 * @returns {HTMLCanvasElement}
 */
export function buildTerrainCanvas(terrain, layout, res = STATIC_RES) {
    const colsTiles = (layout.width / layout.pixelsPerRoom) * 50;
    const rowsTiles = (layout.height / layout.pixelsPerRoom) * 50;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(colsTiles * res));
    cv.height = Math.max(1, Math.round(rowsTiles * res));
    const ctx = cv.getContext('2d');
    ctx.scale(res, res);
    for (const room of Object.keys(terrain)) {
        const off = layout.offsets[room];
        if (!off) continue;
        ctx.save();
        ctx.translate(off.col * 50, off.row * 50);
        drawTerrain(ctx, terrain[room]);
        ctx.restore();
    }
    return cv;
}

const SHELL_TYPES = new Set([
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
    'invaderCore',
    'keeperLair',
    'extractor',
]);

/**
 * Draw static structures for one frame onto a context.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} frame — { objects: FrameObject[] }
 * @param {import('./layout').StageLayout} layout
 */
export function drawStaticStructures(ctx, frame, layout) {
    for (const room of Object.keys(layout.offsets)) {
        const off = layout.offsets[room];
        ctx.save();
        ctx.translate(off.col * 50, off.row * 50);
        const roads = [];
        for (const o of frame.objects) {
            if (o.room !== room) continue;
            if (SHELL_TYPES.has(o.type)) {
                drawStructureShell(ctx, o.x, o.y, o.type);
                if (o.type === 'road') roads.push([o.x, o.y]);
            } else if (o.type === 'source') {
                circle(ctx, o.x + 0.5, o.y + 0.5, {
                    radius: 0.35,
                    fill: '#0a0a0a',
                    stroke: '#333333',
                    strokeWidth: 0.04,
                });
            } else if (o.type === 'mineral') {
                circle(ctx, o.x + 0.5, o.y + 0.5, { radius: 0.35, fill: '#ffffff', opacity: 0.6 });
            } else if (o.type === 'controller') {
                if (o.x === 0 && o.y === 0 && !o.user && !((o.level ?? 0) > 0)) continue;
                circle(ctx, o.x + 0.5, o.y + 0.5, {
                    radius: 0.6,
                    fill: '#181818',
                    stroke: '#888888',
                    strokeWidth: 0.05,
                });
                text(ctx, String(o.level ?? 0), o.x + 0.5, o.y + 0.5 + 0.17, { font: 0.5, fill: '#ffffff' });
            } else if (o.type === 'constructionSite') {
                circle(ctx, o.x + 0.5, o.y + 0.5, { radius: 0.4, fill: '#d3d3d3', opacity: 0.7 });
            }
        }
        connectRoads(ctx, roads);
        ctx.restore();
    }
}

/**
 * Build the structure offscreen canvas for one frame.
 *
 * @param {Object} frame
 * @param {import('./layout').StageLayout} layout
 * @param {number} [res]
 * @returns {HTMLCanvasElement}
 */
export function buildStructureCanvas(frame, layout, res = STATIC_RES) {
    const colsTiles = (layout.width / layout.pixelsPerRoom) * 50;
    const rowsTiles = (layout.height / layout.pixelsPerRoom) * 50;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(colsTiles * res));
    cv.height = Math.max(1, Math.round(rowsTiles * res));
    const ctx = cv.getContext('2d');
    ctx.scale(res, res);
    drawStaticStructures(ctx, frame, layout);
    return cv;
}
