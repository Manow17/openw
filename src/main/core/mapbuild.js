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
const shapes = require('./shapes');

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

/* ---------- lighting ---------- */

// Most lamps of an arena are baked into its own map: each piece there carries the light that fell
// on it. A piece from another map has never been baked with this arena's lamps, so the game lights
// it with them live, on top of its own baked light (a stadium brought into Drift Woods (Night) took
// the colour of its 45 yellow-green lamps). Every lighting channel of such a piece is turned off,
// so no lamp lights it live: it keeps exactly the light baked into it in its own arena. The channels
// are bools of its LightingChannels, each changed in place; "initialized" must be on, or the game
// sets the default channels again (a bool tag of the struct is renamed to it when it has none).
// Returns true when done, false when the piece has no channels written to change.
function unlight(P, cd) {
  const r = tagged(P, cd);
  const lc = prop(r, 'LightingChannels');
  if (!lc || lc.type !== 'StructProperty') return false;
  const value = cd.subarray(lc.at, lc.at + lc.size);
  const sub = readTags(P.names, value, 0);
  if (!sub || !sub.props.length || sub.props.some((p) => p.type !== 'BoolProperty')) return false;
  let init = sub.props.find((p) => p.name === 'bInitialized');
  if (!init) {
    const idx = P.names.indexOf('bInitialized');
    if (idx < 0) return false;
    init = sub.props[0];
    value.writeInt32LE(idx, init.at - 25);
    value.writeInt32LE(0, init.at - 21);
  }
  for (const p of sub.props) value[p.at - 1] = p === init ? 1 : 0;
  return true;
}

