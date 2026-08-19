// The Board — a per-project infinite canvas. projects/<pid>/board.md
//
// ── WHY THE DOCUMENT LOOKS LIKE THIS ───────────────────────────────────────────────────────────
// Frontmatter is the record, the body is an append-only log, exactly like a shot and a reel. That
// is not decoration: it is what makes the board editable by an AGENT with the tools it already has.
// A whiteboard whose state is an opaque binary scene graph (every canvas library ships one) can be
// rendered by an agent and reasoned about by nobody. Here `nodes:` is a YAML list of flat records
// with integer coordinates, so "put the scene-2 shots on the board and line them up" is a diff a
// human can read in the log afterwards.
//
// ── WHAT A NODE IS NOT ─────────────────────────────────────────────────────────────────────────
// A `shot` node stores NO picture, NO title and NO status — only `{ shot: 'SH010' }`. It is a live
// link, resolved through resolveShotMedia (backend/reel.mjs), which is THE shot→media joiner in
// this repo. Denormalising the thumbnail onto the node would make the board a stale copy of the
// shot list the moment anyone re-selects a take, and CLAUDE.md's "no second source of truth" rule
// is precisely about that. Same for `asset`: it carries the { scope, folder, name } triple and
// nothing else.
//
// ── THE ONE COORDINATE RULE ────────────────────────────────────────────────────────────────────
// Coordinates are BOARD space, integers, unbounded in both directions and independent of zoom and
// of the viewport. `view` is a separate record and is pure camera. A node's x never changes because
// someone scrolled.
import fs from 'fs';
import path from 'path';
import { getStorageRoot, readMd, writeMd, stamp, safeScope, appendActivity } from './store.mjs';
import { listContext } from './store.mjs';
import { readFolderKinds } from './memory.mjs';
import { imageSize } from './imageSize.mjs';
import { assetPath } from './library.mjs';
import { applyLayout, LAYOUT_IDS, NODE_KINDS, blankNode, bounds, CARD } from '../frontend/boardLayout.js';

const R = () => getStorageRoot();
const boardMd = pid => path.join(R(), 'projects', safeScope(pid), 'board.md');

// `show` — the version toggle, and the reason the board is a plan and not just a mood wall.
//   'selected' — every shot renders its selectedCandidate. THE PLAN.
//   'all'      — every shot also renders its alternates as a filmstrip, selected take ringed.
// Stored on the document rather than in component state so it survives a reload and so two
// windows on the same project agree about what is being looked at.
export const SHOW_MODES = ['selected', 'all'];

const DEFAULTS = () => ({
  view: { x: 0, y: 0, z: 1 },
  layout: 'scene-grid',
  show: 'selected',
  seq: 0,
  // Monotonic write counter, and the token the stale-write guard compares. NOT `updated`:
  // store.mjs's stamp() has MINUTE granularity ("Aug 18, 20:01"), so two writes in the same minute
  // carry an identical stamp and a timestamp guard silently never fires — which is exactly how the
  // first version of this check passed review and protected nothing.
  rev: 0,
  nodes: []
});

// Only these keys are patchable from the wire. An unlisted key in a PATCH body is dropped, not
// merged — the same closed list the reel uses, and the reason a malformed client cannot invent
// document fields that later readers have to defend against.
const PATCHABLE = ['view', 'layout', 'show', 'nodes'];

// ── node sanitisation ──────────────────────────────────────────────────────────────────────────
// Everything that reaches disk goes through here. Numbers are coerced and rounded (YAML floats
// with 14 decimals are what you get if you let a zoomed drag write straight through, and they make
// the document unreadable for the agent this format exists to serve). Unknown kinds are rejected.
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : d; };
const str = (v, max = 4000) => String(v == null ? '' : v).slice(0, max);

const MIN_W = 40, MIN_H = 28;

