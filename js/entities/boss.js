import { Entity } from './entity.js';
import { CONFIG, HIT_FLASH_FRAMES, TEAMS } from '../config.js';
import { dealDamage } from '../systems/combat.js';
import { Projectile } from '../systems/projectile.js';
import { clamp, lerp, particleQuality, rand, shade, toRgba } from '../utils.js';

// --- BOSS: "Rustmaw, the Hollow Engine" ---------------------------------
// A colossal eldritch locomotive — not a member of ENEMY_TYPES and not driven
// by the generic Unit AI. It extends Entity so the existing combat pipeline
// (dealDamage -> takeDamage) and the enemy loop/draw/removal treat it like any
// other member of game.enemies: player units, towers and the castle acquire and
// damage it for free. Everything else — multi-phase movement, custom attacks,
// its own silhouette — is overridden here. The encounter lifecycle (warning,
// spawn, defeat rewards, boss bar, engine audio) lives in game/game-boss.js.
//
// Tactical identity: heavy plating (blades/arrows glance off — slash/pierce are
// weak vs heavy) with a corrupted boiler that Blunt siege (Catapult, Paladin)
// and Magic crack open; `large` so the Catapult's vsLarge bonus applies. This
// slots straight into the game's existing counter system rather than inventing
// a parallel one.

const PHASE_HI = 0.66; // hp ratio: phase 1 -> 2
const PHASE_LO = 0.33; // hp ratio: phase 2 -> 3

// Corrupted-smoke palette (sickly greens + void purples), emitted additively.
const SMOKE_COLS = ['#7c3aed', '#4ade80', '#a855f7', '#65a30d', '#2e1065'];

export class Boss extends Entity {
    constructor(x, hp) {
        super(x, CONFIG.GROUND_Y, TEAMS.ENEMY);
        // Combat identity. kind is deliberately NOT "building" so resolveDamage
        // takes the armour-class branch; `large` feeds the Catapult vsLarge mod.
        this.kind = 'boss';
        this.isBoss = true;
        this.maxHp = this.hp = hp;
        this.armor = 5;              // flat soak per hit — trims chip damage
        this.armorClass = 'heavy';   // resists slash/pierce; weak to blunt/magic
        this.large = true;
        this.flying = false;
        this.scale = 1;

        // Movement state machine: patrol <-> (telegraph -> charge -> recover).
        this.mode = 'patrol';
        this.modeT = 0;
        this.facing = -1;            // -1 faces the castle (screen-left)
        this.vx = 0;
        this.frame = 0;
        this.patrolMin = 620;
        this.patrolMax = CONFIG.WORLD_WIDTH - 260;
        this.tx = clamp(x, this.patrolMin, this.patrolMax);

        // Phase / cooldowns (frame units — 60 = 1s at 60fps).
        this.phase = 1;
        this.invuln = 0;
        this.atkCd = 90;
        this.dashCd = 360;
        this.summonCd = 360;
        this.smokeT = 0;
        this.coreGlow = 0.6;

        // Charge bookkeeping.
        this.chargeDir = -1;
        this.chargeSpd = 0;
        this._charged = new Set(); // targets already crushed this charge (hit-once)
        this._chargeSrc = { dmgType: 'blunt', siege: true, team: TEAMS.ENEMY, isUnit: false };
        this._cinderSrc = { dmgType: 'magic', team: TEAMS.ENEMY, isUnit: false };

        // Base attack damage (scaled by difficulty at spawn time).
        this.cinderDmg = 12;
        this.chargeDmg = 42;

        // Death sequence.
        this.slain = false;
        this.dyingT = 0;
        this._boomT = 0;

        // Self-describing definition so defOf()/tooltips/selection show a proper
        // name + matchup without adding an ENEMY_TYPES row (defOf prefers .def).
        this.def = {
            name: 'Rustmaw, the Hollow Engine',
            desc: 'A derailed god of iron and cinder. Blunt siege and Magic crack its boiler; blades and arrows glance off the plating.',
            dmgType: 'blunt',
            armorClass: 'heavy',
            armor: this.armor,
            large: true,
        };
    }

