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
import { PlayIcon, PauseIcon, StepForwardIcon } from './Icons';

/**
 * @param {Object} props
 * @param {boolean} props.connected
 * @param {string} props.serverState — 'idle' | 'running' | 'paused' | 'stepping'
 * @param {number} props.serverTick
 * @param {number} props.serverSpeed
 * @param {(state:string) => void} props.onServerStateChange
 * @param {(play:boolean) => void} [props.onToggleLivePlay] — parent callback for space key coordination
 */
export default function LiveControls({
    connected,
    serverState = 'idle',
    serverTick = 0,
    serverSpeed = 1000,
    onServerStateChange,
    onToggleLivePlay,
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
            if (onToggleLivePlay) onToggleLivePlay(false);
        } catch {
            /* connection error — ignore */
        }
    };

    const handleResume = async () => {
        try {
            await postResume();
            if (onToggleLivePlay) onToggleLivePlay(true);
        } catch {
            /* ignore */
        }
    };

    const handleStep = async () => {
        try {
            await postStep(1);
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

    const handleSpeedStep = async (delta) => {
        const speeds = [1, 5, 10, 20, 1000];
        const idx = speeds.indexOf(localSpeed);
        const next = idx >= 0 ? speeds[Math.max(0, Math.min(speeds.length - 1, idx + delta))] : speeds[0];
        if (next !== localSpeed) await handleSpeed(next);
    };

    // Show stepping as paused visually (step is a transient action, no green flash)
    const visualState = serverState === 'stepping' ? 'paused' : serverState;
    const statusClass = visualState === 'idle' ? 'idle' : visualState === 'running' ? 'running' : 'paused';
    const statusText =
        serverState === 'idle'
            ? 'Idle'
            : serverState === 'stepping'
              ? `Paused · tick ${serverTick}`
              : isRunning
                ? `Running · tick ${serverTick}`
                : `Paused · tick ${serverTick}`;

    return (
        <div className="live-controls">
            <span className="control-group-label live">
                <span className="label-dot" />
                Live
            </span>

            <button
                className={`icon-btn ${isRunning ? 'primary' : ''}`}
                onClick={isRunning ? handlePause : handleResume}
                disabled={!canControl}
                title={isRunning ? 'Pause server' : 'Resume server'}
                aria-label={isRunning ? 'Pause server' : 'Resume server'}
            >
                {isRunning ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
            </button>

            <button
                className="icon-btn"
                onClick={handleStep}
                disabled={!canControl}
                title="Step +1 tick"
                aria-label="Step forward one tick"
            >
                <StepForwardIcon size={16} />
            </button>

            <div className="speed-control">
                <label>Speed</label>
                <button
                    className="speed-step-btn"
                    onClick={() => handleSpeedStep(-1)}
                    disabled={!canControl}
                    title="Decrease speed"
                >
                    −
                </button>
                <select
                    className="speed-select"
                    value={localSpeed}
                    onChange={(e) => handleSpeed(e.target.value)}
                    disabled={!canControl}
                >
                    <option value={1}>1×</option>
                    <option value={5}>5×</option>
                    <option value={10}>10×</option>
                    <option value={20}>20×</option>
                    <option value={1000}>Max</option>
                </select>
                <button
                    className="speed-step-btn"
                    onClick={() => handleSpeedStep(1)}
                    disabled={!canControl}
                    title="Increase speed"
                >
                    +
                </button>
            </div>

            <span className={`status-badge ${statusClass}`}>
                <span className="status-dot" />
                {statusText}
            </span>
        </div>
    );
}