// Arena maps. An arena is a "<Name>_P.upk" map file. Newer arenas are built from
// parts, each its own file, which the map loads by name:
//   <Name>_Field    the stadium itself (pitch, walls, goals, stands)
//   <Name>_OOB...   the surroundings outside the walls
//   <Name>_VFX/FX   weather and effects
// Because a part is loaded by file name, replacing one arena's part file with
// another arena's part is how a "merge" is done. Older arenas are a single file.
const fs = require('fs');
const path = require('path');
const upk = require('./upk');

// Internal name of the arena family -> the name players know. Only ones I am sure of.
const FRIENDLY = {
  stadium: 'DFH Stadium', eurostadium: 'Mannfield', park: 'Beckwith Park', utopiastadium: 'Utopia Coliseum',
  trainstation: 'Urban Central', wasteland: 'Wasteland', neotokyo: 'Neo Tokyo', underwater: 'AquaDome',
  farm: 'Farmstead', beach: 'Salty Shores', cs: 'Champions Field', chn_stadium: 'Forbidden Temple',
  fni_stadium: 'Forbidden Temple (Fire & Ice)', arc: 'Starbase ARC', music: 'Neon Fields', outlaw: 'Deadeye Canyon',
  throwbackstadium: 'Throwback Stadium', hoopsstadium: 'Dunk House', hoopsstreet: 'The Block',
};
const VARIANTS = { day: 'Day', night: 'Night', dusk: 'Dusk', dawn: 'Dawn', rainy: 'Rainy', snowy: 'Snowy', snow: 'Snowy', snownight: 'Snowy Night', winter: 'Snowy', foggy: 'Stormy', hw: 'Haunted', standard: 'Standard' };

// "CS_Day_P" -> "Champions Field (Day)"; unknown families keep their internal name.
function arenaName(base) {
  const stem = base.replace(/_P$/i, '');
  const lower = stem.toLowerCase();
  const family = Object.keys(FRIENDLY).filter((k) => lower === k || lower.startsWith(`${k}_`)).sort((a, b) => b.length - a.length)[0];
  if (!family) return stem.replace(/_/g, ' ');
  const rest = stem.slice(family.length).split('_').filter(Boolean).map((t) => VARIANTS[t.toLowerCase()] || t);
  return FRIENDLY[family] + (rest.length ? ` (${rest.join(' ')})` : '');
}

function partKind(partBase) {
  if (/_Field$/i.test(partBase)) return 'field';
  if (/_(VFX|FX|Effects)(_P)?$/i.test(partBase)) return 'effects';
  if (/_Lights?(_S)?$/i.test(partBase)) return 'lights';
  if (/_(SFX|Audio|Audio_Map)$/i.test(partBase)) return 'audio';
  return 'surroundings';
}

// Whole-arena snowy versions that ship with the game: the only places with falling snow.
const SNOWY_VERSIONS = { stadium: 'Stadium_Winter_P', park: 'Park_Snowy_P', eurostadium: 'EuroStadium_SnowNight_P', utopiastadium: 'UtopiaStadium_Snow_P' };

// Arenas that are not a normal soccar pitch: Rocket Labs, Hoops, Dropshot, Snow Day,
// Knockout, Quads, and soccar arenas with an unusual shape. They are never used for,
// or replaced by, "same arena every match".
const NOT_STANDARD = /^(labs_|hoops|shattershot|throwbackhockey|ko_|street_p$|wasteland_p$|wasteland_night_p$|neotokyo_p$|arc_p$)/i;

/**
 * Reads every arena and the part files it loads.
 * cache: { "<file>": { size, parts: [...] } }, updated in place (reading a map header is slow).
 * names: arena file (lower case) -> name the game shows, from the game's own text (labels.js).
 */
