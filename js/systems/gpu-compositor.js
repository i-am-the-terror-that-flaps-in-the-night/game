// --- WEBGPU COMPOSITOR (Stage E: scene distortion + scene bloom) -------------
//
// Promotes the WebGPU overlay to the FINAL compositor on the cinematic tier.
// Instead of drawing transparent glow over the visible 2D canvas, it:
//   1. copies the finished 2D `#gameCanvas` into `sceneTex` (one GPU blit/frame),
//   2. extracts bright pixels → a half-res blur pyramid (scene bloom),
//   3. draws a full-screen quad that samples the scene with a per-pixel UV
//      displacement (shockwave / heat distortion + chromatic split) and adds the
//      bloom, output OPAQUE to the swapchain,
//   4. (caller then draws glow + particles + relief additively on top).
//
// The opaque `#gpuCanvas` (z-index 2) covers the 2D canvas beneath, so the
// player sees the composited result. This is the one thing the transparent
// overlay could not do — bend and bloom the underlying 2D pixels. Gated to the
// cinematic tier (GFX.distortion); every other tier and all fallbacks keep the
// cheap transparent-overlay path untouched.

const SCENE_FORMAT = "rgba8unorm";
const MAX_DISTORT = 16;

// Shared full-screen-triangle vertex stage (no vertex buffer).
const FS_VS = /* wgsl */ `
struct VOut { @builtin(position) pos : vec4f, @location(0) uv : vec2f };
@vertex fn vs(@builtin(vertex_index) vi : u32) -> VOut {
  var o : VOut;
  var P = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let xy = P[vi];
  o.pos = vec4f(xy, 0.0, 1.0);
  o.uv = vec2f((xy.x + 1.0) * 0.5, 1.0 - (xy.y + 1.0) * 0.5);
  return o;
}
`;

const EXTRACT_FS = /* wgsl */ `
@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var scene : texture_2d<f32>;
@group(0) @binding(2) var<uniform> knee : vec4f;   // x = threshold
@fragment fn fs(@location(0) uv : vec2f) -> @location(0) vec4f {
  let c = textureSampleLevel(scene, samp, uv, 0.0).rgb;
  let l = dot(c, vec3f(0.299, 0.587, 0.114));
  let k = smoothstep(knee.x, knee.x + 0.25, l);
  return vec4f(c * k, 1.0);
}
`;

const BLUR_FS = /* wgsl */ `
@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var src : texture_2d<f32>;
@group(0) @binding(2) var<uniform> cfg : vec4f;   // xy = dir*texel
@fragment fn fs(@location(0) uv : vec2f) -> @location(0) vec4f {
  var w = array<f32, 5>(0.227027, 0.194595, 0.121622, 0.054054, 0.016216);
  let step = cfg.xy;
  var sum = textureSampleLevel(src, samp, uv, 0.0).rgb * w[0];
  for (var i = 1; i < 5; i = i + 1) {
    sum += textureSampleLevel(src, samp, uv + step * f32(i), 0.0).rgb * w[i];
    sum += textureSampleLevel(src, samp, uv - step * f32(i), 0.0).rgb * w[i];
  }
  return vec4f(sum, 1.0);
}
`;

const COMPOSITE_FS = /* wgsl */ `
struct Src { center : vec2f, radius : f32, width : f32, strength : f32, kind : f32, _a : f32, _b : f32 };
struct U {
  res : vec2f, bloom : f32, count : u32,
  sources : array<Src, ${MAX_DISTORT}>,
};
@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var scene : texture_2d<f32>;
@group(0) @binding(2) var bloomTex : texture_2d<f32>;
@group(0) @binding(3) var<uniform> u : U;

@fragment fn fs(@location(0) uv : vec2f) -> @location(0) vec4f {
  let aspect = u.res.x / max(u.res.y, 1.0);
  let p = vec2f(uv.x * aspect, uv.y);
  var off = vec2f(0.0, 0.0);        // displacement in aspect-uv space
  for (var i : u32 = 0u; i < u.count; i = i + 1u) {
    let s = u.sources[i];
    let c = vec2f(s.center.x * aspect, s.center.y);
    let d = p - c;
    let dl = length(d) + 0.0001;
    if (s.kind < 0.5) {
      // Shockwave: radial ripple around an expanding ring.
      let band = abs(dl - s.radius);
      let f = smoothstep(s.width, 0.0, band) * s.strength;
      off += (d / dl) * f;
    } else if (s.kind < 1.5) {
      // Heat: vertical shimmer inside a soft radius.
      let f = smoothstep(s.radius, 0.0, dl) * s.strength;
      off.x += sin(uv.y * 90.0 + s._a) * f;
    } else {
      // Gravitational lens: the scene bends INTO the core. Displacement grows
      // ~1/d² toward the horizon (s.width), clamped, and fades out past s.radius.
      var pull = s.strength * (s.width / dl) * (s.width / dl);
      pull = min(pull, 0.18);
      let fade = 1.0 - smoothstep(s.width, s.radius, dl);
      off -= (d / dl) * pull * fade;
    }
  }
  let duv = vec2f(off.x / aspect, off.y);
  let mag = length(off);
  var col = textureSampleLevel(scene, samp, uv + duv, 0.0).rgb;
  if (mag > 0.0015) {
    // Chromatic split scales with displacement magnitude.
    let cr = textureSampleLevel(scene, samp, uv + duv * 1.035, 0.0).r;
    let cb = textureSampleLevel(scene, samp, uv + duv * 0.965, 0.0).b;
    col = vec3f(cr, col.g, cb);
  }
  let bloom = textureSampleLevel(bloomTex, samp, uv, 0.0).rgb * u.bloom;
  return vec4f(col + bloom, 1.0);   // OPAQUE
}
`;

