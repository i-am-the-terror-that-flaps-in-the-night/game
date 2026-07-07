import { UNIT_TYPES } from '../data/units.js';

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

export class MetaProgression {
    constructor(g) {
        this.g = g;
        this.renown = 0;
        this.unlocked = new Set();  // permanently-unlocked unit ids
        this.cleared = new Set();   // campaign levels already first-cleared
        this.load();
    }

    load() {
        try {
            const s = JSON.parse(localStorage.getItem("sd_meta_v1"));
            if (s) {
                this.renown = s.renown || 0;
                this.unlocked = new Set(s.unlocked || []);
                this.cleared = new Set(s.cleared || []);
            }
        } catch (e) { /* keep defaults */ }
    }

    save() {
        try {
            localStorage.setItem("sd_meta_v1", JSON.stringify({
                renown: this.renown,
                unlocked: [...this.unlocked],
                cleared: [...this.cleared],
            }));
        } catch (e) { /* storage unavailable */ }
    }

    addRenown(n) {
        n = Math.floor(n);
        if (n <= 0) return;
        this.renown += n;
        this.save();
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
}
