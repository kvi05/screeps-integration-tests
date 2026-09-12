'use strict';

/**
 * Unit tests for tickHooks.js — tick interceptor singleton.
 *
 * Cover:
 * - setTickInterceptor → getTickInterceptor round-trip
 * - getTickInterceptor returns null when nothing is set
 * - clearTickInterceptor resets to null
 * - set without intervening clear overwrites the previous interceptor
 * - interceptor shape: beforeTick / afterTick / getTickDelay are all optional
 */

const { setTickInterceptor, getTickInterceptor, clearTickInterceptor } = require('../src/lib/orchestration/tickHooks');

describe('tickHooks', () => {
    afterEach(() => {
        clearTickInterceptor();
    });

    it('getTickInterceptor returns null when nothing is set', () => {
        expect(getTickInterceptor()).toBeNull();
    });

    it('setTickInterceptor → getTickInterceptor round-trip', () => {
        const interceptor = {
            beforeTick: async () => {},
            afterTick: async () => {},
            getTickDelay: () => 0,
        };
        setTickInterceptor(interceptor);
        expect(getTickInterceptor()).toBe(interceptor);
    });

    it('clearTickInterceptor resets to null', () => {
        setTickInterceptor({ beforeTick: async () => {} });
        clearTickInterceptor();
        expect(getTickInterceptor()).toBeNull();
    });

    it('set without intervening clear overwrites the previous interceptor', () => {
        const first = { beforeTick: async () => {}, getTickDelay: () => 10 };
        const second = { beforeTick: async () => {}, getTickDelay: () => 20 };

        setTickInterceptor(first);
        setTickInterceptor(second);
        expect(getTickInterceptor()).toBe(second);
    });

    it('interceptor with only beforeTick works', () => {
        const interceptor = { beforeTick: async () => true };
        setTickInterceptor(interceptor);
        expect(getTickInterceptor().beforeTick).toBeDefined();
        expect(getTickInterceptor().afterTick).toBeUndefined();
        expect(getTickInterceptor().getTickDelay).toBeUndefined();
    });

    it('interceptor with only afterTick works', () => {
        const interceptor = { afterTick: async () => {} };
        setTickInterceptor(interceptor);
        expect(getTickInterceptor().afterTick).toBeDefined();
        expect(getTickInterceptor().beforeTick).toBeUndefined();
    });

    it('interceptor with all three hooks works', () => {
        const interceptor = {
            beforeTick: async () => false,
            afterTick: async () => {},
            getTickDelay: () => 42,
        };
        setTickInterceptor(interceptor);
        const resolved = getTickInterceptor();
        expect(resolved.beforeTick).toBeDefined();
        expect(resolved.afterTick).toBeDefined();
        expect(resolved.getTickDelay).toBeDefined();
        expect(resolved.getTickDelay()).toBe(42);
    });

    it('clearTickInterceptor is idempotent', () => {
        clearTickInterceptor();
        clearTickInterceptor();
        expect(getTickInterceptor()).toBeNull();
    });
});
