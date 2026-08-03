// --- DATA-DRIVEN VFX REGISTRY -----------------------------------------------
//
// A high-level, composable effects layer. Gameplay code calls
// `game.vfx.spawn('explosion', x, y, opts)` instead of hand-assembling 4–6
// particle/fx/decal/shake calls at every site. Each named effect is a recipe
// that composes the game's EXISTING primitives:
//
//   game.particles.emit(...)   — bursts (GPU-accelerated when WebGPU is active)
//   game.fx.flash/ring/spark   — transient combat feedback (Canvas 2D "screen")
//   game.decals.add(...)       — scorch/blood ground marks
//   game.cameraFX.impulse(...) — typed directional camera kicks
//   game.shake = max(...)      — ambient screen shake
//   game.lights.add(...)       — dynamic point lights (WebGPU only; no-op else)
//
// Because every recipe bottoms out in primitives that already exist and already
// fall back to Canvas 2D, `spawn` produces AT LEAST today's visuals on the
// lowest tier and richer visuals (GPU particles + real lights) on WebGPU — with
// no second code path to maintain.
//
// `opts` knobs (all optional): scale (spatial multiplier), power (intensity /
// particle-count multiplier), color (fire/spark tint), shake (ambient amp
// override), dir {x,y} (muzzle/recoil direction), ground (y for decals).

import { CONFIG } from '../config.js';

/** @typedef {{x:number,y:number,scale?:number,power?:number,color?:string,shake?:number,dir?:{x:number,y:number},ground?:number}} FXCtx */

// Register a dynamic light if the lighting system is present (WebGPU tier).
// No-op on WebGL/Canvas fallback so recipes stay single-path.
function light(g, x, y, desc) {
    if (g.lights && typeof g.lights.add === "function") g.lights.add({ x, y, ...desc });
}

// Register a scene-space distortion (compositor/cinematic tier only; no-op else).
function distort(g, x, y, desc) {
    if (g.wgpu && typeof g.wgpu.addDistortion === "function") g.wgpu.addDistortion({ x, y, ...desc });
}

// Ground Y for a decal (defaults to the world ground line, like the old sites).
function groundY(o) { return o.ground != null ? o.ground : CONFIG.GROUND_Y; }

