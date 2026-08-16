/**
 * @file ScenarioManager — main screen: list scenarios, run all/single, interactive launch.
 *
 * Features:
 * - SM-1: List all *.scenario.js (auto-discovery)
 * - SM-2: Run all (batch mode)
 * - SM-3: Run single (batch mode)
 * - SM-4: Interactive launch
 * - SM-5/6: Status with color
 * - SM-7: Timing (elapsed/total)
 * - SM-8: tick/sec
 * - SM-9: Filter/search
 * - SM-10: Group by prefix
 * - SM-11: Snapshots tab — launch/delete/import world snapshots
 * - BM-6 (future): Flags (--only, --profiling)
 * - BM-8 (future): Stop current run
 * - BM-9: Batch summary
 *
 * @component
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ScenarioList from './ScenarioList';
import { getScenarios, postRun, getSnapshots, postRunFromSnapshot, deleteSnapshot } from '../api/client';
import { formatSize, formatDuration } from '../utils/format';
import {
    RocketIcon,
    SearchIcon,
    PlayIcon,
    MonitorIcon,
    CheckIcon,
    AlertCircleIcon,
    ClockIcon,
    LoaderIcon,
    EyeIcon,
    CircleIcon,
    LayersIcon,
    CopyIcon,
} from './Icons';

/** Mirrors ScenarioList.STATUS_CONFIG for detail panel use */
const STATUS_CONFIG = {
    pending: { icon: ClockIcon, label: 'Pending' },
    running: { icon: LoaderIcon, label: 'Running' },
    pass: { icon: CheckIcon, label: 'Passed' },
    passed: { icon: CheckIcon, label: 'Passed' },
    fail: { icon: AlertCircleIcon, label: 'Failed' },
    failed: { icon: AlertCircleIcon, label: 'Failed' },
    skip: { icon: CircleIcon, label: 'Skipped' },
    skipped: { icon: CircleIcon, label: 'Skipped' },
};

/**
 * @param {Object} props
 * @param {() => void} props.onNavigateToViewer — navigate to /viewer
 */
