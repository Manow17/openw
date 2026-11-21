// Updates from GitHub Releases. OpenW looks at the releases of its repository; when one is newer
// than itself it downloads that release's setup, checks it against the release's SHA-256 and,
// when asked (or when OpenW closes), runs it silently. The setup keeps settings and skips
// drivers that are already installed, so updating is the same as installing over the top.
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const REPO = 'Manow17/openw';
const SETUP = /^OpenW-Setup-.*\.exe$/i;
const UA = { 'User-Agent': 'OpenW-updater', Accept: 'application/vnd.github+json' };

// "0.4.1" > "0.4.0"; a version with a suffix ("0.5.0-beta") counts as before the plain one
function compare(a, b) {
  const parse = (v) => { const [main, pre] = String(v).replace(/^v/i, '').split('-'); return { n: main.split('.').map((x) => Number(x) || 0), pre: pre || null }; };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.n[i] || 0) !== (y.n[i] || 0)) return (x.n[i] || 0) - (y.n[i] || 0);
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

// The SHA-256 a release vouches for: GitHub's own digest of the file, or the one in its notes.
function checksum(asset, notes) {
  const d = asset && /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || '');
  if (d) return d[1].toLowerCase();
  const m = /SHA-?256[^0-9a-f]{0,20}([0-9a-f]{64})/i.exec(notes || '');
  return m ? m[1].toLowerCase() : null;
}

// The newest release (GitHub API list) that is newer than `current` and has a setup to download.
function pickRelease(releases, current) {
  const usable = (releases || [])
    .filter((r) => !r.draft && compare(r.tag_name, current) > 0)
    .map((r) => ({ r, asset: (r.assets || []).find((a) => SETUP.test(a.name)) }))
    .filter((x) => x.asset)
    .sort((a, b) => compare(b.r.tag_name, a.r.tag_name));
  if (!usable.length) return null;
  const { r, asset } = usable[0];
  return {
    version: r.tag_name.replace(/^v/i, ''), name: r.name || r.tag_name, notes: r.body || '', page: r.html_url,
    file: asset.name, url: asset.browser_download_url, size: asset.size, sha256: checksum(asset, r.body),
  };
}

function get(url, { json = false, to = null, onProgress = null, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: UA }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).toString(), { json, to, onProgress, redirects: redirects - 1 }));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`GitHub answered ${res.statusCode}`)); return; }
      if (to) {
        const total = Number(res.headers['content-length']) || 0;
        let got = 0;
        const out = fs.createWriteStream(to);
        res.on('data', (c) => { got += c.length; if (onProgress && total) onProgress(got / total); });
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve(to)));
        out.on('error', reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const s = Buffer.concat(chunks).toString('utf8'); try { resolve(json ? JSON.parse(s) : s); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('GitHub did not answer')));
  });
}

const sha256File = (file) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});

/**
 * state: { status: 'idle' | 'checking' | 'downloading' | 'ready' | 'current' | 'error', version,
 * progress, error, checkedAt }. Emits 'change' whenever it changes.
 */
class Updater extends EventEmitter {
  constructor({ current, dir }) {
    super();
    this.current = current;
    this.dir = dir;
    this.state = { status: 'idle', current };
    this.release = null;
    this.file = null;
  }

  set(patch) { this.state = { ...this.state, ...patch }; this.emit('change', this.state); }

  // Looks for a newer release; with download, also fetches and checks its setup.
  async check({ download = true } = {}) {
    if (['checking', 'downloading'].includes(this.state.status)) return this.state;
    if (this.state.status === 'ready') return this.state;
    this.set({ status: 'checking', error: null });
    try {
      const releases = await get(`https://api.github.com/repos/${REPO}/releases?per_page=20`, { json: true });
      const rel = pickRelease(releases, this.current);
      if (!rel) { this.set({ status: 'current', checkedAt: Date.now() }); return this.state; }
      this.release = rel;
      this.set({ status: download ? 'downloading' : 'available', version: rel.version, page: rel.page, progress: 0, checkedAt: Date.now() });
      if (download) await this.download();
    } catch (e) {
      this.set({ status: 'error', error: e.message, checkedAt: Date.now() });
    }
    return this.state;
  }

  async download() {
    const rel = this.release;
    if (!rel.sha256) throw new Error(`OpenW ${rel.version} has no SHA-256 to check its setup against, so it is not installed automatically. Download it from GitHub.`);
    fs.mkdirSync(this.dir, { recursive: true });
    for (const f of fs.readdirSync(this.dir)) if (f !== rel.file) fs.rmSync(path.join(this.dir, f), { force: true }); // older downloads
    const file = path.join(this.dir, rel.file);
    if (!(fs.existsSync(file) && (await sha256File(file)) === rel.sha256)) {
      let last = 0;
      await get(rel.url, { to: `${file}.part`, onProgress: (p) => { if (p - last >= 0.02) { last = p; this.set({ progress: p }); } } });
      const got = await sha256File(`${file}.part`);
      if (got !== rel.sha256) { fs.rmSync(`${file}.part`, { force: true }); throw new Error('The downloaded setup does not match the SHA-256 the release gives, so it was thrown away.'); }
      fs.renameSync(`${file}.part`, file);
    }
    this.file = file;
    this.set({ status: 'ready', progress: 1 });
  }

  // Runs the downloaded setup silently; it closes OpenW, installs and starts the new version.
  install() {
    if (this.state.status !== 'ready' || !this.file) return false;
    spawn(this.file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    this.set({ status: 'installing' });
    return true;
  }
}

module.exports = { Updater, compare, pickRelease, checksum, REPO };
