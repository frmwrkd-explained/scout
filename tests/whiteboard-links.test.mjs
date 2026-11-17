// The whiteboard as a place to WRITE and CONNECT: the three kinds a person makes (text, shape,
// draw), the drawn links between any two things, and the one door from a drawn link to a real
// relation.
//
// What is at risk, and therefore what is tested:
//   1. The new kinds and the links are DATA an agent can write by hand. They validate, fail closed
//      on nonsense, and survive a save and a read unchanged.
//   2. A drawn link never outlives its nodes, and a typo never costs one.
//   3. A board written before links existed is still the same board.
//   4. `describeBoard` says what the diagram says, in words — names, never ids.
//   5. "Make it real" writes the record through the record writer, logs it, removes the drawn
//      link — and refuses an agent.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { freshRoot, seedProject } from './helpers.mjs';
import { writeMd, readMd, getStorageRoot } from '../backend/store.mjs';
import { saveCollection } from '../backend/collections.mjs';
import { readEvents } from '../backend/log.mjs';
import {
  getBoard, saveBoard, cleanNode, cleanLink, cleanPoints, describeBoard, linkOffers, realiseLink,
  registerScoutBoardRoutes, boardFile, NODE_KINDS, HUES,
} from '../backend/scoutBoard.mjs';
import { packStroke, strokePath, strokeHit, parsePoints } from '../frontend/boardLayout.js';

const PID = 'pitch';
const at = rel => path.join(getStorageRoot(), rel);
const ACME = 'data/companies/acme-studio.md';
const ANA = 'data/people/ana-cruz.md';
const BEN = 'data/people/ben-lim.md';

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
    ],
  });
  writeMd(at(ACME), { name: 'Acme Studio' }, '');
  writeMd(at(ANA), { name: 'Ana Cruz' }, 'Producer.\n');
  writeMd(at(BEN), { name: 'Ben Lim', companies: 'acme-studio' }, 'Editor.\n');
}

// A small diagram: a heading, two shapes, a note, a stroke — and three links between them.
const diagram = () => ({
  nodes: [
    { id: 'h', t: 'text', text: 'How a story gets booked', size: 'xl', bold: true, x: 0, y: 0, w: 520, h: 52 },
    { id: 'a', t: 'shape', shape: 'round', text: 'Find the person', colour: 'teal', x: 0, y: 120, w: 200, h: 100 },
    { id: 'q', t: 'shape', shape: 'diamond', text: 'Do they answer?', x: 320, y: 110, w: 200, h: 120 },
    { id: 'n', t: 'note', text: 'Ask the admin for an intro first.', colour: 'violet', x: 640, y: 120, w: 240, h: 120 },
    { id: 's', t: 'draw', points: '0,0 12,9 30,4 51,22', width: 4, colour: 'red', x: 10, y: 300, w: 60, h: 30 },
  ],
  links: [
    { id: 'l1', from: 'a', to: 'q' },
    { id: 'l2', from: 'q', to: 'n', label: 'no', ends: 'arrow', line: 'dashed', colour: 'orange' },
    { id: 'l3', from: 'h', to: 'a', ends: 'none' },
  ],
});

