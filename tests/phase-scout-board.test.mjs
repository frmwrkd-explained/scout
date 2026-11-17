// The whiteboard's datastore and its edge derivation (backend/scoutBoard.mjs) — T15.
//
// What is actually at risk here, and therefore what is tested:
//   1. THE DEMONSTRATE. Drop a guest, its territory and the project brief on a board and the two
//      relation edges draw themselves, labelled with the field names that create them. If this
//      test is red the feature does not exist, whatever the canvas looks like.
//   2. An edge means something. It is derived from frontmatter, both ends must be on the board,
//      and a prose mention is not a relation. A line nobody can explain is worse than no line.
//   3. `rev` advances only when NODES change. Panning is not document content — bumping the
//      revision on a camera move fires the stale-write guard on the one user it protects.
//   4. The document stays readable and fails closed: integer coordinates, unknown kinds dropped,
//      no path that escapes the store.
//   5. A card is LIVE. The node stores a path; the title, the properties and the body are read
//      from the file, so the board can never be a stale copy of the record.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { freshRoot, seedProject } from './helpers.mjs';
import { writeMd, readMd, getStorageRoot } from '../backend/store.mjs';
import { saveCollection, addField } from '../backend/collections.mjs';
import {
  getBoard, saveBoard, deriveEdges, cleanNode, describeBoard,
  registerScoutBoardRoutes, boardFile, NODE_KINDS, RECORD_KINDS,
} from '../backend/scoutBoard.mjs';

const PID = 'pitch';
const GUEST = 'data/guests/maria-santos.md';
const GROUND = 'data/groups/nurses-ph.md';
const BRIEF = 'projects/pitch/brief.md';

const at = rel => path.join(getStorageRoot(), rel);

// The workspace the Demonstrate needs: two collections that declare a relation in BOTH directions
// (`guest.found_in` → group, `group.top_finds` → guest, exactly as the seeded workspace does), one
// guest, the ground it was found in, and a project brief that mentions her only in prose.
function seedWorkspace() {
  freshRoot();
  seedProject(PID);

  saveCollection({
    id: 'group', label: 'Groups', query: { path: 'data/groups/**' },
    fields: [
      { key: 'name', type: 'text', primary: true },
      { key: 'finds', type: 'number' },
    ],
  });
  saveCollection({
    id: 'guest', label: 'Guests', query: { tag: 'guest', path: 'data/guests/**' },
    fields: [
      { key: 'name', type: 'text', primary: true },
      { key: 'status', type: 'status', gate: true, options: [{ value: 'needs-review', group: 'todo' }, { value: 'shortlist', group: 'todo' }] },
      { key: 'score', type: 'number', display: 'bar', min: 1, max: 10 },
      { key: 'found', type: 'date', display: 'freshness' },
      { key: 'found_in', type: 'relation', target: 'group', inverse: 'finds' },
    ],
  });
  // `top_finds` is added after `guest` exists — a relation target is checked against what is on
  // disk, so the two halves of a two-way relation cannot both be written in one pass.
  addField('group', { key: 'top_finds', type: 'relation', target: 'guest', many: true });

  writeMd(at(GUEST), {
    name: 'Maria Santos', tags: ['guest'], status: 'needs-review', score: 9,
    found: '2026-08-17', found_in: 'nurses-ph', created_by: 'scout-fb', updated_by: 'scout-fb',
  }, 'A nurse who started cooking on camera during the pandemic.\n');

  writeMd(at(GROUND), {
    name: 'Nurses PH', finds: 12, top_finds: ['maria-santos'],
  }, 'A 40k-member group of Filipino nurses.\n');

  // The brief points at nobody. It says her name in prose, and its one loose field is a NEAR miss
  // ("maria santos" is not the slug "maria-santos") — both of which must draw nothing.
  writeMd(at(BRIEF), { project: PID, title: 'Pitch brief', about: 'maria santos' },
    'We want Maria Santos on the show before September.\n');
}

