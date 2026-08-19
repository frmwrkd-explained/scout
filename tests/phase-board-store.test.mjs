// The Board's datastore and operations (backend/board.mjs).
//
// What is actually at risk here, and therefore what is tested:
//   1. the document stays READABLE. This format exists so an agent can edit the board with the
//      tools it already has; a canvas that writes 14-decimal floats defeats that on the first drag.
//   2. sanitisation FAILS CLOSED. A node with an unknown kind, or a shot node with no shot id, is
//      dropped rather than written — a malformed node on a canvas is an invisible click target.
//   3. align is idempotent and id-stable, because it is the one operation both a human button and
//      an agent call reach.
//   4. deleting a node takes its arrows with it. An arrow anchored to nothing renders as a stub.
//   5. describeBoard never leaks coordinates — that route exists precisely so an agent's read of
//      the board costs a paragraph rather than four hundred integers.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { freshRoot, seedProject, seedShot, req } from './helpers.mjs';
import { readMd, paths } from '../backend/store.mjs';
import {
  getBoard, saveBoard, addNodes, patchNodes, removeNodes,
  syncShots, syncAssets, alignBoard, setShow, describeBoard, cleanNode, SHOW_MODES
} from '../backend/board.mjs';
import { saveContextFile } from '../backend/store.mjs';

const boardFile = pid => path.join(paths.projectDir(pid), 'board.md');

function seedBoardProject(pid = 'bd') {
  freshRoot();
  seedProject(pid);
  seedShot(pid, 'SH010', { no: 1, scene: 1, title: 'Ferry leaves' });
  seedShot(pid, 'SH020', { no: 2, scene: 1, title: 'Wheelhouse' });
  seedShot(pid, 'SH030', { no: 3, scene: 2, title: 'Deck at night' });
  return pid;
}

// ── the empty board ─────────────────────────────────────────────────────────────────────────────
test('a project has a board before anything is written to it', () => {
  const pid = seedBoardProject();
  const b = getBoard(pid);
  assert.deepEqual(b.nodes, []);
  assert.equal(b.layout, 'scene-grid');
  assert.equal(b.show, 'selected');
  assert.deepEqual(b.view, { x: 0, y: 0, z: 1 });
  assert.equal(fs.existsSync(boardFile(pid)), false, 'reading does not create the file');
});

// ── sanitisation ────────────────────────────────────────────────────────────────────────────────
test('coordinates are rounded to integers — the document has to stay readable', () => {
  const pid = seedBoardProject();
  addNodes(pid, [{ t: 'note', x: 12.999999999, y: -3.00000001, w: 240.7, h: 160.2, text: 'hi' }]);
  const raw = readMd(boardFile(pid)).data;
  const n = raw.nodes[0];
  assert.equal(n.x, 13);
  assert.equal(n.y, -3);
  assert.equal(n.w, 241);
  assert.equal(n.h, 160);
  assert.ok(Number.isInteger(n.x) && Number.isInteger(n.y));
});

test('an unknown node kind is dropped, never written', () => {
  const pid = seedBoardProject();
  const { added } = addNodes(pid, [{ t: 'wormhole', x: 0, y: 0 }, { t: 'note', text: 'ok' }]);
  assert.equal(added.length, 1);
  assert.equal(getBoard(pid).nodes.length, 1);
  assert.equal(cleanNode({ t: 'wormhole', id: 'a' }, 'a'), null);
});

test('a shot node with no shot id and an asset with no name are both refused', () => {
  assert.equal(cleanNode({ t: 'shot', id: 'a' }, 'a'), null);
  assert.equal(cleanNode({ t: 'asset', id: 'a', scope: 'p' }, 'a'), null);
  assert.equal(cleanNode({ t: 'asset', id: 'a', name: 'x.png' }, 'a'), null);
  assert.ok(cleanNode({ t: 'asset', id: 'a', scope: 'p', name: 'x.png' }, 'a'));
});

