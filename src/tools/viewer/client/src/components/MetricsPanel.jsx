/**
 * @file MetricsPanel — chart-based metrics visualisation.
 *
 * Features:
 * - MR-1: Graphs of metrics by tick (RCL, energyAvailable, creepCount, towerEnergy)
 * - MR-2: Table view (CSV-like)
 * - MR-4 (future): Compare metrics between two runs
 *
 * @component
 */

import { useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler,
} from 'chart.js';
import { ActivityIcon, TrendingUpIcon } from './Icons';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

/** @type {Array<{key:string, label:string, color:string, extract:(frame:Object) => number|null}>} */
const METRIC_DEFS = [
    {
        key: 'rcl',
        label: 'RCL',
        color: '#c084fc',
        extract: (frame) => {
            const ctrl = frame.objects?.find((o) => o.type === 'controller');
            return ctrl?.level ?? null;
        },
    },
    {
        key: 'energyAvailable',
        label: 'Energy Available',
        color: '#fde047',
        extract: (frame) => {
            let total = 0;
            for (const obj of frame.objects || []) {
                if (obj.store?.energy) total += obj.store.energy;
                if (obj.energy) total += obj.energy;
            }
            return total > 0 ? total : null;
        },
    },
    {
        key: 'creepCount',
        label: 'Creeps',
        color: '#60a5fa',
        extract: (frame) => {
            const count = (frame.objects || []).filter((o) => o.type === 'creep').length;
            return count;
        },
    },
    {
        key: 'towerEnergy',
        label: 'Tower Energy',
        color: '#fbbf24',
        extract: (frame) => {
            let total = 0;
            for (const obj of frame.objects || []) {
                if (obj.type === 'tower' && obj.store?.energy) total += obj.store.energy;
            }
            return total > 0 ? total : null;
        },
    },
];

/**
 * @param {Object} props
 * @param {Array<{gameTime:number, objects:Array}>} props.frames
 */
export default function MetricsPanel({ frames = [] }) {
    const [activeMetric, setActiveMetric] = useState('creepCount');

    const metricDef = METRIC_DEFS.find((m) => m.key === activeMetric) || METRIC_DEFS[0];

    // Collect data points
    const { labels, dataPoints } = useMemo(() => {
        /** @type {string[]} */
        const lbls = [];
        /** @type {(number|null)[]} */
        const pts = [];
        for (const frame of frames) {
            lbls.push(String(frame.gameTime));
            pts.push(metricDef.extract(frame));
        }
        return { labels: lbls, dataPoints: pts };
    }, [frames, metricDef]);

    const chartData = {
        labels,
        datasets: [
            {
                label: metricDef.label,
                data: dataPoints,
                borderColor: metricDef.color,
                backgroundColor: metricDef.color + '22',
                fill: true,
                tension: 0.2,
                pointRadius: 0,
                borderWidth: 2,
            },
        ],
    };

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
            legend: { display: false },
            tooltip: { mode: 'index', intersect: false },
        },
        scales: {
            x: {
                display: true,
                title: { display: true, text: 'Tick', color: '#888888', font: { size: 10 } },
                ticks: { color: '#888888', maxTicksLimit: 20, font: { size: 10 } },
                grid: { color: '#383839' },
            },
            y: {
                display: true,
                title: { display: true, text: metricDef.label, color: '#888888', font: { size: 10 } },
                ticks: { color: '#888888', font: { size: 10 } },
                grid: { color: '#383839' },
                beginAtZero: true,
            },
        },
    };

    // Summary: current + delta
    const currentValue = dataPoints.length > 0 ? dataPoints[dataPoints.length - 1] : null;
    const prevValue = dataPoints.length > 1 ? dataPoints[dataPoints.length - 2] : null;
    const delta = currentValue != null && prevValue != null ? currentValue - prevValue : null;

    // Table data — last 10 ticks
    const tableRows = useMemo(() => {
        const last = frames.slice(-10).reverse();
        return last.map((f) => ({
            tick: f.gameTime,
            value: metricDef.extract(f),
        }));
    }, [frames, metricDef]);

    return (
        <div className="metrics-panel">
            <div className="metrics-header">
                <span className="metrics-title">
                    <ActivityIcon size={14} />
                    Metrics
                </span>
                <select value={activeMetric} onChange={(e) => setActiveMetric(e.target.value)}>
                    {METRIC_DEFS.map((m) => (
                        <option key={m.key} value={m.key}>
                            {m.label}
                        </option>
                    ))}
                </select>
            </div>

            {/* Summary cards */}
            <div className="metrics-summary">
                <div className="metric-card">
                    <div className="metric-label">Current</div>
                    <div className="metric-value">{currentValue ?? '—'}</div>
                    {delta != null && (
                        <div className={`metric-delta ${delta >= 0 ? 'up' : 'down'}`}>
                            {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}
                        </div>
                    )}
                </div>
                <div className="metric-card">
                    <div className="metric-label">Ticks</div>
                    <div className="metric-value">{frames.length}</div>
                    <div className="metric-delta" style={{ color: 'var(--text-muted)' }}>
                        <TrendingUpIcon size={10} /> {metricDef.label}
                    </div>
                </div>
            </div>

            <div className="metrics-chart">
                <Line data={chartData} options={chartOptions} />
            </div>

            <div className="metrics-table">
                <table>
                    <thead>
                        <tr>
                            <th>Tick</th>
                            <th>{metricDef.label}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tableRows.map((r) => (
                            <tr key={r.tick}>
                                <td>{r.tick}</td>
                                <td>{r.value !== null && r.value !== undefined ? r.value : '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
