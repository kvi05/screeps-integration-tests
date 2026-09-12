// Adapted from screeps-dojo (MIT) — Canvas 2D primitives in TILE coordinates.
// Semantics match lib/RoomVisual.js so structure shells render identically to SVG.

/**
 * @typedef {Object} ShapeStyle
 * @property {string|null|false} [fill]
 * @property {string|null|false|boolean} [stroke]
 * @property {number} [strokeWidth]
 * @property {number} [opacity]
 * @property {number} [radius]
 * @property {'dashed'|'dotted'|'solid'} [lineStyle]
 * @property {number|string} [font]
 * @property {CanvasTextAlign} [align]
 */

/**
 * @param {string|null|false|boolean} v
 * @returns {string|null}
 */
function paintColor(v) {
    return typeof v === 'string' && v !== 'transparent' ? v : null;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} [lineStyle]
 */
function applyDash(ctx, lineStyle) {
    if (lineStyle === 'dashed') ctx.setLineDash([0.15, 0.1]);
    else if (lineStyle === 'dotted') ctx.setLineDash([0.05, 0.05]);
}

/**
 * Draw a filled/stroked circle.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x — centre x (tile coords)
 * @param {number} y — centre y (tile coords)
 * @param {ShapeStyle} [s]
 */
export function circle(ctx, x, y, s = {}) {
    ctx.save();
    ctx.globalAlpha = s.opacity ?? 1;
    applyDash(ctx, s.lineStyle);
    ctx.beginPath();
    ctx.arc(x, y, s.radius ?? 0.15, 0, Math.PI * 2);
    const fill = paintColor(s.fill);
    const stroke = paintColor(s.stroke);
    if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
    }
    if (stroke) {
        ctx.lineWidth = s.strokeWidth ?? 0.05;
        ctx.strokeStyle = stroke;
        ctx.stroke();
    }
    ctx.restore();
}

/**
 * Draw a filled/stroked polygon.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number[][]} points — array of [x, y] pairs
 * @param {ShapeStyle} [s]
 */
export function poly(ctx, points, s = {}) {
    if (!points.length) return;
    ctx.save();
    ctx.globalAlpha = s.opacity ?? 1;
    applyDash(ctx, s.lineStyle);
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    const fill = paintColor(s.fill);
    const stroke = paintColor(s.stroke);
    if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
    }
    if (stroke) {
        ctx.lineWidth = s.strokeWidth ?? 0.05;
        ctx.strokeStyle = stroke;
        ctx.stroke();
    }
    ctx.restore();
}

/**
 * Draw a filled/stroked rectangle.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {ShapeStyle} [s]
 */
export function rect(ctx, x, y, w, h, s = {}) {
    ctx.save();
    ctx.globalAlpha = s.opacity ?? 1;
    applyDash(ctx, s.lineStyle);
    const fill = paintColor(s.fill);
    const stroke = paintColor(s.stroke);
    if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, w, h);
    }
    if (stroke) {
        ctx.lineWidth = s.strokeWidth ?? 0.05;
        ctx.strokeStyle = stroke;
        ctx.strokeRect(x, y, w, h);
    }
    ctx.restore();
}

/**
 * Draw a line.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {ShapeStyle} [s]
 */
export function line(ctx, x1, y1, x2, y2, s = {}) {
    ctx.save();
    ctx.globalAlpha = s.opacity ?? 1;
    applyDash(ctx, s.lineStyle);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineWidth = s.strokeWidth ?? 0.1;
    ctx.strokeStyle = paintColor(s.stroke) ?? '#ffffff';
    ctx.stroke();
    ctx.restore();
}

/**
 * Draw text.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} str
 * @param {number} x
 * @param {number} y
 * @param {ShapeStyle} [s]
 */
export function text(ctx, str, x, y, s = {}) {
    ctx.save();
    ctx.globalAlpha = s.opacity ?? 1;
    const size = typeof s.font === 'number' ? s.font : 0.5;
    ctx.font = size + 'px monospace';
    ctx.textAlign = s.align ?? 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = paintColor(s.fill) ?? '#ffffff';
    ctx.fillText(String(str), x, y);
    ctx.restore();
}
