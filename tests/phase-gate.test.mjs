// The gate, quarantine and reject reasons — T08, docs/01_CANON.md Law 4–5.
//
// Law 4's actual claim is narrow and worth stating precisely, because it is easy to test the wrong
// thing: you cannot PREVENT an agent with folder access from writing. You can make the write have
// no effect and be visible. So every case here asserts BOTH halves — the refusal, and the `refused`
// or `quarantine` line in Activity that a human can find afterwards. A gate that holds silently is
// half a gate: the human never learns which assistant is fighting the rules.

import '../tests/_env.mjs'; // first — sets the storage root before store.mjs captures it
import test from 'node:test';
import assert from 'node:assert';
import { freshRoot, req, getStorageRoot, writeMd, readMd, fs, path } from './helpers.mjs';
import { app } from '../backend/index.mjs';
import { saveCollection } from '../backend/collections.mjs';
import {
  upsertRecord, moveRecord, archiveRecord, acceptRecord, readRecord, listRecords,
  isQuarantined, sweepQuarantine, ARCHIVE_REASONS, AGENT_MAX_STAGE, registerRecordRoutes,
} from '../backend/records.mjs';
import { readEvents, eventsFor } from '../backend/log.mjs';

const isMounted = () => (app._router?.stack || []).some(l => l.route && l.route.path === '/api/records/upsert');
if (!isMounted()) registerRecordRoutes(app, {});

const R = () => getStorageRoot();

const GUEST = {
  id: 'guest',
  query: { path: 'data/guests/**' },
  fields: [
    { key: 'name', type: 'text', primary: true },
    { key: 'status', type: 'status', gate: true, options: [
      { value: 'needs-review', group: 'todo' }, { value: 'shortlist', group: 'todo' },
      { value: 'contacted', group: 'active' }, { value: 'replied', group: 'active' },
      { value: 'won', group: 'done' }, { value: 'archived', group: 'done' },
    ] },
    { key: 'handle', type: 'text' },
    { key: 'score', type: 'number' },
  ],
};

function seed() {
  freshRoot();
  saveCollection(GUEST);
}
// A file dropped straight into data/ by something with folder access — door 2 without the pipeline.
function dropFile(rel, data, body = '') {
  const abs = path.join(R(), rel);
  writeMd(abs, data, body);
  return rel;
}
const fm = (rel) => readMd(path.join(R(), rel)).data;
const refusals = () => readEvents({ type: 'refused' });

// ── REFUSAL 1 · promoting past shortlist, on write (T08 step 1) ────────────────────────────────

test('an agent moving a record past shortlist gets 403, and the attempt is in Activity', async () => {
  seed();
  const r = upsertRecord({ collection: 'guest', name: 'Maria Santos' }, { actor: 'scout-fb' });

  // As far as shortlist is allowed — the gate is a ceiling, not a wall.
  assert.deepEqual(moveRecord(r.path, { to: 'shortlist', actor: 'scout-fb' }), { path: r.path, from: 'needs-review', to: 'shortlist' });

  assert.throws(() => moveRecord(r.path, { to: 'contacted', actor: 'scout-fb' }), e => e.status === 403);
  assert.equal(fm(r.path).status, 'shortlist', 'the refused stage landed on disk anyway');

  const http = await req('POST', '/api/records/move', { path: r.path, to: 'won', actor: 'scout-fb' });
  assert.equal(http.status, 403);
  assert.match(http.body.error, new RegExp(AGENT_MAX_STAGE));

  // T08's own path shape, which skills/scout-router documents to agents.
  const byId = await req('POST', '/api/records/maria-santos/move', { to: 'contacted', actor: 'scout-fb' });
  assert.equal(byId.status, 403);

  const seen = refusals();
  assert.equal(seen.length, 3, 'every attempt is a line, not just the first');
  assert.ok(seen.every(e => e.actor === 'scout-fb' && e.target === r.path));
  assert.deepEqual(seen.map(e => e.detail.to), ['contacted', 'won', 'contacted']);

  const activity = await req('GET', '/api/activity?type=refused');
  assert.equal(activity.body.events.length, 3);
});

test('the same move by a human is allowed — the gate is about the actor, not the stage', async () => {
  seed();
  const r = upsertRecord({ collection: 'guest', name: 'Maria Santos' }, { actor: 'scout-fb' });
  const moved = await req('POST', '/api/records/move', { path: r.path, to: 'won', actor: 'crystal' });
  assert.equal(moved.status, 200);
  assert.equal(fm(r.path).status, 'won');
  assert.equal(fm(r.path).proposed, false, 'a human disposing of it clears the proposal');
  assert.equal(refusals().length, 0);
  assert.deepEqual(eventsFor(r.path).map(e => e.type), ['move', 'store']);
});

