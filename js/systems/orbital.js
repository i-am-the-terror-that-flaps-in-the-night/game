import { TEAMS } from '../config.js';
import { dealDamage } from './combat.js';
import { groundAt, terrain } from './terrain.js';

// --- CASTLE ORBITAL LASER ---
// Always on: the moment enemies come within RANGE of the castle, a colossal
// red beam tears down out of the sky onto the densest pack and STAYS on —
// no charge-up, no recharge. It sweeps across the field to follow the
// enemy, burning everything under it every TICK frames. When nothing is in
// range it fades out; it re-ignites the instant something comes close.
// Tunnels shelter troops from it, like every other sky-borne strike.

export const ORBITAL = {
    range: 1100,      // proximity to the castle that wakes the laser
    radius: 70,       // burn half-width at the ground
    dmg: 45,          // magic damage per tick (~450/s)
    tick: 6,          // frames between burn ticks
    bossMult: 0.5,    // Rustmaw's hull shrugs off half
    sweep: 9,         // max beam travel per frame (px)
};

export class OrbitalCannon {
    constructor(g) {
        this.g = g;
        this.reset();
    }

    reset() {
        this.on = false;
        this.x = 0;
        this.power = 0;      // 0..1 visual intensity (eases in/out)
        this.tickT = 0;
        this.t = 0;
        this.tgt = null;
        this.announced = false;
        this.stop();
    }

    // Silence the hum (lifecycle: victory/defeat/menu/reset).
    stop() {
        if (this.g.audio) this.g.audio.stopLaserHum();
    }

    castle() {
        for (const b of this.g.buildings) if (b.type === "castle" && b.active && b.hp > 0) return b;
        return null;
    }

    _valid(e, c) {
        return e.active && e.hp > 0 && e.x - c.x <= ORBITAL.range && !terrain.inTunnel(e.x);
    }

    // Densest cluster of enemies inside the laser's reach.
    _pick(c) {
        const cand = this.g.enemies.filter((e) => this._valid(e, c));
        let best = null, bestN = 0;
        for (const e of cand) {
            let n = 0;
            for (const o of cand) if (Math.abs(o.x - e.x) < ORBITAL.radius * 2) n += o.isBoss ? 4 : 1;
            if (n > bestN || (n === bestN && best && Math.abs(e.x - this.x) < Math.abs(best.x - this.x))) { bestN = n; best = e; }
        }
        return best;
    }

    update(dt) {
        const g = this.g, c = this.castle();
        this.t += dt;
        // Re-evaluate the target a few times a second (sticks to a live one).
        if (c && (!this.tgt || !this._valid(this.tgt, c) || Math.floor(this.t) % 20 === 0)) this.tgt = this._pick(c);
        if (!c || !this.tgt) {
            if (this.on) { this.on = false; g.audio.stopLaserHum(); }
            this.power = Math.max(0, this.power - 0.06 * dt);
            return;
        }
        if (!this.on) {
            // Ignite: the beam slams down right on the target.
            this.on = true;
            if (this.power < 0.05) { this.x = this.tgt.x; this._ignite(); }
            g.audio.startLaserHum();
            if (!this.announced) {
                this.announced = true;
                g.notify("🛰 Orbital laser online: nothing gets near the castle.");
            }
        }
        this.power = Math.min(1, this.power + 0.12 * dt);
        const d = this.tgt.x - this.x;
        this.x += Math.sign(d) * Math.min(Math.abs(d), ORBITAL.sweep * dt);

        // Burn.
        this.tickT -= dt;
        if (this.tickT <= 0) {
            this.tickT = ORBITAL.tick;
            const src = { dmgType: "magic", team: TEAMS.PLAYER, isUnit: false };
            for (const e of g.enemies.slice())
                if (e.active && e.hp > 0 && !terrain.inTunnel(e.x) && Math.abs(e.x - this.x) < ORBITAL.radius)
                    dealDamage(ORBITAL.dmg * (e.isBoss ? ORBITAL.bossMult : 1), src, e);
        }
        this._groundFx(dt);
    }

