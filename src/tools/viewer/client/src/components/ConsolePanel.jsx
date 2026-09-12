/**
 * @file ConsolePanel — dockable log panel with filtering and search.
 *
 * Features:
 * - CL-1: Console panel (report.logs, errors, warnings)
 * - CL-2: Filter by level (all/error/warn/info)
 * - CL-3: Search logs
 * - CL-4: Click log → jump to tick
 * - CL-5 (future): JS input for world.exec()
 * - CL-6 (future): Command history
 *
 * @component
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { TerminalIcon, ChevronUpIcon, ChevronDownIcon, XIcon, SearchIcon } from './Icons';

/**
 * @param {Object} props
 * @param {Array<{level:string, message:string, bot:string, tick?:number}>} props.logs — all console entries
 * @param {(tick:number) => void} props.onJumpToTick — jump replay to tick
 * @param {boolean} props.visible
 * @param {(v:boolean) => void} props.onToggle
 */
export default function ConsolePanel({ logs = [], onJumpToTick, visible = true, onToggle }) {
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [height, setHeight] = useState(180);
    const listRef = useRef(null);

    // Auto-scroll to bottom when new logs arrive
    useEffect(() => {
        if (listRef.current) {
            listRef.current.scrollTop = listRef.current.scrollHeight;
        }
    }, [logs.length]);

    // Count by level
    const counts = useMemo(() => {
        const c = { all: logs.length, error: 0, warn: 0, info: 0, log: 0 };
        for (const log of logs) {
            if (c[log.level] !== undefined) c[log.level]++;
        }
        return c;
    }, [logs]);

    const filteredLogs = useMemo(() => {
        return logs.filter((log) => {
            if (filter !== 'all' && log.level !== filter) return false;
            if (search) {
                const q = search.toLowerCase();
                if (!log.message.toLowerCase().includes(q) && !(log.bot || '').toLowerCase().includes(q)) {
                    return false;
                }
            }
            return true;
        });
    }, [logs, filter, search]);

    if (!visible) {
        const hasErrors = counts.error > 0;
        const hasWarnings = counts.warn > 0;
        const badgeClass = hasErrors ? 'has-errors' : hasWarnings ? 'has-warnings' : '';
        return (
            <div className="console-collapsed" onClick={() => onToggle(true)}>
                <TerminalIcon size={16} />
                <span>Console</span>
                <span className={`console-badge ${badgeClass}`}>{logs.length}</span>
                <span className="console-expand">
                    <ChevronUpIcon size={14} />
                </span>
            </div>
        );
    }

    return (
        <div className="console-panel" style={{ height }}>
            {/* Resize handle */}
            <div
                className="console-resize-handle"
                onMouseDown={(e) => {
                    e.preventDefault();
                    const startY = e.clientY;
                    const startH = height;
                    const onMove = (ev) => {
                        setHeight(Math.max(80, Math.min(500, startH + startY - ev.clientY)));
                    };
                    const onUp = () => {
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                    };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                }}
            />

            {/* Toolbar */}
            <div className="console-toolbar">
                <span className="console-title">
                    <TerminalIcon size={14} />
                    Console ({filteredLogs.length}/{logs.length})
                </span>

                <div className="console-filters">
                    <button
                        className={`console-filter-btn ${filter === 'all' ? 'active' : ''}`}
                        data-filter="all"
                        onClick={() => setFilter('all')}
                    >
                        All {counts.all > 0 && <span className="filter-count">{counts.all}</span>}
                    </button>
                    <button
                        className={`console-filter-btn ${filter === 'error' ? 'active' : ''}`}
                        data-filter="error"
                        onClick={() => setFilter('error')}
                    >
                        Error {counts.error > 0 && <span className="filter-count">{counts.error}</span>}
                    </button>
                    <button
                        className={`console-filter-btn ${filter === 'warn' ? 'active' : ''}`}
                        data-filter="warn"
                        onClick={() => setFilter('warn')}
                    >
                        Warn {counts.warn > 0 && <span className="filter-count">{counts.warn}</span>}
                    </button>
                    <button
                        className={`console-filter-btn ${filter === 'info' ? 'active' : ''}`}
                        data-filter="info"
                        onClick={() => setFilter('info')}
                    >
                        Info {counts.info > 0 && <span className="filter-count">{counts.info}</span>}
                    </button>
                </div>

                <input
                    type="text"
                    className="console-search"
                    placeholder="Search logs..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />

                <button className="console-close" onClick={() => onToggle(false)} title="Hide console">
                    <ChevronDownIcon size={14} />
                </button>
            </div>

            {/* Log lines */}
            <div className="console-lines" ref={listRef}>
                {filteredLogs.map((log, i) => (
                    <div
                        key={i}
                        className="console-line"
                        onClick={() => {
                            if (log.tick !== undefined) {
                                onJumpToTick(log.tick);
                            }
                        }}
                    >
                        <span className={`console-level ${log.level || 'log'}`}>
                            {(log.level || 'log').slice(0, 4)}
                        </span>
                        {log.bot && <span className="console-bot">[{log.bot}]</span>}
                        <span className="console-msg">{log.message}</span>
                        {log.tick !== undefined && <span className="console-tick">T{log.tick}</span>}
                    </div>
                ))}
                {filteredLogs.length === 0 && (
                    <div className="console-empty">
                        {logs.length === 0 ? 'No console output yet' : 'No logs match the current filter'}
                    </div>
                )}
            </div>

            {/* JS input (future: CL-5 interactive console via world.exec) */}
            <div className="console-input-row">
                <span className="console-input-prompt">{'>'}</span>
                <input
                    type="text"
                    className="console-input"
                    placeholder="Execute JS in bot context (coming soon)..."
                    disabled
                />
            </div>
        </div>
    );
}
