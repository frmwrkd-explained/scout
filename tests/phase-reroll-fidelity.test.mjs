// DEV-134 — a re-roll must be THE SAME REQUEST AGAIN.
//
// rerollCandidate() replays the source generation's immutable snapshot, but it used to drop two
// fields, and both losses were silent:
//
//   · `params` — the model's OWN synced-spec settings from SchemaForm (guidance scale, steps,
//     safety tolerance, a duration enum…). backend/providers.mjs spreads these OVER the generic
//     aspect/resolution mapping, so they are not cosmetic: losing them re-runs the job on the
//     model's defaults and hands back a different image with no indication why.
//   · `sessionId` — the chat-turn attribution that makes a generation's cost roll up to the
//     session that asked for it (ticket 22). Dropped, a re-roll's spend fell off the session.
//
// The network is never touched: startGeneration() writes the queued record and returns it before
// any provider call, and that record is what these assert against.
import './_env.mjs'; // first — sets storage-root env before the store loads
// startGeneration() gates on providerReady() (backend/generate.mjs:97) before it writes the queued
// record these assertions read, and falKey() resolves `process.env.FAL_KEY || settings.falApiKey`.
// Without this line the file passes only on a machine that happens to have a real key in .env, and
// fails on CI — which runs `node --test tests/*.test.mjs` BEFORE the build, so a red test here
// means zero desktop artifacts on every platform. Same fake-key pattern as
// tests/phase-provider-timeouts.test.mjs:67. The network is still never touched.
process.env.FAL_KEY = 'test-key-134';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject } from './helpers.mjs';
import { startGeneration, rerollCandidate, listGenerations } from '../backend/generate.mjs';

const PID = 'rerollproj';
const PARAMS = { guidance_scale: 7.5, num_inference_steps: 40, safety_tolerance: '5', output_format: 'jpeg' };

function seedSource(extra = {}) {
  freshRoot();
  seedProject(PID);
  return startGeneration({
    pid: PID, shot: 'SH010', prompt: 'a lighthouse in a storm, cinematic',
    model: 'fal-ai/nano-banana-pro', aspect: '2.39:1', resolution: '2K', seed: 1234,
    params: PARAMS, sessionId: 'chat-abc-1', ...extra
  });
}

test('a re-roll carries the model-specific params forward', () => {
  const src = seedSource();
  assert.deepEqual(src.params, PARAMS, 'precondition: the source stored its params');

  const rr = rerollCandidate(PID, src.id, {});
  assert.ok(rr, 'reroll must produce a candidate');
  // the regression: this used to be {} — the tuned knobs vanished and the job silently re-ran on
  // the model's documented defaults
  assert.deepEqual(rr.params, PARAMS);
});

test('a re-roll carries sessionId so its cost stays attributed to the chat turn', () => {
  const src = seedSource();
  const rr = rerollCandidate(PID, src.id, {});
  assert.equal(rr.sessionId, 'chat-abc-1');
});

test('a re-roll still replays the rest of the snapshot and records lineage', () => {
  const src = seedSource();
  const rr = rerollCandidate(PID, src.id, {});
  assert.equal(rr.prompt, src.prompt);
  assert.equal(rr.model, src.model);
  assert.equal(rr.aspect, '2.39:1');
  assert.equal(rr.resolution, '2K');
  assert.equal(rr.shot, 'SH010');
  assert.equal(rr.parentGeneration, src.id, 'lineage must point back at the source');
  assert.notEqual(rr.id, src.id, 'a re-roll is a NEW candidate, never an edit in place');
  assert.equal(rr.tool, 'reroll');
});

test('seed: replayed by default, cleared with freshSeed (variety, not reproduction)', () => {
  const src = seedSource();
  assert.equal(rerollCandidate(PID, src.id, {}).seed, 1234);
  assert.equal(rerollCandidate(PID, src.id, { freshSeed: true }).seed, null);
});

test('a source with no params re-rolls to an empty object, not undefined', () => {
  freshRoot();
  seedProject(PID);
  const src = startGeneration({
    pid: PID, prompt: 'plain', model: 'fal-ai/flux/schnell', aspect: '16:9'
  });
  const rr = rerollCandidate(PID, src.id, {});
  assert.deepEqual(rr.params, {});
  assert.equal(rr.sessionId, null);
});

test('re-rolling an unknown id is a null, not a throw', () => {
  freshRoot();
  seedProject(PID);
  assert.equal(rerollCandidate(PID, 'gen-does-not-exist', {}), null);
});

test('each re-roll appends a candidate rather than replacing the source', () => {
  const src = seedSource();
  rerollCandidate(PID, src.id, {});
  rerollCandidate(PID, src.id, {});
  const all = listGenerations(PID);
  assert.equal(all.length, 3, 'source + two re-rolls');
  // and every one of them kept the tuned params
  for (const g of all) assert.deepEqual(g.params, PARAMS);
});
