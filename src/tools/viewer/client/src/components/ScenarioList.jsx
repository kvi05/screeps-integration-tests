/**
 * @file ScenarioList — table of scenarios with statuses and actions.
 *
 * Features:
 * - SM-5/6: Status with color-coded icons
 * - SM-7: Timing (elapsed for running, total for completed)
 * - SM-8: tick/sec
 * - SM-3: Run single (batch mode)
 * - SM-4: Interactive launch
 *
 * @component
 */

import { CheckIcon, AlertCircleIcon, ClockIcon, LoaderIcon, CircleIcon, PlayIcon, MonitorIcon } from './Icons';

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
 * @param {Array<{name:string, file:string, size:number, modified:string}>} props.scenarios
 * @param {Object<string,string>} props.statuses — name → 'pending'|'running'|'passed'|'failed'|'skipped'
 * @param {Object<string,{elapsed?:number, total?:number, tickRate?:number}>} [props.timings]
 * @param {(name:string) => void} props.onRun
 * @param {(name:string) => void} props.onInteractive
 */
export default function ScenarioList({ scenarios = [], statuses = {}, timings = {}, onRun, onInteractive }) {
    return (
        <div className="scenario-list">
            <table>
                <thead>
                    <tr>
                        <th>Status</th>
                        <th>Name</th>
                        <th>Timing</th>
                        <th>Tick/s</th>
                        <th>Size</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {scenarios.map((s) => {
                        const status = statuses[s.name] || '';
                        const config = STATUS_CONFIG[status] || null;
                        const timing = timings[s.name] || {};
                        const StatusIcon = config?.icon;
                        return (
                            <tr key={s.name} className="scenario-row">
                                <td>
                                    {config && (
                                        <div className="scenario-status">
                                            <span className={`status-icon ${status}`}>
                                                {StatusIcon && (
                                                    <StatusIcon
                                                        size={12}
                                                        style={{
                                                            animation:
                                                                status === 'running'
                                                                    ? 'spin 1s linear infinite'
                                                                    : undefined,
                                                        }}
                                                    />
                                                )}
                                            </span>
                                            <span className={`status-label ${status}`}>{config.label}</span>
                                        </div>
                                    )}
                                    {!config && <span style={{ color: 'var(--text-dim)' }}>—</span>}
                                </td>
                                <td className="scenario-name">{s.name}</td>
                                <td className="scenario-timing">
                                    {timing.elapsed != null && (
                                        <span className="timing-elapsed">{formatDuration(timing.elapsed)}</span>
                                    )}
                                    {timing.total != null && <span>{formatDuration(timing.total)}</span>}
                                    {!timing.elapsed && !timing.total && '—'}
                                </td>
                                <td className="scenario-tickrate">
                                    {timing.tickRate != null ? `${timing.tickRate.toFixed(1)}` : '—'}
                                </td>
                                <td className="scenario-tickrate">{formatSize(s.size)}</td>
                                <td className="scenario-actions">
                                    <button onClick={() => onRun(s.name)} title="Run in batch mode">
                                        <PlayIcon size={12} />
                                        Run
                                    </button>
                                    <button
                                        onClick={() => onInteractive(s.name)}
                                        className="btn-interactive"
                                        title="Launch in interactive viewer"
                                    >
                                        <MonitorIcon size={12} />
                                        Interactive
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                    {scenarios.length === 0 && (
                        <tr>
                            <td colSpan={6}>
                                <div className="scenario-empty">
                                    <AlertCircleIcon size={48} className="empty-icon" />
                                    <div>No scenarios found</div>
                                </div>
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

/**
 * Format bytes to human-readable.
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Format milliseconds to short duration.
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
    if (ms == null) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}m ${s}s`;
}