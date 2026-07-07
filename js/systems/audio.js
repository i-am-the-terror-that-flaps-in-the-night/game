import { randInt } from '../utils.js';

// --- AUDIO ENGINE ---
export class AudioEngine {
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
    // ── Boss "Rustmaw" cues ─────────────────────────────────────────────
    // Ominous inbound-warning swell.
    bossWarning() {
        this.playTone(70, 0.9, "sawtooth", 0.18);
        this.playTone(52, 1.3, "square", 0.12, 0.12);
        this.playTone(140, 0.5, "sawtooth", 0.08, 0.25);
    }
    // Corrupted furnace-ember shot.
    bossCinder() {
        this.playTone(300, 0.14, "sawtooth", 0.07);
        this.playTone(180, 0.2, "square", 0.05, 0.04);
    }
    // Phase-transition stinger (heavier the deeper the phase).
    bossPhase(p = 1) {
        this.playTone(150, 0.5, "sawtooth", 0.2);
        this.playTone(95, 0.7, "square", 0.15, 0.08);
        this.playTone(210 + p * 45, 0.3, "square", 0.1, 0.16);
    }
    // Guttural mechanical roar (arrival / charge / death).
    bossRoar() {
        this.playTone(60, 0.7, "sawtooth", 0.22);
        this.playTone(42, 0.95, "square", 0.18, 0.05);
        this.playTone(92, 0.5, "sawtooth", 0.12, 0.12);
    }
    // Sustained engine drone: two detuned low oscillators with a slow tremolo
    // LFO for a chugging horror hum. Held until stopBossEngine() tears it down
    // (playTone can't loop, so this manages its own nodes).
    startBossEngine() {
        if (!this.initDone || this.bossEngine) return;
        const t = this.ctx.currentTime;
        const out = this.ctx.createGain();
        out.gain.setValueAtTime(0.0001, t);
        out.gain.exponentialRampToValueAtTime(0.12, t + 1.2);
        out.connect(this.sfx);
        const o1 = this.ctx.createOscillator();
        o1.type = "sawtooth"; o1.frequency.value = 48;
        const o2 = this.ctx.createOscillator();
        o2.type = "square"; o2.frequency.value = 32.5;
        o1.connect(out); o2.connect(out);
        // Tremolo "chug" — LFO summed onto the output gain param.
        const lfo = this.ctx.createOscillator();
        lfo.type = "sine"; lfo.frequency.value = 3.4;
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = 0.05;
        lfo.connect(lfoGain); lfoGain.connect(out.gain);
        o1.start(t); o2.start(t); lfo.start(t);
        this.bossEngine = { out, o1, o2, lfo };
    }
    stopBossEngine() {
        const e = this.bossEngine;
        if (!e) return;
        this.bossEngine = null;
        try {
            const t = this.ctx.currentTime;
            e.out.gain.cancelScheduledValues(t);
            e.out.gain.setValueAtTime(0.1, t);
            e.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
            e.o1.stop(t + 0.45); e.o2.stop(t + 0.45); e.lfo.stop(t + 0.45);
        } catch (_) { /* nodes may already be stopped */ }
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