test('an agent may not reach a late stage through upsert or through the document surface either', async () => {
  seed();
  const r = upsertRecord({ collection: 'guest', name: 'Maria Santos' }, { actor: 'crystal' });
  const patch = await req('PATCH', '/api/records', { path: r.path, patch: { status: 'contacted' }, actor: 'scout-fb' });
  assert.equal(patch.status, 403);
  const up = await req('POST', '/api/records/upsert', { collection: 'guest', name: 'Jun Cruz', status: 'won', actor: 'scout-fb' });
  assert.equal(up.status, 403);
  assert.equal(fm(r.path).status, 'needs-review');
  assert.equal(refusals().length, 2);
});

// ── REFUSAL 2 · an agent-authored stage past shortlist, on read (T08 step 2) ───────────────────

test('an agent-authored stage past shortlist is ignored on read, flagged, and logged once', async () => {
  seed();
  // The write we cannot prevent: an agent with folder access edits the file directly.
  const rel = dropFile('data/guests/maria-santos.md', {
    name: 'Maria Santos', status: 'contacted', handle: '@mariacooks',
    created: '2026-08-17', updated: '2026-08-19', created_by: 'scout-fb', updated_by: 'scout-fb',
    provenance: 'pipeline',
  }, 'A nurse who cooks on camera.\n');

  const read = readRecord(rel);
  assert.equal(read.data.status, AGENT_MAX_STAGE, 'the stage must read back as the last legal one');
  assert.equal(read.flags.agentPromotion, true);
  assert.deepEqual(read.flags.promotionIgnored, { field: 'status', wrote: 'contacted', shown: 'shortlist', by: 'scout-fb' });
  assert.equal(read.raw.status, 'contacted', 'Law 8 — the file still says what it says, and we show that too');
  assert.equal(fm(rel).status, 'contacted', 'nothing rewrote the user\'s file');

  const over = await req('GET', '/api/records?path=' + encodeURIComponent(rel));
  assert.equal(over.body.data.status, 'shortlist');
  assert.equal(over.body.flags.agentPromotion, true);

  // Logged ONCE, however many times the record is read — otherwise one bad file buries the day.
  readRecord(rel); readRecord(rel);
  const seen = refusals();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].actor, 'scout-fb');
  assert.match(seen[0].detail.reason, /ignored on read/);
});

test('the same stage authored by a human is honoured — provenance is what decides', () => {
  seed();
  const rel = dropFile('data/guests/ana-reyes.md', {
    name: 'Ana Reyes', status: 'contacted',
    created_by: 'scout-fb', updated_by: 'crystal', provenance: 'pipeline',
  });
  const read = readRecord(rel);
  assert.equal(read.data.status, 'contacted');
  assert.equal(read.flags.agentPromotion, false);
  assert.equal(refusals().length, 0);
});

// ── REFUSAL 3 · written directly under data/ (T08 step 3) ─────────────────────────────────────

test('a file written under data/ outside the pipeline is quarantined and counted nowhere', async () => {
  seed();
  const clean = upsertRecord({ collection: 'guest', name: 'Maria Santos' }, { actor: 'scout-fb' });
  // Same agent, same folder, no pipeline: no `provenance: pipeline` stamp.
  const rogue = dropFile('data/guests/jun-cruz.md', { name: 'Jun Cruz', status: 'won', created_by: 'scout-fb', updated_by: 'scout-fb' });
  // A file a human made that an agent then edited in place is the same violation from the other end.
  const hijacked = dropFile('data/guests/ana-reyes.md', { name: 'Ana Reyes', created_by: 'crystal', updated_by: 'scout-fb' });

  assert.equal(readRecord(rogue).flags.quarantined, true);
  assert.equal(readRecord(hijacked).flags.quarantined, true);
  assert.equal(readRecord(clean.path).flags.quarantined, false, 'a record that came through the pipeline is not quarantined');

  // Visible and marked, but excluded from the count.
  const listed = listRecords('guest');
  assert.equal(listed.total, 1);
  assert.deepEqual(listed.rows.map(d => d.slug), ['maria-santos']);
  assert.deepEqual(listed.quarantined.map(d => d.slug).sort(), ['ana-reyes', 'jun-cruz']);
  assert.ok(fs.existsSync(path.join(R(), rogue)), 'never deleted — quarantine is not removal');

  const over = await req('GET', '/api/records?collection=guest');
  assert.equal(over.body.total, 1);
  assert.equal(over.body.quarantined.length, 2);

  // MARKED, not merely computed: territory.mjs, documents.mjs and every view read plain
  // frontmatter, so a flag that lived only inside records.mjs would leave the file counted
  // everywhere else. The mark must not falsify the record's own provenance while it is at it.
  assert.equal(fm(rogue).quarantined, true, 'the quarantine is not on the file, so nothing else can see it');
  assert.equal(fm(rogue).updated_by, 'scout-fb', 'marking rewrote the record\'s provenance');
  assert.equal(fm(clean.path).quarantined, undefined, 'a clean record was marked');

  // And it is in Activity, once per file.
  const q = readEvents({ type: 'quarantine' });
  assert.equal(q.length, 2);
  assert.deepEqual(q.map(e => e.target).sort(), ['data/guests/ana-reyes.md', 'data/guests/jun-cruz.md']);

  // A quarantined record is never a merge target — a real finding must not disappear into it.
  const again = upsertRecord({ collection: 'guest', name: 'Jun Cruz', handle: '@juncruz' }, { actor: 'scout-fb' });
  assert.equal(again.verdict, 'store');
  assert.equal(listRecords('guest').total, 2);
});

