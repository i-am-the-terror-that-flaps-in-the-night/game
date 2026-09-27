import { CONFIG } from '../config.js';
import { clamp, rand } from '../utils.js';

// --- TERRAIN: rolling hills + slow ground patches ---
// The battlefield stays 1-D for logic (x drives targeting), but the ground is a
// height curve: every ground-standing thing sits at groundAt(x). Heights are
// relative to CONFIG.GROUND_Y ("sea level"), so a window resize needs no
// rebuild. A flat layout (no hills, no patches) makes groundAt(x) exactly
// CONFIG.GROUND_Y, i.e. the original game.

const STEP = 4;          // px between height samples
const MAX_H = 70;        // tallest allowed hill — keeps slopes walkable/readable
const MIN_W = 300;       // narrowest allowed hill base

// Slow-ground kinds. `slow` multiplies walking speed (flyers are immune).
export const TERRAIN_PATCHES = {
    mud:   { name: "Mud",       slow: 0.6,  top: "#3b2a1a", sheen: "#6b4f33", fx: "#5b4631" },
    snow:  { name: "Snowdrift", slow: 0.75, top: "#dbe4ee", sheen: "#f8fafc", fx: "#e2e8f0" },
    marsh: { name: "Marsh",     slow: 0.65, top: "#1c3b36", sheen: "#5eead4", fx: "#94a3b8" },
};

// High-ground combat tuning, shared by combat.js (damage) and unit.js (range).
// dh = target.y - attacker ground y (positive = attacker stands higher).
export const HIGH_GROUND = {
    minDh: 24,        // height gap before the edge applies
    bonus: 1.15,      // damage shooting/striking downhill
    penalty: 0.9,     // damage shooting/striking uphill
    rangeK: 1 / 300,  // extra range fraction per px of height advantage...
    rangeMax: 0.2,    // ...capped at +20%
};

export class Terrain {
    constructor() {
        this.samples = new Float32Array(Math.ceil(CONFIG.WORLD_WIDTH / STEP) + 2);
        this.hills = [];
        this.patches = [];
        this.zones = []; // temporary slow zones (hazards): {x0,x1,slow,life,kind}
    }

    // spec: { hills:[{x,w,h}], patches:[{x0,x1,kind}] } — null/undefined = flat.
    load(spec) {
        const s = spec || {};
        this.hills = (s.hills || []).map((h) => ({
            x: h.x,
            w: Math.max(MIN_W, h.w),
            h: clamp(h.h, 0, MAX_H),
        }));
        this.patches = (s.patches || []).filter((p) => TERRAIN_PATCHES[p.kind]).map((p) => ({ ...p }));
        this.zones = [];
        this.samples.fill(0);
        for (const h of this.hills) {
            const half = h.w / 2;
            const i0 = Math.max(0, Math.floor((h.x - half) / STEP));
            const i1 = Math.min(this.samples.length - 1, Math.ceil((h.x + half) / STEP));
            for (let i = i0; i <= i1; i++) {
                const d = (i * STEP - h.x) / half;
                if (d > -1 && d < 1) this.samples[i] += h.h * 0.5 * (1 + Math.cos(d * Math.PI));
            }
        }
        // Summed bumps may overlap — keep the whole curve inside the height cap.
        for (let i = 0; i < this.samples.length; i++)
            if (this.samples[i] > MAX_H) this.samples[i] = MAX_H;
    }

    flat() { this.load(null); }

    isFlat() { return this.hills.length === 0; }

    heightAt(x) {
        const f = clamp(x, 0, CONFIG.WORLD_WIDTH) / STEP;
        const i = Math.floor(f);
        const a = this.samples[i], b = this.samples[i + 1];
        return a + (b - a) * (f - i);
    }

    groundAt(x) { return CONFIG.GROUND_Y - this.heightAt(x); }

    // Rise per px of +x (positive = ground climbs toward the right).
    slopeAt(x) { return (this.heightAt(x + 8) - this.heightAt(x - 8)) / 16; }

    patchAt(x) {
        for (const p of this.patches) if (x >= p.x0 && x <= p.x1) return p;
        return null;
    }

    zoneAt(x) {
        for (const z of this.zones) if (x >= z.x0 && x <= z.x1) return z;
        return null;
    }

    addZone(x0, x1, slow, life, kind) {
        this.zones.push({ x0, x1, slow, life, kind });
    }

    update(dt) {
        for (let i = this.zones.length - 1; i >= 0; i--) {
            this.zones[i].life -= dt;
            if (this.zones[i].life <= 0) this.zones.splice(i, 1);
        }
    }

    // Walking-speed multiplier for a ground unit moving in direction dir (±1):
    // climbing costs up to -25%, descending gives up to +10%, then slow ground.
    speedMult(e, dir) {
        if (e.flying) return 1;
        let m = 1;
        const s = this.slopeAt(e.x) * dir;
        if (s > 0) m *= Math.max(0.75, 1 - s * 0.6);
        else if (s < 0) m *= Math.min(1.1, 1 - s * 0.25);
        const p = this.patchAt(e.x);
        if (p) m *= TERRAIN_PATCHES[p.kind].slow;
        const z = this.zoneAt(e.x);
        if (z) m *= z.slow;
        return m;
    }

    // Short human-readable description of the ground at x (hover tooltip).
    describe(x) {
        const parts = [];
        const h = this.heightAt(x);
        if (h >= HIGH_GROUND.minDh)
            parts.push(`<b>High ground</b> (+${Math.round(h)}) — ranged reach farther; attacks downhill ×${HIGH_GROUND.bonus}, uphill ×${HIGH_GROUND.penalty}`);
        else if (Math.abs(this.slopeAt(x)) > 0.12) parts.push("<b>Slope</b> — slower climbing, faster descent");
        const p = this.patchAt(x);
        if (p) parts.push(`<b>${TERRAIN_PATCHES[p.kind].name}</b> — ×${TERRAIN_PATCHES[p.kind].slow} move speed`);
        const z = this.zoneAt(x);
        if (z) parts.push(`<b>Whiteout</b> — ×${z.slow} move speed`);
        return parts.join("<br>");
    }

    // Random Endless layout: 1–3 hills and 0–2 patches in the contested middle.
    static randomLayout() {
        const hills = [];
        const nh = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < nh; i++) {
            const x = 900 + ((i + rand(0.15, 0.85)) * 2900) / nh;
            hills.push({ x: Math.round(x), w: Math.round(rand(340, 620)), h: Math.round(rand(34, MAX_H)) });
        }
        const kinds = Object.keys(TERRAIN_PATCHES);
        const patches = [];
        const np = Math.floor(Math.random() * 3);
        for (let i = 0; i < np; i++) {
            const x0 = Math.round(rand(800, 3700));
            patches.push({ x0, x1: x0 + Math.round(rand(140, 260)), kind: kinds[Math.floor(Math.random() * kinds.length)] });
        }
        return { hills, patches };
    }
}

// The one live battlefield. Module-level (like CONFIG) so leaf modules —
// particles, projectiles, decals — can find the ground without a game handle.
export const terrain = new Terrain();
export function groundAt(x) { return terrain.groundAt(x); }
