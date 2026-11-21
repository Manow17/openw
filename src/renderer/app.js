/* OpenW renderer. No framework: a small element helper, a few custom controls,
   and one function per page that returns a bento grid of tiles. */
const api = (method, ...args) => window.openw.call(method, ...args);

let S = null;          // latest snapshot from the main process
let catalog = null;    // item catalog, loaded on first use
const ui = { tab: location.hash.slice(1) || 'garage', cat: 'cars', q: '', slot: 'src', src: null, dst: null, check: null, only: true, packType: 'all' };

const PAGES = {
  garage: ['Garage', 'Give an item you own the look of another. Only you see it.'],
  maps: ['Workshop Maps', 'Training and challenge maps, on Steam or Epic.'],
  lab: ['Map Merge', 'Mix the game’s own arenas, and add snow.'],
  controller: ['Controller', 'OpenW Input: Steam-style stick, trigger and button settings for any controller.'],
  presets: ['Presets', 'Save your whole setup and switch in one click.'],
  overlay: ['Overlay', 'Your music and your controller, over the game.'],
  clips: ['Clips', 'Press a key in game to save the last moments.'],
  profile: ['Profile', 'Your OpenW card.'],
  settings: ['Settings', ''],
};
const NAV = [
  [['garage', 'cars'], ['maps', 'maps'], ['lab', 'merge'], ['presets', 'presets']],
  [['controller', 'stick'], ['overlay', 'overlay'], ['clips', 'clips']],
  [['profile', 'profile'], ['settings', 'settings']],
];
const RANKS = ['', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Champion', 'Grand Champion', 'Supersonic Legend'];
const COLORS = ['#00d8c8', '#38bdf8', '#818cf8', '#c084fc', '#f472b6', '#fb7185', '#fb923c', '#facc15', '#a3e635'];

// Line icons on a 24px grid (drawn for this project).
const IC = {
  cars: 'M3 13l2-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 5v4h-2a2 2 0 0 1-4 0H9a2 2 0 0 1-4 0H3z M5 13h14',
  wheels: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z M12 3v6 M12 15v6 M3 12h6 M15 12h6',
  boosts: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4c0 2 1 3 2 3c0-3-1-5 1-9z',
  decals: 'M4 20l6-2l10-10a2.1 2.1 0 0 0-3-3L7 15z M14 7l3 3',
  toppers: 'M7 16v-4a5 5 0 0 1 10 0v4 M3 16c0 1.7 4 3 9 3s9-1.3 9-3s-4-1-9-1s-9-.7-9 1z',
  antennas: 'M6 21V4 M6 5h11l-2 3.5L17 12H6',
  engines: 'M4 10v4h3l5 4V6L7 10z M16 9a4 4 0 0 1 0 6 M18.5 6.5a8 8 0 0 1 0 11',
  trails: 'M3 8h10 M3 12h14 M3 16h8 M17 8l4 4l-4 4',
  explosions: 'M12 3l2 5l5-2l-2 5l5 2l-5 2l2 5l-5-2l-2 5l-2-5l-5 2l2-5l-5-2l5-2l-2-5l5 2z',
  finishes: 'M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z',
  banners: 'M3 7h18v10H3z M7 11h7 M7 14h4',
  borders: 'M4 4h16v16H4z M8 8h8v8H8z',
  anthems: 'M9 18V6l10-2v12 M9 18a3 3 0 1 1-6 0a3 3 0 0 1 6 0z M19 16a3 3 0 1 1-6 0a3 3 0 0 1 6 0z',
  packs: 'M3 8l9-5l9 5v8l-9 5l-9-5z M3 8l9 5l9-5 M12 13v8',
  maps: 'M9 4L3 6v14l6-2l6 2l6-2V4l-6 2z M9 4v14 M15 6v14',
  presets: 'M12 3l9 5l-9 5l-9-5z M3 12.5l9 5l9-5 M3 17l9 5l9-5',
  active: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M8 12l3 3l5-6',
  tracker: 'M4 19V5 M4 19h16 M7 15l4-4l3 3l5-6',
  overlay: 'M7 8h10a5 5 0 0 1 5 5v2a3 3 0 0 1-5.5 1.5L15 15H9l-1.5 1.5A3 3 0 0 1 2 15v-2a5 5 0 0 1 5-5z M7 11v3 M5.5 12.5h3 M16 12h.01 M18 14h.01',
  profile: 'M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8z M4 20a8 8 0 0 1 16 0',
  settings: 'M4 7h10 M18 7h2 M14 5v4 M4 17h4 M12 17h8 M8 15v4',
  ball: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M12 8l4 3l-1.5 4.5h-5L8 11z M12 3v5 M20.5 10L16 11 M17 19l-2.5-3.5 M7 19l2.5-3.5 M3.5 10L8 11',
  gauge: 'M4 16a8 8 0 1 1 16 0 M12 16l4-5 M12 16h.01',
  image: 'M4 5h16v14H4z M4 15l4-4l4 4l3-3l5 5 M15 9h.01',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14z M20 20l-4-4',
  down: 'M12 5v14 M6 13l6 6l6-6',
  chevron: 'M6 9l6 6l6-6',
  check: 'M5 12l5 5l9-10',
  warn: 'M12 4l9 16H3z M12 10v4 M12 17h.01',
  info: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M12 11v5 M12 8h.01',
  plus: 'M12 5v14 M5 12h14',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.500 10.500z',
  play: 'M8 5l11 7l-11 7z',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3 M5 11h14v9H5z M12 15v2',
  merge: 'M6 4v5a7 7 0 0 0 7 7h5 M6 20v-9 M15 12l4 4l-4 4',
  stick: 'M12 3a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7z M12 10v5 M5 15h14l-1.5 6h-11z',
  clips: 'M4 6h16v12H4z M8 6v12 M16 6v12 M4 10h4 M4 14h4 M16 10h4 M16 14h4 M11 10.5l3 1.5l-3 1.5z',
};
const FILLED = new Set(['play']);
// which icon stands for a pack type / operation category
const GLYPH = { decal: 'decals', boostmeter: 'gauge', menu: 'maps', loading: 'image', music: 'anthems', sound: 'engines', other: 'packs', map: 'maps' };
const glyphFor = (key) => (IC[key] ? key : GLYPH[key] || 'packs');

/* ---------- element helpers ---------- */

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled'].includes(k)) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(3)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function icon(name, size = 18) {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', width: size, height: size, class: 'ic' });
  const path = svgEl('path', { d: IC[name] || IC.packs });
  if (FILLED.has(name)) { path.setAttribute('fill', 'currentColor'); path.setAttribute('stroke', 'none'); }
  svg.append(path);
  return svg;
}

// The app mark: the same picture as the window icon.
const mark = (size) => h('img', { class: 'mark', src: '../../assets/icon.png', width: size, height: size, alt: '', draggable: 'false' });

const bento = (...kids) => h('div', { class: 'bento' }, kids);
const tile = (cls, ...kids) => h('section', { class: `tile ${cls}` }, kids);
const head = (label, ...actions) => h('div', { class: 'head' }, h('h3', {}, label), actions);
const noteTile = (kind, cls, ...content) => h('section', { class: `tile note ${kind === 'warn' ? 'warn' : ''} ${cls}` }, icon(kind === 'warn' ? 'warn' : 'info', 20), h('div', { class: 'grow' }, content));
const empty = (glyph, heading, text, ...actions) => h('div', { class: 'empty' }, h('span', { class: 'art lg' }, icon(glyph, 30)), h('b', {}, heading), h('p', {}, text), actions);
const btnIcon = (cls, name, label, onclick, extra = {}) => h('button', { class: `btn ${cls}`, onclick, ...extra }, icon(name, 16), label);
const field = (props) => h('input', { type: 'text', spellcheck: 'false', ...props, class: `field ${props.class || ''}` });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const go = (tab) => () => { ui.tab = tab; location.hash = tab; render(); };

// A soft-tinted icon square. The hue comes from the name, so items stay recognisable.
function art(name, glyph, cls = '') {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return h('span', { class: `art ${cls}`, style: `--h:${hash % 360}` }, icon(glyphFor(glyph), cls.includes('lg') ? 30 : 20));
}

/* ---------- custom controls ---------- */

const toggle = (checked, onchange) => h('input', { type: 'checkbox', role: 'switch', class: 'switch', checked, onchange: (e) => onchange(e.target.checked) });

function slider(min, max, value, onchange, oninput, step = 1) {
  const el = h('input', { type: 'range', class: 'slider grow', min, max, step, value });
  const paint = () => el.style.setProperty('--p', `${((el.value - min) / (max - min)) * 100}%`);
  paint();
  el.addEventListener('input', () => { paint(); if (oninput) oninput(Number(el.value)); });
  el.addEventListener('change', () => onchange(Number(el.value)));
  return el;
}

// The number shown next to a slider, made typeable: click it (or Enter on it), type a value,
// Enter. The value is clamped to the slider's range and snapped to its step, then goes through
// the slider's own input and change events, so it is shown and saved exactly as dragging does.
// Escape leaves it as it was; clicking away keeps what was typed.
const clampToRange = (text, range) => window.OpenWValues.typedValue(text, Number(range.min), Number(range.max), Number(range.step) || 1);
function typeable(label, range) {
  label.classList.add('typeable');
  label.tabIndex = 0;
  label.title = 'Click to type a value';
  const edit = () => {
    if (label.querySelector('input')) return;
    const shown = [...label.childNodes];
    const box = h('input', { class: 'valbox', type: 'text', inputmode: 'decimal', spellcheck: 'false', value: range.value, 'aria-label': 'Type a value' });
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const v = commit ? clampToRange(box.value, range) : null;
      label.replaceChildren(...shown);
      if (v != null && v !== Number(range.value)) {
        range.value = v;
        range.dispatchEvent(new Event('input'));
        range.dispatchEvent(new Event('change'));
      }
      if (pendingRender) { pendingRender = false; render(); }
    };
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); if (label.isConnected) label.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); label.focus(); }
    });
    box.addEventListener('blur', () => finish(true));
    label.replaceChildren(box);
    box.focus();
    box.select();
  };
  label.addEventListener('click', edit);
  label.addEventListener('keydown', (e) => { if (e.target === label && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); edit(); } });
  return label;
}
// a value being typed is not thrown away by a page refresh: the refresh waits until it is done
let pendingRender = false;
const typing = () => !!(document.activeElement && document.activeElement.classList.contains('valbox'));

const seg = (options, value, onchange) => h('div', { class: 'seg', role: 'radiogroup' }, options.map(([v, label]) =>
  h('button', { class: v === value ? 'on' : '', role: 'radio', 'aria-checked': String(v === value), onclick: () => v !== value && onchange(v) }, label)));

// Dropdown that replaces <select>. options: [[value, label], ...]
let menuOpen = null;
function closeMenu() {
  if (!menuOpen) return;
  menuOpen.menu.remove();
  menuOpen.btn.classList.remove('open');
  menuOpen.btn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', menuOpen.outside, true);
  menuOpen = null;
}
function select(options, value, onchange, width) {
  const current = options.find(([v]) => v === value) || options[0] || [null, 'Loading…'];
  const btn = h('button', { class: 'select', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', style: width && `width:${width}px` },
    h('span', { class: 'grow clip' }, current[1]), icon('chevron', 16));
  const open = () => {
    closeMenu();
    let active = Math.max(0, options.findIndex(([v]) => v === value));
    const choose = (v) => { closeMenu(); btn.focus(); if (v !== value) onchange(v); };
    const menu = h('div', { class: 'menu', role: 'listbox', tabindex: '-1' }, options.map(([v, label], i) =>
      h('button', { class: `opt${v === value ? ' on' : ''}`, role: 'option', tabindex: '-1', onclick: () => choose(v), onpointermove: () => setActive(i, false) },
        h('span', { class: 'grow' }, label), v === value && icon('check', 15))));
    function setActive(i, scroll = true) {
      active = (i + options.length) % options.length;
      [...menu.children].forEach((c, j) => c.classList.toggle('active', j === active));
      if (scroll) menu.children[active].scrollIntoView({ block: 'nearest' });
    }
    menu.addEventListener('keydown', (e) => {
      const keys = { ArrowDown: () => setActive(active + 1), ArrowUp: () => setActive(active - 1), Home: () => setActive(0), End: () => setActive(options.length - 1),
        Enter: () => choose(options[active][0]), ' ': () => choose(options[active][0]), Escape: () => { closeMenu(); btn.focus(); }, Tab: () => closeMenu() };
      if (keys[e.key]) { if (e.key !== 'Tab') e.preventDefault(); keys[e.key](); }
    });
    document.body.append(menu);
    const r = btn.getBoundingClientRect();
    const below = window.innerHeight - r.bottom > Math.min(menu.scrollHeight, 280) + 14;
    menu.style.cssText = `left:${r.left}px;min-width:${r.width}px;transform-origin:${below ? 'top' : 'bottom'} left;${below ? `top:${r.bottom + 6}px` : `bottom:${window.innerHeight - r.top + 6}px`}`;
    const outside = (e) => { if (!menu.contains(e.target) && !btn.contains(e.target)) closeMenu(); };
    document.addEventListener('pointerdown', outside, true);
    menuOpen = { menu, btn, outside };
    btn.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    menu.focus();
    setActive(active);
  };
  btn.addEventListener('click', () => (menuOpen && menuOpen.btn === btn ? closeMenu() : open()));
  btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); } });
  return btn;
}
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

