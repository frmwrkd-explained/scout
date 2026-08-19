// A7 — the playback clock. The whole point of deriving the frame from a monotonic timestamp
// rather than accumulating it is that drift is zero BY CONSTRUCTION, so these tests inject a fake
// clock and a fake rAF and prove it: irregular ticks, a dropped frame, and a long GC pause must
// all land on exactly the same frame as a perfect 60Hz run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cumulative, clipAt, totalFrames, createEngine } from '../frontend/reelClock.js';

const CLIPS = [{ frames: 96 }, { frames: 48 }, { frames: 72 }];   // 216 total @24fps = 9s

// A controllable clock + rAF pair. Nothing runs until we advance it.
function harness(clips = CLIPS, fps = 24) {
  let t = 0;
  const queue = [];
  const frames = [];
  const eng = createEngine({
    clips, fps,
    onFrame: f => frames.push(f),
    raf: cb => { queue.push(cb); return queue.length; },
    now: () => t
  });
  // Advance wall-clock by ms, firing whatever rAF callbacks are pending.
  // NB: t is DERIVED from the base (base + ms*i/ticks), not accumulated (t += ms/ticks). Accumulating
  // leaves t at 999.9999999999998 after 60 steps of 1000/60, which floors to frame 23 instead of 24 —
  // i.e. the harness would exhibit exactly the drift the engine exists to avoid, and blame the engine.
  const advance = (ms, ticks = 1) => {
    const base = t;
    for (let i = 1; i <= ticks; i++) {
      t = base + (ms * i) / ticks;
      const due = queue.splice(0, queue.length);
      for (const cb of due) cb(t);
    }
  };
  return { eng, advance, frames, at: () => t, setT: v => { t = v; } };
}

test('cumulative and clipAt locate the playing shot', () => {
  const cum = cumulative(CLIPS);
  assert.deepEqual(cum, [0, 96, 144]);
  assert.equal(totalFrames(CLIPS), 216);
  assert.equal(clipAt(cum, CLIPS, 0), 0);
  assert.equal(clipAt(cum, CLIPS, 95), 0);
  assert.equal(clipAt(cum, CLIPS, 96), 1, 'the boundary belongs to the NEXT clip');
  assert.equal(clipAt(cum, CLIPS, 143), 1);
  assert.equal(clipAt(cum, CLIPS, 144), 2);
  assert.equal(clipAt(cum, CLIPS, 215), 2);
  assert.equal(clipAt([], [], 0), -1, 'an empty reel has no clip');
});

test('the frame is a pure function of elapsed time', () => {
  const h = harness();
  h.eng.play();
  h.advance(1000, 60);                       // exactly one second
  assert.equal(h.eng.frame, 24, '1s at 24fps is frame 24');
  h.advance(1000, 60);
  assert.equal(h.eng.frame, 48);
});

test('irregular, dropped and stalled ticks land on the SAME frame — zero drift', () => {
  // The regression this guards: an accumulating clock (frame += 1 per tick) would report a
  // different frame for each of these. A derived clock cannot.
  const smooth = harness(); smooth.eng.play(); smooth.advance(5000, 300);   // 60Hz
  const jittery = harness(); jittery.eng.play(); jittery.advance(5000, 17);  // erratic, ~3.4Hz
  const stalled = harness(); stalled.eng.play(); stalled.advance(5000, 2);   // two ticks in 5s (GC pause)

  assert.equal(smooth.eng.frame, 120, '5s at 24fps');
  assert.equal(jittery.eng.frame, 120, 'a jittery pacer must not change WHERE we land');
  assert.equal(stalled.eng.frame, 120, 'a 2.5s stall must not lose frames');
});

test('pause freezes the frame and play resumes from it', () => {
  const h = harness();
  h.eng.play();
  h.advance(2000, 60);
  assert.equal(h.eng.frame, 48);
  h.eng.pause();
  const held = h.eng.frame;
  h.advance(5000, 60);                       // time passes while paused
  assert.equal(h.eng.frame, held, 'a paused reel does not advance');
  h.eng.play();
  h.advance(1000, 60);
  assert.equal(h.eng.frame, held + 24, 'resume continues, it does not restart');
});

test('seek re-baselines the clock mid-playback', () => {
  const h = harness();
  h.eng.play();
  h.advance(1000, 60);
  h.eng.seek(200);
  assert.equal(h.eng.frame, 200);
  h.advance(1000, 60);
  assert.equal(h.eng.frame, 200 + 24 - 216, 'it wrapped — 224 past the 216 end loops to 8');
});

test('looping wraps to the start rather than stopping', () => {
  const h = harness();
  h.eng.setLoop(true);
  h.eng.seek(200);
  h.eng.play();
  h.advance(1000, 60);                       // +24 frames from 200 → 224 → wraps to 8
  assert.equal(h.eng.frame, 8);
});

