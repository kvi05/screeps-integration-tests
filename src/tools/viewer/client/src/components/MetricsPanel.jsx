/**
 * @file MetricsPanel — chart-based metrics visualisation.
 *
 * Collects metrics from frame.objects and renders line charts
 * using Chart.js + react-chartjs-2.
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

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

/** @type {Array<{key:string, label:string, color:string, extract:(frame:Object) => number|null}>} */
const METRIC_DEFS = [
    {
        key: 'rcl',
        label: 'RCL',
        color: '#4caf50',
        extract: (frame) => {
            const ctrl = frame.objects?.find((o) => o.type === 'controller');
            return ctrl?.level ?? null;
        },
    },
    {
        key: 'energyAvailable',
        label: 'Energy Available',
        color: '#ffeb3b',
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
        color: '#2196f3',
        extract: (frame) => {
            const count = (frame.objects || []).filter((o) => o.type === 'creep').length;
            return count;
        },
    },
    {
        key: 'towerEnergy',
        label: 'Tower Energy',
        color: '#ff9800',
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
                backgroundColor: metricDef.color + '33',
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
                title: { display: true, text: 'Tick', color: '#888' },
                ticks: { color: '#888', maxTicksLimit: 20 },
                grid: { color: '#333' },
            },
            y: {
                display: true,
                title: { display: true, text: metricDef.label, color: '#888' },
                ticks: { color: '#888' },
                grid: { color: '#333' },
                beginAtZero: true,
            },
        },
    };

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
                <span className="metrics-title">Metrics</span>
                <select value={activeMetric} onChange={(e) => setActiveMetric(e.target.value)}>
                    {METRIC_DEFS.map((m) => (
                        <option key={m.key} value={m.key}>
                            {m.label}
                        </option>
                    ))}
                </select>
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
