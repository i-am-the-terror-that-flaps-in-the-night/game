// --- WebGPU ADDITIVE OVERLAY (superset of the WebGL glow overlay) -----------
//
// An optional GPU overlay that supersedes js/systems/gl-renderer.js (WebGL) when
// WebGPU is available. It mirrors the GLRenderer public contract exactly
// (`ok` / `begin()` / `glow()` / `flush()` / `resize()`) so it is a DROP-IN for
// the active overlay — the game repoints `game.gl` at whichever backend is live
// each frame, and the external call sites (vfx.js / void.js / hero.js) that read
// `g.gl` need no branching.
//
// Beyond glow it grows extra capabilities in later stages (GPU-compute
// particles, dynamic lights, bloom, distortion) exposed through additional
// methods that are harmless no-ops until their pipelines exist. Everything
// degrades gracefully: if WebGPU is unavailable, adapter/device init fails, or
// the device is later lost, `ok` stays/returns false and the caller falls back
// to the untouched WebGL → Canvas-2D path.
//
// Boot model: the constructor is synchronous and touches NO GPU state, so the
// game is fully playable on WebGL/Canvas from frame 0. `initAsync()` is kicked
// off fire-and-forget; when the device is ready `ok` flips true and the render
// loop promotes this overlay on the next frame. No frame ever waits on the GPU.
//
// IMPORTANT (smoke contract): no code path here may throw out of a frame or emit
// `console.error` — headless Chromium has no WebGPU and the smoke run fails on
// any pageerror/console.error. All failures are `console.warn` + graceful false.

import { GPUParticles } from './gpu-particles.js';
import { GPURelief } from './gpu-relief.js';
import { GPUSingularity } from './gpu-singularity.js';
import { GPUTrails } from './gpu-trails.js';
import { GPUCompositor } from './gpu-compositor.js';
import { GFX } from './graphics.js';

// Same additive radial-falloff quad as the WebGL overlay, ported to WGSL. Output
// is premultiplied (rgb*w, w) and accumulated with an additive blend, so the
// transparent overlay composites over the 2D canvas as bright glow.
const GLOW_WGSL = /* wgsl */ `
struct VOut {
  @builtin(position) pos : vec4f,
  @location(0) uv  : vec2f,
  @location(1) col : vec4f,
};
@group(0) @binding(0) var<uniform> uRes : vec2f;

@vertex
fn vs(@location(0) aPos : vec2f,
      @location(1) aUV  : vec2f,
      @location(2) aColor : vec4f) -> VOut {
  var o : VOut;
  // pixel -> clip space, y flipped (canvas origin top-left), matching WebGL.
  let clip = vec2f(aPos.x / uRes.x * 2.0 - 1.0,
                   1.0 - aPos.y / uRes.y * 2.0);
  o.pos = vec4f(clip, 0.0, 1.0);
  o.uv  = aUV;
  o.col = aColor;
  return o;
}

@fragment
fn fs(i : VOut) -> @location(0) vec4f {
  // Soft radial falloff: bright core, smooth transparent edge (GPU glow).
  let d = i.uv - vec2f(0.5, 0.5);
  let r = length(d) * 2.0;
  var a = 1.0 - smoothstep(0.0, 1.0, r);
  a = a * a;                     // tighter hot core
  let w = i.col.a * a;
  return vec4f(i.col.rgb * w, w);   // premultiplied additive contribution
}
`;

// Vertex layout mirrors the WebGL batch: pos(2)+uv(2)+color(4)=8 floats/vert,
// 6 verts/quad. Kept identical so the glow() writer is a copy of GLRenderer's.
const FLOATS_PER_VERT = 8;
const VERTS_PER_QUAD = 6;
const FLOATS_PER_QUAD = FLOATS_PER_VERT * VERTS_PER_QUAD;

export class WGPURenderer {
    /**
     * @param {any} [game] back-reference (unused in Stage A; later stages read
     *   camera / scene canvas through it)
     */
    constructor(game) {
        this.game = game || null;
        this.ok = false;           // true only once the device + pipeline exist
        this.supported = typeof navigator !== "undefined" && !!navigator.gpu;
        this.device = null;
        this.context = null;
        this.canvas = null;
        this.format = null;
        this.maxQuads = 8192;      // batch capacity; excess glow sprites drop
        this.count = 0;            // quads queued this frame
        this.data = null;          // Float32Array vertex scratch
        this.w = 0;
        this.h = 0;
        this._dpr = 1;
        this._initted = false;     // initAsync has run (success or failure)
        this._lostPermanently = false;
        this._compositorFailed = false; // compositor path permanently disabled?
        /** @type {{x:number,y:number,age:number,maxAge:number,maxR:number,strength:number,width:number,kind:number}[]} */
        this._distortions = [];
    }

