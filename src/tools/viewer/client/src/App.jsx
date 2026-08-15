import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import CanvasStage from './components/CanvasStage';
import Timeline from './components/Timeline';
import ObjectInspector from './components/ObjectInspector';
import ConsolePanel from './components/ConsolePanel';
import MetricsPanel from './components/MetricsPanel';
import MiniMap from './components/MiniMap';
import ScenarioManager from './components/ScenarioManager';
import SaveLoadPanel from './components/SaveLoadPanel';
import {
    connectSSE,
    postDispose,
    postPause,
    postRestoreTick,
    postResume,
    postSaveSnapshot,
    postSpeed,
    postStep,
} from './api/client';
import { loadPrefs, savePrefs } from './state/prefs';
import {
    ChevronLeftIcon,
    ChevronRightIcon,
    MousePointerIcon,
    ActivityIcon,
    DatabaseIcon,
    SettingsIcon,
    MapIcon,
    GridIcon,
    FocusIcon,
    WifiIcon,
    WifiOffIcon,
    FilmIcon,
} from './components/Icons';
import './styles/global.css';

/**
 * @file App — root viewer component (Phase 2).
 *
 * Manages:
 * - SSE connection lifecycle
 * - Frame accumulation (ring buffer, sessionStorage)
 * - Playback state (playing/paused, tick, speed, sub-frame)
 * - Seamless unified timeline — cursor-driven playback with automatic
 *   server pause/resume (no explicit live/replay modes)
 * - Object inspector (click on canvas)
 * - Console panel (logs from frames)
 * - Metrics graphs
 * - MiniMap
 * - Sidebar tabs: Inspector / Metrics / Save-Load / Settings
 *
 * @component
 */

/**
 * Client-side ring-buffer capacity (max frames retained).
 *
 * The authoritative value comes from the server via the SSE `start` event
 * (`data.replayBuffer`), which reads `config.viewerOptions.replayBuffer`.
 * This constant is only a build-time fallback for when the SSE `start`
 * event arrives without the field (legacy servers).
 */
const REPLAY_BUFFER_FALLBACK = 3000;

/** Sidebar width limits — single source of truth, matches CSS --sidebar-min-w / --sidebar-max-w */
const SIDEBAR_MIN_W = 240;
const SIDEBAR_MAX_W = 550;
const SIDEBAR_DEFAULT_W = 340;