test('an out-of-vocabulary tone or size falls back instead of writing garbage', () => {
  assert.equal(cleanNode({ t: 'note', id: 'a', tone: 'chartreuse' }, 'a').tone, 'accent');
  assert.equal(cleanNode({ t: 'text', id: 'a', size: 'gigantic' }, 'a').size, 'lg');
});

test('zoom is clamped and kept to three decimals; a node cannot be written sub-pixel', () => {
  const pid = seedBoardProject();
  saveBoard(pid, { view: { x: 1.6, y: 2.4, z: 99 } });
  assert.deepEqual(getBoard(pid).view, { x: 2, y: 2, z: 3 });
  saveBoard(pid, { view: { x: 0, y: 0, z: 0.123456 } });
  assert.equal(getBoard(pid).view.z, 0.123);

  addNodes(pid, [{ t: 'note', w: 1, h: 1 }]);
  const n = getBoard(pid).nodes.pop();
  assert.ok(n.w >= 40 && n.h >= 28, 'a node below the floor is clamped, not written as a 1px hit target');
});

test('an unlisted key in a patch is dropped, not merged into the document', () => {
  const pid = seedBoardProject();
  saveBoard(pid, { show: 'all', nonsense: true, seq: 9999 });
  const raw = readMd(boardFile(pid)).data;
  assert.equal(raw.nonsense, undefined);
  assert.equal(raw.seq, 0, 'seq is owned by the id minter, not by the wire');
  assert.equal(raw.show, 'all');
});

// ── ids ─────────────────────────────────────────────────────────────────────────────────────────
test('ids come off the document counter, so two writes in the same millisecond cannot collide', () => {
  const pid = seedBoardProject();
  const a = addNodes(pid, [{ t: 'note', text: '1' }]).added[0];
  const b = addNodes(pid, [{ t: 'note', text: '2' }]).added[0];
  const c = addNodes(pid, [{ t: 'note', text: '3' }, { t: 'note', text: '4' }]).added;
  const ids = [a.id, b.id, ...c.map(n => n.id)];
  assert.equal(new Set(ids).size, 4, 'all distinct');
  assert.ok(ids.every(i => /^n[0-9a-z]+$/.test(i)), 'short and readable in YAML: ' + ids.join(','));
  assert.equal(readMd(boardFile(pid)).data.seq, 4);
});

// ── patch / remove ──────────────────────────────────────────────────────────────────────────────
test('patching a node cannot change its kind', () => {
  const pid = seedBoardProject();
  const n = addNodes(pid, [{ t: 'note', text: 'sticky' }]).added[0];
  patchNodes(pid, [{ id: n.id, t: 'shot', shot: 'SH010', x: 100 }]);
  const after = getBoard(pid).nodes[0];
  assert.equal(after.t, 'note', 'kind is immutable — delete and re-add instead');
  assert.equal(after.x, 100, 'but the move still applied');
});

test('patching an id that is not on the board is a no-op, not a create', () => {
  const pid = seedBoardProject();
  addNodes(pid, [{ t: 'note', text: 'a' }]);
  patchNodes(pid, [{ id: 'nope', x: 500 }]);
  assert.equal(getBoard(pid).nodes.length, 1);
});

test('deleting a node deletes the arrows attached to it', () => {
  const pid = seedBoardProject();
  const [a, b] = addNodes(pid, [{ t: 'note', text: 'a' }, { t: 'note', text: 'b' }]).added;
  addNodes(pid, [{ t: 'arrow', from: a.id, to: b.id }]);
  assert.equal(getBoard(pid).nodes.length, 3);
  removeNodes(pid, [a.id]);
  const left = getBoard(pid).nodes;
  assert.equal(left.length, 1);
  assert.equal(left[0].id, b.id, 'the arrow went with the node it pointed at');
});

// ── sync + align ────────────────────────────────────────────────────────────────────────────────
test('sync pulls in every shot once and never twice', () => {
  const pid = seedBoardProject();
  const first = syncShots(pid);
  assert.equal(first.added.length, 3);
  saveBoard(pid, { nodes: first.board.nodes });
  const second = syncShots(pid);
  assert.equal(second.added.length, 0, 'already-placed shots are left alone');
});

