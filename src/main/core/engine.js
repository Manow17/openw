// The mod engine. Every change OpenW makes to the game goes through here:
// it replaces one existing file in CookedPCConsole, after saving the original,
// and can always put the original back. While the game runs, changes are queued.
//
// Operations:
//   { kind: 'swap', sourceFile, targetFile }  the item you own (source) gets the
//       look of another item (target): target's package, internally renamed to
//       the source's name, is written over the source file.
//   { kind: 'file', gameFile, from }           gameFile is replaced by an
//       arbitrary file (a workshop map).
//   { kind: 'copy', gameFile, sourceGameFile } gameFile is replaced by a copy of
//       another game file (an arena part or a whole arena).
//   { kind: 'build', gameFile, from, side, renames, create } gameFile becomes a copy
//       of the map `from` with only one side kept ('stadium' or 'surroundings'), and
//       names renamed (see mapbuild.js). With `create`, gameFile is a new file that
//       OpenW adds to the folder and deletes again on revert.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const upk = require('./upk');
const mapbuild = require('./mapbuild');

class EngineError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

class Engine {
  constructor({ store, backupDir, getCookedDir, isRunning, getKeys = () => [] }) {
    Object.assign(this, { store, backupDir, getCookedDir, isRunning, getKeys });
    if (!store.get('active')) store.set('active', {});
    if (!store.get('queue')) store.set('queue', []);
  }

  cooked() {
    const dir = this.getCookedDir();
    if (!dir) throw new EngineError('NO_GAME', 'Rocket League folder is not set');
    return dir;
  }

  destName(op) {
    const name = op.kind === 'swap' ? op.sourceFile : op.gameFile;
    if (!name || path.basename(name) !== name) throw new EngineError('BAD_OP', 'Invalid game file name');
    return name;
  }

  internalName(fileName) {
    const wanted = upk.baseName(fileName);
    try {
      const pkg = upk.readHeaderFile(this.pristine(fileName), this.getKeys());
      const hit = pkg.names.find((n) => n.text.toLowerCase() === wanted.toLowerCase());
      if (hit) return hit.text;
    } catch { /* fall back to the file name's casing */ }
    return wanted;
  }

  // Dry run: can this swap be built? Returns { ok, code?, message? }.
  checkSwap(op) {
    try { this.buildContent(op); return { ok: true }; }
    catch (e) { return { ok: false, code: e.code || 'ERROR', message: e.message }; }
  }

  // The unmodified version of a game file: the backup if OpenW has changed it.
  pristine(fileName) {
    const key = fileName.toLowerCase();
    return this.store.get('active')[key] ? path.join(this.backupDir, key) : path.join(this.cooked(), fileName);
  }

  // The key the game uses for a file: the one its original copy is encrypted with.
  destinationKey(fileName) {
    try { return upk.keyOfFile(this.pristine(fileName), this.getKeys()); }
    catch (e) {
      if (e.code === 'NO_KEY') throw new EngineError('NO_KEY', `OpenW cannot read ${fileName}, so it cannot write over it. Adding a key list in Settings may help.`);
      return null; // not an encrypted package: written as it is
    }
  }

