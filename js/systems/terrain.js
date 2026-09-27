import { CONFIG } from '../config.js';
import { clamp } from '../utils.js';

// --- TERRAIN: the whole battlefield is shaped ground ---
// Logic stays 1-D (x drives targeting), but the ground is a height curve and
// every stretch of the map is a set piece: rolling hills, highlands, forests,
// rivers (fords or bridges), mud/snow/marsh, barricaded passes, hilltop
// shrines, and great ridges with a tunnel bored beneath them.
//
// Two surfaces are kept:
//   samples — the WALKING surface; everything ground-bound sits at groundAt(x).
//   top     — the VISIBLE top; equals samples except over a tunnel, where the
//             ridge rises above the tunnel floor troops walk along.
// Heights are relative to CONFIG.GROUND_Y ("sea level") and never negative, so
// a window resize needs no rebuild. An empty spec is exactly flat (the original
// game), which the smoke tests rely on.

const STEP = 4;             // px between height samples
const MAX_H = 150;          // tallest walkable ground
const MAX_SLOPE = 0.55;     // steepest walkable rise (px per px)
const PLATEAU = 650;        // castle plateau: flat up to here...
const PLATEAU_RAMP = 450;   // ...then terrain eases in over this span
const TUNNEL_ARCH = 96;     // tunnel mouth height above its floor

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

// Cover: ranged/projectile damage taken inside a forest; wading a ford.
export const FOREST_COVER = 0.7;
export const FORD_SLOW = 0.55;

// Anchor values for tactical AI (what's worth standing on).
const ANCHOR_VALUE = { crest: 1, shrine: 160, tunnel: 60, bridge: 45, forest: 35, barricade: 50 };

// Seeded PRNG (mulberry32) so a level's map is identical every time.
function prng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── Segment recipes ──────────────────────────────────────────────────────
// Each recipe fills [x0, x1] with features. r() is the level's PRNG.
// Natural widths are rescaled so a level's segment list spans the whole map.
const SEGMENTS = {
    rolling:  { w: 760, make(f, x0, x1, r) { bumps(f, x0, x1, r, 2 + (r() < 0.5 ? 1 : 0), 26, 60); } },
    highland: { w: 900, make(f, x0, x1, r) { bumps(f, x0, x1, r, 1 + (r() < 0.4 ? 1 : 0), 95, 150, 0.9); } },
    forest:   { w: 820, make(f, x0, x1, r) { bumps(f, x0, x1, r, 2, 18, 40); f.forests.push({ x0: x0 + 40, x1: x1 - 40 }); } },
    hillforest: { w: 900, make(f, x0, x1, r) { bumps(f, x0, x1, r, 2, 60, 120); f.forests.push({ x0: x0 + 30, x1: x1 - 30 }); } },
    tunnel:   { w: 900, make(f, x0, x1, r) { ridge(f, x0, x1, r, false); } },
    tunnelforest: { w: 960, make(f, x0, x1, r) { ridge(f, x0, x1, r, true); } },
    ford:     { w: 700, make(f, x0, x1, r) { river(f, x0, x1, r, false); } },
    bridge:   { w: 700, make(f, x0, x1, r) { river(f, x0, x1, r, true); } },
    mud:      { w: 700, make(f, x0, x1, r) { bumps(f, x0, x1, r, 2, 16, 36); patch(f, x0, x1, r, "mud"); } },
    marsh:    { w: 720, make(f, x0, x1, r) { bumps(f, x0, x1, r, 1, 14, 28); patch(f, x0, x1, r, "marsh"); } },
    snow:     { w: 760, make(f, x0, x1, r) { bumps(f, x0, x1, r, 2, 30, 70); patch(f, x0, x1, r, "snow"); } },
    pass:     { w: 820, make(f, x0, x1, r) {
        // Two shoulders with a barricaded saddle between them.
        const m = (x0 + x1) / 2, w = (x1 - x0);
        f.hills.push({ x: x0 + w * 0.22, w: w * 0.5, h: 80 + r() * 40 });
        f.hills.push({ x: x1 - w * 0.22, w: w * 0.5, h: 80 + r() * 40 });
        f.barricades.push({ x: Math.round(m) });
    } },
    shrine:   { w: 820, make(f, x0, x1, r, arg) {
        const m = (x0 + x1) / 2;
        f.hills.push({ x: m, w: (x1 - x0) * 0.8, h: 90 + r() * 40 });
        f.shrines.push({ x: Math.round(m), reward: arg || "gold" });
    } },
};

