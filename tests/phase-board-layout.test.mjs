// The Board's auto-align engine (frontend/boardLayout.js) — the pure half of the feature.
//
// Five invariants, tested directly rather than through the canvas:
//   1. a re-align REUSES node ids. Selection, focus and the undo entry all key off them, so an
//      align that minted fresh ids would read to every other surface as delete-and-recreate.
//   2. a layout passes through everything it does not own, byte-identical. "By scene" must not
//      touch the note you dragged next to a shot.
//   3. scene order is `scene` then `no` — the canonical order backend/story.mjs already sorts on.
//      A layout that invented its own sequence would disagree with the shot list and the reel.
//   4. shots with no scene do not vanish. They collect in scene 0 (UNASSIGNED) — silently hiding
//      pre-scene work is the failure mode this guards.
//   5. rows reserve room for the takes filmstrip in BOTH show modes, so flipping the version
//      toggle never reflows the board or overlaps a neighbouring row.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sceneGrid, shotStrip, byKind, tidy, applyLayout, LAYOUT_IDS, LAYOUTS,
  bounds, fitView, snap, GRID, CARD, cardH, ROW_GAP, STRIP_H, GAP,
  orderShots, groupByScene, sceneOf, blankNode, arrowGeom, anchor, clampZoom,
  toBoard, toScreen, isRect, isAutoFrame, isUserFrame,
  production, alignNodes, distributeNodes, snapGuides, ALIGN_EDGES, SNAP_TOL
} from '../frontend/boardLayout.js';
import { assetKindOf, ASSET_KIND_FOLDERS, folderKind } from '../shared/assetKinds.mjs';

// deterministic id minter — the module takes one by injection precisely so tests need no stubbing
const minter = () => { let i = 0; return () => 'x' + (++i); };
const shot = (id, no, scene) => ({ id, no, scene, title: id });

const SHOTS = [
  shot('SH010', 1, 1), shot('SH020', 2, 1), shot('SH030', 3, 2),
  shot('SH040', 4, 2), shot('SH050', 5, 2)
];

// ── ordering ────────────────────────────────────────────────────────────────────────────────────
test('shots order by scene then no, never by id', () => {
  const jumbled = [shot('SH050', 5, 2), shot('SH010', 1, 1), shot('SH030', 3, 2), shot('SH020', 2, 1)];
  assert.deepEqual(orderShots(jumbled).map(s => s.id), ['SH010', 'SH020', 'SH030', 'SH050']);
});

test('a shot with no scene lands in scene 0, not in the bin', () => {
  assert.equal(sceneOf({ scene: undefined }), 0);
  assert.equal(sceneOf({ scene: 0 }), 0);
  assert.equal(sceneOf({ scene: '3' }), 3);
  const groups = groupByScene([shot('A', 1), shot('B', 2, 1)]);
  assert.deepEqual(groups.map(([k]) => k), [0, 1]);
  assert.equal(groups[0][1].length, 1);
});

// ── scene grid ──────────────────────────────────────────────────────────────────────────────────
test('sceneGrid makes one titled frame per scene and lays its shots in reading order', () => {
  const out = sceneGrid([], SHOTS, { mkId: minter() });
  const frames = out.filter(n => n.t === 'frame');
  assert.equal(frames.length, 2);
  assert.deepEqual(frames.map(f => f.label), ['SCENE 1', 'SCENE 2']);
  // scene 2 sits strictly below scene 1 — scenes stack, they do not overlap
  assert.ok(frames[1].y >= frames[0].y + frames[0].h);

  const cards = out.filter(n => n.t === 'shot');
  assert.equal(cards.length, 5);
  const s1 = cards.filter(c => ['SH010', 'SH020'].includes(c.shot));
  assert.ok(s1[0].x < s1[1].x, 'shots within a scene run left to right');
  assert.equal(s1[0].y, s1[1].y, 'and share a row');
});

