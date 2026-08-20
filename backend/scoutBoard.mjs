// THE WHITEBOARD — one board per project, at `projects/<id>/board.md`. T15.
//
// ── PORTED, NOT INVENTED ───────────────────────────────────────────────────────────────────────
// This is FrameForge's `backend/board.mjs` re-cut for Scout's objects. The document shape is the
// same and deliberately so: frontmatter is the record, the body is an append-only log, so a
// whiteboard is a thing an AGENT can edit with the tools it already has. A canvas library's binary
// scene graph can be rendered by a machine and reasoned about by nobody.
//
// ── THE ONE THING THAT IS NEW: EDGES ARE DERIVED ───────────────────────────────────────────────
// FrameForge had `t: 'arrow'` — a connector you drew by hand between two cards. Scout has none, and
// that is the whole point of the surface. An edge here is a REAL RELATION between the documents on
// the board (`docs/02_DATA_MODEL.md` §2, `type: relation`), read off the relation graph that
// already exists in `documents.mjs`, and LABELLED WITH THE FIELD NAME that creates it (`found_in`,
// `top_finds`). Place a guest and the group it was found in, and the edge draws itself and says
// why. Nothing is stored: `deriveEdges` is a projection of the store onto the placed nodes, so an
// edge can never disagree with the frontmatter, and an edge that means nothing cannot exist.
//
// ── rev ADVANCES ONLY WHEN NODES CHANGE ────────────────────────────────────────────────────────
// The camera is not document content. `view` is saved (a board you re-open should be where you
// left it) but panning does not bump `rev` and does not write a log line — otherwise the stale-write
// guard fires on the one user it exists to protect, and the log fills with scrolling.
//
// ── WHAT THIS MODULE MAY NOT DO ────────────────────────────────────────────────────────────────
// Write a document. Only `records.mjs` writes under `data/`. A board holds POINTERS (`path`) and
// resolves them on read; a card is a live view of the file, never a copy of it. Denormalising a
// title onto a node would make the board a stale second opinion about the record the moment
// anyone edits it.

import fs from 'node:fs';
import path from 'node:path';
import { getStorageRoot, readMd, writeMd, safeScope, appendActivity } from './store.mjs';
import { allDocuments, documentAt, referencesTo, collectionsOf, firstParagraph } from './documents.mjs';
import { listCollections, getCollection, primaryField, gateField } from './collections.mjs';
import { DEFAULT_ACTOR } from './records.mjs';
import { logEvent } from './log.mjs';
import { getTerritory } from './territory.mjs';
import { getGoal } from './memory.mjs';
// The lattice and the card pitch are SHARED with the canvas (frontend/boardLayout.js) so a node
// placed by hand, a node placed by an agent and a node placed by auto-align all land on the same
// grid. board.mjs already imports this module from the backend; this is that precedent, not a new
// coupling.
import { CARD, GRID } from '../frontend/boardLayout.js';

const R = () => getStorageRoot();
export const boardFile = id => path.join(R(), 'projects', safeScope(id) || 'main', 'board.md');

// ── the node kinds ─────────────────────────────────────────────────────────────────────────────
// `docs/05_UI_SPEC.md` §5. Each earns its place by being something you cannot say with another:
//   document        — a LIVE record. Carries only `path`; the card is rendered from the file.
//   territory       — a ground you sweep (`territory/<id>.md`). Its yield comes from territory.mjs,
//                     the sole writer of those numbers — never recomputed here.
//   goal            — a goal (`goals/<id>.md`), with its progress from memory.mjs.
//   collection-view — a saved view, live. A query on the canvas, not a screenshot of one.
//   note            — a sticky. The human's own words, the one node kind that is not a pointer.
//   image           — a picture: a screenshot, a moodboard scrap.
//   frame           — a titled rectangle that groups. Owns nothing inside it.
// There is NO `arrow`. See the header.
export const NODE_KINDS = ['document', 'collection-view', 'territory', 'goal', 'note', 'image', 'frame'];

// The kinds that address a document by path — the only ones an edge can touch, because an edge is
// a relation BETWEEN DOCUMENTS. A collection-view is a query, and membership is not a relation.
export const RECORD_KINDS = ['document', 'territory', 'goal'];