// A territory NODE is how the ground reads on the canvas; its ADDRESS is whatever document holds
// it — today a `#group` record, at M3 a `territory/<id>.md` memory object. Edge derivation reads
// the frontmatter either way, which is why the node kind is a presentation choice and not a
// second addressing scheme.
const demoNodes = () => ([
  { t: 'document', path: GUEST, x: 0, y: 0 },
  { t: 'territory', path: GROUND, x: 420, y: 0 },
  { t: 'document', path: BRIEF, x: 840, y: 0 },
]);

const edgeWords = b => b.edges.map(e => nameOf(b, e.from) + ' -' + e.field + '-> ' + nameOf(b, e.to));
const nameOf = (b, id) => {
  const n = b.nodes.find(x => x.id === id);
  return n ? ((b.cards[n.path] || {}).title || n.path) : '?';
};

// ── 1 · THE DEMONSTRATE ─────────────────────────────────────────────────────────────────────────
test('a guest, its territory and the project brief: the two relation edges draw themselves, labelled', () => {
  seedWorkspace();
  const b = saveBoard(PID, { nodes: demoNodes(), log: 'placed the guest, its territory and the brief' }, { actor: 'crystal' });

  assert.equal(b.nodes.length, 3);
  assert.equal(b.edges.length, 2, 'exactly two relations exist between these three documents');

  const byField = Object.fromEntries(b.edges.map(e => [e.field, e]));
  assert.deepEqual(Object.keys(byField).sort(), ['found_in', 'top_finds']);

  const guestNode = b.nodes.find(n => n.path === GUEST);
  const groundNode = b.nodes.find(n => n.path === GROUND);
  const briefNode = b.nodes.find(n => n.path === BRIEF);

  // direction is real: `from` is the document that HOLDS the pointer
  assert.equal(byField.found_in.from, guestNode.id);
  assert.equal(byField.found_in.to, groundNode.id);
  assert.equal(byField.top_finds.from, groundNode.id);
  assert.equal(byField.top_finds.to, guestNode.id);

  // the label IS the field's name, as a person reads it — never a guess, never a generic "related".
  // `field` stays the machine key (asserted above): an agent reading the board keys off that.
  assert.equal(byField.found_in.label, 'Found in');
  assert.equal(byField.top_finds.label, 'Top finds');

  // both are typed `relation` fields, so the canvas can say WHICH collection declares them
  assert.equal(byField.found_in.declared, true);
  assert.equal(byField.found_in.collection, 'guest');
  assert.equal(byField.top_finds.declared, true);
  assert.equal(byField.top_finds.collection, 'group');
  assert.equal(byField.top_finds.many, true, 'top_finds is a many relation and says so');

  // the brief is on the board and draws nothing, because it points at nothing
  assert.ok(!b.edges.some(e => e.from === briefNode.id || e.to === briefNode.id));

  assert.deepEqual(edgeWords(b).sort(), [
    'Maria Santos -found_in-> Nurses PH',
    'Nurses PH -top_finds-> Maria Santos',
  ]);
});

test('the derivation is a pure projection — deriveEdges on the same nodes says the same thing', () => {
  seedWorkspace();
  const b = saveBoard(PID, { nodes: demoNodes() }, { actor: 'crystal' });
  const again = deriveEdges(b.nodes);
  assert.deepEqual(again, b.edges);
  // nothing about the edges is stored: the document on disk holds nodes and no edge list at all
  const raw = readMd(boardFile(PID)).data;
  assert.equal(raw.edges, undefined);
  assert.equal(Array.isArray(raw.nodes), true);
});

// ── 2 · an edge means something ─────────────────────────────────────────────────────────────────
test('an edge needs BOTH ends on the board', () => {
  seedWorkspace();
  const only = saveBoard(PID, { nodes: [{ t: 'document', path: GUEST, x: 0, y: 0 }, { t: 'document', path: BRIEF, x: 400, y: 0 }] });
  assert.deepEqual(only.edges, [], 'the relation exists in the store, but the other end is not placed');

  const both = saveBoard(PID, { nodes: demoNodes() });
  assert.equal(both.edges.length, 2);
});

