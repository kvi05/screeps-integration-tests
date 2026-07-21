'use strict';

/**
 * CLI tool for creating Memory fixture files.
 *
 * Two-phase logic:
 *   1. Run until `controller.level >= --rcl` is reached (predicate-based)
 *   2. If RCL is reached — additional `--stabilize` ticks to stabilize state
 *
 * Usage:
 *   node src/tools/capture-fixture.js <name> [options]
 *
 * Options:
 *   --from <fixture>     — starting snapshot (default: bootstrap_with_anchor)
 *   --rcl <level>        — target RCL (default: 3, range: 1..8)
 *   --ticks <N>          — max ticks to reach RCL (default: 10000)
 *   --stabilize <N>      — extra ticks after reaching RCL (default: 2000)
 *   --log-level <level>  — 'all'|'error'|'warn' (default: 'error')
 *   --progress <N>       — log every N ticks (0 = disabled, default: 0)
 *   --room <name>        — room name (default: W0N1)
 *   --sources <JSON>     — source positions (default: [{"x":15,"y":15},{"x":35,"y":35}])
 *   --force              — overwrite existing fixture
 *   --warn-size <N>      — warning threshold in bytes (default: 50000)
 *   --help               — show help
 *
 * Examples:
 *   node capture-fixture.js rcl3-stable
 *   node capture-fixture.js rcl3-stable --from bootstrap_with_anchor --ticks 15000
 *   node capture-fixture.js rcl3-stable --rcl 3 --stabilize 3000 --progress 500
 *   node capture-fixture.js rcl3-stable --room W1N1 --force
 *
 * @file CLI for generating memory fixture
 * @summary Creates `fixtures/<name>.memory.json` from running a bot to target RCL.
 */

const { createWorld } = require('../lib/orchestration/world');
const spec = require('../lib/builders/spec');
const { saveFixture, hasFixture } = require('../lib/builders/memory');
const { parseArgs, HelpRequested } = require('../lib/config/cli');

/**
 * @typedef {import('../lib/types').SourceSpecCanonical} SourceSpecCanonical
 * @typedef {import('../lib/types').BotMemory} BotMemory
 */

// ─── CLI Schema ─────────────────────────────────────────────────────────────

const SCHEMA = {
    title: 'capture-fixture',
    usage: 'node src/tools/capture-fixture.js <name> [options]',
    positional: [{ name: 'name', required: true, description: 'fixture name (without .memory.json)' }],
    options: {
        from: { type: 'string', default: 'bootstrap_with_anchor', description: 'starting memory fixture' },
        rcl: { type: 'int', default: 3, min: 1, max: 8, description: 'target RCL' },
        ticks: { type: 'int', default: 10000, min: 1, description: 'max ticks to reach RCL' },
        stabilize: { type: 'int', default: 2000, min: 0, description: 'extra ticks after reaching RCL' },
        logLevel: {
            type: 'enum',
            values: ['all', 'error', 'warn'],
            default: 'error',
            cli: '--log-level',
            description: 'logging level',
        },
        progress: { type: 'int', default: 0, min: 0, description: 'log every N ticks (0 = off)' },
        room: { type: 'string', default: 'W0N1', description: 'room name' },
        sources: {
            type: 'json',
            default: [
                { x: 15, y: 15 },
                { x: 35, y: 35 },
            ],
            description: 'source positions (JSON)',
        },
        force: { type: 'bool', default: false, description: 'overwrite existing fixture' },
        warnSize: {
            type: 'int',
            default: 50000,
            min: 0,
            cli: '--warn-size',
            description: 'warning threshold (bytes)',
        },
    },
};

// ─── Helper functions ───────────────────────────────────────────────────────────

/**
 * Extracts RCL from bot Memory.
 *
 * @param {BotMemory|null|undefined} memory
 * @param {string} roomName
 * @returns {number}
 */
function getRclFromMemory(memory, roomName) {
    if (!memory || !memory.rooms || !memory.rooms[roomName]) {
        return 0;
    }
    /** @type {{level?: number}|undefined} */
    const ctrl = memory.rooms[roomName].controller;
    return (ctrl && ctrl.level) || 0;
}

// ─── Tested API ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} CaptureFixtureOpts
 * @property {string}  name                      — fixture name (without .memory.json)
 * @property {string}  [from='bootstrap_with_anchor'] — starting memory fixture
 * @property {number}  [targetRcl=3]
 * @property {number}  [maxTicks=10000]
 * @property {number}  [stabilize=2000]
 * @property {'all'|'error'|'warn'} [logLevel='error']
 * @property {number}  [progress=0]              — progress log interval (0 = off)
 * @property {string}  [room='W0N1']
 * @property {Array<{x:number,y:number}>} [sources]
 * @property {boolean} [force=false]             — overwrite existing fixture
 * @property {number}  [warnSize=50000]          — warn when size >= N
 */

/**
 * @typedef {Object} CaptureFixtureResult
 * @property {string}   path
 * @property {number}   size
 * @property {number}   finalRcl
 * @property {number}   ticksRun
 * @property {number}   wallClockMs
 * @property {boolean}  targetReached
 * @property {string[]} warnings
 */

/**
 * Creates a fixture: runs the world to targetRcl (Phase 1) and stabilizes
 * Phase 2 (`stabilize` ticks). Returns the result — the calling CLI
 * decides the exit-code.
 *
 * Exit codes:
 * - 0 — success (RCL reached)
 * - 2 — RCL not reached (but fixture saved)
 *
 * @param {CaptureFixtureOpts} cfg
 * @returns {Promise<CaptureFixtureResult>}
 */