    // ── Damage / phases ─────────────────────────────────────────────────
    takeDamage(amt, tag = null) {
        if (this.hp <= 0 || this.invuln > 0) return;
        super.takeDamage(amt, tag); // flinch/flash/dmg-text; calls die() if lethal
        this._checkPhase();
    }

    _checkPhase() {
        if (this.hp <= 0) return;
        const r = this.hp / this.maxHp;
        const np = r > PHASE_HI ? 1 : r > PHASE_LO ? 2 : 3;
        if (np > this.phase) this._enterPhase(np);
    }

    _enterPhase(p) {
        this.phase = p;
        this.invuln = 42;            // brief mercy window during the transition
        this.mode = 'patrol';
        this.modeT = 0;
        this.dashCd = Math.min(this.dashCd, 60);
        this.coreGlow = 1.6;
        const g = game;
        g.shake = Math.max(g.shake, 16);
        g.audio.bossPhase(p);
        g.notify(p >= 3
            ? 'Rustmaw sheds its hull — the core burns exposed! [PHASE 3]'
            : `Rustmaw's plating buckles and splits! [PHASE ${p}]`);
        // Ring of cinders erupts on transition.
        const cx = this.x, cy = CONFIG.GROUND_Y - 48;
        g.fx.ring(cx, cy, { r0: 10, r1: 150, col: '#a855f7', w: 5, life: 26 });
        g.fx.ring(cx, cy, { r0: 6, r1: 100, col: '#4ade80', w: 3, life: 20 });
        g.fx.flash(cx, cy, { r: 120, col: '#f59e0b', life: 16 });
        g.particles.emit(cx, cy, 40, '#a855f7', 9, 4, 'float');
        g.particles.emit(cx, cy, 24, '#f59e0b', 7, 3, 'spark');
    }

    die() {
        if (this.dyingT > 0) return; // already dying
        // Do NOT deactivate yet: keep the entity alive so its death animation can
        // play out in update()/draw(). The encounter watches `slain` for rewards
        // and `!active` for final cleanup.
        this.hp = 0;
        this.slain = true;
        this.mode = 'dead';
        this.vx = 0;
        this.dyingT = 130;
        this._boomT = 0;
    }

    // ── Update ──────────────────────────────────────────────────────────
    update(dt) {
        this.frame += dt;
        if (this.hurtT > 0) this.hurtT = Math.max(0, this.hurtT - dt);
        if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
        if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
        if (this.dyingT > 0) { this._updateDying(dt); return; }

        // Corrupted smoke from the stack.
        this.smokeT -= dt;
        if (this.smokeT <= 0) { this._emitSmoke(); this.smokeT = this.phase >= 3 ? 4 : 8; }

        // Core furnace pulse (brighter mid-telegraph and in later phases).
        const baseGlow = 0.5 + (this.phase - 1) * 0.25;
        const target = baseGlow + (this.mode === 'telegraph' ? 0.9 : 0) + Math.sin(this.frame * 0.13) * 0.18;
        this.coreGlow += (target - this.coreGlow) * Math.min(1, 0.12 * dt);

        // Movement state machine.
        this.modeT -= dt;
        const spd = 1.0 + this.phase * 0.55;
        if (this.mode === 'patrol') this._patrol(dt, spd);
        else if (this.mode === 'telegraph') this._telegraph(dt);
        else if (this.mode === 'charge') this._charge(dt);
        else if (this.mode === 'recover') this._recover(dt, spd);

        // Ranged cinder volley (not while charging).
        if (this.mode !== 'charge' && this.mode !== 'telegraph') {
            this.atkCd -= dt;
            if (this.atkCd <= 0) {
                this._fireCinders();
                this.atkCd = clamp(170 - this.phase * 35, 60, 170);
            }
        }

        // Telegraphed charge.
        this.dashCd -= dt;
        if (this.dashCd <= 0 && this.mode === 'patrol') this._beginTelegraph();

        // Phase-3 cinder-spawn minions (capped so it never runaway-swarms).
        if (this.phase >= 3) {
            this.summonCd -= dt;
            if (this.summonCd <= 0) { this._summon(); this.summonCd = 340; }
        }

        this.x = clamp(this.x, 180, CONFIG.WORLD_WIDTH - 140);
    }

