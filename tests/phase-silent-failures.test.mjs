/* The remaining audit findings — mostly "reported success, did nothing".
 *
 * These are the cheap half of the sweep: no data was destroyed, but the app told the user
 * something had happened when it had not, or quietly did less than it promised.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'frfg-silent-'));
process.env.SCOUT_DATA = ROOT;

const { writeMd } = await import('../backend/store.mjs');
const { setInOut, buildManifest } = await import('../backend/manifest.mjs');
const { reelToTimeline, preflight, pathUrl, toPosixAbs } = await import('../backend/reelExport.mjs');
const cat = await import('../frontend/modelCatalog.js');

test('trimming a shot with no selected take is refused, not silently ignored', () => {
  const pid = 'empty';
  fs.mkdirSync(path.join(ROOT, 'projects', pid, 'shots'), { recursive: true });
  writeMd(path.join(ROOT, 'projects', pid, 'project.md'), { id: pid, name: 'Empty' }, '');
  // a shot with NO selectedCandidate never reaches the manifest
  writeMd(path.join(ROOT, 'projects', pid, 'shots', 'SH020.md'), { id: 'SH020', no: 2, dur: 4 }, '');

  assert.equal(buildManifest(pid).entries.length, 0);
  assert.throws(() => setInOut(pid, 'SH020', 1.0, undefined), /no selected take/,
    'this used to write nothing, return 200, and toast "In point set"');
});

test('video is costed by the duration actually requested', () => {
  // The composer quotes from estimateCost; the ledger used the flat per-generation figure, so a
  // 10s clip was recorded at the 5s price and the spend column drifted from what was charged.
  const vid = cat.MODELS.find(m => m.kind === 'video');
  const five = cat.estimateCost(vid.id, { duration: 5 }).per;
  const ten = cat.estimateCost(vid.id, { duration: 10 }).per;
  assert.ok(ten > five, 'a longer clip must cost more — otherwise there is nothing to fix');
  assert.equal(cat.estimateCost(vid.id, { duration: 10 }).seconds, 10);
});

test('the reference cap comes from the catalog, not a literal', () => {
  // runKie used to slice to a hardcoded 8 (images) / 1 (video) regardless of what the catalog —
  // and therefore the composer — told the user it would send.
  const img = cat.MODELS.find(m => m.provider === 'kie' && m.kind === 'render');
  assert.equal(typeof cat.maxRefs(img.id), 'number');
  assert.ok(cat.maxRefs(img.id) > 0, 'an image model must accept at least one reference');
});

test('srcFrames is converted to timeline frames before preflight compares it', () => {
  // A 24fps source in a 30fps reel: 72 source frames is 90 timeline frames. Comparing the two
  // directly made every slow source look over-read and blocked the whole export.
  const reel = {
    project: 'p', fpsNum: 30, fpsDen: 1, width: 1920, height: 1080,
    clips: [{
      id: 'c1', shot: 'SH010', kind: 'video', startFrame: 0, frames: 80, in: 0,
      file: '/m/a.mov', srcW: 1920, srcH: 1080, srcFps: 24, srcFrames: 72,
    }],
  };
  const tl = reelToTimeline(reel, { mediaFor: () => '/m/a.mov' });
  assert.equal(tl.clips[0].srcFrames, 90, '72 source frames at 24fps is 90 frames at 30fps');
  assert.equal(preflight(tl).errors.filter(e => /frames from a/.test(e)).length, 0,
    'a source slower than the timeline must not read as over-read');
});

test('a Windows media path produces a usable file URL', () => {
  const url = pathUrl(String.raw`C:\pack\media\001.mov`);
  assert.equal(url, 'file://localhost/C:/pack/media/001.mov');
  assert.doesNotMatch(url, /%5C/, 'backslashes must never survive into the URL');
  // and the round-trip guard must be able to fail, which means comparing like with like
  const round = decodeURIComponent(url.replace(/^file:\/\/localhost/, ''));
  assert.equal(round, toPosixAbs(String.raw`C:\pack\media\001.mov`));
});
