import { describe, it, expect } from 'vitest';
import { zoomToward } from '../src/canvas/math';

describe('zoomToward', () => {
    it('zoom in doubles zoom, anchor stays fixed', () => {
        const cam = { x: 100, y: 100, zoom: 1 };
        const result = zoomToward(cam, 300, 200, 2);
        expect(result.zoom).toBe(2);
        expect(result.x).toBeCloseTo(-100);
        expect(result.y).toBeCloseTo(0);
    });

    it('zoom out halves zoom, anchor stays fixed', () => {
        const cam = { x: 400, y: 300, zoom: 2 };
        const result = zoomToward(cam, 400, 300, 0.5);
        expect(result.zoom).toBe(1);
        expect(result.x).toBeCloseTo(400);
        expect(result.y).toBeCloseTo(300);
    });

    it('zoom out from center, anchor stays fixed', () => {
        const cam = { x: 500, y: 400, zoom: 1 };
        const result = zoomToward(cam, 500, 400, 0.5);
        expect(result.zoom).toBe(0.5);
        expect(result.x).toBeCloseTo(500);
        expect(result.y).toBeCloseTo(400);
    });

    it('clamps to max zoom 10', () => {
        const cam = { x: 0, y: 0, zoom: 10 };
        const result = zoomToward(cam, 100, 100, 1.3);
        expect(result.zoom).toBe(10);
        expect(Number.isNaN(result.x)).toBe(false);
        expect(Number.isNaN(result.y)).toBe(false);
    });

    it('clamps to min zoom 0.1', () => {
        const cam = { x: 0, y: 0, zoom: 0.1 };
        const result = zoomToward(cam, 100, 100, 0.5);
        expect(result.zoom).toBe(0.1);
    });

    it('handles zero zoom safely', () => {
        const cam = { x: 0, y: 0, zoom: 0 };
        const result = zoomToward(cam, 100, 100, 2);
        expect(result.zoom).toBe(0.1);
        expect(Number.isNaN(result.x)).toBe(false);
    });

    it('zoom at origin with large factor is stable', () => {
        const cam = { x: 0, y: 0, zoom: 1 };
        const result = zoomToward(cam, 0, 0, 10);
        expect(result.zoom).toBe(10);
        expect(result.x).toBeCloseTo(0);
        expect(result.y).toBeCloseTo(0);
    });

    it('handles negative factor', () => {
        const cam = { x: 100, y: 100, zoom: 1 };
        const result = zoomToward(cam, 200, 200, -1);
        expect(result.zoom).toBe(0.1);
    });

    it('zoom in then out returns to original', () => {
        const cam = { x: 100, y: 100, zoom: 1 };
        const zoomedIn = zoomToward(cam, 300, 200, 2);
        const zoomedOut = zoomToward(zoomedIn, 300, 200, 0.5);
        expect(zoomedOut.zoom).toBeCloseTo(1);
        expect(zoomedOut.x).toBeCloseTo(100);
        expect(zoomedOut.y).toBeCloseTo(100);
    });
});
