import '@testing-library/jest-dom';

// ─── Canvas mock with pixel tracking ──────────────────────────────────────
// jsdom doesn't support HTMLCanvasElement.getContext, so we provide a mock
// that records draw operations and tracks a real pixel buffer. This lets
// tests verify that the canvas is not blank after rendering.

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {CanvasRenderingContext2D & { _canvas: HTMLCanvasElement, _nonEmpty: () => boolean }}
 */
function createMockContext(canvas) {
    const w = canvas.width || 800;
    const h = canvas.height || 600;
    const buf = new Uint8ClampedArray(w * h * 4);

    const stateStack = [];
    let currentAlpha = 1;
    let currentFill = '#000000';
    let currentStroke = '#000000';
    let currentLineWidth = 1;
    let tx = 0,
        ty = 0,
        sx = 1,
        sy = 1;

    // Path bounding box tracking (tile coords)
    let pathMinX, pathMinY, pathMaxX, pathMaxY;

    function pathReset() {
        pathMinX = pathMinY = Infinity;
        pathMaxX = pathMaxY = -Infinity;
    }
    pathReset();

    function pathAdd(x, y) {
        if (x < pathMinX) pathMinX = x;
        if (y < pathMinY) pathMinY = y;
        if (x > pathMaxX) pathMaxX = x;
        if (y > pathMaxY) pathMaxY = y;
    }

    function save() {
        stateStack.push({
            alpha: currentAlpha,
            fill: currentFill,
            stroke: currentStroke,
            lineWidth: currentLineWidth,
            tx,
            ty,
            sx,
            sy,
        });
    }
    function restore() {
        const s = stateStack.pop();
        if (s) {
            currentAlpha = s.alpha;
            currentFill = s.fill;
            currentStroke = s.stroke;
            currentLineWidth = s.lineWidth;
            tx = s.tx;
            ty = s.ty;
            sx = s.sx;
            sy = s.sy;
        }
    }

    /** Set all pixels in a rect to a non-transparent sentinel value. */
    function fillRect(x, y, rw, rh) {
        const x0 = Math.max(0, Math.round(x * sx + tx));
        const y0 = Math.max(0, Math.round(y * sy + ty));
        const x1 = Math.min(w, Math.round((x + rw) * sx + tx));
        const y1 = Math.min(h, Math.round((y + rh) * sy + ty));
        for (let py = y0; py < y1; py++) {
            for (let px = x0; px < x1; px++) {
                const i = (py * w + px) * 4;
                buf[i] = buf[i + 1] = buf[i + 2] = 200;
                buf[i + 3] = Math.round(255 * currentAlpha);
            }
        }
    }

    /** Set all pixels in a rect from a source image/canvas (simplified: mark as drawn). */
    function drawImage(source, dx, dy, dw, dh) {
        const usedW = dw !== undefined ? dw : source.width || 50;
        const usedH = dh !== undefined ? dh : source.height || 50;
        fillRect(dx, dy, usedW, usedH);
    }

    /** Fill bounding box of tracked path commands (screen coords). */
    function fillPath() {
        if (!isFinite(pathMinX)) return; // no path commands recorded
        const x0 = Math.max(0, Math.round(pathMinX * sx + tx));
        const y0 = Math.max(0, Math.round(pathMinY * sy + ty));
        const x1 = Math.min(w, Math.round(pathMaxX * sx + tx));
        const y1 = Math.min(h, Math.round(pathMaxY * sy + ty));
        for (let py = y0; py < y1; py++) {
            for (let px = x0; px < x1; px++) {
                const i = (py * w + px) * 4;
                buf[i] = buf[i + 1] = buf[i + 2] = 200;
                buf[i + 3] = Math.round(255 * currentAlpha);
            }
        }
    }

    const ctx = {
        _canvas: canvas,
        _nonEmpty() {
            for (let i = 3; i < buf.length; i += 4) {
                if (buf[i] > 0) return true;
            }
            return false;
        },
        _pixelCount() {
            let count = 0;
            for (let i = 3; i < buf.length; i += 4) {
                if (buf[i] > 0) count++;
            }
            return count;
        },

        save,
        restore,
        translate(dx, dy) {
            tx += dx;
            ty += dy;
        },
        scale(nsx, nsy) {
            sx *= nsx;
            sy *= nsy !== undefined ? nsy : nsx;
        },
        setTransform(a, b, c, d, e, f) {
            tx = e;
            ty = f;
            sx = a;
            sy = d;
        },
        resetTransform() {
            tx = 0;
            ty = 0;
            sx = 1;
            sy = 1;
        },

        fillRect,
        clearRect(x, y, rw, rh) {
            // Clear = set alpha to 0
            const x0 = Math.round(x),
                y0 = Math.round(y);
            const x1 = Math.min(w, Math.round(x + rw)),
                y1 = Math.min(h, Math.round(y + rh));
            for (let py = y0; py < y1; py++) {
                for (let px = x0; px < x1; px++) {
                    buf[(py * w + px) * 4 + 3] = 0;
                }
            }
        },
        drawImage,
        fillText() {
            /* no-op for pixel tracking */
        },
        measureText(str) {
            return { width: (str || '').length * 6 };
        },

        getImageData(x, y, rw, rh) {
            const out = new Uint8ClampedArray(rw * rh * 4);
            for (let py = 0; py < rh; py++) {
                const srcOff = ((y + py) * w + x) * 4;
                const dstOff = py * rw * 4;
                for (let px = 0; px < rw * 4; px++) {
                    out[dstOff + px] = buf[srcOff + px];
                }
            }
            return { data: out, width: rw, height: rh };
        },

        beginPath() {
            pathReset();
        },
        arc(x, y, r) {
            pathAdd(x - r, y - r);
            pathAdd(x + r, y + r);
        },
        moveTo(x, y) {
            pathAdd(x, y);
        },
        lineTo(x, y) {
            pathAdd(x, y);
        },
        closePath() {},
        fill() {
            fillPath();
        },
        stroke() {
            fillPath();
        },
        setLineDash() {},

        set globalAlpha(v) {
            currentAlpha = v;
        },
        get globalAlpha() {
            return currentAlpha;
        },
        set fillStyle(v) {
            currentFill = v;
        },
        get fillStyle() {
            return currentFill;
        },
        set strokeStyle(v) {
            currentStroke = v;
        },
        get strokeStyle() {
            return currentStroke;
        },
        set lineWidth(v) {
            currentLineWidth = v;
        },
        get lineWidth() {
            return currentLineWidth;
        },
    };

    return ctx;
}

