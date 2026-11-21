// Builds the item catalog from the game's own files. Nothing is bundled: every
// item listed is a package that exists in the user's install.
const fs = require('fs');
const path = require('path');
const upk = require('./upk');
const { swapProblem } = require('../../shared/swap');

// file-name prefix -> category
const PREFIXES = {
  body: 'cars',
  wheel: 'wheels',
  boost: 'boosts',
  skin: 'decals',
  hat: 'toppers',
  antenna: 'antennas', flag: 'antennas', countryflag: 'antennas', streamerflag: 'antennas',
  tourneyflag: 'antennas', pennant: 'antennas',
  engineaudio: 'engines',
  ss: 'trails',
  explosion: 'explosions',
  paintfinish: 'finishes',
  playerbanner: 'banners',
  avatarborder: 'borders',
  anthem: 'anthems',
};

const CATEGORIES = [
  { id: 'cars', label: 'Cars' },
  { id: 'wheels', label: 'Wheels' },
  { id: 'boosts', label: 'Boosts' },
  { id: 'decals', label: 'Decals' },
  { id: 'toppers', label: 'Toppers' },
  { id: 'antennas', label: 'Antennas' },
  { id: 'engines', label: 'Engine Sounds' },
  { id: 'trails', label: 'Trails' },
  { id: 'explosions', label: 'Goal Explosions' },
  { id: 'finishes', label: 'Paint Finishes' },
  { id: 'banners', label: 'Player Banners' },
  { id: 'borders', label: 'Avatar Borders' },
  { id: 'anthems', label: 'Player Anthems' },
];

// "AlphaReward" -> "Alpha Reward", "star_holo" -> "Star Holo"
function prettify(raw) {
  return raw
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function buildCatalog(cookedDir) {
  let files;
  try { files = fs.readdirSync(cookedDir); } catch (e) { throw new Error(`OpenW cannot read the game folder ${cookedDir} (${e.code || e.message}). Check the Rocket League folder in Settings.`); }
  const byLower = new Map(files.map((f) => [f.toLowerCase(), f]));
  const items = [];
  for (const file of files) {
    const m = /^([A-Za-z]+)_(.+)_SF\.upk$/i.exec(file);
    if (!m || /_T$/i.test(m[2])) continue; // "_T_SF" packages are thumbnails
    const category = PREFIXES[m[1].toLowerCase()];
    if (!category || /_premium_skins?(_|$)/i.test(m[2])) continue; // skin sets shipped with a car body are not items
    items.push({
      id: file.toLowerCase(),
      file,
      category,
      name: prettify(m[2]),
      thumb: byLower.get(`${m[1]}_${m[2]}_t_sf.upk`.toLowerCase()) || null, // the item's thumbnail package
      len: m[1].length + 1 + m[2].length, // length of the internal name, e.g. "Boost_Standard"
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { categories: CATEGORIES, items, fileCount: files.length };
}

// Marks each item `ok` when its package can be read with the keys OpenW has
// (only those can be used as a new look, and only those have a readable picture).
// `cache` maps file name -> { size, ok } and is updated in place; pass `skip` for
// files OpenW has replaced, so the answer stays the one for the original file.
function annotate(cookedDir, items, cache = {}, skip = new Set(), extraKeys = []) {
  for (const item of items) {
    const known = cache[item.id];
    if (known && skip.has(item.id)) { item.ok = known.ok; continue; }
    const file = path.join(cookedDir, item.file);
    let size;
    try { size = fs.statSync(file).size; } catch { item.ok = false; continue; } // a file that cannot be read: listed, not usable
    if (!known || known.size !== size) cache[item.id] = { size, ok: upk.probeFile(file, extraKeys) };
    item.ok = cache[item.id].ok;
  }
  return cache;
}

// Can `source` (the item you own) take the look of `target`? The rename is done in
// place, so the source's internal name must fit in the target's; the look must be able to go
// where the game looks for the source's (shared/swap.js).
function canSwap(source, target) {
  return !swapProblem(source, target);
}

module.exports = { CATEGORIES, buildCatalog, annotate, canSwap, prettify };