    /**
     * Register a scene-space distortion source (world coords). Only rendered in
     * compositor mode (cinematic tier); harmlessly aged/ignored otherwise.
     * @param {object} d
     * @param {number} d.x world x
     * @param {number} d.y world y
     * @param {number} [d.maxR] peak ring radius (world px)
     * @param {number} [d.strength] displacement magnitude (px)
     * @param {number} [d.width] ring band width (px)
     * @param {number} [d.life] lifetime (frames)
     * @param {number} [d.kind] 0 = shockwave, 1 = heat
     */
    addDistortion(d) {
        if (!this.compositor) return;
        this._distortions.push({
            x: d.x, y: d.y, age: 0, maxAge: d.life != null ? d.life : 26,
            maxR: d.maxR != null ? d.maxR : 160,
            strength: d.strength != null ? d.strength : 14,
            width: d.width != null ? d.width : 46,
            kind: d.kind || 0,
        });
        if (this._distortions.length > 24) this._distortions.shift();
    }

    /**
     * Asynchronously acquire a WebGPU device and build the glow pipeline.
     * Never throws; resolves to whether WebGPU is usable. Safe to call when
     * WebGPU is absent (returns false) — that is the headless / fallback path.
     * @returns {Promise<boolean>}
     */
    async initAsync() {
        this._initted = true;
        if (!this.supported || this._lostPermanently) return false;
        try {
            const adapter = await navigator.gpu.requestAdapter({
                powerPreference: "high-performance",
            });
            if (!adapter) { console.warn("[wgpu] no adapter; using WebGL overlay"); return false; }

            const device = await adapter.requestDevice();
            if (!device) { console.warn("[wgpu] no device; using WebGL overlay"); return false; }

            // Build the overlay canvas + swapchain.
            const c = document.createElement("canvas");
            c.id = "gpuCanvas";
            // Sit exactly over #gameCanvas (and the WebGL overlay), transparent,
            // ignore pointer events. z-index 2 keeps it above the inert WebGL
            // overlay (z-index 1) and the 2D canvas (z-index 0/auto).
            c.style.cssText =
                "position:absolute;top:0;left:0;width:100vw;height:100vh;" +
                "pointer-events:none;z-index:2;";
            const host = document.getElementById("gameCanvas");
            if (host && host.parentNode) host.parentNode.insertBefore(c, host.nextSibling);
            else document.body.appendChild(c);

            const context = c.getContext("webgpu");
            if (!context) { console.warn("[wgpu] no webgpu context; using WebGL overlay"); return false; }

            const format = navigator.gpu.getPreferredCanvasFormat();
            context.configure({ device, format, alphaMode: "premultiplied" });

            this.device = device;
            this.context = context;
            this.canvas = c;
            this.format = format;

            this._buildGlowPipeline();
            this.data = new Float32Array(this.maxQuads * FLOATS_PER_QUAD);

            // GPU-compute particle pool (simulated + drawn entirely on device).
            try {
                this.particles = new GPUParticles(device, format);
            } catch (e) {
                this.particles = null;
                console.warn("[wgpu] particle pool init failed; using CPU particles:", e && e.message);
            }
            // Normal-lit relief pass for hero/boss sprites.
            try {
                this.relief = new GPURelief(device, format);
            } catch (e) {
                this.relief = null;
                console.warn("[wgpu] relief pass init failed:", e && e.message);
            }
            // Shaded accretion-disk pass for the Voidcaller Singularity.
            try {
                this.singularity = new GPUSingularity(device, format);
            } catch (e) {
                this.singularity = null;
                console.warn("[wgpu] singularity pass init failed:", e && e.message);
            }
            // Additive ribbon trails for glowing projectiles.
            try {
                this.trails = new GPUTrails(device, format);
            } catch (e) {
                this.trails = null;
                console.warn("[wgpu] trail pass init failed:", e && e.message);
            }
            // Compositor: scene-space bloom + distortion (cinematic tier).
            try {
                this.compositor = new GPUCompositor(device, format);
            } catch (e) {
                this.compositor = null;
                console.warn("[wgpu] compositor init failed; distortion/scene-bloom off:", e && e.message);
            }
            this._distortions = [];

            // Device-loss: instantly revert to the WebGL overlay next frame, and
            // attempt one reinit unless the device was intentionally destroyed.
            device.lost.then((info) => {
                this.ok = false;
                this.device = null;
                // Hide the (now-frozen, possibly opaque compositor) canvas so the
                // WebGL overlay + 2D canvas beneath show through — never black.
                if (this.canvas) this.canvas.style.visibility = "hidden";
                console.warn("[wgpu] device lost:", info && info.message);
                if (info && info.reason === "destroyed") {
                    this._lostPermanently = true;
                } else if (!this._lostPermanently) {
                    this._lostPermanently = true; // one loss is enough — stay on WebGL
                }
            });

            // Size the swapchain to the current viewport (resize() ran before
            // the device existed, so its early-out skipped us).
            this.resize(this.w || window.innerWidth, this.h || window.innerHeight);

            this.ok = true;
            return true;
        } catch (e) {
            // Never surface as console.error (smoke fails on it).
            console.warn("[wgpu] init failed; using WebGL overlay:", e && e.message);
            this.ok = false;
            return false;
        }
    }

