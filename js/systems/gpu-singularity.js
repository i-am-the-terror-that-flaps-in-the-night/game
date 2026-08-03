// --- GPU ACCRETION DISK (Voidcaller Singularity) ----------------------------
//
// One additive instanced quad per live rift, shaded in WGSL. Replaces the old
// five Canvas-2D polyline spirals (js/systems/void.js) — which all sheared at
// one rate and read as a spirograph — with a real black-hole accretion disk:
//
//   • Keplerian shear — inner annuli wind faster than the rim (∝ r^-1.5), so the
//     structure continuously stretches/re-winds instead of rigidly rotating.
//   • Noise filaments — fbm bands, not lines, dark between strands.
//   • Doppler beaming — the approaching (screen-left) limb beams bright and
//     shifts toward white/cyan; the receding limb dims toward deep violet.
//   • Photon ring — a thin non-foreshortened halo arcing over the horizon.
//
// Modelled on gpu-relief.js: a small storage-buffer instance array, a
// begin()/add()/renderInto() per-frame contract, screen-space (fed post-camera),
// premultiplied additive output, unit-quad corners from vertex_index.
//
// HARD CONSTRAINT: the overlay is additive and cannot darken. This outputs
// EXACTLY zero inside the horizon (r < rin) — the black event-horizon disc stays
// on the Canvas-2D layer (void.js) and is what makes the disk pop.

const MAX_N = 4;
const FLOATS_PER_DISK = 8;   // center.xy, radius, coreR, spin, intensity, tilt, seed

const DISK_WGSL = /* wgsl */ `
struct Disk {
  center : vec2f, radius : f32, coreR : f32,
  spin : f32, intensity : f32, tilt : f32, seed : f32,
};
struct Scene { res : vec2f, _p0 : f32, _p1 : f32 };
@group(0) @binding(0) var<storage, read> disks : array<Disk>;
@group(0) @binding(1) var<uniform> scene : Scene;

struct VOut {
  @builtin(position) pos : vec4f,
  @location(0) local : vec2f,   // -1..1 within the quad
  @location(1) @interpolate(flat) idx : u32,
};

const CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(-1.0, 1.0),  vec2f(1.0, -1.0), vec2f(1.0, 1.0),
);
const ARMS : f32 = 5.0;
const KEP  : f32 = 0.9;    // Keplerian shear strength
const DOP  : f32 = 0.6;    // Doppler beaming depth

fn hash21(p : vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}
fn vnoise(p : vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn fbm(p0 : vec2f) -> f32 {
  var p = p0;
  var v = 0.0;
  var amp = 0.5;
  for (var i = 0; i < 3; i = i + 1) {
    v += amp * vnoise(p);
    p = p * 2.0;
    amp = amp * 0.5;
  }
  return v;
}

@vertex
fn vs(@builtin(vertex_index) vi : u32,
      @builtin(instance_index) ii : u32) -> VOut {
  var o : VOut;
  let dsk = disks[ii];
  let c = CORNERS[vi];
  // Square quad radius×radius; the disk foreshortens inside the fragment.
  let sp = dsk.center + c * dsk.radius;
  o.pos = vec4f(sp.x / scene.res.x * 2.0 - 1.0, 1.0 - sp.y / scene.res.y * 2.0, 0.0, 1.0);
  o.local = c;
  o.idx = ii;
  return o;
}

@fragment
fn fs(i : VOut) -> @location(0) vec4f {
  let dsk = disks[i.idx];
  let rin = clamp(dsk.coreR / max(dsk.radius, 1.0), 0.04, 0.6);

  // Disk-plane coords (undo the vertical foreshorten to a circle).
  let q = vec2f(i.local.x, i.local.y / max(dsk.tilt, 0.2));
  let r = length(q);
  if (r < rin || r > 1.0) { return vec4f(0.0, 0.0, 0.0, 0.0); }  // horizon + rim cutoff
  let a = atan2(q.y, q.x);

  // 1. Keplerian shear — inner annuli lead the outer ones.
  let phi = a + dsk.spin * KEP * pow(max(r, rin), -1.5);

  // 2. Filaments (fbm bands), dark between strands.
  var fil = fbm(vec2f(phi * ARMS, r * 8.0 + dsk.spin * 0.05 + dsk.seed));
  fil = pow(clamp(fil, 0.0, 1.0), 2.2);

  // 3. Radial profile: steep rise off the horizon, ~1/r² falloff to the rim.
  let rise = smoothstep(rin, rin * 1.15, r);
  let outer = smoothstep(1.0, 0.72, r);            // fade toward the rim
  let inv = 1.0 / (0.25 + r * r * 3.0);
  var body = rise * outer * inv;

  // 4. Vertical body: thickness grows with r, fade above/below the disk plane.
  let thick = mix(0.05, 0.34, r);
  let vfade = smoothstep(thick, 0.0, abs(i.local.y) - dsk.tilt * r * 0.0);
  body *= mix(0.35, 1.0, vfade);

  // 5. Doppler beaming — screen-left (a≈π) approaches → bright, cyan-shifted.
  let beam = pow(max(0.0, 1.0 - DOP * cos(a)), 3.0);

  // 6. Temperature ramp along radius (violet palette).
  let hot  = vec3f(1.0, 0.94, 1.0);   // #fff0ff
  let mid  = vec3f(0.90, 0.29, 1.0);  // #e64bff
  let cool = vec3f(0.486, 0.227, 0.929); // #7c3aed
  var col = mix(hot, mix(mid, cool, smoothstep(0.35, 1.0, r)), smoothstep(rin, 0.35, r));
  // Bright limb pushes toward white/cyan; dim limb stays violet.
  col = mix(col, vec3f(0.75, 1.0, 1.0), clamp((beam - 1.0) * 0.25, 0.0, 0.6));

  var bright = body * (0.6 + fil) * beam * dsk.intensity;

  // 7. Photon ring — thin bright halo in RAW (non-foreshortened) local space,
  //    with a lensed over-arc weighted to the top.
  let rl = length(i.local);
  let ringR = rin * 1.05;
  let ring = smoothstep(0.06, 0.0, abs(rl - ringR)) * 1.4;
  let overArc = ring * (0.5 + 0.5 * (-i.local.y));   // brighter across the top
  bright += (ring + overArc) * dsk.intensity;
  col = mix(col, vec3f(1.0, 0.95, 1.0), clamp(ring, 0.0, 1.0));

  let w = clamp(bright, 0.0, 3.0);
  return vec4f(col * w, w);   // premultiplied additive
}
`;