export const NOTE_TONES = ['accent', 'ok', 'warn', 'danger', 'neutral'];

const SIZES = {
  document: { w: CARD.w, h: 260 },
  'collection-view': { w: 360, h: 300 },
  territory: { w: 300, h: 180 },
  goal: { w: 300, h: 160 },
  note: { w: 240, h: 160 },
  image: { w: CARD.w, h: CARD.h },
  frame: { w: 800, h: 520 },
};

// Only these keys are patchable from the wire. An unlisted key in a PUT body is dropped, not
// merged — a malformed client cannot invent document fields that later readers must defend against.
// `layout` is deliberately NOT one of them: a persisted layout id is how auto-align stops being an
// action and becomes a mode, and a derived layout cannot hold a deliberate placement (T15 §5).
const PATCHABLE = ['view', 'nodes'];

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : d; };
const str = (v, max = 4000) => String(v == null ? '' : v).slice(0, max);

const MIN_W = 40, MIN_H = 28;

// A node's `path` is a store-relative address that arrives from a client. It must not escape the
// root and it must not be absolute — the same reasoning as documents.mjs `documentAt`, applied at
// the door so an unsafe path is never even written to the document.
export function safeRel(p) {
  const s = String(p == null ? '' : p).trim().replace(/\\/g, '/');
  if (!s || s.startsWith('/') || /^[a-zA-Z]:/.test(s)) return '';
  if (s.split('/').some(seg => seg === '' || seg === '.' || seg === '..')) return '';
  return s.slice(0, 300);
}

// An image may point at a file in the workspace OR at a data/https URL (a pasted screenshot before
// the FILES route lands). Anything else is dropped rather than rendered as a broken box.
function safeSrc(v) {
  const s = String(v == null ? '' : v).trim();
  if (/^(https?:|data:image\/)/i.test(s)) return s.slice(0, 2000);
  return safeRel(s);
}

// ── node sanitisation ──────────────────────────────────────────────────────────────────────────
// Everything that reaches disk goes through here, and it FAILS CLOSED: an unknown kind is dropped
// rather than written, because a malformed node on a canvas is an invisible click target. Numbers
// are rounded — a zoomed drag writing 14-decimal floats defeats the format's whole purpose.
export function cleanNode(raw, id) {
  const t = String((raw && raw.t) || '');
  if (!NODE_KINDS.includes(t)) return null;
  const n = { id: id || str(raw && raw.id, 40) || null, t, x: num(raw && raw.x), y: num(raw && raw.y) };
  if (!n.id) return null;

  const size = SIZES[t] || SIZES.note;
  n.w = Math.max(MIN_W, num(raw.w, size.w));
  n.h = Math.max(MIN_H, num(raw.h, size.h));
  // Only written when true: `locked: false` on 200 nodes is 200 lines of noise in a document whose
  // whole purpose is being readable.
  if (raw.locked) n.locked = true;

  if (RECORD_KINDS.includes(t)) {
    n.path = safeRel(raw.path);
    // A record node with no readable address is not a card, it is a hole. Drop it.
    if (!n.path || !n.path.endsWith('.md')) return null;
  }
  if (t === 'collection-view') {
    n.collection = str(raw.collection, 60).replace(/[^a-z0-9-]/gi, '');
    if (!n.collection) return null;
    if (raw.view) n.view = str(raw.view, 60).replace(/[^a-z0-9-]/gi, '');
  }
  if (t === 'note') {
    n.text = str(raw.text, 4000);
    n.tone = NOTE_TONES.includes(raw.tone) ? raw.tone : 'accent';
  }
  if (t === 'image') {
    n.src = safeSrc(raw.src);
    if (!n.src) return null;
    if (raw.alt) n.alt = str(raw.alt, 200);
  }
  if (t === 'frame') n.label = str(raw.label, 120);
  return n;
}

const cleanView = v => ({
  x: num(v && v.x), y: num(v && v.y),
  // zoom is the one non-integer the document keeps; 3 decimals is under a pixel at any board size
  z: Math.min(3, Math.max(0.1, Math.round((Number(v && v.z) || 1) * 1000) / 1000)),
});

