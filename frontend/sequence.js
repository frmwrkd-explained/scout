// DEV-133 — the SHOT LIST: a structured way to write, read and navigate one video prompt.
//
// PURE MODULE. No React, no DOM. The clock maths and the prompt compilation are the load-bearing
// parts, so they live here and are unit-tested directly (tests/phase-sequence.test.mjs).
//
// ── WHAT THE CLOCK IS, AND WHAT IT IS NOT ───────────────────────────────────────────────────────
// The timecodes this module produces are PROMPT TEXT. They are how a segmented video prompt is
// written — `SEGMENT 3 — HER, BIG CLOSE (5.2s–7.6s)` — and, more to the point, how a human reads
// one back and finds the beat they want to change. They are NOT the model's `duration` parameter
// and they do not have to be a legal value of it.
//
// That distinction is why the builder is not gated on the model declaring a duration field. The old
// gate was right for what the old feature was (a duration picker) and wrong for what this is (a
// prompt editor): it hid the whole authoring surface on any model whose fal spec had not been
// synced, which is most of them.
//
// The duration PARAMETER is still schema-only. `durationField`, `durationChoices` and
// `durationParam` are the only source of a sendable duration (backend/modelSchemas.mjs). `fitTo` is
// how an authored clock snaps onto one of those legal values. When a model has none, nothing is
// sent — the timecodes still ship, because they are words in the prompt like any other words.
//
// ── FRAMES, NOT FLOATS ──────────────────────────────────────────────────────────────────────────
// shared/timecode.mjs is THE place a second becomes a frame in this repo. A shot stores an integer
// FRAME COUNT and seconds are a display format. Beats run under a second all the time — a 10-frame
// flash cut is 0.4s at 24 — and three of those authored as floats do not add up to the number
// printed on the total. Authored as frames they always do.
//
// ── WHAT THIS MODULE DOES NOT OWN ───────────────────────────────────────────────────────────────
// Style, look, film stock, grade, atmosphere: none of it. The composer already owns the whole look
// through frontend/lookBuilder.js and its ✦ picker, and that fragment is composed into the prompt at
// generate time. A STYLE block here would be a second place to say the same thing.
//
// Camera angle and camera move ARE per shot, so they live on a shot — but they are still not
// declared here. The angle vocabulary is the `framing` axis in frontend/models.js and the movement
// vocabulary is frontend/cameraMovements.js. This module reads both and never restates either.

import { rateOf, fpsOf, framesFor, secs } from '../shared/timecode.mjs';
import { AXES } from './models.js';
import { CAMERA_MOVEMENTS } from './cameraMovements.js';

// ── the duration PARAMETER — schema only, never a table here ────────────────────────────────────
// CLAUDE.md's hard rule, and the reason the pre-DEV-133 picker was deleted: it offered 4/6/8/10s for
// every model, no route ever sent it, and kie/kling-2.6's minimum is 5s — "a lie the UI told the
// user". Everything below reads the model's own normalized schema.

// FAL spells this several ways across endpoints; these are the names seen in synced specs. A model
// whose duration is expressed some other way won't match and no duration is sent — failing closed is
// right, because guessing wrong sends a parameter the endpoint rejects.
const DURATION_NAMES = ['duration', 'duration_seconds', 'durationSeconds', 'video_length', 'length'];

export function durationField(schema) {
  const fields = (schema && schema.fields) || [];
  return fields.find(f => DURATION_NAMES.includes(f.name)) || null;
}