test('a human accepting a quarantined record is what makes it count', async () => {
  seed();
  const rogue = dropFile('data/guests/jun-cruz.md', { name: 'Jun Cruz', created_by: 'scout-fb', updated_by: 'scout-fb' });
  assert.equal(listRecords('guest').total, 0);

  const accepted = await req('POST', '/api/records/accept', { path: rogue, actor: 'crystal' });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.flags.quarantined, false);
  assert.equal(fm(rogue).quarantined, false);
  assert.equal(listRecords('guest').total, 1);
  assert.equal(readEvents({ type: 'accept' }).length, 1);
  assert.equal(fm(rogue).history[0].action, 'accept');

  // Only a human disposes.
  const byAgent = await req('POST', '/api/records/accept', { path: rogue, actor: 'scout-fb' });
  assert.equal(byAgent.status, 403);
});

// Law 1 is the constraint that decides the shape of the rule: a person must be able to open the
// folder in Finder or Obsidian and work in it. A note they type by hand has no `created_by` and
// never will, so "unattributed" cannot mean "quarantined" — see the note over isQuarantined.
test('a file a human wrote by hand keeps working, attributed or not', () => {
  seed();
  const named = dropFile('data/guests/rowena-cruz.md', { name: 'Rowena Cruz', created_by: 'crystal' });
  const typed = dropFile('data/guests/nobody.md', { name: 'Nobody' });   // straight out of Obsidian
  assert.equal(readRecord(named).flags.quarantined, false);
  assert.equal(readRecord(typed).flags.quarantined, false);
  assert.equal(listRecords('guest').total, 2);
  assert.equal(readEvents({ type: 'quarantine' }).length, 0);

  // The predicate other modules must call, rather than writing a second copy of the rule.
  assert.equal(isQuarantined({ created_by: 'crystal' }, 'data/guests/x.md'), false);
  assert.equal(isQuarantined({}, 'data/guests/x.md'), false, 'a hand-typed note is not an intruder');
  assert.equal(isQuarantined({ created_by: 'scout-fb' }, 'data/guests/x.md'), true);
  assert.equal(isQuarantined({ created_by: 'crystal', updated_by: 'scout-fb' }, 'data/guests/x.md'), true);
  assert.equal(isQuarantined({ created_by: 'scout-fb', provenance: 'pipeline' }, 'data/guests/x.md'), false);
  assert.equal(isQuarantined({ created_by: 'scout-fb', quarantined: false }, 'data/guests/x.md'), false, 'an accepted record stays accepted');
  assert.equal(isQuarantined({}, 'territory/nurses-ph.md'), false, 'only the record store is gated');
  assert.equal(isQuarantined({ created_by: 'scout-fb' }, 'data/_archive/guest/x.md'), false);
});

test('sweepQuarantine marks the whole store in one pass and is idempotent', () => {
  seed();
  upsertRecord({ collection: 'guest', name: 'Maria Santos' }, { actor: 'scout-fb' });
  dropFile('data/guests/jun-cruz.md', { name: 'Jun Cruz', created_by: 'scout-fb' });
  dropFile('data/guests/rico-manalo.md', { name: 'Rico Manalo', created_by: 'vetter' });
  dropFile('territory/nurses-ph.md', { id: 'nurses-ph', created_by: 'scout-fb' });   // not a record

  assert.deepEqual(sweepQuarantine().sort(), ['data/guests/jun-cruz.md', 'data/guests/rico-manalo.md']);
  assert.deepEqual(sweepQuarantine(), [], 'a second pass rewrote files it had already marked');
  assert.equal(fm('territory/nurses-ph.md').quarantined, undefined, 'a memory object is not a record');
  assert.equal(listRecords('guest').total, 1);
});

