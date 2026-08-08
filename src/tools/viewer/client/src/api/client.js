// SSE + REST client for the viewer.
// Connects to the UI server's /api/sse endpoint to receive frames in real time,
// and to REST endpoints for live server control and scenario management.

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

    es.addEventListener('status', (e) => {
        try {
            const data = JSON.parse(e.data);
            onEvent('status', data);
        } catch {
            /* skip */
        }
    });

    es.addEventListener('scenario-result', (e) => {
        try {
            const data = JSON.parse(e.data);
            onEvent('scenario-result', data);
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

// ─── REST: Live Server Control ─────────────────────────────────────────────

/** @param {string} url @param {Object} [body] */
async function postJSON(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        throw new Error(`POST ${url} failed: ${res.status}`);
    }
    return res.json();
}

/** Pause the live server */
export function postPause() {
    return postJSON('/api/pause');
}

/** Resume the live server */
export function postResume() {
    return postJSON('/api/resume');
}

/** Step forward N ticks then pause */
export function postStep(n = 1) {
    return postJSON('/api/step', { n });
}

/** Set server tick speed */
export function postSpeed(speed) {
    return postJSON('/api/speed', { speed });
}

/** Get current server status */
export function getStatus() {
    return fetch('/api/status').then((r) => r.json());
}

/** Get list of available scenarios */
export function getScenarios() {
    return fetch('/api/scenarios').then((r) => r.json());
}

/** Run a scenario */
export function postRun(scenario, interactive = false) {
    return postJSON('/api/run', { scenario, interactive });
}

/** Save current snapshot */
export function postSaveSnapshot() {
    return postJSON('/api/save-snapshot');
}

/** Load a snapshot */
export function postLoadSnapshot(data) {
    return postJSON('/api/load-snapshot', { data });
}

/** Stop the current interactive scenario */
export function postDispose() {
    return postJSON('/api/dispose');
}
