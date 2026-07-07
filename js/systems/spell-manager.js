import { CONFIG, RESOURCES } from '../config.js';
import { SPELLS } from '../data/spells.js';
import { SPELL_BEHAVIORS } from './spell-behaviors.js';
import { cap } from '../utils.js';

export class SpellManager {
    constructor() {
        this.active = null;
        this.mana = 100;
        this.maxMana = 100;
        this.dynamicRegen = 0;
    }
    // Register spell input listeners. Called from Game.bindEvents() so every
    // event binding lives in one place; the canvas must exist (it does — the
    // Game constructor builds it before bindEvents runs).
    bindInput() {
        document.addEventListener("keydown", (e) => {
            if (
                typeof game !== "undefined" &&
                game.state !== "playing"
            )
                return;
            if (e.code === "Escape") { this.cancel(); return; }
            for (const id in SPELLS) {
                if (SPELLS[id].key === e.code) { this.select(id); return; }
            }
        });
        document
            .getElementById("gameCanvas")
            .addEventListener("contextmenu", (e) => {
                e.preventDefault();
                this.cancel();
            });
        document
            .getElementById("gameCanvas")
            .addEventListener("mousemove", (e) =>
                this.updateCursor(e),
            );
        document
            .getElementById("gameCanvas")
            .addEventListener("mousedown", (e) => {
                if (
                    e.button === 0 &&
                    this.active &&
                    e.clientY < window.innerHeight - 120
                )
                    this.cast(e);
            });

        document.getElementById("gameCanvas").addEventListener(
            "touchstart",
            (e) => {
                if (
                    this.active &&
                    e.touches.length === 1 &&
                    e.touches[0].clientY < window.innerHeight - 120
                ) {
                    this.cast({
                        clientX: e.touches[0].clientX,
                        clientY: e.touches[0].clientY,
                    });
                }
            },
            { passive: true },
        );
    }
    update(dt) {
        const regen =
            (RESOURCES.MANA_REGEN + this.dynamicRegen) *
            (1 + (game.upgrades.mana ? 0.5 : 0));
        this.mana = Math.min(this.maxMana, this.mana + regen * dt);
        document.getElementById("manaDisplay").innerText =
            Math.floor(this.mana) + "/" + this.maxMana;

        Object.keys(SPELLS).forEach((s) => {
            const btn = document.getElementById("btnSpell" + cap(s));
            if (btn) btn.disabled = this.mana < SPELLS[s].cost;
        });
    }
    select(spellId) {
        if (this.mana < SPELLS[spellId].cost) {
            game.audio.playError();
            return;
        }
        this.active = spellId;
        document
            .querySelectorAll(".spell-btn")
            .forEach((b) => b.classList.remove("active-spell"));
        document
            .getElementById("btnSpell" + cap(spellId))
            .classList.add("active-spell");
        const overlay = document.getElementById("targetOverlay");
        overlay.style.display = "block";
        const cur = document.getElementById("targetCursor");
        cur.style.width = cur.style.height =
            SPELLS[spellId].radius * 2 * game.camera.z + "px";
        cur.style.borderColor = SPELLS[spellId].color;
        cur.style.background = SPELLS[spellId].color
            .replace(")", ", 0.15)")
            .replace("rgb", "rgba");
    }
    cancel() {
        this.active = null;
        document
            .querySelectorAll(".spell-btn")
            .forEach((b) => b.classList.remove("active-spell"));
        document.getElementById("targetOverlay").style.display =
            "none";
    }
    updateCursor(e) {
        if (!this.active) return;
        const cur = document.getElementById("targetCursor");
        cur.style.left = e.clientX + "px";
        cur.style.top = e.clientY + "px";
    }
    cast(e) {
        const sp = SPELLS[this.active];
        this.mana -= sp.cost;
        const w = game.camera.toWorld(e.clientX, e.clientY);
        const wy = Math.min(w.y, CONFIG.GROUND_Y);

        game.audio.playMagic();

        const behavior = SPELL_BEHAVIORS[this.active];
        if (behavior) behavior(sp, w, wy);
        this.cancel();
    }
}
