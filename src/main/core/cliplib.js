// Clips on disk: names, keybinds, the library list and trimming. No Electron here, so the tests
// can run it; main/clips.js does the capturing and the windows.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mp4 = require('../../shared/mp4');

const EXT = /\.(mp4|webm)$/i;
const LENGTHS = [10, 15, 20, 30, 45, 60, 90, 120, 180];

const DEFAULTS = {
  on: false,          // keep the last moments of the game ready to save
  onlyInGame: true,   // only while Rocket League runs (nothing runs otherwise)
  folder: '',         // '' is Videos\OpenW Clips
  res: '1080',        // 'native' | '1440' | '1080' | '720'
  fps: 60,
  mbps: 12,
  codec: 'h264',      // 'h264' | 'av1'
  source: 'screen',   // 'screen' (with the overlays) | 'game' (the Rocket League window only)
  game: true, gameVol: 100,
  mic: false, micId: 'default', micVol: 100,
  keys: [{ key: 'Alt+F9', seconds: 30 }, { key: 'Alt+F10', seconds: 90 }],
  sound: true, toast: true,
};

// Settings as saved, completed and kept in range (an old or hand-edited file cannot break capture).
function complete(c = {}) {
  const out = { ...DEFAULTS, ...c };
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  const num = (v, lo, hi, def) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : def);
  out.res = pick(String(out.res), ['native', '1440', '1080', '720'], '1080');
  out.fps = pick(Number(out.fps), [30, 60], 60);
  out.mbps = num(out.mbps, 2, 80, 12);
  out.codec = pick(out.codec, ['h264', 'av1'], 'h264');
  out.source = pick(out.source, ['screen', 'game'], 'screen');
  out.gameVol = num(out.gameVol, 0, 200, 100);
  out.micVol = num(out.micVol, 0, 200, 100);
  out.keys = (Array.isArray(out.keys) ? out.keys : DEFAULTS.keys)
    .map((k) => ({ key: normalizeKey(k && k.key), seconds: pick(Number(k && k.seconds), LENGTHS, 30) }))
    .filter((k) => k.key).slice(0, 6);
  for (const b of ['on', 'onlyInGame', 'game', 'mic', 'sound', 'toast']) out[b] = !!out[b];
  out.folder = typeof out.folder === 'string' ? out.folder : '';
  out.micId = typeof out.micId === 'string' ? out.micId : 'default';
  return out;
}

// How many seconds have to be kept: the longest keybind.
const keepSeconds = (c) => Math.max(10, ...complete(c).keys.map((k) => k.seconds));

