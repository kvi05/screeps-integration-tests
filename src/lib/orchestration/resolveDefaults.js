'use strict';

/**
 * Pure helper functions for resolving default values (userId, roomName) from runtime context.
 *
 * These functions are used by orchestration layer to centralize default-resolution logic
 * that was previously duplicated across buildCanonicalRoom, world.spawn, and createStructure.
 *
 * @module orchestration/resolveDefaults
 */

const { BotError } = require('../errors');

/**
 * Resolves default userId for an object in a room.
 *
 * Priority:
 * 1. Explicit userId (caller must check this before calling)
 * 2. roomToBotUserId[roomName] — if a bot claims this room
 * 3. defaultBotUserId — fallback (first bot in the scenario)
 * 4. undefined — if nothing matches
 *
 * @param {string} roomName — room name
 * @param {Object<string, string>} [roomToBotUserId] — per-room bot user id lookup
 * @param {string} [defaultBotUserId] — fallback _id (first bot)
 * @returns {string|undefined} — resolved userId or undefined
 */
function resolveDefaultUserId(roomName, roomToBotUserId, defaultBotUserId) {
    if (roomToBotUserId && roomName && roomToBotUserId[roomName]) {
        return roomToBotUserId[roomName];
    }
    if (defaultBotUserId) {
        return defaultBotUserId;
    }
    return undefined;
}

/**
 * Returns the username of the only bot (for single-bot scenarios).
 *
 * @param {Object<string,{id:string}>} bots — bots by username
 * @returns {string} username
 * @throws {BotError} if no bots or more than 1 bot
 */
function defaultBot(bots) {
    const names = Object.keys(bots);
    if (names.length === 0) {
        throw new BotError('ZERO_BOTS');
    }
    if (names.length > 1) {
        throw new BotError('AMBIGUOUS_BOT', null, {
            title: `Ambiguous bot lookup: ${names.length} bots registered`,
            why: `Registered bots: ${names.join(', ')}. The framework cannot determine which bot you mean when botId() is called without arguments.`,
        });
    }
    return names[0];
}

module.exports = {
    resolveDefaultUserId,
    defaultBot,
};