export function cleanNode(raw, id) {
  const t = String(raw && raw.t || '');
  if (!NODE_KINDS.includes(t)) return null;
  const n = { id: id || str(raw.id, 40) || null, t, x: num(raw.x), y: num(raw.y) };
  if (!n.id) return null;

  if (t === 'arrow') {
    // An endpoint is a node id OR a literal point, never both. Arrows carry no rect.
    if (raw.from) n.from = str(raw.from, 40); else if (raw.fromPt) n.fromPt = { x: num(raw.fromPt.x), y: num(raw.fromPt.y) };
    if (raw.to) n.to = str(raw.to, 40); else if (raw.toPt) n.toPt = { x: num(raw.toPt.x), y: num(raw.toPt.y) };
    if (raw.label) n.label = str(raw.label, 120);
    return n;
  }

  n.w = Math.max(MIN_W, num(raw.w, CARD.w));
  n.h = Math.max(MIN_H, num(raw.h, CARD.h));
  // Only written when true: `locked: false` on all 200 nodes is 200 lines of noise in a document
  // whose whole purpose is being readable.
  if (raw.locked) n.locked = true;

  if (t === 'asset') {
    n.scope = str(raw.scope, 60); n.name = str(raw.name, 200); n.folder = str(raw.folder || '', 200);
    if (!n.scope || !n.name) return null;
    if (raw.kind) n.kind = str(raw.kind, 40);
  }
  if (t === 'text') {
    n.text = str(raw.text, 2000);
    n.size = ['sm', 'md', 'lg', 'xl'].includes(raw.size) ? raw.size : 'lg';
    n.align = ['left', 'center', 'right'].includes(raw.align) ? raw.align : 'left';
    n.tone = ['fg', 'muted', 'accent', 'ok', 'warn', 'danger'].includes(raw.tone) ? raw.tone : 'fg';
  }
  if (t === 'note') { n.text = str(raw.text, 4000); n.tone = ['accent', 'ok', 'warn', 'danger', 'neutral'].includes(raw.tone) ? raw.tone : 'accent'; }
  if (t === 'frame') {
    n.label = str(raw.label, 120);
    // `scene` and `kind` are what let a layout REFILL a frame instead of stacking a second one on
    // top of it. Absent means "a frame the user drew by hand", which no layout owns or moves.
    if (raw.scene != null && raw.scene !== '') n.scene = num(raw.scene);
    if (raw.kind) n.kind = str(raw.kind, 40);
  }
  return n;
}

const cleanView = v => ({
  x: num(v && v.x), y: num(v && v.y),
  // zoom is the one non-integer the document keeps; 3 decimals is under a pixel at any board size
  z: Math.min(3, Math.max(0.1, Math.round((Number(v && v.z) || 1) * 1000) / 1000))
});

// ── read / write ───────────────────────────────────────────────────────────────────────────────
export function getBoard(pid) {
  let data = {}, content = '';
  try { const r = readMd(boardMd(pid)); data = r.data || {}; content = r.content || ''; }
  catch { /* no board yet — a project has one the moment it is asked for */ }
  const d = DEFAULTS();
  const nodes = (Array.isArray(data.nodes) ? data.nodes : []).map(n => cleanNode(n)).filter(Boolean);
  return {
    project: pid,
    view: cleanView(data.view || d.view),
    layout: LAYOUT_IDS.includes(data.layout) ? data.layout : d.layout,
    show: SHOW_MODES.includes(data.show) ? data.show : d.show,
    seq: num(data.seq, 0),
    rev: num(data.rev, 0),
    nodes,
    updated: data.updated || '',
    log: String(content || '').trim()
  };
}

// A cheap signature of the node list. Only what the stale-write guard actually protects — a node's
// identity, kind, geometry and lock — so re-saving an unchanged board is free.
const nodeSig = nodes => (nodes || [])
  .map(n => [n.id, n.t, n.x, n.y, n.w, n.h, n.locked ? 1 : 0, n.shot || n.name || n.text || n.label || ''].join(':'))
  .join('|');

