const { app, BrowserWindow, ipcMain, dialog, shell, screen, protocol, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const game = require('./core/game');
const { Store } = require('./core/store');
const { Engine } = require('./core/engine');
const { buildCatalog, annotate } = require('./core/catalog');
const { readThumbnail } = require('./core/thumbs');
const mediaBridge = require('./media');
const upk = require('./core/upk');
const { Maps, MAP_SLOT } = require('./core/library');
const arenas = require('./core/arenas');
const mapbuild = require('./core/mapbuild');
const looks = require('./core/looks');
const { readLabels, readTexts, applyLabels } = require('./core/labels');
const T = require('../shared/transform');
const inputLib = require('./input');
const steamcfg = require('./core/steamcfg');
const { Updater } = require('./updater');
const { Clips } = require('./clips');
const cliplib = require('./core/cliplib');
// Steam's folder, from the registry (as Steam writes it), or the usual place
const steamDir = () => new Promise((resolve) => require('child_process').execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true }, (err, out) => {
  const m = !err && /SteamPath\s+REG_SZ\s+(.+)/i.exec(String(out));
  resolve(m ? path.normalize(m[1].trim()) : path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'));
}));

const DEFAULTS = {
  platform: null,
  installDir: null,

  theme: { mode: 'dark' },
  updates: { auto: true }, // download new versions from GitHub and install them
  presets: [],
  profile: { name: '', title: '', titleColor: '#00d8c8', glow: false, rank: '', avatar: '' },
  overlay: {
    onlyInGame: true, // show overlays only while Rocket League is the window in front
    pad: { on: false, model: 'auto', x: null, y: null, size: 100, opacity: 100, body: '#14161b', keys: '#23262d', glow: '#00d8c8' },
    music: { on: false, x: null, y: null, size: 100, source: 'auto' },
    card: { on: false, x: null, y: null, size: 100 }, // the Profile page's card, over the game
  },
  // OpenW Input: profiles of stick, trigger and button settings (src/shared/transform.js)
  // own: hide the real controller from games while OpenW Input runs (HidHide when it is there,
  // otherwise PlayStation controllers are opened for OpenW alone); autoHidden: what is hidden now
  input: { on: false, own: true, profile: 'standard', profiles: [{ ...T.TEMPLATES.standard(), id: 'standard' }], autoHidden: [] },
  clips: cliplib.DEFAULTS, // clipping: a hotkey saves the last seconds of the game (clips.js)
};

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const smokeShot = arg('smoke'); // --smoke=<png path>: render once, save a screenshot, quit
const smokeClips = !!smokeShot && process.argv.includes('--smoke-clips'); // test hook: clipping runs in a smoke run
if (arg('data')) app.setPath('userData', path.resolve(arg('data')));
else moveOldData();

// OpenW was called Boostpad. Its data folder (settings, the record of every change and the
// backups of the original game files) moves to the new name once, before anything reads it.
function moveOldData() {
  const old = path.join(app.getPath('appData'), 'boostpad');
  const now = app.getPath('userData');
  if (!fs.existsSync(old) || fs.existsSync(path.join(now, 'state.json')) || fs.existsSync(path.join(now, 'settings.json'))) return;
  try {
    if (fs.existsSync(now)) fs.cpSync(old, now, { recursive: true, force: false, errorOnExist: false });
    else fs.renameSync(old, now);
  } catch {
    // a file in use (another copy running): copy what can be copied, keep the old folder
    try { fs.cpSync(old, now, { recursive: true, force: false, errorOnExist: false }); } catch { /* starts fresh */ }
  }
}

let win = null, settings, engine, maps, catalog = null, arenaList = null, running = false, updater = null, clips = null;

// Errors go to openw.log in the data folder (the newest 200 KB), so a problem on someone's PC can be read.
function logError(where, e) {
  try {
    const file = path.join(app.getPath('userData'), 'openw.log');
    const line = `${new Date().toISOString()} v${app.getVersion()} ${where}: ${(e && e.stack) || e}\n`;
    if (fs.existsSync(file) && fs.statSync(file).size > 200000) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').slice(-100000));
    fs.appendFileSync(file, line);
  } catch { /* logging must never break anything */ }
}
process.on('uncaughtException', (e) => logError('uncaught', e));
process.on('unhandledRejection', (e) => logError('unhandled', e));
const input = new inputLib.Input();
// The controller overlay's live input. Chromium gives gamepad input only to the window in focus,
// and the overlay never has focus (the game does), so the overlay is fed by OpenW's input helper:
// OpenW Input's own while it runs, otherwise a second helper that only reads the controller.
const reader = new inputLib.Input();
let pageWatch = false; // the Controller page shows live input
const padFeedWanted = () => !smokeShot && !!(settings && settings.get('overlay').pad.on);
function sendPad(st, status) {
  const w = overlayWins.pad;
  if (w && !w.isDestroyed() && w.isVisible()) w.webContents.send('pad-state', { ...st, kind: status.pad ? status.pad.kind : null });
}
function syncPadFeed() {
  const want = padFeedWanted();
  if (input.running) {
    if (reader.running) reader.stop();
    input.watch(want || pageWatch);
  } else if (want && !reader.running) {
    try { reader.start(null, { read: true }); reader.watch(true); } catch (e) { logError('overlay reader', e); }
  } else if (!want && reader.running) reader.stop();
}

const ACCENT = '#00d8c8';
const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');
// Window colours per theme: page background and the colour of the minimise/maximise/close glyphs.
const CHROME = { dark: { bg: '#0e0f12', symbol: '#f1f2f4' }, light: { bg: '#e7e8ec', symbol: '#17181c' } };
const chrome = () => CHROME[settings.get('theme').mode] || CHROME.dark;
const titleBar = () => ({ color: '#00000000', symbolColor: chrome().symbol, height: 60 });
function applyChrome() {
  if (!win || win.isDestroyed()) return;
  win.setBackgroundColor(chrome().bg);
  win.setTitleBarOverlay(titleBar());
}

// Item pictures, served to the page as thumb://item/<file>. Each one is decoded
// from the game's own thumbnail package on first use and kept as a small JPEG.
const THUMB_SIZE = 192;
function thumbnail(file) {
  if (path.basename(file) !== file || !/_T_SF\.upk$/i.test(file) || !cooked()) return null;
  const dir = path.join(app.getPath('userData'), 'thumbs');
  const cached = path.join(dir, `${file.toLowerCase()}.jpg`);
  if (fs.existsSync(cached)) { const jpg = fs.readFileSync(cached); return jpg.length ? jpg : null; }
  fs.mkdirSync(dir, { recursive: true });
  let jpg = Buffer.alloc(0); // an empty file remembers "this one has no readable picture"
  try {
    const { width, height, bgra } = readThumbnail(cooked(), file, extraKeys);
    jpg = nativeImage.createFromBitmap(bgra, { width, height }).resize({ width: THUMB_SIZE, height: THUMB_SIZE, quality: 'best' }).toJPEG(86);
  } catch { /* unreadable package or unknown layout */ }
  fs.writeFileSync(cached, jpg);
  return jpg.length ? jpg : null;
}

