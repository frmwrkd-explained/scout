// Reel playback: the clock and the bitmap cache. Pure JS, no React, no DOM beyond createImageBitmap
// — so the frame math is unit-testable and the engine can be reasoned about on its own.
//
// THE FAILURE MODE THIS IS DESIGNED AGAINST: a visible hitch at the exact moment of a cut — the one
// frame where the eye is already looking. Everything below follows from that.
//
// The clock is DERIVED, never accumulated. `frame` is a pure function of a monotonic timestamp, so
// a dropped rAF tick, a GC pause, or a 120Hz ProMotion display changes how OFTEN we sample, never
// WHERE we land. Accumulated error over a two-minute reel is exactly zero by construction. There is
// no mutable currentFrame anywhere.

// Cumulative start frames → binary search, so a 200-shot reel costs log2(200) per frame, not 200.
export function cumulative(clips) {
  const out = new Array(clips.length);
  let n = 0;
  for (let i = 0; i < clips.length; i++) { out[i] = n; n += clips[i].frames; }
  return out;
}

// Which clip is playing at `frame`. Returns the index, or -1 for an empty reel.
export function clipAt(cum, clips, frame) {
  if (!clips.length) return -1;
  let lo = 0, hi = clips.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= frame) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export const totalFrames = clips => clips.reduce((a, c) => a + c.frames, 0);

// ── bitmap cache ─────────────────────────────────────────────────────────────────────────────
// Budgeted in PIXELS, not entries: a 1280-wide resize is ~3.7MB and a full 1080p one 8.3MB, so an
// entry count is a meaningless budget. `.close()` on eviction is MANDATORY — ImageBitmaps are not
// promptly garbage collected and leaking them is how a renderer reaches gigabytes.
export function createBitmapCache({ maxPixels = 40 * 1280 * 720, resizeWidth = 1280 } = {}) {
  const map = new Map();          // url → { bmp, px }
  const pending = new Map();      // url → Promise
  let px = 0;

  function evictTo(limit, keep) {
    // Map preserves insertion order, and `touch` re-inserts, so the first key is the LRU.
    for (const k of map.keys()) {
      if (px <= limit) break;
      if (keep && keep.has(k)) continue;
      const e = map.get(k);
      try { e.bmp.close(); } catch { /* already closed */ }
      px -= e.px;
      map.delete(k);
    }
  }

  return {
    get(url) {
      const e = map.get(url);
      if (!e) return null;
      map.delete(url); map.set(url, e);   // touch: move to the MRU end
      return e.bmp;
    },
    has: url => map.has(url),
    // Decode once per SHOT (every 1–4 seconds), never per frame, so the per-frame budget is
    // untouched. Concurrent calls for the same url share one decode.
    async load(url, keep) {
      if (map.has(url)) return this.get(url);
      if (pending.has(url)) return pending.get(url);
      const p = (async () => {
        const res = await fetch(url);
        const blob = await res.blob();
        // resizeWidth caps memory; 'high' keeps a still readable when it fills the stage.
        const bmp = await createImageBitmap(blob, { resizeWidth, resizeQuality: 'high' });
        const cost = bmp.width * bmp.height;
        map.set(url, { bmp, px: cost });
        px += cost;
        evictTo(maxPixels, keep);
        return bmp;
      })().finally(() => pending.delete(url));
      pending.set(url, p);
      return p;
    },
    stats: () => ({ entries: map.size, pixels: px }),
    clear() {
      for (const e of map.values()) { try { e.bmp.close(); } catch { /* already closed */ } }
      map.clear(); px = 0;
    }
  };
}

