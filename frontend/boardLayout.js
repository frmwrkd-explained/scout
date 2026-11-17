// The Board's geometry and auto-align engine.
//
// PURE MODULE. No React, no DOM, no fetch. Every function here takes nodes in and hands nodes
// back, which is what makes auto-align unit-testable (tests/phase-board-layout.test.mjs) and what
// lets the agent tool and the UI button call the SAME operation instead of two implementations
// that drift. That rule is lifted straight from the reel: `layDownShots` is an action a human or
// an agent invokes, never a derivation that runs behind your back.
//
// ── WHY AUTO-ALIGN IS AN ACTION, NOT A MODE ────────────────────────────────────────────────────
// A board whose layout is derived cannot hold a deliberate placement. You drag a reference next to
// a shot to say "this one, like this", and the next render throws it away. So the layouts below are
// invoked, they return a new node list, and the result is as editable as anything you placed by
// hand. Undo is the ordinary actions ledger.
//
// ── WHAT A LAYOUT IS ALLOWED TO TOUCH ──────────────────────────────────────────────────────────
// Each layout takes the WHOLE node list and returns the WHOLE node list. It repositions only the
// nodes it owns and passes everything else through byte-identical, ids included. Reusing the id of
// an existing node rather than minting a fresh one is load-bearing: selection, focus and the undo
// entry all key off it, so a re-align must not look like a delete-and-recreate.


// ── the grid ───────────────────────────────────────────────────────────────────────────────────
// One spacing unit, used by snapping, by every layout and by the background dots, so a hand-placed
// card and an auto-aligned one land on the same lattice and the seam is invisible.
export const GRID = 20;

// A shot card is 16:9 at 320 wide plus a caption strip. Not a token in styles.css because it is a
// document coordinate — it lives in board space and does not rescale with the theme.
export const CARD = { w: 320, h: 180 };
export const CAPTION_H = 34;         // title + status line under the picture
export const GAP = 24;               // between cards in a row

// The takes filmstrip that appears under a shot card in `show:'all'`. ROW_GAP reserves room for it
// PERMANENTLY, in both modes, so flipping the version toggle never reflows the board and never
// overlaps a neighbour. Paying ~90px of empty space in `selected` mode is the price of the toggle
// being free; a layout that changed with the mode would move cards you placed by hand.
export const STRIP_H = 62;
export const ROW_GAP = GAP + STRIP_H;

export const snap = v => Math.round(v / GRID) * GRID;

// ── the whiteboard's record cards ──────────────────────────────────────────────────────────────
// Two sizes, both on the lattice, shared by the canvas and the server (backend/scoutBoard.mjs) so
// a card placed by a person, by "Show related" and by an agent come out the same size:
//   plain    a record of words — name, a few properties, the opening line
//   picture  a record whose collection has a picture field — the picture leads, whole
// A card can still be resized by hand afterwards; this is only what it is born as.
//   compact  a record with nothing to say beyond its name and a property or two — no empty box
export const BOARD_CARD = { plain: { w: 300, h: 180 }, picture: { w: 280, h: 340 }, compact: { w: 300, h: 120 } };
export const BOARD_GAP = 40;        // between cards placed as a group — room for an edge label

// Where a batch of same-sized cards goes: a grid of `cols` columns starting at (x, y).
export function gridSlots(count, size, { x = 0, y = 0, cols = null, gap = BOARD_GAP } = {}) {
  const n = Math.max(0, count | 0);
  const c = Math.max(1, cols || Math.ceil(Math.sqrt(n * 1.6)));
  return Array.from({ length: n }, (_, i) => ({
    x: snap(x + (i % c) * (size.w + gap)),
    y: snap(y + Math.floor(i / c) * (size.h + gap)),
  }));
}

// The first free spot for a block of `w` × `h` near (x, y): tries the spot itself, then steps to
// the right and down in block-sized strides until nothing on the board overlaps it. Bounded, so a
// crowded board still gets an answer (the last candidate) instead of a loop.
export function freeSpot(nodes, { x, y, w, h }, gap = BOARD_GAP) {
  const rects = (nodes || []).filter(n => n && n.t !== 'arrow' && n.t !== 'frame');
  const hits = (ax, ay) => rects.some(n => ax < n.x + n.w + gap / 2 && ax + w + gap / 2 > n.x && ay < n.y + n.h + gap / 2 && ay + h + gap / 2 > n.y);
  let best = { x: snap(x), y: snap(y) };
  for (let ring = 0; ring < 14; ring++) {
    for (let step = 0; step <= ring; step++) {
      for (const [cx, cy] of [[x + ring * (w + gap), y + step * (h + gap)], [x + step * (w + gap), y + ring * (h + gap)]]) {
        best = { x: snap(cx), y: snap(cy) };
        if (!hits(best.x, best.y)) return best;
      }
    }
  }
  return best;
}

