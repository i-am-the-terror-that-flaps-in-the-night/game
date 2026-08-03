// --- CAMERA FEEL: smooth shake + typed impulses -----------------------------
//
// Replaces the old per-frame white-noise shake (`_shakeX = rand(-shake,shake)`)
// with two blended sources:
//
//   1. Ambient trauma shake — driven by the existing scalar `game.shake`
//      amplitude (every one of the ~40 `game.shake = …` trigger sites keeps
//      working untouched). Instead of white noise we sample smooth, frame-
//      coherent multi-octave sine noise so the screen *rumbles* rather than
//      buzzing, and the amplitude follows trauma² for a punchier, faster-settling
//      falloff. `game.shake` still decays on its own (game.js update loop).
//
//   2. Typed directional impulses — `impulse({x,y,mag,freq,decay})` adds a
//      decaying oscillation along a direction (recoil that kicks opposite the
//      muzzle, an explosion punch, an impact kick). These are additive on top of
//      the ambient shake and each decays smoothly on its own timeline.
//
// The controller is pure math (no GPU, no DOM); it works on every graphics tier.
// `offset()` returns {x,y,rot}; the render pass translates (and optionally
// rotates) by it, and the same offset is fed to the GPU overlay via
// `_shakeX/_shakeY` so both layers shake identically (unchanged contract).

export class CameraFX {
    constructor() {
        /** @type {{x:number,y:number,mag:number,freq:number,decay:number,age:number}[]} */
        this.impulses = [];
        this.t = 0;      // phase clock (advances with dt, in 60fps frame units)
    }

    /**
     * Add a decaying directional camera kick.
     * @param {object} o
     * @param {number} [o.x] unit direction x (need not be normalized)
     * @param {number} [o.y] unit direction y
     * @param {number} o.mag peak offset in px
     * @param {number} [o.freq] oscillation speed (higher = snappier)
     * @param {number} [o.decay] exponential decay rate (higher = shorter)
     */
    impulse({ x = 0, y = -1, mag = 6, freq = 1.1, decay = 0.18 }) {
        const len = Math.hypot(x, y) || 1;
        this.impulses.push({ x: x / len, y: y / len, mag, freq, decay, age: 0 });
        // Bound the pool so a burst of triggers can't grow it without limit.
        if (this.impulses.length > 24) this.impulses.shift();
    }

    /** Advance impulse ages / phase clock and drop spent impulses. */
    update(dt) {
        this.t += dt;
        for (let i = this.impulses.length - 1; i >= 0; i--) {
            const im = this.impulses[i];
            im.age += dt;
            // Drop once the envelope has decayed below ~1% of peak.
            if (Math.exp(-im.decay * im.age) * im.mag < 0.15) this.impulses.splice(i, 1);
        }
    }

    /**
     * Current camera offset. Combines ambient trauma shake (from `shakeAmp`)
     * with all live directional impulses.
     * @param {number} shakeAmp the scalar `game.shake` amplitude (px)
     * @returns {{x:number, y:number, rot:number}}
     */
    offset(shakeAmp) {
        let x = 0, y = 0, rot = 0;
        const t = this.t;

        if (shakeAmp > 0) {
            // trauma² gives a punchier curve that settles faster than linear.
            const trauma = Math.min(1, shakeAmp / 30);
            const amp = shakeAmp * (0.4 + 0.6 * trauma);
            // Two incommensurate octaves per axis → smooth, non-repeating rumble.
            x += amp * (Math.sin(t * 3.7) * 0.6 + Math.sin(t * 8.3 + 1.7) * 0.4);
            y += amp * (Math.sin(t * 4.1 + 2.1) * 0.6 + Math.sin(t * 9.7 + 0.5) * 0.4);
            rot += trauma * 0.010 * Math.sin(t * 5.3);   // subtle roll on big hits
        }

        for (const im of this.impulses) {
            const env = Math.exp(-im.decay * im.age) * im.mag;
            const osc = Math.cos(im.freq * im.age * Math.PI);
            x += im.x * env * osc;
            y += im.y * env * osc;
        }
        return { x, y, rot };
    }
}
