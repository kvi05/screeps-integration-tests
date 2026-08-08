/**
 * @file ConsolePanel — dockable log panel with filtering and search.
 *
 * Reads console logs from frame.console entries.
 * Click on a log line → jump to that tick in replay mode.
 *
 * Adapted from screeps-dojo (MIT) ConsoleDrawer.tsx.
 *
 * @component
 */

import { useState, useMemo, useRef, useEffect } from 'react';

/**
 * @param {Object} props
 * @param {Array<{level:string, message:string, bot:string}>} props.logs — all console entries
 * @param {(tick:number) => void} props.onJumpToTick — jump replay to tick
 * @param {boolean} props.visible
 * @param {(v:boolean) => void} props.onToggle
 */
export default function ConsolePanel({ logs = [], onJumpToTick, visible = true, onToggle }) {
    const [filter, setFilter] = useState('all'); // all | error | warn | info
    const [search, setSearch] = useState('');
    const [height, setHeight] = useState(160);
    const listRef = useRef(null);

    // Auto-scroll to bottom when new logs arrive
    useEffect(() => {
        if (listRef.current) {
            listRef.current.scrollTop = listRef.current.scrollHeight;
        }
    }, [logs.length]);

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

    const levelColor = (level) => {
        switch (level) {
            case 'error':
                return '#f44336';
            case 'warn':
                return '#ff9800';
            case 'info':
                return '#2196f3';
            default:
                return '#e0e0e0';
        }
    };

    if (!visible) {
        return (
            <div className="console-panel-toggle" onClick={() => onToggle(true)}>
                ▲ Console ({logs.length})
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
                        setHeight(Math.max(100, Math.min(600, startH + startY - ev.clientY)));
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
                    Console ({filteredLogs.length}/{logs.length})
                </span>

                <div className="console-filters">
                    <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
                        All
                    </button>
                    <button className={filter === 'error' ? 'active' : ''} onClick={() => setFilter('error')}>
                        Error
                    </button>
                    <button className={filter === 'warn' ? 'active' : ''} onClick={() => setFilter('warn')}>
                        Warn
                    </button>
                    <button className={filter === 'info' ? 'active' : ''} onClick={() => setFilter('info')}>
                        Info
                    </button>
                </div>

                <input
                    type="text"
                    className="console-search"
                    placeholder="Search..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />

                <button className="console-close" onClick={() => onToggle(false)} title="Hide console">
                    ▼
                </button>
            </div>

            {/* Log lines */}
            <div className="console-lines" ref={listRef}>
                {filteredLogs.map((log, i) => (
                    <div
                        key={i}
                        className="console-line"
                        style={{ color: levelColor(log.level) }}
                        onClick={() => {
                            if (log.tick !== undefined) {
                                onJumpToTick(log.tick);
                            }
                        }}
                    >
                        <span className="console-level">{log.level.toUpperCase()}</span>
                        {log.bot && <span className="console-bot">[{log.bot}]</span>}
                        <span className="console-msg">{log.message}</span>
                        {log.tick !== undefined && <span className="console-tick">T{log.tick}</span>}
                    </div>
                ))}
                {filteredLogs.length === 0 && <div className="console-empty">No logs match the current filter</div>}
            </div>
        </div>
    );
}
