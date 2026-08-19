// Ticket 22 — cost surfacing in the chat. The session-attribution seam: a generation started FROM a
// chat session (manual mode / agent confirm-card Proceed) carries the session id onto its generation
// record AND onto the ledger ref, so the session header can sum spend and the Costs page can attribute
// it. Plus the confirm-card's two backend outcomes: Proceed queues a batch (attributed); Decline runs
// NOTHING and appends a compact system event so the agent sees it. All hermetic — no FAL key spends,
// the provider queue is inert under FRFG_TEST so candidates stay `queued` on disk.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, seedShot, req } from './helpers.mjs';
import { ledgerRef, listGenerations } from '../backend/generate.mjs';
import { ledger, getLedger } from '../backend/ledger.mjs';
import { listBatches } from '../backend/batches.mjs';

async function ready(pid = 'neon') { freshRoot(); seedProject(pid); await req('PUT', '/api/settings', { falApiKey: 'test-key' }); return pid; }

test('ledgerRef: pid/shot prefix is preserved verbatim; a chat session appends a strippable suffix', () => {
  assert.equal(ledgerRef('p', 'SH010', null), 'p/SH010', 'no session → unchanged pid/shot');
  assert.equal(ledgerRef('p', null, null), 'p', 'no session, no shot → bare pid');
  assert.equal(ledgerRef('p', 'SH010', 'chat-1'), 'p/SH010 · chat:chat-1');
  assert.equal(ledgerRef('p', null, 'chat-1'), 'p · chat:chat-1');
  // The Costs page strips the suffix (split(' · ')[0]) before its per-project match — verify that
  // stripping recovers the original pid/shot prefix so per-project totals are unaffected.
  assert.equal(ledgerRef('p', null, 'chat-1').split(' · ')[0], 'p');
  assert.equal(ledgerRef('p', 'SH010', 'chat-1').split(' · ')[0], 'p/SH010');
});

test('ledger round-trips a chat-attributed ref so the Costs page can read the session', () => {
  freshRoot();
  const ref = ledgerRef('neon', 'SH010', 'chat-abc');
  ledger({ service: 'fal', op: 'image', model: 'fal-ai/flux/schnell', units: '1 img', cost: 0.02, ref });
  const rows = getLedger();
  assert.equal(rows[0].ref, 'neon/SH010 · chat:chat-abc');
  assert.match(rows[0].ref, /chat:chat-abc/, 'ledger ref carries the session for attribution');
});

test('POST /api/generate carries sessionId onto the generation record', async () => {
  const pid = await ready();
  const id = (await req('POST', '/api/chat/sessions', { project: pid, title: 'S' })).body.id;
  const gen = await req('POST', '/api/generate', { pid, prompt: 'neon alley', model: 'fal-ai/flux/schnell', sessionId: id });
  assert.equal(gen.status, 200, JSON.stringify(gen.body));
  assert.equal(gen.body.sessionId, id, 'the generation record must record the chat session that started it');

  // reload from disk — the datastore is the source of truth
  const onDisk = listGenerations(pid).find(g => g.id === gen.body.id);
  assert.equal(onDisk.sessionId, id, 'sessionId must survive on the persisted record');
});

test('a generation started OUTSIDE chat has a null sessionId (attribution is opt-in)', async () => {
  const pid = await ready();
  const gen = await req('POST', '/api/generate', { pid, prompt: 'x', model: 'fal-ai/flux/schnell' });
  assert.equal(gen.status, 200);
  assert.equal(gen.body.sessionId, null, 'no sessionId supplied → no attribution');
});

test('confirm-card Proceed: POST /api/batches with sessionId attributes every candidate to the session', async () => {
  const pid = await ready();
  seedShot(pid, 'SH010', { no: 1 });
  const id = (await req('POST', '/api/chat/sessions', { project: pid })).body.id;

  // This is exactly what the confirm card's Proceed fires: the batch request + the session id.
  const batch = await req('POST', '/api/batches', {
    pid, shotIds: ['SH010'], prompt: 'storyboard frame', model: 'fal-ai/flux/schnell', variantCount: 4, sessionId: id
  });
  assert.equal(batch.status, 200, JSON.stringify(batch.body));
  assert.equal(batch.body.sessionId, id, 'the batch record records its originating session');

  const cands = listGenerations(pid).filter(g => g.batchId === batch.body.id);
  assert.equal(cands.length, 4, 'four candidates queued');
  assert.ok(cands.every(g => g.sessionId === id), 'every candidate must carry the session id for spend attribution');
});

test('confirm-card Decline: appends a compact system event and queues NOTHING', async () => {
  const pid = await ready();
  const id = (await req('POST', '/api/chat/sessions', { project: pid })).body.id;

  const before = listBatches().length;
  const gensBefore = listGenerations(pid).length;

  // The decline path: a system event through the existing seam (api.chatSystemEvent → this route).
  const ev = await req('POST', '/api/chat/sessions/' + id + '/system-event', { text: 'Declined: 9 frames on FLUX Schnell (~$0.140) — not queued.' });
  assert.equal(ev.status, 200);

  // the message is on the transcript so the agent sees it next turn
  const msgs = (await req('GET', '/api/chat/sessions/' + id)).body.messages;
  const sys = msgs.filter(m => m.role === 'system');
  assert.equal(sys.length, 1, 'exactly one system event appended');
  assert.match(sys[0].text, /^Declined:/, 'the decline note tells the agent what was declined');

  // and NOTHING ran
  assert.equal(listBatches().length, before, 'declining must not queue a batch');
  assert.equal(listGenerations(pid).length, gensBefore, 'declining must not create any generation');
});
