// backend/subcollections.mjs — a person makes a collection, names and colours it, and nests one
// under another. The writes behind the sidebar's "+ New collection" and "Add sub-collection".
//
// Nothing here turns a schema into bytes: every write goes through `collections.mjs`
// (`saveCollection`, `addField`), which is still the only place a collection file is written and
// the only place a field type is defined. This module decides WHAT to write.
//
// HUMAN-ONLY. An agent proposes a collection, a field or a subtable as a card and a human accepts
// it (`proposals.mjs`, docs/02_DATA_MODEL.md §6). These routes are the human doing it directly —
// she is the disposer — so an agent actor is refused here, the same way the reference import is.
//
// The shape rules (what a subtable is, who is whose parent, the eight hues) live in
// `shared/collectionShape.mjs`, because the sidebar and the record page read the same schemas.

import { getCollection, saveCollection, listCollections, addField } from './collections.mjs';
import { slugify } from './store.mjs';
import { isAgentActor, DEFAULT_ACTOR } from './actors.mjs';
import { currentWorkerIdentity } from './workerScope.mjs';
import { logEvent } from './log.mjs';
import { HUES, SELF, subtablesOf, parentsOf, descendantsOf, relationKeyOf } from '../shared/collectionShape.mjs';
import { cleanPage } from '../shared/recordPage.mjs';

export { HUES, subtablesOf, parentsOf, descendantsOf, relationKeyOf };

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function owner(actor) {
  if (currentWorkerIdentity() || isAgentActor(actor)) fail('Only the operator can create or reshape a collection. An assistant proposes one as a card.', 403);
}
const fileOf = id => '.scout/collections/' + id + '.md';
const log = (actor, id, detail) => logEvent({ type: 'schema', actor, target: fileOf(id), detail });

// A label → a collection id: lower-kebab, starting with a letter (collections.mjs requires both).
export function idFromLabel(label) {
  const words = String(label || '').trim();
  if (!words) fail('Give the collection a name.');
  let id = slugify(words);
  if (id === 'untitled') fail('That name has no letters or numbers in it.');
  if (!/^[a-z]/.test(id)) id = 'c-' + id;
  return id;
}

// A new collection is given the hue the workspace uses LEAST, written into its schema. Left to
// the automatic pick (a hash of the id) three neighbours in a short sidebar can land on the same
// colour; choosing at creation keeps them apart, and writing it down keeps it from ever shifting.
function freshHue() {
  const used = new Map(HUES.map(h => [h, 0]));
  for (const c of listCollections()) if (used.has(c.colour)) used.set(c.colour, used.get(c.colour) + 1);
  return [...used.entries()].sort((a, b) => a[1] - b[1])[0][0];
}

// "Companies" → "Company", "People" → "Person": what one record of a collection is called, for the
// label of the field that points at it. Deliberately small — a wrong guess is one rename away.
function singular(label) {
  const w = String(label || '').trim();
  if (/^people$/i.test(w)) return w[0] === 'P' ? 'Person' : 'person';
  if (/ies$/i.test(w)) return w.slice(0, -3) + 'y';
  if (/(ses|xes|ches|shes)$/i.test(w)) return w.slice(0, -2);
  if (/s$/i.test(w) && !/ss$/i.test(w)) return w.slice(0, -1);
  return w;
}

const starter = (id, label, extra = []) => ({
  id,
  label: String(label).trim(),
  colour: freshHue(),
  query: { path: 'data/' + id + '/**' },
  fields: [{ key: 'name', type: 'text', primary: true, required: true }, ...extra],
});

export function createCollection({ label } = {}, { actor = DEFAULT_ACTOR } = {}) {
  owner(actor);
  const id = idFromLabel(label);
  if (getCollection(id)) fail('There is already a collection called "' + id + '".', 409);
  const saved = saveCollection(starter(id, label));
  log(actor, id, { change: 'collection', label: saved.label });
  return saved;
}