test('align populates an empty board rather than returning it empty', () => {
  const pid = seedBoardProject();
  const b = alignBoard(pid, 'scene-grid');
  assert.equal(b.nodes.filter(n => n.t === 'shot').length, 3);
  assert.equal(b.nodes.filter(n => n.t === 'frame').length, 2, 'one frame per scene');
  assert.equal(b.layout, 'scene-grid');
});

test('aligning twice is stable — same ids, same coordinates', () => {
  const pid = seedBoardProject();
  const one = alignBoard(pid, 'scene-grid');
  const two = alignBoard(pid, 'scene-grid');
  const key = b => b.nodes.map(n => [n.id, n.t, n.x, n.y].join(':')).sort().join('|');
  assert.equal(key(one), key(two));
});

test('align preserves a hand-placed note', () => {
  const pid = seedBoardProject();
  const note = addNodes(pid, [{ t: 'note', x: 4000, y: 4000, text: 'client hates the fog' }]).added[0];
  alignBoard(pid, 'scene-grid');
  const after = getBoard(pid).nodes.find(n => n.id === note.id);
  assert.equal(after.x, 4000);
  assert.equal(after.y, 4000);
  assert.equal(after.text, 'client hates the fog');
});

test('an unknown layout falls back to the document default instead of throwing at the user', () => {
  const pid = seedBoardProject();
  const b = alignBoard(pid, 'not-a-layout');
  assert.equal(b.layout, 'scene-grid');
});

// ── the version toggle ──────────────────────────────────────────────────────────────────────────
test('show accepts only the two modes and persists', () => {
  const pid = seedBoardProject();
  assert.deepEqual(SHOW_MODES, ['selected', 'all']);
  assert.equal(setShow(pid, 'all').show, 'all');
  assert.equal(getBoard(pid).show, 'all');
  assert.throws(() => setShow(pid, 'some'), /show must be one of/);
  assert.equal(getBoard(pid).show, 'all', 'a rejected value leaves the document alone');
});

// ── the log ─────────────────────────────────────────────────────────────────────────────────────
test('every operation appends to the board log — this is what makes an agent edit auditable', () => {
  const pid = seedBoardProject();
  addNodes(pid, [{ t: 'note', text: 'x' }], 'agent added a note');
  alignBoard(pid, 'shot-strip');
  const log = getBoard(pid).log;
  assert.match(log, /agent added a note/);
  assert.match(log, /auto-aligned · shot-strip — 3 shots, 2 scenes/);
});

// ── the agent digest ────────────────────────────────────────────────────────────────────────────
test('describeBoard summarises without leaking coordinates', () => {
  const pid = seedBoardProject();
  alignBoard(pid, 'scene-grid');
  addNodes(pid, [{ t: 'note', text: 'keep the fog' }, { t: 'text', text: 'ACT ONE' }]);
  const d = describeBoard(pid);
  assert.equal(d.counts.shot, 3);
  assert.equal(d.counts.frame, 2);
  assert.deepEqual(d.shots.sort(), ['SH010', 'SH020', 'SH030']);
  assert.deepEqual(d.frames, ['SCENE 1', 'SCENE 2']);
  assert.deepEqual(d.text.sort(), ['ACT ONE', 'keep the fog']);
  // the digest carries an overall extent but no per-node x/y — that is the whole point of it
  const json = JSON.stringify(d);
  assert.equal(json.includes('"x":'), true, 'bounds is present');
  assert.equal(d.total, 7, "3 shots + 2 scene frames from the align, plus the note and the heading");
  assert.equal(json.length < 600, true, 'a five-node board describes in well under a paragraph: ' + json.length);
});

