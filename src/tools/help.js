'use strict';

/**
 * Grouped catalog of npm scripts.
 *
 * `package.json` is plain JSON — it cannot carry comments, so the visual
 * grouping ("unified daily drivers" vs "precise tools") lives here.
 * `npm run help` prints the catalog.
 *
 * Keep GROUPS in sync with the `scripts` section of `package.json`:
 * `tests/scriptsHelp.test.js` fails when a script is missing from the
 * catalog or when the catalog references a script that no longer exists.
 *
 * @file npm-scripts catalog for `npm run help`
 */

/** @type {Array<{title: string, items: Array<[string, string]>}>} */
const GROUPS = [
    {
        title: 'Unified — daily drivers',
        items: [
            ['help', 'this catalog'],
            ['check', 'full pipeline: lint → format:check → viewer build → unit → integration → viewer tests'],
            ['test', 'Jest unit tests for the framework'],
            ['test:integration', 'all integration scenarios (examples config)'],
            ['test:integration:smoke', 'single smoke scenario — fastest feedback loop'],
            ['viewer', 'launch the browser viewer UI (Scenario Manager)'],
        ],
    },
    {
        title: 'Quality',
        items: [
            ['lint', 'ESLint across the repo'],
            ['lint:fix', 'ESLint with auto-fixes'],
            ['format', 'Prettier — write'],
            ['format:check', 'Prettier — check only'],
        ],
    },
    {
        title: 'Viewer client (src/tools/viewer/client)',
        items: [
            ['viewer:build', 'install + build the viewer client (Vite → src/tools/viewer/dist)'],
            ['viewer:test', 'Vitest tests for the viewer client'],
            ['viewer:dev', 'Vite dev server with HMR (pair with SIT_VIEWER_PORT, see docs/VIEWER.md)'],
        ],
    },
    {
        title: 'Precise — tools & variants',
        items: [
            ['test:integration:profiling', 'integration scenarios with callgrind profiling'],
            ['fixture:capture', 'capture a memory fixture (src/tools/capture-fixture.js)'],
        ],
    },
    {
        title: 'Lifecycle (npm hooks)',
        items: [['prepare', 'husky git hooks install']],
    },
];

/** @type {Array<[string, string]>} Usage tips printed after the groups. */
const TIPS = [
    ['npm run test:integration -- --only <name>', 'run a single scenario'],
    ['npx sit --viewer --only <name>', 'viewer UI with the scenario auto-launched'],
    [
        'SIT_VIEWER_PORT=3100 npm run viewer -- --viewerPort 3100',
        'pin the viewer port for the dev proxy (then: npm run viewer:dev)',
    ],
    ['npx sit --help', 'full CLI flag reference'],
];

/**
 * Renders the catalog as plain text.
 * @returns {string}
 */
function renderHelp() {
    const lines = ['screeps-integration-tests — npm scripts', ''];
    for (const group of GROUPS) {
        lines.push(`${group.title}:`);
        for (const [name, description] of group.items) {
            lines.push(`  ${name.padEnd(28)} ${description}`);
        }
        lines.push('');
    }
    lines.push('Tips:');
    for (const [command, description] of TIPS) {
        lines.push(`  ${command.padEnd(58)} ${description}`);
    }
    return lines.join('\n');
}

module.exports = { GROUPS, TIPS, renderHelp };

if (require.main === module) {
    console.log(renderHelp());
}
