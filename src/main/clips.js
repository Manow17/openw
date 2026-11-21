// Clipping: a hotkey saves the last seconds of the game.
//
// A hidden window (renderer/recorder.js) captures the screen, or only the Rocket League window,
// with the PC's sound and the microphone, and keeps the last seconds in memory, already encoded.
// It runs only while clipping is on, and by default only while Rocket League runs, so nothing is
// captured or encoded otherwise. A hotkey (several, each with its own length) asks it for a clip;
// the clip is written as an ordinary MP4 to the clips folder, with a picture for the library, and
// a short "Clip saved" note shows over the game. The library (core/cliplib.js) lists, renames,
// trims and deletes (to the Recycle Bin) the clips.
const { BrowserWindow, globalShortcut, desktopCapturer, screen, shell, dialog, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const lib = require('./core/cliplib');

// what a change to restarts the capture (anything else only changes the hotkeys or the notes)
const CAPTURE = ['res', 'fps', 'mbps', 'codec', 'source', 'game', 'gameVol', 'mic', 'micId', 'micVol'];

class Clips {
  constructor({ settings, userData, videos, preload, renderer, icon, isGameRunning, notify, log }) {
    Object.assign(this, { settings, userData, videos, preload, renderer, icon, isGameRunning, notify, log });
    this.thumbs = path.join(userData, 'clip-thumbs');
    this.win = null; this.toastWin = null; this.ready = false;
    this.gameRunning = false;
    this.status = { state: 'off', message: '' };
    this.keyErrors = [];
    this.pending = new Map(); this.nextId = 1;
    this.captureSig = '';
  }

  cfg() { return lib.complete(this.settings.get('clips')); }
  folder() { const c = this.cfg(); return c.folder || path.join(this.videos, 'OpenW Clips'); }
  wanted() { const c = this.cfg(); return c.on && (!c.onlyInGame || this.gameRunning); }
  setStatus(patch) { this.status = { ...this.status, ...patch }; this.notify({ status: this.statusView() }); }
  statusView() { return { ...this.status, keyErrors: this.keyErrors, folder: this.folder() }; }

  setGameRunning(on) { if (this.gameRunning !== on) { this.gameRunning = on; this.sync(); } }

  // Start, restart or stop the recorder and the hotkeys to match the settings and the game.
  async sync() {
    const c = this.cfg();
    if (!this.wanted()) {
      this.stopRecorder();
      this.registerKeys(false);
      this.setStatus({ state: c.on ? 'waiting' : 'off', message: c.on ? 'Starts when Rocket League starts.' : '' });
      return;
    }
    this.registerKeys(true);
    const sig = JSON.stringify(CAPTURE.map((k) => c[k]));
    if (this.win && !this.win.isDestroyed() && sig === this.captureSig && this.status.state !== 'error') return;
    this.captureSig = sig;
    await this.startRecorder(c);
  }

  async startRecorder(c) {
    this.setStatus({ state: 'starting', message: 'Starting…' });
    let source;
    try { source = await this.pickSource(c); } catch (e) { this.setStatus({ state: 'error', message: `The screen could not be captured: ${e.message}` }); return; }
    const config = { ...c, keep: lib.keepSeconds(c) + 2, sourceId: source.id };
    if (!this.win || this.win.isDestroyed()) {
      this.ready = false;
      this.win = new BrowserWindow({ show: false, width: 400, height: 240, skipTaskbar: true, icon: this.icon, webPreferences: { preload: this.preload, backgroundThrottling: false } });
      this.win.on('closed', () => { this.win = null; this.ready = false; });
      this.win.webContents.on('render-process-gone', () => this.setStatus({ state: 'error', message: 'The recorder stopped. Turn clipping off and on again.' }));
      this.pendingConfig = config;
      this.win.loadFile(path.join(this.renderer, 'recorder.html'));
    } else if (this.ready) this.win.webContents.send('clip-config', config);
    else this.pendingConfig = config;
    this.sourceNote = source.note || '';
  }

  // the recorder page has loaded (api 'clipReady')
  recorderReady() {
    this.ready = true;
    if (this.pendingConfig && this.win) { this.win.webContents.send('clip-config', this.pendingConfig); this.pendingConfig = null; }
  }

  stopRecorder() {
    for (const [, p] of this.pending) p.done(new Error('Clipping stopped.'));
    this.pending.clear();
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null; this.ready = false; this.captureSig = '';
  }

  // What to capture: the Rocket League window (falling back to the screen it is on), or the
  // main screen, which includes the overlays.
  async pickSource(c) {
    const sources = await desktopCapturer.getSources({ types: c.source === 'game' ? ['window', 'screen'] : ['screen'], thumbnailSize: { width: 0, height: 0 } });
    if (c.source === 'game') {
      const game = sources.find((s) => /^Rocket League/i.test(s.name) && s.id.startsWith('window:'));
      if (game) return game;
    }
    const primary = String(screen.getPrimaryDisplay().id);
    const s = sources.find((x) => x.id.startsWith('screen:') && x.display_id === primary) || sources.find((x) => x.id.startsWith('screen:'));
    if (!s) throw new Error('no screen found');
    return { ...s, note: c.source === 'game' ? 'The Rocket League window was not found, so the whole screen is recorded.' : '' };
  }

  // messages from the recorder (api 'clipStatus')
  recorderStatus(msg) {
    if (msg.kind === 'recording') {
      const info = { width: msg.width, height: msg.height, fps: msg.fps, audio: msg.audio, codec: /av01/.test(msg.mime) ? 'AV1' : 'H.264' };
      this.setStatus({ state: 'recording', message: this.sourceNote || '', info, held: 0 });
    } else if (msg.kind === 'tick') {
      this.status = { ...this.status, held: msg.held, bytes: msg.bytes };
      this.notify({ status: this.statusView(), tick: true });
    } else if (msg.kind === 'warn') this.setStatus({ message: msg.message });
    else if (msg.kind === 'error') {
      this.log('clips', msg.message);
      this.setStatus({ state: 'error', message: msg.message });
      // the capture ended (the game restarted, a screen changed): try again a few times
      const now = Date.now();
      this.retries = (this.retries || []).filter((t) => now - t < 60000);
      if (this.retries.length < 3) {
        this.retries.push(now);
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => { if (this.status.state === 'error') { this.captureSig = ''; this.sync(); } }, 5000);
      }
    }
  }

  // Global hotkeys: they work while the game is in front. Registered only while recording, so
  // the keys stay free for other apps otherwise.
  registerKeys(on) {
    for (const k of this.registered || []) { try { globalShortcut.unregister(k); } catch { /* gone */ } }
    this.registered = [];
    this.keyErrors = [];
    if (!on) return;
    const c = this.cfg();
    for (const { key, seconds } of c.keys) {
      let ok = false;
      try { ok = globalShortcut.register(key, () => this.save(seconds).catch(() => {})); } catch { ok = false; }
      if (ok) this.registered.push(key); else this.keyErrors.push(key);
    }
  }

  // Save the last `seconds`. Resolves with the clip, or rejects with a reason the page can show.
  save(seconds) {
    const c = this.cfg();
    seconds = lib.LENGTHS.includes(Number(seconds)) ? Number(seconds) : c.keys[0] ? c.keys[0].seconds : 30;
    if (!this.win || !this.ready || this.status.state !== 'recording') {
      const why = this.status.state === 'waiting' ? 'Clipping starts when Rocket League starts.' : 'Clipping is not running.';
      this.toast(false, 'No clip saved', why);
      return Promise.reject(new Error(why));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => done(new Error('The recorder did not answer.')), 20000);
      const done = (err, clip) => { clearTimeout(timer); this.pending.delete(id); if (err) { this.toast(false, 'No clip saved', err.message); reject(err); } else resolve(clip); };
      this.pending.set(id, { seconds, done });
      this.win.webContents.send('clip-save', { id, seconds });
    });
  }

  // the recorder's answer (api 'clipWrite'): the clip's bytes and picture, or why there is none
  write(id, bytes, picture, error) {
    const p = this.pending.get(id);
    if (!p) return false;
    if (error || !bytes) { p.done(new Error(error || 'Nothing was recorded.')); return false; }
    try {
      const dir = this.folder();
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, lib.clipName(dir));
      fs.writeFileSync(file, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      if (picture) this.savePicture(file, picture);
      const seconds = lib.mp4Seconds(file);
      this.toast(true, 'Clip saved', `${seconds ? `${Math.round(seconds)} seconds` : 'Saved'} · ${path.basename(file)}`);
      this.notify({ saved: path.basename(file) });
      p.done(null, { file, seconds });
      return true;
    } catch (e) {
      this.log('clip write', e);
      p.done(new Error(`The clip could not be written: ${e.message}`));
      return false;
    }
  }

  savePicture(file, dataUrl) {
    try {
      const img = nativeImage.createFromDataURL(String(dataUrl));
      if (img.isEmpty()) return;
      fs.mkdirSync(this.thumbs, { recursive: true });
      fs.writeFileSync(lib.thumbFile(this.thumbs, file), img.toJPEG(82));
    } catch (e) { this.log('clip picture', e); }
  }

  // "Clip saved" over the game: a small click-through window at the top of the main screen.
  toast(ok, title, sub) {
    const c = this.cfg();
    if (!c.toast && !c.sound) return;
    const area = screen.getPrimaryDisplay().workArea, width = 460, height = 90;
    const at = { x: area.x + Math.round((area.width - width) / 2), y: area.y + 18, width, height };
    const show = () => {
      if (c.toast) { this.toastWin.setBounds(at); this.toastWin.showInactive(); }
      this.toastWin.webContents.send('clip-toast', { ok, title, sub, sound: c.sound });
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => { if (this.toastWin && !this.toastWin.isDestroyed()) this.toastWin.hide(); }, 3200);
    };
    if (this.toastWin && !this.toastWin.isDestroyed()) { show(); return; }
    this.toastWin = new BrowserWindow({ ...at, frame: false, transparent: true, resizable: false, skipTaskbar: true, focusable: false, show: false, hasShadow: false, icon: this.icon, webPreferences: { preload: this.preload, backgroundThrottling: false } });
    this.toastWin.setAlwaysOnTop(true, 'screen-saver');
    this.toastWin.setIgnoreMouseEvents(true);
    this.toastWin.loadFile(path.join(this.renderer, 'cliptoast.html'));
    this.toastWin.webContents.once('did-finish-load', show);
  }

  /* ---------- the library ---------- */
  list() { return lib.listClips(this.folder(), this.thumbs); }
  rename(file, name) { const to = lib.renameClip(this.folder(), this.thumbs, file, name); this.notify({}); return to; }
  async remove(file) {
    const f = lib.inFolder(this.folder(), file);
    await shell.trashItem(f); // to the Recycle Bin, so it can be brought back
    fs.rmSync(lib.thumbFile(this.thumbs, f), { force: true });
    this.notify({});
  }
  reveal(file) { shell.showItemInFolder(lib.inFolder(this.folder(), file)); }
  openFolder() { const dir = this.folder(); fs.mkdirSync(dir, { recursive: true }); shell.openPath(dir); }
  trim(file, from, to) { const r = lib.trimClip(this.folder(), this.thumbs, file, Number(from), Number(to)); this.notify({}); return r; }
  // a picture for a clip that has none yet (the page draws it from the video)
  picture(file, dataUrl) { this.savePicture(lib.inFolder(this.folder(), file), dataUrl); return lib.thumbFile(this.thumbs, file); }
  async pickFolder(win) {
    const res = await dialog.showOpenDialog(win, { title: 'Where to save clips', properties: ['openDirectory', 'createDirectory'], defaultPath: this.folder() });
    return res.canceled ? null : res.filePaths[0];
  }

  quit() {
    this.registerKeys(false);
    this.stopRecorder();
    if (this.toastWin && !this.toastWin.isDestroyed()) this.toastWin.destroy();
  }
}

module.exports = { Clips };