// ── 1 · the kinds validate and round-trip ───────────────────────────────────────────────────────
test('text, shape and draw are node kinds; nonsense is dropped, defaults are filled', () => {
  for (const k of ['text', 'shape', 'draw']) assert.ok(NODE_KINDS.includes(k), k + ' is a kind');
  assert.equal(NODE_KINDS.includes('arrow'), false, 'a line is a link, never a node');
  assert.deepEqual(HUES, ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink']);

  const text = cleanNode({ t: 'text', text: 'Hello', size: 'huge', bold: 1, colour: 'chartreuse', x: 3.6, y: 9.2, w: 100, h: 20 }, 't1');
  assert.deepEqual(text, { id: 't1', t: 'text', x: 4, y: 9, w: 100, h: 20, text: 'Hello', size: 'm', bold: true });
  assert.equal(cleanNode({ t: 'text', text: '   ', x: 0, y: 0 }, 't2'), null, 'words with no words are not a node');
  assert.equal(cleanNode({ t: 'text', text: 'T', x: 0, y: 0, w: 9, h: 12 }, 't3').w, 9, 'a one-letter label may be narrower than a card');

  const shape = cleanNode({ t: 'shape', shape: 'hexagon', text: '', colour: 'blue', x: 0, y: 0 }, 's1');
  assert.equal(shape.shape, 'rect', 'an unknown shape is a rectangle');
  assert.equal(shape.text, '', 'a shape may be empty — it is still a box you can see');
  assert.equal(shape.colour, 'blue');
  assert.equal(shape.size, undefined, 'the default text size is not written down');
  assert.equal(cleanNode({ t: 'shape', shape: 'diamond', size: 'l', x: 0, y: 0 }, 's2').size, 'l');

  const stroke = cleanNode({ t: 'draw', points: [[0, 0.4], [10.6, 5], [20, 9]], width: 3, x: 0, y: 0, w: 24, h: 12 }, 'd1');
  assert.equal(stroke.points, '0,0 11,5 20,9', 'points are integers in one readable string');
  assert.equal(stroke.width, 4, 'an unknown width is the middle one');
  assert.equal(cleanNode({ t: 'draw', points: 'not points', x: 0, y: 0 }, 'd2'), null, 'a stroke with no points is nothing');
  assert.equal(cleanPoints('5,5'), '5,5 5,5', 'a dot is a stroke that did not travel');
  assert.equal(cleanPoints('1,2 3,4 5'), '1,2 3,4', 'a trailing half pair is ignored');

  const note = cleanNode({ t: 'note', text: 'x', tone: 'warn', colour: 'pink', x: 0, y: 0 }, 'n1');
  assert.equal(note.tone, 'warn', 'the old tone is kept');
  assert.equal(note.colour, 'pink', 'and a hue sits on top of it');
  assert.equal(cleanNode({ t: 'note', text: 'x', x: 0, y: 0 }, 'n2').colour, undefined);

  assert.equal(cleanNode({ t: 'text', text: 'x', x: 0, y: 0 }, 'bad id!').id, 'badid', 'an id is one plain word');
});

test('a diagram survives a save and a read exactly', () => {
  seedWorkspace();
  const saved = saveBoard(PID, { ...diagram(), log: 'drew the booking flow' });
  assert.equal(saved.nodes.length, 5);
  assert.equal(saved.links.length, 3);
  assert.deepEqual(saved.links[0], { id: 'l1', from: 'a', to: 'q', ends: 'arrow', line: 'solid' }, 'defaults are written down');
  assert.deepEqual(saved.links[1], { id: 'l2', from: 'q', to: 'n', label: 'no', ends: 'arrow', line: 'dashed', colour: 'orange' });
  assert.equal(saved.links[2].ends, 'none');

  const read = getBoard(PID);
  assert.deepEqual(read.nodes, saved.nodes);
  assert.deepEqual(read.links, saved.links);
  assert.deepEqual(read.edges, [], 'drawn links are not derived edges — they are kept apart');

  // the file itself is the document: an agent reading it sees the same keys
  const onDisk = readMd(boardFile(PID)).data;
  assert.deepEqual(onDisk.links, saved.links);
  assert.equal(onDisk.nodes.find(n => n.id === 's').points, '0,0 12,9 30,4 51,22');

  // re-saving the same thing is not a change; changing only a link's arrowhead is
  const again = saveBoard(PID, { nodes: read.nodes, links: read.links, base: read.rev });
  assert.equal(again.rev, read.rev, 'nothing changed, the revision holds');
  const flipped = saveBoard(PID, { links: read.links.map(l => (l.id === 'l1' ? { ...l, ends: 'both' } : l)), base: read.rev });
  assert.equal(flipped.rev, read.rev + 1, 'a link is document content');
  assert.equal(flipped.nodes.length, 5, 'a links-only save leaves the nodes alone');
  const recoloured = saveBoard(PID, { nodes: flipped.nodes.map(n => (n.id === 'a' ? { ...n, colour: 'pink' } : n)), base: flipped.rev });
  assert.equal(recoloured.rev, flipped.rev + 1, 'so is a colour');
  assert.equal(recoloured.links.length, 3, 'a nodes-only save leaves the links alone');
});

// ── 2 · a link is only as good as its two ends ──────────────────────────────────────────────────
test('a bad link is dropped or mended as designed', () => {
  const ids = new Set(['a', 'b']);
  assert.equal(cleanLink({ from: 'a', to: 'zzz' }, ids, 'l1'), null, 'unknown node');
  assert.equal(cleanLink({ from: 'a', to: 'a' }, ids, 'l1'), null, 'a thing cannot be linked to itself');
  assert.equal(cleanLink({ from: 'a' }, ids, 'l1'), null, 'one end is not a link');
  assert.equal(cleanLink(null, ids, 'l1'), null);
  assert.equal(cleanLink({ from: 'a', to: 'b' }, ids, ''), null, 'a link needs a name');
  // a typo costs the arrowhead, not the link
  assert.deepEqual(cleanLink({ from: 'a', to: 'b', ends: 'pointy', line: 'wavy', colour: 'beige', label: ' two\nlines ' }, ids, 'l1'),
    { id: 'l1', from: 'a', to: 'b', label: 'two lines', ends: 'arrow', line: 'solid' });

  seedWorkspace();
  const d = diagram();
  const b = saveBoard(PID, {
    nodes: d.nodes,
    links: [...d.links, { id: 'x1', from: 'a', to: 'ghost' }, { id: 'l1', from: 'q', to: 'a' }, { from: 'n', to: 'h' }],
  });
  assert.deepEqual(b.links.map(l => l.from + '>' + l.to), ['a>q', 'q>n', 'h>a', 'q>a', 'n>h'], 'the ghost is gone; the rest stay, in order');
  assert.equal(new Set(b.links.map(l => l.id)).size, b.links.length, 'a repeated id is renamed, a missing one is minted');
  assert.ok(b.links.every(l => /^[A-Za-z0-9_-]+$/.test(l.id)));
});

test('removing a node removes the lines drawn to it, in the same save', () => {
  seedWorkspace();
  const b = saveBoard(PID, diagram());
  const without = saveBoard(PID, { nodes: b.nodes.filter(n => n.id !== 'q'), base: b.rev, log: 'removed the question' });
  assert.deepEqual(without.links.map(l => l.id), ['l3'], 'both links that touched it are gone; the caller sent no links at all');
  assert.equal(getBoard(PID).links.length, 1);
});

test('the canvas may name its own nodes; the counter never hands out a taken name', () => {
  seedWorkspace();
  const b = saveBoard(PID, { nodes: [
    { id: 'n1', t: 'note', text: 'chosen by the canvas', x: 0, y: 0 },
    { t: 'note', text: 'named by the board', x: 300, y: 0 },
    { id: 'n1', t: 'note', text: 'a clash', x: 600, y: 0 },
  ] });
  const ids = b.nodes.map(n => n.id);
  assert.equal(ids[0], 'n1');
  assert.equal(new Set(ids).size, 3, 'three nodes, three names');
});

// ── 3 · old boards ──────────────────────────────────────────────────────────────────────────────
test('a board written before links existed loads unchanged and is not rewritten by a read', () => {
  seedWorkspace();
  const file = boardFile(PID);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeMd(file, {
    board: PID, kind: 'whiteboard', view: { x: 10, y: 20, z: 1 }, seq: 2, rev: 7,
    nodes: [
      { id: 'n1', t: 'note', x: 0, y: 0, w: 240, h: 160, text: 'from before', tone: 'ok' },
      { id: 'n2', t: 'document', x: 300, y: 0, w: 300, h: 180, path: ANA },
    ],
    updated: '2026-08-01T00:00:00.000Z',
  }, '## Board log\n\n- 2026-08-01T00:00:00.000Z · crystal — placed two\n');
  const before = fs.readFileSync(file, 'utf8');

  const b = getBoard(PID);
  assert.equal(b.rev, 7);
  assert.deepEqual(b.links, []);
  assert.deepEqual(b.offers, {});
  assert.equal(b.nodes.length, 2);
  assert.deepEqual(b.nodes[0], { id: 'n1', t: 'note', x: 0, y: 0, w: 240, h: 160, text: 'from before', tone: 'ok' }, 'no new keys appear on an old note');
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'reading is not writing');

  // and a camera move on it is still not a revision
  const panned = saveBoard(PID, { view: { x: 99, y: 0, z: 1 } });
  assert.equal(panned.rev, 7);
  assert.match(panned.log, /placed two/, 'the log is kept');
});

