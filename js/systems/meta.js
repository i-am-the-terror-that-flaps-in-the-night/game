import { UNIT_TYPES } from '../data/units.js';
import { BUILDING_TYPES } from '../data/buildings.js';
import { loadJSON, saveJSON } from './storage.js';

// ─── META PROGRESSION (permanent unit unlocks) ───────────────────────
// Renown is a persistent currency earned by clearing campaign regions and
// surviving endless waves. Spend it in the War Council to permanently unlock
// advanced troops — once unlocked they are available from the START of every
// future run (campaign or endless) without rebuilding their unlock structure.
//
// Militia and Archer are always free; the eight advanced units below are the
// permanent-unlock pool. Costs roughly track combat value.
export const ADVANCED_UNITS = [
    { id: "swordsman", cost: 25,  icon: "🗡️" },
    { id: "spearman",  cost: 30,  icon: "🔱" },
    { id: "cleric",    cost: 40,  icon: "✨" },
    { id: "crossbow",  cost: 45,  icon: "🎯" },
    { id: "knight",    cost: 60,  icon: "🐎" },
    { id: "mage",      cost: 75,  icon: "🔥" },
    { id: "catapult",  cost: 90,  icon: "🪨" },
    { id: "paladin",   cost: 110, icon: "🛡️" },
];

// ─── PERMANENT UNIT UPGRADES ─────────────────────────────────────────
// Bought in the War Council with banked Gold (treasury) OR Renown. Every
// player unit has a Damage and a Health track. A track's current level is the
// index into the shared cost arrays, so maxLevel === gold.length. The bonus is
// ADDITIVE-FLAT (dmgPer/hpPer × level) and is applied to a freshly recruited
// unit in buyUnit() — it raises the unit's floor *beneath* the run's
// multiplicative tech upgrades, forge, and XP promotions, which all stack on
// top. dmgPer/hpPer are tuned to ~+50% of base at full level; costs escalate
// per level and scale with the unit's battlefield value.
export const UNIT_UPGRADES = {
    militia:   { icon: "🗡️", dmgPer: 2, hpPer: 14, gold: [150, 260, 420, 640, 900],   renown: [3, 5, 8, 12, 17] },
    archer:    { icon: "🏹", dmgPer: 2, hpPer: 8,  gold: [170, 290, 460, 700, 980],   renown: [3, 5, 8, 12, 17] },
    swordsman: { icon: "🛡", dmgPer: 2, hpPer: 18, gold: [240, 400, 620, 900, 1250],  renown: [4, 7, 11, 16, 22] },
    spearman:  { icon: "🔱", dmgPer: 3, hpPer: 14, gold: [240, 400, 620, 900, 1250],  renown: [4, 7, 11, 16, 22] },
    crossbow:  { icon: "🎯", dmgPer: 4, hpPer: 9,  gold: [280, 460, 720, 1050, 1450], renown: [4, 7, 11, 16, 22] },
    cleric:    { icon: "✨", dmgPer: 1, hpPer: 12, gold: [240, 400, 620, 900, 1250],  renown: [4, 7, 11, 16, 22] },
    knight:    { icon: "🐎", dmgPer: 5, hpPer: 30, gold: [420, 680, 1000, 1400, 1900], renown: [6, 10, 15, 21, 28] },
    mage:      { icon: "🔥", dmgPer: 6, hpPer: 8,  gold: [420, 680, 1000, 1400, 1900], renown: [6, 10, 15, 21, 28] },
    catapult:  { icon: "🪨", dmgPer: 1, hpPer: 24, gold: [420, 680, 1000, 1400, 1900], renown: [6, 10, 15, 21, 28] },
    paladin:   { icon: "⚔", dmgPer: 5, hpPer: 32, gold: [480, 760, 1100, 1550, 2100], renown: [6, 10, 15, 21, 28] },
};
const UPGRADE_TRACKS = { dmg: "Damage", hp: "Health" };