test('with looping off, playback stops at the end exactly once', () => {
  const h = harness();
  h.eng.setLoop(false);
  h.eng.seek(210);
  h.eng.play();
  h.advance(2000, 60);
  assert.equal(h.eng.playing, false, 'it stopped');
  assert.equal(h.eng.frame, 215, 'parked on the last frame, never past it');
});

test('a loop range confines playback to the in/out points', () => {
  const h = harness();
  h.eng.setRange([96, 144]);                 // just the middle clip
  h.eng.seek(96);
  h.eng.play();
  h.advance(3000, 60);                       // 72 frames — well past the 48-frame range
  const f = h.eng.frame;
  assert.ok(f >= 96 && f < 144, 'stayed inside the range: ' + f);
  assert.equal(f, 96 + (72 % 48), 'and wrapped within it');
});

test('the frame never escapes the reel, in either direction', () => {
  const h = harness();
  h.eng.seek(-500);
  assert.equal(h.eng.frame, 0);
  h.eng.seek(99999);
  assert.equal(h.eng.frame, 215, 'clamped to the last real frame, not the total');
});

test('step moves by whole frames', () => {
  const h = harness();
  h.eng.seek(100);
  h.eng.step(1); assert.equal(h.eng.frame, 101);
  h.eng.step(-25); assert.equal(h.eng.frame, 76);
  h.eng.step(24); assert.equal(h.eng.frame, 100);
});

test('retiming the reel keeps the playhead instead of jumping to zero', () => {
  const h = harness();
  h.eng.seek(150);
  h.eng.setClips([{ frames: 96 }, { frames: 24 }, { frames: 72 }]);   // middle clip shortened
  assert.equal(h.eng.total, 192);
  assert.equal(h.eng.frame, 150, 'the playhead is preserved');
  h.eng.setClips([{ frames: 10 }]);
  assert.equal(h.eng.frame, 9, 'and clamped when the reel got shorter than it');
});

test('resync after an occluded window recomputes from the clock, losing nothing', () => {
  const h = harness();
  h.eng.play();
  h.advance(1000, 60);
  // window hidden: rAF stops entirely, but wall-clock keeps running
  h.setT(h.at() + 4000);
  h.eng.resync();
  assert.equal(h.eng.frame, 120, '5s total elapsed — the hidden 4s still counted');
});

test('an empty reel never plays or divides by zero', () => {
  const h = harness([], 24);
  h.eng.play();
  assert.equal(h.eng.playing, false);
  assert.equal(h.eng.total, 0);
  assert.equal(h.eng.frame, 0);
});

test('onFrame reports integer frames only', () => {
  const h = harness();
  h.eng.play();
  h.advance(1000, 37);
  assert.ok(h.frames.length > 0);
  for (const f of h.frames) {
    assert.ok(Number.isInteger(f), 'got a fractional frame: ' + f);
    assert.ok(f >= 0 && f < 216, 'out of range: ' + f);
  }
});

test('a throwing draw costs one frame, never the whole session', () => {
  // Regression: the exception used to escape tick() before it rescheduled, so playback stopped
  // forever while `playing` stayed true and the derived clock kept advancing — a frozen playhead
  // on a reel that believed it was playing.
  let t = 0;
  const queue = [];
  let calls = 0;
  const eng = createEngine({
    clips: CLIPS, fps: 24,
    onFrame: () => { calls++; if (calls === 2) throw new Error('drawImage failed'); },
    raf: cb => { queue.push(cb); return queue.length; },
    now: () => t
  });
  const advance = (ms, ticks) => {
    const base = t;
    for (let i = 1; i <= ticks; i++) {
      t = base + (ms * i) / ticks;
      for (const cb of queue.splice(0, queue.length)) cb(t);
    }
  };
  eng.play();
  advance(500, 30);
  assert.ok(calls > 5, 'the loop survived the throw and kept drawing: ' + calls);
  assert.equal(eng.playing, true);
  assert.ok(eng.frame > 0, 'and the playhead actually moved');
});

test('play() re-arms a loop that believes it is playing but has nothing scheduled', () => {
  // A raf that hands back no handle stands in for "we are playing but nothing is queued".
  // play() must re-arm instead of early-returning into a permanently frozen playhead.
  let t = 0;
  const queue = [];
  let calls = 0;
  const eng = createEngine({
    clips: CLIPS, fps: 24,
    onFrame: () => { calls++; },
    raf: cb => { queue.push(cb); return null; },
    now: () => t
  });
  eng.play();
  assert.equal(eng.playing, true);
  queue.splice(0, queue.length);      // the scheduled tick is lost
  const before = calls;
  eng.play();                          // re-arms
  t += 100;
  for (const cb of queue.splice(0, queue.length)) cb(t);
  assert.ok(calls > before, 'play() re-armed the loop');
});
