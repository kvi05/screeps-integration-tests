/**
 * @file Controls — playback controls for the viewer.
 *
 * Handles: play/pause, step +N, speed selector.
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
 */
export default function Controls({
    playing,
    tick,
    maxTicks,
    speed,
    onTogglePlay,
    onSeekTick,
    onSetSpeed,
    onStepForward,
}) {
    const handlePlayPause = () => onTogglePlay(!playing);
    const handleSpeedChange = (e) => onSetSpeed(Number(e.target.value));
    const handleTickChange = (e) => onSeekTick(Number(e.target.value));

    return (
        <div className="controls">
            <button onClick={handlePlayPause} title={playing ? 'Pause' : 'Play'}>
                {playing ? '⏸' : '▶'}
            </button>
            <button onClick={onStepForward} title="Step +1">
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
                title="Seek"
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
