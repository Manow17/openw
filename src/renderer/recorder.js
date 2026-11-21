// The clip recorder: a hidden window that captures the screen (or the Rocket League window) and the
// sound, encodes it (MediaRecorder, the graphics card's encoder when Chromium has one) and keeps
// the last seconds in memory (shared/mp4.js Ring). Nothing is written to disk until a clip is saved.
// main/clips.js starts it with 'clip-config' and asks for clips with 'clip-save'.
const api = (method, ...args) => window.openw.call(method, ...args);
let state = null; // { stream, recorder, ring, audio, video, cfg }

const MIME = {
  h264: ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2'],
  av1: ['video/mp4;codecs=av01.0.08M.08,mp4a.40.2', 'video/mp4;codecs=av01,mp4a.40.2'],
};
const SIZES = { 1440: [2560, 1440], 1080: [1920, 1080], 720: [1280, 720] };

function stop() {
  if (!state) return;
  try { if (state.recorder.state !== 'inactive') state.recorder.stop(); } catch { /* already stopped */ }
  for (const s of [state.stream, state.mic, state.out]) if (s) s.getTracks().forEach((t) => t.stop());
  if (state.audio) state.audio.close().catch(() => {});
  state = null;
}

async function start(cfg) {
  stop();
  const [w, h] = SIZES[cfg.res] || [];
  const size = w ? { maxWidth: w, maxHeight: h } : {};
  // Electron's desktop capture: the source main/clips.js picked, and the sound of the whole PC
  const video = { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: cfg.sourceId, maxFrameRate: cfg.fps, minFrameRate: Math.min(30, cfg.fps), ...size } };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: cfg.game ? { mandatory: { chromeMediaSource: 'desktop' } } : false, video });
  } catch (e) {
    if (!cfg.game) throw e;
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video }); // the picture without the sound is better than nothing
    report('warn', `The PC's sound could not be captured (${e.message}). Clips are recorded without it.`);
  }
  let mic = null;
  if (cfg.mic) {
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: cfg.micId && cfg.micId !== 'default' ? { exact: cfg.micId } : undefined, echoCancellation: false, noiseSuppression: true, autoGainControl: true } }); } catch (e) { report('warn', `The microphone could not be opened (${e.message}). Clips are recorded without it.`); }
  }
  // the game sound and the microphone mixed into one track, each at its own volume
  const out = new MediaStream(stream.getVideoTracks());
  let audio = null;
  const sources = [[stream, cfg.gameVol], [mic, cfg.micVol]].filter(([s]) => s && s.getAudioTracks().length);
  if (sources.length) {
    audio = new AudioContext({ sampleRate: 48000 });
    const dest = audio.createMediaStreamDestination();
    for (const [s, vol] of sources) {
      const gain = audio.createGain();
      gain.gain.value = vol / 100;
      audio.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(gain).connect(dest);
    }
    out.addTrack(dest.stream.getAudioTracks()[0]);
  }
  const mime = (MIME[cfg.codec] || MIME.h264).find((m) => MediaRecorder.isTypeSupported(m)) || MIME.h264.find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error('This PC cannot record MP4 video.');
  // a keyframe every second: clips start on one, so a clip is never more than a second longer
  const recorder = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: cfg.mbps * 1e6, audioBitsPerSecond: 160000, videoKeyFrameIntervalDuration: 1000 });
  const ring = new OpenWMp4.Ring(cfg.keep);
  recorder.ondataavailable = async (e) => { if (e.data.size && state && state.recorder === recorder) ring.push(new Uint8Array(await e.data.arrayBuffer())); };
  recorder.onerror = (e) => report('error', `Recording stopped: ${(e.error && e.error.message) || 'unknown error'}.`);
  stream.getVideoTracks()[0].addEventListener('ended', () => report('error', 'The screen capture ended (the window closed or the screen changed).'));
  recorder.start(1000);
  state = { stream, mic, out, audio, recorder, ring, cfg };
  const t = stream.getVideoTracks()[0].getSettings();
  report('recording', '', { width: t.width, height: t.height, fps: Math.round(t.frameRate || cfg.fps), mime, audio: sources.length > 0 });
}

function report(kind, message, info = {}) { api('clipStatus', { kind, message, ...info }).catch(() => {}); }

// The current frame as a small JPEG, for the library. Taken only when a clip is saved, so
// nothing draws the capture the rest of the time.
async function picture() {
  try {
    const track = state && state.stream.getVideoTracks()[0];
    if (!track) return null;
    const frame = await new ImageCapture(track).grabFrame();
    const c = document.createElement('canvas');
    c.width = 384; c.height = Math.round((384 * frame.height) / frame.width);
    c.getContext('2d').drawImage(frame, 0, 0, c.width, c.height);
    frame.close();
    return c.toDataURL('image/jpeg', 0.82);
  } catch { return null; }
}

async function save({ id, seconds }) {
  try {
    if (!state) throw new Error('Clipping is not running.');
    await new Promise((r) => setTimeout(r, 150)); // the moment the key was pressed is in the next chunk
    state.recorder.requestData();
    await new Promise((r) => setTimeout(r, 250));
    const bytes = state.ring.clip(seconds);
    if (!bytes) throw new Error('Nothing is recorded yet. Try again in a second.');
    await api('clipWrite', id, bytes, await picture());
  } catch (e) {
    await api('clipWrite', id, null, null, String(e.message || e)).catch(() => {});
  }
}

window.openw.on('clip-config', (cfg) => { if (cfg) start(cfg).catch((e) => report('error', String(e.message || e))); else stop(); });
window.openw.on('clip-save', save);
setInterval(() => { if (state) report('tick', '', { held: Math.round(state.ring.seconds), bytes: state.ring.bytes }); }, 5000);
api('clipReady').catch(() => {});