function bumps(f, x0, x1, r, n, hMin, hMax, wMul = 1) {
    const span = x1 - x0;
    for (let i = 0; i < n; i++) {
        const c = x0 + span * ((i + 0.3 + r() * 0.4) / n);
        f.hills.push({ x: c, w: (span / n) * (1.1 + r() * 0.5) * wMul, h: hMin + r() * (hMax - hMin) });
    }
}
function patch(f, x0, x1, r, kind) {
    const w = (x1 - x0) * (0.35 + r() * 0.2);
    const a = x0 + (x1 - x0 - w) * (0.2 + r() * 0.6);
    f.patches.push({ x0: Math.round(a), x1: Math.round(a + w), kind });
}
function ridge(f, x0, x1, r, forested) {
    const pad = (x1 - x0) * 0.12;
    const t = { x0: Math.round(x0 + pad), x1: Math.round(x1 - pad), h: 190 + r() * 60, forest: forested };
    f.tunnels.push(t);
    // Gentle foothills either side so the ridge rises out of the land.
    f.hills.push({ x: x0 + pad * 0.5, w: pad * 2.2, h: 30 + r() * 20 });
    f.hills.push({ x: x1 - pad * 0.5, w: pad * 2.2, h: 30 + r() * 20 });
    if (forested) f.forests.push({ x0: t.x0 + 30, x1: t.x1 - 30, onRidge: true });
}
function river(f, x0, x1, r, bridge) {
    const m = (x0 + x1) / 2;
    const w = bridge ? 150 + r() * 70 : 230 + r() * 80;
    // Raised banks keep the channel above sea level.
    f.hills.push({ x: m, w: (x1 - x0) * 0.9, h: 46 + r() * 20 });
    f.rivers.push({ x0: Math.round(m - w / 2), x1: Math.round(m + w / 2), bridge });
}

export class Terrain {
    constructor() {
        const n = Math.ceil(CONFIG.WORLD_WIDTH / STEP) + 2;
        this.samples = new Float32Array(n);
        this.top = new Float32Array(n);
        this.zones = []; // temporary slow zones (hazards): {x0,x1,slow,life,kind}
        this.load(null);
    }

    // spec: null (flat) | legacy { hills, patches } |
    //       { seed, rough, segments:["rolling","tunnelforest","shrine:gold",…] }
    load(spec) {
        const s = spec || {};
        const f = { hills: [], patches: [], forests: [], rivers: [], tunnels: [], shrines: [], barricades: [] };
        let rough = 0, r = prng(1);
        if (s.segments && s.segments.length) {
            r = prng(s.seed || 1);
            rough = s.rough != null ? s.rough : 22;
            const segs = s.segments.map((str) => {
                const [kind, arg] = str.split(":");
                return { def: SEGMENTS[kind] || SEGMENTS.rolling, arg };
            });
            const start = PLATEAU + PLATEAU_RAMP * 0.4, end = CONFIG.WORLD_WIDTH - 120;
            const total = segs.reduce((a, g) => a + g.def.w, 0);
            const k = (end - start) / total;
            let x = start;
            for (const g of segs) {
                const w = g.def.w * k;
                g.def.make(f, x, x + w, r, g.arg);
                x += w;
            }
        } else {
            for (const h of s.hills || []) f.hills.push({ ...h });
            for (const p of s.patches || []) f.patches.push({ ...p });
        }
        this.patches = f.patches.filter((p) => TERRAIN_PATCHES[p.kind]);
        this.forests = f.forests;
        this.rivers = f.rivers;
        this.tunnels = f.tunnels;
        this.shrines = f.shrines;
        this.barricades = f.barricades;
        this.zones = [];
        this._build(f.hills, rough, r);
    }

