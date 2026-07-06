// --- GAME: core state, lifecycle & main loop ---
// (flow/economy/input/ui/render methods are mixed into Game.prototype
//  from the other js/game/*.js files)
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
        // Only basic troops to start — buildings unlock the rest
        // (Barracks, Archery Range, Academy, War Forge).
        this.unlocked = {
            u: new Set(["militia", "archer"]),
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

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        CONFIG.GROUND_Y = Math.max(
            window.innerHeight - 180,
            window.innerHeight * 0.6,
        );
        this._buildBackdropCache();
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
        // Each level starts from basics: rebuild your war economy.
        this.unlocked.u = new Set(["militia", "archer"]);
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

            document.getElementById("victoryStats").innerHTML =
                `<div class="stat-row"><span>Enemies Destroyed</span><span>${this.stats.kills}</span></div><div class="stat-row"><span>Bounty Claimed</span><span>${Math.floor(this.stats.gold)}</span></div><div class="stat-row"><span>Region Reward</span><span style="color:var(--gold);">+${r} Gold</span></div>`;
            document.getElementById("btnNextLevel").style.display =
                this.level + 1 < LEVELS.length ? "block" : "none";
        } else {
            document.getElementById("victoryStats").innerHTML =
                '<p style="text-align:center;color:var(--text-dim);">Endless mode has no end. You fought well.</p>';
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
            document.getElementById("endStats").innerHTML =
                `<div class="stat-row"><span>Enemies Destroyed</span><span>${this.stats.kills}</span></div><div class="stat-row"><span>Waves Survived</span><span style="color:var(--gold);">${w}</span></div><div class="stat-row"><span>Survival Time</span><span>${formatTime((Date.now() - this.stats.start) / 1000)}</span></div><div class="stat-row"><span>Best Wave Ever</span><span style="color:var(--success);">${this.bestEndlessWave}</span></div>`;
        } else {
            document.getElementById("endStats").innerHTML =
                `<div class="stat-row"><span>Enemies Destroyed</span><span>${this.stats.kills}</span></div><div class="stat-row"><span>Survival Time</span><span>${formatTime((Date.now() - this.stats.start) / 1000)}</span></div>`;
        }
        document
            .getElementById("gameOver")
            .classList.remove("hidden");
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
