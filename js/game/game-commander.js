import { TEAMS } from '../config.js';
import { BUILDING_TYPES } from '../data/buildings.js';
import { ENEMY_TYPES } from '../data/enemies.js';
import { UNIT_TYPES } from '../data/units.js';
import { COUNTER_TABLE } from '../systems/combat.js';

// --- GAME: auto-commander (installed by install-mixins.js) -------------------
//
// While you steer the hero by hand, the army and base run themselves: troops
// are recruited and buildings put up automatically. You can still recruit and
// build yourself at any time — the commander plans around whatever exists.
//
// Recruiting scores every unlocked, affordable unit against the threat (the
// next wave's composition plus enemies already on the field) using the same
// COUNTER_TABLE the combat resolver uses, and keeps a frontline in front of
// ranged troops. Building follows an economy-first plan and saves up for the
// next item instead of spending every coin on troops — unless enemies are
// already at the gate.

const TICK = 50;            // frames between decisions (~0.8 s)
const GATE_X = 1300;        // enemies inside this x count as "at the gate"

// Ordered build plan: [type, how many to own]. Each step is satisfied before
// the next is considered; lock-gated types (Academy needs crystal) simply
// wait until affordable.
const BUILD_PLAN = [
    ["mine", 2],
    ["barracks", 1],
    ["tower", 1],
    ["academy", 1],
    ["mine", 3],
    ["tower", 2],
];

// Effectiveness (0..~1.6) of unit type `ut` against one enemy definition.
function matchup(ud, ed) {
    if (ed.flying && !ud.ranged) return 0;              // melee can't reach flyers
    let ac = ed.armorClass || "none";
    if (ud.armorPierce && (ac === "heavy" || ac === "shield")) ac = "light";
    let m = (COUNTER_TABLE[ud.dmgType || "slash"] || COUNTER_TABLE.slash)[ac] || 1;
    if (ud.vsLarge && ed.large) m *= ud.vsLarge;
    if (ud.vsFlying && ed.flying) m *= ud.vsFlying;
    return m;
}

