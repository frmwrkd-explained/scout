// shared/collectionShape.mjs — how collections relate to each other, read off their schemas.
//
// PURE and imported by BOTH sides (backend/subcollections.mjs writes with it, frontend/Rail.jsx and
// frontend/Subtables.jsx draw with it), so "is this a sub-collection of that" has one answer.
//
// The model (docs/02_DATA_MODEL.md §4): a SUB-COLLECTION is a collection whose records each belong
// to a record of another collection through a relation field. `person.company → company` makes
// People a sub-collection of Companies. The PARENT's schema says so, as a subtable:
//
//     subtables: [{ id: 'person', label: 'People', collection: 'person', bind: { company: '$self' } }]
//
// `bind` names the child's relation field; `$self` is the parent record being looked at. Nothing
// else is stored: the subtable is the inverse side of the relation, not a second copy of it.

// The eight hues a collection may be identified by (frontend/styles.css `--hue-*`).
export const HUES = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'];

export const SELF = '$self';

// The child field a subtable binds to the parent record: the key whose value is `$self`.
export function relationKeyOf(subtable) {
  const bind = (subtable && subtable.bind) || {};
  return Object.keys(bind).find(key => bind[key] === SELF) || null;
}

// A collection's subtables, normalised: only entries that name a child collection and a relation
// key survive, each as { id, label, collection, key, bind }. A malformed entry is dropped here
// rather than crashing whoever draws it — the schema file stays as the person wrote it.
export function subtablesOf(collection) {
  const list = Array.isArray(collection && collection.subtables) ? collection.subtables : [];
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const child = String(entry.collection || entry.id || '');
    const key = relationKeyOf(entry);
    if (!child || !key) continue;
    out.push({ id: String(entry.id || child), label: entry.label || child, collection: child, key, bind: entry.bind });
  }
  return out;
}

// Every collection that lists `collectionId` as a sub-collection.
export function parentsOf(collectionId, collections = []) {
  return collections.filter(c => subtablesOf(c).some(s => s.collection === collectionId));
}

// Everything below a collection, however deep. `seen` makes a hand-edited cycle terminate.
export function descendantsOf(collectionId, collections = [], seen = new Set()) {
  const self = collections.find(c => c.id === collectionId);
  for (const sub of subtablesOf(self)) {
    if (seen.has(sub.collection)) continue;
    seen.add(sub.collection);
    descendantsOf(sub.collection, collections, seen);
  }
  return seen;
}

// The sidebar's order: top-level collections, each followed by its sub-collections, indented.
// → [{ collection, depth, parent }]. EVERY COLLECTION IS LISTED ONCE. A child with several parents
// (Messages under People, under Deals and under Companies) sits under the shallowest one — the
// first in file order on a tie — because a sidebar that prints Messages three times reads as three
// different things. Its sub-tables still show on every parent's record page; only the sidebar
// de-duplicates. A collection that is only ever a child does not also appear at the top. A cycle
// written by hand is cut where it would repeat, and a collection nothing reaches is listed at the
// top so it is never hidden.
export function collectionTree(collections = []) {
  const byId = new Map(collections.map(c => [c.id, c]));
  const kids = c => [...new Set(subtablesOf(c).map(s => s.collection))].map(id => byId.get(id)).filter(Boolean);
  const isChild = new Set(collections.flatMap(c => kids(c).map(k => k.id)));
  // Breadth-first, so the first parent to reach a child is its shallowest.
  const placed = new Set();
  const home = new Map();   // child id → the one parent it is listed under
  const place = roots => {
    let level = roots.filter(c => !placed.has(c.id));
    for (const c of level) placed.add(c.id);
    while (level.length) {
      const next = [];
      for (const parent of level) for (const child of kids(parent)) {
        if (placed.has(child.id)) continue;
        placed.add(child.id); home.set(child.id, parent.id); next.push(child);
      }
      level = next;
    }
  };
  const tops = collections.filter(c => !isChild.has(c.id));
  place(tops);
  for (const c of collections) if (!placed.has(c.id)) { tops.push(c); place([c]); }   // only reachable through a cycle
  const out = [];
  const walk = (collection, depth, parent) => {
    out.push({ collection, depth, parent });
    for (const child of kids(collection)) if (home.get(child.id) === collection.id) walk(child, depth + 1, collection.id);
  };
  for (const c of tops) walk(c, 0, null);
  return out;
}

// The folder a collection's records live in, read off its query (`data/people/**` → `data/people`).
export function folderOf(collection) {
  const glob = String((collection && collection.query && collection.query.path) || '');
  const kept = [];
  for (const seg of glob.split('/')) { if (!seg || seg.includes('*')) break; kept.push(seg); }
  return kept.length ? kept.join('/') : (collection && collection.id ? 'data/' + collection.id : '');
}
