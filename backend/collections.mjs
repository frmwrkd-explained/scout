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
