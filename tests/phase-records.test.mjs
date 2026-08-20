// The write pipeline — T06, docs/08_MODULE_CONTRACTS.md §3.
//
// The load-bearing case is the T06 Demonstrate: the same person submitted three times under
// different handles and hashtags must go `store` → `update` → `skip`, and ONE file must exist at
// the end. It is load-bearing because it pins the thing that makes an agent sweep survivable — an
// assistant working a group for an hour re-sees the same twelve people, and a pipeline that stores
// them twelve times is not a pipeline, it is a mess with an API.

import '../tests/_env.mjs'; // first — sets the storage root before store.mjs captures it
import test from 'node:test';
import assert from 'node:assert';
import { freshRoot, req, getStorageRoot, readMd, fs, path } from './helpers.mjs';
import { app } from '../backend/index.mjs';
import { saveCollection } from '../backend/collections.mjs';
import {
  nearMatches, upsertRecord, batchUpsert, patchRecord, readRecord, listRecords,
  slugify, isAgentActor, dirForCollection, MERGE_CONFIDENCE, RecordError, registerRecordRoutes,
} from '../backend/records.mjs';
import { eventsFor, readEvents } from '../backend/log.mjs';

// registerRecordRoutes is mounted by backend/index.mjs, which this task does not own. Mount it here
// if it is not there yet, and never twice — the first matching handler answers, so a double mount
// would hide a real ordering bug behind a duplicate that happens to work.
const isMounted = () => (app._router?.stack || []).some(l => l.route && l.route.path === '/api/records/upsert');
if (!isMounted()) registerRecordRoutes(app, {});

const R = () => getStorageRoot();

const GUEST = {
  id: 'guest',
  label: 'Guests',
  // BOTH halves, like the shipped `workspace/.scout/collections/guest.md`. The fixture used to
  // declare only `path`, so every test here exercised a collection shape the app does not ship —
  // and the tag half is precisely where upsertRecord was failing: records it wrote did not match
  // the collection that defines them, which made them invisible, killed dedupe, and let the gate
  // fail open. A fixture that is easier than production tests the easy case.
  query: { tag: 'guest', path: 'data/guests/**' },
  default_view: 'needs-review',
  fields: [
    { key: 'name', type: 'text', required: true, primary: true },
    // Two URLs, because they mean different things: `profile` is the person, `source` (declared
    // below) is the post you saw them in. Only the first is identity.
    { key: 'profile', type: 'url' },
    { key: 'status', type: 'status', gate: true, options: [
      { value: 'needs-review', group: 'todo' }, { value: 'shortlist', group: 'todo' },
      { value: 'contacted', group: 'active' }, { value: 'replied', group: 'active' },
      { value: 'won', group: 'done' }, { value: 'archived', group: 'done' },
    ] },
    { key: 'handle', type: 'text' },
    { key: 'platform', type: 'select', options: ['instagram', 'facebook', 'tiktok'] },
    { key: 'source', type: 'url' },
    { key: 'found_in', type: 'text' },
    { key: 'score', type: 'number', display: 'bar', min: 1, max: 10 },
    { key: 'tags', type: 'multiselect', options: ['guest', 'manila', 'cebu', 'nurse', 'storyteller', 'baker', 'night-shift'] },
  ],
};

function seed() {
  freshRoot();
  saveCollection(GUEST);
}
const guestFiles = () => { try { return fs.readdirSync(path.join(R(), 'data', 'guests')).filter(f => f.endsWith('.md')); } catch { return []; } };
const fm = (rel) => readMd(path.join(R(), rel)).data;

// ── near-match (T06 step 2) ────────────────────────────────────────────────────────────────────

