import { loadJSON, saveJSON } from './storage.js';

// --- ANTI-LAG: player settings + adaptive load shedding ---
// Settings persist under their own key (NOT the main save) so the campaign
// save stays byte-identical, and "Reset All Saves" leaves performance prefs
// alone — they're machine preferences, not progress.
const KEY = 'sd_perf_v1';

const DEFAULTS = {
    antiLag: 'auto', // 'off' | 'auto' (adaptive) | 'max' (always shed everything)
    fpsCap: 60,      // 0 = unlimited (monitor rate), else frames per second
    res: 'auto',     // 'auto' (preset × shedding) | '100' | '75' | '50'
    dmgNums: 'all',  // 'all' | 'reduced' | 'off'
    crowd: 'auto',   // 'auto' (simplify crowds when busy) | 'full' | 'simple'
    showFps: false,
};

// Lag-shedding levels. The governor walks up this table when frames run long
// and back down once they recover. Each level only ever LOWERS quality relative
// to the chosen graphics preset (see shedGfx), so Performance stays Performance.
//   particleMul/particleCap  scale + clamp CPU particle bursts
//   fxCap                    max live slash/ring/flash/spark effects
//   decalCap                 max ground decals (blood / scorch)
//   dmgCap                   max floating damage numbers per entity
//   dmgBudget                max floating numbers drawn per frame (all entities)
//   lodAt                    visible-enemy count above which enemies draw simplified
//   lodPlayers               also simplify the player's own troops
//   lite                     1: drop shadows/post-FX/distortion + crowd relief
//                            2: also drop dynamic lights, flat scenery, weather,
//                               blurred HUD glass and decorative CSS animation,
//                               and render the GPU glow overlay at 1× DPR
//   minimapEvery             redraw the minimap every Nth frame
//   resMul                   render-resolution multiplier (dynamic resolution)
const LEVELS = [
    { particleMul: 1,    particleCap: 1500, fxCap: 400, decalCap: 201, dmgCap: 6, dmgBudget: 100, lodAt: 90, lodPlayers: false, lite: 0, minimapEvery: 1, resMul: 1 },
    { particleMul: 0.5,  particleCap: 300,  fxCap: 160, decalCap: 120, dmgCap: 3, dmgBudget: 50,  lodAt: 40, lodPlayers: false, lite: 1, minimapEvery: 2, resMul: 1 },
    { particleMul: 0.35, particleCap: 150,  fxCap: 90,  decalCap: 60,  dmgCap: 1, dmgBudget: 20,  lodAt: 15, lodPlayers: false, lite: 2, minimapEvery: 3, resMul: 0.85 },
    { particleMul: 0.2,  particleCap: 80,   fxCap: 50,  decalCap: 30,  dmgCap: 0, dmgBudget: 0,   lodAt: 0,  lodPlayers: true,  lite: 2, minimapEvery: 4, resMul: 0.7 },
];
export const MAX_LEVEL = LEVELS.length - 1;

const DMG_CAP = { all: 6, reduced: 2, off: 0 };

// Horde merge (endless only, while Anti-Lag is on): past this many live
// enemies, a new spawn folds into a nearby enemy of the same type instead of
// adding another body. Its HP, damage and bounty are added on, so the wave's
// total threat and reward are preserved — just carried by fewer, beefier foes.
export const MERGE_AT = 150;
export const MERGE_MAX = 4;      // max enemies folded into one body
export const MERGE_RANGE = 220;  // px: only fold into an enemy this close to the spawn

export const PERF = {
    ...DEFAULTS,
    level: 0,   // current shedding level (0..MAX_LEVEL)
    fps: 0,     // last measured frames per second (display)
    work: 0,    // last measured update+draw CPU ms per frame (display)
    // Derived knobs — recomputed by derivePerf() whenever level/settings change.
    fxCap: LEVELS[0].fxCap,
    decalCap: LEVELS[0].decalCap,
    dmgCap: LEVELS[0].dmgCap,
    dmgBudget: LEVELS[0].dmgBudget,
    dmgLeft: LEVELS[0].dmgBudget, // remaining this frame (reset by Game.draw)
    lodAt: LEVELS[0].lodAt,
    lodPlayers: false,
    lite: 0,
    minimapEvery: 1,
    merge: true,
};

