import { dealDamage } from '../systems/combat.js';
import { lowestHpAllyInRange, nearestX } from '../systems/targeting.js';
import { CONFIG, NECRO_ENEMY_CAP, NECRO_MINION_TYPE, NECRO_SUMMON_INTERVAL, TEAMS } from '../config.js';
import { ENEMY_TYPES } from '../data/enemies.js';
import { UNIT_TYPES } from '../data/units.js';
import { Entity } from './entity.js';
import { Projectile } from '../systems/projectile.js';
import { clamp, dist, rand, randInt } from '../utils.js';

export class Unit extends Entity {
    constructor(x, type, team) {
        super(x, CONFIG.GROUND_Y, team);
        this.kind = "unit"; // combat.js target discrimination (vs instanceof)
        this.type = type;
        const def =
            team === TEAMS.PLAYER
                ? UNIT_TYPES[type]
                : ENEMY_TYPES[type];
        this.name = def.name;
        this.maxHp = def.hp;
        this.hp = this.maxHp;
        this.dmg = def.dmg;
        this.range = def.range;
        this.speed = def.speed;
        this.cd = def.cooldown;
        this.cdTimer = 0;
        this.armor = def.armor || 0;
        this.dmgType = def.dmgType || "slash";
        this.armorClass = def.armorClass || "none";
        this.armorPierce = def.armorPierce || false;
        this.vsLarge = def.vsLarge || 0;
        this.vsFlying = def.vsFlying || 0;
        this.large = def.large || false;
        this.ranged = def.ranged;
        this.proj = def.projectile;
        this.pierce = def.pierce;
        this.healAmt = def.heal || 0;
        this.healRange = def.healRange || 0;
        this.healCd = def.healCd || 0;
        this.healTimer = 0;
        this.charge = def.charge;
        this.aoe = def.aoe || 0;
        this.flying = def.flying;
        this.boss = def.boss;
        this.bounty = def.bounty || 0;
        this.pop = def.pop || 1;
        this.siege = def.siege || false;
        this.scale = def.scale || 1;
        this.col =
            def.color ||
            (team === TEAMS.PLAYER ? "#3b82f6" : "#ef4444");
        this.vis = def.visual || "sword";

        this.state = "walk";
        this.frame = randInt(0, 100);
        this.facing = team === TEAMS.PLAYER ? 1 : -1;
        this.summonTimer = NECRO_SUMMON_INTERVAL; // Fix #3: Necro timer
        // ── XP / Leveling (player units only) ──
        this.xp = 0;
        this.level = 1;
        this.xpNeeded = 60;
        // ── Combat animation state ──
        this.atk = 0;        // melee/ranged swing energy (1 -> 0)
        this.atkKind = 0;    // 1 = melee swing, 2 = ranged draw
        this.hurtT = 0;      // flinch timer (frames)
        this.flashT = 0;     // white hit-flash timer
        this.recoil = 0;     // draw-only knockback offset (px, local x)
        this.wTrail = [];    // weapon-tip motion trail (local coords)
    }
    gainXP(amount) {
        if (this.team !== TEAMS.PLAYER || this.level >= 3 || this.hp <= 0) return;
        this.xp += amount;
        if (this.xp >= this.xpNeeded) {
            this.xp = 0;
            this.level++;
            this.xpNeeded = this.level === 2 ? 150 : 300;
            this.maxHp = Math.floor(this.maxHp * 1.15);
            this.hp    = Math.min(this.hp + 40, this.maxHp);
            this.dmg   = Math.ceil(this.dmg   * 1.10);
            this.armor = (this.armor || 0) + 1;
            game.particles.emit(this.x, this.y - 40, 30, '#fbbf24', 6, 5, 'float');
            game.notify(`${this.name} promoted to ★ Lv.${this.level}!`);
        }
    }
    applyUpgrades(upg) {
        if (!upg) return;
        if (upg.damage) {
            const am = this.ranged ? "ranged" : "melee";
            if (
                !upg.applies ||
                upg.applies === am ||
                (upg.applies === "magic" &&
                    this.proj === "fireball")
            )
                this.dmg *= 1 + upg.damage;
        }
        if (upg.hp) {
            let oldMax = this.maxHp; // Fix #7: Only add diff to current hp
            this.maxHp *= 1 + upg.hp;
            this.hp += this.maxHp - oldMax;
        }
        if (upg.range && this.ranged) this.range *= 1 + upg.range;
        if (upg.speed) this.speed *= 1 + upg.speed;
        if (upg.heal && this.healAmt) this.healAmt *= 1 + upg.heal;
        if (upg.cooldown) this.cd *= 1 + upg.cooldown;
    }
    update(dt) {
        if (!this.active) return;
        this.frame += dt;

        // Combat-animation timers
        if (this.atk > 0) this.atk = Math.max(0, this.atk - dt * 0.085);
        if (this.hurtT > 0) this.hurtT -= dt;
        if (this.flashT > 0) this.flashT -= dt;
        if (this.recoil !== 0) {
            this.recoil *= Math.pow(0.78, dt);
            if (Math.abs(this.recoil) < 0.2) this.recoil = 0;
        }

        if (this.healAmt > 0) {
            if (this.healTimer > 0) this.healTimer -= dt;
            else {
                const allies =
                    this.team === TEAMS.PLAYER
                        ? game.units
                        : game.enemies;
                const tgt = lowestHpAllyInRange(this, allies, this.healRange);
                if (tgt) {
                    tgt.heal(this.healAmt);
                    game.particles.emit(
                        tgt.x,
                        tgt.y - 25,
                        10,
                        "#34d399",
                        3,
                        4,
                        "float",
                    );
                    game.audio.playMagic();
                    this.healTimer = this.healCd;
                    this.state = "attack";
                    this.cdTimer = 30;
                }
            }
        }

        if (this.cdTimer > 0) this.cdTimer -= dt;

        const enemies =
            this.team === TEAMS.PLAYER ? game.enemies : game.units;
        const bldgs =
            this.team === TEAMS.PLAYER ? [] : game.buildings;

        // Fix #4: ground units ignore airborne foes. Fall back to the nearest
        // building only when no enemy is targetable (player units pass bldgs=[]).
        let res = nearestX(this.x, enemies, (e) => e.hp > 0 && !(e.flying && !this.ranged));
        let tgt = res.tgt,
            cD = res.d;
        if (!tgt) {
            res = nearestX(this.x, bldgs, (b) => b.hp > 0);
            tgt = res.tgt;
            cD = res.d;
        }

        if (tgt) {
            this.facing = tgt.x > this.x ? 1 : -1;
            if (cD <= this.range) {
                this.state = "attack";
                if (this.cdTimer <= 0) {
                    this.attack(tgt);
                    this.cdTimer = this.cd;
                }
            } else {
                this.state = "walk";
                let spd = this.speed;
                if (this.charge && cD > 120) spd *= 1.8;
                this.x += this.facing * spd * dt;
                if (
                    this.charge &&
                    cD > 120 &&
                    Math.floor(this.frame) % 5 === 0
                )
                    game.particles.emit(
                        this.x,
                        this.y,
                        2,
                        "#475569",
                        1,
                        2,
                        "fade",
                    );
            }
        } else {
            if (this.team === TEAMS.PLAYER) {
                this.state = "idle";
                const holdX = typeof game !== 'undefined'
                    ? (game.formation === 'defensive' ? 320 : game.formation === 'aggressive' ? 700 : 450)
                    : 450;
                if (this.x > holdX) {
                    this.facing = -1; this.x -= 1.5 * dt; this.state = "walk";
                } else if (typeof game !== 'undefined' && game.formation === 'aggressive' && this.x < holdX - 80) {
                    this.facing = 1; this.x += 1.0 * dt; this.state = "walk";
                }
            } else {
                this.state = "walk";
                this.facing = -1;
                this.x -= this.speed * dt;
            }
        }

        if (this.type === "necromancer") {
            this.summonTimer -= dt;
            if (this.summonTimer <= 0 && game.enemies.length < NECRO_ENEMY_CAP) {
                this.summonTimer = NECRO_SUMMON_INTERVAL;
                game.spawnEnemy(
                    NECRO_MINION_TYPE,
                    this.x + rand(-50, 50),
                    this.y,
                );
                game.particles.emit(
                    this.x,
                    this.y - 35,
                    20,
                    "#c084fc",
                    4,
                    5,
                    "fade",
                );
                game.audio.playMagic();
            }
        }

        this.x = clamp(this.x, 50, CONFIG.WORLD_WIDTH - 50);
    }
    attack(tgt) {
        if (this.type === "catapult") {
            this.catapultBarrage(tgt);
            return;
        }
        if (this.ranged) {
            this.atk = 1; this.atkKind = 2; // draw-back animation
            this.recoil = -this.facing * (this.proj === "fireball" ? 2 : 3); // firing kick-back
            game.projectiles.push(
                new Projectile(
                    this.x,
                    this.y - 40 * this.scale,
                    tgt,
                    this.proj,
                    this.dmg,
                    this.team,
                    this.aoe,
                    this.pierce,
                    this.siege,
                    {
                        dmgType: this.dmgType,
                        armorPierce: this.armorPierce,
                        vsLarge: this.vsLarge,
                        vsFlying: this.vsFlying,
                        isUnit: true,
                    },
                ),
            );
            if (this.proj === "fireball") {
                game.audio.playMagic();
                game.fx.flash(this.x, this.y - 45 * this.scale, {
                    r: 12 * this.scale,
                    col: this.team === TEAMS.PLAYER ? "#60a5fa" : "#c084fc",
                    life: 8,
                }); // cast pulse
            }
            else game.audio.playShoot();
        } else {
            this.atk = 1; this.atkKind = 1; // melee swing
            const src = {
                dmgType: this.dmgType,
                armorPierce: this.armorPierce,
                vsLarge: this.vsLarge,
                vsFlying: this.vsFlying,
                siege: this.siege,
                team: this.team,
                isUnit: true,
            };
            const res = dealDamage(this.dmg, src, tgt);
            const crt = res.tag === "strong"; // counter hits get the heavy FX

            if (this.aoe) {
                const trgs =
                    this.team === TEAMS.PLAYER
                        ? game.enemies
                        : game.units;
                for (const t of trgs)
                    if (
                        t !== tgt &&
                        t.hp > 0 &&
                        dist(this.x, this.y, t.x, t.y) < this.aoe
                    ) {
                        dealDamage(this.dmg * 0.5, src, t);
                        t.recoil = (t.x > this.x ? 1 : -1) * 4;
                    }
                // Ground-slam shockwave
                const sy = this.y - 18 * this.scale;
                game.fx.ring(this.x, sy, { r0: 8, r1: this.aoe * 0.95, col: "#fb923c", w: 4, life: 20 });
                game.fx.ring(this.x, sy, { r0: 4, r1: this.aoe * 0.6, col: "#fed7aa", w: 2, life: 14 });
                game.fx.flash(this.x, sy, { r: this.aoe * 0.7, col: "#fdba74", life: 12 });
                game.decals.add(this.x, CONFIG.GROUND_Y, "scorch", this.aoe * 0.5);
                game.shake = Math.min(14, game.shake + 6);
                game.audio.playExplosion();
            } else {
                // Contact point between attacker and victim, at chest height
                const cx = this.x + this.facing * (16 * this.scale);
                const cy = tgt.y - 24 * (tgt.scale || 1);
                const dir = this.facing > 0 ? 0 : Math.PI;
                const shielded =
                    tgt.vis === "sword_shield" ||
                    tgt.vis === "tower_shield";
                // Swing crescent (sweeps down-forward)
                game.fx.slash(cx, cy, dir + (this.facing > 0 ? 0.35 : -0.35), {
                    len: (crt ? 30 : 24) * this.scale,
                    w: crt ? 6 : 4.5,
                    col: crt ? "#fde68a" : "#f1f5f9",
                    arc: 1.8,
                    life: crt ? 10 : 8,
                });
                // Impact sparks fly back toward attacker
                game.fx.spark(cx, cy, dir + Math.PI, {
                    n: crt ? 9 : 5,
                    len: crt ? 28 : 16,
                    spread: 1.0,
                    col: shielded ? "#bae6fd" : crt ? "#fbbf24" : "#e2e8f0",
                });
                game.fx.flash(cx, cy, {
                    r: crt ? 34 : 18,
                    col: shielded ? "#7dd3fc" : crt ? "#fbbf24" : "#ffffff",
                    life: crt ? 10 : 6,
                });
                if (crt || shielded)
                    game.fx.ring(cx, cy, {
                        r0: 4, r1: crt ? 46 : 26,
                        col: shielded ? "#7dd3fc" : "#fbbf24",
                        w: 3, life: crt ? 16 : 12,
                    });
                if (crt) game.shake = Math.max(game.shake, 4);
                // Victim flinch + knockback wobble (visual only)
                tgt.recoil = this.facing * (crt ? 6 : 3.5);
                game.particles.emit(
                    cx,
                    cy,
                    shielded ? 4 : 6,
                    shielded ? "#bae6fd" : "#ef4444",
                    4,
                    3,
                    "fade",
                );
                game.decals.add(
                    tgt.x,
                    CONFIG.GROUND_Y,
                    "blood",
                    rand(12, 25),
                );
                game.audio.playHit();
            }
        }
    }
    // Catapult: looks like a machine-gun gravel barrage, but the actual damage
    // is a handful of instant raycast hits — no per-frame Projectile objects,
    // so the "hail of shots" is cheap no matter how chaotic it looks.
    catapultBarrage(tgt) {
        this.atk = 1; this.atkKind = 2; // drives the rapid-fire arm judder + muzzle flash
        this.recoil = -this.facing * 5; // firing kick-back
        const src = {
            dmgType: this.dmgType,
            armorPierce: this.armorPierce,
            vsLarge: this.vsLarge,
            vsFlying: this.vsFlying,
            team: this.team,
            isUnit: true,
        };
        const enemies = this.team === TEAMS.PLAYER ? game.enemies : game.units;
        const RAYS = 4; // a few raycasts stand in for a hail of gravel
        const hits = enemies
            .filter((e) => e.hp > 0 && dist(tgt.x, tgt.y, e.x, e.y) < this.aoe)
            .sort((a, b) => dist(tgt.x, tgt.y, a.x, a.y) - dist(tgt.x, tgt.y, b.x, b.y))
            .slice(0, RAYS);
        for (const e of hits) {
            dealDamage(this.dmg * 0.6, src, e);
            game.fx.spark(e.x, e.y - 20 * (e.scale || 1), rand(0, Math.PI * 2), {
                n: 4, len: 14, spread: 1.2, col: "#a8a29e",
            });
            game.fx.flash(e.x, e.y - 20 * (e.scale || 1), { r: 16, col: "#d6d3d1", life: 6 });
        }
        // Muzzle-flash tracer spray toward the impact zone (visual only — no
        // collision, just short-lived streaks fading at staggered times).
        const muzzleX = this.x + this.facing * 18 * this.scale;
        const muzzleY = this.y - 32 * this.scale;
        const ang = Math.atan2(tgt.y - 40 - muzzleY, tgt.x - this.x);
        for (let i = 0; i < 7; i++) {
            game.fx.spark(muzzleX, muzzleY, ang + rand(-0.12, 0.12), {
                n: 2, len: rand(30, 60), spread: 0.05, col: "#78716c", life: 5 + i, w: 1.6,
            });
        }
        game.particles.emit(tgt.x, CONFIG.GROUND_Y, 22, "#78716c", 6, 3, "fade");
        game.decals.add(tgt.x, CONFIG.GROUND_Y, "scorch", this.aoe * 0.4);
        game.shake = Math.min(14, game.shake + 5);
        game.audio.playShoot();
        game.audio.playExplosion();
    }
    die() {
        super.die();
        // Death impact: ground ring + scatter burst
        game.fx.ring(this.x, CONFIG.GROUND_Y, {
            r0: 6, r1: 42 * this.scale,
            col: this.team === TEAMS.PLAYER ? "#64748b" : "#7f1d1d",
            w: 3, life: 18,
        });
        game.fx.flash(this.x, this.y - 22, {
            r: 26 * this.scale, col: "#fca5a5", life: 8,
        });
        game.particles.emit(this.x, this.y - 22, 10, "#1f2937", 5, 3, "fade");
        // Mages / summoners release a rising soul wisp
        if (this.vis === "mage" || this.vis === "staff" || this.boss)
            game.particles.emit(this.x, this.y - 30, 14, "#c084fc", 3, 4, "float");
        game.particles.emit(
            this.x,
            this.y - 25,
            20,
            "#ef4444",
            5,
            4,
            "fade",
        );
        game.decals.add(
            this.x,
            CONFIG.GROUND_Y,
            "blood",
            35 * this.scale,
        );
        if (this.team === TEAMS.ENEMY) {
            game.addGold(this.bounty);
            game.stats.kills++;
            game.audio.playCoin();
            
            // Crystal / iron drops (per-enemy table lives in data/enemies.js)
            const drops = ENEMY_TYPES[this.type].drops;
            if (drops) {
                if (drops.crystal) game.crystal += drops.crystal;
                if (drops.iron) game.iron += drops.iron;
            }
            // Dragon kill flag for achievement
            if (this.type === "dragon") game._dragonKilled = true;
            // Grant XP to nearest player unit
            let ckr = /** @type {any} */ (null), ckrD = 260;
            game.units.forEach(u => {
                if (u.hp > 0 && u.team === TEAMS.PLAYER) {
                    const d = dist(u.x, u.y, this.x, this.y);
                    if (d < ckrD) { ckrD = d; ckr = u; }
                }
            });
            if (ckr) ckr.gainXP(this.bounty || 5);
        } else {
            game.stats.loss++;
            game.pop = Math.max(0, game.pop - this.pop);
        }
    }
}
