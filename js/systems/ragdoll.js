import { TEAMS } from '../config.js';
import { clamp, rand, shade } from '../utils.js';
import { GFX } from './graphics.js';
import { terrain, groundAt } from './terrain.js';
import { OUTLINE } from '../data/looks.js';

// --- DEATHS: ragdolls, planks and confetti -----------------------------------
//
// When a troop dies its body is handed to this system and the Unit itself goes
// inactive straight away (so victory checks, merge counts and targeting never
// see corpses). Each corpse is a small position-based-dynamics skeleton in
// WORLD space — 11 points, distance constraints, gravity, lane-aware ground and
// a tunnel-roof clamp — drawn with the same torso/head art as the living unit.
//
// Death styles (picked per kill):
//   crumple — knocked back, folds over and slumps (the common one)
//   launch  — flung up and away, spinning, often clean off the screen
//   plank   — keels over perfectly stiff, like a felled tree
//   confetti — pops into a burst of confetti; the weapon clatters down
// Weapons, shields and siege-engine timbers drop as separate tumbling pieces.
//
// Anti-lag: hard cap per graphics tier (oldest recycled), no corpses for
// off-screen deaths, bodies at rest stop simulating, then fade.

const G = 0.42;            // gravity, px/frame² at the 60 fps basis
const ITER = 4;            // constraint iterations
const LIFE = 260;          // frames a corpse lingers (fade over the last 60)
const CAP = { performance: 12, standard: 40, cinematic: 80 };
const CONFETTI = ["#f43f5e", "#f59e0b", "#facc15", "#22c55e", "#38bdf8", "#a855f7", "#ffffff"];

// Rest pose in the unit's local frame (x = forward, y up = negative), matching
// the skeleton unit-render.js draws (hip -18, shoulders -40, head centre -50).
//            0 head   1 neck    2 hip   3 kneeB  4 footB  5 kneeF  6 footF  7 elbB   8 handB  9 elbF   10 handF
const POSE = [0, -50, 0, -40, 0, -18, -3, -9, -5, 0, 3, -9, 4, 0, -4, -31, -6, -22, 5, -31, 10, -31];
const LINKS = [
    [0, 1], [1, 2], [0, 2],          // head, spine, neck brace
    [2, 3], [3, 4], [2, 5], [5, 6],  // legs
    [1, 7], [7, 8], [1, 9], [9, 10], // arms
];

const WEAPON = {
    sword: "blade", sword_shield: "blade", tower_shield: "blade", dual: "blade",
    spear: "spear", horse: "spear", club: "club", bow: "bow", crossbow: "bow",
    staff: "staff", mage: "staff",
};
const ITEM_LEN = { blade: 22, spear: 38, club: 22, bow: 24, staff: 30, plank: 26 };

function pickKind(u, tag, underground) {
    if (u.isHero) return tag === "strong" && !underground ? "launch" : "crumple";
    const r = Math.random();
    let k;
    if (tag === "strong") k = r < 0.45 ? "launch" : r < 0.75 ? "crumple" : r < 0.88 ? "plank" : "confetti";
    else k = r < 0.52 ? "crumple" : r < 0.68 ? "launch" : r < 0.84 ? "plank" : "confetti";
    if (underground && k === "launch") k = "crumple";   // no flinging bodies through the bore roof
    if (u.flying && k === "plank") k = "crumple";       // nothing to stand stiff on mid-air
    return k;
}

