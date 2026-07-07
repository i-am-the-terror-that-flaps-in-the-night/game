import { CONFIG } from './config.js';
import { lerp, rand, randInt, toRgba } from './utils.js';

// --- VISUAL SYSTEMS ---
export class DecalSystem {
    constructor() {
        this.decals = [];
    }
    add(x, y, type, size) {
        if (this.decals.length > 200) this.decals.shift();
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
    draw(ctx, cam) {
        for (const d of this.decals) {
            const p = cam.toScreen(d.x, d.y);
            ctx.globalAlpha = d.alpha;
            if (d.type === "blood") {
                ctx.fillStyle = "#7f1d1d";
                ctx.beginPath();
                ctx.ellipse(
                    p.x,
                    p.y + 2,
                    d.size * cam.z,
                    d.size * 0.4 * cam.z,
                    0,
                    0,
                    Math.PI * 2,
                );
                ctx.fill();
            } else if (d.type === "scorch") {
                ctx.fillStyle = "#020617";
                ctx.beginPath();
                ctx.ellipse(
                    p.x,
                    p.y + 2,
                    d.size * cam.z,
                    d.size * 0.3 * cam.z,
                    0,
                    0,
                    Math.PI * 2,
                );
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
    }
}

export class ParticleSystem {
    constructor() {
        this.p = [];
    }
    emit(x, y, c, color, sp, sz, type) {
        const q = parseFloat(
            document.getElementById("particleQuality").value || 1,
        );
        c = Math.floor(c * q);
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
            if (p.life <= 0 || p.y > CONFIG.GROUND_Y + 10)
                this.p.splice(i, 1);
        }
    }
    draw(ctx, cam) {
        for (const p of this.p) {
            const pos = cam.toScreen(p.x, p.y);
            ctx.globalAlpha = Math.max(0, p.life / p.maxL);
            ctx.fillStyle = p.col;
            if (p.type === "float" || p.type === "spark")
                ctx.globalCompositeOperation = "screen";

            ctx.beginPath();
            if (p.type === "spark") {
                ctx.moveTo(pos.x, pos.y);
                ctx.lineTo(
                    pos.x - p.vx * 2 * cam.z,
                    pos.y - p.vy * 2 * cam.z,
                );
                ctx.strokeStyle = p.col;
                ctx.lineWidth = p.sz * cam.z;
                ctx.stroke();
            } else {
                ctx.arc(
                    pos.x,
                    pos.y,
                    Math.max(0.1, p.sz * cam.z),
                    0,
                    Math.PI * 2,
                );
                ctx.fill();
            }
            ctx.globalCompositeOperation = "source-over";
        }
        ctx.globalAlpha = 1;
    }
}

// Transient combat-feedback effects: weapon-swing crescents,
// impact shockwave rings, hit flashes and directional spark bursts.
export class EffectSystem {
    constructor() { this.e = []; }
    _q() {
        const el = document.getElementById("particleQuality");
        return el ? parseFloat(el.value || 1) : 1;
    }
    slash(x, y, ang, opt = {}) {
        this.e.push({
            type: "slash", x, y, ang,
            len: opt.len || 28, w: opt.w || 5,
            col: opt.col || "#ffffff",
            arc: opt.arc != null ? opt.arc : 1.7,
            life: opt.life || 8, maxL: opt.life || 8,
        });
    }
    ring(x, y, opt = {}) {
        this.e.push({
            type: "ring", x, y,
            r0: opt.r0 || 4, r1: opt.r1 || 40,
            col: opt.col || "#ffffff", w: opt.w || 3,
            life: opt.life || 16, maxL: opt.life || 16,
        });
    }
    flash(x, y, opt = {}) {
        this.e.push({
            type: "flash", x, y,
            r: opt.r || 28, col: opt.col || "#ffffff",
            life: opt.life || 7, maxL: opt.life || 7,
        });
    }
    spark(x, y, ang, opt = {}) {
        if (this._q() < 1 && Math.random() < 0.5) return;
        const n = opt.n || 5, spread = opt.spread || 0.6, len = opt.len || 16;
        const rays = [];
        for (let k = 0; k < n; k++)
            rays.push({ a: ang + rand(-spread, spread), L: len * rand(0.55, 1.25) });
        this.e.push({
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
        for (const f of this.e) {
            const a = Math.max(0, f.life / f.maxL); // 1 -> 0
            const t = 1 - a; // progress 0 -> 1
            const p = cam.toScreen(f.x, f.y);
            if (f.type === "slash") {
                const rad = f.len * cam.z * (0.55 + t * 0.75);
                const a0 = f.ang - f.arc / 2, a1 = f.ang + f.arc / 2;
                ctx.globalAlpha = a;
                ctx.strokeStyle = f.col;
                ctx.lineWidth = f.w * cam.z * (1 - t * 0.65);
                ctx.beginPath();
                ctx.arc(p.x, p.y, rad, a0, a1);
                ctx.stroke();
                // bright leading tip
                ctx.globalAlpha = a * 0.95;
                ctx.lineWidth = Math.max(0.5, f.w * 0.45 * cam.z);
                ctx.beginPath();
                ctx.arc(p.x, p.y, rad, a1 - 0.3, a1);
                ctx.stroke();
            } else if (f.type === "ring") {
                const r = lerp(f.r0, f.r1, t) * cam.z;
                ctx.globalAlpha = a * a;
                ctx.strokeStyle = f.col;
                ctx.lineWidth = Math.max(0.5, f.w * cam.z * a);
                ctx.beginPath();
                ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                ctx.stroke();
            } else if (f.type === "flash") {
                const r = Math.max(1, f.r * cam.z * (0.5 + t * 0.8));
                const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
                g.addColorStop(0, toRgba(f.col, 0.85 * a));
                g.addColorStop(0.5, toRgba(f.col, 0.3 * a));
                g.addColorStop(1, toRgba(f.col, 0));
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                ctx.fill();
            } else if (f.type === "spark") {
                ctx.globalAlpha = a;
                ctx.strokeStyle = f.col;
                ctx.lineWidth = f.w * cam.z;
                for (const r of f.rays) {
                    const L = r.L * cam.z * (0.5 + t * 0.9);
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p.x + Math.cos(r.a) * L, p.y + Math.sin(r.a) * L);
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
        const q = parseFloat(
            document.getElementById("particleQuality").value || 1,
        );
        const count = this.type === "rain" ? 4 * q : 2 * q;

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
            if (p.y > CONFIG.GROUND_Y) this.particles.splice(i, 1);
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
            const pos = cam.toScreen(p.x, p.y);
            if (this.type === "rain") {
                ctx.beginPath();
                ctx.moveTo(pos.x, pos.y);
                ctx.lineTo(
                    pos.x - p.vx * cam.z,
                    pos.y - p.s * cam.z,
                );
                ctx.strokeStyle = ctx.fillStyle;
                ctx.lineWidth = p.sz * cam.z;
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, p.sz * cam.z, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    }
}