// resolve(file): where to read a game file from; OpenW's backup for a file it has changed, so a
// merged arena is still scanned as the game shipped it.
function scanArenas(cookedDir, cache = {}, extraKeys = [], names = new Map(), resolve = null) {
  const where = (f) => (resolve ? resolve(f) : path.join(cookedDir, f));
  let all;
  try { all = fs.readdirSync(cookedDir); } catch (e) { throw new Error(`OpenW cannot read the game folder ${cookedDir} (${e.code || e.message}). Check the Rocket League folder in Settings.`); }
  const files = all.filter((f) => /\.upk$/i.test(f) && !/_SF\.upk$/i.test(f));
  const byLower = new Map(files.map((f) => [f.replace(/\.upk$/i, '').toLowerCase(), f]));
  const isMap = (f) => /_P\.upk$/i.test(f) && !/^BG_|_Art_|_VFX_P|_OOB_P|MapImage/i.test(f);
  const arenas = [];
  for (const file of files.filter(isMap)) {
    const base = file.replace(/\.upk$/i, '');
    let size;
    try { size = fs.statSync(where(file)).size; } catch { continue; } // a file that cannot be read is left out
    let entry = cache[file];
    if (!entry || entry.size !== size || entry.locked === undefined) {
      let parts = [], locked = false;
      try {
        // a part is another package this map names that belongs to the same arena family
        // ("Mall_Day_P" loads "Mall_Field") and is not an arena map itself
        const family = `${base.split('_')[0].toLowerCase()}_`;
        parts = [...new Set(upk.readNamesFile(where(file), extraKeys).map((n) => n.toLowerCase()))]
          .filter((n) => n !== base.toLowerCase() && n.startsWith(family) && byLower.has(n) && !isMap(byLower.get(n)))
          .map((n) => byLower.get(n));
      } catch (e) { locked = e.code === 'NO_KEY'; } // unreadable map: listed without parts
      entry = cache[file] = { size, parts, locked };
    }
    const parts = entry.parts.filter((p) => byLower.has(p.replace(/\.upk$/i, '').toLowerCase()))
      .map((p) => ({ file: p, kind: partKind(p.replace(/\.upk$/i, '')) }));
    const id = base.toLowerCase();
    arenas.push({
      id, file, size, name: names.get(id) || arenaName(base),
      playable: names.has(id), // the game lists it as an arena you can play
      standard: names.has(id) && !NOT_STANDARD.test(id),
      field: (parts.find((p) => p.kind === 'field') || {}).file || null, parts,
      // files of this arena that the keys OpenW has cannot open (a key list in Settings opens
      // them); a locked main file also hides which parts the arena has
      locked: [...(entry.locked ? [file] : []), ...parts.filter((p) => !upk.probeFile(where(p.file), extraKeys)).map((p) => p.file)],
    });
  }
  // names the game gives several files are told apart by their file name
  const seen = new Map();
  for (const a of arenas) seen.set(a.name, (seen.get(a.name) || 0) + 1);
  for (const a of arenas) if (seen.get(a.name) > 1) a.name += ` · ${a.file.replace(/_P\.upk$/i, '').replace(/_/g, ' ')}`;
  arenas.sort((a, b) => (b.playable - a.playable) || a.name.localeCompare(b.name));
  return arenas;
}

// Which arenas show a changed game file: the arena itself, or every arena that loads that part.
function arenasUsing(arenas, gameFile) {
  const lower = gameFile.toLowerCase();
  return arenas.filter((a) => a.file.toLowerCase() === lower || a.parts.some((p) => p.file.toLowerCase() === lower));
}

// Parts that hold what lies outside the stadium walls, the main one first.
const OUTSIDE = /(OOB|Mountains|Buildings|Trees|DriftMtn|_Sky)/i;
function outsideParts(arena) {
  const main = (p) => (/_OOB(_P)?\.upk$/i.test(p.file) ? 0 : 1);
  return arena.parts.filter((p) => p.kind === 'surroundings' && OUTSIDE.test(p.file))
    .sort((a, b) => main(a) - main(b) || a.file.localeCompare(b.file));
}