class Corpse {
    constructor(u, kind) {
        this.kind = kind;
        this.u = u;                       // for its look + torso/head painters
        this.L = u._look;
        this.team = u.team === TEAMS.PLAYER;
        this.f = u.facing || 1;
        this.s = u.scale || 1;
        this.lane = u.lane || 0;
        this.life = LIFE;
        this.rest = 0;
        this.horse = u.vis === "horse";
        this.items = [];
        this.bits = [];                   // confetti
        this.p = null;                    // body points [x, y, vx, vy] * 11
        this.y = u.y;                     // draw-order key (feet)
        this.x = u.x;
        this.horseT = 0;

        // Where the figure was standing when it died (flyers hover, riders sit
        // on a horse, a jumping hero is mid-air).
        const lift = u.flying ? 70 + Math.sin((u.frame || 0) * 0.1) * 12 : this.horse ? 18 : 0;
        const baseY = u.y - (lift + (u.jumpH || 0) / this.s) * this.s;
        this.baseX = u.x; this.baseY0 = u.y;

        if (kind !== "confetti") {
            const p = new Float32Array(44);
            for (let i = 0; i < 11; i++) {
                p[i * 4] = u.x + POSE[i * 2] * this.f * this.s;
                p[i * 4 + 1] = baseY + POSE[i * 2 + 1] * this.s;
            }
            this.p = p;
            this.len = LINKS.map(([a, b]) => Math.hypot(p[a * 4] - p[b * 4], p[a * 4 + 1] - p[b * 4 + 1]));
            this._kick(kind);
        } else {
            this._confetti(u, baseY);
        }
        if (kind === "plank") {
            this.theta = 0;
            this.w = 0.018;
            this.dir = Math.random() < 0.7 ? -this.f : this.f;   // usually topples backwards
            this.pose = Array.from(this.p.subarray(0));
        }
        this._dropGear(u, baseY);
    }

    _kick(kind) {
        const p = this.p, f = this.f;
        if (kind === "crumple") {
            // Upper body takes the hit, feet stay planted: folds backwards.
            const push = rand(1.2, 2.6);
            for (let i = 0; i < 11; i++) {
                const up = clamp((-POSE[i * 2 + 1]) / 50, 0, 1);
                p[i * 4 + 2] = -f * push * up + rand(-0.2, 0.2);
                p[i * 4 + 3] = -rand(0.3, 1.2) * up;
            }
        } else if (kind === "launch") {
            const yeet = Math.random() < 0.35;
            const vx = -f * (yeet ? rand(11, 16) : rand(5, 9));
            const vy = yeet ? rand(-17, -13) : rand(-11, -7);
            const w = -f * rand(0.12, 0.3);
            let cx = 0, cy = 0;
            for (let i = 0; i < 11; i++) { cx += p[i * 4]; cy += p[i * 4 + 1]; }
            cx /= 11; cy /= 11;
            for (let i = 0; i < 11; i++) {
                const rx = p[i * 4] - cx, ry = p[i * 4 + 1] - cy;
                p[i * 4 + 2] = vx - w * ry;
                p[i * 4 + 3] = vy + w * rx;
            }
            this.life = yeet ? 200 : LIFE;
        }
    }

    _confetti(u, baseY) {
        const n = Math.round(46 * clamp(GFX.particleMul, 0.5, 1.5));
        const cols = this.team ? ["#2c5aa8", "#e2b84a", ...CONFETTI] : ["#b91c1c", ...CONFETTI];
        for (let i = 0; i < n; i++) {
            const a = rand(0, Math.PI * 2), sp = rand(1.5, 6.5);
            this.bits.push({
                x: u.x + rand(-6, 6) * this.s, y: baseY - rand(10, 50) * this.s,
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3.5,
                r: rand(0, 6.28), vr: rand(-0.35, 0.35),
                c: cols[(Math.random() * cols.length) | 0],
                w: rand(2.5, 4.5), h: rand(1.4, 2.4), ph: rand(0, 6.28), down: false,
            });
        }
    }

    _dropGear(u, baseY) {
        const f = this.f, s = this.s;
        const vis = u.vis;
        if (vis === "catapult") {
            // Siege engine bursts into timbers and wheels.
            for (let i = 0; i < 5; i++) this._item("plank", u.x + rand(-14, 14) * s, baseY - rand(6, 26) * s, rand(-4, 4), rand(-8, -3));
            for (const wx of [-12, 10]) this._item("wheel", u.x + wx * f * s, baseY - 4 * s, rand(-3, 3), rand(-6, -2));
            return;
        }
        const k = WEAPON[vis];
        if (k) {
            const hx = this.p ? this.p[10 * 4] : u.x + 10 * f * s;
            const hy = this.p ? this.p[10 * 4 + 1] : baseY - 31 * s;
            this._item(k, hx, hy, -f * rand(0.5, 3) + (this.kind === "launch" ? -f * 3 : 0), rand(-6, -2.5));
        }
        if (vis === "sword_shield" || vis === "tower_shield" || (this.L && this.L.shield)) {
            this._item(vis === "tower_shield" ? "tower" : "shield", u.x + 8 * f * s, baseY - 31 * s, f * rand(0.5, 2.5), rand(-5, -2));
        }
    }