function write(pid, board, logLine, prevNodes) {
  const { project, log, ...rest } = board;
  // ── the revision advances only when the DOCUMENT changes, never when the camera moves ──
  // `rev` is the token the stale-write guard compares, and the first version bumped it on every
  // write including view-only ones. Panning therefore invalidated the client's base and its next
  // drag 409'd against nobody — a guard against a real race, firing constantly on the one user it
  // was meant to protect. The camera is not document content; it does not get a revision.
  //
  // Computed here rather than passed by callers so a future write path cannot forget it.
  const changed = prevNodes === undefined || nodeSig(prevNodes) !== nodeSig(rest.nodes);
  const rev = num(rest.rev, 0) + (changed ? 1 : 0);
  rest.rev = rev;
  const at = stamp();
  const body = logLine
    ? ((log || '').trim() + '\n\n- ' + at + ' — ' + logLine).trim()
    : (log || '').trim();
  writeMd(boardMd(pid), { project: pid, ...rest, updated: at }, (body || '## Board log') + '\n');
  return { ...board, project: pid, rev, updated: at, log: body };
}

// `base` is the `rev` the caller's copy of the document was built from. When it is given and no
// longer matches, the write is REFUSED rather than applied.
//
// This is not theoretical: the canvas holds the whole node list in component state and PATCHes all
// of it, so a page that had been open while an agent (or a second window, or a chat-tool align)
// changed the board would write its stale list straight over the newer one. It cost seven asset
// nodes the first time it happened. A canvas whose unit of write is "every node" has to check.
export class BoardConflict extends Error {
  constructor(board) { super('The board changed somewhere else — reload before saving.'); this.code = 'stale'; this.board = board; }
}

export function saveBoard(pid, patch = {}, logLine = '', { base = null } = {}) {
  const cur = getBoard(pid);
  if (base != null && Number(base) !== cur.rev) throw new BoardConflict(cur);
  const next = { ...cur };
  for (const k of PATCHABLE) {
    if (!(k in patch)) continue;
    if (k === 'view') next.view = cleanView(patch.view);
    else if (k === 'layout') { if (LAYOUT_IDS.includes(patch.layout)) next.layout = patch.layout; }
    else if (k === 'show') { if (SHOW_MODES.includes(patch.show)) next.show = patch.show; }
    else if (k === 'nodes') next.nodes = (Array.isArray(patch.nodes) ? patch.nodes : []).map(n => cleanNode(n)).filter(Boolean);
  }
  return write(pid, next, logLine, cur.nodes);
}

// ── id minting ─────────────────────────────────────────────────────────────────────────────────
// Ids come off the document's own counter, not Date.now(): a board written twice in the same
// millisecond must not collide, the ids stay short enough to read in the YAML, and a test can
// assert on them.
function minter(board) {
  let seq = board.seq || 0;
  return { next: () => 'n' + (++seq).toString(36), commit: () => { board.seq = seq; } };
}

// ── operations ─────────────────────────────────────────────────────────────────────────────────
// These are what the UI buttons AND the agent tool both call. One implementation per operation is
// the rule the reel established (a human's laydown and an agent's laydown must be the same edit).

export function addNodes(pid, specs, logLine = '') {
  const board = getBoard(pid);
  const m = minter(board);
  const added = [];
  for (const spec of (Array.isArray(specs) ? specs : [specs])) {
    const base = blankNode(String(spec && spec.t || 'text'), {}, m.next);
    // A dropped/pasted/shelf-placed asset is sized from the file too, unless the caller stated a
    // height itself — otherwise the same portrait that syncAssets gets right arrives cropped when
    // you drag it in by hand.
    const box = (spec && spec.t === 'asset' && spec.scope === pid && spec.h == null)
      ? assetBox(pid, spec.folder || '', spec.name, Number(spec.w) > 0 ? Number(spec.w) : CARD.w)
      : null;
    const n = cleanNode({ ...base, ...spec, ...(box || {}) }, base.id);
    if (n) { board.nodes.push(n); added.push(n); }
  }
  m.commit();
  if (!added.length) return { board, added };
  return { board: write(pid, board, logLine || ('added ' + added.length + ' node' + (added.length === 1 ? '' : 's'))), added };
}

