// ── Headless smoke test (dev tooling; not shipped) ───────────────────────
// Boots the game in headless Chromium, drives the public API the inline
// onclick handlers use, and asserts the game boots / runs / saves without any
// uncaught exception or console.error. Also verifies the three localStorage
// save formats round-trip byte-compatibly (the gate for persistence refactors).
//
//   node tools/smoke.mjs          → runs once, exits 0 (pass) / 1 (fail)
//
// No build step: serves the repo root over http (ES modules need http, not
// file://) and loads /index.html.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const PORT = 8123;
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

function startServer() {
    const server = createServer(async (req, res) => {
        try {
            let p = decodeURIComponent(req.url.split('?')[0]);
            if (p === '/') p = '/index.html';
            const full = normalize(join(ROOT, p));
            if (!full.startsWith(ROOT)) { res.writeHead(403).end(); return; }
            const body = await readFile(full);
            res.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream' });
            res.end(body);
        } catch {
            res.writeHead(404).end('not found');
        }
    });
    return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

// Tiny assertion helpers ---------------------------------------------------
let passed = 0;
const failures = [];
function ok(cond, msg) {
    if (cond) { passed++; console.log(`  ✓ ${msg}`); }
    else { failures.push(msg); console.log(`  ✗ ${msg}`); }
}
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const FIX = {
    main: JSON.parse(await readFile(join(ROOT, 'tools/fixtures/main-save.json'), 'utf8')),
    meta: JSON.parse(await readFile(join(ROOT, 'tools/fixtures/meta.json'), 'utf8')),
    ach: JSON.parse(await readFile(join(ROOT, 'tools/fixtures/achievements.json'), 'utf8')),
};

const server = await startServer();
// Use the Chromium build present in this environment directly; the pinned
// Playwright otherwise looks for a headless-shell build that isn't installed.
// Override via PW_CHROMIUM if the path differs on another machine.
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ headless: true, executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

// Any uncaught exception or genuine console.error fails the whole run.
// Browser network noise is ignored: this sandbox can't reach the Google Fonts
// CDN (css/base.css @import → connection reset) and the browser auto-requests
// /favicon.ico (→ 404). Both are constant across runs and unrelated to game
// logic, so they must not mask (or fake) a regression. Uncaught JS exceptions
// (pageerror) are always fatal and never filtered.
const pageErrors = [];
const consoleErrors = [];
const isNetworkNoise = (t) => /Failed to load resource/i.test(t);
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !isNetworkNoise(m.text())) consoleErrors.push(m.text()); });

const poll = (fn, ms = 6000, step = 50) => page.waitForFunction(fn, null, { timeout: ms, polling: step });

