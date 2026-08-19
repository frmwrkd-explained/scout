// DEV-133 — the shot list's clock maths and prompt compilation.
//
// Four invariants, tested directly rather than through the UI:
//   1. the duration PARAMETER still comes only from the model's SYNCED SCHEMA, never a table in the
//      app (CLAUDE.md hard rule — the pre-DEV-133 picker offered 4s for a model whose minimum was
//      5s). This did not change when the builder stopped being gated on that schema: the clock is
//      prompt text, the parameter is not, and only the parameter is schema-bound.
//   2. time is integer FRAMES end to end (shared/timecode.mjs), because sub-second beats are real
//      and three 0.5s floats do not add up to the number printed on the total
//   3. angles and camera moves are READ from the catalogues that already own them — the `framing`
//      axis and cameraMovements.js — and never restated here
//   4. the shot list owns no style, look, stock or lens. That is the composer's ✦ look picker, and
//      a second copy of it here would be a second source of truth for the same fragment
import './_env.mjs'; // first — sets storage-root env before the store loads
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  durationField, durationChoices, supportsSequence, durationParam, nearestChoice,
  spreadFrames, totalFrames, setFrames, roll, fitTo, marks, stamp, minFrames,
  compileScene, blankScene, ANGLES, angleToken, moveById, moveClause,
  QUICK_ANGLES, QUICK_MOVES, MICRO_BEHAVIOUR, composeLens, lensOf, countCameraMoves,
  reorder, removeShot, CUT_OPTIONS, DEFAULT_CUT, maxFrames,
  wordsIn, wordBudget, comfortableBudget, advisories
} from '../frontend/sequence.js';
import { CAMERA_MOVEMENTS } from '../frontend/cameraMovements.js';
import { framesFor, rateOf } from '../shared/timecode.mjs';

const R = rateOf('24');

// shapes as backend/modelSchemas.mjs normalizes them
const ENUM_SCHEMA = { fields: [{ name: 'prompt', type: 'string' }, { name: 'duration', type: 'enum', options: ['5', '10'] }] };
const RANGE_SCHEMA = { fields: [{ name: 'duration_seconds', type: 'integer', min: 4, max: 12, step: 2 }] };
const IMAGE_SCHEMA = { fields: [{ name: 'prompt', type: 'string' }, { name: 'image_size', type: 'enum', options: ['square'] }] };

// ── the duration PARAMETER is still schema-only ─────────────────────────────────────────────────
test('an enum duration yields exactly its own options', () => {
  assert.deepEqual(durationChoices(durationField(ENUM_SCHEMA)), [5, 10]);
  // the regression the old picker had: 4 was offered for a model whose minimum is 5
  assert.ok(!durationChoices(durationField(ENUM_SCHEMA)).includes(4));
});

test('a numeric duration is walked by its own step', () => {
  assert.deepEqual(durationChoices(durationField(RANGE_SCHEMA)), [4, 6, 8, 10, 12]);
});

test('a model with no duration field offers no durations at all', () => {
  assert.equal(durationField(IMAGE_SCHEMA), null);
  assert.equal(durationChoices(durationField(IMAGE_SCHEMA)).length, 0);
  assert.equal(durationParam(durationField(IMAGE_SCHEMA), 5), null, 'nothing is invented for it');
  // supportsSequence survives as "can the user pick a length", and still fails closed
  assert.equal(supportsSequence(IMAGE_SCHEMA), false);
  assert.equal(supportsSequence(null), false);
  assert.equal(supportsSequence({ fields: [{ name: 'duration', type: 'enum', options: ['5'] }] }), false);
});

test('an enum field is sent ITS OWN string, not a number we invented', () => {
  assert.deepEqual(durationParam(durationField(ENUM_SCHEMA), 10), { duration: '10' });
  assert.equal(durationParam(durationField(ENUM_SCHEMA), 7), null, 'a value the model never offered is not sent');
  assert.deepEqual(durationParam(durationField(RANGE_SCHEMA), 8), { duration_seconds: 8 });
});