    _build(hills, rough, r) {
        const S = this.samples, n = S.length;
        S.fill(0);
        // Rolling base: three seeded octaves, eased in past the castle plateau.
        if (rough > 0) {
            const ph = [r() * 6.28, r() * 6.28, r() * 6.28];
            for (let i = 0; i < n; i++) {
                const x = i * STEP;
                const ramp = clamp((x - PLATEAU) / PLATEAU_RAMP, 0, 1);
                const v = 0.5 * Math.sin(x * 0.0021 + ph[0]) + 0.3 * Math.sin(x * 0.0053 + ph[1]) + 0.2 * Math.sin(x * 0.011 + ph[2]);
                S[i] = rough * (0.55 + 0.45 * v) * ramp * ramp * (3 - 2 * ramp);
            }
        }
        for (const h of hills) {
            const half = Math.max(120, h.w / 2);
            const i0 = Math.max(0, Math.floor((h.x - half) / STEP));
            const i1 = Math.min(n - 1, Math.ceil((h.x + half) / STEP));
            for (let i = i0; i <= i1; i++) {
                const d = (i * STEP - h.x) / half;
                if (d > -1 && d < 1) S[i] += h.h * 0.5 * (1 + Math.cos(d * Math.PI));
            }
        }
        for (let i = 0; i < n; i++) S[i] = clamp(S[i], 0, MAX_H);
        // Tunnel floors: level-ish through the ridge (troops walk underneath).
        for (const t of this.tunnels) this._levelSpan(t.x0 - 20, t.x1 + 20);
        // Rivers: a bridge deck spans bank to bank; a ford dips into the channel.
        for (const rv of this.rivers) {
            if (rv.bridge) this._levelSpan(rv.x0 - 24, rv.x1 + 24);
            else {
                const i0 = Math.floor(rv.x0 / STEP), i1 = Math.ceil(rv.x1 / STEP);
                for (let i = i0; i <= i1; i++) {
                    const d = ((i - i0) / (i1 - i0)) * 2 - 1;
                    S[i] = Math.max(0, S[i] - 44 * 0.5 * (1 + Math.cos(d * Math.PI)));
                }
            }
        }
        // Keep every rise walkable (forward + backward slope limit).
        const lim = MAX_SLOPE * STEP;
        for (let i = 1; i < n; i++) S[i] = clamp(S[i], S[i - 1] - lim, S[i - 1] + lim);
        for (let i = n - 2; i >= 0; i--) S[i] = clamp(S[i], S[i + 1] - lim, S[i + 1] + lim);
        // Visible top = walking surface, raised into a hill over each tunnel:
        // a rock face climbs to the portal (bore + ~38 px of cover), then the
        // hill crowns toward t.h with a weathered crest. Troops walk the bore.
        this.top.set(S);
        const cover = TUNNEL_ARCH + 38;
        const smooth = (u) => u * u * (3 - 2 * u);
        for (const t of this.tunnels) {
            const half = (t.x1 - t.x0) / 2;
            const i0 = Math.max(0, Math.floor((t.x0 - 90) / STEP)), i1 = Math.min(n - 1, Math.ceil((t.x1 + 90) / STEP));
            for (let i = i0; i <= i1; i++) {
                const x = i * STEP;
                const e = Math.min(x - t.x0, t.x1 - x); // depth inside the hill
                const prof = e < 0
                    ? cover * smooth(clamp((e + 90) / 90, 0, 1))
                    : cover + (t.h - cover) * smooth(clamp(e / (half * 0.8), 0, 1));
                const crag = e > 0 ? (8 * Math.sin(x * 0.031) + 5 * Math.sin(x * 0.087)) * clamp(e / 120, 0, 1) : 0;
                this.top[i] = Math.max(S[i], S[i] + prof + crag);
            }
        }
        this.flatMap = !S.some((v) => v > 0.5);
        this._findCrests();
        this._buildAnchors();
    }

    // Flatten a span to a straight line between its two ends.
    _levelSpan(a, b) {
        const S = this.samples;
        const i0 = Math.max(0, Math.floor(a / STEP)), i1 = Math.min(S.length - 1, Math.ceil(b / STEP));
        const h0 = S[i0], h1 = S[i1];
        for (let i = i0; i <= i1; i++) S[i] = h0 + (h1 - h0) * ((i - i0) / Math.max(1, i1 - i0));
    }

    // Local maxima of the walking surface (≥ 30 px), spaced ≥ 200 px apart.
    _findCrests() {
        const S = this.samples, out = [];
        const w = Math.round(120 / STEP);
        for (let i = w; i < S.length - w; i++) {
            if (S[i] < 30) continue;
            let peak = true;
            for (let j = i - w; j <= i + w && peak; j++) if (S[j] > S[i]) peak = false;
            if (peak && (!out.length || i * STEP - out[out.length - 1].x > 200)) out.push({ x: i * STEP, h: S[i] });
        }
        this.hills = out; // hazards (rockslides) + minimap use crests
    }

    // Tactical anchor points for the AI, sorted by x.
    _buildAnchors() {
        const a = [];
        for (const c of this.hills) a.push({ x: c.x, kind: "crest", v: c.h * ANCHOR_VALUE.crest });
        for (const s of this.shrines) a.push({ x: s.x, kind: "shrine", v: ANCHOR_VALUE.shrine + this.heightAt(s.x) });
        for (const t of this.tunnels) {
            a.push({ x: t.x0 - 30, kind: "tunnel", v: ANCHOR_VALUE.tunnel });
            a.push({ x: t.x1 + 30, kind: "tunnel", v: ANCHOR_VALUE.tunnel });
        }
        for (const r of this.rivers) {
            a.push({ x: r.x0 - 40, kind: r.bridge ? "bridge" : "ford", v: ANCHOR_VALUE.bridge });
            a.push({ x: r.x1 + 40, kind: r.bridge ? "bridge" : "ford", v: ANCHOR_VALUE.bridge });
        }
        for (const f of this.forests) a.push({ x: (f.x0 + f.x1) / 2, kind: "forest", v: ANCHOR_VALUE.forest + this.heightAt((f.x0 + f.x1) / 2) * 0.5 });
        for (const b of this.barricades) a.push({ x: b.x - 60, kind: "barricade", v: ANCHOR_VALUE.barricade });
        a.sort((p, q) => p.x - q.x);
        this.anchors = a;
    }

