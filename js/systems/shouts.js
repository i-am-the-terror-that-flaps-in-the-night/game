import { TEAMS } from '../config.js';
import { clamp, rand } from '../utils.js';

// --- SHOUTS: little speech bubbles + death screams ---------------------------
//
// Troops occasionally yell — on recruiting, on arrival, mid-swing — and some
// die screaming ("AAAAaaaa…" trailing off as the body flies). Text is costly to
// draw, so: a hard cap on live bubbles, a global cooldown, per-unit cooldowns,
// and nothing is said off-screen. Bubbles are drawn in screen space (never
// mirrored by a unit's facing) and follow their speaker.

const MAX_LIVE = 5;
const MAX_SCREAMS = 3;
const GAP = 22;            // frames between any two ordinary bubbles

const LINES = {
    recruit: ["CHARGE!", "For the crown!", "Onward!", "Reporting in!", "Let's go!", "Point me at 'em!", "Ready!"],
    arrive: ["RAAAH!", "Blood!", "Smash!", "Grrr!", "Burn it down!", "Get 'em!"],
    arriveRabble: ["Huh?", "Wait, what?", "Free loot!", "Me first!"],
    swingP: ["Take that!", "Hyah!", "For glory!", "Hold the line!", "Back, fiend!"],
    swingE: ["Die!", "Rrargh!", "Crush!", "Yours is mine!"],
    hurt: ["Ow!", "Oof!", "Ugh!", "Not the face!"],
    die: ["Avenge me!", "Ugh…", "Tell my mother…", "Worth it.", "I regret nothing!", "Oof."],
    plank: ["Timber!", "Oh no.", "Welp.", "…"],
    confetti: ["Yay?", "Pop!", "Wheee!", "Surprise!"],
    hero: ["This isn't over!", "The void… calls…"],
};

function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

export class ShoutSystem {
    constructor() { this.list = []; this.cd = 0; this.on = true; }

    clear() { this.list.length = 0; this.cd = 0; }

    _visible(x) {
        const g = window.game, cam = g && g.camera;
        if (!cam || !cam.viewW) return true;
        return x > cam.x - 20 && x < cam.x + cam.viewW / (cam.z || 1) + 20;
    }

    // ent: anything with x/y (unit) or headX()/headY() (corpse).
    say(ent, text, opt = {}) {
        if (!this.on || !ent || !text) return false;
        const x = ent.headX ? ent.headX() : ent.x;
        if (!this._visible(x)) return false;
        const scream = !!opt.scream;
        if (!scream && !opt.force) {
            if (this.cd > 0) return false;
            if (ent._shoutCd && ent._shoutCd > (window.game ? window.game.frames : 0)) return false;
        }
        const live = this.list.filter((b) => b.scream === scream).length;
        if (scream ? live >= MAX_SCREAMS : this.list.length - this._screams() >= MAX_LIVE) return false;
        if (!scream) {
            this.cd = GAP;
            if (window.game) ent._shoutCd = window.game.frames + 360;
        }
        this.list.push({
            ent, text, scream,
            life: scream ? 80 : 95, max: scream ? 80 : 95,
            team: ent.team === TEAMS.PLAYER,
            lx: x, ly: ent.headY ? ent.headY() : ent.y - 60 * (ent.scale || 1),
            off: opt.off != null ? opt.off : (ent.headY ? 14 : 82 * (ent.scale || 1)),
            w: 0,
        });
        return true;
    }

    _screams() { let n = 0; for (const b of this.list) if (b.scream) n++; return n; }

    // Convenience triggers with built-in odds.
    recruit(u) { if (Math.random() < 0.3) this.say(u, pick(LINES.recruit)); }
    arrive(e) {
        if (Math.random() < 0.08) this.say(e, pick(e.type === "rabble" ? LINES.arriveRabble : LINES.arrive));
    }
    swing(u) {
        if (Math.random() < 0.012) this.say(u, pick(u.team === TEAMS.PLAYER ? LINES.swingP : LINES.swingE));
    }
    death(corpse, kind, u) {
        if (u.isHero) { this.say(corpse, pick(LINES.hero), { force: true }); return; }
        if (kind === "launch") {
            if (Math.random() < 0.7) this.scream(corpse);
        } else if (kind === "plank") {
            if (Math.random() < 0.35) this.say(corpse, pick(LINES.plank));
        } else if (kind === "confetti") {
            if (Math.random() < 0.45) this.say(corpse, pick(LINES.confetti));
        } else if (Math.random() < 0.18) {
            this.say(corpse, pick(LINES.die));
        }
    }
    scream(corpse) {
        if (this.say(corpse, "A".repeat(4 + ((Math.random() * 4) | 0)), { scream: true }))
            if (window.game && window.game.audio.playScream) window.game.audio.playScream();
    }

