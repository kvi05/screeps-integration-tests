import { memo, useEffect, useRef, useState } from 'react';
import { getStats } from '../api/client';
import { CpuIcon, GaugeIcon } from './Icons';
import { formatSize, formatDuration } from '../utils/format';
import { PERSIST_BUDGET_CHARS } from '../utils/limits';
import { scenarioBasename } from '../utils/scenarioName';

/**
 * @file ResourcesPanel — runtime resource usage for the viewer sidebar.
 *
 * Responsibility:
 *   Polls GET /api/stats every `intervalMs` and combines backend numbers with
 *   browser-side measurements to give objective resource figures for the
 *   framework: memory, CPU, buffer pressure.
 *   - UI server (parent Node process): RSS, heap, external, CPU
 *   - Scenario workers (child processes): self-reported RSS + CPU via IPC,
 *     aggregated into Σ CPU (per-core and Task-Manager scale)
 *   - Browser tab: JS heap (Chromium), frame sizes, SSE latency, render time
 *   - Buffer & storage: frame-buffer fill, serialised-size estimate,
 *     sessionStorage quota usage
 *
 * Built for diagnosing long-run viewer stability (road/profiling analysis,
 * 2026-09-03). Every row carries a hover tooltip explaining the metric.
 *
 * @component
 */

/** Poll interval for /api/stats and browser metric refresh. */
const INTERVAL_MS = 2000;

/** Rolling window for CPU % and heap deltas (samples kept). */
const HISTORY = 60;

/** @typedef {{ tMs:number, userUsec:number, sysUsec:number }} CpuSample */

/**
 * One two-column table row with a hover tooltip (title).
 *
 * @param {Object} props
 * @param {string} props.label
 * @param {*} props.value
 * @param {string} [props.title] — hover explanation of the metric
 * @param {boolean} [props.bad] — highlight the value (error colour)
 */
function Row({ label, value, title, bad = false }) {
    return (
        <tr title={title}>
            <td>{label}</td>
            <td className={`mono ${bad ? 'bad' : ''}`}>{value}</td>
        </tr>
    );
}

/**
 * Resources panel for the viewer sidebar.
 *
 * Memoized: the parent App re-renders on every SSE frame, while this panel's
 * data changes only every INTERVAL_MS. The live frame buffer is passed as a
 * ref and sampled inside the poll loop, so the panel re-renders at the poll
 * cadence (2 s), not on every frame.
 *
 * @param {Object} props
 * @param {{current: {frames: Object[]}}} props.recordingRef — live ref to the
 *   client frame ring buffer (App.recordingRef); stable identity
 * @param {number} [props.replayBuffer] — configured ring buffer capacity
 * @returns {JSX.Element}
 */