    flat() { this.load(null); }

    isFlat() { return this.flatMap; }

    _at(arr, x) {
        const f = clamp(x, 0, CONFIG.WORLD_WIDTH) / STEP;
        const i = Math.floor(f);
        const a = arr[i], b = arr[i + 1];
        return a + (b - a) * (f - i);
    }

    heightAt(x) { return this._at(this.samples, x); }

    // Visible top of the land (ridge crowns over tunnels).
    topAt(x) { return this._at(this.top, x); }

    groundAt(x) { return CONFIG.GROUND_Y - this.heightAt(x); }

    // Rise per px of +x (positive = ground climbs toward the right).
    slopeAt(x) { return (this.heightAt(x + 8) - this.heightAt(x - 8)) / 16; }

    _span(list, x) {
        for (const p of list) if (x >= p.x0 && x <= p.x1) return p;
        return null;
    }
    patchAt(x) { return this._span(this.patches, x); }
    zoneAt(x) { return this._span(this.zones, x); }
    forestAt(x) { return this._span(this.forests, x); }
    riverAt(x) { return this._span(this.rivers, x); }
    tunnelAt(x) { return this._span(this.tunnels, x); }
    inTunnel(x) { return this._span(this.tunnels, x) !== null; }

    // Line-of-sight cover: ranged shots, flyers, towers, spells and hazards
    // can't reach across a tunnel wall — only one side being inside blocks.
    blocksShot(ax, tx) { return this.inTunnel(ax) !== this.inTunnel(tx); }

    tunnelArch() { return TUNNEL_ARCH; }

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
        const rv = this.riverAt(e.x);
        if (rv && !rv.bridge) m *= FORD_SLOW;
        const z = this.zoneAt(e.x);
        if (z) m *= z.slow;
        return m;
    }

    // Short human-readable description of the ground at x (hover tooltip).
    describe(x) {
        const parts = [];
        const h = this.heightAt(x);
        if (this.inTunnel(x))
            parts.push("<b>Tunnel</b>: ranged fire, flyers, spells and towers can't reach in or out. Melee only.");
        else if (h >= 60)
            parts.push(`<b>High ground</b> (+${Math.round(h)}): ranged units reach farther; attacks downhill ×${HIGH_GROUND.bonus}, uphill ×${HIGH_GROUND.penalty}`);
        else if (Math.abs(this.slopeAt(x)) > 0.15) parts.push("<b>Slope</b>: slower climbing, faster descent");
        if (this.forestAt(x) && !this.inTunnel(x)) parts.push(`<b>Forest</b>: ranged damage taken ×${FOREST_COVER}`);
        const rv = this.riverAt(x);
        if (rv) parts.push(rv.bridge ? "<b>Bridge</b>: a fast crossing and a natural chokepoint" : `<b>Ford</b>: wading ×${FORD_SLOW} move speed`);
        const p = this.patchAt(x);
        if (p) parts.push(`<b>${TERRAIN_PATCHES[p.kind].name}</b>: ×${TERRAIN_PATCHES[p.kind].slow} move speed`);
        const z = this.zoneAt(x);
        if (z) parts.push(`<b>Whiteout</b>: ×${z.slow} move speed`);
        return parts.join("<br>");
    }

    // Random Endless map: a full run of segments across the whole field.
    static randomSpec() {
        const pool = ["rolling", "highland", "forest", "hillforest", "tunnel", "tunnelforest", "ford", "bridge", "mud", "marsh", "snow", "pass"];
        const rewards = ["gold", "mana", "watch"];
        const segs = [];
        for (let i = 0; i < 11; i++) {
            if (i === 2 || i === 7) segs.push("shrine:" + rewards[Math.floor(Math.random() * rewards.length)]);
            else segs.push(pool[Math.floor(Math.random() * pool.length)]);
        }
        return { seed: Math.floor(Math.random() * 1e9), rough: 18 + Math.random() * 20, segments: segs };
    }
}

// The one live battlefield. Module-level (like CONFIG) so leaf modules —
// particles, projectiles, decals — can find the ground without a game handle.
export const terrain = new Terrain();
export function groundAt(x) { return terrain.groundAt(x); }
