import { lerp, particleQuality, rand, randInt, toRgba } from '../utils.js';
import { GFX } from './graphics.js';
import { PERF } from './perf.js';
import { GLRenderer } from './gl-renderer.js';
import { groundAt } from './terrain.js';

// --- VISUAL SYSTEMS ---
export class DecalSystem {
    constructor() {
        this.decals = [];
    }
    add(x, y, type, size) {
        // Capped (anti-lag: PERF.decalCap shrinks with the shedding level).
        const cap = PERF.decalCap;
        if (this.decals.length >= cap) this.decals.splice(0, this.decals.length - cap + 1);
        this.decals.push({
            x,
            y,
            type,
            size,
            alpha: 0.8,
            life: 4000,
        });
    }
    update(dt) {
        for (let i = this.decals.length - 1; i >= 0; i--) {
            this.decals[i].life -= dt;
            if (this.decals[i].life < 100)
                this.decals[i].alpha *= 0.95;
            if (this.decals[i].life <= 0) this.decals.splice(i, 1);
        }
    }
    // Off-screen decals are skipped, and runs of same-type/same-alpha decals
    // (nearly all of them: alpha only changes in the last 100 frames) share
    // one path and one fill instead of a fill each (anti-lag).
    draw(ctx, cam) {
        const vL = cam.x - 120, vR = cam.x + cam.viewW / cam.z + 120;
        let type = null, alpha = -1, open = false;
        for (const d of this.decals) {
            if (d.x < vL || d.x > vR) continue;
            if (d.type !== "blood" && d.type !== "scorch") continue;
            if (d.type !== type || d.alpha !== alpha) {
                if (open) ctx.fill();
                type = d.type;
                alpha = d.alpha;
                ctx.globalAlpha = alpha;
                ctx.fillStyle = type === "blood" ? "#7f1d1d" : "#020617";
                ctx.beginPath();
                open = true;
            }
            const px = cam.sx(d.x), py = cam.sy(d.y) + 2, rx = d.size * cam.z;
            ctx.moveTo(px + rx, py);
            ctx.ellipse(px, py, rx, d.size * (type === "blood" ? 0.4 : 0.3) * cam.z, 0, 0, Math.PI * 2);
        }
        if (open) ctx.fill();
        ctx.globalAlpha = 1;
    }
}

