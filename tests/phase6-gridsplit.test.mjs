// Filmmaker-chat ticket 06 — server-side grid split. Splitting a generated contact sheet is a
// first-class backend operation: POST /api/generations/:pid/:id/split-grid decodes the parent
// render, cuts it, and writes one child generation record + render file per kept cell (parent
// linked, provenance noted), optionally attaching a cell to a shot as a candidate. Detection is
// shared with the browser tool page (shared/gridsplit.mjs).
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { freshRoot, seedProject, seedShot, seedGen, req, getStorageRoot, fs, path } from './helpers.mjs';

// Build a synthetic grid PNG: distinct per-cell luminance with dark gridlines exactly on the cut
// lines, so the detector has genuine edge energy at the thirds/halves to lock onto.
async function makeGridPng(rows, cols, cell = 200, line = 4) {
  const W = cols * cell, H = rows * cell;
  const buf = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = Math.floor(y / cell), c = Math.floor(x / cell);
      const idx = (y * W + x) * 3;
      let v = 30 + ((r * cols + c) * 25) % 200;
      const inLine = (x % cell) < line || (y % cell) < line || (x % cell) >= cell - line || (y % cell) >= cell - line;
      if (inLine) v = 0;
      buf[idx] = v; buf[idx + 1] = v; buf[idx + 2] = v;
    }
  }
  return sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

// Seed a done generation record whose render file is a real grid image on disk.
async function seedGridGen(pid, id, rows, cols) {
  const rdir = path.join(getStorageRoot(), 'projects', pid, 'renders');
  fs.mkdirSync(rdir, { recursive: true });
  const png = await makeGridPng(rows, cols);
  const file = id + '.png';
  fs.writeFileSync(path.join(rdir, file), png);
  seedGen(pid, id, { status: 'done', reviewState: 'new', file, schema: 2, model: 'fal-ai/flux/schnell', aspect: '1:1' });
  return file;
}

test('auto-detection splits a genuine 3×3 grid into 9 linked child records with real render files', async () => {
  freshRoot();
  seedProject('neon');
  await seedGridGen('neon', 'sheet1', 3, 3);

  const r = await req('POST', '/api/generations/neon/sheet1/split-grid', {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.rows, 3);
  assert.equal(r.body.cols, 3);
  assert.equal(r.body.detected.rows, 3);
  assert.equal(r.body.detected.cols, 3);
  assert.equal(r.body.count, 9);
  assert.equal(r.body.cells.length, 9);

  // every child is a persisted generation record, linked to the parent, born `done` for review
  const gens = (await req('GET', '/api/generations/neon')).body;
  const children = gens.filter(g => g.parentGeneration === 'sheet1');
  assert.equal(children.length, 9, 'expected 9 child generation records');
  for (const child of children) {
    assert.equal(child.tool, 'gridsplit');
    assert.equal(child.status, 'done');
    assert.equal(child.reviewState, 'new');
    assert.equal(child.schema, 2);
    assert.ok(child.gridCell && child.gridCell.rows === 3 && child.gridCell.cols === 3);
    // the render file exists on disk
    const rp = path.join(getStorageRoot(), 'projects', 'neon', 'renders', child.file);
    assert.ok(fs.existsSync(rp), 'child render file missing: ' + child.file);
    assert.ok(fs.statSync(rp).size > 128, 'child render file is empty');
  }
});

test('explicit rows/cols override wins over auto-detection', async () => {
  freshRoot();
  seedProject('neon');
  await seedGridGen('neon', 'sheet2', 3, 3); // a 3×3 image...

  const r = await req('POST', '/api/generations/neon/sheet2/split-grid', { rows: 2, cols: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.rows, 2); // ...forced to 2×2 by the override
  assert.equal(r.body.cols, 2);
  assert.equal(r.body.count, 4);
  const children = (await req('GET', '/api/generations/neon')).body.filter(g => g.parentGeneration === 'sheet2');
  assert.equal(children.length, 4);
});

test('skip drops cells; shot mapping attaches a cell to a shot as a candidate', async () => {
  freshRoot();
  seedProject('neon');
  seedShot('neon', 'SH010', { no: 1, title: 'Broken drone' });
  await seedGridGen('neon', 'sheet3', 3, 3);

  const r = await req('POST', '/api/generations/neon/sheet3/split-grid', {
    rows: 3, cols: 3,
    skip: ['0-1', '2-2'],
    shots: { '0-0': 'SH010' }
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.count, 7, 'two skipped cells should not produce records');
  assert.ok(!r.body.cells.some(c => c.r === 0 && c.c === 1), 'skipped cell 0-1 was written');
  assert.ok(!r.body.cells.some(c => c.r === 2 && c.c === 2), 'skipped cell 2-2 was written');

  // the mapped cell is attached to the shot as a candidate
  const cell00 = r.body.cells.find(c => c.r === 0 && c.c === 0);
  assert.equal(cell00.shot, 'SH010');
  const forShot = (await req('GET', '/api/generations/neon')).body.filter(g => g.shot === 'SH010');
  assert.equal(forShot.length, 1, 'grid cell not attached to the shot as a candidate');
  assert.equal(forShot[0].parentGeneration, 'sheet3');
  assert.equal(forShot[0].id, cell00.id);
});

test('a mapping to a non-existent shot is rejected with no partial writes', async () => {
  freshRoot();
  seedProject('neon');
  await seedGridGen('neon', 'sheet4', 2, 2);

  const r = await req('POST', '/api/generations/neon/sheet4/split-grid', { rows: 2, cols: 2, shots: { '0-0': 'NOPE' } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /NOPE not found/);
  const children = (await req('GET', '/api/generations/neon')).body.filter(g => g.parentGeneration === 'sheet4');
  assert.equal(children.length, 0, 'a rejected split left child records behind');
});

test('splitting a generation with no finished render fails cleanly', async () => {
  freshRoot();
  seedProject('neon');
  seedGen('neon', 'pending1', { status: 'queued', file: null });
  const r = await req('POST', '/api/generations/neon/pending1/split-grid', { rows: 2, cols: 2 });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /no finished render/);
});
