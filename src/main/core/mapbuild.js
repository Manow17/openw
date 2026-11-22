// Builds merged arenas by editing map packages at the object level.
//
// Most arenas keep their stadium and surroundings together in one map file, so a merge
// cannot be done by swapping whole files. Instead, two packages are built:
//   base          a copy of the stadium arena's map with its surroundings hidden. It keeps
//                 the gameplay (boost pads, goals, spawns, collision) and the stadium.
//   surroundings  a copy of the other arena's map (or one of its outside parts) with its
//                 stadium hidden and its gameplay actors taken out of the level. It is
//                 written as a new file, and the base loads it in place of one of its own
//                 parts (its streaming level name is renamed to the new file's name).
//
// Every edit keeps sizes the same (a mesh reference set to none, an actor reference
// cleared from the level's list, a name shortened in place), so only the compressed
// chunks and the chunk table in the encrypted header change.
const zlib = require('zlib');
const crypto = require('crypto');
const upk = require('./upk');

const TAG = 0x9e2a83c1;
const BLOCK = 131072;

/* ---------- package in and out ---------- */

function open(buf, keys = []) {
  const t = upk.readTables(buf, keys);
  const base = t.chunks[0].uoff;
  const last = t.chunks[t.chunks.length - 1];
  const u = Buffer.alloc(last.uoff + last.usize - base);
  for (const c of t.chunks) upk.inflateChunk(buf, c.coff).copy(u, c.uoff - base);
  return { buf, t, u, base, names: t.names, obj: (e) => u.subarray(e.offset - base, e.offset - base + e.size) };
}

function deflateChunk(data) {
  const blocks = [];
  for (let o = 0; o < data.length; o += BLOCK) {
    const raw = data.subarray(o, Math.min(o + BLOCK, data.length));
    blocks.push({ z: zlib.deflateSync(raw, { level: 6 }), n: raw.length });
  }
  const head = Buffer.alloc(16 + blocks.length * 8);
  head.writeUInt32LE(TAG, 0);
  head.writeInt32LE(BLOCK, 4);
  head.writeInt32LE(blocks.reduce((s, b) => s + b.z.length, 0), 8);
  head.writeInt32LE(data.length, 12);
  blocks.forEach((b, i) => { head.writeInt32LE(b.z.length, 16 + i * 8); head.writeInt32LE(b.n, 20 + i * 8); });
  return Buffer.concat([head, ...blocks.map((b) => b.z)]);
}

// The package's chunks, compressed. They depend only on the objects, not on the key or the
// renames (those are in the header), so a build written into several files is compressed once.
function zipChunks(P) {
  return P.t.chunks.map((c) => deflateChunk(P.u.subarray(c.uoff - P.base, c.uoff - P.base + c.usize)));
}

// renames: { oldName: newName }, matched case-insensitively; a new name may be shorter.
// zipped: zipChunks(P), when it is already made.
function repack(P, key, renames = {}, zipped = zipChunks(P)) {
  const { t, buf } = P;
  const plain = Buffer.from(t.pkg.plain);
  for (const [from, to] of Object.entries(renames)) {
    const hits = t.pkg.names.filter((n) => n.text.toLowerCase() === from.toLowerCase());
    if (!hits.length) throw new Error(`"${from}" is not in the package`);
    for (const n of hits) {
      if (n.wide || to.length > n.len - 1 || !/^[\x21-\x7e]+$/.test(to)) throw new Error(`Cannot rename "${from}" to "${to}"`);
      plain.fill(0, n.offset + 4, n.offset + 4 + n.len);
      plain.write(to, n.offset + 4, 'latin1');
    }
  }
  const parts = [Buffer.from(buf.subarray(0, t.chunks[0].coff))];
  let at = t.chunks[0].coff;
  for (const [i, c] of t.chunks.entries()) {
    const z = zipped[i];
    plain.writeBigInt64LE(BigInt(at), c.at + 12);
    plain.writeInt32LE(z.length, c.at + 20);
    parts.push(z);
    at += z.length;
  }
  upk.aes('enc', key, plain).copy(parts[0], t.pkg.range.start);
  return Buffer.concat(parts);
}

/* ---------- reading objects ---------- */

