/**
 * @file ScenarioManager — main screen: list scenarios, run all/single, interactive launch.
 *
 * Adapted from screeps-dojo (MIT) ScenarioList.tsx.
 *
 * @component
 */

import { useState, useEffect, useCallback } from 'react';
import ScenarioList from './ScenarioList';
import { getScenarios, postRun } from '../api/client';

/**
 * @param {Object} props
 * @param {() => void} props.onNavigateToViewer — navigate to /viewer
 */
export default function ScenarioManager({ onNavigateToViewer }) {
    /** @type {[Array<{name:string, file:string, size:number, modified:string}>, Function]} */
    const [scenarios, setScenarios] = useState([]);
    const [statuses, setStatuses] = useState(/** @type {Object<string, string>} */ ({}));
    const [filter, setFilter] = useState('');
    const [groupPrefix, setGroupPrefix] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Restore persisted statuses from sessionStorage (survives mode switches)
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
            const { scenario, status } = e.detail || {};
            if (scenario) {
                // Extract scenario name from path
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
            }
        };
        window.addEventListener('scenario-result', handleResult);

        return () => {
            cancelled = true;
            window.removeEventListener('scenario-result', handleResult);
        };
    }, []);

    const handleRunAll = useCallback(async () => {
        for (const s of scenarios) {
            setStatuses((prev) => ({ ...prev, [s.name]: 'pending' }));
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
        (name) => {
            postRun(name, true).catch(() => {});
            onNavigateToViewer();
        },
        [onNavigateToViewer],
    );

    // Compute available prefixes for grouping
    const prefixes = [...new Set(scenarios.map((s) => s.name.split('-')[0] + '-'))].sort();

    const filtered = scenarios.filter((s) => {
        if (filter && !s.name.toLowerCase().includes(filter.toLowerCase())) return false;
        if (groupPrefix && !s.name.startsWith(groupPrefix)) return false;
        return true;
    });

    return (
        <div className="scenario-manager">
            <div className="scenario-manager-header">
                <h2>Scenarios</h2>
                <div className="scenario-manager-actions">
                    <input
                        type="text"
                        placeholder="Filter by name..."
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className="scenario-filter-input"
                    />
                    <select
                        value={groupPrefix}
                        onChange={(e) => setGroupPrefix(e.target.value)}
                        className="scenario-group-select"
                    >
                        <option value="">All groups</option>
                        {prefixes.map((p) => (
                            <option key={p} value={p}>
                                {p}*
                            </option>
                        ))}
                    </select>
                    <button onClick={handleRunAll} disabled={scenarios.length === 0} className="btn-run-all">
                        ▶ Run All
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="scenario-loading">Loading scenarios...</div>
            ) : (
                <ScenarioList
                    scenarios={filtered}
                    statuses={statuses}
                    onRun={handleRunOne}
                    onInteractive={handleInteractive}
                />
            )}

            <div className="scenario-manager-footer">
                <button onClick={onNavigateToViewer} className="btn-viewer">
                    Go to Viewer →
                </button>
            </div>
        </div>
    );
}
