// Phase 7 — batch variants + durable queue: one record per candidate, idempotency + deterministic
// seeds, server-enforced maxSpend ceiling, restart reconstruction, cancel preserves completed media.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, seedShot, req, patchGenFile, paths, getStorageRoot, fs, path } from './helpers.mjs';
import { createBatch, checkBatchBudget, applyBatchResult, reconstructQueue, cancelBatch, readBatch, patchBatch } from '../backend/batches.mjs';
import { listGenerations, __resetQueueForTests } from '../backend/generate.mjs';

async function ready() { freshRoot(); seedProject('neon'); seedShot('neon', 'SH010', { no: 1 }); await req('PUT', '/api/settings', { falApiKey: 'test-key' }); }

test('a batch of 8 variants creates 8 independent generation records with unique idempotency keys and deterministic seeds', async () => {
  await ready();
  const b = await req('POST', '/api/batches', { pid: 'neon', shotIds: ['SH010'], prompt: 'neon alley', model: 'fal-ai/flux/schnell', variantCount: 8, baseSeed: 1000 });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.entries.length, 8);
  const gens = listGenerations('neon').filter(g => g.batchId === b.body.id);
  assert.equal(gens.length, 8, 'expected 8 generation records');
  assert.equal(new Set(gens.map(g => g.idempotencyKey)).size, 8, 'idempotency keys not unique');
  assert.equal(new Set(gens.map(g => g.variantIndex)).size, 8, 'variant indices not unique');
  assert.equal(new Set(gens.map(g => g.seed)).size, 8, 'seeds not deterministic-unique per variant');
  assert.ok(gens.every(g => g.status === 'queued'), 'candidates should be queued (queue inert under tests)');
});

test('restart reconstruction re-enqueues remaining queued candidates without duplicating completed ones', async () => {
  await ready();
  const b = (await req('POST', '/api/batches', { pid: 'neon', prompt: 'x', model: 'fal-ai/flux/schnell', variantCount: 8 })).body;
  const gens = listGenerations('neon').filter(g => g.batchId === b.id);
  // simulate two completing before a restart
  for (const g of gens.slice(0, 2)) patchGenFile('neon', g.id, { status: 'done', reviewState: 'new' });
  __resetQueueForTests(); // simulate a process restart (empty in-memory queue; disk is the truth)
  const reEnqueued = reconstructQueue();
  assert.equal(reEnqueued, 6, 'should reconstruct exactly the 6 remaining queued candidates');
  const after = listGenerations('neon').filter(g => g.batchId === b.id);
  assert.equal(after.length, 8, 'reconstruction must not create duplicate records');
  assert.equal(after.filter(g => g.status === 'done').length, 2, 'completed candidates changed count');
});

test('maxSpend is a hard, server-enforced ceiling — the batch pauses before exceeding it', async () => {
  await ready();
  const b = (await req('POST', '/api/batches', { pid: 'neon', prompt: 'x', model: 'fal-ai/flux/schnell', variantCount: 4, maxSpend: 0.05 })).body;
  // simulate spend near the ceiling
  patchBatch(b.id, { actualSpend: 0.04, status: 'running' });
  const gate = checkBatchBudget(b.id, 0.02); // 0.04 + 0.02 = 0.06 > 0.05
  assert.ok(gate.blocked, 'budget gate should block');
  assert.match(gate.reason, /budget ceiling/);
  assert.equal(readBatch(b.id).status, 'paused', 'batch not paused at the ceiling');
});

test('budget gate allows a candidate that stays within maxSpend', async () => {
  await ready();
  const b = (await req('POST', '/api/batches', { pid: 'neon', prompt: 'x', model: 'fal-ai/flux/schnell', variantCount: 4, maxSpend: 1.00 })).body;
  patchBatch(b.id, { actualSpend: 0.02, status: 'running' });
  const gate = checkBatchBudget(b.id, 0.02);
  assert.ok(gate.ok, 'gate should allow within-budget candidate');
});

test('cancel stops queued candidates but never deletes completed candidates or their media', async () => {
  await ready();
  const b = (await req('POST', '/api/batches', { pid: 'neon', prompt: 'x', model: 'fal-ai/flux/schnell', variantCount: 4 })).body;
  const gens = listGenerations('neon').filter(g => g.batchId === b.id);
  const rdir = path.join(getStorageRoot(), 'projects', 'neon', 'renders');
  fs.mkdirSync(rdir, { recursive: true });
  // one completes with real media
  const done = gens[0];
  fs.writeFileSync(path.join(rdir, done.id + '.png'), Buffer.alloc(64, 1));
  patchGenFile('neon', done.id, { status: 'done', reviewState: 'new', file: done.id + '.png' });

  const res = await req('POST', '/api/batches/' + b.id + '/cancel');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'cancelled');
  const after = listGenerations('neon').filter(g => g.batchId === b.id);
  assert.equal(after.find(g => g.id === done.id).status, 'done', 'completed candidate wrongly changed');
  assert.ok(fs.existsSync(path.join(rdir, done.id + '.png')), 'completed media wrongly deleted');
  assert.ok(after.filter(g => g.status === 'cancelled').length >= 3, 'queued candidates not cancelled');
});

test('completed batch candidates enter the Inbox queue independently (reviewState new)', async () => {
  await ready();
  const b = (await req('POST', '/api/batches', { pid: 'neon', prompt: 'x', model: 'fal-ai/flux/schnell', variantCount: 3 })).body;
  const gens = listGenerations('neon').filter(g => g.batchId === b.id);
  // complete one → it should be a `new` candidate visible to the Inbox source
  const g = gens[0];
  patchGenFile('neon', g.id, { status: 'done', reviewState: 'new', file: g.id + '.png' });
  const state = await req('GET', '/api/state');
  const neon = state.body.projects.find(p => p.id === 'neon');
  assert.ok(neon.gens.some(x => x.id === g.id && x.reviewState === 'new'), 'completed batch candidate not in the new queue');
});