    _item(kind, x, y, vx, vy) {
        this.items.push({ kind, x, y, vx, vy, a: rand(-1, 1), va: rand(-0.3, 0.3), len: (ITEM_LEN[kind] || 14) * this.s, rest: false });
    }

    // Floor (and, inside a tunnel bore, ceiling) under x for this corpse.
    _floor(x) { return groundAt(x, this.lane); }
    _ceil(x) {
        if (this.lane !== 0 || !terrain.crossingAt(x)) return -Infinity;
        return groundAt(x, 0) - terrain.tunnelArch() + 8;
    }

    update(dt) {
        this.life -= dt;
        if (this.horse) this.horseT = Math.min(1, this.horseT + dt / 34);
        if (this.p) {
            if (this.kind === "plank") this._plank(dt);
            else if (this.rest < 30) this._sim(dt);
        }
        for (const it of this.items) if (!it.rest) this._itemStep(it, dt);
        for (const b of this.bits) this._bitStep(b, dt);
        // Draw-order key + bubble anchor.
        if (this.p) {
            let my = -Infinity;
            for (let i = 0; i < 11; i++) my = Math.max(my, this.p[i * 4 + 1]);
            this.y = my; this.x = this.p[8];
        }
    }

    _sim(dt) {
        const p = this.p;
        const old = this._old || (this._old = new Float32Array(22));
        let moving = 0;
        for (let i = 0; i < 11; i++) {
            const o = i * 4;
            old[i * 2] = p[o]; old[i * 2 + 1] = p[o + 1];
            p[o + 3] += G * dt;
            p[o + 3] = Math.min(p[o + 3], 22);
            p[o] += p[o + 2] * dt;
            p[o + 1] += p[o + 3] * dt;
        }
        for (let it = 0; it < ITER; it++) {
            for (let k = 0; k < LINKS.length; k++) {
                const a = LINKS[k][0] * 4, b = LINKS[k][1] * 4;
                const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1];
                const d = Math.hypot(dx, dy) || 0.001;
                const diff = (d - this.len[k]) / d * 0.5;
                p[a] += dx * diff; p[a + 1] += dy * diff;
                p[b] -= dx * diff; p[b + 1] -= dy * diff;
            }
            for (let i = 0; i < 11; i++) {
                const o = i * 4;
                const gy = this._floor(p[o]) - (i === 0 ? 7 * this.s : 1.5 * this.s);
                if (p[o + 1] > gy) p[o + 1] = gy;
                const cy = this._ceil(p[o]);
                if (p[o + 1] < cy) p[o + 1] = cy;
            }
        }
        // Velocities from the corrected positions; ground friction + a small bounce.
        for (let i = 0; i < 11; i++) {
            const o = i * 4;
            const vin = p[o + 3];
            p[o + 2] = (p[o] - old[i * 2]) / dt;
            p[o + 3] = (p[o + 1] - old[i * 2 + 1]) / dt;
            const gy = this._floor(p[o]) - (i === 0 ? 7 * this.s : 1.5 * this.s);
            if (p[o + 1] >= gy - 0.5) {
                p[o + 2] *= Math.pow(0.78, dt);
                if (vin > 3) p[o + 3] = -vin * 0.28;
            }
            moving = Math.max(moving, Math.abs(p[o + 2]) + Math.abs(p[o + 3]));
        }
        this.rest = moving < 0.12 ? this.rest + dt : 0;
    }

    // Stiff as a board: the rest pose rotates about the feet and slams down.
    _plank(dt) {
        if (this.theta < Math.PI / 2 || this.w > 0) {
            this.w += Math.sin(this.theta + 0.08) * 0.0095 * dt;
            this.theta += this.w * dt;
            if (this.theta >= Math.PI / 2) {
                this.theta = Math.PI / 2;
                if (this.w > 0.02) { this.w = -this.w * 0.22; this._thud(); }
                else this.w = 0;
            }
        }
        const px = this.baseX, py = this._floor(this.baseX);
        const c = Math.cos(this.theta * this.dir), s = Math.sin(this.theta * this.dir);
        const P = this.pose, oy = this.pose[4 * 4 + 1];   // feet line
        for (let i = 0; i < 11; i++) {
            const lx = P[i * 4] - px, ly = P[i * 4 + 1] - oy;
            this.p[i * 4] = px + lx * c - ly * s;
            this.p[i * 4 + 1] = py + lx * s + ly * c - 2 * this.s;
        }
    }

    _thud() {
        const g = window.game;
        if (!g) return;
        const hx = this.p[0];
        g.particles.emit(hx, this._floor(hx) - 2, 8, "#8b7a5c", 2.2, 3, "fade");
        g.shake = Math.max(g.shake || 0, 1.5);
    }

    _itemStep(it, dt) {
        it.vy = Math.min(it.vy + G * dt, 20);
        it.x += it.vx * dt;
        it.y += it.vy * dt;
        it.a += it.va * dt;
        const sa = Math.sin(it.a) * it.len / 2;
        const r = it.kind === "wheel" || it.kind === "shield" ? 6 * this.s : 0;
        const low = Math.max(it.y + sa, it.y - sa) + r;
        const gy = this._floor(it.x);
        if (low > gy) {
            it.y -= low - gy;
            if (it.vy > 1.5) { it.vy = -it.vy * 0.32; it.va *= 0.6; }
            else {
                it.vy = 0;
                // settle flat
                const flat = Math.round(it.a / Math.PI) * Math.PI;
                it.a += (flat - it.a) * Math.min(1, 0.25 * dt);
                it.va *= Math.pow(0.5, dt);
            }
            it.vx *= Math.pow(0.7, dt);
            if (Math.abs(it.vx) + Math.abs(it.vy) + Math.abs(it.va) < 0.03) it.rest = true;
        }
        const cy = this._ceil(it.x);
        if (it.y < cy) { it.y = cy; it.vy = Math.abs(it.vy) * 0.3; }
    }

    _bitStep(b, dt) {
        if (b.down) return;
        b.ph += 0.2 * dt;
        b.vx *= Math.pow(0.96, dt);
        b.vy = Math.min(b.vy + 0.16 * dt, 1.4);       // flutter: low terminal speed
        b.x += (b.vx + Math.sin(b.ph) * 0.6) * dt;
        b.y += b.vy * dt;
        b.r += b.vr * dt;
        const gy = this._floor(b.x) - 1;
        if (b.y > gy) { b.y = gy; b.down = true; }
        const cy = this._ceil(b.x);
        if (b.y < cy) { b.y = cy; b.vy = 0.5; }
    }

    // Bubble anchor (screams follow the head).
    headX() { return this.p ? this.p[0] : this.x; }
    headY() { return this.p ? this.p[1] : this.y - 50 * this.s; }

    draw(ctx, cam) {
        const a = clamp(this.life / 60, 0, 1);
        if (a <= 0) return;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        if (this.horse) this._drawHorse(ctx, cam);
        if (this.p) this._drawBody(ctx, cam);
        for (const it of this.items) this._drawItem(ctx, cam, it);
        if (this.bits.length) this._drawBits(ctx, cam);
        ctx.restore();
    }

    _drawBody(ctx, cam) {
        const p = this.p, L = this.L, z = cam.z, S = this.s * z, f = this.f;
        const X = (i) => cam.sx(p[i * 4]), Y = (i) => cam.sy(p[i * 4 + 1]);
        const B = L.build || 1;
        const bones = L.body === "bones";
        const metal = L.body === "plate" || L.body === "chain";
        const BONE = "#ddd6c4";
        const sleeve = metal ? "#a3adba" : bones ? BONE : L.body === "bare" ? L.skin : L.body === "leather" ? "#6e4b2c" : L.cloth;
        const fore = metal ? "#a3adba" : bones ? BONE : (L.body === "robe" || L.body === "gambeson") ? L.cloth : L.skin;
        const seg = (pts, w, col) => {
            ctx.strokeStyle = col; ctx.lineWidth = w;
            ctx.beginPath(); ctx.moveTo(X(pts[0]), Y(pts[0]));
            for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i]), Y(pts[i]));
            ctx.stroke();
        };
        const leg = (k, ft, back) => {
            const w = (bones ? 2.6 : 5.6) * B * S;
            seg([2, k, ft], w + 2.2 * S, OUTLINE);
            seg([2, k], w, bones ? BONE : back ? shade(L.pants, -0.25) : L.pants);
            seg([k, ft], w * 0.95, bones ? BONE : back ? shade(L.boots, -0.2) : L.boots);
        };
        const arm = (e, h, back) => {
            const w = (bones ? 2.4 : 4.8) * B * S;
            const dk = (c) => (back ? shade(c, -0.25) : c);
            seg([1, e, h], w + 2.2 * S, OUTLINE);
            seg([1, e], w, dk(sleeve));
            seg([e, h], w * 0.9, dk(fore));
            ctx.fillStyle = dk(metal ? "#6e7887" : bones ? BONE : L.skin);
            ctx.beginPath(); ctx.arc(X(h), Y(h), 2.2 * B * S, 0, Math.PI * 2); ctx.fill();
        };
        // Painter frame: origin at a joint, local "down" along a bone, mirrored by facing.
        const frame = (i, j, fn) => {
            const ang = Math.atan2(p[j * 4 + 1] - p[i * 4 + 1], p[j * 4] - p[i * 4]) - Math.PI / 2;
            ctx.save();
            ctx.translate(X(i), Y(i));
            ctx.rotate(ang);
            ctx.scale(f * S, S);
            fn();
            ctx.restore();
        };
        leg(3, 4, true);
        arm(7, 8, true);
        frame(1, 2, () => {                       // torso: neck -> hip
            ctx.translate(0, 40);
            this.u._drawTorso(ctx, L, -40, -18, B, this.team, GFX.flatScenery);
        });
        {                                         // head: local up along neck -> head
            const ang = Math.atan2(p[1] - p[5], p[0] - p[4]) + Math.PI / 2;
            ctx.save();
            ctx.translate(X(0), Y(0));
            ctx.rotate(ang);
            ctx.scale(f * S, S);
            this.u._drawHead(ctx, L, 8, 1, this.team);
            if (L.head !== "greathelm" && L.head !== "barbute" && L.head !== "skull") {
                ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.2;   // X_X
                ctx.beginPath();
                ctx.moveTo(2.6, -2.8); ctx.lineTo(5.6, 0.2);
                ctx.moveTo(5.6, -2.8); ctx.lineTo(2.6, 0.2);
                ctx.stroke();
            }
            ctx.restore();
        }
        arm(9, 10, false);
        leg(5, 6, false);
    }

    _drawHorse(ctx, cam) {
        // The mount buckles: legs fold, body sinks and tips onto its side.
        const t = this.horseT, z = cam.z, S = this.s * z;
        const gx = cam.sx(this.baseX), gy = cam.sy(this._floor(this.baseX));
        ctx.save();
        ctx.translate(gx, gy);
        ctx.scale(this.f * S, S);
        ctx.translate(0, -18 + t * 12);
        ctx.rotate(-t * 0.18);
        const legL = 18 - t * 13;
        ctx.strokeStyle = "#4a2f17"; ctx.lineWidth = 4;
        for (const lx of [-14, 12]) { ctx.beginPath(); ctx.moveTo(lx, 2); ctx.lineTo(lx + t * 9, 2 + legL); ctx.stroke(); }
        ctx.fillStyle = "#7a5230";
        ctx.beginPath(); ctx.ellipse(-2, -4, 22, 10, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(16, -8); ctx.quadraticCurveTo(28, -14 + t * 14, 30, -26 + t * 26);
        ctx.lineTo(36, -27 + t * 26); ctx.quadraticCurveTo(30, -10 + t * 10, 20, -4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = this.L.cloth;
        ctx.fillRect(-13, -13, 21, 8);
        ctx.strokeStyle = "#7a5230"; ctx.lineWidth = 4.2;
        for (const lx of [-10, 14]) { ctx.beginPath(); ctx.moveTo(lx, 2); ctx.lineTo(lx + t * 11, 2 + legL); ctx.stroke(); }
        ctx.restore();
    }

    _drawItem(ctx, cam, it) {
        const z = cam.z, S = this.s * z;
        ctx.save();
        ctx.translate(cam.sx(it.x), cam.sy(it.y));
        ctx.rotate(it.a);
        ctx.scale(S, S);
        const hl = (it.len / this.s) / 2;
        const line = (x0, x1, w, c) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x1, 0); ctx.stroke(); };
        switch (it.kind) {
            case "blade":
                line(-hl, -hl + 4, 3, "#78350f");
                line(-hl + 4, hl, 3.2, "#d5dbe3");
                ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 2.6;
                ctx.beginPath(); ctx.moveTo(-hl + 4, -4); ctx.lineTo(-hl + 4, 4); ctx.stroke();
                break;
            case "spear":
                line(-hl, hl - 5, 2.6, "#92400e");
                ctx.fillStyle = "#e2e8f0";
                ctx.beginPath(); ctx.moveTo(hl, 0); ctx.lineTo(hl - 7, -3); ctx.lineTo(hl - 7, 3); ctx.closePath(); ctx.fill();
                break;
            case "club":
                line(-hl, 2, 3.4, "#6b4423");
                ctx.fillStyle = "#7a5230";
                ctx.beginPath(); ctx.ellipse(hl - 5, 0, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
                break;
            case "bow":
                ctx.strokeStyle = "#b45309"; ctx.lineWidth = 2.6;
                ctx.beginPath(); ctx.arc(0, -4, 13, 0.35, Math.PI - 0.35); ctx.stroke();
                break;
            case "staff":
                line(-hl, hl, 3, "#6b4423");
                ctx.fillStyle = this.team ? "#93c5fd" : "#d8b4fe";
                ctx.beginPath(); ctx.arc(hl, 0, 3.2, 0, Math.PI * 2); ctx.fill();
                break;
            case "plank":
                line(-hl, hl, 4.5, "#6b4423");
                break;
            case "wheel":
                ctx.fillStyle = "#3a2410"; ctx.strokeStyle = "#1f1408"; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                line(-4, 4, 1.2, "#6b4423");
                break;
            case "shield":
                ctx.fillStyle = "#7d8b9c"; ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 1.6;
                ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.fillStyle = this.L.cloth;
                ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
                break;
            case "tower":
                ctx.fillStyle = "#6b7a8d"; ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 1.4;
                ctx.fillRect(-20, -4.5, 40, 9); ctx.strokeRect(-20, -4.5, 40, 9);
                ctx.fillStyle = this.L.cloth; ctx.fillRect(-8, -1.8, 16, 3.6);
                break;
        }
        ctx.restore();
    }

    _drawBits(ctx, cam) {
        const z = cam.z;
        for (const b of this.bits) {
            const flip = Math.abs(Math.cos(b.ph));          // paper tumbling edge-on
            ctx.fillStyle = b.c;
            ctx.save();
            ctx.translate(cam.sx(b.x), cam.sy(b.y));
            ctx.rotate(b.r);
            const w = b.w * z, h = b.h * z * (b.down ? 0.6 : Math.max(0.2, flip));
            ctx.fillRect(-w / 2, -h / 2, w, h);
            ctx.restore();
        }
    }
}

