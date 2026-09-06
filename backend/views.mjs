// Saved views — T03.
//
// A view is a saved query-plus-presentation, stored IN THE VAULT at `.scout/views/<collection>.json`
// (docs/02_DATA_MODEL.md §3) so views travel with the data and an agent can write one. That is the
// whole reason this is not a settings key.
//
// The default view is INFERRED FROM SHAPE, never asked. A new person should never have to pick a
// view type before they have seen their data.

import fs from 'node:fs';
import path from 'node:path';
import { getStorageRoot, safe } from './store.mjs';
import { getCollection, fieldOf } from './collections.mjs';

const R = () => getStorageRoot();
const viewsDir = () => path.join(R(), '.scout', 'views');
const viewsFile = id => path.join(viewsDir(), safe(id) + '.json');

export const VIEW_TYPES = ['table', 'board', 'list', 'gallery'];

class ViewError extends Error {
  constructor(msg) { super(msg); this.status = 400; }
}

// ── the shape rule ─────────────────────────────────────────────────────────────────────────────
// docs/02_DATA_MODEL.md §3, in order. The person can change it; they should never have to pick one
// to get started.
export function inferViewType(collection) {
  const fields = collection.fields || [];
  const status = fields.find(f => f.type === 'status');
  if (status && (status.options || []).length > 2) return 'board';
  if (fields.some(f => f.type === 'file' && f.primary_media)) return 'gallery';
  if (fields.some(f => f.type === 'date') && !status) return 'list';
  return 'table';
}

// The columns a table opens with when nobody has said otherwise: the title, the gate, and whatever
// carries a number or a freshness date — the three things the collapsed row shows anyway.
function defaultFields(collection) {
  const fields = collection.fields || [];
  const pick = [];
  const prim = fields.find(f => f.primary);
  if (prim) pick.push(prim.key);
  const gate = fields.find(f => f.gate);
  if (gate) pick.push(gate.key);
  for (const f of fields) {
    if (pick.length >= 6) break;
    if (pick.includes(f.key)) continue;
    if (f.type === 'number' || f.type === 'relation' || (f.type === 'date' && f.display === 'freshness') || f.type === 'multiselect') pick.push(f.key);
  }
  return pick;
}

export function defaultView(collection) {
  const type = inferViewType(collection);
  const gate = (collection.fields || []).find(f => f.gate);
  return {
    id: 'all',
    label: 'Everything',
    type,
    filter: [],
    sort: [],
    group: type === 'board' && gate ? gate.key : null,
    fields: defaultFields(collection),
    card: null,
    density: 'compact',
    generated: true, // not on disk — recomputed until someone saves a real one
  };
}

// ── read / write ───────────────────────────────────────────────────────────────────────────────