  buildContent(op) {
    if (op.kind === 'file') return fs.readFileSync(op.from);
    if (op.kind === 'build') {
      if (!op.from || path.basename(op.from) !== op.from) throw new EngineError('BAD_OP', 'Invalid source file name');
      if (!['stadium', 'surroundings', 'empty'].includes(op.side)) throw new EngineError('BAD_OP', 'Invalid side');
      const { pkg, zipped } = this.trimmedMap(op);
      // a file the game has never had is read with the game's common key
      const key = op.create ? Buffer.from(upk.DEFAULT_KEYS[0], 'hex') : this.destinationKey(op.gameFile);
      return mapbuild.repack(pkg, key || pkg.t.pkg.key, op.renames || {}, zipped);
    }
    if (op.kind === 'copy') {
      if (!op.sourceGameFile || path.basename(op.sourceGameFile) !== op.sourceGameFile) throw new EngineError('BAD_OP', 'Invalid source file name');
      if (op.sourceGameFile.toLowerCase() === op.gameFile.toLowerCase()) throw new EngineError('SAME_ITEM', 'Pick two different files');
      // if OpenW has changed the source itself, copy its original
      const from = this.pristine(op.sourceGameFile);
      if (!fs.existsSync(from)) throw new EngineError('NO_SUCH_GAME_FILE', `${op.sourceGameFile} is not in the game folder`);
      const key = this.destinationKey(op.gameFile);
      const buf = fs.readFileSync(from);
      return key ? upk.reencrypt(buf, key, this.getKeys()) : buf;
    }
    if (op.kind !== 'swap') throw new EngineError('BAD_OP', `Unknown operation "${op.kind}"`);
    if (op.sourceFile.toLowerCase() === op.targetFile.toLowerCase()) {
      throw new EngineError('SAME_ITEM', 'Pick two different items');
    }
    // Always read the target from its pristine copy if we have modified it.
    const targetPath = this.pristine(op.targetFile);
    const from = upk.baseName(op.targetFile);
    const to = this.internalName(op.sourceFile);
    const res = upk.renameNames(fs.readFileSync(targetPath), [
      { from, to },
      { from: `${from}_SF`, to: `${to}_SF` },
    ], this.getKeys(), this.destinationKey(op.sourceFile));
    if (res.missing.includes(from)) {
      throw new EngineError('UNEXPECTED_LAYOUT', `"${from}" was not found inside ${op.targetFile}`);
    }
    return res.buffer;
  }

  list() {
    return { active: Object.values(this.store.get('active')), queue: this.store.get('queue') };
  }

  async apply(op) {
    this.destName(op);
    if (await this.isRunning()) return this.enqueue({ type: 'apply', op });
    return { queued: false, record: this.applyNow(op) };
  }

  async revert(destKey) {
    if (await this.isRunning()) return this.enqueue({ type: 'revert', dest: destKey });
    this.revertNow(destKey);
    return { queued: false };
  }

  async revertAll() {
    const out = [];
    for (const key of Object.keys(this.store.get('active'))) out.push(await this.revert(key));
    return out;
  }

  enqueue(entry) {
    const key = (entry.type === 'apply' ? this.destName(entry.op) : entry.dest).toLowerCase();
    const queue = this.store.get('queue').filter((q) => q.key !== key);
    queue.push({ ...entry, key, queuedAt: Date.now() });
    this.store.set('queue', queue);
    return { queued: true };
  }

  unqueue(key) {
    this.store.set('queue', this.store.get('queue').filter((q) => q.key !== key));
  }

  // The map of a build op opened and cut down to its side, with its chunks compressed. The last
  // one is kept for a few seconds: "same arena every match" writes the same build into up to 60
  // arena files, and between those only the header (key and names) differs.
  trimmedMap(op) {
    const from = this.pristine(op.from);
    if (!fs.existsSync(from)) throw new EngineError('NO_SUCH_GAME_FILE', `${op.from} is not in the game folder`);
    const opts = {
      region: op.region || mapbuild.DEFAULT_REGION, clear: op.clear || [],
      gameplay: op.gameplay === undefined ? op.side === 'stadium' : !!op.gameplay, part: !!op.part,
      lights: op.lights === undefined ? null : !!op.lights,
    };
    const st = fs.statSync(from);
    const sig = JSON.stringify([from, st.size, st.mtimeMs, op.side, opts]);
    if (!this.lastBuild || this.lastBuild.sig !== sig) {
      this.lastBuild = null; // the previous one goes before the next is read
      const pkg = mapbuild.open(fs.readFileSync(from), this.getKeys());
      mapbuild.keepSide(pkg, op.side, opts);
      this.lastBuild = { sig, pkg, zipped: mapbuild.zipChunks(pkg) };
    }
    clearTimeout(this.forgetBuild);
    this.forgetBuild = setTimeout(() => { this.lastBuild = null; }, 10000);
    if (this.forgetBuild.unref) this.forgetBuild.unref();
    return this.lastBuild;
  }

