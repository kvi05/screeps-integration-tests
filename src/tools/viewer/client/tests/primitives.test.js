import { describe, it, expect } from 'vitest';
import { circle, poly, rect, line, text } from '../src/canvas/primitives';

/**
 * Creates a mock CanvasRenderingContext2D that records all calls.
 * @returns {CanvasRenderingContext2D & { _calls: Array }}
 */
function createMockCtx() {
    const calls = [];
    const ctx = {
        _calls: calls,
        save() {
            calls.push('save');
        },
        restore() {
            calls.push('restore');
        },
        beginPath() {
            calls.push('beginPath');
        },
        arc(x, y, r) {
            calls.push(['arc', x, y, r]);
        },
        moveTo(x, y) {
            calls.push(['moveTo', x, y]);
        },
        lineTo(x, y) {
            calls.push(['lineTo', x, y]);
        },
        closePath() {
            calls.push('closePath');
        },
        fill() {
            calls.push('fill');
        },
        stroke() {
            calls.push('stroke');
        },
        fillRect(x, y, w, h) {
            calls.push(['fillRect', x, y, w, h]);
        },
        fillText(str, x, y) {
            calls.push(['fillText', str, x, y]);
        },
        setLineDash(arr) {
            calls.push(['setLineDash', arr]);
        },
    };

    return new Proxy(ctx, {
        get(target, prop) {
            if (prop === '_calls') return calls;
            if (typeof target[prop] === 'function') return target[prop];
            return target[prop];
        },
        set(target, prop, value) {
            calls.push([prop, value]);
            target[prop] = value;
            return true;
        },
    });
}

function callsOfType(calls, type) {
    return calls.filter((c) => (Array.isArray(c) ? c[0] === type : c === type));
}

describe('circle', () => {
    it('draws arc path', () => {
        const ctx = createMockCtx();
        circle(ctx, 25, 25, { radius: 0.65, fill: '#FFE87B' });
        expect(ctx._calls).toContain('beginPath');
        const arcCall = callsOfType(ctx._calls, 'arc')[0];
        expect(arcCall[1]).toBe(25);
        expect(arcCall[3]).toBe(0.65);
    });

    it('with fill and stroke calls both', () => {
        const ctx = createMockCtx();
        circle(ctx, 10, 10, { radius: 0.5, fill: '#F00', stroke: '#00F' });
        expect(ctx._calls).toContain('fill');
        expect(ctx._calls).toContain('stroke');
    });

    it('without fill skips fill', () => {
        const ctx = createMockCtx();
        circle(ctx, 10, 10, { radius: 0.5, stroke: '#000' });
        expect(ctx._calls).toContain('stroke');
        expect(ctx._calls).not.toContain('fill');
    });
});

describe('rect', () => {
    it('draws filled rectangle', () => {
        const ctx = createMockCtx();
        rect(ctx, 10, 20, 0.8, 0.6, { fill: '#555' });
        const calls = callsOfType(ctx._calls, 'fillRect');
        expect(calls.length).toBe(1);
        expect(calls[0][1]).toBe(10);
        expect(calls[0][2]).toBe(20);
    });
});

describe('poly', () => {
    it('draws polygon', () => {
        const ctx = createMockCtx();
        poly(
            ctx,
            [
                [0, 0],
                [1, 0],
                [0.5, 1],
            ],
            { fill: '#F00' },
        );
        expect(ctx._calls).toContain('beginPath');
        expect(ctx._calls).toContain('closePath');
        expect(callsOfType(ctx._calls, 'moveTo').length).toBe(1);
        expect(callsOfType(ctx._calls, 'lineTo').length).toBe(2);
    });
});

describe('line', () => {
    it('draws a line segment', () => {
        const ctx = createMockCtx();
        line(ctx, 0, 0, 10, 20, { color: '#F00', width: 0.1 });
        expect(ctx._calls).toContain('stroke');
        expect(callsOfType(ctx._calls, 'moveTo')[0][1]).toBe(0);
        expect(callsOfType(ctx._calls, 'lineTo')[0][1]).toBe(10);
    });
});

describe('text', () => {
    it('calls fillText', () => {
        const ctx = createMockCtx();
        text(ctx, 'Hello', 5, 10, { color: '#000', font: '0.5 sans-serif' });
        const calls = callsOfType(ctx._calls, 'fillText');
        expect(calls[0][1]).toBe('Hello');
    });
});

describe('save/restore', () => {
    it('each primitive saves and restores', () => {
        const primitives = [
            ['circle', circle, [createMockCtx(), 0, 0, {}]],
            ['rect', rect, [createMockCtx(), 0, 0, 1, 1, {}]],
            ['line', line, [createMockCtx(), 0, 0, 1, 1, {}]],
            ['text', text, [createMockCtx(), '', 0, 0, {}]],
        ];
        for (const [, fn, args] of primitives) {
            fn(...args);
            expect(args[0]._calls).toContain('save');
            expect(args[0]._calls).toContain('restore');
        }
    });
});
