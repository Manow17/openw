// Builds assets/controllers/pads.js from the controller drawings in assets/controllers/src.
// Run with:  node scripts/prepare-controllers.js
//
// Sources (both MIT, licences next to the files; see assets/controllers/CREDITS.md):
//   ds4/      PS4 DualShock 4, from Gamepad Viewer's Dracula skin (github.com/dracula/gamepad-viewer)
//   ps5.svg   PS5 DualSense, from Zergatul.Obs.InputOverlay (github.com/Zergatul/Zergatul.Obs.InputOverlay)
//   xbox.svg  Xbox Series controller, from the same project
//
// What this does to them: removes their own colours and style sheets (OpenW colours
// them with CSS, so the user can recolour), makes ids unique per controller, and tags
// every button with data-b = its number in the standard Gamepad mapping, so the overlay
// can light up exactly the button that is pressed.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'assets', 'controllers', 'src');
const OUT = path.join(__dirname, '..', 'assets', 'controllers', 'pads.js');

// Standard Gamepad mapping
const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, Back: 8, Start: 9, L3: 10, R3: 11, Up: 12, Down: 13, Left: 14, Right: 15, Home: 16, Pad: 17 };

const stripXml = (t) => t
  .replace(/<\?xml[^>]*>\s*/g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<metadata[\s\S]*?<\/metadata>/g, '')
  .replace(/<sodipodi:namedview[\s\S]*?(\/>|<\/sodipodi:namedview>)/g, '')
  .replace(/<inkscape:[^>]*\/>/g, '')
  .replace(/\s(?:inkscape|sodipodi):[\w-]+="[^"]*"/g, '')
  .replace(/\sxmlns:(?:dc|cc|rdf|svg|sodipodi|inkscape)="[^"]*"/g, '')
  .replace(/\s+/g, ' ');

// Unique ids, so two controllers (or the app's own page) never clash.
function prefixIds(t, prefix) {
  return t
    .replace(/\sid="([^"]+)"/g, ` id="${prefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
    .replace(/(xlink:)?href="#([^"]+)"/g, (m, x, id) => `${x || ''}href="#${prefix}-${id}"`);
}

// ---------- PS4 (Gamepad Viewer layout: one base drawing, parts placed by CSS) ----------
function buildDs4() {
  let t = fs.readFileSync(path.join(SRC, 'ds4', 'base.svgz'), 'utf8');
  t = stripXml(t);
  // its colours become classes OpenW styles (see pad.js): which part of the controller each one is
  const roles = {
    st1: 'pc-line', st2: 'pc-shine', st3: 'pc-body', st4: 'pc-grip', st5: 'pc-deep', st6: 'pc-well', st9: 'pc-arrow',
    st10: 'pc-trim2', st11: 'pc-trim', st12: 'pc-trim', st13: 'pc-key', st14: 'pc-key', st15: 'pc-key', st16: 'pc-key', st17: 'pc-key',
    st18: 'pc-logo', st19: 'pc-deep', st25: 'pc-trim', st31: 'pc-shine', st32: 'pc-shine', st35: 'pc-hide',
  };
  // keep the style sheet only for opacity/visibility rules, with prefixed class names
  const sheet = (t.match(/<style[^>]*>([\s\S]*?)<\/style>/) || [, ''])[1];
  const keep = [...sheet.matchAll(/\.(st\d+)\{([^}]*)\}/g)]
    .map(([, cls, body]) => [cls, body.split(';').filter((d) => /^\s*(opacity|display|enable-background)/.test(d) || /fill:url/.test(d)).join(';')])
    .filter(([, body]) => body.trim())
    .map(([cls, body]) => `.pc-ds4 .d4-${cls}{${body}}`).join('');
  t = t.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
  t = t.replace(/class="(st\d+)"/g, (m, cls) => `class="d4-${cls}${roles[cls] ? ` ${roles[cls]}` : ''}"`);
  t = prefixIds(t, 'ds4');
  const vb = t.match(/viewBox="([^"]+)"/)[1].split(/[\s,]+/).map(Number); // -556 241.1 806 598.9
  const svgOpen = t.match(/<svg\b[^>]*>/)[0];
  let inner = t.slice(t.indexOf(svgOpen) + svgOpen.length, t.lastIndexOf('</svg>'));

  // Light-up spots, placed where Gamepad Viewer's own style sheet puts the parts
  // (assets/controllers/src/ds4/edit.css, in pixels from the top left of the drawing).
  const X = (px) => +(vb[0] + px).toFixed(1), Y = (px) => +(vb[1] + px).toFixed(1);
  const spots = [];
  const circle = (b, cx, cy, r) => spots.push(`<circle class="pc-spot" data-b="${b}" cx="${X(cx)}" cy="${Y(cy)}" r="${r}"/>`);
  const rect = (b, x, y, w, h, rx) => spots.push(`<rect class="pc-spot" data-b="${b}" x="${X(x)}" y="${Y(y)}" width="${w}" height="${h}" rx="${rx}"/>`);
  // face buttons: box at 567,159; 55px buttons
  circle(B.Y, 567 + 58 + 27.5, 159 + 27.5, 25); circle(B.B, 567 + 170 - 27.5, 159 + 58 + 27.5, 25);
  circle(B.A, 567 + 58 + 27.5, 159 + 171 - 27.5, 25); circle(B.X, 567 + 27.5, 159 + 58 + 27.5, 25);
  // d-pad: box at 92,181, 125x126
  rect(B.Up, 92 + 44, 181, 36, 52, 8); rect(B.Down, 92 + 44, 181 + 126 - 52, 36, 52, 8);
  rect(B.Left, 92, 181 + 45, 52, 36, 8); rect(B.Right, 92 + 125 - 52, 181 + 45, 52, 36, 8);
  // share / options: box at 227,142, 352 wide, 28x46 each
  rect(B.Back, 227 + 2, 142 + 6, 22, 36, 10); rect(B.Start, 227 + 352 - 24, 142 + 6, 22, 36, 10);
  // touchpad 272,122 262x151; PS button 42px at 382, 216 from the bottom
  rect(B.Pad, 272 + 4, 122 + 4, 254, 143, 14); circle(B.Home, 382 + 21, vb[3] - 216 - 21, 19);
  // bumpers: row at 109,94, 588 wide, 99x23
  rect(B.LB, 109, 94, 99, 23, 8); rect(B.RB, 109 + 588 - 99, 94, 99, 23, 8);
  // triggers: row at 109,0, 99x90; a bar that fills from the bottom as they are pulled
  const trig = (b, x) => spots.push(`<rect class="pc-trig" data-trigger="${b}" data-top="${Y(14)}" data-h="76" x="${X(x + 8)}" y="${Y(90)}" width="83" height="0" rx="14"/>`);
  trig(B.LT, 109); trig(B.RT, 109 + 588 - 99);
  // sticks: box at 228,308, 361x105, 94px sticks; L3/R3 ring and a moving cap
  const stick = (axis, press, cx, cy) => spots.push(`<circle class="pc-spot" data-b="${press}" cx="${X(cx)}" cy="${Y(cy)}" r="45"/>`
    + `<circle class="pc-cap" data-stick="${axis}" data-x="${X(cx)}" data-y="${Y(cy)}" data-travel="20" cx="${X(cx)}" cy="${Y(cy)}" r="16"/>`);
  stick(0, B.L3, 228 + 47, 308 + 47); stick(2, B.R3, 228 + 361 - 105 + 47, 308 + 105 - 105 + 47);
  inner += `<g class="pc-layer">${spots.join('')}</g>`;
  return { name: 'PS4 DualShock 4', viewBox: vb.join(' '), css: keep, svg: inner, credit: 'dracula/gamepad-viewer (MIT)' };
}