/**
 * The stadium of `stadium` in `place`: place stays exactly as it is (its sky, lights, fog,
 * surroundings, sounds, effects and gameplay) and only its stadium is exchanged. Built at the
 * object level (mapbuild.js), where every placed piece is sorted into stadium or outside.
 *
 *   - Place's main file keeps everything except its stadium pieces (and anything standing
 *     where the new stadium goes).
 *   - Place's part files: its stadium file, and its sound parts if more room is needed
 *     ("slots"), are pointed at new files holding the stadium arena's stadium pieces: its
 *     stadium file, its main map, and any part that holds some of its stadium, each with
 *     only the stadium kept (no gameplay, lights, sky or fog). A stadium file of place's that
 *     is not needed loads empty. Place's outside parts load as filtered copies (their own
 *     stadium pieces out); its effects and lights parts load as they are.
 *   - A place arena with no stadium file and no sound part has no slot. Then the stadium
 *     arena's map is the base instead (its gameplay and stadium) and place's map and outside
 *     parts load in its part files, place's main map first so its sky comes along; the
 *     lighting and fog are then the stadium arena's.
 * info (optional, from reading the maps): { stadiumRegion, placeRegion, stadiumHolders: Set of
 * stadium-arena files with stadium pieces, placeHolders: Set of place part files with stadium
 * pieces }. Without it, a best guess is planned for display.
 * Standard soccar arenas only: the pitch shape comes with the stadium.
 * Returns { how: 'build', ops, play, note } or { how: 'none', reason }.
 */
