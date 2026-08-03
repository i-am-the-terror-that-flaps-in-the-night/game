// --- GPU-COMPUTE PARTICLE SYSTEM --------------------------------------------
//
// A storage-buffer particle pool simulated entirely on the GPU (a WGSL compute
// pass integrates gravity / drag / wind / turbulence / attraction per frame) and
// drawn with a single instanced additive draw call. Owned by WGPURenderer; only
// active on the WebGPU tier. The CPU never touches per-particle state after
// emission — it just writes newly-spawned particles into a ring region of the
// storage buffer (a few dozen floats per burst) and dispatches compute+render.
//
// Particles live in WORLD space; the render vertex shader applies the camera
// transform + shake so they line up with the 2D layer exactly. Dead particles
// (life<=0) are skipped in compute and collapse to a degenerate (zero-size) quad
// in the vertex shader, so a fixed-capacity pool needs no compaction.
//
// This is the offload the brief asks for: "do not update huge particle
// populations individually in JavaScript." The legacy CPU ParticleSystem stays
// as the fallback for non-WebGPU tiers and for non-additive (fade/debris)
// particles that render on Canvas 2D.

// Per-particle struct: 16 floats / 64 bytes, 16-byte aligned (vec4 color).
//   pos.xy | vel.xy | color.rgba | life maxLife size grav | drag turb kind pad
const FLOATS_PER_P = 16;
const BYTES_PER_P = FLOATS_PER_P * 4;

// Physics presets per emit "kind" (mirrors the CPU ParticleSystem feel):
//   grav (world px/frame²), drag (per-frame), turb (curl-noise amount).
const KIND = {
    float:  { grav: 0.0,  drag: 0.02, turb: 0.35, k: 0 }, // smoke/embers rise & drift
    spark:  { grav: 0.15, drag: 0.05, turb: 0.12, k: 1 }, // fast bright motes fall
    ember:  { grav: -0.04, drag: 0.03, turb: 0.5,  k: 2 }, // buoyant fire embers
};

const SIM_WGSL = /* wgsl */ `
struct P {
  pos : vec2f, vel : vec2f, color : vec4f,
  life : f32, maxLife : f32, size : f32, grav : f32,
  drag : f32, turb : f32, kind : f32, pad : f32,
};
struct SimU {
  dt : f32, time : f32, count : u32, _p0 : f32,
  wind : vec2f, attractor : vec2f,
  attractStrength : f32, attractRadius : f32, _p1 : f32, _p2 : f32,
};
@group(0) @binding(0) var<storage, read_write> parts : array<P>;
@group(0) @binding(1) var<uniform> sim : SimU;

// Cheap hash-based 2D value noise → a smooth pseudo-curl for turbulence.
fn hash2(p : vec2f) -> vec2f {
  let k = vec2f(127.1, 311.7);
  let n = sin(vec2f(dot(p, k), dot(p, vec2f(269.5, 183.3))));
  return fract(n * 43758.5453) * 2.0 - 1.0;
}
fn curl(p : vec2f, t : f32) -> vec2f {
  let a = hash2(p * 0.01 + vec2f(t * 0.01, 0.0));
  let b = hash2(p * 0.013 - vec2f(0.0, t * 0.008));
  return vec2f(a.y - b.x, b.y - a.x);
}

@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id : vec3u) {
  let i = id.x;
  if (i >= sim.count) { return; }
  var p = parts[i];
  if (p.life <= 0.0) { return; }

  var a = vec2f(0.0, p.grav);
  a += (sim.wind + curl(p.pos, sim.time)) * p.turb;

  // Attraction (e.g. a Singularity pulling embers inward).
  if (sim.attractStrength != 0.0) {
    let d = sim.attractor - p.pos;
    let dl = length(d) + 0.001;
    if (dl < sim.attractRadius) {
      a += (d / dl) * sim.attractStrength * (1.0 - dl / sim.attractRadius);
    }
  }

  p.vel += a * sim.dt;
  p.vel *= (1.0 - p.drag * sim.dt);
  p.pos += p.vel * sim.dt;
  p.life -= sim.dt;
  parts[i] = p;
}
`;

