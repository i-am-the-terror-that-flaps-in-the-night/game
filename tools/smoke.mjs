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

    // Campaign victory gate: scheduled-but-unspawned enemies keep pending > 0
    // and isComplete() false (checked synchronously, before any spawn fires).
    const pend = await page.evaluate(() => {
        game.returnToMenu();
        game.startCampaignWithDiff(1.0);
        const before = game.waveM.pending;
        game.callWave();
        return { before, after: game.waveM.pending, complete: game.waveM.isComplete() };
    });
    ok(pend.before === 0 && pend.after > 0, 'campaign tracks pending spawns');
    ok(pend.complete === false, 'isComplete() false while spawns pending (no premature victory)');

    // Data-driven death drops: a shaman drops exactly 2 crystal on death.
    const drop = await page.evaluate(() => {
        const before = game.crystal;
        game.spawnEnemy('shaman', 2000, 0);
        const e = game.enemies[game.enemies.length - 1];
        e.takeDamage(1e9); // kill -> die() reads ENEMY_TYPES.shaman.drops
        return game.crystal - before;
    });
    ok(drop === 2, 'shaman death drops 2 crystal (data-driven)');

    // Ranged combat builds a Projectile (exercises PROJECTILE_TYPES lookup): an
    // enemy archer near the castle targets it and fires an arrow.
    await page.evaluate(() => game.spawnEnemy('archer', 400, 0));
    await poll(`game.projectiles.length > 0`, 6000);
    ok(true, 'ranged combat spawns projectiles');

    // Entities carry the kind flag combat.js discriminates on (vs instanceof).
    const kinds = await page.evaluate(() => {
        const castle = game.buildings.find(b => b.type === 'castle');
        game.spawnEnemy('rabble', 1000, 0);
        const enemy = game.enemies[game.enemies.length - 1];
        return { castle: castle && castle.kind, enemy: enemy && enemy.kind };
    });
    ok(kinds.castle === 'building' && kinds.enemy === 'unit', 'entities carry kind flag (building/unit)');

    // ── 3b. GPU/VFX overlay: instantiation + fallback + high-level APIs ───
    // WebGPU is absent (or unconfigured) in this headless run, so the overlay
    // must fall back to the WebGL renderer and every new high-level system must
    // work without throwing or emitting console.error.
    console.log('\n[gpu/vfx]');
    const gpu = await page.evaluate(() => {
        const g = window.game;
        // Active overlay must be the WebGL renderer unless WebGPU actually inited.
        const fallbackHeld = g.gl === g.glWebgl || (g.wgpu && g.wgpu.ok);
        let spawnOk = false, lightOk = false, shakeOk = false;
        try { g.vfx.spawn('explosion', 600, 300, { scale: 1 }); spawnOk = true; } catch { /* */ }
        const before = g.lights.lights.length;
        try { g.lights.add({ x: 600, y: 300, radius: 120, intensity: 1, color: '#ffaa66' }); lightOk = g.lights.lights.length > before; } catch { /* */ }
        try { g.cameraFX.impulse({ x: -1, y: 0, mag: 4 }); shakeOk = true; } catch { /* */ }
        return { hasWgpu: !!g.wgpu, fallbackHeld, spawnOk, lightOk, shakeOk };
    });
    ok(gpu.hasWgpu, 'WGPURenderer instantiated');
    ok(gpu.fallbackHeld, 'active overlay falls back to WebGL when WebGPU absent');
    ok(gpu.spawnOk, 'game.vfx.spawn runs on the fallback path (no throw)');
    ok(gpu.lightOk, 'game.lights.add registers a dynamic light');
    ok(gpu.shakeOk, 'game.cameraFX.impulse accepts a typed camera kick');

    // ── 3b. Terrain / elevation / hazards ────────────────────────────────
    console.log('\n[terrain]');
    const ter = await page.evaluate(async () => {
        const g = window.game;
        const { resolveDamage } = await import('/js/systems/combat.js');
        const T = g.terrain;
        const r = {};
        T.load(null);
        r.flat = T.groundAt(1000) === T.groundAt(3000) && T.heightAt(1000) === 0;
        T.load({ hills: [{ x: 1500, w: 600, h: 60 }], patches: [{ x0: 900, x1: 1100, kind: 'mud' }] });
        const u = g.units.find((x) => x !== g.hero) || g.units[0];
        const ox = u.x;
        u.x = 1500; u.update(1);
        r.onHill = u.y < T.groundAt(0) - 50;
        u.x = 1000;
        r.mud = Math.abs(T.speedMult(u, 1) - 0.6) < 1e-6;
        u.x = ox; u.update(1);
        const tgt = { kind: 'unit', armorClass: 'none', armor: 0, y: 500 };
        const base = resolveDamage(100, { dmgType: 'magic' }, tgt).amt;
        r.down = Math.abs(resolveDamage(100, { dmgType: 'magic', fromY: 440 }, tgt).amt / base - 1.15) < 1e-6;
        r.up = Math.abs(resolveDamage(100, { dmgType: 'magic', fromY: 560 }, tgt).amt / base - 0.9) < 1e-6;
        const bld = { kind: 'building', armor: 0, y: 500 };
        r.bldg = resolveDamage(100, { dmgType: 'magic', fromY: 400 }, bld).amt === resolveDamage(100, { dmgType: 'magic' }, bld).amt;
        // Hazard: telegraph, then strike hits only what's inside the radius.
        g.hazards.set({ type: 'lightning', every: [999, 999] });
        g.spawnEnemy('ogre', 2000); g.spawnEnemy('ogre', 2600);
        const near = g.enemies[g.enemies.length - 2], far = g.enemies[g.enemies.length - 1];
        const h = g.hazards.trigger(2000);
        r.tele = !!h && !h.struck;
        const hn = near.hp, hf = far.hp;
        for (let i = 0; i < 100; i++) g.hazards.update(1);
        r.struck = h.struck && near.hp < hn && far.hp === hf;
        g.hazards.trigger(2100);
        g.returnToMenu();
        r.cleared = g.hazards.list.length === 0;
        return r;
    });
    ok(ter.flat, 'flat terrain: groundAt is constant (original game)');
    ok(ter.onHill, 'unit on a hill stands above sea level');
    ok(ter.mud, 'mud patch slows walking to x0.6');
    ok(ter.down && ter.up, 'high ground: x1.15 downhill, x0.9 uphill');
    ok(ter.bldg, 'high ground never applies to buildings');
    ok(ter.tele, 'hazard telegraphs before striking');
    ok(ter.struck, 'hazard strike hits inside its radius only');
    ok(ter.cleared, 'returnToMenu clears hazards');

    // Terrain 2.0: full-map set pieces + tactical AI.
    const t2 = await page.evaluate(async () => {
        const g = window.game;
        const { dealDamage } = await import('/js/systems/combat.js');
        const { FOREST_COVER, FORD_SLOW } = await import('/js/systems/terrain.js');
        const T = g.terrain, r = {};
        g.loadLvl(4);
        let covered = true;
        for (let x = 1300; x < 8700; x += 400) if (T.topAt(x) < 5) covered = false;
        r.fullMap = covered && T.heightAt(300) === 0 && T.heightAt(600) === 0;
        // Tunnel cover: ranged outside can't hit inside; melee inside can.
        const t = T.tunnels[0];
        g.spawnEnemy('marauder', t.x0 + 120);
        const foe = g.enemies[g.enemies.length - 1];
        const arch = g.units.find((u) => u.ranged && !u.isHero) || (g.buyUnit('archer'), g.units[g.units.length - 1]);
        arch.x = t.x0 - 160;
        const mil = (g.buyUnit('militia'), g.units[g.units.length - 1]);
        mil.x = t.x0 + 60;
        r.tunnel = !!t && !arch._canHit(foe) && mil._canHit(foe);
        // Forest cover for ranged fire.
        const fo = T.forests.find((f) => !f.onRidge);
        const dummy = (x) => ({ kind: 'unit', armorClass: 'none', armor: 0, x, y: 0, hp: 1e6, takeDamage(a) { this.hp -= a; } });
        const inF = dummy((fo.x0 + fo.x1) / 2), outF = dummy(400);
        dealDamage(100, { dmgType: 'pierce', ranged: true }, inF);
        dealDamage(100, { dmgType: 'pierce', ranged: true }, outF);
        r.forest = Math.abs((1e6 - inF.hp) / (1e6 - outF.hp) - FOREST_COVER) < 1e-6;
        // Ford slows, bridge doesn't.
        const ford = T.rivers.find((v) => !v.bridge);
        r.ford = !!ford && T.speedMult({ x: (ford.x0 + ford.x1) / 2 }, 1) <= FORD_SLOW * 1.05;
        g.loadLvl(2);
        const br = T.rivers.find((v) => v.bridge);
        r.bridge = !!br && Math.abs(T.speedMult({ x: (br.x0 + br.x1) / 2 }, 1) - 1) < 0.12;
        // Shrine capture pays out (Bandit Camp has a gold shrine + barricades).
        g.loadLvl(1);
        const s = g.objectives.list[0];
        g.units.slice(0, 3).forEach((u) => { u.x = s.x; });
        const gold0 = g.gold;
        for (let i = 0; i < 400; i++) g.objectives.update(1);
        r.shrine = s.owner === 1 && g.gold > gold0;
        // Barricade blocks enemy movement and repairs for gold.
        const b = g.buildings.find((x) => x.type === 'barricade');
        g.spawnEnemy('rabble', b.x + 60);
        const rb = g.enemies[g.enemies.length - 1];
        for (let i = 0; i < 200; i++) rb.update(1);
        r.blocks = rb.x >= b.x + b.w / 2 + 5;
        b.hp = b.maxHp * 0.3; g.sel = b; g.gold = 100;
        g.repairSelected();
        r.repair = b.hp > b.maxHp * 0.7 && g.gold === 60;
        // Formation hold sits on a tactical anchor.
        g.setFormation('standard'); g.updateTactics();
        r.hold = T.anchors.some((a) => a.x === g.holdX);
        g.returnToMenu();
        return r;
    });
    ok(t2.fullMap, 'every level is shaped terrain end to end (castle plateau flat)');
    ok(t2.tunnel, 'tunnel cover: ranged can\'t shoot in, melee inside can');
    ok(t2.forest, 'forest cover reduces ranged damage');
    ok(t2.ford && t2.bridge, 'fords slow troops; bridges don\'t');
    ok(t2.shrine, 'holding a shrine captures it and pays out');
    ok(t2.blocks && t2.repair, 'barricades block enemies and repair for gold');
    ok(t2.hold, 'formation holds on a terrain anchor');

    const orb = await page.evaluate(() => {
        const g = window.game, r = {};
        g.loadLvl(4);
        const t = g.terrain.tunnels[0], mid = (t.x0 + t.x1) / 2;
        r.tunnelHill = g.terrain.topAt(mid) - g.terrain.heightAt(mid) > g.terrain.tunnelArch() + 30;
        g.loadLvl(2);
        g.spawnEnemy('ogre', 900);
        const near = g.enemies[g.enemies.length - 1];
        g.spawnEnemy('ogre', 3000);
        const far = g.enemies[g.enemies.length - 1];
        const hp = far.hp;
        for (let i = 0; i < 260; i++) g.orbital.update(1);
        r.hit = near.hp <= 0 || near.hp < near.maxHp * 0.3;
        r.ignoresFar = far.hp === hp;
        g.returnToMenu();
        return r;
    });
    const sell = await page.evaluate(() => {
        const g = window.game;
        g.loadLvl(0); g.gold = 1000;
        g.buyUnit('militia');
        const u = g.units[g.units.length - 1];
        const pop0 = g.pop, gold0 = g.gold;
        g.sel = u; g.sellSelected();
        const soldUnit = !u.active && g.pop === pop0 - u.pop && g.gold === gold0 + Math.floor(u.costPaid.g * 0.5);
        const castle = g.buildings.find((b) => b.type === 'castle');
        g.sel = castle; g.sellSelected();
        const heroSafe = g.sellRefund(g.hero) === null;
        g.returnToMenu();
        return soldUnit && castle.active && heroSafe;
    });
    const pw = await page.evaluate(() => {
        const g = window.game, r = {};
        g.loadLvl(3);
        g.updatePower(1);
        const c = g.buildings.find((b) => b.type === 'castle');
        const d0 = c.dmg, h0 = g.hero.dmg, p0 = g.powerLevel();
        const r0 = g.hero.respawnDelayMs();
        g.waveM.cw = 4;             // four waves survived
        g.updatePower(3600);        // plus a minute
        r.rises = g.powerLevel() > p0 + 0.6;
        r.castle = c.dmg > d0 * 1.5 && c.maxHp > 2000;
        r.hero = g.hero.dmg > h0 * 1.5;
        const r1 = g.hero.respawnDelayMs();
        g.hero.deaths = 3;
        const r2 = g.hero.respawnDelayMs();
        r.revive = r1 < r0 && r2 < r1 && r2 >= 4000;
        g.returnToMenu();
        return r;
    });
    const auto = await page.evaluate(() => {
        const g = window.game;
        g.loadLvl(0);
        const h = g.hero;
        g.spawnEnemy('ogre', 5000);                 // far away: no cast
        h.voidCharge = h.maxCharge; h.frame = 0; h._autoCast();
        const heldFar = g.singularities.length === 0 && h.voidCharge === h.maxCharge;
        g.spawnEnemy('rabble', h.x + 300);          // in reach: casts
        h.frame = 0; h._autoCast();
        const cast = g.singularities.length === 1 && h.voidCharge === 0;
        const nearPack = cast && Math.abs(g.singularities[0].x - (h.x + 300)) < 200;
        g.returnToMenu();
        return heldFar && cast && nearPack;
    });
    ok(auto, 'Voidcaller auto-casts Singularity on a nearby pack when charged');
    ok(pw.rises && pw.castle && pw.hero, 'power level scales castle + Voidcaller with waves and time');
    ok(pw.revive, 'Voidcaller revives faster with waves survived and deaths (min 4s)');
    ok(sell, 'selling refunds half the price paid; castle and hero can\'t be sold');
    ok(orb.tunnelHill, 'tunnels bore through a hill (rock cover over the passage)');
    ok(orb.hit && orb.ignoresFar, 'orbital cannon strikes enemies near the castle only');

    // ── 4. Lifecycle: endless + defeat ───────────────────────────────────
    console.log('\n[lifecycle]');
    await page.evaluate(() => game.returnToMenu());
    await poll(`game.state === 'menu'`);
    ok(true, 'returnToMenu works');

    await page.evaluate(() => game.startEndless());
    await poll(`game.state === 'playing' && game.mode === 'endless'`);
    ok(true, 'endless mode starts');
    ok(await page.evaluate(() => !game.terrain.isFlat() && !!game.hazards.def()), 'endless rolls terrain + a hazard');

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