// Accepted values per setting (anything else in storage falls back to default).
const ALLOWED = {
    antiLag: ['off', 'auto', 'max'],
    fpsCap: [0, 30, 60, 120],
    res: ['auto', '100', '75', '50'],
    dmgNums: ['all', 'reduced', 'off'],
    crowd: ['auto', 'full', 'simple'],
    showFps: [false, true],
};

export function loadPerf() {
    const s = loadJSON(KEY);
    if (s && typeof s === 'object') {
        for (const k of Object.keys(DEFAULTS))
            if (ALLOWED[k].includes(s[k])) PERF[k] = s[k];
    }
    PERF.level = PERF.antiLag === 'max' ? MAX_LEVEL : 0;
    derivePerf();
}

export function savePerf() {
    const out = {};
    for (const k of Object.keys(DEFAULTS)) out[k] = PERF[k];
    saveJSON(KEY, out);
}

// Recompute the derived knobs from the current level + settings.
export function derivePerf() {
    const L = LEVELS[PERF.level];
    PERF.fxCap = L.fxCap;
    PERF.decalCap = L.decalCap;
    PERF.dmgCap = Math.min(L.dmgCap, DMG_CAP[PERF.dmgNums] ?? 6);
    PERF.dmgBudget = PERF.dmgCap ? L.dmgBudget : 0;
    PERF.lodAt = PERF.crowd === 'full' ? Infinity : PERF.crowd === 'simple' ? 0 : L.lodAt;
    PERF.lodPlayers = PERF.crowd === 'simple' || (PERF.crowd === 'auto' && L.lodPlayers);
    PERF.lite = L.lite;
    PERF.minimapEvery = L.minimapEvery;
    PERF.merge = PERF.antiLag !== 'off';
}

// Layer the current shedding level (and the resolution override) on top of a
// freshly-applied graphics preset. Called from refreshGraphics().
/** @param {any} G the GFX object, already reset to its preset */
export function shedGfx(G) {
    const L = LEVELS[PERF.level];
    G.particleMul *= L.particleMul;
    G.particleCap = Math.min(G.particleCap, L.particleCap);
    if (L.lite >= 1) {
        G.shadows = false;
        G.postFX = false;
        G.distortion = false; // also skips the WebGPU compositor's full-screen passes
    }
    if (L.lite >= 2) {
        G.lights = false;
        G.flatScenery = true;
        G.overlayDpr = 1; // GPU glow overlay at CSS-pixel resolution
    }
    G.renderScale = PERF.res === 'auto' ? G.renderScale * L.resMul : Number(PERF.res) / 100;
}

// ── FPS limiter ──
// Returns true when this animation frame should be skipped to honour the FPS
// cap. Carries the overshoot so e.g. a 60 cap on a 144 Hz monitor averages 60
// (alternating 2- and 3-vsync gaps) instead of collapsing to 48; the 2 ms slack
// keeps a 60 Hz monitor from ever dropping a frame to timing jitter.
let capLast = 0;
export function skipFrame(now) {
    const cap = PERF.fpsCap;
    if (!cap) return false;
    const iv = 1000 / cap, el = now - capLast;
    if (el < iv - 2) return true;
    capLast = now - Math.min(iv, Math.max(0, el - iv));
    return false;
}

