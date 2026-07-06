// --- AUDIO ENGINE ---
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
