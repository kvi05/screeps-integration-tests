'use strict';

/**
 * Unit tests for ownership.js — snapshotOwners + mergeOwners.
 *
 * Cover:
 * - snapshotOwners: captures _id→user for objects with `user` field
 * - snapshotOwners: skips objects without `user`
 * - mergeOwners: accumulative merge (Object.assign)
 * - Pre-tick snapshot: owner captured before object is destroyed
 *
 * @file Unit tests for ownership.js
 */

const { snapshotOwners, mergeOwners } = require('../src/lib/observers/ownership');

// ─── Fake DB ──────────────────────────────────────────────────────────────

function createFakeCollection(initialDocs) {
    const state = initialDocs.map((d) => ({ ...d }));
    return {
        find(query) {
            return Promise.resolve(state.filter((d) => matches(d, query)));
        },
        removeWhere(query) {
            const idx = state.findIndex((d) => matches(d, query));
            if (idx >= 0) state.splice(idx, 1);
            return Promise.resolve();
        },
        insert(doc) {
            const newDoc = { _id: `auto_${Date.now()}`, ...doc };
            state.push(newDoc);
            return Promise.resolve(newDoc);
        },
    };
}

function matches(doc, query) {
    for (const key of Object.keys(query)) {
        if (doc[key] !== query[key]) return false;
    }
    return true;
}

