// Collections and field types — T02.
//
// THE ONLY PLACE A FIELD TYPE IS DEFINED. `docs/02_DATA_MODEL.md` §2 is the prose; this file is
// the machine copy. If you are about to write a field type anywhere else in this codebase, you
// are creating the second source of truth CLAUDE.md's table exists to prevent.
//
// A collection is a SAVED QUERY, not a folder (§1). A document belongs to a collection because it
// matches the query — it is never "moved into" one, and it may match several.
//
// The schema IS the frontmatter of `.scout/collections/<id>.md`.

import fs from 'node:fs';
import path from 'node:path';
import { getStorageRoot, readMd, writeMd, safe } from './store.mjs';

const R = () => getStorageRoot();
export const collectionsDir = () => path.join(R(), '.scout', 'collections');
const collectionFile = id => path.join(collectionsDir(), safe(id) + '.md');

// ── the field types ────────────────────────────────────────────────────────────────────────────
// Exactly the set in docs/02_DATA_MODEL.md §2, in that order. `opts` lists the option keys a field
// of this type may carry; anything else on the field is rejected so a typo cannot sit silently in
// a schema for weeks. `derived` marks the two types that are COMPUTED ON READ and never authored.
export const FIELD_TYPES = {
  text:        { opts: ['multiline'] },
  number:      { opts: ['display', 'min', 'max', 'precision'], displays: ['plain', 'bar', 'stars', 'currency'] },
  select:      { opts: ['options'] },
  // AN OPEN VOCABULARY WHEN IT DECLARES NO `options[]` — a tag field, where the next tag is legal
  // because the person typed it. `select` and `status` still require options: they are a fixed set
  // with a colour, and a status option is also a board column, so an undeclared one has nowhere to
  // render. Declared options on a multiselect are still validated. (docs/decisions.md, "seeding
  // ambiguity 1", resolved in favour of the open vocabulary — the shipped `#guest` collection has
  // shipped `tags: multiselect` with no options since M1, and the old rule made every later write
  // of that schema, including every `+ Add property`, a 400 naming a field nobody had touched.)
  multiselect: { opts: ['options'] },
  // NOT the same as select: `group` drives board columns, "what's open", and completion counts.
  status:      { opts: ['options', 'gate'], groups: ['todo', 'active', 'done'] },
  date:        { opts: ['display', 'time'], displays: ['absolute', 'relative', 'freshness'] },
  checkbox:    { opts: [] },
  url:         { opts: [] },
  email:       { opts: [] },
  phone:       { opts: [] },
  relation:    { opts: ['target', 'many', 'inverse'] },
  rollup:      { opts: ['via', 'target_field', 'fn'], fns: ['count', 'sum', 'avg', 'min', 'max', 'latest'], derived: true },
  formula:     { opts: ['expr'], derived: true },
  file:        { opts: ['many', 'primary_media'] },
  // The orchestration type: a task assigned to `scout-fb` is how a person directs a team.
  actor:       { opts: ['kinds'] },
  json:        { opts: [] },
};
export const FIELD_TYPE_NAMES = Object.keys(FIELD_TYPES);

// Every document carries these, always, and they are never declared in a schema (§2).
// `updated_by` is load-bearing: it is how Law 4 ignores an agent-authored promotion.
export const AUTO_FIELDS = ['created', 'updated', 'created_by', 'updated_by', 'verified_at', 'proposed', 'quarantined'];

// ── validation ─────────────────────────────────────────────────────────────────────────────────

class SchemaError extends Error {
  constructor(msg) { super(msg); this.status = 400; }
}