export class RagdollSystem {
    constructor() { this.list = []; this.force = null; }

    clear() { this.list.length = 0; }

    // Hand a dying unit's body over. Returns the style used, or null when no
    // corpse was made (off-screen, boss, dragon) so the caller keeps the old
    // death burst.
    spawn(u, tag) {
        const g = window.game;
        if (!g || u.isBoss || u.vis === "dragon") return null;
        const cam = g.camera;
        if (cam && cam.viewW) {
            const vL = cam.x - 240, vR = cam.x + cam.viewW / (cam.z || 1) + 240;
            if (u.x < vL || u.x > vR) return null;
        }
        if (!u._look && u.vis !== "catapult") return null;   // never drawn: nothing to ragdoll
        const underground = terrain.underground(u);
        let kind = u.vis === "catapult" ? "wreck" : this.force || pickKind(u, tag, underground);   // force: test hook
        // Crowd LOD: big brawls get cheaper bodies (no per-point physics).
        if ((u.team === TEAMS.PLAYER ? g._lodP : g._lodE) && kind === "crumple") kind = "plank";
        const c = new Corpse(u, kind === "wreck" ? "confetti" : kind);
        if (kind === "wreck") { c.bits.length = 0; c.kind = "wreck"; }
        this.list.push(c);
        const cap = CAP[GFX.tier] || 40;
        if (this.list.length > cap) this.list.splice(0, this.list.length - cap);
        return { kind, corpse: c };
    }

    update(dt) {
        if (!(dt > 0)) return;
        const d = Math.min(dt, 3);
        for (let i = this.list.length - 1; i >= 0; i--) {
            const c = this.list[i];
            c.update(d);
            if (c.life <= 0 || c.y > 4000) this.list.splice(i, 1);
        }
    }
}