// The lighting channels a component has on (names), or null when it has none written.
function channelsOf(P, cd) {
  const lc = prop(tagged(P, cd), 'LightingChannels');
  if (!lc || lc.type !== 'StructProperty') return null;
  const value = cd.subarray(lc.at, lc.at + lc.size);
  const sub = readTags(P.names, value, 0);
  return sub ? sub.props.filter((p) => p.type === 'BoolProperty' && value[p.at - 1]).map((p) => p.name) : null;
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
// The full placement of a component or an actor: where (t), turned how (pitch, yaw, roll in
// turns of 65536) and scaled how. A property that is not written has its default.
function transform(d, r, tName, s3Name, sName) {
  const t = vec(d, prop(r, tName)) || { x: 0, y: 0, z: 0 };
  const rot = prop(r, 'Rotation');
  const R = rot && rot.size === 12 ? { p: d.readInt32LE(rot.at), y: d.readInt32LE(rot.at + 4), r: d.readInt32LE(rot.at + 8) } : { p: 0, y: 0, r: 0 };
  const s3 = vec(d, prop(r, s3Name)) || { x: 1, y: 1, z: 1 };
  const sp = prop(r, sName), s = sp && sp.type === 'FloatProperty' ? d.readFloatLE(sp.at) : 1;
  return { t, rot: R, s: { x: s3.x * s, y: s3.y * s, z: s3.z * s } };
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
  // its real shape in the world, read when asked for
  function shape() { return worldShape(P, this); }
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
          ref: sm ? obj : 0, xf: sm ? transform(cd, cr, 'Translation', 'Scale3D', 'Scale') : null,
          shape,
          hide: () => cd.writeInt32LE(0, slot.at),
          move: (dz) => shiftZ(P, cd, dz),
          unlight: () => unlight(P, cd),
          channels: () => channelsOf(P, cd),
        });
      }
      continue;
    }
    const loc = vec(d, prop(r, 'Location'));
    const item = { kind: 'actor', cls: actor.cls, name: actor.name, box: loc ? { c: loc, e: { x: 0, y: 0, z: 0 } } : null, known: !!loc, hide: remove };
    item.shape = shape;
    // a mesh placed on its own (StaticMeshActor, InterpActor, ...): which mesh, and where, so it is
    // judged by what it is
    const comp = prop(r, 'StaticMeshComponent');
    if (comp && comp.type === 'ObjectProperty' && d.readInt32LE(comp.at) > 0) {
      const cd = P.obj(P.t.exports[d.readInt32LE(comp.at) - 1]);
      const sm = prop(tagged(P, cd), 'StaticMesh');
      const obj = sm && sm.type === 'ObjectProperty' ? cd.readInt32LE(sm.at) : 0;
      if (obj) {
        Object.assign(item, { mesh: named(obj).name, group: named(obj).group, ref: obj, xf: transform(d, r, 'Location', 'DrawScale3D', 'DrawScale'), unlight: () => unlight(P, cd), channels: () => channelsOf(P, cd) });
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

// The real shape of a placed mesh, in world space: { pos, idx }, or null when it cannot be read.
function worldShape(P, it) {
  if (!it.ref || it.ref <= 0 || !it.xf) return null;
  if (!P.shapes) P.shapes = new Map();
  let s = P.shapes.get(it.ref);
  if (s === undefined) {
    const d = P.obj(P.t.exports[it.ref - 1]);
    const r = tagged(P, d);
    s = r ? shapes.meshShape(d, r.end) : null;
    P.shapes.set(it.ref, s);
  }
  if (!s) return null;
  if (!it.world) it.world = { pos: shapes.place(s, it.xf), idx: s.idx };
  return it.world;
}

/* ---------- what is stadium ----------
 * Each piece of a map is judged by what it is (its name, its package) and by where its real
 * shape stands. Plants, ground, sky and weather, the game's helper shapes and scenery by name
 * never are stadium. Before 0.4.13 the stadium was a measured area (boxes around anything named
 * like stands) that swallowed trees, rocks and buildings; 0.4.13 and 0.4.14 went by names, which
 * missed roofs and let topiaries named "TopiaryStadium" in; since 0.4.15 it is the footprint of
 * the real shapes (below). */
const words = (text) => String(text || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/).filter(Boolean);
// atmosphere: never part of a stadium, wherever it is (fog over the pitch is the arena's weather)
const ATMOSPHERE_WORDS = new Set(('fog fogs mist haze cloud clouds sky skydome skybox skysphere skyline planet planets moon sun stars galaxy nebula aurora borealis '
  + 'smoke dust sandstorm storm snowfall rain weather sunshaft shaft godray godrays sheet sheets').split(' '));
// plants and garden decoration: never part of a stadium, not even on the pitch (Utopia's topiaries,
// planters and vines stood on the other arena's grass); grass only as the pitch surface itself
const TREE_WORDS = new Set(('tree trees poplar poplars leafy pine pines palm palms cypress bush bushes shrub shrubs plant plants planter planters topiary '
  + 'hedge hedges ivy vine vines flower flowers foliage pot pots corn cactus candy cane canes wreath garland').split(' '));
// (a pattern lying flat on the pitch is its surface, whatever it is called: Utopia's is "BushTrim")
const flatOnPitch = (it) => !!it.box && it.box.c.z + it.box.e.z < 60 && Math.abs(it.box.c.x) <= FIELD.x && Math.abs(it.box.c.y) <= FIELD.y;
// (a word starting like a plant counts too: "Plantpotter", "PeachBlossom", "Lillypads"; short
// words only whole, since "corner" is no corn)
const PLANT_STEMS = ['plant', 'flower', 'bush', 'shrub', 'hedge', 'topiar', 'blossom', 'petal', 'foliage', 'lilypad', 'lillypad', 'lilies', 'tree',
  'palm', 'poplar', 'cypress', 'vine', 'cactus', 'cacti', 'fern', 'seaweed', 'kelp', 'coral', 'leaf', 'leaves', 'wreath', 'garland', 'candycane', 'mushroom'];
const plantWord = (w) => TREE_WORDS.has(w) || ['lily', 'reed', 'reeds', 'moss'].includes(w) || (w.length > 3 && PLANT_STEMS.some((s) => w.startsWith(s)));
const plantlike = (it) => !flatOnPitch(it) && (nameWords(it).some(plantWord) || (nameWords(it).includes('grass') && it.box && it.box.c.z + it.box.e.z > 60));
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
const STADIUM = new Set(('stadium stands crowd crowds people fans seat seats bleacher bleachers tribune grandstand grandstands spectator spectators audience tifo '
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
// (gently rolling ground counts too: Beckwith Park's "TerrainClose" rises 350 over 37000; a slab
// under the stands, like Futura Garden's "UF_Stands_Backing", is part of the stands)
const isGround = (it) => {
  const g = it.box;
  if (!placed(it) || g.c.z - g.e.z >= 100 || !(g.e.x > PITCH.x || g.e.y > PITCH.y)) return false;
  if (standsNamed(it) && !nameWords(it).some((w) => ['ground', 'floor', 'terrain', 'landscape'].includes(w))) return false;
  return (g.e.z < 300 && g.c.z + g.e.z < 600) || (Math.max(g.e.x, g.e.y) > 12000 && g.c.z + g.e.z < 1500 && g.e.z < 0.05 * Math.max(g.e.x, g.e.y));
};
// The land the whole arena stands on, whatever its shape: a big piece whose surface runs under
// the pitch (AquaDome's seafloor is one bowl rising 55000 around the dome). It stays, like ground.
function underlay(it) {
  const g = it.box;
  if (!placed(it) || Math.max(g.e.x, g.e.y) < 8000 || Math.abs(g.c.x) > g.e.x || Math.abs(g.c.y) > g.e.y || g.c.z - g.e.z > 0) return false;
  const s = it.shape();
  if (!s) return false;
  let under = 0;
  shapes.samples(s.pos, s.idx, 500, (x, y, z, a) => { if (Math.abs(x) <= 4096 && Math.abs(y) <= 5120 && z < 200) under += a; });
  return under > 0.25 * 8192 * 10240;
}
// the lie of the land: broad, low for its size and starting at the ground (a seafloor, a plaza,
// hillsides). It may run under a stadium; only where it pokes into its stands does it go.
const terrainLike = (it) => { const g = it.box; return placed(it) && Math.max(g.e.x, g.e.y) > 4000 && g.e.z < 0.3 * Math.max(g.e.x, g.e.y) && g.c.z - g.e.z < 300; };
// the game's own helper shapes (a cube, a sphere) and the boost pads' meshes: gameplay, from the place arena
const helper = (it) => /^(EngineMeshes|EditorMeshes)/i.test(it.group || '') || words(it.group).includes('pickup');
/* ---------- the stadium by its real shape (since 0.4.15) ----------
 * Names alone miss pieces and let others in: Mannfield's roof is "Roof_Boxy", Utopia's awnings
 * over its stands have no stadium word, and its topiaries are "TopiaryStadium". So the stadium
 * starts from its sure pieces: everything on the pitch with its walls and goals, and the pieces
 * named as stands (stands, seats, bleachers, crowd, the stadium itself). Where their real
 * shapes stand, seen from above with their heights, is the stadium's footprint. Any other piece
 * is stadium when most of its real surface lies in that footprint (a roof or an awning over the
 * stands, lights, flags and screens on them), and never when it is a plant, ground, sky or
 * weather, a helper shape, or scenery by its name. */
// (a crowd is no anchor of its own: Boostfield Mall's shoppers stand all over the mall, so a crowd
// is stadium only where the stands are, like any other piece)
const STANDS_WORDS = new Set('stadium stands seat seats seating bleacher bleachers tribune tribunes grandstand grandstands coliseum'.split(' '));
// (or kept in a folder of its package named so: Futura Garden's ribbon over its stands is
// UF_Assets_01.Meshes.Stadium.UF_Ribbon)
const standsNamed = (it) => nameWords(it).some((w) => STANDS_WORDS.has(w) || (w.endsWith('stadium') && w.length > 7))
  || /\.(stadium|stands)$/i.test(it.group || '');
const IN_STADIUM = 0.6; // this much of a piece's surface in the footprint makes it part of the stadium
// never part of any stadium, wherever it stands
function never(it) {
  if (!placed(it) || atmosphere(it) || plantlike(it) || helper(it) || /Foliage/.test(it.cls || '') || isGround(it)) return true;
  return it.kind === 'actor' && !it.mesh && !(/LensFlare|Emitter/.test(it.cls) && onField(it));
}
// surely stadium: on the pitch, or named as stands within reach of it
function sure(it) {
  if (never(it)) return false;
  if (onField(it)) return true;
  const { c } = it.box;
  return standsNamed(it) && !scenery(it) && Math.abs(c.x) <= REACH && Math.abs(c.y) <= REACH && c.z <= TOP;
}
// An arena's stadium footprint, from all its files that hold some of it (added to fp when given,
// so the files can be read one at a time)
function footprint(packages, fp = new shapes.Footprint()) {
  for (const P of packages) footprintOf(inventory(P), fp);
  return fp;
}
// The footprint of the sure pieces among these (inventory items)
function footprintOf(items, fp = new shapes.Footprint()) {
  for (const it of items) {
    // (light cones and beams reach from the stands down over the pitch: no ground of the stadium)
    if (!sure(it) || nameWords(it).some((w) => /^(light)?(cone|cones|beam|beams)$/.test(w))) continue;
    const s = it.shape();
    if (s) fp.add(s.pos, s.idx);
    else if (it.kind !== 'actor' || it.mesh) fp.addBox(it.box);
  }
  return fp;
}
// Is this piece part of the stadium whose footprint is fp?
function inStadium(it, fp) {
  if (never(it)) return false;
  if (sure(it)) return true;
  if (!fp || scenery(it)) return false;
  const s = it.shape();
  if (s) return fp.share(s.pos, s.idx).share >= IN_STADIUM;
  const { c, e } = it.box;
  return [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => fp.has(c.x + dx * e.x * 0.5, c.y + dy * e.y * 0.5, c.z));
}
// Does a piece of the other arena stand where the stadium brought in stands? (a little of it is
// enough: it would poke through the stands)
// (inside its stands' own space: between their floor and just over their top, not under a roof's
// height over them, where trees and hills behind the stands rise)
function clashes(it, fp) {
  if (!fp || !placed(it) || atmosphere(it)) return false;
  const s = it.shape();
  if (s) { const r = fp.share(s.pos, s.idx, { above: CLASH_ABOVE }); return r.share > 0.15 || r.area > 1000000; }
  return fp.has(it.box.c.x, it.box.c.y, it.box.c.z, undefined, CLASH_ABOVE);
}
const CLASH_ABOVE = 300;
const CEILING = 2150; // the pitch's ceiling is at 2044
// Does the stadium brought in have a piece of its own where this piece of the pitch is, at its
// height? (a floor where the floor is; a force field over the pitch is no floor)
function replaced(it, fp) {
  if (!fp || !placed(it)) return false;
  const s = it.shape();
  if (s) return fp.share(s.pos, s.idx, { below: 100, above: 100 }).share >= 0.5;
  return fp.has(it.box.c.x, it.box.c.y, it.box.c.z, 100, 100);
}
// Is a piece (mostly) inside a stadium's outline, seen from above, and not above all of it?
function enclosed(it, fp) {
  if (!fp || !placed(it) || atmosphere(it) || terrainLike(it)) return false;
  const s = it.shape();
  if (s) return fp.within(s.pos, s.idx) >= 0.5;
  return fp.inside(it.box.c.x, it.box.c.y, it.box.c.z);
}
// boxes ({ x0, x1, y0, y1 }, as merges before 0.4.15 kept them) as a footprint
function boxFootprint(boxes) {
  const fp = new shapes.Footprint();
  for (const b of boxes || []) fp.addBox({ c: { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, z: 9000 }, e: { x: (b.x1 - b.x0) / 2, y: (b.y1 - b.y0) / 2, z: 10000 } });
  return fp;
}

/* ---------- keeping one side ---------- */

const PITCH = { x: 4700, y: 6400 }; // half sizes: walls at 4096 x 5120, goals 880 deep, a little room
const GROUND_DROP = 25; // how far the place arena's ground under the pitch is lowered

// Gameplay pieces: they come from one map only (the base), never from both.
const GAMEPLAY = /^(VehiclePickup|Goal|PlayerStart|Pylon|PointInSpace|CameraActor|SpectatorVolume|TriggerVolume|DecalBlockingActor|FXActor|LightmassImportanceVolume|PrefabInstance|MapInfo|ArenaSoundSettings|CrowdSounds|StatEvent|SceneCapture|Note|.*Volume(_TA)?$|.*Manager_TA$)/;
// Sky light and fog: they colour everything around, so they come with the outside.
// (PSC_Constrained_TA: particle systems that follow the camera, like falling snow)
const ATMOSPHERE = /^(ExponentialHeightFog|HeightFog|WindDirectionalSource|SkyLight|PSC_Constrained)/;
const LIGHTS = /^(StaticLightCollectionActor|.*Light)$/;

/**
 * Keeps one side of a map package, in place.
 *   'stadium'       only this arena's stadium: its pieces by `own`, the footprint of this
 *                   arena's stadium (from all its files). Gameplay, lights, sky and fog go.
 *   'surroundings'  everything but this arena's own stadium, anything on its pitch or close
 *                   around it, and anything standing where the stadium brought in stands
 *                   (`clear`, that stadium's footprint). Its ground, sky and fog stay.
 * own and clear: shapes.Footprint (from footprint()); clear may also be boxes, as merges before
 * 0.4.15 kept it. Without own, this package alone makes the footprint.
 * unlit: the pieces kept are loaded into another arena's map: no lamp lights them live, they keep
 * the light baked into them (unlight()); stats.unlit counts them, stats.lit the ones it could not.
 * gameplay: keep the gameplay actors (boost pads, goals, spawns, collision). Exactly one
 * package of a merge has them.
 * Returns counts; `log` (an array) gets one line per thing.
 */
function keepSide(P, side, { clear = null, own = null, gameplay = side === 'stadium', part = false, lights = null, unlit = false } = {}, log = null) {
  const keepLights = lights === null ? side === 'stadium' || gameplay : !!lights;
  const stats = { kept: 0, hidden: 0 };
  if (!own && side !== 'empty') own = footprint([P]);
  if (Array.isArray(clear)) clear = clear.length ? boxFootprint(clear) : null;
  for (const it of inventory(P)) {
    let keep;
    const cls = it.kind === 'actor' ? it.cls : '';
    if (side === 'empty') keep = false; // a part that must load nothing
    // (a DecalBlockingActor holding the pitch floor is a piece of the pitch, not gameplay)
    else if (GAMEPLAY.test(cls) && !(it.mesh && /^DecalBlocking/.test(cls))) keep = gameplay;
    else if (helper(it)) keep = gameplay; // boost pad meshes and helper shapes come with the gameplay
    else if (LIGHTS.test(cls)) keep = keepLights;
    else if (ATMOSPHERE.test(cls)) keep = side === 'surroundings';
    // the pitch's ground detail (close-up grass tufts near the camera): the stadium arena's, from its
    // main map, or the place arena's grass draws over the new pitch
    else if (/^GroundStaticMeshActor/.test(cls)) keep = side === 'stadium' && !part;
    else if (/collision/i.test(`${it.name} ${it.mesh || ''} ${it.group || ''}`)) keep = gameplay; // from one map only
    else if (side === 'stadium') keep = inStadium(it, own); // strictly the stadium: nothing else of this arena
    else if (!placed(it)) {
      // a piece whose place is not known: in this arena's main map it is taken as stadium, unless it
      // is plainly scenery; in an outside part file (fish, birds, weather) it is outside
      keep = part || scenery(it);
    } else {
      const g = it.box;
      // this arena's ground stays: every standard arena's ground is shaped around the same pitch, so
      // it fits under any stadium (Deadeye Canyon's terrain runs right up to the walls). Ground is low
      // and thin and reaches past the pitch; the pitch itself (named so) goes.
      const ground = isGround(it) || underlay(it);
      // Its own stadium goes, by the same rules as the one brought in. Its pitch itself (floor, walls,
      // goals: nothing on it rises over the ceiling) goes piece by piece, only where the new stadium
      // brings a piece of its own: a stadium whose floor is in a file that does not fit leaves this
      // arena's floor, never a hole. Light poles and the like around the pitch go. Everything
      // else stays (since 0.4.16: before, whatever stood close around the pitch or inside a
      // stadium's outline went too, and arenas lost trees and scenery that stood in nobody's way),
      // but where the new stadium really stands, nothing of this arena may stand.
      const pitch = onField(it) && !atmosphere(it) && g.c.z + g.e.z <= CEILING;
      keep = ground || (pitch ? !replaced(it, clear) : !inStadium(it, own) && !(onField(it) && stadiumNamed(it)) && !clashes(it, clear));
      // ground that runs under the pitch often has this arena's own pitch painted on it, at the same
      // height as the new one: lowered a little, the new pitch is always drawn on top
      if (keep && ground && Math.abs(g.c.x) - g.e.x < 4096 && Math.abs(g.c.y) - g.e.y < 5120 && g.c.z + g.e.z > -20) {
        if (it.move && it.move(-GROUND_DROP)) stats.lowered = (stats.lowered || 0) + 1;
      }
    }
    if (!keep) it.hide();
    else if (unlit && it.unlight) { const done = it.unlight(); stats[done ? 'unlit' : 'lit'] = (stats[done ? 'unlit' : 'lit'] || 0) + 1; }
    stats[keep ? 'kept' : 'hidden']++;
    if (log) log.push({ what: it.kind === 'actor' ? it.cls : it.kind, name: it.mesh || it.name, group: it.group || '', x: it.box ? Math.round(it.box.c.x) : null, y: it.box ? Math.round(it.box.c.y) : null, w: it.box ? Math.round(it.box.e.x) : null, h: it.box ? Math.round(it.box.e.y) : null, z: it.box ? Math.round(it.box.c.z) : null, d: it.box ? Math.round(it.box.e.z) : null, kept: keep });
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
// How many stadium pieces a package has (a part with none is free to reuse); fp: the arena's
// stadium footprint (this package alone without it)
function stadiumPieces(P, fp = null) {
  const f = fp || footprint([P]);
  return inventory(P).filter((it) => (it.kind !== 'actor' || it.mesh) && inStadium(it, f)).length;
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

module.exports = {
  open, repack, zipChunks, keepSide, levelActors, partNames, newFileName, deflateChunk, tagged, inventory,
  stadiumPieces, footprint, footprintOf, inStadium, sure, clashes, enclosed, rules: { isGround, underlay, atmosphere, terrainLike },
};
