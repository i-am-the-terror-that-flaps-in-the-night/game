import { CONFIG } from '../config.js';
import { dealDamage } from './combat.js';
import { groundAt, terrain } from './terrain.js';
import { clamp, lerp, rand, toRgba } from '../utils.js';

// --- ENVIRONMENTAL HAZARDS ---
// Each region can carry one signature hazard ({ type, every:[minS,maxS] } on
// its LEVELS entry). On a timer the HazardSystem picks a spot in the contested
// middle of the field, TELEGRAPHS it on the ground for TELEGRAPH frames, then
// strikes. Hazards are neutral — they hurt both armies (units, enemies, the
// hero) — but never buildings or the boss, so economy and boss balance are
// untouched. Damage is flat (no difficulty scaling): terrain is the same for
// everyone. Registry shape mirrors spell-behaviors.js:
//   HAZARD_TYPES[type] = { name, tip, col, linger, strike(g,h), tick?(g,h,dt),
//                          drawOver?(g,h,ctx,cam,k) }

const TELEGRAPH = 90; // frames of ground warning before a strike

// Neutral combat source: team null so no formation modifier applies either way.
const src = (dmgType) => ({ dmgType, team: null, isUnit: false });

// Everything a hazard may hurt: live ground-level fighters on both sides.
function victims(g, x, r, air = false) {
    const out = [];
    for (const list of [g.units, g.enemies])
        for (const e of list)
            if (e.active && e.hp > 0 && !e.isBoss && (air || !e.flying) && !terrain.inTunnel(e.x) && Math.abs(e.x - x) < r) out.push(e);
    return out;
}