export function patchNodes(pid, patches, logLine = '') {
  const board = getBoard(pid);
  const by = new Map(board.nodes.map(n => [n.id, n]));
  let hit = 0;
  for (const p of (Array.isArray(patches) ? patches : [patches])) {
    const cur = by.get(String(p && p.id || ''));
    if (!cur) continue;
    // `t` is immutable: changing a note into a shot would leave the old kind's fields behind and
    // there is no user gesture that means it. Delete and re-add instead.
    const merged = cleanNode({ ...cur, ...p, t: cur.t, id: cur.id }, cur.id);
    if (merged) { Object.assign(cur, merged); hit++; }
  }
  if (!hit) return board;
  return write(pid, board, logLine || ('moved ' + hit + ' node' + (hit === 1 ? '' : 's')));
}

export function removeNodes(pid, ids, logLine = '') {
  const board = getBoard(pid);
  const kill = new Set((Array.isArray(ids) ? ids : [ids]).map(String));
  const before = board.nodes.length;
  // An arrow whose endpoint is deleted goes with it. The alternative — an arrow anchored to a
  // vanished node — renders as a stub pointing at nothing, which is worse than losing the arrow.
  board.nodes = board.nodes.filter(n => !kill.has(n.id) && !(n.t === 'arrow' && (kill.has(n.from) || kill.has(n.to))));
  const gone = before - board.nodes.length;
  if (!gone) return board;
  return write(pid, board, logLine || ('deleted ' + gone + ' node' + (gone === 1 ? '' : 's')));
}

// Put the project's ASSETS on the board. Each node carries the { scope, folder, name } triple every
// other surface uses plus its `kind`, which is what `by-kind` and `production` group on. The film
// asset vocabulary (cast/location/wardrobe/prop) went with the film domain, so the kind is now the
// folder name — one rule, still no second table. T15 replaces this with Scout's own node kinds.
const MEDIA_RE = /\.(png|jpe?g|gif|webp|avif|svg|mp4|mov|webm|m4v)$/i;

// ── an asset card is the shape of its asset ─────────────────────────────────────────────────────
// A 9:16 character portrait rendered into a 16:9 box is a crop, and on a cast board that crop lands
// on the actor's chest. So the node's height comes from the file's REAL dimensions, sniffed from
// the header bytes (backend/imageSize.mjs is zero-dep and reads ~32 bytes, so sizing two hundred
// assets costs nothing). Width stays CARD.w so a row still lines up on one column pitch; only the
// height varies, which is what a masonry-ish board wants.
//
// Anything we cannot sniff — SVG, video, a truncated file — keeps the 16:9 default rather than
// guessing. A wrong aspect is worse than a neutral one.
const MIN_ASPECT = 0.4;    // taller than 2:5 and the card becomes a column nobody can scan
const MAX_ASPECT = 3.0;    // wider than 3:1 and it stops reading as a card

export function assetBox(pid, folder, name, w = CARD.w) {
  const fallback = { w, h: Math.round(w * (CARD.h / CARD.w)) };
  try {
    const file = assetPath(pid, name, folder);
    if (!file || !/\.(png|jpe?g|gif|webp|avif)$/i.test(file)) return fallback;
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(64);
    const read = fs.readSync(fd, buf, 0, 64, 0);
    fs.closeSync(fd);
    const size = imageSize(buf.subarray(0, read));
    if (!size || !size.width || !size.height) return fallback;
    const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, size.width / size.height));
    return { w, h: Math.round(w / aspect) };
  } catch { return fallback; }
}

