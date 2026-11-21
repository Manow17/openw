// Controller overlay window: draws the pad and lights it up with live input.
// The input comes from OpenW's input helper (main.js, 'pad-state'): Chromium's own gamepad API
// only reports to the window in focus, and this one never is while you play. It is used only
// when the helper sends nothing (an older helper, or while moving the overlay).
const root = document.getElementById('pad');
let cfg = { model: 'auto' };
let live = null, liveAt = 0;
window.openw.on('pad-state', (st) => { live = st; liveAt = performance.now(); });

// The helper's report as a standard gamepad: sticks and triggers in Steam's units (up positive),
// buttons as bits A B X Y LB RB LS RS Back Start Guide Up Down Left Right Touchpad ...
const KIND_ID = { ds4: 'DualShock 4 (054c)', dualsense: 'DualSense (0ce6)', edge: 'DualSense Edge (0df2)', xinput: 'Xbox controller (XInput)' };
function fromHelper(st) {
  const U = 32767, bit = (i) => !!(st.rawButtons & (2 ** i));
  const btn = (pressed, value = pressed ? 1 : 0) => ({ pressed, value });
  const lt = Math.max(0, Math.min(1, st.raw[4] / U)), rt = Math.max(0, Math.min(1, st.raw[5] / U));
  const buttons = [bit(0), bit(1), bit(2), bit(3), bit(4), bit(5), false, false, bit(8), bit(9), bit(6), bit(7), bit(11), bit(12), bit(13), bit(14), bit(10), bit(15) || bit(21)].map((b) => btn(b));
  buttons[6] = btn(lt > 0.15, lt);
  buttons[7] = btn(rt > 0.15, rt);
  return { id: KIND_ID[st.kind] || '', connected: true, buttons, axes: [st.raw[0] / U, -st.raw[1] / U, st.raw[2] / U, -st.raw[3] / U] };
}
const current = () => (live && performance.now() - liveAt < 1000 ? fromHelper(live) : Pad.first());
const model = () => (cfg.model && cfg.model !== 'auto' ? cfg.model : Pad.guess(current()) || 'ps5');
Pad.mount(root, model());

function configure(next) {
  cfg = next;
  if (root.dataset.model !== model()) Pad.mount(root, model());
  Pad.style(root, cfg);
  document.body.classList.toggle('edit', !!cfg.edit);
}

function frame() {
  if (root.dataset.model !== model()) { Pad.mount(root, model()); Pad.style(root, cfg); } // a different controller was plugged in
  Pad.update(root, current());
  requestAnimationFrame(frame);
}

window.openw.on('overlay-config', configure);
window.openw.call('overlayConfig', 'pad').then(configure);
requestAnimationFrame(frame);