function validateField(f, i, { collectionIds }) {
  const where = 'fields[' + i + ']' + (f && f.key ? ' (' + f.key + ')' : '');
  if (!f || typeof f !== 'object') throw new SchemaError(where + ' must be an object');
  if (!f.key || !/^[a-z][a-z0-9_]*$/.test(f.key)) {
    throw new SchemaError(where + ': key must be lower_snake_case and start with a letter');
  }
  if (AUTO_FIELDS.includes(f.key)) {
    throw new SchemaError(where + ': "' + f.key + '" is an automatic field on every document — do not declare it');
  }
  const def = FIELD_TYPES[f.type];
  // Naming the legal set in the error is required by T02 — a bare "unknown type" makes the
  // caller go and read the source to find out what it was allowed to say.
  if (!def) {
    throw new SchemaError(where + ': unknown field type "' + f.type + '". Legal types are: ' + FIELD_TYPE_NAMES.join(' · '));
  }

  const allowed = new Set([...def.opts, 'key', 'type', 'label', 'required', 'primary', 'description']);
  for (const k of Object.keys(f)) {
    if (!allowed.has(k)) {
      throw new SchemaError(where + ': "' + k + '" is not an option of type ' + f.type + '. Allowed: ' + def.opts.join(' · '));
    }
  }
  if (def.displays && f.display && !def.displays.includes(f.display)) {
    throw new SchemaError(where + ': display "' + f.display + '" is not one of ' + def.displays.join(' · '));
  }
  if (def.fns && f.fn && !def.fns.includes(f.fn)) {
    throw new SchemaError(where + ': fn "' + f.fn + '" is not one of ' + def.fns.join(' · '));
  }
  // A fixed set is required for `select` and `status` and OPTIONAL for `multiselect` (see the type
  // table above). Whatever IS declared is validated, on all three — an open vocabulary is a field
  // with no options, never a field with a broken one.
  if (f.type === 'select' || f.type === 'status') {
    if (!Array.isArray(f.options) || !f.options.length) {
      throw new SchemaError(where + ': ' + f.type + ' needs a non-empty options[]');
    }
  }
  if (f.options !== undefined && !Array.isArray(f.options)) {
    throw new SchemaError(where + ': options must be a list, not ' + typeof f.options);
  }
  if (Array.isArray(f.options)) {
    for (const o of f.options) {
      const v = typeof o === 'string' ? o : o && o.value;
      if (!v) throw new SchemaError(where + ': every option needs a value');
      if (f.type === 'status' && typeof o === 'object' && o.group && !FIELD_TYPES.status.groups.includes(o.group)) {
        throw new SchemaError(where + ': option "' + v + '" has group "' + o.group + '" — must be one of ' + FIELD_TYPES.status.groups.join(' · '));
      }
    }
  }
  if (f.type === 'relation') {
    if (!f.target) throw new SchemaError(where + ': relation needs a target collection');
    // Checked against what actually exists on disk, not against a list in a doc.
    if (collectionIds && !collectionIds.includes(f.target)) {
      throw new SchemaError(where + ': relation target "' + f.target + '" is not a collection. Existing: ' + (collectionIds.join(' · ') || '(none)'));
    }
  }
  if (f.type === 'rollup' && !f.via) throw new SchemaError(where + ': rollup needs `via` (the relation field it walks)');
  if (f.type === 'formula' && !f.expr) throw new SchemaError(where + ': formula needs `expr`');
}

// The preamble every door shares: a collection is an object, with a kebab-case id and at least one
// field. Returns the fields so callers do not re-reach for them.
function schemaFields(schema) {
  if (!schema || typeof schema !== 'object') throw new SchemaError('a collection must be an object');
  if (!schema.id || !/^[a-z][a-z0-9-]*$/.test(schema.id)) throw new SchemaError('id must be lower-kebab-case');
  const fields = schema.fields;
  if (!Array.isArray(fields) || !fields.length) throw new SchemaError('a collection needs at least one field');
  return fields;
}