// ── the engine ───────────────────────────────────────────────────────────────────────────────
// rAF is the PACER, never the clock. We use the `timestamp` argument the callback receives rather
// than performance.now() inside the body, because the argument is the frame's presentation time
// and now() is whenever this callback happened to run.
export function createEngine({ clips, fps, onFrame, raf, now }) {
  const _raf = raf || (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null);
  const _caf = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : () => {};
  const _now = now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));

  let cum = cumulative(clips);
  let total = totalFrames(clips);
  let playing = false;
  let offset = 0;        // frames elapsed when we last stopped/seeked
  let startedAt = 0;     // wall time at play()
  let handle = null;
  let loop = true;
  let range = null;      // [inFrame, outFrame) — the loop range, or null for the whole reel

  const lo = () => (range ? range[0] : 0);
  const hi = () => (range ? range[1] : total);

  function frameNow(t) {
    if (!playing) return offset;
    const elapsed = ((t ?? _now()) - startedAt) / 1000 * fps;
    let f = offset + elapsed;
    const a = lo(), b = hi();
    const span = Math.max(1, b - a);
    if (f >= b) {
      if (loop) f = a + ((f - a) % span);
      else { f = b; }
    }
    return f;
  }

  function tick(t) {
    handle = null;
    if (!playing) return;
    // The reschedule is in a finally-style tail, and onFrame is wrapped, because a THROWN DRAW
    // kills the loop otherwise: the exception escapes before `handle = _raf(tick)` runs, so
    // playback stops forever while `playing` stays true and the derived clock keeps advancing —
    // the playhead appears frozen but the reel believes it is playing. A bad frame must cost one
    // frame, not the session.
    try {
      const f = frameNow(t);
      if (!loop && f >= hi()) {
        // Park ON the end. Setting `playing = false` without moving `offset` would leave the
        // playhead reporting wherever it was last seeked to, not where playback actually stopped.
        offset = Math.min(total, hi());
        playing = false;
        onFrame(Math.min(total - 1, Math.floor(hi())), true);
        return;
      }
      // NEVER await inside the callback: a missing bitmap draws the previous frame (invisible), a
      // stalled loop is not.
      onFrame(Math.max(0, Math.min(total - 1, Math.floor(f))), false);
    } catch (err) {
      if (typeof console !== 'undefined') console.error('reel: draw failed on one frame', err);
    }
    if (playing) handle = _raf(tick);
  }

  const api = {
    play() {
      if (!total) return;
      if (offset >= hi() - 1) offset = lo();   // replay from the top rather than sitting at the end
      // Self-heal: if we already believe we are playing but nothing is scheduled, re-arm rather
      // than early-returning into a permanently frozen playhead.
      if (playing) { if (handle == null) handle = _raf(tick); return; }
      playing = true;
      startedAt = _now();
      if (handle != null) _caf(handle);
      handle = _raf(tick);
    },
    pause() {
      if (!playing) return;
      offset = frameNow();
      playing = false;
      if (handle != null) _caf(handle);
      handle = null;
    },
    toggle() { playing ? api.pause() : api.play(); },
    get playing() { return playing; },
    get frame() { return Math.max(0, Math.min(total - 1, Math.floor(frameNow()))); },
    get total() { return total; },
    seek(f) {
      offset = Math.max(0, Math.min(total, f));
      // Re-baseline so the derived clock stays exact across a seek mid-playback.
      if (playing) startedAt = _now();
      onFrame(Math.max(0, Math.min(total - 1, Math.floor(offset))), false);
    },
    step(n) { api.seek(api.frame + n); },
    setLoop(v) { loop = !!v; },
    get looping() { return loop; },
    setRange(r) { range = r && r[1] > r[0] ? r : null; },
    get range() { return range; },
    // Re-derive after the reel changed (a retime, a new shot) WITHOUT losing the playhead.
    setClips(next) {
      const f = api.frame;
      clips = next; cum = cumulative(clips); total = totalFrames(clips);
      if (range) range = [Math.min(range[0], total), Math.min(range[1], total)];
      offset = Math.max(0, Math.min(total, f));
      if (playing) startedAt = _now();
    },
    clipIndex: f => clipAt(cum, clips, f),
    startOf: i => cum[i] ?? 0,
    // rAF stops entirely in a hidden or occluded Electron window, so a visibility change must
    // recompute from the clock rather than assume the loop kept ticking.
    resync() { if (playing) { offset = frameNow(); startedAt = _now(); } },
    destroy() { playing = false; if (handle != null) _caf(handle); handle = null; }
  };
  return api;
}