test('re-aligning REUSES ids — an align is a move, not a delete-and-recreate', () => {
  const first = sceneGrid([], SHOTS, { mkId: minter() });
  const ids = Object.fromEntries(first.filter(n => n.t === 'shot').map(n => [n.shot, n.id]));
  // move everything by hand, then align again
  const moved = first.map(n => ({ ...n, x: n.x + 999, y: n.y + 999 }));
  const second = sceneGrid(moved, SHOTS, { mkId: minter() });
  for (const n of second.filter(n => n.t === 'shot')) assert.equal(n.id, ids[n.shot], n.shot + ' kept its id');
  for (const n of second.filter(n => n.t === 'frame')) assert.ok(/^SCENE/.test(n.label));
  // and the second align genuinely repositioned rather than leaving the hand-moved coordinates
  assert.notDeepEqual(second.find(n => n.t === 'shot').x, moved.find(n => n.t === 'shot').x);
});

test('a layout passes through what it does not own, untouched', () => {
  const note = { id: 'keepme', t: 'note', x: 4321, y: 8765, w: 240, h: 160, text: 'do not move me' };
  const text = { id: 'keeptxt', t: 'text', x: -50, y: -50, w: 360, h: 56, text: 'ACT ONE', size: 'xl' };
  const out = sceneGrid([note, text], SHOTS, { mkId: minter() });
  assert.deepEqual(out.find(n => n.id === 'keepme'), note);
  assert.deepEqual(out.find(n => n.id === 'keeptxt'), text);
});

test('a shot node whose shot no longer exists is dropped, not left as a dead link', () => {
  const stale = { id: 'ghost', t: 'shot', shot: 'SH999', x: 0, y: 0, w: CARD.w, h: cardH() };
  const out = sceneGrid([stale], SHOTS, { mkId: minter() });
  assert.equal(out.find(n => n.id === 'ghost'), undefined);
  assert.equal(out.filter(n => n.t === 'shot').length, 5);
});

test('rows reserve the filmstrip gap in BOTH modes, so the version toggle never reflows', () => {
  // 5 shots at 2 columns → scene 2 wraps onto a second row
  const out = sceneGrid([], SHOTS, { cols: 2, mkId: minter() });
  const s2 = out.filter(n => n.t === 'shot' && ['SH030', 'SH040', 'SH050'].includes(n.shot))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const rowGap = s2[2].y - s2[0].y;
  assert.equal(rowGap, cardH() + ROW_GAP, 'row pitch leaves room for the strip');
  assert.ok(rowGap - cardH() >= STRIP_H, 'the strip fits between rows without overlapping');
});

test('every coordinate a layout writes lands on the grid', () => {
  for (const n of sceneGrid([], SHOTS, { mkId: minter() })) {
    if (!isRect(n)) continue;
    assert.equal(n.x % GRID, 0, n.id + ' x');
    assert.equal(n.y % GRID, 0, n.id + ' y');
  }
});

// ── the other layouts ───────────────────────────────────────────────────────────────────────────
test('shotStrip puts every shot on one row in reading order', () => {
  const out = shotStrip([], SHOTS, { mkId: minter() }).filter(n => n.t === 'shot');
  assert.equal(new Set(out.map(n => n.y)).size, 1, 'one row');
  const xs = out.map(n => n.x);
  assert.deepEqual(xs, [...xs].sort((a, b) => a - b), 'left to right');
  assert.equal(out[0].shot, 'SH010');
});

test('shotStrip wraps when asked', () => {
  const out = shotStrip([], SHOTS, { wrap: 2, mkId: minter() }).filter(n => n.t === 'shot');
  assert.equal(new Set(out.map(n => n.y)).size, 3, '5 shots at 2 per row → 3 rows');
});

test('byKind clusters assets under a frame per kind and reads the kind from the caller', () => {
  const assets = [
    { id: 'a1', t: 'asset', x: 0, y: 0, w: 320, h: 180, scope: 'p', name: 'a.png', kind: 'cast' },
    { id: 'a2', t: 'asset', x: 0, y: 0, w: 320, h: 180, scope: 'p', name: 'b.png', kind: 'props' },
    { id: 'a3', t: 'asset', x: 0, y: 0, w: 320, h: 180, scope: 'p', name: 'c.png', kind: 'cast' }
  ];
  const out = byKind(assets, { mkId: minter() });
  const labels = out.filter(n => n.t === 'frame').map(f => f.label);
  assert.deepEqual(labels, ['CAST', 'PROPS']);
  const cast = out.filter(n => n.t === 'asset' && n.kind === 'cast');
  assert.equal(cast[0].y, cast[1].y, 'same-kind assets share a row');
});