// ─── Container sizing ───────────────────────────────────────────────────────
// jsdom elements have 0 width/height by default. CanvasStage computes camera
// zoom from container size — 0 leads to 0 scale and blank canvas.

Object.defineProperties(HTMLElement.prototype, {
    clientWidth: {
        get() {
            return parseInt(this.style.width) || this._jsdomClientWidth || 1024;
        },
        configurable: true,
    },
    clientHeight: {
        get() {
            return parseInt(this.style.height) || this._jsdomClientHeight || 768;
        },
        configurable: true,
    },
});

HTMLCanvasElement.prototype.getBoundingClientRect = function () {
    return {
        width: this.width || 800,
        height: this.height || 600,
        top: 0,
        left: 0,
        right: this.width || 800,
        bottom: this.height || 600,
        x: 0,
        y: 0,
        toJSON() {
            return this;
        },
    };
};
const origGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type) {
    if (type === '2d') {
        return createMockContext(this);
    }
    return origGetContext.call(this, type);
};

// ─── EventSource mock ────────────────────────────────────────────────────

class MockEventSource {
    constructor() {
        this.onmessage = null;
        this.onerror = null;
        this.onopen = null;
        this.readyState = 1;
    }
    close() {
        this.readyState = 2;
    }
}
global.EventSource = MockEventSource;

// ─── requestAnimationFrame ───────────────────────────────────────────────
// CanvasStage runs an animation loop via RAF only when `playing===true`.
// All tests set `playing=false` before injecting frames, so the loop
// never fires. A simple setTimeout mock is adequate for this suite.
// If future tests need to exercise the animation loop, switch to
// `vi.useFakeTimers()` + `vi.advanceTimersByTime(16)`.

global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);