    update(dt) {
        if (!(dt > 0)) return;
        if (this.cd > 0) this.cd -= dt;
        for (let i = this.list.length - 1; i >= 0; i--) {
            const b = this.list[i];
            b.life -= dt;
            const e = b.ent;
            // Follow the speaker while it's around (corpses always; units while alive).
            if (e.headX) { b.lx = e.headX(); b.ly = e.headY(); }
            else if (e.active) { b.lx = e.x; b.ly = e.y - (e.jumpH || 0); }
            if (b.life <= 0) this.list.splice(i, 1);
        }
    }

    draw(ctx, cam) {
        if (!this.list.length) return;
        const z = clamp(cam.z, 0.75, 1.25);
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        for (const b of this.list) {
            const t = 1 - b.life / b.max;              // 0 -> 1 over its life
            const x = cam.sx(b.lx), y = cam.sy(b.ly) - b.off * cam.z;
            if (b.scream) this._drawScream(ctx, b, x, y, t, z);
            else this._drawBubble(ctx, b, x, y, t, z);
        }
        ctx.restore();
    }

    _drawBubble(ctx, b, x, y, t, z) {
        const pop = t < 0.12 ? 0.6 + 0.4 * (t / 0.12) * 1.15 : 1;   // pop-in overshoot
        const a = clamp(b.life / 18, 0, 1);
        const fs = 11 * z;
        ctx.font = `800 ${fs}px system-ui`;
        if (!b.w) b.w = ctx.measureText(b.text).width;
        const w = (b.w + 12 * z) * pop, h = (fs + 8 * z) * pop;
        const by = y - h / 2 - 6 * z - t * 6 * z;
        ctx.globalAlpha = a;
        ctx.fillStyle = "rgba(255,253,245,0.96)";
        ctx.strokeStyle = b.team ? "#1e3a8a" : "#7f1d1d";
        ctx.lineWidth = 1.6 * z;
        ctx.beginPath();
        const r = Math.min(7 * z, h / 2);
        ctx.roundRect(x - w / 2, by - h / 2, w, h, r);
        ctx.moveTo(x - 4 * z, by + h / 2);           // tail
        ctx.lineTo(x - 1 * z, by + h / 2 + 6 * z);
        ctx.lineTo(x + 3 * z, by + h / 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(255,253,245,0.96)";   // cover the tail's seam
        ctx.fillRect(x - 3.4 * z, by + h / 2 - 2 * z, 6 * z, 2.6 * z);
        if (pop >= 1) {
            ctx.fillStyle = "#1c1917";
            ctx.fillText(b.text, x, by + 0.5 * z);
        }
        ctx.globalAlpha = 1;
    }

    // "AAAA" that keeps adding letters, shrinking and fading as it trails off.
    _drawScream(ctx, b, x, y, t, z) {
        const n = b.text.length + Math.floor(t * 8);
        const txt = "A".repeat(Math.max(3, n - Math.floor(t * 4))) + "a".repeat(Math.floor(t * 5));
        const fs = (15 - t * 6) * z;
        ctx.font = `900 italic ${fs}px system-ui`;
        ctx.globalAlpha = clamp(1.15 - t, 0, 1);
        const jx = rand(-1, 1) * (1 - t) * 1.5 * z, jy = rand(-1, 1) * (1 - t) * 1.5 * z;
        ctx.strokeStyle = "rgba(0,0,0,0.75)";
        ctx.lineWidth = 3.2 * z;
        ctx.strokeText(txt, x + jx, y - 4 * z + jy);
        ctx.fillStyle = "#fff1f2";
        ctx.fillText(txt, x + jx, y - 4 * z + jy);
        ctx.globalAlpha = 1;
    }
}