test('a link added to the file by hand, without an id, is read and can be saved', () => {
  seedWorkspace();
  const b = saveBoard(PID, { nodes: diagram().nodes });
  const raw = readMd(boardFile(PID));
  writeMd(boardFile(PID), { ...raw.data, links: [{ from: 'a', to: 'n', label: 'by hand' }] }, raw.content);
  const read = getBoard(PID);
  assert.equal(read.links.length, 1);
  assert.equal(read.links[0].label, 'by hand');
  assert.ok(read.links[0].id);
  const saved = saveBoard(PID, { links: read.links, base: b.rev });
  assert.deepEqual(saved.links, read.links);
});

// ── 4 · the board in words ──────────────────────────────────────────────────────────────────────
test('describeBoard says what the diagram says, with names', () => {
  seedWorkspace();
  const d = diagram();
  saveBoard(PID, {
    nodes: [...d.nodes, { id: 'r1', t: 'document', path: ANA, x: 0, y: 500 }, { id: 'r2', t: 'document', path: ACME, x: 400, y: 500 }],
    links: [...d.links, { id: 'l4', from: 'r1', to: 'r2', label: 'pitching to', ends: 'both' }, { id: 'l5', from: 'n', to: 'r1' }],
  });
  const out = describeBoard(PID);
  assert.deepEqual(out.links, [
    'Find the person → Do they answer?',
    'Do they answer? → Ask the admin for an intro first.: no',
    'How a story gets booked — Find the person',
    'Ana Cruz ↔ Acme Studio: pitching to',
    'Ask the admin for an intro first. → Ana Cruz',
  ]);
  assert.ok(!out.links.join(' ').match(/\b(l\d|r\d)\b/), 'no ids in a description');
  assert.deepEqual(out.texts, ['How a story gets booked']);
  assert.deepEqual(out.shapes, ['round: Find the person', 'diamond: Do they answer?']);
  assert.deepEqual(out.notes, ['Ask the admin for an intro first.']);
  assert.equal(out.strokes, 1, 'a stroke is counted, not described');
  assert.deepEqual(out.documents.sort(), ['Acme Studio', 'Ana Cruz']);
  assert.deepEqual(out.edges, [], 'nothing the records say joins these two yet');
});