export function syncAssets(pid, { kinds = null, folders = null, limit = 200 } = {}) {
  const board = getBoard(pid);
  const have = new Set(board.nodes.filter(n => n.t === 'asset').map(n => n.scope + '/' + (n.folder || '') + '/' + n.name));
  let overrides = {};
  try { overrides = readFolderKinds(pid) || {}; } catch { /* no manifest yet */ }

  const { items } = listContext(pid);
  const m = minter(board);
  const added = [];
  for (const it of items) {
    if (added.length >= limit) break;
    if (!MEDIA_RE.test(it.name)) continue;
    const kind = (it.folder || '').split('/').pop() || '';
    // Default: production assets only. A board that pulled in every reference and note as well
    // would bury the cast under the moodboard on the first click.
    if (!kind) continue;
    if (kinds && !kinds.includes(kind)) continue;
    if (folders && !folders.includes(it.folder)) continue;
    if (have.has(pid + '/' + (it.folder || '') + '/' + it.name)) continue;
    const box = assetBox(pid, it.folder || '', it.name);
    const n = cleanNode({ ...blankNode('asset', {}, m.next), t: 'asset', scope: pid, folder: it.folder || '', name: it.name, kind, ...box });
    if (n) { board.nodes.push(n); added.push(n); }
  }
  m.commit();
  return { board, added };
}

export function alignBoard(pid, layout, opts = {}) {
  const id = LAYOUT_IDS.includes(layout) ? layout : getBoard(pid).layout;
  // Sync first: aligning is what a user reaches for on a board they have not populated yet, and a
  // layout that returns an empty canvas reads as a broken button. Which sync runs depends on what
  // the layout groups.
  let board;
  if (opts.sync === false) board = getBoard(pid);
  else if (id === 'by-kind' || id === 'production') board = syncAssets(pid).board;
  else board = getBoard(pid);
  // Shots are gone with the film domain. applyLayout still takes the list because boardLayout.js is
  // shared with the frontend and is re-cut at T15, when Scout's node kinds land.
  const shots = [];

  // Re-measure asset cards before laying them out. A board built before a card knew its own aspect
  // still holds 16:9 boxes, and nothing else would ever fix them: syncAssets skips assets already
  // on the board. An align is the honest moment to do it — it is an explicit action, and "put my
  // cards in order" reasonably includes "the right shape".
  if (id === 'by-kind' || id === 'production') {
    board.nodes = board.nodes.map(n => {
      if (n.t !== 'asset' || n.scope !== pid || n.locked) return n;
      return { ...n, ...assetBox(pid, n.folder || '', n.name, n.w || CARD.w) };
    });
  }

  const m = minter(board);
  board.nodes = applyLayout(id, board.nodes, shots, { ...opts, mkId: m.next })
    .map(n => cleanNode(n)).filter(Boolean);
  m.commit();
  board.layout = id;
  return write(pid, board, 'auto-aligned · ' + id + ' — ' + board.nodes.length + ' node'
    + (board.nodes.length === 1 ? '' : 's'));
}

export function setShow(pid, show) {
  if (!SHOW_MODES.includes(show)) throw new Error('show must be one of ' + SHOW_MODES.join(' | '));
  return saveBoard(pid, { show }, show === 'all' ? 'showing all takes' : 'showing the selected plan');
}

// Frame the whole board. Not a layout — it only moves the CAMERA, and it is here rather than in
// the component so the agent can answer "show me the board" with a view the user actually sees.
export function fitBoard(pid, vw = 1600, vh = 900) {
  const board = getBoard(pid);
  const b = bounds(board.nodes);
  if (!b.w || !b.h) return board;
  const z = Math.min(3, Math.max(0.1, Math.min((vw - 160) / b.w, (vh - 160) / b.h, 1)));
  return saveBoard(pid, { view: { x: vw / 2 - (b.x + b.w / 2) * z, y: vh / 2 - (b.y + b.h / 2) * z, z } });
}