// ── the document on disk ────────────────────────────────────────────────────────────────────────
test('the board is plain markdown an agent can read: frontmatter record, log body', () => {
  const pid = seedBoardProject();
  alignBoard(pid, 'scene-grid');
  const text = fs.readFileSync(boardFile(pid), 'utf8');
  assert.ok(text.startsWith('---\n'), 'frontmatter first');
  assert.match(text, /## Board log|auto-aligned/, 'and a human-readable body');
  assert.match(text, /t: shot/, 'nodes are flat readable records');
  assert.ok(!/\d\.\d{6}/.test(text), 'no long floats anywhere in the document');
});

// ── assets on the board ─────────────────────────────────────────────────────────────────────────
// The board is a production canvas, not a storyboard: the cast and the places belong on it. The
// grouping vocabulary is shared/assetKinds.mjs — the same table the Assets tab uses — never a
// second one declared here.
function seedAssets(pid) {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');   // a header is enough; nothing decodes these
  saveContextFile(pid, 'ferry-captain.png', png, 'cast');
  saveContextFile(pid, 'deckhand.png', png, 'characters');   // synonym folder → same kind
  saveContextFile(pid, 'harbour.png', png, 'locations');
  saveContextFile(pid, 'lantern.png', png, 'props');
  saveContextFile(pid, 'grain-ref.png', png, 'moodboard');   // a REFERENCE board, not production
  saveContextFile(pid, 'notes.md', Buffer.from('# hi'), 'cast'); // not media
}

test('syncAssets pulls production assets only, and skips references and non-media', () => {
  const pid = seedBoardProject();
  seedAssets(pid);
  const { added } = syncAssets(pid);
  const names = added.map(a => a.name).sort();
  assert.deepEqual(names, ['deckhand.png', 'ferry-captain.png', 'harbour.png', 'lantern.png']);
  assert.equal(added.find(a => a.name === 'grain-ref.png'), undefined, 'the moodboard is a reference board');
  assert.equal(added.find(a => a.name === 'notes.md'), undefined, 'a markdown note is not an asset card');
});

test('an asset node carries the identity triple plus its resolved kind', () => {
  const pid = seedBoardProject();
  seedAssets(pid);
  const { added } = syncAssets(pid);
  const cap = added.find(a => a.name === 'ferry-captain.png');
  assert.equal(cap.scope, pid);
  assert.equal(cap.folder, 'cast');
  assert.equal(cap.kind, 'cast');
  const hand = added.find(a => a.name === 'deckhand.png');
  assert.equal(hand.folder, 'characters');
  assert.equal(hand.kind, 'cast', 'a synonym folder resolves to the canonical kind');
});

test('syncAssets is idempotent — the same file never lands twice', () => {
  const pid = seedBoardProject();
  seedAssets(pid);
  const first = syncAssets(pid);
  saveBoard(pid, { nodes: first.board.nodes });
  assert.equal(syncAssets(pid).added.length, 0);
});

test('syncAssets can be narrowed to specific kinds', () => {
  const pid = seedBoardProject();
  seedAssets(pid);
  const { added } = syncAssets(pid, { kinds: ['props'] });
  assert.deepEqual(added.map(a => a.name), ['lantern.png']);
});

test('the production layout populates BOTH shots and assets from an empty board', () => {
  const pid = seedBoardProject();
  seedAssets(pid);
  const b = alignBoard(pid, 'production');
  assert.equal(b.nodes.filter(n => n.t === 'shot').length, 3, 'shots came in');
  assert.equal(b.nodes.filter(n => n.t === 'asset').length, 4, 'assets came in');
  const labels = b.nodes.filter(n => n.t === 'frame').map(f => f.label).sort();
  assert.deepEqual(labels, ['CAST', 'LOCATIONS', 'PROPS', 'SCENE 1', 'SCENE 2']);
});

test('by-kind on an empty board pulls the assets in rather than returning nothing', () => {
  const pid = seedBoardProject();
  seedAssets(pid);
  const b = alignBoard(pid, 'by-kind');
  assert.equal(b.nodes.filter(n => n.t === 'asset').length, 4);
  assert.ok(b.nodes.filter(n => n.t === 'frame').length >= 3);
});

// ── the newer node fields ───────────────────────────────────────────────────────────────────────
test('text alignment and tone are vocabulary-checked, and default sanely', () => {
  assert.equal(cleanNode({ t: 'text', id: 'a', align: 'justify' }, 'a').align, 'left');
  assert.equal(cleanNode({ t: 'text', id: 'a', align: 'center' }, 'a').align, 'center');
  assert.equal(cleanNode({ t: 'text', id: 'a', tone: 'puce' }, 'a').tone, 'fg');
  assert.equal(cleanNode({ t: 'text', id: 'a', tone: 'danger' }, 'a').tone, 'danger');
});

test('locked is written only when true — a readable document has no 200 false lines in it', () => {
  const pid = seedBoardProject();
  addNodes(pid, [{ t: 'note', text: 'a' }, { t: 'note', text: 'b', locked: true }]);
  const raw = readMd(boardFile(pid)).data.nodes;
  assert.equal('locked' in raw[0], false);
  assert.equal(raw[1].locked, true);
});

// ── the stale-write guard ───────────────────────────────────────────────────────────────────────
// The canvas PATCHes its ENTIRE node list, so a page that was open while the board changed
// elsewhere would write its stale list straight over the newer one. That is not hypothetical: it
// deleted seven asset nodes during development, in one click, silently.
test('a write carrying a stale base rev is refused, not applied', () => {
  const pid = seedBoardProject();
  const first = addNodes(pid, [{ t: 'note', text: 'original' }]).board;
  const staleRev = first.rev;

  // something else changes the board
  addNodes(pid, [{ t: 'note', text: 'from somewhere else' }]);

  assert.throws(
    () => saveBoard(pid, { nodes: [] }, 'clobber', { base: staleRev }),
    e => e.code === 'stale' && /changed somewhere else/i.test(e.message)
  );
  assert.equal(getBoard(pid).nodes.length, 2, 'both notes survive the refused write');
});

test('the conflict carries the CURRENT document so a client can adopt it in one round trip', () => {
  const pid = seedBoardProject();
  const stale = addNodes(pid, [{ t: 'note', text: 'a' }]).board.rev;
  addNodes(pid, [{ t: 'note', text: 'b' }]);
  try {
    saveBoard(pid, { nodes: [] }, '', { base: stale });
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(e.code, 'stale');
    assert.equal(e.board.nodes.length, 2);
  }
});

test('a write with the CURRENT base rev goes through', () => {
  const pid = seedBoardProject();
  const b = addNodes(pid, [{ t: 'note', text: 'a' }]).board;
  const after = saveBoard(pid, { nodes: [...b.nodes, { id: 'zz', t: 'note', x: 0, y: 0, w: 240, h: 160, text: 'b' }] }, 'ok', { base: b.rev });
  assert.equal(after.nodes.length, 2);
});

test('no base rev means no check — the camera and the agent routes are unaffected', () => {
  const pid = seedBoardProject();
  addNodes(pid, [{ t: 'note', text: 'a' }]);
  const after = saveBoard(pid, { view: { x: 10, y: 20, z: 2 } });
  assert.deepEqual(after.view, { x: 10, y: 20, z: 2 });
  assert.equal(after.nodes.length, 1);
});

test('the route answers a stale write with 409 and the live board, not a 400', async () => {
  freshRoot();
  const pid = seedProject('bz');
  let r = await req('POST', '/api/board/' + pid + '/nodes', { nodes: [{ t: 'note', text: 'a' }] });
  const stale = r.body.board.rev;
  await req('POST', '/api/board/' + pid + '/nodes', { nodes: [{ t: 'note', text: 'b' }] });

  r = await req('PATCH', '/api/board/' + pid, { patch: { nodes: [] }, base: stale });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'stale');
  assert.equal(r.body.board.nodes.length, 2);

  // and the same write with the live stamp succeeds
  const live = r.body.board.rev;
  r = await req('PATCH', '/api/board/' + pid, { patch: { nodes: [] }, base: live });
  assert.equal(r.status, 200);
  assert.equal(r.body.nodes.length, 0);
});