function mergePlan(stadium, place, all = [], info = null) {
  if (!stadium || !place) throw new Error('Arena not found');
  if (stadium.id === place.id) return { how: 'none', reason: 'Pick two different arenas.' };
  const odd = [stadium, place].filter((a) => !a.standard);
  if (odd.length) return { how: 'none', reason: `${odd.map((a) => a.name).join(' and ')} ${odd.length > 1 ? 'have' : 'has'} a pitch of another shape, so the walls and the ball would not line up.` };
  const label = `${stadium.name} stadium in ${place.name}`;
  const group = `merge:${stadium.id}:${place.id}`;
  const sRegion = (info && info.stadiumRegion) || null, pRegion = (info && info.placeRegion) || null;
  const holds = (set, file, guess) => (info ? set.has(file.toLowerCase()) : guess);
  const name = (p) => p.file.replace(/\.upk$/i, '');
  const newFile = (i, slot) => `${mapbuildName(`${stadium.id}>${place.id}:${i}`, name(slot).length)}.upk`;
  const base = { kind: 'build', category: 'map', group, label };
  // the stadium arena's stadium pieces, from one of its files
  const stadiumOf = (from, extra = {}) => ({ ...base, from, side: 'stadium', region: sRegion, clear: [], gameplay: false, lights: false, part: from !== stadium.file, ...extra });
  // place's outside, from one of its files
  const outsideOf = (from, extra = {}) => ({ ...base, from, side: 'surroundings', region: pRegion, clear: sRegion || [], gameplay: false, lights: true, part: from !== place.file, ...extra });

  // where the stadium arena's stadium is: its stadium file first (newer arenas keep the stands
  // there), its main map, and parts that hold some of it (Champions Field's upper ring is in CS_OOB2)
  const sources = [
    ...(stadium.field ? [stadium.field] : []),
    ...(holds(info && info.stadiumHolders, stadium.file, true) ? [stadium.file] : []),
    ...stadium.parts.filter((p) => p.kind === 'surroundings' && holds(info && info.stadiumHolders, p.file, false)).map((p) => p.file),
  ];
  const pParts = place.parts;
  const slots = [...pParts.filter((p) => p.kind === 'field'), ...pParts.filter((p) => p.kind === 'audio')];

  if (slots.length) {
    const ops = [];
    const renames = {};
    const assigned = new Map();
    slots.forEach((slot, i) => { if (sources[i]) assigned.set(slot, sources[i]); });
    pParts.forEach((p, i) => {
      const source = assigned.get(p);
      let op = null;
      if (source) op = stadiumOf(source);
      else if (p.kind === 'field') op = { ...stadiumOf(p.file), side: 'empty' }; // place's own stadium never loads
      else if (p.kind === 'surroundings' && (holds(info && info.placeHolders, p.file, !!place.field) || sRegion)) op = outsideOf(p.file);
      if (!op) return; // effects, lights and unused sound parts load as they are
      const file = newFile(i, p);
      renames[name(p)] = file.replace(/\.upk$/i, '');
      ops.push({ ...op, gameFile: file, create: true });
    });
    // the main file goes last, so the game never loads it before the files it points to exist
    ops.push(outsideOf(place.file, { gameFile: place.file, gameplay: true, part: true, renames }));
    const quiet = [...assigned.keys()].some((s) => s.kind === 'audio');
    const left = sources.length - assigned.size;
    const note = [quiet ? `${place.name}’s background sounds make room for the stadium, so they are quiet.` : '',
      left > 0 ? `Part of ${stadium.name}’s stadium did not fit and is left out.` : ''].filter(Boolean).join(' ');
    return { how: 'build', ops, play: [place], note, files: ops.length };
  }

  // no slot in place: the stadium arena's map is the base, place's outside loads in its parts
  const sParts = stadium.parts.filter((p) => p.kind !== 'field' && p.kind !== 'lights');
  if (!sParts.length) return { how: 'none', reason: `${stadium.name} and ${place.name} are each one file with no parts, so there is nowhere to load one into the other.` };
  const pSources = [place.file, ...pParts.filter((p) => p.kind === 'surroundings' || p.kind === 'effects').map((p) => p.file)];
  const free = sParts.filter((p) => p.kind === 'audio' || !holds(info && info.stadiumHolders, p.file, !!stadium.field && p.kind !== 'effects'));
  const ops = [];
  const renames = {};
  const assigned = new Map();
  free.forEach((slot, i) => { if (pSources[i]) assigned.set(slot, pSources[i]); });
  sParts.forEach((slot, i) => {
    const source = assigned.get(slot);
    if (!source && slot.kind === 'audio') return;
    const file = newFile(i, slot);
    renames[name(slot)] = file.replace(/\.upk$/i, '');
    ops.push(source ? { ...outsideOf(source), gameFile: file, create: true }
      : free.includes(slot) ? { ...stadiumOf(slot.file), side: 'empty', gameFile: file, create: true }
        : { ...stadiumOf(slot.file), lights: true, gameFile: file, create: true });
  });
  ops.push({ ...stadiumOf(stadium.file), gameFile: place.file, gameplay: true, lights: true, part: false, renames });
  return {
    how: 'build', ops, play: [place], files: ops.length,
    note: `${place.name} has no stadium or sound file to load ${stadium.name}’s stadium in, so ${stadium.name}’s map is used with ${place.name}’s outside and sky around it; its light and fog are ${stadium.name}’s.`,
  };
}
// A short file name for a built part, the same every time for the same merge.
function mapbuildName(seed, maxLen) {
  const hex = require('crypto').createHash('sha1').update(seed).digest('hex');
  return `BP${hex.slice(0, Math.max(4, Math.min(8, maxLen - 2)))}`;
}
// What mergePlan needs to know, read from the maps. open(file) returns an opened package
// (mapbuild.open) or null.
function mergeInfo(stadium, place, open, mapbuild) {
  const holders = (a) => [a.file, a.field, ...a.parts.filter((p) => p.kind === 'surroundings').map((p) => p.file)].filter(Boolean);
  const region = (a) => mapbuild.arenaRegion(holders(a).map(open).filter(Boolean));
  const stadiumRegion = region(stadium), placeRegion = region(place);
  const withStadium = (files, reg) => new Set(files.filter((f) => { const pkg = open(f); return pkg && mapbuild.stadiumPieces(pkg, reg) > 0; }).map((f) => f.toLowerCase()));
  return {
    stadiumRegion, placeRegion,
    stadiumHolders: withStadium([stadium.file, ...stadium.parts.filter((p) => p.kind === 'surroundings' || p.kind === 'effects').map((p) => p.file)], stadiumRegion),
    placeHolders: withStadium(place.parts.filter((p) => p.kind === 'surroundings').map((p) => p.file), placeRegion),
  };
}