// ---------- PS5 and Xbox (Zergatul's input overlay: every button has an id) ----------
const num = (tag, k) => Number((tag.match(new RegExp(`\\s${k}="([-\\d.e]+)"`)) || [])[1]);
// translate(x,y) of a transform attribute; 0,0 for none (the drawings use no other transforms
// on the groups around buttons)
const shift = (tag) => {
  const m = /\stransform="translate\(\s*([-\d.e]+)[\s,]+([-\d.e]+)\s*\)"/.exec(tag);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
};
// The centre of a circle or ellipse by id, where it is really drawn: with the translate() of
// its own and of every group around it added. (The Xbox sticks sit in translated groups; their
// glow was drawn 111 and 64 units away from the left stick before 0.4.10.)
function centreOf(svg, id) {
  const re = /<(\/?)(g|circle|ellipse)\b([^>]*?)(\/?)>/g;
  const stack = [];
  for (let m; (m = re.exec(svg));) {
    const [tag, close, kind, , self] = m;
    if (kind === 'g') { if (close) stack.pop(); else if (!self) stack.push(shift(tag)); continue; }
    if (close || !new RegExp(`\\sid="${id}"`).test(tag)) continue;
    const own = shift(tag), dx = stack.reduce((s, t) => s + t.x, own.x), dy = stack.reduce((s, t) => s + t.y, own.y);
    return { x: +(num(tag, 'cx') + dx).toFixed(2), y: +(num(tag, 'cy') + dy).toFixed(2), r: num(tag, 'r') || num(tag, 'rx') };
  }
  return null;
}

