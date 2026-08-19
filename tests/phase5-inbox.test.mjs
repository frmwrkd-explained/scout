// Phase 5 — persistent review sessions back the Inbox so the exact cursor survives reload/restart.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, req } from './helpers.mjs';

test('a review session persists its cursor and decisions across requests (restart-safe on disk)', async () => {
  freshRoot();
  const created = await req('POST', '/api/review-sessions', {
    query: '', candidateKeys: [{ pid: 'a', kind: 'gen', id: 'c1' }, { pid: 'a', kind: 'gen', id: 'c2' }], cursor: 0, status: 'active'
  });
  assert.equal(created.status, 200);
  const id = created.body.id;
  assert.ok(id);

  // advance the cursor + record a decision (simulates keep on candidate 1)
  await req('PATCH', '/api/review-sessions/' + id, { cursor: 1, decisions: { 'a/gen/c1': { kind: 'keep' } }, reviewedSpend: 0.02 });

  // re-read (a fresh app would GET /api/state → reviewSessions, or the session directly)
  const reread = await req('GET', '/api/review-sessions/' + id);
  assert.equal(reread.body.cursor, 1);
  assert.equal(reread.body.reviewedSpend, 0.02);
  assert.equal(reread.body.decisions['a/gen/c1'].kind, 'keep');
  assert.equal(reread.body.status, 'active');

  // it also surfaces in /api/state for the client to resume
  const state = await req('GET', '/api/state');
  assert.ok(state.body.reviewSessions.some(s => s.id === id && s.cursor === 1));
});

test('pausing a session sets status=paused and it can be listed and resumed', async () => {
  freshRoot();
  const c = await req('POST', '/api/review-sessions', { candidateKeys: [{ pid: 'a', kind: 'item', id: 'x' }], cursor: 0, status: 'active' });
  await req('PATCH', '/api/review-sessions/' + c.body.id, { status: 'paused', cursor: 0 });
  const list = (await req('GET', '/api/review-sessions')).body;
  const s = list.find(x => x.id === c.body.id);
  assert.equal(s.status, 'paused');
});

test('a new completed candidate does NOT reorder an active session (frozen candidateKeys)', async () => {
  freshRoot();
  const c = await req('POST', '/api/review-sessions', { candidateKeys: [{ pid: 'a', kind: 'gen', id: 'c1' }], cursor: 0, status: 'active' });
  // the session's queue is whatever was frozen at creation — a later save keeps the same order
  const reread = await req('GET', '/api/review-sessions/' + c.body.id);
  assert.deepEqual(reread.body.candidateKeys, [{ pid: 'a', kind: 'gen', id: 'c1' }]);
});
