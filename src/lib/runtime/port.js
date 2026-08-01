'use strict';

/**
 * Allocates a free TCP port on 127.0.0.1 for each mockup server.
 */

const net = require('net');

/**
 * Returns a free TCP port on 127.0.0.1.
 *
 * Used so each mockup server runs on its own port and does not
 * conflict with other parallel or sequential runs.
 *
 * @returns {Promise<number>}
 */
async function getFreePort() {
    const server = net.createServer();
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => {
                server.removeAllListeners();
                resolve(port);
            });
        });
    });
}

module.exports = { getFreePort };