export const commanderMethods = /** @type {ThisType<any>} */ ({
    // Is the auto-commander running? (Only while the hero is hand-steered.)
    commanderActive() {
        return this.state === "playing" && !!this.heroManual && this.heroManual();
    },

    commanderTick(dt) {
        if (!this.commanderActive()) return;
        this._cmdT = (this._cmdT || 0) + dt;
        if (this._cmdT < TICK) return;
        this._cmdT = 0;
        const plan = this._nextBuild();
        const gate = this.enemies.some((e) => e.active && e.x < GATE_X);
        // 1) Build when the next planned building is affordable.
        if (plan && this.checkCost(this.buildCost(plan))) {
            this.build(plan);
            return;
        }
        // 2) Otherwise recruit — but leave enough gold for the planned
        //    building unless the castle is under pressure.
        const reserve = plan && !gate ? (this.buildCost(plan).g || 0) : 0;
        const pick = this._pickRecruit(reserve, gate);
        if (pick) this.buyUnit(pick, true);
    },

    // First build-plan step not yet satisfied that is unlocked and has room.
    _nextBuild() {
        const own = {};
        for (const b of this.buildings) if (b.active && b.team === TEAMS.PLAYER) own[b.type] = (own[b.type] || 0) + 1;
        // Army at the pop cap: put surplus gold into extra towers.
        const steps = this.pop >= this.maxPop - 1 ? [...BUILD_PLAN, ["tower", 5]] : BUILD_PLAN;
        for (const [t, n] of steps) {
            if (!BUILDING_TYPES[t] || !this.unlocked.b.has(t)) continue;
            if ((own[t] || 0) >= n) continue;
            if (this.buildSlot(t) == null) continue;
            return t;
        }
        return null;
    },

    // Threat weights per enemy type: next wave + what's already on the field.
    _threat() {
        const w = {};
        const add = (t, c) => { if (ENEMY_TYPES[t]) w[t] = (w[t] || 0) + c; };
        const wm = this.waveM;
        if (wm) {
            let groups = null;
            if (this.mode === "campaign") { if (wm.cw < wm.tw && wm.wvs[wm.cw]) groups = wm.wvs[wm.cw].enemies; }
            else if (wm.composition) groups = wm.composition(wm.wave + 1);
            if (groups) for (const gr of groups) add(gr.t, gr.c);
        }
        for (const e of this.enemies) if (e.active && !e.isBoss) add(e.type, 1.5 * (e.merged || 1));
        return w;
    },

    // Resource income per frame from finished buildings (mirrors update()).
    _incomeRate() {
        const iM = 1 + (this.upgrades.income || 0), lvlM = this.levelIncomeMult || 1;
        const r = { g: 0, i: 0, c: (this.upgrades.crystal_inc || 0) / 60 };
        for (const b of this.buildings) {
            if (!b.active || b.building || !b.income) continue;
            if (b.income.g) r.g += (b.income.g * iM * lvlM) / 60;
            if (b.income.i) r.i += (b.income.i * lvlM) / 60;
            if (b.income.c) r.c += (b.income.c * lvlM) / 60;
        }
        return r;
    },

    // Unit to recruit now, or null (nothing worth it, or saving up). Scores
    // every unlocked type by counter effectiveness × combat strength per pop
    // slot (the army is pop-capped, so a weak body wastes a slot), shaped by
    // role balance and variety. If the best one isn't affordable yet but will
    // be within ~15 s of income, it waits for it rather than settling.
    _pickRecruit(reserveGold, gate) {
        const threat = this._threat();
        const types = Object.keys(threat);
        const total = types.reduce((a, t) => a + threat[t], 0);
        let melee = 0, ranged = 0;
        const count = {};
        for (const u of this.units) {
            if (!u.active || u.isHero || u.team !== TEAMS.PLAYER) continue;
            count[u.type] = (count[u.type] || 0) + 1;
            if (u.ranged) ranged++; else melee++;
        }
        const scored = [];
        for (const t of Object.keys(UNIT_TYPES)) {
            if (!this.unlocked.u.has(t)) continue;
            const ud = UNIT_TYPES[t];
            if (this.pop + ud.pop > this.maxPop) continue;
            let eff = 1;
            if (total > 0) {
                eff = 0;
                for (const et of types) eff += threat[et] * matchup(ud, ENEMY_TYPES[et]);
                eff /= total;
            }
            const dps = (ud.dmg * 60) / (ud.cooldown || 60) * (1 + (ud.aoe ? 0.5 : 0));
            const strength = Math.sqrt(ud.hp * dps) * (ud.ranged ? 1.15 : 1) * (ud.heal ? 1.2 : 1);
            const role = ud.ranged ? (ranged > melee + 1 ? 0.75 : 1.1) : (melee <= ranged ? 1.25 : 1);
            const variety = 1 / (1 + 0.3 * (count[t] || 0));
            scored.push({ t, score: eff * (strength / (ud.pop || 1)) * role * variety });
        }
        scored.sort((a, b) => b.score - a.score);
        const affordable = (t) => {
            const c = this.unitCost(t);
            return this.checkCost({ ...c, g: (c.g || 0) + reserveGold });
        };
        const rate = this._incomeRate(), WAIT = 900;   // 15 s at the 60 fps basis
        const reachable = (t) => {
            const c = this.unitCost(t);
            const need = (have, cost, per) => cost <= have || (per > 0 && have + per * WAIT >= cost);
            return need(this.gold - reserveGold, c.g || 0, rate.g) && need(this.iron, c.i || 0, rate.i) && need(this.crystal, c.c || 0, rate.c);
        };
        for (const { t } of scored) {
            if (affordable(t)) return t;
            // A better unit is on its way: save for it (not while under pressure).
            if (!gate && reachable(t)) return null;
        }
        return null;
    },
});
