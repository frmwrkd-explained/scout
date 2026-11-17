// The whiteboard as a person meets it: record cards, the links between them, and where things land.
//
// What is at risk, and therefore what is tested:
//   1. A record card is a CARD. A collection with a picture field gives a picture card, born at the
//      picture size; a record of words gets the plain size; a record with nothing but a name gets
//      the compact one. Thirty of them placed at once must not overlap.
//   2. A link is named the way a person reads it — the field's LABEL, never its key — while `field`
//      stays the machine key an agent keys off.
//   3. "Show related" brings in exactly what will draw an edge, in both directions, through the one
//      resolver (`referencesTo`). A second resolver would let the two disagree.
//   4. A label sits on its line and never on top of a card.
//   5. Taking a card off the board never touches the record.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { freshRoot, seedProject } from './helpers.mjs';
import { writeMd, getStorageRoot } from '../backend/store.mjs';
import { saveCollection } from '../backend/collections.mjs';
import { saveBoard, getBoard, relatedTo, humanise, registerScoutBoardRoutes } from '../backend/scoutBoard.mjs';
import {
  BOARD_CARD, BOARD_GAP, GRID, gridSlots, freeSpot, fitView, tidy, arrowGeom, curvePoint, labelSpot,
} from '../frontend/boardLayout.js';

const PID = 'pitch';
const at = rel => path.join(getStorageRoot(), rel);
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const ACME = 'data/companies/acme-studio.md';
const MARIA = 'data/people/maria-santos.md';
const JONAS = 'data/people/jonas-tiu.md';
const SHOT = 'data/references/red-hat.md';
const BARE = 'data/references/no-picture.md';

// Companies → People is the sub-collection shape: the child's relation key is the parent's id
// (`companies`) and its label is the singular a person reads ("Company").
function seedWorkspace() {
  freshRoot();
  seedProject(PID);
  saveCollection({
    id: 'companies', label: 'Companies', query: { path: 'data/companies/**' },
    fields: [{ key: 'name', type: 'text', primary: true }],
  });
  saveCollection({
    id: 'people', label: 'People', query: { path: 'data/people/**' },
    fields: [
      { key: 'name', type: 'text', primary: true },
      { key: 'companies', label: 'Company', type: 'relation', target: 'companies' },
      { key: 'role', type: 'select', options: [{ value: 'producer' }, { value: 'editor' }] },
    ],
  });
  saveCollection({
    id: 'references', label: 'References', query: { path: 'data/references/**' },
    fields: [
      { key: 'name', type: 'text', primary: true },
      { key: 'image', type: 'file', primary_media: true },
      { key: 'use', type: 'multiselect', options: [{ value: 'ads' }, { value: 'unisex' }] },
    ],
  });
  writeMd(at(ACME), { name: 'Acme Studio' }, '');
  writeMd(at(MARIA), { name: 'Maria Santos', companies: 'acme-studio', role: 'producer' }, 'Runs the Manila office.\n');
  writeMd(at(JONAS), { name: 'Jonas Tiu', companies: 'acme-studio' }, '');
  writeMd(at(SHOT), { name: 'Red hat in a field of black', image: 'files/abc123.jpg', use: ['ads'] }, 'Dense repetition.\n');
  writeMd(at(BARE), { name: 'No picture yet', use: ['unisex'] }, 'Words only.\n');
}

// ── 1 · record cards ────────────────────────────────────────────────────────────────────────────
test('a record whose collection has a picture gets a picture card; the others get the size their content needs', () => {
  seedWorkspace();
  const b = saveBoard(PID, { nodes: [
    { t: 'document', path: SHOT, x: 0, y: 0 },
    { t: 'document', path: BARE, x: 400, y: 0 },
    { t: 'document', path: MARIA, x: 800, y: 0 },
    { t: 'document', path: ACME, x: 1200, y: 0 },
    { t: 'document', path: JONAS, x: 1600, y: 0, w: 400, h: 260 },
  ] });
  const node = p => b.nodes.find(n => n.path === p);
  const size = n => ({ w: n.w, h: n.h });

  assert.equal(b.cards[SHOT].cover, 'files/abc123.jpg', 'the primary_media field is the cover');
  assert.equal(b.cards[BARE].cover, null, 'a record without a picture has no cover, whatever its collection');
  assert.deepEqual(size(node(SHOT)), BOARD_CARD.picture);
  assert.deepEqual(size(node(BARE)), BOARD_CARD.plain, 'no picture + words → the plain card');
  assert.deepEqual(size(node(MARIA)), BOARD_CARD.plain);
  assert.deepEqual(size(node(ACME)), BOARD_CARD.compact, 'a name and nothing else is not given an empty box');
  assert.deepEqual(size(node(JONAS)), { w: 400, h: 260 }, 'a size somebody chose is never overruled');

  // the properties a card shows carry the label a person reads, and the schema for the one renderer
  const role = b.cards[MARIA].props.find(p => p.key === 'role');
  assert.ok(role, 'a select is a headline property');
  assert.equal(role.label, 'Role');
  assert.equal(role.field.type, 'select');
  const company = b.cards[MARIA].props.find(p => p.key === 'companies');
  assert.equal(company.label, 'Company', 'the declared label wins over the key');
});

