// Three defects found by an adversarial review AFTER 580 tests were already green, all in the
// record pipeline, all reproduced. This file is the guard for each. Every one of them survived the
// original suite for the same reason: the fixtures were easier than production.
//
//   D1  upsertRecord never stamped the collection's own query tag, so a record it had just written
//       did not match the collection that defines it. Invisible, undedupable, and UNGATED.
//   D2  an equal `source` permalink scored 90 with no contradiction term, so four people found in
//       one comment thread came back {store: 1, skip: 3} — three real findings silently discarded.
//   D3  three implementations of "is this quarantined": the view called the predicate, territory,
//       goals, the hot cache and search read a flag written only at boot.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { freshRoot, writeMd } from './helpers.mjs';
import { getStorageRoot } from '../backend/store.mjs';
import { upsertRecord, batchUpsert, patchRecord, readRecord } from '../backend/records.mjs';
import { readEvents } from '../backend/log.mjs';
import { documentsFor } from '../backend/documents.mjs';
import { viewFor } from '../backend/documents.mjs';
import { territoryStats } from '../backend/territory.mjs';
import { saveGoal, getGoal } from '../backend/memory.mjs';

// The SHIPPED shape: a tag AND a path. Using only `path` is what hid D1 for the whole build.
function seed() {
  writeMd(path.join(getStorageRoot(), '.scout', 'collections', 'guest.md'), {
    id: 'guest', label: 'Guests',
    query: { tag: 'guest', path: 'data/guests/**' },
    fields: [
      { key: 'name', type: 'text', required: true, primary: true },
      { key: 'status', type: 'status', gate: true, options: [
        { value: 'needs-review', group: 'todo' }, { value: 'shortlist', group: 'todo' },
        { value: 'contacted', group: 'active' }, { value: 'won', group: 'done' }] },
      { key: 'handle', type: 'text' },
      { key: 'profile', type: 'url' },
      { key: 'source', type: 'url' },
      { key: 'found_in', type: 'text' },
      { key: 'tags', type: 'multiselect' },
    ],
  }, 'Guests.\n');
}

// Exactly what skills/scout-router/references/api-mode.md tells an agent to send. Note what is
// absent: `tags`. No agent following the documented contract sends them.
const AS_DOCUMENTED = {
  collection: 'guest', name: 'Jun Dela Cruz', handle: '@jundc', found_in: 'nurses-ph',
  source: 'https://facebook.com/groups/nursesph/posts/9001',
};

test('D1 · a record the pipeline writes matches the collection that defines it', () => {
  freshRoot();
  seed();
  const stored = upsertRecord({ ...AS_DOCUMENTED }, { actor: 'scout-fb' });
  assert.equal(stored.verdict, 'store');

  const rows = documentsFor('guest').documents;
  assert.equal(rows.length, 1,
    'the record it just wrote is not in its own collection — it is invisible to every screen, '
    + 'to the hot cache counts, and to _known.md');
  assert.ok([].concat(rows[0].fields.tags || []).includes('guest'),
    'the collection query tag was not stamped');
});

test('D1 · dedupe survives, because the record is a candidate for the next submission', () => {
  freshRoot();
  seed();
  upsertRecord({ ...AS_DOCUMENTED }, { actor: 'scout-fb' });
  const again = upsertRecord({ ...AS_DOCUMENTED }, { actor: 'scout-fb' });
  assert.notEqual(again.verdict, 'store',
    'the same person submitted twice stored twice — writeMd replaces the file wholesale, so a '
    + "human's corrections are destroyed and the verdict reports success");
  assert.equal(documentsFor('guest').documents.length, 1);
});

test('D1 · the gate does not fail open on a record the pipeline created', async () => {
  freshRoot();
  seed();
  const { path: p } = upsertRecord({ ...AS_DOCUMENTED }, { actor: 'scout-fb' });

  await assert.rejects(
    () => patchRecord(p, { status: 'won' }, { actor: 'scout-fb' }),
    e => e.status === 403,
    'an agent promoted a pipeline-created record past shortlist — Law 4 is the guarantee this app '
    + 'exists to make, and it was absent on exactly the records agents create',
  );
  // and the human may still make the same move
  await patchRecord(p, { status: 'won' }, { actor: 'crystal' });
  assert.equal(readRecord(p).data.status, 'won');
});

