/**
 * @file Timeline — seamless unified time controls.
 *
 * A single timeline bar at the bottom of the viewer with no explicit
 * modes. The scrubber cursor is the single source of truth:
 *
 * - Cursor at the recorded edge → the live server is the time source
 *   (play/pause and step-forward drive the server).
 * - Cursor in the past → client-side playback through buffered frames;
 *   the server is paused automatically.
 *
 * @component
 */

import {
    ArrowLeftIcon,
    BookmarkIcon,
    DownloadIcon,
    PauseIcon,
    PlayIcon,
    RewindIcon,
    StepBackIcon,
    StepForwardIcon,
} from './Icons';

/** Unified speed ladder — applies to both the server and client playback */
const SPEEDS = [1, 5, 10, 20, 50, 1000];

/**
 * @param {Object} props
 * @param {boolean} props.connected — SSE connected
 * @param {boolean} props.ended — scenario ended
 * @param {string} props.serverState — 'idle'|'running'|'paused'|'stepping'
 * @param {number} props.serverTick — current server tick
 * @param {boolean} props.playing — time is advancing (client or server)
 * @param {number} props.tick — client-side playback tick (scrubber cursor)
 * @param {number} props.maxTicks — last frame index
 * @param {number} props.speed — unified speed (server + client)
 * @param {(play:boolean) => void} props.onTogglePlay
 * @param {(tick:number) => void} props.onSeekTick
 * @param {() => void} props.onStepForward — cursor forward / server step at the edge
 * @param {() => void} props.onStepBack
 * @param {(speed:number) => void} props.onSetSpeed
 * @param {() => void} props.onRewind — rewind server to current scrubber tick
 * @param {() => void} props.onSave — save snapshot of the current server state
 * @param {() => void} props.onBackToScenarios
 */
export default function Timeline({
    connected,
    ended,
    serverState = 'idle',
    serverTick = 0,
    playing,
    tick,
    maxTicks,
    speed,
    onTogglePlay,
    onSeekTick,
    onStepForward,
    onStepBack,
    onSetSpeed,
    onRewind,
    onSave,
    onBackToScenarios,
}) {
    const hasFrames = maxTicks >= 0;
    const canControlServer = connected && !ended && serverState !== 'idle';
    const serverAdvancing = serverState === 'running' || serverState === 'stepping';

    // Cursor at the recorded edge → the server is the time source
    const atEdge = !hasFrames || tick >= maxTicks;

    // Play is only possible when there is something to play:
    // buffered frames or a controllable live server.
    const playDisabled = !hasFrames && !canControlServer;

    // Step forward: in the past → cursor move; at the edge → server step
    // (only when the server is paused and controllable).
    const stepForwardDisabled = atEdge ? !canControlServer || serverAdvancing : false;
    const stepForwardTitle = atEdge ? 'Step server +1 tick' : 'Step forward +1 tick';

    // Step back moves the cursor; from the edge it also detaches from live.
    const stepBackDisabled = tick <= 0;

    // Rewind is only meaningful when the cursor is in the past.
    const rewindDisabled = !canControlServer || !hasFrames || tick >= maxTicks;

    // Save is always available while the server is controllable —
    // it captures the current world state.
    const saveDisabled = !canControlServer;

    // Speed selector is useless without frames or a controllable server.
    const speedDisabled = !hasFrames && !canControlServer;

    // Scrubber value clamped into the valid range
    const sliderMax = Math.max(0, maxTicks);
    const sliderValue = Math.max(0, Math.min(tick, sliderMax));

    const stepSpeed = (delta) => {
        const idx = SPEEDS.indexOf(speed);
        if (idx < 0) return;
        const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, idx + delta))];
        if (next !== speed) onSetSpeed(next);
    };

    const handleScrub = (e) => {
        onSeekTick(Number(e.target.value));
    };

    const handlePlayPause = () => {
        onTogglePlay(!playing);
    };

    const playPauseTitle = playing ? 'Pause' : 'Play';
    const playPauseIcon = playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />;

    return (
        <div className="timeline-bar">
            <button className="btn-back" onClick={onBackToScenarios} title="Back to Scenarios">
                <ArrowLeftIcon size={16} />
                Scenarios
            </button>

            <div className="timeline-separator" />

            <button
                className={`icon-btn ${playing ? 'primary' : ''}`}
                onClick={handlePlayPause}
                disabled={playDisabled}
                title={playPauseTitle}
                aria-label={playPauseTitle}
            >
                {playPauseIcon}
            </button>

            <button
                className="icon-btn"
                onClick={onStepBack}
                disabled={stepBackDisabled}
                title="Step back -1 tick"
                aria-label="Step back one tick"
            >
                <StepBackIcon size={16} />
            </button>

            <button
                className="icon-btn"
                onClick={onStepForward}
                disabled={stepForwardDisabled}
                title={stepForwardTitle}
                aria-label={stepForwardTitle}
            >
                <StepForwardIcon size={16} />
            </button>

            <div className="speed-control">
                <label>Speed</label>
                <select
                    className="speed-select"
                    value={speed}
                    onChange={(e) => onSetSpeed(Number(e.target.value))}
                    disabled={speedDisabled}
                    aria-label="Speed"
                >
                    <option value={1}>1×</option>
                    <option value={5}>5×</option>
                    <option value={10}>10×</option>
                    <option value={20}>20×</option>
                    <option value={50}>50×</option>
                    <option value={1000}>Max</option>
                </select>
                <button
                    className="speed-step-btn"
                    onClick={() => stepSpeed(-1)}
                    disabled={speedDisabled}
                    title="Decrease speed"
                >
                    −
                </button>
                <button
                    className="speed-step-btn"
                    onClick={() => stepSpeed(1)}
                    disabled={speedDisabled}
                    title="Increase speed"
                >
                    +
                </button>
            </div>

            <input
                type="range"
                min={0}
                max={sliderMax}
                value={sliderValue}
                onChange={handleScrub}
                className="tick-slider timeline-slider"
                title={`Scrub timeline (server tick ${serverTick})`}
                aria-label="Scrub timeline"
            />

            <span className="tick-display">
                <span className="tick-current">{tick}</span>
                <span className="tick-sep">/</span>
                <span>{hasFrames ? maxTicks : '—'}</span>
            </span>

            <div className="timeline-actions">
                <button
                    className="icon-btn"
                    onClick={onRewind}
                    disabled={rewindDisabled}
                    title={`Rewind server to tick ${tick}`}
                    aria-label="Rewind server"
                >
                    <RewindIcon size={16} />
                </button>
                <button
                    className="icon-btn"
                    onClick={onSave}
                    disabled={saveDisabled}
                    title="Save snapshot"
                    aria-label="Save snapshot"
                >
                    <DownloadIcon size={16} />
                </button>
                <button className="icon-btn" disabled title="Bookmark tick (coming soon)" aria-label="Bookmark tick">
                    <BookmarkIcon size={16} />
                </button>
            </div>
        </div>
    );
}
