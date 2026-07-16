import { AudioEngine } from '../systems/audio.js';
import { Camera } from '../systems/camera.js';
import { CONFIG, RESOURCES, TEAMS } from '../config.js';
import { LEVELS } from '../data/levels.js';
import { Building } from '../entities/building.js';
import { Hero } from '../entities/hero.js';
import { MetaProgression } from '../systems/meta.js';
import { SpellManager } from '../systems/spell-manager.js';
import { loadJSON, saveJSON } from '../systems/storage.js';
import { formatTime } from '../utils.js';
import { DecalSystem, EffectSystem, ParticleSystem, WeatherSystem } from '../systems/vfx.js';
import { GFX, refreshGraphics } from '../systems/graphics.js';
import { GLRenderer } from '../systems/gl-renderer.js';

// --- GAME: core state, lifecycle & main loop ---
// (flow/economy/input/ui/render methods are mixed into Game.prototype
//  from the other js/game/*.js files — see js/main.js for the boot ordering
//  contract those mixins depend on.)
// Constructor order is load-bearing: systems that others depend on (audio,
// camera, spells) are built first; loadSave() runs before bindEvents(); and
// bindEvents() runs before loop() starts the frame cycle.
export class Game {
    constructor() {
        this.canvas = document.getElementById("gameCanvas");
        this.ctx = this.canvas.getContext("2d", { alpha: false });
        this.resize();
        window.addEventListener("resize", () => this.resize());

        this.audio = new AudioEngine();
        this.camera = new Camera();
        this.particles = new ParticleSystem();
        this.fx = new EffectSystem();
        this.decals = new DecalSystem();
        this.weather = new WeatherSystem();
        this.spells = new SpellManager();
        // GPU overlay for the additive glow layer (particles + hero/rift auras).
        // Falls back to Canvas 2D automatically if WebGL is unavailable.
        this.gl = new GLRenderer();
        this.gl.init();

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
        this.singularities = [];
        this.hero = null;
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
        this.chromaAberrationT = 0;
        this.frames = 0;
        this.lastT = performance.now();
        this.dayT = 0;
        this.mouse = { x: 0, y: 0 };
        this.keysDown = { left: false, right: false }; // held-key panning state

        this.lightningArcs  = [];
        this.formation       = 'defensive';
        this.difficultyMult  = 1.0;
        this._dragonKilled   = false;
        this.achievements    = null; // inited after game is declared
        this.meta            = new MetaProgression(this); // permanent unlocks
        this.loadSave(); // Fix #20
        refreshGraphics();
        this.resize();
        this.bindEvents();
        this.loop();
    }


