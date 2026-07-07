import { Entity } from './entity.js';
import { CONFIG, HIT_FLASH_FRAMES, TEAMS } from '../config.js';
import { dealDamage } from '../systems/combat.js';
import { Projectile } from '../systems/projectile.js';
import { clamp, lerp, particleQuality, rand, toRgba } from '../utils.js';

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

// Corrupted-exhaust palette — sooty smoke lit by amber embers and void-violet.
// Emitted additively, so these read as glowing exhaust, not solid billows.
const SMOKE_COLS = ['#f59e0b', '#b45309', '#7c3aed', '#6b7280', '#a16207'];

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
        game.particles.emit(ox, oy, 6, '#f59e0b', 4, 3, 'float');
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
        // Belches from the funnel, which sits toward the FRONT of the boiler.
        const sx = this.x + this.facing * 52;
        const sy = CONFIG.GROUND_Y - 116;
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
    // A steam-locomotive silhouette drawn in screen space around
    // cam.toScreen(x,y): long horizontal boiler, tall flared funnel + steam
    // domes on top, a cab with a roof at the rear, big spoked driving wheels
    // linked by a red side-rod, and a cow-catcher pilot at the front. Local
    // space has the FRONT at +x (the facing flip aims it at the castle). The
    // eldritch horror is carried by accents — amber furnace fire, malevolent
    // lamp-eyes, a peeled boiler in phase 3 — not by the base shape.
    draw(ctx, cam, dt) {
        if (!this.active) { this.drawDmg(ctx, cam, dt); return; }
        const p = cam.toScreen(this.x, this.y);
        const z = cam.z * this.scale;
        const q = particleQuality();
        const wob = this.dyingT > 0 ? Math.sin(this.frame * 0.6) * 3 : 0;

        ctx.save();
        ctx.translate(p.x, p.y + wob * z);
        ctx.scale(this.facing * z, z);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Ground shadow.
        ctx.fillStyle = 'rgba(0,0,0,0.42)';
        ctx.beginPath();
        ctx.ellipse(-4, 2, 150, 18, 0, 0, Math.PI * 2);
        ctx.fill();

        // Faint corrupted heat-haze behind the hull (small, so it doesn't wash
        // the machine into a glowing blob).
        if (q >= 1) {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            const aA = 0.05 + this.coreGlow * 0.03 + (this.phase - 1) * 0.02;
            const aura = ctx.createRadialGradient(-40, -46, 10, -40, -46, 150);
            aura.addColorStop(0, toRgba('#f59e0b', aA));
            aura.addColorStop(0.6, toRgba('#7c3aed', aA * 0.5));
            aura.addColorStop(1, 'transparent');
            ctx.fillStyle = aura;
            ctx.fillRect(-200, -190, 400, 220);
            ctx.restore();
        }

        this._drawRunningGear(ctx);
        this._drawHull(ctx);
        this._drawTopworks(ctx);
        this._drawPilot(ctx);
        this._drawGlow(ctx, q);

        // Telegraph tell — a bright forward warning glow down the track ahead.
        if (this.mode === 'telegraph') {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            const t = clamp(1 - this.modeT / 46, 0, 1);
            const g2 = ctx.createLinearGradient(120, 0, 300, 0);
            g2.addColorStop(0, toRgba('#f59e0b', 0.5 * t));
            g2.addColorStop(1, 'transparent');
            ctx.fillStyle = g2;
            ctx.fillRect(120, -60, 200, 64);
            ctx.restore();
        }

        // Hit-flash overlay.
        if (this.flashT > 0) {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = clamp(this.flashT / HIT_FLASH_FRAMES, 0, 1) * 0.5;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.ellipse(0, -54, 118, 44, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        ctx.restore();
        this.drawDmg(ctx, cam, dt);
    }

    // Big spoked driving wheels + small pilot truck, joined by an animated
    // red side-rod — the single strongest "this is a locomotive" cue.
    _drawRunningGear(ctx) {
        const spin = this.frame * (this.mode === 'charge' ? 0.42 : 0.11) * this.facing;
        const driveXs = [-52, 4, 60];
        const R = 27, WY = -27;

        // Axle beam + leaf-spring hangers.
        ctx.strokeStyle = '#0b0f1a';
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(-70, -30); ctx.lineTo(96, -30); ctx.stroke();

        // Pilot (leading) truck — two small wheels under the smokebox.
        for (const wx of [80, 104]) this._wheel(ctx, wx, -13, 12, spin, false);
        // Driving wheels.
        for (const wx of driveXs) this._wheel(ctx, wx, WY, R, spin, true);

        // Side-rod: a straight iron bar pinned to each driver's crank; all pins
        // share a phase, so the rod stays rigid and bobs — as a real one does.
        const rp = R * 0.55;
        const px = Math.cos(spin) * rp, py = Math.sin(spin) * rp;
        ctx.strokeStyle = '#7f1d1d';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(driveXs[0] + px, WY + py);
        ctx.lineTo(driveXs[driveXs.length - 1] + px, WY + py);
        ctx.stroke();
        ctx.strokeStyle = '#b91c1c';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#dc2626';
        for (const wx of driveXs) {
            ctx.beginPath(); ctx.arc(wx + px, WY + py, 3, 0, Math.PI * 2); ctx.fill();
        }
    }

    _wheel(ctx, wx, wy, r, spin, driver) {
        ctx.save();
        ctx.translate(wx, wy);
        // Steel tyre + hub.
        ctx.fillStyle = '#12161f';
        ctx.strokeStyle = '#3a4150';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#565f70';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, r - 4, 0, Math.PI * 2); ctx.stroke();
        if (driver) {
            ctx.rotate(spin);
            ctx.strokeStyle = '#6b7280';
            ctx.lineWidth = 3;
            for (let s = 0; s < 8; s++) {
                ctx.rotate(Math.PI / 4);
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r - 5, 0); ctx.stroke();
            }
            // Counterweight crescent (the dark loco wheel arc).
            ctx.fillStyle = '#0b0f1a';
            ctx.beginPath(); ctx.arc(0, 0, r - 5, 0.6, 2.0); ctx.arc(0, 0, r * 0.4, 2.0, 0.6, true); ctx.closePath(); ctx.fill();
        } else {
            ctx.rotate(spin);
            ctx.strokeStyle = '#565f70';
            ctx.lineWidth = 2;
            for (let s = 0; s < 4; s++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r - 3, 0); ctx.stroke(); }
        }
        ctx.fillStyle = '#2a2f3a';
        ctx.beginPath(); ctx.arc(0, 0, r * 0.26, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    // Footplate, cab (rear), boiler cylinder and smokebox (front).
    _drawHull(ctx) {
        const dmgR = 1 - clamp(this.hp / this.maxHp, 0, 1);
        const iron = (top, y0, y1) => {
            const g = ctx.createLinearGradient(0, y0, 0, y1);
            g.addColorStop(0, top);
            g.addColorStop(0.55, '#232833');
            g.addColorStop(1, '#12151d');
            return g;
        };

        // Running board / footplate.
        ctx.fillStyle = '#1a1f2a';
        ctx.strokeStyle = '#0b0f1a';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.rect(-104, -34, 200, 8); ctx.fill(); ctx.stroke();

        // Cab (rear, -x): boxy body + overhanging roof.
        ctx.fillStyle = iron('#39414f', -98, -34);
        ctx.strokeStyle = '#0b0f1a';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.rect(-104, -96, 44, 62); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#2a2f3a';
        ctx.beginPath(); ctx.moveTo(-110, -96); ctx.lineTo(-54, -96); ctx.lineTo(-58, -104); ctx.lineTo(-106, -104); ctx.closePath();
        ctx.fill(); ctx.stroke();

        // Boiler cylinder (front of cab to smokebox).
        ctx.fillStyle = iron('#3c4453', -86, -34);
        ctx.strokeStyle = '#0b0f1a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-62, -34);
        ctx.lineTo(-62, -80);
        ctx.quadraticCurveTo(-62, -86, -54, -86);
        ctx.lineTo(78, -86);
        ctx.quadraticCurveTo(90, -86, 90, -70);   // smokebox shoulder
        ctx.lineTo(90, -34);
        ctx.closePath(); ctx.fill(); ctx.stroke();

        // Boiler bands (raised rings) + rivet rows.
        ctx.strokeStyle = toRgba('#0b0f1a', 0.8);
        ctx.lineWidth = 2.5;
        for (const bx of [-40, -14, 14, 42]) {
            ctx.beginPath(); ctx.moveTo(bx, -85); ctx.lineTo(bx, -35); ctx.stroke();
        }
        ctx.fillStyle = '#0b0f1a';
        for (const bx of [-52, -26, 2, 30, 58, 74]) {
            ctx.beginPath(); ctx.arc(bx, -82, 1.6, 0, Math.PI * 2); ctx.fill();
        }
        // Top highlight (rolled-steel sheen).
        ctx.strokeStyle = toRgba('#8b95a6', 0.5);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-54, -83); ctx.lineTo(76, -83); ctx.stroke();

        // Smokebox (darker front drum) + round door "face".
        ctx.fillStyle = '#171b24';
        ctx.beginPath(); ctx.rect(66, -84, 24, 50); ctx.fill();
        ctx.strokeStyle = '#0b0f1a'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#20252f';
        ctx.strokeStyle = '#3a4150';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(84, -58, 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        // Door hinge straps + dogs.
        ctx.strokeStyle = '#4a5464'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(84, -80); ctx.lineTo(84, -36); ctx.moveTo(62, -58); ctx.lineTo(106, -58); ctx.stroke();

        // Rust wash, heavier as it corrodes.
        ctx.save();
        ctx.globalAlpha = 0.2 + dmgR * 0.45;
        ctx.strokeStyle = '#7c3f1d';
        ctx.lineWidth = 2;
        for (const bx of [-46, -6, 34, 70]) { ctx.beginPath(); ctx.moveTo(bx, -70); ctx.lineTo(bx + 3, -36); ctx.stroke(); }
        ctx.restore();
    }

    // Funnel (tall flared chimney near the front) + steam & sand domes + a
    // headlamp box. These sit ON TOP of the boiler and sell the locomotive read.
    _drawTopworks(ctx) {
        // Sand dome (small) then steam dome (large) — brass-capped hemispheres.
        const dome = (dx, w, h) => {
            ctx.fillStyle = '#2a2f3a';
            ctx.strokeStyle = '#0b0f1a'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.ellipse(dx, -86, w, h, 0, Math.PI, 0); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#8a6d1f';
            ctx.beginPath(); ctx.ellipse(dx, -86 - h, w * 0.85, 3.5, 0, Math.PI, 0); ctx.fill();
        };
        dome(-24, 11, 13);
        dome(20, 13, 16);

        // Funnel: flared stack rising from the boiler top toward the front.
        ctx.save();
        ctx.translate(52, -86);
        const fg = ctx.createLinearGradient(0, -34, 0, 0);
        fg.addColorStop(0, '#3a4150');
        fg.addColorStop(1, '#1a1f2a');
        ctx.fillStyle = fg;
        ctx.strokeStyle = '#0b0f1a';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-7, 0); ctx.lineTo(-9, -26); ctx.lineTo(-14, -34); // flare out
        ctx.lineTo(14, -34); ctx.lineTo(9, -26); ctx.lineTo(7, 0);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // Cap rim.
        ctx.fillStyle = '#0b0f1a';
        ctx.beginPath(); ctx.ellipse(0, -34, 14, 3.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        // Headlamp box mounted on the smokebox top-front.
        ctx.fillStyle = '#2a2f3a';
        ctx.strokeStyle = '#0b0f1a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.rect(78, -92, 14, 12); ctx.fill(); ctx.stroke();
        // Whistle behind the steam dome.
        ctx.strokeStyle = '#8a6d1f'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(4, -102); ctx.lineTo(4, -112); ctx.stroke();
    }

    // Cow-catcher pilot at the very front, with a few fangs for menace.
    _drawPilot(ctx) {
        ctx.fillStyle = '#1a1f2a';
        ctx.strokeStyle = '#0b0f1a';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(90, -34);
        ctx.lineTo(116, -34);
        ctx.lineTo(128, -2);
        ctx.lineTo(96, -2);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        // Slats.
        ctx.strokeStyle = '#3a4150'; ctx.lineWidth = 1.5;
        for (let i = 1; i <= 3; i++) {
            const t = i / 4;
            ctx.beginPath();
            ctx.moveTo(lerp(96, 106, t), -34 + t * 4);
            ctx.lineTo(lerp(96, 118, t), -2);
            ctx.stroke();
        }
        // Fangs jutting from the pilot.
        ctx.fillStyle = '#d6d3c8';
        for (let i = 0; i < 4; i++) {
            const fx = lerp(100, 122, i / 3);
            ctx.beginPath();
            ctx.moveTo(fx - 3, -3); ctx.lineTo(fx, -13); ctx.lineTo(fx + 3, -3);
            ctx.closePath(); ctx.fill();
        }
    }

    // Glow pass (additive): firebox fire, the malevolent lamp-eyes, and the
    // phase-3 peeled-boiler reveal. Kept last so it sits over the ironwork.
    _drawGlow(ctx, q) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const gl = clamp(this.coreGlow, 0, 2);

        // Firebox glow spilling from under the cab, between the rear drivers.
        const fx = -34, fy = -30;
        const fg = ctx.createRadialGradient(fx, fy, 1, fx, fy, 46);
        fg.addColorStop(0, toRgba('#fde68a', 0.9 * Math.min(1, gl)));
        fg.addColorStop(0.4, toRgba('#f97316', 0.7 * Math.min(1, gl)));
        fg.addColorStop(1, 'transparent');
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.arc(fx, fy, 46, 0, Math.PI * 2); ctx.fill();

        // Headlamp beam-eye on the smokebox door.
        const lamp = 0.55 + Math.sin(this.frame * 0.18) * 0.3 + (this.mode === 'charge' ? 0.4 : 0);
        const lg = ctx.createRadialGradient(84, -58, 1, 84, -58, 20);
        lg.addColorStop(0, toRgba('#fff7ed', lamp));
        lg.addColorStop(0.35, toRgba('#f97316', lamp * 0.85));
        lg.addColorStop(1, 'transparent');
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.arc(84, -58, 19, 0, Math.PI * 2); ctx.fill();
        // Slit pupil so the lamp reads as a watching eye.
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#1a0a02';
        ctx.beginPath(); ctx.ellipse(84, -58, 3, 10, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'screen';

        // Cab window eye.
        const blink = 0.5 + Math.sin(this.frame * 0.07) * 0.4;
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#05070d';
        ctx.beginPath(); ctx.rect(-98, -90, 16, 18); ctx.fill();
        ctx.globalCompositeOperation = 'screen';
        const cg = ctx.createRadialGradient(-90, -81, 1, -90, -81, 12);
        cg.addColorStop(0, toRgba('#fecaca', blink));
        cg.addColorStop(0.5, toRgba('#dc2626', blink * 0.7));
        cg.addColorStop(1, 'transparent');
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.arc(-90, -81, 11, 0, Math.PI * 2); ctx.fill();

        ctx.restore();

        // Phase cracks / phase-3 peeled boiler reveal.
        if (this.phase >= 2) {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.strokeStyle = toRgba('#f97316', 0.85);
            ctx.lineWidth = this.phase >= 3 ? 2.4 : 1.6;
            ctx.beginPath();
            ctx.moveTo(-30, -84); ctx.lineTo(-20, -60); ctx.lineTo(-30, -40);
            ctx.moveTo(30, -84); ctx.lineTo(38, -58); ctx.lineTo(28, -38);
            ctx.stroke();
            if (this.phase >= 3) {
                // A torn boiler panel exposing a glowing furnace ribcage.
                ctx.globalCompositeOperation = 'source-over';
                ctx.fillStyle = '#0a0602';
                ctx.beginPath();
                ctx.moveTo(-8, -80); ctx.lineTo(24, -78); ctx.lineTo(30, -44); ctx.lineTo(-2, -46);
                ctx.closePath(); ctx.fill();
                ctx.globalCompositeOperation = 'screen';
                const rg = ctx.createRadialGradient(12, -62, 2, 12, -62, 26);
                rg.addColorStop(0, toRgba('#fde68a', 0.95));
                rg.addColorStop(0.5, toRgba('#f97316', 0.8 * Math.min(1, gl)));
                rg.addColorStop(1, 'transparent');
                ctx.fillStyle = rg;
                ctx.beginPath(); ctx.arc(12, -62, 24, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = toRgba('#1a0a02', 0.9);
                ctx.lineWidth = 2;
                for (let i = -1; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 9 + 6, -80); ctx.lineTo(i * 9 + 8, -46); ctx.stroke(); }
            }
            ctx.restore();
        }
    }
}
