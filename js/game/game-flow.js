import { TEAMS } from '../config.js';
import { LEVELS } from '../data/levels.js';
import { Building } from '../entities/building.js';
import { EndlessWave, WaveManager } from '../systems/waves.js';

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
        this.reset(300);
        const m = new Building(420, "mine", TEAMS.PLAYER);
        m.building = false;
        m.bTimer = 0;
        this.buildings.push(m);
        this.waveM = new EndlessWave(this);
        this.play();
        this.notify("Survive as long as you can!");
    },

    loadLvl(i) {
        this.level = i;
        this.reset(LEVELS[i].startGold);
        this.waveM = new WaveManager(this, i);
        this.weather.set(LEVELS[i].weather);
        this.play();
        this.notify("Region: " + LEVELS[i].name);
    },

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