function toast(message, isError) {
  const el = h('div', { class: `toast${isError ? ' err' : ''}`, role: 'status' }, icon(isError ? 'warn' : 'check', 16), h('span', {}, message));
  document.getElementById('toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, isError ? 7000 : 3200);
}

// Run an action, show failures as a toast, re-render afterwards.
async function run(fn, done) {
  try {
    const res = await fn();
    if (res && res.state) S = res.state; else if (res && res.settings) S = res;
    if (done) toast(typeof done === 'function' ? done(res) : done);
    render();
    return res;
  } catch (e) {
    toast(String(e.message || e).replace(/^Error invoking remote method 'api': (Error: )?/, ''), true);
  }
}

const set = (key, value) => run(() => api('setSetting', key, value));
const queuedMsg = (res) => (res.queued ? 'Queued. It goes in when Rocket League closes.' : 'Applied.');
const themeMode = () => (S.settings.theme.mode === 'light' ? 'light' : 'dark');

// Switch theme. Colours cross-fade through CSS transitions (see :root.theming), so the
// page is not rebuilt until the fade is over: freshly created elements would not fade.
let themeTimer = null;
function setTheme(mode) {
  if (themeMode() === mode) return;
  const root = document.documentElement;
  S.settings.theme = { mode };
  root.classList.add('theming');
  root.dataset.theme = mode;
  const btn = document.querySelector('#top .iconbtn');
  if (btn) btn.replaceChildren(icon(mode === 'dark' ? 'sun' : 'moon', 18));
  clearTimeout(themeTimer);
  themeTimer = setTimeout(() => { root.classList.remove('theming'); render(); }, 420);
  api('setSetting', 'theme', { mode }).catch((e) => toast(String(e.message || e), true));
}

/* ---------- shell ---------- */

let shown = null; // which page the view currently holds, to animate only on page changes
function render(animate) {
  if (typing()) { pendingRender = true; return; }
  closeMenu();
  document.documentElement.dataset.theme = themeMode();
  const nav = document.getElementById('nav'), top = document.getElementById('top'), view = document.getElementById('view');
  const ready = S.install.valid;
  if (!PAGES[ui.tab]) ui.tab = 'garage';
  const page = ready ? ui.tab : 'setup';
  document.body.classList.toggle('setup', !ready);
  view.classList.toggle('enter', !!animate || shown !== page);
  if (shown !== page) view.scrollTop = 0;
  shown = page;

  const [name, sub] = ready ? PAGES[ui.tab] : ['OpenW', ''];
  const dark = themeMode() === 'dark';
  top.replaceChildren(...[
    h('div', { class: 'pagetitle grow' }, h('h1', {}, name), sub && h('span', { class: 'muted clip' }, sub)),
    ready && S.running && h('span', { class: 'pill' }, h('span', { class: 'dot live' }), h('span', { 'data-progress': 'queue' }, 'Game running · changes are queued')),
    S.update && S.update.status === 'ready' && h('button', { class: 'btn sm primary', title: 'Closes OpenW, installs the new version and starts it again', onclick: () => run(() => api('updateInstall'), (r) => (r.update && r.update.status === 'installing' ? 'Installing the update. OpenW starts again when it is done.' : (r.update && r.update.error) || 'The update did not start.')) }, `Update to v${S.update.version}`),
    h('button', { class: 'iconbtn', 'aria-label': dark ? 'Switch to light mode' : 'Switch to dark mode', onclick: () => setTheme(themeMode() === 'dark' ? 'light' : 'dark') }, icon(dark ? 'sun' : 'moon', 18)),
    ready && btnIcon('primary', 'play', 'Play', () => run(() => api('launchGame'), 'Starting Rocket League…'), { disabled: S.running }),
  ].filter(Boolean));
  if (!ready) { view.replaceChildren(setup()); return; }
  updateNav(nav);
  view.replaceChildren(views[ui.tab]());
}

// The sidebar is built once so the highlight can slide between items.
function updateNav(nav) {
  if (!nav.firstChild) {
    const list = h('div', { class: 'navlist' }, h('div', { class: 'ind' }));
    NAV.forEach((group, g) => {
      if (g) list.append(h('div', { class: 'gap' }));
      for (const [id, glyph] of group) {
        list.append(h('button', { 'data-tab': id, onclick: go(id) }, icon(glyph), h('span', { class: 'grow' }, PAGES[id][0]), id === 'garage' && h('span', { class: 'count', hidden: '' })));
      }
    });
    nav.append(h('div', { class: 'brand' }, mark(32), 'OPENW'), list,
      h('div', { class: 'gamestate' }, h('div', { class: 'row', style: 'gap:8px' }, h('span', { class: 'dot' }), h('b', {}, 'Rocket League')), h('span', { class: 'muted small' }), h('span', { class: 'muted small' }, `v${S.version} · open source`)));
  }
  const ind = nav.querySelector('.ind');
  for (const btn of nav.querySelectorAll('[data-tab]')) {
    const on = btn.dataset.tab === ui.tab;
    btn.classList.toggle('on', on);
    if (on) {
      if (!ind.dataset.placed) { ind.style.transition = 'none'; requestAnimationFrame(() => { ind.style.transition = ''; }); ind.dataset.placed = '1'; }
      ind.style.transform = `translateY(${btn.offsetTop}px)`;
    }
  }
  // the badge sits on the Garage, so it counts item swaps only
  const pending = S.engine.active.filter((r) => r.op.kind === 'swap').length + S.engine.queue.filter((q) => !q.op || q.op.kind === 'swap').length;
  const count = nav.querySelector('.count');
  count.hidden = !pending;
  count.textContent = pending;
  const state = nav.querySelector('.gamestate');
  state.querySelector('.dot').classList.toggle('live', S.running);
  state.children[1].textContent = `${S.install.platform === 'steam' ? 'Steam' : 'Epic Games'} · ${S.running ? 'running' : 'not running'}`;
}

function setup() {
  const choose = (platform, label) => h('button', { class: 'tile s6 press', onclick: async () => {
    const found = await api('detectGame');
    if (found[platform]) run(() => api('setInstall', platform, found[platform]), 'Found Rocket League.');
    else { toast(`No ${label} install found. Start Rocket League once and click ${label} again (OpenW then finds it from the game's own log), or select the "rocketleague" folder.`, true); run(() => api('browseInstall', platform)); }
  } }, h('h3', {}, 'Launcher'), h('h2', {}, label), h('span', { class: 'muted small' }, 'Detect automatically'));
  return h('div', { class: 'setupwrap' }, bento(
    tile('s12 hero ink', mark(72), h('h1', {}, 'Where do you play?'), h('p', { class: 'muted' }, 'Pick your launcher and OpenW finds Rocket League for you.')),
    choose('steam', 'Steam'), choose('epic', 'Epic Games'),
    noteTile('info', 's12', 'OpenW only changes files on your own PC and backs up every file it touches. It is a fan project, not affiliated with Psyonix or Epic Games.')));
}

/* ---------- garage: item swaps ---------- */

// A failed load is shown with its reason and a way to try again, never as endless loading.
const reason = (e) => String((e && e.message) || e).replace(/^Error invoking remote method 'api': (Error: )?/, '');
const failed = (glyph, heading, error, retry) => empty(glyph, heading, `${error} Details are in openw.log in the data folder.`,
  h('div', { class: 'row wrap', style: 'justify-content:center' }, h('button', { class: 'btn primary', onclick: retry }, 'Try again'),
    h('button', { class: 'btn', onclick: () => run(async () => { const res = await api('browseInstall', S.install.platform); catalog = null; catalogError = null; arenas = null; arenasError = null; return res; }) }, 'Choose the Rocket League folder'),
    h('button', { class: 'btn', onclick: () => api('openDataFolder') }, 'Open data folder')));
let catalogError = null, catalogLoading = false;
async function ensureCatalog() {
  if (catalog || catalogLoading) return;
  catalogLoading = true;
  try {
    const c = await api('getCatalog');
    c.counts = {};
    c.byId = new Map();
    for (const i of c.items) {
      c.counts[i.category] = (c.counts[i.category] || 0) + 1;
      c.byId.set(i.id, i);
      i.search = `${i.label} ${i.sub} ${i.name} ${i.file}`.toLowerCase(); // shop name, car, internal name
    }
    c.catLabel = Object.fromEntries(c.categories.map((x) => [x.id, x.label]));
    catalog = c;
    catalogError = null;
  } catch (e) { catalogError = reason(e); } finally { catalogLoading = false; }
  if (ui.tab === 'garage') render(true);
}

// The item's real picture, read from the game's own files (thumb://, see main.js).
// Items whose package cannot be read fall back to their category icon.
function picture(item, glyph, cls = '') {
  const box = h('span', { class: `pic ${cls}` });
  // a lock means the package needs a key OpenW does not have (see Settings)
  const fallback = () => { box.classList.add('none'); box.replaceChildren(icon(item && item.ok === false ? 'lock' : glyphFor(glyph), cls.includes('sm') ? 18 : 26)); };
  if (!item || !item.thumb) { fallback(); return box; }
  const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', draggable: 'false', src: `thumb://item/${encodeURIComponent(item.thumb)}?k=${S.keys}` });
  img.addEventListener('load', () => img.classList.add('in'));
  img.addEventListener('error', fallback);
  box.append(img);
  if (img.complete && img.naturalWidth) img.classList.add('in');
  return box;
}

// Can the item you own take this look? The same check as the main process (shared/swap.js).
const canSwap = (source, target) => !window.OpenWSwap.swapProblem(source, target);
const whyNot = (source, target, code) => window.OpenWSwap.WHY[window.OpenWSwap.swapProblem(source, target) || window.OpenWSwap.CODES[code]] || '';

const views = {};
let popGrid = false; // animate the item grid on the next render (category change)
let garage = null;   // handles of the mounted Garage page, so a pick does not rebuild it

views.garage = () => {
  const root = bento();
  if (!catalog && catalogError) { root.append(tile('s12', failed('cars', 'Your game files could not be read', catalogError, () => { catalogError = null; render(); }))); return root; }
  if (!catalog) { ensureCatalog(); root.append(tile('s12', empty('cars', 'Reading your game files', 'Building the item list from your own install.'))); return root; }

  const pool = () => catalog.items.filter((i) => i.category === ui.cat);
  const op = () => ({ kind: 'swap', sourceFile: ui.src.file, targetFile: ui.dst.file, category: ui.src.category, label: `${ui.src.label} → ${ui.dst.label}` });
  const bar = h('section', { class: 'swapbar' });
  const grid = h('div', { class: `grid${popGrid ? ' pop' : ''}` });
  const count = h('span', { class: 'muted small' });
  const only = h('label', { class: 'row small muted' });
  popGrid = false;

  function paintBar() {
    const pick = (which, label, item, hint) => h('button', { class: `pick${ui.slot === which ? ' on' : ''}`, onclick: () => { ui.slot = which; paintBar(); fill(); } },
      item ? picture(item, item.category, 'lg') : h('span', { class: 'pic lg blank' }, which === 'src' ? '1' : '2'),
      h('span', { class: 'col grow', style: 'gap:4px' }, h('h3', {}, label),
        item ? h('span', { class: 'name clip' }, item.label) : h('span', { class: 'muted' }, hint),
        item && h('span', { class: 'muted small clip' }, [item.sub, item.file].filter(Boolean).join(' · '))));
    const ready = ui.check && ui.check.ok;
    const queued = ui.src && S.engine.queue.some((q) => q.key === ui.src.id);
    const applied = ui.src && S.engine.active.some((r) => r.key === ui.src.id);
    let status;
    if (!ui.src) status = h('span', { class: 'muted' }, 'Start with an item you own');
    else if (queued) status = h('span', { class: 'tag on' }, 'Queued: close Rocket League to apply');
    else if (!ui.dst) status = h('span', { class: 'muted' }, applied ? 'This item is swapped. Pick a look to change it.' : 'Now pick its new look');
    else if (!ui.check) status = h('span', { class: 'muted' }, 'Checking…');
    else if (!ready) status = h('span', { style: 'color:var(--bad)' }, whyNot(ui.src, ui.dst, ui.check.code) || ui.check.message);
    else if (S.running) status = h('span', { class: 'muted' }, 'Rocket League is open. The swap waits until you close it.');
    else if (ui.src.early) status = h('span', { class: 'muted' }, `Ready. ${ui.src.label} is a default item the game loads early (${ui.src.early.join(', ')}), so OpenW also renames that early copy and the game reads your swap.`);
    else if (ui.cat === 'cars' || ui.cat === 'explosions') status = h('span', { class: 'muted' }, 'Ready. Other tools report that car and goal explosion swaps can crash the game.');
    else status = h('span', { class: 'tag on' }, 'Ready');
    bar.replaceChildren(
      pick('src', 'Your item', ui.src, 'Pick an item you own'),
      h('div', { class: 'tile mid ink' },
        h('button', { class: 'btn primary lg', disabled: !ready, onclick: () => run(() => api('apply', op()), queuedMsg) }, S.running ? 'Queue swap' : 'Swap'),
        h('div', { class: 'status' }, status),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm grow', disabled: !ui.src, onclick: () => { const p = pool().filter((i) => canSwap(ui.src, i)); pickItem(p[Math.floor(Math.random() * p.length)], 'dst'); } }, 'Random'),
          h('button', { class: 'btn sm grow', onclick: () => { ui.src = ui.dst = ui.check = null; ui.slot = 'src'; paintBar(); fill(); } }, 'Clear'))),
      pick('dst', 'New look', ui.dst, 'Then pick its new look'));
    requestAnimationFrame(() => root.style.setProperty('--bar', `${bar.offsetHeight}px`));
  }

  function cell(i, n, blocked) {
    // under the name: the car a decal is made for
    return h('button', { class: `cell${blocked ? ' no' : ''}`, 'data-id': i.id, style: n < 24 && `--i:${n}`, 'aria-label': i.label, onclick: () => pickItem(i, ui.slot) },
      picture(i, i.category), h('span', { class: 'name' }, i.label), i.sub && h('span', { class: 'sub' }, i.sub));
  }
  function mark() { // show which cells are picked, without rebuilding them
    for (const el of grid.children) {
      const isSrc = !!ui.src && ui.src.id === el.dataset.id, isDst = !!ui.dst && ui.dst.id === el.dataset.id;
      el.classList.toggle('src', isSrc);
      el.classList.toggle('dst', isDst);
      const badge = el.querySelector('.badge');
      if (badge) badge.remove();
      if (isSrc || isDst) el.append(h('span', { class: 'badge' }, isSrc ? 'YOURS' : 'NEW'));
    }
  }
  // The list is added to the page a batch at a time as you scroll.
  const BATCH = 96;
  const sentinel = h('div', { style: 'height:1px' });
  let list = [], shown = 0;
  const picking = () => ui.slot === 'dst' && ui.src; // choosing a look for a known item
  // A section only ever lists its own items. When a search also matches items in
  // other sections, they are offered here as links instead of being mixed in.
  const elsewhere = h('div', { class: 'elsewhere' });
  const jump = (id) => () => { ui.cat = id; ui.src = ui.dst = ui.check = null; ui.slot = 'src'; popGrid = true; render(); }; // keeps the search text
  function paintElsewhere(q, here) {
    const found = {};
    if (q && !picking()) for (const i of catalog.items) if (i.category !== ui.cat && i.search.includes(q)) found[i.category] = (found[i.category] || 0) + 1;
    const others = catalog.categories.filter((c) => found[c.id]);
    elsewhere.hidden = !others.length && !(q && !here);
    elsewhere.replaceChildren(
      h('span', { class: 'muted small' }, !others.length ? `Nothing called “${ui.q.trim()}” in any section.` : here ? 'Also found in' : `Nothing in ${catalog.catLabel[ui.cat]} called “${ui.q.trim()}”. Found in`),
      ...others.map((c) => h('button', { class: 'chip', onclick: jump(c.id) }, icon(c.id, 15), c.label, h('small', {}, found[c.id]))));
  }
  function more() {
    if (shown >= list.length) return;
    const blocked = (i) => !!picking() && i !== ui.src && !canSwap(ui.src, i);
    grid.append(...list.slice(shown, shown + BATCH).map((i, n) => cell(i, shown + n, blocked(i))));
    shown = Math.min(shown + BATCH, list.length);
    mark();
    io.unobserve(sentinel); // re-arm: fires again if the end of the list is still in view
    if (shown < list.length) io.observe(sentinel);
  }
  if (garage) garage.io.disconnect();
  const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) more(); }, { root: document.getElementById('view'), rootMargin: '500px' });
  function fill() {
    const q = ui.q.trim().toLowerCase();
    list = pool().filter((i) => !q || i.search.includes(q));
    const total = list.length;
    paintElsewhere(q, total);
    const works = picking() ? list.filter((i) => canSwap(ui.src, i)).length : total;
    if (picking() && ui.only) list = list.filter((i) => canSwap(ui.src, i) || i === ui.src);
    // best matches first when searching (name starts with the text), then items with a readable picture
    const rank = (i) => (q && i.label.toLowerCase().startsWith(q) ? 0 : 1);
    list.sort((a, b) => (rank(a) - rank(b)) || (b.ok - a.ok) || a.label.localeCompare(b.label));
    grid.replaceChildren();
    shown = 0;
    more();
    count.textContent = picking() ? `${works} of ${total} looks work with ${ui.src.label}` : plural(total, 'item');
    only.replaceChildren(...(picking() ? [toggle(ui.only, (v) => { ui.only = v; fill(); }), 'Only looks that work'] : []));
  }
  garage = { paintBar, fill, mark, io };
  paintBar();
  fill();

  // Everything OpenW has put in the game, or will when it closes, with a way back.
  const changes = [...S.engine.queue.filter((q) => !q.op || q.op.kind === 'swap').map((q) => ({ q, op: q.op })), ...S.engine.active.filter((r) => r.op.kind === 'swap').map((r) => ({ r, op: r.op }))];
  const applied = changes.length ? tile('s12 applied', h('h3', {}, 'In your game'),
    changes.map(({ q, r, op }) => {
      const label = op ? (op.label || op.gameFile) : q.key;
      const src = op && op.kind === 'swap' && catalog.byId.get(op.sourceFile.toLowerCase());
      return h('div', { class: 'change' },
        op && op.kind === 'swap' ? picture(catalog.byId.get(op.targetFile.toLowerCase()), op.category, 'sm') : art(label, op ? op.category : 'packs'),
        h('span', { class: 'clip', title: src && src.early ? `A default item: its early copy in ${src.early.join(' and ')} is renamed too, so the game reads the swap. Reverting puts that back as well.` : null }, label),
        src && src.early && h('span', { class: 'tag' }, 'Default item'),
        q && h('span', { class: 'tag' }, q.type === 'apply' ? 'Queued' : 'Revert queued'),
        q ? h('button', { class: 'btn sm', onclick: () => run(() => api('unqueue', q.key)) }, 'Cancel')
          : h('button', { class: 'btn sm', onclick: () => run(() => api('revert', r.key), S.running ? 'Revert queued until the game closes.' : 'Original file restored.') }, 'Revert'));
    }),
    S.engine.active.length > 1 && h('button', { class: 'btn sm danger', onclick: () => run(() => api('revertAll'), 'Everything reverted.') }, 'Revert all')) : null;

  root.append(bar, applied || '',
    tile('s3 rail', catalog.categories.map((c) => h('button', { class: ui.cat === c.id ? 'on' : '',
      onclick: () => { ui.cat = c.id; ui.q = ''; ui.src = ui.dst = ui.check = null; ui.slot = 'src'; popGrid = true; render(); } },
    icon(c.id, 17), h('span', { class: 'grow' }, c.label), h('small', {}, catalog.counts[c.id] || 0)))),
    tile('s9',
      h('div', { class: 'row wrap' }, h('label', { class: 'search' }, icon('search', 16),
        field({ placeholder: `Search ${catalog.catLabel[ui.cat].toLowerCase()}`, value: ui.q, oninput: (e) => { ui.q = e.target.value; fill(); } })),
      only, h('span', { class: 'grow' }), count),
      elsewhere, grid, sentinel));
  return root;
};

