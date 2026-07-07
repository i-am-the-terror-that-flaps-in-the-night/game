import { CONFIG, RESOURCES } from '../config.js';
import { SPELLS } from '../data/spells.js';
import { cap, dist, rand } from '../utils.js';

export class SpellManager {
    constructor() {
        this.active = null;
        this.mana = 100;
        this.maxMana = 100;
        this.dynamicRegen = 0;
        document.addEventListener("keydown", (e) => {
            if (
                typeof game !== "undefined" &&
                game.state !== "playing"
            )
                return;
            if (e.code === "KeyZ") this.select("meteor");
            if (e.code === "KeyX") this.select("blizzard");
            if (e.code === "KeyC") this.select("heal");
            if (e.code === "KeyV") this.select("lightning");
            if (e.code === "Escape") this.cancel();
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

        if (this.active === "meteor") {
            game.particles.emit(
                w.x,
                wy - 600,
                40,
                "#f97316",
                12,
                20,
                "fade",
            );
            setTimeout(() => {
                if (game.state !== "playing") return;
                game.audio.playExplosion();
                game.shake = 25;
                game.decals.add(
                    w.x,
                    CONFIG.GROUND_Y,
                    "scorch",
                    sp.radius,
                );
                game.particles.emit(
                    w.x,
                    CONFIG.GROUND_Y,
                    100,
                    "#ef4444",
                    20,
                    10,
                    "fade",
                );
                const pwr =
                    sp.damage *
                    (1 + (game.upgrades.magic_damage || 0)); // Fix #9
                game.enemies.forEach((en) => {
                    if (
                        dist(w.x, CONFIG.GROUND_Y, en.x, en.y) <
                        sp.radius
                    )
                        en.takeDamage(pwr, "strong");
                });
            }, 800);
        } else if (this.active === "blizzard") {
            for (let i = 0; i < 35; i++) {
                setTimeout(() => {
                    if (game.state !== "playing") return;
                    game.particles.emit(
                        w.x + rand(-sp.radius, sp.radius),
                        wy + rand(-80, 80),
                        6,
                        "#38bdf8",
                        3,
                        5,
                        "float",
                    );
                    game.enemies.forEach((en) => {
                        if (dist(w.x, wy, en.x, en.y) < sp.radius) {
                            en.takeDamage(12, "magic");
                            en.x = Math.min(
                                CONFIG.WORLD_WIDTH - 50,
                                en.x + en.speed * 0.9,
                            ); // Fix #8
                        }
                    });
                }, i * 90);
            }
        } else if (this.active === "heal") {
            game.particles.emit(
                w.x,
                wy,
                60,
                "#fde047",
                10,
                8,
                "float",
            );
            const hPwr = sp.heal * (1 + (game.upgrades.heal || 0));
            game.units.forEach((u) => {
                if (dist(w.x, wy, u.x, u.y) < sp.radius)
                    u.heal(hPwr);
            });
            game.buildings.forEach((b) => {
                if (dist(w.x, wy, b.x, b.y) < sp.radius)
                    b.heal(hPwr);
            });
        } else if (this.active === 'lightning') {
            const sp2 = SPELLS.lightning;
            let near = game.enemies.filter(e => e.hp > 0 && dist(w.x, wy, e.x, e.y) < 500);
            near.sort((a,b) => dist(w.x,wy,a.x,a.y) - dist(w.x,wy,b.x,b.y));
            near = near.slice(0, sp2.chains);
            const pwr2 = sp2.damage * (1 + (game.upgrades.magic_damage || 0));
            near.forEach((en, idx) => {
                setTimeout(() => {
                    if (game.state !== 'playing') return;
                    en.takeDamage(pwr2 * Math.pow(0.75, idx), "magic");
                    game.particles.emit(en.x, en.y - 28, 12, '#38bdf8', 6, 3, 'spark');
                    const prev = idx === 0 ? {x: w.x, y: wy} : {x: near[idx-1].x, y: near[idx-1].y - 28};
                    game.lightningArcs.push({ x1: prev.x, y1: prev.y, x2: en.x, y2: en.y - 28, life: 14 });
                    game.audio.playMagic();
                }, idx * 110);
            });
            if (near.length === 0) game.notify('No targets in range!');
        }
        this.cancel();
    }
}
