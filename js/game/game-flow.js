import { TEAMS } from '../config.js';
import { LEVELS } from '../data/levels.js';
import { Building } from '../entities/building.js';
import { EndlessWave, WaveManager } from '../systems/waves.js';
import { Terrain } from '../systems/terrain.js';

// Endless hazard rolls — each pairs a hazard with the weather that sells it.
// (Rockslide needs hills, which every random layout has.)
const ENDLESS_HAZARDS = [
    { weather: "rain", hazard: { type: "lightning", every: [22, 36] } },
    { weather: "none", hazard: { type: "rockslide", every: [24, 38] } },
    { weather: "snow", hazard: { type: "whiteout", every: [26, 40] } },
    { weather: "none", hazard: { type: "fireVent", every: [20, 32] } },
];

// --- GAME: campaign / endless / level flow (installed onto Game.prototype by
// install-mixins.js) ---
export const flowMethods = /** @type {ThisType<any>} */ ({
    startCampaign() {
        this.audio.init();
        this.audio.startMusic();
        document.getElementById('difficultyOverlay').classList.remove('hidden');
    },

    startCampaignWithDiff(mult) {
        this.difficultyMult = mult;
        document.getElementById('difficultyOverlay').classList.add('hidden');
        this.mode = "campaign";
        this.loadLvl(this.maxUnlockedLevel);
    },

    startEndless() {
        this.audio.init();
        this.audio.startMusic();
        this.mode = "endless";
        this.level = -1;
        // Each Endless run rolls its own battlefield and a matching hazard.
        this.terrain.load(Terrain.randomLayout());
        const roll = ENDLESS_HAZARDS[Math.floor(Math.random() * ENDLESS_HAZARDS.length)];
        this.reset(300);
        const m = new Building(420, "mine", TEAMS.PLAYER);
        m.building = false;
        m.bTimer = 0;
        this.buildings.push(m);
        this.waveM = new EndlessWave(this);
        this.weather.set(roll.weather);
        this.hazards.set(roll.hazard);
        this.play();
        this.notify("Survive as long as you can!");
    },

    loadLvl(i) {
        this.level = i;
        this.terrain.load(LEVELS[i].terrain); // before reset: castle/hero sit on it
        this.reset(LEVELS[i].startGold);
        this.waveM = new WaveManager(this, i);
        this.weather.set(LEVELS[i].weather);
        this.hazards.set(LEVELS[i].hazard);
        this.play();
        this.notify("Region: " + LEVELS[i].name);
    },

    returnToMenu() {
        this.state = "menu";
        this.clearBoss();
        this.hazards.clear();
        this.audio.stopMusic();
        this.spells.cancel();
        document
            .querySelectorAll(".overlay")
            .forEach((e) => e.classList.add("hidden"));
        document
            .getElementById("mainMenu")
            .classList.remove("hidden");
    },

    // "Call Wave" button / N key: skip the countdown and summon the next wave
    // immediately. No-op if not actively playing or no wave is queued.
    callWave() {
        if (this.state !== "playing" || !this.waveM) return;
        if (this.waveM.callWave()) this.audio.playTone(880, 0.08, "square", 0.1);
    },

    restartLevel() {
        if (this.mode === "endless") this.startEndless();
        else this.loadLvl(this.level);
    },

    nextLevel() {
        if (this.level + 1 < LEVELS.length)
            this.loadLvl(this.level + 1);
        else {
            this.notify("Campaign Complete! Victory is yours!");
            this.returnToMenu();
        }
    },
});