// extra: { under: [path id, transform] the outline whose first contour is drawn as a solid body
// below everything (the PS5 outline is a ring, so its middle was see-through);
// below: ids of body shapes moved below the buttons, so a filled body never hides a button }
function buildZergatul(file, prefix, name, ids, extra = {}) {
  let t = stripXml(fs.readFileSync(path.join(SRC, file), 'utf8'));
  t = t.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
  t = t.replace(/\sclass="st\d+"/g, '').replace(/\sstyle="[^"]*"/g, '');
  // tag the buttons before ids are prefixed
  t = t.replace(/\sid="([A-Za-z0-9]+)"/g, (m, id) => {
    if (id in ids) return `${m} data-b="${ids[id]}"`;
    if (/^(Left|Right)StickCore$/.test(id)) return `${m} data-stick="${id[0] === 'L' ? 0 : 2}"`;
    if (/^(Left|Right)Trigger$/.test(id)) return `${m} data-trigger="${id[0] === 'L' ? B.LT : B.RT}"`;
    if (/^(Left|Right)TriggerClip$/.test(id)) return `${m} class="pc-hide"`;
    return m;
  });
  t = prefixIds(t, prefix);
  const vb = t.match(/viewBox="([^"]+)"/)[1];
  const svgOpen = t.match(/<svg\b[^>]*>/)[0];
  let inner = t.slice(t.indexOf(svgOpen) + svgOpen.length, t.lastIndexOf('</svg>'));
  // body shapes go below the buttons, and a solid body below everything
  const below = [];
  for (const id of extra.below || []) {
    const tag = new RegExp(`<path\\b[^>]*\\sid="${prefix}-${id}"[^>]*/>`).exec(inner);
    if (!tag) throw new Error(`${file}: no ${id}`);
    inner = inner.replace(tag[0], '');
    below.push(tag[0]);
  }
  if (extra.under) {
    const [id, transform] = extra.under;
    const d = (new RegExp(`<path\\b[^>]*\\sd="([^"]+)"[^>]*\\sid="${prefix}-${id}"`).exec(inner) || [])[1];
    if (!d) throw new Error(`${file}: no ${id}`);
    const outer = d.split(/(?=[mM])/)[0]; // its first contour is the outside of the controller
    below.unshift(`<path class="pc-under" transform="${transform}" d="${outer}"/>`);
  }
  inner = below.join('') + inner;
  // The stick tops are drawn under other shapes, so their glow goes on a layer above
  // everything: a ring for L3/R3 and a dot that follows the stick.
  const centre = (id) => centreOf(inner, `${prefix}-${id}`);
  inner = inner.replace(/\sdata-stick="\d"/g, '');
  const layer = [];
  for (const [axis, core, press] of [[0, 'LeftStickCore', 'ButtonL3'], [2, 'RightStickCore', 'ButtonR3']]) {
    const c = centre(core) || centre(press);
    if (!c || !c.r) continue;
    layer.push(`<circle class="pc-spot" data-b="${axis === 0 ? B.L3 : B.R3}" cx="${c.x}" cy="${c.y}" r="${c.r + 4}"/>`
      + `<circle class="pc-cap" data-stick="${axis}" data-x="${c.x}" data-y="${c.y}" data-travel="${(c.r * 0.3).toFixed(1)}" cx="${c.x}" cy="${c.y}" r="${(c.r * 0.38).toFixed(1)}"/>`);
  }
  inner += `<g class="pc-layer">${layer.join('')}</g>`;
  return { name, viewBox: vb, css: '', svg: inner, credit: 'Zergatul/Zergatul.Obs.InputOverlay (MIT)' };
}

const common = { ButtonA: B.A, ButtonB: B.B, ButtonX: B.X, ButtonY: B.Y, ButtonLB: B.LB, ButtonRB: B.RB, ButtonBack: B.Back, ButtonStart: B.Start, ButtonL3: B.L3, ButtonR3: B.R3 };
const art = {
  // PS5: path1052 is the touchpad, path1084 the PS button, path1056/1058 the grips, path1060 the outline
  ps5: buildZergatul('ps5.svg', 'ps5', 'PS5 DualSense', { ...common, DPadUp: B.Up, DPadDown: B.Down, DPadLeft: B.Left, DPadRight: B.Right, path1052: B.Pad, path1084: B.Home },
    { under: ['path1060', 'translate(0,834)'], below: ['path1052', 'path1056', 'path1058'] }),
  ps4: buildDs4(),
  // Xbox d-pad: D0 up, D2 right, D4 down, D6 left; odd ones are the corners between them
  xbox: buildZergatul('xbox.svg', 'xbox', 'Xbox controller', { ...common, D0: B.Up, D2: B.Right, D4: B.Down, D6: B.Left, D1: `${B.Up}+${B.Right}`, D3: `${B.Right}+${B.Down}`, D5: `${B.Down}+${B.Left}`, D7: `${B.Left}+${B.Up}` }),
};
// required (by the tests): the drawings as they would be built, nothing is written
if (require.main !== module) module.exports = { art, centreOf };
else {
  fs.writeFileSync(OUT, `// Generated by scripts/prepare-controllers.js. Do not edit by hand.\n// Controller drawings: see assets/controllers/CREDITS.md.\nconst PAD_ART = ${JSON.stringify(art)};\n`);
  for (const [k, v] of Object.entries(art)) console.log(k, v.name, `${(v.svg.length / 1024).toFixed(0)} KB`, 'buttons', (v.svg.match(/data-b="/g) || []).length, 'sticks', (v.svg.match(/data-stick="/g) || []).length, 'triggers', (v.svg.match(/data-trigger="/g) || []).length);
  console.log('wrote', path.relative(process.cwd(), OUT), `${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
}