test('D2 · four people found in one comment thread all survive', () => {
  freshRoot();
  seed();
  // One shared `source` permalink — mandatory on every finding, and genuinely shared by everyone
  // who commented on the same post.
  const thread = 'https://facebook.com/groups/nursesph/posts/7777';
  const { tally } = batchUpsert([
    { collection: 'guest', name: 'Grace Bautista', handle: '@graceb', source: thread },
    { collection: 'guest', name: 'Noel Ramos', handle: '@noelr', source: thread },
    { collection: 'guest', name: 'Ligaya Cruz', handle: '@ligayac', source: thread },
    { collection: 'guest', name: 'Tomas Reyes', handle: '@tomasr', source: thread },
  ], { actor: 'scout-fb' });

  assert.equal(tally.store, 4,
    'people who share only the page they were seen on were merged or skipped as duplicates. '
    + 'A skip is unrecoverable: the log names the record they were folded into, never the '
    + 'candidate that was lost, and the agent is told not to try again');
  assert.equal(tally.skip, 0);
  assert.equal(tally.merge, 0);
  assert.equal(documentsFor('guest').documents.length, 4);
});

test('D2 · a shared profile url still merges — it is identity, unlike a permalink', () => {
  freshRoot();
  seed();
  upsertRecord({ collection: 'guest', name: 'Maria Santos', handle: '@mariacooks', profile: 'https://instagram.com/mariacooks' }, { actor: 'scout-fb' });
  const second = upsertRecord({ collection: 'guest', name: 'M. Santos', profile: 'https://instagram.com/mariacooks/' }, { actor: 'scout-fb' });
  assert.notEqual(second.verdict, 'store', 'the same profile url is the same person');
  assert.equal(documentsFor('guest').documents.length, 1);
});

test('D3 · a rogue write is quarantined everywhere at once, not just in the view', async () => {
  freshRoot();
  seed();
  // A genuine find through the pipeline…
  upsertRecord({ collection: 'guest', name: 'Real Person', handle: '@real', found_in: 'nurses-ph' }, { actor: 'scout-fb' });

  // …and twenty an agent with folder access dumped straight into data/ WHILE THE APP IS RUNNING,
  // which is the exact threat Law 4 names. No boot happens in between.
  const dir = path.join(getStorageRoot(), 'data', 'guests');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 20; i++) {
    fs.writeFileSync(path.join(dir, 'rogue-' + i + '.md'),
      '---\nname: Rogue ' + i + '\nstatus: won\nfound_in: nurses-ph\ntags: [guest]\n'
      + 'created_by: scout-fb\nupdated_by: scout-fb\n---\n\nWritten around the pipeline.\n');
  }

  const view = await viewFor('guest');
  assert.equal(view.total, 1, 'the view counted fabricated records');
  assert.equal(view.quarantined.length, 20);

  // The four readers that used to trust the on-disk flag, which nothing had written yet.
  const stats = territoryStats('nurses-ph');
  assert.equal(stats.wins, 0,
    'territory scored fabricated wins — every agent that woke up after this would believe '
    + 'invented ground was its best territory');
  assert.equal(stats.finds, 1);

  const { renderCache } = await import('../backend/memory.mjs');
  const cache = renderCache();
  assert.match(cache.text, /guest 1\b/, 'the hot cache counted the rogue records');

  const { search } = await import('../backend/search.mjs');
  const hits = search('Rogue');
  assert.ok(hits.results.length && hits.results[0].quarantined === true,
    'search did not mark a rogue record — search is how a human finds the thing somebody wrote '
    + 'around the pipeline, so it must be marked the moment it lands, not at the next boot');
});

// ── `behind` measured the wrong calendar ──────────────────────────────────────────────────────
// It used `staleness()` — "how long since anyone re-verified this file" — as a stand-in for "how
// far through the runway are we". A goal saved this morning therefore had elapsed 0 and could never
// be behind, however close its deadline or however little was done. `behind` is the number that
// decides which goals surface on TODAY and in the agent's cache, so it reporting "fine" over a goal
// that is two days from its deadline at a third done is the whole failure.
const DAY = 86400000;
const dayStr = n => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

