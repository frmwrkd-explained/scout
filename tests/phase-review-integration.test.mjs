// Ticket 21 — review integration: one triage state across the chat cards and the review inbox.
//
// The chat cards (frontend/chat/generationCards.jsx) and the review inbox (frontend/ReviewInbox.jsx)
// are React/JSX and are build-verified. What is asserted here is the WIRE CONTRACT both surfaces sit
// on: a review decision is a single edit to the generation record via the one shared route
// (PATCH /api/generations/:pid/:id/review), and BOTH surfaces read that record back from the same
// place (/api/generations/:pid, mirrored into /api/state projects[].gens). So a decision made on a
// chat card is the decision the inbox reads, and vice-versa — there is no parallel chat-side state.
//
// Also asserted: the agent's enumeration path (kept vs rejected of a batch via the generations API by
// batchId) and that the Core-API reference teaches it.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, seedGen, req } from './helpers.mjs';
import { renderCoreApiRef, CORE_API_ROUTES } from '../backend/agentHome.mjs';

// The exact patch shapes the chat card sends (reviewPatchFor / ratePatchFor in generationCards.jsx),
// kept in lock-step with App.applyDecisionTo / App.ibRate so a decision agrees on every surface.
const keepPatch = { reviewState: 'kept' };
const rejectPatch = { reviewState: 'killed' };

test('a keep decision from a chat card is the record both surfaces read (list + /api/state agree)', async () => {
  freshRoot(); seedProject('neon');
  seedGen('neon', 'c1', { status: 'done', reviewState: 'new', file: 'c1.png', batchId: 'b1' });

  // chat card path: PATCH /review with { patch } (identical to App.applyDecisionTo)
  const r = await req('PATCH', '/api/generations/neon/c1/review', { patch: keepPatch });
  assert.equal(r.status, 200);
  assert.equal(r.body.reviewState, 'kept');

  // inbox reads generations from the list route → sees the same decision, no reload of a second store
  const list = (await req('GET', '/api/generations/neon')).body;
  assert.equal(list.find(g => g.id === 'c1').reviewState, 'kept');

  // both chat cards and the inbox re-render from /api/state projects[].gens — assert it carries it too
  const state = (await req('GET', '/api/state')).body;
  const proj = state.projects.find(p => p.id === 'neon');
  assert.equal(proj.gens.find(g => g.id === 'c1').reviewState, 'kept', 'state mirror agrees with the record');
});

test('a rating set on a still-new candidate keeps it and the rating agrees everywhere (App.ibRate parity)', async () => {
  freshRoot(); seedProject('neon');
  seedGen('neon', 'c2', { status: 'done', reviewState: 'new', rating: 0, file: 'c2.png' });

  // ratePatchFor('4') on a 'new' candidate = { rating: 4, reviewState: 'kept' } — same as App.ibRate
  const r = await req('PATCH', '/api/generations/neon/c2/review', { patch: { rating: 4, reviewState: 'kept' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.rating, 4);
  assert.equal(r.body.reviewState, 'kept');

  const state = (await req('GET', '/api/state')).body;
  const g = state.projects.find(p => p.id === 'neon').gens.find(x => x.id === 'c2');
  assert.equal(g.rating, 4);
  assert.equal(g.reviewState, 'kept');
});

test('the agent can enumerate kept vs rejected of a batch via the generations API by batchId', async () => {
  freshRoot(); seedProject('neon');
  // a 4-variant batch, mixed outcomes + one unrelated gen that must NOT leak into the batch tally
  seedGen('neon', 'v1', { status: 'done', file: 'v1.png', batchId: 'b7', reviewState: 'kept' });
  seedGen('neon', 'v2', { status: 'done', file: 'v2.png', batchId: 'b7', reviewState: 'killed' });
  seedGen('neon', 'v3', { status: 'done', file: 'v3.png', batchId: 'b7', reviewState: 'kept' });
  seedGen('neon', 'v4', { status: 'done', file: 'v4.png', batchId: 'b7', reviewState: 'new' });
  seedGen('neon', 'other', { status: 'done', file: 'o.png', batchId: 'bX', reviewState: 'killed' });

  const list = (await req('GET', '/api/generations/neon')).body;
  const batch = list.filter(g => g.batchId === 'b7');
  const kept = batch.filter(g => g.reviewState === 'kept').map(g => g.id);
  const rejected = batch.filter(g => g.reviewState === 'killed').map(g => g.id);
  assert.deepEqual(kept.sort(), ['v1', 'v3']);
  assert.deepEqual(rejected, ['v2']);              // 'other' (bX) excluded — batch scoping is by id
  // this is exactly the "kept 2 / rejected 1" outcome summary the grid card shows on return from triage
});

test('an inbox decision is visible on the chat card read path (killed round-trips to the list + state)', async () => {
  freshRoot(); seedProject('neon');
  seedGen('neon', 'c9', { status: 'done', reviewState: 'new', file: 'c9.png' });

  // inbox path is the SAME route with the SAME body — reject it there
  await req('PATCH', '/api/generations/neon/c9/review', { patch: rejectPatch });

  // the chat card reads projects[].gens from state → sees 'killed' with no chat-local state involved
  const state = (await req('GET', '/api/state')).body;
  assert.equal(state.projects.find(p => p.id === 'neon').gens.find(g => g.id === 'c9').reviewState, 'killed');
});

test('the Core-API reference teaches the agent to enumerate reviewState by batchId', () => {
  const genRoute = CORE_API_ROUTES.find(r => r.path === '/api/generations/:pid');
  assert.ok(/reviewState/.test(genRoute.summary), 'generations route advertises reviewState');
  assert.ok(/batchId/.test(genRoute.summary), 'generations route advertises batchId for per-batch enumeration');
  const ref = renderCoreApiRef('http://127.0.0.1:5176');
  assert.ok(/reviewState/.test(ref) && /batchId/.test(ref), 'rendered reference carries the enumeration guidance');
});
