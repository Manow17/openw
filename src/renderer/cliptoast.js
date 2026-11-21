// "Clip saved", shown over the game for a moment when a clip is saved (or could not be).
// A short rising chime plays when the sound option is on.
const note = document.getElementById('note');
let timer = null;

function chime(ok) {
  try {
    const ac = new AudioContext(), now = ac.currentTime;
    const notes = ok ? [880, 1320] : [520, 390];
    notes.forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, now + i * 0.09);
      g.gain.linearRampToValueAtTime(0.12, now + i * 0.09 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.22);
      o.connect(g).connect(ac.destination);
      o.start(now + i * 0.09); o.stop(now + i * 0.09 + 0.25);
    });
    setTimeout(() => ac.close(), 600);
  } catch { /* no sound device */ }
}

window.openw.on('clip-toast', ({ title, sub, ok, sound }) => {
  document.getElementById('title').textContent = title;
  document.getElementById('sub').textContent = sub || '';
  note.classList.toggle('bad', !ok);
  note.classList.add('in');
  if (sound) chime(ok);
  clearTimeout(timer);
  timer = setTimeout(() => note.classList.remove('in'), 2600);
});
