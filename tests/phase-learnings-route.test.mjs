// Dedupe-aware learning capture over HTTP.
//
// When the user corrects the agent on a shot row, that correction is written as a project learning
// (it rides into every future session's boot payload). The correction loop repeats by nature — the
// user says the same thing until the agent stops getting it wrong — so the route must dedupe, or
// project memory fills with twenty phrasings of one preference.
//
// appendLearnings() already did that dedupe for the session distiller; it just had no HTTP door.
// These tests pin the door's contract: the { added, skipped } shape, the dedupe, and the 400.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, req } from './helpers.mjs';
import { readMemory } from '../backend/memory.mjs';

test('a learning is appended to project memory and reported as added', async () => {
  freshRoot();
  seedProject('neon');
  const r = await req('POST', '/api/memory/neon/learnings', { learnings: ['prefers 2.39:1 for exteriors'] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.added, ['prefers 2.39:1 for exteriors']);
  assert.deepEqual(r.body.skipped, []);
  assert.match(readMemory('neon').body, /prefers 2\.39:1 for exteriors/);
});

test('re-sending the same correction does not duplicate it', async () => {
  freshRoot();
  seedProject('neon');
  await req('POST', '/api/memory/neon/learnings', { learnings: ['the deckhand never smiles'] });
  const r = await req('POST', '/api/memory/neon/learnings', { learnings: ['the deckhand never smiles'] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.added, [], 'an exact repeat must add nothing');
  assert.equal(r.body.skipped.length, 1);
  // and the body carries it exactly once
  const hits = readMemory('neon').body.match(/deckhand never smiles/g) || [];
  assert.equal(hits.length, 1);
});

test('a near-identical rephrasing is also deduped', async () => {
  freshRoot();
  seedProject('neon');
  await req('POST', '/api/memory/neon/learnings', { learnings: ['no passengers on the ferry ever'] });
  const r = await req('POST', '/api/memory/neon/learnings', { learnings: ['no passengers on the ferry, ever.'] });
  assert.equal(r.body.added.length, 0, 'punctuation/case variants must not create a second bullet');
});

test('several learnings can ride one call, and empties are refused', async () => {
  freshRoot();
  seedProject('neon');
  const r = await req('POST', '/api/memory/neon/learnings', { learnings: ['keep the wake in frame', '', 'sodium lamps, not tungsten'] });
  assert.equal(r.body.added.length, 2, 'blank entries are dropped, not stored');

  const bad = await req('POST', '/api/memory/neon/learnings', { learnings: ['  ', ''] });
  assert.equal(bad.status, 400);
  const none = await req('POST', '/api/memory/neon/learnings', {});
  assert.equal(none.status, 400);
});

// The single-string form is what the shot-board card sends.
test('a bare string is accepted as one learning', async () => {
  freshRoot();
  seedProject('neon');
  const r = await req('POST', '/api/memory/neon/learnings', { learnings: 'On SH010 the user asked for: slow dolly, no passengers' });
  assert.equal(r.status, 200);
  assert.equal(r.body.added.length, 1);
});
