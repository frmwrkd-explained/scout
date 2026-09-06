// M1 — collections, documents, saved views, and REFERENCED BY.
//
// backend/collections.mjs, documents.mjs and views.mjs shipped with their Demonstrate sections
// performed by curl but with NO tests. docs/07_BUILD_ORDER.md's Definition of Done says "it has a
// test if it is logic", and all three are logic. This file is that test.
//
// The load-bearing case is `frontmatter wins over the computed cache` (T02 step 5): the day that
// inverts is the day the cache stops being disposable and Law 1 quietly dies.

import '../tests/_env.mjs'; // first — sets the storage root before store.mjs captures it
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { freshRoot, req, writeMd, getStorageRoot } from './helpers.mjs';
import { saveCollection, getCollection, addField, FIELD_TYPE_NAMES } from '../backend/collections.mjs';
import { documentsFor, documentAt, allDocuments, referencesTo, collectionsOf, firstParagraph } from '../backend/documents.mjs';
import { defaultView, inferViewType, saveView, listViews, applyView } from '../backend/views.mjs';

const R = () => getStorageRoot();
const md = (rel, data, body = '') => {
  const abs = path.join(R(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  writeMd(abs, data, body);
  return abs;
};

const GUEST = {
  id: 'guest',
  query: { path: 'data/guests/**' },
  fields: [
    { key: 'name', type: 'text', primary: true },
    { key: 'status', type: 'status', options: ['new', 'shortlist', 'booked'], gate: true },
    { key: 'score', type: 'number', display: 'bar', min: 1, max: 10 },
    { key: 'found_in', type: 'relation', target: 'guest' }, // self-target: legal, and on disk at create
  ],
};

function seedGuests() {
  saveCollection(GUEST);
  md('data/guests/maria-santos.md', { name: 'Maria Santos', status: 'shortlist', score: 9 }, 'A nurse who cooks on camera.\n');
  md('data/guests/jun-cruz.md', { name: 'Jun Cruz', status: 'new', score: 4 }, 'Runs a sari-sari store.\n');
  md('data/guests/ana-reyes.md', { name: 'Ana Reyes', status: 'booked', score: 7 }, 'Already on tape.\n');
}

// ── schema validation (T02 step 3) ─────────────────────────────────────────────────────────────
// Each of these is a 400 with a message that tells the author what to do instead. A validator that
// says only "invalid" makes an agent guess, and an agent that guesses writes the same bad schema
// again with a different typo.

test('an unknown field type is refused, and the error names the full legal set', async () => {
  freshRoot();
  const r = await req('POST', '/api/collections', {
    id: 'bad', fields: [{ key: 'name', type: 'text', primary: true }, { key: 'oops', type: 'sting' }],
  });
  assert.equal(r.status, 400);
  // T02 step 3 requires the legal set in the message, not just a rejection.
  for (const t of FIELD_TYPE_NAMES) assert.ok(r.body.error.includes(t), 'missing "' + t + '" from: ' + r.body.error);
});

test('exactly one primary field — zero and two are both refused', async () => {
  freshRoot();
  const none = await req('POST', '/api/collections', { id: 'p0', fields: [{ key: 'a', type: 'text' }] });
  assert.equal(none.status, 400);
  assert.match(none.body.error, /exactly one primary/);

  const two = await req('POST', '/api/collections', {
    id: 'p2', fields: [{ key: 'a', type: 'text', primary: true }, { key: 'b', type: 'text', primary: true }],
  });
  assert.equal(two.status, 400);
  assert.match(two.body.error, /found 2/);
});

test('at most one gate: true field, and the gate belongs on a status', async () => {
  freshRoot();
  const two = await req('POST', '/api/collections', {
    id: 'g2',
    fields: [
      { key: 'a', type: 'text', primary: true },
      { key: 's1', type: 'status', options: ['x', 'y'], gate: true },
      { key: 's2', type: 'status', options: ['x', 'y'], gate: true },
    ],
  });
  assert.equal(two.status, 400);
  assert.match(two.body.error, /at most one gate/);

  // `gate` on a non-status is caught EARLIER, by the per-field option check, and says more: it
  // names what that type does allow. validateSchema's own "gate: true belongs on a status field"
  // is therefore unreachable in practice — it is defence in depth for a future type that lists
  // `gate` in its opts, not the message anyone actually sees. Assert what is actually reachable.
  const wrongType = await req('POST', '/api/collections', {
    id: 'gt', fields: [{ key: 'a', type: 'text', primary: true, gate: true }],
  });
  assert.equal(wrongType.status, 400);
  assert.match(wrongType.body.error, /"gate" is not an option of type text/);
  assert.match(wrongType.body.error, /Allowed: multiline/);
});

test('a relation to a non-collection is refused, and the error lists the collections that DO exist', async () => {
  freshRoot();
  saveCollection(GUEST);
  const r = await req('POST', '/api/collections', {
    id: 'message',
    fields: [{ key: 'subject', type: 'text', primary: true }, { key: 'g', type: 'relation', target: 'guset' }],
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /not a collection/);
  assert.match(r.body.error, /guest/, 'the message must show what the author could have meant');
});

test('an unknown option on a known field type is refused rather than silently ignored', async () => {
  freshRoot();
  const r = await req('POST', '/api/collections', {
    id: 'opt', fields: [{ key: 'a', type: 'text', primary: true, mutliline: true }],
  });
  assert.equal(r.status, 400, 'a typo in an option sat silently in the schema: ' + JSON.stringify(r.body));
});

// The HUMAN's `+ Add property` door, which the unit test above never went through. It shipped
// broken for the whole build: AddField.jsx posts `{ ...field, actor }`, and `validateField`
// rejects every key outside the type's allowlist — deliberately, so a typo cannot sit unnoticed
// in a schema — so EVERY manual field add 400'd with `"actor" is not an option of type text`.
// The agent's path never hit it (proposals.mjs hands `card.field` over clean), which is exactly
// why 590 green tests said nothing: the only door that was broken was the one only a person uses.
// The route has to destructure the actor off. Reverted, this goes red.
test('the human door: POST /fields takes an actor beside the field and does not mistake it for one', async () => {
  freshRoot();
  seedGuests();
  const r = await req('POST', '/api/collections/guest/fields', { key: 'home_city', type: 'text', actor: 'crystal' });
  assert.equal(r.status, 200, 'the actor was validated as a field option: ' + JSON.stringify(r.body));
  assert.ok((r.body.fields || []).some(f => f.key === 'home_city'), 'the field was not added');
  // The actor belongs in the log, not in the schema — a field carrying `actor` would fail
  // validation on the NEXT write of this collection, from anywhere.
  const added = (r.body.fields || []).find(f => f.key === 'home_city');
  assert.equal(added.actor, undefined, 'the actor was stored on the field');
});

test('a schema change is a mutation, so it lands in the event log with who did it', async () => {
  freshRoot();
  seedGuests();
  await req('POST', '/api/collections/guest/fields', { key: 'home_city', type: 'text', actor: 'crystal' });
  const { body } = await req('GET', '/api/activity?limit=20');
  const ev = (body.events || []).find(e => e.type === 'schema' && e.detail && e.detail.field === 'home_city');
  assert.ok(ev, 'no schema event was logged: ' + JSON.stringify(body.events));
  assert.equal(ev.actor, 'crystal');
  assert.equal(ev.target, '.scout/collections/guest.md');
});

test('adding a field never rewrites existing documents — missing reads as empty', () => {
  freshRoot();
  seedGuests();
  addField('guest', { key: 'handle', type: 'text' });
  const { documents } = documentsFor('guest');
  assert.equal(documents.length, 3);
  assert.ok(documents.every(d => d.fields.handle === undefined));
  // and the file on disk is untouched
  assert.ok(!fs.readFileSync(path.join(R(), 'data/guests/maria-santos.md'), 'utf8').includes('handle'));
});

// ── the query is the membership rule (T02 §1) ──────────────────────────────────────────────────

test('a document belongs to a collection by MATCHING, and may belong to several at once', () => {
  freshRoot();
  seedGuests();
  saveCollection({
    id: 'shortlisted',
    query: { path: 'data/guests/**', where: { status: 'shortlist' } },
    fields: [{ key: 'name', type: 'text', primary: true }],
  });
  assert.deepEqual(documentsFor('shortlisted').documents.map(d => d.slug), ['maria-santos']);
  const maria = documentAt('data/guests/maria-santos.md');
  assert.deepEqual(collectionsOf(maria).sort(), ['guest', 'shortlisted']);
});

test('a query that constrains nothing matches nothing — it is a schema bug, not an "everything" collection', () => {
  freshRoot();
  seedGuests();
  saveCollection({ id: 'empty-query', query: {}, fields: [{ key: 'name', type: 'text', primary: true }] });
  assert.equal(documentsFor('empty-query').documents.length, 0);
});

test('a malformed document costs one record, never the whole read', () => {
  freshRoot();
  seedGuests();
  fs.writeFileSync(path.join(R(), 'data/guests/broken.md'), '---\nname: [unclosed\n  bad: : :\n---\nbody\n');
  const { documents } = documentsFor('guest');
  assert.ok(documents.length >= 3, 'one bad file took out the collection');
});

// ── derived values, and the law that protects the cache (T02 step 5) ───────────────────────────

test('a rollup follows the data, and FRONTMATTER WINS over the computed value', () => {
  freshRoot();
  saveCollection({
    id: 'finding',
    query: { path: 'data/findings/**' },
    fields: [{ key: 'title', type: 'text', primary: true }, { key: 'weight', type: 'number' }],
  });
  saveCollection({
    id: 'rollup-holder',
    query: { path: 'data/rollups/**' },
    fields: [
      { key: 'title', type: 'text', primary: true },
      { key: 'evidence', type: 'relation', target: 'finding', many: true },
      { key: 'evidence_count', type: 'rollup', via: 'evidence', target_field: 'weight', fn: 'count' },
      { key: 'evidence_weight', type: 'rollup', via: 'evidence', target_field: 'weight', fn: 'sum' },
    ],
  });
  md('data/findings/f1.md', { title: 'f1', weight: 2 });
  md('data/findings/f2.md', { title: 'f2', weight: 3 });
  md('data/rollups/r1.md', { title: 'r1', evidence: ['f1', 'f2'] });

  const one = documentsFor('rollup-holder').documents[0];
  assert.equal(one.fields.evidence_count, 2);
  assert.equal(one.fields.evidence_weight, 5);

  // add a third finding and change the data → the rollup FOLLOWS
  md('data/findings/f3.md', { title: 'f3', weight: 5 });
  md('data/rollups/r1.md', { title: 'r1', evidence: ['f1', 'f2', 'f3'] });
  const two = documentsFor('rollup-holder').documents[0];
  assert.equal(two.fields.evidence_count, 3);
  assert.equal(two.fields.evidence_weight, 10);

  // THE ONE THAT MATTERS. A human (or an agent) who typed a value into the file MEANT it. If the
  // computed value won here, the cache would have become authoritative and "files are the truth"
  // would be false — silently, and only for derived fields, which is the worst way to be wrong.
  md('data/rollups/r1.md', { title: 'r1', evidence: ['f1', 'f2', 'f3'], evidence_count: 99 });
  const three = documentsFor('rollup-holder').documents[0];
  assert.equal(three.fields.evidence_count, 99, 'the computed cache overwrote a value from the file');
  assert.equal(three.fields.evidence_weight, 10, 'overriding one derived field stopped its siblings computing');
});

test('the computed cache is disposable — delete .scout/cache/ and everything still resolves', () => {
  freshRoot();
  seedGuests();
  const before = documentsFor('guest').documents.map(d => d.fields.score);
  assert.ok(fs.existsSync(path.join(R(), '.scout', 'cache', 'computed.json')), 'no cache was written to delete');

  fs.rmSync(path.join(R(), '.scout', 'cache'), { recursive: true, force: true });
  const after = documentsFor('guest').documents.map(d => d.fields.score);
  assert.deepEqual(after, before, 'the read did not survive losing its cache');
});

test('a formula is sandboxed — no I/O escapes it, and a hostile expression yields null', () => {
  freshRoot();
  saveCollection({
    id: 'calc',
    query: { path: 'data/calc/**' },
    fields: [
      { key: 'title', type: 'text', primary: true },
      { key: 'a', type: 'number' }, { key: 'b', type: 'number' },
      { key: 'total', type: 'formula', expr: 'a * b' },
      { key: 'evil', type: 'formula', expr: 'process.exit(1)' },
    ],
  });
  md('data/calc/c1.md', { title: 'c1', a: 6, b: 7 });
  const d = documentsFor('calc').documents[0];
  assert.equal(d.fields.total, 42);
  assert.equal(d.fields.evil, null, 'a formula reached outside its own document');
});

test('the summary is the first human paragraph, not the first heading', () => {
  assert.equal(firstParagraph('# Title\n\nThe real sentence.\n\nMore.'), 'The real sentence.');
  assert.equal(firstParagraph(''), '');
  assert.equal(firstParagraph('Wrapped\nacross lines.'), 'Wrapped across lines.');
});

// ── views (T03) ────────────────────────────────────────────────────────────────────────────────

test('the default view type is inferred from shape, never asked about', () => {
  assert.equal(inferViewType({ fields: [{ key: 's', type: 'status', options: ['a', 'b', 'c'] }] }), 'board');
  assert.equal(inferViewType({ fields: [{ key: 'd', type: 'date' }] }), 'list');
  assert.equal(inferViewType({ fields: [{ key: 'f', type: 'file', primary_media: true }] }), 'gallery');
  assert.equal(inferViewType({ fields: [{ key: 'n', type: 'text' }] }), 'table');
  // two options is a toggle, not a board
  assert.equal(inferViewType({ fields: [{ key: 's', type: 'status', options: ['a', 'b'] }] }), 'table');
});

test('two saved views over one collection return different rows', async () => {
  freshRoot();
  seedGuests();
  saveView('guest', { id: 'hot', label: 'Hot', type: 'table', filter: [{ field: 'score', op: 'gte', value: 7 }], sort: [{ field: 'score', dir: 'desc' }] });
  saveView('guest', { id: 'new-only', label: 'New', type: 'table', filter: [{ field: 'status', op: 'is', value: 'new' }] });

  const hot = await req('GET', '/api/collections/guest/documents?view=hot');
  const neu = await req('GET', '/api/collections/guest/documents?view=new-only');
  assert.deepEqual(hot.body.rows.map(r => r.slug), ['maria-santos', 'ana-reyes']);
  assert.deepEqual(neu.body.rows.map(r => r.slug), ['jun-cruz']);
  // same collection, same total — the VIEW is what differs
  assert.equal(hot.body.total, neu.body.total);
});

test('a saved view survives a round trip to disk, and the generated flag does not', () => {
  freshRoot();
  seedGuests();
  assert.equal(defaultView(getCollection('guest')).generated, true);
  saveView('guest', { id: 'hot', label: 'Hot', type: 'table', filter: [{ field: 'score', op: 'gte', value: 7 }] });
  const saved = listViews('guest').views.find(v => v.id === 'hot');
  assert.ok(saved, 'the view did not survive the write');
  assert.equal(saved.generated, undefined, 'a saved view still claims to be generated');
});

test('empties sink in a sort, in both directions', () => {
  const docs = [
    { slug: 'a', fields: { score: 5 } },
    { slug: 'none', fields: {} },
    { slug: 'b', fields: { score: 9 } },
  ];
  const asc = applyView({ sort: [{ field: 'score', dir: 'asc' }] }, docs).rows.map(d => d.slug);
  const desc = applyView({ sort: [{ field: 'score', dir: 'desc' }] }, docs).rows.map(d => d.slug);
  assert.deepEqual(asc, ['a', 'b', 'none']);
  assert.deepEqual(desc, ['b', 'a', 'none']);
});

test('a subtable is a bound collection — one mechanism, no second storage (§4)', async () => {
  freshRoot();
  saveCollection(GUEST);
  saveCollection({
    id: 'message',
    query: { path: 'data/messages/**' },
    fields: [
      { key: 'subject', type: 'text', primary: true },
      { key: 'guest', type: 'relation', target: 'guest' },
    ],
  });
  md('data/messages/m1.md', { subject: 'first', guest: 'maria-santos' });
  md('data/messages/m2.md', { subject: 'second', guest: 'maria-santos' });
  md('data/messages/m3.md', { subject: 'other', guest: 'jun-cruz' });

  const all = await req('GET', '/api/collections/message/documents');
  assert.equal(all.body.rows.length, 3);

  // T03's Demonstrate: a subtable listing only ONE guest's messages.
  const bound = await req('GET', '/api/collections/message/documents?bind=' + encodeURIComponent(JSON.stringify({ guest: 'maria-santos' })));
  assert.deepEqual(bound.body.rows.map(r => r.slug).sort(), ['m1', 'm2']);

  const bad = await req('GET', '/api/collections/message/documents?bind=not-json');
  assert.equal(bad.status, 400);
});

// ── REFERENCED BY (T05 §2) ─────────────────────────────────────────────────────────────────────

function seedReferrers() {
  seedGuests();
  saveCollection({
    id: 'message',
    query: { path: 'data/messages/**' },
    fields: [
      { key: 'subject', type: 'text', primary: true },
      { key: 'guest', type: 'relation', target: 'guest' },
    ],
  });
  md('data/messages/m1.md', { subject: 'First outreach', guest: 'maria-santos' });
  // the three from T05's Demonstrate — all MEMORY objects, none of them in any collection
  md('territory/nurses-ph.md', { id: 'nurses-ph', type: 'territory', label: 'Nurses PH', top_finds: ['maria-santos', 'jun-cruz'] });
  md('learnings/dm-beats-comment.md', { type: 'learning', title: 'A DM beats a comment', evidence: ['maria-santos', 'ana-reyes'] });
  md('projects/2026-08-hazing/brief.md', { type: 'brief', name: 'Hazing — August', featured: 'maria-santos' });
}

test('T05 Demonstrate: a guest referenced by a territory, a learning and a project brief shows three entries with their field names', () => {
  freshRoot();
  seedReferrers();
  const refs = referencesTo('maria-santos');
  const memory = refs.filter(r => !r.declared);
  assert.deepEqual(
    memory.map(r => [r.source, r.field]).sort(),
    [['brief', 'featured'], ['learning', 'evidence'], ['territory', 'top_finds']],
  );
  assert.equal(memory.find(r => r.source === 'territory').title, 'Nurses PH', 'a memory object lost its label');
});

test('a declared relation is marked declared and carries its source collection; a loose pointer is not', () => {
  freshRoot();
  seedReferrers();
  const refs = referencesTo('maria-santos');
  const typed = refs.filter(r => r.declared);
  assert.deepEqual(typed.map(r => [r.collection, r.field]), [['message', 'guest']]);
  assert.equal(refs[0].declared, true, 'typed relations must sort above loose pointers');
  assert.ok(refs.filter(r => !r.declared).every(r => r.collection === null));
});

test('REFERENCED BY crosses collections — this is the case the client-side version could not do', async () => {
  freshRoot();
  seedReferrers();
  // The old inspector computed this from the loaded rows of the ACTIVE collection only, so a guest
  // referenced from territory/, learnings/ and projects/ showed nothing at all.
  const r = await req('GET', '/api/document/references?path=data/guests/maria-santos.md');
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 4);
  const dirs = new Set(r.body.references.map(x => x.path.split('/')[0]));
  assert.deepEqual([...dirs].sort(), ['data', 'learnings', 'projects', 'territory']);
});

test('the match is exact — a slug inside a sentence is not a backlink', () => {
  freshRoot();
  seedReferrers();
  md('data/messages/m9.md', { subject: 'About maria-santos and nurses', guest: 'someone-else', note: 'maria-santos is great' });
  const refs = referencesTo('maria-santos');
  assert.ok(refs.every(r => r.slug !== 'm9'), 'a substring became a false backlink');
});

test('identity and provenance keys are not references', () => {
  freshRoot();
  seedReferrers();
  // `created_by`/`updated_by` are HISTORY's job (T05 §4); `id` is what a document IS.
  md('data/guests/jun-cruz.md', { name: 'Jun Cruz', status: 'new', score: 4, created_by: 'maria-santos', updated_by: 'maria-santos' });
  md('data/guests/twin.md', { name: 'Twin', id: 'maria-santos' });
  const refs = referencesTo('maria-santos');
  assert.ok(refs.every(r => r.slug !== 'jun-cruz'), 'provenance became a backlink');
  assert.ok(refs.every(r => r.slug !== 'twin'), 'an id: became a backlink');
});

test('a document never references itself, and a slug nothing points at returns nothing', () => {
  freshRoot();
  seedReferrers();
  assert.ok(referencesTo('maria-santos').every(r => r.slug !== 'maria-santos'));
  assert.deepEqual(referencesTo('nobody-points-at-me'), []);
});

test('the references route refuses an empty request and a path outside the store', async () => {
  freshRoot();
  seedReferrers();
  assert.equal((await req('GET', '/api/document/references')).status, 400);
  assert.equal((await req('GET', '/api/document/references?path=data/guests/nope.md')).status, 404);
  assert.equal((await req('GET', '/api/document/references?path=../../../etc/passwd')).status, 404);
});

test('?slug= and ?path= are the same question asked two ways', async () => {
  freshRoot();
  seedReferrers();
  const byPath = await req('GET', '/api/document/references?path=data/guests/maria-santos.md');
  const bySlug = await req('GET', '/api/document/references?slug=maria-santos');
  assert.deepEqual(bySlug.body.references, byPath.body.references);
});

// ── the walk itself ────────────────────────────────────────────────────────────────────────────

test('the store walk skips the disposable and the not-yet-admitted', () => {
  freshRoot();
  seedGuests();
  md('.scout/collections/guest.md', { id: 'guest', fields: [] });   // schema, not a document
  md('_inbox/dropped.md', { name: 'not through the pipeline yet' }); // Law 4 — not a record yet
  const paths = allDocuments().map(d => d.path);
  assert.ok(!paths.some(p => p.startsWith('.scout/')), '.scout/ is disposable and must not be walked');
  assert.ok(!paths.some(p => p.startsWith('_inbox/')), '_inbox/ has not passed the pipeline');
  assert.ok(paths.includes('data/guests/maria-santos.md'));
});

// ── `+ Add property`, on the collections that actually ship ────────────────────────────────────
//
// Every test above declares its own fixture, and every fixture was valid — so the one thing nobody
// tested was the schema the app SHIPS. `#guest` declares `tags: multiselect` with no options[], and
// `addField` re-validated the whole schema through `saveCollection`, so that pre-existing field
// 400ed every later write of the collection: `+ Add property` had never worked on a real workspace,
// for the human OR for an accepted agent `schema` card (GOAL gate 8), and the error named a field
// nobody had touched. "A fixture that is easier than production tests the easy case" (HANDOVER §3).

const WORKSPACES = ['workspace-template', 'workspace-demo'];

function rootFrom(name) {
  const root = freshRoot();
  fs.cpSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', name), root, { recursive: true });
  return root;
}

for (const ws of WORKSPACES) {
  test('every collection in ' + ws + ' takes a new field through the route AddField.jsx posts to', async () => {
    rootFrom(ws);
    const { body: list } = await req('GET', '/api/collections');
    const ids = (list.collections || []).map(c => c.id);
    assert.ok(ids.length, ws + ' ships no collections');
    for (const id of ids) {
      // exactly the body frontend/AddField.jsx sends: { ...field, actor }
      const r = await req('POST', '/api/collections/' + id + '/fields', { key: 'home_city', type: 'text', actor: 'crystal' });
      assert.equal(r.status, 200, '#' + id + ' refused a plain text field: ' + JSON.stringify(r.body));
      assert.ok((r.body.fields || []).some(f => f.key === 'home_city'), '#' + id + ' did not gain the field');
      // a field that was already invalid is NAMED rather than allowed to block an unrelated write
      for (const w of r.body.warnings || []) assert.match(w, /^existing field `.+` is invalid: /);
    }
  });

  test('every collection in ' + ws + ' opens on the view its schema names', async () => {
    rootFrom(ws);
    const { body: list } = await req('GET', '/api/collections');
    for (const c of list.collections || []) {
      const { body } = await req('GET', '/api/views/' + c.id);
      assert.deepEqual(body.warnings, [],
        '#' + c.id + ' names a default_view that does not exist: ' + JSON.stringify(body.warnings));
      if (c.default_view) assert.equal(body.defaultViewId, c.default_view);
    }
  });
}

test('a dangling default_view is reported, not silently swapped for whatever is first', async () => {
  freshRoot();
  saveCollection({ ...GUEST, default_view: 'needs-review' });
  const { body } = await req('GET', '/api/views/guest');
  // App.pickCollection does Math.max(0, findIndex(...)), so the dangling id resolved to index 0 and
  // she was shown a different view than the collection asked for, forever, with nothing said.
  assert.equal(body.defaultViewId, 'all', 'it still opens on something');
  assert.equal(body.warnings.length, 1, 'and it says so');
  assert.match(body.warnings[0], /needs-review/);
  assert.match(body.warnings[0], /#guest/);
});

// ── the open vocabulary ────────────────────────────────────────────────────────────────────────
// docs/decisions.md "seeding ambiguity 1", resolved: a multiselect with no options[] is a TAG
// FIELD — the next tag is legal because the person typed it. select and status are not.

test('a multiselect may declare no options — select and status may not', async () => {
  freshRoot();
  const open = await req('POST', '/api/collections', {
    id: 'tagged', query: { path: 'data/tagged/**' },
    fields: [{ key: 'name', type: 'text', primary: true }, { key: 'tags', type: 'multiselect' }],
  });
  assert.equal(open.status, 200, 'an open vocabulary was refused: ' + JSON.stringify(open.body));

  for (const type of ['select', 'status']) {
    const r = await req('POST', '/api/collections', {
      id: 'fixed-' + type, query: { path: 'data/x/**' },
      fields: [{ key: 'name', type: 'text', primary: true }, { key: 'stage', type }],
    });
    assert.equal(r.status, 400, type + ' must still require a fixed set');
    assert.match(r.body.error, /needs a non-empty options\[\]/);
  }
});

test('a multiselect that DOES declare options still has them validated', async () => {
  freshRoot();
  const bad = await req('POST', '/api/collections', {
    id: 'badtags', query: { path: 'data/x/**' },
    fields: [{ key: 'name', type: 'text', primary: true }, { key: 'tags', type: 'multiselect', options: ['ok', { colour: 'accent' }] }],
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /every option needs a value/);

  const notAList = await req('POST', '/api/collections', {
    id: 'strtags', query: { path: 'data/x/**' },
    fields: [{ key: 'name', type: 'text', primary: true }, { key: 'tags', type: 'multiselect', options: 'ph, health' }],
  });
  assert.equal(notAList.status, 400);
  assert.match(notAList.body.error, /options must be a list/);
});
