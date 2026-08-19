// Ticket 17 — shot breakdown + shot board inside the chat. The card RENDERING is React/JSX and is
// build-verified (see the ticket's live-only criteria); what is proven hermetically here is the wire
// contract the card depends on:
//   1. the shot-board tool owns both the live-board and the staged-proposal directive types, so both
//      are gated behind its enablement by the registry;
//   2. a `proposal.breakdown` fence round-trips through the directive protocol carrying the proposed
//      shots the card stages (the one directive that carries content — nothing canonical exists yet);
//   3. Confirm's write path — POST /api/story/:pid/shots per proposed shot — lands them as canonical
//      records the Story tab reads;
//   4. an inline edit — PATCH /api/story/:pid/shots/:id — persists to the canonical shot record.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, seedShot, req } from './helpers.mjs';
import { listShots } from '../backend/story.mjs';
import { parseDirectives } from '../backend/agentRunner.mjs';
import { CHAT_TOOLS, CHAT_TOOL_BY_DIRECTIVE, chatToolById } from '../shared/chatTools.mjs';

// ── the registry entry owns every shot-board directive type (live board + staged proposal) ──
test('the shot-board tool declares its directive types and owns proposal.breakdown', () => {
  const tool = chatToolById('shot-board');
  assert.ok(tool, 'shot-board tool must exist');
  for (const t of ['show.shot-board', 'shot-board', 'breakdown', 'proposal.breakdown'])
    assert.equal(CHAT_TOOL_BY_DIRECTIVE.get(t)?.id, 'shot-board', t + ' must map to the shot-board tool');
  assert.equal(tool.enabledByDefault, false, 'shot-board must default OFF (hackathon compliance)');
  // no other tool may claim the proposal type — the gate would be ambiguous
  const owners = CHAT_TOOLS.filter(t => (t.directiveTypes || []).includes('proposal.breakdown'));
  assert.equal(owners.length, 1, 'exactly one tool owns proposal.breakdown');
});

// ── the staged proposal directive round-trips carrying its proposed shots ──
test('parseDirectives parses a proposal.breakdown fence carrying the proposed shots the card stages', () => {
  const fence = '```frameforge\n' + JSON.stringify({
    type: 'proposal.breakdown', project: 'p',
    shots: [{ no: 1, title: 'Cold open', type: 'Wide', dur: 5 }, { no: 2, title: 'Reveal', type: 'CU', dur: 3 }]
  }) + '\n```';
  const { directives } = parseDirectives('here is the breakdown\n' + fence);
  assert.equal(directives.length, 1);
  assert.equal(directives[0].type, 'proposal.breakdown');
  assert.equal(directives[0].shots.length, 2);
  assert.equal(directives[0].shots[0].title, 'Cold open');
  assert.equal(directives[0].shots[1].type, 'CU');
});

// ── Confirm's write path: proposed shots become canonical records via the existing create route ──
test('confirming a proposal writes each shot through POST /api/story/:pid/shots and the board reflects them', async () => {
  freshRoot(); seedProject('p');
  const proposed = [
    { no: 1, title: 'Cold open', type: 'Wide', dur: 5, status: 'todo' },
    { no: 2, title: 'Reveal', type: 'CU', dur: 3, status: 'todo' }
  ];
  // the card confirms by POSTing each proposed shot sequentially (ordered no/id assignment)
  for (const sh of proposed) {
    const r = await req('POST', '/api/story/p/shots', sh);
    assert.equal(r.status, 200);
    assert.ok(r.body.id, 'created shot carries an id');
  }
  const shots = listShots('p');
  assert.equal(shots.length, 2, 'both proposed shots are now canonical records');
  assert.deepEqual(shots.map(s => s.title), ['Cold open', 'Reveal']);
  assert.deepEqual(shots.map(s => s.type), ['Wide', 'CU']);
  assert.equal(shots[0].no, 1);
  assert.equal(shots[1].no, 2);

  // and the same records the Story tab / live board read (GET /api/story) carry them
  const g = await req('GET', '/api/story/p');
  assert.equal(g.status, 200);
  assert.equal(g.body.shots.length, 2);
});

// ── an inline board edit persists through the existing single-shot patch route ──
test('inline edits (retitle + status) persist through PATCH /api/story/:pid/shots/:id', async () => {
  freshRoot(); seedProject('p');
  seedShot('p', 'SH010', { no: 1, title: 'Old title', type: 'Medium', status: 'todo' });

  let r = await req('PATCH', '/api/story/p/shots/SH010', { patch: { title: 'New title', status: 'review' }, log: 'retitled' });
  assert.equal(r.status, 200);
  assert.equal(r.body.title, 'New title');
  assert.equal(r.body.status, 'review');

  // durable on the canonical record — a fresh read (what the Story tab does) sees it
  const shots = listShots('p');
  assert.equal(shots[0].title, 'New title');
  assert.equal(shots[0].status, 'review');

  // retype through the same seam
  r = await req('PATCH', '/api/story/p/shots/SH010', { patch: { type: 'CU' }, log: 'type → CU' });
  assert.equal(r.status, 200);
  assert.equal(listShots('p')[0].type, 'CU');
});

// ── reorder persists through the existing reorder route (the board's ▲/▼ path) ──
test('reordering persists through PATCH /api/story/:pid/shots/reorder', async () => {
  freshRoot(); seedProject('p');
  seedShot('p', 'SH010', { no: 1, title: 'A' });
  seedShot('p', 'SH020', { no: 2, title: 'B' });

  const r = await req('PATCH', '/api/story/p/shots/reorder', { order: ['SH020', 'SH010'] });
  assert.equal(r.status, 200);
  const byNo = Object.fromEntries(listShots('p').map(s => [s.title, s.no]));
  assert.equal(byNo.B, 1, 'B moved to first');
  assert.equal(byNo.A, 2, 'A moved to second');
});
