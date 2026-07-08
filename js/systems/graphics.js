import { el } from '../ui/dom.js';

const PRESETS = {
    performance: { tier: 'performance', particleMul: 0.5, particleCap: 180, shadows: false, postFX: false, renderScale: 0.7, flatScenery: true },
    standard:    { tier: 'standard',    particleMul: 1,   particleCap: 600, shadows: false, postFX: false, renderScale: 1,   flatScenery: false },
    cinematic:   { tier: 'cinematic',   particleMul: 2,   particleCap: Infinity, shadows: true, postFX: true, renderScale: 1, flatScenery: false },
};

export const GFX = { ...PRESETS.standard };

const TIER = { '0.5': 'performance', '1': 'standard', '2': 'cinematic' };

export function refreshGraphics() {
    const n = el('particleQuality');
    Object.assign(GFX, PRESETS[(n && TIER[n.value]) || 'standard']);
    return GFX;
}

export const particleQuality = () => GFX.particleMul;