export default function ScenarioManager({ onNavigateToViewer }) {
    /** @type {[Array<{name:string, file:string, size:number, modified:string}>, Function]} */
    const [scenarios, setScenarios] = useState([]);
    const [statuses, setStatuses] = useState(/** @type {Object<string, string>} */ ({}));
    const [timings, setTimings] = useState(
        /** @type {Object<string, {elapsed?:number, total?:number, tickRate?:number}>} */ ({}),
    );
    const [filter, setFilter] = useState('');
    const [groupPrefix, setGroupPrefix] = useState('');
    const [loading, setLoading] = useState(true);
    const [profiling, setProfiling] = useState(false);
    const [selectedName, setSelectedName] = useState(/** @type {string|null} */ (null));
    const [detailTab, setDetailTab] = useState(/** @type {'main'|'snapshots'} */ ('main'));
    /** @type {[Array<{file:string, size:number, modified:string, tick?:number, scenario?:string}>, Function]} */
    const [snapshots, setSnapshots] = useState([]);
    const [snapshotError, setSnapshotError] = useState(/** @type {string|null} */ (null));
    const [snapshotsLoadError, setSnapshotsLoadError] = useState(false);
    const snapshotInputRef = useRef(/** @type {HTMLInputElement|null} */ (null));

    // Return to Main tab whenever a different scenario is selected
    useEffect(() => {
        setDetailTab('main');
    }, [selectedName]);

    useEffect(() => {
        // Restore persisted statuses from sessionStorage
        try {
            const saved = JSON.parse(sessionStorage.getItem('sit-scenario-statuses') || '{}');
            if (Object.keys(saved).length > 0) {
                setStatuses(saved);
            }
        } catch {
            /* ignore */
        }

        let cancelled = false;
        async function load() {
            try {
                const data = await getScenarios();
                if (!cancelled && data.scenarios) {
                    setScenarios(data.scenarios);
                }
            } catch {
                /* server not available */
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();

        // Listen for scenario-result SSE events forwarded via window
        const handleResult = (e) => {
            const { scenario, status, time, ticks } = e.detail || {};
            if (scenario) {
                const name = scenario.replace(/^.*[/\\]/, '').replace('.scenario.js', '');
                setStatuses((prev) => {
                    const next = {
                        ...prev,
                        [name]: status === 'pass' ? 'pass' : status === 'skip' ? 'skip' : 'fail',
                    };
                    try {
                        sessionStorage.setItem('sit-scenario-statuses', JSON.stringify(next));
                    } catch {
                        /* ignore */
                    }
                    return next;
                });
                // Record timing
                if (time != null) {
                    setTimings((prev) => ({
                        ...prev,
                        [name]: { total: time, tickRate: ticks && time ? (ticks / time) * 1000 : undefined },
                    }));
                }
            }
        };
        window.addEventListener('scenario-result', handleResult);

        return () => {
            cancelled = true;
            window.removeEventListener('scenario-result', handleResult);
        };
    }, []);

    const handleRunAll = useCallback(async () => {
        // Mark all as pending, then launch them — the server queues with concurrency limit
        for (const s of scenarios) {
            setStatuses((prev) => ({ ...prev, [s.name]: 'pending' }));
        }
        for (const s of scenarios) {
            try {
                await postRun(s.name, false);
                setStatuses((prev) => ({ ...prev, [s.name]: 'running' }));
            } catch {
                setStatuses((prev) => ({ ...prev, [s.name]: 'fail' }));
            }
        }
    }, [scenarios]);

    const handleRunOne = useCallback(async (name) => {
        setStatuses((prev) => ({ ...prev, [name]: 'pending' }));
        try {
            await postRun(name, false);
            setStatuses((prev) => ({ ...prev, [name]: 'running' }));
        } catch {
            setStatuses((prev) => ({ ...prev, [name]: 'fail' }));
        }
    }, []);

    const handleInteractive = useCallback(
        async (name) => {
            try {
                await postRun(name, true);
            } catch {
                /* ignore — still navigate */
            }
            onNavigateToViewer();
        },
        [onNavigateToViewer],
    );

    // ─── Snapshots tab ────────────────────────────────────────────────────

    /** Refresh the snapshot list, filtered by the selected scenario */
    const refreshSnapshots = useCallback(async () => {
        try {
            const data = await getSnapshots();
            // Filter by selected scenario (server normalizes meta.scenario to
            // basename); snapshots without meta.scenario are hidden.
            const filtered = (data.snapshots || []).filter((s) => !selectedName || s.scenario === selectedName);
            setSnapshots(filtered);
            setSnapshotsLoadError(false);
        } catch {
            setSnapshots([]);
            setSnapshotsLoadError(true);
        }
    }, [selectedName]);

    // Refresh when switching to the Snapshots tab or changing the scenario
    useEffect(() => {
        if (detailTab === 'snapshots' && selectedName) {
            refreshSnapshots();
        }
    }, [detailTab, selectedName, refreshSnapshots]);

    /** Launch a new interactive run from a saved snapshot file */
    const handleLaunchFromSnapshot = useCallback(
        async (snapshotFile) => {
            setSnapshotError(null);
            try {
                await postRunFromSnapshot(snapshotFile);
                onNavigateToViewer();
            } catch (err) {
                setSnapshotError(err.message || 'Failed to launch from snapshot');
            }
        },
        [onNavigateToViewer],
    );

    /** Delete a saved snapshot file */
    const handleDeleteSnapshot = useCallback(
        async (snapshotFile) => {
            setSnapshotError(null);
            try {
                await deleteSnapshot(snapshotFile);
                // Refresh the snapshot list
                refreshSnapshots();
            } catch (err) {
                setSnapshotError(err.message || 'Failed to delete snapshot');
            }
        },
        [refreshSnapshots],
    );

    /** Open the file picker to launch directly from a local snapshot JSON */
    const handleLaunchFromFile = useCallback(() => {
        snapshotInputRef.current?.click();
    }, []);

    /** Launch a new interactive run straight from a picked snapshot file
     *  (the snapshot is NOT persisted — it is passed inline to the server) */
    const handleSnapshotFilePicked = useCallback(
        async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            setSnapshotError(null);
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                await postRunFromSnapshot(data);
                onNavigateToViewer();
            } catch (err) {
                setSnapshotError(err.message || 'Failed to launch from snapshot file');
            } finally {
                // Reset file input so the same file can be re-selected
                if (snapshotInputRef.current) snapshotInputRef.current.value = '';
            }
        },
        [onNavigateToViewer],
    );

    // Compute available prefixes for grouping
    const prefixes = useMemo(() => [...new Set(scenarios.map((s) => s.name.split('-')[0] + '-'))].sort(), [scenarios]);

    const filtered = useMemo(
        () =>
            scenarios.filter((s) => {
                if (filter && !s.name.toLowerCase().includes(filter.toLowerCase())) return false;
                if (groupPrefix && !s.name.startsWith(groupPrefix)) return false;
                return true;
            }),
        [scenarios, filter, groupPrefix],
    );

    // Batch summary counts
    const summary = useMemo(() => {
        const counts = { pass: 0, fail: 0, skip: 0, pending: 0, running: 0 };
        for (const s of scenarios) {
            const st = statuses[s.name];
            if (st && counts[st] !== undefined) counts[st]++;
        }
        return counts;
    }, [scenarios, statuses]);

    const hasResults = summary.pass + summary.fail + summary.skip > 0;
    const totalDone = summary.pass + summary.fail + summary.skip;
    const progressPct = scenarios.length > 0 ? (totalDone / scenarios.length) * 100 : 0;

    // Resolve selected scenario object
    const selectedScenario = useMemo(
        () => (selectedName ? scenarios.find((s) => s.name === selectedName) || null : null),
        [scenarios, selectedName],
    );
    const selectedStatus = selectedName ? statuses[selectedName] || '' : '';
    const selectedTiming = selectedName ? timings[selectedName] || {} : {};
    const selectedStatusConfig = STATUS_CONFIG[selectedStatus] || null;
    const SelectedStatusIcon = selectedStatusConfig?.icon;

    const handleCopy = useCallback((text) => {
        navigator.clipboard.writeText(text).catch(() => {});
    }, []);

    return (
        <div className="scenario-manager">
            {/* Header */}
            <div className="sm-header">
                <div className="sm-header-left">
                    <div className="sm-logo">
                        <RocketIcon size={22} />
                    </div>
                    <div className="sm-title-group">
                        <h1>Screeps Integration Tests</h1>
                        <p>Interactive test runner & world viewer</p>
                    </div>
                </div>
                <div className="sm-header-right">
                    <button className="btn-secondary" onClick={onNavigateToViewer}>
                        <EyeIcon size={16} />
                        Open Viewer
                    </button>
                </div>
            </div>

            {/* Toolbar */}
            <div className="sm-toolbar">
                <div className="sm-search">
                    <SearchIcon size={14} className="search-icon" />
                    <input
                        type="text"
                        placeholder="Filter scenarios..."
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                    />
                </div>
                <select
                    value={groupPrefix}
                    onChange={(e) => setGroupPrefix(e.target.value)}
                    className="sm-group-select"
                >
                    <option value="">All groups</option>
                    {prefixes.map((p) => (
                        <option key={p} value={p}>
                            {p}*
                        </option>
                    ))}
                </select>
                {/* Future: BM-6 flags */}
                <div className="sm-flags">
                    <label className="sm-flag" title="Enable callgrind profiling">
                        <input type="checkbox" checked={profiling} onChange={(e) => setProfiling(e.target.checked)} />
                        Profiling
                    </label>
                </div>
                <button onClick={handleRunAll} disabled={scenarios.length === 0} className="btn-primary">
                    <PlayIcon size={16} />
                    Run All
                </button>
            </div>

            {/* Content — master-detail layout */}
            <div className="sm-content">
                {/* Left panel: batch summary + scenario list */}
                <div className="sm-list-panel">
                    <div className="sm-list-scroll">
                        {hasResults && (
                            <div className="sm-batch-summary">
                                <div className="summary-item">
                                    <CheckIcon size={14} style={{ color: 'var(--success)' }} />
                                    <span className="summary-count pass">{summary.pass}</span>
                                    <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>passed</span>
                                </div>
                                <div className="summary-divider" />
                                <div className="summary-item">
                                    <AlertCircleIcon size={14} style={{ color: 'var(--error)' }} />
                                    <span className="summary-count fail">{summary.fail}</span>
                                    <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>failed</span>
                                </div>
                                <div className="summary-divider" />
                                <div className="summary-item">
                                    <ClockIcon size={14} style={{ color: 'var(--text-muted)' }} />
                                    <span className="summary-count skip">{summary.skip}</span>
                                    <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
                                        skipped
                                    </span>
                                </div>
                                <div className="summary-progress">
                                    <div className="summary-progress-bar" style={{ width: `${progressPct}%` }} />
                                </div>
                                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
                                    {totalDone}/{scenarios.length}
                                </span>
                            </div>
                        )}

                        {loading ? (
                            <div className="scenario-loading">
                                <div className="loading-spinner" />
                                <div>Loading scenarios...</div>
                            </div>
                        ) : (
                            <ScenarioList
                                scenarios={filtered}
                                statuses={statuses}
                                timings={timings}
                                selected={selectedName}
                                onSelect={setSelectedName}
                                onRun={handleRunOne}
                                onInteractive={handleInteractive}
                            />
                        )}
                    </div>
                </div>

                {/* Right panel: scenario detail */}
                <div className="sm-detail-panel">
                    {selectedScenario ? (
                        <>
                            <div className="sm-detail-header">
                                <div className="detail-header-left">
                                    <div className="detail-name-row">
                                        <span
                                            className="detail-name"
                                            title="Click to copy"
                                            onClick={() => handleCopy(selectedScenario.name)}
                                        >
                                            {selectedScenario.name}
                                        </span>
                                        <span className="detail-copy-icon" aria-hidden="true">
                                            <CopyIcon size={14} />
                                        </span>
                                    </div>
                                    <div className="detail-file-row">
                                        <span
                                            className="detail-file"
                                            title="Click to copy"
                                            onClick={() => handleCopy(selectedScenario.file)}
                                        >
                                            {selectedScenario.file}
                                        </span>
                                        <span className="detail-copy-icon" aria-hidden="true">
                                            <CopyIcon size={12} />
                                        </span>
                                    </div>
                                </div>
                                <div className="detail-actions">
                                    <button
                                        className="btn-secondary"
                                        onClick={() => handleRunOne(selectedScenario.name)}
                                    >
                                        <PlayIcon size={14} />
                                        Run
                                    </button>
                                    <button
                                        className="btn-primary"
                                        onClick={() => handleInteractive(selectedScenario.name)}
                                    >
                                        <MonitorIcon size={14} />
                                        Interactive
                                    </button>
                                </div>
                            </div>

                            <div className="sm-detail-tabs">
                                <button
                                    className={`sm-detail-tab ${detailTab === 'main' ? 'active' : ''}`}
                                    onClick={() => setDetailTab('main')}
                                >
                                    Main
                                </button>
                                <button
                                    className={`sm-detail-tab ${detailTab === 'snapshots' ? 'active' : ''}`}
                                    onClick={() => setDetailTab('snapshots')}
                                >
                                    Snapshots
                                </button>
                            </div>

                            {detailTab === 'main' ? (
                                <>
                                    <div className="sm-detail-meta">
                                        <div className="meta-item">
                                            <div className="meta-label">Status</div>
                                            <div className="meta-value">
                                                {selectedStatusConfig ? (
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <SelectedStatusIcon
                                                            size={14}
                                                            style={{
                                                                color:
                                                                    selectedStatus === 'pass'
                                                                        ? 'var(--success)'
                                                                        : selectedStatus === 'fail'
                                                                          ? 'var(--error)'
                                                                          : selectedStatus === 'running'
                                                                            ? 'var(--info)'
                                                                            : 'var(--text-muted)',
                                                            }}
                                                        />
                                                        {selectedStatusConfig.label}
                                                    </span>
                                                ) : (
                                                    <span style={{ color: 'var(--text-dim)' }}>Not run</span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="meta-item">
                                            <div className="meta-label">Size</div>
                                            <div className="meta-value">{formatSize(selectedScenario.size)}</div>
                                        </div>
                                        <div className="meta-item">
                                            <div className="meta-label">Timing</div>
                                            <div className="meta-value">
                                                {selectedTiming.total != null
                                                    ? formatDuration(selectedTiming.total)
                                                    : selectedTiming.elapsed != null
                                                      ? `${formatDuration(selectedTiming.elapsed)}…`
                                                      : '—'}
                                            </div>
                                        </div>
                                        <div className="meta-item">
                                            <div className="meta-label">Tick/s</div>
                                            <div className="meta-value">
                                                {selectedTiming.tickRate != null
                                                    ? selectedTiming.tickRate.toFixed(1)
                                                    : '—'}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Extension point for future features */}
                                    <div className="sm-detail-section">
                                        <div className="section-title">Metrics & History</div>
                                        <div className="section-placeholder">
                                            Run the scenario to see performance charts and historical results
                                        </div>
                                    </div>
                                    <div className="sm-detail-section">
                                        <div className="section-title">Description</div>
                                        <div className="section-placeholder">
                                            Scenario descriptions coming soon — add a JSDoc @description to your
                                            .scenario.js file
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="sm-snapshots-tab">
                                    {snapshots.length === 0 ? (
                                        <p className="no-snapshots">
                                            {snapshotsLoadError
                                                ? 'Failed to load snapshots — refresh to retry.'
                                                : 'No snapshots for this scenario.'}
                                        </p>
                                    ) : (
                                        <ul className="sm-snapshot-list thin-scroll">
                                            {snapshots.map((s) => (
                                                <li key={s.file} className="sm-snapshot-item">
                                                    <div className="sm-snapshot-name-row thin-scroll">
                                                        <span className="sm-snapshot-name" title={s.file}>
                                                            {s.file}
                                                        </span>
                                                    </div>
                                                    <div className="sm-snapshot-meta-row">
                                                        {s.tick !== undefined && (
                                                            <span className="sm-snapshot-badge">Tick {s.tick}</span>
                                                        )}
                                                        <span className="sm-snapshot-sep">·</span>
                                                        <span className="sm-snapshot-meta">
                                                            {new Date(s.modified).toLocaleString()}
                                                        </span>
                                                        <span className="sm-snapshot-sep">·</span>
                                                        <span className="sm-snapshot-meta">{formatSize(s.size)}</span>
                                                    </div>
                                                    <div className="sm-snapshot-actions">
                                                        <button
                                                            className="btn-primary btn-small"
                                                            onClick={() => handleLaunchFromSnapshot(s.file)}
                                                        >
                                                            Launch
                                                        </button>
                                                        <button
                                                            className="btn-secondary btn-small"
                                                            onClick={() => handleDeleteSnapshot(s.file)}
                                                        >
                                                            Delete
                                                        </button>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                    <div className="sm-snapshot-footer">
                                        <button className="btn-secondary" onClick={handleLaunchFromFile}>
                                            Launch from file...
                                        </button>
                                        <input
                                            ref={snapshotInputRef}
                                            type="file"
                                            accept=".json"
                                            style={{ display: 'none' }}
                                            onChange={handleSnapshotFilePicked}
                                        />
                                        {snapshotError && <p className="sm-snapshot-error">{snapshotError}</p>}
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="sm-detail-empty">
                            <LayersIcon size={56} className="empty-icon" />
                            <div className="empty-title">Select a scenario</div>
                            <div className="empty-hint">
                                Click on a scenario in the list to see its details and run history
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="sm-footer">
                <span className="sm-footer-info">
                    {scenarios.length} scenario{scenarios.length !== 1 ? 's' : ''} found
                    {filtered.length !== scenarios.length && ` · ${filtered.length} shown`}
                </span>
                <button className="btn-ghost" onClick={onNavigateToViewer}>
                    <MonitorIcon size={16} />
                    Go to Viewer →
                </button>
            </div>
        </div>
    );
}