test('tidy keeps the arrangement it was given — it never regroups or reorders', () => {
  const nodes = [
    { id: 'b', t: 'note', x: 500, y: 3, w: 200, h: 100 },
    { id: 'a', t: 'note', x: 7, y: 11, w: 200, h: 100 },
    { id: 'c', t: 'note', x: 12, y: 400, w: 200, h: 100 }
  ];
  const out = tidy(nodes, { cols: 2 });
  const order = out.slice().sort((p, q) => p.y - q.y || p.x - q.x).map(n => n.id);
  assert.deepEqual(order, ['a', 'b', 'c'], 'reading order survives');
  for (const n of out) { assert.equal(n.x % GRID, 0); assert.equal(n.y % GRID, 0); }
});

test('tidy leaves frames alone — a frame is a deliberate container', () => {
  const frame = { id: 'f', t: 'frame', x: 33, y: 77, w: 800, h: 520, label: 'HAND DRAWN' };
  const out = tidy([frame, { id: 'n', t: 'note', x: 5, y: 5, w: 200, h: 100 }]);
  assert.deepEqual(out.find(n => n.id === 'f'), frame);
});

// ── frame ownership ─────────────────────────────────────────────────────────────────────────────
// A frame carrying `scene` or `kind` was minted by a layout; one carrying neither was drawn by the
// user. Getting this wrong is how By-scene → Shot-strip used to leave two empty labelled boxes
// floating behind a single row of cards.
test('a layout drops the auto-frames it no longer needs but never the user\'s own', () => {
  const mine = { id: 'user', t: 'frame', x: 0, y: 0, w: 400, h: 300, label: 'MY GROUP' };
  const grid = sceneGrid([mine], SHOTS, { mkId: minter() });
  assert.deepEqual(grid.filter(n => n.t === 'frame').map(f => f.label), ['SCENE 1', 'SCENE 2', 'MY GROUP']);

  const strip = shotStrip(grid, SHOTS, { mkId: minter() });
  assert.deepEqual(strip.filter(n => n.t === 'frame').map(f => f.label), ['MY GROUP'],
    'a flat strip has no groups, so the scene frames go — but the hand-drawn one stays');
  assert.deepEqual(strip.find(n => n.id === 'user'), mine, 'and stays byte-identical');
});

test('by-kind clears scene frames, and scene-grid clears kind frames', () => {
  const grid = sceneGrid([], SHOTS, { mkId: minter() });
  const kinded = byKind([...grid, { id: 'a1', t: 'asset', x: 0, y: 0, w: 320, h: 180, scope: 'p', name: 'a.png', kind: 'cast' }], { mkId: minter() });
  assert.deepEqual(kinded.filter(n => n.t === 'frame').map(f => f.label), ['CAST'],
    'the scene frames are not this layout\'s groups');
  const back = sceneGrid(kinded, SHOTS, { mkId: minter() });
  assert.deepEqual(back.filter(n => n.t === 'frame').map(f => f.label), ['SCENE 1', 'SCENE 2'],
    'and the kind frame does not survive the trip back');
});

test('tidy drops auto-frames too — it cannot honour groups it does not lay out', () => {
  const grid = sceneGrid([], SHOTS, { mkId: minter() });
  const out = tidy(grid, { cols: 3 });
  assert.equal(out.filter(isAutoFrame).length, 0);
});

test('isAutoFrame / isUserFrame split cleanly', () => {
  assert.equal(isAutoFrame({ t: 'frame', scene: 1 }), true);
  assert.equal(isAutoFrame({ t: 'frame', kind: 'cast' }), true);
  assert.equal(isAutoFrame({ t: 'frame', label: 'X' }), false);
  assert.equal(isUserFrame({ t: 'frame', label: 'X' }), true);
  assert.equal(isUserFrame({ t: 'frame', scene: 2 }), false);
  assert.equal(isAutoFrame({ t: 'note' }), false);
});

// ── the dispatcher ──────────────────────────────────────────────────────────────────────────────
test('applyLayout dispatches every declared layout and rejects anything else', () => {
  for (const id of LAYOUT_IDS) {
    assert.ok(Array.isArray(applyLayout(id, [], SHOTS, { mkId: minter() })), id);
  }
  assert.throws(() => applyLayout('nope', [], SHOTS), /unknown layout/);
});

