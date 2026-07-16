import { Unit } from './unit.js';
import { TEAMS } from '../config.js';
import { HEROES } from '../data/heroes.js';
import { Singularity } from '../systems/void.js';
import { GFX } from '../systems/graphics.js';

// --- HERO: a persistent, respawning player unit with an active ability --------
//
// Hero reuses everything about Unit — walking, targeting, ranged attacks, the
// stickman renderer (inherited via the Object.assign patch in unit-render.js).
// It reads its stats from HEROES[type] instead of UNIT_TYPES, and layers on an
// ability + respawn timer. Additive only: no existing unit behavior changes.
//
// The Voidcaller is an offensive bruiser: fast, tanky, hits hard with splashing
// void-bolts, and fuels his Singularity with Void Charge built from combat —
// no economy tax. He is never defenseless: his basic attack is a real threat
// while the meter fills.

/** Convert wall-clock ms to dt-frames (game normalizes to 60fps). */
const msToFrames = (ms) => ms / (1000 / 60);

export class Hero extends Unit {
    /**
     * @param {number} x world x
     * @param {string} type key into HEROES
     */
    constructor(x, type) {
        // Bootstrap through Unit's constructor with a valid UNIT_TYPES key so
        // its `def` lookup succeeds, then overwrite every stat from HEROES.
        super(x, "militia", TEAMS.PLAYER);

        const def = HEROES[type];
        this.type = type;
        this.isHero = true;

        this.name = def.name;
        this.maxHp = def.hp;
        this.hp = this.maxHp;
        this.dmg = def.dmg;
        this.range = def.range;
        this.speed = def.speed;
        this.cd = def.cooldown;
        this.armor = def.armor || 0;
        this.dmgType = def.dmgType || "slash";
        this.armorClass = def.armorClass || "none";
        this.ranged = def.ranged;
        this.proj = def.projectile;      // field is `proj`, source key `projectile`
        this.aoe = def.aoe || 0;         // splashing void-bolts
        this.pierce = def.pierce || 0;
        this.pop = def.pop || 0;
        this.col = def.color;             // field is `col`, source key `color`
        this.vis = def.visual;           // field is `vis`, source key `visual`
        this.scale = def.scale || 1;

        // Ability + Void Charge state.
        this.abilityDef = def.ability;
        this.voidCharge = 0;                 // 0..abilityDef.charge (the cast meter)
        this.maxCharge = def.ability.charge || 100;
        this.abilityCd = 0;              // kept for compatibility; charge is the gate
        this.respawnMs = def.respawnMs || 60000;
        this.respawnFrames = 0;
        this.spawnX = x;
    }

    /** @param {number} dt frame delta */
    update(dt) {
        super.update(dt);
        if (this.abilityCd > 0) this.abilityCd = Math.max(0, this.abilityCd - dt);
    }

    /**
     * Basic attack. Fires the void-bolt via Unit's ranged path, then builds Void
     * Charge from the hit — more for each extra enemy caught in the splash — and
     * paints a small space-tear so his attacks read as void magic.
     * @param {any} tgt target entity
     */
    attack(tgt) {
        super.attack(tgt);
        const def = this.abilityDef;
        if (!def) return;
        // Count enemies within the splash radius of the target for bonus charge.
        let splashed = 0;
        const g = window.game;
        if (this.aoe && g && g.enemies) {
            for (let i = 0; i < g.enemies.length; i++) {
                const e = g.enemies[i];
                if (e.active && Math.hypot(e.x - tgt.x, e.y - tgt.y) <= this.aoe) splashed++;
            }
        }
        const extra = Math.max(0, splashed - 1);
        const gain = (def.chargePerHit || 9) + (this._chargeBonusPerHit || 0)
            + extra * (def.chargePerSplash || 4);
        this.voidCharge = Math.min(this.maxCharge, this.voidCharge + gain);
        // Void-bolt cast FX: a bright muzzle flash + a fast expanding rip ring +
        // a spray of magenta embers thrown toward the target. Reads as tearing a
        // hole in space rather than lobbing a fireball.
        const mx = this.x + this.facing * 20 * this.scale;
        const my = this.y - 42 * this.scale;
        if (g && g.fx) {
            g.fx.flash(mx, my, { r: 13 * this.scale, col: "#f0abfc", life: 7 });
            g.fx.ring(mx, my, { r0: 2, r1: 20 * this.scale, col: "#e64bff", w: 2, life: 10 });
        }
        if (g && g.particles) {
            g.particles.emit(mx, my, 5, "#e64bff", 4, 2, "spark");
            g.particles.emit(mx, my, 3, "#c084fc", 2, 2, "float");
        }
        // Space-tear on the impact point too — a rip where the bolt lands.
        if (g && g.fx && tgt) {
            g.fx.ring(tgt.x, tgt.y - 20, { r0: 4, r1: 26, col: "#a855f7", w: 2, life: 12 });
        }
    }

    /** Whether Singularity can be cast right now (meter full, alive). */
    canCast() {
        return this.active && this.abilityDef && this.voidCharge >= this.maxCharge;
    }