// One entry per named effect. Signature: (g, x, y, o) => void, where o is the
// resolved options object (always has x,y; scale/power default to 1).
const EFFECTS = {
    // Full explosion: flash → fireball → sparks → debris → smoke → shockwave →
    // dynamic light → camera punch → scorch decal.
    explosion(g, x, y, o) {
        const s = o.scale, p = o.power;
        const fire = o.color || "#f97316";
        g.fx.flash(x, y, { r: 34 * s, col: "#fdba74", life: 12 });
        g.fx.ring(x, y, { r0: 8 * s, r1: 90 * s, col: "#fb923c", w: 4, life: 20 });
        g.fx.ring(x, y, { r0: 4 * s, r1: 60 * s, col: "#fed7aa", w: 2, life: 14 });
        g.particles.emit(x, y, Math.round(26 * p), fire, 9 * s, 3.2 * s, "spark");
        g.particles.emit(x, y, Math.round(30 * p), "#e5e7eb", 4 * s, 6 * s, "float"); // smoke
        g.particles.emit(x, y, Math.round(10 * p), "#6b5a44", 7 * s, 3.4 * s, "debris");
        light(g, x, y, { radius: 190 * s, intensity: 1.5 * p, color: fire, falloff: 2, flicker: 0.25, life: 22 });
        distort(g, x, y, { maxR: 210 * s, strength: 15 * s, width: 46, life: 26, kind: 0 });
        // Lingering heat shimmer rising off the blast (cinematic tier).
        distort(g, x, y - 20 * s, { maxR: 130 * s, strength: 6 * s, life: 20, kind: 1 });
        g.shake = Math.max(g.shake, o.shake != null ? o.shake : 14 * s);
        g.decals.add(x, groundY(o), "scorch", 34 * s);
    },

    // Weapon/gun muzzle: sharp flash + directional spark cone + brief light +
    // opposite-direction recoil kick.
    muzzleFlash(g, x, y, o) {
        const s = o.scale;
        const d = o.dir || { x: 1, y: 0 };
        const ang = Math.atan2(d.y, d.x);
        g.fx.flash(x, y, { r: 16 * s, col: "#fde68a", life: 6 });
        g.fx.spark(x, y, ang, { n: 5, spread: 0.5, len: 18 * s, col: "#fde68a", w: 2, life: 7 });
        g.particles.emit(x, y, Math.round(4 * o.power), "#fde68a", 6 * s, 1.8 * s, "spark");
        light(g, x, y, { radius: 70 * s, intensity: 1.1, color: "#fde68a", falloff: 2.5, flicker: 0.4, life: 6 });
        // Recoil kicks the view opposite the shot direction.
        g.cameraFX.impulse({ x: -d.x, y: -d.y, mag: 2.4 * s, freq: 1.3, decay: 0.32 });
    },

    // Projectile / arrow impact: small flash, spark scatter, dust, small light.
    impact(g, x, y, o) {
        const s = o.scale;
        const col = o.color || "#fed7aa";
        g.fx.flash(x, y, { r: 14 * s, col, life: 6 });
        g.fx.spark(x, y, o.dir ? Math.atan2(o.dir.y, o.dir.x) + Math.PI : -Math.PI / 2,
            { n: 4, spread: 0.9, len: 12 * s, col, w: 2, life: 6 });
        g.particles.emit(x, y, Math.round(6 * o.power), col, 5 * s, 2 * s, "spark");
        light(g, x, y, { radius: 60 * s, intensity: 0.8, color: col, falloff: 2.5, flicker: 0, life: 6 });
    },

    // Sustained-ish fire lick: rising embers + flicker light + wisp of smoke.
    fire(g, x, y, o) {
        const s = o.scale;
        g.particles.emit(x, y, Math.round(4 * o.power), o.color || "#fb923c", 3 * s, 2.4 * s, "float");
        g.particles.emit(x, y - 6 * s, Math.round(2 * o.power), "#9ca3af", 2 * s, 3 * s, "float");
        light(g, x, y, { radius: 90 * s, intensity: 1.0, color: o.color || "#fb923c", falloff: 2, flicker: 0.5, life: 10 });
        // Rising heat haze above the flame (cinematic tier).
        distort(g, x, y - 12 * s, { maxR: 70 * s, strength: 3.5 * s, life: 8, kind: 1 });
    },

    // Spark burst (parries, ricochets, energy fizz).
    sparks(g, x, y, o) {
        const s = o.scale;
        const col = o.color || "#fde68a";
        const ang = o.dir ? Math.atan2(o.dir.y, o.dir.x) : -Math.PI / 2;
        g.fx.spark(x, y, ang, { n: 6, spread: 0.8, len: 16 * s, col, w: 2, life: 7 });
        g.particles.emit(x, y, Math.round(8 * o.power), col, 6 * s, 1.8 * s, "spark");
    },

    // Drifting smoke puff.
    smoke(g, x, y, o) {
        const s = o.scale;
        g.particles.emit(x, y, Math.round(10 * o.power), o.color || "#9ca3af", 3 * s, 5 * s, "float");
    },

    // Debris scatter (destruction, heavy death), leaves a small mark.
    debris(g, x, y, o) {
        const s = o.scale;
        g.particles.emit(x, y, Math.round(10 * o.power), o.color || "#6b5a44", 7 * s, 3.2 * s, "debris");
        g.fx.ring(x, y, { r0: 3 * s, r1: 30 * s, col: "#78716c", w: 2, life: 12 });
    },
};

export class VFXRegistry {
    /** @param {any} game */
    constructor(game) { this.game = game; }

    /** @returns {boolean} whether a named effect exists. */
    has(name) { return Object.prototype.hasOwnProperty.call(EFFECTS, name); }

    /**
     * Play a named composable effect at a world position.
     * @param {string} name effect id (see EFFECTS)
     * @param {number} x world x
     * @param {number} y world y
     * @param {object} [opts] scale/power/color/shake/dir/ground overrides
     */
    spawn(name, x, y, opts) {
        const fx = EFFECTS[name];
        if (!fx) return;
        const o = opts || {};
        // Resolve defaults once so recipes can assume scale/power exist.
        const ctx = {
            scale: o.scale != null ? o.scale : 1,
            power: o.power != null ? o.power : 1,
            color: o.color,
            shake: o.shake,
            dir: o.dir,
            ground: o.ground,
        };
        // Never let a VFX error break gameplay (smoke fails on console.error).
        try { fx(this.game, x, y, ctx); } catch (e) { /* swallow — cosmetic only */ }
    }
}