test('a goal saved TODAY, near its deadline and barely started, is behind', () => {
  freshRoot();
  saveGoal('sprint', {
    label: 'Six placements', target: 6, current: 1,
    created: dayStr(28),        // it has been running a month…
    deadline: dayStr(-2),       // …and there are two days left
  }, { actor: 'crystal' });

  const g = getGoal('sprint');
  assert.equal(g.current, 1);
  assert.equal(g.behind, true,
    'staleness said elapsed 0 because the FILE was just written, so a goal at 1/6 with two days '
    + 'left reported fine. The calendar that matters is created → deadline.');
});

test('half done with ten days left is behind, even on a goal marked slow-moving', () => {
  freshRoot();
  // The crossover between the two calendars, and it is a realistic goal: eighty days into a
  // ninety-day push, half the target met, and the human has said this object only needs re-checking
  // once a year. Decay honours `sweep_interval_days`, so staleness reads 0.22 and calls it fine.
  // The runway reads 0.89 — she is nearly out of time at half done, which is exactly the goal that
  // should be on TODAY tomorrow morning.
  saveGoal('slow', {
    label: 'Six placements', target: 6, current: 3,
    created: dayStr(80), deadline: dayStr(-10), sweep_interval_days: 365,
  }, { actor: 'crystal' });
  assert.equal(getGoal('slow').behind, true,
    'staleness honours sweep_interval_days, so marking a goal slow-moving made it un-behindable. '
    + 'Decay is for memory that rots; a deadline is a deadline.');
});

test('a goal with plenty of runway left is NOT behind at the same progress', () => {
  freshRoot();
  saveGoal('early', {
    label: 'Six placements', target: 6, current: 1,
    created: dayStr(2), deadline: dayStr(-60),
  }, { actor: 'crystal' });
  assert.equal(getGoal('early').behind, false, '1/6 two days into a two-month runway is on track');
});

