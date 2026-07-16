import { dealDamage } from './combat.js';
import { TEAMS } from '../config.js';
import { rand, randInt } from '../utils.js';
import { GFX } from './graphics.js';

// --- SINGULARITY: the Voidcaller's showcase ability ---------------------------
//
// A self-contained VFX-heavy entity. Lives directly on `game.singularities`
// (like particles/decals), updates + draws itself, and is filtered out by the
// game loop once `active` flips false. All durations are in dt-frames (the game
// clamps dt to 3 and normalizes everything to 60fps "frames").
//
// State machine:
//   form     (28)          rift tears open: core grows, accretion disk ignites,
//                          space-lensing rings expand. Light pull begins.
//   pull     (def.duration) full gravitational pull; energy tendrils lash out to
//                          grab nearby foes and reel them in; debris streams in.
//   collapse (26)          everything implodes: core shrinks, disk whitens and
//                          spins up, pull doubles, screen tightens.
//   detonate (1)           one-shot: white implosion flash -> expanding shock
//                          ring + violet ring + light pillar + AoE magic damage
//                          + heavy shake + chromatic aberration + particle nova.
//
// Reaches into the existing FX/post-FX stack: game.fx rings/flash, game.shake,
// game.chromaAberrationT (chromatic-aberration post pass), game.particles.

const FORM_LEN = 28;
const COLLAPSE_LEN = 26;
const TWO_PI = Math.PI * 2;

export class Singularity {
    /**
     * Auto-target: find the world-x that catches the MOST enemies within
     * `radius` (densest cluster). Returns null when there are no enemies.
     * @param {number} fallbackX preferred x if there are no enemies
     * @param {number} radius blast radius to score density over
     * @returns {number|null}
     */
    static pickTarget(fallbackX, radius) {
        const g = window.game;
        if (!g || !g.enemies || !g.enemies.length) return null;
        const alive = g.enemies.filter((e) => e.active && Number.isFinite(e.x));
        if (!alive.length) return null;
        // Score each enemy's x as a candidate center; pick the one whose window
        // [-radius,+radius] contains the most enemies (ties -> the weighted
        // centroid of that window, so the rift sits in the middle of the pack).
        let best = null, bestCount = -1, bestSum = 0;
        for (const c of alive) {
            let count = 0, sum = 0;
            for (const e of alive) {
                if (Math.abs(e.x - c.x) <= radius) { count++; sum += e.x; }
            }
            if (count > bestCount) { bestCount = count; best = c.x; bestSum = sum / count; }
        }
        return Number.isFinite(bestSum) ? bestSum : best;
    }

    /**
     * @param {number} x world x
     * @param {number} y world y (usually CONFIG.GROUND_Y)
     * @param {import('../data/heroes.js').HEROES['voidcaller']['ability']} def ability def
     */
    constructor(x, y, def) {
        this.x = x;
        this.y = y - 30;                 // float the rift slightly off the ground
        this.def = def;
        this.phase = "form";
        this.phaseT = 0;
        this.coreR = 0;
        this.maxCoreR = 34;
        this.ringR = def.radius * 0.72;
        this.rot = 0;
        this.spin = 0;                   // accretion-disk spin (accelerates)
        this.intensity = 0;             // 0..1 overall energy, drives brightness
        this.active = true;
        // A few persistent "arms" of the accretion spiral, seeded by index so
        // the look is stable frame-to-frame (no Math.random in the hot path).
        this.arms = 5;
    }

