// Documents — resolving a collection's query to a record set. T02 §5 + T03.
//
// A collection is a SAVED QUERY (docs/02_DATA_MODEL.md §1). A document belongs to a collection
// because it MATCHES — it is never moved into one, and it may belong to several at once. Nothing
// in here writes a document file: that is records.mjs's job alone (M2), and until it exists this
// module is read-only on purpose.
//
// Rollups and formulas are DERIVED. They are computed on read, cached in .scout/cache/computed.json,
// and never written into frontmatter as authority. **Frontmatter always wins over the cache** —
// asserted in tests/phase-collections.test.mjs, because the day that inverts is the day the cache
// stops being disposable and the "files are the truth" law quietly dies.

import fs from 'node:fs';
import path from 'node:path';
import { getStorageRoot, readMd } from './store.mjs';
import { getCollection, listCollections, fieldOf, primaryField, AUTO_FIELDS } from './collections.mjs';

const R = () => getStorageRoot();
const cacheDir = () => path.join(R(), '.scout', 'cache');
const computedFile = () => path.join(cacheDir(), 'computed.json');

// ── walking the store ──────────────────────────────────────────────────────────────────────────
// Everything under the root except .scout/ (disposable), _inbox/ (not yet through the pipeline)
// and files/ (attachments). One pass, cached per request by the caller if it matters.