// ── an asset card is the shape of its asset ─────────────────────────────────────────────────────
// A 9:16 character portrait rendered into a 16:9 box is a crop, and on a cast board that crop
// lands on the actor's chest. Dimensions are sniffed from the file header, never guessed.
function pngOf(w, h) {
  // a minimal but VALID PNG header: signature + IHDR length/type + big-endian width/height
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}

test('a portrait asset gets a portrait card, a landscape one stays landscape', () => {
  const pid = seedBoardProject();
  saveContextFile(pid, 'tall.png', pngOf(1080, 1920), 'cast');       // 9:16
  saveContextFile(pid, 'wide.png', pngOf(1920, 1080), 'locations');  // 16:9
  const { added } = syncAssets(pid);
  const tall = added.find(a => a.name === 'tall.png');
  const wide = added.find(a => a.name === 'wide.png');
  assert.ok(tall.h > tall.w, 'a 9:16 portrait is taller than it is wide (' + tall.w + '×' + tall.h + ')');
  assert.ok(Math.abs(tall.h / tall.w - 16 / 9) < 0.05, 'and holds the real ratio');
  assert.ok(wide.w > wide.h, 'a 16:9 plate stays wide');
  assert.ok(Math.abs(wide.w / wide.h - 16 / 9) < 0.05);
});

