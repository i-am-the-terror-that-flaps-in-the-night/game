import { HIT_FLASH_FRAMES, HIT_FLINCH_FRAMES, TEAMS } from '../config.js';
import { Unit } from './unit.js';
import { clamp, ik2, lerp, shade, toRgba } from '../utils.js';
import { GFX } from '../systems/graphics.js';
import { OUTLINE, makeLook } from '../data/looks.js';

// Per-unit torso + head gradients depend only on the unit's skin colour and are
// drawn in a FIXED local coordinate space (the ctx is translated per unit), so
// the same gradient object can be reused across every unit and every frame.
// Building them fresh per unit was 2 createLinearGradient/createRadialGradient
// allocations × up to ~100 units × 60fps — the biggest allocation cost in big
// fights (profiled). Cache them by skin colour and build once. Gradients are
// bound to the single persistent game canvas ctx, so reuse is safe.
const _torsoGradCache = new Map();
const _headGradCache = new Map();
function torsoGrad(ctx, skin) {
    let g = _torsoGradCache.get(skin);
    if (!g) {
        // Fixed reference coords (shoulderY≈-40, hipY≈-18); the tiny per-frame
        // breath bob shifts these <3px — imperceptible on a smooth vertical fade.
        g = ctx.createLinearGradient(0, -40, 0, -18);
        g.addColorStop(0, shade(skin, 0.18));
        g.addColorStop(1, shade(skin, -0.28));
        _torsoGradCache.set(skin, g);
    }
    return g;
}
function headGrad(ctx, skin, headR) {
    let g = _headGradCache.get(skin);
    if (!g) {
        g = ctx.createRadialGradient(-2.5, -2.5, 1, 0, 0, headR);
        g.addColorStop(0, shade(skin, 0.3));
        g.addColorStop(1, shade(skin, -0.18));
        _headGradCache.set(skin, g);
    }
    return g;
}

// Fixed-colour, fixed-local-coordinate gradients (shields, blades, club head,
// horse body) — built once and reused, exactly like the torso/head caches
// above. These were fresh allocations per unit per frame (1-2 per marauder).
const _gradCache = new Map();
function cachedGrad(key, build) {
    let g = _gradCache.get(key);
    if (!g) {
        g = build();
        _gradCache.set(key, g);
    }
    return g;
}
const WHITE_45 = toRgba("#fff", 0.45);
const WHITE_85 = toRgba("#ffffff", 0.85);
const P_FLETCH = "#e2b84a";
const STEEL = "#a3adba", STEEL_D = "#6e7887", STEEL_L = "#d5dbe3";