export class GPUSingularity {
    /**
     * @param {GPUDevice} device
     * @param {GPUTextureFormat} format
     */
    constructor(device, format) {
        this.device = device;
        this.count = 0;
        this._scratch = new Float32Array(MAX_N * FLOATS_PER_DISK);
        this._scene = new Float32Array(4);

        this._buf = device.createBuffer({
            size: MAX_N * FLOATS_PER_DISK * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this._sceneBuf = device.createBuffer({
            size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const mod = device.createShaderModule({ code: DISK_WGSL });
        const bgl = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
                { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
            ],
        });
        this._bind = device.createBindGroup({
            layout: bgl,
            entries: [
                { binding: 0, resource: { buffer: this._buf } },
                { binding: 1, resource: { buffer: this._sceneBuf } },
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

    /** Reset the per-frame disk list. */
    begin() { this.count = 0; }

    /**
     * Queue one accretion disk (screen space).
     * @param {number} sx screen center x
     * @param {number} sy screen center y
     * @param {number} radius outer disk radius (screen px)
     * @param {number} coreR horizon radius (screen px)
     * @param {number} spin accumulated spin (frames)
     * @param {number} intensity 0..2.5
     * @param {number} tilt vertical foreshorten (0.62)
     */
    add(sx, sy, radius, coreR, spin, intensity, tilt) {
        if (this.count >= MAX_N || radius <= 0) return;
        const o = this.count * FLOATS_PER_DISK;
        const s = this._scratch;
        s[o] = sx; s[o + 1] = sy; s[o + 2] = radius; s[o + 3] = coreR;
        s[o + 4] = spin; s[o + 5] = intensity; s[o + 6] = tilt;
        s[o + 7] = (this.count * 17.3) % 10;   // per-disk noise offset
        this.count++;
    }

    hasWork() { return this.count > 0; }

    /** Draw all queued disks into an open render pass. */
    renderInto(pass, resW, resH) {
        if (!this.hasWork()) return;
        const dev = this.device;
        dev.queue.writeBuffer(this._buf, 0, this._scratch, 0, this.count * FLOATS_PER_DISK);
        this._scene[0] = resW; this._scene[1] = resH;
        dev.queue.writeBuffer(this._sceneBuf, 0, this._scene);
        pass.setPipeline(this._pipe);
        pass.setBindGroup(0, this._bind);
        pass.draw(6, this.count, 0, 0);
    }
}
