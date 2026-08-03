// --- GPU PROJECTILE TRAILS --------------------------------------------------
//
// Additive ribbon trails for glowing projectiles, replacing the flat
// globalAlpha=0.6 Canvas-2D polyline (projectile.js). The ribbon tapers BOTH
// width and alpha from a faint thin tail to a bright thick head, which is what
// makes it read as a streak rather than a dotted line.
//
// The CPU builds screen-space ribbon geometry each frame (projectiles are few;
// their histories are short) into one dynamic vertex buffer, drawn in a single
// additive pass. Degenerate (zero-length) segments are skipped so a slow or
// stationary projectile can't produce NaN normals / corrupt geometry.
//
// Only GLOWING projectiles route here (the overlay composites above the 2D
// layer, so a solid arrow's trail would wrongly draw over units it should pass
// behind); everything else stays on Canvas 2D.

const FLOATS_PER_VERT = 6;     // pos.xy + color.rgba
const VERTS_PER_SEG = 6;       // two triangles

const TRAIL_WGSL = /* wgsl */ `
struct VOut { @builtin(position) pos : vec4f, @location(0) col : vec4f };
@group(0) @binding(0) var<uniform> uRes : vec2f;
@vertex
fn vs(@location(0) aPos : vec2f, @location(1) aColor : vec4f) -> VOut {
  var o : VOut;
  o.pos = vec4f(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0, 0.0, 1.0);
  o.col = aColor;
  return o;
}
@fragment
fn fs(i : VOut) -> @location(0) vec4f {
  return vec4f(i.col.rgb * i.col.a, i.col.a);   // premultiplied additive
}
`;

export class GPUTrails {
    /**
     * @param {GPUDevice} device
     * @param {GPUTextureFormat} format
     */
    constructor(device, format) {
        this.device = device;
        this.maxVerts = 24576;              // ~4k ribbon segments/frame
        this.count = 0;                     // verts queued this frame
        this._data = new Float32Array(this.maxVerts * FLOATS_PER_VERT);

        this._vbuf = device.createBuffer({
            size: this.maxVerts * FLOATS_PER_VERT * 4,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this._ubuf = device.createBuffer({
            size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const mod = device.createShaderModule({ code: TRAIL_WGSL });
        const bgl = device.createBindGroupLayout({
            entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
        });
        this._bind = device.createBindGroup({
            layout: bgl, entries: [{ binding: 0, resource: { buffer: this._ubuf } }],
        });
        this._pipe = device.createRenderPipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
            vertex: {
                module: mod, entryPoint: "vs",
                buffers: [{
                    arrayStride: FLOATS_PER_VERT * 4,
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: "float32x2" },
                        { shaderLocation: 1, offset: 8, format: "float32x4" },
                    ],
                }],
            },
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

    /** Reset the per-frame ribbon batch. */
    begin() { this.count = 0; }

    /**
     * Append a tapered additive ribbon along a screen-space polyline.
     * @param {{x:number,y:number}[]} pts tail→head screen points (head = newest)
     * @param {number} baseW head half-width in px
     * @param {number[]} rgb [r,g,b] 0..1
     */
    addRibbon(pts, baseW, rgb) {
        const n = pts.length;
        if (n < 2) return;
        const d = this._data;
        const r = rgb[0], g = rgb[1], b = rgb[2];
        for (let i = 0; i < n - 1; i++) {
            if (this.count + VERTS_PER_SEG > this.maxVerts) return;
            const a = pts[i], c = pts[i + 1];
            const dx = c.x - a.x, dy = c.y - a.y;
            const len = Math.hypot(dx, dy);
            if (len < 0.5) continue;                 // skip degenerate → no NaN normal
            const nx = -dy / len, ny = dx / len;     // unit perpendicular
            // Taper along the trail: tail (t≈0) thin+faint, head (t≈1) thick+bright.
            const t0 = i / (n - 1), t1 = (i + 1) / (n - 1);
            const w0 = baseW * (0.12 + 0.88 * t0), w1 = baseW * (0.12 + 0.88 * t1);
            const a0 = 0.7 * t0 * t0, a1 = 0.7 * t1 * t1;
            const alx = a.x + nx * w0, aly = a.y + ny * w0;   // a left
            const arx = a.x - nx * w0, ary = a.y - ny * w0;   // a right
            const blx = c.x + nx * w1, bly = c.y + ny * w1;   // b left
            const brx = c.x - nx * w1, bry = c.y - ny * w1;   // b right
            let o = this.count * FLOATS_PER_VERT;
            const put = (x, y, al) => {
                d[o] = x; d[o + 1] = y; d[o + 2] = r; d[o + 3] = g; d[o + 4] = b; d[o + 5] = al;
                o += FLOATS_PER_VERT;
            };
            put(alx, aly, a0); put(blx, bly, a1); put(arx, ary, a0);
            put(arx, ary, a0); put(blx, bly, a1); put(brx, bry, a1);
            this.count += VERTS_PER_SEG;
        }
    }

    hasWork() { return this.count > 0; }

    /** Draw all queued ribbons into an open render pass. */
    renderInto(pass, resW, resH) {
        if (!this.hasWork()) return;
        const dev = this.device;
        dev.queue.writeBuffer(this._ubuf, 0, new Float32Array([resW, resH]));
        dev.queue.writeBuffer(this._vbuf, 0, this._data, 0, this.count * FLOATS_PER_VERT);
        pass.setPipeline(this._pipe);
        pass.setBindGroup(0, this._bind);
        pass.setVertexBuffer(0, this._vbuf);
        pass.draw(this.count, 1, 0, 0);
    }
}