test('near-match scores handle, source url, exact name, contained name and trigram overlap', () => {
  seed();
  upsertRecord({ collection: 'guest', name: 'Maria Santos', handle: '@mariacooks',
    profile: 'https://instagram.com/mariacooks/', source: 'https://facebook.com/groups/nursesph/posts/1' });
  upsertRecord({ collection: 'guest', name: 'Jun Cruz', handle: '@juncruz' });

  const score = (candidate) => {
    const m = nearMatches(candidate, { collection: 'guest' });
    return m.length ? m[0] : null;
  };

  // Same handle, written the way three different agents would write it.
  for (const h of ['@mariacooks', 'mariacooks', 'https://www.instagram.com/mariacooks']) {
    const m = score({ name: 'Totally Different Person', handle: h });
    assert.equal(m.confidence, 95, 'handle ' + h);
    assert.match(m.why, /same handle/);
  }
  // Same PROFILE url, protocol and trailing slash and query string apart. Note the key: `source`
  // is the permalink the agent actually saw and is deliberately NOT scored as identity — two people
  // commenting in one thread share it, and scoring it at 90 discarded three of every four findings
  // from a single page as `skip`. A profile identifies a person; a permalink identifies a place.
  const byProfile = score({ name: 'Unrelated Name', profile: 'http://instagram.com/mariacooks?utm_source=x' });
  assert.equal(byProfile.confidence, 90);
  assert.match(byProfile.why, /same .*url/);

  // The regression itself: four different people found on one page must all survive.
  const sameSource = score({ name: 'Someone Else Entirely', handle: '@someoneelse', source: 'http://instagram.com/mariacooks' });
  assert.ok(sameSource === null || sameSource.confidence < 60,
    'a shared source permalink must not merge two different people — got '
    + (sameSource ? sameSource.confidence + ' (' + sameSource.why + ')' : 'no match, which is the strongest possible answer'));

  assert.equal(score({ name: 'maria  SANTOS' }).confidence, 85, 'exact name is case and space insensitive');
  const contained = score({ name: 'Maria Santos Jr' });
  assert.equal(contained.confidence, 65);
  assert.match(contained.why, /name contained/);

  const fuzzy = score({ name: 'Marai Santos' });   // a typo, nothing else to go on
  assert.ok(fuzzy.confidence > 0 && fuzzy.confidence < 65, 'trigram overlap sits below every named signal: ' + fuzzy.confidence);
  assert.match(fuzzy.why, /overlap/);

  // Sorted desc, and every entry carries what the contract promises.
  const all = nearMatches({ name: 'Maria Santos', handle: '@juncruz' }, { collection: 'guest' });
  assert.deepEqual(all.map(m => m.confidence), [...all.map(m => m.confidence)].sort((a, b) => b - a));
  for (const m of all) for (const k of ['id', 'path', 'title', 'confidence', 'why']) assert.ok(m[k] !== undefined, 'missing ' + k);

  assert.equal(score({ name: 'Somebody Else Entirely' }), null, 'a stranger is not a near match');
});

// ── the four verbs (T06 step 3) ────────────────────────────────────────────────────────────────

test('T06 DEMONSTRATE · the same person three times, under different handles and hashtags', () => {
  seed();
  const one = upsertRecord({ collection: 'guest', name: 'Maria Santos', handle: '@mariacooks', tags: ['guest', 'nurse'], found_in: 'nurses-ph' }, { actor: 'scout-fb' });
  const two = upsertRecord({ collection: 'guest', name: 'Maria Santos', handle: '@maria.cooks', tags: ['guest', 'storyteller'], platform: 'instagram' }, { actor: 'scout-fb' });
  const three = upsertRecord({ collection: 'guest', name: 'maria santos', handle: '@mariacooksph', tags: ['nurse', 'storyteller'] }, { actor: 'scout-fb' });

  assert.equal(one.verdict, 'store');
  assert.equal(two.verdict, 'update');
  assert.equal(three.verdict, 'skip');
  assert.deepEqual(guestFiles(), ['maria-santos.md'], 'exactly one file');

  const data = fm('data/guests/maria-santos.md');
  assert.equal(data.handle, '@mariacooks', 'ingest never overwrites a value that is already there');
  assert.deepEqual(data.tags, ['guest', 'nurse', 'storyteller'], 'array fields union');
  assert.equal(data.platform, 'instagram', 'an empty field is filled');
  assert.deepEqual(two.changed.sort(), ['platform', 'tags']);
  assert.deepEqual(three.changed, []);
});

test('a fuzzy hit above the merge threshold merges instead of storing a second file', () => {
  seed();
  upsertRecord({ collection: 'guest', name: 'Maria Santos', handle: '@mariacooks' });
  // A different NAME, so the slug is different — the only thing tying them together is the handle.
  const r = upsertRecord({ collection: 'guest', name: 'Maria S. Santos', handle: '@mariacooks', found_in: 'nurses-ph' });
  assert.equal(r.verdict, 'merge');
  assert.equal(r.matched, 'maria-santos');
  assert.ok(r.confidence >= MERGE_CONFIDENCE);
  assert.deepEqual(guestFiles(), ['maria-santos.md']);
  assert.equal(fm('data/guests/maria-santos.md').found_in, 'nurses-ph');
  assert.equal(fm('data/guests/maria-santos.md').name, 'Maria Santos', 'the merge did not rewrite the title');
});

test('a stranger stores, and a hit below the threshold stores rather than merging', () => {
  seed();
  upsertRecord({ collection: 'guest', name: 'Maria Santos' });
  const r = upsertRecord({ collection: 'guest', name: 'Mario Santoso' });   // similar, not the same person
  assert.ok(r.confidence < MERGE_CONFIDENCE, 'confidence was ' + r.confidence);
  assert.equal(r.verdict, 'store');
  assert.equal(guestFiles().length, 2);
});