// ── freehand strokes ───────────────────────────────────────────────────────────────────────────
// A stroke is a `draw` node: a box on the board and, inside it, a string of integer points relative
// to the box's own corner ("0,0 4,7 12,9"). Shared by the canvas (which draws and erases them) and
// the tests; the server only checks the string is made of numbers (backend/scoutBoard.mjs).
export function parsePoints(str) {
  const nums = String(str == null ? '' : str).split(/[\s,]+/).map(Number).filter(Number.isFinite);
  const out = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: nums[i], y: nums[i + 1] });
  return out;
}

// Board-space samples from the pen → a node's geometry. Samples closer together than `step` are
// one point (a slow hand produces hundreds on one spot), the box is the stroke's bounds grown by
// the line's own thickness so nothing is clipped at the edge, and the points are rounded: a
// 14-decimal float per sample is how a readable file stops being one.
const STROKE_MAX = 1200;
export function packStroke(samples, width = 4, step = 2) {
  const src = (samples || []).filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!src.length) return null;
  let kept = [];
  for (let gap = step; ; gap *= 1.5) {
    kept = [src[0]];
    for (let i = 1; i < src.length; i++) {
      const last = kept[kept.length - 1];
      if (Math.hypot(src[i].x - last.x, src[i].y - last.y) >= gap || i === src.length - 1) kept.push(src[i]);
    }
    if (kept.length <= STROKE_MAX) break;
  }
  if (kept.length > 1) {
    const a = kept[kept.length - 2], b = kept[kept.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.5) kept.pop();
  }
  const pad = Math.ceil(width / 2) + 2;
  const x0 = Math.floor(Math.min(...kept.map(p => p.x)) - pad), y0 = Math.floor(Math.min(...kept.map(p => p.y)) - pad);
  const x1 = Math.ceil(Math.max(...kept.map(p => p.x)) + pad), y1 = Math.ceil(Math.max(...kept.map(p => p.y)) + pad);
  const rel = kept.map(p => Math.round(p.x - x0) + ',' + Math.round(p.y - y0));
  if (rel.length === 1) rel.push(rel[0]);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, points: rel.join(' ') };
}

// The SVG path of a stroke: a quadratic through the midpoints, so a hand-drawn line reads as a
// line and not as the polygon the mouse actually reported.
export function strokePath(str) {
  const p = parsePoints(str);
  if (!p.length) return '';
  if (p.length < 3) return 'M ' + p[0].x + ' ' + p[0].y + ' L ' + p[p.length - 1].x + ' ' + p[p.length - 1].y;
  const mid = (a, b) => ((a.x + b.x) / 2) + ' ' + ((a.y + b.y) / 2);
  let d = 'M ' + p[0].x + ' ' + p[0].y + ' L ' + mid(p[0], p[1]);
  for (let i = 1; i < p.length - 1; i++) d += ' Q ' + p[i].x + ' ' + p[i].y + ' ' + mid(p[i], p[i + 1]);
  return d + ' L ' + p[p.length - 1].x + ' ' + p[p.length - 1].y;
}

// Is the board point `pt` on this stroke? The LINE, not its box — a long diagonal owns a large
// rectangle of board it does not touch, and neither a click nor the eraser should land on that.
export function strokeHit(node, pt, tol = 6) {
  const reach = tol + (node.width || 4) / 2;
  if (pt.x < node.x - reach || pt.x > node.x + node.w + reach || pt.y < node.y - reach || pt.y > node.y + node.h + reach) return false;
  const p = node._pts || parsePoints(node.points);
  const x = pt.x - node.x, y = pt.y - node.y;
  for (let i = 0; i + 1 < p.length; i++) {
    const ax = p[i].x, ay = p[i].y, dx = p[i + 1].x - ax, dy = p[i + 1].y - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
    if (Math.hypot(x - (ax + dx * t), y - (ay + dy * t)) <= reach) return true;
  }
  return false;
}

// A shot card's full height, caption included. Kept as a function because `t:'frame'` and the
// asset node use the same helper with different bodies.
export const cardH = () => CARD.h + CAPTION_H;