// Decryption keys besides the long-published default one: the key list OpenW is built with
// (keys/keys.txt.gz, added by the release build from a secret, never in the repo) and the one the
// user has added (keys.txt in the data folder), for items newer than the built-in list.
let extraKeys = [], bundledKeys = 0;
const keysFile = () => path.join(app.getPath('userData'), 'keys.txt');
const BUNDLED_KEYS = path.join(__dirname, '..', '..', 'keys', 'keys.txt.gz');
function loadKeys() {
  const bundled = upk.readKeyFile(BUNDLED_KEYS);
  bundledKeys = bundled.length;
  extraKeys = [...new Set([...bundled, ...upk.readKeyFile(keysFile())])];
}
// Forget "no readable picture" answers, so they are tried again with the current keys.
function retryMissingThumbs() {
  const dir = path.join(app.getPath('userData'), 'thumbs');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    const file = path.join(dir, name);
    if (fs.statSync(file).size === 0) fs.rmSync(file, { force: true });
  }
}

const cooked = () => (settings.get('installDir') ? game.cookedDir(settings.get('installDir')) : null);

// Where the game finds each item's look (its item list), and which looks it has loaded before the
// item's own file is read (looks.js). Read once per game version and key list, kept in looks.json;
// forgotten when the folder or keys change and whenever the game closes (it may have updated).
let lookData = null;
function lookIndex() {
  const dir = cooked();
  if (!dir) return { products: {}, early: {} };
  if (lookData && lookData.dir === dir) return lookData;
  const stat = (f) => { try { const st = fs.statSync(engine.pristine(f)); return `${st.size}:${Math.round(st.mtimeMs)}`; } catch { return ''; } };
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => looks.EARLY.test(f) || looks.UNTOUCHABLE.test(f)).sort(); } catch { /* no folder */ }
  const sig = JSON.stringify([dir, extraKeys.length, ...names.map((f) => `${f}:${stat(f)}`)]);
  const store = new Store(path.join(app.getPath('userData'), 'looks.json'), {});
  if (store.get('sig') === sig && store.get('products')) {
    lookData = { dir, products: store.get('products'), early: store.get('early') || {} };
    return lookData;
  }
  let products = {}, early = {};
  try { products = looks.readProducts(dir, extraKeys); } catch (e) { logError('item list', e); }
  const want = new Set(Object.values(products).flat().map(([, p]) => p.toLowerCase()));
  try { early = looks.scanEarly(dir, want, extraKeys, (f) => engine.pristine(f)); } catch (e) { logError('early packages', e); }
  store.data = { sig, products, early };
  try { store.save(); } catch (e) { logError('looks.json', e); }
  lookData = { dir, products, early };
  return lookData;
}
const assetPathOf = (file) => looks.assetPath(lookIndex().products, file);

// Swapped items the game has loaded before their own file (defaults in Startup.upk and the main
// menu's scenes) need that early copy renamed, or the swap never shows. One 'hide' change per
// early package, worked out again from every swap that is on or queued; none is left behind.
async function syncHides() {
  if (!cooked()) return;
  const plan = looks.planHides(engine.list(), assetPathOf, lookIndex().early);
  for (const key of plan.unqueue) engine.unqueue(key);
  for (const key of plan.revert) await engine.revert(key);
  for (const op of plan.apply) await engine.apply(op);
}
const inputProfile = () => { const i = settings.get('input'); return T.complete(i.profiles.find((p) => p.id === i.profile) || i.profiles[0]); };
const saveInput = (patch) => settings.set('input', { ...settings.get('input'), ...patch });

// ---- OpenW Input: running the helper and hiding the real controller meanwhile ----
// With HidHide the real controller is hidden from every app but the helper while OpenW Input
// runs, and shown again when it stops or OpenW quits; no permission prompt. Without it,
// PlayStation controllers are opened for the helper alone (works only if nothing else has
// them open). Hiding and showing run one after another.
let hiding = Promise.resolve();
const queueHide = (fn) => (hiding = hiding.then(fn, fn));
const hideWanted = () => settings.get('input').own !== false;
let reconnect = []; // controllers HidHide cannot hide until they reconnect once
const inputStatus = () => ({
  ...input.status,
  hidden: ((settings.get('input').autoHidden || []).length > 0 && !reconnect.length) || !!(input.status.pad && input.status.pad.access === 'own'),
  reconnect,
});
const pushInputStatus = () => send('input-status', inputStatus());
async function hideNow() {
  if (!hideWanted() || !input.running || !inputLib.hasHidHide()) return;
  try {
    const res = await inputLib.hideControllers();
    if (res) {
      saveInput({ autoHidden: [...new Set([...(settings.get('input').autoHidden || []), ...res.paths])] });
      reconnect = res.reconnect;
    }
  } catch (e) { console.error(`hiding the controller: ${e.message}`); }
  pushInputStatus();
}
async function showNow() {
  const paths = settings.get('input').autoHidden || [];
  if (paths.length) {
    try { await inputLib.showControllers(paths); } catch (e) { console.error(`showing the controller: ${e.message}`); }
    saveInput({ autoHidden: [] });
  }
  reconnect = [];
  pushInputStatus();
}
async function startInput() {
  await reader.stop(); // the overlay's reader lets go of the controller first, so OpenW Input can take it
  input.start(inputProfile(), { own: hideWanted() && !inputLib.hasHidHide() });
  syncPadFeed();
  await queueHide(hideNow);
}
async function stopInput() {
  await input.stop();
  syncPadFeed();
  await queueHide(showNow);
}
const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

