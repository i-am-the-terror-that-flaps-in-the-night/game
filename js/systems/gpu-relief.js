// --- NORMAL-LIT SPRITE RELIEF (hero / boss) ---------------------------------
//
// The game's sprites are procedural Canvas-2D vector art — there are no texture
// or normal-map assets to sample. For the two "hero-tier" sprites the player
// looks at most (the Voidcaller hero and the Hollow Engine boss) we still want
// dynamic lights to shape them, not just wash over them. This pass synthesizes a
// hemispherical BODY normal at runtime (a rounded bulge from the sprite's local
// UV) and lights it with the live dynamic lights via dot(N, L) — so a muzzle
// flash or explosion to the sprite's left brightens its left flank and shades
// its right, giving readable relief. The contribution is additive over the
// Canvas-2D sprite (brighten-only, in keeping with the overlay model).
//
// Bounded: at most MAX_SPRITES relief quads and MAX_LIGHTS lights per frame.
// Everything is screen-space (fed post-camera), so it needs no camera uniform.

const MAX_SPRITES = 48;   // hero + boss + a culled crowd of units near lights
const MAX_LIGHTS = 12;
// Per-sprite instance: center.xy, half.xy, tint.rgb, strength = 8 floats.
const FLOATS_PER_SPRITE = 8;

const RELIEF_WGSL = /* wgsl */ `
struct Sprite { center : vec2f, half : vec2f, tint : vec3f, strength : f32 };
// vec4f colour keeps this a clean 32-byte uniform-array stride (a vec3f would
// force 48 via std140 alignment). Alpha channel is unused.
struct Light  { pos : vec2f, radius : f32, intensity : f32, color : vec4f };
struct Scene  { res : vec2f, count : u32, _pad : u32 };

@group(0) @binding(0) var<storage, read> sprites : array<Sprite>;
@group(0) @binding(1) var<uniform> lights : array<Light, ${MAX_LIGHTS}>;
@group(0) @binding(2) var<uniform> scene : Scene;

struct VOut {
  @builtin(position) pos : vec4f,
  @location(0) local : vec2f,   // -1..1 within the sprite quad
  @location(1) frag  : vec2f,   // screen-space fragment position
  @location(2) tint  : vec3f,
  @location(3) strength : f32,
};

const CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(-1.0, 1.0),  vec2f(1.0, -1.0), vec2f(1.0, 1.0),
);

@vertex
fn vs(@builtin(vertex_index) vi : u32,
      @builtin(instance_index) ii : u32) -> VOut {
  var o : VOut;
  let s = sprites[ii];
  let c = CORNERS[vi];
  let sp = s.center + c * s.half;
  o.pos = vec4f(sp.x / scene.res.x * 2.0 - 1.0, 1.0 - sp.y / scene.res.y * 2.0, 0.0, 1.0);
  o.local = c;
  o.frag = sp;
  o.tint = s.tint;
  o.strength = s.strength;
  return o;
}

@fragment
fn fs(i : VOut) -> @location(0) vec4f {
  // Hemispherical body normal from the quad UV: flat rim, bulging centre.
  let r2 = dot(i.local, i.local);
  if (r2 > 1.0) { discard; }
  let nz = sqrt(max(0.0, 1.0 - r2));
  let N = vec3f(i.local.x, -i.local.y, nz + 0.35);   // slight forward bias
  let Nn = normalize(N);
  // Soft body mask so the relief fades at the silhouette edge.
  let mask = smoothstep(1.0, 0.55, r2);

  var lit = vec3f(0.0, 0.0, 0.0);
  for (var k : u32 = 0u; k < scene.count; k = k + 1u) {
    let L = lights[k];
    let dv = L.pos - i.frag;
    let dl = length(dv) + 0.001;
    if (dl > L.radius) { continue; }
    // Light direction in the sprite's local frame (z toward viewer).
    let Ldir = normalize(vec3f(dv.x / L.radius, -dv.y / L.radius, 0.65));
    let ndl = max(0.0, dot(Nn, Ldir));
    let atten = (1.0 - dl / L.radius);
    lit += L.color.rgb * (L.intensity * ndl * atten * atten);
  }
  let col = i.tint * lit * (mask * i.strength);
  return vec4f(col, 0.0);   // additive (premultiplied): pure light add, no alpha coverage
}
`;

