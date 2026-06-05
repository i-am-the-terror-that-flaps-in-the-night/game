            class WaveManager {
                constructor(g, lvl) {
                    this.g = g;
                    this.wvs = JSON.parse(JSON.stringify(LEVELS[lvl].waves));
                    this.cw = 0;
                    this.t = 0;
                    this.tw = this.wvs.length;
                }
                update(dt) {
                    if (this.cw >= this.tw) return;
                    this.t += dt;
                    if (this.t >= this.wvs[this.cw].time * 60) {
                        this.spawn(this.wvs[this.cw]);
                        this.cw++;
                        this.t = 0;
                        this.g.audio.playTone(400, 0.5, "sine", 0.1);
                        this.g.audio.playTone(600, 0.5, "sine", 0.1, 0.2);
                        this.g.notify(`Wave ${this.cw} incoming!`);
                        if (this.cw >= this.tw)
                            setTimeout(
                                () =>
                                    this.g.notify("Final wave! Hold the line!"),
                                2000,
                            );
                    }
                }
                spawn(w) {
                    w.enemies.forEach((gr) => {
                        for (let i = 0; i < gr.c; i++) {
                            setTimeout(
                                () => {
                                    if (this.g.state === "playing")
                                        this.g.spawnEnemy(
                                            gr.t,
                                            CONFIG.WORLD_WIDTH - rand(100, 400),
                                            CONFIG.GROUND_Y,
                                        );
                                },
                                i * 700 + rand(0, 200),
                            );
                        }
                    });
                }
                isComplete() {
                    return this.cw >= this.tw && this.g.enemies.length === 0;
                }
            }

            class EndlessWave {
                constructor(g) {
                    this.g = g;
                    this.wave = 0;
                    this.t = 0;
                    this.int = 600;
                    this.cw = 0;
                    this.tw = Infinity;
                }
                update(dt) {
                    this.t += dt;
                    if (this.t >= this.int) {
                        this.t = 0;
                        this.wave++;
                        this.cw++;
                        this.g.diff = 1 + this.wave * 0.1;
                        this.spawn();
                        const isBoss = this.wave % 6 === 0;
                        if (isBoss) {
                            this.g.audio.playTone(220, 1, "sawtooth", 0.15);
                            this.g.audio.playTone(
                                110,
                                1.2,
                                "sawtooth",
                                0.12,
                                0.2,
                            );
                            this.g.notify(
                                `[BOSS WAVE ${this.wave}] A mighty force approaches!`,
                            );
                            this.g.shake = 15;
                        } else {
                            this.g.audio.playTone(400, 0.5, "sine", 0.1);
                            this.g.notify(
                                `Endless Wave ${this.wave} — Difficulty x${(1 + this.wave * 0.1).toFixed(1)}`,
                            );
                        }
                        this.int = Math.max(330, 760 - this.wave * 9);
                    }
                }
                spawn() {
                    const types = [
                        "rabble",
                        "marauder",
                        "berserker",
                        "shieldman",
                        "archer",
                        "shaman",
                        "ogre",
                        "necromancer",
                    ];
                    const c = Math.floor(5 + this.wave * 2);
                    const maxT = Math.min(
                        types.length - 1,
                        Math.floor(this.wave / 3),
                    ); // Fix #10
                    for (let i = 0; i < c; i++) {
                        setTimeout(() => {
                            if (this.g.state === "playing") {
                                const enemyType =
                                    types[randInt(0, maxT)] || types[0];
                                this.g.spawnEnemy(
                                    enemyType,
                                    CONFIG.WORLD_WIDTH - rand(50, 300),
                                    CONFIG.GROUND_Y,
                                );
                            }
                        }, i * 500);
                    }
                    if (this.wave % 6 === 0)
                        setTimeout(
                            () => {
                                if (this.g.state === "playing")
                                    this.g.spawnEnemy(
                                        "dragon",
                                        CONFIG.WORLD_WIDTH - 150,
                                        CONFIG.GROUND_Y,
                                    );
                            },
                            c * 500 + 1000,
                        );
                }
                isComplete() {
                    return false;
                }
            }


            // ─── ACHIEVEMENTS ────────────────────────────────────────────────
            const ACHIEVEMENTS = [
                { id: 'first_blood',   name: 'First Blood',     icon: '⚔️',  desc: 'Slay your first enemy.' },
                { id: 'century',       name: 'Century',         icon: '💀',  desc: 'Kill 100 enemies in one session.' },
                { id: 'dragon_slayer', name: 'Dragon Slayer',   icon: '🐉',  desc: 'Defeat a Dragon in battle.' },
                { id: 'last_stand',    name: 'Last Stand',      icon: '🏰',  desc: 'Win a level with castle below 15% HP.' },
                { id: 'tech_master',   name: 'Tech Master',     icon: '🔬',  desc: 'Research 5 technologies.' },
                { id: 'wave_10',       name: 'Endured',         icon: '🌊',  desc: 'Survive 10 waves in Endless mode.' },
                { id: 'rich',          name: 'War Profiteer',   icon: '💰',  desc: 'Earn 1500 total gold in one session.' },
                { id: 'holy_order',    name: 'Holy Order',      icon: '✨',  desc: 'Field 3 Paladins simultaneously.' },
                { id: 'max_pop',       name: 'Total War',       icon: '⚔️',  desc: 'Reach maximum population cap.' },
                { id: 'veteran',       name: 'Veteran',         icon: '⭐',  desc: 'Promote a unit to Level 3.' },
            ];

            class AchievementSystem {
                constructor(g) {
                    this.g = g;
                    try { this.unlocked = new Set(JSON.parse(localStorage.getItem('sd_ach_v2') || '[]')); }
                    catch(e) { this.unlocked = new Set(); }
                }
                tryUnlock(id) {
                    if (this.unlocked.has(id)) return;
                    const a = ACHIEVEMENTS.find(x => x.id === id);
                    if (!a) return;
                    this.unlocked.add(id);
                    try { localStorage.setItem('sd_ach_v2', JSON.stringify([...this.unlocked])); } catch(e) {}
                    const area = document.getElementById('notificationArea');
                    if (!area) return;
                    const d = document.createElement('div');
                    d.className = 'notification';
                    d.style.borderLeftColor = 'var(--gold)';
                    d.style.background = 'rgba(251,191,36,0.08)';
                    d.innerHTML = `${a.icon} <strong style="color:var(--gold)">Achievement!</strong> ${a.name}`;
                    area.appendChild(d);
                    setTimeout(() => { if (d.parentNode) d.remove(); }, 5000);
                }
                check() {
                    const g = this.g;
                    if (g.stats.kills >= 1) this.tryUnlock('first_blood');
                    if (g.stats.kills >= 100) this.tryUnlock('century');
                    if (g._dragonKilled) this.tryUnlock('dragon_slayer');
                    if (g.techs.size >= 5) this.tryUnlock('tech_master');
                    if (g.mode === 'endless' && g.waveM && g.waveM.wave >= 10) this.tryUnlock('wave_10');
                    if (g.stats.gold >= 1500) this.tryUnlock('rich');
                    const pals = g.units.filter(u => u.type === 'paladin' && u.hp > 0).length;
                    if (pals >= 3) this.tryUnlock('holy_order');
                    if (g.pop >= g.maxPop && g.maxPop >= 20) this.tryUnlock('max_pop');
                    if (g.units.some(u => u.level >= 3)) this.tryUnlock('veteran');
                }
                render() {
                    const grid = document.getElementById('achievementsGrid');
                    const prog = document.getElementById('achProgress');
                    if (!grid) return;
                    grid.innerHTML = '';
                    ACHIEVEMENTS.forEach(a => {
                        const got = this.unlocked.has(a.id);
                        grid.innerHTML += `<div class="ach-item ${got ? 'unlocked' : 'ach-locked'}">
                            <span class="ach-icon">${a.icon}</span>
                            <div><div class="ach-name">${a.name}</div><div class="ach-desc">${a.desc}</div></div>
                        </div>`;
                    });
                    if (prog) prog.textContent = `${this.unlocked.size} / ${ACHIEVEMENTS.length} Unlocked`;
                }
            }