test('saveGoal keeps a created date the caller supplied', () => {
  freshRoot();
  saveGoal('running', { label: 'x', target: 3, created: dayStr(28) }, { actor: 'crystal' });
  assert.match(String(getGoal('running').data.created).slice(0, 10), /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(String(getGoal('running').data.created).slice(0, 10), dayStr(0),
    'a goal that has been running a month was stamped as starting today, so it had no runway to be '
    + 'measured against');
});

// ── D4 · opening a record must not rewrite it ─────────────────────────────────────────────────
// Found the moment a live-preview editor replaced the textarea: the editor adopts the text it is
// handed, that adoption looked like a keystroke, and the save path PATCHed the body back. The
// server took it — `updated`, `updated_by` and `verified_at` were all rewritten and an `update`
// event with `changed: []` went into the log. Scrolling past a record reassigned it from the
// assistant that found it to the human who looked at it.
//
// `updated_by` is not decoration. Law 4 reads it to ignore an agent-authored promotion, and
// decay.mjs reads the dates to decide what is stale — so a no-op write does not merely add noise,
// it tells the agent that everything was re-verified today.
//
// The editor no longer reports an adopted value as an edit (frontend/RichEditor.jsx), and the
// server refuses the write regardless, because a surface that lies about an edit is exactly what
// this guard exists to survive.
test('D4 · a patch that changes nothing does not touch provenance and does not log', async () => {
  freshRoot();
  seed();
  const { path: p } = upsertRecord({ ...AS_DOCUMENTED, body: 'A nurse.\n' }, { actor: 'scout-fb' });
  const before = readRecord(p);
  const eventsBefore = readEvents({ limit: 200, target: p }).length;

  // Exactly what a surface echoing its own state sends: every value it was just given.
  const out = await patchRecord(p, {
    name: before.data.name, status: before.data.status, handle: before.data.handle,
    body: before.content,
  }, { actor: 'crystal' });

  assert.equal(out.unchanged, true, 'the write was not recognised as a no-op');
  const after = readRecord(p);
  assert.equal(after.data.updated_by, 'scout-fb', 'provenance was reassigned by a no-op patch');
  assert.equal(String(after.data.updated), String(before.data.updated), '`updated` moved on a no-op patch');
  assert.equal(String(after.data.verified_at), String(before.data.verified_at), '`verified_at` moved on a no-op patch');
  assert.equal(
    readEvents({ limit: 200, target: p }).length, eventsBefore,
    'a no-op patch wrote an event into the log',
  );

  // And a REAL change still goes through, with only the key that actually moved named.
  const real = await patchRecord(p, { handle: '@mariacooks' }, { actor: 'crystal' });
  assert.ok(!real.unchanged);
  assert.equal(readRecord(p).data.updated_by, 'crystal');
  const last = readEvents({ limit: 5, target: p })[0];
  assert.deepEqual(last.detail.changed, ['handle']);
});


// ── D5 · the document surface is a door onto EVERYTHING, and it had no scope ───────────────────
//
// `App.openPath` sends every `.md` in the workspace to the document surface, and the surface saves
// through `PATCH /api/records`. So that one route is the write path for a guest, a group, a
// territory, a playbook claim, a goal and `me.md` alike — and it was writing all of them with the
// generic record writer. Two consequences, both reproduced on a temp root:
//
//   · **Law 4 had a side door.** `collectionOf('me.md')` is null, so there is no gate field, so the
//     agent branch never fires. `PATCH /api/records {path:'me.md', patch:{name:'HACKED'}, actor:
//     'scout-fb'}` answered 200 and me.md on disk read `name: HACKED`, while `PUT /api/me` refused
//     the identical write with 403. Same for `goals/`.
//   · **Law 7 was broken.** Every memory writer schedules the hot-cache regeneration; the generic
//     writer did not. Rejecting a group through the document surface left the agent's wake-up
//     context saying the group was still good ground until somebody touched a memory route.
//
// The fix is one rule: records.mjs writes `data/`, and a path outside it is DELEGATED to the module
// that owns that object — which is what makes the refusal, the stripping and the cache bump come
// back in one place, phrased the one way.

import { req } from './helpers.mjs';
import { archiveRecord } from '../backend/records.mjs';
import {
  cacheVersion, regenerateCache, readCache, cancelCacheRegen, setScoutMemoryHooks,
} from '../backend/memory.mjs';
import { saveTerritory } from '../backend/territory.mjs';

const CACHE_SETTLE_MS = 2600;   // the debounce is 2s; this is it plus a margin

function seedMemory() {
  writeMd(path.join(getStorageRoot(), 'me.md'),
    { name: 'Crystal', created_by: 'crystal', type: 'identity' }, 'Crystal finds guests.\n');
  writeMd(path.join(getStorageRoot(), 'assistants', 'scout-fb.md'),
    { id: 'scout-fb', name: 'FB scout' }, 'Sweeps Facebook groups.\n');
}

test('D5 · an agent may not edit me.md or a goal through the document surface either', async () => {
  freshRoot();
  seed();
  seedMemory();
  setScoutMemoryHooks({ readEvents: () => [] });
  saveGoal('book-6-hazing-stories', { label: 'Book 6', target: 6, deadline: '2026-12-01' }, { actor: 'crystal' });

  // The refusal must be THE SAME SENTENCE the memory route gives. Two doors onto one object that
  // disagree about who owns it is how the second one gets found and used.
  const viaRecords = await req('PATCH', '/api/records', { path: 'me.md', patch: { name: 'HACKED' }, actor: 'scout-fb' });
  const viaMe = await req('PUT', '/api/me', { data: { name: 'HACKED' }, actor: 'scout-fb' });
  assert.equal(viaRecords.status, 403, 'an agent edited me.md through the record door');
  assert.equal(viaRecords.body.error, viaMe.body.error);
  assert.equal(readCacheFm('me.md').name, 'Crystal', 'me.md was rewritten by an agent');

  const goalViaRecords = await req('PATCH', '/api/records',
    { path: 'goals/book-6-hazing-stories.md', patch: { target: 99 }, actor: 'scout-fb' });
  const goalViaGoals = await req('PATCH', '/api/goals/book-6-hazing-stories', { patch: { target: 99 }, actor: 'scout-fb' });
  assert.equal(goalViaRecords.status, 403);
  assert.equal(goalViaRecords.body.error, goalViaGoals.body.error);
  assert.equal(getGoal('book-6-hazing-stories').target, 6, 'an agent moved the goalposts');

  // The human still owns both, through the same door.
  const human = await req('PATCH', '/api/records', { path: 'me.md', patch: { name: 'Crystal Reyes' }, actor: 'crystal' });
  assert.equal(human.status, 200);
  assert.equal(readCacheFm('me.md').name, 'Crystal Reyes');
});

// Read frontmatter straight off disk — the assertion has to be about the FILE, not about what a
// module chose to report.
function readCacheFm(rel) {
  const raw = fs.readFileSync(path.join(getStorageRoot(), rel), 'utf8');
  const m = /^---\n([\s\S]*?)\n---/.exec(raw);
  const out = {};
  for (const line of (m ? m[1] : '').split('\n')) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

test('D5 · correcting a territory through the document surface regenerates the hot cache', async () => {
  freshRoot();
  seed();
  seedMemory();
  setScoutMemoryHooks({ readEvents: () => [] });
  saveTerritory('nurses-ph', { label: 'Nurses PH', kind: 'facebook-group', access: 'joined' }, { actor: 'crystal' });
  cancelCacheRegen();                       // drop the regen saveTerritory just scheduled
  const before = regenerateCache({});
  assert.ok(!/BLOCKED/.test(before.text), 'the fixture starts with nothing blocked');

  const r = await req('PATCH', '/api/records',
    { path: 'territory/nurses-ph.md', patch: { access: 'rejected' }, actor: 'crystal' });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.access, 'rejected');

  await new Promise(done => setTimeout(done, CACHE_SETTLE_MS));
  const after = readCache({});
  assert.notEqual(after.version, before.version,
    'the hot cache was not regenerated — an agent asking GET /api/cache/version is told its stale '
    + 'context is still good, which is Law 7 broken by the door the human actually uses');
  assert.match(after.text, /BLOCKED/,
    'the regenerated context does not know the group was rejected');
  cancelCacheRegen();
});

// Delegation covers the memory objects; this covers the other half of the same law. EVERY write
// verb invalidates the cache, including an ordinary record edit — the COUNTS an agent wakes up to
// are computed from records, so a store the cache never heard about is a briefing that is wrong.
test('D5 · an ordinary record edit invalidates the hot cache too', async () => {
  freshRoot();
  seed();
  seedMemory();
  setScoutMemoryHooks({ readEvents: () => [] });
  const { path: p } = upsertRecord({ ...AS_DOCUMENTED }, { actor: 'scout-fb' });
  cancelCacheRegen();
  const before = regenerateCache({});

  const r = await req('PATCH', '/api/records', { path: p, patch: { status: 'shortlist' }, actor: 'crystal' });
  assert.equal(r.status, 200);
  await new Promise(done => setTimeout(done, CACHE_SETTLE_MS));
  assert.notEqual(cacheVersion({}).v, before.version,
    'a record edit left GET /api/cache/version unchanged, so an agent skips re-reading a context '
    + 'whose COUNTS no longer match the store');
  cancelCacheRegen();
});

test('D5 · the rollups territory.mjs owns cannot be typed in through the document surface', async () => {
  freshRoot();
  seed();
  seedMemory();
  setScoutMemoryHooks({ readEvents: () => [] });
  saveTerritory('nurses-ph', { label: 'Nurses PH', access: 'joined' }, { actor: 'crystal' });

  const r = await req('PATCH', '/api/records',
    { path: 'territory/nurses-ph.md', patch: { hit_rate: 99, finds: 500, rules: 'No selling.' }, actor: 'crystal' });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.rules, 'No selling.', 'the fact the human may write did not land');
  assert.equal(r.body.data.hit_rate, undefined, 'a hand-typed hit_rate reached the file');
  assert.equal(r.body.data.finds, undefined, 'a hand-typed finds reached the file');
  cancelCacheRegen();
});