// Lists the items and checks which packages are readable. The check is remembered
// per file; the first run (or the first after adding keys) takes a few seconds, so
// it is done in slices to keep the window responsive.
let catalogJob = null;
async function buildIndex() {
  const dir = cooked(), keys = extraKeys;
  const built = buildCatalog(dir);
  if (!built.items.length) throw new Error(`No items were found in ${dir} (${built.fileCount} files there). This is not the folder Rocket League runs from: pick the "rocketleague" folder under Settings, Game.`);
  const index = new Store(path.join(app.getPath('userData'), 'index.json'), { dir: '', keys: 0, files: {} });
  const fresh = index.get('dir') === dir && index.get('keys') === keys.length;
  const files = fresh ? index.get('files') : {};
  if (!fresh) retryMissingThumbs();
  const swapped = new Set(engine.list().active.map((r) => r.key));
  for (let i = 0; i < built.items.length; i += 120) {
    annotate(dir, built.items.slice(i, i + 120), files, swapped, keys);
    await new Promise((resolve) => setImmediate(resolve));
  }
  index.data = { dir, keys: keys.length, files };
  index.save();
  // where the game finds each look, and items it loads before their own file (looks.js)
  const { products, early } = lookIndex();
  for (const item of built.items) {
    item.path = looks.assetPath(products, item.file);
    const hit = early[item.path.join('.').toLowerCase()];
    if (hit && hit.untouchable.length) item.stuck = hit.untouchable[0];
    else if (hit && hit.exports.length) item.early = hit.exports;
  }
  // real item names, from the game's own text file
  built.named = applyLabels(built.items, readLabels(dir, keys));
  built.items.sort((a, b) => a.label.localeCompare(b.label));
  if (dir === cooked() && keys === extraKeys) catalog = built; // nothing changed while we worked
}

const rlExe = () => { const dir = settings.get('installDir'); return dir ? path.join(dir, 'Binaries', 'Win64', 'RocketLeague.exe') : null; };

// Game files OpenW has changed, or will change when the game closes: file (lower case) -> op.
function arenaChanges() {
  const { active, queue } = engine.list();
  const out = new Map(active.map((r) => [r.key, r.op]));
  for (const q of queue) { if (q.type === 'apply') out.set(q.key, q.op); else out.delete(q.key); }
  return out;
}

const fileSize = (file) => { try { return fs.statSync(file).size; } catch { return 0; } };
// How big each arena file becomes with "same arena every match" on the chosen arena: its merge as built
// (or, while that is still queued, the map it is built from), or a copy of the file it loads.
function everyFileSize(chosen, list, changes) {
  const key = chosen.file.toLowerCase(), op = changes.get(key);
  if (op && op.kind === 'build' && op.group !== 'everymatch') {
    const rec = engine.list().active.find((r) => r.key === key);
    return rec && rec.op === op ? rec.written.size : fileSize(engine.pristine(op.from));
  }
  return fileSize(engine.pristine(arenas.effectiveArena(chosen, list, changes).file));
}
// The every-match ops for an arena, under the name of its merge if it has one. An arena whose
// file OpenW cannot open (it needs a key list) cannot be written over, so it keeps its own look
// (skipped); locked: files of the chosen arena itself that cannot be opened.
function everyPlan(chosen, list, changes) {
  const merge = arenas.mergedArenas(list, changes).find((m) => m.arena.id === chosen.id);
  const all = arenas.everyMatchOps(chosen, list, changes, merge ? merge.label : chosen.name);
  const blocked = (op) => arenas.lockedFiles(list, [op.gameFile]).length > 0;
  const source = all[0] ? [all[0].from, all[0].sourceGameFile] : [];
  return {
    ops: all.filter((op) => !blocked(op)),
    skipped: all.filter(blocked).map((op) => (list.find((a) => a.file.toLowerCase() === op.gameFile.toLowerCase()) || { name: op.gameFile }).name),
    locked: arenas.lockedFiles(list, [chosen.file, arenas.effectiveArena(chosen, list, changes).file, ...source]),
  };
}
const everyOpsFor = (chosen, list, changes) => everyPlan(chosen, list, changes).ops;
// Every match is out of date when a merge was made, changed or reverted since it was turned on.
function everyMatchStale(list, changes) {
  const on = [...changes.values()].filter((op) => op.group === 'everymatch');
  const chosen = on.length && list.find((a) => a.id === on[0].chosen);
  return !!chosen && !arenas.sameEveryMatch(on, everyOpsFor(chosen, list, changes));
}

function snapshot() {
  const dir = settings.get('installDir');
  return {
    version: app.getVersion(),
    update: updater ? updater.state : null,
    settings: settings.data,
    install: { platform: settings.get('platform'), dir, valid: !!dir && game.isValidInstall(dir) },
    running,
    engine: engine.list(),
    mapSlot: MAP_SLOT,
    keys: extraKeys.length,
    bundledKeys,
    userKeys: fs.existsSync(keysFile()), // a key list the user added
    overlayMove: overlayEdit,
  };
}

async function pick(options) {
  const res = await dialog.showOpenDialog(win, options);
  return res.canceled ? [] : res.filePaths;
}

// ---- overlays: click-through windows drawn over the game ----
// Two of them: the controller ("pad") and the now-playing pill ("music"). Each has
// its own position, size and look in settings.overlay, and is shown only while
// Rocket League is the window in front (unless that option is off, or the user is
// previewing or moving them).
const OVERLAYS = {
  pad: { page: 'overlay.html', width: 420, height: 360 },
  music: { page: 'nowplaying.html', width: 400, height: 70 },
  card: { page: 'card.html', width: 380, height: 110 },
};
const ANCHORS = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'];
const DEFAULT_ANCHOR = { pad: 'br', music: 'tc', card: 'tl' };
const overlayWins = {};
let overlayEdit = false, previewUntil = 0, previewTimer = null;
let foreground = ''; // process name of the window in front, '' when unknown

const inGame = () => (foreground ? /^RocketLeague/i.test(foreground) : running);
const overlaySize = (kind) => {
  const scale = settings.get('overlay')[kind].size / 100;
  return { width: Math.round(OVERLAYS[kind].width * scale), height: Math.round(OVERLAYS[kind].height * scale) };
};
function anchorPosition(kind, anchor) {
  const area = screen.getPrimaryDisplay().bounds, { width, height } = overlaySize(kind), gap = 16;
  const x = anchor[1] === 'l' ? area.x + gap : anchor[1] === 'r' ? area.x + area.width - width - gap : area.x + Math.round((area.width - width) / 2);
  const y = anchor[0] === 't' ? area.y + gap : area.y + area.height - height - gap;
  return { x, y };
}
function overlayPayload(kind) {
  return { ...settings.get('overlay')[kind], edit: overlayEdit, ...(kind === 'card' ? { profile: settings.get('profile') } : {}) };
}
function overlayShown(kind) {
  const o = settings.get('overlay');
  return o[kind].on && (overlayEdit || Date.now() < previewUntil || !o.onlyInGame || inGame());
}
function syncOverlays() {
  const o = settings.get('overlay');
  for (const kind of Object.keys(OVERLAYS)) {
    const cfg = o[kind];
    let w = overlayWins[kind];
    if (!cfg.on) { if (w && !w.isDestroyed()) w.destroy(); delete overlayWins[kind]; continue; }
    const size = overlaySize(kind);
    const at = cfg.x == null || cfg.y == null ? anchorPosition(kind, DEFAULT_ANCHOR[kind]) : { x: cfg.x, y: cfg.y };
    if (!w || w.isDestroyed()) {
      w = overlayWins[kind] = new BrowserWindow({
        ...size, ...at, frame: false, transparent: true, resizable: false, skipTaskbar: true, focusable: false, show: false, hasShadow: false, icon: ICON,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
      });
      w.setAlwaysOnTop(true, 'screen-saver');
      w.loadFile(path.join(__dirname, '../renderer', OVERLAYS[kind].page));
      // dragged to a new place while "Move overlays" is on: remember it
      w.on('moved', () => {
        if (!overlayEdit || w.isDestroyed()) return;
        const [x, y] = w.getPosition();
        const next = settings.get('overlay');
        next[kind] = { ...next[kind], x, y };
        settings.set('overlay', next);
        send('state', { state: snapshot(), flushed: [] });
      });
    }
    const b = w.getBounds();
    if (b.width !== size.width || b.height !== size.height || b.x !== at.x || b.y !== at.y) w.setBounds({ ...at, ...size });
    w.setIgnoreMouseEvents(!overlayEdit);
    w.setFocusable(overlayEdit);
    w.webContents.send('overlay-config', overlayPayload(kind));
    if (overlayShown(kind)) { if (!w.isVisible()) w.showInactive(); } else if (w.isVisible()) w.hide();
  }
}