// The shape of the collection itself, independent of whether each field is well formed: no
// duplicate keys, exactly one primary, at most one gate. Split out from the per-field pass because
// `addField` needs THESE checked over the whole schema while only the field being added is checked
// in full — see addField().
function validateInvariants(schema) {
  const fields = schemaFields(schema);

  const keys = fields.map(f => f && f.key);
  const dupe = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dupe) throw new SchemaError('duplicate field key "' + dupe + '"');

  const primaries = fields.filter(f => f && f.primary);
  if (primaries.length !== 1) {
    throw new SchemaError('a collection has exactly one primary: true field (the document title) — found ' + primaries.length);
  }
  const gates = fields.filter(f => f && f.gate);
  if (gates.length > 1) throw new SchemaError('at most one gate: true status field — found ' + gates.length);
  if (gates.length && gates[0].type !== 'status') throw new SchemaError('gate: true belongs on a status field, not a ' + gates[0].type);
  return fields;
}

// A relation may point at the collection being written, which is not on disk yet on create.
function knownCollectionIds(...extra) {
  return [...new Set([...listCollectionIds(), ...extra].filter(Boolean))];
}

export function validateSchema(schema, { selfId = null } = {}) {
  const fields = schemaFields(schema);
  const collectionIds = knownCollectionIds(selfId, schema.id);
  // Per-field FIRST, then the schema-level invariants. The per-field message is the one anybody
  // actually reads — it names what that type DOES allow — and reversing the two turns
  // `gate: true` on a text field into the vaguer whole-schema complaint.
  fields.forEach((f, i) => validateField(f, i, { collectionIds }));
  validateInvariants(schema);
  return schema;
}

// ── read / write ───────────────────────────────────────────────────────────────────────────────

export function listCollectionIds() {
  try {
    return fs.readdirSync(collectionsDir()).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).sort();
  } catch { return []; }
}

export function getCollection(id) {
  const file = collectionFile(id);
  if (!fs.existsSync(file)) return null;
  try {
    const { data, content } = readMd(file);
    return { ...data, id: data.id || id, description: content.trim() || undefined };
  } catch {
    // Readers swallow parse errors by design — a malformed schema must not take out the list.
    return { id, broken: true, fields: [] };
  }
}

export function listCollections() {
  return listCollectionIds().map(getCollection).filter(Boolean);
}

// The ONE writer of a collection file. Both doors below validate their own way and land here, so
// there is a single place that turns a schema into bytes.
function writeCollection(schema) {
  const { description, ...frontmatter } = schema;
  writeMd(collectionFile(schema.id), frontmatter, description ? description + '\n' : '');
  return getCollection(schema.id);
}

export function saveCollection(schema) {
  const existing = getCollection(schema.id);
  validateSchema(schema, { selfId: existing ? schema.id : null });
  return writeCollection(schema);
}

// Adding a field never rewrites existing documents. Missing = empty (§2).
//
// This validates THE FIELD BEING ADDED in full, plus the schema-level invariants — and deliberately
// does NOT re-validate the siblings that were already on disk. It used to, through saveCollection,
// and the shipped `#guest` collection declares `tags: multiselect` with no options[]: under the old
// rule that field was invalid, so EVERY later write of that schema 400ed with
// `fields[7] (tags): multiselect needs a non-empty options[]`. `+ Add property` had therefore never
// worked on the shipped collection, for the human (AddField.jsx) or for an accepted agent `schema`
// card (GOAL gate 8) — and the error named a field nobody had touched.
//
// A bad neighbour is now NAMED and returned as a warning rather than allowed to block a write that
// was not aimed at it. Not silent (Law 8), not fatal.
export function addField(id, field) {
  const c = getCollection(id);
  if (!c) throw new SchemaError('no collection "' + id + '"');
  if (!field || typeof field !== 'object' || Array.isArray(field)) {
    throw new SchemaError('a field is an object: { key, type, ... }');
  }
  const fields = [...(c.fields || [])];
  if (fields.some(f => f && f.key === field.key)) throw new SchemaError('field "' + field.key + '" already exists on ' + id);

  const collectionIds = knownCollectionIds(id);
  validateField(field, fields.length, { collectionIds });
  const next = { ...c, fields: [...fields, field] };
  validateInvariants(next);

  const warnings = [];
  fields.forEach((f, i) => {
    try { validateField(f, i, { collectionIds }); }
    catch (e) { warnings.push('existing field `' + ((f && f.key) || i) + '` is invalid: ' + e.message); }
  });
  const saved = writeCollection(next);
  return warnings.length ? { ...saved, warnings } : saved;
}

