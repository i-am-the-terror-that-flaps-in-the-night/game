import { el } from '../ui/dom.js';

// `webgl`: route the additive glow layer (particles + hero/singularity auras)
// through the GPU overlay (js/systems/gl-renderer.js). On for every tier — it's
// a win everywhere and falls back to Canvas 2D automatically if unavailable.
// `webgpu`/`lights`/`bloom`/`distortion` gate the WebGPU overlay's richer passes
// (see js/systems/wgpu-renderer.js). They only take effect when a WebGPU device
// actually initialized; otherwise the WebGL glow overlay (`webgl`) is used and
// these are ignored. Performance stays on pure WebGL glow (no extra GPU passes).
const PRESETS = {
    performance: { tier: 'performance', particleMul: 0.5, particleCap: 180, shadows: false, postFX: false, renderScale: 0.7, flatScenery: true,  webgl: true, webgpu: false, lights: false, bloom: false,   distortion: false },
    standard:    { tier: 'standard',    particleMul: 1,   particleCap: 600, shadows: false, postFX: false, renderScale: 1,   flatScenery: false, webgl: true, webgpu: true,  lights: true,  bloom: 'low',   distortion: false },
    cinematic:   { tier: 'cinematic',   particleMul: 2,   particleCap: Infinity, shadows: true, postFX: true, renderScale: 1, flatScenery: false, webgl: true, webgpu: true,  lights: true,  bloom: 'high',  distortion: true },
};

export const GFX = { ...PRESETS.standard };

const TIER = { '0.5': 'performance', '1': 'standard', '2': 'cinematic' };

export function refreshGraphics() {
    const n = el('particleQuality');
    Object.assign(GFX, PRESETS[(n && TIER[n.value]) || 'standard']);
    return GFX;
}

export const particleQuality = () => GFX.particleMul;
