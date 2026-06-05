            class Entity {
                constructor(x, y, team) {
                    this.x = x;
                    this.y = y;
                    this.team = team;
                    this.hp = 1;
                    this.maxHp = 1;
                    this.armor = 0;
                    this.active = true;
                    this.dmgTexts = [];
                }
                takeDamage(amt, isCrit = false, isMagic = false) {
                    if (this.hp <= 0) return;
                    this.hp -= amt;
                    this.hurtT = 7;   // flinch
                    this.flashT = 5;  // white hit-flash
                    const col = isMagic
                        ? "#c084fc"
                        : isCrit
                          ? "#fbbf24"
                          : "#ef4444";
                    const sz = isCrit ? 24 : 15;
                    this.dmgTexts.push({
                        v: Math.floor(amt),
                        x: rand(-12, 12),
                        y: -30,
                        life: 40,
                        c: col,
                        s: sz,
                    });
                    if (this.hp <= 0) this.die();
                }
                heal(amt) {
                    if (this.hp <= 0) return;
                    const actual = Math.min(this.maxHp - this.hp, amt);
                    this.hp += actual;
                    this.dmgTexts.push({
                        v: "+" + Math.floor(actual),
                        x: 0,
                        y: -45,
                        life: 50,
                        c: "#10b981",
                        s: 18,
                    });
                }
                die() {
                    this.active = false;
                    this.hp = 0;
                }
                drawHp(ctx, cam, w, offY) {
                    if (this.hp >= this.maxHp || this.hp <= 0) return;
                    const p = cam.toScreen(this.x, this.y);
                    const bw = w * cam.z,
                        bh = 5 * cam.z;
                    ctx.fillStyle = "rgba(0,0,0,0.8)";
                    ctx.fillRect(p.x - bw / 2, p.y + offY * cam.z, bw, bh);
                    ctx.fillStyle =
                        this.team === TEAMS.PLAYER ? "#34d399" : "#ef4444";
                    ctx.fillRect(
                        p.x - bw / 2 + 1,
                        p.y + offY * cam.z + 1,
                        (bw - 2) * (Math.max(0, this.hp) / this.maxHp),
                        bh - 2,
                    );
                }
                drawDmg(ctx, cam, dt) {
                    const p = cam.toScreen(this.x, this.y);
                    for (let i = this.dmgTexts.length - 1; i >= 0; i--) {
                        const d = this.dmgTexts[i];
                        d.life -= dt;
                        d.y -= 0.8 * dt;
                        if (d.life <= 0) {
                            this.dmgTexts.splice(i, 1);
                            continue;
                        }
                        ctx.fillStyle = d.c;
                        ctx.globalAlpha = Math.min(1, d.life / 15);
                        ctx.font = `900 ${d.s * cam.z}px system-ui`;
                        ctx.textAlign = "center";
                        ctx.strokeStyle = "rgba(0,0,0,0.8)";
                        ctx.lineWidth = 4 * cam.z;
                        ctx.strokeText(
                            d.v,
                            p.x + d.x * cam.z,
                            p.y + d.y * cam.z,
                        );
                        ctx.fillText(d.v, p.x + d.x * cam.z, p.y + d.y * cam.z);
                    }
                    ctx.globalAlpha = 1;
                }
            }

            class Building extends Entity {
                constructor(x, type, team) {
                    super(x, CONFIG.GROUND_Y, team);
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
                    this.cooldown = def.cooldown || 0;
                    this.cdTimer = 0;
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
                            let c = null,
                                cd = this.range;
                            for (const t of trgs) {
                                if (t.hp <= 0) continue;
                                const d = Math.abs(t.x - this.x);
                                if (d < cd) {
                                    cd = d;
                                    c = t;
                                }
                            }
                            if (c) {
                                game.projectiles.push(
                                    new Projectile(
                                        this.x,
                                        this.y - this.h * 0.8,
                                        c,
                                        "bolt",
                                        this.dmg,
                                        this.team,
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

            class Unit extends Entity {
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
                            ),
                        );
                        if (this.proj === "fireball") game.audio.playMagic();
                        else game.audio.playShoot();
                    } else {
                        this.atk = 1; this.atkKind = 1; // melee swing
                        const crt = Math.random() < 0.1;
                        const isBldg = tgt instanceof Building;
                        const mult = this.siege && isBldg ? 2 : 1; // Fix #19
                        const actual = Math.max(
                            1,
                            (crt ? this.dmg * 1.6 : this.dmg) * mult -
                                (tgt.armor || 0),
                        );
                        tgt.takeDamage(actual, crt);

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
                                    t.takeDamage(
                                        Math.max(
                                            1,
                                            this.dmg * 0.5 - (t.armor || 0),
                                        ),
                                    );
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
                        let ckr = null, ckrD = 260;
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
                draw(ctx, cam, dt) {
                    if (!this.active) {
                        this.drawDmg(ctx, cam, dt);
                        return;
                    }
                    const p = cam.toScreen(this.x, this.y);
                    const s = this.scale * cam.z;
                    const f = this.facing;
                    const q = (() => { const el = document.getElementById("particleQuality"); return el ? parseFloat(el.value || 1) : 1; })();
                    const lowQ = q < 1;

                    // ── Animation drivers ──
                    const walking = this.state === "walk";
                    const spd = clamp(this.speed / 2, 0.5, 2.2);
                    const gp = this.frame * 0.22 * spd;        // gait phase
                    const breath = Math.sin(this.frame * 0.09) * 1.3;
                    const hurt = this.hurtT > 0 ? clamp(this.hurtT / 7, 0, 1) : 0;
                    const flash = this.flashT > 0 ? clamp(this.flashT / 5, 0, 1) : 0;
                    const sw = this.atk;                       // 1 (just fired) -> 0
                    const windup = clamp((sw - 0.72) / 0.28, 0, 1);
                    const strike = clamp((0.72 - sw) / 0.72, 0, 1);
                    const swing = this.atkKind === 1 ? strike - windup : 0; // -1..+1

                    const bob = walking ? -Math.abs(Math.sin(gp)) * 2.4 : breath * 0.6;
                    const hipY = -18 + bob;
                    const shoulderY = -40 + bob;
                    const headCY = -50 + bob;
                    const headR = 8;
                    let lean = (walking ? Math.sin(gp) * 0.04 : 0) + swing * 0.11 - hurt * 0.13;

                    // ── Palette ──
                    const team = this.team === TEAMS.PLAYER;
                    const skin = this.col;
                    const limb = "#e2e8f0";
                    const limbDark = "#8b98a8";
                    const fPh = gp, bPh = gp + Math.PI;

                    ctx.save();
                    ctx.translate(p.x, p.y);
                    if (this.recoil) ctx.translate(this.recoil * 0.6 * cam.z, 0);
                    ctx.scale(f * s, s);
                    ctx.lineCap = "round";
                    ctx.lineJoin = "round";

                    const bone = (x1, y1, x2, y2, w, col) => {
                        ctx.strokeStyle = col;
                        ctx.lineWidth = w;
                        ctx.beginPath();
                        ctx.moveTo(x1, y1);
                        ctx.lineTo(x2, y2);
                        ctx.stroke();
                    };
                    const limb2 = (rx, ry, tx, ty, l1, l2, bend, w, col) => {
                        const j = ik2(rx, ry, tx, ty, l1, l2, bend);
                        bone(rx, ry, j.x, j.y, w, col);
                        bone(j.x, j.y, j.ex, j.ey, w * 0.9, col);
                        return j;
                    };

                    // ── Ground shadow (shrinks when airborne) ──
                    const air = this.flying ? 0.55 : 1;
                    ctx.fillStyle = `rgba(0,0,0,${0.42 * air})`;
                    ctx.beginPath();
                    ctx.ellipse(0, 0, 12.5 * air, 4.5 * air, 0, 0, Math.PI * 2);
                    ctx.fill();

                    // ── Boss aura ──
                    if (this.boss && this.vis !== "dragon") {
                        ctx.globalCompositeOperation = "screen";
                        ctx.fillStyle = `rgba(239,68,68,${0.1 + Math.sin(this.frame * 0.1) * 0.1})`;
                        ctx.beginPath();
                        ctx.arc(0, -40, 50, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.globalCompositeOperation = "source-over";
                    }

                    if (this.flying) ctx.translate(0, -70 + Math.sin(this.frame * 0.1) * 12);
                    else if (this.vis === "horse") ctx.translate(0, -18);

                    const isHorse = this.vis === "horse";
                    const shielded = this.vis === "sword_shield" || this.vis === "tower_shield";
                    const meleeBlade = ["sword", "sword_shield", "tower_shield", "spear", "club", "dual"].includes(this.vis);
                    const isCatapult = this.vis === "catapult";
                    const isDragon = this.vis === "dragon";

                    // ── Catapult siege engine ──
                    if (isCatapult) {
                        const arm = lerp(-2.3, -0.5, sw); // throws forward on fire, resets to loaded
                        bone(-18, -5, 16, -5, 5, "#5b3a1a"); // base beam
                        for (const wx of [-12, 10]) {
                            ctx.fillStyle = "#3a2410"; ctx.strokeStyle = "#1f1408"; ctx.lineWidth = 2;
                            ctx.beginPath(); ctx.arc(wx, -2, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                            ctx.strokeStyle = "#6b4423"; ctx.lineWidth = 1.2;
                            ctx.beginPath();
                            ctx.moveTo(wx - 4, -2); ctx.lineTo(wx + 4, -2);
                            ctx.moveTo(wx, -6); ctx.lineTo(wx, 2); ctx.stroke();
                        }
                        bone(-6, -5, 0, -26, 4, "#6b4423"); // A-frame
                        bone(8, -5, 0, -26, 4, "#6b4423");
                        ctx.save();
                        ctx.translate(0, -24);
                        ctx.rotate(arm);
                        bone(0, 0, 30, 0, 3.5, "#8a5a2b"); // throwing arm
                        ctx.fillStyle = "#5b3a1a";
                        ctx.beginPath(); ctx.arc(30, 0, 4.5, 0, Math.PI * 2); ctx.fill();
                        if (sw < 0.3) { // payload loaded
                            ctx.fillStyle = "#475569";
                            ctx.beginPath(); ctx.arc(30, -4, 3.5, 0, Math.PI * 2); ctx.fill();
                        }
                        ctx.restore();
                        ctx.fillStyle = skin; // team pennant
                        ctx.beginPath();
                        ctx.moveTo(0, -26); ctx.lineTo(0, -33); ctx.lineTo(8, -31); ctx.lineTo(0, -29);
                        ctx.closePath(); ctx.fill();
                        ctx.restore();
                        this.drawHp(ctx, cam, 40 * this.scale, -52 * this.scale);
                        this.drawDmg(ctx, cam, dt);
                        return;
                    }

                    // ── Dragon (flying boss) ──
                    if (isDragon) {
                        const flap = Math.sin(this.frame * 0.18) * 0.5;
                        ctx.lineCap = "round";
                        // Tail
                        ctx.strokeStyle = shade(skin, -0.18); ctx.lineWidth = 6;
                        ctx.beginPath();
                        ctx.moveTo(-14, -38);
                        ctx.quadraticCurveTo(-34, -34, -42, -47);
                        ctx.stroke();
                        ctx.fillStyle = "#fde68a"; // tail barb
                        ctx.beginPath();
                        ctx.moveTo(-42, -47); ctx.lineTo(-48, -50); ctx.lineTo(-44, -43); ctx.closePath(); ctx.fill();
                        // Wings (behind)
                        ctx.fillStyle = toRgba(shade(skin, -0.28), 0.92);
                        ctx.strokeStyle = toRgba("#0b1020", 0.5); ctx.lineWidth = 1;
                        for (const dir of [1, -1]) {
                            ctx.save();
                            ctx.translate(-4, -45);
                            ctx.rotate(dir * (1.0 + flap));
                            ctx.beginPath();
                            ctx.moveTo(0, 0);
                            ctx.quadraticCurveTo(22, -22, 42, -9);
                            ctx.lineTo(35, -2); ctx.lineTo(42, 4); ctx.lineTo(31, 6);
                            ctx.lineTo(35, 13); ctx.lineTo(20, 8);
                            ctx.quadraticCurveTo(10, 6, 0, 0);
                            ctx.closePath(); ctx.fill(); ctx.stroke();
                            ctx.restore();
                        }
                        // Body
                        const dbg = ctx.createLinearGradient(0, -54, 0, -28);
                        dbg.addColorStop(0, shade(skin, 0.22));
                        dbg.addColorStop(1, shade(skin, -0.28));
                        ctx.fillStyle = dbg;
                        ctx.beginPath(); ctx.ellipse(-2, -40, 19, 12, -0.2, 0, Math.PI * 2); ctx.fill();
                        // Legs
                        ctx.strokeStyle = shade(skin, -0.2); ctx.lineWidth = 4;
                        bone(3, -30, 7, -19, 4, shade(skin, -0.2));
                        bone(-9, -30, -7, -21, 4, shade(skin, -0.2));
                        // Neck + head
                        ctx.fillStyle = shade(skin, 0.05);
                        ctx.beginPath();
                        ctx.moveTo(10, -46);
                        ctx.quadraticCurveTo(24, -52, 30, -58);
                        ctx.lineTo(38, -56);
                        ctx.quadraticCurveTo(40, -50, 30, -47);
                        ctx.quadraticCurveTo(20, -43, 12, -39);
                        ctx.closePath(); ctx.fill();
                        ctx.fillStyle = shade(skin, 0.12);
                        ctx.beginPath(); ctx.ellipse(34, -56, 7, 5, -0.3, 0, Math.PI * 2); ctx.fill();
                        ctx.beginPath(); // snout
                        ctx.moveTo(39, -57); ctx.lineTo(45, -55); ctx.lineTo(39, -53); ctx.closePath(); ctx.fill();
                        ctx.strokeStyle = "#fde68a"; ctx.lineWidth = 2; // horns
                        ctx.beginPath(); ctx.moveTo(32, -61); ctx.lineTo(29, -68); ctx.stroke();
                        ctx.beginPath(); ctx.moveTo(36, -61); ctx.lineTo(35, -67); ctx.stroke();
                        ctx.globalCompositeOperation = "screen"; // eye glow
                        ctx.fillStyle = "#fbbf24";
                        ctx.beginPath(); ctx.arc(35, -57, 1.7, 0, Math.PI * 2); ctx.fill();
                        ctx.globalCompositeOperation = "source-over";
                        if (this.atk > 0.15 || this.state === "attack") { // fire breath
                            ctx.globalCompositeOperation = "screen";
                            const fl = ctx.createRadialGradient(46, -54, 0, 52, -54, 16);
                            fl.addColorStop(0, "#fff7ed");
                            fl.addColorStop(0.4, "#f97316");
                            fl.addColorStop(1, toRgba("#f97316", 0));
                            ctx.fillStyle = fl;
                            ctx.beginPath(); ctx.arc(51, -54, 13, 0, Math.PI * 2); ctx.fill();
                            ctx.globalCompositeOperation = "source-over";
                        }
                        ctx.restore();
                        this.drawHp(ctx, cam, 56 * this.scale, -84 * this.scale);
                        this.drawDmg(ctx, cam, dt);
                        return;
                    }

                    // ── Mount (horse) ──
                    if (isHorse) {
                        const hg = gp * 1.3;
                        const GY = 18; // ground level in this (raised) frame
                        const legD = "#4a2f17", legL = "#7a5230";
                        ctx.lineCap = "round";
                        // far legs (drawn first, darker)
                        bone(-15, 2, -15 + Math.sin(hg) * 6, GY, 4, legD);
                        bone(12, 2, 12 + Math.sin(hg + Math.PI) * 6, GY, 4, legD);
                        // body
                        const bg = ctx.createLinearGradient(0, -14, 0, 6);
                        bg.addColorStop(0, "#8a5a2b");
                        bg.addColorStop(1, "#5b3a1a");
                        ctx.fillStyle = bg;
                        ctx.beginPath(); ctx.ellipse(-2, -4, 22, 10, 0, 0, Math.PI * 2); ctx.fill();
                        ctx.beginPath(); ctx.ellipse(-18, -3, 7, 9, 0, 0, Math.PI * 2); ctx.fill(); // haunch
                        ctx.beginPath(); ctx.ellipse(16, -5, 8, 8, 0, 0, Math.PI * 2); ctx.fill();  // chest
                        // neck + head
                        ctx.fillStyle = "#7a5230";
                        ctx.beginPath();
                        ctx.moveTo(16, -8);
                        ctx.quadraticCurveTo(28, -14, 30, -26);
                        ctx.lineTo(36, -27);
                        ctx.quadraticCurveTo(36, -22, 33, -18);
                        ctx.quadraticCurveTo(26, -8, 20, -4);
                        ctx.closePath(); ctx.fill();
                        ctx.fillStyle = "#5b3a1a";
                        ctx.beginPath(); ctx.ellipse(35, -25, 4, 3, -0.4, 0, Math.PI * 2); ctx.fill(); // muzzle
                        ctx.beginPath(); ctx.moveTo(29, -26); ctx.lineTo(28, -31); ctx.lineTo(32, -27); ctx.closePath(); ctx.fill(); // ear
                        ctx.fillStyle = "#1f1408";
                        ctx.beginPath(); ctx.arc(32, -24, 1, 0, Math.PI * 2); ctx.fill(); // eye
                        ctx.strokeStyle = "#3a2410"; ctx.lineWidth = 2.5; // mane
                        ctx.beginPath(); ctx.moveTo(18, -10); ctx.quadraticCurveTo(26, -20, 29, -26); ctx.stroke();
                        ctx.lineWidth = 3.5; // tail
                        ctx.beginPath(); ctx.moveTo(-22, -6); ctx.quadraticCurveTo(-34, -2, -32, 14); ctx.stroke();
                        ctx.lineWidth = 2;
                        ctx.beginPath(); ctx.moveTo(-22, -4); ctx.quadraticCurveTo(-30, 4, -27, 14); ctx.stroke();
                        // saddle blanket (team color)
                        ctx.fillStyle = skin;
                        ctx.beginPath();
                        ctx.moveTo(-13, -12); ctx.lineTo(8, -13); ctx.lineTo(6, -6); ctx.lineTo(-13, -5);
                        ctx.closePath(); ctx.fill();
                        // near legs (lighter, in front)
                        bone(-10, 2, -10 + Math.sin(hg + Math.PI) * 6, GY, 4.2, legL);
                        bone(14, 2, 14 + Math.sin(hg) * 6, GY, 4.2, legL);
                        // draped rider legs over near side
                        const stir = Math.sin(gp) * 1.2;
                        bone(0, -16, 8, 0 + stir, 3.6, limb);
                        bone(8, 0 + stir, 7, 9, 3.2, limb);
                    }

                    // ── Back leg (behind torso) ──
                    if (!isHorse && !this.flying) {
                        const stride = walking ? 8.5 : 0;
                        const bx = walking ? Math.sin(bPh) * stride : -5;
                        const by = -(walking ? Math.max(0, Math.cos(bPh)) * 5 : 0);
                        const j = limb2(0, hipY, bx, by, 11, 12, -1, 4, limbDark);
                        bone(j.ex, j.ey, j.ex + 4, j.ey, 3.6, limbDark);
                    } else if (this.flying) {
                        // tucked dangling legs
                        bone(0, hipY, -3, hipY + 14, 3.5, limbDark);
                        bone(0, hipY, 3, hipY + 16, 3.5, limb);
                    }

                    // ════ Upper-body group (leans/tilts) ════
                    ctx.save();
                    ctx.translate(0, hipY);
                    ctx.rotate(lean);
                    ctx.translate(0, -hipY);

                    // Wings (flying) — behind body
                    if (this.flying) {
                        const flap = Math.sin(this.frame * 0.3) * 0.55;
                        ctx.fillStyle = toRgba(skin, 0.8);
                        ctx.strokeStyle = toRgba("#0b1020", 0.5);
                        ctx.lineWidth = 1;
                        for (const dir of [1, -1]) {
                            ctx.save();
                            ctx.translate(-1, shoulderY + 3);
                            ctx.rotate(dir * (2.5 + flap) - 0.4);
                            ctx.beginPath();
                            ctx.moveTo(0, 0);
                            ctx.quadraticCurveTo(16, -10, 26, -2);
                            ctx.quadraticCurveTo(16, 4, 0, 4);
                            ctx.closePath();
                            ctx.fill();
                            ctx.stroke();
                            ctx.restore();
                        }
                    }

                    // Cape (mage / staff / boss)
                    if (this.vis === "mage" || this.boss || this.vis === "staff") {
                        const capeSway = Math.sin(this.frame * 0.1) * 4 + swing * 6;
                        const cg = ctx.createLinearGradient(0, shoulderY, 0, hipY + 18);
                        cg.addColorStop(0, shade(skin, 0.1));
                        cg.addColorStop(1, shade(skin, -0.35));
                        ctx.fillStyle = cg;
                        ctx.globalAlpha = 0.92;
                        ctx.beginPath();
                        ctx.moveTo(-3, shoulderY + 2);
                        ctx.quadraticCurveTo(-15 + capeSway, shoulderY + 16, -11 + capeSway, hipY + 16);
                        ctx.quadraticCurveTo(0, hipY + 20, 5, hipY + 12);
                        ctx.lineTo(4, shoulderY + 4);
                        ctx.closePath();
                        ctx.fill();
                        ctx.globalAlpha = 1;
                    }

                    // ── Back arm ──
                    const shX = 0, shY = shoulderY + 3;
                    let bhx, bhy;
                    if (shielded) { bhx = 8; bhy = shoulderY + 9; }
                    else if (this.vis === "bow" || this.vis === "crossbow") {
                        const pull = this.atkKind === 2 ? this.atk : 0;
                        bhx = lerp(4, -7, pull); bhy = shoulderY + 8;
                    } else { bhx = -6 + (walking ? Math.sin(fPh) * 5 : 0); bhy = shoulderY + 12; }
                    limb2(shX, shY, bhx, bhy, 9, 10, 1, 3.4, limbDark);
                    ctx.fillStyle = limbDark;
                    ctx.beginPath(); ctx.arc(bhx, bhy, 2.2, 0, Math.PI * 2); ctx.fill();

                    // ── Torso (tapered tunic, shaded) ──
                    let tg;
                    if (lowQ) { tg = shade(skin, -0.08); }
                    else {
                        tg = ctx.createLinearGradient(0, shoulderY, 0, hipY);
                        tg.addColorStop(0, shade(skin, 0.18));
                        tg.addColorStop(1, shade(skin, -0.28));
                    }
                    ctx.fillStyle = tg;
                    ctx.beginPath();
                    ctx.moveTo(-3.4, shoulderY);
                    ctx.quadraticCurveTo(-4.2, (shoulderY + hipY) / 2, -2.4, hipY);
                    ctx.lineTo(2.4, hipY);
                    ctx.quadraticCurveTo(4.2, (shoulderY + hipY) / 2, 3.4, shoulderY);
                    ctx.closePath();
                    ctx.fill();
                    ctx.strokeStyle = toRgba("#ffffff", 0.22);
                    ctx.lineWidth = 1.1;
                    ctx.beginPath();
                    ctx.moveTo(3.4, shoulderY);
                    ctx.quadraticCurveTo(4.2, (shoulderY + hipY) / 2, 2.4, hipY);
                    ctx.stroke();
                    // shoulder cap
                    ctx.fillStyle = shade(skin, 0.05);
                    ctx.beginPath(); ctx.arc(0, shoulderY + 1, 4, 0, Math.PI * 2); ctx.fill();

                    // ── Shield (drawn in front of torso) ──
                    if (shielded) {
                        ctx.save();
                        ctx.translate(bhx, bhy);
                        if (this.vis === "tower_shield") {
                            const sg = ctx.createLinearGradient(-3, 0, 7, 0);
                            sg.addColorStop(0, "#8a98ab");
                            sg.addColorStop(1, "#4a5667");
                            ctx.fillStyle = sg;
                            ctx.fillRect(-3, -20, 9, 40);
                            ctx.strokeStyle = "#cbd5e1";
                            ctx.lineWidth = 1.5;
                            ctx.strokeRect(-3, -20, 9, 40);
                            ctx.fillStyle = skin;
                            ctx.fillRect(-0.5, -7, 4, 16);
                            ctx.strokeStyle = toRgba("#fff", 0.45);
                            ctx.lineWidth = 1;
                            ctx.beginPath(); ctx.moveTo(-1.5, -18); ctx.lineTo(-1.5, 18); ctx.stroke();
                        } else {
                            const sg = ctx.createRadialGradient(-3, -3, 1, 0, 0, 11);
                            sg.addColorStop(0, "#aebccd");
                            sg.addColorStop(0.7, "#6b7a8d");
                            sg.addColorStop(1, "#3b4757");
                            ctx.fillStyle = sg;
                            ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
                            ctx.strokeStyle = "#cbd5e1";
                            ctx.lineWidth = 1.8;
                            ctx.stroke();
                            ctx.fillStyle = skin;
                            ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
                            ctx.fillStyle = "#fde68a";
                            ctx.beginPath(); ctx.arc(-1, -1, 1.5, 0, Math.PI * 2); ctx.fill();
                        }
                        ctx.restore();
                    }

                    // ── Head + helmet ──
                    ctx.save();
                    ctx.translate(0, headCY);
                    let hg2;
                    if (lowQ) { hg2 = shade(skin, 0.05); }
                    else {
                        hg2 = ctx.createRadialGradient(-2.5, -2.5, 1, 0, 0, headR);
                        hg2.addColorStop(0, shade(skin, 0.3));
                        hg2.addColorStop(1, shade(skin, -0.18));
                    }
                    ctx.fillStyle = hg2;
                    ctx.beginPath(); ctx.arc(0, 0, headR, 0, Math.PI * 2); ctx.fill();
                    ctx.strokeStyle = toRgba("#ffffff", 0.3);
                    ctx.lineWidth = 1.2;
                    ctx.beginPath(); ctx.arc(0, 0, headR - 0.6, -2.2, -0.4); ctx.stroke();

                    const armored = ["sword", "sword_shield", "tower_shield", "spear"].includes(this.vis);
                    if (armored) {
                        ctx.fillStyle = "#94a3b8";
                        ctx.beginPath(); ctx.arc(0, -0.5, headR + 0.6, Math.PI, 0); ctx.closePath(); ctx.fill();
                        ctx.strokeStyle = "#475569"; ctx.lineWidth = 1; ctx.stroke();
                        ctx.strokeStyle = "#334155"; ctx.lineWidth = 1.5;
                        ctx.beginPath(); ctx.moveTo(2, -1); ctx.lineTo(headR - 0.5, -1); ctx.stroke();
                        // Transverse helmet crest (sits along the dome, sweeps back)
                        ctx.fillStyle = skin;
                        ctx.beginPath();
                        ctx.moveTo(-6, -headR - 0.5);
                        ctx.quadraticCurveTo(-1, -headR - 9, 5, -headR - 1.5);
                        ctx.quadraticCurveTo(-1, -headR - 4, -6, -headR - 0.5);
                        ctx.closePath();
                        ctx.fill();
                        ctx.strokeStyle = shade(skin, -0.3); ctx.lineWidth = 0.7; ctx.stroke();
                    } else if (this.vis === "bow" || this.vis === "crossbow") {
                        ctx.fillStyle = "#3f6212";
                        ctx.beginPath(); ctx.arc(0, -1, headR + 0.4, Math.PI, 0); ctx.closePath(); ctx.fill();
                    } else if (this.vis === "mage" || this.vis === "staff") {
                        ctx.fillStyle = shade(skin, -0.05);
                        ctx.beginPath();
                        ctx.moveTo(-headR - 1, 2);
                        ctx.quadraticCurveTo(0, -headR - 11, headR + 1, 2);
                        ctx.quadraticCurveTo(0, 1, -headR - 1, 2);
                        ctx.fill();
                    }
                    // Eye (front side)
                    ctx.fillStyle = "#ffffff";
                    ctx.beginPath(); ctx.arc(4, -1.2, 2.3, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = "#0b1020";
                    ctx.beginPath(); ctx.arc(4.7, -1.2 + hurt * 0.5, 1.1, 0, Math.PI * 2); ctx.fill();
                    if (hurt > 0.3) {
                        ctx.strokeStyle = "#0b1020"; ctx.lineWidth = 1;
                        ctx.beginPath(); ctx.arc(3, 4, 2, -0.3, Math.PI + 0.3); ctx.stroke();
                    }
                    ctx.restore(); // head

                    // ── Front arm + weapon ──
                    let fhx, fhy;
                    if (this.vis === "bow" || this.vis === "crossbow") {
                        fhx = 13; fhy = shoulderY + 7;
                    } else if (this.vis === "staff" || this.vis === "mage") {
                        fhx = 9 + strike * 3; fhy = shoulderY + 8 - strike * 7;
                    } else {
                        const restHx = 10, restHy = shoulderY + 9;
                        const wupHx = -1, wupHy = shoulderY - 7;
                        const strHx = 18, strHy = shoulderY + 13;
                        if (swing < 0) { const k = -swing; fhx = lerp(restHx, wupHx, k); fhy = lerp(restHy, wupHy, k); }
                        else { const k = swing; fhx = lerp(restHx, strHx, k); fhy = lerp(restHy, strHy, k); }
                    }

                    // Weapon angle (melee)
                    let wa;
                    if (swing < 0) { const k = -swing; wa = lerp(-0.7, -2.35, k); }
                    else { const k = swing; wa = lerp(-0.7, 0.6, k); }

                    // Weapon-tip motion trail
                    if (this.atkKind === 1 && meleeBlade && Math.abs(swing) > 0.06 && q >= 1) {
                        const L = this.vis === "spear" ? 34 : this.vis === "club" ? 18 : 20;
                        this.wTrail.push({ x: fhx + Math.cos(wa) * L, y: fhy + Math.sin(wa) * L, l: 6 });
                        if (this.wTrail.length > 12) this.wTrail.shift();
                    }
                    for (let i = this.wTrail.length - 1; i >= 0; i--) {
                        this.wTrail[i].l -= dt;
                        if (this.wTrail[i].l <= 0) this.wTrail.splice(i, 1);
                    }
                    if (this.wTrail.length > 1) {
                        ctx.save();
                        ctx.globalCompositeOperation = "screen";
                        ctx.lineCap = "round";
                        for (let i = 1; i < this.wTrail.length; i++) {
                            const a = this.wTrail[i].l / 6;
                            ctx.strokeStyle = toRgba("#dbeafe", 0.5 * a);
                            ctx.lineWidth = 5 * a;
                            ctx.beginPath();
                            ctx.moveTo(this.wTrail[i - 1].x, this.wTrail[i - 1].y);
                            ctx.lineTo(this.wTrail[i].x, this.wTrail[i].y);
                            ctx.stroke();
                        }
                        ctx.restore();
                    }

                    // Front upper arm/forearm
                    limb2(shX, shY, fhx, fhy, 9, 10, -1, 3.5, limb);
                    ctx.fillStyle = limb;
                    ctx.beginPath(); ctx.arc(fhx, fhy, 2.4, 0, Math.PI * 2); ctx.fill();

                    // Weapon by type
                    if (this.vis === "bow") {
                        ctx.strokeStyle = "#b45309";
                        ctx.lineWidth = 2.6;
                        ctx.beginPath(); ctx.arc(fhx, fhy, 13, -1.15, 1.15); ctx.stroke();
                        const tx = fhx + Math.cos(-1.15) * 13, ty = fhy + Math.sin(-1.15) * 13;
                        const bx2 = fhx + Math.cos(1.15) * 13, by2 = fhy + Math.sin(1.15) * 13;
                        ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(tx, ty); ctx.lineTo(bhx, bhy); ctx.lineTo(bx2, by2); ctx.stroke();
                        if (this.atk > 0.25) {
                            ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 1.8;
                            ctx.beginPath(); ctx.moveTo(bhx, bhy); ctx.lineTo(fhx + 6, fhy); ctx.stroke();
                            ctx.fillStyle = "#cbd5e1";
                            ctx.beginPath();
                            ctx.moveTo(fhx + 7, fhy); ctx.lineTo(fhx + 2, fhy - 2); ctx.lineTo(fhx + 2, fhy + 2);
                            ctx.closePath(); ctx.fill();
                        }
                    } else if (this.vis === "crossbow") {
                        bone(fhx - 5, fhy, fhx + 15, fhy, 3, "#78350f");
                        ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 2;
                        ctx.beginPath(); ctx.moveTo(fhx + 12, fhy - 9); ctx.lineTo(fhx + 12, fhy + 9); ctx.stroke();
                        ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 0.8;
                        ctx.beginPath(); ctx.moveTo(fhx + 12, fhy - 9); ctx.lineTo(fhx - 4, fhy); ctx.lineTo(fhx + 12, fhy + 9); ctx.stroke();
                    } else if (this.vis === "staff" || this.vis === "mage") {
                        const orbX = fhx + 3, orbY = fhy - 22;
                        ctx.strokeStyle = "#6b4423"; ctx.lineWidth = 3;
                        bone(fhx, fhy + 3, orbX, orbY, 3, "#6b4423");
                        const glow = team ? "#60a5fa" : "#c084fc";
                        ctx.globalCompositeOperation = "screen";
                        const og = ctx.createRadialGradient(orbX, orbY, 0, orbX, orbY, 10);
                        og.addColorStop(0, "#ffffff");
                        og.addColorStop(0.4, glow);
                        og.addColorStop(1, toRgba(glow, 0));
                        ctx.fillStyle = og;
                        const r = 9 + (this.atk > 0 ? Math.random() * 4 : Math.sin(this.frame * 0.15) * 1.5);
                        ctx.beginPath(); ctx.arc(orbX, orbY, r, 0, Math.PI * 2); ctx.fill();
                        ctx.globalCompositeOperation = "source-over";
                        ctx.fillStyle = "#ffffff";
                        ctx.beginPath(); ctx.arc(orbX, orbY, 3, 0, Math.PI * 2); ctx.fill();
                    } else if (meleeBlade) {
                        ctx.save();
                        ctx.translate(fhx, fhy);
                        ctx.rotate(wa);
                        if (this.vis === "spear") {
                            bone(-7, 0, 30, 0, 2.6, "#92400e");
                            ctx.fillStyle = "#e2e8f0";
                            ctx.beginPath();
                            ctx.moveTo(34, 0); ctx.lineTo(27, -3.2); ctx.lineTo(28, 0); ctx.lineTo(27, 3.2);
                            ctx.closePath(); ctx.fill();
                        } else if (this.vis === "club") {
                            bone(-4, 0, 9, 0, 3.4, "#6b4423");
                            const cg2 = ctx.createRadialGradient(15, -1, 1, 16, 0, 8);
                            cg2.addColorStop(0, "#a16207");
                            cg2.addColorStop(1, "#5b3a1a");
                            ctx.fillStyle = cg2;
                            ctx.beginPath(); ctx.ellipse(16, 0, 7, 8, 0, 0, Math.PI * 2); ctx.fill();
                            ctx.fillStyle = "#3a2410";
                            for (const a of [-0.7, 0, 0.7]) {
                                ctx.beginPath();
                                ctx.arc(16 + Math.cos(a) * 5, Math.sin(a) * 6, 1.2, 0, Math.PI * 2);
                                ctx.fill();
                            }
                        } else {
                            // sword / sword_shield / tower_shield (short sword) / dual
                            const L = this.vis === "tower_shield" ? 15 : this.vis === "dual" ? 16 : 20;
                            bone(-4, 0, 0, 0, 3, "#78350f"); // grip
                            const bg2 = ctx.createLinearGradient(0, 0, L, 0);
                            bg2.addColorStop(0, "#9aa6b5");
                            bg2.addColorStop(0.6, "#e5e7eb");
                            bg2.addColorStop(1, "#ffffff");
                            ctx.strokeStyle = bg2; ctx.lineWidth = 3.2;
                            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L, 0); ctx.stroke();
                            ctx.strokeStyle = toRgba("#ffffff", 0.85); ctx.lineWidth = 0.9;
                            ctx.beginPath(); ctx.moveTo(L * 0.4, -0.7); ctx.lineTo(L, -0.4); ctx.stroke();
                            ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 3;
                            ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(0, 4); ctx.stroke();
                            ctx.fillStyle = "#b45309";
                            ctx.beginPath(); ctx.arc(-4.5, 0, 1.8, 0, Math.PI * 2); ctx.fill();
                        }
                        ctx.restore();

                        // dual second blade on the back hand
                        if (this.vis === "dual") {
                            ctx.save();
                            ctx.translate(bhx, bhy);
                            ctx.rotate(2.4 - swing * 1.5);
                            bone(-3, 0, 0, 0, 3, "#78350f");
                            ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 2.8;
                            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(14, 0); ctx.stroke();
                            ctx.restore();
                        }
                    } else if (isHorse) {
                        // Couched cavalry lance
                        ctx.save();
                        ctx.translate(fhx, fhy);
                        ctx.rotate(-0.12 + swing * 0.3);
                        bone(-8, 0, 42, 0, 3, "#6b4423");
                        ctx.fillStyle = "#cbd5e1";
                        ctx.beginPath();
                        ctx.moveTo(42, 0); ctx.lineTo(34, -3.2); ctx.lineTo(34, 3.2);
                        ctx.closePath(); ctx.fill();
                        ctx.fillStyle = skin; // pennant
                        ctx.beginPath();
                        ctx.moveTo(28, 0); ctx.lineTo(28, -7); ctx.lineTo(37, -3); ctx.closePath();
                        ctx.fill();
                        ctx.restore();
                    }

                    // ── Hit flash overlay (additive) ──
                    if (flash > 0) {
                        ctx.globalCompositeOperation = "screen";
                        ctx.globalAlpha = flash * 0.55;
                        ctx.fillStyle = "#ffffff";
                        ctx.beginPath();
                        ctx.ellipse(0, (shoulderY + hipY) / 2, 7, 14, 0, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.beginPath();
                        ctx.arc(0, headCY, headR + 1, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.globalAlpha = 1;
                        ctx.globalCompositeOperation = "source-over";
                    }

                    ctx.restore(); // upper-body group

                    // ── Front leg (in front of torso) ──
                    if (!isHorse && !this.flying) {
                        const stride = walking ? 8.5 : 0;
                        const fx = walking ? Math.sin(fPh) * stride : 4;
                        const fy = -(walking ? Math.max(0, Math.cos(fPh)) * 5 : 0);
                        const j = limb2(0, hipY, fx, fy, 11, 12, -1, 4.2, limb);
                        bone(j.ex, j.ey, j.ex + 4.5, j.ey, 3.8, limb);
                    }

                    // ── Boss crown ──
                    if (this.boss) {
                        ctx.fillStyle = "#fbbf24";
                        ctx.strokeStyle = "#b45309";
                        ctx.lineWidth = 1.2;
                        ctx.beginPath();
                        ctx.moveTo(-10, headCY - 9);
                        ctx.lineTo(-6, headCY - 18);
                        ctx.lineTo(-2, headCY - 11);
                        ctx.lineTo(0, headCY - 20);
                        ctx.lineTo(2, headCY - 11);
                        ctx.lineTo(6, headCY - 18);
                        ctx.lineTo(10, headCY - 9);
                        ctx.closePath();
                        ctx.fill();
                        ctx.stroke();
                    }

                    ctx.restore(); // root transform

                    this.drawHp(ctx, cam, 35 * this.scale, -75 * this.scale);
                    // Level star badge
                    if (this.team === TEAMS.PLAYER && this.level > 1 && this.active) {
                        const pL = cam.toScreen(this.x, this.y);
                        ctx.save();
                        ctx.fillStyle = '#fbbf24';
                        ctx.shadowBlur = 8; ctx.shadowColor = '#fbbf24';
                        ctx.font = `bold ${10 * cam.z}px system-ui`;
                        ctx.textAlign = 'center';
                        ctx.fillText('★'.repeat(this.level - 1), pL.x, pL.y - (82 * this.scale + 2) * cam.z);
                        ctx.shadowBlur = 0; ctx.restore();
                    }
                    this.drawDmg(ctx, cam, dt);
                }
            }

            // --- SYSTEMS ---