const SKIP_DIRS = new Set(['.scout', '_inbox', 'files', 'node_modules', '.git']);

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.startsWith('._')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (e.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

export function allDocuments() {
  const root = R();
  return walk(root).map(file => {
    try {
      const { data, content } = readMd(file);
      const rel = path.relative(root, file).split(path.sep).join('/');
      return { path: rel, slug: path.basename(file, '.md'), data, content };
    } catch {
      // A malformed file is quarantined, never fatal — one bad record costs one record.
      return null;
    }
  }).filter(Boolean);
}

// ── query matching ─────────────────────────────────────────────────────────────────────────────
// Any combination of: tag · path glob · frontmatter filter (docs/02_DATA_MODEL.md §1).

// One pass, no sentinel character. The obvious two-pass version needs a placeholder to protect
// `**` from the `*` rule, and a raw NUL is the tempting choice — but a control byte makes the whole
// file BINARY to grep, which then returns nothing, silently, exit 1, on any search of this module.
// docs/FRAMEFORGE_CLAUDE.md documents that exact bug costing hours in backend/store.mjs. This
// version cannot regress into it.
function globToRe(glob) {
  const esc = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = esc.replace(/\*\*|\*/g, m => (m === '**' ? '.*' : '[^/]*'));
  return new RegExp('^' + body + '$');
}

export function matchesQuery(doc, query) {
  if (!query || typeof query !== 'object') return false;
  let touched = false;

  if (query.tag) {
    touched = true;
    const want = [].concat(query.tag);
    const have = [].concat(doc.data.tags || doc.data.tag || []).map(String);
    if (!want.every(t => have.includes(String(t)))) return false;
  }
  if (query.path) {
    touched = true;
    if (!globToRe(query.path).test(doc.path)) return false;
  }
  if (query.where && typeof query.where === 'object') {
    touched = true;
    for (const [k, v] of Object.entries(query.where)) {
      if (String(doc.data[k] ?? '') !== String(v)) return false;
    }
  }
  // A query that constrains nothing would match every file in the store, which is never what
  // anyone meant — it is a schema bug, not an "everything" collection.
  return touched;
}

// ── derived values ─────────────────────────────────────────────────────────────────────────────

function rollup(field, doc, index) {
  const via = field.via;
  const ids = [].concat(doc.data[via] ?? []).map(String).filter(Boolean);
  const rows = ids.map(id => index.bySlug.get(id)).filter(Boolean);
  const vals = rows.map(r => r.data[field.target_field]).filter(v => v !== undefined && v !== null);
  const nums = vals.map(Number).filter(n => !Number.isNaN(n));
  switch (field.fn) {
    case 'count': return rows.length;
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'avg': return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    case 'min': return nums.length ? Math.min(...nums) : null;
    case 'max': return nums.length ? Math.max(...nums) : null;
    case 'latest': return vals.length ? vals.map(String).sort().at(-1) : null;
    default: return null;
  }
}

// Sandboxed, pure, no I/O (docs/02_DATA_MODEL.md §2). Deliberately tiny: arithmetic and field
// references over the document's own values. An escape hatch — prefer a rollup.
function formula(field, doc) {
  const expr = String(field.expr || '');
  if (!/^[\w\s.+\-*/()%,?:<>=!'"]+$/.test(expr)) return null;
  const names = [...new Set(expr.match(/[a-z_][a-z0-9_]*/gi) || [])];
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(...names, '"use strict"; return (' + expr + ');');
    return fn(...names.map(n => doc.data[n]));
  } catch { return null; }
}

export function computeDerived(collection, doc, index) {
  const out = {};
  for (const f of collection.fields || []) {
    if (f.type !== 'rollup' && f.type !== 'formula') continue;
    // FRONTMATTER ALWAYS WINS. A human (or an agent) who wrote a value into the file meant it,
    // and the cache is disposable — the reverse would make a derived cache authoritative.
    if (doc.data[f.key] !== undefined) continue;
    out[f.key] = f.type === 'rollup' ? rollup(f, doc, index) : formula(f, doc);
  }
  return out;
}

// ── the public read path ───────────────────────────────────────────────────────────────────────

function buildIndex(docs) {
  const bySlug = new Map();
  for (const d of docs) if (!bySlug.has(d.slug)) bySlug.set(d.slug, d);
  return { bySlug };
}

export function documentsFor(collectionId, { bind = null } = {}) {
  const collection = getCollection(collectionId);
  if (!collection) return null;
  const all = allDocuments();
  const index = buildIndex(all);
  let rows = all.filter(d => matchesQuery(d, collection.query));

  // A subtable is a collection with a bound parameter — one mechanism, no second storage (§4).
  if (bind && typeof bind === 'object') {
    rows = rows.filter(d => Object.entries(bind).every(([k, v]) => {
      const have = d.data[k];
      return Array.isArray(have) ? have.map(String).includes(String(v)) : String(have ?? '') === String(v);
    }));
  }

  const prim = primaryField(collection);
  const shaped = rows.map(d => ({
    slug: d.slug,
    path: d.path,
    title: (prim && d.data[prim.key]) || d.data.name || d.slug,
    fields: { ...d.data, ...computeDerived(collection, d, index) },
    summary: firstParagraph(d.content),
  }));
  writeComputedCache(collectionId, shaped);
  return { collection, documents: shaped };
}


// ── one collection, through one view, with the quarantine rule applied ────────────────────────
//
// THE one composition of documentsFor + the view + the quarantine split. It was assembled inline
// in `backend/index.mjs`'s route and again in `backend/mcp.mjs`'s tool — the same six lines, in
// two doors, where forgetting `excludeQuarantined` in either one would let a record an agent wrote
// around the pipeline be counted as real (Law 4). A guarantee that has to be re-assembled per
// caller is not a guarantee.
//
//   all: true   returns the whole collection with the view's FILTER dropped — for resolving a
//               RELATION, which must not depend on what somebody last saved as the default view.
//
// Imports live inside the function: views.mjs and records.mjs both reach back into this module,
// and a top-level import either way would be a load-order cycle.
export async function viewFor(collectionId, { view = null, bind = null, all = false } = {}) {
  const [{ getView, defaultView, applyView }, { excludeQuarantined }] = await Promise.all([
    import('./views.mjs'), import('./records.mjs'),
  ]);
  const found = documentsFor(collectionId, { bind });
  if (!found) return null;
  const chosen = getView(collectionId, view || null) || defaultView(found.collection);
  const clean = excludeQuarantined(found.documents);
  const held = found.documents.filter(d => !clean.includes(d));
  const applied = all
    ? { rows: applyView({ ...chosen, filter: [], group: null }, clean).rows, groups: null }
    : applyView(chosen, clean);
  return {
    collection: found.collection,
    view: chosen,
    total: clean.length,
    rows: applied.rows,
    groups: applied.groups,
    // Returned, never hidden: concealing a quarantined record would leave the human no way to
    // accept the ones that are fine (Law 8).
    quarantined: held.map(d => ({ path: d.path, slug: d.slug, title: d.title })),
  };
}

export function documentAt(relPath) {
  const root = R();
  const abs = path.resolve(root, relPath);
  // Path safety: a document path arrives from a client and must not escape the store.
  if (!abs.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(abs)) return null;
  const { data, content } = readMd(abs);
  const rel = path.relative(root, abs).split(path.sep).join('/');
  return { path: rel, slug: path.basename(abs, '.md'), data, content, summary: firstParagraph(content) };
}

// The summary is the human sentence the document surface shows first (docs/05_UI_SPEC.md §2.1) —
// the body up to the first blank line, before any heading.
export function firstParagraph(content) {
  const body = String(content || '').trim();
  if (!body) return '';
  const para = body.split(/\n\s*\n/).find(p => p.trim() && !p.trim().startsWith('#'));
  return (para || '').trim().replace(/\s+/g, ' ');
}

// Disposable by construction: delete .scout/cache/ and everything still resolves, because every
// read recomputes. This exists to be inspectable, not to be depended on.
function writeComputedCache(collectionId, shaped) {
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    let all = {};
    try { all = JSON.parse(fs.readFileSync(computedFile(), 'utf8')); } catch { /* first write */ }
    all[collectionId] = Object.fromEntries(shaped.map(d => [d.slug, d.fields]));
    const tmp = computedFile() + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
    fs.renameSync(tmp, computedFile());
  } catch { /* a cache that cannot be written is still only a cache */ }
}

// Which collections does this document belong to? It may be several — that is the point.
export function collectionsOf(doc) {
  return listCollections().filter(c => matchesQuery(doc, c.query)).map(c => c.id);
}

// ── REFERENCED BY ──────────────────────────────────────────────────────────────────────────────
// Which documents point AT this one through their frontmatter (T05 §2).
//
// SCOPE, decided deliberately (docs/decisions.md · D4): this scans frontmatter VALUES, not only the
// fields a collection declares as `type: relation`. T05's Demonstrate is "a guest referenced by a
// territory, a learning and a project brief" — and `territory/` and `learnings/` are MEMORY objects
// (docs/03_MEMORY.md §1), not collection documents, so they have no schema and therefore no
// declared relation field. A declared-relations-only scan could never satisfy that Demonstrate.
// Every entry carries `declared`, so the surface can still render a typed relation differently
// from a loose pointer — which is what T05 means by "structured and typed".
//
// The match is EXACT against the names a document answers to. A substring test would turn every
// prose field that happens to contain a slug into a false backlink, and a backlink nobody can
// explain is worse than a missing one.

// `id`/`slug` are what a document IS, not what it points at. The provenance pair `created_by` /
// `updated_by` is answered by HISTORY (T05 §4) — listing them here would bury the three real
// references under one row per document the same agent ever touched.
const NON_REFERENCE_KEYS = new Set(['id', 'slug', ...AUTO_FIELDS]);

// Relation values are filename slugs — that is what rollup() resolves through — but a memory object
// also declares an `id:` and the two are allowed to differ, so a document answers to both.
function namesOf(doc) {
  return new Set([doc.slug, doc.data && doc.data.id].filter(Boolean).map(String));
}

function titleOf(doc, inCollections, schemas) {
  for (const id of inCollections) {
    const c = schemas.find(x => x.id === id);
    const p = c && primaryField(c);
    if (p && doc.data[p.key]) return String(doc.data[p.key]);
  }
  // Memory objects have no primary field; territory calls it `label`, most others `name`.
  return String(doc.data.label || doc.data.name || doc.data.title || doc.slug);
}

export function referencesTo(target, { docs = null, collections = null } = {}) {
  const all = docs || allDocuments();
  const schemas = collections || listCollections();

  const self = typeof target === 'string'
    ? (all.find(d => d.slug === target || String(d.data.id || '') === target) || { slug: target, path: null, data: {} })
    : target;
  const names = namesOf(self);
  if (!names.size) return [];

  // Which keys each collection declares as a relation — computed once, not once per document.
  const relKeys = new Map(schemas.map(c =>
    [c.id, new Set((c.fields || []).filter(f => f.type === 'relation').map(f => f.key))]));

  const out = [];
  for (const d of all) {
    if (d.path === self.path) continue; // a document never references itself
    const inCollections = schemas.filter(c => matchesQuery(d, c.query)).map(c => c.id);
    for (const [key, raw] of Object.entries(d.data || {})) {
      if (NON_REFERENCE_KEYS.has(key)) continue;
      const vals = Array.isArray(raw) ? raw : [raw];
      if (!vals.some(v => (typeof v === 'string' || typeof v === 'number') && names.has(String(v)))) continue;
      const declaredIn = inCollections.filter(id => relKeys.get(id).has(key));
      const collection = declaredIn[0] || inCollections[0] || null;
      out.push({
        slug: d.slug,
        path: d.path,
        title: titleOf(d, inCollections, schemas),
        field: key,                 // T05: show the pointing field name
        collection,                 // T05: and the source collection
        // Where it came from, for a document that is in no collection at all: its declared `type`,
        // else its top folder. A memory object must still say "territory" rather than nothing.
        source: collection || String(d.data.type || (d.path || '').split('/')[0] || ''),
        declared: declaredIn.length > 0,
        many: Array.isArray(raw),
      });
    }
  }

  // Typed relations first, then by source, title and field — a stable total order, so the section
  // does not reshuffle between two identical reads.
  out.sort((a, b) =>
    (Number(b.declared) - Number(a.declared)) ||
    a.source.localeCompare(b.source) ||
    a.title.localeCompare(b.title) ||
    a.field.localeCompare(b.field));
  return out;
}
