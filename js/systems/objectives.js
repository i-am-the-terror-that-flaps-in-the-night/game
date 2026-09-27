import { TEAMS } from '../config.js';
import { groundAt, terrain } from './terrain.js';
import { toRgba } from '../utils.js';

// --- HILLTOP SHRINES (capturable objectives) ---
// Each shrine sits on a crest. Troops standing alone within RADIUS push its
// capture meter (prog: -1 enemy … +1 player); contested ground freezes it.
// A player-held shrine pays out its reward; an enemy-held one turns into a
// dark altar that mends nearby enemies — so both sides want the high ground.

const RADIUS = 120;       // capture zone half-width
const AURA = 320;         // reward/altar reach
const RATE = 0.0045;      // meter per frame per unit present (capped at 3)

export const SHRINE_REWARDS = {
    gold:  { name: "Gold Shrine",   icon: "🪙", col: "#fbbf24", desc: "+3 gold/s" },
    mana:  { name: "Mana Shrine",   icon: "✦", col: "#a78bfa", desc: "+2.4 mana/s" },
    watch: { name: "Watch Shrine",  icon: "👁", col: "#7dd3fc", desc: "+15% range for your ranged troops nearby" },
};

export class ObjectiveSystem {
    constructor(g) {
        this.g = g;
        this.list = [];
    }

    // Rebuild from the loaded terrain (called from reset()).
    reset() {
        this.list = terrain.shrines.map((s) => ({ x: s.x, reward: SHRINE_REWARDS[s.reward] ? s.reward : "gold", prog: 0, owner: 0, pulse: 0 }));
    }

    update(dt) {
        const g = this.g;
        for (const s of this.list) {
            let p = 0, e = 0;
            for (const u of g.units) if (u.active && !u.flying && Math.abs(u.x - s.x) < RADIUS) p++;
            for (const u of g.enemies) if (u.active && !u.flying && !u.isBoss && Math.abs(u.x - s.x) < RADIUS) e++;
            const before = s.owner;
            if (p > 0 && e === 0) s.prog = Math.min(1, s.prog + RATE * Math.min(3, p) * dt);
            else if (e > 0 && p === 0) s.prog = Math.max(-1, s.prog - RATE * Math.min(3, e) * dt);
            if (s.prog >= 1) s.owner = TEAMS.PLAYER;
            else if (s.prog <= -1) s.owner = TEAMS.ENEMY;
            else if ((s.owner === TEAMS.PLAYER && s.prog <= 0) || (s.owner === TEAMS.ENEMY && s.prog >= 0)) s.owner = 0;
            if (s.owner !== before) this._flip(s, before);
            s.pulse = Math.max(0, s.pulse - dt);

            if (s.owner === TEAMS.PLAYER) {
                if (s.reward === "gold") g.addGold((3 * dt) / 60);
                else if (s.reward === "mana") g.spells.mana = Math.min(g.spells.maxMana, g.spells.mana + 0.04 * dt);
            } else if (s.owner === TEAMS.ENEMY) {
                // Dark altar: slow mending for enemies in its reach.
                for (const u of g.enemies)
                    if (u.active && !u.isBoss && u.hp > 0 && u.hp < u.maxHp && Math.abs(u.x - s.x) < AURA)
                        u.hp = Math.min(u.maxHp, u.hp + (1.2 * dt) / 60);
            }
        }
    }

    _flip(s, before) {
        const g = this.g, R = SHRINE_REWARDS[s.reward];
        s.pulse = 40;
        const gy = groundAt(s.x);
        const col = s.owner === TEAMS.PLAYER ? "#60a5fa" : s.owner === TEAMS.ENEMY ? "#ef4444" : "#94a3b8";
        g.fx.ring(s.x, gy - 40, { r0: 10, r1: 110, col, w: 3, life: 26 });
        g.particles.emit(s.x, gy - 70, 18, col, 4, 4, "float");
        if (s.owner === TEAMS.PLAYER) {
            g.notify(`${R.icon} ${R.name} captured! ${R.desc}`);
            g.audio.playTone(660, 0.18, "triangle", 0.08);
            g.audio.playTone(990, 0.3, "triangle", 0.08, 0.15);
        } else if (s.owner === TEAMS.ENEMY) {
            g.notify(`⚠ The enemy seized the ${R.name}. It now heals their troops!`);
            g.audio.playTone(220, 0.4, "sawtooth", 0.1);
        } else if (before === TEAMS.PLAYER) {
            g.notify(`${R.name} lost!`);
        }
    }

