// OpenW Input from the main process: runs the helper (bin/openw-input.exe, built from
// native/openw-input.cpp), hands it the profile, and passes on what it reports. Also checks
// for the two drivers it relies on, installs them from the copies OpenW comes with
// (drivers/), and drives HidHide, which hides the real controller from games so they see
// only OpenW's virtual one.
const { spawn, spawnSync, execFile } = require('child_process');
const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../shared/transform');

const EXE = path.join(__dirname, '..', '..', 'bin', 'openw-input.exe');

class Input extends EventEmitter {
  constructor(exe = EXE) {
    super();
    this.exe = exe;
    this.proc = null;
    this.watching = false;
    this.status = { running: false, vigem: null, pad: null, error: '' };
  }

  get running() { return !!this.proc; }

  // own: take PlayStation controllers for the helper alone, so games cannot open them
  // read: only read and report the controller (for the overlay): no virtual pad, no profile
  start(profile, { own = false, read = false } = {}) {
    if (this.proc) return profile ? this.configure(profile) : undefined;
    if (!fs.existsSync(this.exe)) throw new Error('The input helper (bin/openw-input.exe) is missing. Build it with npm run build-input.');
    const proc = spawn(this.exe, read ? ['--read'] : own ? ['--own'] : [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    this.proc = proc;
    this.status = { running: true, vigem: null, pad: null, error: '' };
    let buf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { this.line(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
    });
    proc.stdin.on('error', () => { /* it quit: the exit handler reports it */ });
    proc.on('error', (e) => { this.status.error = e.message; });
    proc.on('exit', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.status = { ...this.status, running: false, pad: null, error: code ? this.status.error || `The input helper stopped (code ${code}).` : this.status.error };
      this.emit('status', this.status);
    });
    if (profile) this.configure(profile);
    if (this.watching) this.write('watch 1');
    this.emit('status', this.status);
  }

  line(text) {
    const [kind, ...rest] = text.split(' ');
    if (kind === 'state') {
      const v = rest.map(Number);
      this.emit('state', { raw: v.slice(0, 6), rawButtons: v[6], out: v.slice(7, 13), outButtons: v[13] });
      return;
    }
    if (kind === 'vigem') this.status.vigem = rest[0] === 'ok';
    else if (kind === 'pad') this.status.pad = rest[0] === 'none' ? null : { kind: rest[0], conn: rest[1], access: rest[3] || 'shared' };
    else if (kind === 'error') this.status.error = rest.slice(1).join(' ');
    else return;
    this.emit('status', { ...this.status });
  }

  write(text) { if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(`${text}\n`); }
  configure(profile) { for (const l of T.lines(profile)) this.write(l); }
  watch(on) { this.watching = !!on; this.write(`watch ${on ? 1 : 0}`); }
  own(on) { this.write(`own ${on ? 1 : 0}`); }
  reopen() { this.write('reopen'); }

  // resolves once the helper has quit
  stop() {
    const proc = this.proc;
    if (!proc) return Promise.resolve();
    const gone = new Promise((resolve) => proc.once('exit', resolve));
    this.write('quit');
    proc.stdin.end();
    setTimeout(() => { if (proc.exitCode == null) proc.kill(); }, 1500);
    return gone;
  }
}

/* ---------- drivers ---------- */

const regKey = (key) => new Promise((resolve) => execFile('reg', ['query', key], { windowsHide: true }, (err) => resolve(!err)));

const pf = process.env.ProgramFiles || 'C:\\Program Files';
const CLI_PLACES = [
  path.join(pf, 'Nefarius Software Solutions', 'HidHide', 'x64', 'HidHideCLI.exe'),
  path.join(pf, 'Nefarius Software Solutions', 'HidHide', 'HidHideCLI.exe'),
  path.join(pf, 'Nefarius Software Solutions e.U', 'HidHide', 'x64', 'HidHideCLI.exe'),
];
const hidHideCli = () => CLI_PLACES.find((p) => fs.existsSync(p)) || null;
const hasHidHide = () => !!hidHideCli();

async function drivers() {
  const [vigem, hidhide] = await Promise.all([
    regKey('HKLM\\SYSTEM\\CurrentControlSet\\Services\\ViGEmBus'),
    regKey('HKLM\\SYSTEM\\CurrentControlSet\\Services\\HidHide'),
  ]);
  return { vigem, hidhide: hidhide && !!hidHideCli(), helper: fs.existsSync(EXE), bundled: { vigem: !!bundled('vigem'), hidhide: !!bundled('hidhide') } };
}

/* ---------- HidHide: the real controller hidden while OpenW Input runs ---------- */

// HidHideCLI writes UTF-16 on some versions and UTF-8 on others.
const decode = (buf) => (buf.length > 1 && (buf[1] === 0 || (buf[0] === 0xFF && buf[1] === 0xFE)) ? buf.toString('utf16le') : buf.toString('utf8')).replace(/^\uFEFF/, '');
// It needs no administrator rights. Its stdin must be closed, or it waits for more commands.
function cli(args, exe = hidHideCli()) {
  return new Promise((resolve, reject) => {
    if (!exe) return reject(new Error('HidHide is not installed.'));
    const p = spawn(exe, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const out = [];
    const timer = setTimeout(() => { p.kill(); reject(new Error('HidHide did not answer.')); }, 10000);
    p.stdout.on('data', (d) => out.push(d));
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('exit', (code) => { clearTimeout(timer); if (code) reject(new Error(`HidHide stopped with code ${code}.`)); else resolve(decode(Buffer.concat(out))); });
  });
}

// Every device entry in --dev-gaming's JSON, wherever it sits.
function gamingDevices(json) {
  const found = [];
  const walk = (node, group) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, group));
    if (!node || typeof node !== 'object') return;
    if (typeof node.deviceInstancePath === 'string') found.push({ ...node, group });
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, node.friendlyName || group);
  };
  walk(json, '');
  return found;
}

