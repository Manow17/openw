// Locate Rocket League (Epic Games / Steam), check whether it is running, launch it.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PROGRAM_DATA = process.env.ProgramData || 'C:\\ProgramData';
const EPIC_MANIFESTS = path.join(PROGRAM_DATA, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
const EPIC_INSTALLED = path.join(PROGRAM_DATA, 'Epic', 'UnrealEngineLauncher', 'LauncherInstalled.dat');
const EPIC_APP = 'Sugar'; // Epic's internal app name for Rocket League
const STEAM_APPID = '252950';
const EXE = 'RocketLeague.exe';

function cookedDir(installDir) {
  return path.join(installDir, 'TAGame', 'CookedPCConsole');
}

// A real Rocket League folder: TAGame\CookedPCConsole full of the game's packages. A folder an
// old install left behind (or an old launcher record points at) has the folder but not the files.
const MIN_PACKAGES = 100;
const counted = new Map(); // folder -> { n, at }: counting thousands of files is not free
function packageCount(installDir) {
  if (!installDir) return 0;
  const hit = counted.get(installDir);
  if (hit && Date.now() - hit.at < 60000) return hit.n;
  let n = 0;
  try { n = fs.readdirSync(cookedDir(installDir)).filter((f) => /\.upk$/i.test(f)).length; } catch { n = 0; }
  counted.set(installDir, { n, at: Date.now() });
  return n;
}
function isValidInstall(installDir) {
  return packageCount(installDir) >= MIN_PACKAGES;
}
// Why a folder is not a Rocket League install, in words.
function whyNotInstall(installDir) {
  const cooked = cookedDir(installDir);
  if (!fs.existsSync(cooked)) {
    let inside = [];
    try { inside = fs.readdirSync(installDir).slice(0, 8); } catch { /* unreadable */ }
    return `${installDir} has no TAGame\\CookedPCConsole folder${inside.length ? ` (it holds: ${inside.join(', ')})` : ''}. Pick the "rocketleague" folder.`;
  }
  counted.delete(installDir);
  return `${cooked} holds ${packageCount(installDir)} game packages, not the thousands Rocket League has, so it is not the folder the game runs from (an old install left behind?). Pick the folder Rocket League is installed in.`;
}

// An Epic record of Rocket League: its app name, or (if a launcher names it differently) its
// display name or the program it starts.
const isRocketLeague = (m) => !!m && (m.AppName === EPIC_APP || m.MainGameAppName === EPIC_APP
  || /^rocket ?league/i.test(m.DisplayName || '') || /RocketLeague\.exe$/i.test(m.LaunchExecutable || ''));

// Epic's install records (*.item) in a manifest folder.
function fromManifests(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /\.item$/i.test(f)); } catch { return null; }
  for (const f of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (isRocketLeague(m) && isValidInstall(m.InstallLocation)) return m.InstallLocation;
    } catch { /* skip unreadable manifest */ }
  }
  return null;
}
// The launcher's list of installed games (LauncherInstalled.dat).
function fromInstalledList(file) {
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8')).InstallationList || [];
    const hit = list.find((m) => isRocketLeague(m) && isValidInstall(m.InstallLocation));
    return hit ? hit.InstallLocation : null;
  } catch { return null; }
}
// The PC's own fixed drives ("C", "D"): a network or empty disc drive can stall a check for minutes.
function fixedDrives() {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command', "(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3').DeviceID -join ','"], { windowsHide: true, timeout: 8000 }, (err, out) => {
      const list = !err ? String(out).split(',').map((d) => d.trim().replace(':', '')).filter((d) => /^[A-Z]$/i.test(d)) : [];
      resolve(list.length ? list : ['C']);
    });
  });
}
// The usual Epic folders on every fixed drive, for a launcher that keeps its records elsewhere.
function fromCommonFolders(letters) {
  const places = ['Program Files\\Epic Games', 'Program Files (x86)\\Epic Games', 'Epic Games', 'Games\\Epic Games', 'Games', 'EpicGames', 'Epic'];
  for (const l of letters) {
    for (const p of places) for (const name of ['rocketleague', 'RocketLeague', 'Rocket League']) {
      const dir = `${l}:\\${p}\\${name}`;
      if (isValidInstall(dir)) return dir;
    }
  }
  return null;
}

