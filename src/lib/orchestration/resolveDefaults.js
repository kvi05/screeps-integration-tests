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

module.exports = {
    resolveDefaultUserId,
};
