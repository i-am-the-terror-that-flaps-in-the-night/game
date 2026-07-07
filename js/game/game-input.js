import { CONFIG } from '../config.js';
import { defOf, describeMatchups } from '../systems/combat.js';
import { BUILDING_TYPES } from '../data/buildings.js';
import { UNIT_TYPES } from '../data/units.js';
import { btnId } from '../utils.js';
import { BUILDING_ROSTER, UNIT_ROSTER } from '../ui/action-bar.js';
import { Game } from './game.js';

// Hotkey -> unit/building type, derived from the on-screen roster so the
// keyboard bindings and the action-bar share a single source of truth.
const KEY_MAP = Object.fromEntries(
    [...UNIT_ROSTER, ...BUILDING_ROSTER].map(([type, disp]) => [disp.toLowerCase(), type]),
);

// --- GAME: event binding, spell selection & formations ---
Object.assign(Game.prototype, /** @type {ThisType<any>} */ ({
    bindEvents() {
        // Native hover titles on the recruit/build bars explaining each role
        Object.entries(UNIT_TYPES).forEach(([t, d]) => {
            const btn = document.getElementById(btnId(t));
            if (btn && d.desc) btn.title = `${d.name} — ${d.desc}`;
        });
        Object.entries(BUILDING_TYPES).forEach(([t, d]) => {
            const btn = document.getElementById(btnId(t));
            if (btn && d.desc) btn.title = `${d.name} — ${d.desc}`;
        });

        this.canvas.addEventListener("mousemove", (e) => {
            this.mouse.x = e.clientX;
            this.mouse.y = e.clientY;
            const w = this.camera.toWorld(e.clientX, e.clientY);
            const tt = document.getElementById("tooltip");
            const hov = this.pickAt(w.x, w.y);

            if (hov) {
                tt.classList.remove("hidden");
                tt.style.left =
                    Math.min(
                        e.clientX + 20,
                        window.innerWidth - 320,
                    ) + "px"; // Fix #14
                tt.style.top = e.clientY + 20 + "px";
                const def = defOf(hov);
                if (def) {
                    const mu = describeMatchups(def);
                    tt.innerHTML = `<div class="tt-name">${def.name}</div><div class="tt-desc">${def.desc || ""}</div>HP: ${Math.floor(hov.hp)}/${hov.maxHp}<br>${def.dmg ? "DMG: " + def.dmg + "<br>" : ""}${def.armor ? "Armor: " + def.armor + "<br>" : ""}${mu ? `<span style="font-size:11px;">${mu}</span>` : ""}`;
                }
            } else {
                tt.classList.add("hidden");
            }
        });

        // FIX: Hide tooltip and stop edge-scroll when mouse leaves canvas
        this.canvas.addEventListener("mouseleave", () => {
            this.mouse.x = -1000;
            this.mouse.y = -1000;
            document.getElementById("tooltip").classList.add("hidden");
        });

        this.canvas.addEventListener("mousedown", (e) => {
            if (e.button !== 0 || this.spells.active) return;
            const w = this.camera.toWorld(e.clientX, e.clientY);
            this.sel = this.pickAt(w.x, w.y);
            this.updateSelUI();
        });

        // Touch Listeners (Fix #1 & #15)
        let touchStartX = null;
        this.canvas.addEventListener(
            "touchstart",
            (e) => {
                if (e.touches.length === 1) {
                    touchStartX = e.touches[0].clientX;
                    if (!this.spells.active) {
                        const w = this.camera.toWorld(
                            e.touches[0].clientX,
                            e.touches[0].clientY,
                        );
                        this.sel = this.pickAt(w.x, w.y, 45, 80);
                        this.updateSelUI();
                    }
                }
            },
            { passive: true },
        );
        this.canvas.addEventListener(
            "touchmove",
            (e) => {
                if (touchStartX !== null && !this.spells.active) {
                    const dx = touchStartX - e.touches[0].clientX;
                    this.camera.pan(dx * 2);
                    touchStartX = e.touches[0].clientX;
                }
            },
            { passive: true },
        );
        this.canvas.addEventListener("touchend", () => {
            touchStartX = null;
        });

        // Mobile Auto-Queue Long Press (Fix #15)
        document.querySelectorAll(".unit-btn").forEach((btn) => {
            let t;
            btn.addEventListener(
                "touchstart",
                (e) => {
                    t = setTimeout(() => {
                        const type = btn.id
                            .replace("btn", "")
                            .toLowerCase();
                        this.toggleAuto(type);
                        if (navigator.vibrate)
                            navigator.vibrate(50);
                    }, 500);
                },
                { passive: true },
            );
            btn.addEventListener("touchend", () => clearTimeout(t));
            btn.addEventListener("touchmove", () =>
                clearTimeout(t),
            );
        });

        // Keyboard
        window.addEventListener("keydown", (e) => {
            if (this.state !== "playing") return;
            const k = e.key.toLowerCase();
            const type = KEY_MAP[k];
            if (type) {
                if (UNIT_TYPES[type]) this.buyUnit(type);
                else if (BUILDING_TYPES[type]) this.build(type);
            }
            if (k === " " || k === "p" || k === "escape")
                this.setSpeed(this.ts === 0 ? 1 : 0);
            if (k === "y") this.openTechTree();
            if (k === "n") this.callWave();
            if (e.code === "ArrowLeft" || e.code === "KeyA")
                this.camera.pan(-40);
            if (e.code === "ArrowRight" || e.code === "KeyD")
                this.camera.pan(40);
        });

        // Minimap
        const mm = document.getElementById("minimap");
        mm.addEventListener("mousedown", (e) => {
            const rect = mm.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            this.camera.tX =
                pct * CONFIG.WORLD_WIDTH -
                window.innerWidth / this.camera.z / 2;
        });
        mm.addEventListener(
            "touchstart",
            (e) => {
                const rect = mm.getBoundingClientRect();
                const pct =
                    (e.touches[0].clientX - rect.left) / rect.width;
                this.camera.tX =
                    pct * CONFIG.WORLD_WIDTH -
                    window.innerWidth / this.camera.z / 2;
            },
            { passive: true },
        );
    },

    // Topmost unit/enemy (falling back to a building) under a world point, or
    // null. ur/ury are the unit hit paddings — touch input passes a larger box
    // than the mouse. Last match in iteration order wins, as before.
    pickAt(wx, wy, ur = 35, ury = 60) {
        let hit = null;
        for (const u of [...this.units, ...this.enemies])
            if (Math.abs(u.x - wx) < ur && Math.abs(u.y - wy) < ury) hit = u;
        if (!hit)
            for (const b of this.buildings)
                if (Math.abs(b.x - wx) < b.w / 2 && wy > b.y - b.h && wy < b.y)
                    hit = b;
        return hit;
    },

    selectSpell(spellId) {
        this.spells.select(spellId);
    },

    setFormation(f) {
        this.formation = f;
        ['defensive','standard','aggressive'].forEach(id => {
            const b = document.getElementById('fBtn-' + id);
            if (b) b.classList.toggle('active', id === f);
        });
    },
}));
