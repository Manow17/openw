// The real shapes of the meshes in a cooked map, and where an arena's stadium stands.
//
// A StaticMesh export holds, after its properties and bounds, its first level of detail: a
// position buffer (stride 12, count n, then a bulk array of element size 12 and count n) and,
// later, an index buffer (element size 2 or 4, a count that is a multiple of 3, every index
// below n). Both are found by their headers; a buffer only counts when every position lies in
// the mesh's bounds and every index points at a position.
//
// A stadium's place is a grid seen from above: each cell its stadium pieces touch, with the
// lowest and highest point of them there. A piece stands in the stadium when most of its
// surface lies in those cells, between their floor and a little above their top (a roof over
// the stands, lights on top of them).

/* ---------- mesh shapes ---------- */

// The first level of detail of a StaticMesh: { pos: Float32Array (x y z ...), idx: Uint32Array }
// or null. d: the export's bytes, start: where its properties end (its bounds come next).
function meshShape(d, start) {
  if (!d || start < 0 || start + 28 > d.length) return null;
  const c = [d.readFloatLE(start), d.readFloatLE(start + 4), d.readFloatLE(start + 8)];
  const e = [d.readFloatLE(start + 12), d.readFloatLE(start + 16), d.readFloatLE(start + 20)];
  if (![...c, ...e].every(Number.isFinite)) return null;
  const room = e.map((v) => Math.abs(v) * 1.01 + 2);
  for (let o = start; o + 16 <= d.length; o++) {
    if (d.readInt32LE(o) !== 12 || d.readInt32LE(o + 8) !== 12) continue;
    const n = d.readInt32LE(o + 4);
    if (n < 3 || n > 4e6 || d.readInt32LE(o + 12) !== n || o + 16 + n * 12 > d.length) continue;
    const pos = new Float32Array(n * 3);
    let ok = true;
    for (let i = 0; i < n * 3; i++) {
      const v = d.readFloatLE(o + 16 + i * 4);
      if (!(Math.abs(v - c[i % 3]) <= room[i % 3])) { ok = false; break; }
      pos[i] = v;
    }
    if (!ok) continue;
    // (16-bit indices, 32-bit only past 65535 positions; the vertex colours in between have
    // element size 4 and one per position, and are no triangles even when they look like some)
    for (let q = o + 16 + n * 12; q + 8 <= d.length; q++) {
      const es = d.readInt32LE(q), cnt = d.readInt32LE(q + 4);
      if (!(es === 2 || (es === 4 && n > 65535 && cnt !== n)) || cnt < 3 || cnt % 3 || q + 8 + cnt * es > d.length) continue;
      const idx = new Uint32Array(cnt);
      let good = true, top = 0;
      for (let i = 0; i < cnt; i++) {
        const v = es === 2 ? d.readUInt16LE(q + 8 + i * 2) : d.readUInt32LE(q + 8 + i * 4);
        if (v >= n) { good = false; break; }
        if (v > top) top = v;
        idx[i] = v;
      }
      // the triangles use the positions up to the last one
      if (good && top >= n * 0.9 - 1) return { pos, idx };
    }
    return null; // positions without triangles: not a shape this can read
  }
  return null;
}

// UE3 rotator (pitch, yaw, roll in turns of 65536) as rows: where local x, y and z point
function rotation(R) {
  const k = (2 * Math.PI) / 65536;
  const SP = Math.sin(R.p * k), CP = Math.cos(R.p * k), SY = Math.sin(R.y * k), CY = Math.cos(R.y * k), SR = Math.sin(R.r * k), CR = Math.cos(R.r * k);
  return [
    [CP * CY, CP * SY, SP],
    [SR * SP * CY - CR * SY, SR * SP * SY + CR * CY, -SR * CP],
    [-(CR * SP * CY + SR * SY), CY * SR - CR * SP * SY, CR * CP],
  ];
}

// A shape placed in the world (xf: { t, rot, s }): positions in world space
function place(shape, xf) {
  const M = rotation(xf.rot);
  const p = shape.pos, out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i] * xf.s.x, y = p[i + 1] * xf.s.y, z = p[i + 2] * xf.s.z;
    out[i] = xf.t.x + x * M[0][0] + y * M[1][0] + z * M[2][0];
    out[i + 1] = xf.t.y + x * M[0][1] + y * M[1][1] + z * M[2][1];
    out[i + 2] = xf.t.z + x * M[0][2] + y * M[1][2] + z * M[2][2];
  }
  return out;
}

// Points spread over each triangle, at most `step` apart, each with its share of the area:
// fn(x, y, z, area). Long thin triangles (a wall seen from above) are covered along their edges.
// budget: about how many points at most (a giant mesh is sampled more coarsely).
function samples(pos, idx, step, fn, budget = 0) {
  if (budget) {
    let total = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      total += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    }
    step = Math.max(step, Math.sqrt(total / budget) * 1.5);
  }
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const ux = pos[b] - ax, uy = pos[b + 1] - ay, uz = pos[b + 2] - az;
    const vx = pos[c] - ax, vy = pos[c + 1] - ay, vz = pos[c + 2] - az;
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    const len = Math.max(Math.hypot(ux, uy, uz), Math.hypot(vx, vy, vz), Math.hypot(ux - vx, uy - vy, uz - vz));
    const n = Math.max(1, Math.min(200, Math.ceil(len / step)));
    const count = ((n + 1) * (n + 2)) / 2, share = area / count;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; i + j <= n; j++) {
        const s = i / n, r = j / n;
        fn(ax + ux * s + vx * r, ay + uy * s + vy * r, az + uz * s + vz * r, share);
      }
    }
  }
}

