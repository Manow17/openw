// Core tests. They never write to the real game folder: packages are copied
// into a temp "CookedPCConsole" first. Tests that need game files are skipped
// when Rocket League is not installed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

const game = require('../src/main/core/game');
const upk = require('../src/main/core/upk');
const { buildCatalog, annotate, canSwap, prettify } = require('../src/main/core/catalog');
const { readThumbnail, decodeDxt } = require('../src/main/core/thumbs');
const { Engine } = require('../src/main/core/engine');
const { Store } = require('../src/main/core/store');
const { Maps, MAP_SLOT } = require('../src/main/core/library');
const arenas = require('../src/main/core/arenas');
const mapbuild = require('../src/main/core/mapbuild');
const { readLabels, readTexts, applyLabels } = require('../src/main/core/labels');

const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openw-test-'));
let passed = 0, skipped = 0;
const tests = [];
function test(name, fn, skip) { tests.push({ name, fn, skip }); }
async function runAll() {
  for (const { name, fn, skip } of tests) { // one at a time: they share a folder
    if (skip) { skipped++; console.log(`  skip  ${name}`); continue; }
    try { await fn(); passed++; console.log(`  ok    ${name}`); }
    catch (e) { process.exitCode = 1; console.log(`  FAIL  ${name}\n        ${e.stack}`); }
  }
}

function makeEngine(cooked, running = { value: false }) {
  const data = fs.mkdtempSync(path.join(tmp, 'data-'));
  const engine = new Engine({
    store: new Store(path.join(data, 'state.json')),
    backupDir: path.join(data, 'backups'),
    getCookedDir: () => cooked,
    isRunning: async () => running.value,
  });
  return { engine, running, data };
}

