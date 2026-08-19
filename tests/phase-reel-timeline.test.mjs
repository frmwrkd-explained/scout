// The multi-track timeline model. A clip is freely positioned (track + offset + in + frames);
// gaps are legal, overlaps within one track are not, and a shot-linked clip takes its PICTURE
// from the shot's current selection while owning its own position and length.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frfg-tl-'));
process.env.FRFG_DATA = root;

const { writeShot, getShot } = await import('../backend/story.mjs');
const {
  buildReel, layDownShots, addClip, patchClip, removeClip, setClipTake,
  patchReel, reelSources, takesForShot, normalizeClips, TRACKS
} = await import('../backend/reel.mjs');
const { rateOf } = await import('../shared/timecode.mjs');

const PID = 'ferry';
const rdir = path.join(root, 'projects', PID, 'renders');
const gdir = path.join(root, 'projects', PID, 'generations');

const gen = (id, shot, file, extra = '') => fs.writeFileSync(path.join(gdir, id + '.md'),
  `---\nid: ${id}\nshot: ${shot}\nfile: ${file}\nmodel: fal-ai/flux\nstatus: done\nstarted: ${Date.parse('2026-07-01') + Number(id.replace(/\D/g, ''))}\n${extra}---\nG\n`);

test('seed a project with three shots and multiple takes each', async () => {
  fs.mkdirSync(rdir, { recursive: true });
  fs.mkdirSync(gdir, { recursive: true });
  for (const n of ['a1', 'a2', 'a3', 'b1', 'b2']) {
    await sharp({ create: { width: 1920, height: 1080, channels: 3, background: { r: 30, g: 40, b: 50 } } }).png().toFile(path.join(rdir, n + '.png'));
  }
  // SH010 has THREE takes, one selected; SH020 has two, none selected; SH030 has none
  gen('g1', 'SH010', 'a1.png', 'reviewState: new\n');
  gen('g2', 'SH010', 'a2.png', 'reviewState: kept\n');
  gen('g3', 'SH010', 'a3.png', 'reviewState: kept\nfinal: true\n');
  gen('g4', 'SH020', 'b1.png', 'reviewState: new\n');
  gen('g5', 'SH020', 'b2.png', 'reviewState: new\n');
  writeShot(PID, { no: 1, id: 'SH010', title: 'Heron', dur: 4, prompt: 'a heron', selectedCandidate: 'g3', status: 'done' });
  writeShot(PID, { no: 2, id: 'SH020', title: 'Ferryman', dur: 2, prompt: 'coins' });
  writeShot(PID, { no: 3, id: 'SH030', title: 'Black water', dur: 3, prompt: 'lights out' });

  // EVERY take is reachable, including unreviewed ones — 'new' candidates were previously
  // invisible to any cut, and that is most of a real project
  assert.equal(takesForShot(PID, 'SH010').length, 3);
  assert.equal(takesForShot(PID, 'SH020').length, 2);
  assert.equal(takesForShot(PID, 'SH030').length, 0);
});

test('a fresh reel is EMPTY — nothing is derived behind your back', async () => {
  const r = await buildReel(PID);
  assert.equal(r.clips.length, 0);
  assert.equal(r.empty, true);
  assert.equal(r.totalFrames, 0);
  assert.deepEqual(r.tracks.map(t => t.id), ['V2', 'V1', 'A1', 'A2']);
});

test('layDownShots fills V1 end to end from the shot list', async () => {
  const r = await layDownShots(PID);
  assert.equal(r.clips.length, 3);
  assert.ok(r.clips.every(c => c.track === 'V1'));
  assert.deepEqual(r.clips.map(c => c.frames), [96, 48, 72]);
  assert.deepEqual(r.clips.map(c => c.startFrame), [0, 96, 144]);
  assert.equal(r.totalFrames, 216);
  // SH010 shows its selected take; SH020 falls back to a kept/new candidate; SH030 is a hole
  assert.equal(r.clips[0].generation, 'g3');
  assert.equal(r.clips[2].state, 'slate');
});

test('clips can be moved anywhere, and gaps are legal', async () => {
  const before = await buildReel(PID);
  const id = before.clips[1].id;
  const r = await patchClip(PID, id, { offset: 300 });
  const moved = r.clips.find(c => c.id === id);
  assert.equal(moved.startFrame, 300, 'it sits where I put it');
  assert.equal(r.totalFrames, 300 + moved.frames, 'the timeline grew to contain it');
  // the gap between clip 1 (ends 96) and this one (starts 300) is real and allowed
  const v1 = r.clips.filter(c => c.track === 'V1').sort((a, b) => a.startFrame - b.startFrame);
  assert.ok(v1[1].startFrame > v1[0].endFrame, 'a gap exists and nothing closed it');
  await patchClip(PID, id, { offset: 96 });
});

