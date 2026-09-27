import { CONFIG, TEAMS } from '../config.js';
import { terrain } from '../systems/terrain.js';

// --- GAME: battlefield tactics (installed onto Game.prototype) ---------------
// Terrain-aware army behaviour shared by every Unit:
//   - holdX: where idle player troops form up. Each formation picks the most
//     valuable tactical anchor (crest, shrine, tunnel mouth, bridgehead, forest,
//     barricade) inside its reach; Aggressive leapfrogs crest to crest as the
//     ground ahead is cleared.
//   - fronts: the leading edge of each army (enemy AI forced-march + boss).
//   - blockers: walls/barricades that enemies must smash through.

const HOLD_WINDOW = { defensive: [350, 1700], standard: [350, 3300] };
const FALLBACK_HOLD = { defensive: 320, standard: 450, aggressive: 700 };
const CLEAR_R = 450; // an anchor is "clear" when no enemy stands this close

export const tacticsMethods = /** @type {ThisType<any>} */ ({
    // Leading edge of the player army (buildings count — they're the base).
    frontX() {
        let f = 300;
        for (const u of this.units) if (u.active && u.x > f) f = u.x;
        for (const b of this.buildings) if (b.active && b.type !== "barricade" && b.x > f) f = b.x;
        return f;
    },

    updateTactics() {
        this._frontP = this.frontX();
        let ef = CONFIG.WORLD_WIDTH;
        for (const e of this.enemies) if (e.active && !e.isBoss && e.x < ef) ef = e.x;
        this._frontE = ef;
        if (this.holdX == null || this._holdForm !== this.formation || this.frames % 20 === 0) {
            this._holdForm = this.formation;
            this.holdX = this._computeHold();
        }
    },

    _anchorClear(x) {
        for (const e of this.enemies) if (e.active && !e.isBoss && Math.abs(e.x - x) < CLEAR_R) return false;
        return true;
    },

    _computeHold() {
        const A = terrain.anchors || [];
        const f = this.formation;
        const win = HOLD_WINDOW[f];
        if (win) {
            let best = null, bestV = -Infinity;
            for (const a of A) {
                if (a.x < win[0] || a.x > win[1]) continue;
                // Defensive favours ground near home; Standard reaches farther.
                const v = a.v - (a.x - win[0]) * (f === "defensive" ? 0.05 : 0.02);
                if (v > bestV) { bestV = v; best = a; }
            }
            return best ? best.x : FALLBACK_HOLD[f];
        }
        // Aggressive: advance through every anchor whose ground is clear, and
        // stop at the first contested one (or short of the enemy line).
        // Step at most ~700 px past the army's front per recompute, and never
        // camp the enemy's gate.
        let hold = FALLBACK_HOLD.aggressive;
        const cap = Math.min(this._frontP + 700, CONFIG.WORLD_WIDTH - 1400);
        for (const a of A) {
            if (a.x <= hold) continue;
            if (a.x > cap || a.x > this._frontE - 250 || !this._anchorClear(a.x)) break;
            hold = a.x;
        }
        return hold;
    },

    // The nearest standing blocker (wall/barricade) at or west of x.
    blockerWest(x) {
        let best = null;
        for (const b of this.buildings)
            if (b.blocks && b.active && b.hp > 0 && !b.building && b.x <= x && (!best || b.x > best.x)) best = b;
        return best;
    },

    // Barricades come from the level's terrain; placed after the castle.
    spawnTerrainStructures(Building) {
        for (const bz of terrain.barricades) {
            const b = new Building(bz.x, "barricade", TEAMS.PLAYER);
            b.building = false;
            b.bTimer = 0;
            this.buildings.push(b);
        }
    },

    // Selected barricade/wall: pay to restore half its health.
    repairSelected() {
        const b = this.sel;
        if (!b || !b.blocks || !b.active || b.hp >= b.maxHp) return;
        const cost = 40;
        if (this.gold < cost) { this.audio.playError(); this.notify("Not enough gold to repair."); return; }
        this.gold -= cost;
        b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.5);
        this.fx.ring(b.x, b.y - b.h * 0.5, { r0: 6, r1: 60, col: "#34d399", w: 3, life: 18 });
        this.particles.emit(b.x, b.y - b.h * 0.5, 12, "#a3e635", 3, 3, "float");
        this.audio.playBuild();
        this.updateSelUI();
    },
});
