import { CONFIG, TEAMS } from '../config.js';
import { BUILDING_TYPES } from '../data/buildings.js';
import { Entity } from './entity.js';
import { Projectile } from '../systems/projectile.js';
import { nearestX } from '../systems/targeting.js';

export class Building extends Entity {
    constructor(x, type, team) {
        super(x, CONFIG.GROUND_Y, team);
        this.kind = "building"; // combat.js target discrimination (vs instanceof)
        this.type = type;
        const def = BUILDING_TYPES[type];
        this.name = def.name;
        this.maxHp = def.hp * (1 + (game.upgrades.bldg_hp || 0));
        this.hp = this.maxHp;
        this.w = def.width;
        this.h = def.height;
        this.armor = def.armor || 0;
        this.income = def.income || {};
        this.dmg = def.dmg || 0;
        this.range = def.range || 0;
        // Anti-air: some structures (the castle) reach much farther against
        // flying foes than against ground troops, and hit them harder.
        this.flyRange = def.flyRange || 0;
        this.vsFlying = def.vsFlying || 0;
        this.cooldown = def.cooldown || 0;
        this.cdTimer = 0;
        this.projType = def.projectile || "bolt";
        this.projAoe = def.aoe || 0;
        this.projDmgType = def.dmgType || null;
        this.bTimer = def.buildTime || 0;
        this.building = this.bTimer > 0;
        this.frame = 0;
    }
    update(dt) {
        if (this.building) {
            this.bTimer -= dt;
            if (this.bTimer <= 0) {
                this.building = false;
                game.audio.playBuild();
                game.notify(`${this.name} completed.`);
                if (this.type === 'forge') {
                    game.upgrades.forge = (game.upgrades.forge || 0) + 0.25;
                    game.units.forEach(u => {
                        if (u.team === TEAMS.PLAYER && !u.ranged)
                            u.dmg = Math.ceil(u.dmg * 1.25);
                    });
                    game.notify('⚒ Forge active — melee units gain +25% damage!');
                }
                if (this.type === 'archery') {
                    game.units.forEach(u => {
                        if (u.team === TEAMS.PLAYER && u.type === 'crossbow') {
                            u.dmg   = Math.ceil(u.dmg   * 1.20);
                            u.range = Math.ceil(u.range * 1.15);
                        }
                    });
                    game.notify('🎯 Archery Range — Crossbowmen enhanced!');
                }
            }
            return;
        }
        this.frame += dt;
        if (this.dmg > 0 && this.range > 0) {
            if (this.cdTimer > 0) this.cdTimer -= dt;
            else {
                const trgs =
                    this.team === TEAMS.PLAYER
                        ? game.enemies
                        : game.units;
                // Flyers can be engaged from farther out (flak-fire); ground
                // targets use the normal, shorter range. Nearest eligible foe.
                const { tgt: c } = nearestX(this.x, trgs, (t, d) =>
                    t.hp > 0 &&
                    d <= (t.flying && this.flyRange ? this.flyRange : this.range),
                );
                if (c) {
                    const opts = {};
                    if (this.projDmgType) opts.dmgType = this.projDmgType;
                    if (this.vsFlying) opts.vsFlying = this.vsFlying;
                    game.projectiles.push(
                        new Projectile(
                            this.x,
                            this.y - this.h * 0.8,
                            c,
                            this.projType,
                            this.dmg,
                            this.team,
                            this.projAoe,
                            0,
                            false,
                            Object.keys(opts).length ? opts : undefined,
                        ),
                    );
                    game.audio.playShoot();
                    this.cdTimer = this.cooldown;
                }
            }
        }
    }
    die() {
        super.die();
        game.particles.emit(
            this.x,
            this.y - this.h / 2,
            40,
            "#475569",
            6,
            10,
            "fade",
        );
        game.decals.add(this.x, this.y, "scorch", this.w);
        game.shake = 10;
        game.audio.playExplosion();
        if (this.type === "castle") game.defeat();
    }
    draw(ctx, cam, dt) {
        const p = cam.toScreen(this.x, this.y);
        const w = this.w * cam.z,
            h = this.h * cam.z,
            x = p.x - w / 2,
            y = p.y - h;

        if (this.building) {
            ctx.fillStyle = "rgba(59,130,246,0.15)";
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = "#3b82f6";
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, w, h);
            const pct =
                1 -
                this.bTimer / BUILDING_TYPES[this.type].buildTime;
            ctx.fillStyle = "#10b981";
            ctx.fillRect(x, p.y - 8 * cam.z, w * pct, 4 * cam.z);
            return;
        }

        ctx.fillStyle = "#1e293b";
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(x, y + h * 0.8, w, h * 0.2);

