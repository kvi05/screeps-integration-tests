// JSDoc type definitions for viewer data structures.
// These mirror the Frame/FrameObject format from screeps-dojo.
//
// @see src/lib/types.js — canonical typedefs (Frame, FrameObject) used by
//   the backend collector (src/lib/observers/snapshot.js). This client-side
//   copy MUST stay in sync with those definitions.

/**
 * A single object in a frame snapshot.
 *
 * @typedef {Object} FrameObject
 * @property {string} _id
 * @property {string} type       — 'creep', 'spawn', 'source', etc.
 * @property {number} x
 * @property {number} y
 * @property {string} room
 * @property {string} [user]
 * @property {number} [hits]
 * @property {number} [hitsMax]
 * @property {Object<string,number>} [store]
 * @property {number} [storeCapacity]
 * @property {Object<string,number>} [storeCapacityResource]
 * @property {Array<{type:string,hits:number}>} [body]
 * @property {string} [name]
 * @property {number} [level]
 * @property {number} [progress]
 * @property {number} [progressTotal]
 * @property {number} [energy]
 * @property {number} [energyCapacity]
 * @property {Object} [actionLog]
 * @property {Object} [spawning]
 * @property {boolean} [spawning] // simple boolean variant
 */

/**
 * A single tick snapshot.
 *
 * @typedef {Object} Frame
 * @property {number} gameTime
 * @property {FrameObject[]} objects
 * @property {Object<string,string[]>} [terrain]
 * @property {string[]} [console]
 */

/**
 * A complete recording: terrain + frames.
 *
 * @typedef {Object} Recording
 * @property {Object<string,string[]>} terrain
 * @property {Frame[]} frames
 */

export {};
