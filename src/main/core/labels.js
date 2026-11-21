// Real item names. The game ships its English text in Coalesced_INT.bin: a set of
// ini-style files, AES-encrypted like the packages. Each product has a section
// named after its package ("skin_IndigoD") with a Label ("Lunation").
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const upk = require('./upk');

const FILE = 'Coalesced_INT.bin';

function decrypt(buf, hex) {
  const d = crypto.createDecipheriv('aes-256-ecb', Buffer.from(hex, 'hex'), null);
  d.setAutoPadding(false);
  return Buffer.concat([d.update(buf), d.final()]);
}

// The right key turns the start into: file count, then a file name as a length-prefixed string.
function findKey(buf, keys) {
  const head = buf.subarray(0, 64);
  return keys.find((hex) => {
    const p = decrypt(head, hex), files = p.readInt32LE(0), len = p.readInt32LE(4);
    if (files < 1 || files > 5000 || len === 0 || Math.abs(len) > 400) return false;
    const text = len < 0 ? p.toString('utf16le', 8, 48) : p.toString('latin1', 8, 48);
    return /^[\x20-\x7e]{12,}/.test(text);
  }) || null;
}

/** Parses the decrypted file into [{ section, key, value }] for every entry. */
function* entries(plain) {
  let p = 0;
  const int = () => { const v = plain.readInt32LE(p); p += 4; return v; };
  const str = () => {
    const len = int();
    if (len === 0) return '';
    const bytes = len < 0 ? -len * 2 : len;
    if (bytes > 1 << 20 || p + bytes > plain.length) throw new Error('bad string length');
    const s = len < 0 ? plain.toString('utf16le', p, p + bytes - 2) : plain.toString('latin1', p, p + bytes - 1);
    p += bytes;
    return s;
  };
  for (let files = int(); files > 0; files--) {
    str(); // file name
    for (let sections = int(); sections > 0; sections--) {
      const section = str();
      for (let pairs = int(); pairs > 0; pairs--) yield { section, key: str(), value: str() };
    }
  }
}

/**
 * Returns a Map of lower-cased package name -> display name, e.g. "skin_indigod" -> "Lunation".
 * Empty when the file is missing or none of the keys opens it (it needs a key from a key list).
 */
function readLabels(cookedDir, extraKeys = []) {
  return readTexts(cookedDir, extraKeys).labels;
}

/**
 * Everything OpenW takes from the game's text in one pass:
 *   labels  package name -> item name ("skin_indigod" -> "Lunation")
 *   maps    arena file   -> arena name as the game shows it ("cs_day_p" -> "Champions Field (Day)")
 * Keys are lower-cased. Both are empty when the file cannot be read.
 */
function readTexts(cookedDir, extraKeys = []) {
  const labels = new Map(), base = new Map(), variant = new Map();
  try {
    const buf = fs.readFileSync(path.join(cookedDir, FILE));
    const key = findKey(buf, [...upk.DEFAULT_KEYS, ...extraKeys]);
    if (key) {
      for (const { section, key: k, value } of entries(decrypt(buf, key))) {
        if (!value) continue;
        if (k === 'Label' && !labels.has(section.toLowerCase())) labels.set(section.toLowerCase(), value);
        else if (section === 'MapBase') base.set(k.toLowerCase(), value);
        else if (section === 'MapVariants') variant.set(k.toLowerCase(), value);
      }
    }
  } catch { /* unreadable: items keep their internal names */ }
  const maps = new Map([...base].map(([file, name]) => [file, variant.has(file) ? `${name} (${variant.get(file)})` : name]));
  // arenas the game's text did not name (it needs a key list to be read): OpenW's own list
  for (const [file, name] of Object.entries(require('./arena-names'))) if (!maps.has(file)) maps.set(file, name);
  return { labels, maps };
}

// Gives each catalog item its shop name (`label`) and, for a decal made for one
// car, that car's name (`sub`). Items without a label keep their internal name.
function applyLabels(items, labels) {
  let named = 0;
  for (const item of items) {
    const base = item.file.replace(/_SF\.upk$/i, '').toLowerCase();
    item.label = labels.get(base) || item.name;
    if (labels.has(base)) named++;
    item.sub = '';
    if (item.category === 'decals') {
      // "skin_moonflax_sportscar_flames" belongs to "body_moonflax_sportscar"
      const parts = base.split('_').slice(1, -1);
      for (let n = parts.length; n > 0 && !item.sub; n--) item.sub = labels.get(`body_${parts.slice(0, n).join('_')}`) || '';
    }
  }
  return named;
}

module.exports = { readLabels, readTexts, applyLabels };
