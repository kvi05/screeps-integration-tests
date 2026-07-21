'use strict';

/**
 * @file Bot-behaviour assertions used to validate scenario reports.
 *
 * Responsibility:
 *   Each function performs a single, specific check on the `WorldReport`
 *   produced by a scenario run.  They are designed to be used after
 *   `world.run()` or `world.tick()` to validate bot behaviour.
 *   All functions throw on failure (just like `node:assert`), so they
 *   can be used directly without extra try/catch wrappers.
 *
 * **Available functions:**
 *
 * | Function | Purpose |
 * |---|---|
 * | `assertNoErrors(report)` | No JavaScript errors in bot console |
 * | `assertBotWorked(report)` | Bot ran ticks and produced non-empty Memory |
 * | `assertRclAtLeast(report, room, n)` | RCL ≥ n |
 * | `assertRclBelow(report, room, n)` | RCL < n |
 * | `assertObjectDestroyed(report, [opts])` | Object(s) have been destroyed |
 * | `assertObjectNoDestroyed(report, [opts])` | Object(s) NOT destroyed |
 * | `assertNoBotObjectDestroyed(report)` | No bot-owned buildings destroyed |
 * | `assertObjectAttacking(report, objectId)` | Object initiated an attack |
 * | `assertObjectNotAttacking(report, objectId)` | Object did NOT attack |
 * | `assertObjectDamaged(report, targetId)` | Target received damage |
 * | `assertObjectNotDamaged(report, targetId)` | Target did NOT receive damage |
 * | `assertBotUserDamaged(report, userId)` | Any bot user object took damage |
 * | `assertBotUserNotDamaged(report, userId)` | No bot user object took damage |
 * | `assertBotUserAttacking(report, userId)` | Bot user initiated an attack |
 * | `assertBotUserNotAttacking(report, userId)` | Bot user did NOT attack |
 *
 * @example
 * const { assertBotWorked, assertRclAtLeast } = require('screeps-integration-tests/assertions');
 * const world = await createWorld({ ... });
 * await world.run();
 * assertBotWorked(world.report);
 * assertRclAtLeast(world.report, 'W0N1', 3);
 *
 * @module screeps-integration-tests/assertions
 */

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
} = require('../lib/assertions/assertions');

module.exports = {
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
};