    // The beam's first contact: a blast, shockwaves and a camera punch.
    _ignite() {
        const g = this.g, x = this.x, gy = groundAt(x);
        g.fx.flash(x, gy - 40, { r: 200, col: "#fecaca", life: 18 });
        g.fx.ring(x, gy, { r0: 10, r1: 260, col: "#ef4444", w: 7, life: 28 });
        g.fx.ring(x, gy, { r0: 6, r1: 150, col: "#fff1f2", w: 3, life: 18 });
        for (let i = 0; i < 12; i++) g.particles.emit(x + (Math.random() - 0.5) * 70, gy - 4, 1, "#3f3f46", 8, 4, "debris");
        g.shake = Math.max(g.shake, 22);
        g.bossFlash = Math.max(g.bossFlash || 0, 0.25);
        if (g.cameraFX && g.cameraFX.impulse) g.cameraFX.impulse({ x: 0, y: 1, mag: 10 });
        g.audio.orbitalFire();
    }

    // Continuous impact: molten sparks, rising embers + smoke, a scorched
    // trail where the beam drags, a hot light and a steady rumble.
    _groundFx(dt) {
        const g = this.g, x = this.x, gy = groundAt(x), f = Math.floor(this.t);
        if (f % 2 === 0) g.particles.emit(x + (Math.random() - 0.5) * 40, gy - 4, 3, "#f87171", 7, 3, "spark");
        if (f % 3 === 0) g.particles.emit(x + (Math.random() - 0.5) * 90, gy - 10, 2, "#fdba74", 2.5, 3, "float");
        if (f % 5 === 0) g.particles.emit(x + (Math.random() - 0.5) * 60, gy - 30, 2, "#44403c", 2, 8, "fade");
        if (f % 7 === 0) g.decals.add(x + (Math.random() - 0.5) * 30, gy, "scorch", 50 + Math.random() * 30);
        if (f % 3 === 0) g.lights.add({ x, y: gy - 90, radius: 320, intensity: 2.0, color: "#f87171", flicker: 0.25, life: 5 });
        if (g.wgpu && g.wgpu.addDistortion && f % 2 === 0)
            g.wgpu.addDistortion({ x, y: gy - 60, kind: 2, maxR: 160, width: 40, strength: 0.012, life: 3 });
        g.shake = Math.max(g.shake, 3.5);
    }

