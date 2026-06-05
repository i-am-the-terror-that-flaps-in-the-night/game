            class Game {
                constructor() {
                    this.canvas = document.getElementById("gameCanvas");
                    this.ctx = this.canvas.getContext("2d");
                    this.resize();
                    window.addEventListener("resize", () => this.resize());

                    this.audio = new AudioEngine();
                    this.camera = new Camera();
                    this.particles = new ParticleSystem();
                    this.fx = new EffectSystem();
                    this.decals = new DecalSystem();
                    this.weather = new WeatherSystem();
                    this.spells = new SpellManager();

                    this.state = "menu";
                    this.level = 0;
                    this.mode = "campaign";
                    this.diff = 1;
                    this.ts = 1;
                    this.gold = 0;
                    this.iron = 0;
                    this.crystal = 0;
                    this.pop = 0;
                    this.maxPop = 20;
                    this.autoQueue = {};
                    this.autoTimer = 0;
                    this.autoIndex = 0;

                    this.units = [];
                    this.enemies = [];
                    this.buildings = [];
                    this.projectiles = [];
                    this.upgrades = {};
                    this.techs = new Set();
                    this.unlocked = {
                        u: new Set([
                            "militia",
                            "swordsman",
                            "spearman",
                            "archer",
                            "cleric",
                            "knight",
                            "mage",
                            "catapult",
                            "paladin",
                        ]),
                        b: new Set([
                            "castle",
                            "mine",
                            "tower",
                            "wall",
                            "barracks",
                            "academy",
                            "archery",
                            "obelisk",
                            "forge",
                        ]),
                    };

                    this.stats = { kills: 0, gold: 0, loss: 0, start: 0 };
                    this.sel = null;
                    this.shake = 0;
                    this.frames = 0;
                    this.lastT = performance.now();
                    this.dayT = 0;
                    this.mouse = { x: 0, y: 0 };

                    this.lightningArcs  = [];
                    this.formation       = 'defensive';
                    this.difficultyMult  = 1.0;
                    this._dragonKilled   = false;
                    this.achievements    = null; // inited after game is declared
                    this.loadSave(); // Fix #20
                    this.loadMeta(); // Permanent per-unit upgrades
                    this.bindEvents();
                    this.loop();
                }

                // Fix #20: Local Storage Persistence
                loadSave() {
                    try {
                        const s = JSON.parse(
                            localStorage.getItem("stickman_dominion_save"),
                        );
                        if (s) {
                            this.maxUnlockedLevel = s.maxUnlockedLevel || 0;
                            this.bestEndlessWave = s.bestEndlessWave || 0;
                            document.getElementById("volSound").value =
                                s.volSound !== undefined ? s.volSound : 70;
                            document.getElementById("volMusic").value =
                                s.volMusic !== undefined ? s.volMusic : 40;
                            document.getElementById("particleQuality").value =
                                s.pq || 1;
                            document.getElementById(
                                "btnStartCampaign",
                            ).innerText =
                                this.maxUnlockedLevel > 0
                                    ? `Resume Campaign (${this.maxUnlockedLevel + 1})`
                                    : "Campaign Mode";
                        } else {
                            this.maxUnlockedLevel = 0;
                            this.bestEndlessWave = 0;
                        }
                    } catch (e) {
                        this.maxUnlockedLevel = 0;
                        this.bestEndlessWave = 0;
                    }
                }
                saveGame() {
                    localStorage.setItem(
                        "stickman_dominion_save",
                        JSON.stringify({
                            maxUnlockedLevel: this.maxUnlockedLevel,
                            bestEndlessWave: this.bestEndlessWave,
                            volSound: document.getElementById("volSound").value,
                            volMusic: document.getElementById("volMusic").value,
                            pq: document.getElementById("particleQuality")
                                .value,
                        }),
                    );
                    document.getElementById("btnStartCampaign").innerText =
                        `Resume Campaign (${this.maxUnlockedLevel + 1})`;
                }

                // ─── PERMANENT PER-UNIT UPGRADES (META PROGRESSION) ──────────
                loadMeta() {
                    this.meta = { valor: 0, upg: {} };
                    for (const t in UNIT_TYPES)
                        this.meta.upg[t] = { hp: 0, dmg: 0 };
                    try {
                        const s = JSON.parse(
                            localStorage.getItem("stickman_dominion_meta"),
                        );
                        if (s) {
                            this.meta.valor = s.valor || 0;
                            for (const t in this.meta.upg) {
                                const u = s.upg && s.upg[t];
                                if (u) {
                                    this.meta.upg[t].hp = Math.min(
                                        META_MAX_RANK,
                                        u.hp || 0,
                                    );
                                    this.meta.upg[t].dmg = Math.min(
                                        META_MAX_RANK,
                                        u.dmg || 0,
                                    );
                                }
                            }
                        }
                    } catch (e) {}
                }
                saveMeta() {
                    try {
                        localStorage.setItem(
                            "stickman_dominion_meta",
                            JSON.stringify(this.meta),
                        );
                    } catch (e) {}
                }
                // Apply a unit's permanent ranks to a freshly-built unit.
                applyMeta(u, t) {
                    const m = this.meta && this.meta.upg[t];
                    if (!m) return;
                    const hpR = META_STATS[0].per,
                        dmgR = META_STATS[1].per;
                    if (m.hp) {
                        const old = u.maxHp;
                        u.maxHp = Math.floor(u.maxHp * (1 + m.hp * hpR));
                        u.hp += u.maxHp - old;
                    }
                    if (m.dmg) u.dmg = Math.ceil(u.dmg * (1 + m.dmg * dmgR));
                }
                // Grant Valor (the meta currency) and persist it.
                awardValor(n) {
                    n = Math.max(0, Math.floor(n));
                    if (!this.meta) this.loadMeta();
                    this.meta.valor += n;
                    this.saveMeta();
                    return n;
                }
                // Buy one rank of a stat for a unit type from the Armory.
                buyMeta(t, stat) {
                    const m = this.meta.upg[t];
                    if (!m || m[stat] >= META_MAX_RANK) {
                        this.audio.playError();
                        return;
                    }
                    const cost = META_COST[m[stat]];
                    if (this.meta.valor < cost) {
                        this.audio.playError();
                        return;
                    }
                    this.meta.valor -= cost;
                    m[stat]++;
                    this.saveMeta();
                    this.audio.playCoin();
                    this.renderArmory();
                }
                openArmory() {
                    this.renderArmory();
                    document
                        .getElementById("armoryOverlay")
                        .classList.remove("hidden");
                }
                renderArmory() {
                    document.getElementById("armoryValor").innerText =
                        this.meta.valor;
                    const grid = document.getElementById("armoryGrid");
                    let html = "";
                    for (const t in UNIT_TYPES) {
                        const def = UNIT_TYPES[t],
                            m = this.meta.upg[t];
                        let rows = "";
                        for (const s of META_STATS) {
                            const rank = m[s.key],
                                maxed = rank >= META_MAX_RANK,
                                cost = maxed ? 0 : META_COST[rank],
                                afford = !maxed && this.meta.valor >= cost;
                            let pips = "";
                            for (let i = 0; i < META_MAX_RANK; i++)
                                pips += `<span style="display:inline-block;width:11px;height:11px;margin-right:3px;border-radius:2px;background:${i < rank ? s.color : "rgba(255,255,255,0.12)"};"></span>`;
                            rows += `<div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
                                <span style="width:78px;color:${s.color};font-size:12px;">${s.icon} ${s.name}</span>
                                <span style="flex:1;">${pips}</span>
                                <button onclick="game.buyMeta('${t}','${s.key}')"
                                    ${maxed || !afford ? "disabled" : ""}
                                    style="min-width:92px;padding:5px 8px;font-size:12px;border-radius:6px;cursor:${maxed || !afford ? "default" : "pointer"};border:1px solid ${maxed ? "rgba(96,165,250,0.4)" : afford ? "rgba(251,191,36,0.6)" : "rgba(255,255,255,0.12)"};background:${maxed ? "rgba(40,60,90,0.5)" : afford ? "linear-gradient(180deg,rgba(60,45,8,0.95),rgba(30,22,4,0.95))" : "rgba(20,20,24,0.6)"};color:${maxed ? "#60a5fa" : afford ? "var(--gold)" : "var(--text-dim)"};">
                                    ${maxed ? "MAX" : "⬆ " + cost + " ✦"}
                                </button>
                            </div>`;
                        }
                        html += `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px 14px;">
                            <div style="font-weight:700;color:var(--text);font-size:14px;">${def.name}</div>
                            ${rows}
                        </div>`;
                    }
                    grid.innerHTML = html;
                }

                resize() {
                    this.canvas.width = window.innerWidth;
                    this.canvas.height = window.innerHeight;
                    CONFIG.GROUND_Y = Math.max(
                        window.innerHeight - 180,
                        window.innerHeight * 0.6,
                    );
                    this._buildBackdropCache();
                }
                bindEvents() {
                    this.canvas.addEventListener("mousemove", (e) => {
                        this.mouse.x = e.clientX;
                        this.mouse.y = e.clientY;
                        const w = this.camera.toWorld(e.clientX, e.clientY);
                        const tt = document.getElementById("tooltip");
                        let hov = null;

                        for (const u of [...this.units, ...this.enemies])
                            if (
                                Math.abs(u.x - w.x) < 35 &&
                                Math.abs(u.y - w.y) < 60
                            )
                                hov = u;
                        if (!hov)
                            for (const b of this.buildings)
                                if (
                                    Math.abs(b.x - w.x) < b.w / 2 &&
                                    w.y > b.y - b.h &&
                                    w.y < b.y
                                )
                                    hov = b;

                        if (hov) {
                            tt.classList.remove("hidden");
                            tt.style.left =
                                Math.min(
                                    e.clientX + 20,
                                    window.innerWidth - 320,
                                ) + "px"; // Fix #14
                            tt.style.top = e.clientY + 20 + "px";
                            const def =
                                BUILDING_TYPES[hov.type] ||
                                (hov.team === TEAMS.PLAYER
                                    ? UNIT_TYPES[hov.type]
                                    : ENEMY_TYPES[hov.type]);
                            if (def)
                                tt.innerHTML = `<div class="tt-name">${def.name}</div><div class="tt-desc">${def.desc || ""}</div>HP: ${Math.floor(hov.hp)}/${hov.maxHp}<br>${def.dmg ? "DMG: " + def.dmg + "<br>" : ""}${def.armor ? "Armor: " + def.armor : ""}`;
                        } else {
                            tt.classList.add("hidden");
                        }
                    });

                    // FIX: Hide tooltip and stop edge-scroll when mouse leaves canvas
                    this.canvas.addEventListener("mouseleave", () => {
                        this.mouse.x = -1000;
                        this.mouse.y = -1000;
                        document.getElementById("tooltip").classList.add("hidden");
                    });

                    this.canvas.addEventListener("mousedown", (e) => {
                        if (e.button !== 0 || this.spells.active) return;
                        const w = this.camera.toWorld(e.clientX, e.clientY);
                        let c = null;
                        for (const u of [...this.units, ...this.enemies])
                            if (
                                Math.abs(u.x - w.x) < 35 &&
                                Math.abs(u.y - w.y) < 60
                            )
                                c = u;
                        if (!c)
                            for (const b of this.buildings)
                                if (
                                    Math.abs(b.x - w.x) < b.w / 2 &&
                                    w.y > b.y - b.h &&
                                    w.y < b.y
                                )
                                    c = b;
                        this.sel = c;
                        this.updateSelUI();
                    });

                    // Touch Listeners (Fix #1 & #15)
                    let touchStartX = null;
                    this.canvas.addEventListener(
                        "touchstart",
                        (e) => {
                            if (e.touches.length === 1) {
                                touchStartX = e.touches[0].clientX;
                                if (!this.spells.active) {
                                    const w = this.camera.toWorld(
                                        e.touches[0].clientX,
                                        e.touches[0].clientY,
                                    );
                                    let c = null;
                                    for (const u of [
                                        ...this.units,
                                        ...this.enemies,
                                    ])
                                        if (
                                            Math.abs(u.x - w.x) < 45 &&
                                            Math.abs(u.y - w.y) < 80
                                        )
                                            c = u;
                                    if (!c)
                                        for (const b of this.buildings)
                                            if (
                                                Math.abs(b.x - w.x) < b.w / 2 &&
                                                w.y > b.y - b.h &&
                                                w.y < b.y
                                            )
                                                c = b;
                                    this.sel = c;
                                    this.updateSelUI();
                                }
                            }
                        },
                        { passive: true },
                    );
                    this.canvas.addEventListener(
                        "touchmove",
                        (e) => {
                            if (touchStartX !== null && !this.spells.active) {
                                const dx = touchStartX - e.touches[0].clientX;
                                this.camera.pan(dx * 2);
                                touchStartX = e.touches[0].clientX;
                            }
                        },
                        { passive: true },
                    );
                    this.canvas.addEventListener("touchend", () => {
                        touchStartX = null;
                    });

                    // Mobile Auto-Queue Long Press (Fix #15)
                    document.querySelectorAll(".unit-btn").forEach((btn) => {
                        let t;
                        btn.addEventListener(
                            "touchstart",
                            (e) => {
                                t = setTimeout(() => {
                                    const type = btn.id
                                        .replace("btn", "")
                                        .toLowerCase();
                                    this.toggleAuto(type);
                                    if (navigator.vibrate)
                                        navigator.vibrate(50);
                                }, 500);
                            },
                            { passive: true },
                        );
                        btn.addEventListener("touchend", () => clearTimeout(t));
                        btn.addEventListener("touchmove", () =>
                            clearTimeout(t),
                        );
                    });

                    // Keyboard
                    window.addEventListener("keydown", (e) => {
                        if (this.state !== "playing") return;
                        const k = e.key.toLowerCase();
                        const m = {
                            1: "militia",
                            2: "swordsman",
                            3: "spearman",
                            4: "archer",
                            5: "crossbow",
                            6: "cleric",
                            7: "knight",
                            8: "mage",
                            9: "catapult",
                            0: "paladin",
                            q: "mine",
                            w: "barracks",
                            e: "tower",
                            r: "wall",
                            t: "academy",
                            f: "obelisk",
                            g: "archery",
                            h: "forge",
                        };
                        if (m[k]) {
                            if ("1234567890".includes(k) && UNIT_TYPES[m[k]]) this.buyUnit(m[k]);
                            else if (BUILDING_TYPES[m[k]]) this.build(m[k]);
                        }
                        if ("0123456789".includes(k)) { if (m[k]) this.buyUnit(m[k]); }
                        if (k === " " || k === "p" || k === "escape")
                            this.setSpeed(this.ts === 0 ? 1 : 0);
                        if (k === "y") this.openTechTree();
                        if (e.code === "ArrowLeft" || e.code === "KeyA")
                            this.camera.pan(-40);
                        if (e.code === "ArrowRight" || e.code === "KeyD")
                            this.camera.pan(40);
                    });

                    // Minimap
                    const mm = document.getElementById("minimap");
                    mm.addEventListener("mousedown", (e) => {
                        const rect = mm.getBoundingClientRect();
                        const pct = (e.clientX - rect.left) / rect.width;
                        this.camera.tX =
                            pct * CONFIG.WORLD_WIDTH -
                            window.innerWidth / this.camera.z / 2;
                    });
                    mm.addEventListener(
                        "touchstart",
                        (e) => {
                            const rect = mm.getBoundingClientRect();
                            const pct =
                                (e.touches[0].clientX - rect.left) / rect.width;
                            this.camera.tX =
                                pct * CONFIG.WORLD_WIDTH -
                                window.innerWidth / this.camera.z / 2;
                        },
                        { passive: true },
                    );
                }

                startCampaign() {
                    this.audio.init();
                    this.audio.startMusic();
                    document.getElementById('difficultyOverlay').classList.remove('hidden');
                }
                startCampaignWithDiff(mult) {
                    this.difficultyMult = mult;
                    document.getElementById('difficultyOverlay').classList.add('hidden');
                    this.mode = "campaign";
                    this.loadLvl(this.maxUnlockedLevel);
                }
                startEndless() {
                    this.audio.init();
                    this.audio.startMusic();
                    this.mode = "endless";
                    this.level = -1;
                    this.reset(450);
                    const m = new Building(420, "mine", TEAMS.PLAYER);
                    m.building = false;
                    m.bTimer = 0;
                    this.buildings.push(m);
                    this.waveM = new EndlessWave(this);
                    this.play();
                    this.notify("Survive as long as you can!");
                }
                loadLvl(i) {
                    this.level = i;
                    this.reset(LEVELS[i].startGold);
                    this.waveM = new WaveManager(this, i);
                    this.weather.set(LEVELS[i].weather);
                    this.play();
                    this.notify("Region: " + LEVELS[i].name);
                }

                reset(g) {
                    if (this.difficultyMult < 1.0) g = Math.floor(g * 1.25);
                    if (this.difficultyMult > 1.0) g = Math.floor(g * (this.difficultyMult > 1.2 ? 0.75 : 0.88));
                    this.gold = g;
                    this.iron = RESOURCES.START_IRON;
                    this.crystal = RESOURCES.START_CRYSTAL;
                    this.spells.mana = this.spells.maxMana =
                        RESOURCES.MAX_MANA + (this.upgrades.mana || 0);
                    this.pop = 0;
                    this.maxPop = 20 + (this.upgrades.pop || 0);
                    this.autoQueue = {};
                    this.units = [];
                    this.enemies = [];
                    this.buildings = [];
                    this.projectiles = [];
                    this.decals.decals = [];
                    this.stats = {
                        kills: 0,
                        gold: 0,
                        loss: 0,
                        start: Date.now(),
                    };
                    this.sel = null;
                    this.camera.x = 0;
                    this.camera.tX = 0;
                    this.buildings.push(
                        new Building(250, "castle", TEAMS.PLAYER),
                    );
                    if (this.level === 0) {
                        const m = new Building(400, "mine", TEAMS.PLAYER);
                        m.building = false;
                        m.bTimer = 0;
                        this.buildings.push(m);
                    }
                    this.setSpeed(1);
                }
                play() {
                    this.state = "playing";
                    document
                        .querySelectorAll(".overlay")
                        .forEach((e) => e.classList.add("hidden"));
                }

                setSpeed(s) {
                    this.ts = s;
                    document
                        .querySelectorAll(".time-btn")
                        .forEach((b) => b.classList.remove("active"));
                    if (s === 0) {
                        document
                            .getElementById("btnPause")
                            .classList.add("active");
                        this.state = "paused";
                        this.audio.stopMusic();
                    } else {
                        if (this.state === "paused" || this.state === "menu") {
                            this.state = "playing";
                            this.audio.startMusic();
                        }
                        document
                            .getElementById("btnSpeed" + s)
                            .classList.add("active");
                    }
                }

                addGold(a) {
                    this.gold += a;
                    this.stats.gold += a;
                }
                checkCost(c) {
                    return (
                        this.gold >= (c.g || 0) &&
                        this.iron >= (c.i || 0) &&
                        this.crystal >= (c.c || 0)
                    );
                }
                payCost(c) {
                    this.gold -= c.g || 0;
                    this.iron -= c.i || 0;
                    this.crystal -= c.c || 0;
                }

                toggleAuto(type) {
                    if (!this.unlocked.u.has(type)) return;
                    this.autoQueue[type] = !this.autoQueue[type];
                    const btn = document.getElementById(
                        "btn" + type.charAt(0).toUpperCase() + type.slice(1),
                    );
                    if (this.autoQueue[type]) {
                        btn.classList.add("auto-queued");
                        this.audio.playTone(800, 0.1, "sine", 0.1);
                    } else {
                        btn.classList.remove("auto-queued");
                        this.audio.playTone(400, 0.1, "sine", 0.1);
                    }
                }

                buyUnit(t, auto = false) {
                    if (this.state !== "playing" || !this.unlocked.u.has(t))
                        return false;
                    const d = UNIT_TYPES[t];
                    if (!this.checkCost(d.cost)) {
                        if (!auto) {
                            this.audio.playError();
                            this.notify("Insufficient Resources.");
                        }
                        return false;
                    }
                    if (this.pop + d.pop > this.maxPop) {
                        if (!auto) {
                            this.audio.playError();
                            this.notify("Population Limit Reached.");
                        }
                        return false;
                    }
                    this.payCost(d.cost);
                    this.pop += d.pop;
                    const u = new Unit(150 + rand(-20, 20), t, TEAMS.PLAYER);
                    u.applyUpgrades(this.upgrades);
                    this.applyMeta(u, t); // Permanent per-unit upgrades
                    if (this.upgrades.forge && !UNIT_TYPES[t].ranged)
                        u.dmg = Math.ceil(u.dmg * (1 + this.upgrades.forge));
                    this.units.push(u);
                    if (!auto) this.audio.playBuild();
                    return true;
                }
                build(t) {
                    if (this.state !== "playing" || !this.unlocked.b.has(t))
                        return;
                    const d = BUILDING_TYPES[t];
                    if (!this.checkCost(d.cost)) {
                        this.audio.playError();
                        this.notify("Insufficient Resources.");
                        return;
                    }
                    let bx = 380;
                    while (
                        this.buildings.some(
                            (b) => Math.abs(b.x - bx) < b.w + 40,
                        )
                    )
                        bx += 110;
                    if (bx > 1400) {
                        this.audio.playError();
                        this.notify("No space near castle!");
                        return;
                    }
                    this.payCost(d.cost);
                    const b = new Building(bx, t, TEAMS.PLAYER);
                    this.buildings.push(b);
                    if (d.unlock)
                        d.unlock.forEach((u) => this.unlocked.u.add(u));
                    this.audio.playBuild();
                }

                spawnEnemy(t, x, y) {
                    const e = new Unit(x, t, TEAMS.ENEMY);
                    e.maxHp *= (this.diff || 1) * (this.difficultyMult || 1);
                    e.dmg   *= (this.diff || 1) * (this.difficultyMult || 1);
                    e.hp = e.maxHp;
                    this.enemies.push(e);
                }

                selectSpell(spellId) {
                    this.spells.select(spellId);
                }

                openTechTree() {
                    if (this.state !== "playing") return;
                    this.setSpeed(0);
                    const c = document.getElementById("techTreeContent");
                    c.innerHTML = "";
                    TECH_TREE.forEach((t) => {
                        const o = this.techs.has(t.id);
                        c.innerHTML += `<div class="tech-item ${o ? "owned" : ""}">
                <div style="font-weight:800;color:${o ? "var(--success)" : "var(--gold)"};font-size:15px;">${t.name} ${o ? "✓" : ""}</div>
                <div style="font-size:13px;color:var(--text-dim);flex-grow:1;">${t.desc}</div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
                    <span style="color:var(--gold);font-weight:800; font-size:14px;">${t.cost}g</span>
                    <button class="tech-btn" ${o || this.gold < t.cost ? "disabled" : ""} onclick="game.buyTech('${t.id}')">${o ? "Researched" : "Research"}</button>
                </div></div>`;
                    });
                    document
                        .getElementById("techTree")
                        .classList.remove("hidden");
                }
                closeTechTree() {
                    document.getElementById("techTree").classList.add("hidden");
                    this.setSpeed(1);
                }
                buyTech(id) {
                    const t = TECH_TREE.find((x) => x.id === id);
                    if (!t || this.techs.has(id) || this.gold < t.cost) return;
                    this.gold -= t.cost;
                    this.techs.add(id);
                    this.upgrades[t.type] =
                        (this.upgrades[t.type] || 0) + t.val;
                    if (t.applies === "magic")
                        this.upgrades.magic_damage =
                            (this.upgrades.magic_damage || 0) + t.val; // Fix #9

                    if (t.type === "pop") this.maxPop += t.val;
                    if (t.type === "mana") {
                        this.spells.maxMana += t.val;
                        this.spells.mana += t.val;
                    }
                    if (t.type === "crystal_inc")
                        this.upgrades.crystal_inc =
                            (this.upgrades.crystal_inc || 0) + t.val;
                    this.audio.playCoin();
                    this.openTechTree();
                    this.updateUI();
                }
                setFormation(f) {
                    this.formation = f;
                    ['defensive','standard','aggressive'].forEach(id => {
                        const b = document.getElementById('fBtn-' + id);
                        if (b) b.classList.toggle('active', id === f);
                    });
                }
                openAchievements() {
                    if (this.achievements) this.achievements.render();
                    document.getElementById('achievementsOverlay').classList.remove('hidden');
                }
                openSettings() {
                    document
                        .getElementById("settingsOverlay")
                        .classList.remove("hidden");
                }
                closeSettings() {
                    this.audio.vols.sound =
                        document.getElementById("volSound").value / 100;
                    this.audio.vols.music =
                        document.getElementById("volMusic").value / 100;
                    this.audio.updateVols();
                    document
                        .getElementById("settingsOverlay")
                        .classList.add("hidden");
                    this.saveGame();
                }
                showHelp() {
                    document
                        .getElementById("helpOverlay")
                        .classList.remove("hidden");
                }
                returnToMenu() {
                    this.state = "menu";
                    this.audio.stopMusic();
                    this.spells.cancel();
                    document
                        .querySelectorAll(".overlay")
                        .forEach((e) => e.classList.add("hidden"));
                    document
                        .getElementById("mainMenu")
                        .classList.remove("hidden");
                }
                restartLevel() {
                    if (this.mode === "endless") this.startEndless();
                    else this.loadLvl(this.level);
                }
                nextLevel() {
                    if (this.level + 1 < LEVELS.length)
                        this.loadLvl(this.level + 1);
                    else {
                        this.notify("Campaign Complete! Victory is yours!");
                        this.returnToMenu();
                    }
                }

                notify(m) {
                    const a = document.getElementById("notificationArea");
                    if (a.children.length > 4) a.removeChild(a.firstChild); // Fix #13
                    const d = document.createElement("div");
                    d.className = "notification";
                    d.innerText = m;
                    a.appendChild(d);
                    setTimeout(() => {
                        if (d.parentNode) d.remove();
                    }, 4000);
                }

                updateSelUI() {
                    const e = document.getElementById("selectedInfo");
                    if (!this.sel) {
                        e.innerText =
                            "Click a unit or building to view details.";
                        return;
                    }
                    const s = this.sel,
                        d =
                            BUILDING_TYPES[s.type] ||
                            (s.team === TEAMS.PLAYER
                                ? UNIT_TYPES[s.type]
                                : ENEMY_TYPES[s.type]);
                    e.innerHTML = `<strong style="color:var(--gold);font-size:15px; letter-spacing:1px; text-transform:uppercase;">${d ? d.name : "Unknown"}</strong><br>HP: ${Math.floor(s.hp)}/${s.maxHp}<br>${s.dmg ? "Damage: " + s.dmg + "<br>" : ""}${s.armor ? "Armor: " + s.armor : ""}`;
                }

                updateUI() {
                    document.getElementById("goldDisplay").innerText = Math.floor(this.gold);
                    // Income per second display
                    const incomeMult2 = 1 + (this.upgrades.income || 0);
                    let incomePerSec = 0;
                    this.buildings.forEach(b => {
                        if (b.active && !b.building && b.income && b.income.g)
                            incomePerSec += b.income.g * incomeMult2;
                    });
                    const irEl = document.getElementById("incomeRate");
                    if (irEl) irEl.innerText = incomePerSec > 0 ? `+${incomePerSec.toFixed(0)}/s` : "";
                    document.getElementById("ironDisplay").innerText =
                        Math.floor(this.iron);
                    document.getElementById("crystalDisplay").innerText =
                        Math.floor(this.crystal);
                    document.getElementById("popDisplay").innerText =
                        this.pop + "/" + this.maxPop;
                    document.getElementById("levelDisplay").innerText =
                        this.mode === "campaign" ? this.level + 1 : "∞";

                    const c = this.buildings.find((b) => b.type === "castle");
                    if (c) {
                        document.getElementById(
                            "castleHealthFill",
                        ).style.width =
                            (Math.max(0, c.hp) / c.maxHp) * 100 + "%";
                        document.getElementById("castleHealthText").innerText =
                            Math.floor(Math.max(0, c.hp)) + " / " + c.maxHp;
                    }

                    if (this.waveM) {
                        if (this.mode === "endless") {
                            const w = this.waveM;
                            const nxt = Math.max(
                                0,
                                Math.floor((w.int - w.t) / 60),
                            );
                            document.getElementById("waveTimer").innerText =
                                "Next Wave: " + nxt + "s";
                            const isBossW = w.wave > 0 && w.wave % 5 === 0;
                            const wnEl = document.getElementById("waveNumber");
                            wnEl.innerText =
                                "Endless - Wave " +
                                w.wave +
                                (isBossW ? " [BOSS WAVE]" : "");
                            if (isBossW) wnEl.classList.add("boss-wave");
                            else wnEl.classList.remove("boss-wave");
                        } else {
                            const w = this.waveM;
                            const nxt =
                                w.cw < w.tw
                                    ? Math.max(
                                          0,
                                          Math.floor(
                                              (w.wvs[w.cw].time * 60 - w.t) /
                                                  60,
                                          ),
                                      )
                                    : 0;
                            document.getElementById("waveTimer").innerText =
                                w.cw < w.tw
                                    ? "Next Wave: " + nxt + "s"
                                    : "Final Wave!";
                            document.getElementById("waveNumber").innerText =
                                "Wave " + w.cw + " / " + w.tw;
                        }
                    }

                    // Wave preview
                    const prevEl = document.getElementById("wavePreview");
                    if (prevEl && this.waveM && this.mode === "campaign") {
                        const wm = this.waveM;
                        if (wm.cw < wm.tw) {
                            const nw = wm.wvs[wm.cw];
                            if (nw) {
                                const str = nw.enemies.map(gr => {
                                    const d2 = ENEMY_TYPES[gr.t];
                                    return `${d2 ? d2.name : gr.t} ×${gr.c}`;
                                }).join(" · ");
                                prevEl.innerHTML = `⚠ <span style="color:#fca5a5;">${str}</span>`;
                            } else prevEl.innerHTML = "";
                        } else prevEl.innerHTML = "";
                    } else if (prevEl) prevEl.innerHTML = "";
                    document.getElementById("statKills").innerText = this.stats.kills;
                    document.getElementById("statGold").innerText = Math.floor(
                        this.stats.gold,
                    );
                    document.getElementById("statLosses").innerText =
                        this.stats.loss;
                    document.getElementById("statTime").innerText = formatTime(
                        (Date.now() - this.stats.start) / 1000,
                    );

                    const bMap = {
                        militia: "btnMilitia",
                        swordsman: "btnSwordsman",
                        spearman: "btnSpearman",
                        archer: "btnArcher",
                        crossbow: "btnCrossbow",
                        cleric: "btnCleric",
                        knight: "btnKnight",
                        mage: "btnMage",
                        catapult: "btnCatapult",
                        paladin: "btnPaladin",
                    };
                    for (const [t, id] of Object.entries(bMap)) {
                        const b = document.getElementById(id),
                            d = UNIT_TYPES[t];
                        if (!b) continue;
                        b.disabled =
                            !this.checkCost(d.cost) ||
                            this.pop + d.pop > this.maxPop ||
                            !this.unlocked.u.has(t);
                    }
                    const blMap = {
                        mine: "btnMine",
                        barracks: "btnBarracks",
                        tower: "btnTower",
                        wall: "btnWall",
                        academy: "btnAcademy",
                        obelisk: "btnObelisk",
                        archery: "btnArchery",
                        forge: "btnForge",
                    };
                    for (const [t, id] of Object.entries(blMap)) {
                        const b = document.getElementById(id);
                        if (!b) continue;
                        b.disabled =
                            !this.checkCost(BUILDING_TYPES[t].cost) ||
                            !this.unlocked.b.has(t);
                    }

                    const td = document.getElementById("activeUpgrades");
                    if (this.techs.size === 0)
                        td.innerHTML =
                            '<div class="stat-row"><span>No upgrades purchased</span></div>';
                    else {
                        td.innerHTML = "";
                        this.techs.forEach((id) => {
                            const t = TECH_TREE.find((x) => x.id === id);
                            if (t)
                                td.innerHTML += `<div class="stat-row"><span>${t.name}</span><span style="color:var(--success)">Active</span></div>`;
                        });
                    }
                }

                update(dt) {
                    if (this.state !== "playing") return;

                    this.dayT += 0.0002 * dt; // Fix #17: Slower cycle

                    if (!this.spells.active) {
                        if (
                            this.mouse.x > 0 &&
                            this.mouse.x < CONFIG.EDGE_SCROLL_MARGIN
                        )
                            this.camera.pan(-CONFIG.EDGE_SCROLL_SPEED * dt);
                        if (
                            this.mouse.x >
                            window.innerWidth - CONFIG.EDGE_SCROLL_MARGIN
                        )
                            this.camera.pan(CONFIG.EDGE_SCROLL_SPEED * dt);
                    }
                    this.camera.update(dt);

                    let buildingManaRegen = 0; // Fix #11: Dynamic mana calculation
                    const iM = 1 + (this.upgrades.income || 0);
                    this.buildings.forEach((b) => {
                        if (!b.active || b.building) return;
                        if (b.income.g)
                            this.addGold((b.income.g * iM * dt) / 60);
                        if (b.income.i) this.iron += (b.income.i * dt) / 60;
                        if (b.income.c) this.crystal += (b.income.c * dt) / 60;
                        if (b.income.mana) buildingManaRegen += b.income.mana;
                    });

                    if (this.upgrades.crystal_inc)
                        this.crystal += (this.upgrades.crystal_inc * dt) / 60;
                    this.spells.dynamicRegen = buildingManaRegen;
                    this.spells.update(dt);

                    // Fix #6: Round Robin Auto-Queue
                    this.autoTimer += dt;
                    if (this.autoTimer >= 60) {
                        this.autoTimer = 0;
                        const activeQueues = Object.keys(this.autoQueue).filter(
                            (k) => this.autoQueue[k],
                        );
                        if (activeQueues.length > 0) {
                            this.autoIndex =
                                (this.autoIndex || 0) % activeQueues.length;
                            this.buyUnit(activeQueues[this.autoIndex], true);
                            this.autoIndex++;
                        }
                    }

                    [
                        ...this.buildings,
                        ...this.units,
                        ...this.enemies,
                        ...this.projectiles,
                    ].forEach((e) => e.update(dt));

                    this.units = this.units.filter(
                        (u) => u.active || u.dmgTexts.length > 0,
                    );
                    this.enemies = this.enemies.filter(
                        (e) => e.active || e.dmgTexts.length > 0,
                    );
                    this.projectiles = this.projectiles.filter((p) => p.active);
                    this.buildings = this.buildings.filter(
                        (b) => b.active || b.dmgTexts.length > 0,
                    );

                    this.particles.update(dt);
                    this.fx.update(dt);
                    this.decals.update(dt);
                    this.weather.update(dt, this.camera);
                    if (this.shake > 0) {
                        this.shake *= Math.pow(0.9, dt);
                        if (this.shake < 0.5) this.shake = 0;
                    }

                    if (this.waveM) {
                        this.waveM.update(dt);
                        if (this.waveM.isComplete()) this.victory();
                    }
                    if (this.achievements && this.frames % 180 === 0) this.achievements.check();

                    if (
                        !this.buildings.some(
                            (b) => b.type === "castle" && b.hp > 0,
                        )
                    )
                        this.defeat();
                    this.updateUI();
                }

                victory() {
                    this.setSpeed(0);
                    this.state = "victory";
                    // Last Stand achievement
                    const castleV = this.buildings.find(b => b.type === "castle");
                    if (castleV && castleV.hp / castleV.maxHp < 0.15 && this.achievements)
                        this.achievements.tryUnlock("last_stand");
                    this.audio.playMagic();
                    this.audio.stopMusic();
                    if (this.mode === "campaign") {
                        const r = LEVELS[this.level].reward;
                        this.gold += r;
                        this.maxUnlockedLevel = Math.max(
                            this.maxUnlockedLevel,
                            this.level + 1,
                        ); // Fix #20
                        this.saveGame();

                        const valor = this.awardValor(
                            Math.floor(this.stats.kills / 2) + 25,
                        );
                        document.getElementById("victoryStats").innerHTML =
                            `<div class="stat-row"><span>Enemies Destroyed</span><span>${this.stats.kills}</span></div><div class="stat-row"><span>Bounty Claimed</span><span>${Math.floor(this.stats.gold)}</span></div><div class="stat-row"><span>Region Reward</span><span style="color:var(--gold);">+${r} Gold</span></div><div class="stat-row"><span>Valor Earned</span><span style="color:#c084fc;">+${valor} ✦</span></div>`;
                        document.getElementById("btnNextLevel").style.display =
                            this.level + 1 < LEVELS.length ? "block" : "none";
                    } else {
                        const valor = this.awardValor(
                            Math.floor(this.stats.kills / 2) + 25,
                        );
                        document.getElementById("victoryStats").innerHTML =
                            `<p style="text-align:center;color:var(--text-dim);">Endless mode has no end. You fought well.</p><div class="stat-row"><span>Valor Earned</span><span style="color:#c084fc;">+${valor} ✦</span></div>`;
                    }
                    document
                        .getElementById("victoryMenu")
                        .classList.remove("hidden");
                }
                defeat() {
                    if (this.state === "defeat") return; // Fix #16: Prevent defeat loop
                    this.setSpeed(0);
                    this.state = "defeat";
                    this.audio.playError();
                    this.audio.stopMusic();
                    if (this.mode === "endless") {
                        const w = this.waveM ? this.waveM.wave : 0;
                        this.bestEndlessWave = Math.max(
                            this.bestEndlessWave || 0,
                            w,
                        );
                        this.saveGame(); // Fix #20
                        const valor = this.awardValor(
                            Math.floor(this.stats.kills / 2) + w * 4,
                        );
                        document.getElementById("endStats").innerHTML =
                            `<div class="stat-row"><span>Enemies Destroyed</span><span>${this.stats.kills}</span></div><div class="stat-row"><span>Waves Survived</span><span style="color:var(--gold);">${w}</span></div><div class="stat-row"><span>Survival Time</span><span>${formatTime((Date.now() - this.stats.start) / 1000)}</span></div><div class="stat-row"><span>Best Wave Ever</span><span style="color:var(--success);">${this.bestEndlessWave}</span></div><div class="stat-row"><span>Valor Earned</span><span style="color:#c084fc;">+${valor} ✦</span></div>`;
                    } else {
                        const valor = this.awardValor(
                            Math.floor(this.stats.kills / 4),
                        );
                        document.getElementById("endStats").innerHTML =
                            `<div class="stat-row"><span>Enemies Destroyed</span><span>${this.stats.kills}</span></div><div class="stat-row"><span>Survival Time</span><span>${formatTime((Date.now() - this.stats.start) / 1000)}</span></div><div class="stat-row"><span>Valor Earned</span><span style="color:#c084fc;">+${valor} ✦</span></div>`;
                    }
                    document
                        .getElementById("gameOver")
                        .classList.remove("hidden");
                }

                drawMinimap() {
                    const mc = document.getElementById("minimap"),
                        cx = mc.getContext("2d");
                    const mw = mc.width,
                        mh = mc.height;
                    cx.clearRect(0, 0, mw, mh);

                    const sX = mw / CONFIG.WORLD_WIDTH;

                    this.buildings.forEach((b) => {
                        if (!b.active) return;
                        cx.fillStyle =
                            b.type === "castle" ? "#fbbf24" : "#3b82f6";
                        cx.fillRect(b.x * sX - 2, mh - 12, 4, 10);
                    });
                    this.units.forEach((u) => {
                        if (u.active) {
                            cx.fillStyle = "#34d399";
                            cx.fillRect(u.x * sX, mh - 8, 2, 4);
                        }
                    });
                    this.enemies.forEach((e) => {
                        if (e.active) {
                            cx.fillStyle = "#ef4444";
                            cx.fillRect(e.x * sX, mh - 8, 2, 4);
                        }
                    });

                    cx.strokeStyle = "rgba(255,255,255,0.6)";
                    cx.lineWidth = 1;
                    cx.strokeRect(
                        this.camera.x * sX,
                        1,
                        (window.innerWidth / this.camera.z) * sX,
                        mh - 2,
                    );
                }

                // ─── CINEMATIC ENVIRONMENT ──────────────────────────────
                _buildBackdropCache() {
                    const w = this.canvas.width,
                        h = this.canvas.height,
                        ctx = this.ctx;
                    if (!w || !h || !ctx) return;
                    const vg = ctx.createRadialGradient(
                        w / 2, h * 0.42, Math.min(w, h) * 0.34,
                        w / 2, h * 0.5, Math.max(w, h) * 0.78,
                    );
                    vg.addColorStop(0, "transparent");
                    vg.addColorStop(0.65, "rgba(0,0,0,0.08)");
                    vg.addColorStop(1, "rgba(0,0,0,0.46)");
                    this._vignette = vg;
                    if (!this._grainPat) {
                        const nc = document.createElement("canvas");
                        nc.width = 64; nc.height = 64;
                        const nx = nc.getContext("2d");
                        const id = nx.createImageData(64, 64);
                        for (let i = 0; i < id.data.length; i += 4) {
                            const v = (128 + (Math.random() * 255 - 128) * 0.55) | 0;
                            id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
                            id.data[i + 3] = 255;
                        }
                        nx.putImageData(id, 0, 0);
                        this._grainPat = ctx.createPattern(nc, "repeat");
                    }
                }

                // A continuous, parallax-scrolled mountain ridge silhouette
                _drawRidge(ctx, w, gy, cam, opt) {
                    const { parallax, seg, color, top, amp } = opt;
                    const scroll = cam.x * parallax;
                    const baseIndex = Math.floor(scroll / seg) - 1;
                    const cols = Math.ceil(w / seg) + 3;
                    const xs = [], hs = [];
                    ctx.beginPath();
                    ctx.moveTo(-seg, gy + 6);
                    for (let k = 0; k <= cols; k++) {
                        const idx = baseIndex + k;
                        const sx = idx * seg - scroll;
                        const n =
                            Math.sin(idx * 1.71) * 0.5 +
                            Math.sin(idx * 0.53 + 1.3) * 0.32 +
                            Math.sin(idx * 0.29 + 4.0) * 0.18 +
                            Math.sin(idx * 0.13 + 2.2) * 0.12;
                        const peakY = top - (0.5 + n * 0.5) * amp;
                        xs.push(sx); hs.push(peakY);
                        ctx.lineTo(sx, peakY);
                    }
                    ctx.lineTo(w + seg, gy + 6);
                    ctx.closePath();
                    ctx.fillStyle = color;
                    ctx.fill();
                    if (opt.snow) {
                        ctx.fillStyle = opt.snowCol;
                        for (let k = 1; k < xs.length - 1; k++) {
                            if (hs[k] < hs[k - 1] && hs[k] < hs[k + 1] &&
                                hs[k] < top - amp * 0.5) {
                                ctx.beginPath();
                                ctx.moveTo(xs[k], hs[k]);
                                ctx.lineTo(xs[k] - seg * 0.34, hs[k] + amp * 0.17);
                                ctx.lineTo(xs[k] + seg * 0.34, hs[k] + amp * 0.17);
                                ctx.closePath();
                                ctx.fill();
                            }
                        }
                    }
                    if (opt.rim) {
                        ctx.strokeStyle = opt.rim;
                        ctx.lineWidth = 1.4;
                        ctx.beginPath();
                        for (let k = 0; k < xs.length; k++)
                            k === 0 ? ctx.moveTo(xs[k], hs[k]) : ctx.lineTo(xs[k], hs[k]);
                        ctx.stroke();
                    }
                }

                drawBackdrop(ctx, w, h, cam, lvl, dP) {
                    const sky = lvl.sky, gnd = lvl.ground;
                    const q = +(document.getElementById("particleQuality")?.value || 1);
                    const sun = clamp(dP, 0, 1);
                    const night = clamp(-dP, 0, 1);
                    const dawn = clamp(1 - Math.abs(dP) * 1.7, 0, 1);
                    const gy = cam.toScreen(0, CONFIG.GROUND_Y).y;
                    const warm = "#ff9d5c", cool = "#16203a";

                    // Atmospheric horizon color, derived from the level theme
                    const glowT = clamp(dawn * 0.6 + sun * 0.32, 0, 0.78);
                    const horizonO = mixRgb(mixRgb(sky, cool, night * 0.45), warm, glowT);
                    const skyTop = shade(sky, -0.5 - night * 0.12);

                    // Sky
                    const sg = ctx.createLinearGradient(0, 0, 0, gy + 30);
                    sg.addColorStop(0, skyTop);
                    sg.addColorStop(0.45, sky);
                    sg.addColorStop(0.82, toRgb(mixRgb(sky, horizonO, 0.7)));
                    sg.addColorStop(1, toRgb(horizonO));
                    ctx.fillStyle = sg;
                    ctx.fillRect(0, 0, w, gy + 30);

                    // Stars (night)
                    if (night > 0.02) {
                        for (let i = 0; i < 95; i++) {
                            const sx = (i * 167.3) % w;
                            const sy = (i * 89.7) % (gy * 0.78);
                            const tw = 0.35 + Math.sin(this.dayT * 4 + i * 1.7) * 0.45;
                            ctx.globalAlpha = night * clamp(tw, 0.04, 0.95);
                            ctx.fillStyle = i % 11 === 0 ? "#bfdbfe" : "#ffffff";
                            const r = i % 13 === 0 ? 1.7 : i % 3 === 0 ? 1.1 : 0.7;
                            ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
                        }
                        ctx.globalAlpha = 1;
                    }

                    // Sun / Moon
                    const cY = gy * 0.82 - dP * gy * 0.82;
                    const cX = w * 0.78 + Math.cos(this.dayT) * w * 0.22;
                    const isSun = dP > -0.05;
                    const bodyCol = isSun ? mixCol("#fff3c4", "#ff8a3d", 1 - sun) : "#dbe4ff";
                    const bodyR = isSun ? 32 : 24;
                    // Corona
                    ctx.save();
                    ctx.globalCompositeOperation = "screen";
                    const cor = ctx.createRadialGradient(cX, cY, 0, cX, cY, bodyR * (isSun ? 7 : 4.8));
                    cor.addColorStop(0, rgba(isSun ? "#ffe7a8" : "#cdd9ff", 0.5));
                    cor.addColorStop(0.25, rgba(isSun ? "#ffb86b" : "#9db4ff", 0.2));
                    cor.addColorStop(1, "transparent");
                    ctx.fillStyle = cor;
                    ctx.fillRect(cX - bodyR * 8, cY - bodyR * 8, bodyR * 16, bodyR * 16);
                    // God rays
                    if (isSun && sun > 0.12 && q >= 1) {
                        ctx.translate(cX, cY);
                        ctx.rotate(this.dayT * 0.08);
                        const rays = 9, len = h;
                        for (let i = 0; i < rays; i++) {
                            ctx.rotate((Math.PI * 2) / rays);
                            const rg = ctx.createLinearGradient(0, 0, 0, len);
                            rg.addColorStop(0, rgba("#ffe7a8", 0.045 * sun));
                            rg.addColorStop(1, "transparent");
                            ctx.fillStyle = rg;
                            ctx.beginPath();
                            ctx.moveTo(-6, 0); ctx.lineTo(6, 0);
                            ctx.lineTo(30, len); ctx.lineTo(-30, len);
                            ctx.closePath(); ctx.fill();
                        }
                    }
                    ctx.restore();
                    // Body
                    ctx.save();
                    ctx.fillStyle = bodyCol;
                    ctx.shadowBlur = isSun ? 42 : 22;
                    ctx.shadowColor = bodyCol;
                    ctx.beginPath(); ctx.arc(cX, cY, bodyR, 0, Math.PI * 2); ctx.fill();
                    if (!isSun) {
                        ctx.shadowBlur = 0;
                        ctx.fillStyle = "rgba(154,169,214,0.5)";
                        ctx.beginPath(); ctx.arc(cX - 7, cY - 5, 4.5, 0, Math.PI * 2); ctx.fill();
                        ctx.beginPath(); ctx.arc(cX + 6, cY + 5, 3, 0, Math.PI * 2); ctx.fill();
                        ctx.beginPath(); ctx.arc(cX + 2, cY - 8, 2.2, 0, Math.PI * 2); ctx.fill();
                    }
                    ctx.restore();

                    // Clouds
                    {
                        const cloudTint = mixRgb(mixRgb({ r: 248, g: 251, b: 255 }, sky, 0.35 + night * 0.4), warm, dawn * 0.4);
                        const ca = clamp((0.2 + sun * 0.16) * (1 - night * 0.45), 0.05, 0.36);
                        ctx.save();
                        ctx.globalAlpha = ca;
                        const nClouds = q < 1 ? 3 : 6;
                        for (let i = 0; i < nClouds; i++) {
                            const m = w + 800;
                            const cx = (((i * 660 + this.frames * (0.2 + (i % 3) * 0.06) - cam.x * 0.05) % m) + m) % m - 400;
                            const cy = gy * (0.13 + (i % 3) * 0.12);
                            const sc = 0.7 + (i % 4) * 0.25;
                            for (let b = 0; b < 5; b++) {
                                const bx = cx + (b - 2) * 42 * sc;
                                const by = cy + Math.sin(b * 1.3 + i) * 9 * sc;
                                const br = (36 - Math.abs(b - 2) * 6) * sc * 1.6;
                                const cg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
                                cg.addColorStop(0, toRgba(cloudTint, 1));
                                cg.addColorStop(1, "transparent");
                                ctx.fillStyle = cg;
                                ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
                            }
                        }
                        ctx.restore();
                    }

                    // Far mountain range (hazy, snow-capped)
                    this._drawRidge(ctx, w, gy, cam, {
                        parallax: 0.05, seg: 150,
                        color: toRgb(mixRgb(sky, horizonO, 0.6)),
                        top: gy * 0.62, amp: gy * 0.32,
                        snow: true, snowCol: rgba("#e8f0ff", 0.4 + sun * 0.25),
                    });
                    // Mid mountain range (sharper, darker, sun-rim)
                    this._drawRidge(ctx, w, gy, cam, {
                        parallax: 0.12, seg: 120,
                        color: toRgb(mixRgb(shade(sky, -0.3), gnd, 0.28)),
                        top: gy * 0.82, amp: gy * 0.34,
                        rim: rgba(isSun ? "#ffcaa0" : "#7e93c8", 0.18 + sun * 0.12),
                    });

                    // Horizon haze band — fuses mountain bases into the atmosphere
                    const hz = ctx.createLinearGradient(0, gy - gy * 0.3, 0, gy + 6);
                    hz.addColorStop(0, "transparent");
                    hz.addColorStop(1, toRgba(horizonO, 0.55 + dawn * 0.2));
                    ctx.fillStyle = hz;
                    ctx.fillRect(0, gy - gy * 0.3, w, gy * 0.3 + 6);

                    // Tree-line silhouette
                    this._drawRidge(ctx, w, gy, cam, {
                        parallax: 0.26, seg: 26,
                        color: shade(gnd, -0.62),
                        top: gy * 0.95, amp: gy * 0.12,
                    });

                    // ── GROUND ──
                    const gTop = mixCol(gnd, "#fff7e0", 0.1 * sun + 0.02);
                    const gg = ctx.createLinearGradient(0, gy, 0, h);
                    gg.addColorStop(0, gTop);
                    gg.addColorStop(0.22, gnd);
                    gg.addColorStop(1, shade(gnd, -0.58));
                    ctx.fillStyle = gg;
                    ctx.fillRect(0, gy, w, h - gy);

                    // Lit rim where grass catches the sky + shadow line beneath
                    ctx.fillStyle = toRgba(mixRgb(gnd, { r: 255, g: 255, b: 240 }, 0.5), 0.45 + sun * 0.3);
                    ctx.fillRect(0, gy - 2, w, 2.5);
                    ctx.fillStyle = "rgba(0,0,0,0.28)";
                    ctx.fillRect(0, gy + 2, w, 2);

                    // Battle-worn dirt path
                    const ph = h - gy;
                    const pathTop = gy + ph * 0.18, pathBot = gy + ph * 0.56;
                    ctx.save();
                    ctx.globalAlpha = 0.45;
                    ctx.fillStyle = mixCol(shade(gnd, -0.35), "#3a2c1c", 0.55);
                    ctx.beginPath();
                    ctx.moveTo(0, pathTop);
                    for (let x = 0; x <= w; x += 60)
                        ctx.lineTo(x, pathTop + Math.sin(x * 0.02 + cam.x * 0.002) * 6);
                    for (let x = w; x >= 0; x -= 60)
                        ctx.lineTo(x, pathBot + Math.sin(x * 0.017 + 2) * 8);
                    ctx.closePath(); ctx.fill();
                    ctx.restore();

                    // Pebbles scattered on the path
                    for (let i = 0; i < 16; i++) {
                        const px2 = (((i * 263 - cam.x) % w) + w) % w;
                        const py2 = pathTop + ((i * 97) % (pathBot - pathTop));
                        const pr = 2 + (i % 3);
                        ctx.fillStyle = shade(gnd, -0.46);
                        ctx.beginPath(); ctx.ellipse(px2, py2, pr, pr * 0.6, 0, 0, Math.PI * 2); ctx.fill();
                        ctx.fillStyle = "rgba(255,255,255,0.08)";
                        ctx.beginPath(); ctx.ellipse(px2 - 0.6, py2 - 0.6, pr * 0.5, pr * 0.3, 0, 0, Math.PI * 2); ctx.fill();
                    }

                    // Grass tufts along the rim (full parallax — locked to the play plane)
                    ctx.save();
                    ctx.strokeStyle = toRgba(mixRgb(gnd, "#bdf07a", 0.35 + sun * 0.2), 0.85);
                    ctx.lineWidth = 1.5;
                    ctx.lineCap = "round";
                    const step = 46, scrollG = cam.x % step;
                    for (let x = -step; x < w + step; x += step) {
                        const sxp = x - scrollG;
                        const wx = sxp + cam.x;
                        const sway = Math.sin(this.frames * 0.03 + wx * 0.05) * 2;
                        const baseY = gy - 1;
                        const hgt = 7 + Math.abs(Math.sin(wx * 0.7)) * 6;
                        ctx.beginPath();
                        ctx.moveTo(sxp, baseY); ctx.lineTo(sxp - 3 + sway, baseY - hgt);
                        ctx.moveTo(sxp, baseY); ctx.lineTo(sxp + sway, baseY - hgt - 2);
                        ctx.moveTo(sxp, baseY); ctx.lineTo(sxp + 3 + sway, baseY - hgt);
                        ctx.stroke();
                    }
                    ctx.restore();
                }

                drawForeground(ctx, w, h, cam, lvl, dP) {
                    const q = +(document.getElementById("particleQuality")?.value || 1);
                    // Ambient drifting motes / embers in front of the action
                    if (q >= 1) {
                        ctx.save();
                        ctx.globalCompositeOperation = "screen";
                        const moteCol = dP > 0 ? "#fff2c4" : "#a9c2ff";
                        const n = q >= 2 ? 20 : 12;
                        for (let i = 0; i < n; i++) {
                            const m = w + 60;
                            const mx = (((i * 173 + this.frames * (0.3 + (i % 3) * 0.18)) % m) + m) % m - 30;
                            const t = this.frames * 0.01 + i;
                            const my = h * 0.5 + Math.sin(t * 1.1 + i) * h * 0.22 + (i % 5) * 18;
                            ctx.globalAlpha = 0.1 + Math.max(0, Math.sin(t * 2 + i)) * 0.12;
                            ctx.fillStyle = moteCol;
                            ctx.beginPath(); ctx.arc(mx, my, 1 + (i % 3), 0, Math.PI * 2); ctx.fill();
                        }
                        ctx.restore();
                    }
                    // Soft out-of-focus framing blades at the screen edges (cinematic depth)
                    ctx.save();
                    ctx.fillStyle = shade(lvl.ground, -0.72);
                    ctx.globalAlpha = 0.5;
                    const blade = (bx, dir, scl) => {
                        const sway = Math.sin(this.frames * 0.02 + bx) * 10 * scl;
                        ctx.beginPath();
                        ctx.moveTo(bx - 16 * scl, h);
                        ctx.quadraticCurveTo(bx + sway * 0.4, h - h * 0.34 * scl, bx + sway + dir * 8 * scl, h - h * 0.55 * scl);
                        ctx.quadraticCurveTo(bx + sway * 0.5, h - h * 0.3 * scl, bx + 16 * scl, h);
                        ctx.closePath(); ctx.fill();
                    };
                    blade(28, -1, 1.0); blade(64, 1, 0.8); blade(12, 1, 0.7);
                    blade(w - 26, 1, 1.0); blade(w - 60, -1, 0.85);
                    ctx.restore();
                }

                drawPostFX(ctx, w, h, dP) {
                    if (this._vignette) {
                        ctx.fillStyle = this._vignette;
                        ctx.fillRect(0, 0, w, h);
                    }
                    const q = +(document.getElementById("particleQuality")?.value || 1);
                    if (q >= 1 && this._grainPat) {
                        ctx.save();
                        ctx.globalAlpha = 0.045;
                        ctx.globalCompositeOperation = "overlay";
                        const ox = (Math.random() * 60) | 0, oy = (Math.random() * 60) | 0;
                        ctx.translate(-ox, -oy);
                        ctx.fillStyle = this._grainPat;
                        ctx.fillRect(0, 0, w + 64, h + 64);
                        ctx.restore();
                    }
                }

                draw(dt) {
                    const ctx = this.ctx,
                        w = this.canvas.width,
                        h = this.canvas.height,
                        cam = this.camera;
                    ctx.save();
                    if (this.shake > 0)
                        ctx.translate(
                            rand(-this.shake, this.shake),
                            rand(-this.shake, this.shake),
                        );

                    const lvl =
                        this.level >= 0 && LEVELS[this.level]
                            ? LEVELS[this.level]
                            : { sky: "#0f172a", ground: "#143d26" };
                    const dP = Math.sin(this.dayT);

                    this.drawBackdrop(ctx, w, h, cam, lvl, dP);

                    ctx.save();
                    this.decals.draw(ctx, cam);

                    const ents = [
                        ...this.buildings.map((b) => ({ t: "b", o: b })),
                        ...this.units.map((u) => ({ t: "u", o: u })),
                        ...this.enemies.map((e) => ({ t: "e", o: e })),
                        ...this.projectiles.map((p) => ({ t: "p", o: p })),
                    ];
                    ents.sort((a, b) => a.o.y - b.o.y);
                    ents.forEach((e) => e.o.draw(ctx, cam, dt));

                    this.particles.draw(ctx, cam);
                    this.fx.draw(ctx, cam);
                    this.weather.draw(ctx, cam);

                    if (this.sel && this.sel.active) {
                        const p = cam.toScreen(this.sel.x, this.sel.y);
                        ctx.strokeStyle = "rgba(251,191,36,0.8)";
                        ctx.lineWidth = 3;
                        ctx.beginPath();
                        ctx.ellipse(
                            p.x,
                            p.y + 2,
                            30 * cam.z,
                            12 * cam.z,
                            0,
                            0,
                            Math.PI * 2,
                        );
                        ctx.stroke();
                    }
                    ctx.restore();

                    // Cinematic foreground (drifting motes + edge framing)
                    this.drawForeground(ctx, w, h, cam, lvl, dP);

                    if (dP < -0.1) {
                        ctx.fillStyle = `rgba(2,6,23,${Math.min(0.55, (-dP - 0.1) * 0.7)})`;
                        ctx.fillRect(0, 0, w, h);
                    } else if (dP > 0.8) {
                        ctx.fillStyle = `rgba(255,245,225,${(dP - 0.8) * 0.2})`;
                        ctx.fillRect(0, 0, w, h);
                    }

                    // Castle danger vignette
                    const cas2 = this.buildings.find(b => b.type === "castle" && b.active && b.hp > 0);
                    if (cas2 && cas2.hp / cas2.maxHp < 0.35) {
                        const ratio2 = 1 - (cas2.hp / cas2.maxHp) / 0.35;
                        const pulse2 = (Math.sin(Date.now() * 0.004) + 1) * 0.5;
                        const alpha2 = (0.08 + ratio2 * 0.22) * (0.5 + pulse2 * 0.5);
                        const vg = ctx.createRadialGradient(w/2, h/2, h*0.22, w/2, h/2, h*0.85);
                        vg.addColorStop(0, "transparent");
                        vg.addColorStop(1, `rgba(200,0,0,${alpha2})`);
                        ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
                    }
                    // Lightning arc rendering
                    for (let i = this.lightningArcs.length - 1; i >= 0; i--) {
                        const arc = this.lightningArcs[i];
                        arc.life -= dt;
                        if (arc.life <= 0) { this.lightningArcs.splice(i, 1); continue; }
                        const p1 = cam.toScreen(arc.x1, arc.y1);
                        const p2 = cam.toScreen(arc.x2, arc.y2);
                        ctx.save();
                        ctx.globalAlpha = (arc.life / 14) * 0.85;
                        ctx.globalCompositeOperation = "screen";
                        ctx.strokeStyle = "#7dd3fc";
                        ctx.lineWidth = 2.5 * cam.z;
                        ctx.shadowBlur = 18; ctx.shadowColor = "#38bdf8";
                        ctx.beginPath();
                        const steps = 7;
                        ctx.moveTo(p1.x, p1.y);
                        for (let s = 1; s < steps; s++) {
                            const tt = s / steps;
                            const mx = p1.x + (p2.x - p1.x)*tt + (Math.random()-0.5)*28;
                            const my = p1.y + (p2.y - p1.y)*tt + (Math.random()-0.5)*28;
                            ctx.lineTo(mx, my);
                        }
                        ctx.lineTo(p2.x, p2.y);
                        ctx.stroke();
                        ctx.shadowBlur = 0; ctx.restore();
                    }

                    // Cinematic post-processing (vignette + film grain)
                    this.drawPostFX(ctx, w, h, dP);

                    ctx.restore();
                    this.drawMinimap();
                }

                loop() {
                    const n = performance.now();
                    let dt = (n - this.lastT) / (1000 / 60);
                    if (dt > 3) dt = 3;
                    this.lastT = n;
                    this.frames++;

                    if (this.state === "playing") {
                        this.update(dt * this.ts);
                    }
                    this.draw(dt * (this.state === "playing" ? this.ts : 1));

                    requestAnimationFrame(() => this.loop());
                }
            }

