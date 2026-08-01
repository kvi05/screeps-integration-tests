'use strict';

/**
 * Minimal bot object for the runtime with EventEmitter-based console subscription.
 */

const { EventEmitter } = require('events');

/**
 * Minimal bot object compatible with the API used by the framework.
 * Console subscription is handled here rather than through the mockup User,
 * so runtime does not depend on `world.addBot`'s implementation.
 */
class TestBot extends EventEmitter {
    constructor(adapter, data) {
        super();
        this._adapter = adapter;
        this._id = data._id;
        this._username = data.username;
    }

    get id() {
        return this._id;
    }

    get username() {
        return this._username;
    }

    get memory() {
        const { env } = this._adapter;
        return env.get(env.keys.MEMORY + this._id);
    }

    async console(expression) {
        const { db } = this._adapter;
        return db['users.console'].insert({ user: this._id, expression, hidden: false });
    }

    async init() {
        const { pubsub } = this._adapter;
        await pubsub.subscribe(`user:${this._id}/console`, (event) => {
            const data = JSON.parse(event);
            const { messages, error } = data;
            const { log = [], results = [] } = messages || {};
            if (error) {
                log.push(error);
            }
            this.emit('console', log, results, this._id, this._username);
        });
        return this;
    }
}

module.exports = { TestBot };
