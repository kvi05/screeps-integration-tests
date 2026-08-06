import { useRef, useEffect, useCallback, useState } from 'react';
import { SpriteCache, StaticLayers } from '../canvas/caches';
import { computeStageLayout } from '../canvas/layout';
import { zoomToward } from '../canvas/math';
import { drawFrame } from '../canvas/drawFrame';

/**
 * @file CanvasStage — the main canvas component that renders room frames.
 *
 * Handles:
 * - Camera: drag (right-click or Ctrl+left-click), zoom (wheel), reset
 * - Rendering: terrain → structures → creeps per frame
 * - Sprite prewarming
 *
 * @component
 */

/**
 * @param {Object} props
 * @param {Object} props.recording — { terrain, frames }
 * @param {number} props.tick — current tick index
 * @param {number|null} props.sub — sub-frame [0,1) or null for static
 * @param {boolean} props.playing — whether playback is active
 */
export default function CanvasStage({ recording, tick, sub, playing }) {
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const layersRef = useRef(null);
    const layoutRef = useRef(null);
    const animFrameRef = useRef(null);

    // Camera state
    const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
    const cameraRef = useRef(camera);
    cameraRef.current = camera;

    const dragRef = useRef(null); // { startX, startY, camStartX, camStartY }
    const initDoneRef = useRef(false);

    // Sprite cache — lives across renders so prewarm accumulates creep types
    const spritesRef = useRef(new SpriteCache());

    // Initialize sprites, layers, layout — once, on first frame arrival
    useEffect(() => {
        if (!recording || !recording.frames || recording.frames.length === 0) return;

        // Prewarm sprites every frame — catches new creep body types as they appear
        spritesRef.current.prewarm(recording);

        if (initDoneRef.current) return;
        initDoneRef.current = true;

        const rooms = Object.keys(recording.terrain || {});
        if (rooms.length === 0) {
            // Infer rooms from first frame
            const seen = new Set();
            for (const o of recording.frames[0].objects || []) {
                if (o.room) seen.add(o.room);
            }
            for (const r of seen) rooms.push(r);
        }

        const layout = computeStageLayout(rooms, 600);
        layoutRef.current = layout;

        const layers = new StaticLayers(recording, layout);
        layersRef.current = layers;

        // Fit camera to show all rooms
        const container = containerRef.current;
        if (container) {
            const cw = container.clientWidth;
            const ch = container.clientHeight;
            const scaleX = cw / layout.width;
            const scaleY = ch / layout.height;
            const zoom = Math.min(scaleX, scaleY, 3) * 0.9;
            const cx = (cw - layout.width * zoom) / 2;
            const cy = (ch - layout.height * zoom) / 2;
            setCamera({ x: cx, y: cy, zoom });
        }
    }, [recording]);

    // Render the current frame — recording read via ref to avoid deps churn
    const recordingRef2 = useRef(recording);
    recordingRef2.current = recording;

    const renderCurrentFrame = useCallback(() => {
        const rec = recordingRef2.current;
        const canvas = canvasRef.current;
        const sprites = spritesRef.current;
        const layers = layersRef.current;
        const layout = layoutRef.current;
        const cam = cameraRef.current;

        if (!canvas || !rec || !sprites || !layers || !layout) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;

        // Resize canvas to match container
        const container = containerRef.current;
        if (container) {
            const w = container.clientWidth;
            const h = container.clientHeight;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
        }

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Background
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);

        // Apply camera transform: pixel coords → tile coords
        ctx.save();
        ctx.translate(cam.x, cam.y);
        const tileScale = (layout.pixelsPerRoom / 50) * cam.zoom;
        ctx.scale(tileScale, tileScale);

        // Update structure layers if epoch changed
        const frame = rec.frames[Math.max(0, Math.min(rec.frames.length - 1, tick))];
        if (frame) layers.updateIfNeeded(frame);

        drawFrame(ctx, rec, tick, sub, {
            sprites,
            layers,
            layout,
            showVisuals: true,
        });

        ctx.restore();
    }, [tick, sub]);

    // Re-render on tick/sub change OR when new frames arrive
    useEffect(() => {
        const t0 = performance.now();
        renderCurrentFrame();
        const elapsed = performance.now() - t0;
        // Emit render timing for metrics collection (PoC)
        if (typeof window !== 'undefined' && window.__viewerPerf) {
            window.__viewerPerf.renderMs.push(elapsed);
        }
    }, [renderCurrentFrame, recording.frames.length]);

    // Animation loop for smooth sub-frame updates
    useEffect(() => {
        if (playing) {
            const animate = () => {
                renderCurrentFrame();
                animFrameRef.current = requestAnimationFrame(animate);
            };
            animFrameRef.current = requestAnimationFrame(animate);
            return () => {
                if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
            };
        }
    }, [playing, renderCurrentFrame]);

    // ─── Mouse handlers ─────────────────────────────────────────────────────

    const getEventPos = useCallback((e) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        return rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : { x: 0, y: 0 };
    }, []);

    const handleMouseDown = useCallback(
        (e) => {
            // Middle button or right button or Ctrl+left → drag
            if (e.button === 1 || e.button === 2 || (e.button === 0 && e.ctrlKey)) {
                e.preventDefault();
                const pos = getEventPos(e);
                dragRef.current = {
                    startX: pos.x,
                    startY: pos.y,
                    camStartX: cameraRef.current.x,
                    camStartY: cameraRef.current.y,
                };
            }
        },
        [getEventPos],
    );

    const handleMouseMove = useCallback(
        (e) => {
            if (!dragRef.current) return;
            const pos = getEventPos(e);
            const dx = pos.x - dragRef.current.startX;
            const dy = pos.y - dragRef.current.startY;
            setCamera((prev) => ({
                ...prev,
                x: dragRef.current.camStartX + dx,
                y: dragRef.current.camStartY + dy,
            }));
        },
        [getEventPos],
    );

    const handleMouseUp = useCallback(() => {
        dragRef.current = null;
    }, []);

    // ─── Wheel handler ──────────────────────────────────────────────────────

    const handleWheel = useCallback(
        (e) => {
            e.preventDefault();
            const pos = getEventPos(e);
            const factor = e.deltaY < 0 ? 1.2 : 0.8;
            setCamera((prev) => zoomToward(prev, pos.x, pos.y, factor));
        },
        [getEventPos, zoomToward],
    );

    const handleContextMenu = useCallback((e) => {
        e.preventDefault();
    }, []);

    // ─── Keyboard handlers ──────────────────────────────────────────────────
    const resetCamera = useCallback(() => {
        const container = containerRef.current;
        const layout = layoutRef.current;
        if (!container || !layout) return;
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const scaleX = cw / layout.width;
        const scaleY = ch / layout.height;
        const zoom = Math.min(scaleX, scaleY, 3) * 0.9;
        const cx = (cw - layout.width * zoom) / 2;
        const cy = (ch - layout.height * zoom) / 2;
        setCamera({ x: cx, y: cy, zoom });
    }, []);

    useEffect(() => {
        const handleKeyDown = (e) => {
            const container = containerRef.current;
            switch (e.key) {
                case '0':
                case 'Home':
                    resetCamera();
                    break;
                case '+':
                case '=':
                    if (!container) break;
                    setCamera((prev) => zoomToward(prev, container.clientWidth / 2, container.clientHeight / 2, 1.3));
                    break;
                case '-':
                    if (!container) break;
                    setCamera((prev) =>
                        zoomToward(prev, container.clientWidth / 2, container.clientHeight / 2, 1 / 1.3),
                    );
                    break;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [resetCamera]);

    // ─── Test API (excluded from production builds by Vite dead-code elimination) ──
    if (import.meta.env.DEV) {
        window.__viewerTest = {
            ...(window.__viewerTest || {}),
            getCamera() {
                return { ...cameraRef.current };
            },
        };
    }

    return (
        <div ref={containerRef} className="canvas-stage">
            <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
                onContextMenu={handleContextMenu}
            />
        </div>
    );
}
