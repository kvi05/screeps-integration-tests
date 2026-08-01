'use strict';

const {
    assertNoErrors,
    assertBotWorked,
    assertRclAtLeast,
    assertRclBelow,
    assertObjectDestroyed,
    assertObjectNotDestroyed,
    assertNoBotObjectDestroyed,
    assertObjectAttacking,
    assertObjectNotAttacking,
    assertObjectDamaged,
    assertObjectNotDamaged,
    assertBotUserDamaged,
    assertBotUserNotDamaged,
    assertBotUserAttacking,
    assertBotUserNotAttacking,
} = require('../src/lib/assertions/assertions');

/**
 * @returns {import('../lib/types').WorldReport}
 */
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
    };
}

describe('assertions', () => {
    describe('assertNoErrors', () => {
        it('passes with empty errors', () => {
            const report = makeEmptyReport();
            expect(() => assertNoErrors(report)).not.toThrow();
        });

        it('fails with errors present', () => {
            const report = makeEmptyReport();
            report.errors = ['TypeError: x'];
            expect(() => assertNoErrors(report)).toThrow();
        });
    });

    describe('assertBotWorked', () => {
        it('passes with ticksRun>0 and non-empty Memory', () => {
            const report = makeEmptyReport();
            report.ticksRun = 10;
            report.finalMemory = { bot: { rooms: { W0N1: { controller: { level: 2 } } } } };
            expect(() => assertBotWorked(report)).not.toThrow();
        });

        it('fails when ticksRun===0', () => {
            const report = makeEmptyReport();
            report.ticksRun = 0;
            report.finalMemory = { bot: { test: true } };
            expect(() => assertBotWorked(report)).toThrow(/did not make a single tick/);
        });

        it('fails with empty finalMemory', () => {
            const report = makeEmptyReport();
            report.ticksRun = 10;
            report.finalMemory = {};
            expect(() => assertBotWorked(report)).toThrow(/no bots in finalMemory/);
        });

        it('fails with empty bot memory', () => {
            const report = makeEmptyReport();
            report.ticksRun = 10;
            report.finalMemory = { bot: {} };
            expect(() => assertBotWorked(report)).toThrow(/empty after run/);
        });

        it('checks all bots', () => {
            const report = makeEmptyReport();
            report.ticksRun = 10;
            report.finalMemory = { bot1: { rooms: {} }, bot2: { test: true } };
            expect(() => assertBotWorked(report)).not.toThrow();
        });

        it('fails if at least one bot has empty memory', () => {
            const report = makeEmptyReport();
            report.ticksRun = 10;
            report.finalMemory = { bot1: { rooms: {} }, bot2: {} };
            expect(() => assertBotWorked(report)).toThrow(/empty after run/);
        });

        it('includes assertNoErrors check', () => {
            const report = makeEmptyReport();
            report.ticksRun = 10;
            report.finalMemory = { bot: { rooms: {} } };
            report.errors = ['ERROR'];
            expect(() => assertBotWorked(report)).toThrow();
        });
    });

    describe('assertRclAtLeast', () => {
        it('passes when RCL >= expected', () => {
            const report = makeEmptyReport();
            report.finalRcl = { W0N1: 3 };
            expect(() => assertRclAtLeast(report, 'W0N1', 3)).not.toThrow();
        });

        it('passes when RCL > expected', () => {
            const report = makeEmptyReport();
            report.finalRcl = { W0N1: 4 };
            expect(() => assertRclAtLeast(report, 'W0N1', 3)).not.toThrow();
        });

        it('fails when RCL < expected', () => {
            const report = makeEmptyReport();
            report.finalRcl = { W0N1: 2 };
            expect(() => assertRclAtLeast(report, 'W0N1', 3)).toThrow(/< expected/);
        });

        it('fails when room is missing', () => {
            const report = makeEmptyReport();
            expect(() => assertRclAtLeast(report, 'W0N1', 1)).toThrow(/not found in report/);
        });
    });

    describe('assertRclBelow', () => {
        it('passes when RCL < max', () => {
            const report = makeEmptyReport();
            report.finalRcl = { W0N1: 2 };
            expect(() => assertRclBelow(report, 'W0N1', 3)).not.toThrow();
        });

        it('fails when RCL >= max', () => {
            const report = makeEmptyReport();
            report.finalRcl = { W0N1: 3 };
            expect(() => assertRclBelow(report, 'W0N1', 3)).toThrow(/>= expected/);
        });

        it('passes when room is missing (value 0)', () => {
            const report = makeEmptyReport();
            expect(() => assertRclBelow(report, 'W0N1', 1)).not.toThrow();
        });
    });

    describe('assertObjectDestroyed', () => {
        it('passes when EVENT_OBJECT_DESTROYED is present', () => {
            const report = makeEmptyReport();
            report.events = [{ tick: 1, event: 2, objectId: 'obj1', data: { type: 'spawn' } }];
            expect(() => assertObjectDestroyed(report)).not.toThrow();
        });

        it('fails when no destructions', () => {
            const report = makeEmptyReport();
            report.events = [];
            expect(() => assertObjectDestroyed(report)).toThrow(/was NOT destroyed/);
        });

        it('filters by object type', () => {
            const report = makeEmptyReport();
            report.events = [
                { tick: 1, event: 2, objectId: 'obj1', data: { type: 'tower' } },
                { tick: 2, event: 2, objectId: 'obj2', data: { type: 'spawn' } },
            ];
            expect(() => assertObjectDestroyed(report, { types: ['spawn'] })).not.toThrow();
            expect(() => assertObjectDestroyed(report, { types: ['extension'] })).toThrow(/was NOT destroyed/);
        });

        it('filters by id', () => {
            const report = makeEmptyReport();
            report.events = [{ tick: 1, event: 2, objectId: 'obj1', data: { type: 'spawn' } }];
            expect(() => assertObjectDestroyed(report, { id: 'obj1' })).not.toThrow();
            expect(() => assertObjectDestroyed(report, { id: 'obj2' })).toThrow();
        });
    });

    describe('assertObjectNotDestroyed', () => {
        it('passes when no destructions', () => {
            const report = makeEmptyReport();
            expect(() => assertObjectNotDestroyed(report)).not.toThrow();
        });

        it('fails when destructions are present', () => {
            const report = makeEmptyReport();
            report.events = [{ tick: 1, event: 2, objectId: 'obj1' }];
            expect(() => assertObjectNotDestroyed(report)).toThrow(/objects destroyed/);
        });
    });

    describe('assertNoBotObjectDestroyed', () => {
        it('passes when non-bot object is destroyed', () => {
            const report = makeEmptyReport();
            report.events = [{ tick: 1, event: 2, objectId: 'inv', data: { type: 'source' } }];
            expect(() => assertNoBotObjectDestroyed(report)).not.toThrow();
        });
    });

    describe('assertObjectAttacking / NotAttacking', () => {
        it('assertObjectAttacking finds EVENT_ATTACK from object', () => {
            const report = makeEmptyReport();
            report.events = [{ tick: 1, event: 1, objectId: 'attacker' }];
            expect(() => assertObjectAttacking(report, 'attacker')).not.toThrow();
            expect(() => assertObjectAttacking(report, 'other')).toThrow();
        });

        it('assertObjectNotAttacking fails when attack is present', () => {
            const report = makeEmptyReport();
            report.events = [{ tick: 1, event: 1, objectId: 'attacker' }];
            expect(() => assertObjectNotAttacking(report, 'attacker')).toThrow(/attacked/);
            expect(() => assertObjectNotAttacking(report, 'other')).not.toThrow();
        });
    });

    describe('assertObjectDamaged / NotDamaged', () => {
        it('assertObjectDamaged finds targetId in EVENT_ATTACK', () => {
            const report = makeEmptyReport();
            report.events = [{ tick: 1, event: 1, objectId: 'a', data: { targetId: 'target' } }];
            expect(() => assertObjectDamaged(report, 'target')).not.toThrow();
            expect(() => assertObjectDamaged(report, 'other')).toThrow();
        });

        it('assertObjectNotDamaged', () => {
            const report = makeEmptyReport();
            report.events = [{ tick: 1, event: 1, objectId: 'a', data: { targetId: 'target' } }];
            expect(() => assertObjectNotDamaged(report, 'target')).toThrow(/received damage/);
            expect(() => assertObjectNotDamaged(report, 'other')).not.toThrow();
        });
    });

    describe('botUser assertions (by owner)', () => {
        const botUserId = 'botUser123';

        function makeReportWithEvents(events) {
            const report = makeEmptyReport();
            report.events = events;
            report.objectOwners = { attacker1: botUserId, defender1: botUserId, enemy1: '2' };
            return report;
        }

        describe('assertBotUserDamaged', () => {
            it('passes when bot object took damage', () => {
                const report = makeReportWithEvents([
                    { tick: 1, event: 1, objectId: 'enemy1', data: { targetId: 'defender1' } },
                ]);
                expect(() => assertBotUserDamaged(report, botUserId)).not.toThrow();
            });

            it('fails when no bot object took damage', () => {
                const report = makeReportWithEvents([]);
                expect(() => assertBotUserDamaged(report, botUserId)).toThrow(/received damage/);
            });
        });

        describe('assertBotUserNotDamaged', () => {
            it('passes when there is no damage to bot objects', () => {
                const report = makeReportWithEvents([]);
                expect(() => assertBotUserNotDamaged(report, botUserId)).not.toThrow();
            });

            it('fails when there is damage to bot objects', () => {
                const report = makeReportWithEvents([
                    { tick: 1, event: 1, objectId: 'enemy1', data: { targetId: 'defender1' } },
                ]);
                expect(() => assertBotUserNotDamaged(report, botUserId)).toThrow(/received damage/);
            });
        });

        describe('assertBotUserAttacking', () => {
            it('passes when bot object attacked', () => {
                const report = makeReportWithEvents([{ tick: 1, event: 1, objectId: 'attacker1' }]);
                expect(() => assertBotUserAttacking(report, botUserId)).not.toThrow();
            });

            it('fails when bot did not attack', () => {
                const report = makeReportWithEvents([]);
                expect(() => assertBotUserAttacking(report, botUserId)).toThrow(/dealt damage/);
            });
        });

        describe('assertBotUserNotAttacking', () => {
            it('passes when bot did not attack', () => {
                const report = makeReportWithEvents([]);
                expect(() => assertBotUserNotAttacking(report, botUserId)).not.toThrow();
            });

            it('fails when bot attacked', () => {
                const report = makeReportWithEvents([{ tick: 1, event: 1, objectId: 'attacker1' }]);
                expect(() => assertBotUserNotAttacking(report, botUserId)).toThrow(/dealt damage/);
            });

            it('shows attack count in error message', () => {
                const report = makeReportWithEvents([
                    { tick: 1, event: 1, objectId: 'attacker1' },
                    { tick: 2, event: 1, objectId: 'attacker1' },
                ]);
                expect(() => assertBotUserNotAttacking(report, botUserId)).toThrow(/2 EVENT_ATTACK/);
            });
        });
    });
});