// ── nodes ──────────────────────────────────────────────────────────────────────────────────────
// The five node kinds, and nothing else. Each one earns its place by being a thing you cannot say
// with another:
//   shot   — a LIVE LINK to a shot record. Renders that shot's selectedCandidate. Never a copy:
//            re-select a take anywhere in the app and the card follows.
//   asset  — a context/library file, addressed by the { scope, folder, name } triple every other
//            surface in this app already uses.
//   text   — a heading. Sizes are named, not numeric, so a board reads as a document.
//   note   — a sticky. Same as text plus a tinted bed; separate kind because the bed is the point.
//   frame  — a titled rectangle that groups. Optionally bound to a scene number, which is what
//            lets sceneGrid refill it instead of stacking a second frame on top.
//   arrow  — a connector between two nodes. Deliberately dumb: see arrowGeom.
export const NODE_KINDS = ['shot', 'asset', 'text', 'note', 'frame', 'arrow'];

export const TEXT_SIZES = { sm: 13, md: 18, lg: 28, xl: 44 };

const DEFAULTS = {
  shot:  { w: CARD.w, h: cardH() },
  asset: { w: CARD.w, h: CARD.h },
  text:  { w: 420, h: 60, size: 'lg', text: '', align: 'left', tone: 'fg' },
  note:  { w: 240, h: 160, text: '', tone: 'accent' },
  frame: { w: 800, h: 520, label: '' },
  arrow: { w: 0, h: 0 }
};

// `mkId` is injected rather than generated here so the module stays pure and the tests are
// deterministic. The Board passes one backed by the document's own `seq` counter.
export function blankNode(t, patch = {}, mkId = () => 'n' + Math.random().toString(36).slice(2, 8)) {
  return { id: mkId(), t, x: 0, y: 0, ...(DEFAULTS[t] || {}), ...patch };
}

// ── rectangles ─────────────────────────────────────────────────────────────────────────────────
// Arrows have no rect of their own — they are defined by their endpoints — so they are skipped by
// every geometry helper. A bounds() that included them would fight with the nodes they connect.
export const isRect = n => n && n.t !== 'arrow';
export const rectOf = n => ({ x: n.x, y: n.y, w: n.w || 0, h: n.h || 0 });

export function bounds(nodes) {
  const rects = (nodes || []).filter(isRect);
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of rects) {
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + (n.w || 0)); y1 = Math.max(y1, n.y + (n.h || 0));
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// The view that puts every node on screen. Zoom is clamped to ZOOM_MAX so a board holding one card
// does not open at 40× — "fit" on a nearly-empty board should read as "here is your card", not as a
// macro shot of its border.
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 3;
export const clampZoom = z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

// `inset` is screen space the content must stay clear of — a floating panel over the canvas
// (`{ left, right, top, bottom }` in px). Without it "fit" centred the cards in the whole canvas
// and the left-hand ones landed underneath the shelf.
export function fitView(nodes, vw, vh, pad = 80, inset = null) {
  const b = bounds(nodes);
  if (!b.w || !b.h) return { x: 0, y: 0, z: 1 };
  const l = (inset && inset.left) || 0, r = (inset && inset.right) || 0, t = (inset && inset.top) || 0, bt = (inset && inset.bottom) || 0;
  const aw = Math.max(120, vw - l - r), ah = Math.max(120, vh - t - bt);
  const z = clampZoom(Math.min((aw - pad * 2) / b.w, (ah - pad * 2) / b.h, 1));
  return { x: l + aw / 2 - (b.x + b.w / 2) * z, y: t + ah / 2 - (b.y + b.h / 2) * z, z };
}

// screen ↔ board. One conversion pair, used by every pointer handler, so a drop point and a drag
// delta can never disagree about which space they are in.
export const toBoard = (sx0, sy0, view) => ({ x: (sx0 - view.x) / view.z, y: (sy0 - view.y) / view.z });
export const toScreen = (bx, by, view) => ({ x: bx * view.z + view.x, y: by * view.z + view.y });

