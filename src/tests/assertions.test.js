'use strict';

const {
    assertNoErrors,
    assertBotWorked,
    assertRclAtLeast,
    assertRclBelow,
    assertObjectDestroyed,
    assertObjectNoDestroyed,
    assertNoBotObjectDestroyed,
    assertObjectAttacking,
    assertObjectNotAttacking,
    assertObjectDamaged,
    assertObjectNotDamaged,
    assertBotUserDamaged,
    assertBotUserNotDamaged,
    assertBotUserAttacking,
    assertBotUserNotAttacking,
} = require('../lib/assertions');

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
        it('проходит при пустом errors', () => {
            const report = makeEmptyReport();
            expect(() => assertNoErrors(report)).not.toThrow();
        });

        it('падает при наличии ошибок', () => {
            const report = makeEmptyReport();
            report.errors = ['TypeError: x'];
            expect(() => assertNoErrors(report)).toThrow();
        });
    });

    describe('assertBotWorked', () => {
        it('проходит при ticksRun>0 и непустой Memory', () => {
            const report = makeEmptyReport();
            report.ticksRun = 10;
            report.finalMemory = { bot: { rooms: { W0N1: { controller: { level: 2 } } } } };
            expect(() => assertBotWorked(report)).not.toThrow();
        });

        it('падает при ticksRun===0', () => {
            const report = makeEmptyReport();
            report.finalMemory = { bot: { test: true } };
            expect(() => assertBotWorked(report)).toThrow(/ни одного тика/);
        });

        it('падает при пустом finalMemory', () => {
            const report = makeEmptyReport();
            report.ticksRun = 10;
            report.finalMemory = {};
            expect(() => assertBotWorked(report)).toThrow(/ни одного бота/);
        });

        it('падает при пустой памяти бота', () => {
            const report = makeEmptyReport();
            report.ticksRun = 10;
            report.finalMemory = { bot: {} };
            expect(() => assertBotWorked(report)).toThrow(/пуста/);
        });

        it('проверяет всех ботов', () => {
            const report = makeEmptyReport();
            report.ticksRun = 10;
            report.finalMemory = { bot1: { rooms: {} }, bot2: { test: true } };
            expect(() => assertBotWorked(report)).not.toThrow();
        });

        it('падает если хотя бы у одного бота пустая память', () => {
            const report = makeEmptyReport();
            report.ticksRun = 10;
            report.finalMemory = { bot1: { rooms: {} }, bot2: {} };
            expect(() => assertBotWorked(report)).toThrow(/пуста/);
        });

        it('включает проверку assertNoErrors', () => {
            const report = makeEmptyReport();
            report.ticksRun = 10;
            report.finalMemory = { bot: { rooms: {} } };
            report.errors = ['ERROR'];
            expect(() => assertBotWorked(report)).toThrow();
        });
    });

    describe('assertRclAtLeast', () => {
        it('проходит при RCL >= expected', () => {
            const report = makeEmptyReport();
            report.finalRcl = { W0N1: 3 };
            expect(() => assertRclAtLeast(report, 'W0N1', 3)).not.toThrow();
        });

        it('проходит при RCL > expected', () => {
            const report = makeEmptyReport();
            report.finalRcl = { W0N1: 4 };
            expect(() => assertRclAtLeast(report, 'W0N1', 3)).not.toThrow();
        });

        it('падает при RCL < expected', () => {
            const report = makeEmptyReport();
            report.finalRcl = { W0N1: 2 };
            expect(() => assertRclAtLeast(report, 'W0N1', 3)).toThrow(/< ожидаемого/);
        });

        it('падает при отсутствующей комнате', () => {
            const report = makeEmptyReport();
            expect(() => assertRclAtLeast(report, 'W0N1', 1)).toThrow(/не найдена/);
        });
    });

    describe('assertRclBelow', () => {
        it('проходит при RCL < max', () => {
            const report = makeEmptyReport();
            report.finalRcl = { W0N1: 2 };
            expect(() => assertRclBelow(report, 'W0N1', 3)).not.toThrow();
        });

        it('падает при RCL >= max', () => {
            const report = makeEmptyReport();
            report.finalRcl = { W0N1: 3 };
            expect(() => assertRclBelow(report, 'W0N1', 3)).toThrow(/>= ожидаемого/);
        });

        it('проходит если комната отсутствует (значение 0)', () => {
            const report = makeEmptyReport();
            expect(() => assertRclBelow(report, 'W0N1', 1)).not.toThrow();
        });
    });

    describe('assertObjectDestroyed', () => {
        it('проходит при наличии EVENT_OBJECT_DESTROYED', () => {
            const report = makeEmptyReport();
            report.events = [{ tick: 1, event: 2, objectId: 'obj1', data: { type: 'spawn' } }];
            expect(() => assertObjectDestroyed(report)).not.toThrow();
        });

        it('падает при отсутствии разрушений', () => {
            const report = makeEmptyReport();
            report.events = [];
            expect(() => assertObjectDestroyed(report)).toThrow(/НЕ был разрушен/);
        });

        it('фильтрует по типу объекта', () => {
            const report = makeEmptyReport();
            report.events = [
                { tick: 1, event: 2, objectId: 'obj1', data: { type: 'tower' } },
                { tick: 2, event: 2, objectId: 'obj2', data: { type: 'spawn' } },
            ];
            expect(() => assertObjectDestroyed(report, { types: ['spawn'] })).not.toThrow();
            expect(() => assertObjectDestroyed(report, { types: ['extension'] })).toThrow(/НЕ был разрушен/);
        });

        it('фильтрует по id', () => {
            const report = makeEmptyReport();
            report.events = [{ tick: 1, event: 2, objectId: 'obj1', data: { type: 'spawn' } }];
            expect(() => assertObjectDestroyed(report, { id: 'obj1' })).not.toThrow();
            expect(() => assertObjectDestroyed(report, { id: 'obj2' })).toThrow();
        });
    });

    describe('assertObjectNoDestroyed', () => {
        it('проходит при отсутствии разрушений', () => {
            const report = makeEmptyReport();
            expect(() => assertObjectNoDestroyed(report)).not.toThrow();
        });

        it('падает при наличии разрушений', () => {
            const report = makeEmptyReport();
            report.events = [{ tick: 1, event: 2, objectId: 'obj1' }];
            expect(() => assertObjectNoDestroyed(report)).toThrow(/разрушены/);
        });
    });

    describe('assertNoBotObjectDestroyed', () => {
        it('проходит при разрушении не-ботовского объекта', () => {
            const report = makeEmptyReport();
            report.events = [{ tick: 1, event: 2, objectId: 'inv', data: { type: 'source' } }];
            expect(() => assertNoBotObjectDestroyed(report)).not.toThrow();
        });
    });

    describe('assertObjectAttacking / NotAttacking', () => {
        it('assertObjectAttacking находит EVENT_ATTACK от объекта', () => {
            const report = makeEmptyReport();
            report.events = [{ tick: 1, event: 1, objectId: 'attacker' }];
            expect(() => assertObjectAttacking(report, 'attacker')).not.toThrow();
            expect(() => assertObjectAttacking(report, 'other')).toThrow();
        });

        it('assertObjectNotAttacking падает при наличии атаки', () => {
            const report = makeEmptyReport();
            report.events = [{ tick: 1, event: 1, objectId: 'attacker' }];
            expect(() => assertObjectNotAttacking(report, 'attacker')).toThrow(/аттаковал/);
            expect(() => assertObjectNotAttacking(report, 'other')).not.toThrow();
        });
    });

    describe('assertObjectDamaged / NotDamaged', () => {
        it('assertObjectDamaged находит targetId в EVENT_ATTACK', () => {
            const report = makeEmptyReport();
            report.events = [{ tick: 1, event: 1, objectId: 'a', data: { targetId: 'target' } }];
            expect(() => assertObjectDamaged(report, 'target')).not.toThrow();
            expect(() => assertObjectDamaged(report, 'other')).toThrow();
        });

        it('assertObjectNotDamaged', () => {
            const report = makeEmptyReport();
            report.events = [{ tick: 1, event: 1, objectId: 'a', data: { targetId: 'target' } }];
            expect(() => assertObjectNotDamaged(report, 'target')).toThrow(/получил урон/);
            expect(() => assertObjectNotDamaged(report, 'other')).not.toThrow();
        });
    });

    describe('botUser assertions (по владельцу)', () => {
        const botUserId = 'botUser123';

        function makeReportWithEvents(events) {
            const report = makeEmptyReport();
            report.events = events;
            report.objectOwners = { attacker1: botUserId, defender1: botUserId, enemy1: '2' };
            return report;
        }

        describe('assertBotUserDamaged', () => {
            it('проходит когда объект бота получил урон', () => {
                const report = makeReportWithEvents([
                    { tick: 1, event: 1, objectId: 'enemy1', data: { targetId: 'defender1' } },
                ]);
                expect(() => assertBotUserDamaged(report, botUserId)).not.toThrow();
            });

            it('падает когда ни один объект бота не получил урон', () => {
                const report = makeReportWithEvents([]);
                expect(() => assertBotUserDamaged(report, botUserId)).toThrow(/НЕ получил урона/);
            });
        });

        describe('assertBotUserNotDamaged', () => {
            it('проходит когда нет урона по объектам бота', () => {
                const report = makeReportWithEvents([]);
                expect(() => assertBotUserNotDamaged(report, botUserId)).not.toThrow();
            });

            it('падает когда есть урон по объектам бота', () => {
                const report = makeReportWithEvents([
                    { tick: 1, event: 1, objectId: 'enemy1', data: { targetId: 'defender1' } },
                ]);
                expect(() => assertBotUserNotDamaged(report, botUserId)).toThrow(/получили урон/);
            });
        });

        describe('assertBotUserAttacking', () => {
            it('проходит когда объект бота атаковал', () => {
                const report = makeReportWithEvents([{ tick: 1, event: 1, objectId: 'attacker1' }]);
                expect(() => assertBotUserAttacking(report, botUserId)).not.toThrow();
            });

            it('падает когда бот не атаковал', () => {
                const report = makeReportWithEvents([]);
                expect(() => assertBotUserAttacking(report, botUserId)).toThrow(/НЕ нанес урона/);
            });
        });

        describe('assertBotUserNotAttacking', () => {
            it('проходит когда бот не атаковал', () => {
                const report = makeReportWithEvents([]);
                expect(() => assertBotUserNotAttacking(report, botUserId)).not.toThrow();
            });

            it('падает когда бот атаковал', () => {
                const report = makeReportWithEvents([{ tick: 1, event: 1, objectId: 'attacker1' }]);
                expect(() => assertBotUserNotAttacking(report, botUserId)).toThrow(/нанесли урон/);
            });

            it('показывает количество атак в сообщении об ошибке', () => {
                const report = makeReportWithEvents([
                    { tick: 1, event: 1, objectId: 'attacker1' },
                    { tick: 2, event: 1, objectId: 'attacker1' },
                ]);
                expect(() => assertBotUserNotAttacking(report, botUserId)).toThrow(/2 EVENT_ATTACK/);
            });
        });
    });
});