test('a clip can be trimmed without touching its neighbours', async () => {
  const before = await buildReel(PID);
  const id = before.clips[0].id;
  const nextStart = before.clips[1].startFrame;
  const r = await patchClip(PID, id, { frames: 48 });
  assert.equal(r.clips.find(c => c.id === id).frames, 48);
  assert.equal(r.clips.find(c => c.startFrame === nextStart).startFrame, nextStart, 'the neighbour did not move');
  await patchClip(PID, id, { frames: 96 });
});

test('footage that is not a shot can be added to any track', async () => {
  await sharp({ create: { width: 1080, height: 1350, channels: 3, background: { r: 90, g: 30, b: 30 } } })
    .png().toFile(path.join(rdir, 'broll.png'));
  const r = await addClip(PID, { track: 'V2', src: path.join(rdir, 'broll.png'), offset: 24, frames: 48, label: 'title card' });
  const c = r.clips.find(x => x.track === 'V2');
  assert.ok(c, 'it landed on V2');
  assert.equal(c.startFrame, 24);
  assert.equal(c.frames, 48);
  assert.equal(c.state, 'filled');
  assert.equal(c.kind, 'image');
  assert.equal(c.shot, undefined, 'it is not linked to any shot');
  // and it overlaps V1 in time, which is the entire point of a second track
  const v1 = r.clips.filter(x => x.track === 'V1');
  assert.ok(v1.some(x => x.startFrame < c.endFrame && x.endFrame > c.startFrame), 'it sits OVER the picture track');
});

test('the same shot can appear twice, each showing a different take', async () => {
  const r1 = await addClip(PID, { track: 'V1', shot: 'SH010', offset: 400, frames: 48, gen: 'g1' });
  const added = r1.clips.find(c => c.startFrame === 400);
  assert.equal(added.generation, 'g1', 'this instance is pinned to take 1');
  const first = r1.clips.find(c => c.shot === 'SH010' && c.startFrame === 0);
  assert.equal(first.generation, 'g3', 'the original still follows the shot selection');
  await removeClip(PID, added.id);
});

test('swapping a take in the timeline writes back to the shot', async () => {
  const before = await buildReel(PID);
  const clip = before.clips.find(c => c.shot === 'SH010');
  assert.equal(getShot(PID, 'SH010').selectedCandidate, 'g3');
  const r = await setClipTake(PID, clip.id, 'g2');
  assert.equal(r.clips.find(c => c.id === clip.id).generation, 'g2');
  // the decision syncs back, so Story and the review flow agree with the cut
  assert.equal(getShot(PID, 'SH010').selectedCandidate, 'g2', 'the shot followed the timeline');
  await setClipTake(PID, clip.id, 'g3');
});

test('takeIndex and takeCount expose the alternates for the UI strip', async () => {
  const r = await buildReel(PID);
  const c = r.clips.find(x => x.shot === 'SH010');
  assert.equal(c.takeCount, 3);
  assert.ok(c.takeIndex >= 0 && c.takeIndex < 3);
});

test('ripple delete closes the gap on that track only', async () => {
  await layDownShots(PID);
  await addClip(PID, { track: 'V2', src: path.join(rdir, 'broll.png'), offset: 200, frames: 24 });
  const before = await buildReel(PID);
  const v2Start = before.clips.find(c => c.track === 'V2').startFrame;
  const second = before.clips.filter(c => c.track === 'V1').sort((a, b) => a.startFrame - b.startFrame)[1];
  const r = await removeClip(PID, second.id, { ripple: true });
  const v1 = r.clips.filter(c => c.track === 'V1').sort((a, b) => a.startFrame - b.startFrame);
  assert.equal(v1.length, 2);
  assert.equal(v1[1].startFrame, v1[0].endFrame, 'the gap closed on V1');
  assert.equal(r.clips.find(c => c.track === 'V2').startFrame, v2Start, 'V2 did NOT move — rippling every track would desync an overlay');
});

test('deleting with ripple off leaves a real gap', async () => {
  await layDownShots(PID);
  const before = await buildReel(PID);
  const mid = before.clips.filter(c => c.track === 'V1')[1];
  const r = await removeClip(PID, mid.id, { ripple: false });
  const v1 = r.clips.filter(c => c.track === 'V1').sort((a, b) => a.startFrame - b.startFrame);
  assert.ok(v1[1].startFrame > v1[0].endFrame, 'the hole stayed');
});

