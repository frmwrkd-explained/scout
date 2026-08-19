// Guard: the pure scene math behind scene retrim and per-scene contact sheets
// (backend/video.mjs). Everything here is a rule that is easy to re-derive at a call site
// and get subtly wrong, which is exactly why it is exported instead of inlined.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { folderKind } from '../shared/assetKinds.mjs';
import { stepTimes, gridFor, adaptiveCuts, parseSceneScores, clampShot, clock, MIN_SCENE_SEC, MAX_PANELS } from '../backend/video.mjs';

test('clampShot keeps the trim inside the video', () => {
  assert.deepEqual(clampShot({ start: -5, end: 999 }, 60), { s: 0, e: 60 });
  assert.deepEqual(clampShot({ start: 10, end: 12 }, 60), { s: 10, e: 12 });
});

test('clampShot nudges rather than rejecting an inverted or collapsed range', () => {
  // dragging the in point past the out point must not error and must not produce e < s
  const a = clampShot({ start: 30, end: 20 }, 60);
  assert.ok(a.e >= a.s + MIN_SCENE_SEC - 1e-9, 'end follows start by at least the minimum');
  const b = clampShot({ start: 12, end: 12 }, 60);
  assert.ok(b.e - b.s >= MIN_SCENE_SEC - 1e-9);
});

test('clampShot leaves room for the minimum at the tail of the video', () => {
  const r = clampShot({ start: 60, end: 60 }, 60);
  assert.ok(r.e <= 60, 'never past the end of the file');
  assert.ok(r.e - r.s >= MIN_SCENE_SEC - 1e-9);
});

test('clock formats a compact, sortable panel stamp', () => {
  assert.equal(clock(0), '0:00.00');
  assert.equal(clock(9.5), '0:09.50');
  assert.equal(clock(83.45), '1:23.45');
  assert.equal(clock(3723.45), '1:02:03.45');
  assert.equal(clock(-4), '0:00.00');
  assert.equal(clock(undefined), '0:00.00');
});

// ── filtergraph guards ───────────────────────────────────────────────────────────────────
// These read the source rather than running ffmpeg: the CI runners have no ffmpeg, but the
// mistakes below fail the WHOLE graph at runtime, which means the contact sheet silently
// refuses to build on a user's machine and nothing catches it here.
const src = readFileSync(new URL('../backend/video.mjs', import.meta.url), 'utf8');