    _buildGlowPipeline() {
        const device = this.device;
        const module = device.createShaderModule({ code: GLOW_WGSL });

        this._uniformBuf = device.createBuffer({
            size: 16, // vec2f padded to 16
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this._vertexBuf = device.createBuffer({
            size: this.maxQuads * FLOATS_PER_QUAD * 4,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        const bgl = device.createBindGroupLayout({
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: "uniform" },
            }],
        });
        this._bindGroup = device.createBindGroup({
            layout: bgl,
            entries: [{ binding: 0, resource: { buffer: this._uniformBuf } }],
        });

        this._pipeline = device.createRenderPipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
            vertex: {
                module, entryPoint: "vs",
                buffers: [{
                    arrayStride: FLOATS_PER_VERT * 4,
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: "float32x2" },  // aPos
                        { shaderLocation: 1, offset: 8, format: "float32x2" },  // aUV
                        { shaderLocation: 2, offset: 16, format: "float32x4" }, // aColor
                    ],
                }],
            },
            fragment: {
                module, entryPoint: "fs",
                targets: [{
                    format: this.format,
                    // Additive accumulation in premultiplied space (matches the
                    // WebGL SRC_ALPHA,ONE glow look).
                    blend: {
                        color: { srcFactor: "one", dstFactor: "one", operation: "add" },
                        alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
                    },
                }],
            },
            primitive: { topology: "triangle-list" },
        });
    }

    /** Match the swapchain backing store to the viewport.
     *  `maxDpr` caps the device-pixel ratio (GFX.overlayDpr; sticky). */
    resize(w, h, maxDpr = this.maxDpr || 2) {
        this.w = w;
        this.h = h;
        this.maxDpr = maxDpr;
        if (!this.ok && !this.device) return; // remember size for post-init resize
        if (!this.canvas) return;
        const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
        this._dpr = dpr;
    }

    /** Begin a frame: reset the glow batch (relief + singularity lists too). */
    begin() {
        if (!this.ok) return;
        this.count = 0;
        if (this.relief) this.relief.begin();
        if (this.singularity) this.singularity.begin();
        if (this.trails) this.trails.begin();
    }

    /**
     * Append a glowing projectile's tapered ribbon trail (screen space). No-op
     * unless the trail pass exists and the WebGPU tier is on.
     * @param {{x:number,y:number}[]} pts tail→head screen points
     * @param {number} baseW head half-width px
     * @param {number[]} rgb [r,g,b] 0..1
     */
    trailRibbon(pts, baseW, rgb) {
        if (this.ok && this.trails && GFX.webgpu) this.trails.addRibbon(pts, baseW, rgb);
    }

    /**
     * Queue a hero/boss sprite for normal-lit relief (screen space). No-op
     * unless the relief pass exists and GFX.lights is on.
     */
    reliefSprite(sx, sy, halfW, halfH, tint, strength) {
        if (this.ok && this.relief && GFX.lights) this.relief.sprite(sx, sy, halfW, halfH, tint, strength);
    }

    /**
     * Queue a shaded accretion disk for a Singularity (screen space). No-op
     * unless the disk pass exists and the WebGPU tier is on.
     */
    singularityDisk(sx, sy, radius, coreR, spin, intensity, tilt) {
        if (this.ok && this.singularity && GFX.webgpu) this.singularity.add(sx, sy, radius, coreR, spin, intensity, tilt);
    }

    /**
     * Queue one additive glow sprite (screen-space). Signature-compatible with
     * GLRenderer.glow so the shared call sites work unchanged.
     * @param {number} x screen x (center)
     * @param {number} y screen y (center)
     * @param {number} r radius in px
     * @param {number} rr red 0..1
     * @param {number} gg green 0..1
     * @param {number} bb blue 0..1
     * @param {number} a additive weight 0..1
     */
    glow(x, y, r, rr, gg, bb, a) {
        if (!this.ok || this.count >= this.maxQuads || a <= 0 || r <= 0) return;
        const d = this.data;
        let o = this.count * FLOATS_PER_QUAD;
        const x0 = x - r, y0 = y - r, x1 = x + r, y1 = y + r;
        const push = (px, py, u, v) => {
            d[o] = px; d[o + 1] = py; d[o + 2] = u; d[o + 3] = v;
            d[o + 4] = rr; d[o + 5] = gg; d[o + 6] = bb; d[o + 7] = a;
            o += FLOATS_PER_VERT;
        };
        push(x0, y0, 0, 0); push(x1, y0, 1, 0); push(x0, y1, 0, 1);
        push(x0, y1, 0, 1); push(x1, y0, 1, 0); push(x1, y1, 1, 1);
        this.count++;
    }

    /**
     * Per-frame state the GPU particle sim needs (camera + timestep). Called by
     * the render loop just before flush(). Harmless when particles are absent.
     * @param {number} dt frame-scaled timestep
     * @param {any} cam camera (reads x/y/z)
     * @param {number} sx shake x
     * @param {number} sy shake y
     * @param {number} frames global frame counter (turbulence/flicker phase)
     */
    setFrame(dt, cam, sx, sy, frames) {
        this._dt = dt;
        this._time = frames || 0;
        if (this.particles && cam) {
            this.particles.setCamera(cam.x, cam.y, cam.z, sx || 0, sy || 0, this.w, this.h);
        }
        // Convert the world-space dynamic lights to screen space for the relief
        // pass (which lights hero/boss sprites in screen coordinates).
        if (this.relief && cam && this.game && this.game.lights) {
            const src = this.game.lights.lights;
            const out = [];
            for (let i = 0; i < src.length && out.length < 12; i++) {
                const l = src[i];
                const fade = Math.max(0, l.life / l.maxLife);
                if (fade <= 0) continue;
                out.push({
                    x: cam.sx(l.x) + (sx || 0), y: cam.sy(l.y) + (sy || 0),
                    rgb: l.rgb, radius: l.radius * cam.z, intensity: l.intensity * fade,
                });
            }
            this.relief.setLights(out);
        }

        // Age scene-distortion sources and, in compositor mode, upload them (in
        // uv space) plus the bloom strength for this frame.
        const dl = this._distortions;
        for (let i = dl.length - 1; i >= 0; i--) {
            dl[i].age += dt;
            if (dl[i].age >= dl[i].maxAge) dl.splice(i, 1);
        }
        if (this._compositorActive() && cam) {
            const vw = this.w || 1, vh = this.h || 1;
            const toUV = (s) => {
                const prog = s.age / s.maxAge;
                const cx = (cam.sx(s.x) + (sx || 0)) / vw;
                const cy = (cam.sy(s.y) + (sy || 0)) / vh;
                if (s.kind === 2) {
                    // Gravitational lens — steady radius, strength passed raw (uv).
                    return { cx, cy, r: (s.maxR * cam.z) / vh, w: (s.width * cam.z) / vh, s: s.strength, kind: 2 };
                }
                if (s.kind === 1) {
                    // Heat shimmer — phase advances with global time (never frozen).
                    return { cx, cy, r: (s.maxR * cam.z) / vh, w: 0, s: (s.strength * (1 - prog)) / vh, kind: 1, a: this._time * 0.15 };
                }
                // Shockwave — expanding ring.
                return { cx, cy, r: (s.maxR * cam.z * prog) / vh, w: (s.width * cam.z) / vh, s: (s.strength * (1 - prog)) / vh, kind: 0 };
            };
            // Lens sources (the rift) get priority so a busy fight full of
            // explosions never evicts the most important effect on screen.
            const lens = [], other = [];
            for (const s of dl) (s.kind === 2 ? lens : other).push(s);
            const sources = lens.concat(other).slice(0, 16).map(toUV);
            const bloomStr = GFX.bloom === "high" ? 0.85 : GFX.bloom === "low" ? 0.4 : 0;
            // Lower the bloom threshold at night so dimmed highlights still bloom,
            // raise it toward noon so the bright scene doesn't over-bloom.
            const dP = this.game && typeof this.game.dayT === "number" ? Math.sin(this.game.dayT) : 1;
            this.compositor.setKnee(0.5 + 0.2 * Math.max(0, dP));
            this.compositor.setParams(bloomStr, sources, vw, vh);
        }
    }

    /** Whether WebGPU is acting as the final compositor this frame (cinematic). */
    _compositorActive() {
        return !!(this.ok && !this._compositorFailed && GFX.webgpu && GFX.distortion && this.compositor
            && this.game && this.game.canvas && this.game.canvas.width > 0);
    }

    /** Upload + draw everything queued this frame; always clears the overlay. */
    flush() {
        if (!this.ok) return;
        const device = this.device;
        let compositorFrame = false;
        try {
            const useParticles = this.particles && GFX.webgpu && this.particles.hasWork();
            const compositor = this._compositorActive();
            compositorFrame = compositor;
            const encoder = device.createCommandEncoder();

            // 1. Compute pass: advance the GPU particle simulation.
            if (useParticles) this.particles.simulate(encoder, this._dt || 1, this._time || 0);

            // 1b. Compositor mode: pull the finished 2D frame into a texture and
            // build its bloom pyramid before the main pass reads it.
            if (compositor) {
                this.compositor.ensureSize(this.game.canvas.width, this.game.canvas.height);
                this.compositor.copyScene(this.game.canvas);
                this.compositor.buildBloom(encoder);
            }

            // 2. Render pass. In compositor mode this is the OPAQUE final image
            // (distorted scene + bloom, then additive overlays on top); otherwise
            // it's the transparent additive overlay composited over the 2D canvas.
            const view = this.context.getCurrentTexture().createView();
            const pass = encoder.beginRenderPass({
                colorAttachments: [{
                    view,
                    clearValue: { r: 0, g: 0, b: 0, a: compositor ? 1 : 0 },
                    loadOp: "clear",   // always clear so stale glows never linger
                    storeOp: "store",
                }],
            });
            // Opaque scene base (distortion + scene bloom) under the overlays.
            if (compositor) this.compositor.drawComposite(pass);
            if (this.count > 0) {
                device.queue.writeBuffer(this._uniformBuf, 0, new Float32Array([this.w, this.h]));
                device.queue.writeBuffer(
                    this._vertexBuf, 0,
                    this.data, 0, this.count * FLOATS_PER_QUAD,
                );
                pass.setPipeline(this._pipeline);
                pass.setBindGroup(0, this._bindGroup);
                pass.setVertexBuffer(0, this._vertexBuf);
                pass.draw(this.count * VERTS_PER_QUAD, 1, 0, 0);
            }
            // Projectile ribbon trails (additive), under the particles/disks.
            if (this.trails) this.trails.renderInto(pass, this.w, this.h);
            if (useParticles) this.particles.renderInto(pass);
            // 3. Shaded accretion disks (additive), after glow/particles.
            if (this.singularity) this.singularity.renderInto(pass, this.w, this.h);
            // 4. Normal-lit relief for hero/boss (screen-space, additive).
            if (this.relief && GFX.lights) this.relief.renderInto(pass, this.w, this.h);
            pass.end();
            device.queue.submit([encoder.finish()]);
        } catch (e) {
            if (compositorFrame) {
                // Compositor-specific failure: disable ONLY the compositor
                // (permanently) and keep the transparent overlay — GPU particles,
                // disk and relief stay alive. Next frame runs overlay mode, which
                // clears the gpuCanvas transparent, so the player never sees black.
                this._compositorFailed = true;
                console.warn("[wgpu] compositor failed; reverting to transparent overlay:", e && e.message);
            } else {
                // A transient GPU error in the overlay path — drop to WebGL and
                // hide the (possibly stale) gpuCanvas so lower layers show.
                this.ok = false;
                if (this.canvas) this.canvas.style.visibility = "hidden";
                console.warn("[wgpu] flush failed; reverting to WebGL overlay:", e && e.message);
            }
        }
    }

    /**
     * Route an additive particle burst to the GPU pool.
     * @param {{x:number,y:number,count:number,rgb:number[],speed:number,size:number,kind:string}} d
     * @returns {boolean} true if accepted by the GPU pool (caller may skip CPU)
     */
    emitParticles(d) {
        if (!this.ok || !this.particles) return false;
        this.particles.emit(d.x, d.y, d.count, d.rgb, d.speed, d.size, d.kind);
        return true;
    }

    /** Set (or clear) a world-space attractor for the particle sim (Singularity). */
    setAttractor(x, y, strength, radius) {
        if (!this.particles) return;
        this.particles.attractor[0] = x;
        this.particles.attractor[1] = y;
        this.particles.attractStrength = strength || 0;
        if (radius) this.particles.attractRadius = radius;
    }

}