const DEFAULTS = () => ({ view: { x: 0, y: 0, z: 1 }, seq: 0, rev: 0, nodes: [] });

// ── EDGES ──────────────────────────────────────────────────────────────────────────────────────
// The heart of this task. `nodes` in, edges out — pure with respect to the board, and it reads the
// relation graph rather than inventing one:
//
//   · `referencesTo` (documents.mjs) already answers "which documents point AT this one, through
//     which field, and is that field a DECLARED relation" — it is what the inspector's REFERENCED
//     BY renders. An edge is that same answer, filtered to the pairs that are both on the board.
//   · the label is the FIELD NAME, never a guess: `found_in`, `top_finds`. A line with no name on
//     it is the "edge that means nothing" this design exists to avoid.
//   · direction is real: `from` holds the pointer, `to` is pointed at. `found_in` and its inverse
//     `top_finds` are therefore TWO edges, not one — because they are two facts, written in two
//     files, either of which can be true without the other.
//
// Injecting `docs`/`collections` keeps this O(one store scan) when the caller has already read the
// store, and makes the test deterministic without stubbing the filesystem.
export function deriveEdges(nodes, { docs = null, collections = null } = {}) {
  const byPath = new Map();                 // path → node ids (a document may be placed twice)
  for (const n of nodes || []) {
    if (!n || !RECORD_KINDS.includes(n.t) || !n.path) continue;
    if (!byPath.has(n.path)) byPath.set(n.path, []);
    byPath.get(n.path).push(n.id);
  }
  // An edge needs two documents. One card on a board relates to nothing, and saying so early keeps
  // a mostly-empty board off the whole-store scan.
  if (byPath.size < 2) return [];

  const all = docs || allDocuments();
  const schemas = collections || listCollections();
  const docByPath = new Map(all.map(d => [d.path, d]));

  const out = [];
  const seen = new Set();
  for (const [targetPath, targetIds] of byPath) {
    const target = docByPath.get(targetPath);
    if (!target) continue;                  // a card whose file is gone draws nothing, silently
    for (const r of referencesTo(target, { docs: all, collections: schemas })) {
      const fromIds = byPath.get(r.path);
      if (!fromIds) continue;               // the relation is real, the other end is not on the board
      for (const from of fromIds) {
        for (const to of targetIds) {
          if (from === to) continue;        // one card cannot relate to itself
          const id = 'e:' + from + ':' + r.field + ':' + to;
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({
            id, from, to,
            field: r.field,                 // the machine name, as written in the frontmatter
            label: r.field,                 // what the canvas draws on the line — the same thing
            declared: !!r.declared,         // a typed `relation` field, or a loose frontmatter pointer
            collection: r.collection || null,
            source: r.source || null,
            many: !!r.many,
          });
        }
      }
    }
  }
  // A stable total order, so two identical reads never reshuffle the canvas.
  out.sort((a, b) => a.from.localeCompare(b.from) || a.field.localeCompare(b.field) || a.to.localeCompare(b.to));
  return out;
}

// ── resolving a card ───────────────────────────────────────────────────────────────────────────
// A `document` node stores a path and nothing else, so the card has to be READ. This is what makes
// the card live: edit the record anywhere in the app and the board shows the edit, because there
// is no copy to go stale.

// The title rule is the app's: the primary field of a collection the document belongs to, else the
// names a memory object answers to. (documents.mjs keeps its own copy of this private; this is the
// same rule, not a second one — if it ever exports `titleOf`, delete this.)
function titleFor(doc, inCollections) {
  for (const id of inCollections) {
    const c = getCollection(id);
    const p = c && primaryField(c);
    if (p && doc.data[p.key]) return String(doc.data[p.key]);
  }
  return String(doc.data.label || doc.data.name || doc.data.title || doc.slug);
}

