'use strict';

/**
 * Unit tests for eventLog.js — readEventLog, filterByType, filterDestroyed, accumulateEvents.
 *
 * Cover:
 * - readEventLog: parses stored JSON events from env.hget
 * - readEventLog: returns [] when nothing stored or JSON is corrupted
 * - filterByType: filters events by event type constant
 * - filterDestroyed: filters destroyed events by types (string|array) and id
 * - accumulateEvents: appends {tick, ...event} to report.events
 *
 * @file Unit tests for eventLog.js
 */

const {
    readEventLog,
    filterByType,
    filterDestroyed,
    accumulateEvents,
    EVENT_ATTACK,
    EVENT_OBJECT_DESTROYED,
    EVENT_ATTACK_CONTROLLER,
} = require('../src/lib/observers/eventLog');

// ─── Fake adapter ─────────────────────────────────────────────────────────

function createFakeAdapter(raw) {
    return {
        env: {
            keys: { ROOM_EVENT_LOG: 'roomEventLog' },
            hget: jest.fn(async () => raw),
        },
    };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────

const SAMPLE_EVENTS = [
    { event: EVENT_ATTACK, objectId: 'creep_1', data: { type: 'creep' } },
    { event: EVENT_OBJECT_DESTROYED, objectId: 'creep_1', data: { type: 'creep' } },
    { event: EVENT_OBJECT_DESTROYED, objectId: 'spawn_1', data: { type: 'spawn' } },
    { event: EVENT_OBJECT_DESTROYED, objectId: 'creep_2', data: { type: 'creep' } },
    { event: EVENT_ATTACK_CONTROLLER, objectId: 'controller_1', data: { type: 'controller' } },
];

// ─── readEventLog ─────────────────────────────────────────────────────────

describe('readEventLog', () => {
    it('returns parsed events from env.hget', async () => {
        const adapter = createFakeAdapter(JSON.stringify(SAMPLE_EVENTS));
        const result = await readEventLog(adapter, 'W0N1');
        expect(adapter.env.hget).toHaveBeenCalledWith('roomEventLog', 'W0N1');
        expect(result).toEqual(SAMPLE_EVENTS);
    });

    it('returns [] when nothing is stored', async () => {
        const adapter = createFakeAdapter(null);
        expect(await readEventLog(adapter, 'W0N1')).toEqual([]);
    });

    it('returns [] when stored JSON is corrupted', async () => {
        const adapter = createFakeAdapter('not-json{{{');
        expect(await readEventLog(adapter, 'W0N1')).toEqual([]);
    });
});

// ─── filterByType ─────────────────────────────────────────────────────────

describe('filterByType', () => {
    it('filters events by event type constant', () => {
        const result = filterByType(SAMPLE_EVENTS, EVENT_OBJECT_DESTROYED);
        expect(result).toHaveLength(3);
        expect(result.every((e) => e.event === EVENT_OBJECT_DESTROYED)).toBe(true);
    });
});

// ─── filterDestroyed ──────────────────────────────────────────────────────

describe('filterDestroyed', () => {
    it('returns all destroyed events without a filter', () => {
        expect(filterDestroyed(SAMPLE_EVENTS)).toHaveLength(3);
    });

    it('filters by a single object type', () => {
        const result = filterDestroyed(SAMPLE_EVENTS, { types: 'creep' });
        expect(result).toHaveLength(2);
        expect(result.every((e) => e.data.type === 'creep')).toBe(true);
    });

    it('filters by multiple object types', () => {
        const result = filterDestroyed(SAMPLE_EVENTS, { types: ['creep', 'spawn'] });
        expect(result).toHaveLength(3);
    });

    it('filters by object id', () => {
        const result = filterDestroyed(SAMPLE_EVENTS, { id: 'spawn_1' });
        expect(result).toHaveLength(1);
        expect(result[0].objectId).toBe('spawn_1');
    });

    it('combines types and id filters', () => {
        const result = filterDestroyed(SAMPLE_EVENTS, { types: 'creep', id: 'creep_2' });
        expect(result).toHaveLength(1);
        expect(result[0].objectId).toBe('creep_2');
    });
});

// ─── accumulateEvents ─────────────────────────────────────────────────────

describe('accumulateEvents', () => {
    it('appends {tick, ...event} to report.events', () => {
        const report = { events: [] };
        accumulateEvents(report, SAMPLE_EVENTS, 7);
        expect(report.events).toHaveLength(5);
        expect(report.events[0]).toEqual({ tick: 7, ...SAMPLE_EVENTS[0] });
        expect(report.events.every((e) => e.tick === 7)).toBe(true);
    });

    it('initializes report.events when it is missing', () => {
        const report = {};
        accumulateEvents(report, [{ event: EVENT_ATTACK }], 1);
        expect(report.events).toEqual([{ tick: 1, event: EVENT_ATTACK }]);
    });
});