/* ---------- keybinds ---------- */
// An Electron accelerator ("Alt+F9") from what the page captured, or '' when it is not usable as a
// global hotkey. A key alone is allowed for F1-F24 and a few spare keys (no letters or digits
// alone: those would stop working in every other app while clipping is on).
const MODS = ['Ctrl', 'Alt', 'Shift', 'Super'];
const ALONE = /^(F([1-9]|1[0-9]|2[0-4])|Insert|Home|End|PageUp|PageDown|Pause|Scrolllock|PrintScreen|num[0-9])$/i;
function normalizeKey(text) {
  const parts = String(text || '').split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return '';
  const alias = { control: 'Ctrl', ctrl: 'Ctrl', commandorcontrol: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift', super: 'Super', meta: 'Super', win: 'Super', windows: 'Super' };
  const mods = new Set(), keys = [];
  for (const p of parts) { const m = alias[p.toLowerCase()]; if (m) mods.add(m); else keys.push(p); }
  if (keys.length !== 1) return '';
  let key = keys[0];
  if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
  else if (/^f\d{1,2}$/i.test(key)) key = key.toUpperCase();
  else if (!/^([0-9]|F\d{1,2}|Insert|Delete|Home|End|PageUp|PageDown|Pause|Scrolllock|PrintScreen|Space|Tab|Backspace|Up|Down|Left|Right|num[0-9]|numadd|numsub|nummult|numdiv|numdec|Plus|-|=|\[|\]|;|'|,|\.|\/|\\|`)$/i.test(key)) return '';
  if (!mods.size && !ALONE.test(key)) return '';
  return [...MODS.filter((m) => mods.has(m)), key].join('+');
}

// Keybinds that clash with each other: the same key twice.
const clashes = (keys) => keys.filter((k, i) => keys.findIndex((x) => x.key.toLowerCase() === k.key.toLowerCase()) !== i).map((k) => k.key);

/* ---------- names ---------- */
const pad = (n) => String(n).padStart(2, '0');
// "Rocket League 2026-11-21 21-30-05.mp4", a number added when that file already exists
function clipName(dir, date = new Date(), ext = '.mp4') {
  const base = `Rocket League ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return unique(dir, base, ext);
}
function unique(dir, base, ext) {
  let name = `${base}${ext}`;
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${base} (${n})${ext}`;
  return name;
}
// A name typed by the user, made safe for a file name (no folders, no characters Windows refuses).
function cleanName(text) {
  return String(text || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 120);
}

/* ---------- the library ---------- */
// How long an MP4 file plays, read from its moov (at the start in clips OpenW writes); null if unknown.
function mp4Seconds(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(64);
    fs.readSync(fd, head, 0, 64, 0);
    let at = 0;
    for (let i = 0; i < 8; i++) {
      const b = Buffer.alloc(16);
      if (fs.readSync(fd, b, 0, 16, at) < 8) return null;
      let size = b.readUInt32BE(0); const type = b.toString('latin1', 4, 8);
      if (size === 1) size = Number(b.readBigUInt64BE(8));
      if (type === 'moov') {
        const moov = Buffer.alloc(Math.min(size, 8 << 20));
        fs.readSync(fd, moov, 0, moov.length, at);
        const mvhd = mp4.boxes(moov, 8, moov.length).find((x) => x.type === 'mvhd');
        if (!mvhd) return null;
        const v1 = moov[mvhd.body] === 1;
        const scale = moov.readUInt32BE(mvhd.body + (v1 ? 20 : 12));
        const dur = v1 ? Number(moov.readBigUInt64BE(mvhd.body + 24)) : moov.readUInt32BE(mvhd.body + 16);
        return scale && dur ? dur / scale : null; // 0 in a fragmented file: unknown
      }
      if (size < 8) return null;
      at += size;
    }
    return null;
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

// Where a clip's picture is kept: one small JPEG per clip file, in OpenW's data folder.
const thumbFile = (thumbs, file) => path.join(thumbs, `${crypto.createHash('sha1').update(path.resolve(file).toLowerCase()).digest('hex').slice(0, 16)}.jpg`);

// The clips in a folder, newest first: { file, name, size, mtime, seconds, thumb }.
function listClips(dir, thumbs) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => EXT.test(n)); } catch { return []; }
  return names.map((n) => {
    const file = path.join(dir, n);
    let st;
    try { st = fs.statSync(file); } catch { return null; }
    if (!st.isFile()) return null;
    const t = thumbFile(thumbs, file);
    return { file, name: n.replace(EXT, ''), ext: path.extname(n), size: st.size, mtime: st.mtimeMs, seconds: /\.mp4$/i.test(n) ? mp4Seconds(file) : null, thumb: fs.existsSync(t) ? t : null };
  }).filter(Boolean).sort((a, b) => b.mtime - a.mtime);
}

// A file in the clips folder, never one elsewhere (the page only ever names files from the list).
function inFolder(dir, file) {
  const f = path.resolve(String(file || '')), d = path.resolve(dir);
  if (path.dirname(f).toLowerCase() !== d.toLowerCase() || !EXT.test(f)) throw new Error('That clip is not in the clips folder.');
  if (!fs.existsSync(f)) throw new Error('That clip is gone.');
  return f;
}

// Rename a clip (and its picture). Returns the new path.
function renameClip(dir, thumbs, file, name) {
  const from = inFolder(dir, file);
  const clean = cleanName(name);
  if (!clean) throw new Error('Give the clip a name.');
  const to = path.join(dir, `${clean}${path.extname(from)}`);
  if (to.toLowerCase() === from.toLowerCase()) { fs.renameSync(from, to); return to; } // only the case changes
  if (fs.existsSync(to)) throw new Error('A clip with that name already exists.');
  fs.renameSync(from, to);
  const t = thumbFile(thumbs, from);
  if (fs.existsSync(t)) fs.renameSync(t, thumbFile(thumbs, to));
  return to;
}

// A copy of an MP4 clip with only [from, to] seconds, cut on keyframes (nothing re-encoded),
// saved next to it as "<name> (trimmed).mp4". Returns the new path.
function trimClip(dir, thumbs, file, from, to) {
  const src = inFolder(dir, file);
  if (!/\.mp4$/i.test(src)) throw new Error('Only MP4 clips can be trimmed.');
  if (!(to > from)) throw new Error('The end has to be after the start.');
  const model = mp4.fromFile(fs.readFileSync(src));
  const part = mp4.cut(model, Math.max(0, from), to);
  if (!mp4.duration(part)) throw new Error('Nothing is left between those times.');
  const out = path.join(dir, unique(dir, `${path.basename(src, path.extname(src))} (trimmed)`, '.mp4'));
  fs.writeFileSync(out, mp4.join(mp4.toFile(part)));
  const t = thumbFile(thumbs, src);
  if (fs.existsSync(t)) fs.copyFileSync(t, thumbFile(thumbs, out));
  return { file: out, start: part.start };
}

module.exports = { DEFAULTS, LENGTHS, complete, keepSeconds, normalizeKey, clashes, clipName, cleanName, unique, mp4Seconds, thumbFile, listClips, inFolder, renameClip, trimClip };