function tagged(P, data) {
  const { names } = P;
  if (data.length >= 12 && names[data.readInt32LE(4)] === 'None') return { props: [], end: 12 };
  // Most objects start their properties within the first few words. Actors with a state frame
  // (moving props, lens flares) have one of odd length first, so every byte is tried, and a
  // start only counts when the whole property list reads to its end.
  for (let s = 0; s <= 96 && s + 12 <= data.length; s++) {
    const ty = names[data.readInt32LE(s + 8)];
    if (names[data.readInt32LE(s)] === undefined || !ty || !/Property$/.test(ty)) continue;
    const r = readTags(names, data, s);
    if (r) return r;
  }
  return null;
}
function readTags(names, data, start) {
  const props = [];
  let p = start;
  for (let guard = 0; guard < 500 && p + 8 <= data.length; guard++) {
    const n = names[data.readInt32LE(p)];
    if (n === undefined) return null;
    if (n === 'None') return { props, end: p + 8 };
    const type = names[data.readInt32LE(p + 8)];
    if (!type || !/Property$/.test(type)) return null;
    const size = data.readInt32LE(p + 16);
    let q = p + 24;
    if (type === 'StructProperty' || type === 'ByteProperty') q += 8;
    if (type === 'BoolProperty') q += 1;
    props.push({ name: n, type, size, at: q });
    p = q + size;
  }
  return null;
}
const prop = (r, name) => r && r.props.find((p) => p.name === name);
const vec = (d, p) => (p && p.size === 12 ? { x: d.readFloatLE(p.at), y: d.readFloatLE(p.at + 4), z: d.readFloatLE(p.at + 8) } : null);

// Local bounds of a mesh in this package: { c: centre, e: extent } (null for imported meshes).
function meshBounds(P, index, cache) {
  if (index <= 0) return null;
  if (cache.has(index)) return cache.get(index);
  const e = P.t.exports[index - 1];
  const d = P.obj(e);
  const r = tagged(P, d);
  let b = null;
  if (r && r.end + 28 <= d.length) {
    const f = (k) => d.readFloatLE(r.end + k * 4);
    b = { c: { x: f(0), y: f(1), z: f(2) }, e: { x: f(3), y: f(4), z: f(5) } };
    if (![b.c.x, b.c.y, b.e.x, b.e.y].every(Number.isFinite)) b = null;
  }
  cache.set(index, b);
  return b;
}

// The level object and its actor list: owner, count, references.
function levelActors(P) {
  const level = P.t.exports.find((e) => e.cls === 'Level');
  if (!level) throw new Error('No level in this package');
  const d = P.obj(level);
  const r = tagged(P, d);
  if (!r) throw new Error('Unreadable level');
  const at = r.end + 4; // the owner comes first
  const count = d.readInt32LE(at);
  if (count < 0 || at + 4 + count * 4 > d.length) throw new Error('Unreadable actor list');
  return { d, at: at + 4, count };
}

/* ---------- moving a piece ---------- */

// Properties that only matter in the editor or for baking: dropped to make room when a
// component needs a Translation it does not have.
const SPARE_PROPS = ['PreviewEnvironmentShadowing', 'bOverrideLightMapRes', 'OverriddenLightMapRes', 'bUseAsOccluder', 'TickGroup'];

/**
 * Moves a component up or down by dz, in place. With a Translation property, its z changes.
 * Without one (meshes placed in world space), the property block is rewritten at the same size:
 * a Translation is added, spare properties make room, and whatever is left is filled with a
 * property of a name the game does not know, which it skips. Returns false if it cannot.
 */