test('a prose mention is not a relation', () => {
  seedWorkspace();
  const b = saveBoard(PID, { nodes: demoNodes() });
  const brief = b.nodes.find(n => n.path === BRIEF);
  // the brief says "Maria Santos" in its body and carries about: "maria santos" in frontmatter.
  // Neither is the slug, and a substring match would turn every sentence into a false backlink.
  assert.ok(!b.edges.some(e => e.from === brief.id || e.to === brief.id));
});

test('a loose frontmatter pointer still draws a labelled edge, and says it is not declared', () => {
  seedWorkspace();
  // the brief now points at the guest through a key no collection declares
  writeMd(at(BRIEF), { project: PID, title: 'Pitch brief', wants: 'maria-santos' }, 'The pitch.\n');
  const b = saveBoard(PID, { nodes: demoNodes() });
  const e = b.edges.find(x => x.field === 'wants');
  assert.ok(e, 'an undeclared pointer is still a real relation — the memory objects have no schema');
  assert.equal(e.declared, false);
  assert.equal(e.field, 'wants');
  assert.equal(e.label, 'Wants');
});

test('a card whose file is gone draws no edge and is reported missing rather than faked', () => {
  seedWorkspace();
  const b = saveBoard(PID, { nodes: demoNodes() });
  fs.rmSync(at(GROUND));
  const after = getBoard(PID);
  assert.equal(after.nodes.length, 3, 'the node stays — never delete what the user placed');
  assert.deepEqual(after.edges, []);
  assert.equal(after.cards[GROUND].missing, true);
});

test('the same document placed twice gets the edge on both cards', () => {
  seedWorkspace();
  const b = saveBoard(PID, {
    nodes: [
      { t: 'document', path: GUEST, x: 0, y: 0 },
      { t: 'territory', path: GROUND, x: 420, y: 0 },
      { t: 'territory', path: GROUND, x: 420, y: 400 },
    ],
  });
  assert.equal(b.edges.filter(e => e.field === 'found_in').length, 2);
  assert.equal(b.edges.filter(e => e.field === 'top_finds').length, 2);
});

// ── 3 · rev ─────────────────────────────────────────────────────────────────────────────────────
test('panning does not advance rev; moving a node does', () => {
  seedWorkspace();
  const placed = saveBoard(PID, { nodes: demoNodes(), log: 'placed three documents' });
  const rev0 = placed.rev;
  assert.ok(rev0 > 0);

  const panned = saveBoard(PID, { view: { x: -800, y: 240, z: 0.75 } });
  assert.equal(panned.rev, rev0, 'the camera is not document content');
  assert.deepEqual(panned.view, { x: -800, y: 240, z: 0.75 }, 'but it is still saved');

  const moved = saveBoard(PID, {
    nodes: panned.nodes.map(n => (n.path === GUEST ? { ...n, x: n.x + 40 } : n)),
    log: 'moved 1 node',
  });
  assert.equal(moved.rev, rev0 + 1, 'a node moved — that is a revision');

  // re-saving an unchanged node list is free, so an idle canvas cannot walk the revision forward
  const same = saveBoard(PID, { nodes: moved.nodes });
  assert.equal(same.rev, moved.rev);
});

test('the body is an append-only log, and a pan writes no line', () => {
  seedWorkspace();
  saveBoard(PID, { nodes: demoNodes(), log: 'placed three documents' }, { actor: 'crystal' });
  saveBoard(PID, { nodes: [], log: 'cleared the board' }, { actor: 'crystal' });
  const before = getBoard(PID).log;
  assert.match(before, /placed three documents/);
  assert.match(before, /cleared the board/);
  assert.ok(before.indexOf('placed three') < before.indexOf('cleared the'), 'oldest first — an append is an append');
  assert.match(before, /· crystal — /);

  saveBoard(PID, { view: { x: 10, y: 10, z: 1 }, log: 'panned' });
  const after = getBoard(PID).log;
  assert.equal(after, before, 'a camera move logs nothing');
});

