/**
 * @file ScenarioList — table of scenarios with statuses and actions.
 *
 * @component
 */

const STATUS_COLORS = {
    pending: '#888',
    running: '#2196f3',
    pass: '#4caf50',
    fail: '#f44336',
    skip: '#555',
};

/**
 * @param {Object} props
 * @param {Array<{name:string, file:string, size:number, modified:string}>} props.scenarios
 * @param {Object<string,string>} props.statuses — name → 'pending'|'running'|'passed'|'failed'|'skipped'
 * @param {(name:string) => void} props.onRun
 * @param {(name:string) => void} props.onInteractive
 */
export default function ScenarioList({ scenarios = [], statuses = {}, onRun, onInteractive }) {
    return (
        <div className="scenario-list">
            <table>
                <thead>
                    <tr>
                        <th>Status</th>
                        <th>Name</th>
                        <th>Size</th>
                        <th>Modified</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {scenarios.map((s) => {
                        const status = statuses[s.name] || '';
                        const color = STATUS_COLORS[status] || '#888';
                        return (
                            <tr key={s.name} className="scenario-row">
                                <td>
                                    {status && <span className="status-dot" style={{ backgroundColor: color }} />}
                                    {status || '—'}
                                </td>
                                <td className="scenario-name">{s.name}</td>
                                <td>{formatSize(s.size)}</td>
                                <td>{formatDate(s.modified)}</td>
                                <td className="scenario-actions">
                                    <button onClick={() => onRun(s.name)} className="btn-run">
                                        Run
                                    </button>
                                    <button onClick={() => onInteractive(s.name)} className="btn-interactive">
                                        Interactive
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                    {scenarios.length === 0 && (
                        <tr>
                            <td colSpan={5} className="scenario-empty">
                                No scenarios found
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
 * Format ISO date to short form.
 * @param {string} iso
 * @returns {string}
 */
function formatDate(iso) {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
    } catch {
        return iso;
    }
}