async function captureFixture(cfg) {
    const {
        name,
        from = 'bootstrap_with_anchor',
        targetRcl = 3,
        maxTicks = 10000,
        stabilize = 2000,
        logLevel = 'error',
        progress = 0,
        room = 'W0N1',
        sources = [
            { x: 15, y: 15 },
            { x: 35, y: 35 },
        ],
        force = false,
        warnSize = 50000,
    } = cfg;

    // Overwrite check — BEFORE starting the world (don't waste minutes)
    if (!force && hasFixture(name)) {
        throw new Error(`Fixture "${name}" already exists. Use --force to overwrite.`);
    }

    const startTime = Date.now();
    /** @type {string[]} */
    const warnings = [];

    // ─── Create world ────────────────────────────────────────────────────────
    /** @type {SourceSpecCanonical[]} */
    const sourceSpecs = sources.map((s) => spec.source(s.x, s.y));

    /** @type {Object} */
    const createWorldOpts = {
        rooms: [
            {
                name: room,
                controller: spec.controller({ level: 1 }),
                sources: sourceSpecs,
            },
        ],
        bots: [{ username: 'bot', room }],
        ticks: maxTicks + stabilize,
        profile: false,
        logLevel,

        // Phase 1: until targetRcl is reached (or maxTicks)
        until: {
            maxTicks,
            predicate: async (w) => {
                const mem = await w.readMemory('bot');
                const cur = getRclFromMemory(mem, room);

                if (progress > 0 && w.report.ticksRun > 0 && w.report.ticksRun % progress === 0) {
                    console.log(`  [phase1] tick ${w.report.ticksRun}, RCL ${cur}`);
                }

                return cur >= targetRcl;
            },
        },
    };

    // Starting memory fixture is passed through the common createWorld memory-pipeline.
    if (from) {
        createWorldOpts.memory = from;
    }

    const world = await createWorld(createWorldOpts);

    try {
        // ─── Phase 1 (runs inside world.run) ─────────────────────────────────
        console.log(`  Phase 1: reaching RCL ${targetRcl} (max ${maxTicks} ticks)...`);
        await world.run();

        /** @type {number} */
        const rclAfterPhase1 = world.report.finalRcl[room] || 0;
        const targetReached = rclAfterPhase1 >= targetRcl;

        if (targetReached) {
            console.log(`  RCL ${rclAfterPhase1} reached at tick ${world.report.ticksRun}`);
        }

        // ─── Phase 2: stabilization (after reaching RCL) ─────────────────────
        if (targetReached && stabilize > 0) {
            console.log(`  Phase 2: stabilizing (${stabilize} ticks)...`);

            for (let i = 0; i < stabilize; i++) {
                await world.tick(1);

                if (progress > 0 && world.report.ticksRun % progress === 0) {
                    const mem = await world.readMemory('bot');
                    const cur = getRclFromMemory(mem, room);
                    console.log(`  [phase2] tick ${world.report.ticksRun}, RCL ${cur}`);
                }
            }
        } else if (!targetReached) {
            console.log(`  Phase 2: SKIPPED (RCL ${targetRcl} not reached)`);
        }

        // ─── Save fixture ─────────────────────────────────────────────────────
        const finalMemory = await world.readMemory('bot');
        const finalRcl = getRclFromMemory(finalMemory, room);
        const { path: filePath, size } = saveFixture(name, finalMemory, { force });
        const wallClockMs = Date.now() - startTime;
        const wallSec = (wallClockMs / 1000).toFixed(1);

        if (!targetReached) {
            warnings.push(`RCL ${targetRcl} was NOT reached (final: ${finalRcl})`);
        }
        if (size >= warnSize) {
            warnings.push(`fixture size ${size} bytes >= threshold ${warnSize}`);
        }

        // ─── Final report ─────────────────────────────────────────────────────
        console.log(`  Fixture saved: ${filePath}`);
        console.log(`    RCL:      ${finalRcl} (target ${targetRcl}) ${targetReached ? '✓' : '✗'}`);
        console.log(`    ticks:    ${world.report.ticksRun}`);
        console.log(`    size:     ${size} bytes`);
        console.log(`    time:     ${wallSec}s`);

        for (const w of warnings) {
            console.log(`  WARNING: ${w}`);
        }

        /** @type {CaptureFixtureResult} */
        const result = {
            path: filePath,
            size,
            finalRcl,
            ticksRun: world.report.ticksRun,
            wallClockMs,
            targetReached,
            warnings,
        };
        return result;
    } finally {
        await world.dispose();
    }
}

// ─── CLI entry point ────────────────────────────────────────────────────────

/**
 * CLI entry point. Parses args, calls captureFixture, returns exit-code.
 * @returns {Promise<number>}
 */
async function main() {
    const { positional, options } = parseArgs(SCHEMA, process.argv.slice(2));

    console.log(`[capture-fixture] Создание fixture "${positional.name}"`);
    console.log(
        `  from: ${options.from}, rcl: ${options.rcl}, ticks: ${options.ticks}, ` +
            `stabilize: ${options.stabilize}, room: ${options.room}`,
    );

    /** @type {CaptureFixtureResult} */
    const result = await captureFixture({
        name: positional.name,
        from: options.from,
        targetRcl: options.rcl,
        maxTicks: options.ticks,
        stabilize: options.stabilize,
        logLevel: options.logLevel,
        progress: options.progress,
        room: options.room,
        sources: options.sources,
        force: options.force,
        warnSize: options.warnSize,
    });

    return result.targetReached ? 0 : 2;
}

if (require.main === module) {
    main()
        .then((exitCode) => process.exit(exitCode))
        .catch((e) => {
            if (e instanceof HelpRequested) {
                console.log(e.helpText);
                process.exit(0);
            } else {
                console.error(`[capture-fixture] Fatal error: ${e.message}`);
                process.exit(1);
            }
        });
}

module.exports = { captureFixture };