    /**
     * Cast the hero's active ability toward a world x.
     * @param {number} worldX target x in world space
     * @returns {boolean} whether the cast fired
     */
    castAbility(worldX) {
        const g = window.game;
        const def = this.abilityDef;
        if (!def || !this.active) return false;
        if (this.voidCharge < this.maxCharge) {
            if (g && g.audio) g.audio.playError();
            return false;
        }
        // A hero ability should be SMART: auto-lock onto the densest enemy
        // cluster rather than wherever the cursor happens to be, so the rift
        // reliably lands on enemies. Fall back to the passed worldX (or the
        // hero's front) only when there are no enemies to target.
        const target = Singularity.pickTarget(this.x + this.facing * 160, def.radius);
        const tx = Number.isFinite(target) ? target
            : Number.isFinite(worldX) ? worldX
            : this.x + this.facing * 200;
        this.voidCharge = 0;                 // spend the whole meter
        // Hero already sits on CONFIG.GROUND_Y, so this.y is the ground line.
        g.singularities.push(new Singularity(tx, this.y, def));
        if (g.audio) g.audio.playMagic();
        return true;
    }

    /**
     * Layered void presence around the hero so he reads as an arcane threat, not
     * a recolored stickman: a rotating rune sigil on the ground, a dark-matter
     * body haze, orbiting shards, and rising energy wisps — all intensifying as
     * Void Charge fills (a readable "about to pop" tell). The normal stickman is
     * drawn on top via the inherited Unit renderer.
     * @param {CanvasRenderingContext2D} ctx
     * @param {any} cam
     * @param {number} dt
     */
    draw(ctx, cam, dt) {
        const TWO_PI = Math.PI * 2;
        const px = cam.sx(this.x);
        const py = cam.sy(this.y);
        const z = cam.z;
        const ok = this.active && Number.isFinite(px) && Number.isFinite(py)
            && Number.isFinite(z) && z > 0;
        const cf = this.voidCharge / (this.maxCharge || 100);   // 0..1
        const t = (window.game ? window.game.frames : 0) * 0.04;
        const s = this.scale * z;
        const g = window.game;
        // GPU glow path: soft blooms go to the WebGL overlay (one batched draw,
        // no shadowBlur). The crisp line-art stays on Canvas 2D. When WebGL is
        // off, shadowBlur is used ONLY on the cinematic tier (GFX.shadows) —
        // lower tiers get the flat line-art, which is what the perf tiers want.
        const gl = ok && g && g.gl && g.gl.ok && GFX.webgl ? g.gl : null;
        const useShadow = !gl && GFX.shadows;
        const sxo = gl ? (g._shakeX || 0) : 0;
        const syo = gl ? (g._shakeY || 0) : 0;

        // ── BEHIND the figure: ground sigil + body glow silhouette ──────────
        if (ok) {
            // Body glow: GPU sprite, or a radial gradient on Canvas 2D.
            const ba = 0.16 + 0.34 * cf;
            if (gl) {
                gl.glow(px + sxo, py - 34 * z + syo, 46 * s, 0.78, 0.5, 1.0, ba * 1.3);
                gl.glow(px + sxo, py - 24 * z + syo, 30 * s, 0.6, 0.3, 0.85, ba);
            } else {
                ctx.save();
                ctx.globalCompositeOperation = "screen";
                const bg = ctx.createRadialGradient(px, py - 34 * z, 0, px, py - 34 * z, 34 * s);
                bg.addColorStop(0, `rgba(200,130,255,${ba})`);
                bg.addColorStop(0.55, `rgba(130,50,190,${ba * 0.55})`);
                bg.addColorStop(1, "rgba(130,50,190,0)");
                ctx.fillStyle = bg;
                ctx.beginPath();
                ctx.ellipse(px, py - 34 * z, 24 * s, 40 * s, 0, 0, TWO_PI);
                ctx.fill();
                ctx.restore();
            }

            // Ground sigil line-art (crisp; no shadowBlur unless cinematic).
            ctx.save();
            ctx.globalCompositeOperation = "screen";
            const sigilR = (32 + cf * 10) * s;
            ctx.translate(px, py - 4 * z);
            ctx.scale(1, 0.4);
            const spin = t * (1 + cf * 2);
            if (useShadow) { ctx.shadowColor = "#e64bff"; ctx.shadowBlur = (6 + cf * 10) * z; }
            const ringOf = (rr, rot, spokes, alpha) => {
                ctx.strokeStyle = `rgba(230,75,255,${alpha})`;
                ctx.lineWidth = 1.4 * z;
                ctx.beginPath();
                ctx.arc(0, 0, rr, 0, TWO_PI);
                ctx.stroke();
                for (let i = 0; i < spokes; i++) {
                    const a = rot + (i / spokes) * TWO_PI;
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(a) * rr * 0.74, Math.sin(a) * rr * 0.74);
                    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
                    ctx.stroke();
                }
            };
            ringOf(sigilR, spin, 8, 0.28 + 0.45 * cf);
            ringOf(sigilR * 0.64, -spin * 1.5, 6, 0.22 + 0.4 * cf);
            ctx.strokeStyle = `rgba(245,208,254,${0.4 + 0.4 * cf})`;
            ctx.lineWidth = 1 * z;
            for (let i = 0; i < 24; i++) {
                const a = -spin * 0.5 + (i / 24) * TWO_PI;
                const r0 = sigilR * 0.82, r1 = sigilR * 0.9;
                ctx.beginPath();
                ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
                ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
                ctx.stroke();
            }
            if (useShadow) ctx.shadowBlur = 0;
            ctx.restore();
        }

