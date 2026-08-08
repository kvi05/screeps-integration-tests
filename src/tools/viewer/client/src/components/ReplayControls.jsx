/**
 * @file ReplayControls — client-side playback of accumulated frames.
 *
 * Controls: play/pause, step forward/back, timeline scrubber,
 * jump to tick, speed selector. Server is not involved.
 *
 * @component
 */

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
    const handleTickChange = (e) => onSeekTick(Number(e.target.value));

    return (
        <div className="replay-controls">
            <span className="control-group-label">Saved Replay</span>

            <button onClick={handlePlayPause} title={playing ? 'Pause' : 'Play'}>
                {playing ? '⏸' : '▶'}
            </button>

            <button onClick={onStepBack} title="Step -1" disabled={tick <= 0}>
                ⏮
            </button>

            <button onClick={onStepForward} title="Step +1" disabled={tick >= maxTicks}>
                ⏭
            </button>

            <span className="tick-display">
                Tick: {tick} / {maxTicks || '—'}
            </span>

            <input
                type="range"
                min={0}
                max={maxTicks || 100}
                value={tick}
                onChange={handleTickChange}
                className="tick-slider"
                title="Scrub timeline"
            />

            <label className="speed-label">
                Speed:
                <select value={speed} onChange={handleSpeedChange}>
                    <option value={1}>1×</option>
                    <option value={2}>2×</option>
                    <option value={5}>5×</option>
                    <option value={10}>10×</option>
                    <option value={20}>20×</option>
                </select>
            </label>
        </div>
    );
}