test('the LAYOUTS registry and LAYOUT_IDS cannot drift', () => {
  assert.deepEqual(LAYOUT_IDS, LAYOUTS.map(l => l.id));
  for (const l of LAYOUTS) { assert.ok(l.label, l.id + ' has a label'); assert.ok(l.hint, l.id + ' has a hint'); }
});

// ── viewport maths ──────────────────────────────────────────────────────────────────────────────
test('bounds ignores arrows — they have no rect of their own', () => {
  const b = bounds([
    { id: 'a', t: 'note', x: 0, y: 0, w: 100, h: 100 },
    { id: 'r', t: 'arrow', from: 'a', to: 'a', x: 99999, y: 99999 }
  ]);
  assert.deepEqual(b, { x: 0, y: 0, w: 100, h: 100 });
});

test('bounds of nothing is zero, and fitView on nothing is the identity camera', () => {
  assert.deepEqual(bounds([]), { x: 0, y: 0, w: 0, h: 0 });
  assert.deepEqual(fitView([], 1200, 800), { x: 0, y: 0, z: 1 });
});

test('fit never zooms PAST 1:1 — a one-card board opens as a card, not a macro shot', () => {
  const v = fitView([{ id: 'a', t: 'note', x: 0, y: 0, w: 40, h: 40 }], 1600, 900);
  assert.equal(v.z, 1);
});

test('fit centres the content in the viewport', () => {
  const nodes = [{ id: 'a', t: 'note', x: 0, y: 0, w: 2000, h: 1000 }];
  const v = fitView(nodes, 1200, 800);
  const c = toScreen(1000, 500, v);           // the content's centre
  assert.ok(Math.abs(c.x - 600) < 1 && Math.abs(c.y - 400) < 1);
});

test('screen ↔ board round-trips at any camera', () => {
  for (const v of [{ x: 0, y: 0, z: 1 }, { x: -340, y: 88, z: 0.37 }, { x: 1200, y: -50, z: 2.5 }]) {
    const b = toBoard(410, 260, v);
    const s = toScreen(b.x, b.y, v);
    assert.ok(Math.abs(s.x - 410) < 1e-6 && Math.abs(s.y - 260) < 1e-6, JSON.stringify(v));
  }
});

test('zoom is clamped at both ends', () => {
  assert.equal(clampZoom(0.0001), 0.1);
  assert.equal(clampZoom(99), 3);
  assert.equal(clampZoom(1.5), 1.5);
});

// ── connectors ──────────────────────────────────────────────────────────────────────────────────
test('an arrow anchors to the side of each card that faces the other', () => {
  const a = { id: 'a', t: 'note', x: 0, y: 0, w: 100, h: 100 };
  const b = { id: 'b', t: 'note', x: 400, y: 0, w: 100, h: 100 };
  const g = arrowGeom({ id: 'r', t: 'arrow', from: 'a', to: 'b' }, { a, b });
  assert.equal(g.a.side, 'r', 'leaves a from the right');
  assert.equal(g.b.side, 'l', 'enters b from the left');
  assert.equal(g.a.x, 100);
  assert.equal(g.b.x, 400);
  assert.ok(g.path.startsWith('M 100 50 C'));
});

test('a vertical pair anchors top/bottom, not left/right', () => {
  const a = { id: 'a', t: 'note', x: 0, y: 0, w: 100, h: 100 };
  const b = { id: 'b', t: 'note', x: 0, y: 400, w: 100, h: 100 };
  const g = arrowGeom({ from: 'a', to: 'b' }, { a, b });
  assert.equal(g.a.side, 'b');
  assert.equal(g.b.side, 't');
});

test('an arrow whose target vanished keeps its literal point instead of collapsing to the origin', () => {
  const a = { id: 'a', t: 'note', x: 0, y: 0, w: 100, h: 100 };
  const g = arrowGeom({ from: 'a', to: 'gone', toPt: { x: 900, y: 900 } }, { a });
  assert.deepEqual({ x: g.b.x, y: g.b.y }, { x: 900, y: 900 });
});

test('anchor picks the dominant axis', () => {
  const r = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(anchor(r, { x: 1000, y: 60 }).side, 'r');
  assert.equal(anchor(r, { x: -1000, y: 60 }).side, 'l');
  assert.equal(anchor(r, { x: 60, y: 1000 }).side, 'b');
  assert.equal(anchor(r, { x: 60, y: -1000 }).side, 't');
});