        // ── The stickman himself, inside the aura ───────────────────────────
        Unit.prototype.draw.call(this, ctx, cam, dt);

        // ── IN FRONT: orbiting shards w/ trails, wisps, near-full flare ──────
        if (ok) {
            ctx.save();
            ctx.globalCompositeOperation = "screen";

            const shards = 3 + Math.round(cf * 3);
            if (useShadow) { ctx.shadowColor = "#e64bff"; ctx.shadowBlur = 10 * z; }
            for (let i = 0; i < shards; i++) {
                const a = t * (1.2 + cf) + (i / shards) * TWO_PI;
                const rr = (24 + Math.sin(t * 1.6 + i) * 4) * s;
                const cx = px + Math.cos(a) * rr;
                const cy = py - 32 * z + Math.sin(a) * rr * 0.4;
                const ta = a - 0.35;
                const tx = px + Math.cos(ta) * rr;
                const ty = py - 32 * z + Math.sin(ta) * rr * 0.4;
                ctx.strokeStyle = `rgba(230,75,255,${0.3 + 0.3 * cf})`;
                ctx.lineWidth = 1.2 * z;
                ctx.beginPath();
                ctx.moveTo(tx, ty);
                ctx.lineTo(cx, cy);
                ctx.stroke();
                const sz = (1.8 + cf * 1.2) * z;
                ctx.fillStyle = `rgba(245,208,254,${0.7 + 0.3 * cf})`;
                ctx.beginPath();
                ctx.moveTo(cx, cy - sz);
                ctx.lineTo(cx + sz, cy);
                ctx.lineTo(cx, cy + sz);
                ctx.lineTo(cx - sz, cy);
                ctx.closePath();
                ctx.fill();
                // GPU bloom behind each shard.
                if (gl) gl.glow(cx + sxo, cy + syo, sz * 4, 0.9, 0.6, 1.0, 0.4 + 0.3 * cf);
            }
            if (useShadow) ctx.shadowBlur = 0;

            // Rising energy wisps off the shoulders (crisp line-art).
            ctx.strokeStyle = `rgba(230,75,255,${0.3 + 0.4 * cf})`;
            ctx.lineWidth = 1.3 * z;
            for (let i = 0; i < 3; i++) {
                const phase = t * 2 + i * 2.1;
                const baseX = px + (i - 1) * 8 * s;
                ctx.beginPath();
                ctx.moveTo(baseX, py - 20 * z);
                for (let k = 1; k <= 4; k++) {
                    const yy = py - (20 + k * 12) * z;
                    const xx = baseX + Math.sin(phase + k * 0.9) * (3 + k) * z;
                    ctx.lineTo(xx, yy);
                }
                ctx.stroke();
            }

            // At/near full charge: bright pulsing crown + upward light column.
            if (cf > 0.85) {
                const pulse = 0.5 + 0.5 * Math.sin(t * 6);
                const readyA = (cf - 0.85) / 0.15;
                if (gl) {
                    gl.glow(px + sxo, py - 56 * z + syo, (22 + pulse * 8) * s,
                        1.0, 0.92, 1.0, (0.4 + 0.4 * pulse) * readyA);
                    // fake the column with a few stacked glows
                    for (let k = 0; k < 4; k++) {
                        gl.glow(px + sxo, py - (30 + k * 26) * z + syo, 10 * s,
                            0.9, 0.3, 1.0, 0.18 * readyA * (1 - k / 4));
                    }
                } else {
                    ctx.strokeStyle = `rgba(255,235,255,${(0.4 + 0.5 * pulse) * readyA})`;
                    if (useShadow) { ctx.shadowColor = "#ffffff"; ctx.shadowBlur = 14 * z; }
                    ctx.lineWidth = 1.6 * z;
                    ctx.beginPath();
                    ctx.arc(px, py - 56 * z, (9 + pulse * 3) * s, 0, TWO_PI);
                    ctx.stroke();
                    const col = ctx.createLinearGradient(px, py, px, py - 120 * z);
                    col.addColorStop(0, `rgba(230,75,255,${0.28 * readyA})`);
                    col.addColorStop(1, "rgba(230,75,255,0)");
                    ctx.fillStyle = col;
                    ctx.fillRect(px - 6 * s, py - 120 * z, 12 * s, 120 * z);
                    if (useShadow) ctx.shadowBlur = 0;
                }
            }
            ctx.restore();
        }
    }

    die() {
        super.die();
        this.respawnFrames = msToFrames(this.respawnMs);
        this.active = false;
    }
}