async function pickItem(item, which) {
  if (!item) return;
  ui[which] = item;
  ui.check = null;
  if (which === 'src') {
    ui.slot = 'dst';
    if (ui.dst && (ui.dst.category !== item.category || !canSwap(item, ui.dst))) ui.dst = null;
    // picked from a search: clear it, so the looks to choose from are not filtered by it
    if (ui.q) { ui.q = ''; render(); return; }
  }
  garage.paintBar();
  if (which === 'src') garage.fill(); else garage.mark();
  if (ui.src && ui.dst) {
    const { src, dst } = ui;
    const check = await api('checkSwap', { kind: 'swap', sourceFile: src.file, targetFile: dst.file });
    if (ui.src === src && ui.dst === dst) { ui.check = check; garage.paintBar(); }
  }
}

/* ---------- workshop maps & map merge ---------- */

let maps = null;
views.maps = () => {
  const add = async () => { maps = await api('mapsAdd'); render(); };
  const root = bento(
    tile('s8', head('Your maps', btnIcon('primary sm', 'plus', 'Add map files', add)),
      h('p', { class: 'muted' }, 'Add the .upk or .udk map files you have downloaded, then load one.')),
    tile('s4 ink', h('h3', {}, 'How to play'), h('p', {}, 'A loaded map takes the place of the Underpass arena. Open Training → Free Play and choose Underpass.')));
  if (!maps) { api('mapsList').then((list) => { maps = list; if (ui.tab === 'maps') render(true); }); return root; }
  const slot = S.mapSlot.toLowerCase();
  const loaded = S.engine.active.find((r) => r.key === slot);
  const queued = S.engine.queue.find((q) => q.key === slot && q.op);
  if (!maps.length) { root.append(tile('s12', empty('maps', 'No maps yet', 'Your workshop maps show up here.'))); return root; }
  root.append(...maps.map((m) => {
    const isLoaded = loaded && loaded.op.from && loaded.op.from.endsWith(m.id), isQueued = queued && queued.op.from && queued.op.from.endsWith(m.id);
    return tile('card',
      h('div', { class: 'row' }, art(m.name, 'maps'), h('div', { class: 'grow' }, h('b', { class: 'clip' }, m.name), h('div', { class: 'muted small' }, `${(m.size / 1048576).toFixed(1)} MB`)),
        isLoaded && h('span', { class: 'tag on' }, 'Loaded'), isQueued && h('span', { class: 'tag' }, 'Queued')),
      h('div', { class: 'row push' },
        isLoaded
          ? h('button', { class: 'btn grow', onclick: () => run(() => api('revert', slot), 'Underpass restored.') }, 'Unload')
          : h('button', { class: 'btn primary grow', onclick: () => run(() => api('mapsLoad', m.id), queuedMsg) }, 'Load'),
        h('button', { class: 'btn danger', disabled: !!isLoaded, onclick: async () => { maps = await api('mapsRemove', m.id); render(); } }, 'Delete')));
  }));
  return root;
};

// Map Merge works on the arenas that ship with the game (see main/core/arenas.js).
let arenas = null, arenasError = null, arenasLoading = false;
const lab = { donor: null, base: null, snow: null, every: null };
// a key list added or removed: items and arenas are read again, merge plans asked again
function keysChanged() { catalog = null; arenas = null; lab.planFor = null; lab.choicesFor = null; lab.choices = null; }
const gb = (bytes) => `${(bytes / 1e9).toFixed(1)} GB`;
// The arenas that show a changed file: the arena itself, or every arena that loads that part.
const shownIn = (gameFile) => arenas.filter((a) => a.file.toLowerCase() === gameFile.toLowerCase() || a.parts.some((p) => p.file.toLowerCase() === gameFile.toLowerCase()));
const playHint = (list) => (list.length ? `Play ${list.map((a) => a.name).join(' or ')} to see it.` : '');

views.lab = () => {
  const root = bento(noteTile('warn', 's12', 'Experimental. Merges sort every piece of both arenas into stadium or outside by name and position, so an odd piece can land on the wrong side; tell us which. Only you see the result, and every change can be reverted below. To pick an arena yourself, use Free Play, Exhibition or a Private Match.'));
  if (!arenas && arenasError) { root.append(tile('s12', failed('maps', 'The arenas could not be read', arenasError, () => { arenasError = null; render(); }))); return root; }
  if (!arenas) {
    if (!arenasLoading) {
      arenasLoading = true;
      api('arenas').then((list) => { arenas = list; }, (e) => { arenasError = reason(e); }).finally(() => { arenasLoading = false; if (ui.tab === 'lab') render(true); });
    }
    root.append(tile('s12', empty('maps', 'Reading the arenas', 'Finding the parts each arena is built from.')));
    return root;
  }
  const byId = (id) => arenas.find((a) => a.id === id);
  // the lists for "every match" and "snow" include your merged arenas; asked again whenever something changes
  const stamp = [...S.engine.active.map((r) => `${r.key}:${r.op.label}`), ...S.engine.queue.map((q) => `${q.key}:${q.type}`)].join('|');
  if (lab.choicesFor !== stamp) {
    lab.choicesFor = stamp;
    api('arenaChoices').then((c) => { if (lab.choicesFor === stamp) { lab.choices = c; if (ui.tab === 'lab') render(true); } }).catch(() => {});
  }
  const choices = lab.choices || { every: [], snow: [], noSnow: [] };
  const mergedTag = (c) => (c.merged ? `${c.label} · your merge` : c.label);
  // every standard soccar arena: they all have the same pitch, so any two can be merged
  const split = arenas.filter((a) => a.standard), standard = arenas.filter((a) => a.standard);
  lab.donor ??= (split.find((a) => a.field) || split[0] || {}).id;
  lab.base ??= (split.filter((a) => a.field)[1] || split[1] || {}).id;
  // how the chosen pair would be merged, asked of the main process once per pair
  const pairKey = `${lab.donor}>${lab.base}`;
  if (lab.planFor !== pairKey) {
    lab.planFor = pairKey;
    lab.plan = null;
    api('mergePlan', lab.donor, lab.base).then((p) => { if (lab.planFor === pairKey) { lab.plan = p; if (ui.tab === 'lab') render(true); } }).catch(() => {});
  }
  const plan = lab.plan;
  if (!choices.snow.some((c) => c.id === lab.snow)) lab.snow = (choices.snow[0] || {}).id;
  if (!choices.every.some((c) => c.id === lab.every)) lab.every = ((choices.every.find((c) => c.id === 'stadium_p') || choices.every[0]) || {}).id;
  const donor = byId(lab.donor), base = byId(lab.base);
  const snow = choices.snow.find((c) => c.id === lab.snow), every = choices.every.find((c) => c.id === lab.every);
  // arenas whose files OpenW cannot open without a key list say so in the lists
  const options = (list) => list.map((a) => [a.id, a.locked && a.locked.length ? `${a.name} · needs a key list` : a.name]);
  const choose = (key) => (id) => { lab[key] = id; render(); };

  // "same stadium every match": what is on now, and what it would cost on disk
  const everyOn = S.engine.active.filter((r) => r.op.group === 'everymatch');
  const everyQueued = S.engine.queue.filter((q) => q.op && q.op.group === 'everymatch' && q.type === 'apply');
  const current = (everyOn[0] || everyQueued[0] || {}).op;
  const currentId = current && (current.chosen || (arenas.find((a) => a.file === current.sourceGameFile) || {}).id);
  const currentName = current && (current.every || current.label.replace(/ in place of .*$/, ''));
  const everyPlaces = new Set([...everyOn, ...everyQueued].map((r) => r.op.place).filter(Boolean)).size;
  const keySkipped = every && every.skipped ? every.skipped.filter((n) => !(every.single || []).includes(n)) : [];
  // the chosen arena is already on; out of date when a merge was made or reverted since
  const same = !!current && currentId === lab.every, stale = !!choices.everyStale;
  const writing = lab.progress && lab.progress.what === 'every' ? ` ${Math.round((lab.progress.done / lab.progress.total) * 100)}%` : '';

  root.append(
    tile('s12 ink', head('Same stadium every match', current && h('span', { class: 'tag on' }, everyQueued.length ? 'Queued' : 'On')),
      h('p', { class: 'muted' }, 'Whatever arena a match is played in, you see the stadium you pick here (pitch, walls, stands and crowd), in that arena’s own surroundings and sky. Each arena keeps its own file, so online matches work. Everyone else still sees the real arena.'),
      h('div', { class: 'row wrap' },
        select(choices.every.map((c) => [c.id, mergedTag(c)]), lab.every, choose('every'), 360),
        h('button', { class: 'btn primary', 'data-progress': 'every', disabled: !every || !!every.locked || (same && !everyQueued.length && !stale) || !!lab.busy,
          onclick: () => busy('every', () => run(() => api('everyMatch', lab.every), (r) => (r.queued ? `Queued: ${every.stadium}’s stadium goes into ${plural(r.arenas, 'arena')} when Rocket League closes.` : `Every match now shows ${every.stadium}’s stadium (${plural(r.arenas, 'arena')}).`))) },
        lab.busy === 'every' ? `Working…${writing}` : !current ? 'Use in every match' : same ? 'Update every match' : 'Switch to this stadium'),
        current && h('button', { class: 'btn', onclick: () => run(() => api('everyMatchOff'), S.running ? 'Turning it off when the game closes.' : 'Your arenas are back to normal.') }, 'Turn off')),
      same && stale && h('p', { class: 'small' }, 'An arena changed since this was turned on (a merge was made or reverted), so some arenas are out of date. Update every match brings them in line.'),
      every && h('p', { class: 'small' }, every.merged ? `Your merge: every match shows ${every.stadium}’s stadium, the stadium of ${every.label}.` : `Every match shows ${every.stadium}’s stadium.`),
      every && every.locked && keyHint(every.locked),
      every && !every.locked && keySkipped.length > 0 && keyHint(`${keySkipped.join(', ')} ${keySkipped.length === 1 ? 'keeps its' : 'keep their'} own look: OpenW cannot open ${keySkipped.length === 1 ? 'it' : 'them'} with the keys it has. A newer key list in Settings, under Item pictures and keys, opens them.`, true),
      every && every.single && every.single.length > 0 && h('p', { class: 'muted small' }, `${every.single.join(' and ')} ${every.single.length === 1 ? 'keeps its' : 'keep their'} own stadium: ${every.single.length === 1 ? 'it is' : 'they are'} a single file with nothing to load another stadium into, and replacing the file would disconnect online matches.`),
      h('p', { class: 'muted small' }, current
        ? `Now: ${currentName} in every match (${plural(everyPlaces || everyOn.length, 'arena')}${everyQueued.length ? ', waiting for the game to close' : ''}).`
        : every ? `Changes ${plural(every.files, 'arena')}. With the originals backed up, that takes about ${gb(every.bytes)} of disk space until you turn it off. Takes a minute or two.` : ''),
      h('p', { class: 'muted small' }, 'Arenas you merged or snowed yourself keep your change. Rocket Labs, Hoops, Dropshot, Snow Day, Knockout and the odd-shaped arenas (Badlands, Tokyo Underpass, ARCtagon) are left as they are.')),
    tile('s7', head('Merge two arenas', h('span', { class: 'tag' }, `${split.length} arenas`)),
      h('p', { class: 'muted' }, 'Puts the stadium of one arena (pitch, walls, goals and stands) in the surroundings of another. Any two soccar arenas can be picked; Hoops, Dropshot, Snow Day and odd-shaped arenas have a different pitch and are left out.'),
      h('div', { class: 'fields' },
        h('b', {}, 'Stadium from'), select(options(split), lab.donor, choose('donor'), 300),
        h('b', {}, 'Placed in'), select(options(split), lab.base, choose('base'), 300)),
      donor && base && mergeHow(plan, donor, base),
      h('button', { class: 'btn primary lg push', disabled: !plan || plan.how === 'none' || !!plan.lockedText || !!lab.busy,
        onclick: () => busy('merge', () => run(() => api('mergeArenas', lab.donor, lab.base), (r) => `${r.queued ? 'Queued.' : 'Merged.'} ${playHint(r.play.map((name) => ({ name })))}`)) },
      lab.busy === 'merge' ? 'Taking both arenas apart… (a few seconds)' : S.running ? 'Queue merge' : 'Merge')),
    tile('s5', head('Add snow', h('span', { class: 'tag' }, `${choices.snow.length} arenas`)),
      h('p', { class: 'muted' }, 'Falling snow is only in the game’s four snowy arenas, so an arena built on DFH Stadium, Mannfield, Beckwith Park or Utopia Coliseum can become its snowy version. Merged arenas cannot: the snowy version would replace the merge.'),
      select(choices.snow.map((c) => [c.id, mergedTag(c)]), lab.snow, choose('snow')),
      snow && h('p', { class: 'muted small' }, `Plays ${snow.snowy} in its place${snow.merged ? ', and keeps your merge' : ''}.`),
      snow && h('p', { class: 'small' }, h('b', {}, playHint(snow.play.map((name) => ({ name }))))),
      snow && h('p', { class: 'small', style: 'color:var(--warn, #e0a030)' }, `Offline only: the snowy version replaces ${snow.label}’s file, and Rocket League checks arena files online, so an online match in ${snow.label} would disconnect.`),
      snow && snow.locked && keyHint(snow.locked),
      choices.noSnow && choices.noSnow.length > 0 && h('p', { class: 'muted small' }, `${choices.noSnow.join(', ')}: no snow, because the snowy version would replace the files your merge changed. For snowy surroundings, merge a stadium into Forbidden Temple (Fire & Ice).`),
      h('button', { class: 'btn primary lg push', disabled: !snow || !!snow.locked, onclick: () => run(() => api('snowArena', lab.snow), (r) => `${r.queued ? 'Queued.' : 'Snow added.'} ${playHint(snow.play.map((name) => ({ name })))}`) }, S.running ? 'Queue snow' : 'Add snow')));

  // merges and snow, one row each (a merge of several files is one row); "every match" is the tile above
  const rows = new Map();
  const add = (op, key, queued) => {
    const id = op.group || key;
    const row = rows.get(id) || { id, op, keys: [], queued: false };
    if (!row.keys.includes(key)) row.keys.push(key);
    // a merge is shown by its arena's own file, not by the files it adds
    if (row.op.create && !op.create) row.op = op;
    row.queued ||= queued;
    rows.set(id, row);
  };
  const arenaChange = (op) => op && op.category === 'map' && (op.kind === 'copy' || op.kind === 'build') && op.group !== 'everymatch';
  for (const q of S.engine.queue) if (arenaChange(q.op)) add(q.op, q.key, true);
  for (const r of S.engine.active) if (arenaChange(r.op)) add(r.op, r.key, false);
  const mine = [...rows.values()];
  const undo = (row) => (row.op.group ? api('revertGroup', row.op.group)
    : row.queued ? api('unqueue', row.keys[0]) : api('revert', row.keys[0]));
  root.append(tile('s12', head('Changed arenas', h('span', { class: 'tag' }, mine.length)),
    mine.length ? h('div', { class: 'list' }, mine.map((row) => h('div', { class: 'item' }, art(row.op.label, 'maps'),
      h('div', { class: 'grow' }, h('b', {}, row.op.label), h('div', { class: 'small' }, playHint(shownIn(row.op.gameFile)) || row.op.gameFile)),
      row.queued && h('span', { class: 'tag' }, 'Queued'),
      h('button', { class: 'btn sm', onclick: () => run(() => undo(row), S.running ? 'Undone when the game closes.' : 'Original arena restored.') }, row.queued ? 'Cancel' : 'Revert'))))
      : h('p', { class: 'muted' }, 'Nothing merged or snowed. Your arenas are original.')));
  return root;
};