// A compact, agent-facing digest: what is on this board, without the coordinates. This is what the
// chat tool returns instead of the raw document — an agent asked "what's on the board" does not
// need 400 integers, and pasting them costs a thousand tokens to say "twelve shots and four notes".
export function describeBoard(pid) {
  const board = getBoard(pid);
  const count = {};
  for (const n of board.nodes) count[n.t] = (count[n.t] || 0) + 1;
  const frames = board.nodes.filter(n => n.t === 'frame').map(n => n.label).filter(Boolean);
  const text = board.nodes.filter(n => n.t === 'text' || n.t === 'note')
    .map(n => String(n.text || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 40);
  return {
    project: pid, layout: board.layout, show: board.show,
    counts: count, total: board.nodes.length, frames, text,
    bounds: bounds(board.nodes), updated: board.updated
  };
}

// ── routes ─────────────────────────────────────────────────────────────────────────────────────
// registerBoardRoutes(app, { appendActivity }) — deps optional, following memory.mjs/control.mjs.
// Every route is a thin wrapper over an operation above; nothing here holds logic, so the agent
// tool hitting POST /api/board/:pid/align and the toolbar button run identical code.
export function registerBoardRoutes(app, deps = {}) {
  const activity = deps.appendActivity || appendActivity;

  app.get('/api/board/:pid', (req, res) => res.json(getBoard(req.params.pid)));

  // The agent's read. Deliberately a different route from the document: an agent asking "what is
  // on this board" gets a digest, not 400 coordinates it will paraphrase back at a thousand tokens.
  app.get('/api/board/:pid/describe', (req, res) => res.json(describeBoard(req.params.pid)));

  app.patch('/api/board/:pid', (req, res) => {
    try {
      res.json(saveBoard(req.params.pid, req.body?.patch || {}, String(req.body?.log || ''),
        { base: req.body?.base || null }));
    } catch (e) {
      // 409 carries the CURRENT document so the client can adopt it in the same round trip
      if (e.code === 'stale') return res.status(409).json({ error: e.message, code: 'stale', board: e.board });
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/board/:pid/nodes', (req, res) => {
    try {
      const { board, added } = addNodes(req.params.pid, req.body?.nodes || req.body || [], String(req.body?.log || ''));
      res.json({ board, added });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.patch('/api/board/:pid/nodes', (req, res) => {
    try { res.json(patchNodes(req.params.pid, req.body?.nodes || [], String(req.body?.log || ''))); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.delete('/api/board/:pid/nodes', (req, res) => {
    try { res.json(removeNodes(req.params.pid, req.body?.ids || [], String(req.body?.log || ''))); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Pull the project's cast / locations / wardrobe / props onto the board.
  app.post('/api/board/:pid/assets', (req, res) => {
    try {
      const { board, added } = syncAssets(req.params.pid, {
        kinds: Array.isArray(req.body?.kinds) && req.body.kinds.length ? req.body.kinds : null,
        folders: Array.isArray(req.body?.folders) && req.body.folders.length ? req.body.folders : null
      });
      if (!added.length) return res.json({ board, added });
      const saved = saveBoard(req.params.pid, { nodes: board.nodes }, 'pulled in ' + added.length + ' asset' + (added.length === 1 ? '' : 's'));
      res.json({ board: { ...saved, seq: board.seq }, added });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post('/api/board/:pid/align', (req, res) => {
    try {
      const board = alignBoard(req.params.pid, String(req.body?.layout || ''), req.body?.opts || {});
      activity({ dot: 'green', t: 'Board aligned', t2: '· ' + req.params.pid, s: board.layout + ' — ' + board.nodes.length + ' nodes', kind: 'proj', ref: req.params.pid });
      res.json(board);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post('/api/board/:pid/show', (req, res) => {
    try { res.json(setShow(req.params.pid, String(req.body?.show || ''))); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.get('/api/board/:pid/export/file', (req, res) => {
    const f = path.join(R(), 'projects', safeScope(req.params.pid), 'export', 'board.png');
    if (!fs.existsSync(f)) return res.status(404).json({ error: 'no board export yet — run the export first' });
    res.sendFile(f);
  });
}