// ── node defaults ───────────────────────────────────────────────────────────────────────────────
test('blankNode gives each kind a usable default box', () => {
  assert.equal(blankNode('shot', {}, () => 'i').h, cardH());
  assert.equal(blankNode('shot', {}, () => 'i').w, CARD.w);
  assert.equal(blankNode('text', {}, () => 'i').size, 'lg');
  assert.equal(blankNode('note', {}, () => 'i').tone, 'accent');
  assert.ok(blankNode('frame', {}, () => 'i').w > CARD.w);
});

test('snap is exact on the lattice and rounds to nearest', () => {
  assert.equal(snap(0), 0);
  assert.equal(snap(GRID), GRID);
  assert.equal(snap(GRID * 1.4), GRID);
  assert.equal(snap(GRID * 1.6), GRID * 2);
  assert.equal(snap(-GRID * 1.6), -GRID * 2);
});

// ── production: the composed layout ─────────────────────────────────────────────────────────────
// Two layouts running at once is the one case where the "a layout owns every auto-frame" rule is
// wrong: each half must leave the other half's groups standing. The first implementation did not,
// and the scene pass silently deleted the asset groups the kind pass had just built.
const ASSETS = [
  { id: 'a1', t: 'asset', x: 0, y: 0, w: 320, h: 180, scope: 'p', name: 'a.png', kind: 'cast' },
  { id: 'a2', t: 'asset', x: 0, y: 0, w: 320, h: 180, scope: 'p', name: 'b.png', kind: 'locations' }
];

test('production keeps BOTH halves — asset groups on top, scenes below', () => {
  const out = production(ASSETS, SHOTS, { mkId: minter() });
  const labels = out.filter(n => n.t === 'frame').map(f => f.label);
  assert.ok(labels.includes('CAST') && labels.includes('LOCATIONS'), 'asset groups survive: ' + labels);
  assert.ok(labels.includes('SCENE 1') && labels.includes('SCENE 2'), 'scene groups too: ' + labels);
  assert.equal(out.filter(n => n.t === 'shot').length, 5);
  assert.equal(out.filter(n => n.t === 'asset').length, 2);
});

test('production stacks the scenes strictly below the assets', () => {
  const out = production(ASSETS, SHOTS, { mkId: minter() });
  const assetBottom = Math.max(...out.filter(n => n.t === 'asset').map(n => n.y + n.h));
  const sceneTop = Math.min(...out.filter(n => n.t === 'frame' && n.scene != null).map(n => n.y));
  assert.ok(sceneTop >= assetBottom, 'scenes start at ' + sceneTop + ', assets end at ' + assetBottom);
});

test('production still respects the user\'s own frames', () => {
  const mine = { id: 'user', t: 'frame', x: -999, y: -999, w: 400, h: 300, label: 'MINE' };
  const out = production([...ASSETS, mine], SHOTS, { mkId: minter() });
  assert.deepEqual(out.find(n => n.id === 'user'), mine);
});

test('a plain layout after production still clears the other half\'s frames', () => {
  const out = production(ASSETS, SHOTS, { mkId: minter() });
  const plain = sceneGrid(out, SHOTS, { mkId: minter() });
  const labels = plain.filter(n => n.t === 'frame').map(f => f.label);
  assert.ok(!labels.includes('CAST'), 'run on its own, scene-grid owns every auto-frame again');
});

// ── align & distribute ──────────────────────────────────────────────────────────────────────────
const BOXES = [
  { id: 'a', t: 'note', x: 0, y: 0, w: 100, h: 100 },
  { id: 'b', t: 'note', x: 50, y: 200, w: 200, h: 60 },
  { id: 'c', t: 'note', x: 400, y: 9, w: 80, h: 40 }
];

test('align pulls every selected node to the same edge', () => {
  assert.deepEqual(alignNodes(BOXES, ['a', 'b', 'c'], 'left').map(n => n.x), [0, 0, 0]);
  assert.deepEqual(alignNodes(BOXES, ['a', 'b', 'c'], 'top').map(n => n.y), [0, 0, 0]);
  // right edges, not left: each node's x is set so x+w lands on the bounding right edge
  const right = alignNodes(BOXES, ['a', 'b', 'c'], 'right');
  assert.deepEqual(right.map(n => n.x + n.w), [480, 480, 480]);
});

