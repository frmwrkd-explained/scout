// Phase 2 — generations are the canonical review candidates. Each generation record carries its own
// review decision (reviewState/rating/final); decisions are independent; a shot points at its chosen
// candidate via selectedCandidate; reroll records parentGeneration; promotion is idempotent; and NO
// <shot>_gen triage item is ever written.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, seedShot, seedGen, req, paths, getStorageRoot, fs, path } from './helpers.mjs';

function threeCandidates() {
  const root = freshRoot();
  seedProject('neon');
  seedShot('neon', 'SH010', { no: 1, title: 'Broken drone', dur: 4 });
  // three independent completed candidates for one shot, each with a real render file
  const rdir = path.join(getStorageRoot(), 'projects', 'neon', 'renders');
  fs.mkdirSync(rdir, { recursive: true });
  ['c1', 'c2', 'c3'].forEach(id => {
    fs.writeFileSync(path.join(rdir, 'SH010_' + id + '.png'), Buffer.alloc(256, 1));
    seedGen('neon', id, { shot: 'SH010', status: 'done', reviewState: 'new', file: 'SH010_' + id + '.png', schema: 2, cost: 0.02, promotedAssets: [] });
  });
  return root;
}

test('three candidates for one shot are three independent generation records', async () => {
  threeCandidates();
  const r = await req('GET', '/api/generations/neon');
  assert.equal(r.status, 200);
  const forShot = r.body.filter(g => g.shot === 'SH010');
  assert.equal(forShot.length, 3);
  assert.deepEqual(new Set(forShot.map(g => g.id)), new Set(['c1', 'c2', 'c3']));
});

test('kill / rate / final decisions stay independent; final sets shot.selectedCandidate; export uses it', async () => {
  threeCandidates();
  const kill = await req('PATCH', '/api/generations/neon/c1/review', { patch: { reviewState: 'killed' } });
  assert.equal(kill.status, 200);
  assert.equal(kill.body.reviewState, 'killed');

  const rate = await req('PATCH', '/api/generations/neon/c2/review', { patch: { rating: 3 } });
  assert.equal(rate.status, 200);
  assert.equal(rate.body.rating, 3);

  const fin = await req('PATCH', '/api/generations/neon/c3/review', { patch: { reviewState: 'kept', final: true } });
  assert.equal(fin.status, 200);
  assert.equal(fin.body.final, true);

  // decisions are independent
  const all = (await req('GET', '/api/generations/neon')).body;
  assert.equal(all.find(g => g.id === 'c1').reviewState, 'killed');
  assert.equal(all.find(g => g.id === 'c2').rating, 3);
  assert.equal(all.find(g => g.id === 'c2').reviewState, 'new'); // rating alone didn't kill/keep-flip c2 away from new? (rating keeps 'new')
  assert.equal(all.find(g => g.id === 'c3').final, true);

  // shot.selectedCandidate points at the final candidate
  const story = await req('GET', '/api/story/neon');
  const sh = story.body.shots.find(s => s.id === 'SH010');
  assert.equal(sh.selectedCandidate, 'c3');
  assert.equal(sh.status, 'done');

  // export/remotion resolves the selected candidate's file
  const rem = await req('POST', '/api/export/neon');
  assert.equal(rem.status, 200);
  const shotsJson = JSON.parse(fs.readFileSync(path.join(getStorageRoot(), 'projects', 'neon', 'export', 'shots.json'), 'utf8'));
  const exportedShot = shotsJson.shots.find(s => s.id === 'SH010');
  assert.equal(exportedShot.selectedCandidate, 'c3');
  assert.ok(exportedShot.files.some(f => /SH010_c3\.png$/.test(f.file)), 'export did not use the selected candidate file');
});

test('no <shot>_gen triage item is written by any candidate action', async () => {
  threeCandidates();
  await req('PATCH', '/api/generations/neon/c3/review', { patch: { reviewState: 'kept', final: true } });
  await req('POST', '/api/generations/neon/c1/save-to-shot');
  const itemsDir = paths.itemsDir('neon');
  const items = fs.existsSync(itemsDir) ? fs.readdirSync(itemsDir).filter(f => f.endsWith('.md')) : [];
  assert.equal(items.filter(f => f.includes('_gen')).length, 0, 'a <shot>_gen item was written');
});

