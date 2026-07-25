'use strict';

const { resolveDefaultUserId, defaultBot } = require('../src/lib/orchestration/resolveDefaults');

describe('resolveDefaultUserId', () => {
    it('returns undefined when no defaults available', () => {
        expect(resolveDefaultUserId('W0N1')).toBeUndefined();
        expect(resolveDefaultUserId('W0N1', undefined)).toBeUndefined();
        expect(resolveDefaultUserId('W0N1', {}, undefined)).toBeUndefined();
    });

    it('picks roomToBotUserId over defaultBotUserId', () => {
        const result = resolveDefaultUserId('W0N1', { W0N1: 'room_bot_123' }, 'fallback_bot_456');
        expect(result).toBe('room_bot_123');
    });

    it('falls back to defaultBotUserId when room is not claimed', () => {
        const result = resolveDefaultUserId('W0N1', { W1N0: 'other_bot' }, 'fallback_bot_456');
        expect(result).toBe('fallback_bot_456');
    });

    it('falls back to defaultBotUserId when roomToBotUserId is empty', () => {
        const result = resolveDefaultUserId('W0N1', {}, 'fallback_bot_456');
        expect(result).toBe('fallback_bot_456');
    });

    it('works with null/undefined edge cases', () => {
        expect(resolveDefaultUserId('W0N1', null, 'fallback_bot_456')).toBe('fallback_bot_456');
        expect(resolveDefaultUserId('W0N1', { W0N1: null }, 'fallback_bot_456')).toBe('fallback_bot_456');
        expect(resolveDefaultUserId('', {}, 'fallback_bot_456')).toBe('fallback_bot_456');
    });

    it('returns undefined when only roomToBotUserId is provided but room is not in it', () => {
        const result = resolveDefaultUserId('W0N1', { W1N0: 'other_bot' });
        expect(result).toBeUndefined();
    });
});

describe('defaultBot', () => {
    it('single-bot returns the only bot name', () => {
        const bots = { myBot: { id: 'u1' } };
        expect(defaultBot(bots)).toBe('myBot');
    });

    it('no-bot throws an error', () => {
        expect(() => defaultBot({})).toThrow('defaultBot: no bots');
    });

    it('multi-bot throws an error', () => {
        const bots = { bot1: { id: 'u1' }, bot2: { id: 'u2' } };
        expect(() => defaultBot(bots)).toThrow(/more than 1 bot/);
    });
});
