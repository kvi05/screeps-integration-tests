'use strict';

/**
 * @file Viewer tick interceptor — implements {@link TickInterceptor} for
 *   live browser viewer control (pause/resume/step/speed) and per-tick
 *   snapshot streaming via IPC.
 *
 * Responsibility:
 *   - Manage pause/resume/step/speed state via EventEmitter
 *   - Listen for `viewer:cmd` IPC from parent process
 *   - Send `viewer:status` on state changes
 *   - In `afterTick`: collect snapshot and send `viewer:frame` via IPC
 *   - Provide `getTickDelay` for speed throttling
 *
 * This module is the ONLY place where viewer-specific IPC lives.
 * Core (world.js) calls the TickInterceptor interface blind.
 *
 * @module tools/viewer/liveControl
 */

const { EventEmitter, once } = require('events');
const { collectSnapshot } = require('../../lib/observers/snapshot');
const { getBotMemory } = require('../../lib/builders/memory');
const { computeMemoryDiff } = require('./memoryDiff');

/**
 * @typedef {import('../../lib/types').TickInterceptor} TickInterceptor
 * @typedef {import('../../lib/types').TickHookContext} TickHookContext
 */

/**
 * Creates a viewer tick interceptor and starts listening for `viewer:cmd`
 * IPC messages from the parent process.
 *
 * The interceptor is self-contained: it owns its own state (paused, speed,
 * step counter) and communicates with the parent via `process.send`.
 *
 * Default values for optional parameters originate from
 * `DEFAULTS.viewerOptions` in `lib/config/config.js` — the single source of
 * truth.  The `||` fallbacks here are a terminal backstop for callers that
 * bypass the config pipeline (e.g. unit tests).
 *
 * @param {Object} opts
 * @param {string} opts.scenarioPath — scenario file path (for status messages)
 * @param {boolean} [opts.paused=false] — start paused
 * @param {number} [opts.speed=1000] — ticks per second (1000 = realtime, higher = faster)
 * @param {number} [opts.keyframeInterval=100] — send full Memory every N ticks
 * @returns {TickInterceptor}
 */
function createViewerInterceptor(opts = {}) {
    const control = new EventEmitter();

    /** @type {boolean} */
    let paused = opts.paused || false;
    /** @type {number} */
    let stepRequested = 0;
    /** @type {number} */
    let speed = opts.speed || 1000;
    /** @type {boolean} Signals the tick loop to stop gracefully */
    let disposed = false;
    /** @type {number} Keyframe interval for Memory diffs */
    const keyframeInterval = opts.keyframeInterval || 100;

    const status = {
        state: paused ? 'paused' : 'running',
        tick: 0,
        speed,
        scenario: opts.scenarioPath || '',
    };

    /** @type {Object<string, *>} Per-bot: previous Memory for diff computation */
    const previousMemory = {};

    /**
     * Sends a viewer:status message to the parent process.
     */
    function sendStatus() {
        if (!process.send) return;
        try {
            process.send({
                type: 'viewer:status',
                state: status.state,
                tick: status.tick,
                speed,
                scenario: status.scenario,
            });
        } catch {
            /* non-critical */
        }
    }

    // ── Listen for viewer:cmd from parent ────────────────────────────────

    process.on('message', (cmd) => {
        if (!cmd || cmd.type !== 'viewer:cmd') return;

        const { action, params } = cmd;
        switch (action) {
            case 'pause':
                paused = true;
                status.state = 'paused';
                sendStatus();
                break;
            case 'resume':
                paused = false;
                status.state = 'running';
                control.emit('resume');
                sendStatus();
                break;
            case 'step':
                stepRequested += params?.n || 1;
                status.state = 'stepping';
                if (paused) {
                    paused = false;
                    control.emit('resume');
                }
                sendStatus();
                break;
            case 'setSpeed':
                speed = params?.speed || 1;
                sendStatus();
                break;
            case 'dispose':
                disposed = true;
                if (process.send) {
                    process.send({ type: 'viewer:disposed', scenario: status.scenario });
                }
                // Unblock the tick loop if it's waiting on pause
                if (paused) {
                    paused = false;
                    control.emit('resume');
                }
                break;
        }
    });

    // ── TickInterceptor implementation ────────────────────────────────────

    /** @type {TickInterceptor} */
    return {
        /**
         * Called before server tick. Handles pause/resume/step logic.
         *
         * @param {TickHookContext} ctx
         * @returns {Promise<boolean|void>} true to stop the tick loop
         */
        async beforeTick(ctx) {
            status.tick = ctx.tickNum;

            // Graceful shutdown: stop the tick loop cleanly.
            // The scenario finishes normally → final result sent → worker exits.
            if (disposed) {
                return true;
            }

            if (paused) {
                sendStatus();
                await once(control, 'resume');
            }

            if (stepRequested > 0) {
                stepRequested--;
                if (stepRequested === 0) {
                    paused = true;
                    status.state = 'paused';
                }
            }

            if (!paused) {
                sendStatus();
            }
        },

        /**
         * Called after observations. Sends viewer:frame snapshot and
         * viewer:memory Memory diffs via IPC.
         *
         * @param {TickHookContext} ctx
         */
        async afterTick(ctx) {
            if (!process.send) return;

            try {
                const snapshot = await collectSnapshot(ctx.adapter, ctx.roomStatus, ctx.report, ctx.tickNum);
                snapshot._sentAt = Date.now();
                snapshot._size = JSON.stringify(snapshot).length;
                process.send({ type: 'viewer:frame', ...snapshot });
            } catch {
                /* non-critical */
            }

            // Collect Memory diffs for all bots
            if (ctx.bots && Object.keys(ctx.bots).length > 0) {
                try {
                    /** @type {Object<string, {type: string, data: *}>} */
                    const botsMemory = {};
                    for (const [_username, bot] of Object.entries(ctx.bots)) {
                        const botUserId = bot.id;
                        if (!botUserId) continue;
                        try {
                            const mem = await getBotMemory(ctx.adapter, botUserId);
                            const prev = previousMemory[botUserId];

                            if (prev === undefined || ctx.tickNum % keyframeInterval === 0) {
                                // Keyframe: send full Memory
                                botsMemory[botUserId] = { type: 'keyframe', data: mem };
                            } else {
                                // Delta: compute diff vs previous tick
                                const diff = computeMemoryDiff(prev, mem);
                                botsMemory[botUserId] = { type: 'delta', data: diff };
                            }

                            previousMemory[botUserId] = mem;
                        } catch {
                            // Bot has no Memory — skip
                            botsMemory[botUserId] = { type: 'keyframe', data: {} };
                            previousMemory[botUserId] = {};
                        }
                    }
                    process.send({ type: 'viewer:memory', tick: ctx.tickNum, bots: botsMemory });
                } catch {
                    /* non-critical */
                }
            }
        },

        /**
         * Returns delay in ms for speed throttling.
         * 0 = unthrottled, >0 = delay between ticks.
         *
         * @returns {number}
         */
        getTickDelay() {
            if (speed >= 1000) return 0;
            return Math.max(0, Math.floor(1000 / speed));
        },
    };
}

module.exports = { createViewerInterceptor };