function shiftZ(P, d, dz) {
  const r = tagged(P, d);
  if (!r) return false;
  const tr = prop(r, 'Translation');
  if (tr && tr.size === 12) { d.writeFloatLE(d.readFloatLE(tr.at + 8) + dz, tr.at + 8); return true; }
  const idx = (n) => P.t.pkg.names.findIndex((x) => x.text === n);
  const [iTrans, iStruct, iVector, iArray] = ['Translation', 'StructProperty', 'Vector', 'ArrayProperty'].map(idx);
  if ([iTrans, iStruct, iVector, iArray].some((i) => i < 0)) return false;
  const start = r.props.length ? r.props[0].at - tagHeader(P, d, r.props[0]) : r.end - 8;
  const pieces = r.props.map((p) => ({ name: p.name, bytes: d.subarray(p.at - tagHeader(P, d, p), p.at + p.size) }));
  const total = r.end - start; // the property block, None included
  const tag = Buffer.alloc(44);
  tag.writeInt32LE(iTrans, 0); tag.writeInt32LE(iStruct, 8); tag.writeInt32LE(12, 16); tag.writeInt32LE(iVector, 24);
  tag.writeFloatLE(0, 32); tag.writeFloatLE(0, 36); tag.writeFloatLE(dz, 40);
  const none = d.subarray(r.end - 8, r.end);
  let keep = pieces;
  const size = (list) => list.reduce((s, p) => s + p.bytes.length, 0) + tag.length + none.length;
  for (const spare of SPARE_PROPS) {
    const left = total - size(keep);
    if (left === 0 || left >= 24) break;
    keep = keep.filter((p) => p.name !== spare);
  }
  const left = total - size(keep);
  if (left !== 0 && left < 24) return false;
  const filler = Buffer.alloc(left);
  if (left) {
    // an ArrayProperty tag with a name that is no property: the game skips its bytes
    filler.writeInt32LE(P.t.pkg.names.findIndex((x) => x.text === 'OpenW') >= 0 ? idx('OpenW') : iVector, 0);
    filler.writeInt32LE(iArray, 8); filler.writeInt32LE(left - 24, 16);
  }
  const block = Buffer.concat([...keep.map((p) => Buffer.from(p.bytes)), tag, filler, Buffer.from(none)]);
  if (block.length !== total) return false;
  block.copy(d, start);
  return true;
}
// Bytes of a property's tag before its value.
function tagHeader(P, d, p) {
  return 24 + (p.type === 'StructProperty' || p.type === 'ByteProperty' ? 8 : 0) + (p.type === 'BoolProperty' ? 1 : 0);
}

/* ---------- where things are ---------- */

// Placement of a component: Translation, Rotation (yaw is what matters for a stadium) and scale.
function placement(d, r) {
  const t = vec(d, prop(r, 'Translation')) || { x: 0, y: 0, z: 0 };
  const rot = prop(r, 'Rotation');
  const yaw = rot && rot.size === 12 ? (d.readInt32LE(rot.at + 4) / 65536) * 2 * Math.PI : 0;
  const s3 = vec(d, prop(r, 'Scale3D')) || { x: 1, y: 1, z: 1 };
  const sp = prop(r, 'Scale');
  const s = sp && sp.type === 'FloatProperty' ? d.readFloatLE(sp.at) : 1;
  return { t, yaw, s: { x: s3.x * s, y: s3.y * s, z: s3.z * s } };
}
// World box of local bounds under a placement.
function worldBox(b, pl) {
  const cx = b.c.x * pl.s.x, cy = b.c.y * pl.s.y;
  const cos = Math.cos(pl.yaw), sin = Math.sin(pl.yaw);
  const ex = Math.abs(b.e.x * pl.s.x), ey = Math.abs(b.e.y * pl.s.y);
  return {
    c: { x: pl.t.x + cx * cos - cy * sin, y: pl.t.y + cx * sin + cy * cos, z: pl.t.z + b.c.z * pl.s.z },
    e: { x: Math.abs(cos) * ex + Math.abs(sin) * ey, y: Math.abs(sin) * ex + Math.abs(cos) * ey, z: Math.abs(b.e.z * pl.s.z) },
  };
}

