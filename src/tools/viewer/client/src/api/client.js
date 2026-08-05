// SSE + REST client for the viewer.
// Connects to the UI server's /api/sse endpoint to receive frames in real time.

/**
 * @callback FrameCallback
 * @param {import('./types').Frame} frame
 * @returns {void}
 */

/**
 * @callback EventCallback
 * @param {string} eventType
 * @param {Object} data
 * @returns {void}
 */

/**
 * Connect to the SSE endpoint and listen for events.
 *
 * @param {EventCallback} onEvent — called for every SSE event
 * @returns {{ close: () => void }}
 */
export function connectSSE(onEvent) {
    const es = new EventSource('/api/sse');

    es.addEventListener('frame', (e) => {
        try {
            const data = JSON.parse(e.data);
            onEvent('frame', data);
        } catch {
            // Malformed frame — skip
        }
    });

    es.addEventListener('start', (e) => {
        try {
            const data = JSON.parse(e.data);
            onEvent('start', data);
        } catch {
            /* skip */
        }
    });

    es.addEventListener('terrain', (e) => {
        try {
            const data = JSON.parse(e.data);
            onEvent('terrain', data);
        } catch {
            /* skip */
        }
    });

    es.addEventListener('end', (e) => {
        try {
            const data = JSON.parse(e.data);
            onEvent('end', data);
        } catch {
            /* skip */
        }
    });

    es.onerror = () => {
        // Connection lost — will auto-reconnect
        onEvent('disconnect', {});
    };

    return {
        close() {
            es.close();
        },
    };
}