// The three fields that matter, exactly as `docs/05_UI_SPEC.md` §2.1 defines the collapsed
// properties row: the gate status, the primary number, and freshness. The card shows these and the
// summary — never nine property rows, which is the altitude bug §2.1 exists to fix.
function headlineProps(doc, inCollections) {
  const out = [];
  const seen = new Set();
  for (const id of inCollections) {
    const c = getCollection(id);
    if (!c) continue;
    const picks = [
      gateField(c),
      (c.fields || []).find(f => f.type === 'number'),
      (c.fields || []).find(f => f.type === 'date' && f.display === 'freshness') || (c.fields || []).find(f => f.type === 'date'),
    ];
    for (const f of picks) {
      if (!f || seen.has(f.key)) continue;
      if (doc.data[f.key] === undefined || doc.data[f.key] === null || doc.data[f.key] === '') continue;
      seen.add(f.key);
      out.push({ key: f.key, field: f, value: doc.data[f.key] });
    }
    if (out.length) break;                  // the first collection that can answer, answers
  }
  return out.slice(0, 3);
}

const BODY_LIMIT = 4000;                    // a card is a card; the full note is one click away

export function resolveCard(node) {
  const rel = node && node.path;
  const doc = rel ? documentAt(rel) : null;
  if (!doc) return { path: rel || '', missing: true, title: String(rel || '').split('/').pop() || 'missing' };
  const inCollections = collectionsOf(doc);
  const card = {
    path: doc.path,
    slug: doc.slug,
    title: titleFor(doc, inCollections),
    collections: inCollections,
    collection: inCollections[0] || null,
    fields: doc.data,
    props: headlineProps(doc, inCollections),
    summary: doc.summary || firstParagraph(doc.content),
    body: String(doc.content || '').slice(0, BODY_LIMIT),
    missing: false,
  };
  // Territory and goal cards carry COMPUTED numbers, and there is exactly one writer of each:
  // territory.mjs owns yield/hit_rate, memory.mjs owns goal progress. Recomputing either here
  // would be the second source of truth CLAUDE.md's table exists to prevent.
  if (node.t === 'territory') {
    const t = getTerritory(doc.slug);
    if (t) card.stats = { ...t.stats, staleness: t.staleness, stale: t.stale, access: t.access };
  }
  if (node.t === 'goal') {
    const g = getGoal(doc.slug);
    if (g) card.goal = g;
  }
  return card;
}

// One read per distinct path, whatever the node count — two cards on the same document are one file.
export function resolveCards(nodes) {
  const out = {};
  for (const n of nodes || []) {
    if (!RECORD_KINDS.includes(n.t) || !n.path || out[n.path]) continue;
    out[n.path] = resolveCard(n);
  }
  return out;
}

// ── read ───────────────────────────────────────────────────────────────────────────────────────
// A read never creates the file: a project has a board the moment it is asked for one.
//
// `resolve` exists for the write path, which reads the current document only to compare revisions
// and must not pay for a whole-store scan to do it.
export function getBoard(id, { resolve = true } = {}) {
  const bid = safeScope(id) || 'main';
  let data = {}, content = '';
  try { const r = readMd(boardFile(bid)); data = r.data || {}; content = r.content || ''; }
  catch { /* no board yet */ }

  const d = DEFAULTS();
  // A FrameForge board lives at this same path and its node kinds are not these. Reading one with
  // Scout's sanitiser would drop every node, and SAVING over it would then destroy them for real —
  // so it is reported, not silently emptied, and the write path refuses. FrameForge's board goes
  // when its surface does; until then this is the seam between them.
  const foreign = isForeignBoard(data);
  const nodes = foreign ? [] : (Array.isArray(data.nodes) ? data.nodes : []).map(n => cleanNode(n)).filter(Boolean);

  const board = {
    board: bid,
    kind: 'whiteboard',
    view: cleanView(data.view || d.view),
    seq: num(data.seq, 0),
    rev: num(data.rev, 0),
    nodes,
    updated: data.updated || '',
    log: String(content || '').trim(),
  };
  if (foreign) board.foreign = true;
  if (resolve) {
    board.edges = deriveEdges(nodes);
    board.cards = resolveCards(nodes);
  }
  return board;
}

function isForeignBoard(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.kind === 'whiteboard') return false;
  // FrameForge's document declares `show` and its own node kinds; an empty file is nobody's.
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  return data.show !== undefined || nodes.some(n => n && !NODE_KINDS.includes(String(n.t || '')));
}

