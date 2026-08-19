// Frame math for the Reel (the animatic). THE one place a second becomes a frame.
//
// Two rules this module exists to enforce:
//   1. Time is an INTEGER FRAME COUNT everywhere downstream. Seconds are an input and a display
//      format, never a stored value. Floats accumulate; frames do not.
//   2. Drop-frame is a property of the RATE, not a user choice. `dfLegal` is read by the
//      serialisers rather than decided by them — emitting <ntsc>TRUE</ntsc> at timebase 25, or a
//      DF display format at 23.976, produces a file Premiere imports as an empty sequence with
//      no error message. DF is legal at 30000/1001 and 60000/1001 and nowhere else.
//
// Lives in shared/ because the timeline ruler and the export serialiser must agree exactly;
// shared/integrations.mjs:5-7 calls the backend→frontend/modelCatalog.js import a wart, and new
// cross-cutting data does not get to repeat it.

// Each rate carries everything both serialisers need, so neither has to derive it.
//   num/den      — the exact rational rate. 23.976 is 24000/1001, never 23.976.
//   nominal      — the integer timecode counts at (23.976 counts at 24). Also the xmeml timebase.
//   ntsc         — xmeml's <ntsc> flag: TRUE for the /1001 rates.
//   dfLegal      — may this rate use drop-frame at all.
//   frameDuration— FCPXML's rational tick, e.g. '1001/24000s'.
export const RATES = [
  { id: '23.976', label: '23.976', num: 24000, den: 1001, nominal: 24, ntsc: true,  dfLegal: false, frameDuration: '1001/24000s' },
  { id: '24',     label: '24',     num: 24,    den: 1,    nominal: 24, ntsc: false, dfLegal: false, frameDuration: '1/24s' },
  { id: '25',     label: '25',     num: 25,    den: 1,    nominal: 25, ntsc: false, dfLegal: false, frameDuration: '1/25s' },
  { id: '29.97',  label: '29.97',  num: 30000, den: 1001, nominal: 30, ntsc: true,  dfLegal: true,  frameDuration: '1001/30000s' },
  { id: '30',     label: '30',     num: 30,    den: 1,    nominal: 30, ntsc: false, dfLegal: false, frameDuration: '1/30s' },
  { id: '50',     label: '50',     num: 50,    den: 1,    nominal: 50, ntsc: false, dfLegal: false, frameDuration: '1/50s' },
  { id: '59.94',  label: '59.94',  num: 60000, den: 1001, nominal: 60, ntsc: true,  dfLegal: true,  frameDuration: '1001/60000s' },
  { id: '60',     label: '60',     num: 60,    den: 1,    nominal: 60, ntsc: false, dfLegal: false, frameDuration: '1/60s' }
];

export const DEFAULT_RATE = '24';

// Resolve a rate from an id ('23.976'), a stored { fpsNum, fpsDen } pair, or a bare number.
// Never throws — an unrecognised rate falls back to 24 rather than producing NaN frame counts
// that would serialise into an XML no NLE can open.
export function rateOf(x) {
  if (!x && x !== 0) return byId(DEFAULT_RATE);
  if (typeof x === 'object') {
    // IDEMPOTENT: an already-resolved rate carries num/den/nominal, not fpsNum/fpsDen. Without
    // this branch, rateOf(rateOf(x)) silently returns the 24fps default — which meant every
    // helper taking a rate object (secs, tcStr, rationalStr) computed a 25 or 29.97 reel at 24.
    if (Number.isFinite(x.num) && Number.isFinite(x.den) && x.nominal) {
      return RATES.find(r => r.num === x.num && r.den === x.den) || byId(DEFAULT_RATE);
    }
    const { fpsNum, fpsDen } = x;
    const hit = RATES.find(r => r.num === Number(fpsNum) && r.den === Number(fpsDen));
    return hit || byId(DEFAULT_RATE);
  }
  const s = String(x);
  const hit = RATES.find(r => r.id === s || r.label === s);
  if (hit) return hit;
  const n = Number(x);
  if (Number.isFinite(n)) {
    // tolerate a bare 23.98 / 29.97 / integer fps
    const near = RATES.find(r => Math.abs(r.num / r.den - n) < 0.01);
    if (near) return near;
  }
  return byId(DEFAULT_RATE);
}
const byId = id => RATES.find(r => r.id === id);

export const fpsOf = rate => rate.num / rate.den;

// seconds → integer frames. The ONLY conversion in the codebase.
// 4s is 96 frames at both 24 and 23.976 — which is the point: the animatic is authored in whole
// frames of intent, and the /1001 rates just play them fractionally slower.
export function framesFor(seconds, rate) {
  const r = rateOf(rate);
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.round(n * fpsOf(r)));
}

// frames → seconds, for display and for ffmpeg (which wants a decimal duration).
export function secs(frames, rate) {
  const r = rateOf(rate);
  return (Number(frames) || 0) / fpsOf(r);
}

// frames → 'HH:MM:SS:FF'. Drop-frame uses ';' before the frames field, per convention.
// The NDF path counts at the NOMINAL rate: 23.976 timecode runs at 24 and simply drifts against
// wall-clock, which is correct and is what every NLE does.
export function tcStr(frames, rate, { drop = false } = {}) {
  const r = rateOf(rate);
  const useDrop = drop && r.dfLegal;
  const fps = r.nominal;
  let f = Math.max(0, Math.floor(Number(frames) || 0));

  if (useDrop) {
    // Duncan's algorithm. dropFrames is the count skipped at each minute boundary: 2 at 29.97,
    // 4 at 59.94 — i.e. two per 30fps of nominal rate.
    const dropFrames = Math.round(fpsOf(r) * 0.066666);
    const framesPer10Min = fps * 60 * 10 - dropFrames * 9;
    const framesPerMin = fps * 60 - dropFrames;
    const d = Math.floor(f / framesPer10Min);
    const m = f % framesPer10Min;
    f = m > dropFrames
      ? f + dropFrames * 9 * d + dropFrames * Math.floor((m - dropFrames) / framesPerMin)
      : f + dropFrames * 9 * d;
  }

  const ff = f % fps;
  const ss = Math.floor(f / fps) % 60;
  const mm = Math.floor(f / (fps * 60)) % 60;
  const hh = Math.floor(f / (fps * 3600)) % 24;
  const p = n => String(n).padStart(2, '0');
  return p(hh) + ':' + p(mm) + ':' + p(ss) + (useDrop ? ';' : ':') + p(ff);
}

// frames → FCPXML rational time, e.g. 96 frames at 23.976 → '96096/24000s'.
// FCPXML rejects decimal seconds in these attributes; the value must be an exact rational whose
// denominator is the timebase, or Final Cut silently reinterprets the duration.
export function rationalStr(frames, rate) {
  const r = rateOf(rate);
  const f = Math.max(0, Math.floor(Number(frames) || 0));
  if (f === 0) return '0s';
  return `${f * r.den}/${r.num}s`;
}

// Human runtime, e.g. '10.29s' or '1:30.4'. Display only — never round-trips.
export function humanDur(frames, rate) {
  const s = secs(frames, rate);
  if (s < 60) return s.toFixed(2) + 's';
  const m = Math.floor(s / 60);
  return m + ':' + (s - m * 60).toFixed(1).padStart(4, '0');
}
