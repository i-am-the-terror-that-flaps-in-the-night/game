import { CONFIG } from '../config.js';
import { LEVELS } from '../data/levels.js';
import { clamp, mixCol, mixRgb, rand, rgba, shade, toRgb, toRgba } from '../utils.js';
import { GFX } from '../systems/graphics.js';

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
        ctx.fillStyle = toRgba(mixRgb(gnd, { r: 255, g: 255, b: 240 }, 0.5), 0.45 + sun * 0.3);
        ctx.fillRect(0, gy - 2, w, 2.5);
        ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.fillRect(0, gy + 2, w, 2);

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
            const baseY = gy - 1;
            const hgt = 7 + Math.abs(Math.sin(wx * 0.7)) * 6;
            ctx.beginPath();
            ctx.moveTo(sxp, baseY); ctx.lineTo(sxp - 3 + sway, baseY - hgt);
            ctx.moveTo(sxp, baseY); ctx.lineTo(sxp + sway, baseY - hgt - 2);
            ctx.moveTo(sxp, baseY); ctx.lineTo(sxp + 3 + sway, baseY - hgt);
            ctx.stroke();
        }
        ctx.restore();
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
        // Capture the shake offset once so the WebGL overlay can track the 2D
        // layer exactly (it's a separate canvas without this ctx translate).
        this._shakeX = this.shake > 0 ? rand(-this.shake, this.shake) : 0;
        this._shakeY = this.shake > 0 ? rand(-this.shake, this.shake) : 0;
        if (this.shake > 0) ctx.translate(this._shakeX, this._shakeY);

        // Start the GPU glow batch for this frame (particles + auras queue into
        // it during the world pass; flushed after). No-op when WebGL is off.
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

        this.particles.draw(ctx, cam);
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
        if (this.gl && this.gl.ok) this.gl.flush();
        this.drawMinimap();
    },
});
