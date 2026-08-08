import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import CanvasStage from './components/CanvasStage';
import LiveControls from './components/LiveControls';
import ReplayControls from './components/ReplayControls';
import ObjectInspector from './components/ObjectInspector';
import ConsolePanel from './components/ConsolePanel';
import MetricsPanel from './components/MetricsPanel';
import MiniMap from './components/MiniMap';
import ScenarioManager from './components/ScenarioManager';
import { connectSSE, postDispose } from './api/client';
import { loadPrefs, savePrefs } from './state/prefs';
import './styles/global.css';

/**
 * @file App — root viewer component (Phase 2).
 *
 * Manages:
 * - SSE connection lifecycle
 * - Frame accumulation (ring buffer, sessionStorage)
 * - Playback state (playing/paused, tick, speed, sub-frame)
 * - Live server control (via REST → IPC)
 * - Object inspector (click on canvas)
 * - Console panel (logs from frames)
 * - Metrics graphs
 * - MiniMap
 *
 * @component
 */

const REPLAY_BUFFER_DEFAULT = 200;

export default function App() {
    // App mode: 'viewer' or 'scenarios'
    const [mode] = useState(() => {
        // URL param ?viewer overrides sessionStorage
        try {
            const params = new URLSearchParams(window.location.search);
            if (params.get('viewer') !== null) return 'viewer';
            return sessionStorage.getItem('sit-viewer-mode') || 'scenarios';
        } catch {
            return 'scenarios';
        }
    });

    // SSE connection state
    const [connected, setConnected] = useState(false);
    const [scenario, setScenario] = useState('');
    const [ended, setEnded] = useState(false);

    // Server status (live control)
    const [serverState, setServerState] = useState('idle');
    const [serverTick, setServerTick] = useState(0);
    const [serverSpeed, setServerSpeed] = useState(1);

    // Ring buffer size
    const replayBuffer = REPLAY_BUFFER_DEFAULT;

    // Recording: accumulated frames — persisted in sessionStorage across reloads
    /** @type {[Object, Function]} */
    const [recording, setRecording] = useState(() => {
        try {
            const saved = sessionStorage.getItem('sit-viewer-recording');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed && parsed.frames && Array.isArray(parsed.frames)) {
                    return parsed;
                }
            }
        } catch {
            /* corrupted — start fresh */
        }
        return { terrain: {}, frames: [] };
    });

    // Playback state
    const [playing, setPlaying] = useState(true);
    const [tick, setTick] = useState(0);
    const [sub, setSub] = useState(null);
    const [speed, setSpeed] = useState(() => loadPrefs().speed);

    // Side panels
    const [showConsole, setShowConsole] = useState(() => loadPrefs().showConsole);
    const [showMetrics, setShowMetrics] = useState(false);
    const [showMiniMap, setShowMiniMap] = useState(() => loadPrefs().showMiniMap);

    // Object inspector
    /** @type {[{room:string, x:number, y:number, objects:Array}|null, Function]} */
    const [clickedTile, setClickedTile] = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const [typeFilter, setTypeFilter] = useState(/** @type {Object<string,boolean>} */ ({}));
    const [searchQuery, setSearchQuery] = useState('');

    // Camera state (for MiniMap + test API)
    const [cameraForMiniMap, setCameraForMiniMap] = useState({ x: 0, y: 0, zoom: 1 });
    const cameraRef = useRef(cameraForMiniMap);
    cameraRef.current = cameraForMiniMap;

    const sseRef = useRef(null);
    const playingRef = useRef(playing);
    playingRef.current = playing;
    const speedRef = useRef(speed);
    speedRef.current = speed;
    const tickRef = useRef(tick);
    tickRef.current = tick;
    const recordingRef = useRef(recording);
    recordingRef.current = recording;
    const endedRef = useRef(ended);
    endedRef.current = ended;

    // ─── Persist recording to sessionStorage on every update ────────────────
    const persistRef = useRef(null);
    useEffect(() => {
        clearTimeout(persistRef.current);
        persistRef.current = setTimeout(() => {
            try {
                sessionStorage.setItem('sit-viewer-recording', JSON.stringify(recording));
            } catch {
                // Storage full — keep in-memory only
            }
        }, 500);
    }, [recording]);

    // ─── Persist user preferences to localStorage ─────────────────────────
    useEffect(() => {
        savePrefs({ speed });
    }, [speed]);
    useEffect(() => {
        savePrefs({ showMiniMap });
    }, [showMiniMap]);
    useEffect(() => {
        savePrefs({ showConsole });
    }, [showConsole]);

    // ─── SSE connection ─────────────────────────────────────────────────────

    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.__viewerPerf = { renderMs: [], sseLatencyMs: [], snapshotSize: [] };
        }

        let firstFrame = true;
        const sse = connectSSE((eventType, data) => {
            switch (eventType) {
                case 'start':
                    // New scenario — reset everything
                    setScenario(data.scenario || '');
                    setConnected(true);
                    setServerState('running');
                    setEnded(false);
                    setPlaying(true);
                    setTick(0);
                    setSub(null);
                    setRecording({ terrain: {}, frames: [] });
                    setClickedTile(null);
                    setSelectedId(null);
                    firstFrame = true;
                    try {
                        sessionStorage.removeItem('sit-viewer-recording');
                    } catch {
                        /* ignore */
                    }
                    break;
                case 'terrain': {
                    setRecording((prev) => ({
                        ...prev,
                        terrain: { ...prev.terrain, ...(data || {}) },
                    }));
                    break;
                }
                case 'frame': {
                    if (data._sentAt && window.__viewerPerf) {
                        window.__viewerPerf.sseLatencyMs.push(Date.now() - data._sentAt);
                    }
                    if (data._size && window.__viewerPerf) {
                        window.__viewerPerf.snapshotSize.push(data._size);
                    }
                    if (firstFrame) {
                        firstFrame = false;
                        setConnected(true);
                        setServerState('running');
                        if (data.terrain && Object.keys(data.terrain).length > 0) {
                            setRecording((prev) => ({
                                ...prev,
                                terrain: { ...prev.terrain, ...data.terrain },
                            }));
                        }
                    }
                    setServerTick(data.gameTime);
                    setRecording((prev) => {
                        const newFrames = [
                            ...prev.frames,
                            {
                                gameTime: data.gameTime,
                                objects: data.objects || [],
                                console: data.console || [],
                            },
                        ];
                        if (newFrames.length > replayBuffer) {
                            newFrames.splice(0, newFrames.length - replayBuffer);
                        }
                        return { ...prev, frames: newFrames };
                    });
                    break;
                }
                case 'end':
                    setEnded(true);
                    setPlaying(false);
                    setServerState('idle');
                    break;
                case 'status': {
                    if (data.state) setServerState(data.state);
                    if (data.tick !== undefined) setServerTick(data.tick);
                    if (data.speed !== undefined) setServerSpeed(data.speed);
                    break;
                }
                case 'scenario-result': {
                    // Persist to sessionStorage so ScenarioManager sees results after mode switch
                    try {
                        const name = (data.scenario || '').replace(/^.*[/\\]/, '').replace('.scenario.js', '');
                        const prev = JSON.parse(sessionStorage.getItem('sit-scenario-statuses') || '{}');
                        prev[name] = data.status === 'pass' ? 'pass' : data.status === 'skip' ? 'skip' : 'fail';
                        sessionStorage.setItem('sit-scenario-statuses', JSON.stringify(prev));
                    } catch {
                        /* ignore */
                    }
                    // Forward to ScenarioManager via window event (avoids prop drilling)
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(
                            new CustomEvent('scenario-result', {
                                detail: {
                                    scenario: data.scenario,
                                    status: data.status,
                                    time: data.time,
                                    ticks: data.ticks,
                                },
                            }),
                        );
                    }
                    break;
                }
                case 'disconnect':
                    setConnected(false);
                    break;
            }
        });

        sseRef.current = sse;

        return () => {
            sse.close();
        };
    }, []);

    // ─── Metrics dump when scenario ends ────────────────────────────────────
    useEffect(() => {
        if (!ended || typeof window === 'undefined' || !window.__viewerPerf) return;
        const p = window.__viewerPerf;
        const avg = (arr) => (arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : '—');
        const pct = (arr, pctVal) => {
            if (!arr.length) return '—';
            const sorted = [...arr].sort((a, b) => a - b);
            return sorted[Math.floor((sorted.length * pctVal) / 100)].toFixed(2);
        };
        console.group('%c📊 Viewer Metrics', 'font-size:16px;font-weight:bold');
        console.log(
            'Snapshot size (bytes):  avg=%s  p50=%s  p99=%s',
            avg(p.snapshotSize),
            pct(p.snapshotSize, 50),
            pct(p.snapshotSize, 99),
        );
        console.log(
            'SSE latency (ms):       avg=%s  p50=%s  p99=%s',
            avg(p.sseLatencyMs),
            pct(p.sseLatencyMs, 50),
            pct(p.sseLatencyMs, 99),
        );
        console.log(
            'Render time (ms):       avg=%s  p50=%s  p99=%s',
            avg(p.renderMs),
            pct(p.renderMs, 50),
            pct(p.renderMs, 99),
        );
        console.log('Total frames: %d', p.snapshotSize.length);
        console.groupEnd();
    }, [ended]);

    // ─── Playback: track mode (live vs replay) ──────────────────────────
    // liveMode = connected AND user hasn't manually scrubbed
    const [liveMode, setLiveMode] = useState(true);

    // When connected with new frames, auto-enter live mode
    useEffect(() => {
        if (connected && !ended) {
            setLiveMode(true);
            setPlaying(true);
        }
    }, [connected, ended]);

    // ─── Live mode: chase latest frame ──────────────────────────────────
    useEffect(() => {
        if (!playing || ended || !liveMode) return;
        const latest = recording.frames.length - 1;
        if (latest >= 0 && tickRef.current !== latest) {
            tickRef.current = latest;
            setTick(latest);
            setSub(null);
        }
    }, [playing, recording.frames.length, ended, liveMode]);

    // ─── Replay mode: timer-based playback ──────────────────────────────
    useEffect(() => {
        if (!playing || ended || liveMode) return;
        if (recording.frames.length === 0) return;
        const latest = recording.frames.length - 1;
        const interval = Math.max(33, 1000 / speed); // max ~30fps for replay

        const timer = setInterval(() => {
            const cur = tickRef.current;
            if (cur >= latest) {
                setPlaying(false);
                return;
            }
            const next = Math.min(cur + 1, latest);
            tickRef.current = next;
            setTick(next);
            setSub(null);
        }, interval);

        return () => clearInterval(timer);
    }, [playing, speed, recording.frames.length, ended, liveMode]);

    // ─── Controls callbacks ─────────────────────────────────────────────────

    const handleTogglePlay = useCallback(
        (play) => {
            if (play) {
                // If connected and at end, switch to live mode
                if (connected && !ended) {
                    setLiveMode(true);
                }
            }
            setPlaying(play);
            if (!play) setSub(null);
        },
        [connected, ended],
    );

    const handleSeekTick = useCallback((t) => {
        setLiveMode(false); // Manual scrub → replay mode
        const max = recordingRef.current.frames.length - 1;
        setTick(Math.max(0, Math.min(t, max)));
        setSub(null);
    }, []);

    const handleStepForward = useCallback(() => {
        setLiveMode(false);
        setPlaying(false);
        setSub(null);
        setTick((prev) => Math.min(prev + 1, recordingRef.current.frames.length - 1));
    }, []);

    const handleStepBack = useCallback(() => {
        setLiveMode(false);
        setPlaying(false);
        setSub(null);
        setTick((prev) => Math.max(0, prev - 1));
    }, []);

    const handleSetSpeed = useCallback((s) => {
        setSpeed(s);
    }, []);

    // ─── Canvas click → Object Inspector ────────────────────────────────────
    const handleCanvasClick = useCallback(
        (roomName, x, y) => {
            const frame = recording.frames[tick];
            if (!frame) return;
            const tileObjects = (frame.objects || []).filter((o) => o.room === roomName && o.x === x && o.y === y);
            setClickedTile({ room: roomName, x, y, objects: tileObjects });
            setSelectedId(tileObjects.length > 0 ? tileObjects[0]._id : null);
        },
        [recording.frames, tick],
    );

    // ─── Console: collect all logs from all frames ──────────────────────────
    const allConsoleLogs = useMemo(() => {
        /** @type {Array<{level:string, message:string, bot:string, tick:number}>} */
        const entries = [];
        for (const frame of recording.frames) {
            if (frame.console) {
                for (const entry of frame.console) {
                    entries.push({ ...entry, tick: frame.gameTime });
                }
            }
        }
        return entries;
    }, [recording.frames]);

    // ─── Room names for MiniMap ─────────────────────────────────────────────
    const roomNames = useMemo(() => {
        const names = Object.keys(recording.terrain || {});
        if (names.length === 0 && recording.frames.length > 0) {
            const seen = new Set();
            for (const o of recording.frames[0].objects || []) {
                if (o.room) seen.add(o.room);
            }
            return [...seen];
        }
        return names;
    }, [recording]);

    // ─── Keyboard shortcuts ─────────────────────────────────────────────────
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')
                return;

            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    handleTogglePlay(!playingRef.current);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    handleStepForward();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    handleStepBack();
                    break;
                case 'm':
                    setShowMetrics((prev) => !prev);
                    break;
                case '`':
                    setShowConsole((prev) => !prev);
                    break;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleTogglePlay, handleStepForward, handleStepBack]);

    // ─── Test API ───────────────────────────────────────────────────────────
    if (import.meta.env.DEV) {
        window.__viewerTest = {
            ...(window.__viewerTest || {}),
            getState() {
                return {
                    tick: tickRef.current,
                    playing: playingRef.current,
                    speed: speedRef.current,
                    connected,
                    ended,
                    framesCount: recordingRef.current.frames.length,
                    serverState,
                    showConsole,
                    showMetrics,
                };
            },
            injectFrames(objectsList, terrainMap) {
                if (terrainMap) {
                    setRecording((prev) => ({
                        terrain: { ...prev.terrain, ...terrainMap },
                        frames: [
                            ...prev.frames,
                            { gameTime: prev.frames.length, objects: objectsList || [], console: [] },
                        ],
                    }));
                } else {
                    setRecording((prev) => ({
                        ...prev,
                        frames: [
                            ...prev.frames,
                            { gameTime: prev.frames.length, objects: objectsList || [], console: [] },
                        ],
                    }));
                }
            },
            reset() {
                setRecording({ terrain: {}, frames: [] });
                setTick(0);
                setPlaying(false);
                setEnded(false);
                setConnected(false);
                setClickedTile(null);
                setSelectedId(null);
            },
            setPlaying(val) {
                setPlaying(val);
            },
            seekTick(t) {
                setTick(Math.max(0, Math.min(t, recordingRef.current.frames.length - 1)));
            },
            getCamera() {
                return cameraRef.current;
            },
            setMode(m) {
                try {
                    sessionStorage.setItem('sit-viewer-mode', m);
                } catch {
                    /* ignore */
                }
                window.location.reload();
            },
        };
    }

    // ─── Render ─────────────────────────────────────────────────────────────

    const maxTicks = recording.frames.length - 1;
    const isLoading = !recording.frames.length;

    // Scenario Manager screen
    if (mode === 'scenarios') {
        return (
            <div className="viewer-layout">
                <ScenarioManager
                    onNavigateToViewer={() => {
                        try {
                            sessionStorage.setItem('sit-viewer-mode', 'viewer');
                        } catch {
                            /* ignore */
                        }
                        window.location.reload();
                    }}
                />
            </div>
        );
    }

    // ─── Camera state (for MiniMap) ─────────────────────────────────────
    const canvasStageRef = useRef(null);

    const handleBackToScenarios = () => {
        postDispose().catch(() => {});
        try {
            sessionStorage.setItem('sit-viewer-mode', 'scenarios');
        } catch {
            /* ignore */
        }
        window.location.reload();
    };

    return (
        <div className="viewer-layout">
            {/* ─── Toolbar ─────────────────────────────── */}
            <div className="viewer-toolbar">
                <button onClick={handleBackToScenarios} className="btn-back-to-scenarios" title="Back to Scenarios">
                    ← Scenarios
                </button>
                <div className="toolbar-separator" />
                <LiveControls
                    connected={connected}
                    serverState={serverState}
                    serverTick={serverTick}
                    serverSpeed={serverSpeed}
                    onServerStateChange={setServerState}
                />
                <div className="toolbar-separator" />
                <ReplayControls
                    playing={playing}
                    tick={tick}
                    maxTicks={maxTicks}
                    speed={speed}
                    onTogglePlay={handleTogglePlay}
                    onSeekTick={handleSeekTick}
                    onSetSpeed={handleSetSpeed}
                    onStepForward={handleStepForward}
                    onStepBack={handleStepBack}
                />
            </div>

            {/* ─── Main area: canvas + side panels ────── */}
            <div className="viewer-main">
                <div className="viewer-canvas-area">
                    <CanvasStage
                        ref={canvasStageRef}
                        recording={recording}
                        tick={tick}
                        sub={sub}
                        playing={playing}
                        selectedId={selectedId}
                        onTileClick={handleCanvasClick}
                        onCameraChange={setCameraForMiniMap}
                    />
                    {isLoading && (
                        <div className="loading-overlay">
                            <div className="spinner" />
                            {connected ? 'Waiting for first frame...' : 'Connecting to server...'}
                        </div>
                    )}
                    {showMiniMap && (
                        <MiniMap
                            roomNames={roomNames}
                            camera={cameraForMiniMap}
                            zoom={cameraForMiniMap.zoom}
                            onJumpTo={(roomName) => {
                                if (canvasStageRef.current?.jumpToRoom) {
                                    canvasStageRef.current.jumpToRoom(roomName);
                                }
                            }}
                        />
                    )}
                </div>

                {/* ─── Side panels ─────────────────────── */}
                <div className="viewer-sidebar">
                    {showMetrics ? (
                        <MetricsPanel frames={recording.frames} />
                    ) : (
                        <ObjectInspector
                            objects={clickedTile?.objects || []}
                            selectedId={selectedId}
                            onSelect={setSelectedId}
                            typeFilter={typeFilter}
                            onTypeFilterChange={setTypeFilter}
                            searchQuery={searchQuery}
                            onSearchChange={setSearchQuery}
                        />
                    )}
                    <div className="sidebar-toggle-buttons">
                        <button className={showMetrics ? 'active' : ''} onClick={() => setShowMetrics(!showMetrics)}>
                            {showMetrics ? 'Objects' : 'Metrics'}
                        </button>
                        <button className={showMiniMap ? 'active' : ''} onClick={() => setShowMiniMap(!showMiniMap)}>
                            MiniMap
                        </button>
                    </div>
                </div>
            </div>

            {/* ─── Console ─────────────────────────────── */}
            <ConsolePanel
                logs={allConsoleLogs}
                onJumpToTick={handleSeekTick}
                visible={showConsole}
                onToggle={setShowConsole}
            />

            {/* ─── Status bar ──────────────────────────── */}
            <div className="status-bar">
                <span>
                    {connected ? (
                        <span className="connected">● Connected</span>
                    ) : (
                        <span className="disconnected">● Disconnected</span>
                    )}
                    {scenario && ` — ${scenario}`}
                </span>
                <span>
                    Frames: {recording.frames.length} | Tick: {tick}/{maxTicks || '—'}
                    {ended ? ' [ENDED]' : ''}
                </span>
            </div>
        </div>
    );
}

// Mount to DOM
const rootEl = document.getElementById('root');
if (rootEl) {
    createRoot(rootEl).render(<App />);
}