// A slow Map Merge action: its button says it is working, and the others wait.
async function busy(what, fn) {
  lab.busy = what;
  lab.progress = null;
  render();
  try { return await fn(); } finally { lab.busy = null; render(); }
}

// A change that needs files OpenW cannot open without a key list: says which, and leads to Settings.
// (soft: only some arenas are affected and the change can still be made)
const keyHint = (text, soft) => h('div', { class: `keyhint${soft ? ' soft' : ''}` }, icon(soft ? 'info' : 'lock', 16),
  h('span', { class: 'grow' }, text), h('button', { class: 'btn sm', onclick: go('settings') }, 'Open Settings'));

// What a merge of the chosen pair will do, in words.
function mergeHow(plan, donor, base) {
  if (donor.id === base.id) return h('p', { class: 'small' }, 'Pick two different arenas.');
  if (!plan) return h('p', { class: 'muted small' }, 'Working out how…');
  if (plan.how === 'none') return h('p', { class: 'small' }, plan.reason);
  if (plan.lockedText) return keyHint(plan.lockedText);
  const files = plan.files > 1 ? ` (${plan.files} files)` : '';
  const how = {
    stadium: `Both arenas keep their stadium in a separate file, so ${donor.name}’s stadium is put straight into ${base.name}.`,
    surroundings: `${donor.name} keeps its stadium and gets ${base.name}’s surroundings around it${files}. Anything built into ${donor.name}’s own file, like a skyline, stays as well.`,
    build: `OpenW takes both maps apart piece by piece: only ${donor.name}’s stadium (pitch, walls, stands, crowd) is kept, and only ${base.name}’s outside, sky and fog around it${files}. Each arena’s stadium is measured from where its stands are.`,
    whole: `${[donor, base].find((a) => !a.field) === donor ? donor.name : base.name} has its stadium built into its main file, so these two cannot be taken apart and put back together. Instead, all of ${donor.name} is played whenever you pick ${base.name}.`,
  }[plan.how];
  return h('div', {},
    h('p', { class: 'muted small' }, how),
    h('p', { class: 'small' }, h('b', {}, playHint(plan.play.map((name) => ({ name }))))),
    plan.note && h('p', { class: 'muted small' }, plan.note),
    plan.online === false && h('p', { class: 'small', style: 'color:var(--warn, #e0a030)' }, `Offline only: ${base.name} is a single file, so it gets ${donor.name}’s map in its place, and Rocket League checks arena files online. An online match in ${base.name} would disconnect.`));
}

/* ---------- controller ---------- */

/* ---------- controller: OpenW Input ---------- */

// The real controller is read by OpenW's helper, run through these settings, and played on a
// virtual Xbox controller (main/input.js, native/openw-input.cpp). The maths for the previews
// is the helper's own, in shared/transform.js.
const TX = window.OpenWTransform;
const PAD_NAMES = { xinput: 'Xbox controller', ds4: 'DualShock 4', dualsense: 'DualSense', edge: 'DualSense Edge' };
const CURVE_OPTS = [['linear', 'Linear'], ['aggressive', 'Aggressive'], ['relaxed', 'Relaxed'], ['wide', 'Wide'], ['extrawide', 'Extra Wide'], ['custom', 'Custom']];
const SIDES = [['left', 'Left'], ['right', 'Right'], ['none', 'None']];
// Steam's own descriptions of its options
const SHAPE_TEXT = {
  circle: 'An even response across the whole throw of the stick.',
  cross: 'Each axis has its own dead zone, which favours straight up, down, left and right.',
  square: 'Diagonals reach full on both axes.',
};
const SOURCE_TEXT = {
  none: 'The raw input of the stick is sent (only the response curve applies).',
  calibration: 'The dead zone of this controller\u2019s calibration.',
  custom: 'Set up a custom dead zone for this profile.',
};
const TRIGGER_CURVES = CURVE_OPTS.filter(([v]) => v !== 'custom');
// [Xbox name, PlayStation name]
const SRC_LABEL = {
  A: ['A', 'Cross'], B: ['B', 'Circle'], X: ['X', 'Square'], Y: ['Y', 'Triangle'], LB: ['LB', 'L1'], RB: ['RB', 'R1'],
  LS: ['Left stick click', 'L3'], RS: ['Right stick click', 'R3'], Back: ['View', 'Share / Create'], Start: ['Menu', 'Options'], Guide: ['Xbox button', 'PS button'],
  Up: ['D-pad up'], Down: ['D-pad down'], Left: ['D-pad left'], Right: ['D-pad right'],
  Touchpad: ['Touchpad click, left half'], TouchpadRight: ['Touchpad click, right half'], Mute: ['Mute button'], FnL: ['Left Fn'], FnR: ['Right Fn'], PaddleL: ['Left back paddle'], PaddleR: ['Right back paddle'],
};
const OUT_LABEL = { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LS: 'Left stick click', RS: 'Right stick click', Back: 'View (Back)', Start: 'Menu (Start)', Guide: 'Xbox button',
  Up: 'D-pad up', Down: 'D-pad down', Left: 'D-pad left', Right: 'D-pad right', LT: 'Left trigger, full', RT: 'Right trigger, full' };
const OUT_OPTS = [['', 'Nothing'], ...Object.entries(OUT_LABEL)];
const HOLD_TIMES = [200, 300, 400, 500, 700, 1000].map((ms) => [ms, `${ms} ms`]);
const TURBO_RATES = [5, 8, 10, 15, 20, 30].map((hz) => [hz, `${hz} a second`]);
const LIGHTS = ['#00d8c8', '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#facc15', '#16a34a', '#ffffff'];

const ctl = { section: 'left', info: null, live: null, watching: false, ui: null, fake: {}, busy: false, want: false };
const ctlLive = () => ui.tab === 'controller' && ctl.ui && ctl.ui.root.isConnected;
const curProfile = () => { const i = S.settings.input; return i.profiles.find((p) => p.id === i.profile) || i.profiles[0]; };
const padKind = () => (ctl.info && ctl.info.status.pad ? ctl.info.status.pad.kind : null);
const srcName = (src) => { const [xb, ps] = SRC_LABEL[src]; const k = padKind(); return !ps ? xb : k === 'xinput' ? xb : k ? ps : `${xb} / ${ps}`; };
function shownSources() {
  const k = padKind(), all = TX.SOURCES;
  if (k === 'xinput') return all.slice(0, 15);
  const pads = ['TouchpadRight'];
  if (k === 'ds4') return [...all.slice(0, 16), ...pads];
  return k === 'edge' ? all : [...all.slice(0, 17), ...pads];
}
async function refreshInput() { ctl.info = await api('inputInfo'); if (ui.tab === 'controller') render(); }
// The first time OpenW Input is turned on, the drivers that come with OpenW go in, quietly and
// together; Windows' permission prompt is the only thing anyone sees. Only the virtual
// controller's driver is needed to go on.
async function setUp(dr) {
  const has = dr.bundled || {};
  const list = [!dr.vigem && has.vigem && 'vigem', !dr.hidhide && has.hidhide && 'hidhide'].filter(Boolean);
  if (!list.length) return;
  toast('Setting up OpenW Input. Windows asks for permission once.');
  const { results, info, state } = await api('inputInstallDrivers', list);
  ctl.info = info; S = state;
  if (results.vigem && results.vigem.startsWith('failed')) throw new Error(`OpenW Input could not be set up: ${results.vigem}.`);
  if (Object.values(results).includes('restart')) toast('Restart Windows once to finish setting up.');
}
window.openw.on('input-status', (st) => { if (ctl.info) { ctl.info.status = st; if (ui.tab === 'controller') render(); } });
window.openw.on('input-state', (st) => { ctl.live = st; if (ctlLive()) ctl.ui.draw(); });
// stop the live feed when the page is left
setInterval(() => { if (ctl.watching && !ctlLive()) { ctl.watching = false; api('inputWatch', false); } }, 1000);

// A canvas drawn at the screen's pixel density; ctx() clears it and works in CSS pixels.
function canvasEl(w, ht) {
  const dpr = window.devicePixelRatio || 1;
  const el = h('canvas', { width: Math.round(w * dpr), height: Math.round(ht * dpr), style: `width:${w}px;height:${ht}px` });
  el.ctx = () => { const c = el.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, ht); return c; };
  el.w = w; el.h = ht;
  return el;
}
const cssVar = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();

// Settings and readings are kept in Steam's units (a stick from the centre to the edge, or a
// trigger's full pull, is 0 to 32767) and shown as a share of that, 0 to 100 %.
const pct = (u) => Math.round((u / TX.M) * 1000) / 10;
const fromPct = (p) => Math.round((p / 100) * TX.M);

// The stick's square: dead zone, where the output can reach, your stick and what the game gets.
// raw and the maths are in Steam's units (-32768..32767).
function drawStick(el, c, raw) {
  const g = el.ctx(), W = el.w, R = W / 2 - 14, cx = W / 2, cy = W / 2, U = TX.M;
  const line = cssVar(el, '--line-2'), muted = cssVar(el, '--muted'), accent = cssVar(el, '--accent'), soft = cssVar(el, '--accent-soft');
  g.lineWidth = 1;
  g.strokeStyle = line; g.strokeRect(cx - R, cy - R, 2 * R, 2 * R);
  g.setLineDash([3, 4]); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke(); g.setLineDash([]);
  // where the output can reach: the round range run through the settings
  g.strokeStyle = accent; g.fillStyle = soft; g.lineWidth = 1.5; g.beginPath();
  for (let i = 0; i <= 144; i++) {
    const a = (i / 144) * Math.PI * 2, [x, y] = TX.stick(Math.cos(a) * U, Math.sin(a) * U, c);
    if (i) g.lineTo(cx + (x / U) * R, cy - (y / U) * R); else g.moveTo(cx + (x / U) * R, cy - (y / U) * R);
  }
  g.fill(); g.stroke();
  // dead zone: round for Circle, a cross for Cross, a square for Square (per axis), none without one
  g.fillStyle = 'rgba(251,113,133,.22)';
  const d = (c.inner / U) * R, off = c.source === 0 || (c.inner === 0 && c.outer >= 32000);
  if (off) { /* no dead zone */ } else if (c.shape === 0) { g.fillRect(cx - d, cy - R, 2 * d, 2 * R); g.fillRect(cx - R, cy - d, 2 * R, 2 * d); }
  else if (c.shape === 2) g.fillRect(cx - d, cy - d, 2 * d, 2 * d);
  else { g.beginPath(); g.arc(cx, cy, d, 0, Math.PI * 2); g.fill(); }
  if (!raw) return;
  const [ox, oy] = TX.stick(raw[0], raw[1], c);
  const px = (v) => (v / U) * R;
  g.strokeStyle = muted; g.lineWidth = 1; g.beginPath(); g.moveTo(cx + px(raw[0]), cy - px(raw[1])); g.lineTo(cx + px(ox), cy - px(oy)); g.stroke();
  g.fillStyle = muted; g.beginPath(); g.arc(cx + px(raw[0]), cy - px(raw[1]), 6, 0, Math.PI * 2); g.fill();
  g.fillStyle = accent; g.beginPath(); g.arc(cx + px(ox), cy - px(oy), 7, 0, Math.PI * 2); g.fill();
}

// Input travel -> output, with the current travel marked.
function drawCurve(el, fn, at) {
  const g = el.ctx(), pad = 14, W = el.w - pad * 2, H = el.h - pad * 2;
  const line = cssVar(el, '--line-2'), accent = cssVar(el, '--accent'), muted = cssVar(el, '--muted');
  g.strokeStyle = line; g.lineWidth = 1; g.strokeRect(pad, pad, W, H);
  g.setLineDash([3, 4]); g.beginPath(); g.moveTo(pad, pad + H); g.lineTo(pad + W, pad); g.stroke(); g.setLineDash([]);
  g.strokeStyle = accent; g.lineWidth = 2; g.beginPath();
  for (let i = 0; i <= 120; i++) { const x = i / 120, y = fn(x); if (i) g.lineTo(pad + x * W, pad + H - y * H); else g.moveTo(pad + x * W, pad + H - y * H); }
  g.stroke();
  g.fillStyle = muted; g.font = '11px "DM Sans", sans-serif';
  g.fillText('in', pad + W - 14, pad + H - 5); g.fillText('out', pad + 5, pad + 13);
  if (at == null) return;
  const x = Math.min(1, at), y = fn(x);
  g.strokeStyle = muted; g.lineWidth = 1; g.beginPath(); g.moveTo(pad + x * W, pad); g.lineTo(pad + x * W, pad + H); g.stroke();
  g.fillStyle = accent; g.beginPath(); g.arc(pad + x * W, pad + H - y * H, 5, 0, Math.PI * 2); g.fill();
}

