// Shape of the unit/enemy/building data tables (js/data/*.js). Kept as a
// script-mode .d.ts (no import/export) so these types are GLOBAL and usable
// from JSDoc `@type {Record<string, EntityDef>}` annotations in the data files.
// All fields are optional (different unit types set different subsets); the
// value is that a MIS-TYPED field name (e.g. `dmgg`, `cst`) is not part of the
// type and therefore fails the excess-property check — catching exactly the
// "one typo in units.js" class of bug the module/typecheck work targets.

type ResourceCost = { g?: number; i?: number; c?: number };
type BuildingIncome = { g?: number; i?: number; c?: number; mana?: number };

interface EntityDef {
    name?: string;
    hp?: number;
    dmg?: number;
    range?: number;
    speed?: number;
    cooldown?: number;
    cost?: ResourceCost;
    pop?: number;
    armor?: number;
    dmgType?: "slash" | "pierce" | "blunt" | "magic";
    armorClass?: "none" | "light" | "heavy" | "shield";
    armorPierce?: boolean;
    vsLarge?: number;
    vsFlying?: number;
    large?: boolean;
    ranged?: boolean;
    projectile?: string;
    pierce?: number;
    heal?: number;
    healRange?: number;
    healCd?: number;
    charge?: boolean;
    aoe?: number;
    siege?: boolean;
    flying?: boolean;
    boss?: boolean;
    bounty?: number;
    drops?: { crystal?: number; iron?: number };
    summon?: boolean;
    scale?: number;
    color?: string;
    visual?: string;
    desc?: string;
}

interface BuildingDef {
    name?: string;
    hp?: number;
    width?: number;
    height?: number;
    cost?: ResourceCost;
    desc?: string;
    income?: BuildingIncome;
    dmg?: number;
    range?: number;
    flyRange?: number;
    cooldown?: number;
    projectile?: string;
    aoe?: number;
    dmgType?: "slash" | "pierce" | "blunt" | "magic";
    vsFlying?: number;
    buildTime?: number;
    unlock?: string[];
    armor?: number;
}
