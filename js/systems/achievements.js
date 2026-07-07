import { loadJSON, saveJSON } from './storage.js';

// ─── ACHIEVEMENTS ────────────────────────────────────────────────
export const ACHIEVEMENTS = [
    { id: 'first_blood',   name: 'First Blood',     icon: '⚔️',  desc: 'Slay your first enemy.' },
    { id: 'century',       name: 'Century',         icon: '💀',  desc: 'Kill 100 enemies in one session.' },
    { id: 'dragon_slayer', name: 'Dragon Slayer',   icon: '🐉',  desc: 'Defeat a Dragon in battle.' },
    { id: 'last_stand',    name: 'Last Stand',      icon: '🏰',  desc: 'Win a level with castle below 15% HP.' },
    { id: 'tech_master',   name: 'Tech Master',     icon: '🔬',  desc: 'Research 5 technologies.' },
    { id: 'wave_10',       name: 'Endured',         icon: '🌊',  desc: 'Survive 10 waves in Endless mode.' },
    { id: 'rich',          name: 'War Profiteer',   icon: '💰',  desc: 'Earn 1500 total gold in one session.' },
    { id: 'holy_order',    name: 'Holy Order',      icon: '✨',  desc: 'Field 3 Paladins simultaneously.' },
    { id: 'max_pop',       name: 'Total War',       icon: '⚔️',  desc: 'Reach maximum population cap.' },
    { id: 'veteran',       name: 'Veteran',         icon: '⭐',  desc: 'Promote a unit to Level 3.' },
    { id: 'boss_slayer',   name: 'Engine Breaker',  icon: '🚂',  desc: 'Unmake Rustmaw, the Hollow Engine.' },
];

export class AchievementSystem {
    constructor(g) {
        this.g = g;
        try { this.unlocked = new Set(loadJSON('sd_ach_v2') || []); }
        catch(e) { this.unlocked = new Set(); }
    }
    tryUnlock(id) {
        if (this.unlocked.has(id)) return;
        const a = ACHIEVEMENTS.find(x => x.id === id);
        if (!a) return;
        this.unlocked.add(id);
        saveJSON('sd_ach_v2', [...this.unlocked]);
        const area = document.getElementById('notificationArea');
        if (!area) return;
        const d = document.createElement('div');
        d.className = 'notification';
        d.style.borderLeftColor = 'var(--gold)';
        d.style.background = 'rgba(251,191,36,0.08)';
        d.innerHTML = `${a.icon} <strong style="color:var(--gold)">Achievement!</strong> ${a.name}`;
        area.appendChild(d);
        setTimeout(() => { if (d.parentNode) d.remove(); }, 5000);
    }
    check() {
        const g = this.g;
        if (g.stats.kills >= 1) this.tryUnlock('first_blood');
        if (g.stats.kills >= 100) this.tryUnlock('century');
        if (g._dragonKilled) this.tryUnlock('dragon_slayer');
        if (g.techs.size >= 5) this.tryUnlock('tech_master');
        if (g.mode === 'endless' && g.waveM && g.waveM.wave >= 10) this.tryUnlock('wave_10');
        if (g.stats.gold >= 1500) this.tryUnlock('rich');
        const pals = g.units.filter(u => u.type === 'paladin' && u.hp > 0).length;
        if (pals >= 3) this.tryUnlock('holy_order');
        if (g.pop >= g.maxPop && g.maxPop >= 20) this.tryUnlock('max_pop');
        if (g.units.some(u => u.level >= 3)) this.tryUnlock('veteran');
    }
    render() {
        const grid = document.getElementById('achievementsGrid');
        const prog = document.getElementById('achProgress');
        if (!grid) return;
        grid.innerHTML = '';
        ACHIEVEMENTS.forEach(a => {
            const got = this.unlocked.has(a.id);
            grid.innerHTML += `<div class="ach-item ${got ? 'unlocked' : 'ach-locked'}">
                <span class="ach-icon">${a.icon}</span>
                <div><div class="ach-name">${a.name}</div><div class="ach-desc">${a.desc}</div></div>
            </div>`;
        });
        if (prog) prog.textContent = `${this.unlocked.size} / ${ACHIEVEMENTS.length} Unlocked`;
    }
}
