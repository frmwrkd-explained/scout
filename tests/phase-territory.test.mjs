// M3 · T09 §3 — territory, and the one thing about it that matters:
// `finds` / `wins` / `hit_rate` are ROLLUPS over the records whose `found_in` points here. They are
// computed on read, never trusted from frontmatter, and stripped from every patch.
//
// T09's Demonstrate is the third test: a record moved to `won` raises its territory's hit rate
// with NO manual edit — the territory file is byte-identical before and after.

import './_env.mjs'; // first — sets the storage root before store.mjs captures it
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { freshRoot, getStorageRoot } from './helpers.mjs';
import { saveCollection } from '../backend/collections.mjs';
import {
  listTerritories, getTerritory, saveTerritory, territoryStats, proposeTerritory,
  registerTerritoryRoutes, COMPUTED_KEYS,
} from '../backend/territory.mjs';
// Proposing ground is a DECIDE card now, so the queue is part of this module's contract.
import { listProposals, accept } from '../backend/proposals.mjs';
import { cancelCacheRegen } from '../backend/memory.mjs';

const R = () => getStorageRoot();
const write = (rel, body) => {
  const abs = path.join(R(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
};
const guest = (id, { status = 'needs-review', found_in = 'nurses-ph', extra = '' } = {}) =>
  write('data/guests/' + id + '.md', '---\nname: ' + id + '\nstatus: ' + status + '\nfound_in: ' + found_in + '\n' + extra + '---\n\nbody\n');

const GUEST_COLLECTION = {
  id: 'guest',
  query: { path: 'data/guests/**' },
  fields: [
    { key: 'name', type: 'text', primary: true },
    { key: 'status', type: 'status', gate: true, options: [
      { value: 'needs-review', group: 'todo' },
      { value: 'shortlist', group: 'active' },
      { value: 'won', group: 'done' },
    ] },
    { key: 'found_in', type: 'text' },
  ],
};

function seed() {
  freshRoot();
  // saveTerritory schedules a (debounced, unref'd) cache regeneration by default now — drop any
  // pending one so a timer from the previous test never renders against this test's root.
  cancelCacheRegen();
  saveCollection(GUEST_COLLECTION);
  saveTerritory('nurses-ph', { label: 'Nurses PH', kind: 'facebook-group', access: 'joined', last_swept: '2026-08-17' }, { actor: 'crystal' });
  saveTerritory('ofw-stories', { label: 'OFW Stories', kind: 'facebook-group', access: 'joined' }, { actor: 'crystal' });
  for (let i = 0; i < 9; i++) guest('g' + i, { status: i === 0 ? 'won' : 'needs-review' });
  guest('o1', { found_in: 'ofw-stories' });
  return R();
}

test('finds and wins are rolled up from the records that point here', () => {
  seed();
  const s = territoryStats('nurses-ph');
  assert.equal(s.finds, 9);
  assert.equal(s.wins, 1);
  assert.equal(s.hit_rate, 11.1, 'one decimal place, as a percentage');
  assert.deepEqual(territoryStats('ofw-stories'), { finds: 1, wins: 0, hit_rate: 0 });
  assert.deepEqual(territoryStats('never-heard-of-it'), { finds: 0, wins: 0, hit_rate: 0 });
});

test('DEMONSTRATE · a record moved to `won` raises the hit rate with no manual edit', () => {
  seed();
  const file = path.join(R(), 'territory', 'nurses-ph.md');
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(getTerritory('nurses-ph').stats.hit_rate, 11.1);

  // Exactly what moveRecord() will do at M2: the record's gate value changes. Nothing else.
  guest('g1', { status: 'won' });

  const after = getTerritory('nurses-ph');
  assert.equal(after.stats.wins, 2);
  assert.equal(after.stats.hit_rate, 22.2, 'the rate moved because the records moved');
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'and the territory file was never touched');
  assert.ok(!/hit_rate|\bwins\b|\bfinds\b/.test(before), 'no rollup was ever written into the file');
});

test('a done value from the collection schema is what counts as a win', () => {
  seed();
  // Rename the done stage: the rollup follows the schema, with no code change.
  saveCollection({ ...GUEST_COLLECTION, fields: GUEST_COLLECTION.fields.map(f => f.key !== 'status' ? f : {
    ...f, options: [{ value: 'needs-review', group: 'todo' }, { value: 'shortlist', group: 'active' }, { value: 'signed', group: 'done' }],
  }) });
  guest('g2', { status: 'signed' });
  assert.equal(territoryStats('nurses-ph').wins, 1, 'only `signed` is done now, and g0 is `won`… ');
});

test('saveTerritory strips finds/wins/hit_rate and says that it did', () => {
  seed();
  const saved = saveTerritory('nurses-ph', { finds: 999, wins: 999, hit_rate: 99.9, rules: 'No self-promo.' }, { actor: 'scout-fb' });
  assert.deepEqual(saved.stripped.sort(), [...COMPUTED_KEYS].sort());
  const raw = fs.readFileSync(path.join(R(), 'territory', 'nurses-ph.md'), 'utf8');
  assert.ok(!/999/.test(raw), 'a hand-typed hit rate never reaches the file');
  assert.match(raw, /No self-promo/, 'but the facts an agent may write do');
  assert.equal(saved.stats.finds, 9, 'and the reported numbers are still the rollup');
});

test('changing access stamps access_changed — the date an agent must not re-request before', () => {
  seed();
  const t = saveTerritory('nurses-ph', { access: 'rejected' }, { actor: 'crystal' });
  assert.equal(t.data.access, 'rejected');
  assert.match(String(t.data.access_changed), /^\d{4}-\d{2}-\d{2}$/);
});

test('quarantined records are excluded from every score', () => {
  seed();
  guest('bad', { status: 'won', extra: 'quarantined: true\n' });
  const s = territoryStats('nurses-ph');
  assert.equal(s.finds, 9, 'a quarantined record is not a find');
  assert.equal(s.wins, 1, 'and certainly not a win');
});

test('an archived reject stays in the denominator — it was still a find', () => {
  seed();
  write('data/_archive/guests/g8.md', '---\nname: g8\nstatus: won\nfound_in: nurses-ph\narchive_reason: off-target\n---\n\nbody\n');
  const s = territoryStats('nurses-ph');
  assert.equal(s.finds, 10, 'Law 5 — the rejects are the labelled data, not a deletion');
  assert.equal(s.wins, 1, 'but an archived record can never count as a win');
});

test('listTerritories carries stats and decay, best ground first', () => {
  seed();
  const list = listTerritories();
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'nurses-ph', 'sorted by hit rate');
  assert.ok(list[0].staleness >= 0 && list[0].staleness <= 1);
  assert.equal(typeof list[0].stale, 'boolean');
});