/* ---------- where a stadium stands ---------- */

const CELL = 250;
const BELOW = 400;   // a piece may reach this far under the stadium's floor in a cell
const ABOVE = 6000;  // and this far over its top (roofs, lights and flags over the stands)
const SAMPLE_BUDGET = 60000; // points to judge one piece by, at most about

class Footprint {
  constructor(cell = CELL) { this.cell = cell; this.cells = new Map(); }
  key(x, y) { return (Math.floor(x / this.cell) + 32768) * 65536 + (Math.floor(y / this.cell) + 32768); }
  // a shape of the stadium: every cell it touches, with its height there
  add(pos, idx) {
    this.hull = null;
    samples(pos, idx, this.cell / 2, (x, y, z) => {
      const k = this.key(x, y), v = this.cells.get(k);
      if (!v) this.cells.set(k, [z, z]);
      else { if (z < v[0]) v[0] = z; if (z > v[1]) v[1] = z; }
    });
  }
  // a box of the stadium (a piece with no readable shape)
  addBox(box) {
    this.hull = null;
    const { c, e } = box;
    for (let x = c.x - e.x; x <= c.x + e.x; x += this.cell / 2) {
      for (let y = c.y - e.y; y <= c.y + e.y; y += this.cell / 2) {
        const k = this.key(x, y), v = this.cells.get(k);
        if (!v) this.cells.set(k, [c.z - e.z, c.z + e.z]);
        else { v[0] = Math.min(v[0], c.z - e.z); v[1] = Math.max(v[1], c.z + e.z); }
      }
    }
  }
  // is this point in the stadium? (its cell or one next to it, between floor and a little over the top)
  has(x, y, z, below = BELOW, above = ABOVE) {
    const ix = Math.floor(x / this.cell) + 32768, iy = Math.floor(y / this.cell) + 32768;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const v = this.cells.get((ix + dx) * 65536 + iy + dy);
        if (v && z >= v[0] - below && z <= v[1] + above) return true;
      }
    }
    return false;
  }
  // how much of a shape's surface lies in the stadium (0..1), and how much area that is
  share(pos, idx, opts = {}) {
    let all = 0, inside = 0;
    samples(pos, idx, this.cell, (x, y, z, a) => { all += a; if (this.has(x, y, z, opts.below, opts.above)) inside += a; }, SAMPLE_BUDGET);
    return { share: all > 0 ? inside / all : 0, area: inside };
  }
  // The stadium's outline seen from above: the convex hull of its cells (counter-clockwise), and
  // how high it reaches. Everything inside is the stadium's inside: the pitch, the stands and the
  // ground between them.
  outline() {
    if (this.hull) return this.hull;
    const pts = [];
    let top = -Infinity;
    for (const [k, v] of this.cells) {
      const x = (Math.floor(k / 65536) - 32768) * this.cell, y = ((k % 65536) - 32768) * this.cell;
      pts.push([x, y], [x + this.cell, y], [x, y + this.cell], [x + this.cell, y + this.cell]);
      if (v[1] > top) top = v[1];
    }
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    const poly = pts.length < 3 ? [] : lower.slice(0, -1).concat(upper.slice(0, -1));
    this.hull = { poly, top };
    return this.hull;
  }
  // is this point inside the stadium's outline (and not above everything of it)?
  inside(x, y, z) {
    const { poly, top } = this.outline();
    if (poly.length < 3 || z > top + ABOVE) return false;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false;
    }
    return true;
  }
  // how much of a shape's surface lies inside the outline (0..1)
  within(pos, idx) {
    let all = 0, inside = 0;
    samples(pos, idx, this.cell * 2, (x, y, z, a) => { all += a; if (this.inside(x, y, z)) inside += a; }, SAMPLE_BUDGET);
    return all > 0 ? inside / all : 0;
  }
  // compact form, to be kept with a build: [cell, [ix, iy, zlo, zhi], ...] (heights in tens)
  toJSON() {
    const out = [];
    for (const [k, v] of this.cells) out.push(Math.floor(k / 65536) - 32768, (k % 65536) - 32768, Math.floor(v[0] / 10), Math.ceil(v[1] / 10));
    return { cell: this.cell, cells: out };
  }
  static from(json) {
    const f = new Footprint(json.cell);
    const a = json.cells;
    for (let i = 0; i + 3 < a.length; i += 4) f.cells.set((a[i] + 32768) * 65536 + a[i + 1] + 32768, [a[i + 2] * 10, a[i + 3] * 10]);
    return f;
  }
  get size() { return this.cells.size; }
}

module.exports = { meshShape, rotation, place, samples, Footprint, CELL };
