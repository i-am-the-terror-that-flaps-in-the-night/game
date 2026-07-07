import { TEAMS } from '../config.js';
import { rand } from '../utils.js';

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
        this.hurtT = 7;   // flinch
        this.flashT = 5;  // white hit-flash
        const col =
            tag === "strong" ? "#fbbf24"
            : tag === "weak" ? "#94a3b8"
            : tag === "magic" ? "#c084fc"
            : "#ef4444";
        const sz = tag === "strong" ? 24 : tag === "weak" ? 12 : 15;
        this.dmgTexts.push({
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
        this.dmgTexts.push({
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
        const p = cam.toScreen(this.x, this.y);
        const bw = w * cam.z,
            bh = 5 * cam.z;
        ctx.fillStyle = "rgba(0,0,0,0.8)";
        ctx.fillRect(p.x - bw / 2, p.y + offY * cam.z, bw, bh);
        ctx.fillStyle =
            this.team === TEAMS.PLAYER ? "#34d399" : "#ef4444";
        ctx.fillRect(
            p.x - bw / 2 + 1,
            p.y + offY * cam.z + 1,
            (bw - 2) * (Math.max(0, this.hp) / this.maxHp),
            bh - 2,
        );
    }
    drawDmg(ctx, cam, dt) {
        const p = cam.toScreen(this.x, this.y);
        for (let i = this.dmgTexts.length - 1; i >= 0; i--) {
            const d = this.dmgTexts[i];
            d.life -= dt;
            d.y -= 0.8 * dt;
            if (d.life <= 0) {
                this.dmgTexts.splice(i, 1);
                continue;
            }
            ctx.fillStyle = d.c;
            ctx.globalAlpha = Math.min(1, d.life / 15);
            ctx.font = `900 ${d.s * cam.z}px system-ui`;
            ctx.textAlign = "center";
            ctx.strokeStyle = "rgba(0,0,0,0.8)";
            ctx.lineWidth = 4 * cam.z;
            ctx.strokeText(
                d.v,
                p.x + d.x * cam.z,
                p.y + d.y * cam.z,
            );
            ctx.fillText(d.v, p.x + d.x * cam.z, p.y + d.y * cam.z);
        }
        ctx.globalAlpha = 1;
    }
}