// The totals a model actually accepts, as numbers, ascending.
//   enum    → its options, numeric ones only ("5s" and "5" both parse)
//   numeric → min..max walked by step (default 1), capped so a 0..600 range is not 600 chips
export function durationChoices(field) {
  if (!field) return [];
  if (field.type === 'enum' && Array.isArray(field.options)) {
    return field.options.map(o => parseFloat(String(o))).filter(n => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
  }
  if (field.type === 'integer' || field.type === 'number') {
    const min = Number.isFinite(field.min) ? field.min : null;
    const max = Number.isFinite(field.max) ? field.max : null;
    if (min == null || max == null || max <= min) return [];
    const step = Number.isFinite(field.step) && field.step > 0 ? field.step : 1;
    const out = [];
    for (let v = min; v <= max + 1e-9 && out.length < 24; v += step) out.push(Math.round(v * 100) / 100);
    return out;
  }
  return [];
}

// Kept for callers that want to know "does this model let the user choose a length at all". It is
// NOT the gate on the shot list — see the header.
export function supportsSequence(schema) { return durationChoices(durationField(schema)).length > 1; }

// The value actually sent: an enum field must receive one of ITS strings, not a number we invented,
// so the original option is handed back verbatim.
export function durationParam(field, total) {
  if (!field) return null;
  if (field.type === 'enum' && Array.isArray(field.options)) {
    const hit = field.options.find(o => parseFloat(String(o)) === total);
    return hit === undefined ? null : { [field.name]: hit };
  }
  return { [field.name]: total };
}

// The legal total nearest an authored one, or null when the model offers no choice. The UI shows
// this so the gap between "what I wrote" and "what the endpoint will run" is never silent.
export function nearestChoice(choices, seconds) {
  if (!choices || !choices.length) return null;
  return choices.reduce((best, c) => (Math.abs(c - seconds) < Math.abs(best - seconds) ? c : best), choices[0]);
}

// ── the two per-shot vocabularies, read from where they already live ────────────────────────────
// What changes shot to shot is the ANGLE and the MOVE. The lens does not, and neither does the
// stock, the grade or the light: those are the clip's look, they are picked once in the composer's
// ✦ picker (frontend/lookBuilder.js), and a per-shot copy of them would be a second source of truth
// for the same fragment as well as a lie about how a scene is actually shot.
export const ANGLES = () => (AXES.find(a => a.key === 'framing') || { tokens: [] }).tokens;
export const angleToken = name => ANGLES().find(t => t.t === name) || null;
export const moveById = id => CAMERA_MOVEMENTS.find(m => m.id === id) || null;

// A shot gets the movement's SHORT form — `directionLabel`, e.g. "camera moves toward subject" — not
// its `promptFragment`. The fragment is a four-sentence paragraph written for a whole clip; six of
// them stacked in one prompt is six paragraphs of camera boilerplate drowning the six lines that
// describe the film. The composer still sends the full fragment for the clip-level move.
export const moveClause = id => { const m = moveById(id); return m ? m.directionLabel : ''; };

// The quick sets — what a director reaches for constantly, with the full library one click behind
// them. Declared HERE and imported by the composer's ✦ picker rather than the other way round, so
// the shot list and the clip-level picker offer the same angles and moves instead of drifting into
// two opinions about what "quick" means.
export const QUICK_ANGLES = ['Wide', 'Medium', 'Close-up', 'Over-shoulder', 'Low-angle power', 'Top-down geometry'];
export const QUICK_MOVES = ['static', 'push-in', 'pull-out', 'pan-left', 'pan-right', 'arc-clockwise', 'boom-up'];

// ── camera wording ──────────────────────────────────────────────────────────────────────────────
// THE line that ships in the prompt as `LENS:`, DERIVED from the angle and the move.
//
// It is derived rather than typed because presenting it as a third always-visible field made people
// think it was a third thing they had to fill in. Picking an angle and a move writes it; the user
// never has to look at it. But a hand-typed line is always as valid — see `lensEdited`, which is
// what stops a later picker change silently overwriting somebody's own words.
export function composeLens(angle, move) {
  const a = angle ? ((angleToken(angle) || {}).f || angle) : '';
  return [a, moveClause(move)].filter(Boolean).join(', ');
}

// How a shot hands to the next. `cutAfter` is stored ON the shot rather than between shots so that
// reordering and deleting carry the cut along with it. Absent on the final shot, always.
export const CUT_OPTIONS = ['HARD CUT.', 'MATCH CUT.', 'SMASH CUT.', 'CUT ON MOVEMENT.'];
export const DEFAULT_CUT = CUT_OPTIONS[0];

// ── the shot list document ──────────────────────────────────────────────────────────────────────
export const DEFAULT_LANGUAGE = 'English';

// Appended automatically whenever acting is on, and never authored. It is the anti-glassy-stare
// safety block: models render dead unblinking eyes without it, and it is the same paragraph every
// time, so asking a user to type it would be asking them to type boilerplate.
export const MICRO_BEHAVIOUR =
  'Every face stays alive: natural blink cadence, visible breath, a working throat, wet eyes with a '
  + 'real catchlight, and small asymmetric movements of brow, jaw and mouth. Reactions arrive a '
  + 'quarter second late, never instantly. Eyes are always focused on something specific, never vacant.';

// A shot's floor and ceiling.
//
// SIX FRAMES (a quarter second at 24) is the shortest beat a model renders as a readable shot, and
// it is also the floor a drag has to feel right against: a floor of one or two frames means the last
// pixels of a drag do nothing visible. Thirty seconds is past every current single-clip ceiling.
export const minFrames = rate => Math.max(1, Math.round(fpsOf(rateOf(rate)) / 4));
export const maxFrames = rate => Math.round(fpsOf(rateOf(rate)) * 30);

export const blankShot = frames => ({
  label: '', action: '', angle: null, move: null, lens: '', lensEdited: false,
  speaker: '', line: '', sfx: '', face: '', cutAfter: DEFAULT_CUT, frames, locked: false
});

export function blankScene({ seconds = 12, count = 3, rate = '24', context = '' } = {}) {
  return {
    context, event: '', acting: '', dialogue: false, hasActing: false, language: DEFAULT_LANGUAGE,
    segments: spreadFrames(count, framesFor(seconds, rate), rate)
  };
}

// ── the clock ───────────────────────────────────────────────────────────────────────────────────

export const totalFrames = segments => (segments || []).reduce((a, s) => a + (Number(s.frames) || 0), 0);

// Lay N shots across `total` frames as evenly as the floor allows. Remainder lands on the last one
// so the sum is exact — an off-by-one frame is invisible on screen and wrong in the total.
export function spreadFrames(count, total, rate = '24') {
  const n = Math.max(1, count);
  const min = minFrames(rate);
  const each = Math.max(min, Math.floor(total / n));
  const out = Array.from({ length: n }, () => blankShot(each));
  out[n - 1].frames = Math.max(min, total - each * (n - 1));
  out[n - 1].cutAfter = '';                                  // the last shot hands to nothing
  return out;
}

// Set ONE shot's length. The total moves with it, and that is deliberate: the clock is prompt text,
// so there is no fixed budget to conserve and no reason for typing 3s here to silently steal a
// second from somewhere else. `fitTo` is where a fixed total lives, applied on purpose.
export function setFrames(segments, ix, frames, rate = '24') {
  const min = minFrames(rate); const max = maxFrames(rate);
  return segments.map((s, i) => (i === ix ? { ...s, frames: Math.max(min, Math.min(max, Math.round(frames))) } : { ...s }));
}

// Drag the boundary BETWEEN shot ix and ix+1 — an NLE roll edit. The two neighbours trade frames and
// the total is untouched, which is what a timeline drag has to mean or the strip jumps around under
// the cursor.
export function roll(segments, ix, deltaFrames, rate = '24') {
  const min = minFrames(rate);
  const list = segments.map(s => ({ ...s }));
  const a = list[ix]; const b = list[ix + 1];
  if (!a || !b) return list;
  const d = Math.max(min - a.frames, Math.min(Math.round(deltaFrames), b.frames - min));
  a.frames += d; b.frames -= d;
  return list;
}

// Scale the whole clock onto a target, proportionally, keeping locked shots at their length.
export function fitTo(segments, target, rate = '24') {
  const min = minFrames(rate);
  const list = segments.map(s => ({ ...s }));
  const free = list.filter(s => !s.locked);
  if (!free.length) return list;                       // everything pinned — caller shows the mismatch
  const lockedSum = list.reduce((a, s) => a + (s.locked ? s.frames : 0), 0);
  const room = Math.max(free.length * min, target - lockedSum);
  const freeSum = free.reduce((a, s) => a + s.frames, 0);
  free.forEach(s => { s.frames = Math.max(min, Math.round(freeSum > 0 ? (s.frames / freeSum) * room : room / free.length)); });
  // rounding drifts a frame or two — settle it on the last free shot so the sum is exact
  const drift = target - totalFrames(list);
  if (drift !== 0) { const last = free[free.length - 1]; last.frames = Math.max(min, last.frames + drift); }
  return list;
}

// Move a shot earlier or later. The cut travels WITH the shot, except that whichever shot ends up
// last must not carry one — a trailing "HARD CUT." after the final beat is a cut to nothing.
export function reorder(segments, ix, dir) {
  const to = ix + dir;
  if (to < 0 || to >= segments.length) return segments.map(s => ({ ...s }));
  const list = segments.map(s => ({ ...s }));
  const [moved] = list.splice(ix, 1);
  list.splice(to, 0, moved);
  return normalizeCuts(list);
}

export function removeShot(segments, ix) {
  return normalizeCuts(segments.filter((_, i) => i !== ix).map(s => ({ ...s })));
}

// The last shot never carries a cut; every earlier one that lost its cut to a reorder gets the
// default back rather than silently emitting no transition.
function normalizeCuts(list) {
  return list.map((s, i) => (i === list.length - 1
    ? { ...s, cutAfter: '' }
    : { ...s, cutAfter: s.cutAfter || DEFAULT_CUT }));
}

// Cumulative in/out points, in frames. The reason the compiler emits ranges rather than durations: a
// model reading "2.6s" in isolation has no idea where in the clip it falls.
export function marks(segments) {
  let t = 0;
  return (segments || []).map(s => {
    const from = t; t += Number(s.frames) || 0;
    return { from, to: t };
  });
}

// frames → the '5.2' in `(5.2s–7.6s)`. One decimal: it is the only precision the prompt grammar
// uses, it is under a frame at any rate we support, and two decimals read as machine output.
export const stamp = (frames, rate) => (Math.round(secs(frames, rate) * 10) / 10).toFixed(1);

// U+2013 inside a range, U+2014 between the segment number and its label. Both are what the
// production packs use, and both are load-bearing for a parser that has to round-trip them.
export const EN_DASH = '–';
export const EM_DASH = '—';

// ── dialogue budget ─────────────────────────────────────────────────────────────────────────────
// 2.5 words per second is the ceiling every one of these models shares — past it the model speeds up
// delivery and the lip-sync desyncs. 2 is comfortable. Both are shown, because "tight" and "over"
// are different problems: tight is fine if the shot does nothing else, over is always wrong.
export const WORDS_PER_SECOND = 2.5;
export const WORDS_PER_SECOND_COMFORTABLE = 2;
export const wordsIn = text => String(text || '').trim().split(/\s+/).filter(Boolean).length;
export const wordBudget = (frames, rate) => Math.floor(secs(frames, rate) * WORDS_PER_SECOND);
export const comfortableBudget = (frames, rate) => Math.floor(secs(frames, rate) * WORDS_PER_SECOND_COMFORTABLE);

// ── compilation ─────────────────────────────────────────────────────────────────────────────────
// One generation, so the whole list arrives as one prompt. Empty blocks are omitted entirely rather
// than emitted with a blank body — a header with nothing under it is a word the model has to average
// away. The segment header grammar is invariant across every production prompt measured:
//   SEGMENT N — LABEL (0.0s–1.6s)
export function compileScene(scene, rate) {
  const sc = scene || {};
  const r = rateOf(rate);
  const segs = sc.segments || [];
  const at = marks(segs);
  const out = [];
  const block = (head, body) => { if (String(body || '').trim()) out.push(head + '\n' + String(body).trim()); };

  block('SCENE', sc.context);
  if (sc.hasActing) {
    block('WHAT IS REALLY HAPPENING', sc.event);
    block('PERFORMANCE', sc.acting);
    if (String(sc.event || '').trim() || String(sc.acting || '').trim()) block('FACES', MICRO_BEHAVIOUR);
  }

  // FORMAT is generated, never typed: it states the shot count, the cut count and the dialogue
  // policy, and all three are already known from the document. Typing them by hand is how a prompt
  // ends up claiming five shots while listing six.
  const written = segs.filter(hasBody);
  if (written.length) {
    const n = segs.length;
    const fmt = [`${n} shot${n === 1 ? '' : 's'} with HARD CUTS`];
    if (n > 1) fmt.push(`${n - 1} hard cut${n === 2 ? '' : 's'}`);
    fmt.push('real time, no ramps, no speed changes');
    fmt.push(sc.dialogue ? `dialogue in ${String(sc.language || DEFAULT_LANGUAGE).trim()}` : 'no dialogue');
    // capitalised per clause, not once over the join — these are sentences
    out.push('FORMAT\n' + fmt.map(cap).join('. ') + '.');
  }

  segs.forEach((s, i) => {
    if (!hasBody(s)) return;                                   // an empty shot still holds TIME
    const label = String(s.label || '').trim().toUpperCase();
    const head = 'SEGMENT ' + (i + 1) + (label ? ' ' + EM_DASH + ' ' + label : '')
      + ` (${stamp(at[i].from, r)}s${EN_DASH}${stamp(at[i].to, r)}s)`;
    const lines = [head];
    if (String(s.action || '').trim()) lines.push(String(s.action).trim());
    // LENS carries framing and move together. Derived from the pickers unless the user took it over.
    const lens = lensOf(s);
    if (lens) lines.push('LENS: ' + lens);
    // bracket grammar — { } dialogue, < > sfx. Prose descriptions of audio get averaged into mush.
    if (sc.dialogue && String(s.line || '').trim()) {
      const who = String(s.speaker || '').trim();
      lines.push((who ? who.toUpperCase() + ' ' : '') + '{' + String(s.line).trim().replace(/^\{|\}$/g, '') + '}');
    }
    if (String(s.sfx || '').trim()) lines.push('SFX: ' + sfxGrammar(s.sfx));
    if (sc.hasActing && String(s.face || '').trim()) lines.push('FACE: ' + String(s.face).trim());
    if (i < segs.length - 1) lines.push(String(s.cutAfter || DEFAULT_CUT).trim());
    out.push(lines.join('\n'));
  });

  return out.join('\n\n');
}

// The camera wording as it will ship: whatever the user typed if they took it over, otherwise
// written fresh from the pickers. Never stored stale — a shot whose angle changed but whose cached
// `lens` did not would emit the old framing.
export const lensOf = s => (s && s.lensEdited ? String(s.lens || '').trim() : composeLens(s && s.angle, s && s.move));

// A shot counts as written if it has any body at all. An angle or a move ALONE counts: "close-up,
// camera locked" is a real instruction even with no action line under it.
const hasBody = s => ['action', 'line', 'sfx', 'face'].some(k => String((s || {})[k] || '').trim())
  || !!(s && (s.angle || s.move))
  || !!(s && s.lensEdited && String(s.lens || '').trim());

// Sound effects arrive as a comma list and ship in angle brackets. Already-bracketed text is left
// exactly as typed — a user who knows the grammar should not have it rewritten under them.
function sfxGrammar(text) {
  const raw = String(text || '').trim();
  if (raw.includes('<')) return raw;
  return raw.split(',').map(x => x.trim()).filter(Boolean).map(x => '<' + x + '>').join(' ');
}

const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ── advisories ──────────────────────────────────────────────────────────────────────────────────
// Everything here is ADVISORY. Nothing blocks, nothing is auto-corrected, and each one says what
// goes wrong and what to do instead — a warning that only says "too long" costs the user the render
// it was trying to save.
//
// Deliberately NOT a per-model capability table: that would be a second source of truth about what
// a model can do, and the one we have (the synced schema) does not carry cut budgets.
export const CUT_BUDGET_SOFT = 6;

// How many distinct camera actions a line of wording describes. One per shot is the rule; a second
// move is a second shot and a cut, because stacked moves jitter on every one of these models.
// Inflections matter: a real wording says "the lens zooms" and "the crane rises", not the bare
// infinitive, so the suffix group is what makes this find anything at all.
const MOVE_VERBS = /\b(pan|tilt|zoom|dolly|track|crane|boom|pedestal|push|pull|arc|orbit|whip|roll|handheld|drift|rack)(s|es|ing|ed)?\b/gi;
export function countCameraMoves(text) {
  const hits = String(text || '').match(MOVE_VERBS);
  if (!hits) return 0;
  // count distinct STEMS — "push in and push through" is one move described twice, not two
  return new Set(hits.map(h => h.toLowerCase().replace(/(s|es|ing|ed)$/, ''))).size;
}

// Unbalanced brackets leak the rest of the prompt into that audio channel — the single most
// expensive typo available in this format.
const BRACKETS = [['<', '>', 'sound'], ['{', '}', 'dialogue'], ['(', ')', 'music']];
const countOf = (text, ch) => (String(text || '').split(ch).length - 1);

// Marks and lettering corrupt on every current model. They belong in a bound reference plate or in
// post, never in the video prompt's text.
const TYPE_WORDS = /\b(logo|emblem|badge|wordmark|lettering|caption|subtitle|watermark|signage|text on screen|on-screen text)\b/i;

export function advisories(scene, rate) {
  const sc = scene || {};
  const segs = sc.segments || [];
  const out = [];
  const push = (tone, text, shot) => out.push({ tone, text, shot: shot ?? null });

  if (segs.length > CUT_BUDGET_SOFT) {
    push('warn', `${segs.length} shots in one clip — faces usually start drifting after the fourth cut. Worth rendering as two clips and chaining the last frame of one into the first of the next.`);
  }

  segs.forEach((s, i) => {
    const n = i + 1;

    const moves = countCameraMoves(lensOf(s));
    if (moves > 1) {
      push('warn', `Shot ${n} asks for ${moves} camera actions. One per shot — a second move is a second shot and a cut.`, i);
    }

    if (sc.dialogue) {
      const words = wordsIn(s.line);
      if (words) {
        const ceiling = wordBudget(s.frames, rate);
        const comfy = comfortableBudget(s.frames, rate);
        if (words > ceiling) {
          push('danger', `Shot ${n}: ${words} words in ${stamp(s.frames, rate)}s, and about ${ceiling} fits. Past that the model rushes the delivery and the lips stop matching — cut the line, not the performance.`, i);
        } else if (words > comfy) {
          push('warn', `Shot ${n}: ${words} words in ${stamp(s.frames, rate)}s is tight — ${comfy} sits comfortably. Fine if the shot does nothing else, but a look and a reaction need room too.`, i);
        }
      }
    }

    for (const [open, close, name] of BRACKETS) {
      const text = [s.sfx, s.line].join(' ');
      if (countOf(text, open) !== countOf(text, close)) {
        push('danger', `Shot ${n} has an unclosed ${open} ${close} — an unbalanced bracket leaks the rest of the prompt into the ${name} channel.`, i);
      }
    }

    if (TYPE_WORDS.test([s.action, lensOf(s)].join(' '))) {
      push('warn', `Shot ${n} asks the model to render a mark or lettering. It corrupts on every current model — bake it into a reference plate and composite type in post.`, i);
    }
  });

  return out;
}
