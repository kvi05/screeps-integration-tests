/**
 * @file LiveControls — management of the real server.
 *
 * REST-based controls: pause/resume/step/speed.
 * Visually and logically separated from ReplayControls.
 *
 * @component
 */

import { useState, useEffect } from 'react';
import { postPause, postResume, postStep, postSpeed } from '../api/client';

/**
 * @param {Object} props
 * @param {boolean} props.connected
 * @param {string} props.serverState — 'idle' | 'running' | 'paused' | 'stepping'
 * @param {number} props.serverTick
 * @param {number} props.serverSpeed
 * @param {(state:string) => void} props.onServerStateChange
 */
export default function LiveControls({
    connected,
    serverState = 'idle',
    serverTick = 0,
    serverSpeed = 1000,
    onServerStateChange,
}) {
    const isRunning = serverState === 'running' || serverState === 'stepping';
    const isPaused = serverState === 'paused';
    const canControl = connected && serverState !== 'idle';

    const [localSpeed, setLocalSpeed] = useState(serverSpeed);
    useEffect(() => {
        setLocalSpeed(serverSpeed);
    }, [serverSpeed]);

    const handlePause = async () => {
        try {
            await postPause();
            // State will be confirmed by SSE status event
        } catch {
            /* connection error — ignore */
        }
    };

    const handleResume = async () => {
        try {
            await postResume();
            // State will be confirmed by SSE status event
        } catch {
            /* ignore */
        }
    };

    const handleStep = async () => {
        try {
            await postStep(1);
            // State will be confirmed by SSE status event
        } catch {
            /* ignore */
        }
    };

    const handleSpeed = async (s) => {
        const val = Number(s);
        setLocalSpeed(val);
        try {
            await postSpeed(val);
        } catch {
            /* ignore */
        }
    };

    const statusText =
        serverState === 'idle'
            ? 'Idle'
            : isRunning
              ? `Running (tick ${serverTick})`
              : isPaused
                ? `Paused (tick ${serverTick})`
                : `Stepping (tick ${serverTick})`;

    const statusColor = serverState === 'idle' ? '#888' : isRunning ? '#4caf50' : isPaused ? '#ff9800' : '#2196f3';

    return (
        <div className="live-controls">
            <span className="control-group-label">Live Server</span>

            <button
                onClick={isRunning ? handlePause : handleResume}
                disabled={!canControl}
                title={isRunning ? 'Pause' : 'Resume'}
            >
                {isRunning ? '⏸' : '▶'}
            </button>

            <button onClick={handleStep} disabled={!canControl} title="Step +1">
                ⏭
            </button>

            <label className="speed-label">
                Speed:
                <select value={localSpeed} onChange={(e) => handleSpeed(e.target.value)} disabled={!canControl}>
                    <option value={1}>1×</option>
                    <option value={5}>5×</option>
                    <option value={10}>10×</option>
                    <option value={20}>20×</option>
                    <option value={1000}>Max</option>
                </select>
            </label>

            <span className="status-indicator" style={{ color: statusColor }}>
                ● {statusText}
            </span>
        </div>
    );
}
