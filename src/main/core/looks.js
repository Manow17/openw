// Where the game finds an item's look, and how a swap puts the new look there.
//
// Every item is a product in the game's item list (ProductsDB, in TAGame.upk). A product names
// the package its look is loaded from and the path of the look inside it: "WHEEL_Star.WHEEL_Star",
// or for some items a path with a group ("boost_bloodshot.FX.boost_bloodshot") or a tier name
// ("boost_anime.boost_anime_tier1"). When the item is used, the game looks that path up among the
// objects it already has and only when it is not there loads <package>_SF.upk. In those files the
// item's objects are "forced exports": whichever loaded package has them first, wins. So:
//
//   - A swap writes the new look's package over the item's file, with the look moved and renamed
//     to exactly the path the item's product asks for (swapLook). Renaming names alone (what OpenW
//     did before 0.4.10) leaves a grouped or tiered look where the game never looks.
//   - Some items are loaded before their own file is ever read: default items are copied into
//     Startup.upk (OEM wheels) and into the main menu's intro scenes (Standard boost, Octane,
//     Breakout, Merc, ...). The game finds those copies first, so a swapped file is never read.
//     For those, the early copy of the look object gets another number on its name (hideLooks):
//     the game misses it and reads the swapped file. The rest of those copies (textures other
//     items use) stays, and so do the scenes that use the copy, since they refer to it by index.
const fs = require('fs');
const path = require('path');
const upk = require('./upk');

const { UpkError } = upk;

/* ---------- the game's item list ---------- */

// { "<package, lower case>": [[product, assetPath], ...] } from TAGame.upk.
function readProducts(cookedDir, keys = []) {
  const buf = fs.readFileSync(path.join(cookedDir, 'TAGame.upk'));
  const t = upk.readTables(buf, keys);
  const T = upk.headerTables(t.pkg);
  const products = T.exports.findIndex((e, i) => T.key(T.pathOf(i + 1)) === 'productsdb.products');
  const out = {};
  if (products < 0) return out;
  for (let i = 0; i < T.exports.length; i++) {
    if (T.exports[i].outer !== products + 1) continue;
    let d;
    try { d = upk.readObject(buf, t, t.exports[i]); } catch { continue; }
    let pkgName = null, assetPath = null;
    // tagged properties: name, type, size, array index, (struct or enum name), value
    for (let o = 4, k = 0; k < 60 && o + 24 <= d.length; k++) {
      const name = t.names[d.readInt32LE(o)];
      if (name === 'None' || name === undefined) break;
      const type = t.names[d.readInt32LE(o + 8)], size = d.readInt32LE(o + 16);
      o += 24;
      if (type === 'BoolProperty') { o += 1; continue; }
      if (type === 'StructProperty' || type === 'ByteProperty') o += 8;
      if (name === 'AssetPackageName' && type === 'NameProperty') pkgName = t.names[d.readInt32LE(o)];
      if (name === 'AssetPath' && type === 'StrProperty') {
        const n = d.readInt32LE(o);
        assetPath = n > 0 ? d.toString('latin1', o + 4, o + 4 + n - 1) : d.toString('utf16le', o + 4, o + 4 - 2 * n - 2);
      }
      o += size;
    }
    if (pkgName && assetPath) (out[pkgName.toLowerCase()] ||= []).push([T.text(T.exports[i]), assetPath]);
  }
  return out;
}

// The path of the look an item file holds, as ['WHEEL_Star', 'WHEEL_Star']: the product whose look
// is <package>.<package>, else the only one, else the first by name. Without the item list (or for a
// file no product uses) it is <package>.<package>, which is right for nearly every item.
function assetPath(products, file) {
  const base = upk.baseName(file);
  const list = (products && products[base.toLowerCase()]) || [];
  const plain = list.find(([, p]) => p.toLowerCase() === `${base}.${base}`.toLowerCase());
  const pick = plain || [...list].sort((a, b) => a[0].localeCompare(b[0]))[0];
  return pick ? pick[1].split('.') : [base, base];
}

/* ---------- a swap ---------- */

