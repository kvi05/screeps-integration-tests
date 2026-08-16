import { useState, useEffect, useCallback, useRef } from 'react';
import {
    postSaveSnapshot,
    postLoadSnapshot,
    postRestoreTick,
    getSnapshots,
    getSnapshotFile,
    deleteSnapshot,
} from '../api/client';
import { DownloadIcon, DatabaseIcon, FilmIcon, RefreshCwIcon, RewindIcon, XIcon } from './Icons';
import { formatSize } from '../utils/format';

/**
 * @file StatePanel — world state management for the viewer sidebar.
 *
 * Responsibility:
 *   Shows the rewind range, saves/imports/loads/deletes world snapshots
 *   for the current scenario, and reports the last state operation.
 *
 * @component
 */

/**
 * World state panel for the viewer sidebar.
 *
 * @param {Object} props
 * @param {string} props.scenario — current scenario name (for filtering)
 * @param {number} props.serverTick — current server tick
 * @param {boolean} props.connected — SSE connected
 * @param {boolean} props.ended — scenario ended
 * @param {boolean} props.disabled — buttons disabled
 * @param {boolean} [props.atEdge] — scrubber cursor is at the recorded edge;
 *   snapshots capture the live server state, so saving is only enabled there
 * @param {number} [props.replayBuffer] — server-side rewind buffer size in
 *   ticks (from the SSE start event); determines the oldest rewindable tick
 * @param {Object|null} props.sseError — SSE error forwarded from server
 * @param {() => void} props.onClearError
 */