// A cheap signature of the node list — identity, kind, geometry, lock and the one field that makes
// each kind what it is. This is what `rev` protects, and it is why re-saving an unchanged board
// (which a camera write is) costs nothing.
const nodeSig = nodes => (nodes || [])
  .map(n => [n.id, n.t, n.x, n.y, n.w, n.h, n.locked ? 1 : 0, n.path || n.collection || n.src || n.text || n.label || ''].join(':'))
  .join('|');

// ── write ──────────────────────────────────────────────────────────────────────────────────────
export class BoardConflict extends Error {
  constructor(board) { super('The board changed somewhere else — reload before saving.'); this.code = 'stale'; this.board = board; }
}
export class BoardForeign extends Error {
  constructor(id) { super('projects/' + id + '/board.md is not a Scout whiteboard — refusing to overwrite it.'); this.code = 'foreign'; }
}

// The body is APPEND-ONLY. Every earlier line survives every write, so the board's history is the
// document rather than something reconstructed from an index. ISO timestamps, not store.stamp():
// stamp() has minute granularity, and a log whose lines cannot be ordered is a list.
function appendLog(existing, at, actor, line) {
  const head = String(existing || '').trim();
  const entry = '- ' + at + ' · ' + actor + ' — ' + String(line).replace(/[\r\n]+/g, ' ').trim();
  return head ? head + '\n' + entry : '## Board log\n\n' + entry;
}

function write(id, board, { log: logLine = '', prevNodes, actor = DEFAULT_ACTOR } = {}) {
  const changed = prevNodes === undefined || nodeSig(prevNodes) !== nodeSig(board.nodes);
  // ── the revision advances only when the DOCUMENT changes, never when the camera moves ──
  // `rev` is the token the stale-write guard compares. Bumping it on a pan invalidates the client's
  // base and 409s its next drag against nobody: a guard against a real race, firing constantly on
  // the one user it protects. Computed here rather than passed in, so no future write path can
  // forget it.
  const rev = num(board.rev, 0) + (changed ? 1 : 0);
  const at = new Date().toISOString();
  const body = (changed && logLine) ? appendLog(board.log, at, actor, logLine) : String(board.log || '').trim();

  writeMd(boardFile(id), {
    board: id, kind: 'whiteboard',
    view: board.view, seq: num(board.seq, 0), rev,
    nodes: board.nodes, updated: at,
  }, (body || '## Board log') + '\n');

  if (changed) {
    // Every mutation lands in the event log (docs/08_MODULE_CONTRACTS.md §1). A pan is not a
    // mutation, which is the same rule `rev` follows and for the same reason.
    try {
      logEvent({
        type: 'update', actor,
        target: 'projects/' + id + '/board.md',
        detail: { nodes: board.nodes.length, what: logLine || 'board saved' },
      });
    } catch { /* a log that cannot be written must not cost the user their drag */ }
  }
  return { ...board, board: id, rev, updated: at, log: body, changed };
}

// ── id minting ─────────────────────────────────────────────────────────────────────────────────
// Ids come off the document's own counter, never Date.now(): a board written twice in the same
// millisecond must not collide, the ids stay short enough to read in the YAML, and a test can
// assert on them.
function minter(board) {
  let seq = num(board.seq, 0);
  return { next: () => 'n' + (++seq).toString(36), commit: () => { board.seq = seq; } };
}

