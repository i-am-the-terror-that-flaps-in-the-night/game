import { CONFIG } from '../config.js';
import { LEVELS } from '../data/levels.js';
import { clamp, mixCol, mixRgb, rgba, shade, toRgb, toRgba } from '../utils.js';
import { GFX } from '../systems/graphics.js';
import { GLRenderer } from '../systems/gl-renderer.js';
import { TERRAIN_PATCHES, terrain } from '../systems/terrain.js';

// --- GAME: backdrop, foreground, post-FX & frame draw (installed by install-mixins.js) ---
export const renderMethods = /** @type {ThisType<any>} */ ({

    // ─── CINEMATIC ENVIRONMENT ──────────────────────────────
    // NOTE: w/h here are the LOGICAL (CSS-pixel) viewport dims (this.vw/this.vh),
    // not the canvas backing-store size — the Performance tier renders the
    // backing store smaller and lets ctx.scale()+CSS handle the upscale, so
    // every cached gradient must be built in logical space (see draw()).
    _buildBackdropCache() {
        const w = this.vw,
            h = this.vh,
            ctx = this.ctx;
        if (!w || !h || !ctx) return;
        const vg = ctx.createRadialGradient(
            w / 2, h * 0.42, Math.min(w, h) * 0.34,
            w / 2, h * 0.5, Math.max(w, h) * 0.78,
        );
        vg.addColorStop(0, "transparent");
        vg.addColorStop(0.65, "rgba(0,0,0,0.08)");
        vg.addColorStop(1, "rgba(0,0,0,0.46)");
        this._vignette = vg;

        // Castle-danger / boss-presence vignettes: baked at full alpha and
        // modulated per-frame via ctx.globalAlpha instead of rebuilding the
        // gradient every frame — mathematically identical premultiplied output
        // (interpolating transparent->rgba(c,1) then scaling by alpha 'a' gives
        // the same result at every stop fraction t as transparent->rgba(c,a)).
        const dv = ctx.createRadialGradient(w / 2, h / 2, h * 0.22, w / 2, h / 2, h * 0.85);
        dv.addColorStop(0, "transparent");
        dv.addColorStop(1, "rgba(200,0,0,1)");
        this._dangerVignette = dv;

        const bv = ctx.createRadialGradient(w / 2, h * 0.46, h * 0.2, w / 2, h * 0.5, h * 0.95);
        bv.addColorStop(0, "transparent");
        bv.addColorStop(1, "rgba(38,10,58,1)");
        this._bossVignette = bv;

        if (!this._grainPat) {
            const nc = document.createElement("canvas");
            nc.width = 64; nc.height = 64;
            const nx = nc.getContext("2d");
            const id = nx.createImageData(64, 64);
            for (let i = 0; i < id.data.length; i += 4) {
                const v = (128 + (Math.random() * 255 - 128) * 0.55) | 0;
                id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
                id.data[i + 3] = 255;
            }
            nx.putImageData(id, 0, 0);
            this._grainPat = ctx.createPattern(nc, "repeat");
        }

        // Sun/moon corona templates: fixed radius per body, built once at a
        // local origin and positioned each frame via ctx.translate (a
        // translate never distorts a radial gradient, so this is
        // bit-identical to rebuilding the gradient at (cX,cY) every frame).
        if (!this._sunCorona) {
            const sr = 32 * 7;
            const cor = ctx.createRadialGradient(0, 0, 0, 0, 0, sr);
            cor.addColorStop(0, rgba("#ffe7a8", 0.5));
            cor.addColorStop(0.25, rgba("#ffb86b", 0.2));
            cor.addColorStop(1, "transparent");
            this._sunCorona = cor;
        }
        if (!this._moonCorona) {
            const mr = 24 * 4.8;
            const cor = ctx.createRadialGradient(0, 0, 0, 0, 0, mr);
            cor.addColorStop(0, rgba("#cdd9ff", 0.5));
            cor.addColorStop(0.25, rgba("#9db4ff", 0.2));
            cor.addColorStop(1, "transparent");
            this._moonCorona = cor;
        }
    },


    // A continuous, parallax-scrolled mountain ridge silhouette
    _drawRidge(ctx, w, gy, cam, opt) {
        const { parallax, seg, color, top, amp } = opt;
        const scroll = cam.x * parallax;
        const baseIndex = Math.floor(scroll / seg) - 1;
        const cols = Math.ceil(w / seg) + 3;
        const xs = [], hs = [];
        ctx.beginPath();
        ctx.moveTo(-seg, gy + 6);
        for (let k = 0; k <= cols; k++) {
            const idx = baseIndex + k;
            const sx = idx * seg - scroll;
            const n =
                Math.sin(idx * 1.71) * 0.5 +
                Math.sin(idx * 0.53 + 1.3) * 0.32 +
                Math.sin(idx * 0.29 + 4.0) * 0.18 +
                Math.sin(idx * 0.13 + 2.2) * 0.12;
            const peakY = top - (0.5 + n * 0.5) * amp;
            xs.push(sx); hs.push(peakY);
            ctx.lineTo(sx, peakY);
        }
        ctx.lineTo(w + seg, gy + 6);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        if (opt.snow) {
            ctx.fillStyle = opt.snowCol;
            for (let k = 1; k < xs.length - 1; k++) {
                if (hs[k] < hs[k - 1] && hs[k] < hs[k + 1] &&
                    hs[k] < top - amp * 0.5) {
                    ctx.beginPath();
                    ctx.moveTo(xs[k], hs[k]);
                    ctx.lineTo(xs[k] - seg * 0.34, hs[k] + amp * 0.17);
                    ctx.lineTo(xs[k] + seg * 0.34, hs[k] + amp * 0.17);
                    ctx.closePath();
                    ctx.fill();
                }
            }
        }
        if (opt.rim) {
            ctx.strokeStyle = opt.rim;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            for (let k = 0; k < xs.length; k++)
                k === 0 ? ctx.moveTo(xs[k], hs[k]) : ctx.lineTo(xs[k], hs[k]);
            ctx.stroke();
        }
    },

    drawBackdrop(ctx, w, h, cam, lvl, dP) {
        const sky = lvl.sky, gnd = lvl.ground;
        const sun = clamp(dP, 0, 1);
        const night = clamp(-dP, 0, 1);
        const dawn = clamp(1 - Math.abs(dP) * 1.7, 0, 1);
        const gy = cam.toScreen(0, CONFIG.GROUND_Y).y;
        const warm = "#ff9d5c", cool = "#16203a";

        // Atmospheric horizon color, derived from the level theme
        const glowT = clamp(dawn * 0.6 + sun * 0.32, 0, 0.78);
        const horizonO = mixRgb(mixRgb(sky, cool, night * 0.45), warm, glowT);
        const skyTop = shade(sky, -0.5 - night * 0.12);

        // Sky — gradient cached & rebuilt only when its resolved stop colors
        // actually change (dP drifts ~0.0002/frame, so truncated color
        // strings stay identical for many consecutive frames); Performance
        // uses a flat fill instead of a gradient entirely.
        if (GFX.flatScenery) {
            ctx.fillStyle = toRgb(mixRgb(skyTop, sky, 0.6));
            ctx.fillRect(0, 0, w, gy + 30);
        } else {
            const horizonMid = toRgb(mixRgb(sky, horizonO, 0.7));
            const horizonEdge = toRgb(horizonO);
            const skyKey = skyTop + "|" + sky + "|" + horizonMid + "|" + horizonEdge + "|" + gy;
            if (this._skyKey !== skyKey) {
                const sg = ctx.createLinearGradient(0, 0, 0, gy + 30);
                sg.addColorStop(0, skyTop);
                sg.addColorStop(0.45, sky);
                sg.addColorStop(0.82, horizonMid);
                sg.addColorStop(1, horizonEdge);
                this._skyKey = skyKey;
                this._skyGrad = sg;
            }
            ctx.fillStyle = this._skyGrad;
            ctx.fillRect(0, 0, w, gy + 30);
        }

        // Stars (night)
        if (night > 0.02) {
            for (let i = 0; i < 95; i++) {
                const sx = (i * 167.3) % w;
                const sy = (i * 89.7) % (gy * 0.78);
                const tw = 0.35 + Math.sin(this.dayT * 4 + i * 1.7) * 0.45;
                ctx.globalAlpha = night * clamp(tw, 0.04, 0.95);
                ctx.fillStyle = i % 11 === 0 ? "#bfdbfe" : "#ffffff";
                const r = i % 13 === 0 ? 1.7 : i % 3 === 0 ? 1.1 : 0.7;
                ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
            }
            ctx.globalAlpha = 1;
        }

        // Sun / Moon
        const cY = gy * 0.82 - dP * gy * 0.82;
        const cX = w * 0.78 + Math.cos(this.dayT) * w * 0.22;
        const isSun = dP > -0.05;
        const bodyCol = isSun ? mixCol("#fff3c4", "#ff8a3d", 1 - sun) : "#dbe4ff";
        const bodyR = isSun ? 32 : 24;
        // Corona (cached template, positioned via translate — see
        // _buildBackdropCache for why this is bit-identical to a fresh
        // per-frame gradient at (cX,cY))
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.translate(cX, cY);
        ctx.fillStyle = isSun ? this._sunCorona : this._moonCorona;
        ctx.fillRect(-bodyR * 8, -bodyR * 8, bodyR * 16, bodyR * 16);
        // God rays — one gradient built per frame and reused for all 9 rays
        // (the stops never varied by ray index, so this is bit-identical to
        // the previous 9-separate-gradients version).
        if (isSun && sun > 0.12 && GFX.postFX) {
            ctx.rotate(this.dayT * 0.08);
            const rays = 9, len = h;
            const rg = ctx.createLinearGradient(0, 0, 0, len);
            rg.addColorStop(0, rgba("#ffe7a8", 0.045 * sun));
            rg.addColorStop(1, "transparent");
            ctx.fillStyle = rg;
            for (let i = 0; i < rays; i++) {
                ctx.rotate((Math.PI * 2) / rays);
                ctx.beginPath();
                ctx.moveTo(-6, 0); ctx.lineTo(6, 0);
                ctx.lineTo(30, len); ctx.lineTo(-30, len);
                ctx.closePath(); ctx.fill();
            }
        }
        ctx.restore();
        // Body
        ctx.save();
        ctx.fillStyle = bodyCol;
        if (GFX.shadows) {
            ctx.shadowBlur = isSun ? 42 : 22;
            ctx.shadowColor = bodyCol;
        }
        ctx.beginPath(); ctx.arc(cX, cY, bodyR, 0, Math.PI * 2); ctx.fill();
        if (!isSun) {
            ctx.shadowBlur = 0;
            ctx.fillStyle = "rgba(154,169,214,0.5)";
            ctx.beginPath(); ctx.arc(cX - 7, cY - 5, 4.5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(cX + 6, cY + 5, 3, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(cX + 2, cY - 8, 2.2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();

        // Clouds — gradient puffs cached per radius bucket and repositioned
        // via translate (bit-identical) while the tint is unchanged;
        // Performance draws flat circles instead (3 clouds, no gradients).
        {
            const cloudTint = mixRgb(mixRgb({ r: 248, g: 251, b: 255 }, sky, 0.35 + night * 0.4), warm, dawn * 0.4);
            const ca = clamp((0.2 + sun * 0.16) * (1 - night * 0.45), 0.05, 0.36);
            ctx.save();
            ctx.globalAlpha = ca;
            if (GFX.flatScenery) {
                ctx.fillStyle = toRgb(cloudTint);
                const nClouds = 3;
                for (let i = 0; i < nClouds; i++) {
                    const m = w + 800;
                    const cx = (((i * 660 + this.frames * (0.2 + (i % 3) * 0.06) - cam.x * 0.05) % m) + m) % m - 400;
                    const cy = gy * (0.13 + (i % 3) * 0.12);
                    const sc = 0.7 + (i % 4) * 0.25;
                    for (let b = 0; b < 5; b++) {
                        const bx = cx + (b - 2) * 42 * sc;
                        const by = cy + Math.sin(b * 1.3 + i) * 9 * sc;
                        const br = (36 - Math.abs(b - 2) * 6) * sc * 1.6;
                        ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
                    }
                }
            } else {
                const nClouds = 6;
                const tintKey = toRgba(cloudTint, 1);
                if (this._cloudTintKey !== tintKey) {
                    this._cloudTintKey = tintKey;
                    this._cloudGrads = new Map();
                }
                for (let i = 0; i < nClouds; i++) {
                    const m = w + 800;
                    const cx = (((i * 660 + this.frames * (0.2 + (i % 3) * 0.06) - cam.x * 0.05) % m) + m) % m - 400;
                    const cy = gy * (0.13 + (i % 3) * 0.12);
                    const sc = 0.7 + (i % 4) * 0.25;
                    for (let b = 0; b < 5; b++) {
                        const bx = cx + (b - 2) * 42 * sc;
                        const by = cy + Math.sin(b * 1.3 + i) * 9 * sc;
                        const br = (36 - Math.abs(b - 2) * 6) * sc * 1.6;
                        const rKey = Math.round(br * 100);
                        let cg = this._cloudGrads.get(rKey);
                        if (!cg) {
                            cg = ctx.createRadialGradient(0, 0, 0, 0, 0, br);
                            cg.addColorStop(0, toRgba(cloudTint, 1));
                            cg.addColorStop(1, "transparent");
                            this._cloudGrads.set(rKey, cg);
                        }
                        ctx.translate(bx, by);
                        ctx.fillStyle = cg;
                        ctx.beginPath(); ctx.arc(0, 0, br, 0, Math.PI * 2); ctx.fill();
                        ctx.translate(-bx, -by);
                    }
                }
            }
            ctx.restore();
        }

        // Far mountain range (hazy, snow-capped)
        this._drawRidge(ctx, w, gy, cam, {
            parallax: 0.05, seg: 150,
            color: toRgb(mixRgb(sky, horizonO, 0.6)),
            top: gy * 0.62, amp: gy * 0.32,
            snow: true, snowCol: rgba("#e8f0ff", 0.4 + sun * 0.25),
        });
        // Mid mountain range (sharper, darker, sun-rim)
        this._drawRidge(ctx, w, gy, cam, {
            parallax: 0.12, seg: 120,
            color: toRgb(mixRgb(shade(sky, -0.3), gnd, 0.28)),
            top: gy * 0.82, amp: gy * 0.34,
            rim: rgba(isSun ? "#ffcaa0" : "#7e93c8", 0.18 + sun * 0.12),
        });

        // Horizon haze band — fuses mountain bases into the atmosphere
        // (skipped on the flat/Performance tier as a minor atmosphere layer)
        if (!GFX.flatScenery) {
            const hazeCol = toRgba(horizonO, 0.55 + dawn * 0.2);
            const hazeKey = hazeCol + "|" + gy;
            if (this._hazeKey !== hazeKey) {
                const hz = ctx.createLinearGradient(0, gy - gy * 0.3, 0, gy + 6);
                hz.addColorStop(0, "transparent");
                hz.addColorStop(1, hazeCol);
                this._hazeKey = hazeKey;
                this._hazeGrad = hz;
            }
            ctx.fillStyle = this._hazeGrad;
            ctx.fillRect(0, gy - gy * 0.3, w, gy * 0.3 + 6);
        }

        // Tree-line silhouette
        this._drawRidge(ctx, w, gy, cam, {
            parallax: 0.26, seg: 26,
            color: shade(gnd, -0.62),
            top: gy * 0.95, amp: gy * 0.12,
        });

        // ── GROUND ──
        const gTop = mixCol(gnd, "#fff7e0", 0.1 * sun + 0.02);
        if (GFX.flatScenery) {
            ctx.fillStyle = gnd;
            ctx.fillRect(0, gy, w, h - gy);
        } else {
            const gndDark = shade(gnd, -0.58);
            const gndKey = gTop + "|" + gnd + "|" + gndDark + "|" + gy + "|" + h;
            if (this._gndKey !== gndKey) {
                const gg = ctx.createLinearGradient(0, gy, 0, h);
                gg.addColorStop(0, gTop);
                gg.addColorStop(0.22, gnd);
                gg.addColorStop(1, gndDark);
                this._gndKey = gndKey;
                this._gndGrad = gg;
            }
            ctx.fillStyle = this._gndGrad;
            ctx.fillRect(0, gy, w, h - gy);
        }

        // Lit rim where grass catches the sky + shadow line beneath
        const rimCol = toRgba(mixRgb(gnd, { r: 255, g: 255, b: 240 }, 0.5), 0.45 + sun * 0.3);
        if (terrain.isFlat()) {
            ctx.fillStyle = rimCol;
            ctx.fillRect(0, gy - 2, w, 2.5);
            ctx.fillStyle = "rgba(0,0,0,0.28)";
            ctx.fillRect(0, gy + 2, w, 2);
        } else this._drawHills(ctx, w, gy, cam, gnd, gTop, rimCol, sun);

        // Battle-worn dirt path
        const ph = h - gy;
        const pathTop = gy + ph * 0.18, pathBot = gy + ph * 0.56;
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = mixCol(shade(gnd, -0.35), "#3a2c1c", 0.55);
        ctx.beginPath();
        ctx.moveTo(0, pathTop);
        for (let x = 0; x <= w; x += 60)
            ctx.lineTo(x, pathTop + Math.sin(x * 0.02 + cam.x * 0.002) * 6);
        for (let x = w; x >= 0; x -= 60)
            ctx.lineTo(x, pathBot + Math.sin(x * 0.017 + 2) * 8);
        ctx.closePath(); ctx.fill();
        ctx.restore();

        // Pebbles scattered on the path
        for (let i = 0; i < 16; i++) {
            const px2 = (((i * 263 - cam.x) % w) + w) % w;
            const py2 = pathTop + ((i * 97) % (pathBot - pathTop));
            const pr = 2 + (i % 3);
            ctx.fillStyle = shade(gnd, -0.46);
            ctx.beginPath(); ctx.ellipse(px2, py2, pr, pr * 0.6, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "rgba(255,255,255,0.08)";
            ctx.beginPath(); ctx.ellipse(px2 - 0.6, py2 - 0.6, pr * 0.5, pr * 0.3, 0, 0, Math.PI * 2); ctx.fill();
        }

        // Grass tufts along the rim (full parallax — locked to the play plane)
        ctx.save();
        ctx.strokeStyle = toRgba(mixRgb(gnd, "#bdf07a", 0.35 + sun * 0.2), 0.85);
        ctx.lineWidth = 1.5;
        ctx.lineCap = "round";
        const step = 46, scrollG = cam.x % step;
        for (let x = -step; x < w + step; x += step) {
            const sxp = x - scrollG;
            const wx = sxp + cam.x;
            const sway = Math.sin(this.frames * 0.03 + wx * 0.05) * 2;
            const baseY = gy - 1 - terrain.topAt(wx) * cam.z;
            const hgt = 7 + Math.abs(Math.sin(wx * 0.7)) * 6;
            ctx.beginPath();
            ctx.moveTo(sxp, baseY); ctx.lineTo(sxp - 3 + sway, baseY - hgt);
            ctx.moveTo(sxp, baseY); ctx.lineTo(sxp + sway, baseY - hgt - 2);
            ctx.moveTo(sxp, baseY); ctx.lineTo(sxp + 3 + sway, baseY - hgt);
            ctx.stroke();
        }
        ctx.restore();

        this._drawPatches(ctx, w, gy, cam);
        if (!terrain.isFlat()) {
            this._drawRivers(ctx, w, gy, cam);
            this._drawCaves(ctx, w, gy, cam);
            this._drawForests(ctx, w, gy, cam, lvl.ground);
        }
    },

    // Seeded 0..1 hash so scenery is stable frame to frame.
    _hash(n) { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); },

    // Rivers: a ford shows water pooled in its dip; a bridge spans a channel.
    _drawRivers(ctx, w, gy, cam) {
        const z = cam.z, f = this.frames;
        const surf = (wx) => gy - terrain.heightAt(wx) * z;
        for (const r of terrain.rivers) {
            const x0 = cam.sx(r.x0), x1 = cam.sx(r.x1);
            if (x1 < -60 || x0 > w + 60) continue;
            ctx.save();
            if (r.bridge) {
                const d0 = surf(r.x0 - 24), d1 = surf(r.x1 + 24);
                // Channel + water under the deck.
                ctx.fillStyle = "#1e293b";
                ctx.beginPath();
                ctx.moveTo(x0 - 10 * z, d0 + 6 * z);
                ctx.quadraticCurveTo((x0 + x1) / 2, (d0 + d1) / 2 + 70 * z, x1 + 10 * z, d1 + 6 * z);
                ctx.closePath(); ctx.fill();
                ctx.fillStyle = "rgba(37,99,235,0.75)";
                ctx.beginPath();
                ctx.moveTo(x0, d0 + 26 * z);
                ctx.quadraticCurveTo((x0 + x1) / 2, (d0 + d1) / 2 + 60 * z, x1, d1 + 26 * z);
                ctx.closePath(); ctx.fill();
                // Piers, deck and rails.
                ctx.fillStyle = "#44403c";
                for (const t of [0.33, 0.66]) {
                    const px = x0 + (x1 - x0) * t, py = d0 + (d1 - d0) * t;
                    ctx.fillRect(px - 5 * z, py, 10 * z, 46 * z);
                }
                ctx.strokeStyle = "#78350f";
                ctx.lineWidth = 7 * z;
                ctx.beginPath(); ctx.moveTo(x0 - 24 * z, d0 + 3 * z); ctx.lineTo(x1 + 24 * z, d1 + 3 * z); ctx.stroke();
                ctx.strokeStyle = "#a16207";
                ctx.lineWidth = 2 * z;
                ctx.beginPath(); ctx.moveTo(x0 - 24 * z, d0 - 16 * z); ctx.lineTo(x1 + 24 * z, d1 - 16 * z); ctx.stroke();
                for (let i = 0; i <= 8; i++) {
                    const t = i / 8, px = x0 - 24 * z + (x1 - x0 + 48 * z) * t, py = d0 + (d1 - d0) * t;
                    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - 16 * z); ctx.stroke();
                }
            } else {
                const bank = Math.min(terrain.heightAt(r.x0), terrain.heightAt(r.x1));
                const wy = gy - (bank - 6) * z;
                ctx.fillStyle = "rgba(37,99,235,0.72)";
                ctx.beginPath();
                ctx.moveTo(x0, wy);
                for (let wx = r.x0; wx <= r.x1; wx += 8) ctx.lineTo(cam.sx(wx), Math.max(wy, surf(wx) + 2 * z));
                ctx.lineTo(x1, wy);
                ctx.closePath(); ctx.fill();
                ctx.strokeStyle = "rgba(147,197,253,0.8)";
                ctx.lineWidth = 2 * z;
                ctx.beginPath(); ctx.moveTo(x0 + 6 * z, wy); ctx.lineTo(x1 - 6 * z, wy); ctx.stroke();
                // Current ripples.
                ctx.strokeStyle = "rgba(191,219,254,0.6)";
                ctx.lineWidth = 1.2 * z;
                for (let i = 0; i < 4; i++) {
                    const rx = x0 + (((f * 0.6 + i * 47) % Math.max(1, x1 - x0)));
                    ctx.beginPath(); ctx.moveTo(rx, wy + 3 * z); ctx.lineTo(rx + 14 * z, wy + 3 * z); ctx.stroke();
                }
            }
            ctx.restore();
        }
    },

    // Tunnel bores, drawn BEHIND the troops (the hill itself is ordinary
    // terrain traced from topAt, so the passage is cut through real ground):
    // a stone-lined bore with a rail track, timber support sets and lanterns.
    _drawCaves(ctx, w, gy, cam) {
        const z = cam.z, A = terrain.tunnelArch();
        const fl = (wx) => gy - terrain.heightAt(wx) * z;
        for (const t of terrain.tunnels) {
            const x0 = cam.sx(t.x0), x1 = cam.sx(t.x1);
            if (x1 < -60 || x0 > w + 60) continue;
            ctx.save();
            ctx.beginPath();
            this._archPath(ctx, t, gy, cam, A);
            ctx.clip();
            // Bore interior: cold rock fading to black at the floor.
            const top = fl((t.x0 + t.x1) / 2) - A * z;
            const g = ctx.createLinearGradient(0, top, 0, top + A * z);
            g.addColorStop(0, "#292524");
            g.addColorStop(1, "#0c0a09");
            ctx.fillStyle = g;
            ctx.fillRect(x0 - 4, top - 60 * z, x1 - x0 + 8, (A + 140) * z);
            // Masonry lining: staggered courses of dressed stone.
            ctx.strokeStyle = "rgba(0,0,0,0.45)";
            ctx.lineWidth = 1.5 * z;
            for (let row = 0; row < 6; row++) {
                const off = row * 17 + 8;
                ctx.beginPath();
                for (let wx = t.x0; wx <= t.x1; wx += 16) {
                    const y = fl(wx) - (A - off) * z;
                    if (wx === t.x0) ctx.moveTo(cam.sx(wx), y); else ctx.lineTo(cam.sx(wx), y);
                }
                ctx.stroke();
                for (let wx = t.x0 + (row % 2 ? 14 : 0); wx < t.x1; wx += 28) {
                    const y = fl(wx) - (A - off) * z;
                    ctx.beginPath(); ctx.moveTo(cam.sx(wx), y); ctx.lineTo(cam.sx(wx), y + 17 * z); ctx.stroke();
                }
            }
            ctx.fillStyle = "rgba(255,255,255,0.035)";
            for (let wx = t.x0 + 6; wx < t.x1; wx += 28)
                ctx.fillRect(cam.sx(wx), fl(wx) - (A - 10) * z, 20 * z, 4 * z);
            // Rail track: sleepers + two rails along the floor.
            ctx.fillStyle = "#3f2a1a";
            for (let wx = t.x0 + 4; wx < t.x1; wx += 18) ctx.fillRect(cam.sx(wx), fl(wx) - 4 * z, 10 * z, 4 * z);
            ctx.strokeStyle = "#78716c";
            ctx.lineWidth = 1.6 * z;
            for (const dy of [5, 2]) {
                ctx.beginPath();
                for (let wx = t.x0; wx <= t.x1; wx += 16) {
                    const y = fl(wx) - dy * z;
                    if (wx === t.x0) ctx.moveTo(cam.sx(wx), y); else ctx.lineTo(cam.sx(wx), y);
                }
                ctx.stroke();
            }
            // Timber support sets: posts, a cap beam and knee braces.
            ctx.strokeStyle = "#5b3a1e";
            for (let wx = t.x0 + 60; wx < t.x1 - 30; wx += 110) {
                const sx = cam.sx(wx), f0 = fl(wx), roof = f0 - A * z;
                ctx.lineWidth = 7 * z;
                ctx.beginPath(); ctx.moveTo(sx, f0); ctx.lineTo(sx, roof + 4 * z); ctx.stroke();
                ctx.lineWidth = 6 * z;
                ctx.beginPath(); ctx.moveTo(sx - 30 * z, roof + 5 * z); ctx.lineTo(sx + 30 * z, roof + 5 * z); ctx.stroke();
                ctx.lineWidth = 3 * z;
                ctx.beginPath();
                ctx.moveTo(sx - 22 * z, roof + 6 * z); ctx.lineTo(sx, roof + 26 * z); ctx.lineTo(sx + 22 * z, roof + 6 * z);
                ctx.stroke();
            }
            ctx.restore();
        }
    },

    // Lantern positions (world x) hung from every other support set.
    _lanterns(t) {
        const out = [];
        for (let wx = t.x0 + 115; wx < t.x1 - 60; wx += 220) out.push(wx);
        return out;
    },

    // Bore outline: floor → roof (A above the floor) with rounded portals.
    _archPath(ctx, t, gy, cam, A) {
        const z = cam.z;
        const fl = (wx) => gy - terrain.heightAt(wx) * z;
        const m = 34; // portal rounding
        ctx.moveTo(cam.sx(t.x0), fl(t.x0));
        ctx.quadraticCurveTo(cam.sx(t.x0), fl(t.x0) - A * z, cam.sx(t.x0 + m), fl(t.x0 + m) - A * z);
        for (let wx = t.x0 + m; wx <= t.x1 - m; wx += 16) ctx.lineTo(cam.sx(wx), fl(wx) - A * z);
        ctx.lineTo(cam.sx(t.x1 - m), fl(t.x1 - m) - A * z);
        ctx.quadraticCurveTo(cam.sx(t.x1), fl(t.x1) - A * z, cam.sx(t.x1), fl(t.x1));
        for (let wx = t.x1; wx >= t.x0; wx -= 16) ctx.lineTo(cam.sx(wx), fl(wx));
        ctx.closePath();
    },

    // Pine forests along the visible top (so forests crown tunnel ridges too).
    _drawForests(ctx, w, gy, cam, gnd) {
        const z = cam.z;
        const dark = shade(gnd, -0.55), mid = shade(gnd, -0.35);
        for (const fo of terrain.forests) {
            if (cam.sx(fo.x1) < -60 || cam.sx(fo.x0) > w + 60) continue;
            for (let layer = 0; layer < 2; layer++) {
                const sp = layer ? 30 : 44;
                for (let wx = fo.x0 + (layer ? 12 : 0); wx <= fo.x1; wx += sp) {
                    const sx = cam.sx(wx);
                    if (sx < -40 || sx > w + 40) continue;
                    const hsh = this._hash(wx * 0.37 + layer);
                    const th = (layer ? 62 : 80) + hsh * 48;
                    const tw = th * 0.34;
                    const by = gy - terrain.topAt(wx) * z + 2 * z;
                    const sway = Math.sin(this.frames * 0.015 + wx) * 1.5 * z;
                    ctx.fillStyle = "#3f2a1a";
                    ctx.fillRect(sx - 2 * z, by - 12 * z, 4 * z, 12 * z);
                    ctx.fillStyle = layer ? mid : dark;
                    for (let k = 0; k < 3; k++) {
                        const ty = by - 10 * z - k * th * 0.26 * z;
                        const kw = tw * (1 - k * 0.26) * z;
                        ctx.beginPath();
                        ctx.moveTo(sx - kw, ty);
                        ctx.lineTo(sx + sway, ty - th * 0.42 * z);
                        ctx.lineTo(sx + kw, ty);
                        ctx.closePath(); ctx.fill();
                    }
                }
            }
        }
    },

    // In front of the armies: tunnel gloom with lantern pools, stone portal
    // headwalls with torches, and a leaf-shade wash over forests.
    drawTerrainFront(ctx, w, cam) {
        if (terrain.isFlat()) return;
        const z = cam.z, A = terrain.tunnelArch();
        const gy = cam.toScreen(0, CONFIG.GROUND_Y).y;
        const lvl = LEVELS[this.level] || { ground: "#143d26" };
        const rock = shade(lvl.ground, -0.45), rockHi = mixCol(shade(lvl.ground, -0.2), "#78716c", 0.5);
        for (const t of terrain.tunnels) {
            if (cam.sx(t.x1 + 60) < -60 || cam.sx(t.x0 - 60) > w + 60) continue;
            const fl = (wx) => gy - terrain.heightAt(wx) * z;
            ctx.save();
            // Underground gloom over whoever is inside...
            ctx.fillStyle = "rgba(6,5,9,0.38)";
            ctx.beginPath();
            this._archPath(ctx, t, gy, cam, A);
            ctx.fill();
            // ...cut by warm lantern pools that light troops passing under them.
            ctx.globalCompositeOperation = "screen";
            for (const lx of this._lanterns(t)) {
                const sx = cam.sx(lx), roof = fl(lx) - A * z;
                if (sx < -120 || sx > w + 120) continue;
                const fk = 0.85 + 0.15 * Math.sin(this.frames * 0.23 + lx);
                const pool = ctx.createRadialGradient(sx, roof + 34 * z, 4, sx, roof + 50 * z, 120 * z);
                pool.addColorStop(0, `rgba(253,186,116,${0.42 * fk})`);
                pool.addColorStop(1, "rgba(0,0,0,0)");
                ctx.fillStyle = pool;
                ctx.fillRect(sx - 120 * z, roof - 10 * z, 240 * z, (A + 20) * z);
            }
            ctx.globalCompositeOperation = "source-over";
            for (const lx of this._lanterns(t)) {
                const sx = cam.sx(lx), roof = fl(lx) - A * z;
                if (sx < -40 || sx > w + 40) continue;
                ctx.strokeStyle = "#292524";
                ctx.lineWidth = 1.2 * z;
                ctx.beginPath(); ctx.moveTo(sx, roof + 8 * z); ctx.lineTo(sx, roof + 26 * z); ctx.stroke();
                ctx.fillStyle = "#1c1917";
                ctx.fillRect(sx - 5 * z, roof + 26 * z, 10 * z, 13 * z);
                ctx.fillStyle = `rgba(254,215,170,${0.8 + 0.2 * Math.sin(this.frames * 0.3 + lx)})`;
                ctx.fillRect(sx - 3 * z, roof + 28 * z, 6 * z, 9 * z);
                if (this.frames % 4 === 0) this.lights.add({ x: lx, y: terrain.groundAt(lx) - A + 34, radius: 130, intensity: 0.7, color: "#fdba74", flicker: 0.2, life: 6 });
            }
            // Portal headwalls: dressed-stone jambs, a voussoir ring over the
            // mouth and a keystone, framing the troops as they pass under.
            for (const [mx, dir] of [[t.x0, 1], [t.x1, -1]]) {
                const sx = cam.sx(mx), f0 = fl(mx);
                const rise = (A + 26) * z;
                ctx.fillStyle = "#57534e";
                ctx.fillRect(sx - (dir > 0 ? 14 : 0) * z, f0 - rise, 14 * z, rise);
                ctx.strokeStyle = "rgba(0,0,0,0.45)";
                ctx.lineWidth = 1.2 * z;
                for (let k = 1; k < 7; k++) {
                    const y = f0 - k * (rise / 7);
                    ctx.beginPath(); ctx.moveTo(sx - (dir > 0 ? 14 : 0) * z, y); ctx.lineTo(sx + (dir > 0 ? 0 : 14) * z, y); ctx.stroke();
                }
                // Voussoir ring following the rounded portal.
                ctx.strokeStyle = "#78716c";
                ctx.lineWidth = 9 * z;
                ctx.beginPath();
                ctx.moveTo(sx, f0 - 8 * z);
                ctx.quadraticCurveTo(sx, f0 - A * z, sx + dir * 34 * z, fl(mx + dir * 34) - A * z);
                ctx.lineTo(sx + dir * 58 * z, fl(mx + dir * 58) - A * z);
                ctx.stroke();
                ctx.strokeStyle = "rgba(0,0,0,0.5)";
                ctx.lineWidth = 1 * z;
                for (let k = 0; k < 6; k++) {
                    const u = k / 6, cxp = sx + dir * 34 * z * u, cyp = f0 - 8 * z - (A - 8) * z * Math.sqrt(u + 0.05);
                    ctx.beginPath(); ctx.moveTo(cxp - 4 * z, cyp - 4 * z); ctx.lineTo(cxp + 4 * z, cyp + 4 * z); ctx.stroke();
                }
                ctx.fillStyle = "#a8a29e";
                ctx.fillRect(sx + dir * 30 * z - 5 * z, fl(mx + dir * 30) - (A + 7) * z, 10 * z, 12 * z);
                // Portal torch.
                const tf = 0.7 + 0.3 * Math.sin(this.frames * 0.31 + mx);
                ctx.fillStyle = `rgba(251,146,60,${tf})`;
                ctx.beginPath(); ctx.arc(sx - dir * 20 * z, f0 - (A - 30) * z, 4 * z, 0, Math.PI * 2); ctx.fill();
                if (this.frames % 4 === 0) this.lights.add({ x: mx - dir * 20, y: terrain.groundAt(mx) - A + 30, radius: 90, intensity: 0.6, color: "#fb923c", flicker: 0.3, life: 6 });
            }
            ctx.restore();
        }
        // Leaf shade over forest floors (not over tunnel ridges).
        for (const fo of terrain.forests) {
            if (fo.onRidge || cam.sx(fo.x1) < -20 || cam.sx(fo.x0) > w + 20) continue;
            ctx.fillStyle = "rgba(4,20,8,0.16)";
            ctx.beginPath();
            ctx.moveTo(cam.sx(fo.x0), gy - terrain.heightAt(fo.x0) * z);
            for (let wx = fo.x0; wx <= fo.x1; wx += 16) ctx.lineTo(cam.sx(wx), gy - (terrain.heightAt(wx) + 90) * z);
            for (let wx = fo.x1; wx >= fo.x0; wx -= 16) ctx.lineTo(cam.sx(wx), gy - terrain.heightAt(wx) * z);
            ctx.closePath(); ctx.fill();
        }
    },

    // Rolling hills: one filled silhouette traced from the terrain height
    // samples across the visible span (no per-frame allocation), a lit crest
    // rim that follows the surface, and a darker strata line beneath it so the
    // rise reads as solid earth rather than a painted bump.
    _drawHills(ctx, w, gy, cam, gnd, gTop, rimCol, sun) {
        const z = cam.z, STEP = 8;
        // Trace the VISIBLE top, so hills over tunnels are part of the land.
        const surf = (sx) => gy - terrain.topAt(cam.x + sx / z) * z;
        const trace = (off) => {
            ctx.moveTo(-STEP, surf(-STEP) + off);
            for (let sx = 0; sx <= w + STEP; sx += STEP) ctx.lineTo(sx, surf(sx) + off);
        };
        // Earth body: lighter at the crest, settling into the ground colour.
        const top = gy - 150 * z;
        const key = gTop + "|" + gnd + "|" + gy;
        if (this._hillKey !== key) {
            const g = ctx.createLinearGradient(0, top, 0, gy + 4);
            g.addColorStop(0, mixCol(gTop, "#fff7e0", 0.16));
            g.addColorStop(1, gnd);
            this._hillKey = key;
            this._hillGrad = g;
        }
        ctx.fillStyle = GFX.flatScenery ? gnd : this._hillGrad;
        ctx.beginPath();
        trace(0);
        ctx.lineTo(w + STEP, gy + 4);
        ctx.lineTo(-STEP, gy + 4);
        ctx.closePath();
        ctx.fill();
        ctx.lineJoin = "round";
        // Strata shadow under the lip, then the sunlit rim on top.
        ctx.strokeStyle = "rgba(0,0,0,0.28)";
        ctx.lineWidth = 2;
        ctx.beginPath(); trace(4); ctx.stroke();
        if (!GFX.flatScenery) {
            ctx.strokeStyle = toRgba(shade(gnd, -0.4), 0.35);
            ctx.lineWidth = 1.5;
            ctx.beginPath(); trace(16); ctx.stroke();
        }
        ctx.strokeStyle = rimCol;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); trace(-1); ctx.stroke();
        ctx.lineJoin = "miter";
    },

    // Slow-ground patches painted onto the surface: glossy mud with bubbles,
    // wind-carved snowdrifts, and reedy marsh water.
    _drawPatches(ctx, w, gy, cam) {
        const z = cam.z;
        for (const p of terrain.patches) {
            const x0 = cam.sx(p.x0), x1 = cam.sx(p.x1);
            if (x1 < -20 || x0 > w + 20) continue;
            const def = TERRAIN_PATCHES[p.kind];
            const surf = (wx) => gy - terrain.heightAt(wx) * z;
            const depth = (p.kind === "snow" ? 9 : 12) * z;
            ctx.save();
            ctx.fillStyle = def.top;
            ctx.globalAlpha = p.kind === "marsh" ? 0.82 : 0.92;
            ctx.beginPath();
            // Tapered ends so the patch blends into the grass.
            ctx.moveTo(x0 - 10 * z, surf(p.x0) + 1);
            for (let wx = p.x0; wx <= p.x1; wx += 10) {
                const bump = p.kind === "snow" ? Math.abs(Math.sin(wx * 0.045)) * 5 * z : 0;
                ctx.lineTo(cam.sx(wx), surf(wx) - 2 * z - bump);
            }
            ctx.lineTo(x1 + 10 * z, surf(p.x1) + 1);
            for (let wx = p.x1; wx >= p.x0; wx -= 20) ctx.lineTo(cam.sx(wx), surf(wx) + depth);
            ctx.closePath();
            ctx.fill();
            // Surface sheen.
            ctx.globalAlpha = 0.5;
            ctx.strokeStyle = def.sheen;
            ctx.lineWidth = 1.2 * z;
            ctx.beginPath();
            for (let wx = p.x0 + 8; wx <= p.x1 - 8; wx += 10) {
                const y = surf(wx) - (p.kind === "snow" ? 3 : 1) * z;
                if (wx === p.x0 + 8) ctx.moveTo(cam.sx(wx), y); else ctx.lineTo(cam.sx(wx), y);
            }
            ctx.stroke();
            ctx.globalAlpha = 0.75;
            if (p.kind === "mud") {
                // Slow bubbles that swell and pop.
                for (let i = 0; i < 5; i++) {
                    const wx = p.x0 + ((i * 53 + 17) % Math.max(1, p.x1 - p.x0));
                    const t = ((this.frames * 0.02 + i * 0.37) % 1);
                    ctx.strokeStyle = def.sheen;
                    ctx.beginPath();
                    ctx.arc(cam.sx(wx), surf(wx) + 3 * z, (1 + t * 3) * z, Math.PI, 0);
                    ctx.stroke();
                }
            } else if (p.kind === "marsh") {
                // Reeds swaying out of the water.
                ctx.strokeStyle = "#3f6212";
                ctx.lineWidth = 1.4 * z;
                for (let wx = p.x0 + 12; wx < p.x1 - 6; wx += 22) {
                    const sway = Math.sin(this.frames * 0.03 + wx) * 2 * z;
                    const by = surf(wx);
                    ctx.beginPath();
                    ctx.moveTo(cam.sx(wx), by);
                    ctx.quadraticCurveTo(cam.sx(wx) + sway, by - 10 * z, cam.sx(wx) + sway * 1.6, by - (16 + (wx % 7)) * z);
                    ctx.stroke();
                }
            }
            ctx.restore();
        }
    },

    drawForeground(ctx, w, h, cam, lvl, dP) {
        // Ambient drifting motes / embers in front of the action (Cinematic only)
        if (GFX.postFX) {
            ctx.save();
            ctx.globalCompositeOperation = "screen";
            const moteCol = dP > 0 ? "#fff2c4" : "#a9c2ff";
            const n = 20;
            for (let i = 0; i < n; i++) {
                const m = w + 60;
                const mx = (((i * 173 + this.frames * (0.3 + (i % 3) * 0.18)) % m) + m) % m - 30;
                const t = this.frames * 0.01 + i;
                const my = h * 0.5 + Math.sin(t * 1.1 + i) * h * 0.22 + (i % 5) * 18;
                ctx.globalAlpha = 0.1 + Math.max(0, Math.sin(t * 2 + i)) * 0.12;
                ctx.fillStyle = moteCol;
                ctx.beginPath(); ctx.arc(mx, my, 1 + (i % 3), 0, Math.PI * 2); ctx.fill();
            }
            ctx.restore();
        }
        // Soft out-of-focus framing blades at the screen edges (cinematic depth)
        ctx.save();
        ctx.fillStyle = shade(lvl.ground, -0.72);
        ctx.globalAlpha = 0.5;
        const blade = (bx, dir, scl) => {
            const sway = Math.sin(this.frames * 0.02 + bx) * 10 * scl;
            ctx.beginPath();
            ctx.moveTo(bx - 16 * scl, h);
            ctx.quadraticCurveTo(bx + sway * 0.4, h - h * 0.34 * scl, bx + sway + dir * 8 * scl, h - h * 0.55 * scl);
            ctx.quadraticCurveTo(bx + sway * 0.5, h - h * 0.3 * scl, bx + 16 * scl, h);
            ctx.closePath(); ctx.fill();
        };
        blade(28, -1, 1.0); blade(64, 1, 0.8); blade(12, 1, 0.7);
        blade(w - 26, 1, 1.0); blade(w - 60, -1, 0.85);
        ctx.restore();
    },

    drawPostFX(ctx, w, h, dP) {
        if (this._vignette) {
            ctx.fillStyle = this._vignette;
            ctx.fillRect(0, 0, w, h);
        }
        if (GFX.postFX && this._grainPat) {
            ctx.save();
            ctx.globalAlpha = 0.045;
            ctx.globalCompositeOperation = "overlay";
            const ox = (Math.random() * 60) | 0, oy = (Math.random() * 60) | 0;
            ctx.translate(-ox, -oy);
            ctx.fillStyle = this._grainPat;
            ctx.fillRect(0, 0, w + 64, h + 64);
            ctx.restore();
        }
        // Chromatic aberration: a brief red/blue channel-split flash triggered by
        // the Singularity detonation (game.chromaAberrationT set to 30 there).
        if (this.chromaAberrationT > 0) {
            const a = this.chromaAberrationT / 30;
            ctx.save();
            ctx.globalCompositeOperation = "screen";
            ctx.globalAlpha = 0.25 * a;
            ctx.fillStyle = "rgba(255,80,80,1)";
            ctx.fillRect(4 * a, 0, w, h);
            ctx.fillStyle = "rgba(80,180,255,1)";
            ctx.fillRect(-4 * a, 0, w, h);
            ctx.restore();
            this.chromaAberrationT = Math.max(0, this.chromaAberrationT - 1);
        }
    },

    draw(dt) {
        const ctx = this.ctx,
            w = this.vw,
            h = this.vh,
            cam = this.camera;
        ctx.save();
        // Render-scale (Performance tier only, otherwise a no-op identity
        // scale): drawing happens entirely in logical (CSS-pixel) space via
        // w/h above; this maps it down to the smaller physical backing
        // store, and the CSS width/height:100vw/100vh on #gameCanvas
        // upscales it back to fill the viewport. Must come BEFORE the shake
        // translate below so the shake amplitude round-trips unchanged
        // through the scale-down + CSS-upscale.
        const rs = GFX.renderScale || 1;
        if (rs !== 1) ctx.scale(rs, rs);
        // Smooth, frame-coherent camera shake (ambient trauma + typed impulses)
        // from CameraFX — replaces the old per-frame white-noise rand. Captured
        // once so the GPU overlay can track the 2D layer exactly (it's a separate
        // canvas without this ctx translate).
        const camOff = this.cameraFX.offset(this.shake);
        this._shakeX = camOff.x;
        this._shakeY = camOff.y;
        if (camOff.x || camOff.y) ctx.translate(camOff.x, camOff.y);

        // Pick the active additive-glow overlay for this frame: WebGPU once its
        // device is ready, else the WebGL renderer. Repointing `this.gl` here is
        // what lets vfx/void/hero (which read g.gl) use whichever backend is live
        // with no per-site branching.
        this.gl = (this.wgpu && this.wgpu.ok) ? this.wgpu : this.glWebgl;
        // Start the GPU glow batch for this frame (particles + auras queue into
        // it during the world pass; flushed after). No-op when the overlay is off.
        const useGL = GFX.webgl && this.gl && this.gl.ok;
        if (useGL) this.gl.begin();

        const lvl =
            this.level >= 0 && LEVELS[this.level]
                ? LEVELS[this.level]
                : { sky: "#0f172a", ground: "#143d26" };
        const dP = Math.sin(this.dayT);

        this.drawBackdrop(ctx, w, h, cam, lvl, dP);

        ctx.save();
        this.decals.draw(ctx, cam);
        this.objectives.draw(ctx, cam);   // hilltop shrines
        this.hazards.drawUnder(ctx, cam); // ground telegraphs sit beneath the armies

        // Reuse one scratch array instead of allocating four .map() arrays + a
        // combined spread + a {t,o} wrapper per entity (whose `t` tag was never
        // read) every frame. Same concat order + stable sort => identical draw
        // order, including y-ties. draw() does not mutate these arrays.
        const ents = this._drawList || (this._drawList = []);
        ents.length = 0;
        for (const b of this.buildings) ents.push(b);
        for (const u of this.units) ents.push(u);
        for (const e of this.enemies) ents.push(e);
        for (const p of this.projectiles) ents.push(p);
        ents.sort((a, b) => a.y - b.y);
        ents.forEach((o) => o.draw(ctx, cam, dt));
        this.drawTerrainFront(ctx, w, cam); // tunnel gloom + portals, forest canopy
        this.orbital.draw(ctx, cam);         // castle uplink, targeting laser, strikes
        this.hazards.drawOver(ctx, cam);

        this.particles.draw(ctx, cam);
        // Dynamic lights queue into the active glow overlay (WebGPU/WebGL) using
        // the same captured shake offset as particles. No-op on Canvas-2D / when
        // GFX.lights is off. Queued during the world pass, composited at flush.
        this.lights.draw(this.gl, cam, this._shakeX, this._shakeY, this.frames);
        // Normal-lit relief for the crowd: queue units/enemies near a live light
        // so explosions shape the whole army, not just the hero/boss (which
        // self-queue in their own draw()). Culled to lit sprites + capped, so a
        // scene with no lights costs nothing. WebGPU tier only (reliefSprite is
        // a no-op on WebGL/Canvas).
        if (this.gl && this.gl.reliefSprite && GFX.lights && this.lights.lights.length) {
            const La = this.lights.lights;
            const litNear = (wx, wy) => {
                for (let k = 0; k < La.length; k++) {
                    const l = La[k], dx = wx - l.x, dy = wy - l.y;
                    if (dx * dx + dy * dy < l.radius * l.radius) return true;
                }
                return false;
            };
            let budget = 44; // leave headroom under MAX_SPRITES(48) for hero/boss
            const queue = (arr, fallbackCol, strength) => {
                for (let i = 0; i < arr.length && budget > 0; i++) {
                    const u = arr[i];
                    if (!u.active || u === this.hero || u.boss) continue;
                    const sscale = u.scale || 1;
                    if (!litNear(u.x, u.y - 20 * sscale)) continue;
                    const rgb = u._reliefRGB || (u._reliefRGB = GLRenderer.parseColor(u.col || fallbackCol));
                    const sc = sscale * cam.z;
                    // Tight body half-width (not full sprite bounds) + low strength
                    // so thin humanoids don't paint a glowing disc around themselves.
                    this.gl.reliefSprite(
                        cam.sx(u.x) + this._shakeX,
                        cam.sy(u.y - 20 * sscale) + this._shakeY,
                        8 * sc, 24 * sc, rgb, strength,
                    );
                    budget--;
                }
            };
            queue(this.units, "#94a3b8", 0.42);
            queue(this.enemies, "#b45454", 0.42);
        }
        this.fx.draw(ctx, cam);
        for (const s of this.singularities) s.draw(ctx, cam);
        this.weather.draw(ctx, cam);

        if (this.sel && this.sel.active) {
            const p = cam.toScreen(this.sel.x, this.sel.y);
            ctx.strokeStyle = "rgba(251,191,36,0.8)";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.ellipse(
                p.x,
                p.y + 2,
                30 * cam.z,
                12 * cam.z,
                0,
                0,
                Math.PI * 2,
            );
            ctx.stroke();
        }
        ctx.restore();

        // Cinematic foreground (drifting motes + edge framing)
        this.drawForeground(ctx, w, h, cam, lvl, dP);

        if (dP < -0.1) {
            ctx.fillStyle = `rgba(2,6,23,${Math.min(0.55, (-dP - 0.1) * 0.7)})`;
            ctx.fillRect(0, 0, w, h);
        } else if (dP > 0.8) {
            ctx.fillStyle = `rgba(255,245,225,${(dP - 0.8) * 0.2})`;
            ctx.fillRect(0, 0, w, h);
        }

        // Castle danger vignette (cached gradient, pulse via globalAlpha)
        const cas2 = this.buildings.find(b => b.type === "castle" && b.active && b.hp > 0);
        if (cas2 && cas2.hp / cas2.maxHp < 0.35 && this._dangerVignette) {
            const ratio2 = 1 - (cas2.hp / cas2.maxHp) / 0.35;
            const pulse2 = (Math.sin(Date.now() * 0.004) + 1) * 0.5;
            const alpha2 = (0.08 + ratio2 * 0.22) * (0.5 + pulse2 * 0.5);
            ctx.save();
            ctx.globalAlpha = alpha2;
            ctx.fillStyle = this._dangerVignette;
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
        }
        // Boss presence: the world dims under the Hollow Engine, and entrance /
        // impact flashes wash the screen. Both are purely cosmetic overlays
        // gated on the encounter state (no gameplay effect).
        if ((this.bossState === "active" || this.bossState === "warning") && this._bossVignette) {
            const pulse = (Math.sin(Date.now() * 0.003) + 1) * 0.5;
            const a = 0.12 + pulse * 0.06;
            ctx.save();
            ctx.globalAlpha = a;
            ctx.fillStyle = this._bossVignette;
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
        }
        if (this.bossFlash > 0) {
            ctx.fillStyle = `rgba(255,240,222,${Math.min(0.6, this.bossFlash)})`;
            ctx.fillRect(0, 0, w, h);
        }

        // Lightning arc rendering
        for (let i = this.lightningArcs.length - 1; i >= 0; i--) {
            const arc = this.lightningArcs[i];
            arc.life -= dt;
            if (arc.life <= 0) { this.lightningArcs.splice(i, 1); continue; }
            const p1 = cam.toScreen(arc.x1, arc.y1);
            const p2 = cam.toScreen(arc.x2, arc.y2);
            ctx.save();
            ctx.globalAlpha = (arc.life / 14) * 0.85;
            ctx.globalCompositeOperation = "screen";
            ctx.strokeStyle = "#7dd3fc";
            ctx.lineWidth = 2.5 * cam.z;
            if (GFX.shadows) { ctx.shadowBlur = 18; ctx.shadowColor = "#38bdf8"; }
            ctx.beginPath();
            const steps = 7;
            ctx.moveTo(p1.x, p1.y);
            for (let s = 1; s < steps; s++) {
                const tt = s / steps;
                const mx = p1.x + (p2.x - p1.x)*tt + (Math.random()-0.5)*28;
                const my = p1.y + (p2.y - p1.y)*tt + (Math.random()-0.5)*28;
                ctx.lineTo(mx, my);
            }
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
            if (GFX.shadows) ctx.shadowBlur = 0;
            ctx.restore();
        }

        // Cinematic post-processing (vignette + film grain)
        this.drawPostFX(ctx, w, h, dP);

        ctx.restore();
        // Composite the GPU glow batch (particles + auras) over the 2D frame in
        // a single draw call. Always flush (even empty) so a frame with nothing
        // queued still clears the previous frame's glows.
        if (this.gl && this.gl.ok) {
            // Hand the WebGPU overlay this frame's camera + timestep so its GPU
            // particle sim can advance (no-op on the WebGL overlay).
            if (this.gl.setFrame) this.gl.setFrame(dt, cam, this._shakeX, this._shakeY, this.frames);
            this.gl.flush();
        }
        this.drawMinimap();
    },
});
