import { CONFIG } from '../config.js';
import { LEVELS } from '../data/levels.js';
import { rand } from '../utils.js';

/**
 * @typedef {Object} WaveController The duck-typed interface both managers below
 *   satisfy (game.waveM). Note the deliberately different invariants:
 *   WaveManager tracks `pending` and completes; EndlessWave never does.
 * @property {(dt:number)=>void} update
 * @property {()=>boolean} isComplete
 * @property {()=>boolean} canCall
 * @property {()=>boolean} callWave
 * @property {number} cw
 * @property {number} tw
 * @property {number} [wave]
 */

// Schedule a wave's enemies as staggered setTimeouts. Each plan entry is
// { type, delayMs, xMin, xMax, track }. The caller computes delayMs (so the
// campaign per-group jitter is applied once, at schedule time, in loop order);
// the x position is randomized at spawn time as before. track:true bumps
// mgr.pending around the spawn (campaign victory gating); endless passes false.
function scheduleSpawns(mgr, plan) {
    plan.forEach((s) => {
        if (s.track) mgr.pending++;
        setTimeout(() => {
            if (s.track) mgr.pending--;
            if (mgr.g.state === "playing")
                mgr.g.spawnEnemy(
                    s.type,
                    CONFIG.WORLD_WIDTH - rand(s.xMin, s.xMax),
                    CONFIG.GROUND_Y,
                );
        }, s.delayMs);
    });
}

export class WaveManager {
    constructor(g, lvl) {
        this.g = g;
        this.wvs = JSON.parse(JSON.stringify(LEVELS[lvl].waves));
        this.cw = 0;
        this.t = 0;
        this.tw = this.wvs.length;
        this.pending = 0; // scheduled-but-not-yet-spawned enemies
    }
    update(dt) {
        if (this.cw >= this.tw) return;
        this.t += dt;
        if (this.t >= this.wvs[this.cw].time * 60) this.advance();
    }
    advance() {
        const w = this.wvs[this.cw];
        this.spawn(w);
        this.cw++;
        this.t = 0;
        // A wave flagged `boss:true` summons the Hollow Engine as a special
        // event alongside its (usually light) escort — a scripted boss finale.
        if (w && w.boss) this.g.spawnBossEncounter();
        this.g.audio.playTone(400, 0.5, "sine", 0.1);
        this.g.audio.playTone(600, 0.5, "sine", 0.1, 0.2);
        this.g.notify(`Wave ${this.cw} incoming!`);
        if (this.cw >= this.tw)
            setTimeout(
                () => this.g.notify("Final wave! Hold the line!"),
                2000,
            );
    }
    // Is there still a wave waiting to be summoned?
    canCall() {
        return this.cw < this.tw;
    }
    // Player chose not to wait out the timer — send the next wave now.
    callWave() {
        if (this.cw >= this.tw) return false;
        this.advance();
        return true;
    }
    spawn(w) {
        const plan = [];
        w.enemies.forEach((gr) => {
            for (let i = 0; i < gr.c; i++) {
                plan.push({
                    type: gr.t,
                    delayMs: i * 700 + rand(0, 200),
                    xMin: 100,
                    xMax: 400,
                    track: true,
                });
            }
        });
        scheduleSpawns(this, plan);
    }
    isComplete() {
        // No victory while staggered spawns are still in flight — otherwise
        // clearing a wave quickly could skip the rest of the level.
        return (
            this.cw >= this.tw &&
            this.pending === 0 &&
            this.g.enemies.length === 0
        );
    }
}

export class EndlessWave {
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
        if (this.t >= this.int) this.advance();
    }
    advance() {
        this.t = 0;
        this.wave++;
        this.cw++;
        this.g.diff = 1 + this.wave * 0.15;
        // Reaching each endless wave banks Renown immediately, so deep runs
        // are rewarded even if you quit before dying.
        if (this.g.meta) this.g.meta.addRenown(Math.ceil(this.wave * 1.5));
        this.spawn();
        const isBoss = this.wave % 5 === 0;
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
            // Every tenth wave, the Hollow Engine itself derails onto the field
            // as a full boss encounter (on top of the elite Boss March).
            if (this.wave % 10 === 0) this.g.spawnBossEncounter();
        } else {
            this.g.audio.playTone(400, 0.5, "sine", 0.1);
            this.g.notify(
                `Endless Wave ${this.wave}: ${this.themeName(this.wave)} — Power x${(1 + this.wave * 0.15).toFixed(1)}`,
            );
        }
        this.int = Math.max(240, 700 - this.wave * 12);
    }
    // Endless always has another wave ready to summon.
    canCall() {
        return true;
    }
    callWave() {
        this.advance();
        return true;
    }
    // Endless waves are scripted, not random: five rotating themes, each
    // demanding a different counter, telegraphed in the wave preview.
    themeName(w) {
        if (w % 5 === 0) return "Boss March";
        return ["Swarm", "Raiding Party", "Shield Wall", "Dark Ritual"][
            (w % 5) - 1
        ];
    }
    composition(w) {
        const s = Math.floor(1 + w * 0.6); // scaling knob
        if (w % 5 === 0) {
            // Boss March: armored elites, a dragon past wave 10
            return [
                { t: "ogre", c: Math.min(1 + Math.floor(w / 5), 10) },
                { t: "shaman", c: Math.min(1 + Math.floor(w / 8), 6) },
                { t: "dragon", c: w >= 10 ? Math.floor(w / 10) : 0 },
            ];
        }
        switch (w % 5) {
            case 1: // Swarm: bodies — AoE and cheap lines shine
                return [
                    { t: "rabble", c: 6 + s * 2 },
                    { t: "marauder", c: w > 5 ? s : 0 },
                ];
            case 2: // Raiding Party: fast slashers hunting your backline
                return [
                    { t: "marauder", c: 3 + s },
                    { t: "berserker", c: 2 + Math.floor(s * 0.8) },
                ];
            case 3: // Shield Wall: arrows bounce — bring blunt or magic
                return [
                    { t: "shieldman", c: 3 + s },
                    { t: "archer", c: 2 + Math.floor(s * 0.7) },
                ];
            default: // Dark Ritual: healers & necromancers must die first
                return [
                    { t: "shaman", c: 1 + Math.floor(s / 2) },
                    { t: "marauder", c: 3 + s },
                    { t: "necromancer", c: w > 8 ? Math.floor(w / 6) : 0 },
                ];
        }
    }
    spawn() {
        let i = 0;
        const plan = [];
        this.composition(this.wave).forEach((gr) => {
            for (let k = 0; k < gr.c; k++, i++) {
                plan.push({
                    type: gr.t,
                    delayMs: i * 500,
                    xMin: 50,
                    xMax: 300,
                    track: false,
                });
            }
        });
        scheduleSpawns(this, plan);
    }
    isComplete() {
        return false;
    }
}
