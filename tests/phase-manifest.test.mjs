// Bigger bet — edit-manifest / selects bridge: final selects in shot order, in/out trim, export.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, seedShot, seedGen, req, getStorageRoot, fs, path } from './helpers.mjs';

function seedSelects() {
  freshRoot();
  seedProject('neon');
  const rdir = path.join(getStorageRoot(), 'projects', 'neon', 'renders');
  fs.mkdirSync(rdir, { recursive: true });
  // two shots, each with a selected candidate + real render, out of order to test shot ordering
  seedShot('neon', 'SH020', { no: 2, dur: 5, selectedCandidate: 'gB' });
  seedShot('neon', 'SH010', { no: 1, dur: 3, selectedCandidate: 'gA' });
  fs.writeFileSync(path.join(rdir, 'a.png'), Buffer.alloc(64, 1));
  fs.writeFileSync(path.join(rdir, 'b.png'), Buffer.alloc(64, 2));
  seedGen('neon', 'gA', { shot: 'SH010', file: 'a.png', prompt: 'first', model: 'flux', batchId: 'batch-1' });
  seedGen('neon', 'gB', { shot: 'SH020', file: 'b.png', prompt: 'second', model: 'flux' });
}

test('manifest lists final selects in shot order with self-describing fields', async () => {
  seedSelects();
  const r = await req('GET', '/api/manifest/neon');
  assert.equal(r.status, 200);
  assert.equal(r.body.entries.length, 2);
  assert.deepEqual(r.body.entries.map(e => e.shot), ['SH010', 'SH020']); // shot order, not selection order
  const e0 = r.body.entries[0];
  assert.equal(e0.generation, 'gA');
  assert.equal(e0.file, 'a.png');
  assert.equal(e0.duration, 3);
  assert.equal(e0.in, 0);
  assert.equal(e0.out, 3);
  assert.equal(e0.sourceBatch, 'batch-1');
});

test('setting in/out trim points persists and a rebuild preserves them', async () => {
  seedSelects();
  await req('POST', '/api/manifest/neon/in-out', { shot: 'SH010', in: 0.5, out: 2.5 });
  const r = await req('GET', '/api/manifest/neon');
  const e = r.body.entries.find(x => x.shot === 'SH010');
  assert.equal(e.in, 0.5);
  assert.equal(e.out, 2.5);
});

test('export writes a selects folder + selects.json (symlink or copy, no data loss)', async () => {
  seedSelects();
  const r = await req('POST', '/api/manifest/neon/export');
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 2);
  assert.equal(r.body.symlinked + r.body.copied, 2);
  const selDir = path.join(getStorageRoot(), 'projects', 'neon', 'selects');
  assert.ok(fs.existsSync(path.join(selDir, 'selects.json')));
  const media = fs.readdirSync(selDir).filter(f => f !== 'selects.json');
  assert.equal(media.length, 2);
  assert.ok(media[0].startsWith('001_SH010_'), 'export not ordered/named by shot order: ' + media.join(','));
});

test('export pack includes edit-manifest.json when selects exist', async () => {
  seedSelects();
  const r = await req('POST', '/api/export/neon');
  assert.equal(r.status, 200);
  const p = path.join(getStorageRoot(), 'projects', 'neon', 'export', 'edit-manifest.json');
  assert.ok(fs.existsSync(p), 'export pack missing edit-manifest.json');
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(m.entries.length, 2);
});