/**
 * The target item's package, made to be read as the source item: its look is moved to the
 * source's look path (srcPath) and renamed to it, along with the package names. Header only.
 * srcPath, tgtPath: look paths as from assetPath(). Throws UpkError with a code the page explains.
 */
function swapLook(buf, srcPath, tgtPath, keys = [], outputKey = null) {
  const [Ps, ...sRest] = srcPath, [Pt, ...tRest] = tgtPath;
  const Os = sRest[sRest.length - 1], Gs = sRest.slice(0, -1);
  const Gt = tRest.slice(0, -1);
  return upk.editHeader(buf, keys, outputKey, (plain, T, pkg) => {
    const asset = T.findExport(tgtPath);
    if (asset < 0) throw new UpkError('UNEXPECTED_LAYOUT', `The look "${tgtPath.join('.')}" was not found inside its file`);
    const look = T.exports[asset];
    if (look.num) throw new UpkError('LAYOUT_DIFFERS', 'This look is stored in a way OpenW cannot move yet');
    // its name: the package name renames with the package; a tier name is renamed on its own
    const renames = [{ from: Pt, to: Ps }, { from: `${Pt}_SF`, to: `${Ps}_SF` }];
    const lookName = T.names[look.name];
    if (lookName.toLowerCase() !== Pt.toLowerCase()) renames.push({ from: lookName, to: Os });
    else if (Os.toLowerCase() !== Ps.toLowerCase()) throw new UpkError('TIERED', 'Your item shares its file with other versions of it, so it can only take a look that does too');
    // where it has to be: straight under the package, or in the same group as the source's look
    let outer = look.outer;
    if (T.key(Gs) !== T.key(Gt)) {
      const into = T.findExport([Pt, ...Gs]);
      if (into < 0) throw new UpkError('LAYOUT_DIFFERS', `Your item keeps its look in a group ("${Gs.join('.')}") this look does not have`);
      outer = into + 1;
      // nothing else may already sit where the look goes
      if (T.exports.some((e, i) => i !== asset && e.outer === outer && !e.num && T.names[e.name].toLowerCase() === lookName.toLowerCase())) {
        throw new UpkError('LAYOUT_DIFFERS', 'This look has another object where its look would go');
      }
      plain.writeInt32LE(outer, look.at + 8);
    }
    const { missing } = upk.renameIn(plain, pkg.names, renames);
    if (missing.includes(Pt)) throw new UpkError('UNEXPECTED_LAYOUT', `"${Pt}" was not found inside the look's file`);
    return { moved: outer !== look.outer };
  }).buffer;
}

/* ---------- items the game has loaded before their own file ---------- */

// The number given to an early copy's look so the game no longer finds it by its path:
// "WHEEL_Star.WHEEL_Star" reads "WHEEL_Star.WHEEL_Star_1331100000" in that file.
const HIDE_NUMBER = 1331100001;
// Packages the game loads before an item's own file: the startup package (always), the main
// menu and its scenes, and the game modes (loaded before the cars of a match).
const EARLY = /^(Startup|MENU_[A-Za-z0-9_]*|NUE_[A-Za-z0-9_]*|GameInfo_[A-Za-z0-9_]*)\.upk$/i;
// Also loaded first, but the game's own code: never changed. Items copied there cannot be swapped.
const UNTOUCHABLE = /^(TAGame|Core|Engine|ProjectX|AkAudio|GFxUI|WinDrv|IpDrv|OnlineSubsystemEOS|OnlineSubsystemSteamworks)\.upk$/i;

/**
 * Which look paths (lower case, from `want`) the early packages carry a copy of (exports) or point
 * to (imports). Returns { "<path>": { exports: [file], imports: [file], untouchable: [file] } }.
 * resolve(file): where to read a game file (its original, if OpenW changed it).
 */
