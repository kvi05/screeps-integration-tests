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

    es.addEventListener('restored', (e) => {
        try {
            const data = JSON.parse(e.data);
            onEvent('restored', data);
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

    es.addEventListener('error', (e) => {
        try {
            const data = JSON.parse(e.data);
            onEvent('error', data);
        } catch {
            onEvent('error', { message: 'Unknown server error' });
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

/** Run all scenarios — the server first stops everything running (atomically), then queues the full set */
export function postRunAll() {
    return postJSON('/api/run-all');
}

/** Stop all running scenarios and clear the queue */
export function postStopAll() {
    return postJSON('/api/stop-all');
}

/** Save current snapshot */
export function postSaveSnapshot() {
    return postJSON('/api/save-snapshot');
}

/** Load a snapshot */
export function postLoadSnapshot(data) {
    return postJSON('/api/load-snapshot', { data });
}

/** Rewind to a specific tick */
export function postRestoreTick(tick) {
    return postJSON('/api/restore-tick', { tick });
}

/** List saved snapshot files */
export function getSnapshots() {
    return fetch('/api/snapshots').then((r) => r.json());
}

/** Launch a scenario from a snapshot: file name (on disk) or inline data */
export function postRunFromSnapshot(input) {
    const body = typeof input === 'string' ? { snapshotFile: input } : { data: input };
    return postJSON('/api/run-from-snapshot', body);
}

/** Fetch the JSON content of a saved snapshot file */
export function getSnapshotFile(fileName) {
    return fetch(`/snapshots/${encodeURIComponent(fileName)}`).then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch snapshot ${fileName}: ${r.status}`);
        return r.json();
    });
}

/** Delete a saved snapshot file */
export function deleteSnapshot(fileName) {
    return fetch(`/api/snapshots/${encodeURIComponent(fileName)}`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error(`Failed to delete snapshot: ${r.status}`);
        return r.json();
    });
}

/** Open the snapshots directory in the OS file manager (server-side) */
export function openSnapshotsFolder() {
    return postJSON('/api/open-snapshots-folder');
}

/** Stop the current interactive scenario */
export function postDispose() {
    return postJSON('/api/dispose');
}

/** Fetch bot Memory at a specific tick */
export function getMemoryAtTick(tick, bot) {
    return fetch(`/api/memory?tick=${tick}&bot=${encodeURIComponent(bot)}`).then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch memory: ${r.status}`);
        return r.json();
    });
}
