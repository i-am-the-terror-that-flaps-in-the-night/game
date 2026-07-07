import { resolveDamage } from '../combat.js';
import { CONFIG, TEAMS } from '../config.js';
import { ENEMY_TYPES } from '../data/enemies.js';
import { UNIT_TYPES } from '../data/units.js';
import { Entity } from './entity.js';
import { Projectile } from '../projectile.js';
import { clamp, dist, rand, randInt } from '../utils.js';

export class Unit extends Entity {
    constructor(x, type, team) {
        super(x, CONFIG.GROUND_Y, team);
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
        this.summonTimer = 300; // Fix #3: Necro timer
        // ── XP / Leveling (player units only) ──
        this.xp = 0;
        this.level = 1;
        this.xpNeeded = 60;
        // ── Paladin self-heal ──
        const ud = team === TEAMS.PLAYER ? UNIT_TYPES[type] : null;
        this.selfHealAmt = (ud && ud.selfHeal) || 0;
        this.selfHealCd  = (ud && ud.selfHealCd)  || 0;
        this.selfHealTimer = 0;
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

        // Paladin / self-healer tick
        if (this.selfHealAmt > 0 && this.hp > 0 && this.hp < this.maxHp) {
            if (this.selfHealTimer > 0) this.selfHealTimer -= dt;
            else {
                this.heal(this.selfHealAmt);
                game.particles.emit(this.x, this.y - 25, 6, '#fde047', 2, 3, 'float');
                this.selfHealTimer = this.selfHealCd;
            }
        }

        if (this.healAmt > 0) {
            if (this.healTimer > 0) this.healTimer -= dt;
            else {
                const allies =
                    this.team === TEAMS.PLAYER
                        ? game.units
                        : game.enemies;
                let tgt = null,
                    lowHp = 1;
                for (const a of allies) {
                    if (
                        a !== this &&
                        a.hp > 0 &&
                        a.hp / a.maxHp < lowHp &&
                        dist(this.x, this.y, a.x, a.y) <
                            this.healRange
                    ) {
                        lowHp = a.hp / a.maxHp;
                        tgt = a;
                    }
                }
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

        let cD = Infinity,
            tgt = null;
        for (const e of enemies) {
            if (e.hp <= 0 || (e.flying && !this.ranged)) continue; // Fix #4: Ground ignores air
            const d = Math.abs(e.x - this.x);
            if (d < cD) {
                cD = d;
                tgt = e;
            }
        }
        if (!tgt) {
            for (const b of bldgs) {
                if (b.hp <= 0) continue;
                const d = Math.abs(b.x - this.x);
                if (d < cD) {
                    cD = d;
                    tgt = b;
                }
            }
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
            if (this.summonTimer <= 0 && game.enemies.length < 60) {
                this.summonTimer = 300;
                game.spawnEnemy(
                    "skeleton",
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
        if (this.ranged) {
            this.atk = 1; this.atkKind = 2; // draw-back animation
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
                        isUnit: true,
                    },
                ),
            );
            if (this.proj === "fireball") game.audio.playMagic();
            else game.audio.playShoot();
        } else {
            this.atk = 1; this.atkKind = 1; // melee swing
            const src = {
                dmgType: this.dmgType,
                armorPierce: this.armorPierce,
                vsLarge: this.vsLarge,
                siege: this.siege,
                team: this.team,
                isUnit: true,
            };
            const res = resolveDamage(this.dmg, src, tgt);
            const crt = res.tag === "strong"; // counter hits get the heavy FX
            tgt.takeDamage(res.amt, res.tag);

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
                        const r2 = resolveDamage(this.dmg * 0.5, src, t);
                        t.takeDamage(r2.amt, r2.tag);
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
            
            // Crystal drops
            if (this.type === "shaman") game.crystal += 2;
            if (this.type === "necromancer") game.crystal += 5;
            if (this.type === "dragon") game.crystal += 25;
            
            // Iron drops
            if (this.type === "marauder") game.iron += 1;
            if (this.type === "berserker") game.iron += 2;
            if (this.type === "shieldman") game.iron += 4;
            if (this.type === "ogre") game.iron += 10;
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