// Every placed thing in a level: meshes and particle systems of the collection actors (each
// hideable on its own), and the other actors (removable from the level).
function inventory(P) {
  const cache = new Map();
  const { d: lv, at, count } = levelActors(P);
  const items = [];
  // where a mesh or particle system comes from: "Trees.Meshes" for LombardyPoplar_Mini
  const T = P.T || (P.T = upk.headerTables(P.t.pkg));
  const named = (ref) => { const parts = T.pathOf(ref); return { name: parts[parts.length - 1] || '', group: parts.slice(0, -1).join('.') }; };
  for (let i = 1; i < count; i++) { // 0 is WorldInfo: every level has one
    const ref = lv.readInt32LE(at + i * 4);
    if (ref <= 0) continue;
    const actor = P.t.exports[ref - 1];
    const remove = () => lv.writeInt32LE(0, at + i * 4);
    const d = P.obj(actor);
    const r = tagged(P, d);
    const list = prop(r, 'StaticMeshComponents') || prop(r, 'ParticleSystemComponents');
    if (list && /CollectionActor$/.test(actor.cls)) {
      const n = d.readInt32LE(list.at);
      for (let k = 0; k < n; k++) {
        const ci = d.readInt32LE(list.at + 4 + k * 4);
        if (ci <= 0) continue;
        const cd = P.obj(P.t.exports[ci - 1]);
        const cr = tagged(P, cd);
        const pl = placement(cd, cr);
        const sm = prop(cr, 'StaticMesh'), tpl = prop(cr, 'Template');
        const slot = sm || tpl;
        if (!slot || slot.type !== 'ObjectProperty') continue;
        const obj = cd.readInt32LE(slot.at);
        if (obj === 0) continue;
        const { name, group } = named(obj);
        const local = sm ? meshBounds(P, obj, cache) : null;
        items.push({
          kind: sm ? 'mesh' : 'particles', name, group, box: local ? worldBox(local, pl) : { c: pl.t, e: { x: 0, y: 0, z: 0 } }, known: !!local || !!prop(cr, 'Translation'),
          hide: () => cd.writeInt32LE(0, slot.at),
          move: (dz) => shiftZ(P, cd, dz),
        });
      }
      continue;
    }
    const loc = vec(d, prop(r, 'Location'));
    const item = { kind: 'actor', cls: actor.cls, name: actor.name, box: loc ? { c: loc, e: { x: 0, y: 0, z: 0 } } : null, known: !!loc, hide: remove };
    // a mesh placed on its own (StaticMeshActor, InterpActor, ...): which mesh, and where, so it is
    // judged by what it is
    const comp = prop(r, 'StaticMeshComponent');
    if (comp && comp.type === 'ObjectProperty' && d.readInt32LE(comp.at) > 0) {
      const cd = P.obj(P.t.exports[d.readInt32LE(comp.at) - 1]);
      const sm = prop(tagged(P, cd), 'StaticMesh');
      const obj = sm && sm.type === 'ObjectProperty' ? cd.readInt32LE(sm.at) : 0;
      if (obj) {
        Object.assign(item, { mesh: named(obj).name, group: named(obj).group });
        const local = meshBounds(P, obj, cache);
        if (local) {
          // a property that is not written has its default: an actor with no Location is at the centre
          const rot = prop(r, 'Rotation');
          const yaw = rot && rot.size === 12 ? (d.readInt32LE(rot.at + 4) / 65536) * 2 * Math.PI : 0;
          const s3 = vec(d, prop(r, 'DrawScale3D')) || { x: 1, y: 1, z: 1 };
          const sp = prop(r, 'DrawScale'), sc = sp && sp.type === 'FloatProperty' ? d.readFloatLE(sp.at) : 1;
          item.box = worldBox(local, { t: loc || { x: 0, y: 0, z: 0 }, yaw, s: { x: s3.x * sc, y: s3.y * sc, z: s3.z * sc } });
          item.known = true;
        }
      }
    }
    items.push(item);
  }
  return items;
}

/* ---------- what is stadium (strict, since 0.4.13) ----------
 * A piece is stadium when it lies on the pitch with its walls and goals (the same in every
 * standard arena), or when its name or its package names a stadium part (stands, crowd, seats,
 * roof, field lights, banners, ...) and it is within reach of the pitch. Anything named as
 * scenery (trees, rocks, dunes, mountains, sky, buildings, city, water, weather, ...) never is,
 * and neither is anything whose place is not known. Before 0.4.13 the stadium was a measured
 * region (the boxes of every mesh named like stands); one big stands mesh made it swallow the
 * whole area around the stadium, and trees, dunes and rocks came along into the other arena. */
const words = (text) => String(text || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/).filter(Boolean);
// atmosphere: never part of a stadium, wherever it is (fog over the pitch is the arena's weather)
const ATMOSPHERE_WORDS = new Set(('fog fogs mist haze cloud clouds sky skydome skybox skysphere skyline planet planets moon sun stars galaxy nebula aurora borealis '
  + 'smoke dust sandstorm storm snowfall rain weather sunshaft shaft godray godrays').split(' '));
