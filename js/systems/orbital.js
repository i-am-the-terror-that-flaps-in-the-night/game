import { TEAMS } from '../config.js';
import { dealDamage } from './combat.js';
import { groundAt, terrain } from './terrain.js';

// --- CASTLE ORBITAL STRIKE CANNON ---
// Always on, never player-triggered: whenever enemies come within RANGE of the
// castle, its uplink locks onto the densest cluster, paints it with a
// targeting laser for CHARGE frames, then a satellite drops a lance of light
// that obliterates everything in RADIUS. It then recharges for COOLDOWN.
// Tunnels shelter troops from it like every other sky-borne strike.

export const ORBITAL = {
    range: 1100,      // proximity to the castle that wakes the cannon
    radius: 125,      // blast radius
    dmg: 650,         // magic damage per strike (armour barely matters)
    bossMult: 0.5,    // Rustmaw's hull shrugs off half
    charge: 50,       // frames of targeting before impact
    cooldown: 150,    // frames between strikes
};

export class OrbitalCannon {
    constructor(g) {
        this.g = g;
        this.reset();
    }

    reset() {
        this.cd = 90;
        this.lock = null;   // { x, t, tgt } while painting a target
        this.beams = [];    // recent strikes (visual)
        this.announced = false;
    }

    castle() {
        for (const b of this.g.buildings) if (b.type === "castle" && b.active && b.hp > 0) return b;
        return null;
    }

    // Densest cluster of enemies inside the cannon's reach (x of its centre).
    _pick(c) {
        const cand = this.g.enemies.filter((e) => e.active && e.hp > 0 && e.x - c.x <= ORBITAL.range && !terrain.inTunnel(e.x));
        let best = null, bestN = 0;
        for (const e of cand) {
            let n = 0;
            for (const o of cand) if (Math.abs(o.x - e.x) < ORBITAL.radius) n += o.isBoss ? 4 : 1;
            if (n > bestN) { bestN = n; best = e; }
        }
        return best;
    }

    update(dt) {
        const g = this.g, c = this.castle();
        for (let i = this.beams.length - 1; i >= 0; i--) if ((this.beams[i].life -= dt) <= 0) this.beams.splice(i, 1);
        if (!c) { this.lock = null; return; }
        if (this.lock) {
            const L = this.lock;
            L.t += dt;
            // Track the target while painting it (the laser follows).
            if (L.tgt && L.tgt.active && L.tgt.hp > 0) L.x += (L.tgt.x - L.x) * Math.min(1, 0.2 * dt);
            if (L.t >= ORBITAL.charge) this._fire(L.x);
            return;
        }
        this.cd -= dt;
        if (this.cd > 0) return;
        const tgt = this._pick(c);
        if (!tgt) { this.cd = 10; return; }
        this.lock = { x: tgt.x, t: 0, tgt };
        g.audio.orbitalCharge();
        if (!this.announced) {
            this.announced = true;
            g.notify("🛰 Orbital cannon online: anything that nears the castle gets vaporized.");
        }
    }

    _fire(x) {
        const g = this.g;
        this.lock = null;
        this.cd = ORBITAL.cooldown;
        const gy = groundAt(x);
        const src = { dmgType: "magic", team: TEAMS.PLAYER, isUnit: false };
        for (const e of g.enemies.slice()) {
            if (!e.active || e.hp <= 0 || terrain.inTunnel(e.x) || Math.abs(e.x - x) > ORBITAL.radius) continue;
            dealDamage(ORBITAL.dmg * (e.isBoss ? ORBITAL.bossMult : 1), src, e);
            if (!e.isBoss) e.x += Math.sign(e.x - x || 1) * 18; // blast shove
        }
        this.beams.push({ x, life: 30 });
        // Impact: white-out flash, stacked shockwaves, molten sparks, a crater.
        g.fx.flash(x, gy - 40, { r: 190, col: "#e0f2fe", life: 18 });
        g.fx.ring(x, gy, { r0: 10, r1: ORBITAL.radius * 1.8, col: "#67e8f9", w: 6, life: 26 });
        g.fx.ring(x, gy, { r0: 6, r1: ORBITAL.radius * 1.1, col: "#ffffff", w: 3, life: 18 });
        g.fx.spark(x, gy - 6, -Math.PI / 2, { n: 18, spread: 1.4, len: 46, col: "#a5f3fc" });
        g.particles.emit(x, gy - 10, 40, "#67e8f9", 9, 4, "spark");
        g.particles.emit(x, gy - 20, 18, "#475569", 4, 7, "fade");
        for (let i = 0; i < 10; i++) g.particles.emit(x + (Math.random() - 0.5) * 60, gy - 4, 1, "#3f3f46", 7, 3.5, "debris");
        g.lights.add({ x, y: gy - 120, radius: 420, intensity: 2.4, color: "#a5f3fc", life: 22 });
        g.decals.add(x, gy, "scorch", ORBITAL.radius * 0.9);
        g.shake = Math.max(g.shake, 20);
        g.bossFlash = Math.max(g.bossFlash || 0, 0.3);
        if (g.cameraFX && g.cameraFX.impulse) g.cameraFX.impulse({ x: 0, y: 1, mag: 9 });
        g.audio.orbitalFire();
    }

