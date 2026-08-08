/**
 * @file ReplayControls — client-side playback of accumulated frames.
 *
 * Controls: play/pause, step forward/back, timeline scrubber,
 * jump to tick, speed selector. Server is not involved.
 *
 * @component
 */

import { PlayIcon, PauseIcon, StepForwardIcon, StepBackIcon, FilmIcon } from './Icons';

/**
 * @param {Object} props
 * @param {boolean} props.playing
 * @param {number} props.tick
 * @param {number} props.maxTicks
 * @param {number} props.speed
 * @param {(playing:boolean) => void} props.onTogglePlay
 * @param {(tick:number) => void} props.onSeekTick
 * @param {(speed:number) => void} props.onSetSpeed
 * @param {() => void} props.onStepForward
 * @param {() => void} props.onStepBack
 */
export default function ReplayControls({
    playing,
    tick,
    maxTicks,
    speed,
    onTogglePlay,
    onSeekTick,
    onSetSpeed,
    onStepForward,
    onStepBack,
}) {
    const handlePlayPause = () => onTogglePlay(!playing);
    const handleSpeedChange = (e) => onSetSpeed(Number(e.target.value));
    const handleSpeedStep = (delta) => {
        const speeds = [1, 2, 5, 10, 20];
        const idx = speeds.indexOf(speed);
        if (idx >= 0) {
            const next = speeds[Math.max(0, Math.min(speeds.length - 1, idx + delta))];
            if (next !== speed) onSetSpeed(next);
        }
    };
    const handleTickChange = (e) => onSeekTick(Number(e.target.value));

    return (
        <div className="replay-controls">
            <span className="control-group-label replay">
                <span className="label-dot" />
                Replay
            </span>

            <button
                className={`icon-btn ${playing ? 'primary' : ''}`}
                onClick={handlePlayPause}
                title={playing ? 'Pause replay' : 'Play replay'}
                aria-label={playing ? 'Pause replay' : 'Play replay'}
            >
                {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
            </button>

            <button
                className="icon-btn"
                onClick={onStepBack}
                title="Step back -1 tick"
                disabled={tick <= 0}
                aria-label="Step back one tick"
            >
                <StepBackIcon size={16} />
            </button>

            <button
                className="icon-btn"
                onClick={onStepForward}
                title="Step forward +1 tick"
                disabled={tick >= maxTicks}
                aria-label="Step forward one tick"
            >
                <StepForwardIcon size={16} />
            </button>

            <span className="tick-display">
                <span className="tick-current">{tick}</span>
                <span className="tick-sep">/</span>
                <span>{maxTicks || '—'}</span>
            </span>

            <input
                type="range"
                min={0}
                max={maxTicks || 100}
                value={tick}
                onChange={handleTickChange}
                className="tick-slider"
                title="Scrub timeline"
                aria-label="Scrub timeline"
            />

            <div className="speed-control">
                <label>Speed</label>
                <button
                    className="speed-step-btn"
                    onClick={() => handleSpeedStep(-1)}
                    title="Decrease speed"
                >
                    −
                </button>
                <select className="speed-select" value={speed} onChange={handleSpeedChange}>
                    <option value={1}>1×</option>
                    <option value={2}>2×</option>
                    <option value={5}>5×</option>
                    <option value={10}>10×</option>
                    <option value={20}>20×</option>
                </select>
                <button
                    className="speed-step-btn"
                    onClick={() => handleSpeedStep(1)}
                    title="Increase speed"
                >
                    +
                </button>
            </div>
        </div>
    );
}