    _patrol(dt, spd) {
        const d = this.tx - this.x;
        if (Math.abs(d) < 14) {
            // Reached a waypoint — pick a fresh one, tending to prowl the front.
            this.tx = rand(this.patrolMin, this.patrolMax);
        } else {
            const dir = Math.sign(d);
            this.x += dir * spd * dt;
            this.facing = dir < 0 ? -1 : 1;
        }
    }

    _beginTelegraph() {
        this.mode = 'telegraph';
        this.modeT = 46;
        this.facing = -1; // wind up toward the castle
        game.audio.bossWarning();
        game.notify('Rustmaw builds a head of steam…');
    }

    _telegraph(dt) {
        // Shudder in place; vent sparks; screen jitters.
        this.x += Math.sin(this.frame * 1.4) * 0.6 * dt;
        game.shake = Math.max(game.shake, 3);
        if (Math.floor(this.frame) % 3 === 0)
            game.particles.emit(this.x + this.facing * 60, CONFIG.GROUND_Y - 30, 3, '#f59e0b', 5, 3, 'spark');
        if (this.modeT <= 0) this._beginCharge();
    }

    _beginCharge() {
        this.mode = 'charge';
        this.chargeDir = -1;
        this.chargeSpd = 8.5 + this.phase * 1.6;
        this.modeT = 200;
        this._charged.clear();
        game.audio.bossRoar();
        game.shake = Math.max(game.shake, 12);
    }

    _charge(dt) {
        this.x += this.chargeDir * this.chargeSpd * dt;
        this.facing = this.chargeDir < 0 ? -1 : 1;
        game.shake = Math.max(game.shake, 7);
        // Crush anything in the locomotive's path — once per target per charge.
        const halfW = 76;
        const ahead = this.x + this.chargeDir * 40;
        for (const u of game.units) {
            if (u.active && !this._charged.has(u) && Math.abs(u.x - ahead) < halfW) {
                this._charged.add(u);
                dealDamage(this.chargeDmg, this._chargeSrc, u);
                game.particles.emit(u.x, u.y - 20, 8, '#f97316', 5, 3, 'spark');
            }
        }
        for (const b of game.buildings) {
            if (b.active && !this._charged.has(b) && Math.abs(b.x - ahead) < halfW) {
                this._charged.add(b);
                dealDamage(this.chargeDmg, this._chargeSrc, b); // siege -> x2 vs buildings
                game.fx.flash(b.x, CONFIG.GROUND_Y - 20, { r: 40, col: '#f59e0b', life: 10 });
            }
        }
        game.particles.emit(this.x - this.chargeDir * 70, CONFIG.GROUND_Y - 26, 2, '#7c3aed', 4, 4, 'float');
        // Stop when the lunge has run its course or reached the castle line.
        if (this.modeT <= 0 || this.x <= this.patrolMin - 260) {
            this.mode = 'recover';
            this.modeT = 70;
        }
    }

    _recover(dt, spd) {
        // Trundle back out to the patrol band, briefly sluggish (a window to
        // punish it). Full aggression resumes on the next patrol tick.
        this.x += 0.6 * spd * dt;
        this.facing = 1;
        if (this.modeT <= 0) {
            this.mode = 'patrol';
            this.tx = rand((this.patrolMin + this.patrolMax) / 2, this.patrolMax);
            this.dashCd = clamp(340 - this.phase * 60, 150, 340);
        }
    }

    _fireCinders() {
        const target = this._pickTarget();
        if (!target) return;
        const n = this.phase; // 1 / 2 / 3 cinders
        const oy = CONFIG.GROUND_Y - 64;
        const ox = this.x + this.facing * 30;
        for (let i = 0; i < n; i++) {
            // Aim slightly apart so a volley fans across the target's line.
            const jitter = { x: target.x + rand(-70, 70) * (i > 0 ? 1 : 0), y: target.y, hp: 1 };
            const aim = i === 0 ? target : jitter;
            game.projectiles.push(new Projectile(
                ox, oy, aim, 'cinder', this.cinderDmg, TEAMS.ENEMY,
                46, 0, false, { dmgType: 'magic', isUnit: false },
            ));
        }
        game.audio.bossCinder();
        game.particles.emit(ox, oy, 6, '#4ade80', 4, 3, 'float');
    }

