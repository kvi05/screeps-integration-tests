'use strict';

const { spec } = require('screeps-integration-tests');

/**
 * Room fixture: terrain-walls.
 *
 * A room with a wall barrier between the spawn (25,25) and the north-east
 * source (35,15). The bot can still reach the south-west source (15,35).
 *
 * Terrain:
 *   - Wall at (25,20) — blocks direct path to NE source
 *   - Swamp at (15,25) — slows path to SW source
 */
const fixture = {
    controller: spec.controller({ level: 3 }),
    sources: [spec.source(15, 35), spec.source(35, 15)],
    structures: [spec.spawn(25, 25), spec.extension(23, 24), spec.extension(27, 24)],
    creeps: [],
    terrain: {
        walls: [
            { x: 25, y: 20 },
            { x: 26, y: 20 },
            { x: 24, y: 20 },
        ],
        swamps: [
            { x: 15, y: 25 },
            { x: 16, y: 25 },
        ],
    },
};

module.exports = { name: 'terrain-walls', fixture };