// Cost of the NEXT level, from a base price and the current level. Geometric
// growth (~1.5x/level) so hero & castle upgrades are UNLIMITED — no cap, the
// price just keeps climbing. Rounded to a tidy number for display.
const UPGRADE_GROWTH = 1.5;
export function upgradeCost(base, lvl) {
    const raw = base * Math.pow(UPGRADE_GROWTH, lvl);
    // round to 2 significant-ish figures so buttons read cleanly (e.g. 1250)
    const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(raw)) - 1));
    return Math.round(raw / mag) * mag;
}

// ─── HERO PERMANENT UPGRADES (unlimited) ─────────────────────────────
// The Voidcaller is not recruited via buyUnit(), so he has his own upgrade
// catalog applied at spawn (reset()) rather than through applyUnitUpgrades().
// Four tracks, each additive-flat per level, NO cap (cost climbs geometrically
// from goldBase/renownBase via upgradeCost). Buyable with banked Gold OR Renown.
//   power      +dmg (basic bolts AND the Singularity detonation scale with dmg)
//   vitality   +maxHp
//   attunement +charge gained per basic hit -> Singularity casts more often
//   rift       +Singularity radius AND detonation damage (the signature blast)
export const HERO_UPGRADES = {
    power:      { icon: "⚔", label: "Power",      per: 6,  suffix: " dmg",   goldBase: 300, renownBase: 5 },
    vitality:   { icon: "❤", label: "Vitality",   per: 80, suffix: " hp",    goldBase: 300, renownBase: 5 },
    attunement: { icon: "🌀", label: "Attunement", per: 2,  suffix: "/hit",   goldBase: 340, renownBase: 6 },
    rift:       { icon: "💥", label: "Rift",       per: 18, suffix: " r/dmg", goldBase: 380, renownBase: 6 },
};

// ─── CASTLE PERMANENT UPGRADES (unlimited) ───────────────────────────
// Applied to the castle Building at run start (reset()). Same unlimited model.
//   might   +beam damage per tick
//   bastion +max HP
//   rapid   -frames between beam ticks (faster machine-gun fire; floored)
//   reach   +beam range
export const CASTLE_UPGRADES = {
    might:   { icon: "⚔", label: "Might",   per: 14, suffix: " dmg",   goldBase: 320, renownBase: 5 },
    bastion: { icon: "🏰", label: "Bastion", per: 400, suffix: " hp",   goldBase: 300, renownBase: 5 },
    rapid:   { icon: "🔥", label: "Rapid Fire", per: 1, suffix: " rof", goldBase: 360, renownBase: 6 },
    reach:   { icon: "🎯", label: "Reach",   per: 30, suffix: " rng",   goldBase: 340, renownBase: 6 },
};

export class MetaProgression {
    constructor(g) {
        this.g = g;
        this.renown = 0;
        this.unlocked = new Set();  // permanently-unlocked unit ids
        this.cleared = new Set();   // campaign levels already first-cleared
        this.treasury = 0;          // banked leftover gold (carryover)
        this.unitUpgrades = {};     // { unitId: { dmg: level, hp: level } }
        this.heroUpgrades = {};     // { track: level } for the Voidcaller
        this.castleUpgrades = {};   // { track: level } for the Castle
        this.load();
    }

    load() {
        try {
            const s = loadJSON("sd_meta_v1");
            if (s) {
                this.renown = s.renown || 0;
                this.unlocked = new Set(s.unlocked || []);
                this.cleared = new Set(s.cleared || []);
                this.treasury = s.treasury || 0;
                this.unitUpgrades = s.unitUpgrades || {};
                this.heroUpgrades = s.heroUpgrades || {};
                this.castleUpgrades = s.castleUpgrades || {};
            }
        } catch (e) { /* keep defaults */ }
    }

    save() {
        saveJSON("sd_meta_v1", {
            renown: this.renown,
            unlocked: [...this.unlocked],
            cleared: [...this.cleared],
            treasury: this.treasury,
            unitUpgrades: this.unitUpgrades,
            heroUpgrades: this.heroUpgrades,
            castleUpgrades: this.castleUpgrades,
        });
    }

    addRenown(n) {
        n = Math.floor(n);
        if (n <= 0) return;
        this.renown += n;
        this.save();
    }