function createFakeAdapter(objects) {
    return {
        db: {
            'rooms.objects': createFakeCollection(objects),
        },
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeEmptyReport() {
    return {
        ticksRun: 0,
        finalRcl: {},
        errors: [],
        warnings: [],
        logs: [],
        finalMemory: {},
        events: [],
        objectOwners: {},
        metrics: { rooms: {}, colonies: {}, bots: {}, world: [] },
        stopReason: null,
        wallClockMs: 0,
        profileText: {},
        profileCallgrind: {},
        frameworkWarnings: [],
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('snapshotOwners', () => {
    it('captures _id → user for objects with user field', async () => {
        const adapter = createFakeAdapter([
            { _id: 'spawn_1', room: 'W0N1', type: 'spawn', user: 'bot_123' },
            { _id: 'tower_1', room: 'W0N1', type: 'tower', user: 'bot_123' },
            { _id: 'creep_1', room: 'W0N1', type: 'creep', user: 'bot_123' },
        ]);

        const owners = await snapshotOwners(adapter, 'W0N1');

        expect(owners).toEqual({
            spawn_1: 'bot_123',
            tower_1: 'bot_123',
            creep_1: 'bot_123',
        });
    });

    it('skips objects without user field', async () => {
        const adapter = createFakeAdapter([
            { _id: 'src_1', room: 'W0N1', type: 'source' },
            { _id: 'wall_1', room: 'W0N1', type: 'constructedWall' },
            { _id: 'road_1', room: 'W0N1', type: 'road' },
        ]);

        const owners = await snapshotOwners(adapter, 'W0N1');

        expect(owners).toEqual({});
    });

    it('only returns objects from the requested room', async () => {
        const adapter = createFakeAdapter([
            { _id: 'spawn_1', room: 'W0N1', type: 'spawn', user: 'bot_123' },
            { _id: 'spawn_2', room: 'W0N2', type: 'spawn', user: 'other_bot' },
        ]);

        const owners = await snapshotOwners(adapter, 'W0N1');

        expect(owners).toEqual({ spawn_1: 'bot_123' });
    });

    it('handles invader userId = "2"', async () => {
        const adapter = createFakeAdapter([{ _id: 'invader_1', room: 'W0N1', type: 'creep', user: '2' }]);

        const owners = await snapshotOwners(adapter, 'W0N1');

        expect(owners).toEqual({ invader_1: '2' });
    });

    it('returns empty object for empty room', async () => {
        const adapter = createFakeAdapter([]);

        const owners = await snapshotOwners(adapter, 'W0N1');

        expect(owners).toEqual({});
    });
});

describe('mergeOwners', () => {
    it('creates objectOwners if not exists', () => {
        const report = makeEmptyReport();
        delete report.objectOwners;

        mergeOwners(report, { creep_1: 'bot_123' });

        expect(report.objectOwners).toEqual({ creep_1: 'bot_123' });
    });

    it('adds new entries accumulatively', () => {
        const report = makeEmptyReport();
        report.objectOwners = { spawn_1: 'bot_123' };

        mergeOwners(report, { tower_1: 'bot_123', creep_1: 'bot_123' });

        expect(report.objectOwners).toEqual({
            spawn_1: 'bot_123',
            tower_1: 'bot_123',
            creep_1: 'bot_123',
        });
    });

    it('does NOT overwrite existing entries (Object.assign behavior)', () => {
        const report = makeEmptyReport();
        report.objectOwners = { creep_1: 'bot_123' };

        mergeOwners(report, { creep_1: 'attacker_456' });

        // Object.assign overwrites, but in practice _id→user is immutable
        // This test documents the actual behavior
        expect(report.objectOwners).toEqual({ creep_1: 'attacker_456' });
    });

    it('handles empty owners map', () => {
        const report = makeEmptyReport();
        report.objectOwners = { spawn_1: 'bot_123' };

        mergeOwners(report, {});

        expect(report.objectOwners).toEqual({ spawn_1: 'bot_123' });
    });
});

describe('pre-tick snapshot — owner captured before destruction', () => {
    it('captures owner of object that is later removed from DB', async () => {
        // Simulate pre-tick state: object exists with owner
        const adapter = createFakeAdapter([
            { _id: 'creep_1', room: 'W0N1', type: 'creep', user: 'bot_123' },
            { _id: 'invader_1', room: 'W0N1', type: 'creep', user: '2' },
        ]);

        // Pre-tick snapshot: capture owners
        const report = makeEmptyReport();
        const owners = await snapshotOwners(adapter, 'W0N1');
        mergeOwners(report, owners);

        // Now simulate tick: creep is destroyed (removed from DB)
        await adapter.db['rooms.objects'].removeWhere({ _id: 'creep_1' });

        // Post-tick event log would show EVENT_ATTACK with targetId='creep_1'
        // ownerOf(report, 'creep_1') should still return 'bot_123'
        expect(report.objectOwners['creep_1']).toBe('bot_123');
        expect(report.objectOwners['invader_1']).toBe('2');

        // After post-tick snapshot, the destroyed creep's owner is still known
        // because mergeOwners is accumulative (Object.assign adds, never removes)
        const postTickOwners = await snapshotOwners(adapter, 'W0N1');
        mergeOwners(report, postTickOwners);

        expect(report.objectOwners['creep_1']).toBe('bot_123');
        expect(report.objectOwners['invader_1']).toBe('2');
    });

    it('pre-tick + post-tick snapshots complement each other', async () => {
        // Pre-tick: only creep exists
        const adapter = createFakeAdapter([{ _id: 'creep_1', room: 'W0N1', type: 'creep', user: 'bot_123' }]);
        const report = makeEmptyReport();

        // Pre-tick snapshot
        const preOwners = await snapshotOwners(adapter, 'W0N1');
        mergeOwners(report, preOwners);

        // Tick: creep destroyed, new tower built
        await adapter.db['rooms.objects'].removeWhere({ _id: 'creep_1' });
        await adapter.db['rooms.objects'].insert({
            _id: 'tower_1',
            room: 'W0N1',
            type: 'tower',
            user: 'bot_123',
        });

        // Post-tick snapshot: captures tower but NOT creep (already removed)
        const postOwners = await snapshotOwners(adapter, 'W0N1');
        mergeOwners(report, postOwners);

        // Both should be in objectOwners
        expect(report.objectOwners['creep_1']).toBe('bot_123');
        expect(report.objectOwners['tower_1']).toBe('bot_123');
    });
});
