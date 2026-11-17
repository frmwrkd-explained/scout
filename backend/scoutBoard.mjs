// THE WHITEBOARD — one board per project, at `projects/<id>/board.md`. T15.
//
// ── PORTED, NOT INVENTED ───────────────────────────────────────────────────────────────────────
// This is FrameForge's `backend/board.mjs` re-cut for Scout's objects. The document shape is the
// same and deliberately so: frontmatter is the record, the body is an append-only log, so a
// whiteboard is a thing an AGENT can edit with the tools it already has. A canvas library's binary
// scene graph can be rendered by a machine and reasoned about by nobody.
//
// ── TWO KINDS OF LINE, AND THEY ARE NEVER CONFUSED ─────────────────────────────────────────────
// EDGES ARE DERIVED. An edge is a REAL RELATION between the documents on the board
// (`docs/02_DATA_MODEL.md` §2, `type: relation`), read off the relation graph that already exists
// in `documents.mjs`, and labelled with the field that creates it ("Found in", "Company"). Place a
// guest and the group it was found in, and the edge draws itself and says why. Nothing is stored:
// `deriveEdges` is a projection of the store onto the placed nodes, so an edge can never disagree
// with the frontmatter, and an edge that means nothing cannot exist.
//
// LINKS ARE DRAWN. A link is a line a person (or an agent) put between two things on the board —
// any two nodes, not only records — to say something the records do not: this leads to that, this
// is why. Links are STORED, in the board file's top-level `links` list, and say nothing about the
// records they touch. When a drawn link happens to join two records that a relation field could
// join, the board OFFERS to make it real (`realiseLink`): the record is then written by
// `records.mjs` like any other edit, the drawn link is removed, and the derived edge takes its
// place. It never happens silently and an agent may not do it.
//
// ── THE BOARD FILE, FOR ANYONE EDITING IT BY HAND ──────────────────────────────────────────────
// `projects/<id>/board.md` frontmatter. Every node: `id` (any short unique word: letters, digits,
// `-`, `_`), `t` (the kind), `x` `y` `w` `h` (integers, board pixels, y grows downward), and
// optionally `locked: true`. Then per kind:
//
//   t: document | territory | goal    path: data/guests/ana.md        a LIVE record card
//   t: collection-view                collection: guest, view: needs-review
//   t: note      text: "…"            tone: accent|ok|warn|danger|neutral, colour: <hue>
//   t: text      text: "…"            size: s|m|l|xl (xl is a heading), bold: true, colour: <hue>,
//                                     fixed: true (wrap at `w`; otherwise the box hugs the words)
//   t: shape     shape: rect|round|ellipse|diamond, text: "…", colour: <hue>, size: s|m|l|xl
//   t: draw      points: "0,0 4,7 12,9" (x,y pairs relative to the node's own x/y), width: 2|4|8,
//                colour: <hue>          a freehand stroke
//   t: image     src: files/<sha>.png | https://…, alt: "…"
//   t: frame     label: "…"           a titled region; owns nothing inside it
//
//   <hue> is one of: red orange amber green teal blue violet pink (the app's `--hue-*` tokens).
//
// And the drawn links, beside `nodes`:
//
//   links:
//     - id: l1            any short unique word
//       from: n3          a node id
//       to: n7            another node id
//       label: because    optional, one line
//       ends: arrow       none | arrow (points at `to`) | both      — default arrow
//       line: solid       solid | dashed                             — default solid
//       colour: teal      optional <hue>
//
// A link whose `from` or `to` is not a node on the board is dropped on the next save. An unknown
// `ends`/`line`/`colour` falls back to the default rather than costing the link. To add a text, a
// shape or a link by hand: append the entry, save the file — the app picks it up on its next read
// and `rev` is bumped by the next save through the API. `GET /api/scout/board/:id/describe` says
// what the diagram reads as, in words.
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
// anyone edits it. (`realiseLink` is not an exception: it calls `records.mjs` `patchRecord`, the
// function behind `PATCH /api/records`, and writes nothing itself.)

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { getStorageRoot, readMd, writeMd, safeScope, appendActivity } from './store.mjs';
import { allDocuments, documentAt, referencesTo, collectionsOf, firstParagraph } from './documents.mjs';
import { listCollections, getCollection, primaryField, gateField } from './collections.mjs';
import { DEFAULT_ACTOR, patchRecord } from './records.mjs';
import { isAgentActor } from './actors.mjs';
import { currentWorkerIdentity } from './workerScope.mjs';
import { logEvent } from './log.mjs';
import { getTerritory } from './territory.mjs';
import { getGoal } from './memory.mjs';
// The lattice and the card pitch are SHARED with the canvas (frontend/boardLayout.js) so a node
// placed by hand, a node placed by an agent and a node placed by auto-align all land on the same
// grid. board.mjs already imports this module from the backend; this is that precedent, not a new
// coupling.
import { CARD, GRID, BOARD_CARD } from '../frontend/boardLayout.js';
import { storeAttachment } from './attachments.mjs';

