import { CONFIG } from '../config.js';
import { LEVELS } from '../data/levels.js';
import { Game } from './game.js';
import { clamp, mixCol, mixRgb, rand, rgba, shade, toRgb, toRgba } from '../utils.js';

// --- GAME: backdrop, foreground, post-FX & frame draw ---
Object.assign(Game.prototype, /** @type {ThisType<any>} */ ({

    // ─── CINEMATIC ENVIRONMENT ──────────────────────────────
    _buildBackdropCache() {
        const w = this.canvas.width,
            h = this.canvas.height,
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
        const q = +(document.getElementById("particleQuality")?.value || 1);
        const sun = clamp(dP, 0, 1);
        const night = clamp(-dP, 0, 1);
        const dawn = clamp(1 - Math.abs(dP) * 1.7, 0, 1);
        const gy = cam.toScreen(0, CONFIG.GROUND_Y).y;
        const warm = "#ff9d5c", cool = "#16203a";

        // Atmospheric horizon color, derived from the level theme
        const glowT = clamp(dawn * 0.6 + sun * 0.32, 0, 0.78);
        const horizonO = mixRgb(mixRgb(sky, cool, night * 0.45), warm, glowT);
        const skyTop = shade(sky, -0.5 - night * 0.12);

        // Sky
        const sg = ctx.createLinearGradient(0, 0, 0, gy + 30);
        sg.addColorStop(0, skyTop);
        sg.addColorStop(0.45, sky);
        sg.addColorStop(0.82, toRgb(mixRgb(sky, horizonO, 0.7)));
        sg.addColorStop(1, toRgb(horizonO));
        ctx.fillStyle = sg;
        ctx.fillRect(0, 0, w, gy + 30);

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
        // Corona
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        const cor = ctx.createRadialGradient(cX, cY, 0, cX, cY, bodyR * (isSun ? 7 : 4.8));
        cor.addColorStop(0, rgba(isSun ? "#ffe7a8" : "#cdd9ff", 0.5));
        cor.addColorStop(0.25, rgba(isSun ? "#ffb86b" : "#9db4ff", 0.2));
        cor.addColorStop(1, "transparent");
        ctx.fillStyle = cor;
        ctx.fillRect(cX - bodyR * 8, cY - bodyR * 8, bodyR * 16, bodyR * 16);
        // God rays
        if (isSun && sun > 0.12 && q >= 1) {
            ctx.translate(cX, cY);
            ctx.rotate(this.dayT * 0.08);
            const rays = 9, len = h;
            for (let i = 0; i < rays; i++) {
                ctx.rotate((Math.PI * 2) / rays);
                const rg = ctx.createLinearGradient(0, 0, 0, len);
                rg.addColorStop(0, rgba("#ffe7a8", 0.045 * sun));
                rg.addColorStop(1, "transparent");
                ctx.fillStyle = rg;
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
        ctx.shadowBlur = isSun ? 42 : 22;
        ctx.shadowColor = bodyCol;
        ctx.beginPath(); ctx.arc(cX, cY, bodyR, 0, Math.PI * 2); ctx.fill();
        if (!isSun) {
            ctx.shadowBlur = 0;
            ctx.fillStyle = "rgba(154,169,214,0.5)";
            ctx.beginPath(); ctx.arc(cX - 7, cY - 5, 4.5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(cX + 6, cY + 5, 3, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(cX + 2, cY - 8, 2.2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();

        // Clouds
        {
            const cloudTint = mixRgb(mixRgb({ r: 248, g: 251, b: 255 }, sky, 0.35 + night * 0.4), warm, dawn * 0.4);
            const ca = clamp((0.2 + sun * 0.16) * (1 - night * 0.45), 0.05, 0.36);
            ctx.save();
            ctx.globalAlpha = ca;
            const nClouds = q < 1 ? 3 : 6;
            for (let i = 0; i < nClouds; i++) {
                const m = w + 800;
                const cx = (((i * 660 + this.frames * (0.2 + (i % 3) * 0.06) - cam.x * 0.05) % m) + m) % m - 400;
                const cy = gy * (0.13 + (i % 3) * 0.12);
                const sc = 0.7 + (i % 4) * 0.25;
                for (let b = 0; b < 5; b++) {
                    const bx = cx + (b - 2) * 42 * sc;
                    const by = cy + Math.sin(b * 1.3 + i) * 9 * sc;
                    const br = (36 - Math.abs(b - 2) * 6) * sc * 1.6;
                    const cg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
                    cg.addColorStop(0, toRgba(cloudTint, 1));
                    cg.addColorStop(1, "transparent");
                    ctx.fillStyle = cg;
                    ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
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
        const hz = ctx.createLinearGradient(0, gy - gy * 0.3, 0, gy + 6);
        hz.addColorStop(0, "transparent");
        hz.addColorStop(1, toRgba(horizonO, 0.55 + dawn * 0.2));
        ctx.fillStyle = hz;
        ctx.fillRect(0, gy - gy * 0.3, w, gy * 0.3 + 6);

        // Tree-line silhouette
        this._drawRidge(ctx, w, gy, cam, {
            parallax: 0.26, seg: 26,
            color: shade(gnd, -0.62),
            top: gy * 0.95, amp: gy * 0.12,
        });

        // ── GROUND ──
        const gTop = mixCol(gnd, "#fff7e0", 0.1 * sun + 0.02);
        const gg = ctx.createLinearGradient(0, gy, 0, h);
        gg.addColorStop(0, gTop);
        gg.addColorStop(0.22, gnd);
        gg.addColorStop(1, shade(gnd, -0.58));
        ctx.fillStyle = gg;
        ctx.fillRect(0, gy, w, h - gy);

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
        const q = +(document.getElementById("particleQuality")?.value || 1);
        // Ambient drifting motes / embers in front of the action
        if (q >= 1) {
            ctx.save();
            ctx.globalCompositeOperation = "screen";
            const moteCol = dP > 0 ? "#fff2c4" : "#a9c2ff";
            const n = q >= 2 ? 20 : 12;
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
        const q = +(document.getElementById("particleQuality")?.value || 1);
        if (q >= 1 && this._grainPat) {
            ctx.save();
            ctx.globalAlpha = 0.045;
            ctx.globalCompositeOperation = "overlay";
            const ox = (Math.random() * 60) | 0, oy = (Math.random() * 60) | 0;
            ctx.translate(-ox, -oy);
            ctx.fillStyle = this._grainPat;
            ctx.fillRect(0, 0, w + 64, h + 64);
            ctx.restore();
        }
    },

    draw(dt) {
        const ctx = this.ctx,
            w = this.canvas.width,
            h = this.canvas.height,
            cam = this.camera;
        ctx.save();
        if (this.shake > 0)
            ctx.translate(
                rand(-this.shake, this.shake),
                rand(-this.shake, this.shake),
            );

        const lvl =
            this.level >= 0 && LEVELS[this.level]
                ? LEVELS[this.level]
                : { sky: "#0f172a", ground: "#143d26" };
        const dP = Math.sin(this.dayT);

        this.drawBackdrop(ctx, w, h, cam, lvl, dP);

        ctx.save();
        this.decals.draw(ctx, cam);

        const ents = [
            ...this.buildings.map((b) => ({ t: "b", o: b })),
            ...this.units.map((u) => ({ t: "u", o: u })),
            ...this.enemies.map((e) => ({ t: "e", o: e })),
            ...this.projectiles.map((p) => ({ t: "p", o: p })),
        ];
        ents.sort((a, b) => a.o.y - b.o.y);
        ents.forEach((e) => e.o.draw(ctx, cam, dt));

        this.particles.draw(ctx, cam);
        this.fx.draw(ctx, cam);
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

        // Castle danger vignette
        const cas2 = this.buildings.find(b => b.type === "castle" && b.active && b.hp > 0);
        if (cas2 && cas2.hp / cas2.maxHp < 0.35) {
            const ratio2 = 1 - (cas2.hp / cas2.maxHp) / 0.35;
            const pulse2 = (Math.sin(Date.now() * 0.004) + 1) * 0.5;
            const alpha2 = (0.08 + ratio2 * 0.22) * (0.5 + pulse2 * 0.5);
            const vg = ctx.createRadialGradient(w/2, h/2, h*0.22, w/2, h/2, h*0.85);
            vg.addColorStop(0, "transparent");
            vg.addColorStop(1, `rgba(200,0,0,${alpha2})`);
            ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
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
            ctx.shadowBlur = 18; ctx.shadowColor = "#38bdf8";
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
            ctx.shadowBlur = 0; ctx.restore();
        }

        // Cinematic post-processing (vignette + film grain)
        this.drawPostFX(ctx, w, h, dP);

        ctx.restore();
        this.drawMinimap();
    },
}));
