import { CONFIG } from '../config.js';
import { SPELLS } from '../data/spells.js';
import { dist, rand } from '../utils.js';

// --- SPELL EFFECTS ---
// One entry per spell id. SpellManager.cast() runs the shared preamble (spend
// mana, resolve the world point `w`, clamp ground `wy`, play the cast sound)
// and then dispatches here. Each body is the exact former cast() branch, so
// adding a spell is one SPELLS entry (with its `key`) plus one function here.
// `sp` is SPELLS[id]; effects read the ambient `game` global like the rest of
// the entity/system code.
export const SPELL_BEHAVIORS = {
    meteor(sp, w, wy) {
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
                ) {
                    en.takeDamage(pwr, "strong");
                    // Airborne foes sit above the impact — throw fire up to
                    // them so the strike clearly connects, not just the ground.
                    if (en.flying) {
                        game.particles.emit(en.x, en.y - 68, 14, "#f97316", 7, 4, "fade");
                        game.fx.flash(en.x, en.y - 68, { r: 30, col: "#fdba74", life: 10 });
                    }
                }
            });
        }, 800);
    },

    blizzard(sp, w, wy) {
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
                        // Frost also swirls up around airborne foes.
                        if (en.flying && i % 5 === 0)
                            game.particles.emit(en.x, en.y - 68, 5, "#38bdf8", 3, 4, "float");
                    }
                });
            }, i * 90);
        }
    },

    heal(sp, w, wy) {
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
    },

    lightning(sp, w, wy) {
        const sp2 = SPELLS.lightning;
        // Arc endpoint sits at each foe's body — higher for airborne targets
        // so the bolt visibly leaps up to Dragons.
        const arcY = (en) => en.y - (en.flying ? 68 : 28);
        let near = game.enemies.filter(e => e.hp > 0 && dist(w.x, wy, e.x, e.y) < 600);
        near.sort((a,b) => dist(w.x,wy,a.x,a.y) - dist(w.x,wy,b.x,b.y));
        near = near.slice(0, sp2.chains);
        const pwr2 = sp2.damage * (1 + (game.upgrades.magic_damage || 0));
        near.forEach((en, idx) => {
            setTimeout(() => {
                if (game.state !== 'playing') return;
                en.takeDamage(pwr2 * Math.pow(0.82, idx), "magic");
                game.particles.emit(en.x, arcY(en), 12, '#7dd3fc', 6, 3, 'spark');
                const prev = idx === 0 ? {x: w.x, y: wy} : {x: near[idx-1].x, y: arcY(near[idx-1])};
                game.lightningArcs.push({ x1: prev.x, y1: prev.y, x2: en.x, y2: arcY(en), life: 14 });
                game.audio.playMagic();
            }, idx * 110);
        });
        if (near.length === 0) game.notify('No targets in range!');
    },
};