const DRAW_WGSL = /* wgsl */ `
struct P {
  pos : vec2f, vel : vec2f, color : vec4f,
  life : f32, maxLife : f32, size : f32, grav : f32,
  drag : f32, turb : f32, kind : f32, pad : f32,
};
struct CamU {
  cam : vec2f, shake : vec2f, res : vec2f, z : f32, minSize : f32,
};
@group(0) @binding(0) var<storage, read> parts : array<P>;
@group(0) @binding(1) var<uniform> cam : CamU;

struct VOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) col : vec4f,
};

// Unit quad (two triangles) generated from vertex_index — no vertex buffer.
const CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(-1.0, 1.0),  vec2f(1.0, -1.0), vec2f(1.0, 1.0),
);

@vertex
fn vs(@builtin(vertex_index) vi : u32,
      @builtin(instance_index) ii : u32) -> VOut {
  var o : VOut;
  let p = parts[ii];
  let alive = p.life > 0.0;
  // Screen-space center: world → camera → shake (matches the 2D layer).
  let center = (p.pos - cam.cam) * cam.z + cam.shake;
  let rad = max(cam.minSize, p.size * cam.z) * select(0.0, 1.0, alive);
  let corner = CORNERS[vi];
  let sp = center + corner * rad;
  let clip = vec2f(sp.x / cam.res.x * 2.0 - 1.0, 1.0 - sp.y / cam.res.y * 2.0);
  o.pos = vec4f(clip, 0.0, 1.0);
  o.uv = corner * 0.5 + vec2f(0.5, 0.5);
  let fade = clamp(p.life / max(p.maxLife, 1.0), 0.0, 1.0);
  o.col = vec4f(p.color.rgb, p.color.a * fade);
  return o;
}

@fragment
fn fs(i : VOut) -> @location(0) vec4f {
  let d = i.uv - vec2f(0.5, 0.5);
  let r = length(d) * 2.0;
  var s = 1.0 - smoothstep(0.0, 1.0, r);
  s = s * s;
  let w = i.col.a * s;
  return vec4f(i.col.rgb * w, w);   // premultiplied additive
}
`;

export class GPUParticles {
    /**
     * @param {GPUDevice} device
     * @param {GPUTextureFormat} format swapchain format (render target)
     * @param {number} [capacity] pool size
     */
    constructor(device, format, capacity = 16384) {
        this.device = device;
        this.capacity = capacity;
        this.cursor = 0;         // ring write head
        this.liveHint = 0;       // high-water mark of written slots (draw bound)
        this._scratch = new Float32Array(1024 * FLOATS_PER_P); // reused emit buffer

        this._storage = device.createBuffer({
            size: capacity * BYTES_PER_P,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this._simU = device.createBuffer({
            size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this._camU = device.createBuffer({
            size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Compute pipeline (read_write storage + sim uniform).
        const simMod = device.createShaderModule({ code: SIM_WGSL });
        const simBGL = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
            ],
        });
        this._simBind = device.createBindGroup({
            layout: simBGL,
            entries: [
                { binding: 0, resource: { buffer: this._storage } },
                { binding: 1, resource: { buffer: this._simU } },
            ],
        });
        this._simPipe = device.createComputePipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [simBGL] }),
            compute: { module: simMod, entryPoint: "cs" },
        });