// --- UNIT RENDERING (stickman drawing, split from Unit class) ---
Object.assign(Unit.prototype, /** @type {ThisType<any>} */ ({
    // Crowd LOD dispatch (anti-lag): when Game.draw flags the frame as crowded
    // (_lodE for enemies, _lodP for the player's troops), common humanoids use
    // the cheap drawLite figure. Catapults, dragons, bosses and the hero
    // (which calls this from Hero.draw) keep full art.
    draw(ctx, cam, dt) {
        const g = window.game;
        if (this.active && g && (this.team === TEAMS.PLAYER ? g._lodP : g._lodE)
            && !this.isHero && !this.boss && this.vis !== "catapult" && this.vis !== "dragon")
            return this.drawLite(ctx, cam, dt);
        return this.drawFull(ctx, cam, dt);
    },

    // Simplified stick figure: one limb path, a torso stroke, a head, a weapon
    // line (+ shield slab) — ~5 draw calls with no gradients, versus ~35 calls
    // and several gradients for the full figure (~5× cheaper to draw, measured).
    // Silhouette, team/type colour, gait, attack swing, hit flash, HP bar and
    // damage numbers are kept. (Batching every figure into a few shared paths
    // was tried and measured slower: big many-subpath strokes rasterize worse
    // than many small ones, and it loses depth order.)
    drawLite(ctx, cam, dt) {
        const px = cam.sx(this.x), py = cam.sy(this.y);
        const s = this.scale * cam.z;
        const walking = this.state === "walk";
        const gp = this.frame * 0.22 * clamp(this.speed / 2, 0.5, 2.2);
        const bob = walking ? -Math.abs(Math.sin(gp)) * 2.4 : 0;
        const hipY = -18 + bob, shY = -40 + bob, headCY = -50 + bob;
        const v = this.vis;
        const horse = v === "horse";
        const L = this._look || (this._look = makeLook(this, this.team === TEAMS.PLAYER));
        const B = L.build;
        const flash = this.flashT > 0;
        const metal = L.body === "plate" || L.body === "chain";
        const bones = L.body === "bones";
        ctx.save();
        ctx.translate(px, py);
        ctx.scale(this.facing * s, s);
        ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.fillRect(-11, -2, 22, 4);
        if (this.flying) ctx.translate(0, -70 + Math.sin(this.frame * 0.1) * 12);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        if (horse) {
            ctx.translate(0, -18);
            const l1 = Math.sin(gp * 1.3) * 6;
            ctx.strokeStyle = "#5b3a1a";
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(-14, 2); ctx.lineTo(-14 + l1, 18);
            ctx.moveTo(13, 2); ctx.lineTo(13 - l1, 18);
            ctx.stroke();
            ctx.fillStyle = "#7a5230";
            ctx.fillRect(-22, -12, 42, 14);
            ctx.fillRect(16, -27, 8, 19);
            ctx.fillStyle = L.cloth;
            ctx.fillRect(-13, -13, 20, 8);
        }
        // Legs + arms as thick clothed strokes (one outline pass, one colour pass).
        const atk = this.atk;
        const hx = 9 + atk * 7, hy = shY + 9 - atk * 6;
        const legW = (bones ? 2.6 : 5.2) * B, armW = (bones ? 2.4 : 4.4) * B;
        const st = horse || this.flying ? 0 : walking ? Math.sin(gp) * 8 : 3.5; // idle: planted stance
        const legs = !horse && !this.flying && L.body !== "robe";
        const limbPath = () => {
            ctx.beginPath();
            if (legs) { ctx.moveTo(st, 0); ctx.lineTo(0, hipY); ctx.lineTo(-st, 0); }
            ctx.moveTo(-6, shY + 15); ctx.lineTo(0, shY + 3); ctx.lineTo(hx, hy);
        };
        ctx.strokeStyle = OUTLINE; ctx.lineWidth = legW + 2;
        limbPath(); ctx.stroke();
        if (legs) {
            ctx.strokeStyle = bones ? "#ddd6c4" : L.pants; ctx.lineWidth = legW;
            ctx.beginPath(); ctx.moveTo(st, 0); ctx.lineTo(0, hipY); ctx.lineTo(-st, 0); ctx.stroke();
        }
        ctx.strokeStyle = bones ? "#ddd6c4" : metal ? STEEL : L.body === "bare" ? L.skin : L.cloth;
        ctx.lineWidth = armW;
        ctx.beginPath(); ctx.moveTo(-6, shY + 15); ctx.lineTo(0, shY + 3); ctx.lineTo(hx, hy); ctx.stroke();
        // Torso block (robe falls to the feet).
        const tw = 6 * B, bottom = L.body === "robe" ? -1 : hipY + 2;
        ctx.fillStyle = flash ? "#ffffff" : bones ? "#ddd6c4" : L.tabard ? L.tabardCol
            : metal ? STEEL : L.body === "bare" ? L.skin : L.body === "leather" ? "#6e4b2c" : L.cloth;
        ctx.beginPath();
        if (bones) ctx.rect(-1.5, shY, 3, hipY - shY);
        else { ctx.moveTo(-tw, shY + 1); ctx.lineTo(tw, shY + 1); ctx.lineTo(tw * 0.85, bottom); ctx.lineTo(-tw * 0.85, bottom); ctx.closePath(); }
        ctx.fill();
        ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.4; ctx.stroke();
        // Head: skin (or skull) + one headgear blob in its main colour.
        ctx.fillStyle = flash ? "#ffffff" : L.head === "skull" ? "#e7e1cf" : L.skin;
        ctx.beginPath(); ctx.arc(0, headCY, 7.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        const hatCol = { cap: L.cloth, kettle: STEEL, helm: STEEL, greathelm: STEEL, barbute: STEEL,
            hood: L.hood || L.cloth, cowl: L.hood || L.cloth, wizard: L.cloth, horned: "#5a3e24", antlers: "#7c5a32" }[L.head]
            || (L.head === "bare" && L.hair ? L.hair : null);
        if (hatCol && !flash) {
            ctx.fillStyle = hatCol;
            ctx.beginPath(); ctx.arc(0, headCY - 0.6, 8.2, Math.PI, 0); ctx.closePath(); ctx.fill();
            if (L.head === "wizard") { ctx.beginPath(); ctx.moveTo(-6, headCY - 7); ctx.lineTo(-5, headCY - 20); ctx.lineTo(6, headCY - 7); ctx.closePath(); ctx.fill(); }
        }
        ctx.fillStyle = L.glowEyes || "#0b1020";
        ctx.beginPath(); ctx.arc(4.4, headCY - 1, 1.2, 0, Math.PI * 2); ctx.fill();
        // Weapon.
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        let tipX = 0, tipY = 0;
        if (v === "bow" || v === "crossbow") ctx.arc(hx - 4, hy, 10, -1.2, 1.2);
        else if (v === "staff" || v === "mage") { ctx.moveTo(hx, hy + 12); ctx.lineTo(hx, hy - 22); }
        else {
            const a = -0.9 + Math.sin(atk * Math.PI) * 1.4;
            const Lw = v === "spear" || horse ? 34 : v === "club" ? 18 : 20;
            tipX = hx + Math.cos(a) * Lw;
            tipY = hy + Math.sin(a) * Lw;
            ctx.moveTo(hx, hy); ctx.lineTo(tipX, tipY);
        }
        ctx.stroke();
        // Shields carry the team colour; the ogre's club head.
        if (v === "sword_shield" || L.shield) {
            ctx.fillStyle = "#7d8b9c";
            ctx.beginPath(); ctx.arc(8, shY + 9, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = L.cloth;
            ctx.beginPath(); ctx.arc(8, shY + 9, 5, 0, Math.PI * 2); ctx.fill();
        } else if (v === "tower_shield") {
            ctx.fillStyle = "#7d8b9c";
            ctx.fillRect(5, shY - 11, 9, 40); ctx.strokeRect(5, shY - 11, 9, 40);
            ctx.fillStyle = L.cloth; ctx.fillRect(8, shY - 2, 3.5, 20);
        } else if (v === "club") {
            ctx.fillStyle = "#7a5230";
            ctx.beginPath(); ctx.arc(tipX, tipY, 7, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        this.drawHp(ctx, cam, 35 * this.scale, -75 * this.scale);
        this._drawBadges(ctx, cam);
        this.drawDmg(ctx, cam, dt);
    },

    // Promotion stars (player) and the horde-merge count (enemy, anti-lag).
    _drawBadges(ctx, cam) {
        if (!this.active) return;
        const star = this.team === TEAMS.PLAYER && this.level > 1;
        const merged = (this.merged || 1) > 1;
        if (!star && !merged) return;
        const plx = cam.sx(this.x), ply = cam.sy(this.y);
        ctx.save();
        ctx.textAlign = 'center';
        if (star) {
            ctx.fillStyle = '#fbbf24';
            if (GFX.shadows) { ctx.shadowBlur = 8; ctx.shadowColor = '#fbbf24'; }
            ctx.font = `bold ${10 * cam.z}px system-ui`;
            ctx.fillText('★'.repeat(this.level - 1), plx, ply - (82 * this.scale + 2) * cam.z);
            ctx.shadowBlur = 0;
        }
        if (merged) {
            ctx.fillStyle = '#fca5a5';
            ctx.font = `900 ${11 * cam.z}px system-ui`;
            ctx.fillText('×' + this.merged, plx, ply - (80 * this.scale + 2) * cam.z);
        }
        ctx.restore();
    },

    // Body between shoulders and hips, drawn in the unit's local frame (facing
    // +x). Width scales with build; height never changes (anchors stay put).
    _drawTorso(ctx, L, shoulderY, hipY, B, team, lowQ) {
        const tw = 6.4 * B, hw = 4.8 * B;          // half-widths: shoulders, hips
        const midY = (shoulderY + hipY) / 2;
        const robe = L.body === "robe";
        const bottom = robe ? -1 : hipY + 2;       // robes fall to the ankles
        const hemW = robe ? 8.5 * B : hw;
        ctx.lineJoin = "round";

        if (L.body === "bones") {
            // Spine, pelvis and ribs — skeletons stay bony on purpose.
            ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4.4;
            ctx.beginPath(); ctx.moveTo(0, shoulderY); ctx.lineTo(0, hipY); ctx.stroke();
            ctx.strokeStyle = "#ddd6c4"; ctx.lineWidth = 2.4;
            ctx.beginPath(); ctx.moveTo(0, shoulderY); ctx.lineTo(0, hipY); ctx.stroke();
            ctx.lineWidth = 1.6;
            for (let i = 0; i < 4; i++) {
                const y = shoulderY + 3 + i * 4, r = 5.4 - i * 0.7;
                ctx.beginPath(); ctx.moveTo(-r, y + 1.5); ctx.quadraticCurveTo(0, y - 1.5, r, y + 1.5); ctx.stroke();
            }
            ctx.beginPath(); ctx.ellipse(0, hipY, 4.2, 2.2, 0, 0, Math.PI * 2); ctx.stroke();
            return;
        }

        const base = L.body === "plate" ? STEEL
            : L.body === "chain" ? "#8d96a2"
            : L.body === "leather" ? "#6e4b2c"
            : L.body === "bare" ? L.skin
            : L.cloth;
        // Silhouette
        ctx.beginPath();
        ctx.moveTo(-tw, shoulderY + 1);
        ctx.quadraticCurveTo(-tw - 0.6, midY, -hw, hipY);
        ctx.lineTo(-hemW, bottom);
        if (L.body === "rags") {
            // ragged hem
            const n = 5;
            for (let i = 1; i <= n; i++) ctx.lineTo(-hemW + (2 * hemW * i) / n, bottom + (i % 2 ? 3 : 0));
        } else ctx.lineTo(hemW, bottom);
        ctx.lineTo(hw, hipY);
        ctx.quadraticCurveTo(tw + 0.6, midY, tw, shoulderY + 1);
        ctx.quadraticCurveTo(0, shoulderY - 2.5, -tw, shoulderY + 1);
        ctx.closePath();
        ctx.fillStyle = base;
        ctx.fill();
        ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.5;
        ctx.stroke();

        if (!lowQ) {
            // Detail pass by body type (cheap strokes, no gradients).
            ctx.save();
            ctx.clip();
            if (L.body === "plate") {
                ctx.fillStyle = STEEL_L;           // breastplate highlight
                ctx.beginPath(); ctx.ellipse(2.4 * B, midY - 3, 2.2 * B, 6, 0.2, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = STEEL_D; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(-tw, hipY - 4); ctx.lineTo(tw, hipY - 4); ctx.stroke();
            } else if (L.body === "chain") {
                ctx.strokeStyle = "#6b7380"; ctx.lineWidth = 0.8;
                for (let y = shoulderY + 3; y < hipY; y += 2.6) { ctx.beginPath(); ctx.moveTo(-tw, y); ctx.lineTo(tw, y); ctx.stroke(); }
            } else if (L.body === "gambeson") {
                ctx.strokeStyle = shade(L.cloth, -0.25); ctx.lineWidth = 0.9;
                for (let x = -tw + 2.5; x < tw; x += 2.8) { ctx.beginPath(); ctx.moveTo(x, shoulderY); ctx.lineTo(x * 0.8, hipY); ctx.stroke(); }
            } else if (L.body === "leather") {
                // cloth shirt showing at the collar + a sash/strap in team colour
                ctx.strokeStyle = L.sash || L.cloth; ctx.lineWidth = 2.4;
                ctx.beginPath(); ctx.moveTo(-tw, shoulderY + 1); ctx.lineTo(tw * 0.8, hipY - 1); ctx.stroke();
            } else if (L.body === "bare") {
                ctx.strokeStyle = shade(L.skin, -0.22); ctx.lineWidth = 0.9;   // pecs/abs hint
                ctx.beginPath(); ctx.moveTo(-1, shoulderY + 6); ctx.quadraticCurveTo(2.5, shoulderY + 8, 5 * B, shoulderY + 5); ctx.stroke();
                if (L.paint) {
                    ctx.strokeStyle = L.paint; ctx.lineWidth = 1.6;
                    for (const y of [shoulderY + 10, shoulderY + 14]) { ctx.beginPath(); ctx.moveTo(-tw, y); ctx.lineTo(tw, y - 2); ctx.stroke(); }
                }
                if (L.beads) {
                    ctx.fillStyle = "#f5f5f4";
                    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(i * 1.8 + 1, shoulderY + 4 + Math.abs(i) * -0.6 + 2, 0.9, 0, Math.PI * 2); ctx.fill(); }
                }
            } else if (L.body === "robe") {
                ctx.strokeStyle = shade(L.cloth, -0.3); ctx.lineWidth = 1;     // fold lines
                for (const x of [-3, 1.5]) { ctx.beginPath(); ctx.moveTo(x, hipY); ctx.lineTo(x * 1.6, bottom); ctx.stroke(); }
            }
            ctx.restore();
        }

        // Tabard over armour: the clearest team cue on heavy troops.
        if (L.tabard) {
            const tY0 = shoulderY + 3, tY1 = hipY + 7, w = 3.6 * B;
            ctx.fillStyle = L.tabardCol;
            ctx.beginPath(); ctx.rect(-w, tY0, 2 * w, tY1 - tY0); ctx.fill();
            ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.1; ctx.stroke();
            if (L.stripes) {
                ctx.fillStyle = L.stripes;
                for (let y = tY0 + 2; y < tY1; y += 5) ctx.fillRect(-w, y, 2 * w, 2);
            } else if (team) {
                // gold cross (or blue on a white paladin tabard)
                ctx.strokeStyle = L.tabardCol === L.cloth ? L.trim : L.cloth; ctx.lineWidth = 1.6;
                const cy = tY0 + (tY1 - tY0) * 0.38;
                ctx.beginPath(); ctx.moveTo(0, tY0 + 2); ctx.lineTo(0, tY1 - 3); ctx.moveTo(-w + 1, cy); ctx.lineTo(w - 1, cy); ctx.stroke();
            }
        }
        // Robe trim / tunic hem in the team's trim colour.
        if (L.body === "robe" || L.body === "tunic") {
            ctx.strokeStyle = L.trim; ctx.lineWidth = 1.3;
            ctx.beginPath(); ctx.moveTo(-hemW + 0.8, bottom - 1); ctx.lineTo(hemW - 0.8, bottom - 1); ctx.stroke();
            if (L.body === "robe") { ctx.beginPath(); ctx.moveTo(3, shoulderY + 2); ctx.lineTo(3.5, bottom - 1); ctx.stroke(); }
        }
        // Belt (or fur loincloth for the wild ones)
        if (L.body !== "robe") {
            if (L.fur || L.body === "bare") {
                ctx.fillStyle = L.fur ? "#6b4a2a" : L.pants;
                ctx.beginPath(); ctx.moveTo(-hw - 0.5, hipY - 2); ctx.lineTo(hw + 0.5, hipY - 2); ctx.lineTo(hw, hipY + 5); ctx.lineTo(0, hipY + 7); ctx.lineTo(-hw, hipY + 5); ctx.closePath(); ctx.fill();
                ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
            } else {
                ctx.strokeStyle = "#3a2616"; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(-hw - 0.3, hipY - 2); ctx.lineTo(hw + 0.3, hipY - 2); ctx.stroke();
                ctx.fillStyle = team ? L.trim : "#9ca3af";
                ctx.fillRect(1.2, hipY - 3.2, 2.2, 2.4);
            }
        }
    },

    // Head in a frame translated to the head centre (facing +x).
    _drawHead(ctx, L, r, hurt, team) {
        const T = Math.PI * 2;
        ctx.lineJoin = "round";
        // Long hair falls behind the head.
        if (L.hair && L.longHair) {
            ctx.fillStyle = L.hair;
            ctx.beginPath(); ctx.moveTo(-r, -2); ctx.quadraticCurveTo(-r - 4, 10, -r + 1, 15); ctx.lineTo(0, 6); ctx.closePath(); ctx.fill();
        }
        // Skull / face
        const skull = L.head === "skull";
        ctx.fillStyle = skull ? "#e7e1cf" : L.skin;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, T); ctx.fill();
        ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.5; ctx.stroke();

        if (skull) {
            ctx.fillStyle = "#1c1917";
            ctx.beginPath(); ctx.arc(3.6, -1.5, 2.2, 0, T); ctx.fill();
            ctx.beginPath(); ctx.arc(-1.2, -1.5, 1.8, 0, T); ctx.fill();
            ctx.fillRect(1.5, 4.2, 5, 1.2);
            ctx.strokeStyle = "#e7e1cf"; ctx.lineWidth = 0.8;
            for (const x of [2.5, 4, 5.5]) { ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, 5.6); ctx.stroke(); }
            return;
        }

        // Hair (shown unless fully helmeted)
        const showsHair = L.hair && !["greathelm", "barbute", "hood", "cowl", "wizard"].includes(L.head);
        if (showsHair) {
            ctx.fillStyle = L.hair;
            ctx.beginPath();
            ctx.arc(0, -0.6, r + 0.6, Math.PI * 0.62, Math.PI * 1.96);
            ctx.quadraticCurveTo(2, -r * 0.45, -r * 0.7, 2);
            ctx.closePath(); ctx.fill();
            if (L.messy) {
                for (const a of [3.6, 4.1, 4.6, 5.1]) {
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(a) * (r - 1), Math.sin(a) * (r - 1));
                    ctx.lineTo(Math.cos(a + 0.15) * (r + 3.5), Math.sin(a + 0.15) * (r + 3.5));
                    ctx.lineTo(Math.cos(a + 0.3) * (r - 1), Math.sin(a + 0.3) * (r - 1));
                    ctx.fill();
                }
            }
        }
        // War paint across the eyes
        if (L.paint) {
            ctx.fillStyle = L.paint;
            ctx.fillRect(1, -2.8, r - 0.5, 2.6);
        }
        // Face: eye, brow, nose, mouth
        const glow = L.glowEyes;
        if (glow) {
            ctx.save();
            ctx.globalCompositeOperation = "screen";
            ctx.fillStyle = glow;
            ctx.beginPath(); ctx.arc(4.4, -1, 1.8, 0, T); ctx.fill();
            ctx.restore();
        } else {
            ctx.fillStyle = "#ffffff";
            ctx.beginPath(); ctx.arc(4, -1.2, 2.1, 0, T); ctx.fill();
            ctx.fillStyle = "#0b1020";
            ctx.beginPath(); ctx.arc(4.7, -1.2 + hurt * 0.5, 1.1, 0, T); ctx.fill();
            ctx.strokeStyle = L.hair || shade(L.skin, -0.4); ctx.lineWidth = 1.1;   // brow
            ctx.beginPath(); ctx.moveTo(2, -4.2 + hurt); ctx.lineTo(6.2, -3.8); ctx.stroke();
        }
        ctx.strokeStyle = shade(L.skin, -0.35); ctx.lineWidth = 1;                  // nose
        ctx.beginPath(); ctx.moveTo(r - 0.6, -0.5); ctx.lineTo(r + 1.3, 1.6); ctx.lineTo(r - 0.4, 2); ctx.stroke();
        if (hurt > 0.3) {
            ctx.strokeStyle = "#0b1020"; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(4, 4.5, 1.6, Math.PI + 0.3, -0.3); ctx.stroke();
        } else {
            ctx.beginPath(); ctx.moveTo(3, 4.6); ctx.lineTo(5.6, 4.3); ctx.stroke();
        }
        if (L.tusks) {
            ctx.fillStyle = "#f5f0e1";
            for (const x of [3, 6]) { ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x + 0.8, 0.6); ctx.lineTo(x + 1.6, 4); ctx.closePath(); ctx.fill(); }
        }
        if (L.hasBeard) {
            ctx.fillStyle = L.beardCol;
            ctx.beginPath();
            ctx.moveTo(-1, 2.5); ctx.quadraticCurveTo(2, 4, r - 0.2, 2.6);
            ctx.quadraticCurveTo(r - 1, r + 2, 3, r + 3.2);
            ctx.quadraticCurveTo(-1, r + 1, -1, 2.5);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.9; ctx.stroke();
        }

        // ── Headgear ──
        ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.3;
        const dome = (col, extra = 0.8) => {
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.arc(0, -0.6, r + extra, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
        };
        switch (L.head) {
            case "cap": {
                dome(team ? L.cloth : shade(L.cloth, -0.1), 0.5);
                ctx.fillStyle = L.trim; ctx.fillRect(-r - 0.5, -2.2, 2 * r + 1, 1.6);
                break;
            }
            case "kettle": {
                dome(STEEL);
                ctx.fillStyle = STEEL_D;                          // wide brim
                ctx.beginPath(); ctx.ellipse(0, -1, r + 4.5, 1.8, 0, 0, T); ctx.fill(); ctx.stroke();
                break;
            }
            case "helm": {
                dome(STEEL);
                ctx.fillStyle = STEEL_D; ctx.fillRect(r - 2.4, -1.5, 2, 5.5);    // nasal
                ctx.fillStyle = team ? L.trim : "#7f1d1d"; ctx.fillRect(-r - 0.6, -2.4, 2 * r + 1.2, 1.4);
                break;
            }
            case "greathelm": {
                ctx.fillStyle = STEEL;
                ctx.beginPath(); ctx.rect(-r - 1, -r - 1.5, 2 * r + 2, 2 * r + 3); ctx.fill(); ctx.stroke();
                ctx.fillStyle = "#1f2328"; ctx.fillRect(0.5, -2.2, r + 0.5, 1.8);   // eye slit
                ctx.fillStyle = STEEL_L; ctx.fillRect(-r + 0.5, -r, 2, 2 * r - 1);
                if (L.plume) {
                    ctx.fillStyle = team ? L.cloth : "#b91c1c";
                    ctx.beginPath(); ctx.moveTo(-2, -r - 1.5); ctx.quadraticCurveTo(-6, -r - 9, -12, -r - 4); ctx.quadraticCurveTo(-6, -r - 4, -2, -r - 1.5); ctx.fill(); ctx.stroke();
                }
                break;
            }
            case "barbute": {
                ctx.fillStyle = STEEL;
                ctx.beginPath(); ctx.arc(0, -0.5, r + 1, 0, T); ctx.fill(); ctx.stroke();
                ctx.fillStyle = "#1f2328";
                ctx.fillRect(1, -2.4, r, 1.8); ctx.fillRect(4, -2.4, 1.8, 7);      // T-slit
                break;
            }
            case "hood":
            case "cowl": {
                const hc = L.hood || L.cloth;
                ctx.fillStyle = hc;
                ctx.beginPath();
                ctx.moveTo(r * 0.9, -r * 0.55);
                ctx.quadraticCurveTo(0, -r - 4, -r - 1.5, -1);
                ctx.quadraticCurveTo(-r - 2, r * 0.9, -2, r + 2);
                ctx.lineTo(-1, 2);
                ctx.quadraticCurveTo(-1, -r * 0.5, r * 0.9, -r * 0.55);
                ctx.closePath(); ctx.fill(); ctx.stroke();
                if (L.head === "cowl") {                          // shadowed face
                    ctx.fillStyle = "rgba(10,8,14,0.45)";
                    ctx.beginPath(); ctx.arc(1.5, 0.5, r - 1.2, -1.4, 1.6); ctx.fill();
                }
                if (L.trimCol) { ctx.strokeStyle = L.trimCol; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(r * 0.9, -r * 0.55); ctx.quadraticCurveTo(-1, -r * 0.5, -1, 2); ctx.stroke(); }
                break;
            }
            case "wizard": {
                ctx.fillStyle = L.cloth;
                ctx.beginPath(); ctx.ellipse(0, -r + 2, r + 4.5, 2.2, 0, 0, T); ctx.fill(); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(-r + 0.5, -r + 1.5); ctx.quadraticCurveTo(-2, -r - 13, -7, -r - 13); ctx.quadraticCurveTo(2, -r - 9, r - 0.5, -r + 1.5); ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.strokeStyle = L.trim; ctx.lineWidth = 1.6;
                ctx.beginPath(); ctx.moveTo(-r + 1.2, -r - 0.2); ctx.lineTo(r - 1.2, -r - 0.2); ctx.stroke();
                break;
            }
            case "horned": {
                dome("#5a3e24");
                ctx.fillStyle = "#e7dcc4";
                for (const sx of [-1, 1]) {
                    ctx.beginPath();
                    ctx.moveTo(sx * (r - 2), -r + 2);
                    ctx.quadraticCurveTo(sx * (r + 5), -r - 1, sx * (r + 4), -r - 8);
                    ctx.quadraticCurveTo(sx * (r + 1), -r - 2, sx * (r - 5), -r + 1);
                    ctx.closePath(); ctx.fill(); ctx.stroke();
                }
                break;
            }
            case "antlers": {
                ctx.fillStyle = "#7c5a32"; ctx.fillRect(-r, -3.5, 2 * r, 2.2);
                ctx.strokeStyle = "#d6c7a6"; ctx.lineWidth = 1.6;
                for (const sx of [-1, 1]) {
                    ctx.beginPath(); ctx.moveTo(sx * 3, -r + 1); ctx.lineTo(sx * 6, -r - 9); ctx.moveTo(sx * 5, -r - 5); ctx.lineTo(sx * 9, -r - 7); ctx.stroke();
                }
                ctx.fillStyle = "#b91c1c";                       // feather
                ctx.beginPath(); ctx.ellipse(-r, -2, 1.6, 4, -0.5, 0, T); ctx.fill();
                break;
            }
            default: break;   // bare
        }
    },

    drawFull(ctx, cam, dt) {
        if (!this.active) {
            this.drawDmg(ctx, cam, dt);
            return;
        }
        const px = cam.sx(this.x), py = cam.sy(this.y);
        const s = this.scale * cam.z;
        const f = this.facing;
        const lowQ = GFX.flatScenery;

        // ── Animation drivers ──
        const walking = this.state === "walk";
        const spd = clamp(this.speed / 2, 0.5, 2.2);
        const gp = this.frame * 0.22 * spd;        // gait phase
        const breath = Math.sin(this.frame * 0.09) * 1.3;
        const hurt = this.hurtT > 0 ? clamp(this.hurtT / HIT_FLINCH_FRAMES, 0, 1) : 0;
        const flash = this.flashT > 0 ? clamp(this.flashT / HIT_FLASH_FRAMES, 0, 1) : 0;
        const sw = this.atk;                       // 1 (just fired) -> 0
        const windup = clamp((sw - 0.72) / 0.28, 0, 1);
        const strike = clamp((0.72 - sw) / 0.72, 0, 1);
        const swing = this.atkKind === 1 ? strike - windup : 0; // -1..+1

        const bob = walking ? -Math.abs(Math.sin(gp)) * 2.4 : breath * 0.6;
        const hipY = -18 + bob;
        const shoulderY = -40 + bob;
        const headCY = -50 + bob;
        const headR = 8;
        const idleSway = (!walking && sw <= 0) ? Math.sin(this.frame * 0.045) * 0.028 : 0;
        let lean = (walking ? Math.sin(gp) * 0.04 : 0) + swing * 0.15 - hurt * 0.13 + idleSway;

        // ── Palette ──
        const team = this.team === TEAMS.PLAYER;
        const skin = this.col;
        const fPh = gp, bPh = gp + Math.PI;
        // Character look (clothing, armour, headgear, skin) — rolled once.
        const L = this._look || (this._look = makeLook(this, team));
        const B = L.build;
        const bones = L.body === "bones";
        const BONE = "#ddd6c4";

        ctx.save();
        ctx.translate(px, py);
        if (this.recoil) ctx.translate(this.recoil * 0.6 * cam.z, 0);
        ctx.scale(f * s, s);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        const bone = (x1, y1, x2, y2, w, col) => {
            ctx.strokeStyle = col;
            ctx.lineWidth = w;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        };

        // ── Filled-figure helpers (outlined, clothed limbs) ──
        const metalBody = L.body === "plate" || L.body === "chain";
        // Polyline outline then coloured runs, so a limb is 3 strokes total.
        const run = (pts, w, col) => {
            ctx.strokeStyle = col;
            ctx.lineWidth = w;
            ctx.beginPath();
            ctx.moveTo(pts[0], pts[1]);
            for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
            ctx.stroke();
        };
        const legF = (tx, ty, back, bootsOnly) => {
            const j = ik2(0, hipY, tx, ty, 11, 12, -1);
            const kx = lerp(j.x, j.ex, 0.5), ky = lerp(j.y, j.ey, 0.5);
            const w = (bones ? 2.6 : 5.6) * B;
            const pc = bones ? BONE : back ? shade(L.pants, -0.25) : L.pants;
            const bc = bones ? BONE : back ? shade(L.boots, -0.2) : L.boots;
            if (bootsOnly) {
                run([kx, ky, j.ex, j.ey, j.ex + 5, j.ey], w + 2.2, OUTLINE);
                run([kx, ky, j.ex, j.ey, j.ex + 5, j.ey], w, bc);
                return;
            }
            run([0, hipY, j.x, j.y, j.ex, j.ey, j.ex + 5, j.ey], w + 2.2, OUTLINE);
            run([0, hipY, j.x, j.y, kx, ky], w, pc);
            run([kx, ky, j.ex, j.ey, j.ex + 5, j.ey], w * 0.95, bc);
        };
        // Sleeve colour by body type; forearm is skin, sleeve or gauntlet.
        const sleeveCol = metalBody ? STEEL : bones ? BONE : L.body === "bare" ? L.skin
            : L.body === "leather" ? "#6e4b2c" : L.cloth;
        const foreCol = metalBody ? STEEL : bones ? BONE
            : (L.body === "robe" || L.body === "gambeson") ? L.cloth : L.skin;
        const armF = (tx, ty, back) => {
            const j = ik2(0, shoulderY + 3, tx, ty, 9, 10, back ? 1 : -1);
            const w = (bones ? 2.4 : 4.8) * B;
            const dk = (c) => (back ? shade(c, -0.25) : c);
            run([0, shoulderY + 3, j.x, j.y, j.ex, j.ey], w + 2.2, OUTLINE);
            run([0, shoulderY + 3, j.x, j.y], w, dk(sleeveCol));
            run([j.x, j.y, j.ex, j.ey], w * 0.9, dk(foreCol));
            ctx.fillStyle = OUTLINE;
            ctx.beginPath(); ctx.arc(j.ex, j.ey, 2.9 * B, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = dk(metalBody ? STEEL_D : bones ? BONE : L.skin);
            ctx.beginPath(); ctx.arc(j.ex, j.ey, 2.0 * B, 0, Math.PI * 2); ctx.fill();
            return j;
        };

        // ── Ground shadow: directional, cast by the sun (all tiers) ──
        // Offsets and stretches away from the sun. The shadow lives inside the
        // `scale(f*s, s)` frame, so the x-offset is divided by facing `f` — that
        // makes it point in a FIXED WORLD direction and NOT mirror when the unit
        // turns around. Length is clamped (no 1/tan blow-up at dawn/dusk) and the
        // shadow fades through dusk into night. `air` keeps the airborne cue.
        const air = this.flying ? 0.55 : 1;
        const _g = window.game;
        const dP = _g ? Math.sin(_g.dayT) : 0.8;     // sun elevation proxy
        const sunAz = _g ? Math.cos(_g.dayT) : 0.3;  // sun horizontal position
        const elev = Math.max(0.3, Math.abs(dP));    // clamp → no cotangent blow-up
        const len = Math.min(2.6, 0.8 / elev);       // length factor, capped
        const dayLight = Math.max(0, Math.min(1, (dP + 0.1) / 0.4)); // 0 night → 1 day
        const tipX = (-sunAz * len * 14 * air) / (f || 1);  // /f → world-fixed direction
        ctx.fillStyle = `rgba(0,0,0,${0.42 * air * (0.22 + 0.78 * dayLight)})`;
        ctx.beginPath();
        // Ellipse spans feet→tip: centred halfway, long axis grows with length.
        ctx.ellipse(tipX * 0.5, 0, 11 * air + Math.abs(tipX) * 0.55, 4.5 * air, 0, 0, Math.PI * 2);
        ctx.fill();

        // ── Boss aura ──
        if (this.boss && this.vis !== "dragon") {
            ctx.globalCompositeOperation = "screen";
            ctx.fillStyle = `rgba(239,68,68,${0.1 + Math.sin(this.frame * 0.1) * 0.1})`;
            ctx.beginPath();
            ctx.arc(0, -40, 50, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalCompositeOperation = "source-over";
        }

        if (this.flying) ctx.translate(0, -70 + Math.sin(this.frame * 0.1) * 12);
        else if (this.vis === "horse") ctx.translate(0, -18);

        const isHorse = this.vis === "horse";
        const shielded = this.vis === "sword_shield" || this.vis === "tower_shield" || !!L.shield;
        const meleeBlade = ["sword", "sword_shield", "tower_shield", "spear", "club", "dual"].includes(this.vis);
        const isCatapult = this.vis === "catapult";
        const isDragon = this.vis === "dragon";

        // ── Catapult siege engine ──
        if (isCatapult) {
            const judder = sw > 0 ? Math.sin(this.frame * 2.4) * 0.15 * sw : 0; // rapid-fire shake
            const arm = lerp(-2.3, -0.5, sw) + judder; // throws forward on fire, resets to loaded
            bone(-18, -5, 16, -5, 5, "#5b3a1a"); // base beam
            for (const wx of [-12, 10]) {
                ctx.fillStyle = "#3a2410"; ctx.strokeStyle = "#1f1408"; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(wx, -2, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.strokeStyle = "#6b4423"; ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(wx - 4, -2); ctx.lineTo(wx + 4, -2);
                ctx.moveTo(wx, -6); ctx.lineTo(wx, 2); ctx.stroke();
            }
            bone(-6, -5, 0, -26, 4, "#6b4423"); // A-frame
            bone(8, -5, 0, -26, 4, "#6b4423");
            ctx.save();
            ctx.translate(0, -24);
            ctx.rotate(arm);
            bone(0, 0, 30, 0, 3.5, "#8a5a2b"); // throwing arm
            ctx.fillStyle = "#5b3a1a";
            ctx.beginPath(); ctx.arc(30, 0, 4.5, 0, Math.PI * 2); ctx.fill();
            if (sw < 0.3) { // payload loaded
                ctx.fillStyle = "#475569";
                ctx.beginPath(); ctx.arc(30, -4, 3.5, 0, Math.PI * 2); ctx.fill();
            }
            if (sw > 0.15) { // strobing muzzle flash while the barrage fires
                ctx.save();
                ctx.globalCompositeOperation = "screen";
                const flicker = Math.floor(this.frame) % 2 === 0 ? 1 : 0.4;
                const mg = ctx.createRadialGradient(30, 0, 0, 30, 0, 10);
                mg.addColorStop(0, toRgba("#fef3c7", 0.9 * flicker * sw));
                mg.addColorStop(1, toRgba("#f59e0b", 0));
                ctx.fillStyle = mg;
                ctx.beginPath(); ctx.arc(30, 0, 10, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
            }
            ctx.restore();
            ctx.fillStyle = skin; // team pennant
            ctx.beginPath();
            ctx.moveTo(0, -26); ctx.lineTo(0, -33); ctx.lineTo(8, -31); ctx.lineTo(0, -29);
            ctx.closePath(); ctx.fill();
            ctx.restore();
            this.drawHp(ctx, cam, 40 * this.scale, -52 * this.scale);
            this.drawDmg(ctx, cam, dt);
            return;
        }

        // ── Dragon (flying boss) ──
        if (isDragon) {
            const flap = Math.sin(this.frame * 0.18) * 0.5;
            ctx.lineCap = "round";
            // Tail
            ctx.strokeStyle = shade(skin, -0.18); ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.moveTo(-14, -38);
            ctx.quadraticCurveTo(-34, -34, -42, -47);
            ctx.stroke();
            ctx.fillStyle = "#fde68a"; // tail barb
            ctx.beginPath();
            ctx.moveTo(-42, -47); ctx.lineTo(-48, -50); ctx.lineTo(-44, -43); ctx.closePath(); ctx.fill();
            // Wings (behind)
            ctx.fillStyle = toRgba(shade(skin, -0.28), 0.92);
            ctx.strokeStyle = toRgba("#0b1020", 0.5); ctx.lineWidth = 1;
            for (const dir of [1, -1]) {
                ctx.save();
                ctx.translate(-4, -45);
                ctx.rotate(dir * (1.0 + flap));
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.quadraticCurveTo(22, -22, 42, -9);
                ctx.lineTo(35, -2); ctx.lineTo(42, 4); ctx.lineTo(31, 6);
                ctx.lineTo(35, 13); ctx.lineTo(20, 8);
                ctx.quadraticCurveTo(10, 6, 0, 0);
                ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.restore();
            }
            // Body
            const dbg = ctx.createLinearGradient(0, -54, 0, -28);
            dbg.addColorStop(0, shade(skin, 0.22));
            dbg.addColorStop(1, shade(skin, -0.28));
            ctx.fillStyle = dbg;
            ctx.beginPath(); ctx.ellipse(-2, -40, 19, 12, -0.2, 0, Math.PI * 2); ctx.fill();
            // Legs
            ctx.strokeStyle = shade(skin, -0.2); ctx.lineWidth = 4;
            bone(3, -30, 7, -19, 4, shade(skin, -0.2));
            bone(-9, -30, -7, -21, 4, shade(skin, -0.2));
            // Neck + head
            ctx.fillStyle = shade(skin, 0.05);
            ctx.beginPath();
            ctx.moveTo(10, -46);
            ctx.quadraticCurveTo(24, -52, 30, -58);
            ctx.lineTo(38, -56);
            ctx.quadraticCurveTo(40, -50, 30, -47);
            ctx.quadraticCurveTo(20, -43, 12, -39);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = shade(skin, 0.12);
            ctx.beginPath(); ctx.ellipse(34, -56, 7, 5, -0.3, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); // snout
            ctx.moveTo(39, -57); ctx.lineTo(45, -55); ctx.lineTo(39, -53); ctx.closePath(); ctx.fill();
            ctx.strokeStyle = "#fde68a"; ctx.lineWidth = 2; // horns
            ctx.beginPath(); ctx.moveTo(32, -61); ctx.lineTo(29, -68); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(36, -61); ctx.lineTo(35, -67); ctx.stroke();
            ctx.globalCompositeOperation = "screen"; // eye glow
            ctx.fillStyle = "#fbbf24";
            ctx.beginPath(); ctx.arc(35, -57, 1.7, 0, Math.PI * 2); ctx.fill();
            ctx.globalCompositeOperation = "source-over";
            if (this.atk > 0.15 || this.state === "attack") { // fire breath
                ctx.globalCompositeOperation = "screen";
                const fl = ctx.createRadialGradient(46, -54, 0, 52, -54, 16);
                fl.addColorStop(0, "#fff7ed");
                fl.addColorStop(0.4, "#f97316");
                fl.addColorStop(1, toRgba("#f97316", 0));
                ctx.fillStyle = fl;
                ctx.beginPath(); ctx.arc(51, -54, 13, 0, Math.PI * 2); ctx.fill();
                ctx.globalCompositeOperation = "source-over";
            }
            ctx.restore();
            this.drawHp(ctx, cam, 56 * this.scale, -84 * this.scale);
            this.drawDmg(ctx, cam, dt);
            return;
        }

        // ── Mount (horse) ──
        if (isHorse) {
            const hg = gp * 1.3;
            const GY = 18; // ground level in this (raised) frame
            const legD = "#4a2f17", legL = "#7a5230";
            ctx.lineCap = "round";
            // far legs (drawn first, darker)
            bone(-15, 2, -15 + Math.sin(hg) * 6, GY, 4, legD);
            bone(12, 2, 12 + Math.sin(hg + Math.PI) * 6, GY, 4, legD);
            // body
            ctx.fillStyle = cachedGrad("horse", () => {
                const bg = ctx.createLinearGradient(0, -14, 0, 6);
                bg.addColorStop(0, "#8a5a2b");
                bg.addColorStop(1, "#5b3a1a");
                return bg;
            });
            ctx.beginPath(); ctx.ellipse(-2, -4, 22, 10, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(-18, -3, 7, 9, 0, 0, Math.PI * 2); ctx.fill(); // haunch
            ctx.beginPath(); ctx.ellipse(16, -5, 8, 8, 0, 0, Math.PI * 2); ctx.fill();  // chest
            // neck + head
            ctx.fillStyle = "#7a5230";
            ctx.beginPath();
            ctx.moveTo(16, -8);
            ctx.quadraticCurveTo(28, -14, 30, -26);
            ctx.lineTo(36, -27);
            ctx.quadraticCurveTo(36, -22, 33, -18);
            ctx.quadraticCurveTo(26, -8, 20, -4);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = "#5b3a1a";
            ctx.beginPath(); ctx.ellipse(35, -25, 4, 3, -0.4, 0, Math.PI * 2); ctx.fill(); // muzzle
            ctx.beginPath(); ctx.moveTo(29, -26); ctx.lineTo(28, -31); ctx.lineTo(32, -27); ctx.closePath(); ctx.fill(); // ear
            ctx.fillStyle = "#1f1408";
            ctx.beginPath(); ctx.arc(32, -24, 1, 0, Math.PI * 2); ctx.fill(); // eye
            ctx.strokeStyle = "#3a2410"; ctx.lineWidth = 2.5; // mane
            ctx.beginPath(); ctx.moveTo(18, -10); ctx.quadraticCurveTo(26, -20, 29, -26); ctx.stroke();
            ctx.lineWidth = 3.5; // tail
            ctx.beginPath(); ctx.moveTo(-22, -6); ctx.quadraticCurveTo(-34, -2, -32, 14); ctx.stroke();
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(-22, -4); ctx.quadraticCurveTo(-30, 4, -27, 14); ctx.stroke();
            // saddle caparison (team cloth + trim)
            ctx.fillStyle = L.cloth;
            ctx.beginPath();
            ctx.moveTo(-13, -12); ctx.lineTo(8, -13); ctx.lineTo(6, -6); ctx.lineTo(-13, -5);
            ctx.closePath(); ctx.fill();
            // near legs (lighter, in front)
            bone(-10, 2, -10 + Math.sin(hg + Math.PI) * 6, GY, 4.2, legL);
            bone(14, 2, 14 + Math.sin(hg) * 6, GY, 4.2, legL);
            // draped rider legs over near side
            const stir = Math.sin(gp) * 1.2;
            run([0, -16, 8, stir, 7, 9, 11, 9], 6.8 * B, OUTLINE);
            run([0, -16, 8, stir], 4.6 * B, L.pants);
            run([8, stir, 7, 9, 11, 9], 4.4 * B, L.boots);
        }

        // ── Back leg (behind torso) ──
        if (!isHorse && !this.flying) {
            const stride = walking ? 8.5 : 0;
            const bx = walking ? Math.sin(bPh) * stride : -5;
            const by = -(walking ? Math.max(0, Math.cos(bPh)) * 5 : 0);
            legF(bx, by, true);
        } else if (this.flying) {
            // tucked dangling legs (bird-like talons for harpies)
            run([0, hipY, -3, hipY + 14], 6, OUTLINE); run([0, hipY, -3, hipY + 14], 3.8, shade(L.skin, -0.25));
            run([0, hipY, 3, hipY + 16], 6, OUTLINE); run([0, hipY, 3, hipY + 16], 3.8, L.skin);
        }

        // ════ Upper-body group (leans/tilts) ════
        ctx.save();
        ctx.translate(0, hipY);
        ctx.rotate(lean);
        ctx.translate(0, -hipY);

        // Wings (flying) — behind body
        if (this.flying) {
            const flap = Math.sin(this.frame * 0.3) * 0.55;
            ctx.fillStyle = toRgba(skin, 0.8);
            ctx.strokeStyle = toRgba("#0b1020", 0.5);
            ctx.lineWidth = 1;
            for (const dir of [1, -1]) {
                ctx.save();
                ctx.translate(-1, shoulderY + 3);
                ctx.rotate(dir * (2.5 + flap) - 0.4);
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.quadraticCurveTo(16, -10, 26, -2);
                ctx.quadraticCurveTo(16, 4, 0, 4);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
        }

        // Cape (mage / staff / boss)
        if (L.cape || this.boss) {
            const capeSway = Math.sin(this.frame * 0.1) * 4 + swing * 6;
            ctx.fillStyle = shade(L.body === "plate" ? L.cloth : L.tabardCol, -0.2);
            ctx.strokeStyle = OUTLINE;
            ctx.lineWidth = 1.2;
            ctx.globalAlpha = 0.95;
            ctx.beginPath();
            ctx.moveTo(-3, shoulderY + 2);
            ctx.quadraticCurveTo(-15 + capeSway, shoulderY + 16, -11 + capeSway, hipY + 16);
            ctx.quadraticCurveTo(0, hipY + 20, 5, hipY + 12);
            ctx.lineTo(4, shoulderY + 4);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // ── Back arm ──
        let bhx, bhy;
        if (shielded) { bhx = 8; bhy = shoulderY + 9; }
        else if (this.vis === "bow" || this.vis === "crossbow") {
            const pull = this.atkKind === 2 ? this.atk : 0;
            bhx = lerp(4, -7, pull); bhy = shoulderY + 8;
        } else { bhx = -6 + (walking ? Math.sin(fPh) * 5 : 0); bhy = shoulderY + 12; }
        armF(bhx, bhy, true);

        // Quiver slung across the back
        if (L.quiver) {
            ctx.save();
            ctx.translate(-4 * B, shoulderY + 6);
            ctx.rotate(-0.35);
            ctx.fillStyle = "#5a3a1e"; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.rect(-2.6, -4, 5.2, 16); ctx.fill(); ctx.stroke();
            ctx.fillStyle = team ? P_FLETCH : "#b91c1c";
            for (const fx of [-1.4, 0.8]) { ctx.beginPath(); ctx.moveTo(fx, -4); ctx.lineTo(fx - 1.4, -8); ctx.lineTo(fx + 1.4, -8); ctx.closePath(); ctx.fill(); }
            ctx.restore();
        }

        // ── Torso (clothed / armoured body) ──
        this._drawTorso(ctx, L, shoulderY, hipY, B, team, lowQ);

        // ── Shield (drawn in front of torso) ──
        if (shielded) {
            ctx.save();
            ctx.translate(bhx, bhy);
            if (this.vis === "tower_shield") {
                ctx.fillStyle = cachedGrad("towerShield", () => {
                    const sg = ctx.createLinearGradient(-3, 0, 7, 0);
                    sg.addColorStop(0, "#8a98ab");
                    sg.addColorStop(1, "#4a5667");
                    return sg;
                });
                ctx.fillRect(-3, -20, 9, 40);
                ctx.strokeStyle = "#cbd5e1";
                ctx.lineWidth = 1.5;
                ctx.strokeRect(-3, -20, 9, 40);
                ctx.fillStyle = L.cloth;
                ctx.fillRect(-0.5, -7, 4, 16);
                ctx.strokeStyle = WHITE_45;
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(-1.5, -18); ctx.lineTo(-1.5, 18); ctx.stroke();
            } else {
                ctx.fillStyle = cachedGrad("roundShield", () => {
                    const sg = ctx.createRadialGradient(-3, -3, 1, 0, 0, 11);
                    sg.addColorStop(0, "#aebccd");
                    sg.addColorStop(0.7, "#6b7a8d");
                    sg.addColorStop(1, "#3b4757");
                    return sg;
                });
                ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = "#cbd5e1";
                ctx.lineWidth = 1.8;
                ctx.stroke();
                ctx.fillStyle = L.cloth;
                ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = "#fde68a";
                ctx.beginPath(); ctx.arc(-1, -1, 1.5, 0, Math.PI * 2); ctx.fill();
            }
            ctx.restore();
        }

        // ── Head, face, hair and headgear ──
        ctx.save();
        ctx.translate(0, headCY);
        this._drawHead(ctx, L, headR, hurt, team);
        ctx.restore();

        // ── Front arm + weapon ──
        let fhx, fhy;
        if (this.vis === "bow" || this.vis === "crossbow") {
            fhx = 13; fhy = shoulderY + 7;
        } else if (this.vis === "staff" || this.vis === "mage") {
            fhx = 9 + strike * 3; fhy = shoulderY + 8 - strike * 7;
        } else {
            const restHx = 10, restHy = shoulderY + 9;
            const wupHx = -4, wupHy = shoulderY - 9;
            const strHx = 21, strHy = shoulderY + 13;
            if (swing < 0) { const k = -swing; fhx = lerp(restHx, wupHx, k); fhy = lerp(restHy, wupHy, k); }
            else { const k = swing; fhx = lerp(restHx, strHx, k); fhy = lerp(restHy, strHy, k); }
        }

        // Weapon angle (melee)
        let wa;
        if (swing < 0) { const k = -swing; wa = lerp(-0.7, -2.35, k); }
        else { const k = swing; wa = lerp(-0.7, 0.6, k); }

        // Weapon-tip motion trail
        if (this.atkKind === 1 && meleeBlade && Math.abs(swing) > 0.06 && GFX.postFX) {
            const L = this.vis === "spear" ? 34 : this.vis === "club" ? 18 : 20;
            this.wTrail.push({ x: fhx + Math.cos(wa) * L, y: fhy + Math.sin(wa) * L, l: 6 });
            if (this.wTrail.length > 12) this.wTrail.shift();
        }
        for (let i = this.wTrail.length - 1; i >= 0; i--) {
            this.wTrail[i].l -= dt;
            if (this.wTrail[i].l <= 0) this.wTrail.splice(i, 1);
        }
        if (this.wTrail.length > 1) {
            ctx.save();
            ctx.globalCompositeOperation = "screen";
            ctx.lineCap = "round";
            for (let i = 1; i < this.wTrail.length; i++) {
                const a = this.wTrail[i].l / 6;
                ctx.strokeStyle = toRgba("#dbeafe", 0.5 * a);
                ctx.lineWidth = 5 * a;
                ctx.beginPath();
                ctx.moveTo(this.wTrail[i - 1].x, this.wTrail[i - 1].y);
                ctx.lineTo(this.wTrail[i].x, this.wTrail[i].y);
                ctx.stroke();
            }
            ctx.restore();
        }

        // Front upper arm/forearm
        armF(fhx, fhy, false);

        // Weapon by type
        if (this.vis === "bow") {
            ctx.strokeStyle = "#b45309";
            ctx.lineWidth = 2.6;
            ctx.beginPath(); ctx.arc(fhx, fhy, 13, -1.15, 1.15); ctx.stroke();
            const tx = fhx + Math.cos(-1.15) * 13, ty = fhy + Math.sin(-1.15) * 13;
            const bx2 = fhx + Math.cos(1.15) * 13, by2 = fhy + Math.sin(1.15) * 13;
            ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(tx, ty); ctx.lineTo(bhx, bhy); ctx.lineTo(bx2, by2); ctx.stroke();
            if (this.atk > 0.25) {
                ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 1.8;
                ctx.beginPath(); ctx.moveTo(bhx, bhy); ctx.lineTo(fhx + 6, fhy); ctx.stroke();
                ctx.fillStyle = "#cbd5e1";
                ctx.beginPath();
                ctx.moveTo(fhx + 7, fhy); ctx.lineTo(fhx + 2, fhy - 2); ctx.lineTo(fhx + 2, fhy + 2);
                ctx.closePath(); ctx.fill();
            }
        } else if (this.vis === "crossbow") {
            bone(fhx - 5, fhy, fhx + 15, fhy, 3, "#78350f");
            ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(fhx + 12, fhy - 9); ctx.lineTo(fhx + 12, fhy + 9); ctx.stroke();
            ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 0.8;
            ctx.beginPath(); ctx.moveTo(fhx + 12, fhy - 9); ctx.lineTo(fhx - 4, fhy); ctx.lineTo(fhx + 12, fhy + 9); ctx.stroke();
        } else if (this.vis === "staff" || this.vis === "mage") {
            const orbX = fhx + 3, orbY = fhy - 22;
            ctx.strokeStyle = "#6b4423"; ctx.lineWidth = 3;
            bone(fhx, fhy + 3, orbX, orbY, 3, "#6b4423");
            const glow = team ? "#60a5fa" : "#c084fc";
            ctx.globalCompositeOperation = "screen";
            const og = ctx.createRadialGradient(orbX, orbY, 0, orbX, orbY, 10);
            og.addColorStop(0, "#ffffff");
            og.addColorStop(0.4, glow);
            og.addColorStop(1, toRgba(glow, 0));
            ctx.fillStyle = og;
            const castPulse = this.atk > 0 ? Math.sin((1 - this.atk) * Math.PI) * 5 : Math.sin(this.frame * 0.15) * 1.5;
            const r = 9 + castPulse;
            ctx.beginPath(); ctx.arc(orbX, orbY, r, 0, Math.PI * 2); ctx.fill();
            ctx.globalCompositeOperation = "source-over";
            ctx.fillStyle = "#ffffff";
            ctx.beginPath(); ctx.arc(orbX, orbY, 3, 0, Math.PI * 2); ctx.fill();
        } else if (meleeBlade) {
            ctx.save();
            ctx.translate(fhx, fhy);
            ctx.rotate(wa);
            if (this.vis === "spear") {
                bone(-7, 0, 30, 0, 2.6, "#92400e");
                ctx.fillStyle = "#e2e8f0";
                ctx.beginPath();
                ctx.moveTo(34, 0); ctx.lineTo(27, -3.2); ctx.lineTo(28, 0); ctx.lineTo(27, 3.2);
                ctx.closePath(); ctx.fill();
            } else if (this.vis === "club") {
                bone(-4, 0, 9, 0, 3.4, "#6b4423");
                ctx.fillStyle = cachedGrad("club", () => {
                    const cg2 = ctx.createRadialGradient(15, -1, 1, 16, 0, 8);
                    cg2.addColorStop(0, "#a16207");
                    cg2.addColorStop(1, "#5b3a1a");
                    return cg2;
                });
                ctx.beginPath(); ctx.ellipse(16, 0, 7, 8, 0, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = "#3a2410";
                for (const a of [-0.7, 0, 0.7]) {
                    ctx.beginPath();
                    ctx.arc(16 + Math.cos(a) * 5, Math.sin(a) * 6, 1.2, 0, Math.PI * 2);
                    ctx.fill();
                }
            } else {
                // sword / sword_shield / tower_shield (short sword) / dual
                const L = this.vis === "tower_shield" ? 15 : this.vis === "dual" ? 16 : 20;
                bone(-4, 0, 0, 0, 3, "#78350f"); // grip
                ctx.strokeStyle = cachedGrad("blade" + L, () => {
                    const bg2 = ctx.createLinearGradient(0, 0, L, 0);
                    bg2.addColorStop(0, "#9aa6b5");
                    bg2.addColorStop(0.6, "#e5e7eb");
                    bg2.addColorStop(1, "#ffffff");
                    return bg2;
                });
                ctx.lineWidth = 3.2;
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L, 0); ctx.stroke();
                ctx.strokeStyle = WHITE_85; ctx.lineWidth = 0.9;
                ctx.beginPath(); ctx.moveTo(L * 0.4, -0.7); ctx.lineTo(L, -0.4); ctx.stroke();
                ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(0, 4); ctx.stroke();
                ctx.fillStyle = "#b45309";
                ctx.beginPath(); ctx.arc(-4.5, 0, 1.8, 0, Math.PI * 2); ctx.fill();
            }
            ctx.restore();

            // dual second blade on the back hand
            if (this.vis === "dual") {
                ctx.save();
                ctx.translate(bhx, bhy);
                ctx.rotate(2.4 - swing * 1.5);
                bone(-3, 0, 0, 0, 3, "#78350f");
                ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 2.8;
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(14, 0); ctx.stroke();
                ctx.restore();
            }
        } else if (isHorse) {
            // Couched cavalry lance
            ctx.save();
            ctx.translate(fhx, fhy);
            ctx.rotate(-0.12 + swing * 0.3);
            bone(-8, 0, 42, 0, 3, "#6b4423");
            ctx.fillStyle = "#cbd5e1";
            ctx.beginPath();
            ctx.moveTo(42, 0); ctx.lineTo(34, -3.2); ctx.lineTo(34, 3.2);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = skin; // pennant
            ctx.beginPath();
            ctx.moveTo(28, 0); ctx.lineTo(28, -7); ctx.lineTo(37, -3); ctx.closePath();
            ctx.fill();
            ctx.restore();
        }

        // ── Hit flash overlay (additive) ──
        if (flash > 0) {
            ctx.globalCompositeOperation = "screen";
            ctx.globalAlpha = flash * 0.7;
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.ellipse(0, (shoulderY + hipY) / 2, 7, 14, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(0, headCY, headR + 1, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";
        }

        ctx.restore(); // upper-body group

        // ── Front leg (in front of torso) ──
        if (!isHorse && !this.flying) {
            const stride = walking ? 8.5 : 0;
            const fx = walking ? Math.sin(fPh) * stride : 4;
            const fy = -(walking ? Math.max(0, Math.cos(fPh)) * 5 : 0);
            legF(fx, fy, false, L.body === "robe");
        }

        // ── Boss crown ──
        if (this.boss) {
            ctx.fillStyle = "#fbbf24";
            ctx.strokeStyle = "#b45309";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(-10, headCY - 9);
            ctx.lineTo(-6, headCY - 18);
            ctx.lineTo(-2, headCY - 11);
            ctx.lineTo(0, headCY - 20);
            ctx.lineTo(2, headCY - 11);
            ctx.lineTo(6, headCY - 18);
            ctx.lineTo(10, headCY - 9);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }

        ctx.restore(); // root transform

        this.drawHp(ctx, cam, 35 * this.scale, -75 * this.scale);
        this._drawBadges(ctx, cam);
        this.drawDmg(ctx, cam, dt);
    }
}));