const TREE_WORDS = new Set('tree trees poplar poplars leafy pine pines palm palms cypress'.split(' '));
// scenery: vetoes a stadium-named piece away from the pitch (by its own name)
const SCENERY_WORDS = new Set([...TREE_WORDS, ...('bush bushes shrub shrubs plant plants foliage flower flowers hedge hedges ivy vine vines rock rocks boulder boulders '
  + 'cliff cliffs dune dunes mountain mountains hill hills terrain landscape mesa water ocean sea waves river lake pond waterfall building buildings skyscraper '
  + 'skyscrapers city house houses road roads street streets bridge highway monorail statue moai robosaurus junkmonster oob backdrop horizon island ship boat '
  + 'blimp car cars truck dragon volcano lava glacier igloo windmill barn silo tent crane billboard').split(' ')]);
// asset packages that only hold scenery (an arena's own packages are named after it, like
// TrainStation_Assets for Urban Central or CHN_OOB_Assets for Forbidden Temple's field: never a veto)
const SCENERY_GROUPS = new Set('trees foliage plants rocks mountains hills terrain landscape sky skybox skydome cloud clouds space planets city buildings water ocean weather nature'.split(' '));
// what names a stadium part away from the pitch (on it, everything is stadium): the stands, the crowd,
// the stadium itself, and what hangs on them. Generic words (light, wall, roof, glass, cone, stand)
// are not enough there: a mall's food court has walls and a banana stand, a park has lamp posts.
const STADIUM = new Set(('stadium stands crowd crowds seat seats bleacher bleachers tribune grandstand grandstands spectator spectators audience tifo '
  + 'coliseum arena field pitch goal goals station banner banners flag flags scaffold jumbotron scoreboard screen floodlight floodlights '
  + 'lightcone lightcones lightbar confetti flash flashes flare flares').split(' '));
const FIELD = { x: 5600, y: 7000 }; // the pitch with its walls, goals and the frame right around them
const REACH = 26000, TOP = 16000;   // how far out stands, roofs and field lights can stand
const nameWords = (it) => [...words(it.name), ...words(it.mesh)];
const atmosphere = (it) => [...nameWords(it), ...words(it.group)].some((w) => ATMOSPHERE_WORDS.has(w));
const scenery = (it) => atmosphere(it) || nameWords(it).some((w) => SCENERY_WORDS.has(w)) || words(it.group).some((w) => SCENERY_GROUPS.has(w)) || /Foliage/.test(it.cls || '');
const stadiumNamed = (it) => nameWords(it).some((w) => STADIUM.has(w) || (w.endsWith('stadium') && w.length > 7));
const placed = (it) => !!it.box && it.known && (it.kind !== 'mesh' || it.box.e.x + it.box.e.y + it.box.e.z > 0);
// mostly on the pitch: its centre, and the middle of each side of its box, within the field
const onField = (it) => placed(it) && Math.abs(it.box.c.x) + it.box.e.x * 0.5 <= FIELD.x && Math.abs(it.box.c.y) + it.box.e.y * 0.5 <= FIELD.y && it.box.c.z < 6000;
// ground: low, thin and reaching past the pitch. Every standard arena's ground fits under any
// stadium, so an arena keeps its own and never gets the other's.
const isGround = (it) => { const g = it.box; return placed(it) && g.e.z < 300 && g.c.z - g.e.z < 100 && g.c.z + g.e.z < 600 && (g.e.x > PITCH.x || g.e.y > PITCH.y); };
function isStadium(it) {
  if (!placed(it) || atmosphere(it) || /Foliage/.test(it.cls || '')) return false;
  if (isGround(it)) return false; // the other arena keeps its own ground, whatever this one calls it
  // other actors (moving meshes, sounds, ...) only when they are a mesh, or a flare on the pitch
  if (it.kind === 'actor' && !it.mesh && !(/LensFlare|Emitter/.test(it.cls) && onField(it))) return false;
  // on the pitch, with its walls and goals: the stadium, whatever its name (but no trees)
  if (onField(it)) return !nameWords(it).some((w) => TREE_WORDS.has(w));
  // further out: only pieces named as stadium parts, never scenery, within reach of the pitch
  const { c } = it.box;
  return stadiumNamed(it) && !scenery(it) && Math.abs(c.x) <= REACH && Math.abs(c.y) <= REACH && c.z <= TOP;
}