  // Run everything that was queued while the game was open, one file at a time, so OpenW stays
  // responsive. onProgress(done, total) after each. If the game starts again meanwhile, the
  // rest stays queued.
  async flushQueue(onProgress = null) {
    if (await this.isRunning()) return [];
    const todo = [...this.store.get('queue')];
    const out = [];
    for (const [i, q] of todo.entries()) {
      if (i > 0 && await this.isRunning()) break;
      try {
        if (q.type === 'apply') this.applyNow(q.op); else this.revertNow(q.dest);
        out.push({ key: q.key, ok: true });
      } catch (e) {
        out.push({ key: q.key, ok: false, code: e.code, message: e.message });
      }
      // done (or failed, and said so): off the queue; anything queued meanwhile stays
      this.store.set('queue', this.store.get('queue').filter((x) => !(x.key === q.key && x.queuedAt === q.queuedAt)));
      if (onProgress) onProgress(i + 1, todo.length);
    }
    return out;
  }

  applyNow(op) {
    const name = this.destName(op);
    const key = name.toLowerCase();
    const dest = path.join(this.cooked(), name);
    const created = !!op.create;
    if (created) {
      // a new file: never written over one the game (or anything else) put there
      const mine = this.store.get('active')[key];
      if (fs.existsSync(dest) && !(mine && mine.created)) throw new EngineError('FILE_EXISTS', `${name} is already in the game folder`);
    } else if (!fs.existsSync(dest)) throw new EngineError('NO_SUCH_GAME_FILE', `${name} is not in the game folder`);
    const content = this.buildContent(op);

    if (!created) {
      this.dropIfOverwritten(key);
      const backup = path.join(this.backupDir, key);
      fs.mkdirSync(this.backupDir, { recursive: true });
      if (!fs.existsSync(backup)) fs.copyFileSync(dest, backup); // first change: keep the original
    }

    const tmp = `${dest}.openw-tmp`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, dest);
    const st = fs.statSync(dest);

    const record = {
      id: crypto.randomUUID(), key, file: name, op, appliedAt: Date.now(), ...(created ? { created: true } : {}),
      written: { size: st.size, mtimeMs: st.mtimeMs },
    };
    const active = this.store.get('active');
    active[key] = record;
    this.store.set('active', active);
    return record;
  }

  revertNow(key) {
    const active = this.store.get('active');
    const rec = active[key];
    if (!rec) return;
    if (rec.created) { // a file OpenW added: take it away again
      fs.rmSync(path.join(this.cooked(), rec.file), { force: true });
      delete active[key];
      this.store.set('active', active);
      return;
    }
    const backup = path.join(this.backupDir, key);
    if (!this.dropIfOverwritten(key) && fs.existsSync(backup)) {
      fs.copyFileSync(backup, path.join(this.cooked(), rec.file));
      fs.rmSync(backup, { force: true });
      delete active[key];
      this.store.set('active', active);
    }
  }

  // A game update or "verify files" replaces our file with a fresh original.
  // In that case the old backup is stale and must never be restored.
  dropIfOverwritten(key) {
    const active = this.store.get('active');
    const rec = active[key];
    if (!rec) return false;
    let st = null;
    try { st = fs.statSync(path.join(this.cooked(), rec.file)); } catch { /* file gone */ }
    const ours = st && st.size === rec.written.size && Math.abs(st.mtimeMs - rec.written.mtimeMs) < 2000;
    if (ours) return false;
    fs.rmSync(path.join(this.backupDir, key), { force: true });
    delete active[key];
    this.store.set('active', active);
    return true;
  }

  reconcile() {
    return Object.keys(this.store.get('active')).filter((key) => this.dropIfOverwritten(key));
  }

  // Versions before 0.1.1 wrote swaps and arena copies with the wrong key when the
  // two files used different ones, which crashes the game. Rebuild any such file.
  // Returns the labels of what was rebuilt. Call only while the game is closed.
  repairKeys() {
    const fixed = [];
    for (const rec of Object.values(this.store.get('active'))) {
      if (rec.op.kind !== 'swap' && rec.op.kind !== 'copy') continue;
      try {
        const want = this.destinationKey(rec.file);
        if (!want) continue;
        const have = (() => { try { return upk.keyOfFile(path.join(this.cooked(), rec.file), this.getKeys()); } catch { return null; } })();
        if (have && have.equals(want)) continue;
        this.applyNow(rec.op);
        fixed.push(rec.op.label || rec.file);
      } catch { /* leave it; the user can revert it */ }
    }
    return fixed;
  }
}

module.exports = { Engine, EngineError };