test('a stale base is refused rather than clobbering the newer board', () => {
  seedWorkspace();
  const mine = saveBoard(PID, { nodes: demoNodes() });
  saveBoard(PID, { nodes: mine.nodes.slice(0, 1), log: 'someone else edited' });   // the board moves on
  assert.throws(
    () => saveBoard(PID, { nodes: mine.nodes, base: mine.rev, log: 'my stale drag' }),
    e => e.code === 'stale' && e.board && e.board.nodes.length === 1,
  );
});

// ── 4 · the document stays readable, and fails closed ──────────────────────────────────────────
// A relation between records is still never drawn by hand — it is read (deriveEdges). What a person
// draws is a LINK, kept in its own list (tests/whiteboard-links.test.mjs), and neither is a node.
test('a line is never a node kind', () => {
  assert.equal(NODE_KINDS.includes('arrow'), false);
  assert.deepEqual(NODE_KINDS, ['document', 'collection-view', 'territory', 'goal', 'note', 'image', 'frame', 'text', 'shape', 'draw']);
  assert.deepEqual(RECORD_KINDS, ['document', 'territory', 'goal']);
  assert.equal(cleanNode({ t: 'arrow', from: 'a', to: 'b' }, 'n1'), null);
  assert.equal(cleanNode({ t: 'shot', shot: 'SH010' }, 'n1'), null, 'a FrameForge kind is not a Scout kind');
});

test('coordinates are rounded and unsafe paths never reach the document', () => {
  seedWorkspace();
  const b = saveBoard(PID, {
    nodes: [
      { t: 'document', path: GUEST, x: 12.999999, y: -3.00001, w: 320.7, h: 260.2 },
      { t: 'document', path: '../../../../etc/passwd' },
      { t: 'document', path: '/etc/passwd' },
      { t: 'document', path: 'data/guests/maria-santos.png' },
      { t: 'note', x: 0, y: 0, text: 'kept' },
    ],
  });
  assert.equal(b.nodes.length, 2, 'three unsafe or unaddressable nodes dropped');
  const raw = readMd(boardFile(PID)).data.nodes[0];
  assert.equal(raw.x, 13);
  assert.equal(raw.y, -3);
  assert.equal(raw.w, 321);
  assert.equal(raw.h, 260);
});

test('ids are minted from the document counter and survive a move', () => {
  seedWorkspace();
  const first = saveBoard(PID, { nodes: demoNodes() });
  assert.deepEqual(first.nodes.map(n => n.id), ['n1', 'n2', 'n3']);
  const moved = saveBoard(PID, { nodes: first.nodes.map(n => ({ ...n, x: n.x + 20 })) });
  assert.deepEqual(moved.nodes.map(n => n.id), ['n1', 'n2', 'n3'], 'a move is not a delete-and-recreate');
  const added = saveBoard(PID, { nodes: [...moved.nodes, { t: 'note', text: 'new', x: 0, y: 600 }] });
  assert.equal(added.nodes[3].id, 'n4', 'the counter never re-issues an id');
});

test('reading a board never creates the file', () => {
  seedWorkspace();
  const b = getBoard(PID);
  assert.deepEqual(b.nodes, []);
  assert.deepEqual(b.edges, []);
  assert.deepEqual(b.view, { x: 0, y: 0, z: 1 });
  assert.equal(fs.existsSync(boardFile(PID)), false);
});

test('a FrameForge board at the same path is reported, not silently emptied or overwritten', () => {
  seedWorkspace();
  writeMd(boardFile(PID), { project: PID, show: 'selected', layout: 'scene-grid', rev: 4, nodes: [{ id: 'a1', t: 'asset', x: 0, y: 0, w: 320, h: 180, scope: PID, name: 'x.png' }] }, '## Board log\n');
  const b = getBoard(PID);
  assert.equal(b.foreign, true);
  assert.throws(() => saveBoard(PID, { nodes: demoNodes() }), e => e.code === 'foreign');
  assert.match(fs.readFileSync(boardFile(PID), 'utf8'), /t: asset/, 'their document is untouched');
});