// ── changing and retiring a field ──────────────────────────────────────────────────────────────
// `docs/04_AGENT_CONTRACT.md` §4 says never change a field's type on live data, and that stays true
// for AGENTS: an agent proposes a schema change and it lands as a card. These two are the human's
// door (`backend/schemaRoutes.mjs` refuses an agent), and both keep the rule §2 already states for
// adding a field: **a schema change never rewrites a document.** That is what makes them safe:
//
//   · the KEY never changes. A "rename" changes the `label`. Changing the key would orphan the
//     value in every file that already carries it, silently, in one write;
//   · a type change re-reads the same stored value through a different renderer. Nothing on disk
//     moves, so changing it back is always possible;
//   · removing a field removes it from the SCHEMA. The value stays in every file's frontmatter and
//     still shows on the record, as an undeclared key (Law 8, and "never delete a user file").
//
// What a field of one type may become. Only pairs where the stored value still reads sensibly:
// a string stays a string, one choice can become many. A type that is not listed cannot change —
// a relation is a link, a file is a path, a rollup is computed; none of them is "just a value".
export const TYPE_CHANGES = {
  text: ['select', 'multiselect', 'number', 'date', 'url', 'email', 'phone'],
  number: ['text'],
  select: ['multiselect', 'status', 'text'],
  multiselect: ['select', 'text'],
  status: ['select'],
  date: ['text'],
  checkbox: ['text'],
  url: ['text', 'email', 'phone'],
  email: ['text', 'url', 'phone'],
  phone: ['text', 'url', 'email'],
};

// Keys every field may carry whatever its type — the same list validateField allows.
const COMMON_FIELD_KEYS = ['key', 'type', 'label', 'required', 'primary', 'description'];

function locateField(id, key) {
  const c = getCollection(id);
  if (!c) throw Object.assign(new SchemaError('no collection "' + id + '"'), { status: 404 });
  const fields = [...(c.fields || [])];
  const at = fields.findIndex(f => f && f.key === key);
  if (at < 0) throw Object.assign(new SchemaError('no field "' + key + '" on ' + id), { status: 404 });
  return { c, fields, at, field: fields[at] };
}

// Same rule as addField: the field being written is validated in full; a neighbour that was
// already invalid is NAMED in `warnings` rather than allowed to block a write not aimed at it.
function neighbourWarnings(fields, skip, collectionIds) {
  const warnings = [];
  fields.forEach((f, i) => {
    if (i === skip) return;
    try { validateField(f, i, { collectionIds }); }
    catch (e) { warnings.push('existing field `' + ((f && f.key) || i) + '` is invalid: ' + e.message); }
  });
  return warnings;
}

