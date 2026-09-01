'use strict';

const fs = require('fs');
const path = require('path');
const { GROUPS, TIPS } = require('../src/tools/help');

/**
 * Guards the `npm run help` catalog against drift from package.json.
 *
 * package.json cannot carry comments, so the grouping/descriptions live in
 * src/tools/help.js. These tests fail when the two get out of sync.
 */
describe('help catalog (src/tools/help.js)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const documented = new Set(GROUPS.flatMap((g) => g.items.map(([name]) => name)));

    it('documents every npm script', () => {
        const missing = Object.keys(pkg.scripts).filter((name) => !documented.has(name));
        expect(missing).toEqual([]);
    });

    it('does not document scripts that no longer exist', () => {
        const stale = [...documented].filter((name) => !(name in pkg.scripts));
        expect(stale).toEqual([]);
    });

    it('has a non-empty description for every entry', () => {
        for (const group of GROUPS) {
            for (const [name, description] of group.items) {
                expect(typeof description).toBe('string');
                expect(description.length).toBeGreaterThan(0);
                expect(name.length).toBeGreaterThan(0);
            }
        }
    });

    it('does not document the same script twice', () => {
        expect(documented.size).toBe(GROUPS.reduce((acc, g) => acc + g.items.length, 0));
    });

    it('tips reference existing scripts where applicable', () => {
        for (const [command] of TIPS) {
            // Extract leading `npm run <script>` references and verify them.
            const match = command.match(/^npm run ([\w:-]+)/);
            if (match) {
                expect(pkg.scripts[match[1]]).toBeDefined();
            }
        }
    });
});
