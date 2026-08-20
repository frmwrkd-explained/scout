// M4 / T13 — DECIDE, the one queue.
//
// The thing under test is not "a card can be accepted". It is that there is ONE accept path and ONE
// reject path for all six kinds, that a rejection cannot happen without one of the five reasons,
// and that nothing is ever silent: a decision lands in the card the agent can read.

import './_env.mjs'; // first — sets the storage root before store.mjs captures it
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { freshRoot, getStorageRoot } from './helpers.mjs';
import {
  CARD_KINDS, REJECT_REASONS, listProposals, getProposal, propose, accept, reject,
  registerProposalRoutes, ProposalError,
} from '../backend/proposals.mjs';
import { saveCollection, getCollection } from '../backend/collections.mjs';

const R = () => getStorageRoot();

let baseUrl;
async function server() {
  if (baseUrl) return baseUrl;
  const app = express();
  app.use(express.json());
  registerProposalRoutes(app, {});
  const s = await new Promise(resolve => { const x = app.listen(0, '127.0.0.1', () => resolve(x)); });
  s.unref();
  baseUrl = 'http://127.0.0.1:' + s.address().port;
  return baseUrl;
}
async function req(method, p, body) {
  const r = await fetch((await server()) + p, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try { parsed = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: parsed };
}

// The effects live in modules other people own (records / memory / territory). Injecting them is
// how this file tests the queue rather than testing whether those modules have landed yet.
function spyDeps() {
  const calls = [];
  return {
    calls,
    moveRecord: (p, o) => { calls.push(['moveRecord', p, o.to]); return { path: p, from: 'new', to: o.to }; },
    archiveRecord: (p, o) => { calls.push(['archiveRecord', p, o.reason]); return { path: p, reason: o.reason }; },
    saveTerritory: (id, patch) => { calls.push(['saveTerritory', id, patch.access]); return { id, ...patch }; },
    saveLearning: (id, patch) => { calls.push(['saveLearning', id, patch.status]); return { id, ...patch }; },
    writeMe: (body) => { calls.push(['writeMe', body]); return { ok: true }; },
    logEvent: (ev) => { calls.push(['log', ev.type, ev.detail && ev.detail.decision ? ev.detail.decision : ev.detail && ev.detail.effect]); return ev; },
  };
}

const GUEST = {
  id: 'guest',
  query: { path: 'data/guests/**' },
  fields: [
    { key: 'name', type: 'text', primary: true },
    { key: 'status', type: 'status', options: ['new', 'shortlist', 'booked'], gate: true },
  ],
};

// One card of every kind, as an agent would send them.
function sixCards() {
  return [
    { kind: 'finding', title: 'Maria Santos', record: 'data/guests/maria-santos.md',
      why: 'Nurse turned cook. Tells her own story, no brand deals in 40 posts.' },
    { kind: 'outbound', title: 'Intro post in Nurses PH', channel: 'facebook-group', territory: 'nurses-ph',
      subject: 'intro post', message: 'Hi all — looking for nurses who cook. Reply if that is you.',
      why: 'The group allows one intro post a month and we have not used ours.' },
    { kind: 'territory', title: 'OFW Stories', territory: 'ofw-stories', url: 'https://facebook.com/groups/ofw',
      why: '3 of the last 6 shortlists are members of this group.' },
    { kind: 'learning', title: 'Video converts', claim: 'People who post video reply more than photo-only accounts',
      evidence: ['data/guests/maria-santos.md', 'data/guests/jun-cruz.md'],
      why: 'Nine of the last eleven bookings posted video. None of the photo-only ones replied.' },
    { kind: 'schema', change: 'field', collection: 'guest', field: { key: 'on_camera', type: 'checkbox' },
      evidence: ['data/guests/maria-santos.md', 'data/guests/jun-cruz.md'],
      why: '14 of your last 20 shortlists post video. Worth filtering on.' },
    { kind: 'question', title: 'Which Maria?', question: 'Two accounts, same name — which one do you mean?',
      why: 'I cannot tell them apart and guessing would poison the dedupe.' },
  ];
}

// ── the queue ──────────────────────────────────────────────────────────────────────────────────

test('a card of every kind lands in one queue, as one file each', () => {
  freshRoot();
  for (const c of sixCards()) propose(c, { actor: 'scout-fb' });
  const open = listProposals({ status: 'open' });
  assert.deepEqual(open.map(c => c.kind).sort(), [...CARD_KINDS].sort(), 'all six kinds, one queue');
  assert.equal(fs.readdirSync(path.join(R(), 'proposals')).length, 6, 'one file per card (Law 6)');
  assert.equal(open[0].created_by, 'scout-fb');
  assert.deepEqual(listProposals({ kind: 'schema' }).map(c => c.change), ['field']);
});

test('the queue is a queue — oldest first, so card 200 is not a random sample of the morning', async () => {
  freshRoot();
  const first = propose({ ...sixCards()[3], title: 'earlier' }, { actor: 'scout-fb' });
  await new Promise(r => setTimeout(r, 5));
  const second = propose({ ...sixCards()[3], title: 'later' }, { actor: 'scout-fb' });
  assert.deepEqual(listProposals({ status: 'open' }).map(c => c.id), [first.id, second.id]);
});

test('every kind is accepted through the one accept() path, and each performs its own effect', async () => {
  freshRoot();
  saveCollection(GUEST);
  const deps = spyDeps();
  const cards = sixCards().map(c => propose(c, { actor: 'scout-fb' }));

  const report = [];
  for (const c of cards) {
    const answer = c.kind === 'question' ? 'The one with 12k followers.' : null;
    const done = await accept(c.id, { actor: 'crystal', answer, deps });
    assert.equal(done.status, 'accepted');
    assert.equal(done.decided_by, 'crystal');
    report.push(c.kind.padEnd(10) + ' → ' + done.effect);
  }

  const did = deps.calls.map(c => c[0]);
  assert.ok(did.includes('moveRecord'), 'a finding must move the record');
  assert.deepEqual(deps.calls.find(c => c[0] === 'moveRecord').slice(1, 3), ['data/guests/maria-santos.md', 'shortlist']);
  assert.equal(deps.calls.find(c => c[0] === 'saveTerritory')[2], 'requested', 'accepting a territory means MAY REQUEST to join');
  assert.equal(deps.calls.find(c => c[0] === 'saveLearning')[2], 'active', 'an accepted learning enters memory');
  // the schema card is the one with a real module behind it — the field must actually exist now
  assert.ok((getCollection('guest').fields || []).some(f => f.key === 'on_camera'), 'the field was never created');
  // outbound: the exact wording is stamped approved, and it is the wording that was proposed
  const outbound = getProposal(cards[1].id);
  assert.ok(outbound.approved_at && outbound.approved_by === 'crystal');
  assert.match(outbound.message, /looking for nurses who cook/);
  assert.equal(listProposals({ status: 'open' }).length, 0, 'the queue is empty');

  process.stdout.write('\n  SIX KINDS · one accept path\n' + report.map(r => '    ' + r).join('\n') + '\n');
});

// ── rejection ──────────────────────────────────────────────────────────────────────────────────

test('a rejection with no reason is refused, and the message names the five', async () => {
  freshRoot();
  const c = propose(sixCards()[3], { actor: 'scout-fb' });
  await assert.rejects(() => reject(c.id, { actor: 'crystal' }), (e) => {
    assert.equal(e.status, 400);
    for (const r of REJECT_REASONS) assert.ok(e.message.includes(r), 'missing "' + r + '" from: ' + e.message);
    return true;
  });
  await assert.rejects(() => reject(c.id, { reason: 'not-feeling-it', actor: 'crystal' }), /is not a rejection reason/);
  assert.equal(getProposal(c.id).status, 'open', 'a refused rejection must leave the card open');
});

test('POST /api/proposals/:id/reject with no reason is a 400; with a reason it is recorded and readable', async () => {
  freshRoot();
  const c = propose(sixCards()[2], { actor: 'scout-fb' });

  const bad = await req('POST', '/api/proposals/' + c.id + '/reject', { actor: 'crystal' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /off-target/);

  const good = await req('POST', '/api/proposals/' + c.id + '/reject', { reason: 'off-target', actor: 'crystal' });
  assert.equal(good.status, 200);
  assert.equal(good.body.status, 'rejected');
  assert.equal(good.body.reason, 'off-target');

  // Never silent: the reason is in the card the agent reads, and it says what to do about it.
  const onDisk = fs.readFileSync(path.join(R(), 'proposals', c.id + '.md'), 'utf8');
  assert.match(onDisk, /reason: off-target/);
  assert.match(onDisk, /Do not re-propose this without new evidence/);
  assert.equal(listProposals({ status: 'rejected' }).length, 1);
  assert.equal(listProposals({ status: 'open' }).length, 0);

  process.stdout.write('\n  REJECT · no reason → ' + bad.status + ' "' + bad.body.error + '"'
    + '\n           off-target → ' + good.status + ' recorded as: ' + getProposal(c.id).notice + '\n');
});

test('rejecting a finding archives the record with the same reason — that is what moves the score', async () => {
  freshRoot();
  const deps = spyDeps();
  const c = propose(sixCards()[0], { actor: 'scout-fb' });
  const out = await reject(c.id, { reason: 'off-target', actor: 'crystal', deps });
  assert.equal(out.effect, 'archived');
  assert.deepEqual(deps.calls.find(x => x[0] === 'archiveRecord').slice(1), ['data/guests/maria-santos.md', 'off-target']);
});

test('a rejection is never blocked by a missing module — the human can always say no', async () => {
  freshRoot();
  // no deps, and records.mjs may not exist yet: the card must still reject cleanly
  const c = propose(sixCards()[0], { actor: 'scout-fb' });
  const out = await reject(c.id, { reason: 'duplicate', actor: 'crystal', deps: {} });
  assert.equal(out.status, 'rejected');
  assert.equal(out.reason, 'duplicate');
});

test('a decided card cannot be decided again', async () => {
  freshRoot();
  const deps = spyDeps();
  const c = propose(sixCards()[1], { actor: 'scout-fb' });
  await accept(c.id, { actor: 'crystal', deps });
  await assert.rejects(() => accept(c.id, { actor: 'crystal', deps }), (e) => e.status === 409);
  await assert.rejects(() => reject(c.id, { reason: 'duplicate', actor: 'crystal', deps }), (e) => e.status === 409);
});

// ── what a card must carry ─────────────────────────────────────────────────────────────────────

test('a schema card must carry the agent\'s evidence, never an opinion', () => {
  freshRoot();
  const { evidence, ...noEvidence } = sixCards()[4];
  assert.throws(() => propose(noEvidence, { actor: 'scout-fb' }), /evidence\[\] — what you observed/);
  assert.throws(() => propose({ ...sixCards()[4], why: '' }, { actor: 'scout-fb' }), /every card carries `why`/);
});

test('views are free — proposing one is refused and the route that allows it is named', () => {
  freshRoot();
  assert.throws(
    () => propose({ kind: 'schema', change: 'view', why: 'nicer', evidence: ['x'] }, { actor: 'scout-fb' }),
    /views are free and reversible — save it with PUT \/api\/views/,
  );
});

test('an unknown kind is refused and the error names the legal set', () => {
  freshRoot();
  try {
    propose({ kind: 'vibe', why: 'because' }, { actor: 'scout-fb' });
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof ProposalError);
    for (const k of CARD_KINDS) assert.ok(e.message.includes(k), 'missing "' + k + '" from: ' + e.message);
  }
});

test('a card that needs its payload says which key is missing', () => {
  freshRoot();
  assert.throws(() => propose({ kind: 'finding', why: 'looks good' }), /needs `record`/);
  // the collision that once archived a proposal file instead of the guest
  assert.throws(
    () => propose({ kind: 'finding', why: 'x', path: 'data/guests/maria-santos.md' }),
    /points at its record with `record`, not `path`/);
  assert.throws(() => propose({ kind: 'outbound', channel: 'dm', why: 'x' }), /needs `message`/);
  assert.throws(() => propose({ kind: 'question', why: 'x' }), /needs `question`/);
});

// ── the invariant that matters most ────────────────────────────────────────────────────────────

test('an effect that throws leaves the card open — never accepted-with-nothing-behind-it', async () => {
  freshRoot();
  const c = propose(sixCards()[0], { actor: 'scout-fb' });
  await assert.rejects(() => accept(c.id, {
    actor: 'crystal',
    deps: { moveRecord: () => { throw new Error('the store said no'); } },
  }), /the store said no/);
  assert.equal(getProposal(c.id).status, 'open', 'the card was stamped accepted while its effect failed');
});

test('a card whose module has not landed is a 501 that says which module, and stays open', async () => {
  freshRoot();
  const c = propose(sixCards()[2], { actor: 'scout-fb' });   // territory → backend/territory.mjs
  const territoryExists = fs.existsSync(new URL('../backend/territory.mjs', import.meta.url));
  if (territoryExists) {
    const done = await accept(c.id, { actor: 'crystal' });
    assert.equal(done.status, 'accepted');
  } else {
    await assert.rejects(() => accept(c.id, { actor: 'crystal' }), (e) => {
      assert.equal(e.status, 501);
      assert.match(e.message, /backend\/territory\.mjs/);
      return true;
    });
    assert.equal(getProposal(c.id).status, 'open');
  }
});

// ── logging + the agent-facing doors ───────────────────────────────────────────────────────────

test('both decisions reach the event log', async () => {
  freshRoot();
  const deps = spyDeps();
  const a = propose(sixCards()[1], { actor: 'scout-fb' });
  const b = propose(sixCards()[3], { actor: 'scout-fb' });
  await accept(a.id, { actor: 'crystal', deps });
  await reject(b.id, { reason: 'bad-data', actor: 'crystal', deps });
  const logged = deps.calls.filter(c => c[0] === 'log').map(c => c[1]);
  assert.deepEqual(logged, ['accept', 'decide']);
});

test('the propose doors the router skill documents all land in the same queue', async () => {
  freshRoot();
  saveCollection(GUEST);
  const f = await req('POST', '/api/fields/propose', {
    collection: 'guest', key: 'on_camera', type: 'checkbox',
    why: '14 of your last 20 shortlists post video.', evidence: ['data/guests/maria-santos.md'], actor: 'scout-fb',
  });
  assert.equal(f.status, 200);
  assert.equal(f.body.kind, 'schema');
  assert.equal(f.body.field.key, 'on_camera');

  const o = await req('POST', '/api/outbound/propose', {
    channel: 'facebook-group', territory: 'nurses-ph', subject: 'intro', message: 'Exact wording.', actor: 'scout-fb',
  });
  assert.equal(o.body.kind, 'outbound');

  const c = await req('POST', '/api/collections/propose', {
    schema: { id: 'venue', query: { path: 'data/venues/**' }, fields: [{ key: 'name', type: 'text', primary: true }] },
    why: 'You keep pasting venue notes into guest records.', evidence: ['data/guests/maria-santos.md'], actor: 'scout-fb',
  });
  assert.equal(c.body.kind, 'schema');

  assert.equal((await req('GET', '/api/proposals')).body.proposals.length, 3, 'one queue, three doors');
});

test('re-proposing the same deterministic id does not grow the queue', () => {
  freshRoot();
  const first = propose({ id: 'task-p-stuck', ...sixCards()[5] }, { actor: 'scout-fb' });
  const again = propose({ id: 'task-p-stuck', ...sixCards()[5] }, { actor: 'scout-fb' });
  assert.equal(again.duplicate, true);
  assert.equal(again.created, first.created);
  assert.equal(listProposals({ status: 'open' }).length, 1);
});