// ── Adaptive governor ──
// Measures the real frame rate in ~1 s windows. Two slow windows in a row
// (below 75% of the target) step the shedding level up — then the step has to
// prove itself: if the next two windows aren't meaningfully faster, shedding
// isn't what's limiting this machine (a 50 Hz screen, a browser battery-saver
// capping animation at 30 fps…), so the step is undone and climbing holds
// until the frame rate falls further. A run of healthy windows (above 90%)
// steps back down; if that step down immediately proves too optimistic (back
// up within ~15 s), the healthy run it needs doubles, so it settles instead of
// oscillating. Returns true when the level changed (caller re-applies GFX).
const gov = {
    t0: 0, frames: 0, work: 0, last: 0,
    slow: 0, ok: 0, okNeed: 6, sinceDown: 99,
    prevFps: 0, probe: /** @type {null | {from:number, fps:number, n:number}} */ (null), hold: 0,
};

// Report this frame's update+draw CPU time (ms) — shown on the FPS meter.
export function perfWork(ms) {
    gov.work += ms;
}

export function perfTick(now, playing) {
    // Long gap (tab hidden, debugger, load) — restart the window, don't judge it.
    if (now - gov.last > 1000) { gov.t0 = now; gov.frames = 0; gov.work = 0; }
    gov.last = now;
    const span = now - gov.t0;
    if (span < 1000 || !gov.frames) { gov.frames++; return false; }
    const fps = PERF.fps = Math.round((gov.frames * 1000) / span);
    PERF.work = gov.work / gov.frames;
    gov.t0 = now;
    gov.frames = 1;
    gov.work = 0;

    let next = PERF.level;
    if (PERF.antiLag === 'off') next = 0;
    else if (PERF.antiLag === 'max') next = MAX_LEVEL;
    else if (playing) {
        const target = PERF.fpsCap || 60;
        gov.sinceDown++;
        if (gov.probe) {
            if (++gov.probe.n >= 2) {
                const gained = fps >= gov.probe.fps * 1.08 || fps >= target * 0.75;
                if (!gained) {
                    next = gov.probe.from;   // didn't help: undo
                    gov.hold = fps * 0.85;   // and only retry if things get worse
                }
                gov.probe = null;
            }
        } else if (fps < target * 0.75 && !(gov.hold && fps >= gov.hold)) {
            gov.ok = 0;
            if (++gov.slow >= 2 && next < MAX_LEVEL) {
                gov.probe = { from: next, fps: (gov.prevFps + fps) / 2, n: 0 };
                next++;
                gov.slow = 0;
                gov.hold = 0;
                if (gov.sinceDown <= 15) gov.okNeed = Math.min(48, gov.okNeed * 2);
            }
        } else {
            gov.slow = 0;
            if (fps > target * 0.9) {
                if (++gov.ok >= gov.okNeed && next > 0) {
                    next--;
                    gov.ok = 0;
                    gov.sinceDown = 0;
                    gov.hold = 0;
                }
            } else gov.ok = 0;
        }
        gov.prevFps = fps;
    }
    if (next === PERF.level) return false;
    setLevel(next);
    return true;
}

export function setLevel(lvl) {
    PERF.level = Math.max(0, Math.min(MAX_LEVEL, lvl));
    gov.slow = 0;
    gov.ok = 0;
    derivePerf();
}

// Forget any in-flight probe/hold (mode switch, new run).
function clearProbe() {
    gov.probe = null;
    gov.hold = 0;
}

// A settings change (mode switch) re-seeds the governor: Max jumps straight to
// the top, Off drops to 0, and Auto starts from scratch with a fresh backoff.
export function resetGovernor() {
    gov.okNeed = 6;
    gov.sinceDown = 99;
    clearProbe();
    setLevel(PERF.antiLag === 'max' ? MAX_LEVEL : 0);
}

// A new run starts light (early waves are cheap): full detail again, but the
// learned backoff is kept so a struggling machine doesn't oscillate. Returns
// true when the level changed.
export function perfNewRun() {
    clearProbe();
    const lvl = PERF.antiLag === 'max' ? MAX_LEVEL : 0;
    if (lvl === PERF.level) return false;
    setLevel(lvl);
    return true;
}