// ── 5 · making a drawn link real ────────────────────────────────────────────────────────────────
test('a drawn link between two records is offered as the relation it could be — in either direction', () => {
  seedWorkspace();
  const nodes = [
    { id: 'p', t: 'document', path: ANA, x: 0, y: 0 },
    { id: 'c', t: 'document', path: ACME, x: 400, y: 0 },
    { id: 'b', t: 'document', path: BEN, x: 0, y: 300 },
    { id: 'n', t: 'note', text: 'a note', x: 400, y: 300 },
  ];
  const b = saveBoard(PID, { nodes, links: [
    { id: 'fwd', from: 'p', to: 'c' },          // the person holds the field
    { id: 'rev', from: 'c', to: 'p' },          // drawn the other way round: still the person's field
    { id: 'done', from: 'b', to: 'c' },         // Ben already says Acme
    { id: 'none', from: 'p', to: 'b' },         // people have no field for people
    { id: 'word', from: 'n', to: 'c' },         // a note is not a record
  ] });
  assert.deepEqual(Object.keys(b.offers).sort(), ['fwd', 'rev']);
  for (const id of ['fwd', 'rev']) {
    const o = b.offers[id];
    assert.equal(o.path, ANA);
    assert.equal(o.field, 'companies');
    assert.equal(o.value, 'acme-studio');
    assert.equal(o.sentence, 'Set Company on Ana Cruz to Acme Studio');
  }
  assert.equal(b.edges.length, 1, 'Ben → Acme is already a fact, and is drawn as one');
  assert.deepEqual(linkOffers([], b.nodes), {});
});

