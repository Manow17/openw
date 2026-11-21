// Controller overlay: top-down drawings of a PS5 DualSense, PS4 DualShock 4 and Xbox
// controller (assets/controllers, MIT-licensed, credits in CREDITS.md), coloured here
// and lit up with live input.
//   Pad.mount(el, model)     draws model ('ps5' | 'ps4' | 'xbox') into el
//   Pad.style(el, settings)  { body, keys, glow, opacity }
//   Pad.update(el, gamepad)  shows a Gamepad's current buttons, triggers and sticks
// Needs assets/controllers/pads.js (PAD_ART) loaded first.
const Pad = (() => {
  const CSS = `
.padsvg { display: block; width: 100%; height: auto; overflow: visible;
  --pad-body: #14161b; --pad-keys: #23262d; --pad-glow: #00d8c8; --pad-line: color-mix(in srgb, var(--pad-body) 55%, #9aa0aa); }
/* PS4 (Gamepad Viewer drawing): its colour roles */
.pc-ds4 .pc-body { fill: var(--pad-body); }
.pc-ds4 .pc-grip { fill: color-mix(in srgb, var(--pad-body) 78%, #ffffff); }
.pc-ds4 .pc-trim { fill: color-mix(in srgb, var(--pad-body) 88%, #ffffff); }
.pc-ds4 .pc-trim2 { fill: color-mix(in srgb, var(--pad-body) 70%, #000000); }
.pc-ds4 .pc-well { fill: color-mix(in srgb, var(--pad-body) 55%, #000000); }
.pc-ds4 .pc-key, .pc-ds4 .pc-arrow { fill: var(--pad-keys); }
.pc-ds4 .pc-deep { fill: color-mix(in srgb, var(--pad-body) 40%, #000000); }
.pc-ds4 .pc-logo { fill: #050608; stroke: none; }
.pc-ds4 .pc-shine { fill: #e8eaee; }
.pc-ds4 .pc-line { fill: var(--pad-line); }
.pc-ds4 .pc-hide { display: none; }
/* PS5 and Xbox (line drawings with an id per button): filled flat */
.pc-zg * { fill: var(--pad-body); stroke: var(--pad-line); stroke-width: 3; stroke-linejoin: round; }
.pc-zg .pc-under { stroke: none; }
.pc-zg .pc-stick { fill: var(--pad-keys); }
.pc-zg [data-b], .pc-zg [data-b] *, .pc-zg [data-stick], .pc-zg [data-stick] * { fill: var(--pad-keys); }
.pc-zg [data-trigger] { fill: var(--pad-keys); }
.pc-zg .pc-hide { display: none; }
/* what lights up */
.padsvg .pc-spot { fill: var(--pad-glow); opacity: 0; transition: opacity .06s; }
.padsvg .pc-spot.on { opacity: .85; }
.padsvg .pc-trig { fill: var(--pad-glow); opacity: .9; }
.padsvg .pc-cap { fill: var(--pad-glow); opacity: 0; transition: opacity .1s; }
.padsvg .pc-cap.on { opacity: .9; }
.pc-zg [data-b].on, .pc-zg [data-b].on *, .pc-zg [data-stick].on, .pc-zg [data-stick].on * { fill: var(--pad-glow); stroke: var(--pad-glow); }`;

  const ART = typeof PAD_ART === 'object' ? PAD_ART : {};
  const ns = 'http://www.w3.org/2000/svg';

  function mount(host, model = 'ps5') {
    if (!document.getElementById('pad-style')) {
      const css = CSS + Object.values(ART).map((a) => a.css).join('');
      document.head.append(Object.assign(document.createElement('style'), { id: 'pad-style', textContent: css }));
    }
    const key = ART[model] ? model : Object.keys(ART)[0];
    const a = ART[key];
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', a.viewBox);
    svg.setAttribute('class', `padsvg ${key === 'ps4' ? 'pc-ds4' : 'pc-zg'}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', a.name);
    svg.innerHTML = a.svg; // generated from the bundled drawings, never from user input
    host.replaceChildren(svg);
    host.dataset.model = key;
    return host;
  }

  function style(host, { body, keys, glow, opacity } = {}) {
    const svg = host.querySelector('.padsvg');
    if (!svg) return;
    const hex = (v) => /^#[0-9a-f]{6}$/i.test(v);
    if (hex(body)) svg.style.setProperty('--pad-body', body);
    if (hex(keys)) svg.style.setProperty('--pad-keys', keys);
    if (hex(glow)) svg.style.setProperty('--pad-glow', glow);
    svg.style.opacity = Math.max(20, Math.min(100, Number(opacity) || 100)) / 100;
  }

  const pressed = (gp, i) => { const b = gp && gp.buttons[i]; return !!b && (b.pressed || b.value > 0.15); };

  function update(host, gp) {
    for (const el of host.querySelectorAll('[data-b]')) {
      // "12+15" lights a d-pad corner when both directions are held
      el.classList.toggle('on', el.dataset.b.split('+').every((i) => pressed(gp, Number(i))));
    }
    for (const el of host.querySelectorAll('[data-trigger]')) {
      const b = gp && gp.buttons[Number(el.dataset.trigger)], v = b ? b.value : 0;
      if (el.classList.contains('pc-trig')) {
        // PS4: a bar that grows from the bottom of the trigger
        const top = Number(el.dataset.top), h = Number(el.dataset.h);
        el.setAttribute('y', (top + h * (1 - v)).toFixed(1));
        el.setAttribute('height', (h * v).toFixed(1));
      } else {
        el.style.fill = v > 0.02 ? `color-mix(in srgb, var(--pad-glow) ${Math.round(v * 100)}%, var(--pad-keys))` : '';
      }
    }
    for (const el of host.querySelectorAll('[data-stick]')) {
      const axis = Number(el.dataset.stick), x = gp ? gp.axes[axis] || 0 : 0, y = gp ? gp.axes[axis + 1] || 0 : 0;
      const moved = Math.hypot(x, y) > 0.25;
      if (el.classList.contains('pc-cap')) {
        const t = Number(el.dataset.travel);
        el.setAttribute('cx', Number(el.dataset.x) + x * t);
        el.setAttribute('cy', Number(el.dataset.y) + y * t);
      } else {
        el.setAttribute('transform', `translate(${(x * 18).toFixed(1)} ${(y * 18).toFixed(1)})`);
      }
      el.classList.toggle('on', moved);
    }
  }

  // Which controller is plugged in, from the name Windows gives it.
  function guess(gp) {
    const id = (gp && gp.id || '').toLowerCase();
    if (/dualsense|0ce6|0df2/.test(id)) return 'ps5';
    if (/dualshock|054c|playstation|wireless controller/.test(id)) return 'ps4';
    if (/xbox|xinput|045e/.test(id)) return 'xbox';
    return null;
  }

  const first = () => [...navigator.getGamepads()].find((p) => p && p.connected) || null;
  const models = () => Object.entries(ART).map(([k, a]) => [k, a.name]);
  return { mount, style, update, first, guess, models };
})();