test('D5 · archiving cannot take a memory object out of the workspace', async () => {
  freshRoot();
  seed();
  seedMemory();
  setScoutMemoryHooks({ readEvents: () => [] });
  saveTerritory('nurses-ph', { label: 'Nurses PH', access: 'joined' }, { actor: 'crystal' });
  // Reproduced: this answered 200 and moved me.md to data/_archive/record/me.md. Nothing in the app
  // may relocate identity, and Law 5 is not a licence to move a file somewhere it stops being read.
  const r = await req('POST', '/api/records/archive', { path: 'me.md', reason: 'bad-data', actor: 'scout-fb' });
  assert.equal(r.status, 403);
  assert.ok(fs.existsSync(path.join(getStorageRoot(), 'me.md')), 'me.md was archived away');
  // And it is the SCOPE that refuses, not the actor: a human cannot archive a territory either.
  assert.throws(() => archiveRecord('territory/nurses-ph.md', { reason: 'off-target', actor: 'crystal' }),
    e => e.status === 403);
  assert.ok(fs.existsSync(path.join(getStorageRoot(), 'territory', 'nurses-ph.md')));
  cancelCacheRegen();
});

// ── D6 · a finding an agent stores becomes a decision, or nobody ever sees it ──────────────────
//
// GOAL.md §3: "Six things need her… a found guest" is the first of the six. DECIDE and TODAY's
// NEEDS YOU count proposal cards and nothing else, so forty overnight finds read as `NEEDS YOU: 0`
// while forty files sat in `data/` marked `proposed: true` that nobody was ever shown.
test('D6 · an agent upsert raises exactly one open finding card; a human upsert raises none', async () => {
  freshRoot();
  seed();
  seedMemory();

  // The body skills/scout-router/references/api-mode.md shows, through the ROUTE.
  const finding = {
    collection: 'guest', name: 'Maria Santos', handle: '@mariacooks',
    found_in: 'nurses-ph', score: 9, source: 'https://instagram.com/p/xyz',
    why: 'Nurse turned cook. Tells her own story, no brand deals in 40 posts.',
  };
  const first = await req('POST', '/api/records/upsert', { ...finding, actor: 'scout-fb' });
  assert.equal(first.status, 200);
  assert.equal(first.body.verdict, 'store');

  const open = await req('GET', '/api/proposals?status=open');
  const cards = open.body.proposals.filter(c => c.kind === 'finding');
  assert.equal(cards.length, 1, 'a found guest never reached the queue — NEEDS YOU stays at 0');
  assert.equal(cards[0].record, first.body.path,
    'the card must point at its record with `record`; `path` is the CARD\'s own file (D7)');
  assert.equal(cards[0].created_by, 'scout-fb');
  assert.equal(cards[0].why, finding.why, 'the reason the agent gave is what the human decides on');
  assert.equal(cards[0].score, 9);
  assert.equal(cards[0].territory, 'nurses-ph');

  // The same finding again is a `skip`, and a skip raises nothing — the queue must not grow a copy
  // per sweep or nobody works it.
  const again = await req('POST', '/api/records/upsert', { ...finding, actor: 'scout-fb' });
  assert.equal(again.body.verdict, 'skip');
  const still = await req('GET', '/api/proposals?status=open');
  assert.equal(still.body.proposals.filter(c => c.kind === 'finding').length, 1);

  // A human typing a record into their own workspace is not asking themselves for permission.
  const byHand = await req('POST', '/api/records/upsert',
    { collection: 'guest', name: 'Jun Dela Cruz', handle: '@jundc', actor: 'crystal' });
  assert.equal(byHand.body.verdict, 'store');
  const after = await req('GET', '/api/proposals?status=open');
  assert.equal(after.body.proposals.filter(c => c.kind === 'finding').length, 1,
    'a human upsert raised a card asking the human to approve their own typing');
});

test('D6 · a batch of findings raises one card each, and one read of the queue for the batch', async () => {
  freshRoot();
  seed();
  seedMemory();
  const items = ['Grace Bautista', 'Noel Ramos', 'Tin Navarro'].map(name => ({
    collection: 'guest', name, found_in: 'nurses-ph',
    source: 'https://facebook.com/groups/nursesph/posts/7777', why: 'Told her own story in the thread.',
  }));
  const r = await req('POST', '/api/records/batch', { items, actor: 'scout-fb' });
  assert.equal(r.body.tally.store, 3);
  const open = await req('GET', '/api/proposals?status=open');
  const cards = open.body.proposals.filter(c => c.kind === 'finding');
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map(c => c.record).sort(), [
    'data/guests/grace-bautista.md', 'data/guests/noel-ramos.md', 'data/guests/tin-navarro.md',
  ]);
});