test('normalizeClips rejects junk instead of storing it', () => {
  const rate = rateOf('24');
  assert.equal(normalizeClips([{ id: 'x', track: 'V1', offset: 0, frames: 0 }], rate).length, 0, 'zero-length dropped');
  assert.equal(normalizeClips([{ id: 'x', track: 'NOPE', offset: 0, frames: 10 }], rate)[0].track, 'V1', 'unknown track falls back');
  assert.equal(normalizeClips([{ id: 'x', track: 'V1', offset: -99, frames: 10 }], rate)[0].offset, 0, 'negative offset clamped');
  assert.equal(normalizeClips([{ id: 'x', track: 'V1', offset: 0, frames: 1 }], rate)[0].frames, 2, 'sub-2-frame clamped');
  assert.equal(normalizeClips([{ track: 'V1', offset: 0, frames: 10 }], rate).length, 0, 'a clip with no id is dropped');
  assert.deepEqual(Object.keys(normalizeClips([{ id: 'x', track: 'V1', offset: 0, frames: 10, junk: 1 }], rate)[0]).sort(),
    ['frames', 'id', 'in', 'offset', 'track'], 'unknown keys are not spread onto the record');
});

test('changing fps rescales the whole timeline, positions included', async () => {
  await layDownShots(PID);
  await patchReel(PID, { fpsNum: 25, fpsDen: 1 });
  const r = await buildReel(PID);
  const v1 = r.clips.filter(c => c.track === 'V1').sort((a, b) => a.startFrame - b.startFrame);
  assert.equal(v1[0].frames, 100, '96f @24 stays 4s, becoming 100f @25');
  assert.equal(v1[1].startFrame, 100, 'and the positions moved with it');
  await patchReel(PID, { fpsNum: 24, fpsDen: 1 });
});

test('sources expose every shot with every take, plus loose renders and assets', () => {
  const s = reelSources(PID);
  assert.equal(s.shots.length, 3);
  assert.equal(s.counts.takes, 5, 'all five takes across the project are placeable');
  const sh = s.shots.find(x => x.id === 'SH010');
  assert.equal(sh.takes.length, 3);
  assert.ok(sh.takes.every(t => t.file && t.generation), 'each take carries a real file');
  assert.ok('renders' in s && 'assets' in s);
});

test('the reel survives a round-trip through markdown', async () => {
  await layDownShots(PID);
  await addClip(PID, { track: 'A1', src: path.join(rdir, 'broll.png'), offset: 10, frames: 50, label: 'scratch' });
  const raw = fs.readFileSync(path.join(root, 'projects', PID, 'reel.md'), 'utf8');
  assert.match(raw, /track: A1/);
  assert.match(raw, /clips:/);
  const r = await buildReel(PID);
  assert.ok(r.clips.some(c => c.track === 'A1'));
});

test.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* temp */ } });

// ── magnetic timeline (Final Cut default): a trim closes its own gap ──────────────────────────
test('trimming a clip shorter pulls the following clips back — no hole', async () => {
  await layDownShots(PID);
  const before = await buildReel(PID);
  const v1 = before.clips.filter(c => c.track === 'V1').sort((a, b) => a.startFrame - b.startFrame);
  const [a, b, c] = v1;
  assert.equal(before.magnetic, true, 'magnetic is ON by default');

  const r = await patchClip(PID, a.id, { frames: a.frames - 24 });
  const after = r.clips.filter(x => x.track === 'V1').sort((x, y) => x.startFrame - y.startFrame);
  assert.equal(after[0].frames, a.frames - 24);
  assert.equal(after[1].startFrame, b.startFrame - 24, 'the next clip moved back to meet it');
  assert.equal(after[2].startFrame, c.startFrame - 24, 'and so did everything after');
  assert.equal(after[1].startFrame, after[0].endFrame, 'butted up — no gap');
  // NB: totalFrames spans every track, so assert on V1's own extent rather than the whole reel
  const v1End = x => x[x.length - 1].endFrame;
  assert.equal(v1End(after), v1End(v1.map(c => ({ endFrame: c.endFrame }))) - 24, 'the picture track got shorter');
});

test('trimming a clip longer pushes the following clips out', async () => {
  await layDownShots(PID);
  const before = await buildReel(PID);
  const v1 = before.clips.filter(c => c.track === 'V1').sort((a, b) => a.startFrame - b.startFrame);
  const r = await patchClip(PID, v1[0].id, { frames: v1[0].frames + 12 });
  const after = r.clips.filter(x => x.track === 'V1').sort((x, y) => x.startFrame - y.startFrame);
  assert.equal(after[1].startFrame, v1[1].startFrame + 12);
  assert.equal(after[1].startFrame, after[0].endFrame, 'still butted, nothing overlaps');
});