    // Nearest player unit by 1-D distance, falling back to the castle/buildings.
    _pickTarget() {
        let best = null, bd = Infinity;
        for (const u of game.units) {
            if (!u.active || u.hp <= 0) continue;
            const d = Math.abs(u.x - this.x);
            if (d < bd) { bd = d; best = u; }
        }
        if (best) return best;
        return game.buildings.find((b) => b.type === 'castle' && b.hp > 0)
            || game.buildings.find((b) => b.active);
    }

    _summon() {
        if (game.enemies.length >= 48) return; // shared swarm ceiling
        const x = clamp(this.x + rand(-50, 50), 300, CONFIG.WORLD_WIDTH - 100);
        game.spawnEnemy('rabble', x, CONFIG.GROUND_Y);
        game.particles.emit(x, CONFIG.GROUND_Y - 20, 16, '#a855f7', 4, 3, 'float');
        game.fx.ring(x, CONFIG.GROUND_Y - 18, { r0: 4, r1: 28, col: '#7c3aed', w: 2, life: 16 });
    }

    _emitSmoke() {
        const sx = this.x + this.facing * -34; // stack sits toward the cab (rear)
        const sy = CONFIG.GROUND_Y - 96;
        const col = SMOKE_COLS[(this.frame | 0) % SMOKE_COLS.length];
        game.particles.emit(sx, sy, this.phase >= 3 ? 5 : 3, col, 2, 4, 'float');
    }

    _updateDying(dt) {
        this.dyingT -= dt;
        this.frame += dt;
        this.vx = 0;
        this._boomT -= dt;
        if (this._boomT <= 0) {
            this._boomT = 13;
            const bx = this.x + rand(-90, 90);
            const by = CONFIG.GROUND_Y - rand(10, 90);
            game.fx.flash(bx, by, { r: rand(40, 80), col: '#f59e0b', life: 14 });
            game.fx.ring(bx, by, { r0: 4, r1: rand(40, 90), col: '#a855f7', w: 3, life: 18 });
            game.particles.emit(bx, by, 22, SMOKE_COLS[(this.frame | 0) % SMOKE_COLS.length], 7, 4, 'float');
            game.particles.emit(bx, by, 14, '#f97316', 6, 3, 'spark');
            game.shake = Math.max(game.shake, 8);
            game.audio.playExplosion();
        }
        if (this.dyingT <= 0) this.active = false;
    }