    /**
     * Pull every enemy inside `radius` toward the core, scaled by proximity.
     * @param {number} dt frame delta
     * @param {number} mult strength multiplier
     */
    _pull(dt, mult) {
        const g = window.game;
        if (!g || !g.enemies) return;
        const r = this.def.radius;
        for (let i = 0; i < g.enemies.length; i++) {
            const e = g.enemies[i];
            if (!e.active) continue;
            const dx = this.x - e.x;
            const dy = this.y - e.y;
            const d = Math.hypot(dx, dy) || 1;
            if (d > r) continue;
            const falloff = 1 - d / r;            // strongest near the core
            const pull = (1 + falloff * 3) * mult * dt;
            e.x += (dx / d) * pull;
            e.y += (dy / d) * pull * 0.4;
            // Tangential swirl so they spiral in rather than sliding straight —
            // reads as orbital motion around the well.
            const tang = falloff * mult * dt * 1.2;
            e.x += (-dy / d) * tang;
        }
    }

    /** @param {number} dt frame delta */
    update(dt) {
        if (!this.active) return;
        const g = window.game;
        this.phaseT += dt;
        this.rot += 0.05 * dt;
        this.spin += (0.18 + this.intensity * 0.4) * dt;

        if (this.phase === "form") {
            const t = Math.min(1, this.phaseT / FORM_LEN);
            const e = t * t * (3 - 2 * t);        // smoothstep
            this.coreR = this.maxCoreR * e;
            this.intensity = e;
            this._pull(dt, 0.4 * e);              // gentle early tug
            if (g && g.particles && this.phaseT % 2 < dt) {
                // Space tearing open: bright sparks spat outward from the seam.
                const a = rand(0, TWO_PI);
                g.particles.emit(
                    this.x + Math.cos(a) * this.coreR,
                    this.y + Math.sin(a) * this.coreR,
                    2, "#f5d0fe", 4, 2, "spark",
                );
            }
            if (this.phaseT >= FORM_LEN) { this.phase = "pull"; this.phaseT = 0; }
        } else if (this.phase === "pull") {
            this.coreR = this.maxCoreR;
            this.intensity = 1;
            this._pull(dt, 1);
            this._spawnAccretion(dt, g);
            if (this.phaseT >= this.def.duration) { this.phase = "collapse"; this.phaseT = 0; }
        } else if (this.phase === "collapse") {
            const t = Math.min(1, this.phaseT / COLLAPSE_LEN);
            this.coreR = this.maxCoreR * (1 - t * 0.9);
            this.ringR = this.def.radius * (0.72 - 0.55 * t);
            this.intensity = 1 + t * 1.5;         // over-bright as it winds up
            this._pull(dt, 2 + t * 3);            // yank everything in hard
            if (g && g.particles) {
                // Matter screaming into the core — dense white/violet inrush.
                for (let k = 0; k < 3; k++) {
                    const a = rand(0, TWO_PI);
                    const rr = this.def.radius * (0.5 + 0.5 * (1 - t));
                    g.particles.emit(
                        this.x + Math.cos(a) * rr,
                        this.y + Math.sin(a) * rr,
                        1, k ? "#ffffff" : "#e64bff", 5, 2, "spark",
                    );
                }
            }
            if (this.phaseT >= COLLAPSE_LEN) {
                this.phase = "detonate"; this.phaseT = 0; this._detonate();
            }
        } else if (this.phase === "detonate") {
            this.active = false;
        }
    }

    /** Streaming accretion debris + energy tendrils during the pull phase. */
    _spawnAccretion(dt, g) {
        if (!g || !g.particles) return;
        // Inward-streaming embers around the disk.
        const n = randInt(2, 3);
        for (let i = 0; i < n; i++) {
            const a = rand(0, TWO_PI);
            const rr = rand(this.def.radius * 0.35, this.def.radius);
            g.particles.emit(
                this.x + Math.cos(a) * rr,
                this.y + Math.sin(a) * rr,
                1, i % 2 ? "#e64bff" : "#a855f7", 2, 2, "spark",
            );
        }
        // Ambient motes drifting in from above.
        if (this.phaseT % 4 < dt) {
            g.particles.emit(
                this.x + rand(-this.def.radius, this.def.radius),
                this.y - rand(30, 150),
                1, "#c084fc", 1, 3, "float",
            );
        }
    }