/* ---------- what is stadium and what is outside ---------- */

// The stadium of an arena is a region: the pitch with its walls and goals, plus the footprint
// of each of its stands (measured from the map). Arenas differ a lot: Parc de Paris has stands
// only behind the goals and open park along the sides, so one box around everything would
// count the park as stadium.
const STANDS = /stand|bleach|seat|tribune|grandstand|crowd|people|audience|spectator|_roof|backwall/i;
const SKY = /sky|cloud|sunplane|sun_?disc|moon|horizon|fog|backdrop|skyline|stars?_|aurora|borealis/i;
const GROUND_DROP = 25; // how far the place arena's ground under the pitch is lowered
const SKY_HEIGHT = 4500; // a placed actor above this (the crossbar is at 642, the ceiling at 2044) is sky
const NEVER_STADIUM = /OOB/i;
const STADIUM_PART = /stadium|arena|coliseum/i;
const PITCH = { x: 4700, y: 6400 }; // half sizes: walls at 4096 x 5120, goals 880 deep, a little room
const STAND_ROOM = 400;

// One box per stands piece, mirrored both ways (arenas are symmetric).
function standBoxes(P) {
  const out = [];
  for (const it of inventory(P)) {
    if (it.kind !== 'mesh' || !it.known || !STANDS.test(it.name) || SKY.test(it.name) || NEVER_STADIUM.test(it.name)) continue;
    if (flat(it.box)) continue; // a path or floor named after the stands is not a stand
    const { c, e } = it.box;
    if (Math.abs(c.x) + e.x > 60000 || Math.abs(c.y) + e.y > 60000) continue; // a mistaken giant: not a stand
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      out.push({
        x0: sx * c.x - e.x - STAND_ROOM, x1: sx * c.x + e.x + STAND_ROOM, y0: sy * c.y - e.y - STAND_ROOM, y1: sy * c.y + e.y + STAND_ROOM,
        z0: c.z - e.z, z1: c.z + e.z + STAND_ROOM, stands: true, // nothing below the stands (water, ground) is part of them
      });
    }
  }
  return out;
}
// The stadium region of an arena from all its packages that hold stands (main file, stadium
// file, outside parts): [pitch box, ...stand boxes], rounded and without duplicates.
function arenaRegion(packages) {
  const boxes = [{ x0: -PITCH.x, x1: PITCH.x, y0: -PITCH.y, y1: PITCH.y }];
  const seen = new Set();
  for (const P of packages) {
    for (const b of standBoxes(P)) {
      const r = { x0: Math.round(b.x0), x1: Math.round(b.x1), y0: Math.round(b.y0), y1: Math.round(b.y1), z0: Math.round(b.z0), z1: Math.round(b.z1), stands: true };
      const k = `${r.x0},${r.x1},${r.y0},${r.y1},${r.z0},${r.z1}`;
      if (!seen.has(k)) { seen.add(k); boxes.push(r); }
    }
  }
  return boxes;
}
const inRegion = (pt, region) => region.some((b) => pt.x >= b.x0 && pt.x <= b.x1 && pt.y >= b.y0 && pt.y <= b.y1);
const regionBounds = (region) => region.reduce((a, b) => ({ x: Math.max(a.x, Math.abs(b.x0), Math.abs(b.x1)), y: Math.max(a.y, Math.abs(b.y0), Math.abs(b.y1)) }), { x: 0, y: 0 });
// mostly inside: its centre, and the middle of each side, are in the region
const mostlyIn = (box, region) => inRegion(box.c, region)
  && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => inRegion({ x: box.c.x + dx * box.e.x * 0.5, y: box.c.y + dy * box.e.y * 0.5 }, region));
const flat = (box) => box.e.z < 150 && (box.e.x > 2000 || box.e.y > 2000);
// In 3D, inside the stands themselves (not just above or below them): a lily pad on the water
// next to the stands, or a big rock that only touches them, is not part of the stands.
const inStands = (pt, region) => region.some((b) => b.stands && pt.x >= b.x0 && pt.x <= b.x1 && pt.y >= b.y0 && pt.y <= b.y1 && pt.z >= b.z0 && pt.z <= b.z1);
const mostlyInStands = (box, region) => inStands(box.c, region)
  && [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].every(([dx, dy, dz]) => inStands({ x: box.c.x + dx * box.e.x * 0.5, y: box.c.y + dy * box.e.y * 0.5, z: box.c.z + dz * box.e.z * 0.5 }, region));