    // Bank leftover gold into the persistent treasury at run-end (gold
    // carryover). Self-persisting like addRenown, so run-end callers need no
    // extra saveGame(). Returns the amount actually banked (for the stats HUD).
    bankGold(n) {
        n = Math.floor(n);
        if (n <= 0) return 0;
        this.treasury += n;
        this.save();
        return n;
    }

    // Current level of a unit's upgrade track (0 when never bought).
    upgradeLevel(id, track) {
        return (this.unitUpgrades[id] && this.unitUpgrades[id][track]) || 0;
    }

    // Apply permanent flat stat bonuses to a freshly recruited player unit.
    // Called from buyUnit() BEFORE the run's multiplicative applyUpgrades(), so
    // meta upgrades raise the base and tech/forge/XP stack on top. Reads the
    // shared UNIT_UPGRADES catalog for the per-level amounts — never mutates it.
    applyUnitUpgrades(unit, type) {
        const cfg = UNIT_UPGRADES[type];
        const lv = this.unitUpgrades[type];
        if (!cfg || !lv) return;
        if (lv.dmg) unit.dmg += cfg.dmgPer * lv.dmg;
        if (lv.hp) {
            unit.maxHp += cfg.hpPer * lv.hp;
            unit.hp = unit.maxHp; // fresh recruit spawns at full (raised) HP
        }
    }

    // Spend treasury Gold OR Renown to buy the next level of a unit's track.
    buyUpgrade(id, track, currency) {
        const cfg = UNIT_UPGRADES[id];
        if (!cfg || (track !== "dmg" && track !== "hp")) return;
        const costs = currency === "renown" ? cfg.renown : cfg.gold;
        const lvl = this.upgradeLevel(id, track);
        if (lvl >= costs.length) return; // maxed
        const cost = costs[lvl];
        const have = currency === "renown" ? this.renown : this.treasury;
        if (have < cost) {
            this.g.audio.playError();
            return;
        }
        if (currency === "renown") this.renown -= cost;
        else this.treasury -= cost;
        this.unitUpgrades[id] = this.unitUpgrades[id] || {};
        this.unitUpgrades[id][track] = lvl + 1;
        this.save();
        this.g.audio.playCoin();
        this.g.notify(
            `⚔ ${UNIT_TYPES[id].name} ${UPGRADE_TRACKS[track]} → Lv.${lvl + 1}`,
        );
        this.renderUpgrades();
    }

    // ── Hero (Voidcaller) permanent upgrades ─────────────────────────────
    heroUpgradeLevel(track) {
        return this.heroUpgrades[track] || 0;
    }

    // Apply the Voidcaller's banked upgrades to his fresh instance. Called from
    // reset() right after the hero is constructed (he isn't recruited via
    // buyUnit, so applyUnitUpgrades never touches him). Reads HERO_UPGRADES for
    // per-level amounts; never mutates the catalog.
    applyHeroUpgrades(hero) {
        if (!hero) return;
        const p = this.heroUpgradeLevel("power");
        const v = this.heroUpgradeLevel("vitality");
        const a = this.heroUpgradeLevel("attunement");
        const r = this.heroUpgradeLevel("rift");
        if (p) hero.dmg += HERO_UPGRADES.power.per * p;
        if (v) {
            hero.maxHp += HERO_UPGRADES.vitality.per * v;
            hero.hp = hero.maxHp;
        }
        if (a && hero.abilityDef) {
            // Faster Void Charge: more meter per basic hit.
            hero._chargeBonusPerHit = HERO_UPGRADES.attunement.per * a;
        }
        if (r && hero.abilityDef) {
            // Bigger, deadlier Singularity. abilityDef is shared data — clone the
            // fields we bump so we never mutate HEROES[].ability globally.
            hero.abilityDef = Object.assign({}, hero.abilityDef);
            hero.abilityDef.radius += HERO_UPGRADES.rift.per * r;
            hero.abilityDef.damage += HERO_UPGRADES.rift.per * r * 4;
        }
    }

