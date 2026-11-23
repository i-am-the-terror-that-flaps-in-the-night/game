// --- CHARACTER LOOKS ---------------------------------------------------------
//
// How each troop type is dressed. unit-render.js keeps the SAME skeleton (joint
// positions, hand targets, head/shoulder/hip heights — weapons, VFX and HP bars
// hang off those) and uses this table to fill it out into an actual person:
// skin, hair, clothing, armour, headgear and build.
//
// Keyed by team + type (`p:archer` vs `e:archer`), not by weapon visual: several
// types share a weapon visual but should look nothing alike.
//
// Team cue: YOUR troops always wear blue cloth with gold trim. Enemies wear
// reds, rusts, blacks and earth tones. Everything else varies.
//
// Per-soldier variation (skin tone, hair, beard, cloth shade) is rolled ONCE at
// first draw from small fixed palettes, so colour-keyed caches stay bounded.

export const OUTLINE = "#16110d";

const SKIN_HUMAN = ["#f2cda8", "#e3b088", "#c98e62", "#a26d47", "#7a5034"];
const SKIN_OGRE = ["#7d8f5a", "#6f8150", "#8a9466"];
const SKIN_PALE = ["#d9d4e4", "#cfd3dd"];
const SKIN_FAE = ["#b9a3d6", "#a991c9"];
const SKIN_TRIBAL = ["#b07a4f", "#8f5d3a", "#6e4528"];
const HAIR = ["#1c140e", "#3b2616", "#6a4123", "#a46d34", "#d2b273", "#7c7c7c"];

// Team palettes. Player cloth comes in a few close blues so a formation isn't
// one flat colour; enemy cloth is chosen per type below.
const P_CLOTH = ["#2c5aa8", "#3466b8", "#28509a"];
const P_TRIM = "#e2b84a";

