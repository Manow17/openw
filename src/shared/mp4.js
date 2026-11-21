/* MP4 for clips, without re-encoding anything.
   The recorder (renderer/recorder.js) gets fragmented MP4 from MediaRecorder: an init segment
   (ftyp, moov) and then fragments (moof + mdat) that each start on a video keyframe. This keeps
   the last seconds of those fragments (Ring), and turns a run of them into an ordinary MP4 file
   (one moov with full sample tables, then one mdat) that every player and site accepts, with its
   duration known. The same model trims a saved clip: keyframe to keyframe on the video, so no
   picture is re-encoded.
   Works on Uint8Array (page) and Buffer (main process, tests). Loaded by the page as a script and
   by the main process with require. */
(function (root) {
  const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'moof', 'traf', 'mvex', 'edts', 'dinf']);
  const dv = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const fourcc = (u8, p) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);

  // The boxes in u8[start, end): [{ type, start, end, body }] (body: where the content starts).
  function boxes(u8, start = 0, end = u8.length) {
    const v = dv(u8), out = [];
    for (let p = start; p + 8 <= end;) {
      let size = v.getUint32(p), body = p + 8;
      if (size === 1) { size = Number(v.getBigUint64(p + 8)); body = p + 16; } else if (size === 0) size = end - p;
      if (size < 8 || p + size > end) break; // incomplete: the rest has not arrived yet
      out.push({ type: fourcc(u8, p + 4), start: p, end: p + size, body });
      p += size;
    }
    return out;
  }
  const child = (u8, box, type) => boxes(u8, box.body, box.end).find((b) => b.type === type);
  const children = (u8, box, type) => boxes(u8, box.body, box.end).filter((b) => b.type === type);
  const path = (u8, box, ...types) => types.reduce((b, t) => b && child(u8, b, t), box);
  const slice = (u8, box) => u8.subarray(box.start, box.end);

  /* ---------- the model: tracks with their samples ---------- */
  // track: { id, timescale, handler, tkhd, mdhd, hdlr, head (vmhd/smhd), dinf, stsd, samples }
  // sample: { data: Uint8Array, dur, cto, sync }

  // The tracks of an init segment or a whole file's moov, without samples.
  function tracksOf(u8, moov) {
    const trex = new Map();
    const mvex = child(u8, moov, 'mvex');
    if (mvex) for (const t of children(u8, mvex, 'trex')) { const v = dv(u8); trex.set(v.getUint32(t.body + 4), { dur: v.getUint32(t.body + 12), size: v.getUint32(t.body + 16), flags: v.getUint32(t.body + 20) }); }
    return children(u8, moov, 'trak').map((trak) => {
      const v = dv(u8);
      const tkhd = child(u8, trak, 'tkhd'), mdia = child(u8, trak, 'mdia'), mdhd = child(u8, mdia, 'mdhd'), hdlr = child(u8, mdia, 'hdlr');
      const minf = child(u8, mdia, 'minf'), stbl = child(u8, minf, 'stbl');
      const id = v.getUint32(tkhd.body + (u8[tkhd.body] === 1 ? 20 : 12));
      const timescale = v.getUint32(mdhd.body + (u8[mdhd.body] === 1 ? 20 : 12));
      const head = child(u8, minf, 'vmhd') || child(u8, minf, 'smhd') || child(u8, minf, 'nmhd');
      return {
        id, timescale, handler: fourcc(u8, hdlr.body + 8), trex: trex.get(id) || { dur: 0, size: 0, flags: 0 },
        tkhd: slice(u8, tkhd), mdhd: slice(u8, mdhd), hdlr: slice(u8, hdlr), head: head && slice(u8, head),
        dinf: child(u8, minf, 'dinf') && slice(u8, child(u8, minf, 'dinf')), stsd: slice(u8, child(u8, stbl, 'stsd')), stbl, samples: [],
      };
    });
  }

  const isSync = (flags) => !(flags & 0x10000) && ((flags >>> 24) & 3) !== 1;

  // The samples of one fragment (moof + mdat bytes), added to the tracks.
  function addFragment(tracks, frag) {
    const v = dv(frag);
    const moof = boxes(frag).find((b) => b.type === 'moof');
    if (!moof) return;
    for (const traf of children(frag, moof, 'traf')) {
      const tfhd = child(frag, traf, 'tfhd');
      const tf = v.getUint32(tfhd.body) & 0xffffff, id = v.getUint32(tfhd.body + 4);
      const track = tracks.find((t) => t.id === id);
      if (!track) continue;
      let q = tfhd.body + 8, base = moof.start;
      if (tf & 0x01) { base = Number(v.getBigUint64(q)); q += 8; }
      if (tf & 0x02) q += 4;
      const defDur = tf & 0x08 ? v.getUint32((q += 4) - 4) : track.trex.dur;
      const defSize = tf & 0x10 ? v.getUint32((q += 4) - 4) : track.trex.size;
      const defFlags = tf & 0x20 ? v.getUint32((q += 4) - 4) : track.trex.flags;
      for (const trun of children(frag, traf, 'trun')) {
        const rf = v.getUint32(trun.body) & 0xffffff, n = v.getUint32(trun.body + 4);
        let r = trun.body + 8, offset = 0, first = null;
        if (rf & 0x01) { offset = v.getInt32(r); r += 4; }
        if (rf & 0x04) { first = v.getUint32(r); r += 4; }
        let at = base + offset;
        for (let i = 0; i < n; i++) {
          const dur = rf & 0x100 ? v.getUint32((r += 4) - 4) : defDur;
          const size = rf & 0x200 ? v.getUint32((r += 4) - 4) : defSize;
          let flags = rf & 0x400 ? v.getUint32((r += 4) - 4) : defFlags;
          const cto = rf & 0x800 ? v.getInt32((r += 4) - 4) : 0;
          if (i === 0 && first != null) flags = first;
          if (at + size > frag.length) throw new Error('fragment data is cut short');
          track.samples.push({ data: frag.subarray(at, at + size), dur, cto, sync: track.handler === 'vide' ? isSync(flags) : true });
          at += size;
        }
      }
    }
  }

  // Tracks with samples from an init segment and fragments (Uint8Arrays of moof + mdat).
  function fromFragments(init, fragments) {
    const moov = boxes(init).find((b) => b.type === 'moov');
    if (!moov) throw new Error('no init segment');
    const tracks = tracksOf(init, moov);
    for (const f of fragments) addFragment(tracks, f);
    return { ftyp: boxes(init).find((b) => b.type === 'ftyp'), init, tracks };
  }

  // Tracks with samples from an MP4 file: an ordinary one (written by toFile, or by any app), or a
  // fragmented one (what MediaRecorder and some apps write).
  function fromFile(u8) {
    const top = boxes(u8), moov = top.find((b) => b.type === 'moov');
    if (!moov) throw new Error('not an MP4 file');
    if (top.some((b) => b.type === 'moof')) {
      const init = join(top.filter((b) => b.type === 'ftyp' || b.type === 'moov').map((b) => slice(u8, b)));
      const frags = [];
      top.forEach((b, i) => { if (b.type === 'moof' && top[i + 1] && top[i + 1].type === 'mdat') frags.push(u8.subarray(b.start, top[i + 1].end)); });
      return fromFragments(init, frags);
    }
    const v = dv(u8);
    const tracks = tracksOf(u8, moov);
    for (const t of tracks) {
      const stbl = t.stbl, get = (type) => child(u8, stbl, type);
      const sizes = [], durs = [], ctos = [], syncs = new Set();
      const stsz = get('stsz'), fixed = v.getUint32(stsz.body + 4), count = v.getUint32(stsz.body + 8);
      for (let i = 0; i < count; i++) sizes.push(fixed || v.getUint32(stsz.body + 12 + i * 4));
      const stts = get('stts');
      for (let i = 0, n = v.getUint32(stts.body + 4); i < n; i++) { const c = v.getUint32(stts.body + 8 + i * 8), d = v.getUint32(stts.body + 12 + i * 8); for (let k = 0; k < c; k++) durs.push(d); }
      const ctts = get('ctts');
      if (ctts) for (let i = 0, n = v.getUint32(ctts.body + 4); i < n; i++) { const c = v.getUint32(ctts.body + 8 + i * 8), o = v.getInt32(ctts.body + 12 + i * 8); for (let k = 0; k < c; k++) ctos.push(o); }
      const stss = get('stss');
      if (stss) for (let i = 0, n = v.getUint32(stss.body + 4); i < n; i++) syncs.add(v.getUint32(stss.body + 8 + i * 4) - 1);
      const stco = get('stco') || get('co64'), wide = stco.type === 'co64';
      const chunks = [];
      for (let i = 0, n = v.getUint32(stco.body + 4); i < n; i++) chunks.push(wide ? Number(v.getBigUint64(stco.body + 8 + i * 8)) : v.getUint32(stco.body + 8 + i * 4));
      const stsc = get('stsc'), runs = [];
      for (let i = 0, n = v.getUint32(stsc.body + 4); i < n; i++) runs.push({ first: v.getUint32(stsc.body + 8 + i * 12) - 1, per: v.getUint32(stsc.body + 12 + i * 12) });
      let s = 0;
      for (let c = 0; c < chunks.length && s < count; c++) {
        const run = runs.filter((x) => x.first <= c).pop();
        let at = chunks[c];
        for (let k = 0; k < run.per && s < count; k++, s++) {
          t.samples.push({ data: u8.subarray(at, at + sizes[s]), dur: durs[s] || 0, cto: ctos[s] || 0, sync: t.handler === 'vide' ? (stss ? syncs.has(s) : true) : true });
          at += sizes[s];
        }
      }
    }
    return { ftyp: top.find((b) => b.type === 'ftyp'), init: u8, tracks };
  }

  /* ---------- writing ---------- */
  function box(type, ...parts) {
    const flat = parts.flat(Infinity).filter(Boolean);
    const size = 8 + flat.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(size), v = dv(out);
    v.setUint32(0, size);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    let p = 8;
    for (const part of flat) { out.set(part, p); p += part.length; }
    return out;
  }
  const u32 = (...xs) => { const b = new Uint8Array(xs.length * 4), v = dv(b); xs.forEach((x, i) => v.setUint32(i * 4, x >>> 0)); return b; };
  const full = (type, version, flags, ...parts) => box(type, u32(((version & 0xff) << 24) | (flags & 0xffffff)), ...parts);
  // a copy of a box (as bytes) with a version 0 / 1 duration field set
  function withDuration(bytes, off0, off1, dur) {
    const b = new Uint8Array(bytes), v = dv(b);
    if (b[8] === 1) v.setBigUint64(off1, BigInt(Math.round(dur))); else v.setUint32(off0, Math.min(0xffffffff, Math.round(dur)));
    return b;
  }
  const trackSeconds = (t) => t.samples.reduce((s, x) => s + x.dur, 0) / t.timescale;

  /**
   * An ordinary MP4 (ftyp, moov with the sample tables, mdat) from a model. Each track's samples
   * are written in runs of about half a second, interleaved, so playback reads forward.
   */
  function toFile(model) {
    const tracks = model.tracks.filter((t) => t.samples.length);
    if (!tracks.length) throw new Error('nothing to write');
    const MOVIE = 1000;
    const seconds = Math.max(...tracks.map(trackSeconds));
    // chunks: runs of samples, interleaved by time
    const runs = [];
    for (const t of tracks) {
      let at = 0, run = null;
      t.samples.forEach((s, i) => {
        if (!run || at - run.time >= t.timescale / 2) { run = { track: t, first: i, count: 0, time: at, sec: at / t.timescale }; runs.push(run); }
        run.count++;
        at += s.dur;
      });
    }
    runs.sort((a, b) => a.sec - b.sec || a.track.id - b.track.id);
    const dataSize = runs.reduce((s, r) => s + r.track.samples.slice(r.first, r.first + r.count).reduce((x, y) => x + y.data.length, 0), 0);
    const wide = dataSize > 0xfff00000;
    const build = (mdatStart) => {
      const offsets = new Map(tracks.map((t) => [t, []]));
      let at = mdatStart + (wide ? 16 : 8);
      for (const r of runs) { offsets.get(r.track).push({ at, per: r.count }); at += r.track.samples.slice(r.first, r.first + r.count).reduce((x, y) => x + y.data.length, 0); }
      const traks = tracks.map((t) => {
        const S = t.samples, dur = S.reduce((s, x) => s + x.dur, 0);
        const stts = [];
        for (const s of S) { const last = stts[stts.length - 1]; if (last && last[1] === s.dur) last[0]++; else stts.push([1, s.dur]); }
        const anyCto = S.some((s) => s.cto);
        const ctts = [];
        if (anyCto) for (const s of S) { const last = ctts[ctts.length - 1]; if (last && last[1] === s.cto) last[0]++; else ctts.push([1, s.cto]); }
        const syncs = S.map((s, i) => (s.sync ? i + 1 : 0)).filter(Boolean);
        const chunks = offsets.get(t);
        const stsc = [];
        chunks.forEach((c, i) => { const last = stsc[stsc.length - 1]; if (!last || last[1] !== c.per) stsc.push([i + 1, c.per, 1]); });
        const stbl = box('stbl', t.stsd,
          full('stts', 0, 0, u32(stts.length, ...stts.flat())),
          anyCto && full('ctts', 1, 0, u32(ctts.length, ...ctts.flat())),
          t.handler === 'vide' && syncs.length < S.length && full('stss', 0, 0, u32(syncs.length, ...syncs)),
          full('stsc', 0, 0, u32(stsc.length, ...stsc.flat())),
          full('stsz', 0, 0, u32(0, S.length, ...S.map((s) => s.data.length))),
          wide ? full('co64', 0, 0, u32(chunks.length), ...chunks.map((c) => { const b = new Uint8Array(8); dv(b).setBigUint64(0, BigInt(c.at)); return b; }))
            : full('stco', 0, 0, u32(chunks.length, ...chunks.map((c) => c.at))));
        const dinf = t.dinf || box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
        const head = t.head || (t.handler === 'vide' ? full('vmhd', 0, 1, new Uint8Array(8)) : full('smhd', 0, 0, new Uint8Array(4)));
        const tkhd = withDuration(t.tkhd, 28, 36, (dur / t.timescale) * MOVIE);
        tkhd[11] |= 3; // enabled, in the movie
        return box('trak', tkhd, box('mdia', withDuration(t.mdhd, 24, 32, dur), t.hdlr, box('minf', head, dinf, stbl)));
      });
      const mvhd = new Uint8Array(100), mv = dv(mvhd);
      mv.setUint32(12, MOVIE); mv.setUint32(16, Math.round(seconds * MOVIE)); mv.setUint32(20, 0x00010000); mv.setUint16(24, 0x0100);
      [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].forEach((x, i) => mv.setUint32(36 + i * 4, x));
      mv.setUint32(96, Math.max(...tracks.map((t) => t.id)) + 1);
      return box('moov', box('mvhd', mvhd), traks);
    };
    const ftyp = box('ftyp', u32(0x69736f6d, 0x200, 0x69736f6d, 0x69736f32, 0x61766331, 0x6d703431)); // isom; isom iso2 avc1 mp41
    // the moov's size does not depend on where mdat starts (same number of offsets), so build twice
    const moov = build(ftyp.length + build(0).length);
    const head = new Uint8Array(wide ? 16 : 8), hv = dv(head);
    if (wide) { hv.setUint32(0, 1); hv.setBigUint64(8, BigInt(dataSize + 16)); } else hv.setUint32(0, dataSize + 8);
    head.set([0x6d, 0x64, 0x61, 0x74], 4);
    const parts = [ftyp, moov, head];
    for (const r of runs) for (const s of r.track.samples.slice(r.first, r.first + r.count)) parts.push(s.data);
    return parts;
  }

  // One Uint8Array from toFile's parts (the page sends one buffer to the main process).
  function join(parts) {
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let p = 0;
    for (const part of parts) { out.set(part, p); p += part.length; }
    return out;
  }

  /**
   * The part of a model between two times (seconds), cut on video keyframes: it starts at the last
   * keyframe at or before `from`, so nothing has to be re-encoded. Audio is cut to the same span.
   */
  function cut(model, from, to) {
    const video = model.tracks.find((t) => t.handler === 'vide');
    let start = from, startTime = 0;
    if (video) {
      let at = 0, best = 0;
      for (const s of video.samples) { if (s.sync && at / video.timescale <= from + 1e-6) best = at; at += s.dur; }
      start = best / video.timescale;
    }
    startTime = start;
    const tracks = model.tracks.map((t) => {
      let at = 0;
      const samples = t.samples.filter((s) => { const sec = at / t.timescale; at += s.dur; return sec >= startTime - 1e-6 && sec < to; });
      return { ...t, samples };
    });
    return { ...model, tracks, start };
  }

  const duration = (model) => Math.max(0, ...model.tracks.filter((t) => t.samples.length).map(trackSeconds));

  /**
   * The last seconds of a live fragmented MP4 stream. push() takes the recorder's bytes as they
   * come; clip(seconds) returns an ordinary MP4 (bytes) of at least that long (when there is that
   * much), starting on a keyframe. Older fragments are dropped as new ones come in.
   */
  class Ring {
    constructor(keep = 60) { this.keep = keep; this.pending = new Uint8Array(0); this.init = null; this.frags = []; this.bytes = 0; }
    push(u8) {
      const joined = new Uint8Array(this.pending.length + u8.length);
      joined.set(this.pending); joined.set(u8, this.pending.length);
      const top = boxes(joined);
      let used = 0, moof = null;
      for (const b of top) {
        if (b.type === 'ftyp') { this.ftyp = joined.slice(b.start, b.end); used = b.end; } else if (b.type === 'moov') {
          this.init = join([this.ftyp || new Uint8Array(0), joined.slice(b.start, b.end)]);
          this.tracks = tracksOf(this.init, boxes(this.init).find((x) => x.type === 'moov'));
          this.frags = []; this.bytes = 0;
          used = b.end;
        } else if (b.type === 'moof') moof = b; else if (b.type === 'mdat' && moof) {
          this.add(joined.slice(moof.start, b.end));
          moof = null; used = b.end;
        } else if (!moof) used = b.end; // anything else between fragments
      }
      this.pending = joined.slice(used);
    }
    add(frag) {
      if (!this.tracks) return;
      const probe = this.tracks.map((t) => ({ ...t, samples: [] }));
      addFragment(probe, frag);
      const video = probe.find((t) => t.handler === 'vide');
      const v = dv(frag), moof = boxes(frag)[0];
      // when it starts: the video track's decode time in this fragment
      let time = this.frags.length ? this.frags[this.frags.length - 1].end : 0;
      for (const traf of children(frag, moof, 'traf')) {
        const tfhd = child(frag, traf, 'tfhd'), tfdt = child(frag, traf, 'tfdt'), id = v.getUint32(tfhd.body + 4);
        const t = this.tracks.find((x) => x.id === id);
        if (t && t.handler === 'vide' && tfdt) time = (frag[tfdt.body] === 1 ? Number(v.getBigUint64(tfdt.body + 4)) : v.getUint32(tfdt.body + 4)) / t.timescale;
      }
      const len = video ? video.samples.reduce((s, x) => s + x.dur, 0) / video.timescale : 0;
      this.frags.push({ bytes: frag, start: time, end: time + len, sync: !video || !video.samples.length || video.samples[0].sync });
      this.bytes += frag.length;
      // drop what is older than needed, keeping a keyframe to start from
      const latest = this.frags[this.frags.length - 1].end;
      while (this.frags.length > 1 && this.frags[1].start < latest - this.keep - 1 && this.frags.slice(1).some((f) => f.sync && f.start <= latest - this.keep)) {
        this.bytes -= this.frags.shift().bytes.length;
      }
    }
    // seconds held (from the first keyframe)
    get seconds() { const i = this.frags.findIndex((f) => f.sync); return i < 0 ? 0 : this.frags[this.frags.length - 1].end - this.frags[i].start; }
    clip(seconds) {
      if (!this.init || !this.frags.length) return null;
      const end = this.frags[this.frags.length - 1].end, want = end - seconds;
      let from = -1;
      for (let i = 0; i < this.frags.length; i++) if (this.frags[i].sync && (from < 0 || this.frags[i].start <= want)) from = i;
      if (from < 0) return null;
      const model = fromFragments(this.init, this.frags.slice(from).map((f) => f.bytes));
      return join(toFile(model));
    }
  }

  const api = { boxes, fromFragments, fromFile, toFile, join, cut, duration, Ring };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenWMp4 = api;
}(typeof window !== 'undefined' ? window : globalThis));