// The label, the colour, and how a record's page looks (`header`, `page`) — and nothing else. A
// route that accepted the whole schema here would be a second, unguarded way to rewrite fields.
export function setCollectionMeta(id, patch = {}, { actor = DEFAULT_ACTOR } = {}) {
  owner(actor);
  const current = getCollection(id);
  if (!current) fail('no collection "' + id + '"', 404);
  const next = { ...current };
  const changed = {};
  if (patch.label !== undefined) {
    const label = String(patch.label || '').trim();
    if (!label) fail('A collection needs a name.');
    if (label !== current.label) { next.label = label; changed.label = label; }
  }
  if (patch.colour !== undefined) {
    if (patch.colour === null || patch.colour === '') { if (current.colour) { delete next.colour; changed.colour = null; } }
    else if (!HUES.includes(patch.colour)) fail('colour "' + patch.colour + '" is not one of ' + HUES.join(' · '));
    else if (patch.colour !== current.colour) { next.colour = patch.colour; changed.colour = patch.colour; }
  }
  // `header` — the properties under the title of every record of this collection, in order
  // (frontend/RecordHeader.jsx). Each must be a field of the collection that can sit there.
  if (patch.header !== undefined) {
    if (patch.header === null) { if (current.header !== undefined) { delete next.header; changed.header = null; } }
    else {
      if (!Array.isArray(patch.header)) fail('header must be a list of field keys');
      const fields = current.fields || [];
      const keys = [...new Set(patch.header.map(String))];
      for (const key of keys) {
        const field = fields.find(f => f.key === key);
        if (!field) fail('header names "' + key + '", which is not a field of ' + id);
        if (field.primary) fail('"' + key + '" is the title — it is already at the top of the page');
        if (field.type === 'file' || field.type === 'json' || (field.type === 'text' && field.multiline)) {
          fail('"' + key + '" is shown as its own block on the page, not as a header property');
        }
      }
      if (JSON.stringify(keys) !== JSON.stringify(current.header)) { next.header = keys; changed.header = keys; }
    }
  }
  // `page` — how every record of this collection is laid out (shared/recordPage.mjs).
  if (patch.page !== undefined) {
    let page;
    try { page = cleanPage(patch.page); } catch (e) { fail(e.message); }
    if (page === null) { if (current.page !== undefined) { delete next.page; changed.page = null; } }
    else if (JSON.stringify(page) !== JSON.stringify(current.page)) { next.page = page; changed.page = page; }
  }
  if (!Object.keys(changed).length) return current;
  // `getCollection` lifts the file's body into `description` and `saveCollection` writes it back
  // as the body, so the round trip keeps it once — never dropped, never doubled into frontmatter.
  const saved = saveCollection(next);
  log(actor, id, { change: 'meta', ...changed });
  return saved;
}

// The relation field on `child` that points at `parentId`, or null.
const relationTo = (child, parentId) => (child.fields || []).find(f => f && f.type === 'relation' && f.target === parentId) || null;

// A field key for "belongs to <parent>" that is free on the child.
function freeKey(child, parentId) {
  const base = parentId.replace(/-/g, '_');
  const taken = new Set((child.fields || []).map(f => f.key));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 50; n++) if (!taken.has(base + '_' + n)) return base + '_' + n;
  fail('could not name a relation field on ' + child.id);
  return null;
}

// Nest a collection under `parentId`: either a NEW one (`label`) or an EXISTING one (`collection`).
// → { parent, child, key, created, linked }.
export function addSubcollection(parentId, { label, collection } = {}, { actor = DEFAULT_ACTOR } = {}) {
  owner(actor);
  const parent = getCollection(parentId);
  if (!parent) fail('no collection "' + parentId + '"', 404);
  const key = parentId.replace(/-/g, '_');
  let child, created = false, relationKey;

  if (collection) {
    child = getCollection(String(collection));
    if (!child) fail('no collection "' + collection + '"', 404);
    if (child.id === parentId) fail('A collection cannot be its own sub-collection.');
    // `person` under `company` is fine; `company` under `person` would then make each the
    // other's ancestor, and the sidebar would nest forever.
    if (descendantsOf(child.id, listCollections()).has(parentId)) {
      fail('"' + parentId + '" is already inside "' + child.id + '" — nesting it the other way round would make a loop.');
    }
    const existing = subtablesOf(parent).find(s => s.collection === child.id);
    if (existing) return { parent, child, key: existing.key, created: false, linked: false };   // idempotent
    const relation = relationTo(child, parentId);
    relationKey = relation ? relation.key : freeKey(child, parentId);
    if (!relation) {
      child = addField(child.id, { key: relationKey, type: 'relation', target: parentId, label: singular(parent.label || parentId) });
      log(actor, child.id, { change: 'field', field: relationKey, field_type: 'relation', target: parentId });
    }
  } else {
    const id = idFromLabel(label);
    if (id === parentId) fail('A collection cannot be its own sub-collection.');
    if (getCollection(id)) fail('There is already a collection called "' + id + '". Link it instead of creating it again.', 409);
    relationKey = key;
    child = saveCollection(starter(id, label, [{ key: relationKey, type: 'relation', target: parentId, label: singular(parent.label || parentId) }]));
    created = true;
    log(actor, id, { change: 'collection', label: child.label, parent: parentId });
  }

  const entry = { id: child.id, label: child.label || child.id, collection: child.id, bind: { [relationKey]: SELF } };
  const saved = saveCollection({ ...parent, subtables: [...(Array.isArray(parent.subtables) ? parent.subtables : []), entry] });
  log(actor, parentId, { change: 'subtable', subtable: child.id, field: relationKey });
  return { parent: saved, child, key: relationKey, created, linked: true };
}

// Un-nest. Only the parent's subtable entry goes: the child collection, its relation field and
// every record stay exactly where they are.
export function removeSubcollection(parentId, childId, { actor = DEFAULT_ACTOR } = {}) {
  owner(actor);
  const parent = getCollection(parentId);
  if (!parent) fail('no collection "' + parentId + '"', 404);
  const list = Array.isArray(parent.subtables) ? parent.subtables : [];
  const next = list.filter(s => String((s && (s.collection || s.id)) || '') !== String(childId));
  if (next.length === list.length) return parent;
  const { subtables, ...rest } = parent;
  const saved = saveCollection(next.length ? { ...rest, subtables: next } : rest);
  log(actor, parentId, { change: 'subtable-removed', subtable: String(childId) });
  return saved;
}

export default { createCollection, setCollectionMeta, addSubcollection, removeSubcollection, idFromLabel, HUES };
