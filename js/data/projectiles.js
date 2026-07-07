// Projectile visual/physics stats, keyed by projectile type. Moved verbatim
// from the Projectile constructor. `defaultDmgType` replaces the former
// name-based inference (fireball/skull -> magic, else pierce); an explicit
// opts.dmgType still overrides it. Note aoe stays a boolean flag here (the
// constructor does `aoe || def.aoe || 0`, so the numeric splash radius comes
// from the firing unit, not this table).
/** @type {Record<string, ProjectileDef>} */
export const PROJECTILE_TYPES = {
    arrow: { sp: 12, c: "#cbd5e1", sz: 2, arc: true, defaultDmgType: "pierce" },
    bolt: { sp: 16, c: "#94a3b8", sz: 3, arc: false, defaultDmgType: "pierce" },
    fireball: {
        sp: 8,
        c: "#f97316",
        sz: 6,
        aoe: true,
        glow: true,
        defaultDmgType: "magic",
    },
    rock: {
        sp: 6,
        c: "#475569",
        sz: 12,
        arc: true,
        aoe: true,
        defaultDmgType: "pierce",
    },
    skull: {
        sp: 7,
        c: "#c084fc",
        sz: 6,
        glow: true,
        summon: true,
        defaultDmgType: "magic",
    },
};
