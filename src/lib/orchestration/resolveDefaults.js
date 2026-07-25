'use strict';

/**
 * Pure helper functions for resolving default values (userId, roomName) from runtime context.
 *
 * These functions are used by orchestration layer to centralize default-resolution logic
 * that was previously duplicated across buildCanonicalRoom, world.spawn, and createStructure.
 *
 * @module orchestration/resolveDefaults
 */

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
 * @throws {Error} if no bots or more than 1 bot
 */
function defaultBot(bots) {
    const names = Object.keys(bots);
    if (names.length === 0) {
        throw new Error('defaultBot: no bots in opts.bots');
    }
    if (names.length > 1) {
        throw new Error(`defaultBot: more than 1 bot (${names.join(', ')}) — specify username explicitly`);
    }
    return names[0];
}

module.exports = {
    resolveDefaultUserId,
    defaultBot,
};