test('drawtext expressions never use the drawbox/scale variables', () => {
  // drawbox, scale, pad and crop know `iw`/`ih`. drawtext does NOT — it knows `w`/`h` — and an
  // `ih` there dies with "Undefined constant or missing '('", taking the whole filter chain
  // with it. The two filters sit on adjacent lines in buildContactSheet, which is exactly how
  // the wrong variable gets copied across.
  const shots = [...src.matchAll(/drawtext=[^`]*/g)];
  assert.ok(shots.length >= 3, 'the panel label and both header lines must be found');
  for (const m of shots) {
    assert.ok(!/\biw\b/.test(m[0]), 'drawtext must not reference iw: ' + m[0].slice(0, 90));
    assert.ok(!/\bih\b/.test(m[0]), 'drawtext must not reference ih: ' + m[0].slice(0, 90));
  }
});

test('a font path reaches the filtergraph escaped', () => {
  // A Windows font path ('C:/Windows/Fonts/arial.ttf') carries a colon, which the graph parser
  // reads as the next option. escPath is what keeps drawtext from being handed 'C' as a font.
  assert.match(src, /drawtext=fontfile='\$\{escPath\(font\)\}'/,
    'drawtext must interpolate the font through escPath and quote it');
});

// ── adaptive cut detection ───────────────────────────────────────────────────────────────
// The rule this file exists to protect: a cut is a LOCAL SPIKE, never a value above a fixed
// line. Measured on a real dark-graded ad, a global 0.3 threshold found 30 of ~120 cuts, so
// single "scenes" swallowed six shots and every contact sheet built on them was nonsense.

// steady footage at `base`, with a spike of `s` at each index in `at`
const track = (n, base, at = [], s = 0.5) =>
  Array.from({ length: n }, (_, i) => ({ t: i * 0.04, s: at.includes(i) ? s : base }));

test('adaptiveCuts finds a cut in DARK footage a fixed threshold would miss', () => {
  // 0.11 would sail under any of the old thresholds (0.3 / 0.4 / 0.5) but is 30x its neighbours
  const cuts = adaptiveCuts(track(60, 0.004, [30], 0.11));
  assert.equal(cuts.length, 1);
  assert.ok(Math.abs(cuts[0] - 30 * 0.04) < 1e-9);
});

test('adaptiveCuts does not invent cuts in busy footage', () => {
  // a bright, high-motion shot: every frame scores high, nothing spikes relative to the rest
  assert.deepEqual(adaptiveCuts(track(60, 0.28)), []);
});

test('adaptiveCuts does not fire on noise in a locked-off shot', () => {
  // near-zero baseline: without the floor under the baseline, a 0.01 flicker divides into a
  // huge ratio and the detector shreds a static shot into dozens of scenes
  assert.deepEqual(adaptiveCuts(track(60, 0.00002, [20, 40], 0.01)), []);
});

test('adaptiveCuts collapses a multi-frame dissolve into one cut', () => {
  // a dissolve scores high for several frames running — that is one cut, not five
  const cuts = adaptiveCuts(track(80, 0.004, [40, 41, 42, 43], 0.2));
  assert.equal(cuts.length, 1, 'a run within minLen is one cut');
});

test('adaptiveCuts takes any frame over the hard-cut score', () => {
  // a blazing cut between two unrelated bright frames should not need the ratio test's blessing
  const rows = track(20, 0.30);
  rows[10].s = 0.62;
  assert.equal(adaptiveCuts(rows, { ratio: 99 }).length, 1);
});

test('sensitivity moves the cut count in the expected direction', () => {
  const rows = track(120, 0.01, [20, 50, 80], 0.05);
  const strict = adaptiveCuts(rows, { ratio: 4.0, minScore: 0.06 }).length;
  const high = adaptiveCuts(rows, { ratio: 2.5, minScore: 0.02 }).length;
  assert.ok(high >= strict, 'a more sensitive tier can never find fewer cuts');
});

test('parseSceneScores reads ffmpeg metadata=print, score on the following line', () => {
  const rows = parseSceneScores([
    'frame:0    pts:0       pts_time:0',
    'lavfi.scene_score=0.000000',
    'frame:1    pts:1024    pts_time:0.04',
    'lavfi.scene_score=0.482913',
    'frame:2    pts:2048    pts_time:0.08',      // no score line — must be skipped, not crash
    'frame:3    pts:3072    pts_time:0.12',
    'lavfi.scene_score=0.010000'
  ].join('\n'));
  assert.deepEqual(rows, [{ t: 0, s: 0 }, { t: 0.04, s: 0.482913 }, { t: 0.12, s: 0.01 }]);
});

// ── frame-step sampling ──────────────────────────────────────────────────────────────────

test('stepTimes samples every Nth frame, not a fixed count', () => {
  const r = stepTimes(10, 12, 25, 5, 60);          // 2s @ 25fps, every 5th frame
  assert.equal(r.step, 5);
  for (let i = 1; i < r.times.length; i++) {
    assert.ok(Math.abs((r.times[i] - r.times[i - 1]) - 5 / 25) < 1e-9, 'spacing is exactly the step');
  }
  assert.ok(r.times.length >= 8, 'a 2s shot at 5-frame steps is ~10 panels, not 9 by definition');
});

test('stepTimes gives a short transition real density', () => {
  // the whole point: a 0.8s whip used to be nine panels like everything else
  const r = stepTimes(0, 0.8, 25, 2, 60);
  assert.ok(r.times.length >= 8, 'got ' + r.times.length + ' panels for a 0.8s shot');
});

test('stepTimes coarsens the step instead of truncating a long shot', () => {
  // 60s at every 2nd frame would be 750 panels. It must still span the WHOLE shot.
  const r = stepTimes(0, 60, 25, 2, MAX_PANELS);
  assert.ok(r.times.length <= MAX_PANELS, 'respects the cap');
  assert.ok(r.step > 2, 'step widened rather than dropping the tail');
  assert.ok(r.times[r.times.length - 1] > 55, 'last panel still near the end of the shot');
});

test('stepTimes insets off the cut at both ends', () => {
  // ffmpeg reports a cut at the first frame of the NEXT shot
  const r = stepTimes(10, 12, 25, 5, 60);
  assert.ok(r.times[0] > 10, 'first panel sits after the in point');
  assert.ok(r.times[r.times.length - 1] < 12, 'last panel sits before the out point');
});

test('stepTimes survives a degenerate scene', () => {
  for (const [s, e, fps] of [[5, 5, 25], [5, 5.1, 0], [0, 1, NaN]]) {
    const r = stepTimes(s, e, fps, 5, 60);
    assert.ok(r.times.length >= 1, 'always at least one panel');
    assert.ok(r.times.every(Number.isFinite), 'no NaN timestamps reach ffmpeg');
  }
});

test('gridFor shapes any panel count, and the grid always has room', () => {
  for (let n = 1; n <= MAX_PANELS; n++) {
    const g = gridFor(n);
    assert.ok(g.cols >= 1 && g.cols <= 6, n + ' panels → ' + g.cols + ' cols');
    assert.ok(g.cols * g.rows >= n, n + ' panels must fit in ' + g.cols + 'x' + g.rows);
    // the blank-padding path fills the remainder; more than one empty ROW means a wasted band
    assert.ok(g.cols * g.rows - n < g.cols, n + ' panels leaves a whole empty row');
  }
});

// ── the Assets / References split reaches the tab badges ─────────────────────────────────
// A badge that counts something its own tab cannot render is worse than no badge: the Assets
// tab read "133" on a project whose media all sat at the context root and then rendered an
// empty page, because AssetBoards shows production FOLDERS only. shared/assetKinds.mjs is the
// one rule for that split (CLAUDE.md: "Production assets and mood/references are never one
// list") and App.jsx must not re-derive it.
const appSrc = readFileSync(new URL('../frontend/App.jsx', import.meta.url), 'utf8');

test('the Assets badge counts only production-folder media', () => {
  const line = appSrc.split('\n').find(l => l.includes('const ctxMedia ='));
  assert.ok(line, 'ctxMedia must still exist');
  assert.match(line, /folderKind\(/, 'ctxMedia must filter through folderKind, not count every context image');
});

test('a context-root file is a reference, never a production asset', () => {
  // this is the behaviour the badge depends on: a mood/video import lands at the root
  assert.equal(folderKind(''), 'reference');
  assert.equal(folderKind('cast'), 'asset');
  assert.equal(folderKind('Characters'), 'asset');
  assert.equal(folderKind('moodboard'), 'reference');
});