    // ── Rendering ───────────────────────────────────────────────────────
    // Custom silhouette drawn in screen space around cam.toScreen(x,y). Layered
    // back-to-front; screen-blend passes for the corrupted glow/core/eyes. One
    // entity, so the detail cost is negligible.
    draw(ctx, cam, dt) {
        if (!this.active) { this.drawDmg(ctx, cam, dt); return; }
        const p = cam.toScreen(this.x, this.y);
        const z = cam.z * this.scale;
        const q = particleQuality();
        const dying = this.dyingT > 0;
        const wob = dying ? Math.sin(this.frame * 0.6) * 3 : 0;

        ctx.save();
        ctx.translate(p.x, p.y + wob * z);
        ctx.scale(this.facing * z, z);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Ground shadow (large).
        ctx.fillStyle = 'rgba(0,0,0,0.42)';
        ctx.beginPath();
        ctx.ellipse(0, 2, 150, 20, 0, 0, Math.PI * 2);
        ctx.fill();

        // Corrupted aura behind the hull.
        if (q >= 1) {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            const aura = ctx.createRadialGradient(0, -60, 20, 0, -60, 210);
            const aA = 0.10 + this.coreGlow * 0.06 + (this.phase - 1) * 0.03;
            aura.addColorStop(0, toRgba('#7c3aed', aA));
            aura.addColorStop(0.5, toRgba('#4ade80', aA * 0.4));
            aura.addColorStop(1, 'transparent');
            ctx.fillStyle = aura;
            ctx.fillRect(-220, -220, 440, 260);
            ctx.restore();
        }

        this._drawWheels(ctx);
        this._drawBody(ctx);
        this._drawCore(ctx);
        this._drawMaw(ctx);
        this._drawStack(ctx);
        this._drawSpines(ctx);
        this._drawTendrils(ctx, q);

        // Telegraph tell — a bright forward warning glow across the tracks.
        if (this.mode === 'telegraph') {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            const t = clamp(1 - this.modeT / 46, 0, 1);
            const g2 = ctx.createLinearGradient(-40, 0, -260, 0);
            g2.addColorStop(0, toRgba('#f59e0b', 0.5 * t));
            g2.addColorStop(1, 'transparent');
            ctx.fillStyle = g2;
            ctx.fillRect(-260, -70, 220, 74);
            ctx.restore();
        }

        // Hit-flash overlay.
        if (this.flashT > 0) {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = clamp(this.flashT / HIT_FLASH_FRAMES, 0, 1) * 0.5;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.ellipse(-6, -52, 120, 46, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        ctx.restore();
        this.drawDmg(ctx, cam, dt);
    }

    _drawWheels(ctx) {
        // Too many wheels for any real engine — the impossible undercarriage.
        const spin = this.frame * (this.mode === 'charge' ? 0.5 : 0.14) * -this.facing;
        const xs = [-110, -74, -38, -2, 40, 84];
        ctx.strokeStyle = '#0b0f1a';
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(-120, -14); ctx.lineTo(96, -14); ctx.stroke(); // axle beam
        for (let i = 0; i < xs.length; i++) {
            const wx = xs[i];
            const r = i === 1 || i === 4 ? 26 : 17;
            ctx.save();
            ctx.translate(wx, -12);
            ctx.fillStyle = '#141a26';
            ctx.strokeStyle = '#2b3446';
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            // Glowing eldritch rim + spokes.
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.strokeStyle = toRgba('#a855f7', 0.55);
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, 0, r - 3, 0, Math.PI * 2); ctx.stroke();
            ctx.rotate(spin + i);
            ctx.strokeStyle = toRgba('#4ade80', 0.5);
            ctx.lineWidth = 1.6;
            for (let s = 0; s < 4; s++) {
                ctx.rotate(Math.PI / 2);
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r - 4, 0); ctx.stroke();
            }
            ctx.restore();
            ctx.restore();
        }
    }