    draw(ctx, cam) {
        const g = this.g, c = this.castle(), z = cam.z, f = g.frames;
        if (!c) return;
        // Uplink mast on the castle: pulses faster as the next strike nears.
        const mx = cam.sx(c.x + 40), my = cam.sy(c.y - c.h);
        const ready = this.lock ? 1 : 1 - Math.max(0, this.cd) / ORBITAL.cooldown;
        ctx.save();
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 3 * z;
        ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx, my - 46 * z); ctx.stroke();
        ctx.lineWidth = 2 * z;
        ctx.beginPath(); ctx.ellipse(mx, my - 40 * z, 14 * z, 5 * z, -0.4, 0, Math.PI * 2); ctx.stroke();
        const pulse = 0.5 + 0.5 * Math.sin(f * (0.08 + ready * 0.35));
        ctx.fillStyle = `rgba(103,232,249,${0.35 + 0.65 * pulse * ready})`;
        ctx.beginPath(); ctx.arc(mx, my - 48 * z, 4 * z, 0, Math.PI * 2); ctx.fill();

        ctx.globalCompositeOperation = "screen";
        // Targeting: a thin red laser from the sky and a closing reticle.
        if (this.lock) {
            const L = this.lock, k = L.t / ORBITAL.charge;
            const lx = cam.sx(L.x), ly = cam.sy(groundAt(L.x));
            ctx.strokeStyle = `rgba(248,113,113,${0.4 + 0.5 * k})`;
            ctx.lineWidth = (1 + k * 2) * z;
            ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, ly); ctx.stroke();
            const r = ORBITAL.radius * (1.5 - k * 0.5) * z;
            ctx.strokeStyle = `rgba(248,113,113,${0.5 + 0.4 * k})`;
            ctx.lineWidth = 2 * z;
            ctx.beginPath(); ctx.ellipse(lx, ly, r, r * 0.22, 0, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.ellipse(lx, ly, r * 0.35, r * 0.08, 0, 0, Math.PI * 2); ctx.stroke();
            for (const d of [-1, 1]) {
                ctx.beginPath(); ctx.moveTo(lx + d * r * 1.1, ly); ctx.lineTo(lx + d * r * 0.6, ly); ctx.stroke();
            }
        }
        // Strike: a blinding lance of light from orbit, collapsing inward.
        for (const b of this.beams) {
            const k = b.life / 30;
            const bx = cam.sx(b.x), by = cam.sy(groundAt(b.x));
            const wOuter = (70 * k + 10) * z, wCore = (22 * k + 3) * z;
            const grd = ctx.createLinearGradient(bx - wOuter, 0, bx + wOuter, 0);
            grd.addColorStop(0, "rgba(34,211,238,0)");
            grd.addColorStop(0.5, `rgba(103,232,249,${0.75 * k})`);
            grd.addColorStop(1, "rgba(34,211,238,0)");
            ctx.fillStyle = grd;
            ctx.fillRect(bx - wOuter, 0, wOuter * 2, by);
            ctx.fillStyle = `rgba(255,255,255,${0.95 * k})`;
            ctx.fillRect(bx - wCore / 2, 0, wCore, by);
            const glow = ctx.createRadialGradient(bx, by, 4, bx, by, 160 * z);
            glow.addColorStop(0, `rgba(236,254,255,${0.9 * k})`);
            glow.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = glow;
            ctx.fillRect(bx - 160 * z, by - 160 * z, 320 * z, 200 * z);
        }
        ctx.restore();
    }
}