test('a head trim keeps the clip anchored and closes the gap behind it', async () => {
  await layDownShots(PID);
  const before = await buildReel(PID);
  const v1 = before.clips.filter(c => c.track === 'V1').sort((a, b) => a.startFrame - b.startFrame);
  const a = v1[0];
  // the UI sends {in, frames} with the offset untouched when magnetic
  const r = await patchClip(PID, a.id, { in: 24, frames: a.frames - 24 });
  const after = r.clips.filter(x => x.track === 'V1').sort((x, y) => x.startFrame - y.startFrame);
  assert.equal(after[0].startFrame, a.startFrame, 'it stayed anchored');
  assert.equal(after[0].in, 24, 'the source in-point moved, so the picture held');
  assert.equal(after[1].startFrame, after[0].endFrame, 'the gap closed');
});

test('magnetic off leaves the hole exactly where it was', async () => {
  await layDownShots(PID);
  await patchReel(PID, { magnetic: false });
  const before = await buildReel(PID);
  assert.equal(before.magnetic, false);
  const v1 = before.clips.filter(c => c.track === 'V1').sort((a, b) => a.startFrame - b.startFrame);
  const r = await patchClip(PID, v1[0].id, { frames: v1[0].frames - 24 });
  const after = r.clips.filter(x => x.track === 'V1').sort((x, y) => x.startFrame - y.startFrame);
  assert.equal(after[1].startFrame, v1[1].startFrame, 'nothing moved');
  assert.ok(after[1].startFrame > after[0].endFrame, 'and a real gap is sitting there');
  await patchReel(PID, { magnetic: true });
});

test('an explicit ripple flag overrides the stored magnetic mode both ways', async () => {
  await layDownShots(PID);
  const v1 = (await buildReel(PID)).clips.filter(c => c.track === 'V1').sort((a, b) => a.startFrame - b.startFrame);
  // magnetic is on, but this trim asks NOT to ripple
  const r = await patchClip(PID, v1[0].id, { frames: v1[0].frames - 24 }, { ripple: false });
  const after = r.clips.filter(x => x.track === 'V1').sort((x, y) => x.startFrame - y.startFrame);
  assert.equal(after[1].startFrame, v1[1].startFrame, 'the override won');
});

test('deleting closes the gap by default now', async () => {
  await layDownShots(PID);
  const before = await buildReel(PID);
  const v1 = before.clips.filter(c => c.track === 'V1').sort((a, b) => a.startFrame - b.startFrame);
  const r = await removeClip(PID, v1[1].id);          // no explicit ripple → magnetic decides
  const after = r.clips.filter(x => x.track === 'V1').sort((x, y) => x.startFrame - y.startFrame);
  assert.equal(after[1].startFrame, after[0].endFrame, 'the gap closed on delete');
  assert.equal(after[after.length - 1].endFrame, v1[v1.length - 1].endFrame - v1[1].frames, 'V1 got shorter by exactly that clip');
});

test('a magnetic trim never disturbs another track', async () => {
  await layDownShots(PID);
  await addClip(PID, { track: 'V2', src: path.join(rdir, 'broll.png'), offset: 300, frames: 48 });
  const before = await buildReel(PID);
  const v2Before = before.clips.find(c => c.track === 'V2').startFrame;
  const v1 = before.clips.filter(c => c.track === 'V1').sort((a, b) => a.startFrame - b.startFrame);
  const r = await patchClip(PID, v1[0].id, { frames: v1[0].frames - 36 });
  assert.equal(r.clips.find(c => c.track === 'V2').startFrame, v2Before,
    'V2 held its position — rippling every track would desync an overlay from its picture');
});

test('moving a clip never ripples, even with magnetic on', async () => {
  await layDownShots(PID);
  const before = await buildReel(PID);
  const v1 = before.clips.filter(c => c.track === 'V1').sort((a, b) => a.startFrame - b.startFrame);
  const r = await patchClip(PID, v1[0].id, { offset: 500 });
  const moved = r.clips.find(c => c.id === v1[0].id);
  assert.equal(moved.startFrame, 500);
  const others = r.clips.filter(c => c.track === 'V1' && c.id !== v1[0].id).sort((a, b) => a.startFrame - b.startFrame);
  assert.equal(others[0].startFrame, v1[1].startFrame, 'placement is deliberate — neighbours stay put');
});
