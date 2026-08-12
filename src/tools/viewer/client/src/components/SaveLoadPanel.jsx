import { useState, useEffect, useCallback, useRef } from 'react';
import { postSaveSnapshot, postLoadSnapshot, postRestoreTick, getSnapshots } from '../api/client';
import { DownloadIcon, DatabaseIcon, FilmIcon, RefreshCwIcon } from './Icons';

/**
 * @file SaveLoadPanel — Save / Load / Rewind UI for the viewer sidebar.
 *
 * Provides buttons to:
 * - Save the current world state as a JSON snapshot file
 * - Load a previously saved snapshot file
 * - Rewind to a specific tick (restore from room history)
 * - List saved snapshot files
 *
 * @component
 */

/**
 * Save/Load/Rewind panel for the viewer sidebar.
 *
 * @param {Object} props
 * @param {number} props.currentTick — current server tick
 * @param {boolean} props.connected — whether the server is connected
 * @param {boolean} props.ended — whether the scenario has ended
 * @param {boolean} props.disabled — whether buttons should be disabled
 */
export default function SaveLoadPanel({
    currentTick = 0,
    connected = false,
    ended = false,
    disabled = false,
    sseError = null,
    onClearError = null,
}) {
    const [snapshots, setSnapshots] = useState(/** @type {Array<{file:string, size:number, modified:string}>} */ ([]));
    const [status, setStatus] = useState(/** @type {string|null} */ (null));
    const [error, setError] = useState(/** @type {string|null} */ (null));
    const [rewindTick, setRewindTick] = useState(String(currentTick > 0 ? currentTick - 1 : 0));
    const [inProgress, setInProgress] = useState(false);
    const fileInputRef = useRef(/** @type {HTMLInputElement|null} */ (null));

    const isDisabled = disabled || inProgress || !connected;

    // ─── Load snapshot list ──────────────────────────────────────────────

    const refreshSnapshots = useCallback(async () => {
        try {
            const data = await getSnapshots();
            setSnapshots(data.snapshots || []);
        } catch {
            // Directory may not exist — ignore
            setSnapshots([]);
        }
    }, []);

    useEffect(() => {
        refreshSnapshots();
    }, [refreshSnapshots]);

    // ─── SSE errors forwarded from server ────────────────────────────────
    useEffect(() => {
        if (sseError) {
            setError(`[${sseError.code}] ${sseError.message}`);
            setStatus(null);
            setInProgress(false);
            if (onClearError) onClearError();
        }
    }, [sseError, onClearError]);

    // ─── Actions ─────────────────────────────────────────────────────────

    /** Save current state as a snapshot file */
    const handleSave = useCallback(async () => {
        setInProgress(true);
        setError(null);
        setStatus('Saving snapshot...');
        try {
            await postSaveSnapshot();
            setStatus('Snapshot save initiated. Check server console.');
            // Refresh the list after a delay to allow file to be written
            setTimeout(refreshSnapshots, 1000);
        } catch (err) {
            setError(err.message || 'Failed to save snapshot');
            setStatus(null);
        } finally {
            setInProgress(false);
        }
    }, [refreshSnapshots]);

    /** Load a snapshot from a selected file */
    const handleLoadFile = useCallback(async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setInProgress(true);
        setError(null);
        setStatus(`Loading ${file.name}...`);
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            await postLoadSnapshot(data);
            setStatus(`Snapshot "${file.name}" load initiated.`);
        } catch (err) {
            setError(err.message || 'Failed to load snapshot');
            setStatus(null);
        } finally {
            setInProgress(false);
            // Reset file input so the same file can be re-selected
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }, []);

    /** Rewind to a specific tick */
    const handleRestoreTick = useCallback(async () => {
        const tick = parseInt(rewindTick, 10);
        if (isNaN(tick) || tick < 0) {
            setError('Invalid tick number');
            return;
        }
        if (tick >= currentTick) {
            setError(`Cannot rewind to tick ${tick} (current tick is ${currentTick})`);
            return;
        }

        setInProgress(true);
        setError(null);
        setStatus(`Restoring to tick ${tick}...`);
        try {
            await postRestoreTick(tick);
            setStatus(`Restore to tick ${tick} initiated.`);
        } catch (err) {
            setError(err.message || 'Failed to restore tick');
            setStatus(null);
        } finally {
            setInProgress(false);
        }
    }, [rewindTick, currentTick]);

    /** Load a snapshot from the saved files list */
    const handleLoadFromList = useCallback(async (fileName) => {
        setInProgress(true);
        setError(null);
        setStatus(`Loading ${fileName}...`);
        try {
            const res = await fetch(`/snapshots/${fileName}`);
            if (!res.ok) throw new Error(`Failed to fetch ${fileName}: ${res.status}`);
            const data = await res.json();
            await postLoadSnapshot(data);
            setStatus(`Snapshot "${fileName}" load initiated.`);
        } catch (err) {
            setError(err.message || 'Failed to load snapshot from list');
            setStatus(null);
        } finally {
            setInProgress(false);
        }
    }, []);

    /** Format file size for display */
    const formatSize = (bytes) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    // ─── Render ──────────────────────────────────────────────────────────

    const btnClass = (extra) => `btn-primary${extra ? ` ${extra}` : ''}`;

    return (
        <div className="save-load-panel">
            {/* Status / Error messages */}
            {status && <div className="save-load-status info">{status}</div>}
            {error && (
                <div className="save-load-status error">
                    {error}
                    <button className="dismiss-btn" onClick={() => setError(null)}>
                        ×
                    </button>
                </div>
            )}

            {/* ─── Save Snapshot ─────────────────────────────── */}
            <div className="save-load-section">
                <h3>
                    <DownloadIcon size={16} />
                    Save Snapshot
                </h3>
                <p>Save the current world state to a JSON file for later inspection or replay.</p>
                <div className="save-load-actions">
                    <button className={btnClass()} onClick={handleSave} disabled={isDisabled}>
                        <DownloadIcon size={14} />
                        Save Snapshot
                    </button>
                </div>
            </div>

            {/* ─── Load Snapshot ─────────────────────────────── */}
            <div className="save-load-section">
                <h3>
                    <DatabaseIcon size={16} />
                    Load Snapshot
                </h3>
                <p>Load a previously saved snapshot file to restore the world state.</p>
                <div className="save-load-actions">
                    <button className={btnClass()} onClick={() => fileInputRef.current?.click()} disabled={isDisabled}>
                        <DatabaseIcon size={14} />
                        Load from File...
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        style={{ display: 'none' }}
                        onChange={handleLoadFile}
                    />
                </div>
            </div>

            {/* ─── Rewind to Tick ────────────────────────────── */}
            <div className="save-load-section">
                <h3>
                    <RefreshCwIcon size={16} />
                    Rewind to Tick
                </h3>
                <p>Restore the world state to a past tick (from room history).</p>
                <div className="save-load-actions rewind-row">
                    <input
                        type="number"
                        className="rewind-input"
                        value={rewindTick}
                        min={0}
                        max={Math.max(0, currentTick - 1)}
                        onChange={(e) => setRewindTick(e.target.value)}
                        disabled={isDisabled}
                    />
                    <button className={btnClass()} onClick={handleRestoreTick} disabled={isDisabled}>
                        <RefreshCwIcon size={14} />
                        Restore
                    </button>
                </div>
            </div>

            {/* ─── Saved Snapshots List ──────────────────────── */}
            <div className="save-load-section">
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
                {snapshots.length === 0 ? (
                    <p className="no-snapshots">No saved snapshots yet.</p>
                ) : (
                    <ul className="snapshot-list">
                        {snapshots.map((s) => (
                            <li key={s.file} className="snapshot-item">
                                <span className="snapshot-name" title={s.file}>
                                    {s.file}
                                </span>
                                <span className="snapshot-meta">
                                    {formatSize(s.size)} — {new Date(s.modified).toLocaleString()}
                                </span>
                                <button
                                    className="btn-secondary btn-small"
                                    onClick={() => handleLoadFromList(s.file)}
                                    disabled={isDisabled}
                                >
                                    Load
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
