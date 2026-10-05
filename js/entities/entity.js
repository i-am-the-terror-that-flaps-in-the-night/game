import { HIT_FLASH_FRAMES, HIT_FLINCH_FRAMES, TEAMS } from '../config.js';
import { rand } from '../utils.js';
import { PERF } from '../systems/perf.js';

// Floating combat text, capped per entity (anti-lag): beyond the cap the oldest
// number is dropped. In a late-endless brawl the orbital beam alone ticks every
// enemy ~10×/s; uncapped, each body carried 7+ live numbers, every one a
// strokeText+fillText per frame. Cap 0 (Damage Numbers: Off) records nothing.
function pushDmgText(list, t) {
    const cap = PERF.dmgCap;
    if (cap <= 0) return;
    list.push(t);
    if (list.length > cap) list.splice(0, list.length - cap);
}

// --- ENTITIES ---
export class Entity {
    constructor(x, y, team) {
        this.x = x;
        this.y = y;
        this.team = team;
        this.hp = 1;
        this.maxHp = 1;
        this.armor = 0;
        this.active = true;
        this.dmgTexts = [];
    }
    // tag: 'strong' (counter hit) | 'weak' (resisted) | 'magic' | null
    takeDamage(amt, tag = null) {
        if (this.hp <= 0) return;
        this.hp -= amt;
        const heavy = tag === "strong"; // counter/critical hit — punchier feedback
        this.hurtT = heavy ? HIT_FLINCH_FRAMES * 1.4 : HIT_FLINCH_FRAMES;   // flinch
        this.flashT = heavy ? HIT_FLASH_FRAMES * 1.6 : HIT_FLASH_FRAMES;  // white hit-flash
        if (heavy && typeof game !== "undefined") game.shake = Math.max(game.shake, 3);
        const col =
            tag === "strong" ? "#fbbf24"
            : tag === "weak" ? "#94a3b8"
            : tag === "magic" ? "#c084fc"
            : "#ef4444";
        const sz = tag === "strong" ? 24 : tag === "weak" ? 12 : 15;
        pushDmgText(this.dmgTexts, {
            v: Math.floor(amt),
            x: rand(-12, 12),
            y: -30,
            life: 40,
            c: col,
            s: sz,
        });
        if (this.hp <= 0) this.die();
    }
    heal(amt) {
        if (this.hp <= 0) return;
        const actual = Math.min(this.maxHp - this.hp, amt);
        this.hp += actual;
        pushDmgText(this.dmgTexts, {
            v: "+" + Math.floor(actual),
            x: 0,
            y: -45,
            life: 50,
            c: "#10b981",
            s: 18,
        });
    }
    die() {
        this.active = false;
        this.hp = 0;
    }
    drawHp(ctx, cam, w, offY) {
        if (this.hp >= this.maxHp || this.hp <= 0) return;
        const px = cam.sx(this.x);
        const py = cam.sy(this.y);
        const bw = w * cam.z,
            bh = 5 * cam.z;
        ctx.fillStyle = "rgba(0,0,0,0.8)";
        ctx.fillRect(px - bw / 2, py + offY * cam.z, bw, bh);
        ctx.fillStyle =
            this.team === TEAMS.PLAYER ? "#34d399" : "#ef4444";
        ctx.fillRect(
            px - bw / 2 + 1,
            py + offY * cam.z + 1,
            (bw - 2) * (Math.max(0, this.hp) / this.maxHp),
            bh - 2,
        );
    }
    // Age floating texts (split from drawing so off-screen, culled entities
    // still expire theirs — the removal filter keeps a dead entity alive until
    // its texts are gone).
    ageDmg(dt) {
        for (let i = this.dmgTexts.length - 1; i >= 0; i--) {
            const d = this.dmgTexts[i];
            d.life -= dt;
            d.y -= 0.8 * dt;
            if (d.life <= 0) this.dmgTexts.splice(i, 1);
        }
    }
    drawDmg(ctx, cam, dt) {
        this.ageDmg(dt);
        const n = this.dmgTexts.length;
        // Per-frame budget across all entities (anti-lag): past it, texts keep
        // aging but aren't drawn this frame. strokeText+fillText is costly.
        if (n && PERF.dmgLeft > 0) {
            PERF.dmgLeft -= n;
            const px = cam.sx(this.x);
            const py = cam.sy(this.y);
            // Shared state set once per entity; font only when the size changes.
            ctx.textAlign = "center";
            ctx.strokeStyle = "rgba(0,0,0,0.8)";
            ctx.lineWidth = 4 * cam.z;
            let fs = -1;
            for (let i = n - 1; i >= 0; i--) {
                const d = this.dmgTexts[i];
                ctx.fillStyle = d.c;
                ctx.globalAlpha = Math.min(1, d.life / 15);
                if (d.s !== fs) {
                    fs = d.s;
                    ctx.font = `900 ${fs * cam.z}px system-ui`;
                }
                ctx.strokeText(
                    d.v,
                    px + d.x * cam.z,
                    py + d.y * cam.z,
                );
                ctx.fillText(d.v, px + d.x * cam.z, py + d.y * cam.z);
            }
        }
        ctx.globalAlpha = 1;
    }
}