    // Range multiplier from a held Watch Shrine (player ranged troops only).
    rangeMult(u) {
        if (!u.ranged || u.team !== TEAMS.PLAYER) return 1;
        for (const s of this.list)
            if (s.owner === TEAMS.PLAYER && s.reward === "watch" && Math.abs(u.x - s.x) < AURA) return 1.15;
        return 1;
    }

    at(x) {
        for (const s of this.list) if (Math.abs(s.x - x) < RADIUS) return s;
        return null;
    }

    owner(x) {
        const s = this.at(x);
        return s ? s.owner : 0;
    }

    // Stone pillar, owner banner and a capture ring (drawn under the armies).
    draw(ctx, cam) {
        const z = cam.z, f = this.g.frames;
        for (const s of this.list) {
            const px = cam.sx(s.x);
            if (px < -120 || px > cam.viewW + 120) continue;
            const R = SHRINE_REWARDS[s.reward];
            const gy = cam.sy(groundAt(s.x));
            const col = s.owner === TEAMS.PLAYER ? "#60a5fa" : s.owner === TEAMS.ENEMY ? "#ef4444" : "#94a3b8";
            ctx.save();
            // Capture zone.
            ctx.globalAlpha = 0.5;
            ctx.strokeStyle = col;
            ctx.lineWidth = 2 * z;
            ctx.setLineDash([6 * z, 6 * z]);
            ctx.beginPath(); ctx.ellipse(px, gy, RADIUS * z, 14 * z, 0, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]);
            // Pillar + cap stone.
            ctx.globalAlpha = 1;
            ctx.fillStyle = "#57534e";
            ctx.fillRect(px - 9 * z, gy - 62 * z, 18 * z, 62 * z);
            ctx.fillStyle = "#44403c";
            ctx.fillRect(px - 14 * z, gy - 8 * z, 28 * z, 8 * z);
            ctx.fillRect(px - 13 * z, gy - 68 * z, 26 * z, 7 * z);
            ctx.strokeStyle = "rgba(0,0,0,0.35)";
            ctx.lineWidth = 1 * z;
            for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(px - 9 * z, gy - i * 16 * z); ctx.lineTo(px + 9 * z, gy - i * 16 * z); ctx.stroke(); }
            // Rune glow when held.
            if (s.owner) {
                ctx.globalCompositeOperation = "screen";
                const a = 0.35 + 0.25 * Math.sin(f * 0.08) + s.pulse / 60;
                const gr = ctx.createRadialGradient(px, gy - 36 * z, 2, px, gy - 36 * z, 60 * z);
                gr.addColorStop(0, toRgba(col, Math.min(1, a)));
                gr.addColorStop(1, "rgba(0,0,0,0)");
                ctx.fillStyle = gr;
                ctx.fillRect(px - 60 * z, gy - 96 * z, 120 * z, 120 * z);
                ctx.globalCompositeOperation = "source-over";
            }
            // Banner pole + flag (waves).
            ctx.strokeStyle = "#292524";
            ctx.lineWidth = 2 * z;
            ctx.beginPath(); ctx.moveTo(px, gy - 68 * z); ctx.lineTo(px, gy - 110 * z); ctx.stroke();
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.moveTo(px, gy - 110 * z);
            for (let i = 0; i <= 4; i++) ctx.lineTo(px + i * 7 * z, gy - (108 - Math.sin(f * 0.12 + i) * 2) * z);
            for (let i = 4; i >= 0; i--) ctx.lineTo(px + i * 7 * z, gy - (94 - Math.sin(f * 0.12 + i) * 2) * z);
            ctx.closePath(); ctx.fill();
            // Capture meter arc.
            if (Math.abs(s.prog) > 0.01 && Math.abs(s.prog) < 1) {
                ctx.strokeStyle = s.prog > 0 ? "#60a5fa" : "#ef4444";
                ctx.lineWidth = 4 * z;
                ctx.beginPath();
                ctx.arc(px, gy - 36 * z, 26 * z, -Math.PI / 2, -Math.PI / 2 + Math.abs(s.prog) * Math.PI * 2);
                ctx.stroke();
            }
            // Reward icon.
            ctx.font = `${16 * z}px system-ui`;
            ctx.textAlign = "center";
            ctx.fillStyle = R.col;
            ctx.fillText(R.icon, px, gy - 118 * z);
            ctx.restore();
        }
    }
}