test('an agent write lands proposed, in the first stage, stamped as pipeline (T06 step 6)', () => {
  seed();
  const r = upsertRecord({ collection: 'guest', name: 'Jun Cruz', status: 'shortlist' }, { actor: 'scout-fb' });
  const d = fm(r.path);
  assert.equal(d.proposed, true);
  assert.equal(d.status, 'needs-review', 'an agent creates in the first stage whatever it asked for');
  assert.equal(d.created_by, 'scout-fb');
  assert.equal(d.provenance, 'pipeline');
  assert.ok(d.created && d.updated && d.verified_at);

  // A human writing the same collection is not proposing anything.
  const h = upsertRecord({ collection: 'guest', name: 'Ana Reyes', status: 'contacted' }, { actor: 'crystal' });
  assert.equal(fm(h.path).proposed, undefined);
  assert.equal(fm(h.path).status, 'contacted');
  assert.equal(isAgentActor('scout-fb'), true);
  assert.equal(isAgentActor('crystal'), false);
});

test('every mutation appends to the log, and a skip is logged without writing the file', () => {
  seed();
  const r = upsertRecord({ collection: 'guest', name: 'Maria Santos', handle: '@mariacooks' }, { actor: 'scout-fb' });
  const before = fs.statSync(path.join(R(), r.path)).mtimeMs;
  upsertRecord({ collection: 'guest', name: 'Maria Santos', handle: '@other' }, { actor: 'scout-fb' });

  assert.deepEqual(eventsFor(r.path).map(e => e.type), ['skip', 'store']);
  assert.equal(eventsFor(r.path)[0].actor, 'scout-fb');
  assert.equal(fs.statSync(path.join(R(), r.path)).mtimeMs, before, 'a skip wrote the file anyway');
});

// ── batch (T06 step 4) and match (T06 step 5) ──────────────────────────────────────────────────

test('a batch is one near-match pass, and it dedupes against itself', () => {
  seed();
  const r = batchUpsert([
    { collection: 'guest', name: 'Maria Santos', handle: '@mariacooks', tags: ['guest'] },
    { collection: 'guest', name: 'Jun Cruz', handle: '@juncruz' },
    { collection: 'guest', name: 'Maria Santos', handle: '@mariacooks', tags: ['nurse'] },   // same sweep, same person
    { collection: 'guest', name: 'Maria Santos', handle: '@mariacooks' },                     // nothing new
    { collection: 'guest', name: 'Rowena Cruz', handle: '@rowena' },
  ], { actor: 'scout-fb' });

  assert.deepEqual(r.tally, { store: 3, update: 1, merge: 0, skip: 1 });
  assert.equal(r.results.length, 5);
  assert.equal(guestFiles().length, 3, 'the batch created a duplicate of someone inside itself');
  assert.deepEqual(fm('data/guests/maria-santos.md').tags, ['guest', 'nurse']);
});

test('one bad item in a batch never costs the other forty-nine', () => {
  seed();
  const r = batchUpsert([
    { collection: 'guest', name: 'Maria Santos' },
    { collection: 'guest' },                          // no name
    { name: 'No Collection' },
    { collection: 'guest', name: 'Jun Cruz' },
  ]);
  assert.deepEqual(r.tally, { store: 2, update: 0, merge: 0, skip: 0 });
  assert.equal(r.results.filter(x => x.verdict === 'refused').length, 2);
  assert.equal(guestFiles().length, 2);
});

test('POST /api/records/match is a dry run — no file, no log line', async () => {
  seed();
  await req('POST', '/api/records/upsert', { collection: 'guest', name: 'Maria Santos', handle: '@mariacooks', actor: 'scout-fb' });
  const filesBefore = guestFiles();
  const eventsBefore = readEvents({}).length;

  const r = await req('POST', '/api/records/match', { collection: 'guest', name: 'Maria Santos', handle: '@mariacooks' });
  assert.equal(r.status, 200);
  assert.equal(r.body.matches[0].confidence, 95);
  assert.deepEqual(guestFiles(), filesBefore);
  assert.equal(readEvents({}).length, eventsBefore, 'a dry run wrote to the log');
});

