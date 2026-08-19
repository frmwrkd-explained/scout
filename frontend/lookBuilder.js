// Look builder — the pure brain behind the composer's LOOK and CAMERA pickers.
//
// ProjectGenerate's composer no longer asks the user to type cinematography into the prompt.
// It parks two small serializable objects in React state — `style` and `camera` — and this
// module turns them into prompt text, into the short pills the composer renders, and back
// again from a preset or a saved style lock. Nothing here touches React, the DOM, or the
// network: the composer owns the state, this owns the grammar.
//
// The flow, end to end:
//   preset click  → applyPreset(id) → { style, camera, aspect } → setState (aspect drives the
//                   existing aspect control, so a preset can retune the frame in one gesture)
//   lock picked   → styleFromLock(lock) → a style whose `override` IS the lock fragment, which
//                   means a lock and a hand-picked look are the same shape downstream
//   token toggled → composer mutates style.picks / camera.picks directly and clears presetId
//   every render  → styleLabel/cameraLabel for the pills, styleFragment/cameraFragment for the
//                   live prompt preview and for the text appended at submit time
//
// The two axis groups are a deliberate split of the single AXES list in models.js: everything
// that describes the LOOK (film stock, light, grade, atmosphere) versus everything that
// describes the CAMERA (framing, body, glass). Same tokens, two pickers, so a user can swap the
// grade without losing the lens — the thing the old single-list PromptBuilder made impossible.
//
// Fragments produced here are USUALLY continuation clauses — no leading capital, no trailing
// period — because the caller appends them to the user's prompt. But two of them are not: a
// camera movement's catalog fragment is a run of imperative sentences aimed at video models, and
// a hand-edited or lock-imported override can be anything the user typed, up to and including a
// whole previous generation prompt. Comma-joining either of those produces
// '…flooded plaza, Dolly or push the entire camera forward. This is physical camera travel…',
// which reads as a splice and prompts as one. So the SEAM is not the caller's business any more:
// joinFragment/joinFragments below own it, and every consumer must route through them instead of
// doing its own `.join(', ')`.
// Explicit .js extensions: this module and the pure chain below it are imported by node (tests,
// and backend/*.mjs for the model catalog), which does not resolve extensionless specifiers the
// way the bundler does.
import { AXES, PRESETS } from './models.js';
import { CAMERA_MOVEMENTS, assembleMovePrompt } from './cameraMovements.js';

export const STYLE_AXIS_KEYS = ['style', 'look', 'filmstock', 'lightsource', 'lightstyle', 'atmosphere', 'filter'];
export const CAMERA_AXIS_KEYS = ['framing', 'camera', 'focal', 'lenstype'];

// Ordered by the KEY list, not by AXES order — the picker's reading order is a UX decision
// (what you reach for first), and it differs from the assembly order models.js uses.
const pickAxes = keys => keys.map(k => AXES.find(a => a.key === k)).filter(Boolean);
export const styleAxes = () => pickAxes(STYLE_AXIS_KEYS);
export const cameraAxes = () => pickAxes(CAMERA_AXIS_KEYS);

// `override` is tri-state and the distinction is load-bearing:
//   null    — no override; the fragment is derived from `picks`
//   ''      — the user emptied the fragment box on purpose: this style ships NOTHING
//   '…'     — that text, verbatim, instead of the picks
// `edited` says the override came from the fragment textarea rather than from a legacy lock's
// stored prose, which is the only thing that lets styleLabel tell "this IS the lock" apart from
// "this started as the lock and is now something else".
export const emptyStyle = () => ({ picks: {}, override: null, edited: false, presetId: null, lockId: null, lockName: null });
export const emptyCamera = () => ({ picks: {}, move: null, speed: 'normal', stabilization: 'smooth' });

// Preset 'Aspect Ratio' picks are catalog display names; the composer's aspect control only
// speaks the five ASPECTS strings. Anything outside that set maps to null = leave the user's
// current aspect alone rather than silently snapping it to something the control can't show.
const ASPECT_MAP = {
  '16:9 HD': '16:9',
  '2.39:1 Anamorphic': '2.39:1',
  '2.35:1 Scope': '2.39:1',
  '9:16 Vertical': '9:16',
  '1:1 Square': '1:1',
  '4:3 Academy': null,
  '1.85:1 Theatrical': null
};