// `patch` is the keys to change. `null` (or '') removes an optional key — that is how a label is
// cleared back to the key. Anything the resulting type does not allow is dropped when the TYPE
// changes (select → text loses `options`), and is refused by validateField when it does not.
export function updateField(id, key, patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new SchemaError('a field change is an object: { label, type, options, … }');
  const { c, fields, at, field } = locateField(id, key);

  if (patch.key !== undefined && patch.key !== key) {
    throw new SchemaError('a field\'s key cannot change — every document already stores its value under "' + key + '". Change its label instead.');
  }
  if (patch.primary !== undefined && !!patch.primary !== !!field.primary) {
    throw new SchemaError('the title field is set when a collection is made and cannot be moved here');
  }
  if (patch.gate !== undefined && !!patch.gate !== !!field.gate) {
    throw new SchemaError('the gate is what the promotion rule guards — it cannot be switched on or off here');
  }

  const type = patch.type || field.type;
  if (type !== field.type) {
    if (field.primary) throw new SchemaError('the title field stays text');
    if (field.gate) throw new SchemaError('"' + key + '" is the gate field — its type cannot change');
    if (!FIELD_TYPES[type]) {
      throw new SchemaError('unknown field type "' + type + '". Legal types are: ' + FIELD_TYPE_NAMES.join(' · '));
    }
    const allowed = TYPE_CHANGES[field.type] || [];
    if (!allowed.includes(type)) {
      throw new SchemaError('a ' + field.type + ' field cannot become ' + type + '. '
        + (allowed.length ? 'It can become: ' + allowed.join(' · ') + '.' : 'Its type is fixed — add a new property instead.'));
    }
  }

  const next = { ...field, ...patch, key, type };
  for (const [k, v] of Object.entries(patch)) if (v === null || v === undefined || (k === 'label' && String(v).trim() === '')) delete next[k];
  if (typeof next.label === 'string') next.label = next.label.trim();
  if (type !== field.type) {
    const keep = new Set([...FIELD_TYPES[type].opts, ...COMMON_FIELD_KEYS]);
    for (const k of Object.keys(next)) if (!keep.has(k)) delete next[k];
  }

  const collectionIds = knownCollectionIds(id);
  validateField(next, at, { collectionIds });
  const schema = { ...c, fields: fields.map((f, i) => (i === at ? next : f)) };
  validateInvariants(schema);

  const warnings = neighbourWarnings(schema.fields, at, collectionIds);
  const saved = writeCollection(schema);
  return warnings.length ? { ...saved, warnings } : saved;
}

// Removes the field from the schema and nothing else. Saved views that name it are scrubbed by the
// caller (`views.mjs` `scrubFieldFromViews`, called from `schemaRoutes.mjs`) — that lives there
// because views.mjs already imports this module, and the other direction would be a cycle.
// Other collections that point at this field are NOT rewritten: they are listed in `warnings`, so
// the person sees what now dangles instead of having three schemas change under one click.
export function removeField(id, key) {
  const { c, fields, at, field } = locateField(id, key);
  if (field.primary) throw new SchemaError('"' + key + '" is the title of every record in this collection — it cannot be removed');
  if (field.gate) throw new SchemaError('"' + key + '" is the gate field — the promotion rule depends on it, so it cannot be removed');

  const schema = { ...c, fields: fields.filter((_, i) => i !== at) };
  validateInvariants(schema);

  const warnings = [];
  for (const f of schema.fields) {
    if (f.type === 'rollup' && f.via === key) warnings.push('`' + f.key + '` rolls up through `' + key + '` and now has nothing to walk');
  }
  for (const other of listCollections()) {
    if (other.broken) continue;
    for (const f of other.fields || []) {
      if (other.id !== id && f.type === 'relation' && f.target === id && f.inverse === key) {
        warnings.push('#' + other.id + ' `' + f.key + '` names `' + key + '` as its inverse');
      }
      const via = f.type === 'rollup' ? (other.fields || []).find(x => x.key === f.via) : null;
      if (via && via.type === 'relation' && via.target === id && f.target_field === key) {
        warnings.push('#' + other.id + ' `' + f.key + '` rolls up `' + key + '`');
      }
    }
    for (const sub of other.subtables || []) {
      if (sub && sub.collection === id && sub.bind && Object.prototype.hasOwnProperty.call(sub.bind, key)) {
        warnings.push('#' + other.id + ' lists these records as "' + (sub.label || sub.id) + '" through `' + key + '`');
      }
    }
  }

  const saved = writeCollection(schema);
  return warnings.length ? { ...saved, warnings } : saved;
}

export function fieldOf(collection, key) {
  return (collection.fields || []).find(f => f.key === key) || null;
}
export function primaryField(collection) {
  return (collection.fields || []).find(f => f.primary) || null;
}
export function gateField(collection) {
  return (collection.fields || []).find(f => f.gate && f.type === 'status') || null;
}

export { SchemaError };