// The controllers HidHide can hide, grouped as one entry per physical controller.
function controllers(json, hidden) {
  const groups = new Map();
  for (const d of gamingDevices(json)) {
    if (d.present === false) continue;
    const key = d.baseContainerDeviceInstancePath || d.deviceInstancePath;
    const ids = /VID_([0-9A-F]{4}).*PID_([0-9A-F]{4})/i.exec(d.deviceInstancePath) || [];
    const g = groups.get(key) || { name: d.group || d.description || d.product || 'Controller', vid: (ids[1] || '').toUpperCase(), pid: (ids[2] || '').toUpperCase(), paths: [] };
    for (const p of [d.deviceInstancePath, d.baseContainerDeviceInstancePath]) if (p && !g.paths.includes(p)) g.paths.push(p);
    groups.set(key, g);
  }
  const lower = new Set(hidden.map((p) => p.toLowerCase()));
  return [...groups.values()].map((g) => ({
    ...g,
    hidden: g.paths.some((p) => lower.has(p.toLowerCase())),
    // an Xbox 360 pad may be OpenW's own virtual one
    virtual: g.vid === '045E' && g.pid === '028E',
  }));
}

// Which of these devices have HidHide's filter in their driver stack. It attaches when a
// device connects, so a controller that was plugged in before HidHide was installed cannot be
// hidden until it reconnects (OpenW's setup restarts them for that).
function withFilter(ids) {
  if (!ids.length) return Promise.resolve(new Set());
  const list = ids.map(psQuote).join(',');
  const cmd = `foreach ($id in @(${list})) { $s = (Get-PnpDeviceProperty -InstanceId $id -KeyName DEVPKEY_Device_Stack -ErrorAction SilentlyContinue).Data -join ' '; if ($s -match 'HidHide') { $id } }`;
  return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 15000 }, (err, out) => {
    resolve(new Set(String(out || '').split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean)));
  }));
}

// Hides every real controller from all apps except the input helper, so games only see the
// virtual one. Returns { paths: what it hid, reconnect: names of controllers that must
// reconnect before hiding works }, or null without HidHide.
async function hideControllers() {
  if (!hidHideCli()) return null;
  let json = [];
  try { json = JSON.parse(await cli(['--dev-gaming'])); } catch { json = []; }
  const pads = controllers(json, []).filter((c) => !c.virtual);
  const paths = pads.flatMap((c) => c.paths);
  await cli(['--app-reg', EXE, ...paths.flatMap((p) => ['--dev-hide', p]), '--cloak-on']);
  const filtered = await withFilter(paths);
  const reconnect = pads.filter((c) => !c.paths.some((p) => filtered.has(p.toLowerCase()))).map((c) => c.name);
  return { paths, reconnect };
}
// Shows them again; the sync one is for when OpenW quits.
const showArgs = (paths) => paths.flatMap((p) => ['--dev-unhide', p]);
const showControllers = (paths) => (paths.length && hidHideCli() ? cli(showArgs(paths)) : Promise.resolve(''));
function showControllersSync(paths) {
  const exe = hidHideCli();
  if (paths.length && exe) spawnSync(exe, showArgs(paths), { stdio: 'ignore', windowsHide: true, timeout: 5000 });
}

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Runs a PowerShell script with administrator rights, so Windows asks once. The script can
// write $out (a file); its text comes back.
function runElevated(body, refused) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openw-admin-'));
  const script = path.join(dir, 'run.ps1'), out = path.join(dir, 'out.txt');
  fs.writeFileSync(script, `\uFEFF$out = ${psQuote(out)}\r\n${body}\r\n`, 'utf8');
  const start = `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${psQuote(`"${script}"`)}`;
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', start], { windowsHide: true }, (err) => {
    let text = '';
    try { text = fs.readFileSync(out, 'utf8').replace(/^\uFEFF/, ''); } catch { /* nothing written */ }
    fs.rmSync(dir, { recursive: true, force: true });
    if (err) reject(new Error(refused));
    else resolve(text);
  }));
}

