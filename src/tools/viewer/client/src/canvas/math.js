// Camera math — pure functions, testable without DOM/React.

/**
 * Zoom toward a point (px, py) in screen coordinates.
 * The world under the cursor stays under the cursor after zoom.
 *
 * @param {{x:number,y:number,zoom:number}} cam — current camera state
 * @param {number} px — screen x of anchor point
 * @param {number} py — screen y of anchor point
 * @param {number} factor — multiplier for zoom (e.g. 1.3 = in, 1/1.3 = out)
 * @returns {{x:number,y:number,zoom:number}}
 */
export function zoomToward(cam, px, py, factor) {
    const newZoom = Math.max(0.1, Math.min(10, cam.zoom * factor));
    return {
        x: px - (px - cam.x) * (newZoom / cam.zoom),
        y: py - (py - cam.y) * (newZoom / cam.zoom),
        zoom: newZoom,
    };
}