/* ---------- files that need a key list ----------
 * Rocket League encrypts its packages with many keys; OpenW ships one, and opens the rest with
 * a key list the user adds in Settings. A change that has to read a locked file cannot be built,
 * so it is checked before anything is written, and the page says which arena is in the way. */

// The game files an op reads: what it is built or copied from, and the file it writes over (it
// is written with that file's own key, read from the file).
const opReads = (op) => [op.from, op.sourceGameFile, op.create ? null : op.gameFile].filter(Boolean);

// Which of `files` (arena files and parts) cannot be opened: [{ file, arena }], one per file.
function lockedFiles(arenas, files) {
  const owner = new Map();
  for (const a of arenas) for (const f of a.locked || []) if (!owner.has(f.toLowerCase())) owner.set(f.toLowerCase(), { file: f, arena: a.name });
  const out = new Map();
  for (const f of files) { const hit = owner.get(String(f).toLowerCase()); if (hit) out.set(hit.file, hit); }
  return [...out.values()];
}

// What a merge, snow or every-match change would need to read and cannot: both arenas' own
// files (a locked map also hides which parts it has, so the plan itself would be wrong) and
// everything its ops read.
function lockedFor(arenas, involved, ops) {
  return lockedFiles(arenas, [...involved.map((a) => a.file), ...ops.flatMap(opReads)]);
}

// In words, for the page and for an error: which arena file cannot be opened and what fixes it.
function lockedMessage(locked) {
  if (!locked.length) return '';
  const what = locked.map((l) => `${l.arena}’s file ${l.file}`);
  const list = what.length > 1 ? `${what.slice(0, -1).join(', ')} and ${what[what.length - 1]}` : what[0];
  return `OpenW cannot open ${list} with the one key it comes with. Add a key list in Settings, under Item pictures and keys, and try again.`;
}

/* ---------- merged arenas ----------
 * `changes` is what OpenW has changed in the game folder: game file (lower case) -> op.
 * Merges and snow are copies, so they can be followed back to the file that is really loaded. */

const isMerge = (op) => op && / stadium in /.test(op.label || '') && op.group !== 'everymatch';

// The arena whose files are really loaded when `arena` is played: a whole-arena merge
// (or a snowy version) makes its main file a copy of another arena's.
function effectiveArena(arena, arenas, changes) {
  let a = arena;
  for (let i = 0; i < 5; i++) {
    const op = changes.get(a.file.toLowerCase());
    const src = op && op.kind === 'copy' && op.group !== 'everymatch' && arenas.find((x) => x.file.toLowerCase() === op.sourceGameFile.toLowerCase());
    if (!src) break;
    a = src;
  }
  return a;
}

// Arenas that look different because of a merge, each under the name of that merge.
function mergedArenas(arenas, changes) {
  const out = new Map();
  for (const op of changes.values()) {
    if (!isMerge(op)) continue;
    for (const a of arenasUsing(arenas, op.gameFile)) if (a.standard && !out.has(a.id)) out.set(a.id, { arena: a, label: op.label.replace(/, snowy$/, ''), group: op.group || null });
  }
  return [...out.values()];
}

