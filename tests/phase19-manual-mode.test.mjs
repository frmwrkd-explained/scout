// Ticket 19 — Manual mode: the manual-turn record path. A manual generation composed in the chat
// composer starts through the normal /api/generate|/api/batches routes (covered elsewhere); this
// asserts the SESSION-side record: POST /manual-turn persists a user message + an assistant message
// carrying the generation directive at a ⟦frameforge:0⟧ marker (ticket 12's shape), so the same inline
// cards (ticket 14) render it — and it all survives a reload. No live agent, no FAL key: hermetic.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, req, server_ } from './helpers.mjs';

test('manual-turn: single generation directive is recorded and survives reload', async () => {
  freshRoot();
  seedProject('p');
  await server_();

  const created = await req('POST', '/api/chat/sessions', { project: 'p', title: 'Manual' });
  assert.equal(created.status, 200);
  const id = created.body.id;

  const directive = { type: 'generation', ref: 'gen-123', project: 'p' };
  const rec = await req('POST', '/api/chat/sessions/' + id + '/manual-turn', {
    userText: 'Manual · Image · FLUX Schnell\n“a wide desert”', directive
  });
  assert.equal(rec.status, 200);
  assert.equal(rec.body.ok, true);
  assert.equal(rec.body.turn, 0, 'first manual turn should be turn 0');

  // reload from disk — the datastore is the source of truth
  const reloaded = await req('GET', '/api/chat/sessions/' + id);
  assert.equal(reloaded.status, 200);
  const msgs = reloaded.body.messages;
  assert.equal(msgs.length, 2, 'expected user + assistant messages, got ' + msgs.length);

  const [user, asst] = msgs;
  assert.equal(user.role, 'user');
  assert.match(user.text, /Manual · Image · FLUX Schnell/);

  assert.equal(asst.role, 'assistant');
  assert.match(asst.text, /⟦frameforge:0⟧/, 'assistant text must carry the inline directive marker');
  assert.equal(asst.directives.length, 1);
  assert.deepEqual(asst.directives[0], directive, 'directive must round-trip verbatim');
  assert.equal(asst.cost, 0, 'the chat message itself carries no cost — the generation record does');
});

test('manual-turn: a batch directive records with the batch id envelope, and turns increment', async () => {
  freshRoot();
  seedProject('p');
  await server_();

  const id = (await req('POST', '/api/chat/sessions', { project: 'p' })).body.id;

  // first manual turn
  await req('POST', '/api/chat/sessions/' + id + '/manual-turn', {
    userText: 'first', directive: { type: 'generation', ref: 'gen-a', project: 'p' }
  });
  // second manual turn — a variant batch
  const batchDir = { type: 'generation.batch', batch: 'batch-xyz', project: 'p' };
  const rec2 = await req('POST', '/api/chat/sessions/' + id + '/manual-turn', {
    userText: 'Manual · Image · 4×', directive: batchDir
  });
  assert.equal(rec2.status, 200);
  assert.equal(rec2.body.turn, 1, 'second manual turn should be turn 1');

  const msgs = (await req('GET', '/api/chat/sessions/' + id)).body.messages;
  assert.equal(msgs.length, 4, 'two manual turns → four messages');
  const lastAsst = msgs[3];
  assert.deepEqual(lastAsst.directives[0], batchDir);
  assert.match(lastAsst.text, /⟦frameforge:0⟧/);
});

test('manual-turn: a missing directive is rejected, not silently persisted', async () => {
  freshRoot();
  seedProject('p');
  await server_();

  const id = (await req('POST', '/api/chat/sessions', { project: 'p' })).body.id;
  const bad = await req('POST', '/api/chat/sessions/' + id + '/manual-turn', { userText: 'no directive here' });
  assert.equal(bad.status, 400);

  const msgs = (await req('GET', '/api/chat/sessions/' + id)).body.messages;
  assert.equal(msgs.length, 0, 'a rejected manual turn must not append any messages');
});

test('manual-turn: an unknown session id is a 404', async () => {
  freshRoot();
  seedProject('p');
  await server_();
  const miss = await req('POST', '/api/chat/sessions/chat-does-not-exist/manual-turn', {
    directive: { type: 'generation', ref: 'gen-x' }
  });
  assert.equal(miss.status, 404);
});