    _detonate() {
        const g = window.game;
        if (!g) { this.active = false; return; }
        const def = this.def;
        const R = def.radius;
        if (g.fx) {
            // Implosion flash -> layered expanding shock.
            g.fx.flash(this.x, this.y, { r: R * 0.9, col: "#ffffff", life: 10 });
            g.fx.ring(this.x, this.y, { r0: 4, r1: R * 1.6, col: "#ffffff", w: 8, life: 22 });
            g.fx.ring(this.x, this.y, { r0: 10, r1: R * 1.9, col: "#e64bff", w: 5, life: 30 });
            g.fx.ring(this.x, this.y, { r0: 30, r1: R * 1.2, col: "#a855f7", w: 3, life: 20 });
            g.fx.flash(this.x, this.y, { r: R * 1.5, col: "#e64bff", life: 18 });
        }
        // AoE magic damage to every enemy in radius, scaled up near the core.
        const src = {
            dmgType: "magic", armorPierce: false, vsLarge: 0, vsFlying: 0,
            siege: false, team: TEAMS.PLAYER, isUnit: true,
        };
        if (g.enemies) {
            for (let i = 0; i < g.enemies.length; i++) {
                const e = g.enemies[i];
                if (!e.active) continue;
                const d = Math.hypot(this.x - e.x, this.y - e.y);
                if (d <= R) {
                    const mult = 1 + 0.6 * (1 - d / R);   // core hits harder
                    dealDamage(def.damage * mult, src, e);
                }
            }
        }
        g.shake = Math.max(g.shake || 0, 30);
        g.chromaAberrationT = 40;
        if (g.audio) { g.audio.playExplosion(); g.audio.playMagic(); }
        // Particle nova: fast outward blast + slow rising void embers.
        if (g.particles) {
            g.particles.emit(this.x, this.y, 60, "#ffffff", 12, 4, "spark");
            g.particles.emit(this.x, this.y, 50, "#e64bff", 9, 3, "spark");
            g.particles.emit(this.x, this.y, 30, "#a855f7", 5, 5, "float");
        }
    }

    // ---------------------------------------------------------------- drawing

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {import('./camera.js').Camera} cam
     */
    draw(ctx, cam) {
        if (!this.active) return;
        const px = cam.sx(this.x);
        const py = cam.sy(this.y);
        const z = cam.z;
        if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(z) || z <= 0) return;

        const def = this.def;
        const R = def.radius * z;
        const core = Math.max(0.5, this.coreR * z);
        const glow = Math.min(1.4, this.intensity);
        const t = this.spin;
        // GPU glow path: soft blooms → WebGL overlay (batched, no shadowBlur);
        // crisp line-art stays on Canvas 2D. shadowBlur only when no GL AND the
        // cinematic tier is active.
        const g = window.game;
        const gl = g && g.gl && g.gl.ok && GFX.webgl ? g.gl : null;
        const useShadow = !gl && GFX.shadows;
        const sxo = gl ? (g._shakeX || 0) : 0;
        const syo = gl ? (g._shakeY || 0) : 0;

        ctx.save();

        // 1) Gravity well haze — dim violet, deepest at the rim (light bending).
        ctx.globalCompositeOperation = "screen";
        if (gl) {
            gl.glow(px + sxo, py + syo, R * 1.05, 0.58, 0.2, 0.92, 0.28 * glow);
            gl.glow(px + sxo, py + syo, R * 0.8, 0.9, 0.29, 1.0, 0.22 * glow);
        } else {
            const well = ctx.createRadialGradient(px, py, core * 0.5, px, py, R);
            well.addColorStop(0, `rgba(88,28,135,${0.05 * glow})`);
            well.addColorStop(0.55, `rgba(147,51,234,${0.12 * glow})`);
            well.addColorStop(0.82, `rgba(230,75,255,${0.14 * glow})`);
            well.addColorStop(1, "rgba(147,51,234,0)");
            ctx.fillStyle = well;
            ctx.beginPath();
            ctx.arc(px, py, R, 0, TWO_PI);
            ctx.fill();
        }

