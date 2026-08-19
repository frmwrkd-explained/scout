// A1 — frame math. Everything the animatic exports rests on this file being right, and an XML
// with wrong frame math imports as an empty sequence with no error message, so these assertions
// are the only place the mistake is catchable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RATES, rateOf, fpsOf, framesFor, secs, tcStr, rationalStr, humanDur } from '../shared/timecode.mjs';

test('every rate is internally consistent', () => {
  for (const r of RATES) {
    assert.ok(r.num > 0 && r.den > 0, r.id + ' has a real rational rate');
    assert.equal(r.ntsc, r.den === 1001, r.id + ': ntsc iff /1001');
    // DF is legal ONLY at 30000/1001 and 60000/1001. 23.976 is always non-drop — the single
    // most common way a hand-written exporter produces a file Premiere refuses.
    assert.equal(r.dfLegal, r.den === 1001 && (r.num === 30000 || r.num === 60000), r.id + ': dfLegal');
    assert.equal(r.nominal, Math.round(r.num / r.den), r.id + ': nominal is the rounded rate');
  }
});

test('4 seconds is 96 frames at 24 and at 23.976', () => {
  // The headline case: authored intent is whole frames, and the /1001 rates play them slower
  // rather than giving a different count.
  assert.equal(framesFor(4, '24'), 96);
  assert.equal(framesFor(4, '23.976'), 96);
});

test('4 seconds across every supported rate', () => {
  const want = { '23.976': 96, '24': 96, '25': 100, '29.97': 120, '30': 120, '50': 200, '59.94': 240, '60': 240 };
  for (const [id, frames] of Object.entries(want)) {
    assert.equal(framesFor(4, id), frames, '4s at ' + id);
  }
});

test('framesFor refuses garbage instead of producing NaN', () => {
  // A NaN frame count serialises into an XML that no NLE can open, so it must never escape here.
  for (const bad of [undefined, null, '', 'abc', NaN, -3, 0]) {
    assert.equal(framesFor(bad, '24'), 0, String(bad));
  }
});

test('rateOf falls back to 24 rather than throwing', () => {
  assert.equal(rateOf('nonsense').id, '24');
  assert.equal(rateOf(undefined).id, '24');
  assert.equal(rateOf({ fpsNum: 24000, fpsDen: 1001 }).id, '23.976');
  assert.equal(rateOf(25).id, '25');
  assert.equal(rateOf(23.98).id, '23.976', 'a bare decimal snaps to the nearest real rate');
});

test('rateOf is idempotent — every helper may be handed a resolved rate', () => {
  // Regression: a resolved rate carries num/den, not fpsNum/fpsDen, so the object branch used to
  // fall through to the 24fps default. buildReel resolves once and passes the object to secs(),
  // tcStr() and rationalStr(), so a 25 or 29.97 reel silently computed all of its timing at 24.
  for (const r of RATES) {
    assert.equal(rateOf(r).id, r.id, r.id + ' must survive a second resolution');
    assert.equal(rateOf(rateOf(rateOf(r))).id, r.id);
    // and the helpers must agree whether handed an id or the object
    assert.equal(secs(100, r), secs(100, r.id), 'secs(' + r.id + ')');
    assert.equal(tcStr(100, r), tcStr(100, r.id), 'tcStr(' + r.id + ')');
    assert.equal(rationalStr(100, r), rationalStr(100, r.id), 'rationalStr(' + r.id + ')');
    assert.equal(framesFor(4, r), framesFor(4, r.id), 'framesFor(' + r.id + ')');
  }
  assert.equal(secs(100, rateOf('25')), 4, '100 frames at 25fps is 4s, not 4.167');
});

test('frames and seconds round-trip', () => {
  for (const id of ['23.976', '24', '25', '29.97', '30']) {
    for (const f of [1, 2, 96, 100, 1798, 17982]) {
      assert.equal(framesFor(secs(f, id), id), f, f + ' frames at ' + id);
    }
  }
});

test('non-drop timecode counts at the nominal rate', () => {
  assert.equal(tcStr(0, '24'), '00:00:00:00');
  assert.equal(tcStr(96, '24'), '00:00:04:00');
  assert.equal(tcStr(247, '24'), '00:00:10:07');   // the worked example in the spec
  assert.equal(tcStr(24 * 60, '24'), '00:01:00:00');
  assert.equal(tcStr(24 * 3600, '24'), '01:00:00:00');
  // 23.976 counts at 24 and drifts against wall-clock. That is correct and what every NLE does.
  assert.equal(tcStr(96, '23.976'), '00:00:04:00');
  assert.equal(tcStr(100, '25'), '00:00:04:00');
});

test('drop-frame skips two frame numbers per minute, except every tenth', () => {
  assert.equal(tcStr(0, '29.97', { drop: true }), '00:00:00;00');
  assert.equal(tcStr(1799, '29.97', { drop: true }), '00:00:59;29');
  // the drop: frame 1800 reads 00:01:00;02, not ;00
  assert.equal(tcStr(1800, '29.97', { drop: true }), '00:01:00;02');
  // the tenth minute does NOT drop, so the count realigns
  assert.equal(tcStr(17982, '29.97', { drop: true }), '00:10:00;00');
});

test('drop-frame is refused at every rate where it is illegal', () => {
  // Asking for drop at 24 must yield NDF with a ':' separator, not a ';' — a DF display format
  // at a non-DF rate is exactly the malformed file that imports as an empty sequence.
  for (const id of ['23.976', '24', '25', '30', '50', '60']) {
    const tc = tcStr(1800, id, { drop: true });
    assert.ok(!tc.includes(';'), id + ' must not produce drop-frame timecode: ' + tc);
  }
  for (const id of ['29.97', '59.94']) {
    assert.ok(tcStr(1800, id, { drop: true }).includes(';'), id + ' may drop');
  }
});

test('FCPXML rational time is exact, never decimal', () => {
  assert.equal(rationalStr(0, '24'), '0s');
  assert.equal(rationalStr(96, '23.976'), '96096/24000s');
  assert.equal(rationalStr(96, '24'), '96/24s');
  assert.equal(rationalStr(120, '29.97'), '120120/30000s');
  // no decimal point may ever appear — Final Cut silently reinterprets a decimal duration
  for (const id of ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60']) {
    for (const f of [1, 2, 96, 247, 5000]) {
      assert.ok(/^(\d+\/\d+s|0s)$/.test(rationalStr(f, id)), id + ' ' + f + ': ' + rationalStr(f, id));
    }
  }
});

test('fpsOf is the exact rational, not the nominal', () => {
  assert.equal(fpsOf(rateOf('24')), 24);
  assert.ok(Math.abs(fpsOf(rateOf('23.976')) - 23.976023976) < 1e-6);
  assert.ok(Math.abs(fpsOf(rateOf('29.97')) - 29.97002997) < 1e-6);
});

test('humanDur reads as a runtime', () => {
  assert.equal(humanDur(247, '24'), '10.29s');
  assert.equal(humanDur(96, '24'), '4.00s');
  assert.equal(humanDur(24 * 90, '24'), '1:30.0');
});