const R = () => getStorageRoot();
const raw = express.raw;
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
//   text            — bare words on the canvas, no card around them. A heading, a label, a remark.
//   shape           — a rectangle, rounded rectangle, ellipse or diamond with words in it: the
//                     boxes of a flowchart.
//   draw            — a freehand stroke.
// There is NO `arrow` node. A line between two things is a LINK (the `links` list) — see the header.
export const NODE_KINDS = ['document', 'collection-view', 'territory', 'goal', 'note', 'image', 'frame', 'text', 'shape', 'draw'];

// The kinds that address a document by path — the only ones an edge can touch, because an edge is
// a relation BETWEEN DOCUMENTS. A collection-view is a query, and membership is not a relation.
export const RECORD_KINDS = ['document', 'territory', 'goal'];

export const NOTE_TONES = ['accent', 'ok', 'warn', 'danger', 'neutral'];
// The eight colours anything a person makes on the board can take — the app's `--hue-*` tokens, by
// name. A name is stored, never a colour value, so a board looks right in light and in dark.
export const HUES = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'];
export const TEXT_SIZES = ['s', 'm', 'l', 'xl'];
export const SHAPES = ['rect', 'round', 'ellipse', 'diamond'];
export const STROKE_WIDTHS = [2, 4, 8];
export const LINK_ENDS = ['none', 'arrow', 'both'];
export const LINK_LINES = ['solid', 'dashed'];

const SIZES = {
  document: { w: CARD.w, h: 260 },
  'collection-view': { w: 360, h: 300 },
  territory: { w: 300, h: 180 },
  goal: { w: 300, h: 160 },
  note: { w: 240, h: 160 },
  image: { w: CARD.w, h: CARD.h },
  frame: { w: 800, h: 520 },
  text: { w: 280, h: 28 },
  shape: { w: 200, h: 120 },
  draw: { w: 40, h: 40 },
};

// Only these keys are patchable from the wire. An unlisted key in a PUT body is dropped, not
// merged — a malformed client cannot invent document fields that later readers must defend against.
// `layout` is deliberately NOT one of them: a persisted layout id is how auto-align stops being an
// action and becomes a mode, and a derived layout cannot hold a deliberate placement (T15 §5).
const PATCHABLE = ['view', 'nodes', 'links'];

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : d; };
const str = (v, max = 4000) => String(v == null ? '' : v).slice(0, max);

const MIN_W = 40, MIN_H = 28;
// Words and strokes are as small as they are: a one-letter label is narrower than any card.
const SMALL = new Set(['text', 'draw']);
const MIN_SMALL = 8;
const safeId = v => str(v, 40).replace(/[^A-Za-z0-9_-]/g, '');
const hue = v => (HUES.includes(v) ? v : null);

