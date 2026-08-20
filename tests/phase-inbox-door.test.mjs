// T07 — door 2. `_inbox/` is untrusted input, `data/` is the store, the watcher is the border.
//
// Named `phase-inbox-door` rather than `phase-inbox` because `tests/phase5-inbox.test.mjs` already
// exists and guards a completely different thing (FrameForge's review-session cursor). Two files
// called "inbox" that mean different things is exactly the confusion Law 10 is about.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { freshRoot, writeMd } from './helpers.mjs';
import { getStorageRoot } from '../backend/store.mjs';
import { sweepInbox, ensureInbox, writeKnown, writeIndexFile, normalise, inferCollection } from '../backend/inbox.mjs';
import { documentsFor } from '../backend/documents.mjs';

function seedGuestCollection() {
  writeMd(path.join(getStorageRoot(), '.scout', 'collections', 'guest.md'), {
    id: 'guest', label: 'Guests', query: { tag: 'guest', path: 'data/guests/**' },
    fields: [
      { key: 'name', type: 'text', required: true, primary: true },
      { key: 'status', type: 'status', gate: true, options: [
        { value: 'needs-review', group: 'todo' }, { value: 'shortlist', group: 'todo' },
        { value: 'contacted', group: 'active' }, { value: 'won', group: 'done' }] },
      { key: 'handle', type: 'text' },
      { key: 'found_in', type: 'relation', target: 'group' },
      { key: 'score', type: 'number' },
      { key: 'tags', type: 'multiselect' },
    ],
  }, 'Guests.\n');
}

function drop(name, text) {
  const dir = ensureInbox();
  fs.writeFileSync(path.join(dir, name), text);
  return path.join(dir, name);
}

test('a hand-written .md dropped in _inbox lands in the store, deduped and logged', async () => {
  freshRoot();
  seedGuestCollection();

  drop('maria.md', `---
collection: guest
name: Maria Santos
handle: "@mariacooks"
found_in: nurses-ph
score: 9
tags: [guest]
---

A nurse who tells her own story rather than reviewing other people's.
`);

  const first = await sweepInbox();
  assert.equal(first.failed.length, 0, JSON.stringify(first.failed));
  assert.equal(first.processed.length, 1);
  assert.equal(first.processed[0].verdict, 'store');

  const rows = documentsFor('guest').documents;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fields.name, 'Maria Santos');

  // the source file moved out of the drop folder, into _done/<date>/
  const done = path.join(getStorageRoot(), '_inbox', '_done');
  assert.ok(fs.existsSync(done), '_done/ was not created');
  const dates = fs.readdirSync(done);
  assert.equal(dates.length, 1);
  assert.ok(fs.readdirSync(path.join(done, dates[0])).includes('maria.md'));

  // ── the same person again, under a different handle spelling ────────────────────────────
  // This is T06's dedupe reached THROUGH door 2, which is the point of "no second code path".
  drop('maria-again.md', `---
collection: guest
name: Maria Santos
handle: "@maria_cooks"
found_in: nurses-ph
---

Same person, found again in a different thread.
`);
  const second = await sweepInbox();
  assert.equal(second.failed.length, 0, JSON.stringify(second.failed));
  assert.notEqual(second.processed[0].verdict, 'store', 'a second drop of the same person stored a duplicate');
  assert.equal(documentsFor('guest').documents.length, 1, 'dedupe did not hold across the door');
});

test('a malformed drop lands in _failed/ with the reason written into the file', async () => {
  freshRoot();
  seedGuestCollection();

  // no `collection:` and no tag that any collection queries — unroutable
  drop('mystery.md', `---
name: Someone
---

No collection, no tag.
`);

  const r = await sweepInbox();
  assert.equal(r.processed.length, 0);
  assert.equal(r.failed.length, 1);

  const failedDir = path.join(getStorageRoot(), '_inbox', '_failed');
  const files = fs.readdirSync(failedDir);
  assert.deepEqual(files, ['mystery.md']);

  const text = fs.readFileSync(path.join(failedDir, 'mystery.md'), 'utf8');
  assert.match(text, /scout_failed:/, 'the reason is not in the file the agent will reopen');
  assert.match(text, /collection/i, 'the reason does not say what was actually wrong');
  // the original data survives — a failure never costs the agent its work
  assert.match(text, /Someone/);
  // and it is out of the drop folder, so the next sweep does not retry it forever
  assert.ok(!fs.existsSync(path.join(getStorageRoot(), '_inbox', 'mystery.md')));
});

test('unknown frontmatter keys are kept under `extra`, never dropped', () => {
  freshRoot();
  seedGuestCollection();
  const collection = inferCollection({ collection: 'guest' });
  const out = normalise({ collection: 'guest', name: 'X', handle: '@x', instagram_url: 'https://…', vibe: 9 }, collection);
  assert.equal(out.name, 'X');
  assert.equal(out.handle, '@x');
  assert.deepEqual(out.extra, { instagram_url: 'https://…', vibe: 9 },
    'an agent that used the wrong key still told us something true');
});

test('a drop routes by tag when it names no collection', () => {
  freshRoot();
  seedGuestCollection();
  const c = inferCollection({ tags: ['guest'] });
  assert.equal(c && c.id, 'guest', 'folder mode writes tags, not a collection id');
});

test('_known.md is flat and greppable, and _index.md says where things live', async () => {
  freshRoot();
  seedGuestCollection();
  drop('m.md', `---
collection: guest
name: Maria Santos
handle: "@mariacooks"
status: needs-review
tags: [guest]
---
Body.
`);
  await sweepInbox();
  writeKnown();
  writeIndexFile();

  const known = fs.readFileSync(path.join(getStorageRoot(), '_known.md'), 'utf8');
  // the one command an agent in any sandbox has to be able to run
  assert.match(known, /@mariacooks/);
  assert.match(known, /Maria Santos/);
  const line = known.split('\n').find(l => l.includes('@mariacooks'));
  assert.ok(line.split(' · ').length >= 4, 'the line is not the flat `id · name · handle · status` shape');

  const index = fs.readFileSync(path.join(getStorageRoot(), '_index.md'), 'utf8');
  assert.match(index, /#guest/);
  assert.match(index, /context\.md/, 'the index does not point at the wake-up read');
});

test('the README that tells an agent how to drop sits in the folder it is needed in', () => {
  freshRoot();
  ensureInbox();
  const readme = fs.readFileSync(path.join(getStorageRoot(), '_inbox', 'README.md'), 'utf8');
  assert.match(readme, /found_in/, 'the drop instructions do not mention the field territory scoring depends on');
  assert.match(readme, /_known\.md/, 'the drop instructions do not tell the agent how to dedupe');
  assert.match(readme, /shortlist/, 'the drop instructions do not state the gate');
});