// ── connectors ─────────────────────────────────────────────────────────────────────────────────
// An arrow anchors to the side of each rect that FACES the other rect, picked by comparing centre
// offsets. That is the whole algorithm, and refusing to grow it is deliberate: orthogonal routing
// with obstacle avoidance is what turns a board into a diagram editor with a layout engine to
// maintain. Here an arrow means "these two relate"; if it crosses a card, move the card.
export function anchor(rect, towards) {
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  const dx = towards.x - cx, dy = towards.y - cy;
  if (Math.abs(dx) > Math.abs(dy)) {
    return { x: dx > 0 ? rect.x + rect.w : rect.x, y: cy, side: dx > 0 ? 'r' : 'l' };
  }
  return { x: cx, y: dy > 0 ? rect.y + rect.h : rect.y, side: dy > 0 ? 'b' : 't' };
}

// Endpoints resolve from node ids when they are bound, and from literal points when they are not —
// a half-drawn arrow has a live cursor end, and an arrow whose target was deleted keeps its last
// point instead of collapsing to the origin.
export function arrowGeom(arrow, byId) {
  const end = (ref, pt, other) => {
    const n = ref && byId ? byId[ref] : null;
    if (n && isRect(n)) return anchor(rectOf(n), other);
    return pt || { x: 0, y: 0 };
  };
  const aCentre = (() => { const n = arrow.from && byId ? byId[arrow.from] : null; return n && isRect(n) ? { x: n.x + n.w / 2, y: n.y + n.h / 2 } : (arrow.fromPt || { x: 0, y: 0 }); })();
  const bCentre = (() => { const n = arrow.to && byId ? byId[arrow.to] : null; return n && isRect(n) ? { x: n.x + n.w / 2, y: n.y + n.h / 2 } : (arrow.toPt || { x: 0, y: 0 }); })();
  const a = end(arrow.from, arrow.fromPt, bCentre);
  const b = end(arrow.to, arrow.toPt, aCentre);
  // A gentle cubic, control points pushed along each anchor's own normal, so the curve leaves and
  // enters perpendicular to the card edge. A straight line between two side anchors reads as a
  // slash across the board; this reads as a connection.
  const d = Math.max(40, Math.min(160, Math.hypot(b.x - a.x, b.y - a.y) / 2));
  const push = (p, k) => p.side === 'r' ? { x: p.x + k, y: p.y }
    : p.side === 'l' ? { x: p.x - k, y: p.y }
      : p.side === 'b' ? { x: p.x, y: p.y + k } : { x: p.x, y: p.y - k };
  const c1 = a.side ? push(a, d) : a, c2 = b.side ? push(b, d) : b;
  return { a, b, c1, c2, path: `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}` };
}

// A point ON the connector at `t` (0 = start, 1 = end) — the cubic `arrowGeom` drew, not the
// straight line between its ends, so a label sits on the curve it names.
export function curvePoint(g, t) {
  const c1 = g.c1 || g.a, c2 = g.c2 || g.b, u = 1 - t;
  const at = k => u * u * u * g.a[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * g.b[k];
  return { x: at('x'), y: at('y') };
}

// Where a connector's label goes: the middle of the curve unless a card is in the way there, in
// which case it slides along the curve to the nearest stretch that is clear. A label printed over
// a card hides the card's own words; a label a little off-centre hides nothing. `taken` is the
// list of label boxes already placed, so two labels never stack on the same spot either.
const LABEL_STOPS = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82];
export function labelSpot(g, rects, { w = 84, h = 24, taken = [] } = {}) {
  const clear = p => {
    const x0 = p.x - w / 2, y0 = p.y - h / 2;
    const hit = r => x0 < r.x + r.w && x0 + w > r.x && y0 < r.y + r.h && y0 + h > r.y;
    return !(rects || []).some(hit) && !taken.some(hit);
  };
  let spot = null;
  for (const t of LABEL_STOPS) { const p = curvePoint(g, t); if (clear(p)) { spot = p; break; } }
  spot = spot || curvePoint(g, 0.5);
  taken.push({ x: spot.x - w / 2, y: spot.y - h / 2, w, h });
  return spot;
}

// ── the layouts ────────────────────────────────────────────────────────────────────────────────
// Each returns the full node list. `mkId` mints ids for frames a layout has to create.

const FRAME_PAD = 40;
const FRAME_HEAD = 52;               // room for the frame's title above its contents
const DEFAULT_COLS = 4;