    _drawBody(ctx) {
        // Boiler — a long riveted iron cylinder, rust-streaked, tapering to the
        // cow-catcher at the front (screen-left / -x).
        const dmgR = 1 - clamp(this.hp / this.maxHp, 0, 1); // 0..1 corrosion
        const bg = ctx.createLinearGradient(0, -96, 0, -18);
        bg.addColorStop(0, shade('#3b3247', 0.12));
        bg.addColorStop(0.5, '#241f31');
        bg.addColorStop(1, shade('#3a2a20', -0.2)); // rusted underside
        ctx.fillStyle = bg;
        ctx.strokeStyle = '#0b0f1a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-120, -18);
        ctx.lineTo(-120, -74);
        ctx.quadraticCurveTo(-118, -92, -96, -92); // boiler shoulder
        ctx.lineTo(70, -92);
        ctx.quadraticCurveTo(92, -92, 92, -66);     // cab back
        ctx.lineTo(92, -18);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Panel seams + rivets.
        ctx.strokeStyle = toRgba('#0b0f1a', 0.7);
        ctx.lineWidth = 1.5;
        for (const sx of [-88, -52, -16, 22, 58]) {
            ctx.beginPath(); ctx.moveTo(sx, -90); ctx.lineTo(sx, -20); ctx.stroke();
        }
        ctx.fillStyle = '#0b0f1a';
        for (const sx of [-104, -70, -34, 4, 40, 76]) {
            ctx.beginPath(); ctx.arc(sx, -86, 2, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(sx, -24, 2, 0, Math.PI * 2); ctx.fill();
        }

        // Rust / corrosion streaks intensify as it takes damage.
        ctx.save();
        ctx.globalAlpha = 0.25 + dmgR * 0.5;
        ctx.strokeStyle = '#7c3f1d';
        ctx.lineWidth = 2;
        for (const sx of [-96, -40, 18, 64]) {
            ctx.beginPath();
            ctx.moveTo(sx, -70);
            ctx.lineTo(sx + 3, -24);
            ctx.stroke();
        }
        ctx.restore();

        // Cracks appear from phase 2, glowing corruption from phase 3.
        if (this.phase >= 2) {
            ctx.strokeStyle = this.phase >= 3 ? toRgba('#4ade80', 0.9) : toRgba('#1a1330', 0.9);
            if (this.phase >= 3) { ctx.save(); ctx.globalCompositeOperation = 'screen'; }
            ctx.lineWidth = this.phase >= 3 ? 2 : 1.5;
            ctx.beginPath();
            ctx.moveTo(-60, -88); ctx.lineTo(-48, -62); ctx.lineTo(-58, -42); ctx.lineTo(-44, -22);
            ctx.moveTo(30, -90); ctx.lineTo(40, -60); ctx.lineTo(28, -40);
            ctx.stroke();
            if (this.phase >= 3) ctx.restore();
        }

        // Cab window — a warped porthole with a watching glow.
        ctx.fillStyle = '#05070d';
        ctx.beginPath(); ctx.ellipse(62, -66, 14, 16, 0, 0, Math.PI * 2); ctx.fill();
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const blink = 0.55 + Math.sin(this.frame * 0.07) * 0.45;
        const eg = ctx.createRadialGradient(62, -64, 1, 62, -64, 12);
        eg.addColorStop(0, toRgba('#fca5a5', blink));
        eg.addColorStop(0.5, toRgba('#dc2626', blink * 0.7));
        eg.addColorStop(1, 'transparent');
        ctx.fillStyle = eg;
        ctx.beginPath(); ctx.arc(62, -64, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = toRgba('#fee2e2', blink);
        ctx.beginPath(); ctx.arc(59, -66, 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    _drawCore(ctx) {
        // The furnace heart — a glowing maw in the boiler flank. Widens and
        // brightens with coreGlow; fully exposed (its grate peeled) in phase 3.
        const exposed = this.phase >= 3;
        const cx = -26, cy = -54;
        const rw = exposed ? 30 : 22;
        const rh = exposed ? 26 : 20;
        // Dark furnace mouth.
        ctx.fillStyle = '#0a0602';
        ctx.beginPath(); ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2); ctx.fill();
        // Glowing corrupted fire.
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const gl = clamp(this.coreGlow, 0, 2);
        const cg = ctx.createRadialGradient(cx, cy, 1, cx, cy, rw * 1.4);
        cg.addColorStop(0, toRgba('#fef9c3', 0.95));
        cg.addColorStop(0.35, toRgba('#f59e0b', 0.85 * Math.min(1, gl)));
        cg.addColorStop(0.7, toRgba('#65a30d', 0.5 * Math.min(1, gl)));
        cg.addColorStop(1, 'transparent');
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.arc(cx, cy, rw * 1.4, 0, Math.PI * 2); ctx.fill();
        // Inner flicker embers.
        ctx.fillStyle = toRgba('#fde68a', 0.8);
        for (let i = 0; i < 4; i++) {
            const a = this.frame * 0.1 + i * 1.7;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * rw * 0.4, cy + Math.sin(a * 1.3) * rh * 0.4, 2, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
        // Grate bars (intact until phase 3 tears them off).
        if (!exposed) {
            ctx.strokeStyle = '#0b0f1a';
            ctx.lineWidth = 2.4;
            for (let i = -2; i <= 2; i++) {
                ctx.beginPath(); ctx.moveTo(cx + i * 8, cy - rh); ctx.lineTo(cx + i * 8, cy + rh); ctx.stroke();
            }
        }
    }

    _drawMaw(ctx) {
        // Cow-catcher reforged into a fanged maw at the front (-x).
        ctx.fillStyle = '#161320';
        ctx.strokeStyle = '#0b0f1a';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-120, -18);
        ctx.lineTo(-120, -60);
        ctx.lineTo(-160, -30);
        ctx.lineTo(-150, -8);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        // Inner throat glow.
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const tg = ctx.createRadialGradient(-134, -30, 1, -134, -30, 26);
        const g = clamp(this.coreGlow, 0, 2);
        tg.addColorStop(0, toRgba('#f59e0b', 0.6 * Math.min(1, g)));
        tg.addColorStop(1, 'transparent');
        ctx.fillStyle = tg;
        ctx.beginPath(); ctx.arc(-134, -30, 24, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        // Fangs — upper and lower rows.
        ctx.fillStyle = '#d6d3c8';
        for (let i = 0; i < 5; i++) {
            const t = i / 4;
            const ux = lerp(-152, -122, t), uy = lerp(-26, -54, t);
            ctx.beginPath();
            ctx.moveTo(ux, uy); ctx.lineTo(ux + 4, uy + 9); ctx.lineTo(ux + 8, uy);
            ctx.closePath(); ctx.fill();
            const lx = lerp(-150, -122, t), ly = lerp(-14, -20, t);
            ctx.beginPath();
            ctx.moveTo(lx, ly); ctx.lineTo(lx + 4, ly - 9); ctx.lineTo(lx + 8, ly);
            ctx.closePath(); ctx.fill();
        }
        // Headlamp eye above the maw — a cyclopean corrupted lantern.
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const lamp = 0.6 + Math.sin(this.frame * 0.2) * 0.35 + (this.mode === 'charge' ? 0.4 : 0);
        const lg = ctx.createRadialGradient(-108, -70, 1, -108, -70, 18);
        lg.addColorStop(0, toRgba('#fff7ed', lamp));
        lg.addColorStop(0.4, toRgba('#f97316', lamp * 0.8));
        lg.addColorStop(1, 'transparent');
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.arc(-108, -70, 16, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    _drawStack(ctx) {
        // Smokestack toward the cab, canted at an impossible angle.
        ctx.save();
        ctx.translate(-30, -92);
        ctx.rotate(-0.12);
        const sg = ctx.createLinearGradient(0, -34, 0, 0);
        sg.addColorStop(0, '#2b2440');
        sg.addColorStop(1, '#151122');
        ctx.fillStyle = sg;
        ctx.strokeStyle = '#0b0f1a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-9, 0); ctx.lineTo(-13, -34); ctx.lineTo(13, -34); ctx.lineTo(9, 0);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // Mouth glow.
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const mg = ctx.createRadialGradient(0, -34, 1, 0, -34, 16);
        mg.addColorStop(0, toRgba('#4ade80', 0.7));
        mg.addColorStop(1, 'transparent');
        ctx.fillStyle = mg;
        ctx.beginPath(); ctx.arc(0, -34, 15, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.restore();
    }

    _drawSpines(ctx) {
        // Bone-iron spines cresting the boiler — grows more feral each phase.
        const n = 4 + this.phase * 2;
        ctx.fillStyle = '#e7e2d3';
        ctx.strokeStyle = '#0b0f1a';
        ctx.lineWidth = 1;
        for (let i = 0; i < n; i++) {
            const sx = lerp(-92, 60, i / (n - 1));
            const h = 8 + ((i % 3) * 4) + this.phase * 2;
            const sway = Math.sin(this.frame * 0.06 + i) * 1.5;
            ctx.beginPath();
            ctx.moveTo(sx - 4, -92);
            ctx.lineTo(sx + sway, -92 - h);
            ctx.lineTo(sx + 4, -92);
            ctx.closePath();
            ctx.fill(); ctx.stroke();
        }
    }

    _drawTendrils(ctx, q) {
        if (q < 1) return;
        // Writhing shadow tendrils leaking from the seams (screen-blended so they
        // read as corrupted light, not solid mass).
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.strokeStyle = toRgba('#7c3aed', 0.4 + (this.phase - 1) * 0.12);
        ctx.lineWidth = 2;
        const roots = [[-70, -30], [10, -30], [50, -30]];
        for (let r = 0; r < roots.length; r++) {
            const [rx, ry] = roots[r];
            ctx.beginPath();
            ctx.moveTo(rx, ry);
            let px = rx, py = ry;
            for (let s = 1; s <= 4; s++) {
                const a = Math.sin(this.frame * 0.08 + r * 2 + s) * 0.9;
                px += Math.cos(a) * 10;
                py += 8 + Math.sin(a) * 3;
                ctx.lineTo(px, py);
            }
            ctx.stroke();
        }
        ctx.restore();
    }
}