    // Spend banked Gold OR Renown to buy the next level of a hero track.
    // Unlimited: no cap, cost climbs geometrically via upgradeCost().
    buyHeroUpgrade(track, currency) {
        const cfg = HERO_UPGRADES[track];
        if (!cfg) return;
        const lvl = this.heroUpgradeLevel(track);
        const base = currency === "renown" ? cfg.renownBase : cfg.goldBase;
        const cost = upgradeCost(base, lvl);
        const have = currency === "renown" ? this.renown : this.treasury;
        if (have < cost) {
            this.g.audio.playError();
            return;
        }
        if (currency === "renown") this.renown -= cost;
        else this.treasury -= cost;
        this.heroUpgrades[track] = lvl + 1;
        this.save();
        this.g.audio.playCoin();
        this.g.notify(`🌀 Voidcaller ${cfg.label} → Lv.${lvl + 1}`);
        // If a run is live, re-apply so the boost lands immediately.
        if (this.g.hero) this.applyHeroUpgrades(this.g.hero);
        this.renderHeroUpgrades();
    }

    // ── Castle permanent upgrades (unlimited) ────────────────────────────
    castleUpgradeLevel(track) {
        return this.castleUpgrades[track] || 0;
    }

    // Apply the castle's banked upgrades to its fresh Building instance. Called
    // from reset() after the castle is pushed. Reads CASTLE_UPGRADES; never
    // mutates the catalog. `rapid` lowers the beam cooldown (floored at 2 so it
    // can't hit zero and fire every frame at absurd DPS).
    applyCastleUpgrades(castle) {
        if (!castle) return;
        const m = this.castleUpgradeLevel("might");
        const b = this.castleUpgradeLevel("bastion");
        const r = this.castleUpgradeLevel("rapid");
        const rc = this.castleUpgradeLevel("reach");
        if (m) castle.dmg += CASTLE_UPGRADES.might.per * m;
        if (b) {
            castle.maxHp += CASTLE_UPGRADES.bastion.per * b;
            castle.hp += CASTLE_UPGRADES.bastion.per * b;
        }
        if (r) castle.cooldown = Math.max(2, castle.cooldown - CASTLE_UPGRADES.rapid.per * r);
        if (rc) {
            castle.range += CASTLE_UPGRADES.reach.per * rc;
            if (castle.flyRange) castle.flyRange += CASTLE_UPGRADES.reach.per * rc;
        }
    }

    buyCastleUpgrade(track, currency) {
        const cfg = CASTLE_UPGRADES[track];
        if (!cfg) return;
        const lvl = this.castleUpgradeLevel(track);
        const base = currency === "renown" ? cfg.renownBase : cfg.goldBase;
        const cost = upgradeCost(base, lvl);
        const have = currency === "renown" ? this.renown : this.treasury;
        if (have < cost) {
            this.g.audio.playError();
            return;
        }
        if (currency === "renown") this.renown -= cost;
        else this.treasury -= cost;
        this.castleUpgrades[track] = lvl + 1;
        this.save();
        this.g.audio.playCoin();
        this.g.notify(`🏰 Castle ${cfg.label} → Lv.${lvl + 1}`);
        // Re-apply live: rebuild from the base castle def each purchase so bonuses
        // don't stack multiplicatively across buys.
        const castle = this.g.buildings && this.g.buildings.find((x) => x.type === "castle");
        if (castle) this._reapplyCastle(castle);
        this.renderCastleUpgrades();
    }

    // Recompute the live castle's upgradeable stats from its base def + current
    // levels (idempotent), so repeated purchases mid-run apply cleanly.
    _reapplyCastle(castle) {
        const def = BUILDING_TYPES.castle;
        if (!def) return;
        const lvl = Math.max(0, this.g.level || 0);
        // Mirror reset()'s base-castle math for dmg, then layer upgrades.
        castle.dmg = Math.round((def.dmg || 0) * (1 + lvl * 0.6));
        castle.cooldown = def.cooldown || 0;
        castle.range = def.range || 0;
        castle.flyRange = def.flyRange || 0;
        const baseMaxHp = def.hp * (1 + (this.g.upgrades.bldg_hp || 0));
        const hpFrac = castle.maxHp > 0 ? castle.hp / castle.maxHp : 1;
        castle.maxHp = baseMaxHp;
        this.applyCastleUpgrades(castle);
        castle.hp = Math.min(castle.maxHp, castle.maxHp * hpFrac);
    }