function scanEarly(cookedDir, want, keys = [], resolve = null) {
  const where = (f) => (resolve ? resolve(f) : path.join(cookedDir, f));
  const out = {};
  const add = (p, kind, file) => { const e = (out[p] ||= { exports: [], imports: [], untouchable: [] }); if (!e[kind].includes(file)) e[kind].push(file); };
  for (const file of fs.readdirSync(cookedDir).filter((f) => EARLY.test(f) || UNTOUCHABLE.test(f))) {
    let T;
    try { T = upk.headerTables(upk.readHeaderFile(where(file), keys)); } catch { continue; }
    const fixed = UNTOUCHABLE.test(file);
    T.exports.forEach((e, i) => { if (!e.num && e.outer > 0) { const p = T.key(T.pathOf(i + 1)); if (want.has(p)) add(p, fixed ? 'untouchable' : 'exports', file); } });
    if (!fixed) T.imports.forEach((e, i) => { if (!e.num && e.outer < 0) { const p = T.key(T.pathOf(-(i + 1))); if (want.has(p)) add(p, 'imports', file); } });
  }
  return out;
}

/**
 * The changes that let swapped items show although the game has them loaded early: for each early
 * package that carries a copy of one of `sources` (look paths), a 'hide' op that renames that copy.
 * When the copy is in Startup.upk (always loaded), the early packages that point to it are changed
 * the same way, so they keep finding it; a copy elsewhere is only loaded with its own scene.
 */
function hideOps(sources, scan) {
  const byFile = new Map();
  for (const p of new Set(sources.map((s) => (Array.isArray(s) ? s.join('.') : s).toLowerCase()))) {
    const hit = scan && scan[p];
    if (!hit || !hit.exports.length) continue;
    const files = [...hit.exports, ...(hit.exports.some((f) => /^Startup\.upk$/i.test(f)) ? hit.imports : [])];
    for (const f of files) { if (!byFile.has(f)) byFile.set(f, new Set()); byFile.get(f).add(p); }
  }
  return [...byFile].sort((a, b) => a[0].localeCompare(b[0])).map(([gameFile, paths]) => ({
    kind: 'hide', gameFile, paths: [...paths].sort(), category: 'hide', group: 'hide',
    label: `Lets swapped items show: ${gameFile}`,
  }));
}

/**
 * What has to change so the 'hide' changes match the swaps that are on or queued: the engine's
 * list ({ active, queue }), where each swap's source look is (assetPathOf(file)) and the early
 * scan. Returns { apply: [op], revert: [key], unqueue: [key] }; nothing for what is already right.
 */
function planHides({ active, queue }, assetPathOf, scan) {
  const on = new Map(active.map((r) => [r.key, r.op]));
  for (const q of queue) { if (q.type === 'apply') on.set(q.key, q.op); else on.delete(q.key); }
  const sources = [...on.values()].filter((op) => op.kind === 'swap').map((op) => assetPathOf(op.sourceFile));
  const want = new Map(hideOps(sources, scan).map((op) => [op.gameFile.toLowerCase(), op]));
  const same = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
  const out = { apply: [], revert: [], unqueue: [] };
  for (const [key, op] of on) {
    if (op.kind !== 'hide' || want.has(key)) continue;
    if (active.some((r) => r.key === key)) out.revert.push(key); else out.unqueue.push(key);
  }
  for (const [key, op] of want) { const now = on.get(key); if (!now || now.kind !== 'hide' || !same(now.paths, op.paths)) out.apply.push(op); }
  return out;
}

// Rename the copies of these looks (paths) in an early package: exports and imports at exactly
// that path get HIDE_NUMBER. Header only, written with the file's own key.
function hideLooks(buf, paths, keys = [], outputKey = null) {
  const want = new Set(paths.map((p) => p.toLowerCase()));
  const { buffer, result } = upk.editHeader(buf, keys, outputKey, (plain, T) => {
    let n = 0;
    T.exports.forEach((e, i) => { if (!e.num && want.has(T.key(T.pathOf(i + 1)))) { plain.writeInt32LE(HIDE_NUMBER, e.at + 16); n++; } });
    T.imports.forEach((e, i) => { if (!e.num && want.has(T.key(T.pathOf(-(i + 1))))) { plain.writeInt32LE(HIDE_NUMBER, e.at + 24); n++; } });
    return n;
  });
  if (!result) throw new UpkError('NOTHING_TO_HIDE', 'None of these looks is in this file');
  return buffer;
}

module.exports = { readProducts, assetPath, swapLook, hideLooks, hideOps, planHides, scanEarly, HIDE_NUMBER, EARLY, UNTOUCHABLE };
