import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import CanvasStage from './components/CanvasStage';
import Controls from './components/Controls';
import { connectSSE } from './api/client';
import './styles/global.css';

/**
 * @file App — root viewer component.
 *
 * Manages:
 * - SSE connection lifecycle
 * - Frame accumulation into a recording
 * - Playback state (playing/paused, tick, speed, sub-frame)
 *
 * @component
 */

export default function App() {
    // SSE connection state
    const [connected, setConnected] = useState(false);
    const [scenario, setScenario] = useState('');
    const [maxTicks, setMaxTicks] = useState(0);
    const [ended, setEnded] = useState(false);

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
    const [speed, setSpeed] = useState(5);

    const sseRef = useRef(null);
    const playingRef = useRef(playing);
    playingRef.current = playing;
    const speedRef = useRef(speed);
    speedRef.current = speed;
    const tickRef = useRef(tick);
    tickRef.current = tick;
    const recordingRef = useRef(recording);
    recordingRef.current = recording;

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

    // ─── SSE connection ─────────────────────────────────────────────────────

    useEffect(() => {
        // Perf collector for PoC metrics
        if (typeof window !== 'undefined') {
            window.__viewerPerf = { renderMs: [], sseLatencyMs: [], snapshotSize: [] };
        }

        let firstFrame = true;
        const sse = connectSSE((eventType, data) => {
            switch (eventType) {
                case 'start':
                    setScenario(data.scenario || '');
                    setMaxTicks(data.maxTicks || 0);
                    setConnected(true);
                    break;
                case 'terrain': {
                    setRecording((prev) => ({
                        ...prev,
                        terrain: { ...prev.terrain, ...(data || {}) },
                    }));
                    break;
                }
                case 'frame': {
                    // SSE latency: server timestamp vs now
                    if (data._sentAt && window.__viewerPerf) {
                        window.__viewerPerf.sseLatencyMs.push(Date.now() - data._sentAt);
                    }
                    // Snapshot size
                    if (data._size && window.__viewerPerf) {
                        window.__viewerPerf.snapshotSize.push(data._size);
                    }
                    // First frame → mark connected and capture terrain
                    if (firstFrame) {
                        firstFrame = false;
                        setConnected(true);
                        if (data.terrain && Object.keys(data.terrain).length > 0) {
                            setRecording((prev) => ({
                                ...prev,
                                terrain: { ...prev.terrain, ...data.terrain },
                            }));
                        }
                    }
                    setRecording((prev) => ({
                        ...prev,
                        frames: [...prev.frames, { gameTime: data.gameTime, objects: data.objects || [] }],
                    }));
                    break;
                }
                case 'end':
                    setEnded(true);
                    setPlaying(false);
                    break;
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
        console.group('%c📊 Viewer PoC Metrics', 'font-size:16px;font-weight:bold');
        console.log(
            'Snapshot size (bytes):  avg=%s  p50=%s  p99=%s  min=%s  max=%s',
            avg(p.snapshotSize),
            pct(p.snapshotSize, 50),
            pct(p.snapshotSize, 99),
            p.snapshotSize.length ? Math.min(...p.snapshotSize) : '—',
            p.snapshotSize.length ? Math.max(...p.snapshotSize) : '—',
        );
        console.log(
            'SSE latency (ms):       avg=%s  p50=%s  p99=%s  min=%s  max=%s',
            avg(p.sseLatencyMs),
            pct(p.sseLatencyMs, 50),
            pct(p.sseLatencyMs, 99),
            p.sseLatencyMs.length ? Math.min(...p.sseLatencyMs) : '—',
            p.sseLatencyMs.length ? Math.max(...p.sseLatencyMs) : '—',
        );
        console.log(
            'Render time (ms):       avg=%s  p50=%s  p99=%s  min=%s  max=%s',
            avg(p.renderMs),
            pct(p.renderMs, 50),
            pct(p.renderMs, 99),
            p.renderMs.length ? Math.min(...p.renderMs) : '—',
            p.renderMs.length ? Math.max(...p.renderMs) : '—',
        );
        console.log('Total frames: %d', p.snapshotSize.length);
        console.groupEnd();
    }, [ended]);

    // ─── Playback: while live, chase latest frame ────────────────────────────

    useEffect(() => {
        if (!playing || ended) return;
        // Jump to latest available frame — no timer drift
        const latest = recording.frames.length - 1;
        if (latest >= 0 && tickRef.current !== latest) {
            tickRef.current = latest;
            setTick(latest);
            setSub(null);
        }
    }, [playing, recording.frames.length, ended]);

    // ─── Controls callbacks ─────────────────────────────────────────────────

    const handleTogglePlay = useCallback((play) => {
        setPlaying(play);
        if (!play) setSub(null);
    }, []);

    const handleSeekTick = useCallback((t) => {
        setTick(Math.max(0, Math.min(t, recordingRef.current.frames.length - 1)));
        setSub(null);
    }, []);

    const handleStepForward = useCallback(() => {
        setPlaying(false);
        setSub(null);
        setTick((prev) => Math.min(prev + 1, recordingRef.current.frames.length - 1));
    }, []);

    const handleSetSpeed = useCallback((s) => {
        setSpeed(s);
    }, []);

    // ─── Keyboard shortcuts ─────────────────────────────────────────────────

    useEffect(() => {
        const handleKeyDown = (e) => {
            // Don't handle if user is typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

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
                    setTick((prev) => Math.max(0, prev - 1));
                    setSub(null);
                    break;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleTogglePlay, handleStepForward]);

    // ─── Test API (excluded from production builds by Vite dead-code elimination) ──
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
                };
            },
            injectFrames(objectsList, terrainMap) {
                if (terrainMap) {
                    setRecording((prev) => ({
                        terrain: { ...prev.terrain, ...terrainMap },
                        frames: [...prev.frames, { gameTime: prev.frames.length, objects: objectsList || [] }],
                    }));
                } else {
                    setRecording((prev) => ({
                        ...prev,
                        frames: [...prev.frames, { gameTime: prev.frames.length, objects: objectsList || [] }],
                    }));
                }
            },
            reset() {
                setRecording({ terrain: {}, frames: [] });
                setTick(0);
                setPlaying(false);
                setEnded(false);
                setConnected(false);
            },
            setPlaying(val) {
                setPlaying(val);
            },
            seekTick(t) {
                setTick(Math.max(0, Math.min(t, recordingRef.current.frames.length - 1)));
            },
        };
    }

    // ─── Render ─────────────────────────────────────────────────────────────

    const isLoading = !recording.frames.length && connected;

    return (
        <div className="viewer-layout">
            <Controls
                playing={playing}
                tick={tick}
                maxTicks={recording.frames.length - 1}
                speed={speed}
                onTogglePlay={handleTogglePlay}
                onSeekTick={handleSeekTick}
                onSetSpeed={handleSetSpeed}
                onStepForward={handleStepForward}
            />
            <CanvasStage recording={recording} tick={tick} sub={sub} playing={playing} />
            {isLoading && (
                <div className="loading-overlay">
                    <div className="spinner" />
                    Waiting for first frame...
                </div>
            )}
            <div className="status-bar">
                <span>
                    {scenario ? `Scenario: ${scenario}` : 'Viewer'}
                    {ended ? ' (finished)' : ''}
                </span>
                <span className={connected ? 'connected' : 'disconnected'}>
                    {connected ? '● Connected' : '○ Disconnected'}
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