test('align touches only the selection, and never a locked node', () => {
  const out = alignNodes(BOXES, ['a', 'b'], 'left');
  assert.equal(out.find(n => n.id === 'c').x, 400, 'unselected node untouched');
  const withLock = [...BOXES.slice(0, 2), { ...BOXES[2], locked: true }];
  const locked = alignNodes(withLock, ['a', 'b', 'c'], 'left');
  assert.equal(locked.find(n => n.id === 'c').x, 400, 'a locked node refuses to be aligned');
});

test('aligning a single node is a no-op — there is nothing to align it to', () => {
  assert.deepEqual(alignNodes(BOXES, ['a'], 'left'), BOXES);
});

test('every declared align edge is implemented', () => {
  for (const e of ALIGN_EDGES) {
    const out = alignNodes(BOXES, ['a', 'b', 'c'], e);
    assert.notDeepEqual(out, BOXES, e + ' moved something');
  }
});

test('distribute equalises the GAPS, not the centres', () => {
  const out = distributeNodes(BOXES, ['a', 'b', 'c'], 'h');
  const sorted = out.slice().sort((p, q) => p.x - q.x);
  const g1 = sorted[1].x - (sorted[0].x + sorted[0].w);
  const g2 = sorted[2].x - (sorted[1].x + sorted[1].w);
  assert.ok(Math.abs(g1 - g2) <= 1, 'gaps ' + g1 + ' and ' + g2 + ' match despite different widths');
  assert.equal(sorted[0].x, 0, 'the outer two do not move');
  assert.equal(sorted[2].x + sorted[2].w, 480);
});

test('distribute needs three nodes — two are already evenly spaced', () => {
  assert.deepEqual(distributeNodes(BOXES, ['a', 'b'], 'h'), BOXES);
});

// ── snap guides ─────────────────────────────────────────────────────────────────────────────────
test('snap returns the correction AND the line to draw', () => {
  const other = { id: 'z', t: 'note', x: 0, y: 0, w: 100, h: 100 };
  const g = snapGuides({ x: 3, y: 0, w: 100, h: 100 }, [other]);
  assert.equal(g.dx, -3, 'nudged back onto the neighbour\'s left edge');
  assert.ok(g.guides.some(l => l.axis === 'x' && l.at === 0));
});

test('snap ignores anything further away than the tolerance', () => {
  const other = { id: 'z', t: 'note', x: 0, y: 0, w: 100, h: 100 };
  const g = snapGuides({ x: SNAP_TOL + 40, y: 500, w: 100, h: 100 }, [other]);
  assert.equal(g.dx, 0);
  assert.equal(g.guides.length, 0);
});

test('snap picks the NEAREST candidate when several are in range', () => {
  const near = { id: 'n', t: 'note', x: 102, y: 0, w: 50, h: 50 };
  const far = { id: 'f', t: 'note', x: 96, y: 0, w: 50, h: 50 };
  const g = snapGuides({ x: 100, y: 0, w: 50, h: 50 }, [near, far]);
  assert.equal(g.dx, 2, 'chose the 2px correction over the 4px one');
});

test('snap edge-to-edge as well as edge-to-same-edge', () => {
  // a card whose LEFT is near another card's RIGHT should butt up against it
  const other = { id: 'z', t: 'note', x: 0, y: 0, w: 100, h: 100 };
  const g = snapGuides({ x: 104, y: 0, w: 60, h: 60 }, [other]);
  assert.equal(g.dx, -4);
});

test('snap ignores arrows — they have no rect to snap to', () => {
  const g = snapGuides({ x: 3, y: 3, w: 100, h: 100 }, [{ id: 'r', t: 'arrow', from: 'a', to: 'b' }]);
  assert.equal(g.guides.length, 0);
});