const pitchOnly = (region) => region.filter((b) => !b.stands);
// names of stadium pieces (an arena's own stadium, wherever its stands box ends)
const STADIUM_WORDS = /stadium|stand|seat|bleach|tribune|grandstand|crowd|arena|coliseum|field|goal|pitch/i;
const DEFAULT_REGION = [{ x0: -6500, x1: 6500, y0: -8000, y1: 8000 }];

// Gameplay pieces: they come from one map only (the base), never from both.
const GAMEPLAY = /^(VehiclePickup|Goal|PlayerStart|Pylon|PointInSpace|CameraActor|SpectatorVolume|TriggerVolume|DecalBlockingActor|FXActor|LightmassImportanceVolume|PrefabInstance|MapInfo|ArenaSoundSettings|CrowdSounds|StatEvent|SceneCapture|Note|.*Volume(_TA)?$|.*Manager_TA$)/;
// Sky light and fog: they colour everything around, so they come with the outside.
// (PSC_Constrained_TA: particle systems that follow the camera, like falling snow)
const ATMOSPHERE = /^(ExponentialHeightFog|HeightFog|WindDirectionalSource|SkyLight|PSC_Constrained)/;
const LIGHTS = /^(StaticLightCollectionActor|.*Light)$/;

/**
 * Keeps one side of a map package, in place.
 *   'stadium'       only this arena's stadium (`region`): pieces mostly inside it. The sky,
 *                   fog, anything named OOB and everything further out is hidden. Lights stay
 *                   (they light the stadium).
 *   'surroundings'  only what lies outside both stadiums (`region`, this arena's own, and
 *                   `clear`, the other arena's), plus sky and fog. Lights are taken out.
 * gameplay: keep the gameplay actors (boost pads, goals, spawns, collision). Exactly one
 * package of a merge has them.
 * Returns counts; `log` (an array) gets one line per thing.
 */