        // Render pipeline (read-only storage in the vertex stage + cam uniform).
        const drawMod = device.createShaderModule({ code: DRAW_WGSL });
        const drawBGL = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
                { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
            ],
        });
        this._drawBind = device.createBindGroup({
            layout: drawBGL,
            entries: [
                { binding: 0, resource: { buffer: this._storage } },
                { binding: 1, resource: { buffer: this._camU } },
            ],
        });
        this._drawPipe = device.createRenderPipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [drawBGL] }),
            vertex: { module: drawMod, entryPoint: "vs" },
            fragment: {
                module: drawMod, entryPoint: "fs",
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

        // Per-frame simulation params (default: no wind / no attractor).
        this.wind = [0, 0];
        this.attractor = [0, 0];
        this.attractStrength = 0;
        this.attractRadius = 300;
    }

    /**
     * Spawn a burst of additive particles (world coords). Small counts are
     * generated on the CPU and written into the ring; physics runs on the GPU.
     * @param {number} x world x
     * @param {number} y world y
     * @param {number} count particles
     * @param {number[]} rgb [r,g,b] 0..1
     * @param {number} speed emission speed
     * @param {number} size particle radius (world px)
     * @param {string} kind "float" | "spark" | "ember"
     */
    emit(x, y, count, rgb, speed, size, kind) {
        count = Math.min(count | 0, 1024);
        if (count <= 0) return;
        const kp = KIND[kind] || KIND.spark;
        const s = this._scratch;
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = speed * (0.3 + Math.random() * 0.7);
            const o = i * FLOATS_PER_P;
            s[o] = x; s[o + 1] = y;                         // pos
            s[o + 2] = Math.cos(a) * sp; s[o + 3] = Math.sin(a) * sp; // vel
            s[o + 4] = rgb[0]; s[o + 5] = rgb[1]; s[o + 6] = rgb[2]; s[o + 7] = 1; // color
            const life = 20 + Math.random() * 30;
            s[o + 8] = life; s[o + 9] = 50;                 // life, maxLife
            s[o + 10] = size * (0.5 + Math.random() * 0.5); // size
            s[o + 11] = kp.grav;                            // grav
            s[o + 12] = kp.drag; s[o + 13] = kp.turb; s[o + 14] = kp.k; s[o + 15] = 0;
        }
        this._writeRing(s, count);
    }

    // Write `count` particles from scratch into the ring, splitting on wrap.
    _writeRing(scratch, count) {
        const cap = this.capacity;
        let start = this.cursor;
        const first = Math.min(count, cap - start);
        this.device.queue.writeBuffer(
            this._storage, start * BYTES_PER_P,
            scratch, 0, first * FLOATS_PER_P,
        );
        if (first < count) {
            this.device.queue.writeBuffer(
                this._storage, 0,
                scratch, first * FLOATS_PER_P, (count - first) * FLOATS_PER_P,
            );
        }
        this.cursor = (start + count) % cap;
        this.liveHint = Math.min(cap, Math.max(this.liveHint, start + count));
    }

    /** Camera + viewport for this frame's render (logical px, matching cam.sx). */
    setCamera(camX, camY, z, shakeX, shakeY, resW, resH) {
        // CamU: cam.xy, shake.xy, res.xy, z, minSize
        this.device.queue.writeBuffer(this._camU, 0, new Float32Array([
            camX, camY, shakeX, shakeY, resW, resH, z, 1.5,
        ]));
    }

    /** True when the pool has ever held particles (worth simulating/drawing). */
    hasWork() { return this.liveHint > 0; }

    /** Encode the compute simulation pass. */
    simulate(encoder, dt, timeFrames) {
        if (!this.hasWork()) return;
        const count = this.liveHint;
        // SimU layout: dt,time,count,_p0, wind.xy, attractor.xy, aStr,aRad,_,_
        const u = new ArrayBuffer(64);
        const f = new Float32Array(u), i = new Uint32Array(u);
        f[0] = dt; f[1] = timeFrames; i[2] = count; f[3] = 0;
        f[4] = this.wind[0]; f[5] = this.wind[1];
        f[6] = this.attractor[0]; f[7] = this.attractor[1];
        f[8] = this.attractStrength; f[9] = this.attractRadius;
        this.device.queue.writeBuffer(this._simU, 0, u);
        const pass = encoder.beginComputePass();
        pass.setPipeline(this._simPipe);
        pass.setBindGroup(0, this._simBind);
        pass.dispatchWorkgroups(Math.ceil(count / 64));
        pass.end();
    }

    /** Draw all particles into an already-open render pass (additive). */
    renderInto(pass) {
        if (!this.hasWork()) return;
        pass.setPipeline(this._drawPipe);
        pass.setBindGroup(0, this._drawBind);
        pass.draw(6, this.liveHint, 0, 0);
    }
}
