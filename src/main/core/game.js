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

function isValidInstall(installDir) {
  try { return !!installDir && fs.statSync(cookedDir(installDir)).isDirectory(); } catch { return false; }
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
// The usual Epic folders on every drive, for a launcher that keeps its records elsewhere.
function fromCommonFolders(drives = null) {
  const letters = drives || 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((l) => { try { return fs.existsSync(`${l}:\\`); } catch { return false; } });
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
  return fromCommonFolders(options.drives);
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

async function detect() {
  const [epic, steam] = await Promise.all([detectEpic(), detectSteam()]);
  if (epic || steam) return { epic, steam };
  const live = await fromRunningGame();
  return { epic: live && live.platform === 'epic' ? live.dir : null, steam: live && live.platform === 'steam' ? live.dir : null };
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

module.exports = { cookedDir, isValidInstall, isRocketLeague, detectEpic, detectSteam, fromRunningGame, detect, isRunning, isProcessRunning, launchUrl };