test('reroll creates a new candidate whose parentGeneration is the source', async () => {
  threeCandidates();
  await req('PUT', '/api/settings', { falApiKey: 'test-key' }); // fal-ai model → provider ready (queue is inert under tests)
  const r = await req('POST', '/api/generations/neon/c2/reroll', { freshSeed: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.parentGeneration, 'c2');
  assert.equal(r.body.tool, 'reroll');
  assert.equal(r.body.shot, 'SH010');
  assert.notEqual(r.body.id, 'c2');
});

test('promotion to a board is idempotent — repeating it does not create duplicate files', async () => {
  threeCandidates();
  const a = await req('POST', '/api/generations/neon/c3/promote', { scope: 'board', folder: 'selects' });
  assert.equal(a.status, 200);
  const b = await req('POST', '/api/generations/neon/c3/promote', { scope: 'board', folder: 'selects' });
  assert.equal(b.status, 200);
  assert.equal(b.body.idempotent, true);
  const boardDir = path.join(getStorageRoot(), 'projects', 'neon', 'context', 'selects');
  const media = fs.readdirSync(boardDir).filter(f => !f.endsWith('.meta.md'));
  assert.equal(media.length, 1, 'promotion created duplicate media files');
  // provenance sidecar exists and records the source generation
  const sidecar = fs.readdirSync(boardDir).find(f => f.endsWith('.meta.md'));
  assert.ok(sidecar, 'no provenance sidecar written');
  assert.match(fs.readFileSync(path.join(boardDir, sidecar), 'utf8'), /sourceGeneration: c3/);
  // the candidate records the promotion
  const g = (await req('GET', '/api/generations/neon')).body.find(x => x.id === 'c3');
  assert.equal(g.promotedAssets.length, 1);
});

test('promotion to the global library succeeds and writes an activity entry (no nested-undefined crash)', async () => {
  threeCandidates();
  const a = await req('POST', '/api/generations/neon/c3/promote', { scope: 'library', folder: '' });
  assert.equal(a.status, 200, 'library promote failed: ' + JSON.stringify(a.body));
  assert.equal(a.body.scope, 'library');
  assert.equal(a.body.idempotent, false);
  const libDir = path.join(getStorageRoot(), 'library');
  const media = fs.readdirSync(libDir).filter(f => !f.endsWith('.meta.md'));
  assert.equal(media.length, 1);
  // the activity feed must have been written (ref:undefined for library scope used to throw)
  const state = await req('GET', '/api/state');
  assert.ok(state.body.activity.some(e => /promoted/i.test(e.t)), 'promotion activity not recorded');
});

test('killing the selected candidate clears the shot selection; keeping preserves older candidates', async () => {
  threeCandidates();
  // keep c1 first → becomes selection (no selection yet)
  await req('PATCH', '/api/generations/neon/c1/review', { patch: { reviewState: 'kept' } });
  let sh = (await req('GET', '/api/story/neon')).body.shots.find(s => s.id === 'SH010');
  assert.equal(sh.selectedCandidate, 'c1');
  // keep c2 → does NOT steal the selection (c1 already selected)
  await req('PATCH', '/api/generations/neon/c2/review', { patch: { reviewState: 'kept' } });
  sh = (await req('GET', '/api/story/neon')).body.shots.find(s => s.id === 'SH010');
  assert.equal(sh.selectedCandidate, 'c1', 'keeping a second candidate wrongly stole the selection');
  // kill c1 → selection clears (c1 was selected)
  await req('PATCH', '/api/generations/neon/c1/review', { patch: { reviewState: 'killed' } });
  sh = (await req('GET', '/api/story/neon')).body.shots.find(s => s.id === 'SH010');
  assert.equal(sh.selectedCandidate, null);
});