    // Award for finishing a campaign region: a big one-time first-clear bonus,
    // a token amount on replays (so grinding the easiest level isn't worth it).
    awardCampaign(level) {
        const first = !this.cleared.has(level);
        const amt = first ? 20 + level * 8 : 5;
        this.renown += amt;
        if (first) this.cleared.add(level);
        this.save();
        return amt;
    }

    // Merge permanent unlocks into a run's active roster (called from reset()).
    applyTo(set) {
        this.unlocked.forEach((id) => set.add(id));
    }

    // Spend renown to permanently unlock a unit (from the War Council panel).
    buy(id) {
        const def = ADVANCED_UNITS.find((u) => u.id === id);
        if (!def || this.unlocked.has(id)) return;
        if (this.renown < def.cost) {
            this.g.audio.playError();
            return;
        }
        this.renown -= def.cost;
        this.unlocked.add(id);
        this.save();
        // If a run is already in progress, make it available immediately.
        if (this.g.unlocked && this.g.unlocked.u) this.g.unlocked.u.add(id);
        this.g.audio.playCoin();
        this.g.notify(`⚔ ${UNIT_TYPES[id].name} permanently unlocked!`);
        this.renderCouncil();
        if (this.g.state === "playing") this.g.updateUI();
    }

    renderCouncil() {
        const rd = document.getElementById("renownDisplay");
        if (rd) rd.textContent = `✦ ${this.renown} Renown`;
        const grid = document.getElementById("unlockGrid");
        if (!grid) return;
        grid.innerHTML = "";
        ADVANCED_UNITS.forEach((u) => {
            const d = UNIT_TYPES[u.id];
            const owned = this.unlocked.has(u.id);
            const afford = this.renown >= u.cost;
            const action = owned
                ? `<span class="unlock-owned">✓ Unlocked</span>`
                : `<button class="tech-btn" ${afford ? "" : "disabled"} onclick="game.meta.buy('${u.id}')">Unlock · ✦${u.cost}</button>`;
            grid.innerHTML += `<div class="ach-item ${owned ? "unlock-done" : ""}">
                <span class="ach-icon">${u.icon}</span>
                <div style="flex-grow:1;min-width:0;">
                    <div class="ach-name">${d.name}</div>
                    <div class="ach-desc">${d.desc || ""}</div>
                    <div style="margin-top:8px;">${action}</div>
                </div>
            </div>`;
        });
    }

    // Permanent per-unit upgrade grid (War Council). Each unit shows a Damage
    // and a Health track with a level pip bar and two buy buttons — pay in
    // banked Gold or Renown. Rendered on overlay open and after each purchase.
    renderUpgrades() {
        const td = document.getElementById("treasuryDisplay");
        if (td)
            td.innerHTML =
                `🪙 <b style="color:var(--gold)">${this.treasury}</b> Gold &nbsp;·&nbsp; ✦ <b style="color:#c084fc">${this.renown}</b> Renown`;
        const grid = document.getElementById("upgradeGrid");
        if (!grid) return;
        grid.innerHTML = "";
        Object.keys(UNIT_UPGRADES).forEach((id) => {
            const cfg = UNIT_UPGRADES[id];
            const d = UNIT_TYPES[id];
            const max = cfg.gold.length;
            const trackRow = (track, label, per) => {
                const lvl = this.upgradeLevel(id, track);
                const bar = "▰".repeat(lvl) + "▱".repeat(max - lvl);
                const bonus = per * lvl;
                let action;
                if (lvl >= max) {
                    action = `<span class="unlock-owned">✓ MAX</span>`;
                } else {
                    const g = cfg.gold[lvl];
                    const r = cfg.renown[lvl];
                    const gAff = this.treasury >= g;
                    const rAff = this.renown >= r;
                    action =
                        `<button class="tech-btn upg-btn" ${gAff ? "" : "disabled"} onclick="game.meta.buyUpgrade('${id}','${track}','gold')">🪙${g}</button>` +
                        `<button class="tech-btn upg-btn" ${rAff ? "" : "disabled"} onclick="game.meta.buyUpgrade('${id}','${track}','renown')">✦${r}</button>`;
                }
                return `<div class="upg-track">
                    <span class="upg-label">${label} <span class="upg-bar">${bar}</span>${bonus ? ` <span class="upg-bonus">+${bonus}</span>` : ""}</span>
                    <span class="upg-actions">${action}</span>
                </div>`;
            };
            grid.innerHTML += `<div class="ach-item">
                <span class="ach-icon">${cfg.icon}</span>
                <div style="flex-grow:1;min-width:0;">
                    <div class="ach-name">${d.name}</div>
                    ${trackRow("dmg", "⚔ Damage", cfg.dmgPer)}
                    ${trackRow("hp", "❤ Health", cfg.hpPer)}
                </div>
            </div>`;
        });
    }