// Everything below is called on every keystroke in the composer, so each entry point starts by
// assuming its argument is garbage. A throw here would blank the whole generate tab.
const asObj = v => (v && typeof v === 'object' ? v : null);
const picksOf = sel => (asObj(sel) && asObj(sel.picks)) || {};
const listOf = (picks, key) => (Array.isArray(picks[key]) ? picks[key] : []);

const axisByKey = key => AXES.find(a => a.key === key) || null;
const tokenOf = (key, name) => {
  const ax = axisByKey(key);
  if (!ax) return null;
  return ax.tokens.find(t => t.t === name) || null;
};

// Mirror of assemblePrompt()'s frag(): strip the trailing period so the caller's own grammar
// ('. ' / ', ') isn't doubled. Catalog fragments also carry hard newlines from the Airtable
// sync, so collapse whitespace on the way through.
const cleanFrag = f => String(f == null ? '' : f).replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();

// Same whitespace normalisation, but the terminal punctuation SURVIVES. Anything the user typed,
// or any catalog direction written as prose, keeps its final period — that period is the evidence
// joinFragment reads to decide whether the thing is a sentence or a clause. Only per-token axis
// fragments go through cleanFrag, because those are clause parts by construction.
const cleanText = f => String(f == null ? '' : f).replace(/\s+/g, ' ').trim();

// Comma-join across axes with no empty segments and no ', ,' seams.
const joinAxes = (picks, keys) => keys
  .flatMap(k => listOf(picks, k).map(name => cleanFrag((tokenOf(k, name) || {}).f)))
  .filter(Boolean)
  .join(', ')
  .replace(/\s*,\s*(,\s*)+/g, ', ')
  .replace(/^[\s,]+/, '')
  .trim();