/**
 * Rocket League from the Epic Games launcher. The old and new launchers keep their records in
 * different places, so every one is tried: the manifest folder (in ProgramData, wherever that is,
 * and the one Epic writes in the registry), the launcher's list of installed games, and the usual
 * install folders on every drive. options (for tests): { manifestDirs, installedLists, drives }.
 */
async function detectEpic(options = {}) {
  const dirs = options.manifestDirs || [EPIC_MANIFESTS, await regQuery('HKCU\\Software\\Epic Games\\EOS', 'ModSdkMetadataDir')].filter(Boolean);
  for (const dir of dirs) { const hit = fromManifests(path.normalize(dir)); if (hit) return hit; }
  for (const file of options.installedLists || [EPIC_INSTALLED]) { const hit = fromInstalledList(file); if (hit) return hit; }
  return fromCommonFolders(options.drives || await fixedDrives());
}

function regQuery(key, value) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', value], { windowsHide: true }, (err, out) => {
      if (err) return resolve(null);
      const m = out.match(new RegExp(value + '\\s+REG_\\w+\\s+(.+)'));
      resolve(m ? m[1].trim() : null);
    });
  });
}

async function detectSteam() {
  const roots = new Set();
  const reg = await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath');
  if (reg) roots.add(path.normalize(reg));
  roots.add('C:\\Program Files (x86)\\Steam');
  for (const root of [...roots]) {
    try {
      const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) roots.add(m[1].replace(/\\\\/g, '\\'));
    } catch { /* no library file here */ }
  }
  for (const root of roots) {
    const dir = path.join(root, 'steamapps', 'common', 'rocketleague');
    if (isValidInstall(dir)) return dir;
  }
  return null;
}

// The folder of a Rocket League that is running now, from its own program path, whatever
// launcher started it: { dir, platform } or null.
function fromRunningGame() {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command', "(Get-Process RocketLeague -ErrorAction SilentlyContinue | Select-Object -First 1).Path"], { windowsHide: true }, (err, out) => {
      const exe = !err && String(out).trim();
      if (!exe) return resolve(null);
      const dir = path.resolve(path.dirname(exe), '..', '..'); // <install>\Binaries\Win64\RocketLeague.exe
      resolve(isValidInstall(dir) ? { dir, platform: /steamapps/i.test(dir) ? 'steam' : 'epic' } : null);
    });
  });
}

// A running Rocket League's own folder comes first: it is the one the game really uses.
async function detect() {
  const [live, epic, steam] = await Promise.all([fromRunningGame(), detectEpic(), detectSteam()]);
  return {
    epic: live && live.platform === 'epic' ? live.dir : epic,
    steam: live && live.platform === 'steam' ? live.dir : steam,
  };
}

function isProcessRunning(exe) {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${exe}`, '/NH', '/FO', 'CSV'], { windowsHide: true }, (err, out) => {
      resolve(!err && out.toLowerCase().includes(exe.toLowerCase()));
    });
  });
}
const isRunning = () => isProcessRunning(EXE);

function launchUrl(platform) {
  return platform === 'steam'
    ? `steam://rungameid/${STEAM_APPID}`
    : `com.epicgames.launcher://apps/${EPIC_APP}?action=launch&silent=true`;
}

module.exports = { cookedDir, isValidInstall, whyNotInstall, packageCount, MIN_PACKAGES, isRocketLeague, detectEpic, detectSteam, fromRunningGame, detect, isRunning, isProcessRunning, launchUrl };