export class ParticleSystem {
    constructor() {
        this.p = [];
    }
    emit(x, y, c, color, sp, sz, type) {
        const q = particleQuality();
        c = Math.floor(c * q);
        if (c <= 0) return;
        // GPU offload: additive particles (float/spark) are simulated AND drawn
        // entirely on the GPU when the WebGPU pool is live — the CPU never tracks
        // them. Non-additive (fade/debris) stay on the CPU/Canvas-2D path below.
        const g = typeof game !== "undefined" ? game : window.game;
        if (g && g.wgpu && g.wgpu.ok && GFX.webgpu &&
            (type === "float" || type === "spark")) {
            g.wgpu.emitParticles({
                x, y, count: c, rgb: GLRenderer.parseColor(color),
                speed: sp, size: sz, kind: type,
            });
            return;
        }
        for (let i = 0; i < c; i++) {
            const a = rand(0, Math.PI * 2),
                s = rand(sp * 0.3, sp);
            this.p.push({
                x,
                y,
                vx: Math.cos(a) * s,
                vy: Math.sin(a) * s,
                life: randInt(20, 50),
                maxL: 50,
                col: color,
                sz: rand(sz * 0.5, sz),
                type,
            });
        }
        if (this.p.length > GFX.particleCap)
            this.p.splice(0, this.p.length - GFX.particleCap);
    }
    update(dt) {
        for (let i = this.p.length - 1; i >= 0; i--) {
            let p = this.p[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.type !== "float") p.vy += 0.2 * dt; // gravity
            p.life -= dt;
            if (p.type === "fade" || p.type === "float")
                p.sz *= Math.pow(0.94, dt);
            if (p.life <= 0 || p.y > groundAt(p.x) + 10)
                this.p.splice(i, 1);
        }
    }
    draw(ctx, cam) {
        // Additive particles (float/spark) go through the GPU glow batch when
        // WebGL is active — one draw call for all of them, no per-sprite
        // composite-op thrash. Non-additive (fade/debris) stay on Canvas 2D.
        const g = typeof game !== "undefined" ? game : window.game;
        const useGL = g && g.gl && g.gl.ok && GFX.webgl;
        const sx = useGL ? g._shakeX || 0 : 0;
        const sy = useGL ? g._shakeY || 0 : 0;
        const vL = cam.x - 60, vR = cam.x + cam.viewW / cam.z + 60;
        for (const p of this.p) {
            if (p.x < vL || p.x > vR) continue; // off-screen (anti-lag)
            const px = cam.sx(p.x), py = cam.sy(p.y);
            const additive = p.type === "float" || p.type === "spark";
            const alpha = Math.max(0, p.life / p.maxL);

            if (useGL && additive) {
                // Sparks streak along velocity; approximate with a couple of
                // overlapping glow dots so they still read as motion trails.
                const c = GLRenderer.parseColor(p.col);
                const rad = Math.max(1.5, p.sz * cam.z * 2.2);
                if (p.type === "spark") {
                    g.gl.glow(px + sx, py + sy, rad, c[0], c[1], c[2], alpha * 0.9);
                    g.gl.glow(px - p.vx * cam.z + sx, py - p.vy * cam.z + sy,
                        rad * 0.7, c[0], c[1], c[2], alpha * 0.5);
                } else {
                    g.gl.glow(px + sx, py + sy, rad, c[0], c[1], c[2], alpha * 0.8);
                }
                continue;
            }

            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.col;
            if (additive) ctx.globalCompositeOperation = "screen";
            ctx.beginPath();
            if (p.type === "spark") {
                ctx.moveTo(px, py);
                ctx.lineTo(px - p.vx * 2 * cam.z, py - p.vy * 2 * cam.z);
                ctx.strokeStyle = p.col;
                ctx.lineWidth = p.sz * cam.z;
                ctx.stroke();
            } else {
                ctx.arc(px, py, Math.max(0.1, p.sz * cam.z), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalCompositeOperation = "source-over";
        }
        ctx.globalAlpha = 1;
    }
}

// Hit-flash gradients: one unit-radius radial per colour, scaled to each
// flash and faded via globalAlpha. Identical output to the old fresh gradient
// per flash per frame (stop alphas 0.85a/0.3a/0 == globalAlpha a × 0.85/0.3/0),
// without the allocation — flashes fire on every hit, death and castle shot.
const _flashGrads = new Map();
function flashGrad(ctx, col) {
    let g = _flashGrads.get(col);
    if (!g) {
        g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, toRgba(col, 0.85));
        g.addColorStop(0.5, toRgba(col, 0.3));
        g.addColorStop(1, toRgba(col, 0));
        _flashGrads.set(col, g);
    }
    return g;
}

// Transient combat-feedback effects: weapon-swing crescents,
// impact shockwave rings, hit flashes and directional spark bursts.
export class EffectSystem {
    constructor() { this.e = []; }
    // Live effects are capped (anti-lag; PERF.fxCap shrinks as the shedding
    // level rises). Oldest go first — they're the most faded anyway. Every
    // flash builds a radial gradient per frame, so an uncapped late-endless
    // melee (hits + deaths + castle beam) was hundreds of gradients a frame.
    _add(f) {
        this.e.push(f);
        if (this.e.length > PERF.fxCap) this.e.splice(0, this.e.length - PERF.fxCap);
    }
    slash(x, y, ang, opt = {}) {
        this._add({
            type: "slash", x, y, ang,
            len: opt.len || 28, w: opt.w || 5,
            col: opt.col || "#ffffff",
            arc: opt.arc != null ? opt.arc : 1.7,
            life: opt.life || 8, maxL: opt.life || 8,
        });
    }
    ring(x, y, opt = {}) {
        this._add({
            type: "ring", x, y,
            r0: opt.r0 || 4, r1: opt.r1 || 40,
            col: opt.col || "#ffffff", w: opt.w || 3,
            life: opt.life || 16, maxL: opt.life || 16,
        });
    }
    flash(x, y, opt = {}) {
        this._add({
            type: "flash", x, y,
            r: opt.r || 28, col: opt.col || "#ffffff",
            life: opt.life || 7, maxL: opt.life || 7,
        });
    }
    spark(x, y, ang, opt = {}) {
        if (particleQuality() < 1 && Math.random() < 0.5) return;
        const n = opt.n || 5, spread = opt.spread || 0.6, len = opt.len || 16;
        const rays = [];
        for (let k = 0; k < n; k++)
            rays.push({ a: ang + rand(-spread, spread), L: len * rand(0.55, 1.25) });
        this._add({
            type: "spark", x, y, rays,
            col: opt.col || "#fde68a", w: opt.w || 2,
            life: opt.life || 7, maxL: opt.life || 7,
        });
    }
    update(dt) {
        for (let i = this.e.length - 1; i >= 0; i--) {
            this.e[i].life -= dt;
            if (this.e[i].life <= 0) this.e.splice(i, 1);
        }
    }
    draw(ctx, cam) {
        if (!this.e.length) return;
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.lineCap = "round";
        const sw = cam.viewW + 320;
        for (const f of this.e) {
            const a = Math.max(0, f.life / f.maxL); // 1 -> 0
            const t = 1 - a; // progress 0 -> 1
            const px = cam.sx(f.x), py = cam.sy(f.y);
            if (px < -320 || px > sw) continue; // off-screen (anti-lag)
            if (f.type === "slash") {
                const rad = f.len * cam.z * (0.55 + t * 0.75);
                const a0 = f.ang - f.arc / 2, a1 = f.ang + f.arc / 2;
                ctx.globalAlpha = a;
                ctx.strokeStyle = f.col;
                ctx.lineWidth = f.w * cam.z * (1 - t * 0.65);
                ctx.beginPath();
                ctx.arc(px, py, rad, a0, a1);
                ctx.stroke();
                // bright leading tip
                ctx.globalAlpha = a * 0.95;
                ctx.lineWidth = Math.max(0.5, f.w * 0.45 * cam.z);
                ctx.beginPath();
                ctx.arc(px, py, rad, a1 - 0.3, a1);
                ctx.stroke();
            } else if (f.type === "ring") {
                const r = lerp(f.r0, f.r1, t) * cam.z;
                ctx.globalAlpha = a * a;
                ctx.strokeStyle = f.col;
                ctx.lineWidth = Math.max(0.5, f.w * cam.z * a);
                ctx.beginPath();
                ctx.arc(px, py, r, 0, Math.PI * 2);
                ctx.stroke();
            } else if (f.type === "flash") {
                const r = Math.max(1, f.r * cam.z * (0.5 + t * 0.8));
                // Flash never set globalAlpha itself: it inherits whatever the
                // previous effect left, so scale that (restored after).
                ctx.save();
                ctx.globalAlpha *= a;
                ctx.fillStyle = flashGrad(ctx, f.col);
                ctx.translate(px, py);
                ctx.scale(r, r);
                ctx.beginPath();
                ctx.arc(0, 0, 1, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            } else if (f.type === "spark") {
                ctx.globalAlpha = a;
                ctx.strokeStyle = f.col;
                ctx.lineWidth = f.w * cam.z;
                for (const r of f.rays) {
                    const L = r.L * cam.z * (0.5 + t * 0.9);
                    ctx.beginPath();
                    ctx.moveTo(px, py);
                    ctx.lineTo(px + Math.cos(r.a) * L, py + Math.sin(r.a) * L);
                    ctx.stroke();
                }
            }
        }
        ctx.globalAlpha = 1;
        ctx.restore();
    }
}

export class WeatherSystem {
    constructor() {
        this.particles = [];
        this.type = "none";
    }
    set(type) {
        this.type = type;
        this.particles = [];
    }
    update(dt, cam) {
        if (this.type === "none") return;
        const q = particleQuality();
        // Anti-lag (lite >= 2): stop spawning; drops already falling finish.
        const count = PERF.lite >= 2 ? 0 : this.type === "rain" ? 4 * q : 2 * q;

        for (let i = 0; i < count * dt; i++) {
            this.particles.push({
                x:
                    cam.x +
                    rand(-200, window.innerWidth / cam.z + 200),
                y: cam.y - 100,
                s: this.type === "rain" ? rand(15, 25) : rand(2, 5),
                vx: this.type === "rain" ? 2 : rand(-1, 1),
                sz: this.type === "rain" ? rand(1, 2) : rand(2, 4),
            });
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            let p = this.particles[i];
            p.x += p.vx * dt;
            p.y += p.s * dt;
            if (p.y > groundAt(p.x)) this.particles.splice(i, 1);
        }
    }
    draw(ctx, cam) {
        if (this.type === "none") return;
        ctx.save();
        ctx.fillStyle =
            this.type === "rain"
                ? "rgba(150,200,255,0.4)"
                : "rgba(255,255,255,0.6)";
        for (const p of this.particles) {
            const px = cam.sx(p.x), py = cam.sy(p.y);
            if (this.type === "rain") {
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(
                    px - p.vx * cam.z,
                    py - p.s * cam.z,
                );
                ctx.strokeStyle = ctx.fillStyle;
                ctx.lineWidth = p.sz * cam.z;
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.arc(px, py, p.sz * cam.z, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    }
}