export const HAZARD_TYPES = {
    // Rain maps: a bolt of lightning cracks down onto one spot.
    lightning: {
        name: "Lightning Storm", col: "#93c5fd", r: 60, linger: 26,
        tip: "Lightning strikes where the armies clash — watch for the crackling ground marks and pull back.",
        strike(g, h) {
            const gy = groundAt(h.x);
            for (const e of victims(g, h.x, this.r, true)) dealDamage(40, src("magic"), e, true);
            for (let i = 0; i < 3; i++)
                g.lightningArcs.push({ x1: h.x + rand(-60, 60), y1: gy - 720, x2: h.x + rand(-10, 10), y2: gy, life: 14 });
            g.fx.flash(h.x, gy - 20, { r: 90, col: "#e0f2fe", life: 12 });
            g.fx.ring(h.x, gy, { r0: 6, r1: this.r * 1.3, col: "#7dd3fc", w: 3, life: 18 });
            g.particles.emit(h.x, gy - 4, 16, "#bae6fd", 6, 3, "spark");
            g.lights.add({ x: h.x, y: gy - 60, radius: 260, intensity: 1.8, color: "#bfdbfe", life: 14 });
            g.decals.add(h.x, gy, "scorch", 46);
            g.shake = Math.max(g.shake, 9);
            g.bossFlash = Math.max(g.bossFlash || 0, 0.18); // brief sky-flash
            g.audio.thunder();
        },
    },

    // Hill maps: boulders break off a crest and roll down both faces.
    rockslide: {
        name: "Rockslide", col: "#d6b98c", r: 26, linger: 200,
        tip: "Boulders tumble down the hillsides — don't park your army at the foot of a slope.",
        strike(g, h) {
            h.rocks = [];
            for (const dir of [-1, 1])
                for (let i = 0; i < 2; i++)
                    h.rocks.push({ x: h.x + dir * rand(4, 30), vx: dir * rand(0.8, 1.6), rot: 0, sz: rand(11, 16), hit: new Set(), live: true });
            g.particles.emit(h.x, groundAt(h.x) - 6, 18, "#8b7355", 5, 4, "fade");
            g.shake = Math.max(g.shake, 7);
            g.audio.rumble();
        },
        tick(g, h, dt) {
            for (const r of h.rocks) {
                if (!r.live) continue;
                // Gravity along the slope: accelerate downhill, bleed speed on flats.
                const s = terrain.slopeAt(r.x);
                r.vx = clamp(r.vx - s * 0.35 * dt, -7, 7) * Math.pow(Math.abs(s) < 0.02 ? 0.97 : 0.992, dt);
                r.x += r.vx * dt;
                r.rot += (r.vx / r.sz) * dt;
                if (Math.floor(h.age) % 4 === 0)
                    g.particles.emit(r.x, groundAt(r.x) - 2, 1, "#8b7355", 1.5, 3, "fade");
                for (const e of victims(g, r.x, r.sz + 12)) {
                    if (r.hit.has(e)) continue;
                    r.hit.add(e);
                    dealDamage(35, src("blunt"), e, true);
                    g.fx.flash(e.x, e.y - 20, { r: 22, col: "#fde68a", life: 8 });
                }
                // Stalled out (or left the field): shatter.
                if (Math.abs(r.vx) < 0.35 || r.x < 60 || r.x > CONFIG.WORLD_WIDTH - 60) {
                    r.live = false;
                    const gy = groundAt(r.x);
                    for (let i = 0; i < 6; i++) g.particles.emit(r.x, gy - r.sz, 1, "#6b5a44", 4, rand(2, 4), "debris");
                    g.particles.emit(r.x, gy - 4, 8, "#a8a29e", 3, 4, "fade");
                    g.shake = Math.max(g.shake, 3);
                }
            }
        },
        drawOver(g, h, ctx, cam) {
            if (!h.rocks) return;
            for (const r of h.rocks) {
                if (!r.live) continue;
                const p = cam.toScreen(r.x, groundAt(r.x) - r.sz);
                const s = r.sz * cam.z;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(r.rot);
                ctx.fillStyle = "#57534e";
                ctx.strokeStyle = "#1c1917";
                ctx.lineWidth = 2 * cam.z;
                ctx.beginPath();
                for (let i = 0; i < 7; i++) {
                    const a = (i / 7) * Math.PI * 2;
                    const rr = s * (0.82 + ((i * 37) % 5) * 0.06);
                    if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
                    else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = "rgba(255,255,255,0.12)";
                ctx.beginPath(); ctx.arc(-s * 0.3, -s * 0.3, s * 0.35, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
            }
        },
    },

    // Snow maps: a howling whiteout that bogs down anyone caught inside.
    whiteout: {
        name: "Whiteout", col: "#e2e8f0", r: 110, linger: 360,
        tip: "Whiteouts freeze the ground — anything caught inside slows to a crawl and takes frostbite.",
        strike(g, h) {
            terrain.addZone(h.x - this.r, h.x + this.r, 0.6, this.linger, "whiteout");
            g.particles.emit(h.x, groundAt(h.x) - 30, 24, "#f1f5f9", 5, 5, "float");
            g.fx.ring(h.x, groundAt(h.x), { r0: 10, r1: this.r, col: "#e0f2fe", w: 3, life: 22 });
            g.audio.gust();
        },
        tick(g, h, dt) {
            h.frostT = (h.frostT || 0) - dt;
            if (h.frostT <= 0) {
                h.frostT = 60;
                for (const e of victims(g, h.x, this.r)) dealDamage(8, src("magic"), e, true);
            }
            if (Math.floor(h.age) % 3 === 0)
                g.particles.emit(h.x + rand(-this.r, this.r), groundAt(h.x) - rand(10, 90), 1, "#f8fafc", 2.5, 3, "float");
        },
        drawOver(g, h, ctx, cam, k) {
            // A soft dome of blowing snow hugging the ground (fades in and out).
            const gy = cam.sy(groundAt(h.x)), px = cam.sx(h.x);
            const a = 0.34 * Math.min(1, k * 4) * Math.min(1, (1 - k) * 5);
            const r = this.r * 1.25 * cam.z;
            ctx.save();
            ctx.translate(px, gy);
            ctx.scale(1, 0.6);
            const grd = ctx.createRadialGradient(0, 0, r * 0.15, 0, 0, r);
            grd.addColorStop(0, `rgba(241,245,249,${a})`);
            grd.addColorStop(0.6, `rgba(226,232,240,${a * 0.6})`);
            grd.addColorStop(1, "rgba(226,232,240,0)");
            ctx.fillStyle = grd;
            ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
            // Wind streaks raking through it.
            ctx.strokeStyle = `rgba(248,250,252,${a * 1.4})`;
            ctx.lineWidth = 1.5 * cam.z;
            for (let i = 0; i < 6; i++) {
                const sx = ((h.age * 9 + i * 71) % (2 * r)) - r;
                const sy = -((i * 37) % 70 + 10) * cam.z;
                ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 26 * cam.z, sy + 3 * cam.z); ctx.stroke();
            }
            ctx.restore();
        },
    },

    // Volcanic maps: fissure vents erupt in a column of fire.
    fireVent: {
        name: "Fire Vents", col: "#f97316", r: 50, linger: 40,
        tip: "The ground here is molten — fire vents erupt without mercy. Keep troops off the glowing cracks.",
        strike(g, h) {
            const gy = groundAt(h.x);
            for (const e of victims(g, h.x, this.r, true)) dealDamage(45, src("magic"), e, true);
            g.fx.flash(h.x, gy - 40, { r: 80, col: "#fdba74", life: 14 });
            g.fx.ring(h.x, gy, { r0: 6, r1: this.r * 1.4, col: "#f97316", w: 4, life: 18 });
            g.particles.emit(h.x, gy - 6, 26, "#f97316", 7, 4, "spark");
            g.particles.emit(h.x, gy - 20, 12, "#57534e", 3, 6, "fade");
            g.lights.add({ x: h.x, y: gy - 70, radius: 200, intensity: 1.6, color: "#fb923c", flicker: 0.3, life: 30 });
            g.decals.add(h.x, gy, "scorch", 60);
            g.shake = Math.max(g.shake, 8);
            g.audio.ventRoar();
        },
        drawOver(g, h, ctx, cam, k) {
            // The eruption column: tall, flickering, collapsing as it ends.
            const gy = cam.sy(groundAt(h.x)), px = cam.sx(h.x);
            const hgt = (220 + Math.sin(h.age * 0.8) * 20) * (1 - k * 0.6) * cam.z;
            const wid = (22 + Math.sin(h.age * 1.3) * 5) * cam.z;
            ctx.save();
            ctx.globalCompositeOperation = "screen";
            ctx.globalAlpha = 1 - k;
            const grd = ctx.createLinearGradient(0, gy - hgt, 0, gy);
            grd.addColorStop(0, "rgba(251,146,60,0)");
            grd.addColorStop(0.5, "rgba(249,115,22,0.75)");
            grd.addColorStop(1, "rgba(254,240,138,0.95)");
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.moveTo(px - wid, gy);
            ctx.quadraticCurveTo(px - wid * 0.4, gy - hgt * 0.6, px, gy - hgt);
            ctx.quadraticCurveTo(px + wid * 0.4, gy - hgt * 0.6, px + wid, gy);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        },
    },
};

export class HazardSystem {
    constructor(g) {
        this.g = g;
        this.spec = null;
        this.list = [];
        this.t = 0;
        this.warned = false;
    }

    // spec: { type, every:[minS,maxS], vents?:[x] } or null for none.
    set(spec) {
        this.spec = spec && HAZARD_TYPES[spec.type] ? spec : null;
        this.clear();
        this.warned = false;
        if (this.spec) this.t = this._interval() * 0.6; // first one comes a bit sooner
    }

    clear() {
        this.list.length = 0;
        terrain.zones.length = 0;
    }

    def() { return this.spec ? HAZARD_TYPES[this.spec.type] : null; }

    _interval() {
        const [a, b] = this.spec.every || [25, 40];
        return rand(a, b) * 60;
    }

    // A spot in the contested middle: between the two fronts, clear of the castle.
    _pickX() {
        const g = this.g;
        let pf = 400, ef = CONFIG.WORLD_WIDTH - 400;
        for (const u of g.units) if (u.active && u !== g.hero) pf = Math.max(pf, u.x);
        let any = false;
        for (const e of g.enemies) if (e.active && !e.isBoss) { ef = any ? Math.min(ef, e.x) : e.x; any = true; }
        if (ef < pf) ef = pf + 200;
        ef = Math.min(ef, pf + 1600); // long map: strike where the fighting is
        let x = lerp(pf, ef, rand(0.2, 0.8));
        if (this.spec.type === "rockslide" && terrain.hills.length)
            x = terrain.hills.reduce((b, h) => (Math.abs(h.x - x) < Math.abs(b.x - x) ? h : b)).x;
        else if (this.spec.vents && this.spec.vents.length)
            x = this.spec.vents.reduce((b, v) => (Math.abs(v - x) < Math.abs(b - x) ? v : b));
        return clamp(x, 620, CONFIG.WORLD_WIDTH - 200);
    }

    // Queue a hazard (at x, or a picked spot). Returns the hazard record.
    trigger(x) {
        const d = this.def();
        if (!d) return null;
        const h = { type: this.spec.type, x: x != null ? x : this._pickX(), age: 0, struck: false };
        this.list.push(h);
        this.g.audio.hazardWarn();
        if (!this.warned) {
            this.warned = true;
            this.g.notify(`⚠ ${d.name}! ${d.tip}`);
        }
        return h;
    }

    update(dt) {
        if (!this.spec) return;
        this.t -= dt;
        if (this.t <= 0) {
            this.trigger();
            this.t = this._interval();
        }
        for (let i = this.list.length - 1; i >= 0; i--) {
            const h = this.list[i], d = HAZARD_TYPES[h.type];
            h.age += dt;
            if (!h.struck && h.age >= TELEGRAPH) {
                h.struck = true;
                h.age = TELEGRAPH;
                d.strike(this.g, h);
            } else if (h.struck && d.tick) d.tick(this.g, h, dt);
            if (h.struck && h.age >= TELEGRAPH + d.linger) this.list.splice(i, 1);
        }
    }

    // Ground telegraph: a pulsing marker that tightens as the strike nears.
    drawUnder(ctx, cam) {
        for (const h of this.list) {
            if (h.struck) continue;
            const d = HAZARD_TYPES[h.type];
            const k = h.age / TELEGRAPH;
            const p = cam.toScreen(h.x, groundAt(h.x));
            const r = d.r * cam.z;
            const pulse = 0.5 + 0.5 * Math.sin(h.age * (0.2 + k * 0.5));
            ctx.save();
            // Faint column of light marking the danger from afar.
            ctx.globalCompositeOperation = "screen";
            const colH = 260 * cam.z;
            const cg = ctx.createLinearGradient(0, p.y - colH, 0, p.y);
            cg.addColorStop(0, toRgba(d.col, 0));
            cg.addColorStop(1, toRgba(d.col, (0.1 + 0.22 * k) * (0.7 + 0.3 * pulse)));
            ctx.fillStyle = cg;
            ctx.fillRect(p.x - r * 0.55, p.y - colH, r * 1.1, colH);
            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = 0.45 + 0.5 * k;
            ctx.fillStyle = toRgba(d.col, 0.16 + pulse * 0.22);
            ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.2, 0, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = d.col;
            ctx.lineWidth = 2.5 * cam.z;
            ctx.setLineDash([8 * cam.z, 6 * cam.z]);
            ctx.lineDashOffset = -h.age * 1.5;
            ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.2, 0, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]);
            // Inner ring closing in on the impact point.
            const ir = r * (1 - k * 0.85);
            ctx.globalAlpha = 0.4 + 0.5 * k;
            ctx.beginPath(); ctx.ellipse(p.x, p.y, ir, ir * 0.2, 0, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
            // Warning sparks/crackle as it builds.
            if (Math.floor(h.age) % 7 === 0 && k > 0.3)
                this.g.particles.emit(h.x + rand(-d.r, d.r) * 0.7, groundAt(h.x) - 3, 1, d.col, 2, 2, "spark");
        }
    }

    // Strike visuals drawn above the armies.
    drawOver(ctx, cam) {
        for (const h of this.list) {
            if (!h.struck) continue;
            const d = HAZARD_TYPES[h.type];
            if (d.drawOver) d.drawOver(this.g, h, ctx, cam, (h.age - TELEGRAPH) / d.linger);
        }
    }

    // Is a hazard pending/live at world x? (tooltip + minimap)
    at(x) {
        for (const h of this.list) if (Math.abs(h.x - x) < HAZARD_TYPES[h.type].r + 20) return h;
        return null;
    }
}