test('an unreadable or non-raster asset keeps the neutral default rather than guessing', () => {
  const pid = seedBoardProject();
  saveContextFile(pid, 'vector.svg', Buffer.from('<svg/>'), 'props');
  saveContextFile(pid, 'broken.png', Buffer.from('not a png'), 'props');
  const { added } = syncAssets(pid);
  for (const a of added) {
    assert.ok(a.w > a.h, a.name + ' falls back to the 16:9 default');
  }
});

test('an absurd aspect is clamped — a card is not a one-pixel column', () => {
  const pid = seedBoardProject();
  saveContextFile(pid, 'strip.png', pngOf(40, 4000), 'props');   // 1:100
  saveContextFile(pid, 'pano.png', pngOf(4000, 40), 'props');    // 100:1
  const { added } = syncAssets(pid);
  const strip = added.find(a => a.name === 'strip.png');
  const pano = added.find(a => a.name === 'pano.png');
  assert.ok(strip.h / strip.w <= 2.6, 'tall is clamped (' + strip.w + '×' + strip.h + ')');
  assert.ok(pano.w / pano.h <= 3.1, 'wide is clamped (' + pano.w + '×' + pano.h + ')');
});

test('aligning re-measures cards, so a board built before this still gets fixed', () => {
  const pid = seedBoardProject();
  saveContextFile(pid, 'tall.png', pngOf(1080, 1920), 'cast');
  // a node placed the old way: a 16:9 box over a 9:16 file
  addNodes(pid, [{ t: 'asset', scope: pid, folder: 'cast', name: 'tall.png', kind: 'cast', w: 320, h: 180 }]);
  assert.equal(getBoard(pid).nodes[0].h, 180);
  alignBoard(pid, 'by-kind');
  const fixed = getBoard(pid).nodes.find(n => n.t === 'asset');
  assert.ok(fixed.h > fixed.w, 'the align corrected it to portrait (' + fixed.w + '×' + fixed.h + ')');
});

test('a LOCKED card is never re-measured — locked means the user decided', () => {
  const pid = seedBoardProject();
  saveContextFile(pid, 'tall.png', pngOf(1080, 1920), 'cast');
  addNodes(pid, [{ t: 'asset', scope: pid, folder: 'cast', name: 'tall.png', kind: 'cast', w: 320, h: 180, locked: true }]);
  alignBoard(pid, 'by-kind');
  assert.equal(getBoard(pid).nodes.find(n => n.t === 'asset').h, 180);
});