    // Fix #20: Local Storage Persistence
    loadSave() {
        try {
            const s = loadJSON("stickman_dominion_save");
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
        saveJSON(
            "stickman_dominion_save",
            {
                maxUnlockedLevel: this.maxUnlockedLevel,
                bestEndlessWave: this.bestEndlessWave,
                volSound: document.getElementById("volSound").value,
                volMusic: document.getElementById("volMusic").value,
                pq: document.getElementById("particleQuality")
                    .value,
            },
            { swallow: false },
        );
        document.getElementById("btnStartCampaign").innerText =
            `Resume Campaign (${this.maxUnlockedLevel + 1})`;
    }

    resize() {
        const rs = GFX.renderScale || 1;
        this.vw = window.innerWidth;
        this.vh = window.innerHeight;
        this.canvas.width = Math.round(this.vw * rs);
        this.canvas.height = Math.round(this.vh * rs);
        CONFIG.GROUND_Y = Math.max(
            window.innerHeight - 180,
            window.innerHeight * 0.6,
        );
        // resize() runs once in the constructor before this.camera exists (the
        // Camera seeds viewW itself); guard for that first call.
        if (this.camera) this.camera.viewW = window.innerWidth;
        if (this.gl) this.gl.resize(this.vw, this.vh);
        this._buildBackdropCache();
    }

    reset(g) {
        this.clearBoss(); // tear down any prior boss encounter + engine audio
        if (this.difficultyMult < 1.0) g = Math.floor(g * 1.25);
        if (this.difficultyMult > 1.0) g = Math.floor(g * (this.difficultyMult > 1.2 ? 0.75 : 0.88));
        this.gold = g;
        // Full gold carryover: your entire banked treasury seeds this run's
        // starting gold and is consumed. (Permanent upgrades are bought from the
        // treasury in the War Council BEFORE starting the next run — anything
        // left carries in.)
        if (this.meta && this.meta.treasury > 0) {
            this.gold += this.meta.treasury;
            this.meta.treasury = 0;
            this.meta.save();
        }
        this.iron = RESOURCES.START_IRON;
        this.crystal = RESOURCES.START_CRYSTAL;
        this.spells.mana = this.spells.maxMana =
            RESOURCES.MAX_MANA + (this.upgrades.mana || 0);
        this.pop = 0;
        this.maxPop = 20 + (this.upgrades.pop || 0);
        // Each level starts from basics: rebuild your war economy. Permanently
        // unlocked troops (bought with Renown in the War Council) are always
        // available from the start, bypassing the per-level building gate.
        this.unlocked.u = new Set(["militia", "archer"]);
        if (this.meta) this.meta.applyTo(this.unlocked.u);
        this.autoQueue = {};
        this.units = [];
        this.enemies = [];
        this.buildings = [];
        this.projectiles = [];
        this.singularities = [];
        this.hero = null;
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
        // Later levels get a much deadlier (but still short-ranged)
        // castle and a fatter income stream — the early game stays hard,
        // the grind at the end doesn't.
        const lvl = Math.max(0, this.level);
        this.levelIncomeMult = 1 + lvl * 0.22;
        const castle = new Building(250, "castle", TEAMS.PLAYER);
        castle.dmg = Math.round(castle.dmg * (1 + lvl * 0.6));
        // Layer on banked permanent castle upgrades (Might/Bastion/Rapid/Reach).
        if (this.meta) this.meta.applyCastleUpgrades(castle);
        this.buildings.push(castle);
        // Spawn the hero near the castle at run start (campaign + endless), then
        // layer on his banked permanent upgrades (Power/Vitality/Attunement/Rift).
        this.hero = new Hero(340, "voidcaller");
        if (this.meta) this.meta.applyHeroUpgrades(this.hero);
        this.units.push(this.hero);
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

    // Camera scroll + easing, driven by RAW (unscaled) dt every frame from the
    // loop — decoupled from game state and timescale so scrolling stays smooth
    // and continuous even while paused or when the game speed changes. This is
    // what fixes the scroll "pauses/stops".
    updateCamera(dt) {
        // Scroll during active play AND while paused — the whole point of
        // decoupling from ts is that you can pan the battlefield when paused.
        const canScroll = this.state === "playing" || this.state === "paused";
        if (canScroll) {
            // Held-arrow/AD panning — continuous per-frame, smooth from frame 1.
            const kb = CONFIG.EDGE_SCROLL_SPEED * 1.3 * dt;
            if (this.keysDown.left) this.camera.pan(-kb);
            if (this.keysDown.right) this.camera.pan(kb);
            // Mouse edge-scroll (skipped while aiming a spell).
            if (!this.spells.active) {
                if (this.mouse.x > 0 && this.mouse.x < CONFIG.EDGE_SCROLL_MARGIN)
                    this.camera.pan(-CONFIG.EDGE_SCROLL_SPEED * dt);
                if (this.mouse.x > window.innerWidth - CONFIG.EDGE_SCROLL_MARGIN)
                    this.camera.pan(CONFIG.EDGE_SCROLL_SPEED * dt);
            }
        }
        this.camera.update(dt);
    }

    update(dt) {
        if (this.state !== "playing") return;

        this.dayT += 0.0002 * dt; // Fix #17: Slower cycle

        let buildingManaRegen = 0; // Fix #11: Dynamic mana calculation
        const iM = 1 + (this.upgrades.income || 0);
        const lvlM = this.levelIncomeMult || 1;
        this.buildings.forEach((b) => {
            if (!b.active || b.building) return;
            if (b.income.g)
                this.addGold((b.income.g * iM * lvlM * dt) / 60);
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

        // Update every entity that existed at the START of this frame. Capture
        // all four counts up front so anything spawned mid-frame (necromancer
        // summons -> enemies, towers/archers -> projectiles) is first updated
        // NEXT frame — exactly what the old combined-snapshot array did, but
        // without allocating that array every frame. The pre-captured lengths
        // are essential: a plain `i < this.arr.length` loop (or four forEach
        // calls) would re-read the grown array and process those new entities a
        // frame early. No entity update splices these arrays (removal is the
        // filter pass below), so indices 0..N-1 stay stable through the loop.
        const bN = this.buildings.length,
            uN = this.units.length,
            eN = this.enemies.length,
            pN = this.projectiles.length,
            sN = this.singularities.length;
        for (let i = 0; i < bN; i++) this.buildings[i].update(dt);
        for (let i = 0; i < uN; i++) this.units[i].update(dt);
        for (let i = 0; i < eN; i++) this.enemies[i].update(dt);
        for (let i = 0; i < pN; i++) this.projectiles[i].update(dt);
        for (let i = 0; i < sN; i++) this.singularities[i].update(dt);

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
        this.singularities = this.singularities.filter((s) => s.active);

        // Hero respawn: while down, tick the timer; when it clears, restore the
        // hero at its spawn point and re-push into this.units (it was filtered
        // out on death). Guard against double-push if it is somehow still there.
        if (this.hero && !this.hero.active && this.hero.respawnFrames > 0) {
            this.hero.respawnFrames = Math.max(0, this.hero.respawnFrames - dt);
            if (this.hero.respawnFrames === 0) {
                this.hero.active = true;
                this.hero.hp = this.hero.maxHp;
                this.hero.x = this.hero.spawnX;
                this.hero.state = "walk";
                this.hero.dmgTexts = [];
                if (!this.units.includes(this.hero)) this.units.push(this.hero);
            }
        }

        this.particles.update(dt);
        this.fx.update(dt);
        this.decals.update(dt);
        this.weather.update(dt, this.camera);
        if (this.shake > 0) {
            this.shake *= Math.pow(0.9, dt);
            if (this.shake < 0.5) this.shake = 0;
        }
        if (this.bossFlash > 0) {
            this.bossFlash *= Math.pow(0.85, dt);
            if (this.bossFlash < 0.02) this.bossFlash = 0;
        }

        // Boss encounter lifecycle (warning -> arrival -> defeat rewards). The
        // Boss entity itself lives in this.enemies and is updated/drawn/removed
        // by the normal enemy path; this only drives the encounter meta-state.
        this.updateBoss(dt);

        if (this.waveM) {
            this.waveM.update(dt);
            // Don't declare victory while a boss is still inbound or fighting —
            // the enemies array can momentarily empty during its warning phase.
            const bossBusy = this.bossState === "warning" || this.bossState === "active";
            if (this.waveM.isComplete() && !bossBusy) this.victory();
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
        this.clearBoss();
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
            const renown = this.meta ? this.meta.awardCampaign(this.level) : 0;
            // Bank leftover + region reward into the persistent treasury
            // (gold carryover) to spend on permanent upgrades.
            const banked = this.meta ? this.meta.bankGold(this.gold) : 0;

            document.getElementById("victoryStats").innerHTML =
                `<div class="stat-row"><span>Enemies Destroyed</span><span>${this.stats.kills}</span></div><div class="stat-row"><span>Bounty Claimed</span><span>${Math.floor(this.stats.gold)}</span></div><div class="stat-row"><span>Region Reward</span><span style="color:var(--gold);">+${r} Gold</span></div><div class="stat-row"><span>Gold Banked</span><span style="color:var(--gold);">+${banked} 🪙</span></div><div class="stat-row"><span>Renown Earned</span><span style="color:#c084fc;">+${renown} ✦</span></div>`;
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
        this.clearBoss();
        this.setSpeed(0);
        this.state = "defeat";
        this.audio.playError();
        this.audio.stopMusic();
        // Even in defeat, whatever gold you had banks into the treasury (gold
        // carryover). The line-383 re-entry guard prevents double-banking.
        const banked = this.meta ? this.meta.bankGold(this.gold) : 0;
        if (this.mode === "endless") {
            const w = this.waveM ? this.waveM.wave : 0;
            this.bestEndlessWave = Math.max(
                this.bestEndlessWave || 0,
                w,
            );
            this.saveGame(); // Fix #20
            document.getElementById("endStats").innerHTML =
                `<div class="stat-row"><span>Enemies Destroyed</span><span>${this.stats.kills}</span></div><div class="stat-row"><span>Waves Survived</span><span style="color:var(--gold);">${w}</span></div><div class="stat-row"><span>Survival Time</span><span>${formatTime((Date.now() - this.stats.start) / 1000)}</span></div><div class="stat-row"><span>Gold Banked</span><span style="color:var(--gold);">+${banked} 🪙</span></div><div class="stat-row"><span>Best Wave Ever</span><span style="color:var(--success);">${this.bestEndlessWave}</span></div>`;
        } else {
            document.getElementById("endStats").innerHTML =
                `<div class="stat-row"><span>Enemies Destroyed</span><span>${this.stats.kills}</span></div><div class="stat-row"><span>Survival Time</span><span>${formatTime((Date.now() - this.stats.start) / 1000)}</span></div><div class="stat-row"><span>Gold Banked</span><span style="color:var(--gold);">+${banked} 🪙</span></div>`;
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
        // Camera runs on RAW dt every frame (not ts-scaled, not state-gated) so
        // scrolling never stalls when paused or slowed.
        this.updateCamera(dt);
        this.draw(dt * (this.state === "playing" ? this.ts : 1));

        requestAnimationFrame(() => this.loop());
    }
}