function keepSide(P, side, { region = DEFAULT_REGION, clear = [], gameplay = side === 'stadium', part = false, lights = null } = {}, log = null) {
  const keepLights = lights === null ? side === 'stadium' || gameplay : !!lights;
  const stats = { kept: 0, hidden: 0 };
  // `clear`: the pieces of the stadium brought in (their boxes): nothing of this arena stays there
  const clearReach = regionBounds(clear);
  for (const it of inventory(P)) {
    let keep;
    const cls = it.kind === 'actor' ? it.cls : '';
    if (side === 'empty') keep = false; // a part that must load nothing
    else if (GAMEPLAY.test(cls)) keep = gameplay;
    else if (LIGHTS.test(cls)) keep = keepLights;
    else if (ATMOSPHERE.test(cls)) keep = side === 'surroundings';
    // the pitch's ground detail (close-up grass tufts near the camera): the stadium arena's, from its
    // main map, or the place arena's grass draws over the new pitch
    else if (/^GroundStaticMeshActor/.test(cls)) keep = side === 'stadium' && !part;
    else if (/collision/i.test(`${it.name} ${it.mesh || ''} ${it.group || ''}`)) keep = gameplay; // from one map only
    else if (side === 'stadium') keep = isStadium(it); // strictly the stadium: nothing else of this arena
    else if (!placed(it)) {
      // a piece whose place is not known: in this arena's main map it is taken as stadium, unless it
      // is plainly scenery; in an outside part file (fish, birds, weather) it is outside
      keep = part || scenery(it);
    } else {
      const g = it.box;
      // this arena's ground stays: every standard arena's ground is shaped around the same pitch, so
      // it fits under any stadium (Deadeye Canyon's terrain runs right up to the walls). Ground is low
      // and thin and reaches past the pitch; the pitch itself (named so) goes.
      const ground = isGround(it);
      // its own stadium, by the same rules as the one brought in, and fog or lights hanging over its pitch
      const own = isStadium(it) || (onField(it) && stadiumNamed(it));
      // where the new stadium's pieces stand, nothing of this arena may stand (a combined mesh far
      // bigger than all of them, like a whole terrain in one, only goes when it is mostly inside)
      const huge = !flat(g) && (g.e.x > clearReach.x * 1.2 || g.e.y > clearReach.y * 1.2);
      const clash = clear.length > 0 && (huge ? mostlyIn(g, clear) : inRegion(g.c, clear) || mostlyIn(g, clear));
      keep = ground || (!own && !clash);
      // ground that runs under the pitch often has this arena's own pitch painted on it, at the same
      // height as the new one: lowered a little, the new pitch is always drawn on top
      if (keep && ground && Math.abs(g.c.x) - g.e.x < 4096 && Math.abs(g.c.y) - g.e.y < 5120 && g.c.z + g.e.z > -20) {
        if (it.move && it.move(-GROUND_DROP)) stats.lowered = (stats.lowered || 0) + 1;
      }
    }
    if (!keep) it.hide();
    stats[keep ? 'kept' : 'hidden']++;
    if (log) log.push({ what: it.kind === 'actor' ? it.cls : it.kind, name: it.mesh || it.name, group: it.group || '', x: it.box ? Math.round(it.box.c.x) : null, y: it.box ? Math.round(it.box.c.y) : null, w: it.box ? Math.round(it.box.e.x) : null, h: it.box ? Math.round(it.box.e.y) : null, kept: keep });
  }
  // weather that follows the camera (falling snow) can hang off any actor, WorldInfo included: a
  // stadium brought into another arena brings none of it
  if (side !== 'surroundings') {
    for (const e of P.t.exports) {
      if (!/^PSC_Constrained/.test(e.cls)) continue;
      const d = P.obj(e);
      const tpl = prop(tagged(P, d), 'Template');
      if (tpl && tpl.type === 'ObjectProperty' && d.readInt32LE(tpl.at) !== 0) { d.writeInt32LE(0, tpl.at); stats.hidden++; }
    }
  }
  return stats;
}
// How many stadium pieces a package has (a part with none is free to reuse).
// How many stadium pieces a package has (by the strict rules; `region` is no longer used).
function stadiumPieces(P) {
  return inventory(P).filter((it) => it.kind !== 'actor' && isStadium(it)).length;
}
// Where an arena's stadium pieces are: one box each (as a region: x0 x1 y0 y1), from all the files
// that hold some. The place arena clears these, so nothing of it stands inside the new stadium.
function stadiumBoxes(packages) {
  const out = [], seen = new Set();
  for (const P of packages) {
    for (const it of inventory(P)) {
      if (it.kind === 'actor' && !it.mesh) continue;
      if (!isStadium(it) || it.box.e.x + it.box.e.y < 50) continue;
      const { c, e } = it.box;
      const b = { x0: Math.round(c.x - e.x), x1: Math.round(c.x + e.x), y0: Math.round(c.y - e.y), y1: Math.round(c.y + e.y) };
      const k = `${b.x0},${b.x1},${b.y0},${b.y1}`;
      if (!seen.has(k)) { seen.add(k); out.push(b); }
    }
  }
  // the pitch is always part of it; a box inside another adds nothing
  out.unshift({ x0: -PITCH.x, x1: PITCH.x, y0: -PITCH.y, y1: PITCH.y });
  return out.filter((b, i) => !out.some((o, j) => j !== i && o.x0 <= b.x0 && o.x1 >= b.x1 && o.y0 <= b.y0 && o.y1 >= b.y1 && (j < i || o.x0 !== b.x0 || o.x1 !== b.x1 || o.y0 !== b.y0 || o.y1 !== b.y1)));
}


// Streaming level names a map loads (its part packages), as written in its name table.
function partNames(P, partFiles) {
  const wanted = new Set(partFiles.map((f) => f.replace(/\.upk$/i, '').toLowerCase()));
  return P.t.pkg.names.filter((n) => wanted.has(n.text.toLowerCase())).map((n) => n.text);
}

// A short file name for a built surroundings package, the same for the same merge.
function newFileName(seed, maxLen) {
  const hex = crypto.createHash('sha1').update(seed).digest('hex');
  return `BP${hex.slice(0, Math.max(4, Math.min(8, maxLen - 2)))}`;
}

module.exports = { open, repack, zipChunks, keepSide, levelActors, partNames, newFileName, deflateChunk, tagged, inventory, arenaRegion, standBoxes, stadiumPieces, stadiumBoxes, isStadium, DEFAULT_REGION };
