// The Board's PNG export (backend/boardExport.mjs) and its HTTP surface.
//
// Two distinct risks:
//   1. boardExport.mjs restates the palette as hex LITERALS, because it writes a file opened
//      outside the app where `var(--ink)` resolves to nothing. That is a deliberate second copy and
//      therefore exactly the kind of thing CLAUDE.md says will drift. This file is the guard: the
//      literals are asserted against frontend/tokens.js, which mirrors styles.css :root.
//   2. the renderer composites real image buffers over an SVG, because sharp cannot rasterise an
//      <image href> pointing at a local file. An SVG-only renderer produces a beautiful empty
//      board and no error, so the end-to-end case below asserts the picture actually lands.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { freshRoot, seedProject, seedShot, seedGen, req, paths } from './helpers.mjs';
import { TOKENS } from '../frontend/tokens.js';
import { addNodes, alignBoard, getBoard } from '../backend/board.mjs';
import { exportBoardPng } from '../backend/boardExport.mjs';

const SRC = fs.readFileSync(new URL('../backend/boardExport.mjs', import.meta.url), 'utf8');
const literal = name => (SRC.match(new RegExp(name + ":\\s*'(#[0-9A-Fa-f]{6})'")) || [])[1];

test('the export palette has not drifted from the design tokens', () => {
  // key in boardExport's C map → key in TOKENS
  const pairs = [
    ['ink', 'ink'], ['surface', 'surface'], ['raise', 'raise'],
    ['border', 'border'], ['border3', 'border-3'],
    ['fg', 'fg'], ['fgMuted', 'fg-muted'], ['fgFaint', 'fg-faint'],
    ['accent', 'accent'], ['ok', 'ok'], ['warn', 'warn'], ['danger', 'danger'], ['marked', 'marked']
  ];
  for (const [local, token] of pairs) {
    const got = literal(local);
    assert.ok(got, 'boardExport declares ' + local);
    assert.equal(got.toUpperCase(), TOKENS[token].toUpperCase(),
      local + ' must equal TOKENS["' + token + '"] — styles.css :root is the source of truth');
  }
});

test('an empty board refuses to export rather than writing a blank PNG', async () => {
  freshRoot(); seedProject('bx');
  await assert.rejects(() => exportBoardPng('bx'), /board is empty/i);
});

test('the export composites real pictures, not just chrome', async () => {
  freshRoot();
  const pid = seedProject('bx');
  fs.mkdirSync(path.join(paths.projectDir(pid), 'renders'), { recursive: true });

  // a flat magenta still — a colour that appears nowhere in the palette, so finding it in the
  // output proves the picture was composited rather than the bed being drawn
  const file = 'SH010_gen-1.png';
  await sharp({ create: { width: 320, height: 180, channels: 3, background: { r: 255, g: 0, b: 255 } } })
    .png().toFile(path.join(paths.projectDir(pid), 'renders', file));

  seedShot(pid, 'SH010', { no: 1, scene: 1, title: 'Ferry leaves', selectedCandidate: 'gen-1' });
  seedGen(pid, 'gen-1', { shot: 'SH010', file, reviewState: 'kept' });
  alignBoard(pid, 'scene-grid');

  const out = await exportBoardPng(pid, { width: 900 });
  assert.ok(fs.existsSync(out.file), 'wrote a file');
  assert.ok(out.bytes > 0 && out.width > 0 && out.height > 0);
  assert.equal(out.file, path.join(paths.projectDir(pid), 'export', 'board.png'));

  const { data, info } = await sharp(out.file).raw().toBuffer({ resolveWithObject: true });
  let magenta = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] > 200) magenta++;
  }
  assert.ok(magenta > 500, 'the take is actually in the PNG (' + magenta + ' magenta px)');
});

test('a shot with no take exports as a labelled bed, not a crash', async () => {
  freshRoot();
  const pid = seedProject('bx');
  seedShot(pid, 'SH010', { no: 1, scene: 1, title: 'Nothing rendered yet' });
  alignBoard(pid, 'scene-grid');
  const out = await exportBoardPng(pid, { width: 800 });
  assert.ok(out.bytes > 0);
});

test('notes, headings and frames survive the round trip to PNG', async () => {
  freshRoot();
  const pid = seedProject('bx');
  addNodes(pid, [
    { t: 'text', x: 0, y: 0, w: 400, h: 60, text: 'ACT ONE', size: 'xl' },
    { t: 'note', x: 0, y: 100, w: 240, h: 160, text: 'client hates the fog', tone: 'danger' },
    { t: 'frame', x: -40, y: -40, w: 600, h: 400, label: 'OPENING' }
  ]);
  const out = await exportBoardPng(pid, { width: 900 });
  assert.equal(out.nodes, 3);
  assert.ok(out.bytes > 0);
});

// ── the HTTP surface ────────────────────────────────────────────────────────────────────────────
test('the board routes are wired and round-trip through HTTP', async () => {
  freshRoot();
  const pid = seedProject('bx');
  seedShot(pid, 'SH010', { no: 1, scene: 1, title: 'One' });
  seedShot(pid, 'SH020', { no: 2, scene: 2, title: 'Two' });

  let r = await req('GET', '/api/board/' + pid);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.nodes, []);

  r = await req('POST', '/api/board/' + pid + '/align', { layout: 'scene-grid' });
  assert.equal(r.status, 200);
  assert.equal(r.body.nodes.filter(n => n.t === 'shot').length, 2);

  r = await req('POST', '/api/board/' + pid + '/nodes', { nodes: [{ t: 'note', text: 'from the wire' }] });
  assert.equal(r.status, 200);
  const noteId = r.body.added[0].id;

  r = await req('PATCH', '/api/board/' + pid + '/nodes', { nodes: [{ id: noteId, x: 640, y: 320 }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.nodes.find(n => n.id === noteId).x, 640);

  r = await req('POST', '/api/board/' + pid + '/show', { show: 'all' });
  assert.equal(r.body.show, 'all');
  r = await req('POST', '/api/board/' + pid + '/show', { show: 'nonsense' });
  assert.equal(r.status, 400, 'a bad mode is rejected, not coerced');

  r = await req('GET', '/api/board/' + pid + '/describe');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.shots.sort(), ['SH010', 'SH020']);

  r = await req('DELETE', '/api/board/' + pid + '/nodes', { ids: [noteId] });
  assert.equal(r.status, 200);
  assert.equal(r.body.nodes.find(n => n.id === noteId), undefined);

  // export before anything has been exported → a 404 with a readable reason, never a broken image
  freshRoot(); seedProject('by');
  r = await req('GET', '/api/board/by/export/file');
  assert.equal(r.status, 404);
  assert.match(r.body.error, /no board export yet/);
});

test('the board tool is registered with an agent-facing capability line', async () => {
  const { chatToolById } = await import('../shared/chatTools.mjs');
  const t = chatToolById('board');
  assert.ok(t, 'the board tool exists');
  assert.equal(t.enabledByDefault, false, 'nothing is on until the user turns it on');
  assert.match(t.capability, /describe/, 'points the agent at the digest route, not the raw document');
  assert.match(t.capability, /scene-grid/, 'names the layouts it can call');
  assert.ok(t.directiveTypes.includes('show.board'));
});