// ── save ───────────────────────────────────────────────────────────────────────────────────────
// ONE write verb, because the canvas holds the whole node list in component state and sends all of
// it. That is also why `base` exists: a page open while an agent (or a second window) changed the
// board would otherwise write its stale list straight over the newer one. When `base` is given and
// no longer matches, the write is REFUSED and the current document comes back with the refusal, so
// the client can adopt it in the same round trip.
export function saveBoard(id, body = {}, { actor = DEFAULT_ACTOR } = {}) {
  const bid = safeScope(id) || 'main';
  const cur = getBoard(bid, { resolve: false });
  if (cur.foreign) throw new BoardForeign(bid);

  const who = String((body && body.actor) || actor || DEFAULT_ACTOR).trim() || DEFAULT_ACTOR;
  const base = body && (body.base != null ? body.base : body.rev);
  if (base != null && base !== '' && Number(base) !== cur.rev) throw new BoardConflict({ ...cur, edges: deriveEdges(cur.nodes), cards: resolveCards(cur.nodes) });

  const next = { ...cur };
  const m = minter(next);
  const used = new Set();
  for (const k of PATCHABLE) {
    if (!body || !(k in body)) continue;
    if (k === 'view') next.view = cleanView(body.view);
    if (k === 'nodes') {
      next.nodes = (Array.isArray(body.nodes) ? body.nodes : []).map(raw => {
        // A node arriving without an id is a new one — the client places it, the document names it.
        // A duplicated id is renamed rather than dropped, because losing a card is worse than
        // renaming one, and selection keys off the id the server hands back.
        const wanted = str(raw && raw.id, 40);
        const id2 = (!wanted || used.has(wanted)) ? m.next() : wanted;
        used.add(id2);
        return cleanNode(raw, id2);
      }).filter(Boolean);
    }
  }
  m.commit();

  const saved = write(bid, next, { log: String((body && body.log) || ''), prevNodes: cur.nodes, actor: who });
  saved.edges = deriveEdges(saved.nodes);
  saved.cards = resolveCards(saved.nodes);
  return saved;
}

// A compact, agent-facing digest: what is on this board and how it hangs together, without the
// coordinates. An agent asked "what is on the board" does not need four hundred integers.
export function describeBoard(id) {
  const b = getBoard(id);
  const counts = {};
  for (const n of b.nodes) counts[n.t] = (counts[n.t] || 0) + 1;
  return {
    board: b.board,
    counts, total: b.nodes.length,
    documents: b.nodes.filter(n => RECORD_KINDS.includes(n.t)).map(n => ((b.cards[n.path] || {}).title) || n.path),
    edges: b.edges.map(e => {
      const from = b.nodes.find(n => n.id === e.from), to = b.nodes.find(n => n.id === e.to);
      const name = n => (n && b.cards[n.path] ? b.cards[n.path].title : (n ? n.path : '?'));
      return name(from) + ' —' + e.field + '→ ' + name(to);
    }),
    notes: b.nodes.filter(n => n.t === 'note').map(n => String(n.text || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 40),
    updated: b.updated,
  };
}

// The lattice the canvas snaps to, exported so a caller placing a node from the server side lands
// on the same grid as a hand-placed one.
export { GRID };

// ── routes ─────────────────────────────────────────────────────────────────────────────────────
// Two routes, matching `frontend/api.js` (`api.scoutBoard` / `api.saveScoutBoard`). Nothing here
// holds logic: an agent's save and the canvas's save run identical code, which is the rule that
// keeps auto-align from having two implementations.
export function registerScoutBoardRoutes(app, deps = {}) {
  const activity = deps.appendActivity || appendActivity;

  app.get('/api/scout/board/:id', (req, res) => {
    try { res.json(getBoard(req.params.id)); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.put('/api/scout/board/:id', (req, res) => {
    const body = req.body || {};
    try {
      const saved = saveBoard(req.params.id, body, { actor: body.actor });
      if (saved.changed) {
        activity({
          dot: 'green', t: 'Whiteboard saved', t2: '· ' + saved.board,
          s: (body.log || 'nodes changed') + ' — ' + saved.nodes.length + ' node' + (saved.nodes.length === 1 ? '' : 's')
            + ', ' + saved.edges.length + ' relation' + (saved.edges.length === 1 ? '' : 's'),
          kind: 'proj', ref: saved.board,
        });
      }
      res.json(saved);
    } catch (e) {
      // 409 carries the CURRENT document so the client can adopt it without a second round trip.
      if (e.code === 'stale') return res.status(409).json({ error: e.message, code: 'stale', board: e.board });
      if (e.code === 'foreign') return res.status(409).json({ error: e.message, code: 'foreign' });
      res.status(400).json({ error: e.message });
    }
  });
}

// `fs` is imported for the existence check callers do on the raw file (Law 8 — the path is always
// reachable), and re-exported as a helper rather than making every caller rebuild the path.
export const boardExists = id => fs.existsSync(boardFile(id));
