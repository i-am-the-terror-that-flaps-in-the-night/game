import { dealDamage } from './combat.js';
import { CONFIG, NECRO_MINION_TYPE, PROJ_CULL_MARGIN, PROJ_HIT_RADIUS, TEAMS } from '../config.js';
import { PROJECTILE_TYPES } from '../data/projectiles.js';
import { dist, rand, shade } from '../utils.js';
import { GFX } from './graphics.js';
import { GLRenderer } from './gl-renderer.js';
import { groundAt } from './terrain.js';

// --- PROJECTILES & MAGIC ---
export class Projectile {
    constructor(x, y, target, type, dmg, team, aoe, pierce, siege, opts) {
        this.x = x;
        this.y = y;
        this.t = target;
        this.type = type;
        this.dmg = dmg;
        this.team = team;
        this.active = true;
        this.trail = [];
        const def = PROJECTILE_TYPES[type];
        // Combat-resolution source info (counter system)
        const o = opts || {};
        this.src = {
            dmgType: o.dmgType || def.defaultDmgType,
            armorPierce: o.armorPierce || false,
            vsLarge: o.vsLarge || 0,
            vsFlying: o.vsFlying || 0,
            siege: siege || false,
            team: team,
            isUnit: o.isUnit || false,
            fromY: o.fromY,
        };

        this.tX = target.x;
        this.tY = target.y; // Fix #5: Cache coords

        this.sp = def.sp;
        this.col = def.c;
        this.sz = def.sz;
        this.aoe = aoe || def.aoe || 0;
        this.pierce = pierce || 0;
        this.siege = siege || false;
        this.arc = def.arc;
        this.glow = def.glow;
        this.summon = def.summon;

        const a = Math.atan2(this.tY - y, this.tX - x);
        this.vx = Math.cos(a) * this.sp;
        this.vy = Math.sin(a) * this.sp;
        this.startY = y;
        this.arcH = this.arc ? rand(50, 100) : 0;
        this.arcP = 0;
    }
    update(dt) {
        if (!this.active) return;

        if (this.t && this.t.hp > 0) {
            this.tX = this.t.x;
            this.tY = this.t.y;
        } // Update if alive

        this.x += this.vx * dt;
        if (this.arc) {
            this.arcP +=
                (this.sp * dt) /
                dist(
                    0,
                    0,
                    this.tX - this.x,
                    this.tY - this.y + 0.1,
                );
            this.y =
                this.startY -
                Math.sin(Math.min(1, this.arcP) * Math.PI) *
                    this.arcH +
                (this.tY - this.startY) * this.arcP;

            // Only the descending half can strike the ground, so a lob launched
            // from a slope doesn't clip the hillside it starts on.
            if (this.arcP >= 1 || (this.arcP > 0.5 && this.y >= groundAt(this.x))) {
                // Fix #2: Hit properly
                if (this.t && this.t.hp > 0 && !this.aoe)
                    this.hit(this.t);
                else this.hitFloor();
            }
        } else {
            this.y += this.vy * dt;
            if (this.y > groundAt(this.x) + 4) this.hitFloor();
        }

        // Distance-sampled history (not per-frame): appends only after moving a
        // minimum distance, so trail length is independent of frame rate / game
        // speed and a slow/stationary shot can't pile zero-length points on one
        // spot (which would give the GPU ribbon NaN normals).
        const last = this.trail.length ? this.trail[this.trail.length - 1] : null;
        if (!last || Math.hypot(this.x - last.x, this.y - last.y) >= 6) {
            this.trail.push({ x: this.x, y: this.y });
            const maxPts = this.glow ? 16 : 5;
            if (this.trail.length > maxPts) this.trail.shift();
        }

        if (
            !this.arc &&
            this.t &&
            this.t.hp > 0 &&
            dist(this.x, this.y, this.tX, this.tY) < PROJ_HIT_RADIUS
        )
            this.hit(this.t);
        if (this.x < -PROJ_CULL_MARGIN || this.x > CONFIG.WORLD_WIDTH + PROJ_CULL_MARGIN)
            this.active = false;
    }
    hitFloor() {
        this.y = groundAt(this.x);
        if (this.aoe) this.explode();
        else {
            this.active = false;
            game.particles.emit(
                this.x,
                this.y,
                5,
                "#64748b",
                2,
                2,
                "fade",
            );
        }
    }
    hit(target) {
        this.active = false;
        if (this.summon && this.team === TEAMS.ENEMY) {
            game.spawnEnemy(NECRO_MINION_TYPE, this.x, groundAt(this.x));
            game.particles.emit(
                this.x,
                this.y,
                15,
                "#c084fc",
                3,
                3,
                "fade",
            );
            return;
        }
        if (this.aoe) {
            this.explode();
            return;
        }

        dealDamage(this.dmg, this.src, target);
        const ang = Math.atan2(this.vy, this.vx) + Math.PI;
        game.fx.spark(this.x, this.y, ang, {
            n: 5, len: 14, spread: 0.8, col: this.col,
        });
        game.fx.flash(this.x, this.y, { r: 16, col: this.col, life: 6 });
        game.particles.emit(
            this.x,
            this.y,
            6,
            this.col,
            4,
            2,
            "spark",
        );
        game.lights.add({ x: this.x, y: this.y, radius: 55, intensity: 0.75, color: this.col, life: 6 });
        if (this.pierce > 0) {
            this.active = true;
            this.pierce--;
        }
    }
    explode() {
        this.active = false;
        const targets =
            this.team === TEAMS.PLAYER
                ? [
                      ...game.enemies,
                      ...game.buildings.filter(
                          (b) => b.team === TEAMS.ENEMY,
                      ),
                  ]
                : [
                      ...game.units,
                      ...game.buildings.filter(
                          (b) => b.team === TEAMS.PLAYER,
                      ),
                  ];
        for (const t of targets) {
            if (dist(this.x, this.y, t.x, t.y) < this.aoe) {
                dealDamage(this.dmg * 0.6, this.src, t);
            }
        }
        game.particles.emit(
            this.x,
            this.y,
            25,
            this.col,
            8,
            4,
            "fade",
        );
        game.fx.ring(this.x, this.y, { r0: 8, r1: this.aoe, col: this.col, w: 4, life: 20 });
        game.fx.ring(this.x, this.y, { r0: 4, r1: this.aoe * 0.6, col: "#fff7ed", w: 2, life: 13 });
        game.fx.flash(this.x, this.y, { r: this.aoe * 0.8, col: shade(this.col, 0.4), life: 12 });
        game.decals.add(
            this.x,
            groundAt(this.x),
            "scorch",
            this.aoe * 0.8,
        );
        game.shake = Math.min(15, game.shake + this.aoe * 0.15);
        // Explosion casts a coloured dynamic light so the blast lifts the
        // surrounding world (WebGPU/WebGL tiers; no-op on Canvas-2D).
        game.lights.add({
            x: this.x, y: this.y,
            radius: this.aoe * 1.6, intensity: 1.4, color: this.col,
            flicker: 0.2, life: 16,
        });
        if (this.aoe > 50) game.audio.playExplosion();
    }
    draw(ctx, cam) {
        if (!this.active) return;
        const px = cam.sx(this.x);
        const py = cam.sy(this.y);
        ctx.fillStyle = this.col;

        if (this.glow) {
            ctx.globalCompositeOperation = "screen";
            if (GFX.shadows) {
                ctx.shadowBlur = 20 * cam.z;
                ctx.shadowColor = this.col;
            }
        }

        if (this.type === "arrow" || this.type === "bolt") {
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(Math.atan2(this.vy, this.vx));
            ctx.fillRect(
                -6 * cam.z,
                -1 * cam.z,
                12 * cam.z,
                2 * cam.z,
            );
            ctx.restore();
        } else {
            ctx.beginPath();
            ctx.arc(px, py, this.sz * cam.z, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.shadowBlur = 0;
        ctx.globalCompositeOperation = "source-over";

        if (this.trail.length > 1) {
            // GLOWING projectiles get a tapered additive GPU ribbon when WebGPU
            // is live; the flat 2D polyline is then skipped. Solid projectiles
            // (arrows) always stay on Canvas 2D — the overlay draws above units,
            // which would look wrong for a non-glowing bolt.
            const gme = typeof game !== "undefined" ? game : window.game;
            const wg = this.glow && gme && gme.wgpu && gme.wgpu.ok && GFX.webgpu
                && gme.wgpu.trailRibbon ? gme.wgpu : null;
            if (wg) {
                const sxo = gme._shakeX || 0, syo = gme._shakeY || 0;
                const pts = [];
                for (let i = 0; i < this.trail.length; i++) {
                    pts.push({ x: cam.sx(this.trail[i].x) + sxo, y: cam.sy(this.trail[i].y) + syo });
                }
                // Head follows the live position so the ribbon tip meets the bolt.
                pts.push({ x: cam.sx(this.x) + sxo, y: cam.sy(this.y) + syo });
                const c = GLRenderer.parseColor(this.col);
                wg.trailRibbon(pts, Math.max(1.5, this.sz * 1.1 * cam.z), c);
            } else {
                ctx.strokeStyle = this.col;
                ctx.lineWidth = this.sz * 0.6 * cam.z;
                ctx.globalAlpha = 0.6;
                if (this.glow) ctx.globalCompositeOperation = "screen";
                ctx.beginPath();
                for (let i = 0; i < this.trail.length; i++) {
                    const tx = cam.sx(this.trail[i].x);
                    const ty = cam.sy(this.trail[i].y);
                    if (i === 0) ctx.moveTo(tx, ty);
                    else ctx.lineTo(tx, ty);
                }
                ctx.stroke();
                ctx.globalAlpha = 1;
                ctx.globalCompositeOperation = "source-over";
            }
        }
    }
}
