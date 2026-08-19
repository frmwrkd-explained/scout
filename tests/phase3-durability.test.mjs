// Phase 3 — durable actions, conflict detection, staged trash + undo, ledger correctness.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, seedItem, req, paths, getStorageRoot, fs, path } from './helpers.mjs';
import { ledger, getLedgerRollup, monthKey } from '../backend/ledger.mjs';
import { buildAgentArgs } from '../backend/jobs.mjs';

test('conflict: an unrelated external field change between read and write merges safely', async () => {
  freshRoot();
  seedProject('p');
  seedItem('p', 'A', { st: 'new', rating: 0, note: '' });
  const it = (await req('PATCH', '/api/projects/p/items/A', { patch: {} })).body; // read current rev
  const baseRev = it.rev;
  // an external agent changes an UNRELATED field (note) after we read
  const file = paths.itemMd('p', 'A');
  const raw = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, raw.replace('note: \'\'', "note: agent-edit").replace('note: ""', 'note: agent-edit'));
  // we now change `st` with our stale baseRev + baseValues for `st` only
  const r = await req('PATCH', '/api/projects/p/items/A', { patch: { st: 'kept' }, baseRev, baseValues: { st: 'new' } });
  assert.equal(r.status, 200, 'unrelated-field drift should merge, not conflict');
  assert.equal(r.body.st, 'kept');
});

test('conflict: the SAME field changed externally returns 409 and preserves both values', async () => {
  freshRoot();
  seedProject('p');
  seedItem('p', 'A', { st: 'new' });
  const it = (await req('PATCH', '/api/projects/p/items/A', { patch: {} })).body;
  const baseRev = it.rev;
  // external agent flips `st` to killed
  await req('PATCH', '/api/projects/p/items/A', { patch: { st: 'killed' } });
  // we try to set st=kept with the STALE baseRev/baseValues → conflict on the same field
  const r = await req('PATCH', '/api/projects/p/items/A', { patch: { st: 'kept' }, baseRev, baseValues: { st: 'new' } });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body.conflictingFields, ['st']);
  assert.equal(r.body.currentValues.st, 'killed'); // on-disk (external) value preserved
});

test('action journal records item mutations and undo restores the previous value (survives across requests)', async () => {
  freshRoot();
  seedProject('p');
  seedItem('p', 'A', { st: 'new' });
  const r = await req('PATCH', '/api/projects/p/items/A', { patch: { st: 'kept' }, baseValues: { st: 'new' } });
  assert.equal(r.body.st, 'kept');
  const actions = (await req('GET', '/api/actions')).body;
  const a = actions.find(x => x.command === 'item.patch' && (x.targets || []).includes('p/A'));
  assert.ok(a, 'no journal entry for the patch');
  assert.equal(a.undoable, true);
  // undo (simulates undo after navigating elsewhere — the journal is on disk)
  const u = await req('POST', '/api/actions/' + a.id + '/undo');
  assert.equal(u.status, 200);
  const after = (await req('PATCH', '/api/projects/p/items/A', { patch: {} })).body;
  assert.equal(after.st, 'new', 'undo did not restore the previous state');
});

test('staged trash: deleting an asset stages the file + sidecar and restore brings both back', async () => {
  freshRoot();
  // seed a library asset + sidecar
  const libDir = path.join(getStorageRoot(), 'library', 'refs');
  fs.mkdirSync(libDir, { recursive: true });
  fs.writeFileSync(path.join(libDir, 'a.png'), Buffer.alloc(64, 7));
  fs.writeFileSync(path.join(libDir, 'a.png.meta.md'), '---\ndescription: hi\n---\n');

  const del = await req('DELETE', '/api/library/file?name=a.png&folder=refs');
  assert.equal(del.status, 200);
  assert.ok(!fs.existsSync(path.join(libDir, 'a.png')), 'asset not moved out');
  assert.ok(!fs.existsSync(path.join(libDir, 'a.png.meta.md')), 'sidecar not moved out');

  const trash = (await req('GET', '/api/staged-trash')).body;
  assert.equal(trash.length, 1);
  assert.equal(trash[0].paths.length, 2, 'asset + sidecar should be one 2-path entry');

  const restore = await req('POST', '/api/staged-trash/' + trash[0].id + '/restore');
  assert.equal(restore.status, 200);
  assert.ok(fs.existsSync(path.join(libDir, 'a.png')), 'asset not restored');
  assert.ok(fs.existsSync(path.join(libDir, 'a.png.meta.md')), 'sidecar not restored');
  assert.equal((await req('GET', '/api/staged-trash')).body.length, 0);
});

test('staged trash: deleting a folder with multiple assets restores its complete tree', async () => {
  freshRoot();
  const board = path.join(getStorageRoot(), 'library', 'board');
  fs.mkdirSync(board, { recursive: true });
  fs.writeFileSync(path.join(board, 'one.png'), Buffer.alloc(32, 1));
  fs.writeFileSync(path.join(board, 'one.png.meta.md'), '---\nkind: prop\n---\n');
  fs.writeFileSync(path.join(board, 'two.png'), Buffer.alloc(32, 2));

  const del = await req('DELETE', '/api/library/folder?name=board');
  assert.equal(del.status, 200);
  assert.ok(!fs.existsSync(board), 'folder not staged');

  const trash = (await req('GET', '/api/staged-trash')).body;
  const restore = await req('POST', '/api/staged-trash/' + trash[0].id + '/restore');
  assert.equal(restore.status, 200);
  assert.ok(fs.existsSync(path.join(board, 'one.png')));
  assert.ok(fs.existsSync(path.join(board, 'one.png.meta.md')));
  assert.ok(fs.existsSync(path.join(board, 'two.png')));
});

test('ledger monthly totals stay correct past the 500-row detail cap', () => {
  freshRoot();
  const N = 620;
  for (let i = 0; i < N; i++) ledger({ service: 'fal', op: 'image', model: 'm', units: '1 img', cost: 0.01, ref: 'x' });
  const rollup = getLedgerRollup();
  const mk = monthKey(Date.now());
  assert.ok(rollup[mk], 'no rollup for current month');
  assert.equal(rollup[mk].count, N);
  assert.ok(Math.abs(rollup[mk].total - N * 0.01) < 1e-6, 'monthly total undercounted: ' + rollup[mk].total);
});

test('prompt-rewrite agent runs with tools disabled and never --dangerously-skip-permissions', () => {
  const args = buildAgentArgs('rewrite this');
  assert.ok(!args.includes('--dangerously-skip-permissions'), 'dangerous flag must not be present');
  const ai = args.indexOf('--allowedTools');
  assert.ok(ai >= 0 && args[ai + 1] === '', 'tools must be disabled (empty --allowedTools)');
});