test('make it real: the record is written by the record writer and logged, the drawn link goes, the edge appears', async () => {
  seedWorkspace();
  const b = saveBoard(PID, {
    nodes: [{ id: 'p', t: 'document', path: ANA, x: 0, y: 0 }, { id: 'c', t: 'document', path: ACME, x: 400, y: 0 }, { id: 'n', t: 'note', text: 'why', x: 0, y: 300 }],
    links: [{ id: 'k1', from: 'c', to: 'p', label: 'works here' }, { id: 'k2', from: 'n', to: 'p' }],
  });
  assert.equal(b.edges.length, 0);
  const since = new Date(Date.now() - 1000).toISOString();

  // an agent may not
  await assert.rejects(realiseLink(PID, 'k1', { actor: 'scout-fb' }), e => e.status === 403);
  assert.equal(readMd(at(ANA)).data.companies, undefined, 'a refusal writes nothing');
  assert.equal(getBoard(PID).links.length, 2);
  // a link with nothing to say is refused, and so is one that is not there
  await assert.rejects(realiseLink(PID, 'k2', { actor: 'crystal' }), e => e.status === 409);
  await assert.rejects(realiseLink(PID, 'nope', { actor: 'crystal' }), e => e.status === 404);

  const out = await realiseLink(PID, 'k1', { actor: 'crystal' });
  const ana = readMd(at(ANA));
  assert.equal(ana.data.companies, 'acme-studio', 'the record says it now');
  assert.equal(ana.data.updated_by, 'crystal', 'provenance is the record writer\'s — proof it went through records.mjs');
  assert.match(ana.content, /Producer/, 'the note under it is untouched');

  assert.deepEqual(out.links.map(l => l.id), ['k2'], 'the drawn link is gone; the other one stays');
  assert.equal(out.edges.length, 1, 'and the derived edge now says it');
  assert.equal(out.edges[0].label, 'Company');
  assert.equal(out.realised.sentence, 'Set Company on Ana Cruz to Acme Studio');
  assert.equal(out.rev, b.rev + 1);
  assert.match(out.log, /made a drawn link real — Set Company on Ana Cruz to Acme Studio/);

  const events = readEvents({ since, limit: 50 });
  const record = events.find(e => e.target === ANA && e.type === 'update');
  assert.ok(record, 'the record edit is in the event log');
  assert.equal(record.actor, 'crystal');
  assert.deepEqual(record.detail.changed, ['companies']);
  assert.ok(events.some(e => e.target === 'projects/' + PID + '/board.md' && /made a drawn link real/.test(String(e.detail && e.detail.what))), 'and so is the board change');
});

test('a many-relation is added to, never replaced', async () => {
  seedWorkspace();
  saveCollection({
    id: 'teams', label: 'Teams', query: { path: 'data/teams/**' },
    fields: [{ key: 'name', type: 'text', primary: true }, { key: 'members', type: 'relation', target: 'people', many: true }],
  });
  const TEAM = 'data/teams/core.md';
  writeMd(at(TEAM), { name: 'Core team', members: ['ben-lim'] }, '');
  const b = saveBoard(PID, {
    nodes: [{ id: 't', t: 'document', path: TEAM, x: 0, y: 0 }, { id: 'p', t: 'document', path: ANA, x: 400, y: 0 }],
    links: [{ id: 'k1', from: 'p', to: 't' }],
  });
  // drawn from the person, but people have no field for teams: the team's `members` is the one
  assert.equal(b.offers.k1.path, TEAM);
  assert.equal(b.offers.k1.many, true);
  assert.equal(b.offers.k1.sentence, 'Add Ana Cruz to Members on Core team');
  const out = await realiseLink(PID, 'k1', { actor: 'crystal' });
  assert.deepEqual(readMd(at(TEAM)).data.members, ['ben-lim', 'ana-cruz'], 'Ben is still a member');
  assert.equal(out.links.length, 0);
  assert.ok(out.edges.some(e => e.field === 'members'), 'the derived edge replaces the drawn link');
});