// Scene number, normalised. Shots written before scenes existed carry no `scene`, and a board that
// dropped them would silently hide work — they collect in scene 0, rendered as UNASSIGNED.
export const sceneOf = s => {
  const n = Number(s && s.scene);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

// Shots in the order a director reads them: by scene, then by `no` inside the scene. `no` is the
// canonical order (backend/story.mjs sorts on it), so this never invents an opinion about sequence.
export function orderShots(shots) {
  return (shots || []).slice().sort((a, b) =>
    sceneOf(a) - sceneOf(b) || (a.no ?? 99) - (b.no ?? 99) || String(a.id).localeCompare(String(b.id)));
}

export function groupByScene(shots) {
  const m = new Map();
  for (const s of orderShots(shots)) {
    const k = sceneOf(s);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(s);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

// Reuse the node already representing `key`, or mint one. This is what keeps ids stable across
// re-aligns — see the header.
function reuse(existing, key, make) {
  const hit = existing.get(key);
  if (hit) { existing.delete(key); return { ...hit }; }
  return make();
}

// ── who owns a frame ───────────────────────────────────────────────────────────────────────────
// A frame carrying `scene` or `kind` was MINTED BY A LAYOUT and belongs to it. A frame carrying
// neither was drawn by the user and is untouchable.
//
// The rule that follows, and the bug it fixes: a layout rebuilds the auto-frames it needs and
// DROPS every other auto-frame. Without this, aligning By scene and then Shot strip left the two
// scene frames sitting behind the new single row as empty labelled rectangles — boxes containing
// nothing, in a layout that has no scenes. Passing them through looked like the "don't touch what
// you don't own" rule, but a layout does own them: it made them.
export const isAutoFrame = n => n && n.t === 'frame' && (n.scene != null || n.kind != null);
export const isUserFrame = n => n && n.t === 'frame' && n.scene == null && n.kind == null;

// WHICH auto-frames a given call owns. A layout run on its own owns every auto-frame, so switching
// By-scene → By-kind leaves no orphans. But `production` runs both halves at once, and each half
// must leave the OTHER half's frames standing — otherwise the second call silently deletes the
// groups the first one just built, which is exactly what it did on the first run.
const ownsFrame = (n, only) => isAutoFrame(n) && (!only || (only === 'scene' ? n.scene != null : n.kind != null));

// ── scene grid — THE default. Every scene is a titled frame; its shots sit in reading order. ──
export function sceneGrid(nodes, shots, opts = {}) {
  const { cols = DEFAULT_COLS, originX = 0, originY = 0, mkId, owns = null } = opts;
  const list = (nodes || []).map(n => ({ ...n }));
  const shotNodes = new Map(list.filter(n => n.t === 'shot' && n.shot).map(n => [n.shot, n]));
  const frameNodes = new Map(list.filter(n => n.t === 'frame' && n.scene != null).map(n => [String(n.scene), n]));
  // every auto-frame is dropped here; the scenes that still exist are re-minted below, and a
  // `kind` frame left over from By-kind is not this layout's and does not survive it
  const others = list.filter(n => !(n.t === 'shot' && n.shot) && !ownsFrame(n, owns));

  const out = [];
  const placed = [];
  let y = snap(originY);

  for (const [scene, group] of groupByScene(shots)) {
    const rows = Math.ceil(group.length / cols) || 1;
    const wide = Math.min(cols, group.length) || 1;
    const frameW = wide * CARD.w + (wide - 1) * GAP + FRAME_PAD * 2;
    const frameH = FRAME_HEAD + rows * cardH() + (rows - 1) * ROW_GAP + FRAME_PAD;

    const frame = reuse(frameNodes, String(scene), () =>
      blankNode('frame', {}, mkId || undefined));
    Object.assign(frame, {
      t: 'frame', scene,
      label: scene ? 'SCENE ' + scene : 'UNASSIGNED',
      x: snap(originX), y, w: snap(frameW), h: snap(frameH)
    });
    // Frames render behind their contents, so they lead the list — z-order in this document IS
    // array order, which keeps "send to back" a splice rather than a z field to reconcile.
    out.push(frame);

    group.forEach((s, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const node = reuse(shotNodes, s.id, () => blankNode('shot', { shot: s.id }, mkId || undefined));
      Object.assign(node, {
        t: 'shot', shot: s.id,
        x: snap(originX + FRAME_PAD + col * (CARD.w + GAP)),
        y: snap(y + FRAME_HEAD + row * (cardH() + ROW_GAP)),
        w: CARD.w, h: cardH()
      });
      placed.push(node);
    });

    y = snap(y + frameH + ROW_GAP);
  }

  // A shot node whose shot no longer exists, and a scene frame with no shots left, are both stale.
  // They are DROPPED here rather than left floating: the board is a view of the shot list, and a
  // card pointing at a deleted shot is a dead link the user has to clean up by hand.
  return [...out, ...placed, ...others];
}

// ── shot strip — one continuous row in reading order. The storyboard, unwrapped. ──
export function shotStrip(nodes, shots, opts = {}) {
  const { originX = 0, originY = 0, wrap = 0, mkId, owns = null } = opts;
  const list = (nodes || []).map(n => ({ ...n }));
  const shotNodes = new Map(list.filter(n => n.t === 'shot' && n.shot).map(n => [n.shot, n]));
  // a flat strip has no groups, so every auto-frame goes; the user's own frames stay put
  const others = list.filter(n => !(n.t === 'shot' && n.shot) && !ownsFrame(n, owns));
  const ordered = orderShots(shots);
  const perRow = wrap > 0 ? wrap : ordered.length || 1;

  const placed = ordered.map((s, i) => {
    const node = reuse(shotNodes, s.id, () => blankNode('shot', { shot: s.id }, mkId || undefined));
    return Object.assign(node, {
      t: 'shot', shot: s.id,
      x: snap(originX + (i % perRow) * (CARD.w + GAP)),
      y: snap(originY + Math.floor(i / perRow) * (cardH() + ROW_GAP)),
      w: CARD.w, h: cardH()
    });
  });
  return [...others.filter(n => n.t === 'frame'), ...placed, ...others.filter(n => n.t !== 'frame')];
}

// ── by kind — cluster the ASSET nodes by their meta kind (talent / location / prop / style). ──
// The vocabulary is not restated here: the caller passes `kindOf`, which reads whatever
// AssetBoards already decided an asset is. A second kind table would be a second source of truth.
export function byKind(nodes, opts = {}) {
  const { kindOf = n => n.kind || '', cols = DEFAULT_COLS, originX = 0, originY = 0, mkId, owns = null } = opts;
  const list = (nodes || []).map(n => ({ ...n }));
  const assets = list.filter(n => n.t === 'asset');
  const frames = new Map(list.filter(n => n.t === 'frame' && n.kind != null).map(n => [String(n.kind), n]));
  // scene frames from a previous By-scene are not this layout's groups; they go with the rest
  const others = list.filter(n => n.t !== 'asset' && !ownsFrame(n, owns));

  const groups = new Map();
  for (const a of assets) {
    const k = String(kindOf(a) || 'unsorted');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }

  const out = [], placed = [];
  let y = snap(originY);
  for (const [kind, group] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const wide = Math.min(cols, group.length) || 1;

    // Row pitch is the TALLEST card in that row, not a constant. Asset cards carry their file's
    // real aspect (backend/board.mjs `assetBox`), so a 9:16 character portrait is half again as
    // tall as a 16:9 plate — a fixed CARD.h pitch drew the portraits straight through the row
    // beneath them. Each row is measured, so mixed aspects sit in a clean grid either way.
    const rowH = [];
    group.forEach((a, i) => {
      const r = Math.floor(i / cols);
      rowH[r] = Math.max(rowH[r] || 0, a.h || CARD.h);
    });
    const rowTop = [];
    rowH.reduce((acc, h, r) => { rowTop[r] = acc; return acc + h + GAP; }, 0);
    const bodyH = rowH.reduce((a, h) => a + h, 0) + Math.max(0, rowH.length - 1) * GAP;

    const frame = reuse(frames, kind, () => blankNode('frame', {}, mkId || undefined));
    Object.assign(frame, {
      // the kind IS the folder name since the film asset vocabulary was removed — see Board.jsx
      t: 'frame', kind, label: String(kind).toUpperCase(),
      x: snap(originX), y,
      w: snap(wide * CARD.w + (wide - 1) * GAP + FRAME_PAD * 2),
      h: snap(FRAME_HEAD + bodyH + FRAME_PAD)
    });
    out.push(frame);
    group.forEach((a, i) => {
      placed.push(Object.assign(a, {
        x: snap(originX + FRAME_PAD + (i % cols) * (CARD.w + GAP)),
        y: snap(y + FRAME_HEAD + rowTop[Math.floor(i / cols)])
      }));
    });
    y = snap(y + frame.h + ROW_GAP);
  }
  return [...out, ...placed, ...others];
}

// ── production — THE whole project on one canvas: the cast and places on top, the scenes below. ──
// This is the layout a director actually wants when they say "show me the project". Assets lead
// because they are the vocabulary — who and where — and the scenes read underneath as the story
// told with them. It is a composition of the two layouts above rather than a third algorithm, so
// there is no new grouping rule to keep in sync with them.
export function production(nodes, shots, opts = {}) {
  const { originX = 0, originY = 0, mkId } = opts;
  // assets first, at the origin. `owns:'kind'` means "clear the stale KIND frames, leave the scene
  // frames to the call below" — without it the second call deletes the groups this one just made.
  const withAssets = byKind(nodes, { ...opts, originX, originY, mkId, owns: 'kind' });
  const assetBottom = withAssets.filter(n => n.t === 'asset' || (n.t === 'frame' && n.kind != null))
    .reduce((m, n) => Math.max(m, n.y + (n.h || 0)), originY);
  // then the scenes, starting a clear band below whatever the assets occupied
  return sceneGrid(withAssets, shots, {
    ...opts, originX,
    originY: snap(assetBottom + (assetBottom > originY ? ROW_GAP * 2 : 0)),
    mkId, owns: 'scene'
  });
}

// ── tidy — snap everything to the lattice and close the gaps, preserving relative order. ──
// The gentle one. It never regroups and never reorders; it takes the arrangement you already have
// and removes the wobble. The USER's frames and every arrow are left alone — a hand-drawn frame is
// a deliberate container and tidying it independently of its contents would tear the two apart.
//
// Auto-frames (scene/kind) do NOT survive, for the same reason they do not survive shotStrip:
// repacking the cards into a fresh grid means a scene frame no longer contains its scene, and an
// empty labelled box is worse than no box.
export function tidy(nodes, opts = {}) {
  const { cols = DEFAULT_COLS, originX = null, originY = null, gap = GAP } = opts;
  const list = (nodes || []).filter(n => !isAutoFrame(n)).map(n => ({ ...n }));
  // A locked card is one somebody finished placing: arranging never moves it.
  const movable = list.filter(n => isRect(n) && n.t !== 'frame' && !n.locked);
  if (!movable.length) return list;

  const b = bounds(movable);
  const x0 = snap(originX == null ? b.x : originX);
  const y0 = snap(originY == null ? b.y : originY);

  // Reading order: top-to-bottom in bands, left-to-right inside a band. The band height is the
  // tallest card, so two cards a few pixels apart vertically stay on the same row instead of
  // being read as two rows and shuffled past each other.
  const band = Math.max(...movable.map(n => n.h || 0)) || cardH();
  const ordered = movable.slice().sort((a, c) =>
    Math.floor(a.y / band) - Math.floor(c.y / band) || a.x - c.x);

  const colW = Math.max(...movable.map(n => n.w || 0)) || CARD.w;
  ordered.forEach((n, i) => {
    n.x = snap(x0 + (i % cols) * (colW + gap));
    n.y = snap(y0 + Math.floor(i / cols) * (band + gap));
  });
  return list;
}

// ── align & distribute — the multi-selection verbs every design tool has ────────────────────────
// Stolen wholesale from Figma/Excalidraw/tldraw because the vocabulary is universal and users
// arrive already knowing it. Pure, so the buttons and any future keyboard shortcut share one
// implementation. Locked nodes and arrows are never moved.
export const ALIGN_EDGES = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'];

export function alignNodes(nodes, ids, edge) {
  const set = new Set(ids || []);
  const targets = (nodes || []).filter(n => set.has(n.id) && isRect(n) && !n.locked);
  if (targets.length < 2) return nodes || [];        // aligning one thing to itself is a no-op
  const b = bounds(targets);
  const at = n => {
    switch (edge) {
      case 'left': return { x: b.x };
      case 'right': return { x: b.x + b.w - n.w };
      case 'hcenter': return { x: b.x + (b.w - n.w) / 2 };
      case 'top': return { y: b.y };
      case 'bottom': return { y: b.y + b.h - n.h };
      case 'vcenter': return { y: b.y + (b.h - n.h) / 2 };
      default: return {};
    }
  };
  const moved = new Map(targets.map(n => {
    const d = at(n);
    return [n.id, { x: d.x != null ? Math.round(d.x) : n.x, y: d.y != null ? Math.round(d.y) : n.y }];
  }));
  return (nodes || []).map(n => (moved.has(n.id) ? { ...n, ...moved.get(n.id) } : n));
}

// Equal GAPS between neighbours, not equal centres. Equal centres looks wrong the moment two cards
// are different sizes, which on this board they routinely are (a note next to a shot).
export function distributeNodes(nodes, ids, axis = 'h') {
  const set = new Set(ids || []);
  const targets = (nodes || []).filter(n => set.has(n.id) && isRect(n) && !n.locked);
  if (targets.length < 3) return nodes || [];        // two things are already evenly spaced
  const horiz = axis === 'h';
  const sorted = targets.slice().sort((a, b) => (horiz ? a.x - b.x : a.y - b.y));
  const first = sorted[0], last = sorted[sorted.length - 1];
  const span = horiz ? (last.x + last.w) - first.x : (last.y + last.h) - first.y;
  const used = sorted.reduce((a, n) => a + (horiz ? n.w : n.h), 0);
  const gap = (span - used) / (sorted.length - 1);
  const moved = new Map();
  let cursor = horiz ? first.x : first.y;
  for (const n of sorted) {
    moved.set(n.id, Math.round(cursor));
    cursor += (horiz ? n.w : n.h) + gap;
  }
  return (nodes || []).map(n => (moved.has(n.id)
    ? { ...n, [horiz ? 'x' : 'y']: moved.get(n.id) }
    : n));
}

// ── snap guides ────────────────────────────────────────────────────────────────────────────────
// While dragging, find the edges and centres of OTHER nodes that the moving set is within `tol` of,
// and hand back both the correction to apply and the lines to draw. This is the single affordance
// that makes hand-placement on a canvas feel precise instead of approximate, and it is why a board
// full of hand-placed cards can look as tidy as an auto-aligned one.
export const SNAP_TOL = 6;

export function snapGuides(moving, others, tol = SNAP_TOL) {
  if (!moving || !moving.w) return { dx: 0, dy: 0, guides: [] };
  const mv = { l: moving.x, r: moving.x + moving.w, cx: moving.x + moving.w / 2,
    t: moving.y, b: moving.y + moving.h, cy: moving.y + moving.h / 2 };
  let best = { dx: null, dy: null, ax: Infinity, ay: Infinity };
  const guides = [];
  for (const o of others) {
    if (!isRect(o)) continue;
    const ot = { l: o.x, r: o.x + o.w, cx: o.x + o.w / 2, t: o.y, b: o.y + o.h, cy: o.y + o.h / 2 };
    for (const [a, b] of [['l', 'l'], ['r', 'r'], ['cx', 'cx'], ['l', 'r'], ['r', 'l']]) {
      const d = ot[b] - mv[a];
      if (Math.abs(d) <= tol && Math.abs(d) < best.ax) { best.dx = d; best.ax = Math.abs(d); best.gx = ot[b]; }
    }
    for (const [a, b] of [['t', 't'], ['b', 'b'], ['cy', 'cy'], ['t', 'b'], ['b', 't']]) {
      const d = ot[b] - mv[a];
      if (Math.abs(d) <= tol && Math.abs(d) < best.ay) { best.dy = d; best.ay = Math.abs(d); best.gy = ot[b]; }
    }
  }
  if (best.dx != null) guides.push({ axis: 'x', at: best.gx });
  if (best.dy != null) guides.push({ axis: 'y', at: best.gy });
  return { dx: best.dx || 0, dy: best.dy || 0, guides };
}

// The registry the toolbar and the agent tool both read, so "which layouts exist" is one list.
export const LAYOUTS = [
  { id: 'production', label: 'Production', hint: 'the whole project — cast and locations on top, scenes below' },
  { id: 'scene-grid', label: 'By scene', hint: 'every scene a titled frame, shots in order' },
  { id: 'shot-strip', label: 'Shot strip', hint: 'one continuous row in shot order' },
  { id: 'by-kind', label: 'By kind', hint: 'cluster assets by cast / location / wardrobe / prop' },
  { id: 'tidy', label: 'Tidy', hint: 'snap to grid and close gaps, keep the arrangement' }
];
export const LAYOUT_IDS = LAYOUTS.map(l => l.id);

// The one dispatcher. The UI button, the keyboard shortcut and POST /api/board/:pid/align all come
// through here, so an agent's align and a human's align are the same code path.
export function applyLayout(id, nodes, shots, opts = {}) {
  switch (id) {
    case 'scene-grid': return sceneGrid(nodes, shots, opts);
    case 'shot-strip': return shotStrip(nodes, shots, opts);
    case 'by-kind': return byKind(nodes, opts);
    case 'production': return production(nodes, shots, opts);
    case 'tidy': return tidy(nodes, opts);
    default: throw new Error('unknown layout: ' + id);
  }
}
