'use strict';

/**
 * Minimal mock bot for framework self-tests.
 *
 * Does nothing except keeping Memory non-empty so that assertBotWorked()
 * recognises that the bot executed at least one tick.
 */
module.exports.loop = function () {
    Memory.tick = Game.time;
};