export default function StatePanel({
    scenario = '',
    serverTick = 0,
    connected = false,
    ended = false,
    disabled = false,
    atEdge = true,
    replayBuffer = 0,
    sseError = null,
    onClearError = null,
}) {
    /** @type {[Array<{file:string, size:number, modified:string, tick?:number, scenario?:string}>, Function]} */
    const [snapshots, setSnapshots] = useState([]);
    const [error, setError] = useState(/** @type {string|null} */ (null));
    const [inProgress, setInProgress] = useState(false);
    const fileInputRef = useRef(/** @type {HTMLInputElement|null} */ (null));
    const [rewindTick, setRewindTick] = useState(String(Math.max(0, serverTick - 1)));
    const rewindDirtyRef = useRef(false);
    const [listError, setListError] = useState(false);
    const refreshTimerRef = useRef(/** @type {ReturnType<typeof setTimeout>|null} */ (null));

    const isDisabled = disabled || inProgress || !connected || ended;

    // Current scenario basename — snapshots are filtered by meta.scenario.
    // In the browser there is no path.basename, so split on both separators.
    const scenarioName = (scenario || '')
        .split(/[/\\]/)
        .pop()
        .replace(/\.scenario\.js$/, '');

    // ─── Load snapshot list (filtered by scenario) ───────────────────────

    const refreshSnapshots = useCallback(async () => {
        try {
            const data = await getSnapshots();
            const all = data.snapshots || [];
            // Snapshots without meta.scenario cannot be matched to a run —
            // hide them to keep the list relevant to the current scenario.
            setSnapshots(scenarioName ? all.filter((s) => s.scenario === scenarioName) : all);
            setListError(false);
        } catch {
            setSnapshots([]);
            setListError(true);
        }
    }, [scenarioName]);

    useEffect(() => {
        refreshSnapshots();
    }, [refreshSnapshots]);

    // Clear the post-save refresh timer when the panel unmounts
    useEffect(() => () => clearTimeout(refreshTimerRef.current), []);

    // Keep the default rewind target trailing the server tick. A manually
    // typed value is left alone until the rewind succeeds.
    useEffect(() => {
        if (!rewindDirtyRef.current) {
            setRewindTick(String(Math.max(0, serverTick - 1)));
        }
    }, [serverTick]);

    // ─── Rewind range ────────────────────────────────────────────────────
    // The server keeps per-tick snapshots (sit:snap:<N>) for the last
    // replayBuffer ticks, and a rewind target must be strictly before the
    // current tick. Fall back to the full range when the buffer size is
    // unknown (legacy servers don't send it in the SSE start event).
    const firstRewindTick = replayBuffer > 0 ? Math.max(1, serverTick - replayBuffer + 1) : 1;
    const lastRewindTick = Math.max(0, serverTick - 1);
    const rewindRangeText =
        connected && lastRewindTick >= firstRewindTick
            ? `Ticks ${firstRewindTick}–${lastRewindTick} available for rewind`
            : '—';

    // ─── SSE errors forwarded from server ────────────────────────────────
    useEffect(() => {
        if (sseError) {
            setError(`[${sseError.code}] ${sseError.message}`);
            setInProgress(false);
            if (onClearError) onClearError();
        }
    }, [sseError, onClearError]);

    // ─── Actions ─────────────────────────────────────────────────────────

    /** Save current state as a snapshot file */
    const handleSave = useCallback(async () => {
        setInProgress(true);
        setError(null);
        try {
            await postSaveSnapshot();
            // The save completes asynchronously (worker collects the dump,
            // the parent writes the file) — refresh shortly after so the new
            // file shows up in the list.
            clearTimeout(refreshTimerRef.current);
            refreshTimerRef.current = setTimeout(refreshSnapshots, 1000);
        } catch (err) {
            setError(err.message || 'Failed to save snapshot');
        } finally {
            setInProgress(false);
        }
    }, [refreshSnapshots]);

    /** Import a snapshot file from disk (loads it into the running world) */
    const handleImportFile = useCallback(async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setInProgress(true);
        setError(null);
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            await postLoadSnapshot(data);
        } catch (err) {
            setError(err.message || 'Failed to import snapshot');
        } finally {
            setInProgress(false);
            // Reset file input so the same file can be re-selected
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }, []);

    /** Load a snapshot from the saved files list */
    const handleLoadFromList = useCallback(async (fileName) => {
        setInProgress(true);
        setError(null);
        try {
            const data = await getSnapshotFile(fileName);
            await postLoadSnapshot(data);
        } catch (err) {
            setError(err.message || 'Failed to load snapshot from list');
        } finally {
            setInProgress(false);
        }
    }, []);

    /** Delete a saved snapshot file */
    const handleDelete = useCallback(
        async (fileName) => {
            setInProgress(true);
            setError(null);
            try {
                await deleteSnapshot(fileName);
                refreshSnapshots();
            } catch (err) {
                setError(err.message || 'Failed to delete snapshot');
            } finally {
                setInProgress(false);
            }
        },
        [refreshSnapshots],
    );

    /** Rewind the server to a manually entered tick */
    const handleRestoreTick = useCallback(async () => {
        const tick = parseInt(rewindTick, 10);
        if (Number.isNaN(tick) || tick < 0) {
            setError('Invalid tick number');
            return;
        }
        if (tick >= serverTick) {
            setError(`Cannot rewind to tick ${tick}: current tick is ${serverTick}`);
            return;
        }
        if (replayBuffer > 0 && tick < firstRewindTick) {
            setError(`Tick ${tick} is outside the rewind buffer (${firstRewindTick}–${lastRewindTick})`);
            return;
        }

        setInProgress(true);
        setError(null);
        try {
            await postRestoreTick(tick);
            // The next server tick re-syncs the default target automatically
            rewindDirtyRef.current = false;
        } catch (err) {
            setError(err.message || 'Failed to rewind');
        } finally {
            setInProgress(false);
        }
    }, [rewindTick, serverTick, replayBuffer, firstRewindTick, lastRewindTick]);

    // ─── Render ──────────────────────────────────────────────────────────

    return (
        <div className="state-panel">
            {error && (
                <div className="state-status error">
                    {error}
                    <button className="dismiss-btn" onClick={() => setError(null)}>
                        ×
                    </button>
                </div>
            )}

            {/* ─── Rewind Range ─────────────────────────────── */}
            <div className="state-section">
                <h3>
                    <RewindIcon size={16} />
                    Rewind Range
                </h3>
                <p className="rewind-range">{rewindRangeText}</p>

                <div className="state-rewind-row">
                    <input
                        type="number"
                        className="state-rewind-input"
                        aria-label="Rewind target tick"
                        value={rewindTick}
                        min={replayBuffer > 0 ? firstRewindTick : 0}
                        max={Math.max(0, lastRewindTick)}
                        placeholder="Tick…"
                        onChange={(e) => {
                            rewindDirtyRef.current = true;
                            setRewindTick(e.target.value);
                        }}
                        disabled={isDisabled}
                    />
                    <button className="btn-primary" onClick={handleRestoreTick} disabled={isDisabled}>
                        <RewindIcon size={14} />
                        {inProgress ? 'Rewinding...' : 'Rewind'}
                    </button>
                </div>
            </div>

            {/* ─── Save current state ──────────────────────── */}
            <div className="state-section">
                <h3>
                    <DownloadIcon size={16} />
                    Save Current State
                </h3>
                <p>Save the current world state to a JSON snapshot for later inspection or replay.</p>
                <div className="state-actions">
                    <button className="btn-primary" onClick={handleSave} disabled={isDisabled || !atEdge}>
                        <DownloadIcon size={14} />
                        {inProgress ? 'Saving...' : 'Save Snapshot'}
                    </button>
                </div>
            </div>

            {/* ─── Import from file ─────────────────────────── */}
            <div className="state-section">
                <h3>
                    <DatabaseIcon size={16} />
                    Load Snapshot
                </h3>
                <p>Load a snapshot JSON from disk into the current world.</p>
                <div className="state-actions">
                    <button
                        className="btn-secondary"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isDisabled}
                    >
                        <DatabaseIcon size={14} />
                        Load from File...
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        style={{ display: 'none' }}
                        onChange={handleImportFile}
                    />
                </div>
            </div>

            {/* ─── Saved Snapshots (this scenario) ─────────── */}
            <div className="state-section">
                <h3>
                    <FilmIcon size={16} />
                    Saved Snapshots
                    <button
                        className="icon-btn refresh-btn"
                        onClick={refreshSnapshots}
                        disabled={inProgress}
                        title="Refresh list"
                    >
                        <RefreshCwIcon size={12} />
                    </button>
                </h3>
                {scenarioName && <p className="snapshot-scenario">{scenarioName}</p>}
                {snapshots.length === 0 ? (
                    <p className="no-snapshots">
                        {listError
                            ? 'Failed to load snapshots — refresh to retry.'
                            : 'No saved snapshots for this scenario.'}
                    </p>
                ) : (
                    <ul className="snapshot-list thin-scroll">
                        {snapshots.map((s) => (
                            <li key={s.file} className="snapshot-item">
                                {/* Name gets a full-width row with its own
                                    horizontal scroll — long file names stay
                                    readable instead of being ellipsized */}
                                <div className="snapshot-name-row thin-scroll">
                                    <span className="snapshot-name" title={s.file}>
                                        {s.file}
                                    </span>
                                </div>
                                <div className="snapshot-meta-row">
                                    {s.tick !== undefined && <span className="snapshot-badge">Tick {s.tick}</span>}
                                    <span className="snapshot-sep">·</span>
                                    <span className="snapshot-meta">{new Date(s.modified).toLocaleString()}</span>
                                    <span className="snapshot-sep">·</span>
                                    <span className="snapshot-meta">{formatSize(s.size)}</span>
                                </div>
                                <div className="snapshot-actions">
                                    <button
                                        className="btn-secondary btn-small"
                                        onClick={() => handleLoadFromList(s.file)}
                                        disabled={isDisabled}
                                    >
                                        <DatabaseIcon size={12} />
                                        Load
                                    </button>
                                    <button
                                        className="btn-secondary btn-small"
                                        onClick={() => handleDelete(s.file)}
                                        disabled={isDisabled}
                                    >
                                        <XIcon size={12} />
                                        Delete
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
