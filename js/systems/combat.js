import { TEAMS } from '../config.js';
import { BUILDING_TYPES } from '../data/buildings.js';
import { ENEMY_TYPES } from '../data/enemies.js';
import { UNIT_TYPES } from '../data/units.js';
// Targets are identified by a `kind` flag ("unit" | "building") set in the
// entity constructors, rather than `instanceof`, so this module needs no import
// of the entity classes — breaking the unit<->combat and building->projectile->
// combat->building import cycles. Every target reaching resolveDamage is
// constructed by exactly one of those two constructors, so the partition is
// identical to the former instanceof checks.

// Resolve any live entity (unit / enemy / building) to its data definition.
export function defOf(entity) {
    return (
        BUILDING_TYPES[entity.type] ||
        (entity.team === TEAMS.PLAYER
            ? UNIT_TYPES[entity.type]
            : ENEMY_TYPES[entity.type])
    );
}

// --- COMBAT RESOLUTION (counter system) ---
// Every unit has a damage type and an armor class. Damage is deterministic:
// base * counter-multiplier * formation-modifier - flat armor. No random crits.

export const DAMAGE_LABELS = { slash: "Slash", pierce: "Pierce", blunt: "Blunt", magic: "Magic" };
export const ARMOR_LABELS = { none: "Unarmored", light: "Light", heavy: "Heavy", shield: "Shielded" };

// COUNTER_TABLE[damageType][armorClass] = multiplier
export const COUNTER_TABLE = {
    slash:  { none: 1.2,  light: 1.0,  heavy: 0.65, shield: 0.85 },
    pierce: { none: 1.1,  light: 1.25, heavy: 0.7,  shield: 0.5  },
    blunt:  { none: 0.85, light: 1.0,  heavy: 1.35, shield: 1.25 },
    magic:  { none: 1.0,  light: 1.15, heavy: 1.25, shield: 1.15 },
};

// Formation stances trade damage dealt against damage taken (player units only).
export const FORMATION_MODS = {
    defensive:  { deal: 0.9,  take: 0.85 },
    standard:   { deal: 1.0,  take: 1.0  },
    aggressive: { deal: 1.15, take: 1.1  },
};

// Resolve an attack. src: { dmgType, armorPierce, vsLarge, siege, team, isUnit }.
// `formation` is the attacker/defender formation id (player-unit modifier only);
// pass a falsy value for no modifier. Kept as a parameter so this function is
// pure (no global read) and unit-testable. Returns { amt, tag } where tag drives
// the damage-text color: 'strong' (counter hit), 'weak' (resisted), 'magic', or null.
export function resolveDamage(base, src, target, formation) {
    let mult = 1;
    if (target.kind === "building") {
        if (src.siege) mult *= 2;
        else if (src.dmgType === "blunt") mult *= 1.2;
    } else {
        let ac = target.armorClass || "none";
        // Armor-piercing bolts treat heavy plate and shields as light armor.
        if (src.armorPierce && (ac === "heavy" || ac === "shield")) ac = "light";
        mult *= (COUNTER_TABLE[src.dmgType || "slash"] || COUNTER_TABLE.slash)[ac] || 1;
        if (src.vsLarge && target.large) mult *= src.vsLarge;
        // Anti-air: arrows/bolts and the castle's battlements bite far harder
        // into airborne foes (Dragons) than melee ever could.
        if (src.vsFlying && target.flying) mult *= src.vsFlying;

        const f = FORMATION_MODS[formation];
        if (f) {
            if (src.team === TEAMS.PLAYER && src.isUnit) mult *= f.deal;
            if (target.team === TEAMS.PLAYER && target.kind === "unit") mult *= f.take;
        }
    }
    const amt = Math.max(1, base * mult - (target.armor || 0));
    const tag = mult >= 1.2 ? "strong" : mult <= 0.8 ? "weak" : src.dmgType === "magic" ? "magic" : null;
    return { amt, tag };
}

// Resolve an attack and apply it to the target in one step. Returns the same
// { amt, tag } as resolveDamage so callers can still read `tag` for hit FX.
export function dealDamage(base, src, target) {
    const formation = typeof game !== "undefined" ? game.formation : undefined;
    const res = resolveDamage(base, src, target, formation);
    target.takeDamage(res.amt, res.tag);
    return res;
}

// Short matchup summary for tooltips: which armor classes this damage type
// punishes or bounces off.
export function describeMatchups(def) {
    if (!def || !def.dmgType) return "";
    const row = COUNTER_TABLE[def.dmgType];
    if (!row) return "";
    const strong = Object.keys(row).filter((k) => row[k] >= 1.2).map((k) => ARMOR_LABELS[k]);
    const weak = Object.keys(row).filter((k) => row[k] <= 0.8).map((k) => ARMOR_LABELS[k]);
    let s = `⚔ ${DAMAGE_LABELS[def.dmgType]} · 🛡 ${ARMOR_LABELS[def.armorClass || "none"]}`;
    if (def.armorPierce) s += " · punches through armor";
    if (def.vsLarge) s += ` · ×${def.vsLarge} vs large foes`;
    if (def.vsFlying) s += ` · ×${def.vsFlying} vs flying`;
    if (strong.length) s += `<br><span style="color:#4ade80">Strong vs ${strong.join(", ")}</span>`;
    if (weak.length) s += `<br><span style="color:#f87171">Weak vs ${weak.join(", ")}</span>`;
    return s;
}

// One-line tactical tip for a wave composition ([{t, c}]), keyed off the most
// dangerous enemy type present.
export const WAVE_HINTS = [
    ["dragon",      "Dragons fly — melee can't reach them. Archers and Crossbows hit them hard, and your Castle's flak scorches them from range."],
    ["necromancer", "Necromancers raise skeletons — kill them before the dead pile up."],
    ["ogre",        "Ogres wear heavy armor — Spearmen and Crossbows pierce it; keep militia away."],
    ["shieldman",   "Shield wall — arrows bounce off. Crack it with Blunt (Catapult, Paladin) or Magic."],
    ["shaman",      "Shamans heal from the back — snipe them or hit the pack with AoE."],
    ["archer",      "Arrow volleys ahead — shielded Swordsmen soak pierce damage."],
    ["berserker",   "Berserkers sprint for your backline — hold a solid melee screen."],
    ["marauder",    "Light raiders — Archers and a melee line trade well."],
];
export function waveHint(groups) {
    if (!groups || !groups.length) return "";
    const present = new Set(groups.map((g) => g.t));
    for (const [t, hint] of WAVE_HINTS) if (present.has(t)) return hint;
    return "A rabble mob — cheap melee and archers handle it.";
}