    draw(ctx, cam) {
        const g = this.g, c = this.castle(), z = cam.z, f = g.frames;
        if (!c) return;
        // Uplink mast on the castle: blazes red while the laser is live.
        const mx = cam.sx(c.x + 40), my = cam.sy(c.y - c.h);
        ctx.save();
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 3 * z;
        ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx, my - 46 * z); ctx.stroke();
        ctx.lineWidth = 2 * z;
        ctx.beginPath(); ctx.ellipse(mx, my - 40 * z, 14 * z, 5 * z, -0.4, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = this.power > 0 ? `rgba(248,113,113,${0.5 + 0.5 * this.power})` : "rgba(148,163,184,0.6)";
        ctx.beginPath(); ctx.arc(mx, my - 48 * z, (4 + this.power * 3) * z, 0, Math.PI * 2); ctx.fill();
        if (this.power <= 0.01) { ctx.restore(); return; }

        const P = this.power;
        const bx = cam.sx(this.x), by = cam.sy(groundAt(this.x));
        const W = 170 * z * (0.6 + 0.4 * P); // beam half-width scale
        ctx.globalCompositeOperation = "screen";

        // Sky aperture: a burning rift in the clouds the beam pours out of.
        const ap = ctx.createRadialGradient(bx, 0, 4, bx, 0, 240 * z);
        ap.addColorStop(0, `rgba(254,202,202,${0.85 * P})`);
        ap.addColorStop(0.35, `rgba(239,68,68,${0.45 * P})`);
        ap.addColorStop(1, "rgba(127,29,29,0)");
        ctx.fillStyle = ap;
        ctx.fillRect(bx - 240 * z, -10, 480 * z, 250 * z);
        ctx.strokeStyle = `rgba(252,165,165,${0.5 * P})`;
        ctx.lineWidth = 2 * z;
        for (let k = 0; k < 3; k++) {
            const r = (60 + k * 38 + ((f * 1.5 + k * 20) % 38)) * z;
            ctx.beginPath(); ctx.ellipse(bx, 4, r, r * 0.18, 0, 0, Math.PI * 2); ctx.stroke();
        }

        // Beam body: wide crimson haze → saturated red → hot pink → white core.
        const layer = (hw, a, c0, c1) => {
            const gr = ctx.createLinearGradient(bx - hw, 0, bx + hw, 0);
            gr.addColorStop(0, c0 + "0)");
            gr.addColorStop(0.5, c1 + `${a})`);
            gr.addColorStop(1, c0 + "0)");
            ctx.fillStyle = gr;
            ctx.fillRect(bx - hw, 0, hw * 2, by);
        };
        const wob = 1 + 0.06 * Math.sin(f * 0.5) + 0.04 * Math.sin(f * 1.7);
        layer(W * 1.6 * wob, 0.35 * P, "rgba(127,29,29,", "rgba(185,28,28,");
        layer(W * wob, 0.6 * P, "rgba(185,28,28,", "rgba(220,38,38,");
        // Solid body (normal blend so it stays deep red against a dark sky).
        ctx.globalCompositeOperation = "source-over";
        layer(W * 0.62 * wob, 0.9 * P, "rgba(185,28,28,", "rgba(220,38,38,");
        layer(W * 0.36 * wob, 0.95 * P, "rgba(220,38,38,", "rgba(239,68,68,");
        ctx.globalCompositeOperation = "screen";
        layer(W * 0.2 * wob, 0.9 * P, "rgba(239,68,68,", "rgba(252,165,165,");
        ctx.fillStyle = `rgba(254,205,211,${0.9 * P})`;
        const core = W * 0.08 * wob;
        ctx.fillRect(bx - core, 0, core * 2, by);

        // Energy bands pouring down the beam.
        for (let yb = ((f * 22) % 90) - 90; yb < by; yb += 90) {
            const bg = ctx.createLinearGradient(0, yb, 0, yb + 40 * z);
            bg.addColorStop(0, "rgba(254,202,202,0)");
            bg.addColorStop(0.5, `rgba(254,202,202,${0.3 * P})`);
            bg.addColorStop(1, "rgba(254,202,202,0)");
            ctx.fillStyle = bg;
            ctx.fillRect(bx - W * 0.3, yb, W * 0.6, 40 * z);
        }

        // Crackling arcs licking off the beam's edges.
        ctx.strokeStyle = `rgba(254,202,202,${0.8 * P})`;
        ctx.lineWidth = 1.6 * z;
        for (let k = 0; k < 4; k++) {
            const side = k % 2 ? 1 : -1;
            let y = ((f * 9 + k * 173) % Math.max(1, by));
            let x = bx + side * W * 0.45;
            ctx.beginPath(); ctx.moveTo(x, y);
            for (let s = 0; s < 5; s++) {
                x += side * (6 + Math.random() * 12) * z;
                y += (Math.random() * 24 - 6) * z;
                ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // Ground impact: a white-hot splash and a molten pool.
        const hot = ctx.createRadialGradient(bx, by, 4, bx, by, 190 * z);
        hot.addColorStop(0, `rgba(255,241,242,${0.95 * P})`);
        hot.addColorStop(0.25, `rgba(248,113,113,${0.7 * P})`);
        hot.addColorStop(1, "rgba(127,29,29,0)");
        ctx.fillStyle = hot;
        ctx.fillRect(bx - 190 * z, by - 190 * z, 380 * z, 230 * z);
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = `rgba(254,215,170,${0.55 * P})`;
        ctx.beginPath(); ctx.ellipse(bx, by + 2 * z, ORBITAL.radius * 1.1 * z, 9 * z, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(220,38,38,${0.6 * P})`;
        ctx.beginPath(); ctx.ellipse(bx, by + 2 * z, ORBITAL.radius * 1.5 * z, 12 * z, 0, 0, Math.PI * 2); ctx.fill();

        // Faint red cast over the whole scene while the laser burns.
        ctx.fillStyle = `rgba(127,29,29,${0.08 * P})`;
        ctx.fillRect(0, 0, cam.viewW || 4000, by + 400);
        ctx.restore();
    }
}