export default function App() {
    // App mode: 'viewer' or 'scenarios'
    const [mode] = useState(() => {
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
    /** @type {[{code:string, message:string}|null, Function]} SSE error forwarded from server */
    const [sseError, setSseError] = useState(/** @type {{code:string, message:string}|null} */ (null));

    // Ring buffer size — received from server via SSE `start`, fallback to compile-time default
    const [replayBuffer, setReplayBuffer] = useState(REPLAY_BUFFER_FALLBACK);

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
    const [showMiniMap, setShowMiniMap] = useState(() => loadPrefs().showMiniMap);
    const [sidebarTab, setSidebarTab] = useState('inspector'); // inspector | metrics | saveload | settings

    // Sidebar
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_W);
    const sidebarRef = useRef(null);

    // Canvas overlay toggles (future: WR-8 heatmap, WR-9 grid)
    const [showGrid, setShowGrid] = useState(false);

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
    const connectedRef = useRef(connected);
    connectedRef.current = connected;
    const serverStateRef = useRef(serverState);
    serverStateRef.current = serverState;
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
    const replayBufferRef = useRef(replayBuffer);
    replayBufferRef.current = replayBuffer;

    // ─── Persist recording to sessionStorage (scenario end / page hide) ─────
    // The previous debounced persist JSON.stringified up to 200 frames every
    // 500ms on the main thread during a live run. Saving only on scenario end
    // or right before the page hides/unloads is enough to survive a reload.
    const persistRecording = useCallback(() => {
        try {
            sessionStorage.setItem('sit-viewer-recording', JSON.stringify(recordingRef.current));
        } catch {
            // Storage full — keep in-memory only
        }
    }, []);

    useEffect(() => {
        if (!ended) return;
        persistRecording();
    }, [ended, persistRecording]);

    useEffect(() => {
        const onHide = () => persistRecording();
        window.addEventListener('pagehide', onHide);
        window.addEventListener('visibilitychange', onHide);
        return () => {
            window.removeEventListener('pagehide', onHide);
            window.removeEventListener('visibilitychange', onHide);
        };
    }, [persistRecording]);

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
                    setScenario(data.scenario || '');
                    setConnected(true);
                    // Respect viewerOptions.paused: start paused if the server did
                    setServerState(data.paused ? 'paused' : 'running');
                    setEnded(false);
                    setPlaying(!data.paused);
                    setTick(0);
                    setSub(null);
                    setRecording({ terrain: {}, frames: [] });
                    setClickedTile(null);
                    setSelectedId(null);
                    if (data.replayBuffer) setReplayBuffer(data.replayBuffer);
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
                        if (newFrames.length > replayBufferRef.current) {
                            newFrames.splice(0, newFrames.length - replayBufferRef.current);
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
                case 'restored': {
                    // Server was rewound to a past tick — reset local frame buffer
                    setRecording({ terrain: recording.terrain, frames: [] });
                    setTick(0);
                    setSub(null);
                    setServerTick(data.tick || 0);
                    setPlaying(false);
                    break;
                }
                case 'status': {
                    if (data.state) setServerState(data.state);
                    if (data.tick !== undefined) setServerTick(data.tick);
                    if (data.speed !== undefined) setServerSpeed(data.speed);
                    break;
                }
                case 'scenario-result': {
                    try {
                        const name = (data.scenario || '').replace(/^.*[/\\]/, '').replace('.scenario.js', '');
                        const prev = JSON.parse(sessionStorage.getItem('sit-scenario-statuses') || '{}');
                        prev[name] = data.status === 'pass' ? 'pass' : data.status === 'skip' ? 'skip' : 'fail';
                        sessionStorage.setItem('sit-scenario-statuses', JSON.stringify(prev));
                    } catch {
                        /* ignore */
                    }
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
                case 'error': {
                    // Server-side error forwarded via SSE (e.g. restore/save failure)
                    setSseError({
                        code: data.code || 'unknown',
                        message: data.message || 'Unknown server error',
                    });
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

    // ─── Derived playback state ─────────────────────────────────────────
    // The server is the time source while running/stepping.
    const serverAdvancing = serverState === 'running' || serverState === 'stepping';
    // Cursor at the recorded edge → ready to hand over to the live server.
    const isAtEdge = recording.frames.length === 0 || tick >= recording.frames.length - 1;

    // ─── Reconciliation: keep the server in sync with the cursor ────────
    // Invariant: the server ticks ⟺ playing && cursor at the edge.
    // This single effect replaces all manual pause/resume calls — scrubbing
    // back pauses the server, and playing at the edge resumes it.
    useEffect(() => {
        if (!connected || ended) return;
        if (serverState === 'idle' || serverState === 'stepping') return;
        const running = serverState === 'running';
        if (playing && isAtEdge && !running) {
            postResume().catch(() => {});
        } else if (!playing && running) {
            postPause().catch(() => {});
        }
    }, [playing, isAtEdge, serverState, connected, ended]);

    // ─── Auto-stop local replay at the edge after the scenario ended ────
    // Once the client has played through the buffered frames and there is no
    // live server left to hand over to, reset the play state so the button
    // shows "Play" again instead of staying stuck in "Pause".
    useEffect(() => {
        if (ended && playing && isAtEdge) {
            setPlaying(false);
        }
    }, [ended, playing, isAtEdge]);

    // ─── Chase: follow new frames while the SERVER is the time source ───
    // Runs only when the server is actually advancing (running/stepping).
    // During client playback (server paused) the cursor is driven by the
    // timer below — chasing here would jump the cursor straight to the
    // latest frame the moment play is pressed in the past.
    useEffect(() => {
        if (ended || !serverAdvancing) return;
        const latest = recording.frames.length - 1;
        if (latest >= 0 && tickRef.current !== latest) {
            tickRef.current = latest;
            setTick(latest);
            setSub(null);
        }
    }, [serverAdvancing, recording.frames.length, ended]);

    // ─── Client timer: play through buffered frames ─────────────────────
    // Runs only while the server is NOT advancing. When the cursor reaches
    // the edge, isAtEdge flips and the reconciliation effect resumes the
    // live server — seamless handover.
    useEffect(() => {
        if (!playing || serverAdvancing || isAtEdge) return;
        const interval = Math.max(9, 1000 / speed);

        const timer = setInterval(() => {
            const latest = recordingRef.current.frames.length - 1;
            const cur = tickRef.current;
            if (cur >= latest) {
                // No live server to hand over to — stop the timer
                if (endedRef.current || !connectedRef.current) setPlaying(false);
                return;
            }
            const next = Math.min(cur + 1, latest);
            tickRef.current = next;
            setTick(next);
            setSub(null);
        }, interval);

        return () => clearInterval(timer);
    }, [playing, speed, recording.frames.length, serverAdvancing, isAtEdge]);

    // ─── Controls callbacks ─────────────────────────────────────────────────

    // Play/pause — reconciliation decides whether the server or the
    // client timer is the time source.
    const handleTogglePlay = useCallback((play) => {
        setPlaying(play);
        if (!play) {
            setSub(null);
        }
    }, []);

    const handleSeekTick = useCallback((t) => {
        setPlaying(false);
        setSub(null);
        const max = recordingRef.current.frames.length - 1;
        setTick(Math.max(0, Math.min(t, max)));
    }, []);

    // In the past → cursor move. At the recorded edge → step the live server.
    const handleStepForward = useCallback(() => {
        setPlaying(false);
        setSub(null);
        const latest = recordingRef.current.frames.length - 1;
        if (tickRef.current >= latest) {
            const st = serverStateRef.current;
            if (connectedRef.current && !endedRef.current && st !== 'running' && st !== 'stepping') {
                postStep(1).catch(() => {});
            }
            return;
        }
        setTick((prev) => Math.min(prev + 1, latest));
    }, []);

    const handleStepBack = useCallback(() => {
        setPlaying(false);
        setSub(null);
        setTick((prev) => Math.max(0, prev - 1));
    }, []);

    // Unified speed — applies to both server ticks and client playback.
    const handleSetSpeed = useCallback((s) => {
        setSpeed(s);
        if (connectedRef.current && !endedRef.current) {
            postSpeed(s).catch(() => {});
        }
    }, []);

    // Rewind the server to the current scrubber tick (discards later ticks)
    const handleRewind = useCallback(() => {
        const frames = recordingRef.current.frames;
        const idx = Math.max(0, Math.min(tickRef.current, frames.length - 1));
        const frame = frames[idx];
        const gameTick = frame && typeof frame.gameTime === 'number' ? frame.gameTime : idx;
        setPlaying(false);
        setSub(null);
        postRestoreTick(gameTick).catch(() => {
            /* SSE error event carries the message */
        });
    }, []);

    // Save a snapshot of the current server state to disk
    const handleSaveSnapshot = useCallback(() => {
        const controllable = connectedRef.current && !endedRef.current && serverStateRef.current !== 'idle';
        if (!controllable) return;

        postSaveSnapshot().catch(() => {
            /* SSE error event carries the message */
        });
    }, []);

    // ─── Canvas click → Object Inspector ────────────────────────────────────
    const handleCanvasClick = useCallback(
        (roomName, x, y) => {
            const frame = recording.frames[tick];
            if (!frame) return;
            const tileObjects = (frame.objects || []).filter((o) => o.room === roomName && o.x === x && o.y === y);
            setClickedTile({ room: roomName, x, y, objects: tileObjects });
            setSelectedId(tileObjects.length > 0 ? tileObjects[0]._id : null);
            setSidebarTab('inspector');
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
            const tag = e.target.tagName;
            const isTimelineSlider = e.target instanceof HTMLInputElement && e.target.type === 'range';
            // Hotkeys are suppressed while typing in form controls — except
            // Space on the timeline scrubber: a range input has no native
            // Space behavior, and the play/pause hotkey must keep working
            // right after the user grabs the timeline.
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
                if (!isTimelineSlider || e.key !== ' ') return;
            }

            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    // Single play/pause — reconciliation routes it to the
                    // server or the client timer based on cursor position.
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
                case ']':
                    // Increase unified speed (server + client)
                    {
                        const speeds = [1, 5, 10, 20, 50, 1000];
                        const idx = speeds.indexOf(speedRef.current);
                        if (idx >= 0 && idx < speeds.length - 1) {
                            handleSetSpeed(speeds[idx + 1]);
                        }
                    }
                    break;
                case '[':
                    // Decrease unified speed (server + client)
                    {
                        const speeds = [1, 5, 10, 20, 50, 1000];
                        const idx = speeds.indexOf(speedRef.current);
                        if (idx > 0) {
                            handleSetSpeed(speeds[idx - 1]);
                        }
                    }
                    break;
                case 'm':
                    setSidebarTab((prev) => (prev === 'metrics' ? 'inspector' : 'metrics'));
                    break;
                case '`':
                    setShowConsole((prev) => !prev);
                    break;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleTogglePlay, handleStepForward, handleStepBack, handleSetSpeed, serverState]);

    // ─── Test API ───────────────────────────────────────────────────────────
    if (import.meta.env.DEV) {
        window.__viewerTest = {
            ...(window.__viewerTest || {}),
            getState() {
                return {
                    /** App mode: 'viewer' | 'scenarios' */
                    mode,
                    /** Live server state (SSE-driven, remote) */
                    server: {
                        connected,
                        state: serverState, // 'idle' | 'running' | 'paused' | 'stepping'
                        ended,
                        tick: serverTick,
                        speed: serverSpeed,
                        scenario,
                    },
                    /** Client-side recorded frames ring buffer */
                    recording: {
                        framesCount: recordingRef.current.frames.length,
                    },
                    /** Local replay / playback controls */
                    playback: {
                        tick: tickRef.current,
                        playing: playingRef.current,
                        speed: speedRef.current,
                        atEdge: isAtEdge,
                    },
                    /** UI toggles */
                    ui: {
                        showConsole,
                        showMiniMap,
                        showGrid,
                        sidebarTab,
                        sidebarCollapsed,
                        selectedId,
                    },
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
                setPlaying(false);
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

    const handleBackToScenarios = async () => {
        try {
            await postDispose();
        } catch {
            /* ignore */
        }
        try {
            sessionStorage.setItem('sit-viewer-mode', 'scenarios');
        } catch {
            /* ignore */
        }
        // Small delay to ensure the dispose command reaches the worker before reload
        setTimeout(() => window.location.reload(), 200);
    };

    // Current room label (for overlay)
    const currentRoom = clickedTile?.room || roomNames[0] || '';

    return (
        <div className="viewer-layout">
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

                    {/* ─── Floating transport controls (frosted glass, top) ──
                         Always mounted — controls must be usable before the
                         first frame arrives (the server re-sends its last
                         frame on connect, but a cold start may still have none) */}
                    <Timeline
                        connected={connected}
                        ended={ended}
                        serverState={serverState}
                        serverTick={serverTick}
                        playing={playing}
                        tick={tick}
                        maxTicks={maxTicks}
                        speed={speed}
                        onTogglePlay={handleTogglePlay}
                        onSeekTick={handleSeekTick}
                        onStepForward={handleStepForward}
                        onStepBack={handleStepBack}
                        onSetSpeed={handleSetSpeed}
                        onRewind={handleRewind}
                        onSave={handleSaveSnapshot}
                        onBackToScenarios={handleBackToScenarios}
                    />

                    {/* Canvas overlays */}
                    {currentRoom && !isLoading && (
                        <div className="canvas-overlay canvas-room-label glass-panel">
                            <MapIcon size={12} />
                            {currentRoom}
                        </div>
                    )}
                    {!isLoading && (
                        <div
                            className="canvas-overlay interactive canvas-zoom-indicator glass-panel"
                            onClick={() => canvasStageRef.current?.resetCamera?.()}
                            title="Reset camera (click)"
                            style={{ cursor: 'pointer' }}
                        >
                            <FocusIcon size={12} />
                            {cameraForMiniMap.zoom.toFixed(1)}×
                        </div>
                    )}
                    {!isLoading && (
                        <div className="canvas-overlay interactive canvas-toolbar glass-panel">
                            <button
                                className={`icon-btn ${showGrid ? 'active' : ''}`}
                                onClick={() => setShowGrid(!showGrid)}
                                title="Toggle grid overlay"
                            >
                                <GridIcon size={14} />
                            </button>
                            <button
                                className="icon-btn"
                                onClick={() => canvasStageRef.current?.resetCamera?.()}
                                title="Reset camera (0, Home)"
                            >
                                <FocusIcon size={14} />
                            </button>
                            <button
                                className={`icon-btn sidebar-collapse-btn ${sidebarCollapsed ? 'active' : ''}`}
                                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                                title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
                            >
                                {sidebarCollapsed ? <ChevronLeftIcon size={14} /> : <ChevronRightIcon size={14} />}
                            </button>
                        </div>
                    )}

                    {isLoading && (
                        <div className="loading-overlay">
                            <div className="loading-spinner" />
                            <div className="loading-text">
                                {connected ? 'Waiting for first frame...' : 'Connecting to server...'}
                            </div>
                            <div className="loading-hint">
                                {connected
                                    ? 'The scenario is running, data will appear shortly'
                                    : 'Make sure the viewer server is running'}
                            </div>
                        </div>
                    )}
                    {showMiniMap && !isLoading && (
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
                <div
                    ref={sidebarRef}
                    className={`viewer-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}
                    style={sidebarCollapsed ? undefined : { width: sidebarWidth }}
                >
                    {/* Resize handle — direct DOM during drag, no React re-renders */}
                    {!sidebarCollapsed && (
                        <div
                            className="sidebar-resize-handle"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                const startX = e.clientX;
                                const startW = sidebarRef.current?.offsetWidth || sidebarWidth;
                                const el = sidebarRef.current;
                                // Disable CSS transition + lock cursor during drag
                                el?.classList.add('dragging');
                                document.body.style.cursor = 'ew-resize';
                                const onMove = (ev) => {
                                    const newW = Math.max(
                                        SIDEBAR_MIN_W,
                                        Math.min(SIDEBAR_MAX_W, startW + startX - ev.clientX),
                                    );
                                    if (el) el.style.width = newW + 'px';
                                };
                                const onUp = (ev) => {
                                    document.removeEventListener('mousemove', onMove);
                                    document.removeEventListener('mouseup', onUp);
                                    el?.classList.remove('dragging');
                                    document.body.style.cursor = '';
                                    const finalW = Math.max(
                                        SIDEBAR_MIN_W,
                                        Math.min(SIDEBAR_MAX_W, startW + startX - ev.clientX),
                                    );
                                    setSidebarWidth(finalW);
                                };
                                document.addEventListener('mousemove', onMove);
                                document.addEventListener('mouseup', onUp);
                            }}
                        />
                    )}
                    {/* Sidebar tabs */}
                    <div className="sidebar-tabs">
                        <button
                            className={`sidebar-tab ${sidebarTab === 'inspector' ? 'active' : ''}`}
                            onClick={() => setSidebarTab('inspector')}
                            title="Object Inspector"
                        >
                            <MousePointerIcon size={14} />
                            <span>Inspect</span>
                        </button>
                        <button
                            className={`sidebar-tab ${sidebarTab === 'metrics' ? 'active' : ''}`}
                            onClick={() => setSidebarTab('metrics')}
                            title="Metrics"
                        >
                            <ActivityIcon size={14} />
                            <span>Metrics</span>
                        </button>
                        <button
                            className={`sidebar-tab ${sidebarTab === 'saveload' ? 'active' : ''}`}
                            onClick={() => setSidebarTab('saveload')}
                            title="Save / Load"
                        >
                            <DatabaseIcon size={14} />
                        </button>
                        <button
                            className={`sidebar-tab ${sidebarTab === 'settings' ? 'active' : ''}`}
                            onClick={() => setSidebarTab('settings')}
                            title="Settings"
                        >
                            <SettingsIcon size={14} />
                        </button>
                    </div>

                    {/* Sidebar content */}
                    <div className="sidebar-content">
                        {sidebarTab === 'inspector' && (
                            <ObjectInspector
                                objects={clickedTile?.objects || []}
                                selectedId={selectedId}
                                onSelect={setSelectedId}
                                typeFilter={typeFilter}
                                onTypeFilterChange={setTypeFilter}
                                searchQuery={searchQuery}
                                onSearchChange={setSearchQuery}
                                currentTick={recording.frames[tick]?.gameTime ?? 0}
                            />
                        )}
                        {sidebarTab === 'metrics' && <MetricsPanel frames={recording.frames} />}
                        {sidebarTab === 'saveload' && (
                            <SaveLoadPanel
                                currentTick={serverTick}
                                connected={connected}
                                ended={ended}
                                sseError={sseError}
                                onClearError={() => setSseError(null)}
                            />
                        )}
                        {sidebarTab === 'settings' && (
                            <SettingsPanel
                                showMiniMap={showMiniMap}
                                onToggleMiniMap={() => setShowMiniMap(!showMiniMap)}
                                showConsole={showConsole}
                                onToggleConsole={() => setShowConsole(!showConsole)}
                            />
                        )}
                    </div>

                    {/* Sidebar footer toggles */}
                    <div className="sidebar-footer">
                        <button
                            className={`sidebar-footer-btn ${showMiniMap ? 'active' : ''}`}
                            onClick={() => setShowMiniMap(!showMiniMap)}
                        >
                            <MapIcon size={14} />
                            MiniMap
                        </button>
                        <button
                            className={`sidebar-footer-btn ${showConsole ? 'active' : ''}`}
                            onClick={() => setShowConsole(!showConsole)}
                        >
                            <FilmIcon size={14} />
                            Console
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
                <div className="status-section">
                    <span className={`status-item ${connected ? 'connected' : 'disconnected'}`}>
                        <span className="status-dot" />
                        {connected ? (
                            <>
                                <WifiIcon size={12} />
                                Connected
                            </>
                        ) : (
                            <>
                                <WifiOffIcon size={12} />
                                Disconnected
                            </>
                        )}
                    </span>
                    {scenario && <span className="status-item status-scenario">{scenario}</span>}
                    {ended && <span className="status-item status-ended">● ENDED</span>}
                </div>
                <div className="status-section">
                    <span className="kbd-hints">
                        <span>
                            <kbd>Space</kbd>live play/pause
                        </span>
                        <span>
                            <kbd>←</kbd>
                            <kbd>→</kbd>step replay
                        </span>
                        <span>
                            <kbd>[</kbd>
                            <kbd>]</kbd>live speed
                        </span>
                        <span>
                            <kbd>0</kbd>
                            <kbd>Home</kbd>reset view
                        </span>
                        <span>
                            <kbd>M</kbd>metrics
                        </span>
                        <span>
                            <kbd>`</kbd>console
                        </span>
                    </span>
                </div>
            </div>
        </div>
    );
}

// ─── Settings Panel (placeholder for future settings) ───────────────────────
function SettingsPanel({ showMiniMap, onToggleMiniMap, showConsole, onToggleConsole }) {
    return (
        <div className="settings-panel">
            <div className="settings-row">
                <div>
                    <div className="settings-label">MiniMap</div>
                    <div className="settings-hint">Show room overview in corner</div>
                </div>
                <div className={`toggle-switch ${showMiniMap ? 'on' : ''}`} onClick={onToggleMiniMap} />
            </div>
            <div className="settings-row">
                <div>
                    <div className="settings-label">Console</div>
                    <div className="settings-hint">Show bot console output</div>
                </div>
                <div className={`toggle-switch ${showConsole ? 'on' : ''}`} onClick={onToggleConsole} />
            </div>
            <div className="settings-row">
                <div>
                    <div className="settings-label">Grid overlay</div>
                    <div className="settings-hint">Show tile grid on canvas</div>
                </div>
                <div className="toggle-switch" />
            </div>
            <div className="settings-row">
                <div>
                    <div className="settings-label">Heatmap</div>
                    <div className="settings-hint">Energy density visualization</div>
                </div>
                <div className="toggle-switch" />
            </div>
        </div>
    );
}

// Mount to DOM
const rootEl = document.getElementById('root');
if (rootEl) {
    createRoot(rootEl).render(<App />);
}