// ── the routes ──────────────────────────────────────────────────────────────────────────────────
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
const call = async (method, p, body) => {
  const r = await fetch((await base()) + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

test('PUT carries links; GET describe reads the diagram; POST realise is human only', async () => {
  seedWorkspace();
  const put = await call('PUT', '/api/scout/board/' + PID, {
    nodes: [{ id: 'p', t: 'document', path: ANA, x: 0, y: 0 }, { id: 'c', t: 'document', path: ACME, x: 400, y: 0 }, { id: 't', t: 'text', text: 'Who works where', x: 0, y: -80 }],
    links: [{ id: 'k1', from: 'p', to: 'c' }, { id: 'k2', from: 't', to: 'p', ends: 'none' }],
    log: 'drew two links',
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.links.length, 2);
  assert.ok(put.body.offers.k1);

  const said = await call('GET', '/api/scout/board/' + PID + '/describe');
  assert.equal(said.status, 200);
  assert.deepEqual(said.body.links, ['Ana Cruz → Acme Studio', 'Who works where — Ana Cruz']);

  const agent = await call('POST', '/api/scout/board/' + PID + '/links/k1/realise', { actor: 'scout-fb' });
  assert.equal(agent.status, 403);
  const person = await call('POST', '/api/scout/board/' + PID + '/links/k1/realise', {});
  assert.equal(person.status, 200);
  assert.equal(readMd(at(ANA)).data.companies, 'acme-studio');
  assert.deepEqual(person.body.links.map(l => l.id), ['k2']);
  const twice = await call('POST', '/api/scout/board/' + PID + '/links/k1/realise', {});
  assert.equal(twice.status, 404, 'it is gone; it cannot be done twice');
});

// ── strokes (frontend/boardLayout.js — pure, shared with the canvas) ────────────────────────────
test('a stroke is packed into its own box, drawn as one smooth path, and hit by touching the line', () => {
  // board-space points, as the pen collects them
  const pts = [{ x: 100.2, y: 200.7 }, { x: 100.9, y: 200.9 }, { x: 130, y: 220 }, { x: 180, y: 205 }, { x: 240, y: 260 }];
  const s = packStroke(pts, 4);
  assert.ok(s.w >= 140 && s.h >= 60, 'the box holds the stroke');
  assert.ok(s.x <= 100 && s.y <= 200, 'with room for the line\'s own thickness');
  const rel = parsePoints(s.points);
  assert.ok(rel.every(p => Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x <= s.w && p.y <= s.h), 'integers, inside the box');
  assert.ok(rel.length < pts.length, 'two samples a hair apart are one point');
  assert.equal(packStroke([], 4), null);
  assert.equal(parsePoints(packStroke([{ x: 5, y: 5 }], 4).points).length, 2, 'a tap is a dot');

  const d = strokePath(s.points);
  assert.match(d, /^M \d+ \d+ /);
  assert.ok(/Q/.test(d), 'curved through the points, not a polyline');
  assert.equal(strokePath(''), '');

  const node = { x: s.x, y: s.y, w: s.w, h: s.h, points: s.points, width: 4 };
  assert.equal(strokeHit(node, { x: 130, y: 220 }, 6), true, 'on the line');
  assert.equal(strokeHit(node, { x: 155, y: 213 }, 6), true, 'between two points is still the line');
  assert.equal(strokeHit(node, { x: 120, y: 255 }, 6), false, 'inside the box but off the line');
  assert.equal(strokeHit(node, { x: 900, y: 900 }, 6), false);
});