function readFile(id) {
  try {
    const raw = fs.readFileSync(viewsFile(id), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : (parsed.views || []);
  } catch { return []; }
}

// A dangling `default_view` is announced once per process rather than printed on every read — the
// rail calls listViews on every collection switch, and a warning that repeats is a warning nobody
// reads.
const announced = new Set();

export function listViews(collectionId) {
  const collection = getCollection(collectionId);
  if (!collection) return null;
  const saved = readFile(collectionId);
  // Always at least one view. A collection with no saved views is the normal first-run case, not
  // an error state, and it must still open on something.
  const views = saved.length ? saved : [defaultView(collection)];
  const wantedDefault = collection.default_view;
  const dflt = views.find(v => v.id === wantedDefault) || views[0];

  // A schema naming a view that does not exist used to fall through in silence: App.pickCollection
  // does `Math.max(0, views.findIndex(...))`, so the dangling id resolved to index 0 and the person
  // was shown a different view than the collection asked for, forever, with nothing said. The
  // shipped `#guest` declared `default_view: needs-review` and no views file was ever written, so
  // that was the first-run experience. Law 8: never silent.
  const warnings = [];
  if (wantedDefault && dflt.id !== wantedDefault) {
    const line = '#' + collectionId + ' names default_view "' + wantedDefault
      + '", which is not one of: ' + views.map(v => v.id).join(' · ')
      + '. Opening on "' + dflt.id + '" instead.';
    warnings.push(line);
    const key = collectionId + '\u0000' + wantedDefault + '\u0000' + views.map(v => v.id).join(',');
    if (!announced.has(key)) { announced.add(key); console.warn('scout · views · ' + line); }
  }
  return { collection, views, defaultViewId: dflt.id, warnings };
}

export function getView(collectionId, viewId) {
  const found = listViews(collectionId);
  if (!found) return null;
  return found.views.find(v => v.id === (viewId || found.defaultViewId)) || found.views[0] || null;
}

function validateView(collection, view) {
  if (!view || typeof view !== 'object') throw new ViewError('a view must be an object');
  if (!view.id || !/^[a-z][a-z0-9-]*$/.test(view.id)) throw new ViewError('view id must be lower-kebab-case');
  if (view.type && !VIEW_TYPES.includes(view.type)) {
    throw new ViewError('view type "' + view.type + '" is not one of ' + VIEW_TYPES.join(' · '));
  }
  const known = k => !!fieldOf(collection, k) || ['created', 'updated', 'verified_at', 'created_by', 'updated_by'].includes(k);
  for (const f of view.filter || []) {
    if (!known(f.field)) throw new ViewError('filter references unknown field "' + f.field + '"');
  }
  for (const s of view.sort || []) {
    if (!known(s.field)) throw new ViewError('sort references unknown field "' + s.field + '"');
  }
  for (const k of view.fields || []) {
    if (!known(k)) throw new ViewError('view shows unknown field "' + k + '"');
  }
  if (view.group && !known(view.group)) throw new ViewError('group references unknown field "' + view.group + '"');
  return view;
}

export function saveView(collectionId, view) {
  const collection = getCollection(collectionId);
  if (!collection) throw new ViewError('no collection "' + collectionId + '"');
  validateView(collection, view);
  // Replace IN PLACE. Filtering the old one out and appending re-ordered the strip on every
  // save, so switching a view's shape or its density made its tab jump to the end of the row —
  // the control moved because you used it. Only a genuinely new view appends.
  const saved = readFile(collectionId);
  const at = saved.findIndex(v => v.id === view.id);
  const entry = { ...view, generated: undefined };
  const next = at >= 0
    ? saved.map((v, i) => (i === at ? entry : v))
    : [...saved, entry];
  fs.mkdirSync(viewsDir(), { recursive: true });
  // tmp + rename, like every other write in this codebase: a half-written views file would not
  // error on read, it would silently resolve to zero views.
  const tmp = viewsFile(collectionId) + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
  fs.renameSync(tmp, viewsFile(collectionId));
  return next;
}

export function deleteView(collectionId, viewId) {
  const saved = readFile(collectionId);
  const next = saved.filter(v => v.id !== viewId);
  if (next.length === saved.length) return next;
  fs.mkdirSync(viewsDir(), { recursive: true });
  const tmp = viewsFile(collectionId) + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
  fs.renameSync(tmp, viewsFile(collectionId));
  return next;
}

// ── applying a view to a document set ──────────────────────────────────────────────────────────

const OPS = {
  is: (a, b) => String(a ?? '') === String(b),
  'is-not': (a, b) => String(a ?? '') !== String(b),
  contains: (a, b) => [].concat(a ?? []).map(String).includes(String(b)),
  gt: (a, b) => Number(a) > Number(b),
  lt: (a, b) => Number(a) < Number(b),
  gte: (a, b) => Number(a) >= Number(b),
  lte: (a, b) => Number(a) <= Number(b),
  empty: a => a === undefined || a === null || a === '' || (Array.isArray(a) && !a.length),
  'not-empty': a => !OPS.empty(a),
};

export function applyView(view, documents) {
  let rows = documents;
  for (const f of view.filter || []) {
    const op = OPS[f.op] || OPS.is;
    rows = rows.filter(d => op(d.fields[f.field], f.value));
  }
  for (const s of [...(view.sort || [])].reverse()) {
    const dir = s.dir === 'desc' ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const x = a.fields[s.field], y = b.fields[s.field];
      if (x === y) return 0;
      if (x === undefined || x === null || x === '') return 1;   // empties sink, either direction
      if (y === undefined || y === null || y === '') return -1;
      const nx = Number(x), ny = Number(y);
      if (!Number.isNaN(nx) && !Number.isNaN(ny)) return (nx - ny) * dir;
      return String(x).localeCompare(String(y)) * dir;
    });
  }
  if (!view.group) return { rows, groups: null };
  const groups = new Map();
  for (const d of rows) {
    const k = String(d.fields[view.group] ?? '');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(d);
  }
  return { rows, groups: [...groups].map(([key, items]) => ({ key, items })) };
}

export { ViewError };