// A stroke's points: "x,y x,y …", integers, relative to the node's own corner. Stored as ONE
// string, not a YAML list — a stroke is a few hundred numbers, and a few hundred lines of
// frontmatter per scribble would bury the parts of the file a person can read.
const MAX_POINTS = 2000;
export function cleanPoints(v) {
  const flat = Array.isArray(v) ? v.flat() : String(v == null ? '' : v).split(/[\s,]+/);
  const nums = flat.map(Number).filter(Number.isFinite).map(Math.round);
  const pairs = [];
  for (let i = 0; i + 1 < nums.length && pairs.length < MAX_POINTS; i += 2) pairs.push(nums[i] + ',' + nums[i + 1]);
  if (!pairs.length) return '';
  if (pairs.length === 1) pairs.push(pairs[0]);          // a dot is a stroke that did not travel
  return pairs.join(' ');
}

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
  const n = { id: safeId(id) || safeId(raw && raw.id) || null, t, x: num(raw && raw.x), y: num(raw && raw.y) };
  if (!n.id) return null;

  const size = SIZES[t] || SIZES.note;
  n.w = Math.max(SMALL.has(t) ? MIN_SMALL : MIN_W, num(raw.w, size.w));
  n.h = Math.max(SMALL.has(t) ? MIN_SMALL : MIN_H, num(raw.h, size.h));
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
    // A hue on top of the tone: the tone stays so a board written before hues existed, or read by
    // something that only knows tones, still means what it meant.
    if (hue(raw.colour)) n.colour = raw.colour;
  }
  if (t === 'text') {
    n.text = str(raw.text, 4000);
    // Words with no words are an invisible click target. (The canvas removes an empty text when
    // you click away; this is the same rule for a file edited by hand.)
    if (!n.text.trim()) return null;
    n.size = TEXT_SIZES.includes(raw.size) ? raw.size : 'm';
    if (raw.bold) n.bold = true;
    if (raw.fixed) n.fixed = true;
    if (hue(raw.colour)) n.colour = raw.colour;
  }
  if (t === 'shape') {
    n.shape = SHAPES.includes(raw.shape) ? raw.shape : 'rect';
    n.text = str(raw.text, 600);
    if (TEXT_SIZES.includes(raw.size) && raw.size !== 'm') n.size = raw.size;
    if (hue(raw.colour)) n.colour = raw.colour;
  }
  if (t === 'draw') {
    n.points = cleanPoints(raw.points);
    if (!n.points) return null;
    n.width = STROKE_WIDTHS.includes(Number(raw.width)) ? Number(raw.width) : 4;
    if (hue(raw.colour)) n.colour = raw.colour;
  }
  if (t === 'image') {
    n.src = safeSrc(raw.src);
    if (!n.src) return null;
    if (raw.alt) n.alt = str(raw.alt, 200);
  }
  if (t === 'frame') n.label = str(raw.label, 120);
  return n;
}

// ── link sanitisation ──────────────────────────────────────────────────────────────────────────
// A drawn link is valid only between two DIFFERENT nodes that are on the board. Everything else
// about it has a default, so a typo in `ends` costs the arrowhead and not the link.
export function cleanLink(raw, nodeIds, id) {
  if (!raw || typeof raw !== 'object') return null;
  const from = safeId(raw.from), to = safeId(raw.to);
  if (!from || !to || from === to) return null;
  if (!nodeIds.has(from) || !nodeIds.has(to)) return null;      // dangling: its node is gone
  const l = { id: safeId(id) || safeId(raw.id) || null, from, to };
  if (!l.id) return null;
  const label = str(raw.label, 200).replace(/[\r\n]+/g, ' ').trim();
  if (label) l.label = label;
  l.ends = LINK_ENDS.includes(raw.ends) ? raw.ends : 'arrow';
  l.line = LINK_LINES.includes(raw.line) ? raw.line : 'solid';
  if (hue(raw.colour)) l.colour = raw.colour;
  return l;
}
// A list of raw links against the nodes that exist: cleaned, ids made unique, danglers dropped.
function cleanLinks(list, nodes, mint = null) {
  const nodeIds = new Set((nodes || []).map(n => n.id));
  const used = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    let id = safeId(raw && raw.id);
    if (!id || used.has(id)) { if (!mint) continue; do { id = mint(); } while (used.has(id)); }
    const l = cleanLink(raw, nodeIds, id);
    if (!l) continue;
    used.add(l.id);
    out.push(l);
  }
  return out;
}

const cleanView = v => ({
  x: num(v && v.x), y: num(v && v.y),
  // zoom is the one non-integer the document keeps; 3 decimals is under a pixel at any board size
  z: Math.min(3, Math.max(0.1, Math.round((Number(v && v.z) || 1) * 1000) / 1000)),
});

const DEFAULTS = () => ({ view: { x: 0, y: 0, z: 1 }, seq: 0, rev: 0, nodes: [], links: [] });

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
            // What the canvas draws on the line: the field's own LABEL — "Company", "Found in" —
            // the same words the table header and the record page use for it. The machine name
            // stays in `field` for anything that needs to go and check the frontmatter.
            label: labelOfField(schemas, r.collection, r.field),
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