// Does this fragment OPEN as prose rather than as a clause? Two signals, both required: it starts
// with a capital, and it terminates a sentence somewhere. A camera-movement direction does both
// ('Dolly or push the entire camera forward… This is physical camera travel, not a zoom.'), and
// so does a lock whose fragment was saved from an entire generation prompt.
//
// Both halves matter. 'A cinematic film still, dramatic composition' opens with a capital but
// never closes a sentence — it is a noun phrase and must keep comma-joining. And a camera clause
// that opens on the LENS ('85mm classic portrait lens… compression. Dolly or push…') is a clause
// at the seam even though it carries sentences later on, so it comma-joins onto the prompt and
// its own internal sentences take care of themselves. Only the head of the fragment decides.
export const isSentenceish = f => {
  const s = String(f == null ? '' : f);
  return /^["'“‘(\[]?[A-Z]/.test(s) && /[.!?]["'”’)\]]?(\s|$)/.test(s);
};

// THE seam. A continuation clause comma-joins; prose starts its own sentence. Every caller that
// appends one fragment to another — the composer's suffix, the stored lock prose, the lens/motion
// pair below — goes through here, so the rule lives in exactly one place instead of being
// re-guessed by each `.join(', ')` at the call site.
export function joinFragment(base, frag) {
  const a = String(base == null ? '' : base).replace(/[\s,]+$/, '').trim();
  const b = String(frag == null ? '' : frag).replace(/^[\s,]+/, '').trim();
  if (!a) return b;
  if (!b) return a;
  // A clause hanging off prose reads as a continuation of the last sentence, so the period that
  // would strand it ('…through the fog. 85mm portrait lens') comes off.
  if (!isSentenceish(b)) return a.replace(/[.!?]+$/, '') + ', ' + b;
  return /[.!?]["'”’)\]]?$/.test(a) ? a + ' ' + b : a + '. ' + b;
}
export const joinFragments = (...parts) => parts.reduce((acc, p) => joinFragment(acc, p), '');

export function styleFragment(style) {
  const s = asObj(style);
  if (!s) return '';
  // An override is either hand-edited text or a style lock's fragment. Either way the user has
  // spoken more recently than the token grid, so it wins outright — INCLUDING when they emptied
  // it. `''` is the user saying "no style clause", not "fall back to the picks I can still see
  // greyed out behind this box"; only `null` means fall back. Getting this wrong shipped the
  // whole preset the box claimed to have replaced.
  //
  // cleanText, not cleanFrag: a typed override may be whole sentences, and stripping its final
  // period is what made 'The camera drifts through the fog.' indistinguishable from a clause at
  // the seam — the difference between '…plaza. The camera drifts' and '…plaza, The camera drifts'.
  if (typeof s.override === 'string') return cleanText(s.override);
  return joinAxes(picksOf(s), STYLE_AXIS_KEYS);
}

export function cameraFragment(camera, opts) {
  const c = asObj(camera);
  if (!c) return '';
  const lens = joinAxes(picksOf(c), CAMERA_AXIS_KEYS);
  // A still frame has no motion — including a movement fragment on an image model just burns
  // tokens and confuses the composition, so the movement half is video-only.
  const video = !!(asObj(opts) && opts.video);
  const move = video && c.move ? CAMERA_MOVEMENTS.find(m => m.id === c.move) : null;
  // assembleMovePrompt already folds speed + stabilization in the right order and skips unknown
  // ids; we pass no subject/duration because the composer's prompt already carries the subject
  // and the model's own duration control owns the length.
  // cleanText keeps the direction's final period, which is what marks it as prose at the seam.
  const motion = move ? cleanText(assembleMovePrompt(move, { speed: c.speed, stabilization: c.stabilization })) : '';
  return joinFragment(lens, motion);
}

// Labels ride inside 24px pills, so they are ruthlessly short: two names max, then the overflow
// count. Priority order is "what identifies this look at a glance", not axis order.
const STYLE_LABEL_ORDER = ['look', 'style', 'lightsource', 'lightstyle', 'filmstock', 'atmosphere', 'filter'];
const CAMERA_LABEL_ORDER = ['focal', 'lenstype', 'framing', 'camera'];

const pill = names => {
  if (!names.length) return '';
  const head = names.slice(0, 2).join(' · ');
  return names.length > 2 ? head + ' +' + (names.length - 2) : head;
};
const orderedNames = (picks, order) => order.flatMap(k => listOf(picks, k));
const trunc = (t, n) => (t.length > n ? t.slice(0, n - 1).trim() + '…' : t);

export function styleLabel(style) {
  const s = asObj(style);
  if (!s) return 'No style';
  // An emptied override ships no style clause, whatever is still selected behind it. The pill is
  // a status line; claiming a preset here while sending nothing is the exact failure it exists
  // to prevent.
  if (typeof s.override === 'string' && !s.override.trim()) return 'No style';
  const preset = s.presetId ? (PRESETS.find(x => x.id === s.presetId) || {}).name : '';
  const base = preset || s.lockName || pill(orderedNames(picksOf(s), STYLE_LABEL_ORDER));
  // `edited` is set only by the fragment textarea, so a legacy lock — which also arrives as an
  // override — still gets its own name unqualified: that prose IS the lock, not an edit of it.
  if (s.edited && typeof s.override === 'string') {
    // The preset/lock/picks the edit started from no longer describe what will be sent, so they
    // survive as provenance only, with the qualifier that makes naming them honest. 24 chars plus
    // ' (edited)' is 33 — inside the same budget the plain-prose branch below already assumed.
    return base ? trunc(base, 24) + ' (edited)' : trunc(cleanFrag(s.override), 34);
  }
  if (base) return base;
  // Hand-typed text with nothing else to name it — show a truncated taste rather than claiming
  // there's no style at all.
  if (typeof s.override === 'string') return trunc(cleanFrag(s.override), 34);
  return 'No style';
}

export function cameraLabel(camera, opts) {
  const c = asObj(camera);
  if (!c) return 'Default camera';
  const names = orderedNames(picksOf(c), CAMERA_LABEL_ORDER);
  const video = !!(asObj(opts) && opts.video);
  const move = video && c.move ? CAMERA_MOVEMENTS.find(m => m.id === c.move) : null;
  if (move) names.push(move.name);
  return pill(names) || 'Default camera';
}

export function applyPreset(presetId) {
  const p = PRESETS.find(x => x.id === presetId);
  // Total by contract: an unknown id resets rather than throwing, so a stale presetId in a
  // restored project can never wedge the composer.
  if (!p) return { style: emptyStyle(), camera: emptyCamera(), aspect: null };
  const style = emptyStyle();
  const camera = emptyCamera();
  style.presetId = p.id;
  for (const [key, names] of Object.entries(p.pick || {})) {
    if (!Array.isArray(names) || !names.length) continue;
    if (STYLE_AXIS_KEYS.includes(key)) style.picks[key] = names.slice();
    else if (CAMERA_AXIS_KEYS.includes(key)) camera.picks[key] = names.slice();
    // 'aspect' falls through on purpose — it leaves the axis system and becomes a control value.
  }
  const aspectName = (p.pick && p.pick.aspect && p.pick.aspect[0]) || null;
  const aspect = aspectName && Object.prototype.hasOwnProperty.call(ASPECT_MAP, aspectName) ? ASPECT_MAP[aspectName] : null;
  return { style, camera, aspect };
}

// A style saved from the builder carries the picks it was built from, so loading it puts the
// axis grid back exactly as the user left it — the whole point of building styles in the
// builder. Only a legacy lock, or one imported from a bare item prompt, has no picks; that one
// still degrades to opaque `override` prose, which is all it ever had.
export function styleFromLock(lock) {
  const l = asObj(lock);
  if (!l) return emptyStyle();
  const picks = clonePicks(asObj(l.picks) || {});
  // "Was this built on the axes?" — count only REAL selections. The `aspect` entry riding along
  // in picks is an inert round-trip carry (see splitFlatPicks), and a lock carrying nothing but
  // that is still legacy prose. Camera-only styles count too: their lens comes back via
  // cameraFromLock, so the fragment must NOT also land in override or the lens is said twice.
  const structured = STYLE_AXIS_KEYS.some(k => (picks[k] || []).length) || countPicks(cameraFromLock(l)) > 0;
  if (structured) {
    return {
      picks,
      // The saved fragment is regenerated from the picks on every render, so keeping it as an
      // override here would freeze the style at save time and make the grid's edits inert.
      override: null,
      edited: false,
      presetId: l.presetId || null,
      lockId: l.id || null,
      lockName: l.name || null
    };
  }
  // edited:false on purpose — this prose IS the lock, so the pill shows the lock's name plain.
  // Only the fragment textarea sets edited, and only then does the name pick up '(edited)'.
  return { picks: {}, override: l.fragment || null, edited: false, presetId: null, lockId: l.id || null, lockName: l.name || null };
}

// The camera half of a saved style. Absent on legacy locks and on styles that say nothing about
// the camera — both mean "leave the composer's current camera alone", hence null rather than
// emptyCamera(), so the caller can tell the two apart.
export function cameraFromLock(lock) {
  const l = asObj(lock);
  const c = l && asObj(l.camera);
  if (!c) return null;
  return {
    picks: clonePicks(asObj(c.picks) || {}),
    move: c.move || null,
    speed: c.speed || 'normal',
    stabilization: c.stabilization || 'smooth'
  };
}

// The whole look as ONE continuation clause — the look half plus the lens half.
//
// video:false on purpose: a camera MOVE is video-only and is re-derived from the persisted
// camera.move at generate time, so baking it into the stored prose would double it up.
export function fullFragment(style, camera) {
  return joinFragments(styleFragment(style), cameraFragment(camera, { video: false }));
}

// The inverse of styleFromLock/cameraFromLock — everything the server needs to reconstruct this
// composition later, alongside the assembled fragment.
//
// `fragment` spans style AND camera because every consumer of it wants the whole look: the
// clipboard, ShotWorkspace's manual append, the card excerpts, and the fallback path for a lock
// that has no picks. The composer never reads it — it rebuilds the clause from picks on every
// render — so a fragment that includes the lens cannot double-append there.
export function lockPayload(style, camera, aspect) {
  const s = asObj(style) || {};
  const c = asObj(camera);
  return {
    fragment: fullFragment(style, camera),
    picks: clonePicks(picksOf(s)),
    camera: c ? { picks: clonePicks(picksOf(c)), move: c.move || null, speed: c.speed || 'normal', stabilization: c.stabilization || 'smooth' } : null,
    aspect: aspect || null,
    presetId: s.presetId || null
  };
}

// picks arrays are handed straight into React state and spread on every toggle — a shallow copy
// would alias the caller's arrays across the save/load boundary.
const clonePicks = p => Object.fromEntries(Object.entries(asObj(p) || {}).map(([k, v]) => [k, (Array.isArray(v) ? v : []).slice()]));

// ── the two shapes of the same selection ──
// The prompt builder edits all 12 axes as ONE flat map. The composer edits them as style +
// camera, with aspect promoted to a control. Same axis keys, two shapes — these convert between
// them, which is what lets a style built in either surface open in the other.
//
// The `aspect` axis rides along inside `picks` untouched: it is in neither STYLE_AXIS_KEYS nor
// CAMERA_AXIS_KEYS, so styleFragment/cameraFragment ignore it and no picker renders it, but it
// survives a save/load round-trip so the prompt builder gets its selection back verbatim. The
// separate `aspect` FIELD on a style is the mapped composer value ('2.39:1'), which is what the
// frame-shape control actually speaks.
export function splitFlatPicks(flat) {
  const p = asObj(flat) || {};
  const style = emptyStyle();
  const camera = emptyCamera();
  for (const [k, names] of Object.entries(p)) {
    if (!Array.isArray(names) || !names.length) continue;
    if (STYLE_AXIS_KEYS.includes(k)) style.picks[k] = names.slice();
    else if (CAMERA_AXIS_KEYS.includes(k)) camera.picks[k] = names.slice();
    else if (k === 'aspect') style.picks.aspect = names.slice(); // inert, carried for round-trip
  }
  const aspectName = (p.aspect || [])[0] || null;
  const aspect = aspectName && Object.prototype.hasOwnProperty.call(ASPECT_MAP, aspectName) ? ASPECT_MAP[aspectName] : null;
  return { style, camera, aspect };
}

export function mergeToFlatPicks(style, camera) {
  const out = {};
  for (const [k, v] of Object.entries(picksOf(style))) if (Array.isArray(v) && v.length) out[k] = v.slice();
  for (const [k, v] of Object.entries(picksOf(camera))) if (Array.isArray(v) && v.length) out[k] = v.slice();
  return out;
}

// "Does this contribute anything to the prompt?" — must agree with styleFragment or the composer
// lights a pill for a style that ships nothing. An override of any kind is the whole answer, so
// an emptied one makes the style empty no matter what is still selected behind it.
export function isStyleEmpty(style) {
  const s = asObj(style);
  if (!s) return true;
  if (typeof s.override === 'string') return !s.override.trim();
  return countPicks(s) === 0;
}

// A movement counts: a camera with nothing but `move: 'push-in'` still writes a whole paragraph
// of direction into a video prompt.
export function isCameraEmpty(camera) {
  const c = asObj(camera);
  if (!c) return true;
  return !c.move && countPicks(c) === 0;
}

// Accepts either a selection object ({picks:…}) or a bare picks map, because the composer's
// per-axis rows sometimes hold only the map.
export function countPicks(sel) {
  const o = asObj(sel);
  if (!o) return 0;
  const picks = asObj(o.picks) || o;
  return Object.values(picks).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
}

// One line per preset, written to describe what the frame LOOKS like — the card shows the
// preview image, so the blurb's job is to name the thing the eye can't infer from a thumbnail.
const BLURBS = {
  br2049: 'Anamorphic scope, neon in fog, cold shadows.',
  goldenhour: 'Backlit skin, warm haze, 85mm falloff.',
  noir: 'Hard black-and-white, venetian shadow, grain.',
  cyberpunk: 'Wet neon, tungsten spill, rain on the lens.',
  verite: 'Handheld 16mm, flat daylight, honest grain.',
  anderson: 'Flat symmetry, pastel walls, soft window light.',
  mythic: 'Painterly firelight, deep shadow, epic scale.'
};

// Preview jpgs are bundled under public/preset-previews/. Every current PRESETS id has one; if a
// preset is added without an image the UI still gets a path, so the <img> needs an onError
// fallback rather than trusting this to always resolve.
//
// `aspect` is baked in here rather than left to the card renderer: reading it meant calling
// applyPreset(p.id) — which rebuilds two selection objects and walks the whole pick map — once
// per card on every render of the library grid, purely to read one string that can never change.
export const LOOK_PRESETS = PRESETS.map(p => ({
  id: p.id,
  name: p.name,
  pick: p.pick,
  aspect: applyPreset(p.id).aspect,
  img: '/preset-previews/' + p.id + '.jpg',
  blurb: BLURBS[p.id] || ''
}));