        if (this.type === "castle") {
            ctx.fillStyle = "#334155";
            ctx.fillRect(
                x + w * 0.1,
                y - 20 * cam.z,
                w * 0.3,
                20 * cam.z,
            );
            ctx.fillRect(
                x + w * 0.6,
                y - 20 * cam.z,
                w * 0.3,
                20 * cam.z,
            );
            ctx.fillStyle = "#020617";
            ctx.fillRect(
                x + w * 0.4,
                y + h * 0.5,
                w * 0.2,
                h * 0.5,
            );
            ctx.strokeStyle = "#cbd5e1";
            ctx.beginPath();
            ctx.moveTo(p.x, y);
            ctx.lineTo(p.x, y - 45 * cam.z);
            ctx.stroke();
            ctx.fillStyle = "#ef4444";
            const wave = Math.sin(this.frame * 0.1) * 6;
            ctx.beginPath();
            ctx.moveTo(p.x, y - 45 * cam.z);
            ctx.lineTo(p.x + 25 * cam.z, y - 35 * cam.z + wave);
            ctx.lineTo(p.x, y - 25 * cam.z);
            ctx.fill();
        } else if (this.type === "mine") {
            ctx.fillStyle = "#78350f";
            ctx.beginPath();
            ctx.arc(p.x, p.y, w * 0.45, Math.PI, 0);
            ctx.fill();
            ctx.fillStyle = "#000";
            ctx.beginPath();
            ctx.arc(p.x, p.y, w * 0.25, Math.PI, 0);
            ctx.fill();
            if (this.frame % 60 < 30) {
                ctx.fillStyle = "var(--gold)";
                ctx.beginPath();
                ctx.arc(
                    p.x,
                    p.y - 12 * cam.z,
                    4 * cam.z,
                    0,
                    Math.PI * 2,
                );
                ctx.fill();
            }
        } else if (this.type === "tower") {
            ctx.fillStyle = "#334155";
            ctx.fillRect(x, y, w, h);
            ctx.fillStyle = "#0f172a";
            ctx.fillRect(
                x - 5 * cam.z,
                y,
                w + 10 * cam.z,
                15 * cam.z,
            );
            ctx.fillStyle = "#000";
            ctx.fillRect(
                x + w * 0.3,
                y + 25 * cam.z,
                w * 0.4,
                25 * cam.z,
            );
        } else if (this.type === "wall") {
            ctx.fillStyle = "#475569";
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = "#1e293b";
            ctx.lineWidth = 3 * cam.z;
            for (let i = 0; i < 4; i++) {
                ctx.beginPath();
                ctx.moveTo(x, y + i * (h / 4));
                ctx.lineTo(x + w, y + i * (h / 4));
                ctx.stroke();
            }
        } else if (this.type === "forge") {
            ctx.fillStyle = "#2d1a0e";
            ctx.fillRect(x, y, w, h);
            // chimney
            ctx.fillStyle = "#374151";
            ctx.fillRect(x + w*0.65, y - 16*cam.z, w*0.2, 16*cam.z);
            // body
            ctx.fillStyle = "#4b2c1a";
            ctx.fillRect(x + w*0.05, y + h*0.4, w*0.9, h*0.45);
            // anvil
            ctx.fillStyle = "#6b7280";
            ctx.fillRect(x + w*0.15, y + h*0.55, w*0.7, h*0.2);
            ctx.fillRect(x + w*0.25, y + h*0.4, w*0.5, h*0.15);
            // fire glow
            ctx.globalCompositeOperation = "screen";
            const ff = 0.3 + Math.abs(Math.sin(this.frame * 0.12)) * 0.4;
            ctx.fillStyle = `rgba(251,146,60,${ff})`;
            ctx.beginPath();
            ctx.arc(p.x, y + h*0.35, 14*cam.z, 0, Math.PI*2);
            ctx.fill();
            ctx.fillStyle = `rgba(255,220,100,${ff*0.6})`;
            ctx.beginPath();
            ctx.arc(p.x, y + h*0.3, 7*cam.z, 0, Math.PI*2);
            ctx.fill();
            ctx.globalCompositeOperation = "source-over";
        } else if (this.type === "obelisk") {
            ctx.fillStyle = "#1e1b4b";
            ctx.beginPath();
            ctx.moveTo(p.x, y);
            ctx.lineTo(x + w, p.y);
            ctx.lineTo(x, p.y);
            ctx.closePath();
            ctx.fill();
            ctx.globalCompositeOperation = "screen";
            ctx.fillStyle = `rgba(192, 132, 252, ${0.5 + Math.sin(this.frame * 0.05) * 0.3})`;
            ctx.beginPath();
            ctx.arc(p.x, y + h * 0.6, 15 * cam.z, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalCompositeOperation = "source-over";
        }

        this.drawHp(ctx, cam, this.w * 0.8, -this.h - 15);
        this.drawDmg(ctx, cam, dt);
    }
}
