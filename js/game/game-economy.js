import { CONFIG, TEAMS } from '../config.js';
import { BUILDING_TYPES } from '../data/buildings.js';
import { TECH_TREE } from '../data/tech.js';
import { UNIT_TYPES } from '../data/units.js';
import { Building } from '../entities/building.js';
import { Unit } from '../entities/unit.js';
import { btnId, rand } from '../utils.js';

// --- GAME: resources, recruiting, building & tech (installed by install-mixins.js) ---
export const economyMethods = /** @type {ThisType<any>} */ ({
    addGold(a) {
        this.gold += a;
        this.stats.gold += a;
    },

    checkCost(c) {
        return (
            this.gold >= (c.g || 0) &&
            this.iron >= (c.i || 0) &&
            this.crystal >= (c.c || 0)
        );
    },

    payCost(c) {
        this.gold -= c.g || 0;
        this.iron -= c.i || 0;
        this.crystal -= c.c || 0;
    },

    // Recruiting the same unit over and over gets expensive: +18% of the
    // base price per living unit of that type. Mixed armies stay cheap.
    unitCost(t) {
        const base = UNIT_TYPES[t].cost;
        const n = this.units.filter(
            (u) => u.type === t && u.hp > 0 && u.team === TEAMS.PLAYER,
        ).length;
        const s = 1 + 0.18 * n;
        return {
            g: Math.ceil((base.g || 0) * s),
            i: Math.ceil((base.i || 0) * s),
            c: Math.ceil((base.c || 0) * s),
        };
    },

    // Mines escalate steeply — the second mine is a real investment call.
    buildCost(t) {
        const base = BUILDING_TYPES[t].cost;
        if (t !== "mine") return base;
        const n = this.buildings.filter(
            (b) => b.type === "mine" && b.active,
        ).length;
        const s = Math.pow(1.6, n);
        return { g: Math.ceil((base.g || 0) * s) };
    },

    toggleAuto(type) {
        if (!this.unlocked.u.has(type)) return;
        this.autoQueue[type] = !this.autoQueue[type];
        const btn = document.getElementById(btnId(type));
        if (this.autoQueue[type]) {
            btn.classList.add("auto-queued");
            this.audio.playTone(800, 0.1, "sine", 0.1);
        } else {
            btn.classList.remove("auto-queued");
            this.audio.playTone(400, 0.1, "sine", 0.1);
        }
    },

    buyUnit(t, auto = false) {
        if (this.state !== "playing" || !this.unlocked.u.has(t))
            return false;
        const d = UNIT_TYPES[t];
        const cost = this.unitCost(t);
        if (!this.checkCost(cost)) {
            if (!auto) {
                this.audio.playError();
                this.notify("Insufficient Resources.");
            }
            return false;
        }
        if (this.pop + d.pop > this.maxPop) {
            if (!auto) {
                this.audio.playError();
                this.notify("Population Limit Reached.");
            }
            return false;
        }
        this.payCost(cost);
        this.pop += d.pop;
        const u = new Unit(150 + rand(-20, 20), t, TEAMS.PLAYER);
        // Permanent War-Council upgrades raise the base stats first; the run's
        // multiplicative tech (applyUpgrades) and forge then stack on top.
        if (this.meta) this.meta.applyUnitUpgrades(u, t);
        u.applyUpgrades(this.upgrades);
        if (this.upgrades.forge && !UNIT_TYPES[t].ranged)
            u.dmg = Math.ceil(u.dmg * (1 + this.upgrades.forge));
        this.units.push(u);
        if (!auto) this.audio.playBuild();
        return true;
    },

    build(t) {
        if (this.state !== "playing" || !this.unlocked.b.has(t))
            return;
        const d = BUILDING_TYPES[t];
        const cost = this.buildCost(t);
        if (!this.checkCost(cost)) {
            this.audio.playError();
            this.notify("Insufficient Resources.");
            return;
        }
        // Lay buildings out in a row on your side of the field. Scan left→right
        // for the first gap wide enough for THIS building's actual footprint
        // (so a slot freed by a destroyed building gets reused), packing them
        // just clear of each other. The frontier runs to midfield, so a real
        // base — several mines, towers, walls and every unlocker — fits without
        // running out of room after a handful of structures.
        const newW = d.width || 100;
        const gap = 22; // breathing room between adjacent footprints
        const maxX = CONFIG.WORLD_WIDTH * 0.5; // buildable out to midfield
        let bx = 340;
        while (
            this.buildings.some(
                (b) => Math.abs(b.x - bx) < (b.w + newW) / 2 + gap,
            )
        )
            bx += 24;
        if (bx > maxX) {
            this.audio.playError();
            this.notify("No space near castle!");
            return;
        }
        this.payCost(cost);
        const b = new Building(bx, t, TEAMS.PLAYER);
        this.buildings.push(b);
        if (d.unlock) {
            d.unlock.forEach((u) => this.unlocked.u.add(u));
            const names = d.unlock
                .map((u) => UNIT_TYPES[u].name)
                .join(", ");
            this.notify(`Unlocked: ${names}`);
        }
        this.audio.playBuild();
    },

    spawnEnemy(t, x, y) {
        const e = new Unit(x, t, TEAMS.ENEMY);
        e.maxHp *= (this.diff || 1) * (this.difficultyMult || 1);
        e.dmg   *= (this.diff || 1) * (this.difficultyMult || 1);
        e.hp = e.maxHp;
        this.enemies.push(e);
    },

    buyTech(id) {
        const t = TECH_TREE.find((x) => x.id === id);
        if (!t || this.techs.has(id) || this.gold < t.cost) return;
        this.gold -= t.cost;
        this.techs.add(id);
        this.upgrades[t.type] =
            (this.upgrades[t.type] || 0) + t.val;
        if (t.applies === "magic")
            this.upgrades.magic_damage =
                (this.upgrades.magic_damage || 0) + t.val; // Fix #9

        if (t.type === "pop") this.maxPop += t.val;
        if (t.type === "mana") {
            this.spells.maxMana += t.val;
            this.spells.mana += t.val;
        }
        if (t.type === "crystal_inc")
            this.upgrades.crystal_inc =
                (this.upgrades.crystal_inc || 0) + t.val;
        this.audio.playCoin();
        this.openTechTree();
        this.updateUI();
    },
});