// A field's human name: the schema's `label` when it declares one, else the key read as words
// (`found_in` → "Found in"). The same rule frontend/PropertyRows.jsx `propertyLabel` applies.
export function humanise(key) {
  const words = String(key == null ? '' : key).replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
function labelOfField(schemas, collectionId, key) {
  const c = collectionId ? (schemas || []).find(x => x.id === collectionId) : null;
  const f = c ? (c.fields || []).find(x => x.key === key) : null;
  return humanise((f && f.label) || key);
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

// What a card says about its record, in at most three properties.
//
// When the collection has CHOSEN what sits under a record's title (its `header` key, set on the
// record page), the card shows those — a record should read the same on the board as it does on
// its own page. Otherwise it is the three fields `docs/05_UI_SPEC.md` §2.1 names for a collapsed
// row — the gate status, the primary number, freshness — and when a collection has none of those
// (a library of references, a list of people), what identifies a thing at a glance instead: a
// choice, the record it belongs to, its tags. Long text and pictures are never card properties.
const cardable = f => !!f && !f.primary && f.type !== 'file' && f.type !== 'json' && !(f.type === 'text' && f.multiline);
function headlineProps(doc, inCollections) {
  const out = [];
  const seen = new Set();
  const has = f => !(doc.data[f.key] === undefined || doc.data[f.key] === null || doc.data[f.key] === '' || (Array.isArray(doc.data[f.key]) && !doc.data[f.key].length));
  for (const id of inCollections) {
    const c = getCollection(id);
    if (!c) continue;
    const fields = (c.fields || []).filter(cardable);
    const gate = gateField(c);
    let picks;
    if (Array.isArray(c.header)) {
      picks = c.header.map(k => fields.find(f => f.key === k));
    } else {
      // A bare number is "the primary number" only where the collection scores things (it has a
      // gate, or the field says how to draw itself). An import's row number is not a headline.
      const scored = f => f.type === 'number' && (!!gate || !!f.display);
      picks = [
        gate,
        fields.find(scored),
        fields.find(f => f.type === 'date' && f.display === 'freshness') || (gate ? fields.find(f => f.type === 'date') : null),
        ...fields.filter(f => f.type === 'status' || f.type === 'select'),
        ...fields.filter(f => f.type === 'relation' || f.type === 'actor'),
        ...fields.filter(f => f.type === 'multiselect'),
        ...fields.filter(f => f.type === 'number' && !/(^|_)(id|number|no)$/.test(f.key)),
        ...fields.filter(f => f.type === 'date'),
      ];
    }
    for (const f of picks) {
      if (!f || seen.has(f.key) || !cardable(f) || !has(f)) continue;
      seen.add(f.key);
      out.push({ key: f.key, label: humanise(f.label || f.key), field: f, value: doc.data[f.key] });
    }
    if (out.length) break;                  // the first collection that can answer, answers
  }
  return out.slice(0, 3);
}

// The record's picture, if its collection has a picture field and this record has one: the
// `primary_media` file field, else the first file field — the same rule the cards layout and the
// record page use. A workspace-relative path (or a URL); the canvas resolves it to bytes.
function coverOf(doc, inCollections) {
  for (const id of inCollections) {
    const c = getCollection(id);
    const files = ((c && c.fields) || []).filter(f => f.type === 'file');
    const f = files.find(x => x.primary_media) || files[0];
    if (!f) continue;
    const v = [].concat(doc.data[f.key] ?? []).find(x => typeof x === 'string' && x.trim());
    if (v) return String(v).trim();
  }
  return null;
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
    cover: coverOf(doc, inCollections),
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
  // A board written before links existed has no `links` key and reads as having none. A link added
  // by hand without an id is given one here, so it can be selected; the next save writes it down.
  let k = 0;
  const links = foreign ? [] : cleanLinks(data.links, nodes, () => 'l' + (++k).toString(36));

  const board = {
    board: bid,
    kind: 'whiteboard',
    view: cleanView(data.view || d.view),
    seq: num(data.seq, 0),
    rev: num(data.rev, 0),
    nodes,
    links,
    updated: data.updated || '',
    log: String(content || '').trim(),
  };
  if (foreign) board.foreign = true;
  if (resolve) Object.assign(board, resolved(nodes, links));
  return board;
}

// What a read adds to the stored board: the derived edges, the live cards, and — for each drawn
// link a relation field could say instead — the offer to make it real. One store scan for all three.
function resolved(nodes, links) {
  const needsStore = (nodes || []).filter(n => RECORD_KINDS.includes(n.t)).length >= 2;
  const docs = needsStore ? allDocuments() : [];
  const collections = needsStore ? listCollections() : [];
  return {
    edges: needsStore ? deriveEdges(nodes, { docs, collections }) : [],
    cards: resolveCards(nodes),
    offers: needsStore ? linkOffers(links, nodes, { docs, collections }) : {},
  };
}

function isForeignBoard(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.kind === 'whiteboard') return false;
  // FrameForge's document declares `show` and its own node kinds; an empty file is nobody's.
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  return data.show !== undefined || nodes.some(n => n && !NODE_KINDS.includes(String(n.t || '')));
}

// The signature of what the board SAYS — every node and every drawn link, exactly as they would be
// written. This is what `rev` protects, and it is why re-saving an unchanged board (which a camera
// write is) costs nothing. Cleaned nodes are small and key-ordered, so the comparison is exact:
// a colour, a size or a link's arrowhead changing is a change.
const nodeSig = (nodes, links) => JSON.stringify(nodes || []) + '\n' + JSON.stringify(links || []);

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

function write(id, board, { log: logLine = '', prevNodes, prevLinks, actor = DEFAULT_ACTOR } = {}) {
  const changed = prevNodes === undefined || nodeSig(prevNodes, prevLinks) !== nodeSig(board.nodes, board.links);
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
    nodes: board.nodes, links: board.links || [], updated: at,
  }, (body || '## Board log') + '\n');

  if (changed) {
    // Every mutation lands in the event log (docs/08_MODULE_CONTRACTS.md §1). A pan is not a
    // mutation, which is the same rule `rev` follows and for the same reason.
    try {
      logEvent({
        type: 'update', actor,
        target: 'projects/' + id + '/board.md',
        detail: { nodes: board.nodes.length, links: (board.links || []).length, what: logLine || 'board saved' },
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
  return { next: (prefix = 'n') => prefix + (++seq).toString(36), commit: () => { board.seq = seq; } };
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
  if (base != null && base !== '' && Number(base) !== cur.rev) throw new BoardConflict({ ...cur, ...resolved(cur.nodes, cur.links) });

  // A record card that arrives without a size is BORN at the board's card size: taller, with room
  // for the picture, when its record has one. Decided here rather than in `cleanNode` (which is a
  // pure sanitiser and reads no documents) so a card an agent places and one a person drags in
  // come out the same.
  const sized = raw => {
    if (!raw || raw.t !== 'document' || (raw.w != null && raw.h != null)) return raw;
    const rel = safeRel(raw.path);
    let size = BOARD_CARD.plain;
    try {
      const d = rel ? documentAt(rel) : null;
      if (d && coverOf(d, collectionsOf(d))) size = BOARD_CARD.picture;
      // nothing to read but a name and a property or two: a full-height card would be an empty box
      else if (d && raw.t === 'document' && !(d.summary || firstParagraph(d.content))) size = BOARD_CARD.compact;
    } catch { /* sized as a plain card */ }
    return { ...raw, ...size };
  };

  const next = { ...cur };
  const m = minter(next);
  const used = new Set();
  const wants = new Set((Array.isArray(body && body.nodes) ? body.nodes : []).map(r => safeId(r && r.id)).filter(Boolean));
  for (const k of PATCHABLE) {
    if (!body || !(k in body)) continue;
    if (k === 'view') next.view = cleanView(body.view);
    if (k === 'nodes') {
      next.nodes = (Array.isArray(body.nodes) ? body.nodes : []).map(raw => {
        // A node arriving without an id is a new one — the client places it, the document names it.
        // A duplicated id is renamed rather than dropped, because losing a card is worse than
        // renaming one, and selection keys off the id the server hands back.
        // An id may also be chosen by whoever places the node (the canvas does, so it can link to
        // a note it has only just made; an agent editing the file does). The counter never hands
        // out one that is already taken.
        const wanted = safeId(raw && raw.id);
        let id2 = wanted;
        if (!id2 || used.has(id2)) { do { id2 = m.next(); } while (used.has(id2) || wants.has(id2)); }
        used.add(id2);
        return cleanNode(sized(raw), id2);
      }).filter(Boolean);
    }
  }
  // Links are checked against the nodes THIS save leaves on the board — after the node list is
  // settled, whichever of the two the body carried. Removing a card therefore removes the lines
  // drawn to it in the same write, with nothing for the caller to remember.
  next.links = cleanLinks(body && 'links' in body ? body.links : cur.links, next.nodes, () => m.next('l'));
  m.commit();

  const saved = write(bid, next, { log: String((body && body.log) || ''), prevNodes: cur.nodes, prevLinks: cur.links, actor: who });
  Object.assign(saved, resolved(saved.nodes, saved.links));
  return saved;
}

// ── what a node is called ──────────────────────────────────────────────────────────────────────
// The words a person would use for a thing on the board: a record's title, a note's or a shape's
// own text, a frame's name. Never an id — an id means nothing to anyone reading a description.
const squash = (v, max = 80) => { const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max - 1) + '…' : t; };
export function nodeName(n, cards = {}) {
  if (!n) return '?';
  if (RECORD_KINDS.includes(n.t)) return (cards[n.path] && cards[n.path].title) || n.path;
  if (n.t === 'note') return squash(n.text) || 'an empty note';
  if (n.t === 'text') return squash(n.text);
  if (n.t === 'shape') return squash(n.text) || 'an empty ' + n.shape;
  if (n.t === 'frame') return squash(n.label) || 'an unnamed group';
  if (n.t === 'collection-view') return 'the ' + n.collection + (n.view ? ' · ' + n.view : '') + ' list';
  if (n.t === 'image') return squash(n.alt) || 'a picture';
  if (n.t === 'draw') return 'a drawn stroke';
  return n.t;
}
const ARROW = { none: ' — ', arrow: ' → ', both: ' ↔ ' };

// A compact, agent-facing digest: what is on this board and what it SAYS, without the coordinates.
// An agent asked "what is on the board" does not need four hundred integers; it needs the records,
// the facts between them (`edges`, read from the records), and the diagram a person drew on top:
// the words (`texts`, `notes`, `shapes`) and every drawn link as "A → B: label" with real names.
// Strokes are counted, not described — a scribble has no words in it.
export function describeBoard(id) {
  const b = getBoard(id);
  const counts = {};
  for (const n of b.nodes) counts[n.t] = (counts[n.t] || 0) + 1;
  const byId = new Map(b.nodes.map(n => [n.id, n]));
  const name = nid => nodeName(byId.get(nid), b.cards);
  return {
    board: b.board,
    counts, total: b.nodes.length,
    documents: b.nodes.filter(n => RECORD_KINDS.includes(n.t)).map(n => ((b.cards[n.path] || {}).title) || n.path),
    edges: b.edges.map(e => name(e.from) + ' —' + e.field + '→ ' + name(e.to)),
    links: b.links.map(l => name(l.from) + (ARROW[l.ends] || ARROW.arrow) + name(l.to) + (l.label ? ': ' + l.label : '')),
    notes: b.nodes.filter(n => n.t === 'note').map(n => squash(n.text, 400)).filter(Boolean).slice(0, 40),
    texts: b.nodes.filter(n => n.t === 'text').map(n => squash(n.text, 400)).filter(Boolean).slice(0, 60),
    shapes: b.nodes.filter(n => n.t === 'shape').map(n => n.shape + ': ' + (squash(n.text, 200) || '(empty)')).slice(0, 60),
    groups: b.nodes.filter(n => n.t === 'frame' && n.label).map(n => squash(n.label, 120)),
    strokes: counts.draw || 0,
    updated: b.updated,
  };
}

// ── making a drawn link real ───────────────────────────────────────────────────────────────────
// A drawn link between two RECORD cards can sometimes be said by the records themselves: when one
// record's collection has a relation field that targets the other's. Then — and only then — the
// board offers one explicit action: set that field. `linkOffers` finds those; nothing is written
// until a person asks (`realiseLink`).
//
// The link's own direction is tried first (the record it starts at holds the pointer); if that
// collection has no such field, the other direction is tried, because a person who drags from
// Acme to Ana means "these belong together", not "Acme has a field for Ana". A relation the
// records already state is not offered — the derived edge is already on the board saying it.
export function linkOffers(links, nodes, { docs = null, collections = null } = {}) {
  const out = {};
  const byId = new Map((nodes || []).map(n => [n.id, n]));
  const candidates = (links || []).filter(l => {
    const a = byId.get(l.from), b = byId.get(l.to);
    return a && b && RECORD_KINDS.includes(a.t) && RECORD_KINDS.includes(b.t) && a.path !== b.path;
  });
  if (!candidates.length) return out;
  const all = docs || allDocuments();
  const schemas = collections || listCollections();
  const docByPath = new Map(all.map(d => [d.path, d]));
  for (const l of candidates) {
    const a = docByPath.get(byId.get(l.from).path), b = docByPath.get(byId.get(l.to).path);
    if (!a || !b) continue;
    for (const [holder, target] of [[a, b], [b, a]]) {
      const targetIn = new Set(collectionsOf(target, schemas));
      let hit = null;
      for (const cid of collectionsOf(holder, schemas)) {
        const c = schemas.find(x => x.id === cid);
        const f = c && (c.fields || []).find(x => x && x.type === 'relation' && targetIn.has(x.target));
        if (f) { hit = { c, f }; break; }
      }
      if (!hit) continue;
      const has = [].concat(holder.data[hit.f.key] ?? []).map(String);
      if (has.includes(target.slug)) break;            // already true: the derived edge says so
      const label = humanise(hit.f.label || hit.f.key);
      const holderTitle = titleFor(holder, collectionsOf(holder, schemas));
      const targetTitle = titleFor(target, collectionsOf(target, schemas));
      out[l.id] = {
        link: l.id, path: holder.path, title: holderTitle, collection: hit.c.id,
        field: hit.f.key, label, many: !!hit.f.many,
        target: target.path, targetTitle, value: target.slug,
        sentence: hit.f.many
          ? 'Add ' + targetTitle + ' to ' + label + ' on ' + holderTitle
          : 'Set ' + label + ' on ' + holderTitle + ' to ' + targetTitle,
      };
      break;
    }
  }
  return out;
}

export class BoardRefusal extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// The one action that turns a drawn link into a fact. The record is written by `patchRecord` —
// the function behind `PATCH /api/records`, the door the record page saves through — so the gate,
// provenance (`updated_by`), the event log and the hot-cache invalidation all happen exactly as
// they do for an edit made on the record's own page. Then the drawn link is taken off the board:
// the derived edge now says the same thing, and two lines for one fact is a lie about how many
// facts there are. A person only: an agent may draw a link, but may not use one to write a record.
export async function realiseLink(id, linkId, { actor = DEFAULT_ACTOR } = {}) {
  const who = String(actor || DEFAULT_ACTOR).trim() || DEFAULT_ACTOR;
  if (isAgentActor(who)) throw new BoardRefusal('Only a person can turn a drawn link into a relation on a record.', 403);
  const bid = safeScope(id) || 'main';
  const board = getBoard(bid);
  if (board.foreign) throw new BoardForeign(bid);
  const lid = safeId(linkId);
  if (!board.links.some(l => l.id === lid)) throw new BoardRefusal('There is no drawn link "' + lid + '" on this board.', 404);
  const offer = board.offers[lid];
  if (!offer) throw new BoardRefusal('No relation field can say what this link says, so there is nothing to set.', 409);

  const holder = documentAt(offer.path);
  if (!holder) throw new BoardRefusal(offer.path + ' is gone.', 404);
  const had = [].concat(holder.data[offer.field] ?? []).map(String).filter(Boolean);
  const value = offer.many ? [...new Set([...had, offer.value])] : offer.value;
  const record = await patchRecord(offer.path, { [offer.field]: value }, { actor: who });

  const saved = saveBoard(bid, {
    links: board.links.filter(l => l.id !== lid),
    log: 'made a drawn link real — ' + offer.sentence,
  }, { actor: who });
  return { ...saved, realised: { ...offer, replaced: offer.many ? null : (had[0] || null) }, record: { path: record.path, rev: record.rev } };
}

// ── what a record is related to ────────────────────────────────────────────────────────────────
// "Show related" on a card: the records this one points AT, and the ones that point at IT. Both
// halves come from the one resolver the inspector's REFERENCED BY and the board's edges already
// use (`referencesTo`), so a card brought in this way is guaranteed to draw an edge when it lands:
//   in   referencesTo(this)                       — who points at me
//   out  every document T where referencesTo(T) includes this one — who I point at
// For `out` the store is not scanned once per document: a record can only point at something by
// naming it, so the candidates are the documents whose slug or `id` appears among this record's
// frontmatter values, and `referencesTo` then gives the verdict (and the field) for each.
const RELATED_LIMIT = 24;
export function relatedTo(relPath, { docs = null, collections = null } = {}) {
  const rel = safeRel(relPath);
  const all = docs || allDocuments();
  const schemas = collections || listCollections();
  const self = all.find(d => d.path === rel);
  if (!self) return { path: rel, missing: true, in: [], out: [], more: 0 };

  const shape = (r, direction) => ({
    path: r.path, title: r.title, field: r.field, label: labelOfField(schemas, r.collection, r.field),
    declared: !!r.declared, collection: r.collection || null, direction,
  });
  const incoming = referencesTo(self, { docs: all, collections: schemas }).map(r => shape(r, 'in'));

  const named = new Set();
  for (const raw of Object.values(self.data || {})) {
    for (const v of Array.isArray(raw) ? raw : [raw]) if (typeof v === 'string' || typeof v === 'number') named.add(String(v));
  }
  const outgoing = [];
  for (const t of all) {
    if (t.path === self.path) continue;
    if (!named.has(t.slug) && !(t.data && t.data.id != null && named.has(String(t.data.id)))) continue;
    for (const r of referencesTo(t, { docs: all, collections: schemas })) {
      if (r.path !== self.path) continue;
      const inCollections = collectionsOf(t, schemas);
      outgoing.push({
        path: t.path, title: titleFor(t, inCollections), field: r.field, label: labelOfField(schemas, r.collection, r.field),
        declared: !!r.declared, collection: inCollections[0] || null, direction: 'out',
      });
    }
  }
  // Declared relations first — they are the ones somebody modelled on purpose — then the rest.
  const order = (a, b) => (b.declared - a.declared) || String(a.title).localeCompare(String(b.title));
  outgoing.sort(order); incoming.sort(order);
  const seen = new Set();
  const take = list => list.filter(x => (seen.has(x.path) ? false : (seen.add(x.path), true)));
  const out = take(outgoing), inn = take(incoming);
  const total = out.length + inn.length;
  const keepOut = out.slice(0, RELATED_LIMIT);
  const keepIn = inn.slice(0, Math.max(0, RELATED_LIMIT - keepOut.length));
  return { path: self.path, missing: false, out: keepOut, in: keepIn, more: total - keepOut.length - keepIn.length };
}

// The lattice the canvas snaps to, exported so a caller placing a node from the server side lands
// on the same grid as a hand-placed one.
export { GRID };

// ── routes ─────────────────────────────────────────────────────────────────────────────────────
// The read and the save match `frontend/api.js` (`api.scoutBoard` / `api.saveScoutBoard`); the rest
// are the board's own. Nothing here holds logic: an agent's save and the canvas's save run identical code, which is the rule that
// keeps auto-align from having two implementations.
export function registerScoutBoardRoutes(app, deps = {}) {
  const activity = deps.appendActivity || appendActivity;

  app.get('/api/scout/board/:id', (req, res) => {
    try { res.json(getBoard(req.params.id)); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  // GET /api/scout/board/:id/describe — the board in words: what is on it and what the diagram says.
  app.get('/api/scout/board/:id/describe', (req, res) => {
    try { res.json(describeBoard(req.params.id)); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  // POST /api/scout/board/:id/links/:link/realise — set the relation a drawn link stands for, then
  // remove the drawn link. A worker's own identity wins over anything the body claims, the same
  // rule `records.mjs` applies at its door.
  app.post('/api/scout/board/:id/links/:link/realise', async (req, res) => {
    const who = String((currentWorkerIdentity() && currentWorkerIdentity().actor) || (req.body && req.body.actor) || DEFAULT_ACTOR);
    try {
      const out = await realiseLink(req.params.id, req.params.link, { actor: who });
      activity({ dot: 'green', t: 'Relation set from the whiteboard', t2: '· ' + out.board, s: out.realised.sentence, kind: 'proj', ref: out.board });
      res.json(out);
    } catch (e) {
      if (e.code === 'foreign') return res.status(409).json({ error: e.message, code: 'foreign' });
      res.status(e.status || 400).json({ error: e.message });
    }
  });

  // GET /api/scout/board/:id/related?path=  — what "Show related" brings in. Read-only.
  app.get('/api/scout/board/:id/related', (req, res) => {
    try { res.json(relatedTo(String(req.query.path || ''))); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  // POST /api/scout/board/:id/image?name=  (raw bytes) — a picture dropped, pasted or picked onto
  // the board. It is stored like every other attachment — content-addressed under `files/`, by the
  // one writer of that folder (attachments.mjs) — and the answer is the workspace-relative path an
  // `image` node then carries. Nothing is written to the board here; placing the node is a save.
  app.post('/api/scout/board/:id/image', raw({ type: '*/*', limit: '60mb' }), (req, res) => {
    try {
      const saved = storeAttachment(req.body, { type: String(req.headers['content-type'] || ''), name: String(req.query.name || '') });
      res.json({ path: saved.path, size: saved.size, existed: saved.existed });
    } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
  });

  app.put('/api/scout/board/:id', (req, res) => {
    const body = req.body || {};
    try {
      const saved = saveBoard(req.params.id, body, { actor: body.actor });
      if (saved.changed) {
        activity({
          dot: 'green', t: 'Whiteboard saved', t2: '· ' + saved.board,
          s: (body.log || 'nodes changed') + ' — ' + saved.nodes.length + ' node' + (saved.nodes.length === 1 ? '' : 's')
            + ', ' + saved.edges.length + ' relation' + (saved.edges.length === 1 ? '' : 's')
            + (saved.links.length ? ', ' + saved.links.length + ' drawn link' + (saved.links.length === 1 ? '' : 's') : ''),
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