// ── proposing ground writes NOTHING (Law 4) ────────────────────────────────────────────────────
// This wrote `territory/<id>.md` with `proposed: true` until 2026-09-06, and memory.mjs then
// rendered that unapproved ground under `## NEVER TRIED` — so an agent could name a place and read
// it back on its next wake as somewhere it was allowed to work, with nobody having said yes. The
// gate lives in the pipeline: a DECIDE card, and only accepting it writes a file.

test('DEMONSTRATE · proposing ground makes a card and writes no territory file', async () => {
  seed();
  const card = await proposeTerritory(
    { label: 'Frat Alumni PH', kind: 'facebook-group', url: 'https://facebook.com/groups/frat', why: 'three shortlists mention it' },
    { actor: 'vetter' });

  assert.equal(card.kind, 'territory', 'it is a card, not a territory');
  assert.equal(card.status, 'open');
  assert.equal(card.created_by, 'vetter');
  assert.match(card.why, /three shortlists/);
  assert.equal(fs.existsSync(path.join(R(), 'territory', 'frat-alumni-ph.md')), false,
    'Law 4 — an agent proposes; nothing is written until a human disposes');
  assert.equal(getTerritory('frat-alumni-ph'), null);
  assert.equal(listProposals({ status: 'open' }).length, 1, 'one card in the one queue');

  // …and accepting it is what creates the ground, at `requested`: they agreed the agent may ASK.
  await accept(card.id, { actor: 'crystal' });
  const t = getTerritory('frat-alumni-ph');
  assert.ok(t, 'accepting the card is the only thing that writes the file');
  assert.equal(t.access, 'requested', 'requested, never joined — joining is Facebook\'s decision');
  assert.equal(t.data.label, 'Frat Alumni PH', 'and what the finder knew travelled on the card');
  assert.equal(t.data.kind, 'facebook-group');
});

test('a proposal is idempotent, refuses ground that already exists, and refuses a card with no `why`', async () => {
  seed();
  const first = await proposeTerritory({ label: 'Frat Alumni PH', why: 'three shortlists mention it' }, { actor: 'vetter' });
  const again = await proposeTerritory({ label: 'Frat Alumni PH', why: 'three shortlists mention it' }, { actor: 'vetter' });
  assert.equal(again.id, first.id, 'an agent that re-proposes every morning must not grow the queue');
  assert.equal(listProposals({ status: 'open' }).length, 1);

  await assert.rejects(() => proposeTerritory({ label: 'Nurses PH', why: 'x' }, { actor: 'vetter' }), /already exists/);
  await assert.rejects(() => proposeTerritory({ label: 'Cebu Nurses' }, { actor: 'vetter' }),
    /`why`/, 'the human decides on the reason, so there has to be one');
});

test('the routes serve the rollup and refuse to store one', async () => {
  seed();
  const app = express();
  app.use(express.json());
  registerTerritoryRoutes(app, {});
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const list = await (await fetch(base + '/api/territory')).json();
    assert.equal(list.territory.length, 2);

    const one = await (await fetch(base + '/api/territory/nurses-ph')).json();
    assert.equal(one.stats.finds, 9);

    const missing = await fetch(base + '/api/territory/nope');
    assert.equal(missing.status, 404);

    // frontend/api.js sends { patch, actor }; an agent sends the fields flat. Both work.
    const patched = await (await fetch(base + '/api/territory/nurses-ph', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actor: 'scout-fb', patch: { last_swept: '2026-08-19', hit_rate: 90 } }),
    })).json();
    assert.deepEqual(patched.stripped, ['hit_rate']);
    assert.equal(patched.territory.stats.hit_rate, 11.1, 'still the rollup, not the 90 that was sent');

    // The route an agent actually calls, with the body backend/mcp.mjs sends (`name`, not `label`).
    // It must make a card and leave `territory/` alone.
    const proposed = await (await fetch(base + '/api/territory/propose', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Cebu Nurses', kind: 'facebook-group', why: '4 of 9 shortlists are members', actor: 'scout-fb' }),
    })).json();
    assert.equal(proposed.card.kind, 'territory');
    assert.equal(proposed.card.status, 'open');
    assert.match(proposed.note, /nothing was written/i, 'said out loud, so the agent does not go and work it');
    assert.equal(fs.existsSync(path.join(R(), 'territory', 'cebu-nurses.md')), false);
    assert.equal((await (await fetch(base + '/api/territory')).json()).territory.length, 2,
      'still the two territories that were seeded');

    const noWhy = await fetch(base + '/api/territory/propose', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Davao Nurses', actor: 'scout-fb' }),
    });
    assert.equal(noWhy.status, 400);
  } finally { server.close(); }
});
