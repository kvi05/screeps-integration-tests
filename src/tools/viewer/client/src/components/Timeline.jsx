/**
 * @file Timeline — seamless unified time controls, a floating frosted-glass
 * overlay on top of the canvas.
 *
 * Three visually separated floating groups, all inside one `transport-row`
 * flex container spanning the full width — so the center bar can never
 * overlap the side pills on narrow screens (the scrubber shrinks first):
 *
 * - `transport-back` (left): navigation back to the Scenario Manager
 * - `transport-bar` (center, flexible): transport — play/pause, step back/forward,
 *   unified speed, scrubber, tick display, live server-tick indicator, rewind
 * - `transport-actions` (right): save snapshot, bookmark
 *
 * The scrubber carries the time indicators:
 *
 * - Color zone: green — ticks in the server ring buffer (rewind available),
 *   gray — ticks outside the ring buffer.
 * - Marks: bookmark dots and saved-snapshot marks (💾) on their ticks.
 *
 * The scrubber cursor remains the single source of truth:
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
 * @param {number[]} [props.bookmarks] — scrubber ticks with a bookmark
 * @param {(tick:number) => void} [props.onToggleBookmark] — toggle a bookmark
 *   on the current scrubber tick
 * @param {number[]} [props.snapshotTicks] — scrubber ticks with a saved
 *   snapshot (💾 marks)
 * @param {number|null} [props.rewindAvailableFrom] — first scrubber index
 *   still inside the server ring buffer (green zone starts here); null = unknown
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
    bookmarks = [],
    onToggleBookmark = null,
    snapshotTicks = [],
    rewindAvailableFrom = null,
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

    // Rewind is only meaningful when the cursor is in the past and inside
    // the server ring buffer (when the zone is known).
    const rewindDisabled =
        !canControlServer ||
        !hasFrames ||
        tick >= maxTicks ||
        (rewindAvailableFrom != null && tick < rewindAvailableFrom);

    // Save captures the LIVE server state, so it only makes sense at the
    // recorded edge — in the past the scrubber shows buffered replay frames.
    const saveDisabled = !canControlServer || !atEdge;

    // Speed selector is useless without frames or a controllable server.
    const speedDisabled = !hasFrames && !canControlServer;

    // Scrubber value clamped into the valid range
    const sliderMax = Math.max(0, maxTicks);
    const sliderValue = Math.max(0, Math.min(tick, sliderMax));

    // ─── Timeline indicators ─────────────────────────────────────────────

    // Bookmark: toggled on the current scrubber tick; possible whenever
    // there is a timeline to bookmark on.
    const bookmarkDisabled = !hasFrames;
    const isBookmarked = bookmarks.includes(sliderValue);
    const bookmarkTitle = isBookmarked ? `Remove bookmark at tick ${sliderValue}` : `Bookmark tick ${sliderValue}`;

    // Ring-buffer zone: green from the oldest rewindable scrubber index to
    // the end, gray before it. Unknown zone → fully gray.
    let zonePct = 100;
    if (rewindAvailableFrom != null && sliderMax > 0) {
        zonePct = Math.max(0, Math.min(100, (rewindAvailableFrom / sliderMax) * 100));
    }
    const zoneBackground =
        zonePct >= 100
            ? 'var(--bg-overlay)'
            : `linear-gradient(to right, ` +
              `var(--bg-overlay) 0%, var(--bg-overlay) ${zonePct}%, ` +
              `var(--success) ${zonePct}%, var(--success) 100%)`;

    // Marks: bookmark dots + snapshot glyphs, positioned by scrubber index
    const marks = [
        ...bookmarks.map((b) => ({ tick: b, type: 'bookmark', key: `bm-${b}` })),
        ...snapshotTicks.map((s) => ({ tick: s, type: 'snapshot', key: `snap-${s}` })),
    ]
        .filter((m) => Number.isFinite(m.tick) && m.tick >= 0 && m.tick <= sliderMax)
        .sort((a, b) => a.tick - b.tick);

    const markPct = (markTick) => (sliderMax > 0 ? (markTick / sliderMax) * 100 : 0);

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
        <>
            {/* ─── Transport row — single flex container spanning the full
                   width so the center bar can never overlap the side pills ── */}
            <div className="transport-row">
                {/* ─── Navigation back to the Scenario Manager (left) ────── */}
                <div className="transport-back glass-panel">
                    <button className="btn-back" onClick={onBackToScenarios} title="Back to Scenarios">
                        <ArrowLeftIcon size={16} />
                        Scenarios
                    </button>
                </div>

                {/* ─── Transport controls (center, flexible) ─────────────── */}
                <div className="transport-bar glass-panel">
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

                    <div className="timeline-separator" />

                    <div className="speed-control">
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

                    <div className="timeline-slider-wrap">
                        <div
                            className="timeline-slider-zone"
                            style={{ background: zoneBackground }}
                            aria-hidden="true"
                        />
                        <div className="timeline-slider-marks" aria-hidden="true">
                            {marks.map((m) => (
                                <span
                                    key={m.key}
                                    className={`timeline-mark ${m.type}`}
                                    style={{ left: `${markPct(m.tick)}%` }}
                                    data-mark={m.type}
                                    data-tick={m.tick}
                                    title={
                                        m.type === 'bookmark'
                                            ? `Bookmark at tick ${m.tick}`
                                            : `Saved snapshot at tick ${m.tick}`
                                    }
                                >
                                    {m.type === 'snapshot' ? '💾' : null}
                                </span>
                            ))}
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
                    </div>

                    <span className="tick-display">
                        <span className="tick-current">{tick}</span>
                        <span className="tick-sep">/</span>
                        <span>{hasFrames ? maxTicks : '—'}</span>
                    </span>

                    {/* Live server tick — the authoritative time source */}
                    <div className="server-tick-indicator" title="Live server tick">
                        <span className={`server-tick-dot ${serverState}`} />
                        <span className="server-tick-label">live</span>
                        <span className="server-tick-value">{serverTick}</span>
                    </div>

                    <div className="timeline-separator" />

                    <button
                        className="icon-btn"
                        onClick={onRewind}
                        disabled={rewindDisabled}
                        title={`Rewind server to tick ${tick}`}
                        aria-label="Rewind server"
                    >
                        <RewindIcon size={16} />
                    </button>
                </div>

                {/* ─── Actions (top-right) ───────────────────────────────────── */}
                <div className="transport-actions glass-panel">
                    <button
                        className="icon-btn"
                        onClick={onSave}
                        disabled={saveDisabled}
                        title="Save snapshot"
                        aria-label="Save snapshot"
                    >
                        <DownloadIcon size={16} />
                    </button>
                    <button
                        className={`icon-btn ${isBookmarked ? 'active' : ''}`}
                        onClick={() => onToggleBookmark?.(sliderValue)}
                        disabled={bookmarkDisabled}
                        title={bookmarkTitle}
                        aria-label="Bookmark tick"
                    >
                        <BookmarkIcon size={16} />
                    </button>
                </div>
            </div>
        </>
    );
}