// "Same arena every match": every standard arena file becomes a copy of what `chosen`
// really loads (for a whole-arena merge, the arena merged in). Whatever arena the game
// picks, it loads that. The pitch is the same size in all standard arenas, so the ball and
// walls still line up. Arena files you changed yourself (a merge, snow) are left as they are.
function everyMatchOps(chosen, arenas, changes = new Map(), label = chosen.name) {
  if (!chosen.standard) throw new Error('Pick a standard soccar arena');
  const source = effectiveArena(chosen, arenas, changes).file;
  const own = (a) => { const op = changes.get(a.file.toLowerCase()); return op && op.group !== 'everymatch'; };
  // a built merge is built again in each arena's place (its added files are shared); a copy of the
  // original main file would lose it
  const built = changes.get(chosen.file.toLowerCase());
  const make = built && built.kind === 'build' && built.group !== 'everymatch'
    ? (a) => ({ kind: 'build', gameFile: a.file, from: built.from, side: built.side, renames: built.renames, region: built.region, clear: built.clear, gameplay: built.gameplay, lights: built.lights, part: built.part })
    : (a) => ({ kind: 'copy', gameFile: a.file, sourceGameFile: source });
  return arenas.filter((a) => a.standard && a.id !== chosen.id && a.file.toLowerCase() !== source.toLowerCase() && !own(a)).map((a) => ({
    ...make(a), category: 'map', group: 'everymatch', chosen: chosen.id, label: `${label} in place of ${a.name}`,
  }));
}

// Whether two sets of every-match ops write the same files in the same way. Every match is out
// of date when what it wrote is not what it would write now (a merge made, changed or reverted).
function sameEveryMatch(a, b) {
  const sig = (o) => JSON.stringify([o.gameFile.toLowerCase(), o.kind, o.sourceGameFile || null, o.from || null, o.side || null,
    o.renames || null, o.region || null, o.clear || null, !!o.gameplay, !!o.lights, !!o.part]);
  const x = a.map(sig).sort(), y = b.map(sig).sort();
  return x.length === y.length && x.every((s, i) => s === y[i]);
}

/**
 * Snow for an arena, merged or not. Falling snow only exists inside the game's four snowy
 * arenas (there is no separate snow file: Forbidden Temple (Fire & Ice)'s effects file is
 * its fire dragon, checked in game), so snow means playing the snowy version of the arena.
 * Works on what the arena really loads: a whole-arena merge of DFH Stadium becomes the
 * snowy DFH Stadium and stays a merge. A stadium or surroundings merge cannot get snow,
 * because the snowy version would replace the files that make the merge.
 * Returns { how: 'version', op, play } or null.
 */
function snowPlan(arena, arenas, changes = new Map()) {
  const merge = mergedArenas(arenas, changes).find((m) => m.arena.id === arena.id);
  const eff = effectiveArena(arena, arenas, changes);
  if (merge && eff.id === arena.id) return null;
  const stem = eff.file.replace(/_P\.upk$/i, '').toLowerCase();
  const family = Object.keys(SNOWY_VERSIONS).find((k) => stem === k || stem.startsWith(`${k}_`));
  const snowy = family && arenas.find((a) => a.file.toLowerCase() === `${SNOWY_VERSIONS[family].toLowerCase()}.upk`);
  if (!snowy || snowy.id === eff.id) return null; // no snowy version, or already it
  const op = { kind: 'copy', gameFile: arena.file, sourceGameFile: snowy.file, category: 'map', label: `Snow on ${arena.name}` };
  if (merge) Object.assign(op, { group: merge.group, label: `${merge.label}, snowy` }); // stays part of its merge
  return { how: 'version', op, play: [arena], snowy: snowy.name };
}

module.exports = { scanArenas, arenaName, partKind, mergePlan, mergeInfo, outsideParts, arenasUsing, everyMatchOps, sameEveryMatch, effectiveArena, mergedArenas, snowPlan, opReads, lockedFiles, lockedFor, lockedMessage };