// ── real synced shapes, read off the live schema endpoint ───────────────────────────────────────
// Not invented fixtures: FAL spells duration four different ways across these endpoints, and one of
// them ("4s") is why durationParam hands the ORIGINAL option back instead of a number.
test('real FAL duration shapes all resolve', () => {
  const KLING = { fields: [{ name: 'duration', type: 'enum', options: ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'], default: '5' }] };
  const VEO = { fields: [{ name: 'duration', type: 'enum', options: ['4s', '6s', '8s'], default: '8s' }] };
  const PIXVERSE = { fields: [{ name: 'duration', type: 'integer', min: 1, max: 15, default: 5 }] };
  const SORA = { fields: [{ name: 'duration', type: 'enum', options: ['4', '8', '12', '16', '20'], default: 4 }] };

  assert.equal(durationChoices(durationField(KLING)).length, 13);
  assert.deepEqual(durationChoices(durationField(VEO)), [4, 6, 8], '"4s" parses to 4');
  assert.deepEqual(durationChoices(durationField(SORA)), [4, 8, 12, 16, 20]);
  assert.equal(durationChoices(durationField(PIXVERSE)).length, 15, 'min..max by step 1');

  assert.deepEqual(durationParam(durationField(VEO), 6), { duration: '6s' });
  assert.deepEqual(durationParam(durationField(KLING), 12), { duration: '12' });
  assert.deepEqual(durationParam(durationField(PIXVERSE), 9), { duration: 9 });
});

test('nearestChoice snaps an authored clock onto a legal one, and never invents a value', () => {
  assert.equal(nearestChoice([4, 8, 12, 16, 20], 9.3), 8);
  assert.equal(nearestChoice([4, 8, 12, 16, 20], 10.5), 12);
  assert.equal(nearestChoice([5, 10], 7.5), 5, 'ties go to the first, deterministically');
  assert.equal(nearestChoice([], 9), null, 'no choices → nothing to snap to');
  assert.equal(nearestChoice(null, 9), null);
});

// ── the clock is frames ─────────────────────────────────────────────────────────────────────────
test('spreadFrames lays segments evenly and sums to the total EXACTLY', () => {
  for (const [n, seconds] of [[3, 15], [4, 10], [1, 5], [3, 10], [6, 12]]) {
    const total = framesFor(seconds, R);
    const s = spreadFrames(n, total, R);
    assert.equal(s.length, n);
    assert.equal(totalFrames(s), total, n + '×' + seconds + 's');
    assert.ok(s.every(x => x.frames >= minFrames(R)));
  }
});

test('a sub-second beat is representable and does not drift', () => {
  // three 0.5s beats: 12 frames each at 24. Summed as floats, 0.1+0.2-style error is what puts
  // 1.4999999999999998 on a total that has to read 1.5. Summed as frames it is 36, always.
  let segs = spreadFrames(3, framesFor(1.5, R), R);
  assert.equal(totalFrames(segs), 36);
  for (const i of [0, 1, 2]) segs = setFrames(segs, i, framesFor(0.5, R), R);
  assert.equal(totalFrames(segs), 36, 'set individually, it lands on the same integer');
  assert.equal(stamp(36, R), '1.5', 'and it prints as the number the user typed');
  // sub-second beats stay exact all the way down to the floor
  assert.equal(stamp(minFrames(R), R), '0.3');
});

test('setFrames moves the total with it — the clock is prompt text, not a fixed budget', () => {
  const segs = spreadFrames(3, framesFor(12, R), R);       // 96/96/96
  const next = setFrames(segs, 0, 200, R);
  assert.equal(next[0].frames, 200);
  assert.equal(next[1].frames, 96, 'the neighbours are NOT silently robbed');
  assert.equal(totalFrames(next), 200 + 96 + 96);
});

test('setFrames never mutates the input and holds the floor', () => {
  const segs = spreadFrames(3, framesFor(12, R), R);
  const copy = JSON.parse(JSON.stringify(segs));
  const next = setFrames(segs, 1, -50, R);
  assert.deepEqual(segs, copy, 'input untouched');
  assert.equal(next[1].frames, minFrames(R), 'clamped to the floor, never zero or negative');
});

test('roll trades frames between two neighbours and leaves the total alone', () => {
  const segs = spreadFrames(3, framesFor(12, R), R);
  const total = totalFrames(segs);
  const next = roll(segs, 0, 24, R);
  assert.equal(next[0].frames, segs[0].frames + 24);
  assert.equal(next[1].frames, segs[1].frames - 24);
  assert.equal(next[2].frames, segs[2].frames, 'a roll touches exactly two segments');
  assert.equal(totalFrames(next), total, 'total preserved — the strip must not jump under the cursor');
});

test('roll clamps at the floor however hard it is dragged', () => {
  const segs = spreadFrames(3, framesFor(12, R), R);
  const total = totalFrames(segs);
  for (const d of [9999, -9999]) {
    const next = roll(segs, 1, d, R);
    assert.equal(totalFrames(next), total, 'drag ' + d);
    assert.ok(next.every(s => s.frames >= minFrames(R)), 'drag ' + d + ' kept the floor');
  }
  assert.deepEqual(roll(segs, 2, 10, R).map(s => s.frames), segs.map(s => s.frames), 'no boundary past the last segment');
});

test('fitTo scales onto a target proportionally and lands on it exactly', () => {
  const segs = setFrames(spreadFrames(3, framesFor(12, R), R), 0, 192, R);   // 192/96/96 = 16s
  const target = framesFor(10, R);
  const next = fitTo(segs, target, R);
  assert.equal(totalFrames(next), target, next.map(s => s.frames).join('/'));
  assert.ok(next[0].frames > next[1].frames, 'the long beat stays comparatively long');
  assert.ok(next.every(s => s.frames >= minFrames(R)));
});

test('fitTo leaves a locked segment at its authored length', () => {
  const segs = spreadFrames(3, framesFor(12, R), R).map((s, i) => (i === 2 ? { ...s, locked: true, frames: 48 } : s));
  const target = framesFor(8, R);
  const next = fitTo(segs, target, R);
  assert.equal(next[2].frames, 48, 'locked beat untouched');
  assert.equal(totalFrames(next), target);
});

test('marks are cumulative in/out points, because a bare duration has no place in the clip', () => {
  const segs = [{ frames: 60 }, { frames: 24 }, { frames: 36 }];
  assert.deepEqual(marks(segs), [{ from: 0, to: 60 }, { from: 60, to: 84 }, { from: 84, to: 120 }]);
  assert.equal(stamp(84, R), '3.5');
});

// ── the two per-shot vocabularies are READ, never restated ──────────────────────────────────────
test('angles come from the framing axis, not from a list in this module', () => {
  const names = ANGLES().map(t => t.t);
  assert.ok(names.length >= 12, 'the whole framing axis is offered');
  assert.ok(names.includes('Wide') && names.includes('Close-up') && names.includes('Over-shoulder'));
  // every angle carries the plate the shot list renders as its board panel
  for (const t of ANGLES()) assert.match(String(t.img || ''), /^\/axis-options\/framing--/, t.t + ' has no thumbnail');
  assert.equal(angleToken('Close-up').f, 'tight close-up on the face, emotional detail');
  assert.equal(angleToken('nope'), null, 'an unknown angle resolves to null, never throws');
});

test('every quick-set entry actually exists in its catalogue', () => {
  // the quick sets are declared here and imported by the composer's picker; a typo would silently
  // shrink the offered set rather than error, so it is pinned
  for (const n of QUICK_ANGLES) assert.ok(angleToken(n), 'no such angle: ' + n);
  for (const id of QUICK_MOVES) assert.ok(moveById(id), 'no such move: ' + id);
});

test('a shot gets the movement SHORT form, never its whole paragraph', () => {
  // six stacked promptFragments is six paragraphs of camera boilerplate drowning the six lines that
  // describe the film — the clip-level move still sends the full fragment via lookBuilder
  assert.equal(moveClause('push-in'), 'camera moves toward subject');
  assert.equal(moveClause(null), '');
  assert.equal(moveClause('nope'), '');
  for (const m of CAMERA_MOVEMENTS) {
    assert.ok(m.directionLabel && m.directionLabel.length < 60, m.id + ' direction label is not short');
  }
});

// ── compilation ─────────────────────────────────────────────────────────────────────────────────
const SCENE = {
  context: 'A storm rolls over the lighthouse.',
  event: '', acting: '', dialogue: false, hasActing: false, language: 'English',
  segments: [
    { label: 'held wide', action: 'wide on the tower', angle: 'Wide', move: 'static', speaker: '', line: '', sfx: 'wind, rain on glass', face: '', cutAfter: 'HARD CUT.', frames: 96 },
    { label: '', action: 'the keeper climbs', angle: null, move: 'push-in', speaker: '', line: '', sfx: '', face: '', cutAfter: 'MATCH CUT.', frames: 120 },
    { label: 'the lamp', action: 'the lamp ignites', angle: 'Close-up', move: null, speaker: '', line: '', sfx: '', face: '', cutAfter: '', frames: 144 }
  ]
};

test('shots compile to the invariant SEGMENT header with CUMULATIVE ranges', () => {
  // the grammar measured across 14 production prompts: `SEGMENT N — LABEL (0.0s–1.6s)`, em dash
  // before the label, en dash inside the range, one decimal, always cumulative from 0.0
  const out = compileScene(SCENE, R);
  assert.match(out, /^SEGMENT 1 — HELD WIDE \(0\.0s–4\.0s\)$/m);
  assert.match(out, /^SEGMENT 2 \(4\.0s–9\.0s\)$/m, 'an unlabelled shot keeps its number and range');
  assert.match(out, /^SEGMENT 3 — THE LAMP \(9\.0s–15\.0s\)$/m);
});

test('LENS carries the angle fragment and the move SHORT form on one line', () => {
  const out = compileScene(SCENE, R);
  // the framing token's own fragment, verbatim from the axis — not a paraphrase invented here
  assert.match(out, /^LENS: wide shot with full environment context, camera locked$/m);
  assert.match(out, /^LENS: camera moves toward subject$/m, 'a move with no angle still writes the line');
  assert.match(out, /^LENS: tight close-up on the face, emotional detail$/m, 'an angle with no move likewise');
  // the four-sentence promptFragment belongs to the clip-level picker, never to a shot
  assert.ok(!out.includes('This is physical camera travel'), 'the long move paragraph must not land per shot');
});

test('the camera wording is DERIVED, until a human takes it over', () => {
  assert.equal(composeLens('Wide', 'static'), 'wide shot with full environment context, camera locked');
  assert.equal(composeLens(null, null), '');
  // lensOf is what ships: pickers win while lensEdited is false, the human wins once it is true
  assert.equal(lensOf({ angle: 'Wide', move: 'static', lens: 'stale text' }), composeLens('Wide', 'static'));
  assert.equal(lensOf({ angle: 'Wide', move: 'static', lens: 'my own words', lensEdited: true }), 'my own words');
  const out = compileScene({ ...SCENE, segments: [{ ...SCENE.segments[0], lens: 'shot from a drone, straight down', lensEdited: true }] }, R);
  assert.match(out, /^LENS: shot from a drone, straight down$/m, 'nothing is rejected for being off-catalog');
});

test('a shot with only an angle still counts as written', () => {
  const out = compileScene({ ...SCENE, context: '', segments: [{ frames: 96, angle: 'Wide', action: '' }] }, R);
  assert.match(out, /^SEGMENT 1 \(0\.0s–4\.0s\)$/m);
  assert.match(out, /^LENS: wide shot with full environment context$/m);
});

test('block order runs SCENE → FORMAT → shots, and empty blocks are omitted entirely', () => {
  const out = compileScene(SCENE, R);
  let at = -1;
  for (const head of ['SCENE', 'FORMAT', 'SEGMENT 1', 'SEGMENT 2', 'SEGMENT 3']) {
    const ix = out.indexOf(head);
    assert.ok(ix > at, head + ' is out of order');
    at = ix;
  }
  // a header with nothing under it is a word the model has to average away
  for (const head of ['WHAT IS REALLY HAPPENING', 'PERFORMANCE', 'FACES']) {
    assert.ok(!out.includes(head), head + ' was emitted empty');
  }
  // style, look, stock and grade belong to the composer's look picker and must never appear here
  for (const head of ['STYLE', 'LOOK', 'POSITIVE LOCKS', 'FILM STOCK']) {
    assert.ok(!out.includes(head), head + ' is the look builder’s job, not the shot list’s');
  }
});

test('each shot carries its OWN cut, and the last one carries none', () => {
  const out = compileScene(SCENE, R);
  assert.match(out, /^HARD CUT\.$/m);
  assert.match(out, /^MATCH CUT\.$/m, 'the cut is per shot, not one hardcoded kind');
  assert.equal((out.match(/CUT\.$/gm) || []).length, 2, 'three shots, two cuts');
  assert.ok(!/CUT\.$/.test(out.trimEnd()), 'a cut after the final beat is a cut to nothing');
});

test('reorder and remove carry the cut with the shot and re-normalise the last one', () => {
  const moved = reorder(SCENE.segments, 0, 1);
  assert.deepEqual(moved.map(s => s.action), ['the keeper climbs', 'wide on the tower', 'the lamp ignites']);
  assert.equal(moved[2].cutAfter, '', 'whatever ends up last loses its cut');
  assert.ok(moved[1].cutAfter, 'and whatever stops being last gains one');
  assert.deepEqual(reorder(SCENE.segments, 0, -1).map(s => s.action), SCENE.segments.map(s => s.action), 'off the top is a no-op');
  assert.deepEqual(reorder(SCENE.segments, 2, 1).map(s => s.action), SCENE.segments.map(s => s.action), 'off the bottom likewise');
  const gone = removeShot(SCENE.segments, 2);
  assert.equal(gone.length, 2);
  assert.equal(gone[1].cutAfter, '', 'the new last shot drops its cut');
  assert.ok(CUT_OPTIONS.includes(DEFAULT_CUT));
});

test('FORMAT is generated from the document, never typed', () => {
  const out = compileScene(SCENE, R);
  assert.match(out, /FORMAT\n3 shots with HARD CUTS\. 2 hard cuts\. Real time, no ramps, no speed changes\. No dialogue\./);
  assert.match(compileScene({ ...SCENE, dialogue: true, language: 'British English' }, R), /Dialogue in British English\./);
});

test('SFX ships in angle brackets, dialogue in braces, and hand-written grammar is left alone', () => {
  const out = compileScene({ ...SCENE, dialogue: true, segments: [{ ...SCENE.segments[0], speaker: 'the keeper', line: 'It holds.' }] }, R);
  assert.match(out, /SFX: <wind> <rain on glass>/);
  assert.match(out, /^THE KEEPER \{It holds\.\}$/m);
  const already = compileScene({ ...SCENE, segments: [{ ...SCENE.segments[0], sfx: '<a latch clicks> <wind>' }] }, R);
  assert.match(already, /SFX: <a latch clicks> <wind>/, 'a user who knows the grammar is not rewritten');
});

test('acting adds two authored blocks plus the micro-behaviour block nobody types', () => {
  const acting = { ...SCENE, hasActing: true, event: 'He is leaving tomorrow and they both know.', acting: 'She wants him to stay and keeps it light.' };
  const out = compileScene(acting, R);
  assert.match(out, /^WHAT IS REALLY HAPPENING$/m);
  assert.match(out, /^PERFORMANCE$/m);
  assert.ok(out.includes(MICRO_BEHAVIOUR), 'the anti-glassy-stare block is appended, not authored');
  assert.ok(!compileScene({ ...acting, hasActing: false }, R).includes('PERFORMANCE'), 'written but switched off stays out');
  // and it is not appended to a scene that turned acting on without answering either question
  assert.ok(!compileScene({ ...SCENE, hasActing: true }, R).includes(MICRO_BEHAVIOUR));
});

test('an empty shot holds TIME but emits no block — the clock still advances', () => {
  const out = compileScene({
    ...SCENE, context: '',
    segments: [{ frames: 120, action: '' }, { frames: 120, action: 'second beat' }]
  }, R);
  assert.match(out, /SEGMENT 2 \(5\.0s–10\.0s\)/, 'the written beat starts at 5.0s, not 0.0s');
  assert.ok(!out.includes('SEGMENT 1'));
});

test('nothing written compiles to nothing, so an empty shot list cannot be sent', () => {
  assert.equal(compileScene({ segments: [{ frames: 120, action: '' }] }, R), '');
  assert.equal(compileScene({}, R), '');
  assert.equal(compileScene(null, R), '');
});

test('blankScene is coherent and carries no style of its own', () => {
  const s = blankScene({ seconds: 12, count: 3, rate: R });
  assert.equal(s.segments.length, 3);
  assert.equal(totalFrames(s.segments), framesFor(12, R));
  assert.equal(s.dialogue, false);
  assert.equal(s.hasActing, false);
  for (const k of ['look', 'style', 'register', 'locks']) {
    assert.ok(!(k in s), 'blankScene must not own ' + k + ' — the look picker does');
  }
  for (const sh of s.segments) assert.deepEqual([sh.angle, sh.move], [null, null], 'a blank shot picks nothing for you');
  assert.equal(s.segments[s.segments.length - 1].cutAfter, '', 'the last shot starts with no cut');
});

// ── advisories ──────────────────────────────────────────────────────────────────────────────────
test('the dialogue budget is 2.5 words per second, with 2 as comfortable', () => {
  assert.equal(wordBudget(framesFor(12, R), R), 30);
  assert.equal(wordBudget(framesFor(2.6, R), R), 6);
  assert.equal(comfortableBudget(framesFor(12, R), R), 24, 'tight and over are different problems');
  assert.equal(wordsIn('  You  were   good with them. '), 5);
  assert.equal(wordsIn(''), 0);
});

test('over-long dialogue is flagged with the shot number, in plain words', () => {
  const scene = { dialogue: true, segments: [{ frames: framesFor(2, R), line: 'one two three four five six seven eight' }] };
  const [note] = advisories(scene, R);
  assert.equal(note.tone, 'danger');
  assert.match(note.text, /Shot 1: 8 words in 2\.0s/);
  assert.equal(note.shot, 0, 'attributed to the shot, so the UI can jump to it');
  assert.equal(advisories({ ...scene, dialogue: false }, R).length, 0, 'silent scenes are not scolded about speech');
  // tight is a warning, not an error — fine if the shot does nothing else
  const tight = advisories({ dialogue: true, segments: [{ frames: framesFor(2, R), line: 'one two three four five' }] }, R);
  assert.equal(tight[0].tone, 'warn');
});

test('a stacked camera move is flagged — one action per shot', () => {
  assert.equal(countCameraMoves('locked off, nothing travels'), 0);
  assert.equal(countCameraMoves('a slow push in'), 1);
  assert.equal(countCameraMoves('tracking left while the lens zooms and the crane rises'), 3);
  const [note] = advisories({ segments: [{ frames: 96, lensEdited: true, lens: 'pan right and then dolly forward' }] }, R);
  assert.equal(note.tone, 'warn');
  assert.match(note.text, /2 camera actions/);
});

test('an unbalanced bracket is an error, because it leaks the prompt into the audio channel', () => {
  const [note] = advisories({ segments: [{ frames: 96, sfx: '<wind, rain on glass' }] }, R);
  assert.equal(note.tone, 'danger');
  assert.match(note.text, /unclosed < >/);
  assert.equal(advisories({ segments: [{ frames: 96, sfx: '<wind> <rain>' }] }, R).length, 0);
});

test('asking the model to render a mark is flagged, with what to do instead', () => {
  const [note] = advisories({ segments: [{ frames: 96, action: 'the logo spins into frame' }] }, R);
  assert.equal(note.tone, 'warn');
  assert.match(note.text, /composite type in post/);
});

test('a cut count past the soft budget warns, and does not block', () => {
  const scene = { segments: Array.from({ length: 8 }, () => ({ frames: 48 })) };
  const [note] = advisories(scene, R);
  assert.equal(note.tone, 'warn');
  assert.match(note.text, /8 shots/);
  assert.equal(note.shot, null, 'a whole-sequence note belongs to no single shot');
  assert.equal(advisories({ segments: Array.from({ length: 5 }, () => ({ frames: 48 })) }, R).length, 0);
});

test('the shot floor is a quarter second, the ceiling is thirty', () => {
  // six frames at 24. A floor of one or two frames means the last pixels of a drag do nothing
  // visible, and no model renders a two-frame beat as a readable shot.
  assert.equal(minFrames(R), 6);
  assert.equal(maxFrames(R), 720);
  assert.equal(stamp(minFrames(R), R), '0.3');
});