views.controller = () => {
  const root = bento();
  if (!ctl.info) {
    refreshInput().catch((e) => toast(String(e.message || e), true));
    root.append(tile('s12', empty('stick', 'Getting OpenW Input ready', 'One moment.')));
    return root;
  }
  const { status: st, drivers: dr } = ctl.info;
  const inp = S.settings.input, p = curProfile();
  if (st.running && !ctl.watching) { ctl.watching = true; api('inputWatch', true); }
  const drawers = [];
  ctl.ui = { root, draw: () => drawers.forEach((d) => d(ctl.live)) };

  // edits are saved and sent on; while a slider moves they are only sent
  const save = () => api('inputSave', p).catch((e) => toast(String(e.message || e), true));
  const preview = () => { api('inputPreview', p); ctl.ui.draw(); };
  const redo = () => { save(); render(); };
  const lbl = (title, sub, grow) => h('div', { class: `lbl${grow ? ' grow' : ''}` }, h('b', {}, title), sub && h('div', { class: 'muted small' }, sub));
  const valRow = (title, sub, obj, key, min, max, fmt = (v) => String(v), step = 1) => {
    const val = h('span', { class: 'val' }, fmt(obj[key]));
    const range = slider(min, max, obj[key], (v) => { obj[key] = v; save(); }, (v) => { obj[key] = v; val.textContent = fmt(v); preview(); }, step);
    return h('div', { class: 'opt-row' }, lbl(title, sub), range, typeable(val, range));
  };
  // a value in Steam's units, shown and set as % of the stick's travel or the trigger's pull
  const pctRow = (title, sub, obj, key, min, max) => {
    const units = (v) => Math.max(min, Math.min(max, fromPct(v)));
    const val = h('span', { class: 'val' }, `${pct(obj[key])}%`);
    const range = slider(pct(min), pct(max), pct(obj[key]), (v) => { obj[key] = units(v); save(); }, (v) => { obj[key] = units(v); val.textContent = `${pct(obj[key])}%`; preview(); }, 0.1);
    return h('div', { class: 'opt-row' }, lbl(title, sub), range, typeable(val, range));
  };
  const choiceRow = (title, sub, control) => h('div', { class: 'opt-row' }, lbl(title, sub, true), control);
  const flip = (obj, key) => toggle(obj[key], (v) => { obj[key] = v; save(); preview(); });

  // --- on / off ---
  const own = inp.own !== false;
  const padText = st.pad ? `${PAD_NAMES[st.pad.kind] || 'Controller'} over ${st.pad.conn === 'bt' ? 'Bluetooth' : 'USB'}${st.hidden ? ', hidden from games' : ''}.` : 'No controller found yet. Plug one in or connect it over Bluetooth.';
  const vText = st.vigem === false ? 'Not set up yet: turn OpenW Input off and on again to finish.' : st.vigem ? 'Virtual Xbox controller is on.' : 'Starting…';
  root.append(tile(`s12 bar${st.running ? ' ink' : ''}`, art('OpenW Input', 'stick'),
    h('div', { class: 'grow' }, h('b', {}, 'OpenW Input'), h('div', { class: 'muted small' }, st.running ? `${padText} ${vText}` : st.error || 'Off. Turn it on to play with these settings.')),
    onOff(st)));

  if (!dr.helper) root.append(noteTile('warn', 's12', 'The input helper (bin/openw-input.exe) is missing from this copy of OpenW. Build it with npm run build-input.'));
  if (st.running && own && st.reconnect && st.reconnect.length && !ctl.busy) {
    root.append(noteTile('info', 's12', h('b', {}, 'One last step: reconnect your controller'),
      h('p', {}, 'Unplug it and plug it back in (or turn it off and on over Bluetooth). It is then hidden from games every time, and they only see OpenW’s controller. Needed once.')));
  } else if (st.running && st.pad && own && !st.hidden && !ctl.busy) {
    root.append(noteTile('info', 's12', h('b', {}, 'Your controller is not hidden from games yet'),
      h('p', {}, 'Games may get every press twice. See Hide real controller.')));
  }

  // --- profiles ---
  // a pasted profile code is added on Enter
  const code = field({ placeholder: 'Paste a code', style: 'width:120px', onkeydown: (e) => { if (e.key === 'Enter' && code.value.trim()) run(() => api('inputImport', code.value), 'Profile added.'); } });
  root.append(tile('s12 bar', h('b', {}, 'Profile'),
    select(inp.profiles.map((x) => [x.id, x.name]), inp.profile, (v) => run(() => api('inputSelect', v)), 170),
    field({ value: p.name, maxlength: 40, style: 'width:130px', 'aria-label': 'Profile name', onchange: (e) => run(() => api('inputRename', p.id, e.target.value), 'Renamed.') }),
    select([['', 'New profile…'], ['standard', 'Steam defaults'], ['square', 'Square dead zone']], '', (v) => v && run(() => api('inputNew', v), 'Profile added.'), 140),
    steamPicker(),
    h('button', { class: 'btn sm', onclick: () => run(() => api('inputNew', '', p.id), 'Copy made.') }, 'Duplicate'),
    h('button', { class: 'btn sm', onclick: async () => { await navigator.clipboard.writeText(await api('inputExport', p.id)); toast('Profile code copied.'); } }, 'Copy code'),
    h('span', { class: 'grow' }), code,
    h('button', { class: 'btn sm danger', disabled: inp.profiles.length < 2, onclick: () => { if (window.confirm(`Delete the profile “${p.name}”?`)) run(() => api('inputDelete', p.id), 'Profile deleted.'); } }, 'Delete')));

  root.append(h('div', { class: 's12 secbar' }, seg([['left', 'Left stick'], ['right', 'Right stick'], ['triggers', 'Triggers'], ['buttons', 'Buttons'], ['feedback', 'Rumble and light'], ['hide', 'Hide real controller']],
    ctl.section, (v) => { ctl.section = v; render(); })));

  const tag = (off = 'Turn on to see it live') => h('span', { class: `tag${st.running ? ' on' : ''}` }, st.running ? 'Live' : off);
  const sec = ctl.section;
  if (sec === 'left' || sec === 'right') {
    const s = p.sticks[sec], i = sec === 'left' ? 0 : 1, U = TX.M;
    const map = canvasEl(260, 260), curve = canvasEl(260, 140), read = h('div', { class: 'muted small mono' });
    map.classList.add('stickmap');
    const rawOf = (live) => (st.running && live ? [live.raw[i * 2], live.raw[i * 2 + 1]] : ctl.fake[sec] || null);
    drawers.push((live) => {
      const c = TX.stickCfg(s), raw = rawOf(live);
      drawStick(map, c, raw);
      // the output along the horizontal axis
      drawCurve(curve, (x) => TX.stick(x * U, 0, c)[0] / U, raw ? Math.hypot(raw[0], raw[1]) / U : null);
      if (raw) { const [ox, oy] = TX.stick(raw[0], raw[1], c); read.textContent = `stick ${pct(raw[0])}%, ${pct(raw[1])}%  →  game ${pct(ox)}%, ${pct(oy)}%`; } else read.textContent = ' ';
    });
    // with OpenW Input off, drag in the square to see what the settings do
    const drag = (e) => {
      if (st.running || !(e.buttons & 1)) return;
      const r = map.getBoundingClientRect(), R = r.width / 2 - 14;
      let x = (e.clientX - r.left - r.width / 2) / R, y = -(e.clientY - r.top - r.height / 2) / R;
      const len = Math.hypot(x, y); if (len > 1) { x /= len; y /= len; }
      ctl.fake[sec] = [Math.round(x * U), Math.round(y * U)]; ctl.ui.draw();
    };
    map.addEventListener('pointerdown', (e) => { map.setPointerCapture(e.pointerId); drag(e); });
    map.addEventListener('pointermove', drag);
    map.addEventListener('pointerup', () => { ctl.fake[sec] = null; ctl.ui.draw(); });
    const dz = s.source !== 'none';
    root.append(
      tile('s5 ctl', head(`${sec === 'left' ? 'Left' : 'Right'} stick`, tag('Drag to try')), map,
        h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'dot muted' }), 'Your stick'), h('span', {}, h('i', { class: 'dot accent' }), 'What the game gets'), h('span', {}, h('i', { class: 'dot dead' }), 'Dead zone')),
        curve, read,
        h('p', { class: 'muted small' }, 'The same maths as Steam Input, measured from the Steam client: the same settings give the same output, to within 0.02%. In Rocket League, turn the game’s own Controller Deadzone down, since this handles it.')),
      tile('s7 ctl', head('Joystick', h('button', { class: 'btn sm', onclick: () => { p.sticks[sec] = TX.blank('').sticks[sec]; redo(); } }, 'Steam defaults')),
        h('div', { class: 'sub' }, 'Deadzone'),
        choiceRow('Deadzone source', SOURCE_TEXT[s.source], seg([['none', 'None'], ['calibration', 'Calibration'], ['custom', 'Custom']], s.source, (v) => { s.source = v; redo(); })),
        dz && pctRow('Deadzone inner', 'Travel from the centre that does nothing.', s, 'inner', 0, 32000),
        dz && pctRow('Deadzone outer', 'How far from the centre counts as full.', s, 'outer', 0, 32000),
        dz && choiceRow('Deadzone shape', SHAPE_TEXT[s.shape], seg([['cross', 'Cross'], ['circle', 'Circle'], ['square', 'Square']], s.shape, (v) => { s.shape = v; redo(); })),
        dz && pctRow('Anti-deadzone', 'Adds to the smallest output, to get past a game’s own dead zone.', s, 'anti', 0, 32767),
        dz && pctRow('Anti-deadzone buffer', 'Re-establishes a dead zone after the anti-deadzone.', s, 'antiBuffer', 0, 32767),
        h('div', { class: 'sub' }, 'Sensitivity'),
        choiceRow('Stick response curve', s.curve === 'linear' ? 'Maps the input to the output 1:1.' : 'Relaxed and wider curves give finer small movements; Aggressive reaches full sooner.', select(CURVE_OPTS, s.curve, (v) => { s.curve = v; redo(); }, 160)),
        s.curve === 'custom' && valRow('Custom response curve', 'Lower is more relaxed, higher more aggressive (Relaxed is 100).', s, 'customCurve', 25, 375),
        valRow('Horizontal scale', '', s, 'scaleX', 0, 100, (v) => `${v}%`),
        valRow('Vertical scale', '', s, 'scaleY', 0, 100, (v) => `${v}%`),
        choiceRow('Invert horizontal', '', flip(s, 'invertX')),
        choiceRow('Invert vertical', '', flip(s, 'invertY')),
        h('div', { class: 'sub' }, 'Output'),
        choiceRow('Output joystick', 'Which stick of the virtual controller it moves.', seg(SIDES, s.output, (v) => { s.output = v; redo(); })),
        choiceRow('Outer ring command', 'A button held while the stick is pushed past the radius.', select(OUT_OPTS, s.ring.to, (v) => { s.ring.to = v; redo(); }, 160)),
        s.ring.to && pctRow('Command radius', '', s.ring, 'radius', 1, 32767),
        s.ring.to && choiceRow('Command invert', 'Held inside the radius instead.', flip(s.ring, 'invert')),
        h('div', { class: 'sub' }, 'OpenW extra'),
        valRow('Smoothing', 'Steadies a shaky stick but adds a little delay. Steam has no such setting; off is the same as Steam.', s, 'smoothing', 0, 100, (v) => (v ? `${v}%` : 'Off'))));
  } else if (sec === 'triggers') {
    for (const [side, name, i] of [['left', 'Left', 4], ['right', 'Right', 5]]) {
      const t = p.triggers[side], curve = canvasEl(260, 130), rawBar = h('i'), outBar = h('i'), U = TX.M;
      drawers.push((live) => {
        const c = TX.trigCfg(t), raw = st.running && live ? live.raw[i] / U : null;
        drawCurve(curve, (x) => TX.trigger(x * U, c) / U, raw);
        rawBar.style.width = `${(raw || 0) * 100}%`;
        outBar.style.width = `${(st.running && live ? live.out[i] / U : 0) * 100}%`;
      });
      root.append(tile('s6 ctl', head(`${name} trigger`, tag()), curve,
        h('div', { class: 'opt-row' }, lbl('Your trigger'), h('div', { class: 'meter raw grow' }, rawBar)),
        h('div', { class: 'opt-row' }, lbl('Game gets'), h('div', { class: 'meter grow' }, outBar)),
        pctRow('Trigger range start', 'Pull before anything happens.', t, 'start', 0, 32767),
        pctRow('Trigger range end', 'Pull that already counts as full.', t, 'end', 0, 32767),
        choiceRow('Response curve', '', select(TRIGGER_CURVES, t.curve, (v) => { t.curve = v; redo(); }, 150)),
        choiceRow('Output trigger', '', seg(SIDES, t.output, (v) => { t.output = v; redo(); })),
        choiceRow('Hair trigger', 'OpenW extra: full the moment it moves down, off the moment it moves back up.', flip(t, 'hair')),
        h('p', { class: 'muted small' }, 'Steam’s range and defaults (3% to 97.7% of the pull). Steam’s live preview does not cover triggers, so unlike the sticks this was not measured.')));
    }
  } else if (sec === 'buttons') {
    const lights = [];
    drawers.push((live) => {
      const bits = st.running && live ? live.rawButtons : 0;
      for (const [el, bit] of lights) el.classList.toggle('on', !!(bits & (1 << bit)));
    });
    const rows = shownSources().map((src) => {
      const b = p.buttons[src], lit = h('i', { class: 'lit' });
      lights.push([lit, TX.SOURCES.indexOf(src)]);
      return [
        h('div', { class: 'bname' }, lit, srcName(src)),
        select(OUT_OPTS, b.to, (v) => { b.to = v; redo(); }, 160),
        select([['', 'No long press'], ...OUT_OPTS.slice(1)], b.hold, (v) => { b.hold = v; redo(); }, 160),
        b.hold ? select(HOLD_TIMES, b.holdMs, (v) => { b.holdMs = v; redo(); }, 100) : h('span', { class: 'muted small' }, ' '),
        h('div', { class: 'row' }, toggle(b.turbo, (v) => { b.turbo = v; redo(); }), b.turbo && select(TURBO_RATES, b.rate, (v) => { b.rate = v; redo(); }, 130)),
        toggle(b.toggle, (v) => { b.toggle = v; save(); }),
      ];
    });
    root.append(tile('s12 ctl', head('Buttons', h('button', { class: 'btn sm', onclick: () => { p.buttons = TX.blank('').buttons; redo(); } }, 'Reset')),
      h('p', { class: 'muted' }, 'What each button of your controller presses on the virtual Xbox controller. A long press sends a second button once it is held long enough (a short press then sends the first on release). Turbo repeats while held; toggle keeps it held until the next press.'),
      h('div', { class: 'btable' }, ['Button', 'Sends', 'Long press', 'Hold for', 'Turbo', 'Toggle'].map((x) => h('div', { class: 'th' }, x)), rows)));
  } else if (sec === 'feedback') {
    const ps = padKind() && padKind() !== 'xinput';
    root.append(
      tile('s6 ctl', head('Rumble'), h('p', { class: 'muted' }, 'Rumble the game sends to the virtual controller is played on yours.'),
        valRow('Strength', '0% turns rumble off.', p, 'rumble', 0, 200)),
      tile('s6 ctl', head('Lightbar', !ps && h('span', { class: 'tag' }, 'PlayStation controllers')),
        h('p', { class: 'muted' }, 'The colour of a DualShock 4 or DualSense light while OpenW Input runs.'),
        h('div', { class: 'swatches' },
          h('button', { class: `btn sm${p.light ? '' : ' primary'}`, onclick: () => { p.light = ''; redo(); } }, 'Leave as it is'),
          LIGHTS.map((c) => h('button', { class: `swatch${p.light === c ? ' on' : ''}`, style: `background:${c}`, 'aria-label': c, onclick: () => { p.light = c; redo(); } })))));
  } else {
    root.append(hideTile(st, dr, inp));
  }
  requestAnimationFrame(() => ctl.ui.draw());
  return root;
};