    // Visual level indicator for UNLIMITED tracks: a Lv.N badge + a bounded pip
    // bar (never grows past 12 pips, so String.repeat can't blow up). This is
    // the shared renderer for hero + castle rows.
    _upgTrackRow(cfg, lvl, buyFn, track) {
        const gCost = upgradeCost(cfg.goldBase, lvl);
        const rCost = upgradeCost(cfg.renownBase, lvl);
        const gAff = this.treasury >= gCost;
        const rAff = this.renown >= rCost;
        const bonus = cfg.per * lvl;
        const pips = "▰".repeat(Math.min(lvl, 12)) + (lvl > 12 ? "…" : "");
        const action =
            `<button class="tech-btn upg-btn" ${gAff ? "" : "disabled"} onclick="game.meta.${buyFn}('${track}','gold')">🪙${gCost}</button>` +
            `<button class="tech-btn upg-btn" ${rAff ? "" : "disabled"} onclick="game.meta.${buyFn}('${track}','renown')">✦${rCost}</button>`;
        return `<div class="upg-track">
            <span class="upg-label">${cfg.icon} ${cfg.label} <span class="upg-bonus">Lv.${lvl}</span> <span class="upg-bar">${pips}</span>${bonus ? ` <span class="upg-bonus">+${bonus}${cfg.suffix}</span>` : ""}</span>
            <span class="upg-actions">${action}</span>
        </div>`;
    }

    // Voidcaller permanent upgrade grid (War Council). One card, four UNLIMITED
    // tracks. Gold/Renown buy buttons; no cap.
    renderHeroUpgrades() {
        const grid = document.getElementById("heroUpgradeGrid");
        if (!grid) return;
        const rows = Object.keys(HERO_UPGRADES).map((track) =>
            this._upgTrackRow(HERO_UPGRADES[track], this.heroUpgradeLevel(track),
                "buyHeroUpgrade", track)).join("");
        grid.innerHTML = `<div class="ach-item">
            <span class="ach-icon">🌀</span>
            <div style="flex-grow:1;min-width:0;">
                <div class="ach-name">Voidcaller</div>
                ${rows}
            </div>
        </div>`;
    }

    // Castle permanent upgrade grid (War Council). One card, four UNLIMITED
    // tracks. Mirrors renderHeroUpgrades().
    renderCastleUpgrades() {
        const grid = document.getElementById("castleUpgradeGrid");
        if (!grid) return;
        const rows = Object.keys(CASTLE_UPGRADES).map((track) =>
            this._upgTrackRow(CASTLE_UPGRADES[track], this.castleUpgradeLevel(track),
                "buyCastleUpgrade", track)).join("");
        grid.innerHTML = `<div class="ach-item">
            <span class="ach-icon">🏰</span>
            <div style="flex-grow:1;min-width:0;">
                <div class="ach-name">Castle</div>
                ${rows}
            </div>
        </div>`;
    }
}