// ── the asset-kind vocabulary ───────────────────────────────────────────────────────────────────
// It moved to shared/ so backend/board.mjs could group a canvas by cast/location/prop. These guard
// the contract AssetBoards.jsx and the board now both depend on.
test('folder names map to kinds case-insensitively and across synonyms', () => {
  assert.equal(assetKindOf('cast'), 'cast');
  assert.equal(assetKindOf('Characters'), 'cast');
  assert.equal(assetKindOf('ACTORS'), 'cast');
  assert.equal(assetKindOf('locations'), 'locations');
  assert.equal(assetKindOf('Sets'), 'locations');
  assert.equal(assetKindOf('props'), 'props');
  assert.equal(assetKindOf('Wardrobe'), 'wardrobe');
  assert.equal(assetKindOf('moodboard'), '', 'a reference board is not a production kind');
});

test('a per-folder override beats the name, in both directions', () => {
  assert.equal(assetKindOf('cast', { cast: 'reference' }), '', 'demoted to a reference board');
  assert.equal(assetKindOf('vehicles', { vehicles: 'asset' }), 'vehicles', 'promoted under its own name');
});

test('folderKind still splits References from Assets the way AssetBoards expects', () => {
  assert.equal(folderKind('cast'), 'asset');
  assert.equal(folderKind('moodboard'), 'reference');
  assert.equal(folderKind('moodboard', { moodboard: 'asset' }), 'asset');
  assert.equal(ASSET_KIND_FOLDERS.length, 4);
});

// ── the AssetBoards facade is actually wired ────────────────────────────────────────────────────
// `shared/assetKinds.mjs` holds the table; `frontend/AssetBoards.jsx` re-exports it so its existing
// importers keep working. The first version wrote that as a bare `export … from`, which re-exports
// the names WITHOUT binding them in the module's own scope — and AssetBoards calls assetFoldersOf()
// itself, so the Assets tab died at render with "assetFoldersOf is not defined". `npm run build`
// was perfectly happy: a bundler resolves the re-export, and nothing here renders React. These two
// static checks are what stands between that class of bug and a shipped white screen.
import fsx from 'node:fs';
import pathx from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = pathx.join(pathx.dirname(fileURLToPath(import.meta.url)), '..', 'frontend');
const readFrontend = f => fsx.readFileSync(pathx.join(FRONTEND, f), 'utf8');

test('every name AssetBoards uses from shared/assetKinds is imported, not just re-exported', () => {
  const src = readFrontend('AssetBoards.jsx');
  const shared = fsx.readFileSync(pathx.join(FRONTEND, '..', 'shared', 'assetKinds.mjs'), 'utf8');
  const exported = [...shared.matchAll(/export (?:const|function) (\w+)/g)].map(m => m[1]);
  assert.ok(exported.length >= 6, 'found the shared exports: ' + exported.join(','));

  // the LOCAL import statement (an `export … from` line does not bind anything)
  const imp = src.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/shared\/assetKinds\.mjs['"]/);
  assert.ok(imp, 'AssetBoards imports from shared/assetKinds.mjs with a real import statement');
  const bound = imp[1].split(',').map(x => x.trim()).filter(Boolean);

  // strip every import/export statement, then look for bare uses in the body
  const body = src
    .replace(/import[\s\S]*?from\s*['"][^'"]+['"];?/g, '')
    .replace(/export\s*\{[^}]*\};?/g, '');

  for (const name of exported) {
    const used = new RegExp('(?<![\\w.])' + name + '\\s*[(.\\[]').test(body);
    if (used) assert.ok(bound.includes(name), name + ' is used in AssetBoards.jsx but not locally imported');
  }
});

test('every name imported FROM AssetBoards is actually exported by it', () => {
  const src = readFrontend('AssetBoards.jsx');
  const exportedNames = new Set();
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const n of m[1].split(',')) { const t = n.trim().split(/\s+as\s+/).pop(); if (t) exportedNames.add(t); }
  }
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:const|function|class)\s+(\w+)/g)) exportedNames.add(m[1]);

  const consumers = fsx.readdirSync(FRONTEND).filter(f => /\.jsx?$/.test(f) && f !== 'AssetBoards.jsx');
  let checked = 0;
  for (const f of consumers) {
    const text = fsx.readFileSync(pathx.join(FRONTEND, f), 'utf8');
    for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/AssetBoards['"]/g)) {
      for (const raw of m[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        checked++;
        assert.ok(exportedNames.has(name), f + ' imports { ' + name + ' } from ./AssetBoards, which does not export it');
      }
    }
  }
  assert.ok(checked >= 4, 'actually inspected some importers (' + checked + ')');
});