(async () => {
  const found = await game.detect();
  const install = found.epic || found.steam;
  const real = install ? game.cookedDir(install) : null;
  console.log(`game: ${install || 'not installed'}`);

  test('prettify item names', () => {
    assert.strictEqual(prettify('AlphaReward'), 'Alpha Reward');
    assert.strictEqual(prettify('star_holo'), 'Star Holo');
  });

  test('arenas are known by name even without a key list', () => {
    if (!real) return;
    const { readTexts } = require('../src/main/core/labels');
    const list = arenas.scanArenas(real, {}, [], readTexts(real, []).maps);
    const standard = list.filter((a) => a.standard);
    assert.ok(standard.length >= 55, 'standard arenas without a key list: ' + standard.length);
    assert.ok(standard.some((a) => a.id === 'stadium_p' && a.name === 'DFH Stadium'));
  });

  test('updates: versions compare, the newest usable release is picked, its SHA-256 is read', () => {
    const { compare, pickRelease, checksum } = require('../src/main/updater');
    assert.ok(compare('0.4.1', '0.4.0') > 0 && compare('v0.10.0', '0.9.9') > 0 && compare('0.4.0', '0.4.0') === 0);
    assert.ok(compare('0.5.0-beta', '0.5.0') < 0 && compare('0.5.0-beta', '0.4.9') > 0);
    const sha = 'a'.repeat(64);
    const rel = (tag, opts = {}) => ({ tag_name: tag, draft: !!opts.draft, body: opts.body || '', html_url: 'u', assets: opts.noSetup ? [] : [{ name: 'OpenW-Setup-' + tag.slice(1) + '.exe', browser_download_url: 'https://x/' + tag, size: 9, digest: opts.digest }] });
    const list = [rel('v0.4.0'), rel('v0.4.2', { draft: true }), rel('v0.4.1', { body: 'SHA-256: ' + '\x60' + sha + '\x60' }), rel('v0.5.0', { noSetup: true })];
    const pick = pickRelease(list, '0.4.0');
    assert.deepStrictEqual([pick.version, pick.file, pick.sha256], ['0.4.1', 'OpenW-Setup-0.4.1.exe', sha]);
    assert.strictEqual(pickRelease(list, '0.4.1'), null, 'nothing newer: no draft, no release without a setup');
    assert.strictEqual(checksum({ digest: 'sha256:' + 'B'.repeat(64) }, ''), 'b'.repeat(64), 'GitHub\'s own digest comes first');
    // the setup needs administrator rights: it is started through the shell, with Windows' prompt, silently, and starts OpenW again
    const { setupCommand } = require('../src/main/updater');
    assert.strictEqual(setupCommand("C:\\Users\\O'Neil\\OpenW-Setup-0.4.6.exe"), "Start-Process -FilePath 'C:\\Users\\O''Neil\\OpenW-Setup-0.4.6.exe' -ArgumentList '/S','--updated','--force-run' -Verb RunAs -ErrorAction Stop");
    const { nextVersion } = require('../scripts/release-version');
    assert.strictEqual(nextVersion('0.4.1', ['v0.4.0']), '0.4.1');
    assert.strictEqual(nextVersion('0.4.1', ['v0.4.0', 'v0.4.1']), '0.4.2');
    assert.strictEqual(nextVersion('0.4.0', ['v0.4.0', 'v0.4.3', 'v0.3.9']), '0.4.4');
    assert.strictEqual(nextVersion('0.5.0', ['v0.4.7']), '0.5.0');
  });

  test('Rocket League is found in every place Epic launchers record it', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'epic-'));
    const install = path.join(dir, 'Games', 'rocketleague');
    fs.mkdirSync(path.join(install, 'TAGame', 'CookedPCConsole'), { recursive: true });
    for (let i = 0; i < game.MIN_PACKAGES; i++) fs.writeFileSync(path.join(install, 'TAGame', 'CookedPCConsole', `Pkg${i}.upk`), '');
    const manifests = path.join(dir, 'Manifests');
    fs.mkdirSync(manifests);
    // another game first, then Rocket League recorded by app name
    fs.writeFileSync(path.join(manifests, 'a.item'), JSON.stringify({ AppName: 'Fortnite', InstallLocation: dir }));
    fs.writeFileSync(path.join(manifests, 'b.item'), JSON.stringify({ AppName: 'Sugar', InstallLocation: install }));
    assert.strictEqual(await game.detectEpic({ manifestDirs: [path.join(dir, 'nothing'), manifests], installedLists: [], drives: [] }), install);
    // a launcher that names it differently: by display name or the program it starts
    fs.writeFileSync(path.join(manifests, 'b.item'), JSON.stringify({ AppName: 'x1', DisplayName: 'Rocket League®', InstallLocation: install }));
    assert.strictEqual(await game.detectEpic({ manifestDirs: [manifests], installedLists: [], drives: [] }), install);
    // no manifests at all: the launcher's list of installed games
    const list = path.join(dir, 'LauncherInstalled.dat');
    fs.writeFileSync(list, JSON.stringify({ InstallationList: [{ AppName: 'Sugar', InstallLocation: install }] }));
    assert.strictEqual(await game.detectEpic({ manifestDirs: [], installedLists: [list], drives: [] }), install);
    // a record of a folder that is gone is not an install
    fs.writeFileSync(list, JSON.stringify({ InstallationList: [{ AppName: 'Sugar', InstallLocation: path.join(dir, 'gone') }] }));
    assert.strictEqual(await game.detectEpic({ manifestDirs: [], installedLists: [list], drives: [] }), null);
    // a folder an old install left behind (the folders, not the game's files) is not an install, and says why
    const left = path.join(dir, 'Old', 'rocketleague');
    fs.mkdirSync(path.join(left, 'TAGame', 'CookedPCConsole'), { recursive: true });
    fs.writeFileSync(path.join(manifests, 'b.item'), JSON.stringify({ AppName: 'Sugar', InstallLocation: left }));
    assert.strictEqual(await game.detectEpic({ manifestDirs: [manifests], installedLists: [], drives: [] }), null);
    assert.ok(!game.isValidInstall(left) && game.isValidInstall(install));
    assert.match(game.whyNotInstall(left), /holds 0 game packages/);
    assert.match(game.whyNotInstall(dir), /has no TAGame/);
    // the game's own log names the folder it ran from, whatever launcher installed it; the newest log wins
    const docs = path.join(dir, 'Docs');
    const logs = path.join(docs, 'My Games', 'Rocket League', 'TAGame', 'Logs');
    fs.mkdirSync(logs, { recursive: true });
    const base = (d) => 'Init: Base directory: ' + path.join(d, 'Binaries', 'Win64') + path.sep + '\r\n';
    fs.writeFileSync(path.join(logs, 'Launch-backup-old.log'), 'Log: Log file open\r\n' + base(left));
    fs.writeFileSync(path.join(logs, 'Launch.log'), 'Log: Log file open\r\nInit: Version: 1\r\n' + base(install) + 'Init: other\r\n');
    assert.deepStrictEqual(game.fromGameLogs([path.join(dir, 'nothing'), docs]), { dir: install, platform: 'epic' });
    const found = await game.detect({ documents: [docs], epic: { manifestDirs: [], installedLists: [], drives: [] }, steam: false });
    assert.strictEqual(found.epic, install);
  });

  test('store round-trips', () => {
    const f = path.join(tmp, 's.json');
    new Store(f, { a: 1 }).set('b', [2]);
    assert.deepStrictEqual(new Store(f).data, { a: 1, b: [2] });
  });

  test('catalog lists items from the install', () => {
    const cat = buildCatalog(real);
    const count = (c) => cat.items.filter((i) => i.category === c).length;
    assert.ok(count('cars') > 50 && count('wheels') > 200 && count('decals') > 500);
    assert.ok(cat.items.every((i) => !/_T_SF\.upk$/i.test(i.file)));
    console.log(`        ${cat.items.length} items in ${cat.categories.length} categories`);
  }, !real);

  // Pick a few real wheel packages to work on, copied to a temp folder.
  let cooked = null, files = [];
  if (real) {
    cooked = path.join(tmp, 'CookedPCConsole');
    fs.mkdirSync(cooked);
    files = buildCatalog(real).items.filter((i) => i.category === 'wheels').map((i) => i.file)
      .sort((a, b) => a.length - b.length);
    // Newer packages use keys OpenW does not have; test with ones it can read.
    const readable = (f) => { try { upk.readPackageFile(path.join(real, f)); return true; } catch { return false; } };
    const mid = Math.floor(files.length / 2);
    files = [files.find(readable), files.slice(mid).find(readable), files.findLast(readable)];
    for (const f of [...files, MAP_SLOT]) fs.copyFileSync(path.join(real, f), path.join(cooked, f));
  }
  const [shortF, midF, longF] = files;

  test('package header decrypts and the name table parses', () => {
    for (const f of files) {
      const pkg = upk.readPackageFile(path.join(cooked, f));
      assert.strictEqual(pkg.names.length, pkg.summary.nameCount);
      const base = upk.baseName(f).toLowerCase();
      assert.ok(pkg.names.some((n) => n.text.toLowerCase() === base), `${f} has no "${base}" name`);
    }
  }, !real);

  test('rename is in place: same size, only the header block changes', () => {
    const buf = fs.readFileSync(path.join(cooked, longF));
    const from = upk.baseName(longF), to = upk.baseName(shortF);
    const res = upk.renameNames(buf, [{ from, to }, { from: `${from}_SF`, to: `${to}_SF` }]);
    assert.strictEqual(res.buffer.length, buf.length);
    const before = upk.readPackage(buf), after = upk.readPackage(res.buffer);
    const { start, size } = before.range;
    assert.ok(buf.subarray(0, start).equals(res.buffer.subarray(0, start)));
    assert.ok(buf.subarray(start + size).equals(res.buffer.subarray(start + size)));
    assert.strictEqual(after.names.length, before.names.length);
    assert.ok(after.names.some((n) => n.text === to));
    assert.ok(!after.names.some((n) => n.text.toLowerCase() === from.toLowerCase()));
    const changed = after.names.filter((n, i) => n.text !== before.names[i].text).length;
    assert.strictEqual(changed, res.renamed.length);
  }, !real);

  test('a longer name is refused, not truncated', () => {
    const buf = fs.readFileSync(path.join(cooked, shortF));
    assert.throws(
      () => upk.renameNames(buf, [{ from: upk.baseName(shortF), to: upk.baseName(longF) }]),
      (e) => e.code === 'NAME_TOO_LONG',
    );
  }, !real);

  test('swap writes the file, keeps a backup, and revert restores it exactly', async () => {
    const { engine, data } = makeEngine(cooked);
    const dest = path.join(cooked, shortF);
    const original = sha(dest);
    assert.deepStrictEqual(engine.checkSwap({ kind: 'swap', sourceFile: shortF, targetFile: longF }), { ok: true });
    const res = await engine.apply({ kind: 'swap', sourceFile: shortF, targetFile: longF });
    assert.strictEqual(res.queued, false);
    assert.notStrictEqual(sha(dest), original);
    assert.strictEqual(sha(path.join(data, 'backups', shortF.toLowerCase())), original);
    // the swapped package now answers to the source item's name
    const base = upk.baseName(shortF).toLowerCase();
    assert.ok(upk.readPackageFile(dest).names.some((n) => n.text.toLowerCase() === base));
    // applying a second swap on top must not overwrite the pristine backup
    await engine.apply({ kind: 'swap', sourceFile: shortF, targetFile: midF });
    assert.strictEqual(sha(path.join(data, 'backups', shortF.toLowerCase())), original);
    await engine.revert(shortF.toLowerCase());
    assert.strictEqual(sha(dest), original);
    assert.strictEqual(engine.list().active.length, 0);
    assert.ok(!fs.existsSync(path.join(data, 'backups', shortF.toLowerCase())));
  }, !real);

  /* ---------- item swaps that show in game (core/looks.js) ---------- */
  const looks = require('../src/main/core/looks');
  const { swapProblem } = require('../src/shared/swap');

  test('swaps: which looks an item can take, from where the game finds each look', () => {
    const it = (id, path, len = path[0].length, extra = {}) => ({ id, path, len, ok: true, ...extra });
    const star = it('wheel_star', ['WHEEL_Star', 'WHEEL_Star']);
    const alpha = it('wheel_alpharim', ['WHEEL_AlphaRim', 'WHEEL_AlphaRim']);
    const grouped = it('boost_bloodshot', ['boost_bloodshot', 'FX', 'boost_bloodshot']);
    const tier = it('boost_anime', ['boost_anime', 'boost_anime_tier1']);
    const tier2 = it('boost_comet', ['boost_comet', 'boost_comet_tier1']);
    assert.strictEqual(swapProblem(star, alpha), '');
    assert.strictEqual(swapProblem(star, grouped), '', 'a look kept in a group is moved to where the game looks');
    assert.strictEqual(swapProblem(alpha, star), 'long', 'the internal name has to fit');
    const standard = it('boost_standard', ['Boost_Standard', 'Boost_Standard']);
    assert.strictEqual(swapProblem(tier, standard), 'tiered', 'a tier needs a look with its own name to rename');
    assert.strictEqual(swapProblem(tier, tier2), '');
    assert.strictEqual(swapProblem(star, { ...alpha, ok: false }), 'key');
    assert.strictEqual(swapProblem({ ...star, stuck: 'TAGame.upk' }, alpha), 'stuck');
    assert.strictEqual(swapProblem(star, star), 'same');
    assert.ok(canSwap(star, alpha) && !canSwap(tier, standard));
    // without the item list a look is at <package>.<package>
    assert.deepStrictEqual(looks.assetPath({}, 'WHEEL_Star_SF.upk'), ['WHEEL_Star', 'WHEEL_Star']);
    const products = { boost_anime: [['boost_anime_tier2', 'boost_anime.boost_anime_tier2'], ['boost_anime_tier1', 'boost_anime.boost_anime_tier1']], wheel_star: [['wheel_star_holo', 'WHEEL_Star.WHEEL_Star'], ['WHEEL_Star', 'WHEEL_Star.WHEEL_Star']] };
    assert.deepStrictEqual(looks.assetPath(products, 'boost_anime_SF.upk'), ['boost_anime', 'boost_anime_tier1']);
    assert.deepStrictEqual(looks.assetPath(products, 'WHEEL_Star_SF.upk'), ['WHEEL_Star', 'WHEEL_Star']);
  });

  test('swaps: the new look is put exactly where the game looks for the item, also when it is kept in a group', () => {
    const products = looks.readProducts(real, []);
    assert.ok(Object.keys(products).length > 5000, 'the item list is read from TAGame.upk');
    const ap = (f) => looks.assetPath(products, f);
    assert.deepStrictEqual(ap('WHEEL_Star_SF.upk'), ['WHEEL_Star', 'WHEEL_Star']);
    const keyOf = (f) => upk.keyOfFile(path.join(real, f), []);
    const backups = path.join(process.env.APPDATA || '', 'OpenW', 'backups');
    const original = (f) => (fs.existsSync(path.join(backups, f.toLowerCase())) ? path.join(backups, f.toLowerCase()) : path.join(real, f));
    const swapped = (src, tgt) => {
      const buf = fs.readFileSync(original(tgt));
      const out = looks.swapLook(buf, ap(src), ap(tgt), [], keyOf(src));
      assert.strictEqual(out.length, buf.length, 'header only: the file keeps its size');
      const T = upk.headerTables(upk.readPackage(out, []));
      const at = T.findExport(ap(src));
      assert.ok(at >= 0, `${src} <- ${tgt}: no object at ${ap(src).join('.')}`);
      return { T, at };
    };
    // the user's swap: OEM wheels with the look of Goldstone
    if (fs.existsSync(path.join(real, 'WHEEL_AlphaRim_SF.upk'))) {
      const { T } = swapped('WHEEL_Star_SF.upk', 'WHEEL_AlphaRim_SF.upk');
      assert.ok(T.findExport(['WHEEL_Star', 'WHEEL_AlphaRim_SM']) >= 0, 'with the Goldstone mesh');
    }
    // a look kept in a group ("<pkg>.FX.<pkg>") is moved up to "<pkg>.<pkg>", and the other way round
    const items = buildCatalog(real).items;
    const readable = (i) => upk.probeFile(path.join(real, i.file), []);
    const groupedT = items.find((i) => ap(i.file).length === 3 && i.category === 'boosts' && readable(i));
    const plainS = groupedT && items.find((i) => i.category === 'boosts' && ap(i.file).length === 2 && i.len <= groupedT.len && readable(i) && !/_T$/i.test(i.file));
    if (groupedT && plainS) {
      const { T, at } = swapped(plainS.file, groupedT.file);
      assert.strictEqual(T.exports[at].outer, T.findExport([ap(plainS.file)[0]]) + 1, 'straight under the package');
    }
    // a pair that cannot work is refused with a reason, not written so it never shows
    const tiered = items.find((i) => { const p = ap(i.file); return p.length === 2 && p[1].toLowerCase() !== p[0].toLowerCase() && readable(i); });
    const simple = tiered && items.find((i) => i.category === tiered.category && ap(i.file)[0].length >= tiered.len && ap(i.file).length === 2 && ap(i.file)[0].toLowerCase() === ap(i.file)[1].toLowerCase() && readable(i));
    if (tiered && simple) assert.throws(() => looks.swapLook(fs.readFileSync(path.join(real, simple.file)), ap(tiered.file), ap(simple.file), []), (e) => e.code === 'TIERED');
  }, !real);

  test('swaps: default items the game loads early (OEM wheels, Standard boost) get that copy renamed, and it reverts exactly', async () => {
    const products = looks.readProducts(real, []);
    const want = new Set(Object.values(products).flat().map(([, p]) => p.toLowerCase()));
    const backups = path.join(process.env.APPDATA || '', 'OpenW', 'backups');
    const original = (f) => (fs.existsSync(path.join(backups, f.toLowerCase())) ? path.join(backups, f.toLowerCase()) : path.join(real, f));
    const scan = looks.scanEarly(real, want, [], original);
    // the OEM wheel is in Startup.upk, which the game always has loaded; the menu's intro scenes point to it
    const star = scan['wheel_star.wheel_star'];
    assert.ok(star && star.exports.includes('Startup.upk'), 'OEM wheels are copied into Startup.upk');
    const ops = looks.hideOps([['WHEEL_Star', 'WHEEL_Star'], ['Boost_Standard', 'Boost_Standard'], ['WHEEL_AlphaRim', 'WHEEL_AlphaRim']], scan);
    const startup = ops.find((o) => o.gameFile === 'Startup.upk');
    assert.ok(startup && startup.paths.includes('wheel_star.wheel_star'));
    for (const f of star.imports) assert.ok(ops.some((o) => o.gameFile === f && o.paths.includes('wheel_star.wheel_star')), `${f} keeps finding the early copy`);
    if (scan['boost_standard.boost_standard']) assert.ok(ops.some((o) => o.paths.includes('boost_standard.boost_standard')), 'the Standard boost is copied into a menu scene');
    assert.ok(!ops.some((o) => o.paths.includes('wheel_alpharim.wheel_alpharim')), 'an item no early package carries needs nothing');
    // what changes: only that one object's name in Startup.upk; the rest of the OEM wheel stays
    const dir = fs.mkdtempSync(path.join(tmp, 'early-'));
    fs.copyFileSync(original('Startup.upk'), path.join(dir, 'Startup.upk'));
    const before = sha(path.join(dir, 'Startup.upk'));
    const { engine, data } = makeEngine(dir);
    await engine.apply(startup);
    const T = upk.headerTables(upk.readPackageFile(path.join(dir, 'Startup.upk')));
    assert.strictEqual(T.findExport(['WHEEL_Star', 'WHEEL_Star']), -1, 'the game no longer finds the early copy');
    assert.ok(T.findExport(['WHEEL_Star', `WHEEL_Star_${looks.HIDE_NUMBER - 1}`]) >= 0);
    assert.ok(T.findExport(['WHEEL_Star', 'OEM_Combined_RGB']) >= 0, 'textures other wheels use stay');
    assert.strictEqual(fs.statSync(path.join(dir, 'Startup.upk')).size, fs.statSync(original('Startup.upk')).size);
    await engine.revert('startup.upk');
    assert.strictEqual(sha(path.join(dir, 'Startup.upk')), before);
    assert.ok(!fs.existsSync(path.join(data, 'backups', 'startup.upk')));
  }, !real);

  test('swaps: the early copies follow the swaps that are on or queued', () => {
    const scan = {
      'wheel_star.wheel_star': { exports: ['Startup.upk'], imports: ['MENU_X.upk'], untouchable: [] },
      'boost_standard.boost_standard': { exports: ['NUE_X.upk'], imports: ['MENU_Y.upk'], untouchable: [] },
    };
    const ap = (f) => { const b = upk.baseName(f); return [b, b]; };
    const swap = (src) => ({ kind: 'swap', sourceFile: src, targetFile: 'x_SF.upk' });
    const rec = (key, op) => ({ key, op });
    // nothing yet: Startup and the scene that points to it get the wheel; the boost's scene only its own
    let plan = looks.planHides({ active: [rec('wheel_star_sf.upk', swap('WHEEL_Star_SF.upk')), rec('boost_standard_sf.upk', swap('Boost_Standard_SF.upk'))], queue: [] }, ap, scan);
    assert.deepStrictEqual(plan.apply.map((o) => [o.gameFile, o.paths]), [['MENU_X.upk', ['wheel_star.wheel_star']], ['NUE_X.upk', ['boost_standard.boost_standard']], ['Startup.upk', ['wheel_star.wheel_star']]]);
    assert.ok(!plan.apply.some((o) => o.gameFile === 'MENU_Y.upk'), 'a copy only its own scene loads: what points to it is left alone');
    // already right: nothing to do
    const hides = plan.apply.map((o) => rec(o.gameFile.toLowerCase(), o));
    plan = looks.planHides({ active: [rec('wheel_star_sf.upk', swap('WHEEL_Star_SF.upk')), rec('boost_standard_sf.upk', swap('Boost_Standard_SF.upk')), ...hides], queue: [] }, ap, scan);
    assert.deepStrictEqual(plan, { apply: [], revert: [], unqueue: [] });
    // the wheel swap reverted (queued while the game runs): its early copies go back too
    plan = looks.planHides({ active: [rec('wheel_star_sf.upk', swap('WHEEL_Star_SF.upk')), rec('boost_standard_sf.upk', swap('Boost_Standard_SF.upk')), ...hides], queue: [{ key: 'wheel_star_sf.upk', type: 'revert' }] }, ap, scan);
    assert.deepStrictEqual(plan.revert.sort(), ['menu_x.upk', 'startup.upk']);
    // a queued hide whose swap is cancelled is taken off the queue
    plan = looks.planHides({ active: [], queue: [{ key: 'startup.upk', type: 'apply', op: hides.find((h) => h.key === 'startup.upk').op }] }, ap, scan);
    assert.deepStrictEqual(plan.unqueue, ['startup.upk']);
  });

  test('swaps from before 0.4.10 are built again once, the way the game reads them', async () => {
    const { engine } = makeEngine(cooked);
    await engine.apply({ kind: 'swap', sourceFile: shortF, targetFile: longF });
    const active = engine.store.get('active');
    delete active[shortF.toLowerCase()].rev; // as an older version wrote it
    engine.store.set('active', active);
    assert.strictEqual(engine.rebuildSwaps().length, 1);
    assert.strictEqual(engine.rebuildSwaps().length, 0, 'only once');
    await engine.revert(shortF.toLowerCase());
  }, !real);

  test('changes are queued while the game runs and applied when it closes', async () => {
    const { engine, running } = makeEngine(cooked, { value: true });
    const dest = path.join(cooked, midF);
    const original = sha(dest);
    const res = await engine.apply({ kind: 'swap', sourceFile: midF, targetFile: longF });
    assert.strictEqual(res.queued, true);
    assert.strictEqual(sha(dest), original);
    assert.deepStrictEqual(await engine.flushQueue(), []); // still running: nothing happens
    running.value = false;
    const done = await engine.flushQueue();
    assert.ok(done.length === 1 && done[0].ok);
    assert.notStrictEqual(sha(dest), original);
    await engine.revertAll();
    assert.strictEqual(sha(dest), original);
  }, !real);

  test('queued changes go in one file at a time, and wait again if the game starts meanwhile', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'queue-'));
    const files = ['a.upk', 'b.upk', 'c.upk'];
    for (const f of files) fs.writeFileSync(path.join(dir, f), `original ${f}`);
    const src = path.join(tmp, 'queue-new.bin');
    fs.writeFileSync(src, 'new');
    const { engine, running } = makeEngine(dir, { value: true });
    for (const f of files) assert.strictEqual((await engine.apply({ kind: 'file', gameFile: f, from: src })).queued, true);
    running.value = false;
    const seen = [];
    const done = await engine.flushQueue((n, total) => { seen.push(`${n}/${total}`); running.value = true; }); // the game starts after the first
    assert.deepStrictEqual(seen, ['1/3']);
    assert.deepStrictEqual(done.map((d) => [d.key, d.ok]), [['a.upk', true]]);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'a.upk'), 'utf8'), 'new');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'b.upk'), 'utf8'), 'original b.upk');
    assert.deepStrictEqual(engine.list().queue.map((q) => q.key), ['b.upk', 'c.upk']);
    running.value = false;
    assert.strictEqual((await engine.flushQueue()).filter((d) => d.ok).length, 2);
    assert.strictEqual(engine.list().queue.length, 0);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'c.upk'), 'utf8'), 'new');
    await engine.revertAll();
    for (const f of files) assert.strictEqual(fs.readFileSync(path.join(dir, f), 'utf8'), `original ${f}`);
  });

  test('a build written into several arena files is made once', async () => {
    const keysFile = path.join(process.env.APPDATA || '', 'OpenW', 'keys.txt');
    const file = path.join(real || '', 'Farm_GRS_P.upk');
    if (!fs.existsSync(keysFile) || !fs.existsSync(file)) return;
    const keys = upk.parseKeys(fs.readFileSync(keysFile, 'utf8'));
    const backup = path.join(process.env.APPDATA, 'OpenW', 'backups', 'farm_grs_p.upk');
    const dir = fs.mkdtempSync(path.join(tmp, 'builds-'));
    fs.copyFileSync(fs.existsSync(backup) ? backup : file, path.join(dir, 'Farm_GRS_P.upk'));
    const engineWith = () => new Engine({ store: new Store(path.join(fs.mkdtempSync(path.join(tmp, 'data-')), 'state.json')), backupDir: path.join(tmp, 'unused'), getCookedDir: () => dir, isRunning: async () => false, getKeys: () => keys });
    const op = (gameFile, extra = {}) => ({ kind: 'build', gameFile, from: 'Farm_GRS_P.upk', side: 'surroundings', create: true, renames: { Farm_SFX: 'BPabcd12' }, ...extra });
    const open = mapbuild.open;
    let opens = 0;
    mapbuild.open = (...a) => { opens++; return open(...a); };
    try {
      const engine = engineWith();
      for (const f of ['One_P.upk', 'Two_P.upk', 'Three_P.upk']) await engine.apply(op(f));
      assert.strictEqual(opens, 1, 'the same build was made again for each file');
      await engine.apply(op('Four_P.upk', { side: 'stadium' })); // a different build is made anew
      assert.strictEqual(opens, 2);
      // what is written is what a build of its own gives, byte for byte
      const alone = engineWith().buildContent(op('Two_P.upk'));
      assert.strictEqual(crypto.createHash('sha1').update(alone).digest('hex'), sha(path.join(dir, 'Two_P.upk')));
      const t = upk.readTables(fs.readFileSync(path.join(dir, 'Three_P.upk')), keys);
      assert.ok(t.names.includes('BPabcd12'));
    } finally { mapbuild.open = open; }
  }, !real);

  test('a file replaced by a game update is left alone on revert', async () => {
    const { engine, data } = makeEngine(cooked);
    const dest = path.join(cooked, midF);
    const original = fs.readFileSync(dest);
    await engine.apply({ kind: 'swap', sourceFile: midF, targetFile: longF });
    const updated = Buffer.concat([original, Buffer.from('new game version')]);
    fs.writeFileSync(dest, updated); // simulate the launcher patching the file
    assert.deepStrictEqual(engine.reconcile(), [midF.toLowerCase()]);
    assert.ok(fs.readFileSync(dest).equals(updated));
    assert.ok(!fs.existsSync(path.join(data, 'backups', midF.toLowerCase())));
    fs.writeFileSync(dest, original);
  }, !real);

  test('workshop map takes the Underpass slot and unloads cleanly', async () => {
    const { engine, data } = makeEngine(cooked);
    const maps = new Maps(path.join(data, 'maps'));
    const fake = path.join(tmp, 'My_Test_Map.upk');
    fs.writeFileSync(fake, 'not a real map');
    assert.deepStrictEqual(maps.add([fake, path.join(tmp, 's.json')]), ['My_Test_Map.upk']);
    const slot = path.join(cooked, MAP_SLOT);
    const original = sha(slot);
    await engine.apply(maps.op('My_Test_Map.upk'));
    assert.strictEqual(fs.readFileSync(slot, 'utf8'), 'not a real map');
    await engine.revert(MAP_SLOT.toLowerCase());
    assert.strictEqual(sha(slot), original);
  }, !real);

  test('arena names and part kinds', () => {
    assert.strictEqual(arenas.arenaName('CS_Day_P'), 'Champions Field (Day)');
    assert.strictEqual(arenas.arenaName('Stadium_P'), 'DFH Stadium');
    assert.strictEqual(arenas.arenaName('FNI_Stadium_P'), 'Forbidden Temple (Fire & Ice)');
    assert.strictEqual(arenas.arenaName('Labs_Basin_P'), 'Labs Basin');
    assert.deepStrictEqual(['CS_Field', 'CS_OOB2', 'CHN_Stadium_VFX', 'CS_Lights', 'Park_SFX'].map(arenas.partKind), ['field', 'surroundings', 'effects', 'lights', 'audio']);
  });

  test('every pair of standard arenas gets a merge, the best kind that fits', () => {
    const part = (file) => ({ file, kind: arenas.partKind(file.replace(/\.upk$/, '')) });
    const arena = (id, name, parts, standard = true) => ({
      id, name, file: `${id}.upk`, standard, parts: parts.map(part),
      field: (parts.find((p) => /_Field\.upk$/.test(p)) || null),
    });
    const beach = arena('beach_p', 'Salty Shores', ['Beach_Field.upk', 'Beach_OOB.upk', 'Beach_OOB2.upk']);
    const cs = arena('cs_p', 'Champions Field', ['CS_Field.upk', 'CS_OOB.upk', 'CS_OOB2.upk']);
    const tenth = arena('stadium_10a_p', 'DFH Stadium (10th Anniversary)', ['Stadium_10A_OOB.upk', 'Stadium_10A_SFX.upk']);
    const dusk = arena('ff_dusk_p', 'Estadio Vida', ['FF_Dusk_OOB.upk', 'FF_Dusk_BlueOOB.upk', 'FF_Dusk_SFX.upk']);
    const park = arena('park_p', 'Beckwith Park', ['Park_SFX.upk']);
    const hoops = arena('hoopsstadium_p', 'Dunk House', [], false);
    const all = [beach, cs, tenth, dusk, park, hoops];
    // built merges: [file, from, side, created, gameplay], and the renames of the main file
    const built = (p) => p.ops.map((o) => [/^BP[0-9a-f]+\.upk$/.test(o.gameFile) ? 'new' : o.gameFile, o.from, o.side, !!o.create, !!o.gameplay]);
    const renamed = (p) => Object.keys(p.ops[p.ops.length - 1].renames);
    // the place arena stays its own map (sky, light, fog, gameplay) with only its stadium out; its stadium
    // file loads the other arena's stadium; its outside parts load without their stadium pieces
    let p = arenas.mergePlan(beach, cs, all);
    assert.deepStrictEqual([p.how, p.play.map((a) => a.id)], ['build', ['cs_p']]);
    assert.deepStrictEqual(built(p), [
      ['new', 'Beach_Field.upk', 'stadium', true, false], ['new', 'CS_OOB.upk', 'surroundings', true, false], ['new', 'CS_OOB2.upk', 'surroundings', true, false],
      ['cs_p.upk', 'cs_p.upk', 'surroundings', false, true]]);
    assert.deepStrictEqual(renamed(p), ['CS_Field', 'CS_OOB', 'CS_OOB2']);
    assert.ok(p.ops.filter((o) => o.side === 'stadium').every((o) => o.lights === false && o.gameplay === false), 'the stadium brings no lights or gameplay');
    assert.ok(p.ops[p.ops.length - 1].lights === true, 'the place keeps its lights');
    assert.match(p.note, /did not fit/); // only one slot: Salty Shores' main map stays out
    // a one-file stadium arena: its main map, stadium side, in the place's stadium file
    p = arenas.mergePlan(dusk, beach, all);
    assert.deepStrictEqual(built(p), [
      ['new', 'ff_dusk_p.upk', 'stadium', true, false], ['new', 'Beach_OOB.upk', 'surroundings', true, false], ['new', 'Beach_OOB2.upk', 'surroundings', true, false],
      ['beach_p.upk', 'beach_p.upk', 'surroundings', false, true]]);
    // a place with only a sound part: the stadium loads there, and its background sounds go quiet
    p = arenas.mergePlan(tenth, park, all);
    assert.deepStrictEqual(built(p), [['new', 'stadium_10a_p.upk', 'stadium', true, false], ['park_p.upk', 'park_p.upk', 'surroundings', false, true]]);
    assert.deepStrictEqual(renamed(p), ['Park_SFX']);
    assert.match(p.note, /background sounds/);
    assert.ok(p.ops.every((o) => !o.create || o.gameFile.length - 4 <= 'Park_SFX'.length), 'new names fit in the slot they replace');
    // a place with no part files at all: the stadium arena's map is the base, the place's main map first in its parts
    const mann = arena('eurostadium_p', 'Mannfield', []);
    p = arenas.mergePlan(tenth, mann, [...all, mann]);
    assert.deepStrictEqual(built(p), [['new', 'eurostadium_p.upk', 'surroundings', true, false], ['eurostadium_p.upk', 'stadium_10a_p.upk', 'stadium', false, true]]);
    assert.match(p.note, /light and fog/);
    assert.strictEqual(arenas.mergePlan(mann, arena('eurostadium_dusk_p', 'Mannfield (Dusk)', []), all).how, 'none');
    // with what was read from the maps: each side gets the right stadium region to keep or to clear
    const R = [{ x0: -6000, x1: 6000, y0: -8000, y1: 8000 }], R2 = [{ x0: -5000, x1: 5000, y0: -7000, y1: 7000 }];
    p = arenas.mergePlan(beach, cs, all, { stadiumRegion: R, placeRegion: R2, stadiumHolders: new Set(['beach_p.upk']), placeHolders: new Set() });
    // (the stadium side needs no region since 0.4.13: what is stadium is decided piece by piece; the
    // place clears where the stadium's pieces stand)
    assert.ok(p.ops.every((o) => (o.side === 'stadium' ? o.region === null && o.clear.length === 0 : o.clear === R)));
    assert.ok(p.ops.every((o) => o.rev === arenas.MERGE_REV) && !arenas.oldMerge(p.ops[0]) && arenas.oldMerge({ kind: 'build' }));
    assert.ok(p.ops.some((o) => o.from === 'CS_OOB.upk'), 'an outside part is filtered even without stadium pieces, to clear the new stadium');
    // every file of one merge shares a group, so it is undone as one
    assert.ok(arenas.mergePlan(dusk, beach, all).ops.every((o) => o.group === 'merge:ff_dusk_p:beach_p' && o.label === 'Estadio Vida stadium in Salty Shores'));
    // a different pitch cannot be swapped whole
    assert.strictEqual(arenas.mergePlan(park, hoops, all).how, 'none');
    assert.strictEqual(arenas.mergePlan(park, park, all).how, 'none');
  });

  test('arenas are scanned from the install with their parts', () => {
    const cache = {};
    const backups = path.join(process.env.APPDATA || '', 'OpenW', 'backups');
    const original = (f) => (fs.existsSync(path.join(backups, f.toLowerCase())) ? path.join(backups, f.toLowerCase()) : path.join(real, f));
    const list = arenas.scanArenas(real, cache, [], new Map(), original);
    const cs = list.find((a) => a.id === 'cs_p'), beach = list.find((a) => a.id === 'beach_p'), park = list.find((a) => a.id === 'park_p');
    assert.ok(list.length > 50 && cs && beach && park);
    assert.strictEqual(cs.field.toLowerCase(), 'cs_field.upk');
    assert.strictEqual(park.field, null, 'Beckwith Park is a single file');
    assert.strictEqual(arenas.snowPlan(park, list).how, 'version');
    // scanned without the game's text, so "standard" is not known here
    const plan = arenas.mergePlan({ ...beach, standard: true }, { ...cs, standard: true }, list);
    assert.strictEqual(plan.how, 'build');
    const main = plan.ops[plan.ops.length - 1];
    // Champions Field stays its own map; its stadium file loads Salty Shores' stadium
    assert.deepStrictEqual([main.gameFile, main.from, main.side, main.gameplay], [cs.file, cs.file, 'surroundings', true]);
    assert.ok(plan.ops.some((o) => o.from === beach.field && o.side === 'stadium' && main.renames[cs.field.replace(/\.upk$/i, '')] === o.gameFile.replace(/\.upk$/i, '')));
    const again = arenas.scanArenas(real, cache, [], new Map(), original); // second pass comes from the cache
    assert.strictEqual(again.length, list.length);
    console.log(`        ${list.length} arenas, ${list.filter((a) => a.field).length} with a stadium part, ${list.filter((a) => arenas.snowPlan(a, list)).length} with a snow option`);
  }, !real);

  test('a merge, snow or every match that needs a file OpenW cannot open says which arena and file, before anything is written', () => {
    const part = (file) => ({ file, kind: arenas.partKind(file.replace(/\.upk$/, '')) });
    const arena = (id, name, parts, locked = []) => ({ id, name, file: `${id}.upk`, standard: true, playable: true, parts: parts.map(part), field: parts.find((p) => /_Field\.upk$/.test(p)) || null, locked });
    // Drift Woods (Night) without a key list: its main map is locked, so even its parts are unknown
    const woods = arena('woods_night_p', 'Drift Woods (Night)', [], ['woods_night_p.upk']);
    const waste = arena('wasteland_grs_p', 'Wasteland (Pitched)', ['Wasteland_GRS_Art_P.upk', 'Wasteland_GRS_VFX.upk', 'Wasteland_SFX.upk']);
    const cs = arena('cs_p', 'Champions Field', ['CS_Field.upk', 'CS_OOB.upk', 'CS_OOB2.upk'], ['CS_OOB2.upk']);
    const beach = arena('beach_p', 'Salty Shores', ['Beach_Field.upk', 'Beach_OOB.upk']);
    const all = [woods, waste, cs, beach];
    let plan = arenas.mergePlan(waste, woods, all);
    assert.strictEqual(plan.how, 'build');
    let locked = arenas.lockedFor(all, [waste, woods], plan.ops);
    assert.deepStrictEqual(locked, [{ file: 'woods_night_p.upk', arena: 'Drift Woods (Night)' }]);
    const msg = arenas.lockedMessage(locked);
    assert.match(msg, /Drift Woods \(Night\)’s file woods_night_p\.upk/);
    assert.match(msg, /key list in Settings/);
    // a locked part only matters when the merge reads it
    plan = arenas.mergePlan(beach, cs, all);
    assert.deepStrictEqual(arenas.lockedFor(all, [beach, cs], plan.ops).map((l) => l.file), ['CS_OOB2.upk']);
    assert.deepStrictEqual(arenas.lockedFor(all, [waste, beach], arenas.mergePlan(waste, beach, all).ops), []);
    assert.strictEqual(arenas.lockedMessage([]), '');
    // what an op reads: its source and the file it writes over (not a file it adds)
    assert.deepStrictEqual(arenas.opReads({ kind: 'copy', gameFile: 'a.upk', sourceGameFile: 'b.upk' }), ['b.upk', 'a.upk']);
    assert.deepStrictEqual(arenas.opReads({ kind: 'build', gameFile: 'BP1.upk', from: 'c.upk', create: true }), ['c.upk']);
  });

  test('without a key list, arenas the built-in key cannot open are marked locked, and the engine names the file', async () => {
    const list = arenas.scanArenas(real, {}, []);
    const locked = list.filter((a) => a.locked.length);
    const open = list.filter((a) => !a.locked.length);
    assert.ok(open.length > 40, `${open.length} arenas open with the built-in key`);
    for (const a of locked) for (const f of a.locked) assert.ok(!upk.probeFile(path.join(real, f), []), `${f} is marked locked but opens`);
    console.log(`        ${locked.length} arenas need a key list: ${locked.slice(0, 6).map((a) => a.name).join(', ')}${locked.length > 6 ? '…' : ''}`);
    const lockedMain = locked.find((a) => a.locked.includes(a.file));
    if (!lockedMain) return;
    assert.deepStrictEqual(lockedMain.parts, [], 'a locked map cannot tell its parts');
    // building from it: refused with the file's name and the way out, and the game folder is untouched
    const dir = fs.mkdtempSync(path.join(tmp, 'locked-'));
    fs.copyFileSync(path.join(real, lockedMain.file), path.join(dir, lockedMain.file));
    const { engine } = makeEngine(dir);
    const before = sha(path.join(dir, lockedMain.file));
    await assert.rejects(engine.apply({ kind: 'build', gameFile: 'BPtest.upk', create: true, from: lockedMain.file, side: 'surroundings' }),
      (e) => e.code === 'NO_KEY' && e.message.includes(lockedMain.file) && /key list in Settings/.test(e.message));
    // copying it over an arena that opens: refused the same way, and that arena stays as it was
    const small = open.filter((a) => fs.existsSync(path.join(real, a.file))).sort((x, y) => x.size - y.size)[0];
    fs.copyFileSync(path.join(real, small.file), path.join(dir, small.file));
    const smallBefore = sha(path.join(dir, small.file));
    await assert.rejects(engine.apply({ kind: 'copy', gameFile: small.file, sourceGameFile: lockedMain.file }),
      (e) => e.code === 'NO_KEY' && e.message.includes(lockedMain.file));
    assert.strictEqual(sha(path.join(dir, small.file)), smallBefore);
    assert.strictEqual(sha(path.join(dir, lockedMain.file)), before);
    assert.ok(!fs.existsSync(path.join(dir, 'BPtest.upk')));
  }, !real);

  test('a swap is written with the key of the file it replaces', async () => {
    const keysFile = path.join(process.env.APPDATA || '', 'OpenW', 'keys.txt');
    if (!fs.existsSync(keysFile)) return; // needs a key list to find two items with different keys
    const keys = upk.parseKeys(fs.readFileSync(keysFile, 'utf8'));
    const keyOf = (f) => upk.keyOfFile(path.join(real, f), keys).toString('hex');
    // Lunation is encrypted with a key from the list, Cosmological with the built-in one
    const lunation = 'skin_IndigoD_SF.upk', cosmo = 'skin_bloodbros_SF.upk';
    if (!fs.existsSync(path.join(real, lunation)) || !fs.existsSync(path.join(real, cosmo))) return;
    const dir = fs.mkdtempSync(path.join(tmp, 'keys-'));
    const backup = path.join(process.env.APPDATA, 'OpenW', 'backups', lunation.toLowerCase());
    fs.copyFileSync(fs.existsSync(backup) ? backup : path.join(real, lunation), path.join(dir, lunation)); // the original, even if swapped in the game
    fs.copyFileSync(path.join(real, cosmo), path.join(dir, cosmo));
    const wanted = upk.keyOfFile(path.join(dir, lunation), keys).toString('hex');
    assert.notStrictEqual(wanted, keyOf(cosmo), 'test needs two items with different keys');
    const { engine } = makeEngine(dir);
    engine.getKeys = () => keys;
    await engine.apply({ kind: 'swap', sourceFile: lunation, targetFile: cosmo });
    const written = upk.readPackageFile(path.join(dir, lunation), keys);
    assert.strictEqual(written.key.toString('hex'), wanted, 'written with the donor key: the game cannot read it');
    assert.ok(written.names.some((n) => n.text === 'skin_IndigoD'));
  }, !real);

  test('arena names come from the game text; every-match covers standard arenas only', () => {
    const keysFile = path.join(process.env.APPDATA || '', 'OpenW', 'keys.txt');
    const keys = fs.existsSync(keysFile) ? upk.parseKeys(fs.readFileSync(keysFile, 'utf8')) : [];
    const { maps } = readTexts(real, keys);
    if (!maps.size) return; // the game text needs a key list
    const backups = path.join(process.env.APPDATA || '', 'OpenW', 'backups');
    const original = (f) => (fs.existsSync(path.join(backups, f.toLowerCase())) ? path.join(backups, f.toLowerCase()) : path.join(real, f));
    const list = arenas.scanArenas(real, {}, keys, maps, original);
    const byId = (id) => list.find((a) => a.id === id);
    assert.strictEqual(byId('cs_day_p').name, 'Champions Field (Day)');
    assert.strictEqual(byId('underwater_p').name, 'AquaDome');
    assert.ok(byId('stadium_p').standard && !byId('labs_basin_p').standard && !byId('hoopsstadium_p').standard);
    // same stadium every match: every standard arena with a stadium or sound part; one-file ones are left
    const { stadium, targets, skipped } = arenas.everyMatchTargets(byId('stadium_p'), list);
    assert.strictEqual(stadium.id, 'stadium_p');
    assert.ok(targets.length > 50 && targets.every((a) => a.standard && a.id !== 'stadium_p'), `${targets.length} arenas`);
    assert.ok(!targets.some((a) => /labs_|hoops|shattershot/i.test(a.file)));
    assert.deepStrictEqual(skipped.map((s) => s.arena.id).sort(), ['eurostadium_dusk_p', 'eurostadium_p']);
    // each arena keeps its own main file: written from itself, so its id and object numbering stay
    for (const place of targets) {
      const ops = arenas.everyMatchOps(byId('stadium_p'), place, list);
      assert.ok(ops.length, `${place.name} gets the stadium`);
      assert.ok(ops.every((o) => o.create || o.from.toLowerCase() === o.gameFile.toLowerCase()), `${place.name}: only its own file is written over`);
      assert.ok(ops.every((o) => o.group === 'everymatch' && o.place === place.id && o.stadium === 'stadium_p'));
    }
    assert.deepStrictEqual(arenas.arenasUsing(list, 'Underwater_Field.upk').map((a) => a.name), ['AquaDome']);
    // snow: only arenas with a snowy version in the game, and not the snowy version itself
    assert.deepStrictEqual(['stadium_p', 'park_night_p', 'underwater_p', 'cs_p', 'stadium_winter_p'].map((id) => (arenas.snowPlan(byId(id), list) || {}).snowy),
      ['DFH Stadium (Snowy)', 'Beckwith Park (Snowy)', undefined, undefined, undefined]);
  }, !real);

  test('merged arenas can be used in every match and get snow, and the merge stays', () => {
    const part = (file) => ({ file, kind: arenas.partKind(file.replace(/\.upk$/, '')) });
    const arena = (id, name, parts) => ({ id, name, file: `${id}.upk`, standard: true, playable: true, parts: parts.map(part), field: parts.find((p) => /_Field/.test(p)) || null });
    const aqua = arena('underwater_p', 'AquaDome', ['Underwater_Field.upk', 'Underwater_FX.upk']);
    const neon = arena('music_p', 'Neon Fields', ['Music_Field.upk', 'Music_Effects.upk']);
    const mann = arena('eurostadium_p', 'Mannfield', []);
    const dfh = arena('stadium_p', 'DFH Stadium', ['Stadium_OOB_Audio_Map.upk']);
    const winter = arena('stadium_winter_p', 'DFH Stadium (Snowy)', ['Stadium_OOB_Audio_Map.upk']);
    const fni = { ...arena('fni_stadium_p', 'Forbidden Temple (Fire & Ice)', ['FNI_Stadium_VFX.upk', 'FNI_Stadium_SFX.upk']), file: 'FNI_Stadium_P.upk' };
    const all = [aqua, neon, mann, dfh, winter, fni];
    const changes = new Map();
    for (const op of [...arenas.mergePlan(neon, aqua, all).ops, ...arenas.mergePlan(mann, dfh, all).ops, ...arenas.mergePlan(dfh, winter, all).ops]) changes.set(op.gameFile.toLowerCase(), op);
    // the merged arenas are listed under their merge (the added files are not arenas)
    assert.deepStrictEqual(arenas.mergedArenas(all, changes).map((m) => [m.arena.id, m.label]).sort(),
      [['stadium_p', 'Mannfield stadium in DFH Stadium'], ['stadium_winter_p', 'DFH Stadium stadium in DFH Stadium (Snowy)'], ['underwater_p', 'Neon Fields stadium in AquaDome']]);
    // every match with a merged arena shows the stadium of that merge, in every other arena that has
    // somewhere to load it; arenas you merged keep your merge, the merge's stadium arena shows its own
    assert.strictEqual(arenas.everyStadium(aqua, all, changes).id, 'music_p');
    let t = arenas.everyMatchTargets(aqua, all, changes);
    assert.deepStrictEqual(t.targets.map((a) => a.id), ['fni_stadium_p']);
    assert.deepStrictEqual(t.skipped.map((s) => [s.arena.id, s.why]), [['eurostadium_p', 'single']]);
    let ops = arenas.everyMatchOps(aqua, fni, all, changes, 'Neon Fields stadium in AquaDome');
    assert.ok(ops.length && ops.every((o) => o.chosen === 'underwater_p' && o.stadium === 'music_p' && o.place === 'fni_stadium_p' && o.every === 'Neon Fields stadium in AquaDome'));
    assert.ok(ops.some((o) => o.create && o.from === 'Music_Field.upk' && o.side === 'stadium'), 'Neon Fields\' stadium is loaded');
    const main = ops.find((o) => !o.create);
    assert.deepStrictEqual([main.gameFile, main.from, main.gameplay], ['FNI_Stadium_P.upk', 'FNI_Stadium_P.upk', true]);
    // a merge into a one-file arena replaces its main file: offline only, and every match never does it
    assert.strictEqual(arenas.mergePlan(neon, mann, all).online, false);
    assert.strictEqual(arenas.mergePlan(neon, fni, all).online, true);
    assert.deepStrictEqual(arenas.everyMatchOps(neon, mann, all), []);
    t = arenas.everyMatchTargets(dfh, all, changes);
    assert.strictEqual(t.stadium.id, 'eurostadium_p', 'DFH Stadium shows its merge\'s stadium (Mannfield\'s)');
    // merged arenas get no snow: the snowy version would replace what makes the merge
    for (const a of [aqua, winter, dfh]) assert.strictEqual(arenas.snowPlan(a, all, changes), null);
    assert.strictEqual(arenas.snowPlan(dfh, all).op.sourceGameFile, 'stadium_winter_p.upk');
    assert.strictEqual(arenas.snowPlan(dfh, all).online, false, 'snow replaces the arena file: offline only');
  });

  test('every match is out of date once a merge changes the arena it shows', () => {
    const part = (file) => ({ file, kind: arenas.partKind(file.replace(/\.upk$/, '')) });
    const arena = (id, name, parts) => ({ id, name, file: `${id}.upk`, standard: true, playable: true, parts: parts.map(part), field: parts.find((p) => /_Field/.test(p)) || null });
    const aqua = arena('underwater_p', 'AquaDome', ['Underwater_Field.upk', 'Underwater_FX.upk']);
    const neon = arena('music_p', 'Neon Fields', ['Music_Field.upk', 'Music_Effects.upk']);
    const mann = arena('eurostadium_p', 'Mannfield', []);
    const park = arena('park_p', 'Beckwith Park', ['Park_SFX.upk']);
    const all = [aqua, neon, mann, park];
    const changes = new Map();
    const on = () => [...changes.values()].filter((o) => o.group === 'everymatch');
    const turnOn = () => {
      for (const [k, o] of [...changes]) if (o.group === 'everymatch') changes.delete(k);
      for (const place of arenas.everyMatchTargets(aqua, all, changes).targets) for (const op of arenas.everyMatchOps(aqua, place, all, changes)) changes.set(op.gameFile.toLowerCase(), op);
    };
    turnOn();
    assert.ok(arenas.sameEveryMatch(on(), aqua, all, changes), 'nothing changed');
    // Neon Fields' stadium merged into AquaDome: every match should now show the merge's stadium
    for (const op of arenas.mergePlan(neon, aqua, all).ops) changes.set(op.gameFile.toLowerCase(), op);
    assert.ok(!arenas.sameEveryMatch(on(), aqua, all, changes));
    // brought up to date, it is the same again
    turnOn();
    assert.ok(arenas.sameEveryMatch(on(), aqua, all, changes));
    // written the old way (a copy of the arena over each file, before 0.4.11): out of date, and put back
    const old = { kind: 'copy', gameFile: 'park_p.upk', sourceGameFile: 'underwater_p.upk', group: 'everymatch', chosen: 'underwater_p' };
    assert.ok(arenas.oldEveryMatch(old) && !arenas.oldEveryMatch(on()[0]) && !arenas.oldEveryMatch({ group: 'merge:a:b' }));
    assert.ok(!arenas.sameEveryMatch([old], aqua, all, changes));
  });

  test('ground under the new pitch is lowered, even when it has no position of its own', () => {
    const keysFile = path.join(process.env.APPDATA || '', 'OpenW', 'keys.txt');
    const file = path.join(real || '', 'Outlaw_Oasis_OOB.upk');
    if (!fs.existsSync(keysFile) || !fs.existsSync(file)) return;
    const keys = upk.parseKeys(fs.readFileSync(keysFile, 'utf8'));
    const backup = path.join(process.env.APPDATA, 'OpenW', 'backups', 'outlaw_oasis_oob.upk');
    const buf = fs.readFileSync(fs.existsSync(backup) ? backup : file);
    const P = mapbuild.open(buf, keys);
    const before = mapbuild.inventory(P).find((i) => i.name === 'OL_Terrain_Ground_Main');
    const pitch = [{ x0: -4700, x1: 4700, y0: -6400, y1: 6400 }];
    const stats = mapbuild.keepSide(P, 'surroundings', { region: pitch, clear: pitch, part: true, lights: true });
    assert.strictEqual(stats.lowered, 1);
    const again = mapbuild.open(mapbuild.repack(P, Buffer.from(upk.DEFAULT_KEYS[0], 'hex')), keys);
    const after = mapbuild.inventory(again).find((i) => i.name === 'OL_Terrain_Ground_Main');
    assert.strictEqual(Math.round(after.box.c.z), Math.round(before.box.c.z) - 25);
    assert.strictEqual(again.t.exports.length, P.t.exports.length);
  }, !real);

  test('an arena file OpenW builds from itself keeps its package id and object numbering (what online matches check)', () => {
    const file = ['Park_P.upk', 'Stadium_P.upk', 'Woods_P.upk'].find((f) => fs.existsSync(path.join(real, f)) && upk.probeFile(path.join(real, f), []));
    if (!file) return;
    const backups = path.join(process.env.APPDATA || '', 'OpenW', 'backups');
    const src = fs.existsSync(path.join(backups, file.toLowerCase())) ? path.join(backups, file.toLowerCase()) : path.join(real, file);
    const buf = fs.readFileSync(src);
    const P = mapbuild.open(buf, []);
    mapbuild.keepSide(P, 'surroundings', { gameplay: true, lights: true });
    const out = mapbuild.repack(P, P.t.pkg.key, { [`${file.replace(/_P\.upk$/i, '')}_SFX`]: 'BPtest' });
    const id = (b) => { const s = upk.parseSummary(b); let o = s.guidOffset + 16; const n = b.readInt32LE(o); return { guid: b.subarray(s.guidOffset, s.guidOffset + 16).toString('hex'), gens: b.subarray(o, o + 4 + n * 12).toString('hex'), exports: s.exportCount }; };
    assert.deepStrictEqual(id(out), id(buf));
  }, !real);

  test('same stadium every match, built from real arenas: each arena keeps its own id and numbering and loads the stadium', async () => {
    const backups = path.join(process.env.APPDATA || '', 'OpenW', 'backups');
    const original = (f) => (fs.existsSync(path.join(backups, f.toLowerCase())) ? path.join(backups, f.toLowerCase()) : path.join(real, f));
    const list = arenas.scanArenas(real, {}, [], new Map(), original).map((a) => ({ ...a, standard: !/^(labs_|hoops|shattershot|ko_)/i.test(a.id) }));
    const byId = (id) => list.find((a) => a.id === id);
    const chosen = byId('stadium_p'), park = byId('park_p'), aqua = byId('underwater_p');
    const usable = (a) => a && !a.locked.length;
    if (![chosen, park, aqua].every(usable)) return;
    // a sandbox game folder: copies of these arenas' files
    const dir = fs.mkdtempSync(path.join(tmp, 'every-'));
    const files = new Set([chosen, park, aqua].flatMap((a) => [a.file, ...a.parts.map((p) => p.file)]));
    for (const f of files) fs.copyFileSync(original(f), path.join(dir, f));
    const sandbox = list.filter((a) => [chosen, park, aqua].includes(a));
    const { engine } = makeEngine(dir);
    const opened = new Map();
    const open = (f) => { const k = f.toLowerCase(); if (!opened.has(k)) { let p = null; try { p = mapbuild.open(fs.readFileSync(path.join(dir, f)), []); } catch { /* left out */ } opened.set(k, p); } return opened.get(k); };
    const id = (file) => { const b = fs.readFileSync(file); const s = upk.parseSummary(b); const o = s.guidOffset + 16, n = b.readInt32LE(o); return `${b.subarray(s.guidOffset, o).toString('hex')}|${b.subarray(o, o + 4 + n * 12).toString('hex')}|${s.exportCount}`; };
    const before = Object.fromEntries([park, aqua].map((a) => [a.id, id(path.join(dir, a.file))]));
    const { targets } = arenas.everyMatchTargets(chosen, sandbox);
    assert.deepStrictEqual(targets.map((a) => a.id).sort(), ['park_p', 'underwater_p']);
    const ops = [];
    for (const place of targets) ops.push(...arenas.everyMatchOps(chosen, place, sandbox, new Map(), chosen.name, arenas.mergeInfo(chosen, place, open, mapbuild)));
    opened.clear();
    for (const op of ops) await engine.apply(op);
    for (const place of [park, aqua]) {
      const file = path.join(dir, place.file);
      assert.strictEqual(id(file), before[place.id], `${place.name} keeps its package id and object numbering`);
      // its stadium or sound part now loads a file OpenW added, holding DFH Stadium's stadium
      const names = upk.readPackageFile(file).names.map((n) => n.text);
      const added = ops.filter((o) => o.create && o.place === place.id && o.side === 'stadium');
      assert.ok(added.length && added.every((o) => names.includes(o.gameFile.replace(/\.upk$/, '')) && fs.existsSync(path.join(dir, o.gameFile))), `${place.name} loads the stadium`);
    }
    // and turning it off puts every file back, the added ones gone
    for (const rec of engine.list().active) await engine.revert(rec.key);
    for (const place of [park, aqua]) assert.strictEqual(id(path.join(dir, place.file)), before[place.id]);
    assert.ok(!ops.some((o) => o.create && fs.existsSync(path.join(dir, o.gameFile))));
  }, !real);

  test('strictly the stadium: what counts, piece by piece', () => {
    const at = (x, y, z, ex, ey, ez) => ({ c: { x, y, z }, e: { x: ex, y: ey, z: ez } });
    const mesh = (name, group, box) => ({ kind: 'mesh', name, group, box, known: true });
    const yes = (it, why) => assert.ok(mapbuild.isStadium(it), why), no = (it, why) => assert.ok(!mapbuild.isStadium(it), why);
    // on the pitch: the stadium, whatever the arena calls its packages
    yes(mesh('Farm_G_FieldGrass', 'Farm_GRS_Assets.Meshes', at(0, 0, 0, 4096, 5120, 10)), 'Farmstead\'s pitch');
    yes(mesh('Mall_Field_Walls_Hex', 'Mall_OOB_Assets_01.Meshes', at(4096, 0, 1000, 40, 5000, 1000)), 'an OOB package holding the field');
    yes(mesh('Utopia_FieldRailingBushes_SM', 'UtopiaStadium_Assets_B.Meshes', at(4300, 0, 300, 100, 3000, 200)), 'planters on the field railing');
    no(mesh('LombardyPoplar_Mini', 'Trees.Meshes', at(4500, 6000, 300, 300, 300, 600)), 'never a tree');
    no(mesh('StadiumFogRing', 'EuroStadium_Assets.Meshes', at(0, 0, 500, 5000, 5000, 100)), 'never fog');
    no(mesh('ConcreteBase', 'Park_Assets.Meshes', at(0, 0, -48, 5120, 6656, 16)), 'never the ground: the other arena keeps its own');
    no(mesh('PA_Stadium_Ground_01', 'Paname.Meshes', at(0, 0, 0, 12000, 15000, 50)), 'not even ground named stadium');
    // away from the pitch: only pieces named as stadium parts, never scenery, within reach
    yes(mesh('Crowd_01', 'FutureStadium_Assets.Meshes', at(-5400, 15300, 6700, 10000, 5000, 3000)), 'the crowd');
    yes(mesh('Stadium_Base', 'FutureStadium_Assets.Meshes', at(-1800, 11478, 2856, 29272, 11670, 6872)), 'the stadium itself, however big');
    yes(mesh('Station_Stands_Upper', 'TrainStation_Assets.Meshes', at(0, 9000, 2000, 6000, 2000, 1500)), 'Urban Central\'s stands: its package name is no veto');
    no(mesh('Utopia_Chair001', 'UtopiaStadium_Assets.Meshes', at(9000, 9000, 800, 50, 50, 60)), 'a food court chair is no stadium, whatever package it is in');
    no(mesh('Mall_FoodCourt_Walls_01', 'Mall_Assets.Meshes', at(12000, 0, 2000, 3000, 3000, 2000)), 'walls of a mall are no stadium');
    no(mesh('LeafyTrees_01_Combined', 'Stadium_Assets.Meshes', at(4285, -15828, 6548, 15174, 5783, 2740)), 'trees in a stadium package');
    no(mesh('Woods_PowerLine_Light_01', 'Woods_Assets.Meshes', at(15000, 0, 3000, 200, 200, 2000)), 'a lamp post is no stadium');
    no(mesh('Crowd_02', 'FutureStadium_Assets.Meshes', at(40000, 0, 2000, 3000, 3000, 2000)), 'too far out');
    no(mesh('Stadium_Lights', 'X', at(0, 9000, 30000, 2000, 2000, 500)), 'too high up');
    // and nothing whose place is not known, nor actors that are no mesh
    no({ kind: 'mesh', name: 'Goal_Frame', group: 'X', box: null, known: false }, 'no position');
    no({ kind: 'actor', cls: 'InterpActor', name: 'InterpActor_4', box: at(0, 0, 3000, 0, 0, 0), known: true }, 'a moving thing that is no mesh');
  });

  test('strictly the stadium, on real arenas: no scenery and nothing unplaced comes along, the pitch does', () => {
    const keysFile = path.join(process.env.APPDATA || '', 'OpenW', 'keys.txt');
    const keys = fs.existsSync(keysFile) ? upk.parseKeys(fs.readFileSync(keysFile, 'utf8')) : [];
    const backups = path.join(process.env.APPDATA || '', 'OpenW', 'backups');
    const original = (f) => (fs.existsSync(path.join(backups, f.toLowerCase())) ? path.join(backups, f.toLowerCase()) : path.join(real, f));
    // whole words, as the game names things ("StreetSignArrows" has no tree in it)
    const wordsOf = (t) => String(t).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/);
    const SCENERY = { test: (t) => wordsOf(t).some((w) => /^(trees?|poplars?|leafy|bush(es)?|rocks?|dunes?|mountains?|hills?|terrain|cliffs?|skyscrapers?|buildings?|city|statue|monorail|moai|planets?|clouds?|skydome|skysphere)$/.test(w)) };
    let checked = 0;
    for (const file of ['Park_Snowy_P.upk', 'Stadium_P.upk', 'Wasteland_GRS_P.upk', 'Mall_Day_P.upk', 'Woods_P.upk', 'UtopiaStadium_P.upk', 'Farm_P.upk', 'CS_Field.upk']) {
      if (!fs.existsSync(path.join(real, file))) continue;
      let P;
      try { P = mapbuild.open(fs.readFileSync(original(file)), keys); } catch { continue; } // needs a key list
      const log = [];
      mapbuild.keepSide(P, 'stadium', { gameplay: false, lights: false, part: /_Field/.test(file) }, log);
      const kept = log.filter((l) => l.kept && l.what !== 'GroundStaticMeshActor_TA');
      // (planters on a field's own railing, like Utopia's, are part of its field)
      const scenery = kept.filter((l) => SCENERY.test(`${l.name} ${l.group}`) && !/stadium/i.test(l.name)
        && !(/bush/i.test(l.name) && /field/i.test(l.name) && Math.abs(l.x) <= 5600 && Math.abs(l.y) <= 7000));
      assert.deepStrictEqual(scenery.map((l) => `${l.group}.${l.name}`), [], `${file}: scenery came along`);
      assert.ok(kept.every((l) => l.x !== null), `${file}: a piece with no position came along`);
      const onPitch = kept.filter((l) => Math.abs(l.x) <= 4096 && Math.abs(l.y) <= 5120);
      assert.ok(onPitch.length >= 5, `${file}: only ${onPitch.length} pieces of the pitch`);
      assert.ok(!kept.some((l) => /^(VehiclePickup|Goal|PlayerStart|StaticLightCollectionActor|ExponentialHeightFog|SkyLight)/.test(l.what)), `${file}: gameplay, lights or fog came along`);
      checked++;
    }
    assert.ok(checked >= 3, `${checked} arenas checked`);
  }, !real);

  test('a map is taken apart and put back together without changing anything else', () => {
    const keysFile = path.join(process.env.APPDATA || '', 'OpenW', 'keys.txt');
    const file = path.join(real || '', 'Farm_GRS_P.upk');
    if (!fs.existsSync(keysFile) || !fs.existsSync(file)) return;
    const keys = upk.parseKeys(fs.readFileSync(keysFile, 'utf8'));
    const backup = path.join(process.env.APPDATA, 'OpenW', 'backups', 'farm_grs_p.upk');
    const buf = fs.readFileSync(fs.existsSync(backup) ? backup : file);
    // unchanged: every object comes back byte for byte
    const P = mapbuild.open(buf, keys);
    const again = mapbuild.repack(P, P.t.pkg.key);
    const t = upk.readTables(again, keys);
    assert.ok(t.exports.every((e, i) => upk.readObject(again, t, e).equals(P.obj(P.t.exports[i]))));
    // one side kept: some meshes hidden, gameplay gone from the surroundings, a part renamed, still readable
    const S = mapbuild.open(buf, keys);
    const log = [];
    const stats = mapbuild.keepSide(S, 'surroundings', { region: mapbuild.arenaRegion([mapbuild.open(buf, keys)]) }, log);
    assert.ok(stats.hidden > 20 && stats.kept > 20, JSON.stringify(stats));
    // no gameplay and no lights come along with the outside; sky and fog do
    assert.ok(log.filter((l) => /^(VehiclePickup|Goal|PlayerStart|StaticLightCollectionActor)/.test(l.what)).every((l) => !l.kept));
    assert.ok(log.some((l) => /SkySphere/.test(l.name) && l.kept));
    // and its stadium is gone: nothing kept sits on the pitch (a combined mesh centred on it but
    // spreading far past it, like all the farm's chickens in one, stands around it)
    assert.ok(log.filter((l) => l.kept && l.what === 'mesh' && l.x !== null && !/sky|fog|sun/i.test(l.name)).every((l) => Math.abs(l.x) > 4096 || Math.abs(l.y) > 5120 || l.w > 6000 || l.h > 7000));
    assert.ok(log.some((l) => !l.kept && /field|goal/i.test(l.name)), 'its own field and goals are hidden');
    const built = mapbuild.repack(S, Buffer.from(upk.DEFAULT_KEYS[0], 'hex'), { Farm_SFX: 'BPabcd12' });
    const t2 = upk.readTables(built, keys);
    assert.ok(t2.names.includes('BPabcd12') && !t2.names.some((n) => /^farm_sfx$/i.test(n)));
    assert.strictEqual(t2.exports.length, P.t.exports.length);
  }, !real);

  test('a copied arena file is written with the replaced file\'s key', async () => {
    const keysFile = path.join(process.env.APPDATA || '', 'OpenW', 'keys.txt');
    if (!fs.existsSync(keysFile)) return;
    const keys = upk.parseKeys(fs.readFileSync(keysFile, 'utf8'));
    // two small arena parts that use different keys
    const parts = ['Music_Field.upk', 'Underwater_Field.upk', 'CS_Field.upk', 'Beach_Field.upk'].filter((f) => fs.existsSync(path.join(real, f)));
    const keyOf = (dir, f) => upk.keyOfFile(path.join(dir, f), keys).toString('hex');
    const backups = path.join(process.env.APPDATA, 'OpenW', 'backups');
    const original = (f) => (fs.existsSync(path.join(backups, f.toLowerCase())) ? path.join(backups, f.toLowerCase()) : path.join(real, f));
    const dir = fs.mkdtempSync(path.join(tmp, 'arena-'));
    for (const f of parts) fs.copyFileSync(original(f), path.join(dir, f));
    const pair = parts.flatMap((a) => parts.map((b) => [a, b])).find(([a, b]) => a !== b && keyOf(dir, a) !== keyOf(dir, b));
    if (!pair) return;
    const [dest, src] = pair, want = keyOf(dir, dest);
    const { engine } = makeEngine(dir);
    engine.getKeys = () => keys;
    await engine.apply({ kind: 'copy', gameFile: dest, sourceGameFile: src });
    assert.strictEqual(keyOf(dir, dest), want);
    assert.deepStrictEqual(upk.readPackageFile(path.join(dir, dest), keys).names.map((n) => n.text), upk.readPackageFile(path.join(dir, src), keys).names.map((n) => n.text));
  }, !real);

  test('copy: one game file becomes a copy of another, and reverts', async () => {
    const { engine } = makeEngine(cooked);
    const dest = path.join(cooked, midF), original = sha(dest);
    await engine.apply({ kind: 'copy', gameFile: midF, sourceGameFile: longF });
    assert.strictEqual(sha(dest), sha(path.join(cooked, longF)));
    assert.strictEqual(engine.checkSwap({ kind: 'copy', gameFile: midF, sourceGameFile: '..\\x.upk' }).ok, false);
    await engine.revert(midF.toLowerCase());
    assert.strictEqual(sha(dest), original);
  }, !real);

  test('probe agrees with a full read, and compatible looks are marked', () => {
    const cat = buildCatalog(real);
    const wheels = cat.items.filter((i) => i.category === 'wheels');
    const sample = wheels.filter((_, n) => n % 25 === 0);
    annotate(real, sample);
    for (const item of sample) {
      let full = true;
      try { upk.readPackageFile(path.join(real, item.file)); } catch { full = false; }
      assert.strictEqual(item.ok, full, `${item.file}: probe says ${item.ok}, full read says ${full}`);
    }
    const a = { id: 'a', len: 10, ok: true }, longer = { id: 'b', len: 12, ok: true }, locked = { id: 'c', len: 12, ok: false };
    assert.ok(canSwap(a, longer) && !canSwap(longer, a) && !canSwap(a, locked) && !canSwap(a, a));
    // the rule must match what the engine can actually build
    const { engine } = makeEngine(real);
    const readable = sample.filter((i) => i.ok);
    for (const target of readable.slice(0, 12)) {
      const built = engine.checkSwap({ kind: 'swap', sourceFile: readable[0].file, targetFile: target.file }).ok;
      assert.strictEqual(built, canSwap(readable[0], target), `${readable[0].file} -> ${target.file}`);
    }
  }, !real);

  test('item pictures decode from the game thumbnails', () => {
    const cat = buildCatalog(real);
    annotate(real, cat.items.filter((i) => i.category === 'boosts'));
    const boosts = cat.items.filter((i) => i.category === 'boosts' && i.ok && i.thumb).slice(0, 25);
    let decoded = 0;
    for (const item of boosts) {
      let pic;
      try { pic = readThumbnail(real, item.thumb); } catch { continue; } // thumbnail package may use another key
      assert.ok(pic.width >= 64 && pic.height >= 64 && pic.bgra.length === pic.width * pic.height * 4);
      assert.ok(new Set(pic.bgra.subarray(0, 4096 * 4)).size > 4 || new Set(pic.bgra).size > 4, `${item.thumb} is a flat colour`);
      decoded++;
    }
    assert.ok(decoded >= boosts.length * 0.8, `only ${decoded} of ${boosts.length} decoded`);
  }, !real);

  test('DXT1 block decodes to the right colours', () => {
    // one 4x4 block: colour0 = pure red, colour1 = pure blue, every pixel uses colour0
    const block = Buffer.from([0x00, 0xf8, 0x1f, 0x00, 0, 0, 0, 0]);
    const px = decodeDxt(block, 4, 4, false);
    assert.deepStrictEqual([...px.subarray(0, 4)], [0, 0, 255, 255]); // BGRA
  });

  test('key lists: hex and base64 lines are read, junk and the built-in key are dropped', () => {
    const hex = 'ab'.repeat(32), b64 = Buffer.alloc(32, 7).toString('base64');
    const keys = upk.parseKeys(`# comment\n${hex}\n${hex.toUpperCase()}\n${b64}\nnot a key\n${upk.DEFAULT_KEYS[0]}\n`);
    assert.deepStrictEqual(keys, [hex, Buffer.alloc(32, 7).toString('hex')]);
  });

  test('the key list OpenW is built with: read gzipped or plain, packed into the app, never committed', () => {
    const zlib = require('zlib');
    const k1 = 'a'.repeat(64), k2 = Buffer.alloc(32, 7).toString('base64');
    const text = `${k1}\r\n${k2}\r\n${upk.DEFAULT_KEYS[0]}\r\njunk\r\n`;
    fs.writeFileSync(path.join(tmp, 'k.txt.gz'), zlib.gzipSync(text));
    fs.writeFileSync(path.join(tmp, 'k.txt'), text);
    assert.deepStrictEqual(upk.readKeyFile(path.join(tmp, 'k.txt.gz')), [k1, Buffer.alloc(32, 7).toString('hex')]);
    assert.deepStrictEqual(upk.readKeyFile(path.join(tmp, 'k.txt')), upk.readKeyFile(path.join(tmp, 'k.txt.gz')));
    assert.deepStrictEqual(upk.readKeyFile(path.join(tmp, 'missing.gz')), []);
    const root = path.join(__dirname, '..');
    // keys/ is never committed, but the setup carries it
    const { execFileSync } = require('child_process');
    assert.match(execFileSync('git', ['check-ignore', 'keys/keys.txt.gz'], { cwd: root, encoding: 'utf8' }), /keys\/keys\.txt\.gz/);
    assert.strictEqual(execFileSync('git', ['ls-files', 'keys'], { cwd: root, encoding: 'utf8' }).trim(), '', 'no key list in the repo');
    assert.ok(require('../package.json').build.files.includes('keys/**/*'));
    const wf = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
    assert.ok(wf.indexOf('secrets.OPENW_KEYS') > 0 && wf.indexOf('keys/keys.txt.gz') < wf.indexOf('electron-builder --win'), 'the release build adds the key list before building');
    assert.match(fs.readFileSync(path.join(root, 'src', 'main', 'main.js'), 'utf8'), /'keys', 'keys\.txt\.gz'/);
  });

  test('wrong extra keys do not stop a readable package from opening', () => {
    const wrong = ['11'.repeat(32), '22'.repeat(32)];
    const pkg = upk.readPackageFile(path.join(cooked, shortF), wrong);
    assert.ok(pkg.names.length > 0);
    assert.strictEqual(upk.probeFile(path.join(cooked, shortF), wrong), true);
  }, !real);

  test('item names: labels are applied, decals get their car, missing ones keep the internal name', () => {
    const items = [
      { file: 'skin_IndigoD_SF.upk', name: 'Indigo D', category: 'decals' },
      { file: 'skin_grain_stripes_SF.upk', name: 'Grain Stripes', category: 'decals' },
      { file: 'body_grain_SF.upk', name: 'Grain', category: 'cars' },
      { file: 'boost_unknown_SF.upk', name: 'Unknown', category: 'boosts' },
    ];
    const named = applyLabels(items, new Map([['skin_indigod', 'Lunation'], ['skin_grain_stripes', 'Stripes'], ['body_grain', 'Fennec']]));
    assert.strictEqual(named, 3);
    assert.deepStrictEqual(items.map((i) => [i.label, i.sub]), [['Lunation', ''], ['Stripes', 'Fennec'], ['Fennec', ''], ['Unknown', '']]);
    assert.strictEqual(readLabels(path.join(tmp, 'nowhere')).size, 0, 'a missing text file gives no labels, not an error');
  });

  test('a value typed next to a slider is clamped to its range and snapped to its step', () => {
    const { typedValue } = require('../src/shared/values');
    // percent sliders (0.1 steps): "20", "20%", " 80.1 % " and "80,1" all work
    assert.strictEqual(typedValue('20', 0, 97.7, 0.1), 20);
    assert.strictEqual(typedValue('20%', 0, 97.7, 0.1), 20);
    assert.strictEqual(typedValue(' 80.1 % ', 0, 100, 0.1), 80.1);
    assert.strictEqual(typedValue('80,1', 0, 100, 0.1), 80.1);
    assert.strictEqual(typedValue('33.33', 0, 100, 0.1), 33.3);
    // out of range: the nearest end
    assert.strictEqual(typedValue('150', 0, 97.7, 0.1), 97.7);
    assert.strictEqual(typedValue('-5', 0, 100, 0.1), 0);
    assert.strictEqual(typedValue('0', 0.003, 100, 0.1), 0.003);
    // whole-number sliders round, ranges that do not start at 0 snap from their start
    assert.strictEqual(typedValue('42.6', 0, 200, 1), 43);
    assert.strictEqual(typedValue('10', 20, 100, 1), 20);
    assert.strictEqual(typedValue('251', 25, 375, 1), 251);
    // "off" is the lowest value (Smoothing shows 0 as Off); anything else is ignored
    assert.strictEqual(typedValue('Off', 0, 100, 1), 0);
    for (const junk of ['', 'abc', '%', null, '1e400']) assert.strictEqual(typedValue(junk, 0, 100, 1), null, String(junk));
  });

  test('every overlay window has its page, and the profile card goes over the game with the profile', () => {
    const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
    const block = /const OVERLAYS = \{([\s\S]*?)\n\};/.exec(main)[1];
    const pages = [...block.matchAll(/(\w+): \{ page: '([\w.]+)'/g)].map((m) => [m[1], m[2]]);
    assert.deepStrictEqual(pages.map((p) => p[0]), ['pad', 'music', 'card']);
    for (const [, page] of pages) assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'renderer', page)), `${page} is missing`);
    assert.match(main, /kind === 'card' \? \{ profile: settings\.get\('profile'\) \}/, 'the card window gets the profile');
    assert.match(main, /card: \{ on: false, x: null, y: null, size: 100 \}/, 'off until turned on');
    const card = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'card.js'), 'utf8');
    assert.match(card, /overlayConfig', 'card'/);
  });

  test('controller overlay: every model lights up where its buttons are drawn, and the PS5 body is solid', () => {
    const vm = require('vm');
    const ctx = {};
    vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', 'assets', 'controllers', 'pads.js'), 'utf8')};this.ART = PAD_ART;`, ctx);
    const shipped = ctx.ART;
    const { art, centreOf } = require('../scripts/prepare-controllers.js');
    assert.deepStrictEqual(Object.keys(shipped), ['ps5', 'ps4', 'xbox']);
    for (const k of Object.keys(art)) assert.strictEqual(shipped[k].svg, art[k].svg, `pads.js is out of date for ${k}: run node scripts/prepare-controllers.js`);
    const spot = (svg, b) => { const m = new RegExp(`<circle class="pc-spot" data-b="${b}" cx="([-\\d.]+)" cy="([-\\d.]+)"`).exec(svg); return m && { x: Number(m[1]), y: Number(m[2]) }; };
    const near = (a, b, what) => assert.ok(a && b && Math.hypot(a.x - b.x, a.y - b.y) < 0.5, `${what}: glow at ${JSON.stringify(a)}, drawn at ${JSON.stringify(b)}`);
    // Xbox: the sticks sit in translated groups; the glow goes where they are drawn, not where their numbers say
    const xbox = fs.readFileSync(path.join(__dirname, '..', 'assets', 'controllers', 'src', 'xbox.svg'), 'utf8');
    near(spot(shipped.xbox.svg, 10), { x: 367.8 - 111.12499 - 0.13231075, y: 486.7 - 64.029164 - 0.13229715 }, 'Xbox L3');
    near(spot(shipped.xbox.svg, 11), { x: 662.7 - 5.0270754 - 0.13230778, y: 619.8 - 16.139577 - 0.13230041 }, 'Xbox R3');
    near(centreOf(xbox, 'ButtonL3'), spot(shipped.xbox.svg, 10), 'centreOf');
    near(spot(shipped.ps5.svg, 10), { x: 359, y: 460.3 }, 'PS5 L3');
    // every model has both sticks, both triggers and every standard button
    for (const [k, a] of Object.entries(shipped)) {
      const tagged = new Set([...a.svg.matchAll(/data-b="([\d+]+)"/g)].flatMap((m) => m[1].split('+')).map(Number));
      const want = k === 'xbox' ? [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15] : [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
      for (const b of want) assert.ok(tagged.has(b), `${k} has no button ${b}`);
      assert.strictEqual((a.svg.match(/class="pc-cap" data-stick=/g) || []).length, 2, `${k} sticks`);
      assert.strictEqual((a.svg.match(/data-trigger="/g) || []).length, 2, `${k} triggers`);
    }
    // PS5: a solid body under everything, and the grips and touchpad under the buttons
    const ps5 = shipped.ps5.svg;
    assert.ok(ps5.startsWith('<path class="pc-under"'), 'the solid body is drawn first');
    for (const id of ['path1056', 'path1058', 'path1052']) assert.ok(ps5.indexOf(`ps5-${id}"`) < ps5.indexOf('ps5-ButtonBack"'), `${id} is drawn below the create button`);
  });

  /* ---------- clips ---------- */
  const mp4 = require('../src/shared/mp4');
  const cliplib = require('../src/main/core/cliplib');
  // 4.2 s recorded by Chromium's MediaRecorder (a counter on a canvas and a tone), as the recorder gets it
  const sample = () => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'recorder-sample.mp4')));

  test('clips: the last seconds are kept as they arrive and saved as an ordinary MP4 that starts on a keyframe', () => {
    const raw = sample();
    const ring = new mp4.Ring(60);
    for (let i = 0; i < raw.length; i += 3001) ring.push(raw.subarray(i, i + 3001)); // pieces that cut boxes in half
    assert.ok(ring.frags.length >= 4 && ring.frags.every((f) => f.sync), 'fragments start on keyframes');
    assert.ok(Math.abs(ring.seconds - 4.2) < 0.3, `holds ${ring.seconds}`);
    const clip = ring.clip(2);
    const top = mp4.boxes(clip).map((b) => b.type);
    assert.deepStrictEqual(top, ['ftyp', 'moov', 'mdat'], 'one moov at the front, one mdat: plays and seeks everywhere');
    const m = mp4.fromFile(clip);
    const d = mp4.duration(m);
    assert.ok(d >= 2 && d < 3.2, `a 2 second clip is ${d} s`);
    const video = m.tracks.find((t) => t.handler === 'vide'), audio = m.tracks.find((t) => t.handler === 'soun');
    assert.ok(video.samples[0].sync, 'starts on a keyframe');
    assert.ok(audio && audio.samples.length > 0, 'with its sound');
    // longer than what is held: everything there is
    assert.ok(Math.abs(mp4.duration(mp4.fromFile(ring.clip(60))) - mp4.duration(mp4.fromFile(raw))) < 0.05);
    // an old part is dropped once it is not needed
    const short = new mp4.Ring(1);
    short.push(raw);
    assert.ok(short.frags.length < ring.frags.length && short.seconds >= 1, `keeps ${short.seconds} s for a 1 s ring`);
  });

  test('clips: an MP4 file reads back sample for sample, and a trim cuts on keyframes without re-encoding', () => {
    const raw = sample();
    const model = mp4.fromFile(raw); // a fragmented file reads too
    const flat = mp4.join(mp4.toFile(model));
    const again = mp4.fromFile(flat);
    assert.deepStrictEqual(again.tracks.map((t) => t.samples.length), model.tracks.map((t) => t.samples.length));
    for (let i = 0; i < model.tracks.length; i++) {
      const a = model.tracks[i].samples, b = again.tracks[i].samples;
      assert.ok(a.every((s, k) => s.dur === b[k].dur && s.sync === b[k].sync && Buffer.compare(Buffer.from(s.data), Buffer.from(b[k].data)) === 0), `track ${i} samples are the same`);
    }
    assert.ok(Buffer.from(mp4.join(mp4.toFile(again))).equals(Buffer.from(flat)), 'writing is stable');
    const part = mp4.cut(again, 1.5, 3);
    const video = part.tracks.find((t) => t.handler === 'vide');
    assert.ok(video.samples[0].sync && part.start <= 1.5 && part.start > 0.3, `starts on the keyframe before 1.5 s (${part.start})`);
    const d = mp4.duration(part);
    assert.ok(Math.abs(d - (3 - part.start)) < 0.1, `${d} s`);
  });

  test('clips: hotkeys, names and settings are kept to what works', () => {
    const k = cliplib.normalizeKey;
    assert.deepStrictEqual(['alt+f9', 'F8', 'ctrl+shift+s', 'Control+Alt+1', 'win+g', 'Alt+num5'].map(k), ['Alt+F9', 'F8', 'Ctrl+Shift+S', 'Ctrl+Alt+1', 'Super+G', 'Alt+num5']);
    for (const bad of ['x', '5', 'Ctrl+Alt', 'Alt+F9+F10', '', 'Alt+Ü', null]) assert.strictEqual(k(bad), '', String(bad)); // a letter alone would stop working everywhere
    assert.deepStrictEqual(cliplib.clashes([{ key: 'Alt+F9' }, { key: 'alt+f9' }, { key: 'F8' }]), ['alt+f9']);
    const c = cliplib.complete({ fps: 45, mbps: 500, res: 4000, codec: 'x', keys: [{ key: 'x', seconds: 30 }, { key: 'alt+f10', seconds: 7 }], on: 1 });
    assert.deepStrictEqual([c.fps, c.mbps, c.res, c.codec, c.on], [60, 80, '1080', 'h264', true]);
    assert.deepStrictEqual(c.keys, [{ key: 'Alt+F10', seconds: 30 }], 'a key that cannot work is dropped, an odd length becomes 30 s');
    assert.strictEqual(cliplib.keepSeconds({ keys: [{ key: 'F8', seconds: 15 }, { key: 'F9', seconds: 120 }] }), 120);
    assert.strictEqual(cliplib.cleanName('  my: goal / save?.  '), 'my goal save');
    const dir = fs.mkdtempSync(path.join(tmp, 'clips-'));
    const when = new Date(2026, 10, 21, 21, 5, 9);
    assert.strictEqual(cliplib.clipName(dir, when), 'Rocket League 2026-11-21 21-05-09.mp4');
    fs.writeFileSync(path.join(dir, 'Rocket League 2026-11-21 21-05-09.mp4'), '');
    assert.strictEqual(cliplib.clipName(dir, when), 'Rocket League 2026-11-21 21-05-09 (2).mp4');
  });

  test('clips: the library lists, renames and trims clips in its folder, and nothing outside it', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'lib-')), thumbs = path.join(dir, 'thumbs');
    const raw = sample();
    const file = path.join(dir, 'Rocket League 2026-11-21 21-00-00.mp4');
    fs.writeFileSync(file, mp4.join(mp4.toFile(mp4.fromFile(raw))));
    fs.mkdirSync(thumbs);
    fs.writeFileSync(cliplib.thumbFile(thumbs, file), 'jpg');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a clip');
    let list = cliplib.listClips(dir, thumbs);
    assert.deepStrictEqual(list.map((x) => x.name), ['Rocket League 2026-11-21 21-00-00']);
    assert.ok(Math.abs(list[0].seconds - 4.2) < 0.2 && list[0].thumb, 'length from the file, and its picture');
    const renamed = cliplib.renameClip(dir, thumbs, file, 'Ceiling shot');
    assert.strictEqual(path.basename(renamed), 'Ceiling shot.mp4');
    assert.ok(fs.existsSync(cliplib.thumbFile(thumbs, renamed)), 'the picture follows');
    const { file: cut, start } = cliplib.trimClip(dir, thumbs, renamed, 2, 3.5);
    assert.strictEqual(path.basename(cut), 'Ceiling shot (trimmed).mp4');
    assert.ok(Math.abs(cliplib.mp4Seconds(cut) - (3.5 - start)) < 0.1);
    list = cliplib.listClips(dir, thumbs);
    assert.strictEqual(list.length, 2);
    // the page only names files from the list: anything else is refused
    assert.throws(() => cliplib.renameClip(dir, thumbs, path.join(tmp, 'elsewhere.mp4'), 'x'), /not in the clips folder/);
    assert.throws(() => cliplib.trimClip(dir, thumbs, path.join(dir, 'notes.txt'), 0, 1), /not in the clips folder/);
    assert.throws(() => cliplib.renameClip(dir, thumbs, renamed, 'Ceiling shot (trimmed)'), /already exists/);
  });

  /* ---------- OpenW Input ---------- */
  const TX = require('../src/shared/transform');
  const inputLib = require('../src/main/input');

  test('input: OpenW computes what Steam Input does (points measured from the Steam client)', () => {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'steam-measured.json'), 'utf8'));
    let points = 0;
    for (const ex of data.experiments) {
      const c = TX.stickCfg(ex.stick);
      for (const [x, y, ox, oy] of ex.points) {
        const [a, b] = TX.stick(x, y, c);
        // Steam rounds inside its maths a little differently: 5 out of 32767 is the most measured
        assert.ok(Math.abs(a - ox) <= 5 && Math.abs(b - oy) <= 5, `${ex.name}: (${x}, ${y}) -> Steam (${ox}, ${oy}), OpenW (${a}, ${b})`);
        points++;
      }
    }
    assert.ok(data.experiments.length >= 50 && points > 1200, `${data.experiments.length} experiments, ${points} points`);
    // Steam's curves: Relaxed is Custom 100, the custom slider switches branch after 201
    assert.ok(Math.abs(TX.customSlope(100) - TX.CURVE_SLOPES.relaxed) < 1e-12);
    assert.ok(TX.customSlope(201) < 1 && TX.customSlope(202) > 1);
    // triggers: Steam's range, linear by default
    const t = TX.trigCfg(TX.blank('t').triggers.left);
    assert.strictEqual(TX.trigger(1000, t), 0);
    assert.strictEqual(TX.trigger(32000, t), 32767);
    assert.strictEqual(TX.trigger(16500, t), Math.trunc((15500 / 31000) * 32767));
  });

  test('input: the helper computes exactly what the page shows', () => {
    const { execFileSync } = require('child_process');
    // random settings of every kind, each checked on random sticks and triggers
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const lines = [], expect = [];
    for (let k = 0; k < 80; k++) {
      const p = TX.blank('t');
      Object.assign(p.sticks.left, { source: pick(['none', 'calibration', 'custom', 'custom']), shape: pick(['circle', 'cross', 'square']), inner: Math.round(rnd() * 12000), outer: 16000 + Math.round(rnd() * 16000),
        curve: pick(TX.CURVE_NAMES), customCurve: 25 + Math.round(rnd() * 350), anti: pick([0, Math.round(rnd() * 12000)]), antiBuffer: pick([0, Math.round(rnd() * 6000)]),
        scaleX: Math.round(rnd() * 100), scaleY: Math.round(rnd() * 100), invertX: rnd() < 0.3, invertY: rnd() < 0.3 });
      Object.assign(p.triggers.left, { start: Math.round(rnd() * 12000), end: 18000 + Math.round(rnd() * 14767), curve: pick(Object.keys(TX.CURVE_SLOPES)) });
      lines.push(...TX.lines(p).filter((l) => !l.startsWith('button')));
      const sc = TX.stickCfg(p.sticks.left), tc = TX.trigCfg(p.triggers.left);
      sc.slope = +sc.slope.toFixed(6); tc.slope = +tc.slope.toFixed(6); // the helper gets 6 places
      for (let j = 0; j < 25; j++) {
        const x = Math.round(rnd() * 65535) - 32768, y = Math.round(rnd() * 65535) - 32768, tv = Math.round(rnd() * 32767);
        lines.push(`in 0 ${x} ${y}`, `tin 0 ${tv}`);
        expect.push(TX.stick(x, y, sc), TX.trigger(tv, tc));
      }
    }
    const out = execFileSync(inputLib.EXE, ['--transform'], { input: `${lines.join('\n')}\n`, encoding: 'utf8' }).trim().split(/\r?\n/);
    assert.strictEqual(out.length, expect.length);
    out.forEach((line, i) => {
      const got = line.split(' ').slice(1).map(Number), want = [].concat(expect[i]);
      // whole numbers on both sides; a hair's difference in float rounding may move one by 1
      want.forEach((w, j) => assert.ok(Math.abs(got[j] - w) <= 1, `line ${i}: helper ${line}, page ${want.join(' ')}`));
    });
  }, !fs.existsSync(inputLib.EXE));

  test('input: profiles become the helper\'s lines, and old or pasted ones are completed', () => {
    const p = TX.blank('Test');
    p.buttons.A = { ...p.buttons.A, to: 'B', turbo: true, rate: 15, hold: 'Y', holdMs: 300 };
    p.sticks.left.ring = { to: 'LB', radius: 24000, invert: true };
    p.light = '#ff8000';
    const l = TX.lines(p);
    assert.strictEqual(l[l.length - 1], 'apply');
    assert.strictEqual(l.filter((x) => x.startsWith('button ')).length, TX.SOURCES.length);
    assert.strictEqual(l.find((x) => x.startsWith('button 0 ')), `button 0 ${TX.OUT.B} 1 15 0 ${TX.OUT.Y} 300`);
    assert.ok(l[0].endsWith(` 24000 1 ${TX.OUT.LB} 0`), l[0]);
    assert.ok(l.includes('light 255 128 0'));
    assert.strictEqual(l.find((x) => x.startsWith('button 15 ')).split(' ')[2], String(TX.OUT.Back), 'touchpad left half is View by default');
    assert.strictEqual(l.find((x) => x.startsWith('button 21 ')).split(' ')[2], String(TX.OUT.Start), 'touchpad right half is Menu by default');
    // Steam's defaults
    assert.deepStrictEqual([p.sticks.left.source, p.sticks.left.inner, p.sticks.left.outer, p.sticks.left.shape, p.sticks.left.customCurve], ['none', 0, 28000, 'circle', 200]);
    // a profile from before OpenW used Steam's units (percentages) is converted
    const old = TX.complete({ name: 'Old', sticks: { left: { shape: 'square', inner: 16, outer: 8, curve: 'linear' } } });
    assert.strictEqual(old.units, 'steam');
    assert.strictEqual(old.sticks.left.source, 'custom');
    assert.strictEqual(old.sticks.left.inner, Math.round(16 * 327.67));
    assert.strictEqual(old.sticks.left.outer, Math.round(92 * 327.67));
    assert.strictEqual(old.sticks.right.output, 'right');
    assert.strictEqual(old.buttons.Guide.to, 'Guide');
    // a Steam-unit profile is kept as it is
    const now = TX.complete({ units: 'steam', sticks: { left: { source: 'custom', inner: 6668, outer: 25755, shape: 'square' } } });
    assert.deepStrictEqual([now.sticks.left.inner, now.sticks.left.outer], [6668, 25755]);
  });

  test('input: a Steam layout file is imported with Steam\'s values', () => {
    const steamcfg = require('../src/main/core/steamcfg');
    const file = path.join(tmp, 'controller_ps4.vdf');
    fs.writeFileSync(file, `"controller_mappings"
{
	"version"		"3"
	"group" { "id" "0" "mode" "four_buttons" "inputs" { "button_a" { "activators" { "Full_Press" { "bindings" { "binding" "xinput_button A, , " } } } } "button_b" { "activators" { "Full_Press" { "bindings" { "binding" "xinput_button X, , " } "settings" { "toggle" "1" } } "Long_Press" { "bindings" { "binding" "xinput_button Y, , " } "settings" { "long_press_time" "500" } } } } } }
	"group" { "id" "3" "mode" "joystick_move" "inputs" { "click" { "activators" { "Full_Press" { "bindings" { "binding" "xinput_button JOYSTICK_LEFT, , " } } } } }
		"settings" { "deadzone_inner_radius" "6668" "deadzone_outer_radius" "25755" "deadzone_shape" "2" "deadzone_enable_type" "2" "curve_exponent" "5" "custom_curve_exponent" "300" } }
	"group" { "id" "8" "mode" "joystick_move" "settings" { "output_joystick" "1" } }
	"group" { "id" "4" "mode" "trigger" "settings" { "output_trigger" "1" } }
	"group" { "id" "11" "mode" "single_button" "inputs" { "click" { "activators" { "Full_Press" { "bindings" { "binding" "xinput_button SELECT, , " } } } } } }
	"group" { "id" "12" "mode" "single_button" "inputs" { "click" { "activators" { "Full_Press" { "bindings" { "binding" "key_press SPACE, , " } } } } } }
	"preset" { "id" "0" "name" "Default" "group_source_bindings" { "0" "button_diamond active" "3" "joystick active" "8" "right_joystick active" "4" "left_trigger active" "11" "left_trackpad active" "12" "right_trackpad active" } }
}
`);
    const { profile: p, skipped } = steamcfg.importLayout(file, TX, { name: 'Test', light: '#00ffff' });
    assert.deepStrictEqual([p.sticks.left.source, p.sticks.left.inner, p.sticks.left.outer, p.sticks.left.shape, p.sticks.left.curve, p.sticks.left.customCurve], ['custom', 6668, 25755, 'square', 'custom', 300]);
    assert.deepStrictEqual([p.sticks.right.source, p.sticks.right.outer, p.sticks.right.output], ['none', 28000, 'right']);
    assert.strictEqual(p.triggers.left.output, 'left');
    assert.deepStrictEqual([p.buttons.A.to, p.buttons.B.to, p.buttons.B.toggle, p.buttons.B.hold, p.buttons.B.holdMs], ['A', 'X', true, 'Y', 500]);
    assert.strictEqual(p.buttons.LS.to, 'LS');
    assert.strictEqual(p.buttons.Touchpad.to, 'Back');
    assert.strictEqual(p.buttons.TouchpadRight.to, '', 'a keyboard binding has no Xbox button');
    assert.ok(skipped.some((x) => /key_press/.test(x)));
    assert.strictEqual(p.light, '#00ffff');
    assert.strictEqual(TX.complete(p).sticks.left.inner, 6668, 'kept in Steam units');
  });

  test('input: the helper\'s messages are understood', () => {
    const inp = new inputLib.Input(path.join(tmp, 'nowhere.exe'));
    const seen = [];
    inp.on('status', (s) => seen.push(s));
    inp.on('state', (s) => seen.push(s));
    inp.line('vigem ok 1');
    inp.line('pad dualsense bt 0 own');
    inp.line('state 0.1 -0.2 0 0 0.5 1 3 0.12 -0.25 0 0 0.6 1 4096');
    inp.line('pad none');
    assert.strictEqual(seen[0].vigem, true);
    assert.deepStrictEqual(seen[1].pad, { kind: 'dualsense', conn: 'bt', access: 'own' });
    assert.deepStrictEqual(seen[2].raw, [0.1, -0.2, 0, 0, 0.5, 1]);
    assert.strictEqual(seen[2].outButtons, 4096);
    assert.strictEqual(seen[3].pad, null);
    assert.throws(() => inp.start(TX.blank('x')), /missing/);
  });

  test('input: HidHide\'s controller list is grouped per controller, with what is hidden marked', () => {
    const json = [
      { friendlyName: 'Wireless Controller', devices: [
        { present: true, gamingDevice: true, deviceInstancePath: 'HID\\VID_054C&PID_09CC&MI_03\\8&1', baseContainerDeviceInstancePath: 'USB\\VID_054C&PID_09CC\\5&2' },
        { present: true, gamingDevice: true, deviceInstancePath: 'HID\\VID_054C&PID_09CC&MI_03&Col02\\8&1', baseContainerDeviceInstancePath: 'USB\\VID_054C&PID_09CC\\5&2' }] },
      { friendlyName: 'Xbox 360 Controller for Windows', devices: [
        { present: true, gamingDevice: true, deviceInstancePath: 'USB\\VID_045E&PID_028E\\1&2', baseContainerDeviceInstancePath: 'USB\\VID_045E&PID_028E\\1&2' }] },
      { friendlyName: 'Gone', devices: [{ present: false, deviceInstancePath: 'HID\\VID_1234&PID_5678\\1' }] },
    ];
    const list = inputLib.controllers(json, ['hid\\vid_054c&pid_09cc&mi_03\\8&1']);
    assert.strictEqual(list.length, 2);
    assert.deepStrictEqual(list[0].paths, ['HID\\VID_054C&PID_09CC&MI_03\\8&1', 'USB\\VID_054C&PID_09CC\\5&2', 'HID\\VID_054C&PID_09CC&MI_03&Col02\\8&1']);
    assert.strictEqual(list[0].hidden, true);
    assert.strictEqual(list[0].name, 'Wireless Controller');
    assert.strictEqual(list[1].virtual, true);
    assert.strictEqual(inputLib.decode(Buffer.from('﻿--cloak-on', 'utf16le')), '--cloak-on');
  });

  test('input: the driver installers OpenW comes with are intact, and the install script is valid PowerShell', () => {
    const { execFileSync } = require('child_process');
    for (const w of Object.keys(inputLib.DRIVERS)) assert.ok(inputLib.bundled(w), `${inputLib.DRIVERS[w].file} is missing or changed`);
    const files = Object.keys(inputLib.DRIVERS).map((w) => [w, inputLib.bundled(w)]);
    const script = `$out = ${inputLib.psQuote(path.join(tmp, "it's out.txt"))}\r\n${inputLib.installScript(files)}`;
    const file = path.join(tmp, 'install.ps1');
    fs.writeFileSync(file, script);
    const parse = `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile(${inputLib.psQuote(file)}, [ref]$null, [ref]$e); $e.Count`;
    assert.strictEqual(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', parse], { encoding: 'utf8' }).trim(), '0');
    assert.ok(script.includes("'/exenoui','/qn','/norestart'"));
    assert.ok(script.includes('restart-pads.ps1') && fs.existsSync(path.join(__dirname, '..', 'src', 'main', 'restart-pads.ps1')), 'controllers restart after HidHide');
  });

  await runAll();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${skipped} skipped${process.exitCode ? ', FAILURES above' : ''}`);
})();
