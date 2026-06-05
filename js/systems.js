            class AudioEngine {
                constructor() {
                    this.ctx = null;
                    this.initDone = false;
                    this.vols = { sound: 0.7, music: 0.4 };
                }
                init() {
                    if (this.initDone) return;
                    const AC = window.AudioContext || window.webkitAudioContext;
                    if (!AC) return;
                    this.ctx = new AC();
                    this.master = this.ctx.createGain();
                    this.master.connect(this.ctx.destination);
                    this.sfx = this.ctx.createGain();
                    this.sfx.connect(this.master);
                    this.bgm = this.ctx.createGain();
                    this.bgm.connect(this.master);
                    this.updateVols();
                    this.initDone = true;
                }
                updateVols() {
                    if (!this.initDone) return;
                    this.sfx.gain.value = this.vols.sound;
                    this.bgm.gain.value = this.vols.music;
                }
                playTone(freq, dur, type, vol, when = 0) {
                    if (!this.initDone || this.vols.sound === 0) return;
                    const t = this.ctx.currentTime + when;
                    const osc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();
                    osc.type = type;
                    osc.frequency.value = freq;
                    gain.gain.setValueAtTime(vol, t);
                    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
                    osc.connect(gain);
                    gain.connect(this.sfx);
                    osc.start(t);
                    osc.stop(t + dur);
                }
                playHit() {
                    this.playTone(150, 0.1, "square", 0.1);
                }
                playShoot() {
                    this.playTone(600, 0.1, "triangle", 0.05);
                }
                playExplosion() {
                    this.playTone(100, 0.4, "sawtooth", 0.2);
                    this.playTone(50, 0.5, "square", 0.2, 0.1);
                }
                playMagic() {
                    this.playTone(800, 0.3, "sine", 0.1);
                    this.playTone(1200, 0.2, "sine", 0.1, 0.1);
                }
                playBuild() {
                    this.playTone(300, 0.15, "sine", 0.1);
                    this.playTone(400, 0.2, "sine", 0.1, 0.15);
                }
                playError() {
                    this.playTone(200, 0.2, "sawtooth", 0.1);
                }
                playCoin() {
                    this.playTone(1200, 0.1, "sine", 0.05);
                }
                startMusic() {
                    if (!this.initDone || this.musicInt) return;
                    const notes = [
                        261.63, 293.66, 329.63, 349.23, 392.0, 440.0,
                    ];
                    this.musicInt = setInterval(() => {
                        if (Math.random() > 0.4 && this.vols.music > 0) {
                            this.playTone(
                                notes[randInt(0, 5)],
                                0.5,
                                "sine",
                                this.vols.music * 0.3,
                                0,
                            );
                            this.playTone(
                                notes[randInt(0, 5)] * 0.5,
                                0.8,
                                "triangle",
                                this.vols.music * 0.15,
                                0,
                            );
                        }
                    }, 600);
                }
                stopMusic() {
                    clearInterval(this.musicInt);
                    this.musicInt = null;
                }
            }

            // --- VISUAL SYSTEMS ---
            class DecalSystem {
                constructor() {
                    this.decals = [];
                }
                add(x, y, type, size) {
                    if (this.decals.length > 200) this.decals.shift();
                    this.decals.push({
                        x,
                        y,
                        type,
                        size,
                        alpha: 0.8,
                        life: 4000,
                    });
                }
                update(dt) {
                    for (let i = this.decals.length - 1; i >= 0; i--) {
                        this.decals[i].life -= dt;
                        if (this.decals[i].life < 100)
                            this.decals[i].alpha *= 0.95;
                        if (this.decals[i].life <= 0) this.decals.splice(i, 1);
                    }
                }
                draw(ctx, cam) {
                    for (const d of this.decals) {
                        const p = cam.toScreen(d.x, d.y);
                        ctx.globalAlpha = d.alpha;
                        if (d.type === "blood") {
                            ctx.fillStyle = "#7f1d1d";
                            ctx.beginPath();
                            ctx.ellipse(
                                p.x,
                                p.y + 2,
                                d.size * cam.z,
                                d.size * 0.4 * cam.z,
                                0,
                                0,
                                Math.PI * 2,
                            );
                            ctx.fill();
                        } else if (d.type === "scorch") {
                            ctx.fillStyle = "#020617";
                            ctx.beginPath();
                            ctx.ellipse(
                                p.x,
                                p.y + 2,
                                d.size * cam.z,
                                d.size * 0.3 * cam.z,
                                0,
                                0,
                                Math.PI * 2,
                            );
                            ctx.fill();
                        }
                    }
                    ctx.globalAlpha = 1;
                }
            }

            class ParticleSystem {
                constructor() {
                    this.p = [];
                }
                emit(x, y, c, color, sp, sz, type) {
                    const q = parseFloat(
                        document.getElementById("particleQuality").value || 1,
                    );
                    c = Math.floor(c * q);
                    for (let i = 0; i < c; i++) {
                        const a = rand(0, Math.PI * 2),
                            s = rand(sp * 0.3, sp);
                        this.p.push({
                            x,
                            y,
                            vx: Math.cos(a) * s,
                            vy: Math.sin(a) * s,
                            life: randInt(20, 50),
                            maxL: 50,
                            col: color,
                            sz: rand(sz * 0.5, sz),
                            type,
                        });
                    }
                }
                update(dt) {
                    for (let i = this.p.length - 1; i >= 0; i--) {
                        let p = this.p[i];
                        p.x += p.vx * dt;
                        p.y += p.vy * dt;
                        if (p.type !== "float") p.vy += 0.2 * dt; // gravity
                        p.life -= dt;
                        if (p.type === "fade" || p.type === "float")
                            p.sz *= Math.pow(0.94, dt);
                        if (p.life <= 0 || p.y > CONFIG.GROUND_Y + 10)
                            this.p.splice(i, 1);
                    }
                }
                draw(ctx, cam) {
                    for (const p of this.p) {
                        const pos = cam.toScreen(p.x, p.y);
                        ctx.globalAlpha = Math.max(0, p.life / p.maxL);
                        ctx.fillStyle = p.col;
                        if (p.type === "float" || p.type === "spark")
                            ctx.globalCompositeOperation = "screen";

                        ctx.beginPath();
                        if (p.type === "spark") {
                            ctx.moveTo(pos.x, pos.y);
                            ctx.lineTo(
                                pos.x - p.vx * 2 * cam.z,
                                pos.y - p.vy * 2 * cam.z,
                            );
                            ctx.strokeStyle = p.col;
                            ctx.lineWidth = p.sz * cam.z;
                            ctx.stroke();
                        } else {
                            ctx.arc(
                                pos.x,
                                pos.y,
                                Math.max(0.1, p.sz * cam.z),
                                0,
                                Math.PI * 2,
                            );
                            ctx.fill();
                        }
                        ctx.globalCompositeOperation = "source-over";
                    }
                    ctx.globalAlpha = 1;
                }
            }

            // Transient combat-feedback effects: weapon-swing crescents,
            // impact shockwave rings, hit flashes and directional spark bursts.
            class EffectSystem {
                constructor() { this.e = []; }
                _q() {
                    const el = document.getElementById("particleQuality");
                    return el ? parseFloat(el.value || 1) : 1;
                }
                slash(x, y, ang, opt = {}) {
                    this.e.push({
                        type: "slash", x, y, ang,
                        len: opt.len || 28, w: opt.w || 5,
                        col: opt.col || "#ffffff",
                        arc: opt.arc != null ? opt.arc : 1.7,
                        life: opt.life || 8, maxL: opt.life || 8,
                    });
                }
                ring(x, y, opt = {}) {
                    this.e.push({
                        type: "ring", x, y,
                        r0: opt.r0 || 4, r1: opt.r1 || 40,
                        col: opt.col || "#ffffff", w: opt.w || 3,
                        life: opt.life || 16, maxL: opt.life || 16,
                    });
                }
                flash(x, y, opt = {}) {
                    this.e.push({
                        type: "flash", x, y,
                        r: opt.r || 28, col: opt.col || "#ffffff",
                        life: opt.life || 7, maxL: opt.life || 7,
                    });
                }
                spark(x, y, ang, opt = {}) {
                    if (this._q() < 1 && Math.random() < 0.5) return;
                    const n = opt.n || 5, spread = opt.spread || 0.6, len = opt.len || 16;
                    const rays = [];
                    for (let k = 0; k < n; k++)
                        rays.push({ a: ang + rand(-spread, spread), L: len * rand(0.55, 1.25) });
                    this.e.push({
                        type: "spark", x, y, rays,
                        col: opt.col || "#fde68a", w: opt.w || 2,
                        life: opt.life || 7, maxL: opt.life || 7,
                    });
                }
                update(dt) {
                    for (let i = this.e.length - 1; i >= 0; i--) {
                        this.e[i].life -= dt;
                        if (this.e[i].life <= 0) this.e.splice(i, 1);
                    }
                }
                draw(ctx, cam) {
                    if (!this.e.length) return;
                    ctx.save();
                    ctx.globalCompositeOperation = "screen";
                    ctx.lineCap = "round";
                    for (const f of this.e) {
                        const a = Math.max(0, f.life / f.maxL); // 1 -> 0
                        const t = 1 - a; // progress 0 -> 1
                        const p = cam.toScreen(f.x, f.y);
                        if (f.type === "slash") {
                            const rad = f.len * cam.z * (0.55 + t * 0.75);
                            const a0 = f.ang - f.arc / 2, a1 = f.ang + f.arc / 2;
                            ctx.globalAlpha = a;
                            ctx.strokeStyle = f.col;
                            ctx.lineWidth = f.w * cam.z * (1 - t * 0.65);
                            ctx.beginPath();
                            ctx.arc(p.x, p.y, rad, a0, a1);
                            ctx.stroke();
                            // bright leading tip
                            ctx.globalAlpha = a * 0.95;
                            ctx.lineWidth = Math.max(0.5, f.w * 0.45 * cam.z);
                            ctx.beginPath();
                            ctx.arc(p.x, p.y, rad, a1 - 0.3, a1);
                            ctx.stroke();
                        } else if (f.type === "ring") {
                            const r = lerp(f.r0, f.r1, t) * cam.z;
                            ctx.globalAlpha = a * a;
                            ctx.strokeStyle = f.col;
                            ctx.lineWidth = Math.max(0.5, f.w * cam.z * a);
                            ctx.beginPath();
                            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                            ctx.stroke();
                        } else if (f.type === "flash") {
                            const r = Math.max(1, f.r * cam.z * (0.5 + t * 0.8));
                            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
                            g.addColorStop(0, toRgba(f.col, 0.85 * a));
                            g.addColorStop(0.5, toRgba(f.col, 0.3 * a));
                            g.addColorStop(1, toRgba(f.col, 0));
                            ctx.fillStyle = g;
                            ctx.beginPath();
                            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                            ctx.fill();
                        } else if (f.type === "spark") {
                            ctx.globalAlpha = a;
                            ctx.strokeStyle = f.col;
                            ctx.lineWidth = f.w * cam.z;
                            for (const r of f.rays) {
                                const L = r.L * cam.z * (0.5 + t * 0.9);
                                ctx.beginPath();
                                ctx.moveTo(p.x, p.y);
                                ctx.lineTo(p.x + Math.cos(r.a) * L, p.y + Math.sin(r.a) * L);
                                ctx.stroke();
                            }
                        }
                    }
                    ctx.globalAlpha = 1;
                    ctx.restore();
                }
            }

            class WeatherSystem {
                constructor() {
                    this.particles = [];
                    this.type = "none";
                }
                set(type) {
                    this.type = type;
                    this.particles = [];
                }
                update(dt, cam) {
                    if (this.type === "none") return;
                    const q = parseFloat(
                        document.getElementById("particleQuality").value || 1,
                    );
                    const count = this.type === "rain" ? 4 * q : 2 * q;

                    for (let i = 0; i < count * dt; i++) {
                        this.particles.push({
                            x:
                                cam.x +
                                rand(-200, window.innerWidth / cam.z + 200),
                            y: cam.y - 100,
                            s: this.type === "rain" ? rand(15, 25) : rand(2, 5),
                            vx: this.type === "rain" ? 2 : rand(-1, 1),
                            sz: this.type === "rain" ? rand(1, 2) : rand(2, 4),
                        });
                    }

                    for (let i = this.particles.length - 1; i >= 0; i--) {
                        let p = this.particles[i];
                        p.x += p.vx * dt;
                        p.y += p.s * dt;
                        if (p.y > CONFIG.GROUND_Y) this.particles.splice(i, 1);
                    }
                }
                draw(ctx, cam) {
                    if (this.type === "none") return;
                    ctx.save();
                    ctx.fillStyle =
                        this.type === "rain"
                            ? "rgba(150,200,255,0.4)"
                            : "rgba(255,255,255,0.6)";
                    for (const p of this.particles) {
                        const pos = cam.toScreen(p.x, p.y);
                        if (this.type === "rain") {
                            ctx.beginPath();
                            ctx.moveTo(pos.x, pos.y);
                            ctx.lineTo(
                                pos.x - p.vx * cam.z,
                                pos.y - p.s * cam.z,
                            );
                            ctx.strokeStyle = ctx.fillStyle;
                            ctx.lineWidth = p.sz * cam.z;
                            ctx.stroke();
                        } else {
                            ctx.beginPath();
                            ctx.arc(pos.x, pos.y, p.sz * cam.z, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    }
                    ctx.restore();
                }
            }

            // --- PROJECTILES & MAGIC ---
            class Projectile {
                constructor(x, y, target, type, dmg, team, aoe, pierce, siege) {
                    this.x = x;
                    this.y = y;
                    this.t = target;
                    this.type = type;
                    this.dmg = dmg;
                    this.team = team;
                    this.active = true;
                    this.trail = [];

                    this.tX = target.x;
                    this.tY = target.y; // Fix #5: Cache coords

                    const def = {
                        arrow: { sp: 12, c: "#cbd5e1", sz: 2, arc: true },
                        bolt: { sp: 16, c: "#94a3b8", sz: 3, arc: false },
                        fireball: {
                            sp: 8,
                            c: "#f97316",
                            sz: 6,
                            aoe: true,
                            glow: true,
                        },
                        rock: {
                            sp: 6,
                            c: "#475569",
                            sz: 12,
                            arc: true,
                            aoe: true,
                        },
                        skull: {
                            sp: 7,
                            c: "#c084fc",
                            sz: 6,
                            glow: true,
                            summon: true,
                        },
                    }[type];

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

                        if (this.arcP >= 1 || this.y >= CONFIG.GROUND_Y) {
                            // Fix #2: Hit properly
                            if (this.t && this.t.hp > 0 && !this.aoe)
                                this.hit(this.t);
                            else this.hitFloor();
                        }
                    } else {
                        this.y += this.vy * dt;
                        if (this.y > CONFIG.GROUND_Y) this.hitFloor();
                    }

                    this.trail.push({ x: this.x, y: this.y });
                    if (this.trail.length > (this.glow ? 10 : 5))
                        this.trail.shift();

                    if (
                        !this.arc &&
                        this.t &&
                        this.t.hp > 0 &&
                        dist(this.x, this.y, this.tX, this.tY) < 30
                    )
                        this.hit(this.t);
                    if (this.x < -200 || this.x > CONFIG.WORLD_WIDTH + 200)
                        this.active = false;
                }
                hitFloor() {
                    this.y = CONFIG.GROUND_Y;
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
                        game.spawnEnemy("skeleton", this.x, CONFIG.GROUND_Y);
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

                    const mult =
                        this.siege && target instanceof Building ? 2 : 1;
                    const d = Math.max(
                        1,
                        this.dmg * mult - (target.armor || 0),
                    );
                    target.takeDamage(d);
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
                            const mult =
                                this.siege && t instanceof Building ? 2 : 1; // Fix #19: Siege logic
                            t.takeDamage(
                                Math.max(
                                    1,
                                    this.dmg * 0.6 * mult - (t.armor || 0),
                                ),
                            );
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
                        CONFIG.GROUND_Y,
                        "scorch",
                        this.aoe * 0.8,
                    );
                    game.shake = Math.min(15, game.shake + this.aoe * 0.15);
                    if (this.aoe > 50) game.audio.playExplosion();
                }
                draw(ctx, cam) {
                    if (!this.active) return;
                    const p = cam.toScreen(this.x, this.y);
                    ctx.fillStyle = this.col;

                    if (this.glow) {
                        ctx.globalCompositeOperation = "screen";
                        ctx.shadowBlur = 20 * cam.z;
                        ctx.shadowColor = this.col;
                    }

                    if (this.type === "arrow" || this.type === "bolt") {
                        ctx.save();
                        ctx.translate(p.x, p.y);
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
                        ctx.arc(p.x, p.y, this.sz * cam.z, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    ctx.shadowBlur = 0;
                    ctx.globalCompositeOperation = "source-over";

                    if (this.trail.length > 1) {
                        ctx.strokeStyle = this.col;
                        ctx.lineWidth = this.sz * 0.6 * cam.z;
                        ctx.globalAlpha = 0.6;
                        if (this.glow) ctx.globalCompositeOperation = "screen";
                        ctx.beginPath();
                        for (let i = 0; i < this.trail.length; i++) {
                            const tp = cam.toScreen(
                                this.trail[i].x,
                                this.trail[i].y,
                            );
                            if (i === 0) ctx.moveTo(tp.x, tp.y);
                            else ctx.lineTo(tp.x, tp.y);
                        }
                        ctx.stroke();
                        ctx.globalAlpha = 1;
                        ctx.globalCompositeOperation = "source-over";
                    }
                }
            }

            // --- ENTITIES ---