// ── REFUSAL 4 · archive needs a reason, and never deletes (T08 steps 4–5) ─────────────────────

test('archiving without a reason is a 400, and the file is untouched', async () => {
  seed();
  const r = upsertRecord({ collection: 'guest', name: 'Maria Santos' }, { actor: 'scout-fb' });

  const none = await req('POST', '/api/records/archive', { path: r.path, actor: 'crystal' });
  assert.equal(none.status, 400);
  assert.deepEqual(none.body.reasons, ARCHIVE_REASONS, 'the error names the legal set, so nobody has to guess');

  const bogus = await req('POST', '/api/records/archive', { path: r.path, reason: 'i did not like them', actor: 'crystal' });
  assert.equal(bogus.status, 400);
  assert.throws(() => archiveRecord(r.path, { reason: '', actor: 'crystal' }), e => e.status === 400);

  // Law 5 has one door: you cannot reach `archived` by moving the status and dodging the reason.
  const sideways = await req('POST', '/api/records/move', { path: r.path, to: 'archived', actor: 'crystal' });
  assert.equal(sideways.status, 400);

  assert.ok(fs.existsSync(path.join(R(), r.path)), 'a refused archive must not have moved anything');
  assert.equal(listRecords('guest').total, 1);
});

test('archiving with a reason moves the file, keeps its frontmatter, its reason and its history', async () => {
  seed();
  const r = upsertRecord({ collection: 'guest', name: 'Maria Santos', handle: '@mariacooks', score: 9, body: 'A nurse who cooks on camera.' }, { actor: 'scout-fb' });
  moveRecord(r.path, { to: 'shortlist', actor: 'scout-fb' });

  const done = await req('POST', '/api/records/archive', { path: r.path, reason: 'off-target', actor: 'crystal' });
  assert.equal(done.status, 200);
  assert.equal(done.body.path, 'data/_archive/guest/maria-santos.md');

  assert.ok(!fs.existsSync(path.join(R(), r.path)), 'the record is no longer in the live store');
  const archived = readMd(path.join(R(), done.body.path));
  assert.equal(archived.data.name, 'Maria Santos', 'frontmatter survives the move');
  assert.equal(archived.data.handle, '@mariacooks');
  assert.equal(archived.data.score, 9);
  assert.equal(archived.data.archived, true);
  assert.equal(archived.data.archive_reason, 'off-target');
  assert.equal(archived.data.archived_by, 'crystal');
  assert.equal(archived.data.archived_from, r.path);
  assert.equal(archived.data.status, 'archived');
  assert.match(archived.content, /A nurse who cooks on camera\./, 'the body survives too');

  // Full history: the reason, who, when, and where it came from — the rejects are the training data.
  assert.equal(archived.data.history.length, 1);
  assert.deepEqual(
    { by: archived.data.history[0].by, action: archived.data.history[0].action, reason: archived.data.history[0].reason, from: archived.data.history[0].from },
    { by: 'crystal', action: 'archive', reason: 'off-target', from: r.path });
  assert.deepEqual(eventsFor(r.path).map(e => e.type), ['archive', 'move', 'store']);
  assert.equal(eventsFor(r.path)[0].detail.reason, 'off-target');

  assert.equal(listRecords('guest').total, 0, 'an archived record leaves the collection');
  assert.equal((await req('POST', '/api/records/archive', { path: done.body.path, reason: 'off-target', actor: 'crystal' })).status, 400);
});

test('archiving is available on T08\'s own route shape, and every reason in the set is legal', async () => {
  seed();
  for (const reason of ARCHIVE_REASONS) {
    upsertRecord({ collection: 'guest', name: 'Guest ' + reason }, { actor: 'scout-fb' });
    const r = await req('POST', '/api/records/guest-' + reason + '/archive', { reason, actor: 'scout-fb' });
    assert.equal(r.status, 200, reason + ': ' + JSON.stringify(r.body));
    assert.equal(readMd(path.join(R(), r.body.path)).data.archive_reason, reason);
  }
  assert.equal(listRecords('guest').total, 0);
  assert.equal(fs.readdirSync(path.join(R(), 'data', '_archive', 'guest')).length, ARCHIVE_REASONS.length);
});
