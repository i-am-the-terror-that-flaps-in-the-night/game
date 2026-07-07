import { CONFIG } from '../config.js';
import { Boss } from '../entities/boss.js';
import { el } from '../ui/dom.js';
import { clamp, rand } from '../utils.js';

// --- GAME: boss encounter orchestration (installed onto Game.prototype) ------
// Owns the *encounter lifecycle* — the warning telegraph, spawning Rustmaw into
// game.enemies, the boss health bar, the engine-drone audio, and defeat
// rewards. The Boss entity itself (js/entities/boss.js) handles moment-to-moment
// behaviour via the normal enemy update/draw/removal path, so nothing here
// special-cases the main loop beyond one updateBoss(dt) tick.
//
// State kept on the Game instance (all transient — never serialized):
//   bossState : 'idle' | 'warning' | 'active' | 'done'
//   bossEntity: the live Boss instance while active
//   bossWarnT : frames remaining on the arrival warning
export const bossMethods = /** @type {ThisType<any>} */ ({
    // Kick off an encounter. `opts.warnFrames` overrides the ~3s telegraph;
    // `opts.hp` overrides the auto-scaled health pool. Returns false if a boss
    // is already in progress (only one Hollow Engine at a time).
    spawnBossEncounter(opts = {}) {
        if (this.bossState === 'warning' || this.bossState === 'active') return false;
        this.bossState = 'warning';
        this.bossWarnT = opts.warnFrames != null ? opts.warnFrames : 180;
        this.bossEntity = null;
        this.bossRewarded = false;
        this._bossHp = opts.hp || this._bossScaledHp();
        this._bossArriveX = CONFIG.WORLD_WIDTH - 320;
        this._bossWarnDur = this.bossWarnT || 1;
        this.audio.bossWarning();
        this.shake = Math.max(this.shake, 12);
        this.notify('⚠ THE RAILS ARE SCREAMING — something vast is inbound.');
        this._showBossWarning(true);
        return true;
    },

    // Health scales with difficulty and (in endless) how deep the run is, so it
    // stays a genuine wall rather than melting to a maxed-out army.
    _bossScaledHp() {
        const diffM = (this.diff || 1) * (this.difficultyMult || 1);
        const waveM = this.mode === 'endless' && this.waveM ? 1 + (this.waveM.wave || 0) * 0.05 : 1;
        return Math.round(4200 * diffM * waveM);
    },

    // One tick of the encounter, called from Game.update() each frame.
    updateBoss(dt) {
        if (!this.bossState || this.bossState === 'idle' || this.bossState === 'done') return;

        if (this.bossState === 'warning') {
            this.bossWarnT -= dt;
            // Escalating foreshadow at the arrival point: rumbling tremors,
            // dust shaken loose from the rails, and pulses of void-light that
            // grow as the Engine bears down.
            const gx = this._bossArriveX, gy = CONFIG.GROUND_Y;
            const t = 1 - clamp(this.bossWarnT / this._bossWarnDur, 0, 1);
            if (this.frames % 6 === 0) {
                this.shake = Math.max(this.shake, 4 + t * 8);
                this.particles.emit(gx + rand(-70, 70), gy - 4, 2, '#6b5a44', 1.6 + t * 2, 4, 'fade');
            }
            if (this.frames % 20 === 0)
                this.fx.ring(gx, gy - 10, { r0: 4, r1: 60 + t * 90, col: '#7c3aed', w: 2, life: 22 });
            if (this.bossWarnT <= 0) this._bossArrive();
            return;
        }

        // active
        const b = this.bossEntity;
        if (b && b.slain && !this.bossRewarded) this._bossDefeated();
        if (!b || (!b.active && this.bossRewarded)) {
            this.bossState = 'done';
            this.bossEntity = null;
            this._showBossBar(false);
            this.audio.stopBossEngine();
        }
    },

    _bossArrive() {
        this.bossState = 'active';
        this._showBossWarning(false);
        const x = CONFIG.WORLD_WIDTH - 320;
        const b = new Boss(x, this._bossHp);
        const diffM = (this.diff || 1) * (this.difficultyMult || 1);
        b.cinderDmg = Math.max(1, Math.round(b.cinderDmg * diffM));
        b.chargeDmg = Math.max(1, Math.round(b.chargeDmg * diffM));
        this.enemies.push(b);
        this.bossEntity = b;
        this.audio.startBossEngine();
        this.audio.bossRoar();
        this.shake = Math.max(this.shake, 26);
        this.bossFlash = 0.7; // screen-wide entrance flash (decayed in update)
        // Ground-tearing arrival: a big flash, stacked shockwaves, a steam
        // geyser, erupting shrapnel and scorched rails where it breaks through.
        const gx = b.x, gy = CONFIG.GROUND_Y;
        this.fx.flash(gx, gy - 50, { r: 150, col: '#fde68a', life: 22 });
        for (let i = 0; i < 3; i++)
            this.fx.ring(gx, gy - 20, { r0: 8 + i * 18, r1: 150 + i * 60, col: i % 2 ? '#7c3aed' : '#f59e0b', w: 4, life: 24 + i * 6 });
        this.particles.emit(gx, gy - 30, 30, '#e5e7eb', 4, 6, 'float');
        this.particles.emit(gx, gy - 10, 24, '#f97316', 6, 3, 'spark');
        const chunk = ['#2a2f3a', '#3a4150', '#1a1f2a', '#4a3222'];
        for (let i = 0; i < 14; i++)
            this.particles.emit(gx + rand(-42, 42), gy - 8, 1, chunk[i % 4], 7, rand(2, 5), 'debris');
        this.decals.add(gx, gy, 'scorch', 90);
        this.decals.add(gx - 62, gy, 'scorch', 48);
        this.decals.add(gx + 62, gy, 'scorch', 48);
        this.notify('RUSTMAW, THE HOLLOW ENGINE, TEARS ONTO THE FIELD!');
        this._showBossBar(true);
    },

    _bossDefeated() {
        this.bossRewarded = true;
        this.audio.stopBossEngine();
        this.audio.bossRoar();
        this.audio.playExplosion();
        this.shake = Math.max(this.shake, 28);
        this.bossFlash = Math.max(this.bossFlash || 0, 0.85); // death whiteout
        const b = this.bossEntity;
        if (b) {
            this.fx.flash(b.x, CONFIG.GROUND_Y - 40, { r: 160, col: '#fde68a', life: 24 });
            this.fx.ring(b.x, CONFIG.GROUND_Y - 30, { r0: 8, r1: 200, col: '#f59e0b', w: 5, life: 30 });
            this.fx.ring(b.x, CONFIG.GROUND_Y - 30, { r0: 4, r1: 150, col: '#7c3aed', w: 3, life: 24 });
        }
        const waveBonus = this.mode === 'endless' && this.waveM ? (this.waveM.wave || 0) * 20 : 0;
        const bounty = 400 + waveBonus;
        this.addGold(bounty);
        this.stats.kills += 1;
        if (this.meta) this.meta.addRenown(30);
        if (this.achievements) this.achievements.tryUnlock('boss_slayer');
        this.notify(`RUSTMAW IS UNMADE — +${bounty} gold, +30 ✦ Renown`);
    },

    // Per-frame HUD sync (called from updateUI). Visibility is toggled by
    // _showBossBar; this only refreshes the numbers while active.
    updateBossBar() {
        if (this.bossState !== 'active' || !this.bossEntity) return;
        const b = this.bossEntity;
        const fill = el('bossBarFill');
        if (fill) fill.style.width = clamp(b.hp / b.maxHp, 0, 1) * 100 + '%';
        const ph = el('bossBarPhase');
        if (ph) ph.innerText = b.slain ? 'DERAILING…' : 'PHASE ' + b.phase + ' / 3';
    },

    _showBossBar(on) {
        const bar = el('bossBar');
        if (bar) bar.classList.toggle('hidden', !on);
        if (on) {
            const nm = el('bossBarName');
            if (nm) nm.innerText = 'RUSTMAW · THE HOLLOW ENGINE';
        }
    },

    _showBossWarning(on) {
        const w = el('bossWarning');
        if (w) w.classList.toggle('hidden', !on);
    },

    // Tear down any encounter and its audio/HUD. Called from reset(),
    // returnToMenu(), victory() and defeat() so no engine drone or boss bar can
    // leak across battles. The enemies array is cleared separately by reset().
    clearBoss() {
        this.bossState = 'done';
        this.bossEntity = null;
        this.bossRewarded = false;
        this.bossFlash = 0;
        if (this.audio) this.audio.stopBossEngine();
        this._showBossBar(false);
        this._showBossWarning(false);
    },
});