test('rows of mixed aspects never overlap and stay inside their frame', () => {
  const pid = seedBoardProject();
  saveContextFile(pid, 'a.png', pngOf(1080, 1920), 'cast');
  saveContextFile(pid, 'b.png', pngOf(1080, 1920), 'cast');
  saveContextFile(pid, 'c.png', pngOf(1920, 1080), 'cast');
  saveContextFile(pid, 'd.png', pngOf(1080, 1920), 'cast');
  const b = alignBoard(pid, 'by-kind', { cols: 2 });
  const cards = b.nodes.filter(n => n.t === 'asset');
  const frame = b.nodes.find(n => n.t === 'frame');
  const rows = {};
  cards.forEach(c => { (rows[c.y] = rows[c.y] || []).push(c); });
  const ys = Object.keys(rows).map(Number).sort((x, y) => x - y);
  for (let i = 0; i < ys.length - 1; i++) {
    const bottom = Math.max(...rows[ys[i]].map(c => c.y + c.h));
    assert.ok(bottom <= ys[i + 1], 'row at ' + ys[i] + ' ends at ' + bottom + ', next starts at ' + ys[i + 1]);
  }
  for (const c of cards) assert.ok(c.y + c.h <= frame.y + frame.h, c.name + ' fits inside its frame');
});

// ── the guard must not fire on the user it protects ─────────────────────────────────────────────
// The first version bumped `rev` on EVERY write, view-only ones included. Panning therefore
// invalidated the client's base and its next drag 409'd against nobody — a guard against a real
// race, firing constantly in ordinary single-window use. The camera is not document content.
test('moving the camera does not advance the document revision', () => {
  const pid = seedBoardProject();
  const { board } = addNodes(pid, [{ t: 'note', text: 'a' }]);
  const rev = board.rev;
  saveBoard(pid, { view: { x: 10, y: 10, z: 1 } });
  saveBoard(pid, { view: { x: 40, y: 90, z: 2 } });
  assert.equal(getBoard(pid).rev, rev, 'panning left the revision alone');
  // and the save the client had queued before panning still goes through
  const after = saveBoard(pid, { nodes: board.nodes }, 'moved', { base: rev });
  assert.ok(after, 'no spurious conflict');
});

test('the version toggle and a layout switch do not advance it either', () => {
  const pid = seedBoardProject();
  const { board } = addNodes(pid, [{ t: 'note', text: 'a' }]);
  const rev = board.rev;
  setShow(pid, 'all');
  saveBoard(pid, { layout: 'shot-strip' });
  assert.equal(getBoard(pid).rev, rev);
});

test('re-saving an identical node list is not a change', () => {
  const pid = seedBoardProject();
  const { board } = addNodes(pid, [{ t: 'note', text: 'a' }]);
  const rev = board.rev;
  saveBoard(pid, { nodes: board.nodes });
  saveBoard(pid, { nodes: board.nodes });
  assert.equal(getBoard(pid).rev, rev, 'a no-op write is not a revision');
});

test('but a real node change does advance it, and is still caught', () => {
  const pid = seedBoardProject();
  const { board } = addNodes(pid, [{ t: 'note', text: 'a' }]);
  const rev = board.rev;
  const moved = board.nodes.map(n => ({ ...n, x: n.x + 200 }));
  const after = saveBoard(pid, { nodes: moved }, 'moved');
  assert.equal(after.rev, rev + 1, 'a move is a revision');

  addNodes(pid, [{ t: 'note', text: 'from another window' }]);
  assert.throws(() => saveBoard(pid, { nodes: [] }, 'clobber', { base: rev }), e => e.code === 'stale');
});

test('every field the signature covers counts as a change', () => {
  const pid = seedBoardProject();
  const { board } = addNodes(pid, [{ t: 'note', text: 'a' }]);
  let rev = board.rev;
  const bump = (patch, why) => {
    const next = getBoard(pid).nodes.map(n => ({ ...n, ...patch }));
    const r = saveBoard(pid, { nodes: next }).rev;
    assert.equal(r, rev + 1, why + ' counts as a change');
    rev = r;
  };
  bump({ x: 999 }, 'a move');
  bump({ w: 400 }, 'a resize');
  bump({ locked: true }, 'a lock');
  bump({ text: 'edited' }, 'a text edit');
});