export class GPURelief {
    /**
     * @param {GPUDevice} device
     * @param {GPUTextureFormat} format
     */
    constructor(device, format) {
        this.device = device;
        this.count = 0;                 // sprites queued this frame
        this.lightCount = 0;
        this._spriteScratch = new Float32Array(MAX_SPRITES * FLOATS_PER_SPRITE);
        this._lightScratch = new Float32Array(MAX_LIGHTS * 8); // Light = 8 floats (32B)
        this._sceneScratch = new ArrayBuffer(16);

        this._spriteBuf = device.createBuffer({
            size: MAX_SPRITES * FLOATS_PER_SPRITE * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this._lightBuf = device.createBuffer({
            size: MAX_LIGHTS * 8 * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this._sceneBuf = device.createBuffer({
            size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const mod = device.createShaderModule({ code: RELIEF_WGSL });
        const bgl = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
                { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
            ],
        });
        this._bind = device.createBindGroup({
            layout: bgl,
            entries: [
                { binding: 0, resource: { buffer: this._spriteBuf } },
                { binding: 1, resource: { buffer: this._lightBuf } },
                { binding: 2, resource: { buffer: this._sceneBuf } },
            ],
        });
        this._pipe = device.createRenderPipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
            vertex: { module: mod, entryPoint: "vs" },
            fragment: {
                module: mod, entryPoint: "fs",
                targets: [{
                    format,
                    blend: {
                        color: { srcFactor: "one", dstFactor: "one", operation: "add" },
                        alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
                    },
                }],
            },
            primitive: { topology: "triangle-list" },
        });
    }

    /** Reset the per-frame sprite list. */
    begin() { this.count = 0; }

    /**
     * Queue a hero/boss sprite for normal-lit relief (screen space).
     * @param {number} sx screen centre x
     * @param {number} sy screen centre y
     * @param {number} halfW half width px
     * @param {number} halfH half height px
     * @param {number[]} tint [r,g,b] base albedo 0..1
     * @param {number} [strength] relief intensity
     */
    sprite(sx, sy, halfW, halfH, tint, strength = 1) {
        if (this.count >= MAX_SPRITES) return;
        const o = this.count * FLOATS_PER_SPRITE;
        const s = this._spriteScratch;
        s[o] = sx; s[o + 1] = sy; s[o + 2] = halfW; s[o + 3] = halfH;
        s[o + 4] = tint[0]; s[o + 5] = tint[1]; s[o + 6] = tint[2]; s[o + 7] = strength;
        this.count++;
    }

    /**
     * Upload the active lights (already in screen space).
     * @param {{x:number,y:number,rgb:number[],radius:number,intensity:number}[]} lights
     */
    setLights(lights) {
        const n = Math.min(lights.length, MAX_LIGHTS);
        const s = this._lightScratch;
        for (let i = 0; i < n; i++) {
            const l = lights[i], o = i * 8;
            // Layout matches WGSL Light: pos.xy, radius, intensity, color.rgba.
            s[o] = l.x; s[o + 1] = l.y;
            s[o + 2] = l.radius; s[o + 3] = l.intensity;
            s[o + 4] = l.rgb[0]; s[o + 5] = l.rgb[1]; s[o + 6] = l.rgb[2]; s[o + 7] = 1;
        }
        this.lightCount = n;
    }

    /** True if there is anything to draw this frame. */
    hasWork() { return this.count > 0 && this.lightCount > 0; }

    /** Draw the relief quads into an open render pass. */
    renderInto(pass, resW, resH) {
        if (!this.hasWork()) return;
        const dev = this.device;
        dev.queue.writeBuffer(this._spriteBuf, 0, this._spriteScratch, 0, this.count * FLOATS_PER_SPRITE);
        dev.queue.writeBuffer(this._lightBuf, 0, this._lightScratch, 0, this.lightCount * 8);
        const sv = new DataView(this._sceneScratch);
        sv.setFloat32(0, resW, true); sv.setFloat32(4, resH, true);
        sv.setUint32(8, this.lightCount, true);
        dev.queue.writeBuffer(this._sceneBuf, 0, this._sceneScratch);

        pass.setPipeline(this._pipe);
        pass.setBindGroup(0, this._bind);
        pass.draw(6, this.count, 0, 0);
    }
}