test('thirty picture cards placed at once make a grid: on the lattice, none touching', () => {
  const slots = gridSlots(30, BOARD_CARD.picture, { x: 13, y: 7 });
  assert.equal(slots.length, 30);
  const rects = slots.map(s => ({ ...s, ...BOARD_CARD.picture }));
  for (const r of rects) { assert.equal(r.x % GRID, 0); assert.equal(r.y % GRID, 0); }
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const grown = { x: rects[i].x - BOARD_GAP / 2, y: rects[i].y - BOARD_GAP / 2, w: rects[i].w + BOARD_GAP, h: rects[i].h + BOARD_GAP };
    assert.ok(!overlap(grown, rects[j]), 'cards ' + i + ' and ' + j + ' are closer than the gap');
  }
  const cols = new Set(rects.map(r => r.x)).size, rows = new Set(rects.map(r => r.y)).size;
  assert.ok(cols > rows, 'wider than tall — it has to fit a landscape canvas');
  assert.deepEqual(gridSlots(0, BOARD_CARD.plain), []);
});

test('a new card goes to the first free spot, never on top of what is there', () => {
  const nodes = [{ t: 'document', x: 0, y: 0, w: 300, h: 180 }, { t: 'document', x: 340, y: 0, w: 300, h: 180 }];
  const want = { x: 0, y: 0, w: 300, h: 180 };
  const spot = freeSpot(nodes, want);
  assert.ok(!nodes.some(n => overlap({ ...want, ...spot }, n)));
  assert.deepEqual(freeSpot([], want), { x: 0, y: 0 }, 'an empty board answers with the spot asked for');
  // a frame is a region, not an obstacle: cards are meant to be put inside it
  assert.deepEqual(freeSpot([{ t: 'frame', x: -40, y: -40, w: 900, h: 600 }], want), { x: 0, y: 0 });
});

test('fit keeps the cards clear of a panel floating over the canvas', () => {
  const nodes = [{ t: 'document', x: 0, y: 0, w: 300, h: 180 }, { t: 'document', x: 3000, y: 1400, w: 300, h: 180 }];
  const v = fitView(nodes, 1600, 900, 80, { left: 300 });
  const left = 0 * v.z + v.x, right = (3300) * v.z + v.x;
  assert.ok(left >= 300, 'the left-most card starts right of the panel, got ' + left);
  assert.ok(right <= 1600);
  const plain = fitView(nodes, 1600, 900);
  assert.ok(plain.z > v.z, 'less room means a smaller zoom');
});

test('arrange honours the gap it is given', () => {
  const nodes = Array.from({ length: 6 }, (_, i) => ({ id: 'n' + i, t: 'document', x: i * 7, y: i * 3, w: 300, h: 180 }));
  const out = tidy(nodes, { cols: 3, gap: 60 });
  const xs = [...new Set(out.map(n => n.x))].sort((a, b) => a - b);
  assert.equal(xs.length, 3);
  assert.equal(xs[1] - xs[0], 360);
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) assert.ok(!overlap(out[i], out[j]));
});

// ── 2 · links are named for people ──────────────────────────────────────────────────────────────
test('a link carries the field label; the key stays in `field`', () => {
  seedWorkspace();
  const b = saveBoard(PID, { nodes: [{ t: 'document', path: ACME, x: 0, y: 0 }, { t: 'document', path: MARIA, x: 500, y: 0 }] });
  assert.equal(b.edges.length, 1);
  const e = b.edges[0];
  assert.equal(e.field, 'companies');
  assert.equal(e.label, 'Company');
  assert.equal(e.declared, true);
  assert.equal(e.from, b.nodes.find(n => n.path === MARIA).id, 'the person holds the pointer');
  assert.equal(humanise('found_in'), 'Found in');
  assert.equal(humanise('top-finds'), 'Top finds');
  assert.equal(humanise(''), '');
});

// ── 3 · show related ────────────────────────────────────────────────────────────────────────────
test('show related: a company brings in its people, a person brings in the company', () => {
  seedWorkspace();
  const fromCompany = relatedTo(ACME);
  assert.equal(fromCompany.missing, false);
  assert.deepEqual(fromCompany.in.map(r => r.path).sort(), [JONAS, MARIA]);
  assert.deepEqual(fromCompany.out, []);
  assert.ok(fromCompany.in.every(r => r.label === 'Company' && r.field === 'companies' && r.direction === 'in'));

  const fromPerson = relatedTo(MARIA);
  assert.deepEqual(fromPerson.out.map(r => r.path), [ACME]);
  assert.equal(fromPerson.out[0].title, 'Acme Studio');
  assert.equal(fromPerson.out[0].label, 'Company');
  assert.equal(fromPerson.out[0].direction, 'out');
  assert.deepEqual(fromPerson.in, []);

  // and everything it names DOES draw: put them on a board and count
  const paths = [ACME, ...fromCompany.in.map(r => r.path)];
  const b = saveBoard(PID, { nodes: paths.map((p, i) => ({ t: 'document', path: p, x: i * 400, y: 0 })) });
  assert.equal(b.edges.length, fromCompany.in.length, 'one edge per related record — the same resolver decided both');

  assert.deepEqual(relatedTo('data/people/nobody.md'), { path: 'data/people/nobody.md', missing: true, in: [], out: [], more: 0 });
  assert.deepEqual(relatedTo(SHOT).in.concat(relatedTo(SHOT).out), [], 'a record nothing points at brings in nothing');
});