try {
    const url = `http://localhost:${PORT}/index.html`;

    // ── 1. Boot ──────────────────────────────────────────────────────────
    console.log('\n[boot]');
    await page.goto(url, { waitUntil: 'load' });
    await poll(`window.game && window.game.state === 'menu'`);
    ok(true, 'game boots to menu state');
    ok(await page.evaluate(() => !!document.getElementById('gameCanvas')), 'canvas present');

    // ── 2. Campaign run ──────────────────────────────────────────────────
    console.log('\n[campaign]');
    await page.evaluate(() => { window.game.startCampaignWithDiff(1.0); window.game.setSpeed(2); });
    await poll(`window.game.state === 'playing'`);
    ok(true, 'campaign level loads and plays');
    ok(await page.evaluate(() => game.buildings.some(b => b.type === 'castle')), 'castle exists');

    const goldBefore = await page.evaluate(() => game.gold);
    await poll(`game.gold > ${goldBefore}`, 8000); // mine income accrues
    ok(true, 'gold income accrues over time');

    await page.evaluate(() => game.callWave());
    await poll(`game.enemies.length > 0`, 8000);
    ok(true, 'wave summons enemies');

    // ── 3. Interaction ───────────────────────────────────────────────────
    console.log('\n[interaction]');
    const popBefore = await page.evaluate(() => game.pop);
    const bought = await page.evaluate(() => game.buyUnit('militia'));
    ok(bought === true, 'buyUnit(militia) succeeds');
    ok(await page.evaluate((p) => game.pop > p, popBefore), 'population increases after recruit');

    const manaSpent = await page.evaluate(async () => {
        game.spells.mana = 999;
        game.spells.select('meteor');
        const before = game.spells.mana;
        // Real event path: canvas mousedown, button 0, above the action bar.
        const cv = document.getElementById('gameCanvas');
        cv.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 640, clientY: 300, bubbles: true }));
        return before - game.spells.mana;
    });
    ok(manaSpent > 0, 'casting a spell consumes mana');

    // Data-driven keybind (KeyZ -> meteor) and Escape-cancel via the real
    // keydown path.
    const keys = await page.evaluate(() => {
        game.spells.mana = 999;
        document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ' }));
        const selected = game.spells.active;
        document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
        return { selected, afterEscape: game.spells.active };
    });
    ok(keys.selected === 'meteor', 'KeyZ selects meteor (data-driven keybind)');
    ok(keys.afterEscape === null, 'Escape cancels spell selection');

    // ── 4. Lifecycle: endless + defeat ───────────────────────────────────
    console.log('\n[lifecycle]');
    await page.evaluate(() => game.returnToMenu());
    await poll(`game.state === 'menu'`);
    ok(true, 'returnToMenu works');

    await page.evaluate(() => game.startEndless());
    await poll(`game.state === 'playing' && game.mode === 'endless'`);
    ok(true, 'endless mode starts');

    await page.evaluate(() => game.buildings.forEach(b => { if (b.type === 'castle') b.takeDamage(1e9); }));
    await poll(`game.state === 'defeat'`, 4000);
    ok(true, 'castle destruction triggers defeat');
    ok(await page.evaluate(() => !document.getElementById('gameOver').classList.contains('hidden')), 'game-over overlay shown');

    // ── 5. Save-format byte-compat ───────────────────────────────────────
    console.log('\n[save-format]');
    await page.evaluate((fx) => {
        localStorage.clear();
        localStorage.setItem('stickman_dominion_save', JSON.stringify(fx.main));
        localStorage.setItem('sd_meta_v1', JSON.stringify(fx.meta));
        localStorage.setItem('sd_ach_v2', JSON.stringify(fx.ach));
    }, FIX);
    await page.reload({ waitUntil: 'load' });
    await poll(`window.game && window.game.state === 'menu'`);

    // main save round-trips (vol/pq must remain strings)
    const mainOut = await page.evaluate(() => { game.saveGame(); return localStorage.getItem('stickman_dominion_save'); });
    const mainParsed = JSON.parse(mainOut);
    ok(deepEq(mainParsed, FIX.main), 'stickman_dominion_save round-trips deep-equal');
    ok(typeof mainParsed.volSound === 'string' && typeof mainParsed.volMusic === 'string' && typeof mainParsed.pq === 'string',
        'volSound/volMusic/pq remain strings');

    // meta save round-trips
    const metaOut = await page.evaluate(() => { game.meta.save(); return localStorage.getItem('sd_meta_v1'); });
    ok(deepEq(JSON.parse(metaOut), FIX.meta), 'sd_meta_v1 round-trips deep-equal');

    // achievements: append a fresh id, bare-array format preserved in order
    const achOut = await page.evaluate(() => { game.achievements.tryUnlock('dragon_slayer'); return localStorage.getItem('sd_ach_v2'); });
    ok(deepEq(JSON.parse(achOut), [...FIX.ach, 'dragon_slayer']), 'sd_ach_v2 stays a bare ordered array');

    // ── 6. No errors anywhere ────────────────────────────────────────────
    console.log('\n[errors]');
    ok(pageErrors.length === 0, `no uncaught page errors${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
    ok(consoleErrors.length === 0, `no console.error${consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''}`);
} catch (err) {
    failures.push('EXCEPTION: ' + (err && err.stack || err));
    console.log('  ✗ EXCEPTION:', err && err.message || err);
} finally {
    await browser.close();
    server.close();
}

console.log(`\n${failures.length ? 'FAIL' : 'PASS'} — ${passed} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach(f => console.log('   • ' + f)); process.exit(1); }
process.exit(0);