/* ---------- the drivers OpenW comes with ---------- */

// Nefarius Software Solutions' own signed installers, as published on GitHub (drivers/README.md).
const DRIVER_DIR = path.join(__dirname, '..', '..', 'drivers');
const DRIVERS = {
  vigem: { name: 'ViGEmBus', file: 'ViGEmBus_1.22.0_x64_x86_arm64.exe', sha256: '89220a7865076b342892f98865f3499fb7c4cfd673159e89d352c360fd014c6a' },
  hidhide: { name: 'HidHide', file: 'HidHide_1.5.230_x64.exe', sha256: 'f4bbbcb82e6258641b887c74bc81c4c5f66e4aa811808dfc304347687b7605f6' },
};
// Windows Installer exit codes: done, done after a restart, or a version already there.
const DONE = { 0: 'installed', 1638: 'installed', 3010: 'restart', 1641: 'restart' };

// The bundled installer, if it is there and unchanged.
function bundled(which) {
  const d = DRIVERS[which];
  if (!d) return null;
  const file = path.join(DRIVER_DIR, d.file);
  if (!fs.existsSync(file)) return null;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return hash === d.sha256 ? file : null;
}

// The elevated script: each installer runs silently (Advanced Installer: /exenoui /qn), and
// its exit code goes to $out as JSON.
// After HidHide, the connected controllers restart so its filter attaches at once.
const RESTART_PADS = path.join(__dirname, 'restart-pads.ps1');
const installScript = (files) => [
  '$codes = @{}',
  ...files.map(([w, f]) => `$p = Start-Process -FilePath ${psQuote(f)} -ArgumentList '/exenoui','/qn','/norestart' -Wait -PassThru; $codes[${psQuote(w)}] = $p.ExitCode`),
  ...(files.some(([w]) => w === 'hidhide') ? [`if ($codes['hidhide'] -in 0,1638,3010,1641) { & ${psQuote(RESTART_PADS)} }`] : []),
  '$codes | ConvertTo-Json | Set-Content -Encoding utf8 -Path $out',
].join('\r\n');

// Installs the drivers without their own windows (Windows still asks for permission, once).
// Returns { vigem: 'installed' | 'restart' | 'failed' , ... }.
async function installDrivers(list) {
  const want = [...new Set(list)].filter((w) => DRIVERS[w]);
  if (!want.length) return {};
  const files = want.map((w) => [w, bundled(w)]);
  const broken = files.find(([, f]) => !f);
  if (broken) throw new Error(`The ${DRIVERS[broken[0]].name} installer that came with OpenW is missing or changed, so it was not run.`);
  const text = await runElevated(installScript(files), 'Windows did not give permission, so no driver was installed.');
  let codes = {};
  try { codes = JSON.parse(text); } catch { /* nothing reported */ }
  return Object.fromEntries(want.map((w) => [w, DONE[codes[w]] || `failed (${codes[w] ?? 'no answer'})`]));
}

// Hide these device paths from every app except the input helper.
const hide = (paths) => elevated([['--app-reg', EXE], ...paths.map((p) => ['--dev-hide', p]), ['--cloak-on']]);
const show = (paths) => elevated(paths.map((p) => ['--dev-unhide', p]));

module.exports = { Input, EXE, DRIVERS, drivers, bundled, installDrivers, installScript, psQuote, hasHidHide, hideControllers, showControllers, showControllersSync, controllers, gamingDevices, decode };
