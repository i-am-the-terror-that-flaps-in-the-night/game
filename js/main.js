// ── Entry point (ES module) ──────────────────────────────────────────
// Import the prototype-mixin modules for their side effects so Game.prototype
// and Unit.prototype are fully assembled BEFORE anything is instantiated.
import './game/game-flow.js';
import './game/game-economy.js';
import './game/game-input.js';
import './game/game-ui.js';
import './game/game-render.js';
import './entities/unit-render.js';

import { Game } from './game/game.js';
import { AchievementSystem } from './systems/achievements.js';
import { renderActionBar } from './ui/action-bar.js';

// ── Boot ordering contract (load-bearing — do not reorder) ───────────
// 1. The side-effect imports above install every Game.prototype / Unit.prototype
//    mixin, so the constructor's mixin methods (bindEvents, loop -> draw) exist.
// 2. renderActionBar() builds the recruit/build buttons FIRST — the Game
//    constructor's bindEvents() queries them by id.
// 3. `new Game()` runs the constructor, which internally requires: loadSave()
//    (reads DOM inputs) before bindEvents(), and bindEvents() before loop().
// 4. window.game is assigned AFTER construction, then AchievementSystem is
//    attached. achievements stays null during the constructor because it may
//    touch the bare `game` global, which only resolves once window.game is set
//    (Game.update() null-guards `this.achievements` for the same reason).
renderActionBar();

// The single game instance intentionally stays a global (window.game): inline
// HTML handlers (onclick="game.…") and the entity/system code reference it by
// that bare name, which resolves to this global property.
const game = new Game();
window.game = game;
game.achievements = new AchievementSystem(game);

// ── Home-screen data motes (holographic embers) ──────────────────────
(function spawnEmbers() {
    const container = document.getElementById('menuEmbers');
    if (!container) return;
    const colors = ['#2de2ff', '#7df9ff', '#2dd4bf', '#22d3ee', '#e64bff'];
    const count = 38;
    for (let i = 0; i < count; i++) {
        const el = document.createElement('div');
        el.className = 'ember';
        const size = 2 + Math.random() * 3;
        el.style.setProperty('--dur', (6 + Math.random() * 10) + 's');
        el.style.setProperty('--delay', (Math.random() * 12) + 's');
        el.style.setProperty('--drift', ((Math.random() - 0.5) * 120) + 'px');
        el.style.left = (Math.random() * 100) + '%';
        el.style.width = size + 'px';
        el.style.height = size + 'px';
        el.style.background = colors[Math.floor(Math.random() * colors.length)];
        el.style.boxShadow = `0 0 ${size * 2}px ${el.style.background}`;
        container.appendChild(el);
    }
})();