test('the whole pipeline over HTTP returns the verdict the agent contract promises', async () => {
  seed();
  const one = await req('POST', '/api/records/upsert', { collection: 'guest', name: 'Maria Santos', handle: '@mariacooks', found_in: 'nurses-ph', actor: 'scout-fb' });
  const two = await req('POST', '/api/records/upsert', { collection: 'guest', name: 'Maria Santos', handle: '@maria2', platform: 'instagram', actor: 'scout-fb' });
  const three = await req('POST', '/api/records/upsert', { collection: 'guest', name: 'Maria Santos', handle: '@maria3', actor: 'scout-fb' });
  assert.deepEqual([one.body.verdict, two.body.verdict, three.body.verdict], ['store', 'update', 'skip']);

  const batch = await req('POST', '/api/records/batch', { actor: 'scout-fb', items: [{ collection: 'guest', name: 'Jun Cruz' }, { collection: 'guest', name: 'Jun Cruz' }] });
  assert.deepEqual(batch.body.tally, { store: 1, update: 0, merge: 0, skip: 1 });

  const activity = await req('GET', '/api/activity?limit=50');
  assert.equal(activity.status, 200);
  assert.deepEqual(activity.body.events.map(e => e.type), ['skip', 'store', 'skip', 'update', 'store']);

  const history = await req('GET', '/api/records/history?path=' + encodeURIComponent(one.body.path));
  assert.deepEqual(history.body.events.map(e => e.type), ['skip', 'update', 'store']);
  // The agent door can also address a record by its id, the way T08 and the router skill write it.
  const byId = await req('GET', '/api/records/history?path=maria-santos');
  assert.equal(byId.body.events.length, 3);
});

test('a record without a collection, or a collection that does not exist, is a clean refusal', async () => {
  seed();
  assert.equal((await req('POST', '/api/records/upsert', { name: 'Nobody' })).status, 400);
  assert.equal((await req('POST', '/api/records/upsert', { collection: 'nope', name: 'Nobody' })).status, 404);
  assert.equal((await req('POST', '/api/records/upsert', { collection: 'guest' })).status, 400);
  assert.throws(() => upsertRecord({ collection: 'guest' }), RecordError);
});

// ── the editor half: patchRecord ───────────────────────────────────────────────────────────────

test('patchRecord overwrites where ingest would not, and refuses a stale rev with 409', async () => {
  seed();
  const r = upsertRecord({ collection: 'guest', name: 'Maria Santos', handle: '@mariacooks', score: 4 });
  const read = readRecord(r.path);

  const saved = patchRecord(r.path, { score: 9, handle: '@corrected' }, { actor: 'crystal', rev: read.rev });
  assert.equal(saved.data.score, 9, 'a human edit is authoritative');
  assert.equal(saved.data.handle, '@corrected');
  assert.notEqual(saved.rev, read.rev);

  assert.throws(() => patchRecord(r.path, { score: 1 }, { actor: 'crystal', rev: read.rev }), e => e.status === 409);
  const http = await req('PATCH', '/api/records', { path: r.path, patch: { score: 1 }, rev: read.rev, actor: 'crystal' });
  assert.equal(http.status, 409);
  assert.equal(fm(r.path).score, 9, 'the losing write must not have landed');
  assert.deepEqual(eventsFor(r.path).map(e => e.type), ['update', 'store']);
});

test('a body is appended, never replaced', () => {
  seed();
  const r = upsertRecord({ collection: 'guest', name: 'Maria Santos', body: 'A nurse who cooks on camera.' });
  upsertRecord({ collection: 'guest', name: 'Maria Santos', body: 'A nurse who cooks on camera.' });          // seen already
  const second = upsertRecord({ collection: 'guest', name: 'Maria Santos', body: 'Her sister runs the messages.' });
  assert.equal(second.verdict, 'update');
  const body = readRecord(r.path).content;
  assert.match(body, /A nurse who cooks on camera\./);
  assert.match(body, /Her sister runs the messages\./);
});

// ── small surfaces that other modules depend on ────────────────────────────────────────────────

test('slugify and dirForCollection produce the shape that is already on disk', () => {
  seed();
  assert.equal(slugify('Maria Santos'), 'maria-santos');
  assert.equal(slugify('José  Peña-Reyes!'), 'jose-pena-reyes');
  assert.equal(slugify(''), 'untitled');
  assert.equal(dirForCollection({ id: 'guest', query: { path: 'data/guests/**' } }), 'data/guests');
  assert.equal(dirForCollection({ id: 'guest', query: { tag: 'guest' } }), 'data/guest');
  assert.equal(upsertRecord({ collection: 'guest', name: 'Maria Santos' }).path, 'data/guests/maria-santos.md');
});

test('listRecords counts the live rows and lists the rest apart', () => {
  seed();
  upsertRecord({ collection: 'guest', name: 'Maria Santos' }, { actor: 'scout-fb' });
  upsertRecord({ collection: 'guest', name: 'Jun Cruz' }, { actor: 'crystal' });
  const l = listRecords('guest');
  assert.equal(l.total, 2);
  assert.equal(l.quarantined.length, 0);
  assert.equal(l.collection.id, 'guest');
});
