// --- WebGL ADDITIVE OVERLAY -------------------------------------------------
//
// A GPU-accelerated overlay for the game's additive "glow" layer: particles and
// the hero/singularity auras. These were the profiled hot paths in Canvas 2D —
// particles thrashed globalCompositeOperation per-sprite, and the auras leaned
// on shadowBlur (the single most expensive 2D op, re-rasterized per stroke).
//
// On the GPU all of that collapses into one thing the hardware does for free:
// additive alpha blending (SRC_ALPHA, ONE) of textured quads. We batch every
// glow sprite for the frame into two big vertex buffers (one draw call each) and
// blend them over the 2D canvas via a transparent, pointer-events:none overlay.
//
// Everything degrades gracefully: if WebGL is unavailable or GFX.webgl is off,
// `ok` stays false and the callers fall back to the untouched Canvas-2D paths.
//
// Coordinate space: sprites are submitted in *screen pixels* (post-camera,
// matching cam.sx/cam.sy), plus a shake offset so the overlay tracks the shaken
// 2D layer. A simple ortho projection maps pixels -> clip space in the shader.

const VERT_SRC = `
attribute vec2 aPos;        // quad corner in screen pixels
attribute vec2 aUV;         // 0..1 within the sprite quad
attribute vec4 aColor;      // premultiplied-ish rgba (a scales additive weight)
uniform vec2 uRes;          // viewport size in pixels
varying vec2 vUV;
varying vec4 vColor;
void main() {
    vUV = aUV;
    vColor = aColor;
    // pixel -> clip space, y flipped (canvas origin top-left)
    vec2 clip = vec2(aPos.x / uRes.x * 2.0 - 1.0,
                     1.0 - aPos.y / uRes.y * 2.0);
    gl_Position = vec4(clip, 0.0, 1.0);
}`;

const FRAG_SRC = `
precision mediump float;
varying vec2 vUV;
varying vec4 vColor;
void main() {
    // Soft radial falloff: bright core, smooth transparent edge. This is the
    // GPU equivalent of a blurred glow — no shadowBlur needed.
    vec2 d = vUV - 0.5;
    float r = length(d) * 2.0;             // 0 at center, 1 at edge
    float a = 1.0 - smoothstep(0.0, 1.0, r);
    a *= a;                                 // tighter hot core
    gl_FragColor = vec4(vColor.rgb * vColor.a * a, vColor.a * a);
}`;

// Floats per vertex: pos(2) + uv(2) + color(4) = 8. Six verts per quad.
const FLOATS_PER_VERT = 8;
const VERTS_PER_QUAD = 6;
const FLOATS_PER_QUAD = FLOATS_PER_VERT * VERTS_PER_QUAD;

export class GLRenderer {
    /** @type {Map<string, number[]>} color-parse cache (see parseColor) */
    static _colCache = new Map();

    constructor() {
        this.ok = false;
        this.gl = null;
        this.canvas = null;
        this.maxQuads = 4096;             // batch capacity; excess sprites drop
        this.count = 0;                   // quads queued this frame
        this.data = null;                 // Float32Array vertex scratch
        this.w = 0;
        this.h = 0;
    }

