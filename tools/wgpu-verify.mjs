// ── WebGPU dev verification (NOT part of smoke) ──────────────────────────
// Launches the real system Chrome with WebGPU enabled, boots the game, drives a
// few VFX-heavy gameplay events, and reports whether the WebGPU overlay actually
// initialized and rendered without GPU validation errors. Screenshots land in
// scratch/ for eyeballing. Headless Chromium in the smoke path has no WebGPU, so
// this must be run against a GPU-capable Chrome:
//
//   PW_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     node tools/wgpu-verify.mjs
//
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const OUT = join(ROOT, 'scratch');
const PORT = 8124;
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
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
        } catch { res.writeHead(404).end('not found'); }
    });
    return new Promise((r) => server.listen(PORT, () => r(server)));
}

await mkdir(OUT, { recursive: true });
const server = await startServer();
const EXE = process.env.PW_CHROMIUM || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({
    headless: true,
    executablePath: EXE,
    args: [
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan',
        '--use-angle=metal',
        '--ignore-gpu-blocklist',
    ],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const pageErrors = [];
const consoleErrors = [];
const warns = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) consoleErrors.push(m.text());
    if (m.type() === 'warning') warns.push(m.text());
});
const poll = (fn, ms = 8000) => page.waitForFunction(fn, null, { timeout: ms, polling: 50 });

let ok = true;
const say = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) ok = false; };