// "Import from Steam": the Steam Input layouts on this PC, newest first.
let steamLayouts = null;
function steamPicker() {
  if (!steamLayouts) {
    steamLayouts = [];
    api('inputSteamLayouts').then((l) => { steamLayouts = l; if (ui.tab === 'controller') render(); }).catch(() => { steamLayouts = []; });
  }
  if (!steamLayouts.length) return null;
  const names = { ps4: 'PS4', ps5: 'PS5', xbox360: 'Xbox 360', xboxone: 'Xbox One', xboxelite: 'Xbox Elite', switch_pro: 'Switch Pro', generic: 'Controller', neptune: 'Steam Deck', steamcontroller_gordon: 'Steam Controller' };
  const opts = [['', 'Import from Steam…'], ...steamLayouts.map((l) => [l.file, `${l.name} · ${names[l.controller] || l.controller} · ${new Date(l.modified).toLocaleDateString()}`])];
  return select(opts, '', (file) => file && run(async () => {
    const r = await api('inputImportSteam', file);
    if (r.skipped && r.skipped.length) toast(`Imported. Not copied (OpenW plays Xbox buttons only): ${r.skipped.slice(0, 4).join(', ')}${r.skipped.length > 4 ? '…' : ''}`);
    return r;
  }, 'Steam layout imported as a new profile.'), 170);
}

// The OpenW Input switch. While it starts or stops it shows where it is going and does not
// take another click, so status updates in between cannot make it bounce.
function onOff(st) {
  const el = toggle(ctl.busy ? ctl.want : st.running, (v) => {
    if (ctl.busy) return;
    ctl.busy = true; ctl.want = v;
    run(async () => {
      if (v) await setUp(ctl.info.drivers); // the first time only: drivers go in
      const r = await api(v ? 'inputStart' : 'inputStop');
      ctl.info = await api('inputInfo');
      return r;
    }, v ? 'OpenW Input is on.' : 'OpenW Input is off.').finally(() => { ctl.busy = false; if (ui.tab === 'controller') render(); });
  });
  el.disabled = ctl.busy;
  return el;
}

// Hiding the real controller from games while OpenW Input runs (HidHide, or for PlayStation
// controllers without it, opening them for OpenW alone).
function hideTile(st, dr, inp) {
  const own = inp.own !== false, hidden = !!(st.running && st.hidden);
  const ps = st.pad && st.pad.kind !== 'xinput';
  const state = !own ? 'Off: games see your controller as well as OpenW’s.'
    : !st.running ? 'It is hidden as soon as OpenW Input is on.'
      : !st.pad ? 'No controller found.'
        : hidden ? 'Hidden: games only see OpenW’s virtual controller.'
          : st.reconnect && st.reconnect.length ? 'Unplug your controller and plug it back in once, then it is hidden.'
            : 'It could not be hidden this time.';
  return tile(`s12 ctl${hidden ? ' ink' : ''}`, head('Hide your controller from games', toggle(own, (v) => run(() => api('inputOwn', v), v ? 'Your controller is hidden while OpenW Input runs.' : 'Games see your controller again.'))),
    h('p', { class: 'muted' }, 'While OpenW Input is on, games only see OpenW’s virtual controller, so every press counts once. Your controller is back for everything the moment OpenW Input turns off or OpenW closes.'),
    h('div', { class: 'opt-row' }, h('span', { class: `tag${hidden ? ' on' : ''}` }, hidden ? 'Hidden' : 'Not hidden'), h('div', { class: 'grow muted small' }, state),
      st.running && own && !hidden && ps && !dr.hidhide && h('button', { class: 'btn sm', onclick: () => { api('inputReopen'); toast('Trying again.'); } }, 'Try again')));
}

/* ---------- presets ---------- */

views.presets = () => {
  const name = field({ class: 'grow', placeholder: 'Name this setup', maxlength: 40 });
  const paste = field({ class: 'grow', placeholder: 'Paste a preset code' });
  const list = S.settings.presets, n = S.engine.active.length;
  const root = bento(
    tile('s7', head('Save current setup'), h('p', { class: 'muted' }, n ? `${plural(n, 'change')} active right now.` : 'Nothing is active yet. Apply a swap or a map first.'),
      h('div', { class: 'row push' }, name, h('button', { class: 'btn primary', disabled: !n, onclick: () => run(() => api('presetSave', name.value), 'Preset saved.') }, 'Save'))),
    tile('s5', head('Import'), h('p', { class: 'muted' }, 'Paste a preset code to add that setup.'),
      h('div', { class: 'row push' }, paste, h('button', { class: 'btn', onclick: () => run(() => api('presetImport', paste.value), 'Preset imported.') }, 'Import'))));
  root.append(...(list.length ? list : [null]).map((p) => (!p ? tile('s12', empty('presets', 'No presets yet', 'Set your car up the way you like, then save it here.')) : tile('card',
    h('div', { class: 'row' }, art(p.name, 'presets'), h('div', { class: 'grow' }, h('b', { class: 'clip' }, p.name), h('div', { class: 'muted small' }, `${plural(p.ops.length, 'change')} · ${new Date(p.savedAt).toLocaleDateString()}`))),
    h('p', { class: 'muted small' }, p.ops.slice(0, 4).map((o) => o.label).join(' · ') || 'Empty'),
    h('div', { class: 'row wrap push' },
      h('button', { class: 'btn primary grow', onclick: () => run(() => api('presetLoad', p.id), (r) => (r.errors.length ? `Loaded with ${plural(r.errors.length, 'problem')}: ${r.errors[0]}` : 'Preset loaded.')) }, 'Load'),
      h('button', { class: 'btn', onclick: async () => { await navigator.clipboard.writeText(await api('presetExport', p.id)); toast('Preset code copied.'); } }, 'Copy code'),
      h('button', { class: 'btn danger', onclick: () => run(() => api('presetDelete', p.id)) }, 'Delete'))))));
  return root;
};

/* ---------- overlay: music and controller over the game ---------- */

let media = { found: false }; // what Windows says is playing (see main/media.js)
let sources = null;           // music apps that can be followed
let overlayUI = null;         // handles of the mounted Overlay page
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const mediaNow = () => Math.max(0, Math.min(media.duration || 0, media.position + (media.playing ? (Date.now() - media.updated) / 1000 : 0)));
const ANCHORS = [['tl', 'Top left'], ['tc', 'Top centre'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['bc', 'Bottom centre'], ['br', 'Bottom right']];
const PAD_LOOKS = [
  ['Midnight black', '#14161b', '#23262d'], ['White', '#e9ebef', '#c9cdd4'], ['Grey', '#6b7079', '#3c4048'], ['Cosmic red', '#8f1a24', '#2a0d11'],
  ['Starlight blue', '#2c63c9', '#16305e'], ['Galactic purple', '#4b2f86', '#241640'], ['Nova pink', '#d8679a', '#5a2440'], ['Gold', '#a8841f', '#3f300b'],
];
const GLOWS = ['#00d8c8', '#38bdf8', '#818cf8', '#f472b6', '#fb7185', '#fb923c', '#facc15', '#a3e635', '#ffffff'];

// One overlay's settings, changed and saved; and its position and size rows (Overlay and Profile pages).
const overlayUpd = (kind, patch) => { const o = S.settings.overlay; return set('overlay', { ...o, [kind]: { ...o[kind], ...patch } }); };
const overlayPlace = (kind) => {
  const o = S.settings.overlay;
  return h('div', { class: 'opt-row' }, h('div', { class: 'grow' }, h('b', {}, 'Position'), h('div', { class: 'muted small' }, o[kind].x == null ? 'Default place. Pick a corner, or use Move overlays to drag it.' : `Custom: ${o[kind].x}, ${o[kind].y}`)),
    select([['', o[kind].x == null ? 'Default' : 'Custom'], ...ANCHORS, ...(o[kind].x == null ? [] : [['reset', 'Back to default']])], '', (anchor) => anchor && run(() => api('overlayAnchor', kind, anchor)), 170));
};
const overlaySizeRow = (kind, min, max) => {
  const o = S.settings.overlay;
  const label = h('div', { class: 'muted small' }, `${o[kind].size}%`);
  const range = slider(min, max, o[kind].size, (v) => overlayUpd(kind, { size: v }), (v) => { label.textContent = `${v}%`; });
  return h('div', { class: 'opt-row' }, h('div', { style: 'width:120px' }, h('b', {}, 'Size'), h('div', {}, typeable(label, range))), range);
};

views.overlay = () => {
  const o = S.settings.overlay, moving = S.overlayMove;
  const upd = overlayUpd;
  if (!sources) api('mediaSources').then((list) => { sources = list; if (ui.tab === 'overlay') render(); });
  const place = overlayPlace, sizeRow = overlaySizeRow;

  // --- music ---
  const cover = h('div', { class: 'cover sm' }), name = h('b', { class: 'clip' }), artist = h('div', { class: 'muted small clip' }), fill = h('i'), time = h('span', { class: 'muted small' });
  const press = (action) => () => {
    if (action === 'toggle' && media.found) { media = { ...media, position: mediaNow(), updated: Date.now(), playing: !media.playing }; paint(); } // show it at once
    api('mediaControl', action);
  };
  const playBtn = h('button', { class: 'btn sm primary grow', onclick: press('toggle') });
  const tick = () => { fill.style.width = media.found && media.duration ? `${(mediaNow() / media.duration) * 100}%` : '0'; time.textContent = media.found && media.duration ? `${clock(mediaNow())} / ${clock(media.duration)}` : ''; };
  function paint() {
    cover.replaceChildren(media.found && media.art ? h('img', { src: media.art, alt: '' }) : icon('anthems', 26));
    name.textContent = media.found ? media.title : 'Nothing is playing';
    artist.textContent = media.found ? [media.artist, media.source].filter(Boolean).join(' · ') : 'Start a song in any music app on this PC.';
    playBtn.textContent = media.found && media.playing ? 'Pause' : 'Play';
    tick();
  }
  const musicTile = tile(`s6${o.music.on ? ' ink' : ''}`, head('Now playing', toggle(o.music.on, (v) => upd('music', { on: v }))),
    h('p', { class: 'muted' }, 'A small pill over the game with the track, artist and progress.'),
    h('div', { class: 'nowcard' }, cover, h('div', { class: 'col grow', style: 'gap:3px' }, name, artist, h('div', { class: 'progress' }, fill), time)),
    h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: press('prev') }, 'Previous'), playBtn, h('button', { class: 'btn sm', onclick: press('next') }, 'Next')),
    h('div', { class: 'opt-row' }, h('div', { class: 'grow' }, h('b', {}, 'Music app'), h('div', { class: 'muted small' }, 'Follow one app, or whichever is playing.')),
      select((sources || [{ id: 'auto', name: 'Any app (whatever is playing)' }]).map((s) => [s.id, s.name]), o.music.source, (v) => upd('music', { source: v }), 250)),
    sizeRow('music', 70, 160), place('music'));

  // --- controller ---
  // 'auto' follows the controller that is plugged in; the preview shows that one too
  const shownModel = () => (o.pad.model && o.pad.model !== 'auto' ? o.pad.model : Pad.guess(Pad.first()) || 'ps5');
  const preview = Pad.mount(h('div', { class: 'padpreview' }), shownModel());
  Pad.style(preview, o.pad);
  const look = PAD_LOOKS.find(([, body, keys]) => body === o.pad.body && keys === o.pad.keys);
  const opacityLabel = h('div', { class: 'muted small' }, `${o.pad.opacity}%`);
  const opacity = slider(20, 100, o.pad.opacity, (v) => upd('pad', { opacity: v }), (v) => { opacityLabel.textContent = `${v}%`; Pad.style(preview, { ...o.pad, opacity: v }); });
  const padTile = tile(`s6${o.pad.on ? ' ink' : ''}`, head('Controller', toggle(o.pad.on, (v) => upd('pad', { on: v }))),
    h('p', { class: 'muted' }, 'Shows every button, trigger and stick you press. Press something on your controller to try it here.'),
    preview,
    h('div', { class: 'opt-row' }, h('div', { class: 'grow' }, h('b', {}, 'Controller'), h('div', { class: 'muted small' }, 'Automatic picks the one that is plugged in.')),
      select([['auto', 'Automatic'], ...Pad.models()], o.pad.model || 'auto', (v) => upd('pad', { model: v }), 200)),
    h('div', { class: 'opt-row' }, h('div', { class: 'grow' }, h('b', {}, 'Colour'), h('div', { class: 'muted small' }, 'The shell and its buttons.')),
      select(PAD_LOOKS.map(([label]) => [label, label]).concat(look ? [] : [['', 'Custom']]), look ? look[0] : '', (v) => { const pick = PAD_LOOKS.find(([label]) => label === v); if (pick) upd('pad', { body: pick[1], keys: pick[2] }); }, 170)),
    h('div', { class: 'opt-row' }, h('div', { class: 'grow' }, h('b', {}, 'Pressed colour'), h('div', { class: 'muted small' }, 'What a button lights up in.')),
      h('div', { class: 'swatches' }, GLOWS.map((c) => h('button', { class: `swatch${o.pad.glow === c ? ' on' : ''}`, style: `background:${c}`, 'aria-label': c, onclick: () => upd('pad', { glow: c }) })))),
    h('div', { class: 'opt-row' }, h('div', { style: 'width:120px' }, h('b', {}, 'Opacity'), h('div', {}, typeable(opacityLabel, opacity))), opacity),
    sizeRow('pad', 50, 200), place('pad'));

  overlayUI = { paint, tick, preview, root: padTile, shownModel };
  paint();
  return bento(
    tile('s12 bar', h('div', { class: 'grow' }, h('b', {}, 'Only while playing Rocket League'), h('div', { class: 'muted small' }, 'Overlays appear when Rocket League is the window in front, and hide when you tab out.')),
      toggle(o.onlyInGame, (v) => set('overlay', { ...o, onlyInGame: v })),
      h('button', { class: 'btn', onclick: () => { api('overlayPreview'); toast('Showing overlays for 8 seconds.'); } }, 'Show for 8 seconds'),
      h('button', { class: `btn${moving ? ' primary' : ''}`, onclick: () => run(() => api('overlayMove', !moving), moving ? 'Positions saved.' : 'Drag the overlays where you want them, then press Done.') }, moving ? 'Done moving' : 'Move overlays')),
    musicTile, padTile,
    noteTile('info', 's12', 'Overlays are separate click-through windows drawn on top of the game, so Rocket League must run in borderless or windowed mode. They do not read or change the game. Music comes from Windows’ own media controls, so anything that appears in the Windows volume flyout works: Spotify, Apple Music, TIDAL, Deezer, Amazon Music, YouTube Music and SoundCloud in a browser, VLC, foobar2000 and more.'));
};

