import { TEAMS } from '../config.js';
import { dealDamage } from './combat.js';
import { groundAt, terrain } from './terrain.js';

// --- CASTLE ORBITAL LASER ---
// Always on: the moment enemies come within RANGE of the castle, a colossal
// blue energy wave (Kamehameha-style) tears down out of the sky onto the
// densest pack and STAYS on —
// no charge-up, no recharge. It sweeps across the field to follow the
// enemy, burning everything under it every TICK frames. When nothing is in
// range it fades out; it re-ignites the instant something comes close.
// Tunnels shelter troops from it, like every other sky-borne strike.
// Its damage, reach and girth scale with the army's power level
// (game.powerLevel(): rises with waves survived and time in the run).

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

    // Current strength multiplier (1 at the start of a run).
    _lvl() { return this.g.powerLevel ? this.g.powerLevel() : 1; }
    radius() { return ORBITAL.radius * Math.min(1.8, 1 + (this._lvl() - 1) * 0.1); }

    // Densest cluster of enemies inside the laser's reach.
    _pick(c) {
        const cand = this.g.enemies.filter((e) => this._valid(e, c));
        let best = null, bestN = 0;
        for (const e of cand) {
            let n = 0;
            for (const o of cand) if (Math.abs(o.x - e.x) < this.radius() * 2) n += o.isBoss ? 4 : 1;
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
                g.notify("🛰 KA-ME-HA-ME-HA! The castle's orbital beam is online: nothing gets near.");
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
            const dmg = ORBITAL.dmg * this._lvl(), R = this.radius();
            for (const e of g.enemies.slice())
                if (e.active && e.hp > 0 && !terrain.inTunnel(e.x) && Math.abs(e.x - this.x) < R)
                    dealDamage(dmg * (e.isBoss ? ORBITAL.bossMult : 1), src, e);
        }
        this._groundFx(dt);
    }

    // The beam's first contact: a blue-white blast, shockwaves, a camera punch.
    _ignite() {
        const g = this.g, x = this.x, gy = groundAt(x);
        g.fx.flash(x, gy - 40, { r: 220, col: "#dbeafe", life: 18 });
        g.fx.ring(x, gy, { r0: 10, r1: 280, col: "#3b82f6", w: 7, life: 28 });
        g.fx.ring(x, gy, { r0: 6, r1: 160, col: "#f0f9ff", w: 3, life: 18 });
        g.fx.spark(x, gy - 6, -Math.PI / 2, { n: 20, spread: 1.5, len: 50, col: "#93c5fd" });
        for (let i = 0; i < 12; i++) g.particles.emit(x + (Math.random() - 0.5) * 70, gy - 4, 1, "#3f3f46", 8, 4, "debris");
        g.shake = Math.max(g.shake, 22);
        g.bossFlash = Math.max(g.bossFlash || 0, 0.25);
        if (g.cameraFX && g.cameraFX.impulse) g.cameraFX.impulse({ x: 0, y: 1, mag: 10 });
        g.audio.orbitalFire();
    }

    // Continuous impact: electric-blue sparks, rising ki motes, dust, a
    // scorched trail where the beam drags, a cold-blue light and a rumble.
    _groundFx(dt) {
        const g = this.g, x = this.x, gy = groundAt(x), f = Math.floor(this.t);
        const R = this.radius();
        if (f % 2 === 0) g.particles.emit(x + (Math.random() - 0.5) * 40, gy - 4, 3, "#60a5fa", 7, 3, "spark");
        if (f % 2 === 1) g.particles.emit(x + (Math.random() - 0.5) * R * 1.4, gy - 10, 2, "#bfdbfe", 3, 3, "float");
        if (f % 5 === 0) g.particles.emit(x + (Math.random() - 0.5) * 60, gy - 30, 2, "#475569", 2, 8, "fade");
        if (f % 7 === 0) g.decals.add(x + (Math.random() - 0.5) * 30, gy, "scorch", 50 + Math.random() * 30);
        if (f % 3 === 0) g.lights.add({ x, y: gy - 90, radius: 340, intensity: 2.2, color: "#60a5fa", flicker: 0.25, life: 5 });
        if (g.wgpu && g.wgpu.addDistortion && f % 2 === 0)
            g.wgpu.addDistortion({ x, y: gy - 60, kind: 2, maxR: 170, width: 40, strength: 0.012, life: 3 });
        g.shake = Math.max(g.shake, 3.5);
    }

    draw(ctx, cam) {
        const g = this.g, c = this.castle(), z = cam.z, f = g.frames;
        if (!c) return;
        // Uplink mast on the castle: blazes blue while the beam is live.
        const mx = cam.sx(c.x + 40), my = cam.sy(c.y - c.h);
        ctx.save();
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 3 * z;
        ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx, my - 46 * z); ctx.stroke();
        ctx.lineWidth = 2 * z;
        ctx.beginPath(); ctx.ellipse(mx, my - 40 * z, 14 * z, 5 * z, -0.4, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = this.power > 0 ? `rgba(96,165,250,${0.5 + 0.5 * this.power})` : "rgba(148,163,184,0.6)";
        ctx.beginPath(); ctx.arc(mx, my - 48 * z, (4 + this.power * 3) * z, 0, Math.PI * 2); ctx.fill();
        if (this.power <= 0.01) { ctx.restore(); return; }

        const P = this.power;
        const bx = cam.sx(this.x), by = cam.sy(groundAt(this.x));
        const grow = this.radius() / ORBITAL.radius; // beam thickens as power rises
        const W = 170 * z * (0.6 + 0.4 * P) * grow;
        const wob = 1 + 0.07 * Math.sin(f * 0.6) + 0.05 * Math.sin(f * 1.9);

        // Sky source: a crackling ki sphere the wave pours out of.
        ctx.globalCompositeOperation = "screen";
        const orbR = (70 + 8 * Math.sin(f * 0.4)) * z * grow;
        const orb = ctx.createRadialGradient(bx, 30 * z, 4, bx, 30 * z, orbR * 2.6);
        orb.addColorStop(0, `rgba(255,255,255,${P})`);
        orb.addColorStop(0.25, `rgba(191,219,254,${0.95 * P})`);
        orb.addColorStop(0.5, `rgba(59,130,246,${0.6 * P})`);
        orb.addColorStop(1, "rgba(30,64,175,0)");
        ctx.fillStyle = orb;
        ctx.fillRect(bx - orbR * 2.6, -orbR * 2, orbR * 5.2, orbR * 4.6);
        // Radiating rays off the sphere.
        ctx.strokeStyle = `rgba(191,219,254,${0.55 * P})`;
        ctx.lineWidth = 2 * z;
        for (let k = 0; k < 10; k++) {
            const a = (k / 10) * Math.PI * 2 + f * 0.03;
            const r0 = orbR * 0.9, r1 = orbR * (1.6 + 0.4 * Math.sin(f * 0.3 + k));
            ctx.beginPath();
            ctx.moveTo(bx + Math.cos(a) * r0, 30 * z + Math.sin(a) * r0);
            ctx.lineTo(bx + Math.cos(a) * r1, 30 * z + Math.sin(a) * r1);
            ctx.stroke();
        }

        // Beam body: deep-blue aura → saturated blue → electric sky-blue →
        // a blinding white core (the classic energy-wave look).
        const layer = (hw, a, c0, c1) => {
            const gr = ctx.createLinearGradient(bx - hw, 0, bx + hw, 0);
            gr.addColorStop(0, c0 + "0)");
            gr.addColorStop(0.5, c1 + `${a})`);
            gr.addColorStop(1, c0 + "0)");
            ctx.fillStyle = gr;
            ctx.fillRect(bx - hw, 0, hw * 2, by);
        };
        layer(W * 1.7 * wob, 0.45 * P, "rgba(30,64,175,", "rgba(37,99,235,");
        ctx.globalCompositeOperation = "source-over";
        layer(W * 0.7 * wob, 0.9 * P, "rgba(29,78,216,", "rgba(59,130,246,");
        layer(W * 0.45 * wob, 0.95 * P, "rgba(59,130,246,", "rgba(96,165,250,");
        ctx.globalCompositeOperation = "screen";
        layer(W * 0.28 * wob, 1.0 * P, "rgba(96,165,250,", "rgba(191,219,254,");
        const core = W * 0.13 * wob;
        ctx.fillStyle = `rgba(255,255,255,${0.97 * P})`;
        ctx.fillRect(bx - core, 0, core * 2, by);

        // Spiralling ki streams wrapping the beam.
        ctx.lineWidth = 3 * z;
        for (let k = 0; k < 2; k++) {
            ctx.strokeStyle = `rgba(224,242,254,${0.55 * P})`;
            ctx.beginPath();
            for (let y = 0; y <= by; y += 12) {
                const x = bx + Math.sin(y * 0.03 - f * 0.35 + k * Math.PI) * W * 0.5;
                if (y === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // Energy pulses rushing down the beam.
        for (let yb = ((f * 26) % 90) - 90; yb < by; yb += 90) {
            const bg = ctx.createLinearGradient(0, yb, 0, yb + 40 * z);
            bg.addColorStop(0, "rgba(219,234,254,0)");
            bg.addColorStop(0.5, `rgba(219,234,254,${0.35 * P})`);
            bg.addColorStop(1, "rgba(219,234,254,0)");
            ctx.fillStyle = bg;
            ctx.fillRect(bx - W * 0.35, yb, W * 0.7, 40 * z);
        }

        // Lightning crackling off the beam's edges.
        ctx.strokeStyle = `rgba(191,219,254,${0.9 * P})`;
        ctx.lineWidth = 1.8 * z;
        for (let k = 0; k < 6; k++) {
            const side = k % 2 ? 1 : -1;
            let y = ((f * 11 + k * 173) % Math.max(1, by));
            let x = bx + side * W * 0.5;
            ctx.beginPath(); ctx.moveTo(x, y);
            for (let s = 0; s < 6; s++) {
                x += side * (6 + Math.random() * 14) * z;
                y += (Math.random() * 26 - 8) * z;
                ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // Ground impact: a white-hot ki dome bulging from the strike point.
        const domeR = (120 + 10 * Math.sin(f * 0.5)) * z * grow;
        const hot = ctx.createRadialGradient(bx, by, 4, bx, by, domeR * 1.6);
        hot.addColorStop(0, `rgba(255,255,255,${P})`);
        hot.addColorStop(0.3, `rgba(147,197,253,${0.85 * P})`);
        hot.addColorStop(0.65, `rgba(37,99,235,${0.45 * P})`);
        hot.addColorStop(1, "rgba(30,64,175,0)");
        ctx.fillStyle = hot;
        ctx.beginPath(); ctx.ellipse(bx, by, domeR * 1.6, domeR * 0.9, 0, Math.PI, 0); ctx.fill();
        ctx.fillRect(bx - domeR * 1.6, by, domeR * 3.2, 30 * z);
        ctx.strokeStyle = `rgba(219,234,254,${0.6 * P})`;
        ctx.lineWidth = 2 * z;
        const rr = domeR * (0.6 + ((f * 0.03) % 1));
        ctx.beginPath(); ctx.ellipse(bx, by, rr * 1.6, rr * 0.3, 0, 0, Math.PI * 2); ctx.stroke();

        // Faint blue cast over the whole scene while the beam burns.
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = `rgba(30,58,138,${0.09 * P})`;
        ctx.fillRect(0, 0, cam.viewW || 4000, by + 400);
        ctx.restore();
    }
}