function ResourcesPanel({ recordingRef, replayBuffer = 0 }) {
    /** @type {[Object|null, Function]} last /api/stats payload */
    const [stats, setStats] = useState(/** @type {Object|null} */ (null));
    /** @type {[string|null, Function]} fetch error message */
    const [error, setError] = useState(/** @type {string|null} */ (null));

    // CPU % between two polls — kept in a ref, not state (renders read the latest)
    const prevCpuRef = useRef(/** @type {CpuSample|null} */ (null));
    /** @type {[number|null, Function]} CPU % since the previous poll */
    const [cpuPct, setCpuPct] = useState(/** @type {number|null} */ (null));

    // Per-worker CPU % — previous cumulative µs per pid (workers self-report)
    const workerPrevRef = useRef(/** @type {Map<number, CpuSample>} */ (new Map()));
    /** @type {[Object<number, number>, Function]} pid → CPU % of one core */
    const [workerCpu, setWorkerCpu] = useState(/** @type {Object<number, number>} */ ({}));

    // Browser JS heap history for the growth indicator
    const heapHistRef = useRef(/** @type {number[]} */ []);
    /** @type {[{used:number, total:number, limit:number}|null, Function]} */
    const [jsHeap, setJsHeap] = useState(/** @type {{used:number, total:number, limit:number}|null} */ (null));

    // Render/SSE stats from the existing perf hooks (window.__viewerPerf)
    /** @type {[{renderMs:number, sseLatencyMs:number, sseFps:number, snapshotBytes:number}, Function]} */
    const [clientPerf, setClientPerf] = useState({
        renderMs: 0,
        sseLatencyMs: 0,
        sseFps: 0,
        snapshotBytes: 0,
    });

    // sessionStorage usage (the persist target — has a hard browser quota)
    /** @type [{used:number, quota:number}|, Function] */
    const [storage, setStorage] = useState({ used: 0, quota: 0 });

    // Frame count — sampled from recordingRef inside the poll loop (see the
    // component JSDoc for why this is not a prop-driven value)
    const [frameCount, setFrameCount] = useState(recordingRef.current?.frames.length || 0);

    useEffect(() => {
        let cancelled = false;

        const sampleBrowser = () => {
            // JS heap — Chrome/Edge only (Firefox lacks performance.memory)
            const pm = performance.memory;
            if (pm) {
                setJsHeap({ used: pm.usedJSHeapSize, total: pm.totalJSHeapSize, limit: pm.jsHeapSizeLimit });
                heapHistRef.current.push(pm.usedJSHeapSize);
                if (heapHistRef.current.length > HISTORY) heapHistRef.current.shift();
            }
            // Persisted viewer keys — sum their sizes for a quota estimate
            try {
                let used = 0;
                for (let i = 0; i < sessionStorage.length; i++) {
                    const k = sessionStorage.key(i);
                    if (k) used += k.length + (sessionStorage.getItem(k) || '').length;
                }
                // UTF-16 → bytes (2 per char in storage)
                setStorage({ used: used * 2, quota: PERSIST_BUDGET_CHARS });
            } catch {
                /* storage unavailable */
            }
            // Perf hooks — rolling averages of the last 100 samples
            const perf = window.__viewerPerf;
            if (perf) {
                const avg = (arr) => {
                    if (!arr || arr.length === 0) return 0;
                    const s = arr.slice(-100);
                    return s.reduce((a, b) => a + b, 0) / s.length;
                };
                const latency = perf.sseLatencyMs.slice(-100);
                setClientPerf({
                    renderMs: avg(perf.renderMs),
                    sseLatencyMs: avg(latency),
                    sseFps: latency.length >= 2 ? 1000 / Math.max(1, avg(latency)) : 0,
                    snapshotBytes: avg(perf.snapshotSize) || 0,
                });
            }
        };

        const poll = async () => {
            sampleBrowser();
            // Ring-buffer fill is only meaningful at the poll cadence (2 s),
            // not on every SSE frame
            setFrameCount(recordingRef.current?.frames.length || 0);
            try {
                const s = await getStats();
                if (cancelled) return;
                setStats(s);
                setError(null);
                // CPU % = delta(cpu time) / delta(wall time) — UI server process.
                // Values are "of one core": 100% = one fully loaded core.
                const now = { tMs: Date.now(), userUsec: s.process.cpuUserUsec, sysUsec: s.process.cpuSystemUsec };
                const prev = prevCpuRef.current;
                if (prev) {
                    const dWall = (now.tMs - prev.tMs) * 1000; // µs
                    const dCpu = now.userUsec - prev.userUsec + (now.sysUsec - prev.sysUsec);
                    if (dWall > 0) setCpuPct(Math.max(0, (dCpu / dWall) * 100));
                }
                prevCpuRef.current = now;

                // Scenario workers (child processes) — the same CPU math per pid.
                // Workers report cumulative µs; each poll diffs against the
                // previous report for that pid.
                const nextWorkerCpu = {};
                const livePids = new Set();
                for (const w of s.viewer.workers || []) {
                    livePids.add(w.pid);
                    const wPrev = workerPrevRef.current.get(w.pid);
                    if (wPrev) {
                        const dWall = (now.tMs - wPrev.tMs) * 1000;
                        const dCpu = w.cpuUserUsec - wPrev.userUsec + (w.cpuSystemUsec - wPrev.sysUsec);
                        if (dWall > 0) nextWorkerCpu[w.pid] = Math.max(0, (dCpu / dWall) * 100);
                    }
                    workerPrevRef.current.set(w.pid, {
                        tMs: now.tMs,
                        userUsec: w.cpuUserUsec,
                        sysUsec: w.cpuSystemUsec,
                    });
                }
                // Drop entries of exited workers (their stats are gone anyway)
                for (const pid of [...workerPrevRef.current.keys()]) {
                    if (!livePids.has(pid)) workerPrevRef.current.delete(pid);
                }
                setWorkerCpu(nextWorkerCpu);
            } catch {
                if (!cancelled) setError('Backend stats unavailable');
            }
        };

        poll();
        const id = setInterval(poll, INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, []);

    // Ring-buffer capacity for the fill row (frameCount comes from the poll loop)
    const cap = replayBuffer || frameCount || 1;
    const fillPct = Math.min(100, (frameCount / cap) * 100);

    // Heap growth over the retained window: last vs first sample (MB/s)
    let heapGrowth = null;
    const hist = heapHistRef.current;
    if (hist.length >= 2) {
        const dt = ((hist.length - 1) * INTERVAL_MS) / 1000;
        heapGrowth = (hist[hist.length - 1] - hist[0]) / dt; // bytes/sec
    }

    const pct = (v) => (v == null ? '—' : `${v.toFixed(0)}%`);

    // Scenario workers (child processes) reported by the backend
    const workers = stats?.viewer.workers || [];
    const workerCpus = Object.values(workerCpu);
    const totalCpu = (cpuPct || 0) + workerCpus.reduce((a, b) => a + b, 0); // % of ONE core
    const cpus = stats?.system.cpus || 0;
    const machinePct = cpus > 0 ? totalCpu / cpus : null; // Task Manager scale

    return (
        <div className="state-panel resources-panel">
            {error && <div className="state-status error">{error}</div>}

            {/* ─── UI server (parent Node process) ─── */}
            <div className="state-section">
                <h3>
                    <CpuIcon size={14} /> UI server (Node)
                    {stats && (
                        <span className="resources-meta">
                            pid {stats.process.pid} · up {formatDuration(stats.process.uptimeSec * 1000)}
                        </span>
                    )}
                </h3>
                <table className="resources-table">
                    <tbody>
                        <Row
                            label="Memory (RSS)"
                            value={stats ? formatSize(stats.process.rss) : '—'}
                            title="Resident Set Size — ALL memory of the UI server process: JS heap + C++ objects + buffers. This is the number Task Manager shows for this process. Scenarios run in separate worker processes (see below)."
                        />
                        <Row
                            label="JS heap used / total"
                            value={
                                stats
                                    ? `${formatSize(stats.process.heapUsed)} / ${formatSize(stats.process.heapTotal)}`
                                    : '—'
                            }
                            title="V8 JavaScript heap of the UI server. RSS − heap ≈ native/buffer memory."
                        />
                        <Row
                            label="External"
                            value={stats ? formatSize(stats.process.external) : '—'}
                            title="Memory OUTSIDE the V8 JS heap: ArrayBuffers, network/socket buffers and other C++ allocations."
                        />
                        <Row
                            label="CPU (server proc)"
                            value={pct(cpuPct)}
                            title="CPU of the UI server process alone. 100% = one fully loaded core. Scenario workers have their own section below."
                        />
                        <Row
                            label="Memory history"
                            value={
                                stats?.viewer.memoryHistoryTicks != null
                                    ? `${stats.viewer.memoryHistoryTicks} ticks`
                                    : '—'
                            }
                            title="Per-tick bot Memory ring buffer kept in the server for rewind / Memory viewer (keyframes + diffs)."
                        />
                        <Row
                            label="SSE clients"
                            value={stats ? stats.viewer.sseClients : '—'}
                            title="Connected browser tabs receiving the frame stream."
                        />
                    </tbody>
                </table>
                {stats && (
                    <p className="resources-hint">
                        Host: {formatSize(stats.system.totalMem - stats.system.freeMem)} /{' '}
                        {formatSize(stats.system.totalMem)} used · {stats.system.cpus} CPUs · {stats.system.platform}
                    </p>
                )}
            </div>

            {/* ─── Scenario workers (child processes) ─── */}
            {workers.length > 0 && (
                <div className="state-section">
                    <h3>
                        <CpuIcon size={14} /> Workers
                        <span className="resources-meta">
                            {workers.length} proc{workers.length > 1 ? 's' : ''}
                        </span>
                    </h3>
                    <table className="resources-table">
                        <tbody>
                            {workers.map((w) => (
                                <Row
                                    key={w.pid}
                                    label={scenarioBasename(w.scenario) || 'snapshot-launch'}
                                    value={`${formatSize(w.rss)} · ${pct(workerCpu[w.pid])}`}
                                    title={`Scenario worker (pid ${w.pid}) — self-reported RSS and CPU. 100% = one core.`}
                                />
                            ))}
                            <Row
                                label="Σ CPU"
                                value={`${pct(totalCpu)}${machinePct != null ? ` · ${pct(machinePct)} all` : ''}`}
                                title="Sum of CPU across the UI server + all scenario workers. The first number is 'of one core' (100% = 1 core); the second is normalised to all CPU cores — the scale Task Manager's total CPU uses."
                            />
                        </tbody>
                    </table>
                    <p className="resources-hint">
                        Scenarios run in child processes — their CPU/memory is reported here, not in the UI server
                        section.
                    </p>
                </div>
            )}

            {/* ─── Browser tab ─── */}
            <div className="state-section">
                <h3>
                    <GaugeIcon size={14} /> Browser tab
                </h3>
                <table className="resources-table">
                    <tbody>
                        {jsHeap ? (
                            <>
                                <Row
                                    label="JS heap used"
                                    value={formatSize(jsHeap.used)}
                                    title="JavaScript heap of this tab (performance.memory)."
                                />
                                <Row
                                    label="JS heap limit"
                                    value={formatSize(jsHeap.limit)}
                                    title="Browser cap for this tab's JS heap."
                                />
                                <Row
                                    label="Heap trend (2min)"
                                    value={`${
                                        heapGrowth == null
                                            ? '—'
                                            : `${heapGrowth > 0 ? '+' : ''}${formatSize(Math.abs(heapGrowth))}/s`
                                    }`}
                                    bad={heapGrowth != null && heapGrowth > 1024 * 100}
                                    title="Heap growth rate over the last ~2 minutes. Sustained growth = leak, flat = healthy GC."
                                />
                            </>
                        ) : (
                            <Row
                                label="JS heap"
                                value="n/a"
                                title="performance.memory is Chromium-only (Chrome/Edge). In Firefox open about:performance instead."
                            />
                        )}
                        <Row
                            label="Avg frame size"
                            value={clientPerf.snapshotBytes ? formatSize(clientPerf.snapshotBytes) : '—'}
                            title="Average size of one frame snapshot received over SSE."
                        />
                        <Row
                            label="SSE latency"
                            value={clientPerf.sseLatencyMs ? `${clientPerf.sseLatencyMs.toFixed(1)}ms` : '—'}
                            title="Time from the server stamping a frame to the browser receiving it (rolling average of the last 100 frames)."
                        />
                        <Row
                            label="SSE frame rate"
                            value={clientPerf.sseFps ? `${clientPerf.sseFps.toFixed(1)}/s` : '—'}
                            title="Estimated frame arrival rate: 1 / average SSE latency (rolling window of the last 100 frames)."
                        />
                        <Row
                            label="Render time"
                            value={clientPerf.renderMs ? `${clientPerf.renderMs.toFixed(1)}ms` : '—'}
                            title="Average canvas redraw time. Spikes here mean the main thread is struggling."
                        />
                    </tbody>
                </table>
            </div>

            {/* ─── Frame buffer / storage pressure ─── */}
            <div className="state-section">
                <h3>
                    <GaugeIcon size={14} /> Buffer &amp; storage
                </h3>
                <table className="resources-table">
                    <tbody>
                        <Row
                            label="Frame buffer"
                            value={`${frameCount} / ${cap} (${fillPct.toFixed(0)}%)`}
                            title="Client-side ring buffer of frames received over SSE. At capacity the oldest frames are evicted — replay depth is capped, not memory."
                        />
                        <Row
                            label="Buffer JSON ≈"
                            value={
                                clientPerf.snapshotBytes && frameCount
                                    ? formatSize(clientPerf.snapshotBytes * frameCount)
                                    : '—'
                            }
                            title="Estimated size of the whole frame buffer if serialised to JSON (avg frame size × frames). Lives in the BROWSER — it is what gets written to sessionStorage on scenario end / tab close."
                        />
                        <Row
                            label="sessionStorage"
                            value={`${formatSize(storage.used)} / ${formatSize(storage.quota)}`}
                            bad={storage.used > storage.quota}
                            title="Browser storage where the recording is saved. Persist budget 45 MB (Firefox allows ~50 MB; older browsers ~5 MB — hard browser limitation)."
                        />
                    </tbody>
                </table>
                {fillPct >= 95 && (
                    <p className="resources-hint warn">
                        Buffer at capacity — oldest frames are being evicted normally.
                    </p>
                )}
            </div>
        </div>
    );
}

export default memo(ResourcesPanel);
