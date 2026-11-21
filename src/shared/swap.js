/* Can the item you own (source) take the look of another (target)? Used by the main process
   (core/catalog.js) and by the Garage page, so the list only offers looks that will show.
   Items: { id, ok, len, path, stuck } where path is where the game finds the look
   (['WHEEL_Star', 'WHEEL_Star'], see main/core/looks.js) and stuck names a game file that keeps the
   item loaded and that OpenW does not change. The swap itself checks the rest (main/core/looks.js).
   Loaded by the page as a script and by the main process with require. */
(function (root) {
  const lc = (s) => String(s || '').toLowerCase();
  // '' when it can, otherwise a reason code (see WHY)
  function swapProblem(source, target) {
    if (!source || !target || source.id === target.id) return 'same';
    if (source.stuck) return 'stuck';
    if (!target.ok) return 'key';
    if (source.len > target.len) return 'long';
    const sp = source.path || [], tp = target.path || [];
    if (sp.length > 1 && tp.length > 1) {
      const Ps = sp[0], Os = sp[sp.length - 1], Pt = tp[0], Ot = tp[tp.length - 1];
      if (lc(Ot) === lc(Pt)) { if (lc(Os) !== lc(Ps)) return 'tiered'; } // one name for the package and its look
      else if (Os.length > Ot.length) return 'long'; // the look's own name is renamed in place
    }
    return '';
  }
  const WHY = {
    same: 'Pick two different items.',
    stuck: 'The game keeps this item in its own program files, which OpenW does not change, so it cannot take another look.',
    key: 'This look uses a newer package key that OpenW cannot read. A key list in Settings opens it.',
    long: 'Not supported yet: this look has a shorter internal name than your item.',
    tiered: 'Your item shares its file with its other versions (tiers), so it can only take a look that does too.',
    layout: 'This look is stored differently from your item, so the game would not find it.',
  };
  // a reason code for an error code from the swap (engine)
  const CODES = { NAME_TOO_LONG: 'long', NO_KEY: 'key', TIERED: 'tiered', LAYOUT_DIFFERS: 'layout', SAME_ITEM: 'same' };
  const api = { swapProblem, WHY, CODES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenWSwap = api;
}(typeof window !== 'undefined' ? window : globalThis));