// ── 4 · a label sits on its line, off the cards ─────────────────────────────────────────────────
test('a link label rides its curve and slides out from under a card in the way', () => {
  const byId = { a: { id: 'a', t: 'document', x: 0, y: 0, w: 300, h: 180 }, b: { id: 'b', t: 'document', x: 900, y: 0, w: 300, h: 180 } };
  const g = arrowGeom({ from: 'a', to: 'b' }, byId);
  assert.deepEqual(curvePoint(g, 0), { x: g.a.x, y: g.a.y });
  assert.deepEqual(curvePoint(g, 1), { x: g.b.x, y: g.b.y });

  const mid = labelSpot(g, Object.values(byId));
  assert.equal(Math.round(mid.x), 600, 'nothing in the way → the middle');

  const wall = { id: 'c', t: 'document', x: 540, y: -200, w: 120, h: 600 };
  const moved = labelSpot(g, [...Object.values(byId), wall]);
  const box = { x: moved.x - 42, y: moved.y - 12, w: 84, h: 24 };
  assert.ok(!overlap(box, wall), 'the label is not printed over the card');
  assert.ok(moved.x > 300 && moved.x < 900, 'and it is still on its own line');

  // two links between the same pair: the second label does not land on the first
  const taken = [];
  const first = labelSpot(g, Object.values(byId), { taken });
  const second = labelSpot(g, Object.values(byId), { taken });
  assert.notDeepEqual(first, second);
  assert.equal(taken.length, 2);
});

// ── the two new routes ──────────────────────────────────────────────────────────────────────────
let baseUrl = null;
async function base() {
  if (baseUrl) return baseUrl;
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  registerScoutBoardRoutes(app);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  server.unref();
  baseUrl = 'http://127.0.0.1:' + server.address().port;
  return baseUrl;
}

test('GET /api/scout/board/:id/related answers with what Show related will place', async () => {
  seedWorkspace();
  const r = await fetch((await base()) + '/api/scout/board/' + PID + '/related?path=' + encodeURIComponent(ACME));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.in.map(x => x.title).sort(), ['Jonas Tiu', 'Maria Santos']);
  assert.equal(body.more, 0);
});

// The smallest valid PNG: one transparent pixel.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('POST /api/scout/board/:id/image stores a dropped picture once and writes nothing to the board', async () => {
  seedWorkspace();
  const url = (await base()) + '/api/scout/board/' + PID + '/image?name=drop.png';
  const before = getBoard(PID).rev;
  const post = type => fetch(url, { method: 'POST', headers: { 'Content-Type': type }, body: PNG });

  const first = await post('image/png');
  assert.equal(first.status, 200);
  const a = await first.json();
  assert.match(a.path, /^files\/[0-9a-f]{64}\.png$/, 'content-addressed, by the one writer of files/');
  assert.equal(a.existed, false);
  assert.ok(fs.existsSync(at(a.path)));
  assert.equal(fs.statSync(at(a.path)).size, PNG.length);

  const again = await (await post('image/png')).json();
  assert.equal(again.path, a.path, 'the same bytes are one file');
  assert.equal(again.existed, true);

  const bad = await post('text/html');
  assert.equal(bad.status, 400, 'something the app cannot show is refused, not stored');
  assert.equal(getBoard(PID).rev, before, 'storing a picture is not a board save');

  // the path is what an image node carries, and it survives the sanitiser
  const b = saveBoard(PID, { nodes: [{ t: 'image', src: a.path, x: 0, y: 0, w: 300, h: 300 }] });
  assert.equal(b.nodes[0].src, a.path);
});

// ── 5 · the board is not the record ─────────────────────────────────────────────────────────────
test('taking a card off the board leaves the record exactly as it was', () => {
  seedWorkspace();
  const before = fs.readFileSync(at(MARIA), 'utf8');
  const b = saveBoard(PID, { nodes: [{ t: 'document', path: MARIA, x: 0, y: 0 }, { t: 'document', path: ACME, x: 500, y: 0 }] });
  const cleared = saveBoard(PID, { nodes: [], base: b.rev, log: 'removed 2 cards' });
  assert.equal(cleared.nodes.length, 0);
  assert.equal(cleared.edges.length, 0);
  assert.equal(fs.readFileSync(at(MARIA), 'utf8'), before);
  assert.ok(fs.existsSync(at(ACME)));
});
