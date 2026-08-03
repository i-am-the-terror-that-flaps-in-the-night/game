// --- DYNAMIC 2D LIGHTING ----------------------------------------------------
//
// Screen-space additive point lights. Explosions, muzzle flashes, fire and
// glowing projectiles register a coloured light; each frame the live lights are
// queued into the active GPU glow overlay (WebGPU or WebGL) as large, soft,
// colour-modulated radials, so the surrounding world visibly brightens where
// light falls. This is the "lighting affects the world" deliverable within the
// additive-overlay model (brighten-only; true relief shading for the hero/boss
// comes from their baked normal maps — see the wgpu normal-lit pass).
//
// Lights live in WORLD space (they track the camera/pan) and decay over a short
// life. The system is a no-op when the overlay is unavailable or GFX.lights is
// off (performance tier), so there is no Canvas-2D fallback cost.
//
// Because lights bottom out in the shared `overlay.glow()` primitive, they work
// on every GPU backend with zero backend-specific code.

import { GLRenderer } from './gl-renderer.js';
import { GFX } from './graphics.js';

export class LightSystem {
    constructor() {
        /** @type {{x:number,y:number,radius:number,intensity:number,rgb:number[],falloff:number,flicker:number,life:number,maxLife:number,seed:number}[]} */
        this.lights = [];
        this.max = 96;      // bound the pool; oldest evicted past this
        this._seed = 1;
    }

    /**
     * Register a transient point light (world coordinates).
     * @param {object} d
     * @param {number} d.x world x
     * @param {number} d.y world y
     * @param {number} [d.radius] world-space radius in px
     * @param {number} [d.intensity] additive brightness (>1 allowed)
     * @param {string} [d.color] CSS colour
     * @param {number} [d.falloff] edge softness (unused in v1 core shape)
     * @param {number} [d.flicker] 0..1 flicker depth
     * @param {number} [d.life] lifetime in frames (60=1s)
     */
    add(d) {
        const rgb = GLRenderer.parseColor(d.color || "#ffffff");
        const life = d.life != null ? d.life : 12;
        this.lights.push({
            x: d.x, y: d.y,
            radius: d.radius != null ? d.radius : 120,
            intensity: d.intensity != null ? d.intensity : 1,
            rgb,
            falloff: d.falloff != null ? d.falloff : 2,
            flicker: d.flicker != null ? d.flicker : 0,
            life, maxLife: life,
            seed: (this._seed = (this._seed * 1664525 + 1013904223) >>> 0) / 4294967296,
        });
        if (this.lights.length > this.max) this.lights.shift();
    }

    update(dt) {
        for (let i = this.lights.length - 1; i >= 0; i--) {
            const l = this.lights[i];
            l.life -= dt;
            if (l.life <= 0) this.lights.splice(i, 1);
        }
    }

    /**
     * Queue every live light into the active glow overlay. Called during the
     * world render pass; screen coords include the captured shake offset so the
     * overlay tracks the 2D layer exactly (same contract particles use).
     * @param {any} overlay active glow renderer (game.gl); must expose .ok/.glow
     * @param {any} cam
     * @param {number} sx shake x
     * @param {number} sy shake y
     * @param {number} t global time (frames) for flicker phase
     */
    draw(overlay, cam, sx, sy, t) {
        if (!overlay || !overlay.ok || !GFX.lights) return;
        for (const l of this.lights) {
            const px = cam.sx(l.x) + sx;
            const py = cam.sy(l.y) + sy;
            const fade = Math.max(0, l.life / l.maxLife);
            // Flicker: cheap per-light phase noise around 1.0.
            const fl = l.flicker
                ? 1 - l.flicker * 0.5 * (1 + Math.sin(t * (6 + l.seed * 5) + l.seed * 30))
                : 1;
            const a = l.intensity * fade * fl;
            if (a <= 0) continue;
            const r = l.radius * cam.z;
            // Two stacked radials: a wide soft pool + a brighter core, so the
            // light reads as area illumination rather than a single hot dot.
            overlay.glow(px, py, r, l.rgb[0], l.rgb[1], l.rgb[2], a * 0.5);
            overlay.glow(px, py, r * 0.5, l.rgb[0], l.rgb[1], l.rgb[2], a * 0.7);
        }
    }
}