// ── 5 · a card is live ──────────────────────────────────────────────────────────────────────────
test('a document node renders the live document — title, the three fields that matter, the body', () => {
  seedWorkspace();
  const b = saveBoard(PID, { nodes: demoNodes() });
  const card = b.cards[GUEST];
  assert.equal(card.title, 'Maria Santos');
  assert.equal(card.collection, 'guest');
  assert.match(card.summary, /^A nurse who started cooking/);
  assert.match(card.body, /pandemic/);
  // docs/05_UI_SPEC.md §2.1 — the gate status, the primary number and freshness, and no more
  assert.deepEqual(card.props.map(p => p.key), ['status', 'score', 'found']);
  assert.equal(card.props[0].field.type, 'status');
  assert.equal(card.props[0].field.gate, true);
  assert.equal(card.props[1].value, 9);

  // and it is LIVE: edit the record, the card changes, the board is not rewritten
  const revBefore = b.rev;
  writeMd(at(GUEST), { ...card.fields, name: 'Maria Santos-Reyes', score: 10 }, 'Now booked.\n');
  const after = getBoard(PID);
  assert.equal(after.cards[GUEST].title, 'Maria Santos-Reyes');
  assert.equal(after.cards[GUEST].props[1].value, 10);
  assert.equal(after.rev, revBefore, 'nothing about the board changed — the record did');
});

test('the agent digest says what the board means, not where the cards are', () => {
  seedWorkspace();
  saveBoard(PID, { nodes: [...demoNodes(), { t: 'note', text: 'ask her about night shifts', x: 0, y: 500 }] });
  const d = describeBoard(PID);
  assert.equal(d.total, 4);
  assert.deepEqual(d.counts, { document: 2, territory: 1, note: 1 });
  assert.deepEqual(d.edges.sort(), ['Maria Santos —found_in→ Nurses PH', 'Nurses PH —top_finds→ Maria Santos']);
  assert.deepEqual(d.notes, ['ask her about night shifts']);
  assert.equal(JSON.stringify(d).includes('"x"'), false, 'no coordinates in an agent read');
});

// ── the two routes ──────────────────────────────────────────────────────────────────────────────
// Mounted on a throwaway app: `backend/index.mjs` is the integrator's file and this module is
// registered there, not here (docs/08_MODULE_CONTRACTS.md §0).
let baseUrl = null;
async function routes() {
  if (baseUrl) return baseUrl;
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  registerScoutBoardRoutes(app);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  server.unref();
  baseUrl = 'http://127.0.0.1:' + server.address().port;
  return baseUrl;
}
async function call(method, p, body) {
  const base = await routes();
  const r = await fetch(base + p, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try { parsed = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: parsed };
}

test('GET /api/scout/board/:id hands back the nodes, the derived edges and the live cards', async () => {
  seedWorkspace();
  await call('PUT', '/api/scout/board/' + PID, { nodes: demoNodes(), log: 'placed three documents', actor: 'crystal' });
  const { status, body } = await call('GET', '/api/scout/board/' + PID);
  assert.equal(status, 200);
  assert.equal(body.nodes.length, 3);
  assert.equal(body.edges.length, 2);
  assert.deepEqual(body.edges.map(e => e.field).sort(), ['found_in', 'top_finds']);
  assert.deepEqual(body.edges.map(e => e.label).sort(), ['Found in', 'Top finds']);
  assert.equal(body.cards[GUEST].title, 'Maria Santos');
});

test('PUT with a stale base 409s and hands the current board back with it', async () => {
  seedWorkspace();
  const mine = (await call('PUT', '/api/scout/board/' + PID, { nodes: demoNodes() })).body;
  await call('PUT', '/api/scout/board/' + PID, { nodes: mine.nodes.slice(0, 2), log: 'an agent tidied' });
  const stale = await call('PUT', '/api/scout/board/' + PID, { nodes: mine.nodes, base: mine.rev, log: 'my drag' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'stale');
  assert.equal(stale.body.board.nodes.length, 2, 'the client can adopt the current document in the same round trip');
});
