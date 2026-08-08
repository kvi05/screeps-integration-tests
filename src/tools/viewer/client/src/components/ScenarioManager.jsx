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
 * - BM-6 (future): Flags (--only, --profiling)
 * - BM-8 (future): Stop current run
 * - BM-9: Batch summary
 *
 * @component
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import ScenarioList from './ScenarioList';
import { getScenarios, postRun } from '../api/client';
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
} from './Icons';

/**
 * @param {Object} props
 * @param {() => void} props.onNavigateToViewer — navigate to /viewer
 */
export default function ScenarioManager({ onNavigateToViewer }) {
    /** @type {[Array<{name:string, file:string, size:number, modified:string}>, Function]} */
    const [scenarios, setScenarios] = useState([]);
    const [statuses, setStatuses] = useState(/** @type {Object<string, string>} */ ({}));
    const [timings, setTimings] = useState(/** @type {Object<string, {elapsed?:number, total?:number, tickRate?:number}>} */ ({}));
    const [filter, setFilter] = useState('');
    const [groupPrefix, setGroupPrefix] = useState('');
    const [loading, setLoading] = useState(true);
    const [profiling, setProfiling] = useState(false);

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

    // Compute available prefixes for grouping
    const prefixes = useMemo(
        () => [...new Set(scenarios.map((s) => s.name.split('-')[0] + '-'))].sort(),
        [scenarios],
    );

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
                        <input
                            type="checkbox"
                            checked={profiling}
                            onChange={(e) => setProfiling(e.target.checked)}
                        />
                        Profiling
                    </label>
                </div>
                <button onClick={handleRunAll} disabled={scenarios.length === 0} className="btn-primary">
                    <PlayIcon size={16} />
                    Run All
                </button>
            </div>

            {/* Content */}
            <div className="sm-content">
                {/* Batch summary (BM-9) */}
                {hasResults && (
                    <div className="sm-batch-summary">
                        <div className="summary-item">
                            <CheckIcon size={16} style={{ color: 'var(--success)' }} />
                            <span className="summary-count pass">{summary.pass}</span>
                            <span style={{ color: 'var(--text-muted)' }}>passed</span>
                        </div>
                        <div className="summary-divider" />
                        <div className="summary-item">
                            <AlertCircleIcon size={16} style={{ color: 'var(--error)' }} />
                            <span className="summary-count fail">{summary.fail}</span>
                            <span style={{ color: 'var(--text-muted)' }}>failed</span>
                        </div>
                        <div className="summary-divider" />
                        <div className="summary-item">
                            <ClockIcon size={16} style={{ color: 'var(--text-muted)' }} />
                            <span className="summary-count skip">{summary.skip}</span>
                            <span style={{ color: 'var(--text-muted)' }}>skipped</span>
                        </div>
                        <div className="summary-progress">
                            <div className="summary-progress-bar" style={{ width: `${progressPct}%` }} />
                        </div>
                        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
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
                        onRun={handleRunOne}
                        onInteractive={handleInteractive}
                    />
                )}
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