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
 * @param {Object} opts
 * @param {string} opts.scenarioPath — scenario file path (for status messages)
 * @param {boolean} [opts.paused=false] — start paused
 * @param {number} [opts.speed=1000] — ticks per second (1000 = realtime, higher = faster)
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

    const status = {
        state: paused ? 'paused' : 'running',
        tick: 0,
        speed,
        scenario: opts.scenarioPath || '',
    };

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
         * Called after observations. Sends viewer:frame snapshot via IPC.
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
