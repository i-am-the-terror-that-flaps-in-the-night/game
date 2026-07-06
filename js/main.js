// Init
const game = new Game();
game.achievements = new AchievementSystem(game);

// ─── HOME SCREEN DATA MOTES (holographic embers) ──────────────────
(function spawnEmbers() {
    const container = document.getElementById('menuEmbers');
    if (!container) return;
    const colors = ['#2de2ff','#7df9ff','#2dd4bf','#22d3ee','#e64bff'];
    const count = 38;
    for (let i = 0; i < count; i++) {
        const el = document.createElement('div');
        el.className = 'ember';
        const size = 2 + Math.random() * 3;
        el.style.setProperty('--dur',  (6 + Math.random() * 10) + 's');
        el.style.setProperty('--delay', (Math.random() * 12) + 's');
        el.style.setProperty('--drift', ((Math.random() - 0.5) * 120) + 'px');
        el.style.left   = (Math.random() * 100) + '%';
        el.style.width  = size + 'px';
        el.style.height = size + 'px';
        el.style.background = colors[Math.floor(Math.random() * colors.length)];
        el.style.boxShadow = `0 0 ${size * 2}px ${el.style.background}`;
        container.appendChild(el);
    }
})();