const overlayLive = () => ui.tab === 'overlay' && overlayUI && overlayUI.root.isConnected;
window.openw.on('media', (state) => { media = state; if (overlayLive()) overlayUI.paint(); });
api('mediaState').then((state) => { media = state; if (overlayLive()) overlayUI.paint(); });
setInterval(() => { if (overlayLive()) overlayUI.tick(); }, 500);
(function padLoop() {
  if (overlayLive()) {
    const want = overlayUI.shownModel(); // a controller plugged in while the page is open
    if (overlayUI.preview.dataset.model !== want) { Pad.mount(overlayUI.preview, want); Pad.style(overlayUI.preview, S.settings.overlay.pad); }
    Pad.update(overlayUI.preview, Pad.first());
  }
  requestAnimationFrame(padLoop);
}());

/* ---------- profile ---------- */

function profileCard(p) {
  const glow = p.glow ? `text-shadow:0 0 14px ${p.titleColor}` : '';
  return h('div', { class: 'pcard' },
    p.avatar ? h('img', { src: p.avatar, alt: '' }) : h('div', { class: 'ph' }, (p.name || '?')[0].toUpperCase()),
    h('div', { class: 'col', style: 'gap:4px' }, h('div', { class: 'pname clip' }, p.name || 'Your name'),
      h('div', { class: 'ptitle', style: `color:${p.titleColor};${glow}` }, p.title || 'Your title'),
      p.rank && h('span', { class: 'tag', style: 'align-self:flex-start' }, p.rank)));
}

// What of your profile can really change in Rocket League: the banner, avatar border and anthem
// are items, so the Garage gives them another look (only you see it).
const PROFILE_ITEMS = [['banners', 'Player banner'], ['borders', 'Avatar border'], ['anthems', 'Player anthem']];

views.profile = () => {
  const p = S.settings.profile, upd = (patch) => set('profile', { ...p, ...patch });
  const card = S.settings.overlay.card || { on: false, size: 100 };
  const swaps = [...S.engine.active.filter((r) => r.op.kind === 'swap').map((r) => ({ op: r.op, queued: false })),
    ...S.engine.queue.filter((q) => q.op && q.op.kind === 'swap').map((q) => ({ op: q.op, queued: true }))];
  const toGarage = (cat) => () => { ui.cat = cat; ui.q = ''; ui.src = ui.dst = ui.check = null; ui.slot = 'src'; popGrid = true; go('garage')(); };
  return bento(
    tile(`s5${card.on ? ' ink' : ''}`, head('Your card', toggle(!!card.on, (v) => overlayUpd('card', { on: v }))), profileCard(p),
      h('p', { class: 'muted small' }, card.on
        ? 'Shown over the game while you play, like the music pill. Only you see it, and it shows in your recordings and clips.'
        : 'Turn it on to show this card over the game while you play. Only you see it, and it shows in your recordings and clips.'),
      card.on && overlaySizeRow('card', 60, 180), card.on && overlayPlace('card')),
    tile('s7', head('Edit'), h('div', { class: 'fields' },
      h('b', {}, 'Name'), field({ maxlength: 24, value: p.name, onchange: (e) => upd({ name: e.target.value }) }),
      h('b', {}, 'Title'), field({ maxlength: 32, value: p.title, onchange: (e) => upd({ title: e.target.value }) }),
      h('b', {}, 'Title colour'), h('div', { class: 'swatches' }, COLORS.map((c) => h('button', { class: `swatch${p.titleColor === c ? ' on' : ''}`, style: `background:${c}`, 'aria-label': c, onclick: () => upd({ titleColor: c }) }))),
      h('b', {}, 'Glow'), h('div', {}, toggle(p.glow, (v) => upd({ glow: v }))),
      h('b', {}, 'Rank badge'), h('div', {}, select(RANKS.map((r) => [r, r || 'None']), p.rank, (v) => upd({ rank: v }), 220)),
      h('b', {}, 'Picture'), h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => run(async () => { const a = await api('pickAvatar'); return a ? api('setSetting', 'profile', { ...p, avatar: a }) : null; }) }, 'Choose picture'),
        p.avatar && h('button', { class: 'btn danger', onclick: () => upd({ avatar: '' }) }, 'Remove')))),
    tile('s12', head('In Rocket League', h('span', { class: 'tag' }, 'Only you see it')),
      h('p', { class: 'muted' }, 'Your banner, avatar border and anthem are items, so they can take the look of any other one in the Garage. You see the new look in the game; other players still see your real one.'),
      h('div', { class: 'list' }, PROFILE_ITEMS.map(([cat, name]) => {
        const s = swaps.find((x) => x.op.category === cat);
        return h('div', { class: 'item' }, art(name, cat),
          h('div', { class: 'grow' }, h('b', {}, name), h('div', { class: 'muted small' }, s ? `${s.op.label}${s.queued ? ' (when Rocket League closes)' : ''}` : 'As the game shows it')),
          h('button', { class: 'btn sm', onclick: toGarage(cat) }, s ? 'Change in Garage' : 'Pick a look in Garage'));
      }))),
    noteTile('info', 's12', h('b', {}, 'What OpenW cannot change in the game'),
      h('p', {}, 'Rocket League takes your name and picture from your Epic Games or Steam account, and your rank and titles (with their colour) from its own servers. No file on your PC holds them, so OpenW cannot change them in the game. Your name, title, rank badge and picture here are for this card.')));
};

/* ---------- clips: a hotkey saves the last seconds of the game ---------- */