    /** Create the overlay canvas + GL context. Returns whether WebGL is usable. */
    init() {
        try {
            const c = document.createElement("canvas");
            c.id = "glCanvas";
            // Sit exactly over #gameCanvas, transparent, ignore pointer events.
            c.style.cssText =
                "position:absolute;top:0;left:0;width:100vw;height:100vh;" +
                "pointer-events:none;z-index:1;";
            const host = document.getElementById("gameCanvas");
            if (host && host.parentNode) host.parentNode.insertBefore(c, host.nextSibling);
            else document.body.appendChild(c);
            const gl = c.getContext("webgl", {
                alpha: true, premultipliedAlpha: false, antialias: false,
                depth: false, stencil: false,
            });
            if (!gl) return false;

            this.canvas = c;
            this.gl = gl;
            this.prog = this._program(VERT_SRC, FRAG_SRC);
            if (!this.prog) return false;

            this.aPos = gl.getAttribLocation(this.prog, "aPos");
            this.aUV = gl.getAttribLocation(this.prog, "aUV");
            this.aColor = gl.getAttribLocation(this.prog, "aColor");
            this.uRes = gl.getUniformLocation(this.prog, "uRes");

            this.buffer = gl.createBuffer();
            this.data = new Float32Array(this.maxQuads * FLOATS_PER_QUAD);

            gl.disable(gl.DEPTH_TEST);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE);   // additive

            this.ok = true;
            return true;
        } catch (e) {
            this.ok = false;
            return false;
        }
    }

    _program(vs, fs) {
        const gl = this.gl;
        const compile = (type, src) => {
            const sh = gl.createShader(type);
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
                gl.deleteShader(sh);
                return null;
            }
            return sh;
        };
        const v = compile(gl.VERTEX_SHADER, vs);
        const f = compile(gl.FRAGMENT_SHADER, fs);
        if (!v || !f) return null;
        const p = gl.createProgram();
        gl.attachShader(p, v);
        gl.attachShader(p, f);
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
        return p;
    }

    /** Match the overlay backing store to the viewport (called from resize). */
    resize(w, h) {
        if (!this.ok) return;
        this.w = w;
        this.h = h;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this._dpr = dpr;
    }

    /** Begin a frame: clear the accumulation buffer. */
    begin() {
        if (!this.ok) return;
        this.count = 0;
    }

    /**
     * Queue one additive glow sprite (screen-space).
     * @param {number} x screen x (center)
     * @param {number} y screen y (center)
     * @param {number} r radius in px
     * @param {number} rr red 0..1
     * @param {number} gg green 0..1
     * @param {number} bb blue 0..1
     * @param {number} a additive weight 0..1
     */
    glow(x, y, r, rr, gg, bb, a) {
        if (!this.ok || this.count >= this.maxQuads || a <= 0 || r <= 0) return;
        const d = this.data;
        let o = this.count * FLOATS_PER_QUAD;
        const x0 = x - r, y0 = y - r, x1 = x + r, y1 = y + r;
        // Two triangles: (x0,y0)(x1,y0)(x0,y1) + (x0,y1)(x1,y0)(x1,y1)
        const push = (px, py, u, v) => {
            d[o] = px; d[o + 1] = py; d[o + 2] = u; d[o + 3] = v;
            d[o + 4] = rr; d[o + 5] = gg; d[o + 6] = bb; d[o + 7] = a;
            o += FLOATS_PER_VERT;
        };
        push(x0, y0, 0, 0); push(x1, y0, 1, 0); push(x0, y1, 0, 1);
        push(x0, y1, 0, 1); push(x1, y0, 1, 0); push(x1, y1, 1, 1);
        this.count++;
    }

    /** Upload + draw everything queued this frame in a single draw call. */
    flush() {
        if (!this.ok) return;
        const gl = this.gl;
        // Always clear the overlay so last frame's glows don't linger, even if
        // nothing was queued this frame.
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (this.count === 0) return;

        gl.useProgram(this.prog);
        gl.uniform2f(this.uRes, this.w, this.h);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        // Upload only the used slice.
        gl.bufferData(gl.ARRAY_BUFFER,
            this.data.subarray(0, this.count * FLOATS_PER_QUAD), gl.DYNAMIC_DRAW);

        const stride = FLOATS_PER_VERT * 4;
        gl.enableVertexAttribArray(this.aPos);
        gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(this.aUV);
        gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, stride, 8);
        gl.enableVertexAttribArray(this.aColor);
        gl.vertexAttribPointer(this.aColor, 4, gl.FLOAT, false, stride, 16);

        gl.drawArrays(gl.TRIANGLES, 0, this.count * VERTS_PER_QUAD);
    }

    /** Parse "#rrggbb" or "rgba(r,g,b,a)" into [r,g,b,a] floats 0..1. Cached. */
    static parseColor(col) {
        const cache = GLRenderer._colCache;
        let v = cache.get(col);
        if (v) return v;
        v = [1, 1, 1, 1];
        if (col && col[0] === "#") {
            const h = col.slice(1);
            if (h.length === 6) {
                v = [
                    parseInt(h.slice(0, 2), 16) / 255,
                    parseInt(h.slice(2, 4), 16) / 255,
                    parseInt(h.slice(4, 6), 16) / 255,
                    1,
                ];
            }
        } else if (col && col.startsWith("rgba")) {
            const m = col.match(/[\d.]+/g);
            if (m && m.length >= 3) {
                v = [+m[0] / 255, +m[1] / 255, +m[2] / 255, m[3] !== undefined ? +m[3] : 1];
            }
        }
        cache.set(col, v);
        return v;
    }
}