// What is playing, read from Windows' media controls (any app that shows up there).
// (test hook: --fake-media gives test runs a made-up track, so the pages can be screenshotted)
let mediaState = smokeShot && process.argv.includes('--fake-media')
  ? { found: true, app: 'Spotify.exe', source: 'Spotify', title: 'Example Track', artist: 'Example Artist', album: 'Example Album', playing: true, position: 62, duration: 201, updated: Date.now(), art: '' }
  : { found: false };
let mediaWatcher = null;
function startMedia() {
  if (mediaWatcher) mediaWatcher.stop();
  mediaWatcher = mediaBridge.watch({
    source: settings.get('overlay').music.source,
    onState(state) {
      mediaState = state;
      send('media', state);
      const w = overlayWins.music;
      if (w && !w.isDestroyed()) w.webContents.send('media', state);
    },
    onForeground(name) { foreground = name; syncOverlays(); },
  });
}

// Everything the UI can ask for. Each method returns plain JSON.
const api = {
  getState: () => snapshot(),
  detectGame: () => game.detect(),

  // updates from GitHub Releases (updater.js)
  async updateCheck() { await updater.check({ download: true }); return snapshot(); },
  async updateInstall() {
    // OpenW closes only once the setup really runs; refused permission leaves it open, saying so
    if (await updater.install()) setTimeout(() => { installOnQuit = false; app.quit(); }, 300);
    return snapshot();
  },

  setInstall(platform, dir) {
    if (!game.isValidInstall(dir)) throw new Error(game.whyNotInstall(dir));
    settings.set('platform', platform);
    settings.set('installDir', dir);
    catalog = null;
    arenaList = null;
    lookData = null;
    return snapshot();
  },
  async browseInstall(platform) {
    const [dir] = await pick({ title: 'Select the rocketleague folder', properties: ['openDirectory'] });
    return dir ? api.setInstall(platform, dir) : snapshot();
  },
  setSetting(key, value) {
    if (!(key in DEFAULTS)) throw new Error(`Unknown setting ${key}`);
    settings.set(key, value);
    if (key === 'overlay') {
      syncOverlays();
      syncPadFeed();
      if (value.music.source !== (mediaWatcher && mediaWatcher.source)) startMedia(); // follow a different app
    }
    if (key === 'theme') applyChrome();
    if (key === 'profile') syncOverlays(); // the card over the game shows the change
    if (key === 'clips') { settings.set('clips', cliplib.complete(value)); if (clips && (!smokeShot || smokeClips)) clips.sync(); }
    return snapshot();
  },

  async getCatalog() {
    if (!catalog) {
      catalogJob ??= buildIndex().finally(() => { catalogJob = null; });
      await catalogJob;
      if (!catalog) { catalogJob ??= buildIndex().finally(() => { catalogJob = null; }); await catalogJob; } // the folder or keys changed meanwhile
      if (!catalog) throw new Error('The item list could not be built. Try again.');
    }
    return catalog;
  },

  checkSwap: (op) => engine.checkSwap(op),
  async apply(op) {
    const res = await engine.apply(op);
    if (op.kind === 'swap') await syncHides();
    return { ...res, state: snapshot() };
  },
  async revert(key) { await engine.revert(key); await syncHides(); return snapshot(); },
  async revertAll() { await engine.revertAll(); return snapshot(); },
  async unqueue(key) { engine.unqueue(key); await syncHides(); return snapshot(); },

  mapsList: () => maps.list(),
  async mapsAdd() {
    const files = await pick({ title: 'Add workshop map files', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Maps', extensions: ['upk', 'udk'] }] });
    maps.add(files);
    return maps.list();
  },
  mapsRemove(id) { maps.remove(id); return maps.list(); },
  mapsLoad: (id) => api.apply(maps.op(id)),

  // Map Merge: arenas and the part files they load
  arenas() {
    if (!arenaList) {
      const cache = new Store(path.join(app.getPath('userData'), 'arenas.json'), { dir: '', keys: 0, files: {} });
      const files = cache.get('dir') === cooked() && cache.get('keys') === extraKeys.length ? cache.get('files') : {};
      arenaList = arenas.scanArenas(cooked(), files, extraKeys, readTexts(cooked(), extraKeys).maps, (f) => engine.pristine(f));
      cache.data = { dir: cooked(), keys: extraKeys.length, files };
      cache.save();
    }
    return arenaList;
  },
  // The arenas for "same arena every match" and "add snow": merged arenas first, under
  // the name of their merge, then the rest. Snow options say how the snow is made.
  arenaChoices() {
    const list = api.arenas(), changes = arenaChanges();
    const merged = arenas.mergedArenas(list, changes);
    const mergedIds = new Set(merged.map((m) => m.arena.id));
    const all = [...merged.map((m) => ({ arena: m.arena, label: m.label, merged: true })),
      ...list.filter((a) => !mergedIds.has(a.id)).map((a) => ({ arena: a, label: a.name, merged: false }))];
    // per arena: how many files every match replaces, and the disk space those take (the
    // originals are kept as backups, so that is what it adds)
    const every = all.filter((c) => c.arena.standard).map((c) => {
      const plan = everyPlan(c.arena, list, changes), files = plan.ops.length;
      const size = plan.locked.length ? 0 : everyFileSize(c.arena, list, changes);
      return { id: c.arena.id, label: c.label, merged: c.merged, files, bytes: files * size, skipped: plan.skipped, locked: arenas.lockedMessage(plan.locked) };
    });
    const snow = [], noSnow = [];
    for (const c of all.filter((x) => x.arena.playable)) {
      const plan = arenas.snowPlan(c.arena, list, changes);
      const locked = plan ? arenas.lockedMessage(arenas.lockedFor(list, [c.arena], [plan.op])) : '';
      if (plan) snow.push({ id: c.arena.id, label: c.label, merged: c.merged, how: plan.how, snowy: plan.snowy, play: plan.play.map((a) => a.name), locked });
      else if (c.merged) noSnow.push(c.label);
    }
    return { every, everyStale: everyMatchStale(list, changes), snow, noSnow };
  },
  // Same arena every match: one copy per standard arena, applied (or queued) one by one.
  async everyMatch(id) {
    const list = api.arenas(), chosen = list.find((a) => a.id === id);
    if (!chosen) throw new Error('Arena not found');
    const changes = arenaChanges();
    const { ops, skipped, locked } = everyPlan(chosen, list, changes);
    if (locked.length) throw new Error(arenas.lockedMessage(locked));
    // an arena chosen before: files the new choice does not write go back, so none keeps the old
    // one; the others are written over (their backup stays the original)
    for (const q of engine.list().queue) if (q.op && q.op.group === 'everymatch') engine.unqueue(q.key);
    for (const rec of engine.list().active) if (rec.op.group === 'everymatch' && !ops.some((o) => o.gameFile.toLowerCase() === rec.key)) await engine.revert(rec.key);
    let queued = false;
    for (const [i, op] of ops.entries()) {
      queued = (await engine.apply(op)).queued || queued;
      send('progress', { what: 'every', done: i + 1, total: ops.length });
    }
    return { queued, skipped, state: snapshot() };
  },
  async everyMatchOff() {
    for (const q of engine.list().queue) if (q.op && q.op.group === 'everymatch') engine.unqueue(q.key);
    for (const rec of engine.list().active) if (rec.op.group === 'everymatch') await engine.revert(rec.key);
    return snapshot();
  },
  // How a merge would be done, for the page to describe before anything is written.
  mergePlan(stadiumId, placeId) {
    const list = api.arenas(), find = (id) => list.find((a) => a.id === id);
    const stadium = find(stadiumId), place = find(placeId);
    const plan = arenas.mergePlan(stadium, place, list);
    // files it would have to read that the keys OpenW has cannot open: said before Merge is pressed
    const locked = plan.how === 'none' ? [] : arenas.lockedFor(list, [stadium, place], plan.ops);
    return { how: plan.how, reason: plan.reason, note: plan.note, files: plan.ops ? plan.ops.length : 0, play: (plan.play || []).map((a) => a.name), locked, lockedText: arenas.lockedMessage(locked) };
  },
  async mergeArenas(stadiumId, placeId) {
    const list = api.arenas(), find = (id) => list.find((a) => a.id === id);
    const stadium = find(stadiumId), place = find(placeId);
    if (!stadium || !place) throw new Error('Arena not found');
    // nothing is written when a file it needs cannot be opened, so no half merge is left behind
    const first = arenas.mergePlan(stadium, place, list);
    if (first.how !== 'none') {
      const locked = arenas.lockedFor(list, [stadium, place], first.ops);
      if (locked.length) throw new Error(arenas.lockedMessage(locked));
    }
    // read both maps: where each stadium is, and which of the stadium arena's parts hold none of it
    const opened = new Map();
    const open = (file) => {
      const key = file.toLowerCase();
      if (!opened.has(key)) {
        let pkg = null;
        try { pkg = mapbuild.open(fs.readFileSync(engine.pristine(file)), extraKeys); } catch { /* unreadable: left out */ }
        opened.set(key, pkg);
      }
      return opened.get(key);
    };
    const info = arenas.mergeInfo(stadium, place, open, mapbuild);
    opened.clear();
    const plan = arenas.mergePlan(stadium, place, list, info);
    if (plan.how === 'none') throw new Error(plan.reason);
    const locked = arenas.lockedFor(list, [stadium, place], plan.ops);
    if (locked.length) throw new Error(arenas.lockedMessage(locked));
    // a merge made before for this pair goes first, so no file of the old one stays
    for (const rec of engine.list().active) if (rec.op.group === plan.ops[0].group && !plan.ops.some((o) => o.gameFile.toLowerCase() === rec.key)) await engine.revert(rec.key);
    let queued = false;
    for (const op of plan.ops) queued = (await engine.apply(op)).queued || queued;
    return { queued, play: plan.play.map((a) => a.name), state: snapshot() };
  },
  // Undo every file of one merge (they share a group).
  async revertGroup(group) {
    for (const q of engine.list().queue) if (q.op && q.op.group === group) engine.unqueue(q.key);
    for (const rec of engine.list().active) if (rec.op.group === group) await engine.revert(rec.key);
    return snapshot();
  },
  snowArena(id) {
    const list = api.arenas(), arena = list.find((a) => a.id === id);
    if (!arena) throw new Error('Arena not found');
    const plan = arenas.snowPlan(arena, list, arenaChanges());
    if (!plan) throw new Error('This arena has no file where snow can go');
    const locked = arenas.lockedFor(list, [arena], [plan.op]);
    if (locked.length) throw new Error(arenas.lockedMessage(locked));
    return api.apply(plan.op);
  },


  presetSave(name) {
    const ops = engine.list().active.map((r) => r.op).filter((op) => op.kind !== 'hide'); // worked out again on load
    if (!ops.length) throw new Error('Nothing is active yet. Apply something first.');
    const presets = settings.get('presets');
    presets.push({ id: Date.now().toString(36), name: String(name).slice(0, 40) || 'My setup', ops, savedAt: Date.now() });
    settings.set('presets', presets);
    return snapshot();
  },
  async presetLoad(id) {
    const preset = settings.get('presets').find((p) => p.id === id);
    if (!preset) throw new Error('Preset not found');
    await engine.revertAll();
    const errors = [];
    for (const op of preset.ops.filter((o) => o.kind !== 'hide')) {
      try { await engine.apply(op); } catch (e) { errors.push(`${op.label || op.gameFile || op.sourceFile}: ${e.message}`); }
    }
    try { await syncHides(); } catch (e) { errors.push(e.message); }
    return { errors, state: snapshot() };
  },
  presetDelete(id) {
    settings.set('presets', settings.get('presets').filter((p) => p.id !== id));
    return snapshot();
  },
  presetExport(id) {
    const p = settings.get('presets').find((x) => x.id === id);
    // only swaps are portable: file ops point at paths on this PC
    return JSON.stringify({ openwPreset: 1, name: p.name, ops: p.ops.filter((o) => o.kind === 'swap') });
  },
  presetImport(text) {
    const data = JSON.parse(text);
    if ((data.openwPreset ?? data.boostpadPreset) !== 1 || !Array.isArray(data.ops)) throw new Error('Not an OpenW preset');
    const ops = data.ops.filter((o) => o.kind === 'swap' && typeof o.sourceFile === 'string' && typeof o.targetFile === 'string')
      .map((o) => ({ kind: 'swap', sourceFile: path.basename(o.sourceFile), targetFile: path.basename(o.targetFile), label: String(o.label || ''), category: String(o.category || '') }));
    const presets = settings.get('presets');
    presets.push({ id: Date.now().toString(36), name: String(data.name || 'Imported').slice(0, 40), ops, savedAt: Date.now() });
    settings.set('presets', presets);
    return snapshot();
  },

  mediaState: () => mediaState,
  mediaSources: () => mediaBridge.SOURCES.map(({ id, name }) => ({ id, name })),
  mediaControl(action) { mediaBridge.control(action, settings.get('overlay').music.source); },
  async pickAvatar() {
    const [file] = await pick({ title: 'Choose a picture', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (!file) return null;
    if (fs.statSync(file).size > 400 * 1024) throw new Error('Picture must be under 400 KB');
    const ext = path.extname(file).slice(1).replace('jpg', 'jpeg');
    return `data:image/${ext};base64,${fs.readFileSync(file).toString('base64')}`;
  },

  launchGame() {
    shell.openExternal(game.launchUrl(settings.get('platform')));
    return { ok: true };
  },
  openDataFolder() { shell.openPath(app.getPath('userData')); },

  // ---- OpenW Input: the controller remapper ----
  async inputInfo() { return { status: inputStatus(), drivers: await inputLib.drivers() }; },
  // both resolve once the helper has really started or stopped, so the switch does not bounce
  async inputStart() { await startInput(); saveInput({ on: true }); return snapshot(); },
  async inputStop() { await stopInput(); saveInput({ on: false }); return snapshot(); },
  async inputOwn(on) {
    saveInput({ own: !!on });
    if (input.running) {
      if (inputLib.hasHidHide()) await queueHide(on ? hideNow : showNow);
      else input.own(!!on);
    }
    return snapshot();
  },
  inputReopen() { input.reopen(); },
  // Steam Input layouts on this PC, newest first, to copy into an OpenW profile
  async inputSteamLayouts() {
    const dir = await steamDir();
    return steamcfg.findLayouts(dir).map(({ app: name, controller, file, modified }) => ({ name, controller, file, modified }));
  },
  async inputImportSteam(file) {
    const dir = await steamDir();
    const layout = steamcfg.findLayouts(dir).find((l) => l.file === file);
    if (!layout) throw new Error('That Steam layout is gone.');
    const { profile, skipped } = steamcfg.importLayout(layout.file, T, { name: `${layout.app} (Steam)`.slice(0, 40), light: steamcfg.steamLightbar(dir) });
    const p = T.complete({ ...profile, id: Date.now().toString(36), from: 'steam' });
    saveInput({ profiles: [...settings.get('input').profiles, p], profile: p.id });
    if (input.running) input.configure(inputProfile());
    return { state: snapshot(), skipped };
  },
  inputWatch(on) { pageWatch = !!on; input.watch(pageWatch || padFeedWanted()); },
  // a setting changed: saved, and the helper gets it at once
  inputSave(profile) {
    const p = T.complete(profile), i = settings.get('input');
    if (!i.profiles.some((x) => x.id === p.id)) throw new Error('That profile is gone.');
    saveInput({ profiles: i.profiles.map((x) => (x.id === p.id ? p : x)) });
    if (p.id === i.profile && input.running) input.configure(p);
    return true;
  },
  // while a slider moves: the helper gets it, nothing is saved yet
  inputPreview(profile) { if (input.running && profile.id === settings.get('input').profile) input.configure(T.complete(profile)); },
  inputSelect(id) {
    if (!settings.get('input').profiles.some((x) => x.id === id)) throw new Error('That profile is gone.');
    saveInput({ profile: id });
    if (input.running) input.configure(inputProfile());
    return snapshot();
  },
  inputNew(template, from) {
    const i = settings.get('input');
    const base = from ? i.profiles.find((x) => x.id === from) : null;
    const p = base ? { ...structuredClone(base), name: `${base.name} copy`.slice(0, 40) } : (T.TEMPLATES[template] || T.TEMPLATES.standard)();
    p.id = Date.now().toString(36);
    saveInput({ profiles: [...i.profiles, T.complete(p)], profile: p.id });
    if (input.running) input.configure(inputProfile());
    return snapshot();
  },
  inputRename(id, name) {
    const clean = String(name || '').trim().slice(0, 40);
    if (!clean) throw new Error('Give the profile a name.');
    saveInput({ profiles: settings.get('input').profiles.map((x) => (x.id === id ? { ...x, name: clean } : x)) });
    return snapshot();
  },
  inputDelete(id) {
    const i = settings.get('input');
    if (i.profiles.length < 2) throw new Error('Keep at least one profile.');
    const profiles = i.profiles.filter((x) => x.id !== id);
    saveInput({ profiles, profile: i.profile === id ? profiles[0].id : i.profile });
    if (input.running) input.configure(inputProfile());
    return snapshot();
  },
  inputExport(id) {
    const p = settings.get('input').profiles.find((x) => x.id === id);
    const { id: _drop, ...rest } = p;
    return Buffer.from(JSON.stringify({ openwInput: 1, profile: rest })).toString('base64');
  },
  inputImport(code) {
    let data;
    try { data = JSON.parse(Buffer.from(String(code).trim(), 'base64').toString('utf8')); } catch { data = null; }
    if (!data || data.openwInput !== 1 || !data.profile) throw new Error('Not an OpenW Input profile code.');
    const p = T.complete({ ...data.profile, id: Date.now().toString(36) });
    saveInput({ profiles: [...settings.get('input').profiles, p], profile: p.id });
    if (input.running) input.configure(inputProfile());
    return snapshot();
  },
  // install the drivers OpenW comes with; a running helper starts again to use them
  async inputInstallDrivers(list) {
    const want = Array.isArray(list) ? list : ['vigem'];
    const results = await inputLib.installDrivers(want);
    if (input.running) {
      await stopInput();
      await startInput();
    }
    return { results, info: { status: inputStatus(), drivers: await inputLib.drivers() }, state: snapshot() };
  },

  async importKeys() {
    const [file] = await pick({ title: 'Choose a key list (keys.txt)', properties: ['openFile'], filters: [{ name: 'Key list', extensions: ['txt'] }] });
    if (!file) return snapshot();
    const text = fs.readFileSync(file, 'utf8');
    if (!upk.parseKeys(text).length) throw new Error('No keys found in that file. Expected one key per line (64 hex characters or base64).');
    fs.writeFileSync(keysFile(), text);
    return api.reloadKeys();
  },
  removeKeys() {
    fs.rmSync(keysFile(), { force: true });
    return api.reloadKeys();
  },
  reloadKeys() {
    loadKeys();
    retryMissingThumbs();
    catalog = null;
    arenaList = null; // arenas the old keys could not open (and their parts) are read again
    lookData = null;
    return snapshot();
  },
  overlayConfig: (kind) => overlayPayload(kind),

  // ---- clipping (clips.js) ----
  clipsInfo: () => ({ status: clips.statusView(), list: clips.list() }),
  async clipSaveNow(seconds) { return clips.save(seconds); },
  clipRename: (file, name) => clips.rename(file, name),
  clipDelete: (file) => clips.remove(file),
  clipReveal: (file) => clips.reveal(file),
  clipOpenFolder: () => clips.openFolder(),
  clipTrim: (file, from, to) => clips.trim(file, from, to),
  clipPicture: (file, dataUrl) => clips.picture(file, dataUrl),
  clipKey: (text) => cliplib.normalizeKey(text), // '' when it cannot be a global hotkey
  // while the page waits for a new hotkey, the old ones do not fire
  clipKeysPaused(on) { clips.registerKeys(!on && clips.wanted()); return clips.statusView(); },
  async clipPickFolder() {
    const dir = await clips.pickFolder(win);
    if (dir) api.setSetting('clips', { ...settings.get('clips'), folder: dir });
    return snapshot();
  },
  // from the recorder window
  clipReady: () => clips.recorderReady(),
  clipStatus: (msg) => clips.recorderStatus(msg || {}),
  clipWrite: (id, bytes, picture, error) => clips.write(id, bytes, picture, error),
  // let the user drag the overlays to where they want them
  overlayMove(on) { overlayEdit = !!on; syncOverlays(); return snapshot(); },
  overlayPreview() {
    previewUntil = Date.now() + 8000;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(syncOverlays, 8100);
    syncOverlays();
  },
  overlayAnchor(kind, anchor) {
    if (!OVERLAYS[kind] || !(ANCHORS.includes(anchor) || anchor === 'reset')) throw new Error('Unknown position');
    const next = settings.get('overlay');
    next[kind] = { ...next[kind], ...(anchor === 'reset' ? { x: null, y: null } : anchorPosition(kind, anchor)) };
    settings.set('overlay', next);
    syncOverlays();
    return snapshot();
  },
};

// Swaps written by a version before 0.4.10 are built again the way the game reads them, and items
// the game loads early get their early copy renamed (syncHides). While the game is closed only.
// Returns a line for the page, or ''.
async function upgradeSwaps() {
  const hidden = () => engine.list().active.filter((r) => r.op.kind === 'hide').length;
  const before = hidden();
  let rebuilt = [];
  try { rebuilt = engine.rebuildSwaps(); } catch (e) { logError('rebuild swaps', e); }
  try { await syncHides(); } catch (e) { logError('hide', e); }
  if (!rebuilt.length && hidden() === before) return '';
  return `Item swaps updated so they show in game${rebuilt.length ? `: ${rebuilt.join(', ')}` : ''}.`;
}

async function poll() {
  const now = await game.isRunning();
  if (now === running) return;
  running = now;
  syncOverlays();
  if (clips) clips.setGameRunning(running);
  let flushed = [], notice = '';
  if (!running) {
    lookData = null; // the game may have been updated
    flushed = await engine.flushQueue((done, total) => send('progress', { what: 'queue', done, total }));
    // anything an older version wrote with the wrong key is rebuilt as soon as the game closes
    const repaired = engine.repairKeys();
    if (repaired.length) notice = `Rebuilt ${repaired.length === 1 ? 'a change' : `${repaired.length} changes`} that an earlier version wrote incorrectly: ${repaired.join(', ')}.`;
    notice = [notice, await upgradeSwaps()].filter(Boolean).join(' ');
  }
  send('state', { state: snapshot(), flushed, notice });
}

protocol.registerSchemesAsPrivileged([{ scheme: 'thumb', privileges: { standard: true, secure: true } }]);
app.setAppUserModelId('io.github.openw'); // own taskbar identity and icon on Windows

app.whenReady().then(async () => {
  const data = app.getPath('userData');
  settings = new Store(path.join(data, 'settings.json'), DEFAULTS);
  engine = new Engine({
    store: new Store(path.join(data, 'state.json')),
    backupDir: path.join(data, 'backups'),
    getCookedDir: cooked,
    isRunning: game.isRunning,
    getKeys: () => extraKeys,
    getAssetPath: (file) => assetPathOf(file),
  });
  loadKeys();
  maps = new Maps(path.join(data, 'maps'));
  settings.set('clips', cliplib.complete(settings.get('clips')));
  clips = new Clips({
    settings, userData: data, videos: app.getPath('videos'), preload: path.join(__dirname, 'preload.js'), renderer: path.join(__dirname, '../renderer'), icon: ICON,
    isGameRunning: () => running, notify: (payload) => send('clips', payload), log: logError,
  });
  updater = new Updater({ current: app.getVersion(), dir: path.join(data, 'updates') });
  updater.on('change', () => send('state', { state: snapshot(), flushed: [] }));
  delete settings.data.steamInput; // the old Steam Input route is gone
  // profiles from before OpenW used Steam's units are converted once
  if (settings.get('input').profiles.some((x) => x.units !== 'steam')) saveInput({ profiles: settings.get('input').profiles.map((x) => T.complete(x)) });
  input.on('status', (st) => {
    pushInputStatus();
    if (st.running && st.pad) queueHide(hideNow); // a controller plugged in while running
  });
  input.on('state', (st) => { send('input-state', st); sendPad(st, input.status); });
  reader.on('state', (st) => sendPad(st, reader.status));
  input.on('status', (st) => { if (!st.running) syncPadFeed(); }); // OpenW Input stopped on its own: the reader takes over
  // anything left hidden by an earlier run (or by 0.3's hide list) is shown again first
  const leftover = [...(settings.get('input').autoHidden || []), ...(settings.get('input').hidden || [])];
  if (leftover.length && !smokeShot) {
    saveInput({ autoHidden: leftover, hidden: undefined });
    queueHide(showNow);
  }
  if (settings.get('input').on && !smokeShot) {
    startInput().catch((e) => console.error(e.message)); // its hiding queues after the leftover above
  }
  // settings from an older version: bring the overlay options into the current shape
  let saved = settings.get('overlay');
  if (saved.pad && saved.music && !saved.card) saved = settings.set('overlay', { ...saved, card: { ...DEFAULTS.overlay.card } }); // 0.4.10 added the card
  if (!saved.pad || !saved.music) {
    settings.set('overlay', { ...DEFAULTS.overlay, pad: { ...DEFAULTS.overlay.pad, on: !!saved.controller }, music: { ...DEFAULTS.overlay.music, on: !!saved.nowPlaying } });
  } else if (saved.pad.body === '#f2f3f5' && saved.pad.keys === '#1b1c21') {
    // the old drawn controller's default colours: use the new default (midnight black)
    settings.set('overlay', { ...saved, pad: { ...saved.pad, body: DEFAULTS.overlay.pad.body, keys: DEFAULTS.overlay.pad.keys, model: saved.pad.model || 'auto' } });
  }
  // a folder set before that holds no game (an old install left behind, an old launcher record):
  // the real one is looked for again, the running game's own folder first
  if (settings.get('installDir') && !game.isValidInstall(settings.get('installDir'))) {
    const was = settings.get('installDir');
    try {
      const found = await game.detect();
      const platform = found[settings.get('platform')] ? settings.get('platform') : found.epic ? 'epic' : found.steam ? 'steam' : null;
      if (platform) {
        settings.set('platform', platform);
        settings.set('installDir', found[platform]);
        logError('install', `${was} holds no game; using ${found[platform]} instead`);
      } else logError('install', `${was} holds no game and no other install was found: ${game.whyNotInstall(was)}`);
    } catch (e) { logError('install', e); }
  }
  const installed = cooked() && game.isValidInstall(settings.get('installDir'));
  if (installed) engine.reconcile();
  running = await game.isRunning();
  // swaps written by an older version with the wrong key crash the game: rebuild them
  const repaired = installed && !running && !smokeShot ? engine.repairKeys() : [];
  // swaps from before 0.4.10 are brought up to date (while the game runs, only queued)
  let upgraded = '';
  if (installed && !smokeShot) {
    if (!running) upgraded = await upgradeSwaps();
    else syncHides().catch((e) => logError('hide', e));
  }

  protocol.handle('thumb', (request) => {
    let jpg = null;
    try { jpg = thumbnail(decodeURIComponent(new URL(request.url).pathname.slice(1))); } catch { /* answered as missing */ }
    return jpg
      ? new Response(jpg, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=31536000, immutable' } })
      : new Response('', { status: 404 });
  });

  ipcMain.handle('api', async (_e, method, ...args) => {
    if (!Object.hasOwn(api, method)) throw new Error(`Unknown method ${method}`);
    try { return await api[method](...args); } catch (e) { logError(method, e); throw e; }
  });

  win = new BrowserWindow({
    width: 1320, height: 840, minWidth: 1000, minHeight: 660, backgroundColor: chrome().bg, show: !smokeShot,
    autoHideMenuBar: true, title: 'OpenW', icon: ICON,
    // custom title bar: the page draws the bar, Windows draws only the three buttons
    titleBarStyle: 'hidden', titleBarOverlay: titleBar(),
    // test runs render offscreen, which keeps animations running so the screenshot is truthful
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, offscreen: !!smokeShot },
  });
  win.on('closed', () => {
    for (const w of Object.values(overlayWins)) if (w && !w.isDestroyed()) w.destroy();
    if (clips) clips.quit(); // its hidden windows would keep OpenW running
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // test hook, smoke mode only: --smoke-page=nowplaying screenshots an overlay page instead of the app
  const page = smokeShot && arg('smoke-page') ? `${path.basename(arg('smoke-page'))}.html` : 'index.html';
  await win.loadFile(path.join(__dirname, '../renderer', page), { hash: arg('tab') || '' });
  const startNotice = [repaired.length ? `Rebuilt ${repaired.length === 1 ? 'a change' : `${repaired.length} changes`} that an earlier version wrote incorrectly: ${repaired.join(', ')}.` : '', upgraded].filter(Boolean).join(' ');
  if (startNotice) setTimeout(() => send('state', { state: snapshot(), flushed: [], notice: startNotice }), 1500);

  if (smokeShot) {
    const errors = [];
    win.webContents.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
    if (smokeClips) {
      clips.gameRunning = true; clips.sync();
      // what clipping costs: CPU of OpenW's processes over the last seconds of the run
      setTimeout(() => app.getAppMetrics(), 9000);
      setTimeout(() => console.log(JSON.stringify({ clipMetrics: app.getAppMetrics().map((m) => ({ type: m.type, cpu: Math.round(m.cpu.percentCPUUsage), mb: Math.round(m.memory.workingSetSize / 1024), privateMb: Math.round((m.memory.privateBytes || 0) / 1024) })) })), 15000);
    }
    // test hook, smoke mode only: --smoke-eval=<file.js> runs in the page before the screenshot
    if (arg('smoke-eval')) setTimeout(() => win.webContents.executeJavaScript(fs.readFileSync(arg('smoke-eval'), 'utf8')).catch((e) => errors.push(String(e))), 1200);
    setTimeout(async () => {
      fs.writeFileSync(smokeShot, (await win.webContents.capturePage()).toPNG());
      console.log(JSON.stringify({ smoke: 'ok', errors }));
      app.exit(errors.length ? 1 : 0);
    }, arg("smoke-wait") ? Number(arg("smoke-wait")) : arg("smoke-eval") ? 5000 : 2500);
    return;
  }
  syncOverlays();
  syncPadFeed();
  startMedia();
  clips.gameRunning = running;
  clips.sync();
  setInterval(poll, 4000);
  // updates: only an installed OpenW updates itself (a copy run from the source folder does not)
  if (app.isPackaged) {
    const check = () => { if (settings.get('updates').auto) updater.check({ download: true }); };
    setTimeout(check, 15000);
    setInterval(check, 6 * 3600 * 1000);
  }
});
let installOnQuit = true;

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  // a downloaded update goes in when OpenW closes (the setup starts OpenW again afterwards)
  if (installOnQuit && updater && settings && settings.get('updates').auto && updater.state.status === 'ready') updater.install({ wait: false });
  if (mediaWatcher) mediaWatcher.stop();
  if (clips) clips.quit();
  input.stop();
  reader.stop();
  // the real controller must not stay hidden once OpenW is gone
  const paths = settings && settings.get('input').autoHidden;
  if (paths && paths.length) { inputLib.showControllersSync(paths); saveInput({ autoHidden: [] }); }
});