export class GPUCompositor {
    /**
     * @param {GPUDevice} device
     * @param {GPUTextureFormat} format swapchain format
     */
    constructor(device, format) {
        this.device = device;
        this.format = format;
        this.ready = false;
        this.sceneW = 0;
        this.sceneH = 0;

        this._sampler = device.createSampler({
            magFilter: "linear", minFilter: "linear",
            addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge",
        });

        // Uniforms.
        this._kneeBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this._dirHBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this._dirVBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        // Composite uniform: res(2)+bloom+count = 4 floats header + 16*8 floats.
        this._compBuf = device.createBuffer({
            size: 16 + MAX_DISTORT * 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this._compScratch = new ArrayBuffer(16 + MAX_DISTORT * 32);

        device.pushErrorScope("validation");
        this._buildPipelines();
        device.popErrorScope().then((e) => { if (e) console.warn("[wgpu] compositor pipeline error:", e.message); });
        device.queue.writeBuffer(this._kneeBuf, 0, new Float32Array([0.62, 0, 0, 0]));
    }

    _buildPipelines() {
        const d = this.device;
        const fsVs = d.createShaderModule({ code: FS_VS });
        const mk = (fsCode, entries) => {
            const mod = d.createShaderModule({ code: FS_VS + fsCode });
            const bgl = d.createBindGroupLayout({ entries });
            return {
                bgl,
                pipe: d.createRenderPipeline({
                    layout: d.createPipelineLayout({ bindGroupLayouts: [bgl] }),
                    vertex: { module: mod, entryPoint: "vs" },
                    fragment: { module: mod, entryPoint: "fs", targets: [{ format: SCENE_FORMAT }] },
                    primitive: { topology: "triangle-list" },
                }),
            };
        };
        /** @type {(b:number)=>GPUBindGroupLayoutEntry} */
        const texEntry = (b) => ({ binding: b, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
        /** @type {(b:number)=>GPUBindGroupLayoutEntry} */
        const sampEntry = (b) => ({ binding: b, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } });
        /** @type {(b:number)=>GPUBindGroupLayoutEntry} */
        const uEntry = (b) => ({ binding: b, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } });

        this._extract = mk(EXTRACT_FS, [sampEntry(0), texEntry(1), uEntry(2)]);
        this._blur = mk(BLUR_FS, [sampEntry(0), texEntry(1), uEntry(2)]);
        // Composite renders to the swapchain (its own format), so build separately.
        const cmod = d.createShaderModule({ code: FS_VS + COMPOSITE_FS });
        const cbgl = d.createBindGroupLayout({
            entries: [sampEntry(0), texEntry(1), texEntry(2), uEntry(3)],
        });
        this._compBGL = cbgl;
        this._composite = d.createRenderPipeline({
            layout: d.createPipelineLayout({ bindGroupLayouts: [cbgl] }),
            vertex: { module: cmod, entryPoint: "vs" },
            fragment: { module: cmod, entryPoint: "fs", targets: [{ format: this.format }] },
            primitive: { topology: "triangle-list" },
        });
    }

    /** (Re)allocate the scene + bloom textures when the source size changes. */
    ensureSize(w, h) {
        w = Math.max(1, w | 0); h = Math.max(1, h | 0);
        if (this.ready && w === this.sceneW && h === this.sceneH) return;
        this.sceneW = w; this.sceneH = h;
        const bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
        const d = this.device;
        const mk = (tw, th, extra) => d.createTexture({
            size: [tw, th], format: SCENE_FORMAT,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | extra,
        });
        this._sceneTex && this._sceneTex.destroy();
        this._bloomA && this._bloomA.destroy();
        this._bloomB && this._bloomB.destroy();
        this._sceneTex = mk(w, h, GPUTextureUsage.COPY_DST);
        this._bloomA = mk(bw, bh, 0);
        this._bloomB = mk(bw, bh, 0);
        const sv = this._sceneTex.createView(), av = this._bloomA.createView(), bv = this._bloomB.createView();
        this._sv = sv; this._av = av; this._bv = bv;

        // Bind groups referencing the fresh views.
        this._extractBind = d.createBindGroup({
            layout: this._extract.bgl,
            entries: [{ binding: 0, resource: this._sampler }, { binding: 1, resource: sv }, { binding: 2, resource: { buffer: this._kneeBuf } }],
        });
        this._blurHBind = d.createBindGroup({
            layout: this._blur.bgl,
            entries: [{ binding: 0, resource: this._sampler }, { binding: 1, resource: av }, { binding: 2, resource: { buffer: this._dirHBuf } }],
        });
        this._blurVBind = d.createBindGroup({
            layout: this._blur.bgl,
            entries: [{ binding: 0, resource: this._sampler }, { binding: 1, resource: bv }, { binding: 2, resource: { buffer: this._dirVBuf } }],
        });
        this._compBind = d.createBindGroup({
            layout: this._compBGL,
            entries: [
                { binding: 0, resource: this._sampler },
                { binding: 1, resource: sv },
                { binding: 2, resource: av },
                { binding: 3, resource: { buffer: this._compBuf } },
            ],
        });
        // Blur step = 1 texel in the bloom mip.
        d.queue.writeBuffer(this._dirHBuf, 0, new Float32Array([1 / bw, 0, 0, 0]));
        d.queue.writeBuffer(this._dirVBuf, 0, new Float32Array([0, 1 / bh, 0, 0]));
        this.ready = true;
    }

    /**
     * Set the bloom bright-extract threshold. Driven by day/night so scene
     * highlights still bloom after dusk (when the whole frame is dimmed) and
     * don't over-bloom at noon.
     * @param {number} knee luminance threshold 0..1
     */
    setKnee(knee) {
        this.device.queue.writeBuffer(this._kneeBuf, 0, new Float32Array([knee, 0, 0, 0]));
    }

    /** Copy the finished 2D canvas into the scene texture (one blit). */
    copyScene(canvas2d) {
        if (!this.ready) return;
        this.device.queue.copyExternalImageToTexture(
            { source: canvas2d },
            { texture: this._sceneTex },
            { width: this.sceneW, height: this.sceneH },
        );
    }

    /**
     * Upload composite params for this frame.
     * @param {number} bloomStrength
     * @param {{cx:number,cy:number,r:number,w:number,s:number,kind:number,a?:number}[]} sources uv-space distortions
     * @param {number} resW logical width
     * @param {number} resH logical height
     */
    setParams(bloomStrength, sources, resW, resH) {
        const f = new Float32Array(this._compScratch);
        const i = new Uint32Array(this._compScratch);
        f[0] = resW; f[1] = resH; f[2] = bloomStrength;
        const n = Math.min(sources.length, MAX_DISTORT);
        i[3] = n;
        for (let k = 0; k < n; k++) {
            const s = sources[k], o = 4 + k * 8;   // 8 floats per Src (32B)
            f[o] = s.cx; f[o + 1] = s.cy; f[o + 2] = s.r; f[o + 3] = s.w;
            f[o + 4] = s.s; f[o + 5] = s.kind; f[o + 6] = s.a || 0; f[o + 7] = 0;
        }
        this.device.queue.writeBuffer(this._compBuf, 0, this._compScratch);
    }

    /** Encode the bright-extract + separable blur passes → bloomA. */
    buildBloom(encoder) {
        if (!this.ready) return;
        const pass = (view, pipe, bind) => {
            const p = encoder.beginRenderPass({
                colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
            });
            p.setPipeline(pipe); p.setBindGroup(0, bind); p.draw(3, 1, 0, 0); p.end();
        };
        pass(this._av, this._extract.pipe, this._extractBind);  // scene → bloomA (bright)
        pass(this._bv, this._blur.pipe, this._blurHBind);       // bloomA → bloomB (H)
        pass(this._av, this._blur.pipe, this._blurVBind);       // bloomB → bloomA (V)
    }

    /** Draw the scene+distortion+bloom composite into an open swapchain pass. */
    drawComposite(pass) {
        if (!this.ready) return;
        pass.setPipeline(this._composite);
        pass.setBindGroup(0, this._compBind);
        pass.draw(3, 1, 0, 0);
    }
}