// The recorder and the library live in the main process (main/clips.js); this page shows them.
const clipsUI = { info: null, loading: false, picturing: new Set() };
const LENGTH_OPTS = [10, 15, 20, 30, 45, 60, 90, 120, 180].map((s) => [s, s < 60 ? `${s} seconds` : s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} minute${s > 60 ? 's' : ''}`]);
const fileUrl = (p) => `file:///${String(p).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:')}`;
const mmss = (s) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const mb = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(0.1, bytes / 1e6).toFixed(1)} MB`);
const clipCfg = () => S.settings.clips;
const setClips = (patch) => set('clips', { ...clipCfg(), ...patch });

function loadClips() {
  if (clipsUI.loading) return;
  clipsUI.loading = true;
  api('clipsInfo').then((info) => { clipsUI.info = info; }, (e) => { clipsUI.info = { status: { state: 'error', message: reason(e) }, list: [] }; })
    .finally(() => { clipsUI.loading = false; if (ui.tab === 'clips') render(); });
}
window.openw.on('clips', (p) => {
  if (!clipsUI.info) return;
  if (p.status) clipsUI.info.status = p.status;
  if (p.tick) { const el = document.querySelector('[data-clipstate]'); if (el && ui.tab === 'clips') el.textContent = clipStateText(p.status); return; }
  if (p.saved) toast(`Clip saved: ${p.saved}`);
  if (!p.status || p.saved) loadClips(); else if (ui.tab === 'clips') render();
});

function clipStateText(st) {
  const c = clipCfg(), keys = c.keys.map((k) => `${k.key} saves ${LENGTH_OPTS.find(([s]) => s === k.seconds)[1]}`).join(', ');
  const longest = Math.max(10, ...c.keys.map((k) => k.seconds));
  switch (st.state) {
    case 'recording': {
      const i = st.info || {};
      return `Keeping the last ${longest} seconds ready · ${i.width}×${i.height}, ${i.fps} fps, ${i.codec}${i.audio ? ', with sound' : ', no sound'} · ${keys || 'no hotkey set'}`;
    }
    case 'waiting': return `On. It starts when Rocket League starts, then ${keys || 'set a hotkey below'}.`;
    case 'starting': return 'Starting…';
    case 'error': return st.message || 'Something went wrong.';
    default: return c.on ? 'Starting…' : `Off. Turn it on, then in game ${keys || 'set a hotkey below'}.`;
  }
}

views.clips = () => {
  if (!clipsUI.info) { loadClips(); return bento(tile('s12', empty('clips', 'Reading your clips', 'One moment.'))); }
  const { status: st, list } = clipsUI.info, c = clipCfg();
  const recording = st.state === 'recording';
  const longest = Math.max(10, ...c.keys.map((k) => k.seconds));
  const root = bento();

  // --- on / off and what it is doing ---
  root.append(tile(`s12 bar${recording ? ' ink' : ''}`, art('Clips', 'clips'),
    h('div', { class: 'grow' }, h('b', {}, 'Clipping'), h('div', { class: 'muted small', 'data-clipstate': '' }, clipStateText(st)),
      st.state !== 'error' && st.message && h('div', { class: 'small', style: 'color:var(--warn, #e0a030)' }, st.message),
      st.keyErrors && st.keyErrors.length > 0 && h('div', { class: 'small', style: 'color:var(--bad)' }, `${st.keyErrors.join(', ')} ${st.keyErrors.length > 1 ? 'are' : 'is'} taken by another app. Pick another key under Hotkeys.`)),
    recording && h('button', { class: 'btn sm', onclick: () => run(() => api('clipSaveNow', c.keys[0] ? c.keys[0].seconds : 30)) }, 'Save a clip now'),
    toggle(c.on, (v) => setClips({ on: v }))));

  // --- the library ---
  const grid = h('div', { class: 'clipgrid' }, list.map((clip) => clipCard(clip)));
  root.append(tile('s12', head('Your clips', h('span', { class: 'tag' }, plural(list.length, 'clip')), h('button', { class: 'btn sm', onclick: () => api('clipOpenFolder') }, 'Open folder')),
    list.length ? grid : h('p', { class: 'muted' }, `No clips yet. ${c.keys[0] ? `In game, press ${c.keys[0].key} and the last ${c.keys[0].seconds} seconds are saved here.` : ''}`)));
  pictureMissing(list);

  // --- hotkeys ---
  const keys = c.keys;
  const setKeys = (next) => setClips({ keys: next });
  root.append(tile('s6 ctl', head('Hotkeys', keys.length < 6 && h('button', { class: 'btn sm', onclick: () => captureKey(null, (key) => setKeys([...keys, { key, seconds: 60 }])) }, 'Add a hotkey')),
    h('p', { class: 'muted small' }, 'They work while you play. Give each its own length, for example a short one for a goal and a long one for a whole play. A key alone works for F1 to F12 and keys like Insert or Pause; anything else needs Ctrl, Alt or Shift.'),
    keys.map((k, i) => h('div', { class: 'opt-row' },
      h('button', { class: 'btn sm keycap', title: 'Click, then press the keys', onclick: (e) => captureKey(e.currentTarget, (key) => setKeys(keys.map((x, j) => (j === i ? { ...x, key } : x)))) }, k.key),
      h('span', { class: 'muted small' }, 'saves the last'),
      select(LENGTH_OPTS, k.seconds, (v) => setKeys(keys.map((x, j) => (j === i ? { ...x, seconds: v } : x))), 150),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn sm danger', disabled: keys.length < 2, onclick: () => setKeys(keys.filter((_, j) => j !== i)) }, 'Remove'))),
    h('p', { class: 'muted small' }, `It keeps the last ${longest} seconds (the longest hotkey) in memory: about ${mb(((c.mbps * 1e6) / 8) * (longest + 2))} while it runs.`)));

  // --- quality ---
  const rate = slider(2, 80, c.mbps, (v) => setClips({ mbps: v }), (v) => { rateVal.textContent = `${v} Mbps`; rateSub.textContent = sizeText(v); });
  const rateVal = h('span', { class: 'val wide' }, `${c.mbps} Mbps`);
  const sizeText = (v) => `About ${mb(((v * 1e6) / 8) * 60)} per minute of clip.`;
  const rateSub = h('div', { class: 'muted small' }, sizeText(c.mbps));
  root.append(tile('s6 ctl', head('Quality'),
    h('div', { class: 'opt-row' }, h('div', { class: 'lbl grow' }, h('b', {}, 'What to record'), h('div', { class: 'muted small' }, c.source === 'game' ? 'Only the Rocket League window: the overlays are not in the clip.' : 'The whole main screen, with your overlays.')),
      seg([['screen', 'Screen'], ['game', 'Game window']], c.source, (v) => setClips({ source: v }))),
    h('div', { class: 'opt-row' }, h('div', { class: 'lbl grow' }, h('b', {}, 'Resolution'), h('div', { class: 'muted small' }, 'Smaller is lighter on your PC while you play.')),
      select([['native', 'Same as the screen'], ['1440', '1440p'], ['1080', '1080p'], ['720', '720p']], c.res, (v) => setClips({ res: v }), 170)),
    h('div', { class: 'opt-row' }, h('div', { class: 'lbl grow' }, h('b', {}, 'Frame rate')), seg([[30, '30 fps'], [60, '60 fps']], c.fps, (v) => setClips({ fps: v }))),
    h('div', { class: 'opt-row' }, h('div', { class: 'lbl' }, h('b', {}, 'Bitrate'), rateSub), rate, typeable(rateVal, rate)),
    h('div', { class: 'opt-row' }, h('div', { class: 'lbl grow' }, h('b', {}, 'Video format'), h('div', { class: 'muted small' }, c.codec === 'av1' ? 'Smaller files at the same quality. Needs a recent graphics card to stay light; some apps cannot play it yet.' : 'MP4 that plays everywhere. Uses your graphics card when it can.')),
      select([['h264', 'H.264 (MP4)'], ['av1', 'AV1 (MP4)']], c.codec, (v) => setClips({ codec: v }), 170)),
    c.codec === 'av1' && clipsUI.av1hw === false && h('p', { class: 'small', style: 'color:var(--warn, #e0a030)' }, 'Your graphics card cannot encode AV1, so the processor does it, which can cost frames while you play. H.264 is encoded by the graphics card.')));
  if (clipsUI.av1hw === undefined) {
    clipsUI.av1hw = null;
    const ask = (codec) => VideoEncoder.isConfigSupported({ codec, width: 1920, height: 1080, framerate: 60, bitrate: 12e6, hardwareAcceleration: 'prefer-hardware' }).then((r) => r.supported, () => false);
    ask('av01.0.08M.08').then((ok) => { clipsUI.av1hw = ok; if (ui.tab === 'clips' && !ok) render(); });
  }

  // --- sound ---
  const vol = (key, label) => {
    const val = h('span', { class: 'val' }, `${c[key]}%`);
    const r = slider(0, 200, c[key], (v) => setClips({ [key]: v }), (v) => { val.textContent = `${v}%`; });
    return h('div', { class: 'opt-row' }, h('div', { class: 'lbl' }, h('b', {}, label)), r, typeable(val, r));
  };
  if (c.mic && !clipsUI.mics) listMics();
  root.append(tile('s6 ctl', head('Sound'),
    h('div', { class: 'opt-row' }, h('div', { class: 'lbl grow' }, h('b', {}, 'Game and PC sound'), h('div', { class: 'muted small' }, 'Everything you hear: the game, and also music or voice chat.')), toggle(c.game, (v) => setClips({ game: v }))),
    c.game && vol('gameVol', 'Volume'),
    h('div', { class: 'opt-row' }, h('div', { class: 'lbl grow' }, h('b', {}, 'Microphone'), h('div', { class: 'muted small' }, 'Your voice, mixed in.')), toggle(c.mic, (v) => { if (v) listMics(true); setClips({ mic: v }); })),
    c.mic && h('div', { class: 'opt-row' }, h('div', { class: 'lbl grow' }, h('b', {}, 'Which microphone')),
      select([['default', 'Windows default'], ...(clipsUI.mics || []).map((m) => [m.deviceId, m.label || 'Microphone'])], c.micId, (v) => setClips({ micId: v }), 220)),
    c.mic && vol('micVol', 'Mic volume')));

  // --- saving ---
  root.append(tile('s6 ctl', head('Saving'),
    h('div', { class: 'opt-row' }, h('div', { class: 'lbl grow' }, h('b', {}, 'Clips folder'), h('div', { class: 'muted small', style: 'word-break:break-all' }, st.folder)),
      h('button', { class: 'btn sm', onclick: () => run(() => api('clipPickFolder')).then(() => loadClips()) }, 'Change')),
    h('div', { class: 'opt-row' }, h('div', { class: 'lbl grow' }, h('b', {}, 'Only while Rocket League runs'), h('div', { class: 'muted small' }, 'Nothing is recorded, and the hotkeys stay free, when the game is closed.')), toggle(c.onlyInGame, (v) => setClips({ onlyInGame: v }))),
    h('div', { class: 'opt-row' }, h('div', { class: 'lbl grow' }, h('b', {}, '"Clip saved" over the game')), toggle(c.toast, (v) => setClips({ toast: v }))),
    h('div', { class: 'opt-row' }, h('div', { class: 'lbl grow' }, h('b', {}, 'Sound when a clip is saved')), toggle(c.sound, (v) => setClips({ sound: v })))));
  return root;
};

function clipCard(clip) {
  const pic = clip.thumb ? h('img', { src: fileUrl(clip.thumb), alt: '', loading: 'lazy', draggable: 'false' }) : icon('clips', 30);
  return h('button', { class: 'clipcard', onclick: () => openClip(clip) },
    h('span', { class: `clipthumb${clip.thumb ? '' : ' none'}` }, pic, clip.seconds != null && h('span', { class: 'cliplen' }, mmss(clip.seconds))),
    h('span', { class: 'name clip' }, clip.name),
    h('span', { class: 'muted small' }, `${new Date(clip.mtime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${mb(clip.size)}`));
}

// Clips without a picture (saved by another app, or renamed outside OpenW) get one from their video.
async function pictureMissing(list) {
  for (const clip of list.filter((x) => !x.thumb && !clipsUI.picturing.has(x.file)).slice(0, 4)) {
    clipsUI.picturing.add(clip.file);
    try {
      const v = h('video', { muted: '', preload: 'auto', src: fileUrl(clip.file) });
      await new Promise((ok, bad) => { v.onloadeddata = ok; v.onerror = bad; setTimeout(bad, 8000); });
      v.currentTime = Math.min(1.5, (v.duration || 2) / 2);
      await new Promise((ok) => { v.onseeked = ok; setTimeout(ok, 3000); });
      const cv = h('canvas'); cv.width = 384; cv.height = Math.round((384 * v.videoHeight) / (v.videoWidth || 384)) || 216;
      cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
      await api('clipPicture', clip.file, cv.toDataURL('image/jpeg', 0.82));
      clip.thumb = true;
    } catch { /* stays without a picture */ }
  }
  if (list.some((x) => x.thumb === true)) loadClips();
}

async function listMics(ask) {
  try {
    if (ask) { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); } // names show once allowed
    clipsUI.mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
  } catch { clipsUI.mics = []; }
  if (ui.tab === 'clips') render();
}

// Click a hotkey button, press the keys: Ctrl/Alt/Shift plus a key, or an F key alone. Escape cancels.
function captureKey(btn, done) {
  const NAMES = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ScrollLock: 'Scrolllock', ' ': 'Space' };
  const label = btn || h('span');
  const old = label.textContent;
  label.textContent = 'Press keys…';
  label.classList.add('listening');
  api('clipKeysPaused', true).catch(() => {});
  const finish = (key) => {
    window.removeEventListener('keydown', onKey, true);
    label.classList.remove('listening');
    label.textContent = old;
    api('clipKeysPaused', false).catch(() => {});
    if (key) done(key);
  };
  const onKey = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { finish(null); return; }
    if (['Control', 'Alt', 'Shift', 'Meta', 'OS'].includes(e.key)) { label.textContent = `${[e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean).join('+')}+…`; return; }
    const main = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : /^Numpad\d$/.test(e.code) ? `num${e.code.slice(6)}` : NAMES[e.key] || e.key;
    const text = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super', main].filter(Boolean).join('+');
    const key = await api('clipKey', text);
    if (!key) { label.textContent = `${text} cannot be used. Try another…`; return; }
    if (clipCfg().keys.some((k) => k.key.toLowerCase() === key.toLowerCase()) && key !== old) { label.textContent = `${key} is already used. Try another…`; return; }
    finish(key);
  };
  window.addEventListener('keydown', onKey, true);
  if (!btn) toast('Press the keys for the new hotkey (Escape cancels).');
}

// The player: watch, rename, trim, show in folder, delete. It sits over the page, so a page update
// does not stop the video.
function openClip(clip) {
  document.querySelector('.player') && document.querySelector('.player').remove();
  const video = h('video', { src: fileUrl(clip.file), controls: '', autoplay: '', class: 'pvideo' });
  const close = () => { video.pause(); video.removeAttribute('src'); video.load(); box.remove(); document.removeEventListener('keydown', onEsc); };
  const onEsc = (e) => { if (e.key === 'Escape' && !e.target.closest('input')) close(); };
  document.addEventListener('keydown', onEsc);
  const name = field({ value: clip.name, maxlength: 120, class: 'grow', 'aria-label': 'Clip name' });
  const rename = async () => {
    const v = name.value.trim();
    if (!v || v === clip.name) return;
    try { clip.file = await api('clipRename', clip.file, v); clip.name = v; toast('Renamed.'); loadClips(); } catch (e) { toast(reason(e), true); name.value = clip.name; }
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
  name.addEventListener('change', rename);
  const trimBox = h('div', { class: 'trim', hidden: '' });
  const trimBtn = h('button', { class: 'btn sm', onclick: () => { trimBox.hidden = !trimBox.hidden; if (!trimBox.hidden) buildTrim(); } }, 'Trim');
  function buildTrim() {
    const dur = video.duration || clip.seconds || 0;
    if (!dur) { trimBox.replaceChildren(h('p', { class: 'muted small' }, 'Loading the clip…')); video.addEventListener('loadedmetadata', buildTrim, { once: true }); return; }
    let from = 0, to = Math.round(dur * 10) / 10;
    const fromVal = h('span', { class: 'val' }, mmss(from)), toVal = h('span', { class: 'val' }, `${to.toFixed(1)} s`);
    const fromR = slider(0, to, 0, () => {}, (v) => { from = v; fromVal.textContent = `${v.toFixed(1)} s`; video.currentTime = v; }, 0.1);
    const toR = slider(0, to, to, () => {}, (v) => { to = v; toVal.textContent = `${v.toFixed(1)} s`; video.currentTime = v; }, 0.1);
    fromVal.textContent = '0.0 s';
    trimBox.replaceChildren(
      h('div', { class: 'opt-row' }, h('b', { style: 'width:60px' }, 'Start'), fromR, typeable(fromVal, fromR)),
      h('div', { class: 'opt-row' }, h('b', { style: 'width:60px' }, 'End'), toR, typeable(toVal, toR)),
      h('div', { class: 'row' }, h('p', { class: 'muted small grow' }, 'The copy starts on the nearest frame the video can start from, up to a second before Start. Nothing is re-encoded, so it keeps the full quality.'),
        h('button', { class: 'btn primary sm', onclick: async () => {
          if (to <= from) { toast('The end has to be after the start.', true); return; }
          try { const r = await api('clipTrim', clip.file, from, to); toast(`Saved a trimmed copy: ${r.file.split(/[\\/]/).pop()}`); loadClips(); } catch (e) { toast(reason(e), true); }
        } }, 'Save trimmed copy')));
  }
  const box = h('div', { class: 'player', onclick: (e) => { if (e.target === box) close(); } },
    h('div', { class: 'pbox' }, video,
      h('div', { class: 'row' }, name, trimBtn,
        h('button', { class: 'btn sm', onclick: () => api('clipReveal', clip.file).catch((e) => toast(reason(e), true)) }, 'Show in folder'),
        h('button', { class: 'btn sm danger', onclick: async () => {
          if (!window.confirm(`Delete “${clip.name}”? It goes to the Recycle Bin.`)) return;
          try { await api('clipDelete', clip.file); close(); toast('Clip moved to the Recycle Bin.'); loadClips(); } catch (e) { toast(reason(e), true); }
        } }, 'Delete'),
        h('button', { class: 'btn sm', onclick: close }, 'Close')),
      trimBox));
  document.body.append(box);
}

/* ---------- settings ---------- */

views.settings = () => {
  const mode = themeMode();
  const themeCard = (id, label) => h('button', { class: `themecard${mode === id ? ' on' : ''}`, 'aria-pressed': String(mode === id), onclick: () => setTheme(id) },
    h('span', { class: `mini ${id}` }, h('i'), h('i'), h('i'), h('i')), h('span', { class: 'row' }, h('span', { class: 'grow' }, label), mode === id && icon('check', 16)));
  return bento(
    tile('s5', head('Appearance'), h('div', { class: 'themes' }, themeCard('dark', 'Dark'), themeCard('light', 'Light'))),
    tile('s7', head('Game'),
      h('div', { class: 'opt-row' }, h('div', { class: 'grow' }, h('b', {}, 'Rocket League folder'), h('div', { class: 'muted small', style: 'word-break:break-all' }, S.install.dir)),
        h('button', { class: 'btn sm', onclick: () => run(() => api('browseInstall', S.install.platform)) }, 'Change')),
      h('div', { class: 'opt-row push' }, h('div', { class: 'grow' }, h('b', {}, 'Launcher'), h('div', { class: 'muted small' }, 'Used by the Play button.')),
        select([['epic', 'Epic Games'], ['steam', 'Steam']], S.install.platform, (v) => set('platform', v)))),
    tile('s7', head('Item pictures and keys', h('span', { class: `tag${S.keys ? ' on' : ''}` }, S.keys ? `${(S.keys + 1).toLocaleString()} keys` : 'Built-in key only')),
      h('p', { class: 'muted' }, S.bundledKeys
        ? 'Rocket League encrypts item and arena files with many different keys. OpenW comes with them, so items and arenas open without you doing anything. If a brand-new item still shows a lock after a game update, add a newer key list (a keys.txt, one key per line) here.'
        : 'Rocket League encrypts item packages with many different keys. OpenW includes one, which opens about two thirds of items. Items it cannot open show a lock and cannot be used as a new look. Add a key list (a keys.txt, one key per line) to open the rest.'),
      h('div', { class: 'row wrap push' },
        h('button', { class: 'btn primary', onclick: () => run(async () => { const res = await api('importKeys'); keysChanged(); return res; }, (r) => (r.keys ? `${r.keys.toLocaleString()} keys loaded. Pictures are being re-read.` : 'No change.')) }, S.userKeys ? 'Replace key list' : S.bundledKeys ? 'Add a newer key list' : 'Add key list'),
        S.userKeys ? h('button', { class: 'btn danger', onclick: () => run(async () => { const res = await api('removeKeys'); keysChanged(); return res; }, 'Key list removed.') }, 'Remove') : null)),
    updatesTile(),
    tile('s5', head('Data'), h('p', { class: 'muted' }, 'Backups, maps and settings live in the data folder.'),
      h('div', { class: 'row wrap push' },
        h('button', { class: 'btn', onclick: () => api('openDataFolder') }, 'Open data folder'),
        h('button', { class: 'btn danger', disabled: !S.engine.active.length, onclick: () => run(() => api('revertAll'), 'Everything reverted.') }, 'Revert every change'))),
    noteTile('warn', 's12', `OpenW v${S.version} changes files in your Rocket League folder and backs up each one first. Rocket League runs with Easy Anti-Cheat; OpenW does not touch or work around it and cannot promise that changed files are accepted online. Changing game files may break the game’s terms of service and could put your account at risk, so use it at your own risk. Your launcher’s “Verify files” always restores a clean install. Free and open source; not affiliated with Psyonix or Epic Games.`));
};

// Updates from GitHub Releases: what the updater is doing, and the switch for automatic updates.
function updatesTile() {
  const u = S.update || { status: 'idle' };
  const auto = !S.settings.updates || S.settings.updates.auto !== false;
  const status = {
    idle: auto ? 'Checks GitHub for a new version shortly after OpenW starts, and every 6 hours.' : 'Automatic updates are off.',
    checking: 'Checking GitHub…',
    current: `You have the newest version (v${S.version}).`,
    available: `OpenW v${u.version} is out.`,
    downloading: `Downloading OpenW v${u.version}… ${Math.round((u.progress || 0) * 100)}%`,
    ready: `OpenW v${u.version} is downloaded and checked. It installs when you close OpenW, or now:`,
    installing: 'Installing…',
    error: `Could not update: ${u.error}`,
  }[u.status] || '';
  const note = u.status !== 'error' && u.error ? u.error : '';
  return tile('s7', head('Updates', h('span', { class: `tag${u.status === 'ready' ? ' on' : ''}` }, `v${S.version}`)),
    h('p', { class: 'muted' }, 'New versions come from OpenW’s releases on GitHub. Each download is checked against the SHA-256 its release gives before it is installed; Windows asks for permission once while it installs.'),
    h('div', { class: 'opt-row' }, h('div', { class: 'grow' }, h('b', {}, 'Update automatically'), h('div', { class: 'muted small' }, status)),
      toggle(auto, (v) => set('updates', { ...(S.settings.updates || {}), auto: v }))),
    note && h('p', { class: 'small', style: 'color:var(--warn, #e0a030)' }, note),
    h('div', { class: 'row wrap push' },
      u.status === 'ready'
        ? h('button', { class: 'btn primary', onclick: () => run(() => api('updateInstall'), (r) => (r.update && r.update.status === 'installing' ? 'Installing the update. OpenW starts again when it is done.' : (r.update && r.update.error) || 'The update did not start.')) }, `Install v${u.version} now`)
        : h('button', { class: 'btn', disabled: ['checking', 'downloading', 'installing'].includes(u.status), onclick: () => run(() => api('updateCheck'), (r) => (r.update && r.update.status === 'current' ? 'You have the newest version.' : r.update && r.update.status === 'error' ? r.update.error : 'Update found.')) }, 'Check now')));
}

/* ---------- boot ---------- */

// How far a long write is: the every-match button, or the game pill while queued changes go in.
window.openw.on('progress', (p) => {
  if (p.what === 'every') lab.progress = p;
  const el = document.querySelector(`[data-progress="${p.what}"]`);
  if (el) el.textContent = p.what === 'every' ? `${p.done * 2 <= p.total ? 'Reading arenas' : 'Writing arenas'}… ${Math.round((p.done / p.total) * 100)}%` : `Writing queued changes… ${p.done} of ${p.total}`;
});

window.openw.on('state', ({ state, flushed, notice }) => {
  S = state;
  if (notice) toast(notice);
  const ok = flushed.filter((f) => f.ok).length, failed = flushed.filter((f) => !f.ok);
  if (ok) toast(`${plural(ok, 'queued change')} applied.`);
  for (const f of failed) toast(`${f.key}: ${f.message}`, true);
  render();
});
api('getState').then((s) => { S = s; render(); });
