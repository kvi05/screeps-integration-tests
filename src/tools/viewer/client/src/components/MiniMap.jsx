/**
 * @file MiniMap — overview of all active rooms with camera position indicator.
 *
 * Features:
 * - WR-5: Mini-map of all active rooms with camera position
 * - Shows room grid, labels, and viewport indicator
 * - Click on a room to jump the camera there
 *
 * @component
 */

import { useRef, useEffect, useState } from 'react';
import { MapIcon } from './Icons';

/**
 * @param {Object} props
 * @param {string[]} props.roomNames — list of active room names (e.g. ['W0N1', 'W0N2'])
 * @param {{x:number, y:number}} props.camera — camera pan offset
 * @param {number} props.zoom
 * @param {(x:number, y:number) => void} props.onJumpTo
 */
export default function MiniMap({ roomNames = [], camera = { x: 0, y: 0 }, zoom = 1, onJumpTo }) {
    const canvasRef = useRef(null);
    const [hoveredRoom, setHoveredRoom] = useState(null);

    const CELL = 20;
    const PADDING = 10;
    const WIDTH = 200;
    const HEIGHT = 150;

    /** @type {import('react').MutableRefObject<Array<{name:string, hx:number, hy:number}>>} */
    const parsedRef = useRef([]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = WIDTH * dpr;
        canvas.height = HEIGHT * dpr;
        canvas.style.width = `${WIDTH}px`;
        canvas.style.height = `${HEIGHT}px`;
        ctx.scale(dpr, dpr);

        // Background
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        if (roomNames.length === 0) return;

        // Parse room names to grid coordinates
        const parsed = roomNames
            .map((name) => {
                const match = name.match(/^([WE])(\d+)([NS])(\d+)$/);
                if (!match) return null;
                return {
                    name,
                    hx: match[1] === 'E' ? parseInt(match[2]) : -parseInt(match[2]) - 1,
                    hy: match[3] === 'S' ? parseInt(match[4]) : -parseInt(match[4]) - 1,
                };
            })
            .filter(Boolean);
        parsedRef.current = parsed;

        // Find bounds
        let minHx = Infinity,
            maxHx = -Infinity,
            minHy = Infinity,
            maxHy = -Infinity;
        for (const p of parsed) {
            if (p.hx < minHx) minHx = p.hx;
            if (p.hx > maxHx) maxHx = p.hx;
            if (p.hy < minHy) minHy = p.hy;
            if (p.hy > maxHy) maxHy = p.hy;
        }

        const gridW = maxHx - minHx + 1;
        const gridH = maxHy - minHy + 1;
        const scale = Math.min((WIDTH - PADDING * 2) / (gridW * CELL), (HEIGHT - PADDING * 2) / (gridH * CELL), 1);

        const offsetX = PADDING + (WIDTH - PADDING * 2 - gridW * CELL * scale) / 2;
        const offsetY = PADDING + (HEIGHT - PADDING * 2 - gridH * CELL * scale) / 2;

        // Draw rooms
        for (const p of parsed) {
            const rx = offsetX + (p.hx - minHx) * CELL * scale;
            const ry = offsetY + (p.hy - minHy) * CELL * scale;
            const rw = CELL * scale - 1;
            const rh = CELL * scale - 1;

            // Room fill
            const isHovered = hoveredRoom === p.name;
            ctx.fillStyle = isHovered ? '#3d3d3e' : '#2d2d2e';
            ctx.fillRect(rx, ry, rw, rh);

            // Room border
            ctx.strokeStyle = isHovered ? '#2dd4bf' : '#454546';
            ctx.lineWidth = isHovered ? 1.5 : 1;
            ctx.strokeRect(rx, ry, rw, rh);

            // Room name label
            ctx.fillStyle = isHovered ? '#5eead4' : '#888888';
            ctx.font = `${Math.max(8, 10 * scale)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(p.name, rx + rw / 2, ry + rh / 2 + 3);
        }

        // Camera viewport indicator — show on all rooms as a subtle highlight
        ctx.strokeStyle = '#2dd4bf';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 2]);
        // Show on first room as a simple indicator (TODO: proper viewport rect)
        if (parsed.length > 0) {
            const p0 = parsed[0];
            const rx = offsetX + (p0.hx - minHx) * CELL * scale + 2;
            const ry = offsetY + (p0.hy - minHy) * CELL * scale + 2;
            const rw = CELL * scale - 5;
            const rh = CELL * scale - 5;
            ctx.strokeRect(rx, ry, rw, rh);
        }
        ctx.setLineDash([]);
    }, [roomNames, camera, zoom, hoveredRoom]);

    const handleClick = (e) => {
        const canvas = canvasRef.current;
        const currentParsed = parsedRef.current;
        if (!canvas || currentParsed.length === 0) return;
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;

        // Compute bounds from currentParsed
        let minHx = Infinity,
            maxHx = -Infinity,
            minHy = Infinity,
            maxHy = -Infinity;
        for (const p of currentParsed) {
            if (p.hx < minHx) minHx = p.hx;
            if (p.hx > maxHx) maxHx = p.hx;
            if (p.hy < minHy) minHy = p.hy;
            if (p.hy > maxHy) maxHy = p.hy;
        }
        const gridW = maxHx - minHx + 1;
        const gridH = maxHy - minHy + 1;
        const scale = Math.min((WIDTH - PADDING * 2) / (gridW * CELL), (HEIGHT - PADDING * 2) / (gridH * CELL), 1);
        const offsetX = PADDING + (WIDTH - PADDING * 2 - gridW * CELL * scale) / 2;
        const offsetY = PADDING + (HEIGHT - PADDING * 2 - gridH * CELL * scale) / 2;

        // Find which room was clicked
        for (const p of currentParsed) {
            const rx = offsetX + (p.hx - minHx) * CELL * scale;
            const ry = offsetY + (p.hy - minHy) * CELL * scale;
            const rw = CELL * scale;
            const rh = CELL * scale;
            if (cx >= rx && cx < rx + rw && cy >= ry && cy < ry + rh) {
                if (onJumpTo) {
                    onJumpTo(p.name);
                }
                break;
            }
        }
    };

    const handleMouseMove = (e) => {
        const canvas = canvasRef.current;
        const currentParsed = parsedRef.current;
        if (!canvas || currentParsed.length === 0) return;
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;

        let minHx = Infinity,
            maxHx = -Infinity,
            minHy = Infinity,
            maxHy = -Infinity;
        for (const p of currentParsed) {
            if (p.hx < minHx) minHx = p.hx;
            if (p.hx > maxHx) maxHx = p.hx;
            if (p.hy < minHy) minHy = p.hy;
            if (p.hy > maxHy) maxHy = p.hy;
        }
        const gridW = maxHx - minHx + 1;
        const gridH = maxHy - minHy + 1;
        const scale = Math.min((WIDTH - PADDING * 2) / (gridW * CELL), (HEIGHT - PADDING * 2) / (gridH * CELL), 1);
        const offsetX = PADDING + (WIDTH - PADDING * 2 - gridW * CELL * scale) / 2;
        const offsetY = PADDING + (HEIGHT - PADDING * 2 - gridH * CELL * scale) / 2;

        let found = null;
        for (const p of currentParsed) {
            const rx = offsetX + (p.hx - minHx) * CELL * scale;
            const ry = offsetY + (p.hy - minHy) * CELL * scale;
            const rw = CELL * scale;
            const rh = CELL * scale;
            if (cx >= rx && cx < rx + rw && cy >= ry && cy < ry + rh) {
                found = p.name;
                break;
            }
        }
        setHoveredRoom(found);
    };

    return (
        <div className="mini-map-container">
            <div className="mini-map-header">
                <MapIcon size={12} />
                MiniMap
            </div>
            <canvas
                ref={canvasRef}
                className="mini-map"
                onClick={handleClick}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setHoveredRoom(null)}
                title="Click a room to navigate"
            />
        </div>
    );
}