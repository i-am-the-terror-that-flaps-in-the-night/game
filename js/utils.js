// --- UTILS ---
export const rand = (min, max) => Math.random() * (max - min) + min;
export const randInt = (min, max) => Math.floor(rand(min, max + 1));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
export const lerp = (a, b, t) => a + (b - a) * t;

// --- COLOR UTILS (for cinematic environment) ---
export const _hexCache = {};
export const hexToRgb = (hex) => {
    if (typeof hex !== "string") return hex; // already an {r,g,b}
    if (_hexCache[hex]) return _hexCache[hex];
    let h = hex.replace("#", "");
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    const n = parseInt(h, 16);
    const o = { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    _hexCache[hex] = o;
    return o;
};
// Mix two colors (hex or {r,g,b}); returns {r,g,b}
export const mixRgb = (a, b, t) => {
    const A = hexToRgb(a), B = hexToRgb(b);
    return {
        r: lerp(A.r, B.r, t),
        g: lerp(A.g, B.g, t),
        b: lerp(A.b, B.b, t),
    };
};
export const toRgb = (o) => `rgb(${o.r|0},${o.g|0},${o.b|0})`;
export const toRgba = (o, a) => {
    const c = hexToRgb(o);
    return `rgba(${c.r|0},${c.g|0},${c.b|0},${a})`;
};
// Mix two colors -> rgb string (convenience)
export const mixCol = (a, b, t) => toRgb(mixRgb(a, b, t));
// Lighten (>0) or darken (<0); returns rgb string
export const shade = (col, amt) => {
    const c = hexToRgb(col);
    const f = amt < 0 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
    return toRgb(mixRgb(c, f, Math.abs(amt)));
};
export const rgba = toRgba;
// 2-bone IK solver for articulated limbs. Returns the joint (knee/elbow)
// position plus the (length-clamped) end position. bend = +1/-1 chooses
// which way the joint folds.
export const ik2 = (rx, ry, tx, ty, l1, l2, bend) => {
    let dx = tx - rx, dy = ty - ry;
    let d = Math.hypot(dx, dy) || 0.0001;
    const maxD = l1 + l2 - 0.01, minD = Math.abs(l1 - l2) + 0.01;
    if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; }
    else if (d < minD) { dx *= minD / d; dy *= minD / d; d = minD; }
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const ux = dx / d, uy = dy / d;
    const px = -uy, py = ux;
    return {
        x: rx + ux * a + px * h * bend,
        y: ry + uy * a + py * h * bend,
        ex: rx + dx, ey: ry + dy,
    };
};
export const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ":" + (sec < 10 ? "0" : "") + sec;
};
