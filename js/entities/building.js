import { CONFIG, TEAMS } from '../config.js';
import { BUILDING_TYPES } from '../data/buildings.js';
import { Entity } from './entity.js';
import { Projectile } from '../systems/projectile.js';
import { nearestX } from '../systems/targeting.js';
import { dealDamage } from '../systems/combat.js';
import { rand, dist } from '../utils.js';

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
        // Castle beam visual state (machine-gun raycast). beamT counts down each
        // frame the beam is drawn; beamX/beamY is the current aim point.
        this.beamT = 0;
        this.beamX = 0;
        this.beamY = 0;
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
        if (this.beamT > 0) this.beamT -= dt;
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
                    // The castle fires a continuous machine-gun raycast beam; all
                    // other structures keep the homing projectile.
                    if (this.type === "castle") this.castleBeam(c, trgs);
                    else {
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
                    }
                    this.cdTimer = this.cooldown;
                }
            }
        }
    }

    // Machine-gun raycast BEAM (castle). Fires a hitscan ray from the muzzle to
    // the target; damages the primary target plus a couple of foes the ray
    // passes near (so it reads as a sweeping beam, not a single bolt). All the
    // heavy VFX — muzzle fire, smoke, tracer sparks, beam line — are purely
    // cosmetic and never touch combat.
    castleBeam(tgt, trgs) {
        const muzzleX = this.x;
        const muzzleY = this.y - this.h * 0.8;
        // Damage: primary target + up to 2 more enemies lying near the ray path.
        const src = {
            dmgType: this.projDmgType || "magic",
            vsFlying: this.vsFlying || 0,
            team: this.team,
            isUnit: false,
        };
        dealDamage(this.dmg, src, tgt);
        // Ray direction, for "near the line" hits.
        const ax = tgt.x - muzzleX, ay = tgt.y - muzzleY;
        const alen = Math.hypot(ax, ay) || 1;
        const ux = ax / alen, uy = ay / alen;
        let extra = 0;
        for (let i = 0; i < trgs.length && extra < 2; i++) {
            const e = trgs[i];
            if (e === tgt || e.hp <= 0) continue;
            // distance from enemy to the beam segment
            const rx = e.x - muzzleX, ry = (e.y - 20) - muzzleY;
            const proj = rx * ux + ry * uy;
            if (proj < 0 || proj > alen) continue;
            const perp = Math.abs(rx * uy - ry * ux);
            if (perp < 26) { dealDamage(this.dmg * 0.6, src, e); extra++; }
        }
        // ---- Cosmetic beam + muzzle FX (no combat effect) ----
        this.beamT = 4;                 // draw the beam for ~4 frames
        this.beamX = tgt.x;
        this.beamY = tgt.y - 20;
        const ang = Math.atan2(this.beamY - muzzleY, this.beamX - muzzleX);
        // Muzzle flash + fire burst.
        game.fx.flash(muzzleX, muzzleY, { r: 20, col: "#fde68a", life: 6 });
        game.fx.spark(muzzleX, muzzleY, ang, { n: 5, len: rand(24, 44), spread: 0.25, col: "#fbbf24", w: 2, life: 5 });
        // Machine-gun fire embers (rising, additive) + smoke (grey, opaque).
        game.particles.emit(muzzleX, muzzleY, 6, "#fb923c", 3, 3, "float");   // fire
        game.particles.emit(muzzleX, muzzleY, 4, "#fbbf24", 4, 2, "spark");   // muzzle sparks
        game.particles.emit(muzzleX, muzzleY - 6, 5, "#6b7280", 2, 4, "fade"); // smoke puff
        game.particles.emit(muzzleX, muzzleY - 6, 3, "#374151", 1, 5, "fade"); // dark smoke
        // Impact fire + smoke at the hit point.
        game.particles.emit(this.beamX, this.beamY, 5, "#f97316", 4, 3, "float");
        game.particles.emit(this.beamX, this.beamY, 4, "#9ca3af", 2, 4, "fade");
        game.shake = Math.min(10, game.shake + 1.2);
        game.audio.playShoot();
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
        const px = cam.sx(this.x);
        const py = cam.sy(this.y);
        const w = this.w * cam.z,
            h = this.h * cam.z,
            x = px - w / 2,
            y = py - h;

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
            ctx.fillRect(x, py - 8 * cam.z, w * pct, 4 * cam.z);
            return;
        }

        ctx.fillStyle = "#1e293b";
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(x, y + h * 0.8, w, h * 0.2);

        if (this.type === "castle") {
            // Machine-gun beam: a hot raycast line from the muzzle to the aim
            // point while firing (beamT > 0). Cosmetic — damage already applied.
            if (this.beamT > 0) {
                const mx = px, my = py - this.h * 0.8 * cam.z;
                const bx = cam.sx(this.beamX), by = cam.sy(this.beamY);
                if (Number.isFinite(bx) && Number.isFinite(by)) {
                    ctx.save();
                    ctx.globalCompositeOperation = "screen";
                    const a = Math.max(0, this.beamT / 4);
                    // outer glow beam
                    ctx.strokeStyle = `rgba(251,146,60,${0.5 * a})`;
                    ctx.lineWidth = (5 + Math.random() * 2) * cam.z;
                    ctx.lineCap = "round";
                    ctx.beginPath();
                    ctx.moveTo(mx, my);
                    ctx.lineTo(bx, by);
                    ctx.stroke();
                    // hot white core
                    ctx.strokeStyle = `rgba(255,244,214,${0.9 * a})`;
                    ctx.lineWidth = 2 * cam.z;
                    ctx.beginPath();
                    ctx.moveTo(mx, my);
                    ctx.lineTo(bx, by);
                    ctx.stroke();
                    // muzzle glow
                    ctx.fillStyle = `rgba(255,224,130,${0.7 * a})`;
                    ctx.beginPath();
                    ctx.arc(mx, my, (6 + Math.random() * 3) * cam.z, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                }
            }
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
            ctx.moveTo(px, y);
            ctx.lineTo(px, y - 45 * cam.z);
            ctx.stroke();
            ctx.fillStyle = "#ef4444";
            const wave = Math.sin(this.frame * 0.1) * 6;
            ctx.beginPath();
            ctx.moveTo(px, y - 45 * cam.z);
            ctx.lineTo(px + 25 * cam.z, y - 35 * cam.z + wave);
            ctx.lineTo(px, y - 25 * cam.z);
            ctx.fill();
        } else if (this.type === "mine") {
            ctx.fillStyle = "#78350f";
            ctx.beginPath();
            ctx.arc(px, py, w * 0.45, Math.PI, 0);
            ctx.fill();
            ctx.fillStyle = "#000";
            ctx.beginPath();
            ctx.arc(px, py, w * 0.25, Math.PI, 0);
            ctx.fill();
            if (this.frame % 60 < 30) {
                ctx.fillStyle = "var(--gold)";
                ctx.beginPath();
                ctx.arc(
                    px,
                    py - 12 * cam.z,
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
            ctx.arc(px, y + h*0.35, 14*cam.z, 0, Math.PI*2);
            ctx.fill();
            ctx.fillStyle = `rgba(255,220,100,${ff*0.6})`;
            ctx.beginPath();
            ctx.arc(px, y + h*0.3, 7*cam.z, 0, Math.PI*2);
            ctx.fill();
            ctx.globalCompositeOperation = "source-over";
        } else if (this.type === "obelisk") {
            ctx.fillStyle = "#1e1b4b";
            ctx.beginPath();
            ctx.moveTo(px, y);
            ctx.lineTo(x + w, py);
            ctx.lineTo(x, py);
            ctx.closePath();
            ctx.fill();
            ctx.globalCompositeOperation = "screen";
            ctx.fillStyle = `rgba(192, 132, 252, ${0.5 + Math.sin(this.frame * 0.05) * 0.3})`;
            ctx.beginPath();
            ctx.arc(px, y + h * 0.6, 15 * cam.z, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalCompositeOperation = "source-over";
        }

        this.drawHp(ctx, cam, this.w * 0.8, -this.h - 15);
        this.drawDmg(ctx, cam, dt);
    }
}