        // 2) Space-warp shockwaves — faint rings pulsing OUTWARD from the core on
        //    a staggered cycle, so the whole field looks like rippling spacetime.
        ctx.lineWidth = 1.5 * z;
        for (let i = 0; i < 3; i++) {
            const phase = (t * 0.25 + i / 3) % 1;          // 0..1 expansion
            const rr = phase * R;
            const a = Math.max(0, (1 - phase) * 0.28 * glow);
            ctx.strokeStyle = `rgba(230,120,255,${a})`;
            ctx.beginPath();
            ctx.arc(px, py, Math.max(0, rr), 0, TWO_PI);
            ctx.stroke();
        }

        // 3) Lensing rings — thin bright circles that bend space around the core.
        ctx.lineWidth = 1 * z;
        for (let i = 0; i < 3; i++) {
            const rr = core * (1.6 + i * 0.9) + Math.sin(t * 0.6 + i) * 3 * z;
            const a = (0.22 - i * 0.06) * glow;
            ctx.strokeStyle = `rgba(240,171,252,${Math.max(0, a)})`;
            ctx.beginPath();
            ctx.arc(px, py, Math.max(0, rr), 0, TWO_PI);
            ctx.stroke();
        }

        // 3) Hot inner bloom — a bright core glow so the disk reads as blazing
        //    plasma against the black hole, not just line art.
        if (gl) {
            gl.glow(px + sxo, py + syo, core * 3.8, 1.0, 0.72, 1.0, 0.7 * Math.min(1, glow));
            gl.glow(px + sxo, py + syo, core * 1.8, 1.0, 0.95, 1.0, 0.6 * Math.min(1, glow));
        } else {
            const bloom = ctx.createRadialGradient(px, py, core * 0.6, px, py, core * 3.4);
            bloom.addColorStop(0, `rgba(255,230,255,${0.5 * Math.min(1, glow)})`);
            bloom.addColorStop(0.4, `rgba(240,120,255,${0.28 * glow})`);
            bloom.addColorStop(1, "rgba(168,85,247,0)");
            ctx.fillStyle = bloom;
            ctx.beginPath();
            ctx.arc(px, py, core * 3.4, 0, TWO_PI);
            ctx.fill();
        }

