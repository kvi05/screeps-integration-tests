import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpriteCache } from '../src/canvas/caches';

/**
 * SpriteCache.prewarm must be incremental:
 * - only the newest frame is scanned (every creep that ever existed was in the
 *   newest frame at the moment it arrived — a full-buffer scan would
 *   re-rasterize everything on every incoming frame);
 * - a persistent `prewarmed` set survives across calls, so each distinct
 *   appearance is rasterized exactly once;
 * - identical creeps in one frame share a cache key and are rasterized once;
 * - the invader is rasterized once.
 */
describe('SpriteCache incremental prewarm', () => {
    let cache;
    let rasterizeCreep;
    let rasterizeInvader;

    const creep = (overrides = {}) => ({
        _id: 'c1',
        type: 'creep',
        user: '1',
        x: 1,
        y: 1,
        room: 'W0N0',
        body: ['WORK', 'WORK', 'MOVE'],
        store: {},
        storeCapacity: 100,
        ...overrides,
    });

    const recording = (frames) => ({ terrain: {}, frames });

    beforeEach(() => {
        cache = new SpriteCache();
        // Avoid real SVG→Image rasterization (Image.onload never fires in jsdom).
        rasterizeCreep = vi.spyOn(cache, 'rasterizeCreep').mockResolvedValue();
        // The real method sets this.invader — the `if (!this.invader)` guard in
        // prewarm depends on it. Simulate that so "rasterized once" is observable.
        rasterizeInvader = vi.spyOn(cache, 'rasterizeInvader').mockImplementation(function () {
            this.invader = {};
            return Promise.resolve(this.invader);
        });
    });

    it('scans only the newest frame, not the whole buffer', async () => {
        const oldOnly = creep({ _id: 'old' });
        const newest = creep({ _id: 'new' });
        await cache.prewarm(
            recording([
                { gameTime: 0, objects: [oldOnly] },
                { gameTime: 1, objects: [newest] },
            ]),
        );

        // oldOnly was in the buffer but never as the newest frame → skipped.
        expect(rasterizeCreep).toHaveBeenCalledTimes(1);
        expect(rasterizeCreep).toHaveBeenCalledWith(cache.key(newest), newest);
    });

    it('rasterizes each distinct appearance exactly once across prewarm calls', async () => {
        const c = creep();
        await cache.prewarm(recording([{ gameTime: 0, objects: [c] }]));
        await cache.prewarm(recording([{ gameTime: 1, objects: [c] }]));
        await cache.prewarm(recording([{ gameTime: 2, objects: [c] }]));

        expect(rasterizeCreep).toHaveBeenCalledTimes(1);
    });

    it('deduplicates identical creeps within the same frame by appearance key', async () => {
        const a = creep({ _id: 'a' });
        const b = creep({ _id: 'b' }); // same body/store → same key
        await cache.prewarm(recording([{ gameTime: 0, objects: [a, b] }]));

        expect(rasterizeCreep).toHaveBeenCalledTimes(1);
        expect(rasterizeCreep).toHaveBeenCalledWith(cache.key(a), a);
    });

    it('rasterizes new store/body variants as they appear across frames', async () => {
        const base = { body: ['WORK', 'CARRY', 'MOVE'] };
        const empty = creep({ _id: 'e', ...base });
        const quarter = creep({ _id: 'q', ...base, store: { energy: 25 } });
        const half = creep({ _id: 'h', ...base, store: { energy: 50 } });

        await cache.prewarm(recording([{ gameTime: 0, objects: [empty, half] }]));
        expect(rasterizeCreep).toHaveBeenCalledTimes(2);

        // quarter has a new store bucket → rasterized; empty/half already known.
        await cache.prewarm(recording([{ gameTime: 1, objects: [empty, quarter, half] }]));
        expect(rasterizeCreep).toHaveBeenCalledTimes(3);
    });

    it('rasterizes the invader only once across prewarm calls', async () => {
        await cache.prewarm(recording([{ gameTime: 0, objects: [] }]));
        await cache.prewarm(recording([{ gameTime: 1, objects: [] }]));

        expect(rasterizeInvader).toHaveBeenCalledTimes(1);
        expect(rasterizeCreep).not.toHaveBeenCalled();
    });

    it('skips spawning creeps and NPC users', async () => {
        const spawning = creep({ _id: 'sp', spawning: true });
        const npc = creep({ _id: 'npc', user: '2' });
        await cache.prewarm(recording([{ gameTime: 0, objects: [spawning, npc] }]));

        expect(rasterizeCreep).not.toHaveBeenCalled();
        // The invader is still scheduled (it is not part of the NPC skip).
        expect(rasterizeInvader).toHaveBeenCalledTimes(1);
    });

    it('is a no-op for empty or missing recordings', async () => {
        await cache.prewarm({ frames: [] });
        await cache.prewarm({});

        expect(rasterizeCreep).not.toHaveBeenCalled();
        expect(rasterizeInvader).not.toHaveBeenCalled();
    });
});
