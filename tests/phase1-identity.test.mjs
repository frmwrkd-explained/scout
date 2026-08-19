// Phase 1 — scoped { projectId, itemId } identity. The core bug: item ids like SH010_gen repeat
// across projects, and a global getItem(id) returned the first match, so a mutation could land in
// the wrong project. These tests prove mutations are project-scoped and the legacy endpoint 409s.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, seedItem, req, readItemFile, paths, fs } from './helpers.mjs';

test('scoped patch touches only the named project; the same-id item elsewhere is byte-for-byte unchanged', async () => {
  freshRoot();
  seedProject('proj-a');
  seedProject('proj-b');
  seedItem('proj-a', 'SH010_gen', { st: 'new' });
  seedItem('proj-b', 'SH010_gen', { st: 'new' });

  const beforeA = readItemFile('proj-a', 'SH010_gen');

  // keep the item in project B
  const r = await req('PATCH', '/api/projects/proj-b/items/SH010_gen', { patch: { st: 'kept' }, log: 'kept' });
  assert.equal(r.status, 200);
  assert.equal(r.body.st, 'kept');
  assert.equal(r.body.proj, 'proj-b');

  // project A must be untouched
  assert.equal(readItemFile('proj-a', 'SH010_gen'), beforeA, 'project A item file changed unexpectedly');
  // project B must reflect the change on disk
  assert.match(readItemFile('proj-b', 'SH010_gen'), /st: kept/);
});

test('a note (reroll) job reads and modifies only the named project', async () => {
  freshRoot();
  seedProject('proj-a');
  seedProject('proj-b');
  seedItem('proj-a', 'SH010_gen', { st: 'new' });
  seedItem('proj-b', 'SH010_gen', { st: 'new' });
  const beforeA = readItemFile('proj-a', 'SH010_gen');

  const r = await req('POST', '/api/projects/proj-b/items/SH010_gen/note', { text: 'make it neon' });
  assert.equal(r.status, 200);
  assert.equal(r.body.item.proj, 'proj-b');
  assert.equal(r.body.item.fbState, 'queued');
  // only project B's item got the queued note
  assert.equal(readItemFile('proj-a', 'SH010_gen'), beforeA);
  assert.match(readItemFile('proj-b', 'SH010_gen'), /fbState: queued/);
});

test('empty Trash with repeated ids across projects deletes only the trashed records', async () => {
  freshRoot();
  seedProject('proj-a');
  seedProject('proj-b');
  seedItem('proj-a', 'SH010_gen', { st: 'new', trashed: false });         // keep
  seedItem('proj-b', 'SH010_gen', { st: 'killed', trashed: true });        // purge
  seedItem('proj-b', 'SH020_gen', { st: 'new', trashed: false });          // keep

  const r = await req('POST', '/api/trash/empty');
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted, 1);
  assert.ok(fs.existsSync(paths.itemMd('proj-a', 'SH010_gen')), 'proj-a item wrongly deleted');
  assert.ok(fs.existsSync(paths.itemMd('proj-b', 'SH020_gen')), 'proj-b keep wrongly deleted');
  assert.ok(!fs.existsSync(paths.itemMd('proj-b', 'SH010_gen')), 'trashed item not deleted');
});

test('legacy global item endpoint returns 409 when the id is ambiguous across projects', async () => {
  freshRoot();
  seedProject('proj-a');
  seedProject('proj-b');
  seedItem('proj-a', 'SH010_gen');
  seedItem('proj-b', 'SH010_gen');

  const r = await req('PATCH', '/api/items/SH010_gen', { patch: { st: 'kept' } });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /ambiguous item id/);
  assert.deepEqual(new Set(r.body.projects), new Set(['proj-a', 'proj-b']));
});

test('legacy global item endpoint operates and flags deprecation when exactly one match exists', async () => {
  freshRoot();
  seedProject('proj-a');
  seedItem('proj-a', 'SH010_gen', { st: 'new' });

  const r = await req('PATCH', '/api/items/SH010_gen', { patch: { st: 'kept' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.st, 'kept');
  assert.ok(r.body.deprecated, 'expected a deprecation field on the legacy response');
});

test('patching a missing item 404s (no cross-project fallback)', async () => {
  freshRoot();
  seedProject('proj-a');
  const r = await req('PATCH', '/api/projects/proj-a/items/DOES_NOT_EXIST', { patch: { st: 'kept' } });
  assert.equal(r.status, 404);
});