        // 4) Accretion disk — a spun-up swirl of arms as gradient strokes. This
        //    is the main "wow": hot plasma spiralling into the void. Arms vary in
        //    brightness/width and the whole disk foreshortens (ellipse) for a 3D
        //    "seen at an angle" read rather than a flat spirograph. shadowBlur
        //    only when no GPU overlay AND cinematic tier (else the GPU bloom +
        //    the gradient strokes carry the glow).
        if (useShadow) { ctx.shadowColor = "#e64bff"; ctx.shadowBlur = 24 * z * glow; }
        for (let arm = 0; arm < this.arms; arm++) {
            const base = t + (arm / this.arms) * TWO_PI;
            // Per-arm variation seeded by index (stable, no RNG in hot path).
            const bright = 0.55 + 0.45 * ((arm * 2 + 1) % this.arms) / this.arms;
            const turns = 2.1 + 0.5 * ((arm * 3) % 3) / 3;
            ctx.beginPath();
            const steps = 30;
            for (let sN = 0; sN <= steps; sN++) {
                const f = sN / steps;
                const ang = base + f * Math.PI * turns;
                const rad = core * 1.02 + f * (R * 0.64 - core);
                const wob = Math.sin(f * 11 + t * 2.4 + arm) * (2 + f * 2) * z;
                const x = px + Math.cos(ang) * (rad + wob);
                const y = py + Math.sin(ang) * (rad + wob) * 0.62;  // strong ellipse
                if (sN === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            const grd = ctx.createLinearGradient(px, py - core, px, py - R);
            grd.addColorStop(0, `rgba(255,255,255,${bright * glow})`);
            grd.addColorStop(0.35, `rgba(240,120,255,${0.75 * bright * glow})`);
            grd.addColorStop(1, "rgba(147,51,234,0)");
            ctx.strokeStyle = grd;
            ctx.lineWidth = (1.4 + bright * 1.8) * z;
            ctx.stroke();
        }
        if (useShadow) ctx.shadowBlur = 0;

        // 4) Inner ignition ring — bright rim right at the event horizon.
        ctx.strokeStyle = `rgba(255,235,255,${0.9 * Math.min(1, glow)})`;
        ctx.lineWidth = 2.2 * z;
        if (useShadow) { ctx.shadowColor = "#ffffff"; ctx.shadowBlur = 16 * z * glow; }
        ctx.beginPath();
        ctx.arc(px, py, core * 1.02, 0, TWO_PI);
        ctx.stroke();
        if (useShadow) ctx.shadowBlur = 0;

        // 5) Event horizon — pure black disc, over the glow (this is what makes
        //    the accretion disk pop: a true void hole in the middle).
        ctx.globalCompositeOperation = "source-over";
        const hole = ctx.createRadialGradient(px, py, 0, px, py, core);
        hole.addColorStop(0, "#000000");
        hole.addColorStop(0.75, "#000000");
        hole.addColorStop(1, "rgba(20,4,30,0.4)");
        ctx.fillStyle = hole;
        ctx.beginPath();
        ctx.arc(px, py, core, 0, TWO_PI);
        ctx.fill();

        // 6) Energy tendrils — reach from the core to nearby enemies, "grabbing"
        //    them. Sells the pull far better than particles alone.
        if (g && g.enemies && (this.phase === "pull" || this.phase === "collapse")) {
            ctx.globalCompositeOperation = "screen";
            ctx.lineWidth = 1.6 * z;
            if (useShadow) { ctx.shadowColor = "#e64bff"; ctx.shadowBlur = 8 * z; }
            let drawn = 0;
            for (let i = 0; i < g.enemies.length && drawn < 6; i++) {
                const e = g.enemies[i];
                if (!e.active) continue;
                const d = Math.hypot(this.x - e.x, this.y - e.y);
                if (d > def.radius) continue;
                drawn++;
                const ex = cam.sx(e.x), ey = cam.sy(e.y - 24);
                if (!Number.isFinite(ex) || !Number.isFinite(ey)) continue;
                // Jagged lightning-like tendril with a mid-point wobble.
                const mx = (px + ex) / 2 + Math.sin(t * 3 + i) * 10 * z;
                const my = (py + ey) / 2 + Math.cos(t * 3 + i) * 10 * z;
                const fade = 1 - d / def.radius;
                ctx.strokeStyle = `rgba(230,75,255,${0.35 + 0.4 * fade})`;
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.quadraticCurveTo(mx, my, ex, ey);
                ctx.stroke();
            }
            if (useShadow) ctx.shadowBlur = 0;
        }

        // 7) Photon jets — thin bright beams shooting from the poles, rotating.
        ctx.globalCompositeOperation = "screen";
        const jet = core * 3.2 * glow;
        ctx.strokeStyle = `rgba(245,208,254,${0.5 * Math.min(1, glow)})`;
        ctx.lineWidth = 1.4 * z;
        for (let s = -1; s <= 1; s += 2) {
            const ang = t * 0.4;
            ctx.beginPath();
            ctx.moveTo(px + Math.cos(ang) * core * s, py + Math.sin(ang) * core * s);
            ctx.lineTo(px + Math.cos(ang) * jet * s, py + Math.sin(ang) * jet * s);
            ctx.stroke();
        }

        ctx.restore();
    }
}