try {
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
    await poll(`window.game && window.game.state === 'menu'`);

    const info = await page.evaluate(() => ({
        hasWgpu: !!window.game.wgpu,
        supported: window.game.wgpu && window.game.wgpu.supported,
    }));
    say(info.hasWgpu, 'game.wgpu instantiated');
    console.log(`    navigator.gpu present: ${info.supported}`);

    // Give the async device init a moment to resolve.
    const wgpuOk = await page.waitForFunction(
        `window.game.wgpu && window.game.wgpu.ok === true`, null, { timeout: 6000, polling: 50 },
    ).then(() => true).catch(() => false);
    say(wgpuOk, wgpuOk ? 'WebGPU device initialized (wgpu.ok === true)' : 'WebGPU NOT available — game correctly on WebGL fallback');

    // Boot a campaign and drive VFX-heavy events regardless of backend.
    await page.evaluate(() => { window.game.startCampaignWithDiff(1.0); window.game.setSpeed(2); });
    await poll(`window.game.state === 'playing'`);

    // Cinematic tier so lights + bloom flags are on, then drop a meteor onto a
    // cluster of enemies (targeted at an enemy's actual screen position).
    await page.evaluate(() => {
        const sel = document.getElementById('particleQuality');
        if (sel) { sel.value = '2'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        for (let i = 0; i < 10; i++) game.spawnEnemy('rabble', 900 + i * 45, 0);
    });
    await page.waitForTimeout(200);
    const cast = await page.evaluate(() => {
        const e = game.enemies[0];
        const p = game.camera.toScreen(e.x, e.y);
        game.spells.mana = 999; game.spells.cd = {};
        game.spells.select('meteor');
        const cv = document.getElementById('gameCanvas');
        cv.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: p.x, clientY: p.y - 40, bubbles: true }));
        return { x: Math.round(p.x), y: Math.round(p.y) };
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, 'wgpu_meteor_impact.png') });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, 'wgpu_meteor.png') });
    say(true, `meteor cast at screen (${cast.x},${cast.y}); shots: scratch/wgpu_meteor{,_impact}.png`);
    // Deterministic registry+light check: fire an explosion at a clear mid-field
    // spot (above the HUD) and capture within the same frame window.
    const lit = await page.evaluate(() => {
        const wx = game.camera.x + window.innerWidth * 0.35;
        const wy = game.camera.y + window.innerHeight * 0.42;
        game.vfx.spawn('explosion', wx, wy, { scale: 2.4, power: 1.6 });
        game.vfx.spawn('fire', wx + 120, wy, { scale: 1.5, power: 2 });
        return game.lights.lights.length;
    });
    say(lit > 0, `game.vfx.spawn drove ${lit} dynamic light(s)`);
    await page.waitForTimeout(60);
    await page.screenshot({ path: join(OUT, 'wgpu_explosion.png') });
    say(true, 'explosion+fire VFX rendered (screenshot: scratch/wgpu_explosion.png)');

    // GPU-compute particle path: capture device validation errors while
    // emitting a heavy additive burst, and confirm the pool actually filled.
    const gpuInfo = await page.evaluate(async () => {
        const w = window.game.wgpu;
        if (!w || !w.ok || !w.particles) return { active: false };
        w.device.pushErrorScope('validation');
        const before = w.particles.liveHint;
        // 40 bursts of additive particles routed through the public emit path.
        for (let b = 0; b < 40; b++) {
            const wx = game.camera.x + 300 + (b * 17) % 900;
            const wy = game.camera.y + 250 + (b * 29) % 250;
            game.particles.emit(wx, wy, 60, '#38bdf8', 6, 3, 'float');
            game.particles.emit(wx, wy, 40, '#fbbf24', 8, 2, 'spark');
        }
        const after = w.particles.liveHint;
        // Let a couple of sim+render frames run.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const err = await w.device.popErrorScope();
        return { active: true, before, after, cpuCount: game.particles.p.length, err: err ? err.message : null };
    });
    if (gpuInfo.active) {
        say(gpuInfo.after > gpuInfo.before, `GPU particle pool filled: liveHint ${gpuInfo.before} → ${gpuInfo.after}`);
        say(gpuInfo.err === null, gpuInfo.err ? `GPU validation error: ${gpuInfo.err}` : 'no GPU validation errors during compute+render');
        console.log(`    CPU particle array (additive offloaded → should stay low): ${gpuInfo.cpuCount}`);
    } else {
        console.log('    GPU particle pool inactive (WebGL fallback) — skipping compute check');
    }
    await page.waitForTimeout(80);
    await page.screenshot({ path: join(OUT, 'wgpu_gpu_particles.png') });
    say(true, 'GPU particle burst rendered (screenshot: scratch/wgpu_gpu_particles.png)');

    // Normal-lit relief: park a bright light just left of the hero and confirm
    // the relief pass runs without validation errors + queued the hero sprite.
    const relief = await page.evaluate(async () => {
        const w = window.game.wgpu;
        if (!w || !w.ok || !w.relief) return { active: false };
        const hero = game.hero;
        if (!hero) return { active: false, noHero: true };
        w.device.pushErrorScope('validation');
        // A persistent bright light to the hero's left, re-added each of a few frames.
        for (let f = 0; f < 6; f++) {
            game.lights.add({ x: hero.x - 90, y: hero.y - 40, radius: 260, intensity: 2.2, color: '#ffd28a', life: 30 });
            await new Promise((r) => requestAnimationFrame(r));
        }
        const err = await w.device.popErrorScope();
        return { active: true, reliefCount: w.relief.count, lightCount: w.relief.lightCount, err: err ? err.message : null };
    });
    if (relief.active) {
        say(relief.reliefCount > 0, `relief pass queued ${relief.reliefCount} hero/boss sprite(s), ${relief.lightCount} light(s)`);
        say(relief.err === null, relief.err ? `relief validation error: ${relief.err}` : 'no GPU validation errors in relief pass');
    } else {
        console.log(`    relief pass inactive${relief.noHero ? ' (no hero)' : ''}`);
    }
    await page.waitForTimeout(40);
    await page.screenshot({ path: join(OUT, 'wgpu_relief.png') });
    say(true, 'hero relief rendered (screenshot: scratch/wgpu_relief.png)');

    // Singularity: shaded GPU accretion disk + particle-attractor lifecycle.
    const riftCast = await page.evaluate(() => {
        const w = window.game.wgpu;
        if (!w || !w.ok || !game.hero) return { ok: false };
        for (let i = 0; i < 8; i++) game.spawnEnemy('rabble', game.hero.x + 220 + i * 30, 0);
        game.hero.voidCharge = game.hero.maxCharge;
        const cast = game.hero.castAbility(game.hero.x + 260);
        w.device.pushErrorScope('validation');
        return { ok: true, cast };
    });
    if (riftCast.ok) {
        say(riftCast.cast === true, 'Singularity cast fired');
        // Advance into the pull phase and capture disk + attractor.
        let pull = { disk: 0, attract: 0, phase: '' };
        for (let f = 0; f < 40; f++) {
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
            pull = await page.evaluate(() => {
                const w = window.game.wgpu, s = game.singularities[0];
                return { disk: w.singularity ? w.singularity.count : 0,
                    attract: w.particles ? w.particles.attractStrength : 0,
                    phase: s ? s.phase : 'gone' };
            });
            if (pull.phase === 'pull') break;
        }
        await page.screenshot({ path: join(OUT, 'wgpu_singularity_pull.png') });
        say(pull.disk > 0, `GPU accretion disk queued (count ${pull.disk}, phase ${pull.phase})`);
        say(pull.attract > 0, `particle attractor engaged during pull (strength ${pull.attract.toFixed(2)})`);
        // Run out the rest of the rift's life, then check for validation errors + leak.
        const end = await page.evaluate(async () => {
            const w = window.game.wgpu;
            for (let f = 0; f < 260 && game.singularities.length; f++) {
                await new Promise((r) => requestAnimationFrame(r));
            }
            await new Promise((r) => requestAnimationFrame(r));
            const err = await w.device.popErrorScope();
            return { leaked: w.particles ? w.particles.attractStrength : 0, alive: game.singularities.length, err: err ? err.message : null };
        });
        await page.screenshot({ path: join(OUT, 'wgpu_singularity_detonate.png') });
        say(end.err === null, end.err ? `singularity validation error: ${end.err}` : 'no GPU validation errors across form→pull→collapse→detonate');
        say(end.leaked === 0, `attractor cleared after rift died (leak check: strength ${end.leaked})`);
    } else {
        console.log('    singularity check skipped (no WebGPU/hero)');
    }

    const active = await page.evaluate(() => (window.game.wgpu && window.game.wgpu.ok) ? 'WebGPU' : (window.game.gl && window.game.gl.ok ? 'WebGL' : 'Canvas2D'));
    console.log(`    active overlay backend: ${active}`);

    // Compositor mode (Stage E): scene bloom + shockwave distortion on cinematic.
    const comp = await page.evaluate(async () => {
        const w = window.game.wgpu;
        if (!w || !w.ok || !w.compositor) return { active: false };
        // Ensure cinematic (distortion tier).
        const sel = document.getElementById('particleQuality');
        if (sel && sel.value !== '2') { sel.value = '2'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        w.device.pushErrorScope('validation');
        // A blast near screen centre → registers a scene distortion source.
        const wx = game.camera.x + window.innerWidth * 0.4;
        const wy = game.camera.y + window.innerHeight * 0.4;
        game.vfx.spawn('explosion', wx, wy, { scale: 2.6, power: 1.6 });
        let activeFrames = 0;
        for (let f = 0; f < 5; f++) {
            await new Promise((r) => requestAnimationFrame(r));
            if (w._compositorActive()) activeFrames++;
        }
        const err = await w.device.popErrorScope();
        return { active: true, activeFrames, distortions: w._distortions.length, ready: w.compositor.ready, err: err ? err.message : null };
    });
    if (comp.active) {
        say(comp.activeFrames > 0, `compositor mode active ${comp.activeFrames}/5 frames (scene sampled + bloom + distortion)`);
        say(comp.ready, 'compositor textures allocated (sceneTex + bloom pyramid)');
        say(comp.err === null, comp.err ? `compositor validation error: ${comp.err}` : 'no GPU validation errors in compositor pass');
        console.log(`    live distortion sources: ${comp.distortions}`);
    } else {
        console.log('    compositor inactive (WebGL fallback or non-cinematic)');
    }
    await page.waitForTimeout(50);
    await page.screenshot({ path: join(OUT, 'wgpu_compositor.png') });
    say(true, 'compositor frame rendered (screenshot: scratch/wgpu_compositor.png)');

    // Relief for the crowd (P2-B): light a group of units and assert the relief
    // pass queues more than the hero/boss alone, validation-clean.
    const crowd = await page.evaluate(async () => {
        const w = window.game.wgpu;
        if (!w || !w.ok || !w.relief || !game.hero) return { ok: false };
        for (let i = 0; i < 12; i++) game.spawnEnemy('rabble', game.camera.x + 300 + i * 45, 0);
        w.device.pushErrorScope('validation');
        let maxCount = 0;
        for (let f = 0; f < 6; f++) {
            game.lights.add({ x: game.camera.x + 500, y: game.hero.y - 20, radius: 600, intensity: 2, color: '#ffd28a', life: 30 });
            await new Promise((r) => requestAnimationFrame(r));
            maxCount = Math.max(maxCount, w.relief.count);
        }
        const err = await w.device.popErrorScope();
        return { ok: true, maxCount, err: err ? err.message : null };
    });
    if (crowd.ok) {
        say(crowd.maxCount > 2, `relief queued ${crowd.maxCount} sprites (crowd lit, not just hero/boss)`);
        say(crowd.err === null, crowd.err ? `relief crowd validation error: ${crowd.err}` : 'no GPU validation errors lighting the crowd');
    }

    // Tier sweep: every preset must render (never a black screen). Only
    // cinematic runs the compositor/lensing; performance/standard use the
    // transparent overlay. Screenshots for eyeball; also confirm no throw.
    for (const [val, name] of [['0.5', 'performance'], ['1', 'standard'], ['2', 'cinematic']]) {
        const swept = await page.evaluate((v) => {
            try {
                const sel = document.getElementById('particleQuality');
                if (sel) { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); }
                const wx = game.camera.x + window.innerWidth * 0.4, wy = game.camera.y + window.innerHeight * 0.42;
                game.vfx.spawn('explosion', wx, wy, { scale: 2.2 });
                return true;
            } catch { return false; }
        }, val);
        await page.waitForTimeout(80);
        await page.screenshot({ path: join(OUT, `wgpu_tier_${name}.png`) });
        say(swept, `tier ${name} rendered without throw (screenshot: scratch/wgpu_tier_${name}.png)`);
    }
    // Restore cinematic for the remaining checks.
    await page.evaluate(() => { const s = document.getElementById('particleQuality'); if (s) { s.value = '2'; s.dispatchEvent(new Event('change', { bubbles: true })); } });

    // GPU projectile trails (P2-D): fire glowing projectiles, assert the ribbon
    // pass fills (glow routes to GPU, 2D polyline skipped), validation-clean.
    const trails = await page.evaluate(async () => {
        const w = window.game.wgpu;
        if (!w || !w.ok || !w.trails) return { ok: false };
        const mod = await import('/js/systems/projectile.js');
        const team = game.hero ? game.hero.team : 0;
        for (let i = 0; i < 6; i++) {
            game.projectiles.push(new mod.Projectile(
                game.camera.x + 200, game.hero.y - 80 - i * 12,
                { x: game.camera.x + 900, y: game.hero.y - 80 },
                'fireball', 5, team, true, 0, false, {}));
        }
        w.device.pushErrorScope('validation');
        let maxCount = 0;
        for (let f = 0; f < 20; f++) {
            await new Promise((r) => requestAnimationFrame(r));
            maxCount = Math.max(maxCount, w.trails.count);
        }
        const err = await w.device.popErrorScope();
        return { ok: true, maxCount, err: err ? err.message : null };
    });
    if (trails.ok) {
        say(trails.maxCount > 0, `GPU trail ribbon filled (${trails.maxCount} verts) for glowing projectiles`);
        say(trails.err === null, trails.err ? `trail validation error: ${trails.err}` : 'no GPU validation errors in trail pass');
    }

    // Perf: sustained heavy additive-particle load, measured as achieved FPS
    // over a fixed window, WebGPU vs forced-WebGL (same scene, same emission).
    async function measureFps(label) {
        return await page.evaluate(async (lbl) => {
            const emit = () => {
                for (let b = 0; b < 6; b++) {
                    const wx = game.camera.x + 200 + Math.random() * 1000;
                    const wy = game.camera.y + 200 + Math.random() * 260;
                    game.particles.emit(wx, wy, 40, '#38bdf8', 6, 3, 'float');
                    game.particles.emit(wx, wy, 30, '#fbbf24', 8, 2, 'spark');
                }
            };
            let frames = 0;
            const t0 = performance.now();
            await new Promise((resolve) => {
                const tick = () => {
                    emit();
                    frames++;
                    if (performance.now() - t0 >= 1500) resolve();
                    else requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
            });
            const secs = (performance.now() - t0) / 1000;
            return { lbl, fps: Math.round(frames / secs), backend: (game.wgpu && game.wgpu.ok) ? 'WebGPU' : 'WebGL' };
        }, label);
    }
    const perfGpu = await page.evaluate(() => !!(window.game.wgpu && window.game.wgpu.ok)) ? await measureFps('webgpu') : null;
    // Force the WebGL overlay for the comparison run (same scene/emission).
    const hadGpu = await page.evaluate(() => {
        const on = !!(window.game.wgpu && window.game.wgpu.ok);
        if (window.game.wgpu) window.game.wgpu.ok = false;
        return on;
    });
    await page.waitForTimeout(60);
    const perfGl = await measureFps('webgl');
    console.log('\n[perf] sustained ~420 additive particles/frame, 1.5s window:');
    if (perfGpu) console.log(`    ${perfGpu.backend}: ${perfGpu.fps} fps`);
    console.log(`    ${perfGl.backend}: ${perfGl.fps} fps`);
    // Re-enable WebGPU (device still valid) for the device-loss drill below.
    if (hadGpu) await page.evaluate(() => { window.game.wgpu.ok = true; });

    // Device-loss drill: destroy the WebGPU device mid-run and confirm the
    // overlay gracefully reverts to WebGL without throwing.
    const loss = await page.evaluate(async () => {
        const w = window.game.wgpu;
        if (!w || !w.ok) return { active: false };
        w.device.destroy();
        // Let a few frames run so device.lost resolves + the loop repoints gl.
        await new Promise((r) => setTimeout(r, 200));
        return {
            active: true,
            wgpuOk: w.ok,
            backend: (window.game.gl === window.game.glWebgl) ? 'WebGL' : (window.game.wgpu.ok ? 'WebGPU' : 'other'),
        };
    });
    if (loss.active) {
        say(loss.wgpuOk === false, 'device-loss flips wgpu.ok to false');
        say(loss.backend === 'WebGL', `overlay fell back to ${loss.backend} after device loss`);
    } else {
        console.log('    device-loss drill skipped (WebGPU not active)');
    }

    say(pageErrors.length === 0, `no uncaught page errors${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
    say(consoleErrors.length === 0, `no console.error${consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''}`);
    const wgpuWarns = warns.filter((w) => /\[wgpu\]/.test(w));
    if (wgpuWarns.length) console.log('    [wgpu] warnings:', wgpuWarns.join(' | '));
} catch (err) {
    say(false, 'EXCEPTION: ' + (err && err.message || err));
} finally {
    await browser.close();
    server.close();
}
console.log(`\n${ok ? 'OK' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
