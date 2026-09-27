import { TEAMS } from '../config.js';

// --- GAME: power level (installed onto Game.prototype) -----------------------
// Your side grows stronger the longer you hold out. powerLevel() starts at 1
// and climbs with every wave survived and every minute of the run. It scales:
//   - the castle's damage and max HP,
//   - the Voidcaller's damage and max HP,
//   - the orbital beam's damage, reach and girth (read in orbital.js).
// Stats are rescaled from each entity's run-start base (captured on first
// sight), so tech/meta bonuses applied at spawn are preserved and multiplied.

export const POWER = {
    perWave: 0.15,   // +15% per wave survived
    perMinute: 0.06, // +6% per minute in the run
    hpShare: 0.6,    // HP grows at 60% of the damage rate
    notifyStep: 0.5, // announce every +0.5x
};

export const powerMethods = /** @type {ThisType<any>} */ ({
    // Waves survived so far (campaign: waves called; endless: wave number).
    waveCount() {
        const w = this.waveM;
        if (!w) return 0;
        return this.mode === "endless" ? w.wave || 0 : w.cw || 0;
    },

    powerLevel() {
        const mins = (this.runFrames || 0) / 3600;
        return 1 + this.waveCount() * POWER.perWave + mins * POWER.perMinute; // uncapped
    },

    resetPower() {
        this.runFrames = 0;
        this._powerStep = 0;
    },

    updatePower(dt) {
        this.runFrames = (this.runFrames || 0) + dt;
        const p = this.powerLevel();
        for (const b of this.buildings) if (b.type === "castle" && b.team === TEAMS.PLAYER) this._empower(b, p);
        if (this.hero) this._empower(this.hero, p);
        const step = Math.floor((p - 1) / POWER.notifyStep + 1e-9);
        if (step > (this._powerStep || 0)) {
            this._powerStep = step;
            this.notify(`⚡ Power level rising! Castle, orbital beam and Voidcaller are now ×${p.toFixed(1)}`);
            this.audio.playTone(523, 0.15, "triangle", 0.08);
            this.audio.playTone(784, 0.25, "triangle", 0.08, 0.12);
            const c = this.buildings.find((b) => b.type === "castle");
            if (c) this.fx.ring(c.x, c.y - c.h * 0.5, { r0: 10, r1: 160, col: "#60a5fa", w: 4, life: 26 });
            if (this.hero && this.hero.active) this.fx.ring(this.hero.x, this.hero.y - 40, { r0: 6, r1: 90, col: "#c084fc", w: 3, life: 22 });
        }
    },

    _empower(e, p) {
        if (!e._base) e._base = { dmg: e.dmg, maxHp: e.maxHp };
        e.dmg = e._base.dmg * p;
        const nm = e._base.maxHp * (1 + (p - 1) * POWER.hpShare);
        if (nm > e.maxHp) {
            const gain = nm - e.maxHp;
            e.maxHp = nm;
            if (e.hp > 0) e.hp = Math.min(nm, e.hp + gain); // growth heals the new headroom
        }
    },
});