// body:  tunic | gambeson | chain | plate | robe | leather | bare | rags | bones
// head:  bare | cap | kettle | hood | helm | greathelm | wizard | horned |
//        antlers | skull | barbute | cowl | circlet
// build: torso/limb thickness multiplier (bulk, never height — tunnel clearance)
export const LOOKS = {
    // ── Player ───────────────────────────────────────────────────────────
    "p:militia":  { body: "tunic",    head: "cap",       build: 0.95, pants: "#5b4630", boots: "#3a2a1c", beard: 0.35 },
    "p:spearman": { body: "gambeson", head: "kettle",    build: 1.05, pants: "#4a3a2a", boots: "#2e2218", shield: true, beard: 0.3 },
    "p:archer":   { body: "leather",  head: "hood",      build: 0.95, pants: "#3f4a2a", boots: "#3a2a1c", hood: "#355a2a", quiver: true },
    "p:crossbow": { body: "gambeson", head: "kettle",    build: 1.0,  pants: "#3a3a40", boots: "#2a2a2e", tabard: true, quiver: true },
    "p:knight":   { body: "plate",    head: "greathelm", build: 1.15, pants: "#5c6470", boots: "#3b4048", tabard: true, plume: true },
    "p:mage":     { body: "robe",     head: "wizard",    build: 1.0,  pants: "#22304f", boots: "#1c2033", beard: 0.8, beardCol: "#e5e7eb" },
    "p:catapult": { body: "tunic",    head: "cap",       build: 1.0,  pants: "#5b4630", boots: "#3a2a1c" },
    "p:paladin":  { body: "plate",    head: "helm",      build: 1.3,  pants: "#6b7280", boots: "#3b4048", tabard: true, tabardCol: "#f1ede2", cape: true, beard: 0.5 },

    // ── Enemies ──────────────────────────────────────────────────────────
    "e:rabble":      { body: "rags",     head: "bare",    build: 0.9,  cloth: ["#7a3b2a", "#6b5a3a", "#5a4a3c"], pants: "#4a3a2a", boots: "#2a1e14", beard: 0.5, messy: true },
    "e:marauder":    { body: "leather",  head: "horned",  build: 1.05, cloth: ["#8e2a22", "#7a2a1e"], pants: "#3b2a20", boots: "#241811", sash: "#b91c1c", beard: 0.6 },
    "e:berserker":   { body: "bare",     head: "bare",    build: 1.25, cloth: ["#5a3b22"], pants: "#4a2f1a", boots: "#2a1a10", paint: "#b91c1c", beard: 0.9, messy: true, fur: true },
    "e:shieldman":   { body: "chain",    head: "helm",    build: 1.15, cloth: ["#8e2a22"], pants: "#3b3b42", boots: "#22222a", tabard: true },
    "e:archer":      { body: "leather",  head: "cowl",    build: 0.95, cloth: ["#2b2622", "#3a2e26"], pants: "#2a2420", boots: "#1a1512", hood: "#3d1f1a", quiver: true },
    "e:shaman":      { body: "robe",     head: "antlers", build: 1.0,  cloth: ["#4a5a2a", "#5a4a2a"], pants: "#3a2a1a", boots: "#2a1a10", skin: SKIN_TRIBAL, paint: "#e7e5e4", beads: true },
    "e:ogre":        { body: "bare",     head: "bare",    build: 1.55, cloth: ["#5a4022"], pants: "#4a3520", boots: "#2a1e12", skin: SKIN_OGRE, tusks: true, bald: true },
    "e:harpy":       { body: "bare",     head: "bare",    build: 0.9,  cloth: ["#4c1d95"], pants: "#3b1a6e", boots: "#2a124d", skin: SKIN_FAE, longHair: true },
    "e:halberdier":  { body: "plate",    head: "barbute", build: 1.1,  cloth: ["#ca8a04"], pants: "#1f1f24", boots: "#141418", tabard: true, stripes: "#1c1917" },
    "e:necromancer": { body: "robe",     head: "cowl",    build: 1.0,  cloth: ["#1c1626", "#241a30"], pants: "#120e18", boots: "#0c0a10", skin: SKIN_PALE, hood: "#1c1626", trimCol: "#a855f7", glowEyes: "#c084fc" },
    "e:skeleton":    { body: "bones",    head: "skull",   build: 0.9,  cloth: ["#6b5a3a"], pants: "#d8d2c0", boots: "#d8d2c0" },

    // ── Hero ─────────────────────────────────────────────────────────────
    "h:voidcaller":  { body: "robe",     head: "cowl",    build: 1.05, cloth: ["#3b1663"], pants: "#1f0b38", boots: "#14072a", hood: "#2e1150", trimCol: "#e64bff", glowEyes: "#f0abfc", cape: true },
};

const FALLBACK = { body: "tunic", head: "bare", build: 1, pants: "#4a3a2a", boots: "#2a1e14" };

function pick(arr, r) { return arr[Math.floor(r * arr.length) % arr.length]; }

/** Resolve a unit's look once (cached on the unit as `_look`). */
export function makeLook(u, isPlayer) {
    const key = (u.isHero ? "h:" : isPlayer ? "p:" : "e:") + u.type;
    const L = LOOKS[key] || FALLBACK;
    const r = Math.random;
    const skinSet = L.skin || SKIN_HUMAN;
    const cloth = isPlayer && !u.isHero ? pick(P_CLOTH, r()) : pick(L.cloth || ["#7a2a22"], r());
    const hair = L.bald ? null : pick(HAIR, r());
    return {
        ...L,
        skin: pick(skinSet, r()),
        hair,
        beardCol: L.beardCol || hair || "#3b2616",
        hasBeard: !!hair && r() < (L.beard || 0),
        cloth,
        trim: L.trimCol || (isPlayer ? P_TRIM : "#2b2420"),
        tabardCol: L.tabardCol || cloth,
        build: L.build || 1,
    };
}
