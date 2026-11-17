// Changing and retiring a property from the views: what the human's door promises.
//   · a rename changes the label, never the key, and never touches a document;
//   · a type change is allowed only where the stored value still reads sensibly;
//   · removing a field leaves its value in every file, and takes it out of the saved views;
//   · the title and the gate cannot be removed or re-typed;
//   · an agent is refused, and the refusal is in the log.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, req, readMd, getStorageRoot, fs, path } from './helpers.mjs';
import { saveCollection, getCollection, updateField, removeField, TYPE_CHANGES, FIELD_TYPES } from '../backend/collections.mjs';
import { saveView, listViews, scrubFieldFromViews } from '../backend/views.mjs';
import { upsertRecord } from '../backend/records.mjs';
import { readEvents } from '../backend/log.mjs';

const SCHEMA = {
  id: 'people', label: 'People', query: { path: 'data/people/**' },
  fields: [
    { key: 'name', type: 'text', primary: true },
    { key: 'stage', type: 'status', gate: true, options: [{ value: 'new', group: 'todo' }, { value: 'shortlist', group: 'active' }, { value: 'won', group: 'done' }] },
    { key: 'role', type: 'text' },
    { key: 'city', type: 'select', options: ['manila', 'cebu'] },
    { key: 'tags', type: 'multiselect' },
    { key: 'photo', type: 'file', primary_media: true },
    { key: 'notes', type: 'text', multiline: true },
  ],
};
const fieldOf = (collection, key) => (collection.fields || []).find(f => f.key === key);
const recordFile = slug => path.join(getStorageRoot(), 'data', 'people', slug + '.md');
function seed() {
  freshRoot();
  saveCollection(SCHEMA);
  upsertRecord({ collection: 'people', name: 'Maria Santos', role: 'Producer', city: 'manila', tags: ['video'], notes: 'First line.\nSecond line.' });
}

test('a rename changes the label, keeps the key, and leaves every document alone', () => {
  seed();
  const before = fs.readFileSync(recordFile('maria-santos'), 'utf8');
  const saved = updateField('people', 'role', { label: 'Job title' });
  assert.deepEqual(fieldOf(saved, 'role'), { key: 'role', type: 'text', label: 'Job title' });
  assert.deepEqual(saved.fields.map(f => f.key), SCHEMA.fields.map(f => f.key), 'order and keys are unchanged');
  assert.equal(fs.readFileSync(recordFile('maria-santos'), 'utf8'), before, 'the record file is byte-identical');
  // Clearing the label goes back to the key; it is not stored as an empty string.
  assert.equal(fieldOf(updateField('people', 'role', { label: '  ' }), 'role').label, undefined);
  assert.throws(() => updateField('people', 'role', { key: 'job' }), /key cannot change/);
  assert.throws(() => updateField('people', 'nope', { label: 'x' }), e => e.status === 404);
  assert.throws(() => updateField('nope', 'role', { label: 'x' }), e => e.status === 404);
});

test('a type changes only where the stored value still reads, and sheds what the new type cannot carry', () => {
  seed();
  // text → select needs its choices, and gets them from the same patch.
  assert.throws(() => updateField('people', 'role', { type: 'select' }), /needs a non-empty options/);
  const asSelect = updateField('people', 'role', { type: 'select', options: ['Producer', 'Editor'] });
  assert.deepEqual(fieldOf(asSelect, 'role'), { key: 'role', type: 'select', options: ['Producer', 'Editor'] });
  // select → text drops `options`; a multiline text → url drops `multiline`.
  assert.deepEqual(fieldOf(updateField('people', 'role', { type: 'text' }), 'role'), { key: 'role', type: 'text' });
  assert.deepEqual(fieldOf(updateField('people', 'notes', { type: 'url' }), 'notes'), { key: 'notes', type: 'url' });
  // one choice can become many, and keeps its list
  assert.deepEqual(fieldOf(updateField('people', 'city', { type: 'multiselect' }), 'city').options, ['manila', 'cebu']);
  // The stored value never moved.
  assert.equal(readMd(recordFile('maria-santos')).data.role, 'Producer');

  assert.throws(() => updateField('people', 'photo', { type: 'text' }), /a file field cannot become text\. Its type is fixed/);
  assert.throws(() => updateField('people', 'tags', { type: 'number' }), /cannot become number\. It can become: select · text/);
  assert.throws(() => updateField('people', 'role', { type: 'sparkle' }), /unknown field type "sparkle"/);
  // An option the type does not have is still refused, not silently stored.
  assert.throws(() => updateField('people', 'role', { multilne: true }), /"multilne" is not an option of type text/);
  // Options and flags of the SAME type change freely.
  assert.equal(fieldOf(updateField('people', 'role', { multiline: true }), 'role').multiline, true);
  assert.equal(fieldOf(updateField('people', 'role', { multiline: null }), 'role').multiline, undefined);

  // Every listed change names a real type, so the picker can never offer one the server refuses.
  for (const [from, to] of Object.entries(TYPE_CHANGES)) {
    assert.ok(FIELD_TYPES[from], from);
    for (const t of to) assert.ok(FIELD_TYPES[t] && t !== from, from + ' → ' + t);
  }
});

test('the title and the gate are fixed points', () => {
  seed();
  assert.equal(fieldOf(updateField('people', 'name', { label: 'Full name' }), 'name').label, 'Full name', 'the title can be relabelled');
  assert.throws(() => updateField('people', 'name', { type: 'url' }), /title field stays text/);
  assert.throws(() => updateField('people', 'name', { primary: false }), /cannot be moved/);
  assert.throws(() => updateField('people', 'role', { primary: true }), /cannot be moved/);
  assert.throws(() => updateField('people', 'stage', { type: 'select' }), /gate field — its type cannot change/);
  assert.throws(() => updateField('people', 'stage', { gate: false }), /cannot be switched on or off/);
  assert.throws(() => removeField('people', 'name'), /title of every record/);
  assert.throws(() => removeField('people', 'stage'), /gate field/);
  assert.equal(getCollection('people').fields.length, SCHEMA.fields.length);
});

test('removing a field keeps its value in the file and takes it out of the saved views', async () => {
  seed();
  saveView('people', { id: 'all', label: 'Everything', type: 'table', fields: ['name', 'role', 'city'], widths: { name: 300, role: 180 },
    filter: [{ field: 'role', op: 'is', value: 'Producer' }, { field: 'city', op: 'is', value: 'manila' }], sort: [{ field: 'role', dir: 'asc' }], group: 'role' });
  saveView('people', { id: 'faces', label: 'Faces', type: 'gallery', cover: 'photo', fields: ['city'], card: { fields: ['role', 'city'] }, filter: [], sort: [] });

  const r = await req('DELETE', '/api/collections/people/fields/role', { actor: 'crystal' });
  assert.equal(r.status, 200);
  assert.ok(!r.body.fields.some(f => f.key === 'role'));
  assert.equal(r.body.views, 2, 'both saved views named it');

  // Law 8 / never delete: the value is still in the document, as a key the schema no longer declares.
  assert.equal(readMd(recordFile('maria-santos')).data.role, 'Producer');

  const [all, faces] = listViews('people').views;
  assert.deepEqual(all.fields, ['name', 'city']);
  assert.deepEqual(all.widths, { name: 300 });
  assert.deepEqual(all.filter, [{ field: 'city', op: 'is', value: 'manila' }]);
  assert.deepEqual(all.sort, []);
  assert.equal(all.group, null);
  assert.deepEqual(faces.card.fields, ['city']);
  // A scrubbed view saves again without complaint — that is the whole point of scrubbing it.
  saveView('people', { ...all, size: 'l' });

  // The cover falls back to the schema's picture rather than to "no picture".
  await req('DELETE', '/api/collections/people/fields/photo', { actor: 'crystal' });
  assert.equal(listViews('people').views[1].cover, undefined);
  assert.equal(scrubFieldFromViews('people', 'never-there'), 0);
  assert.equal((await req('DELETE', '/api/collections/people/fields/role', {})).status, 404, 'a field that is already gone is a 404');
});

test('something that still points at a removed field is named, not rewritten', () => {
  seed();
  saveCollection({ id: 'firms', label: 'Firms', query: { path: 'data/firms/**' },
    subtables: [{ id: 'staff', label: 'Staff', collection: 'people', bind: { firm: '$self' } }],
    fields: [{ key: 'name', type: 'text', primary: true }, { key: 'staff', type: 'relation', target: 'people', many: true, inverse: 'firm' }] });
  updateField('people', 'role', { type: 'text' });
  saveCollection({ ...getCollection('people'), fields: [...getCollection('people').fields, { key: 'firm', type: 'relation', target: 'firms' }] });
  const saved = removeField('people', 'firm');
  assert.equal(saved.warnings.length, 2);
  assert.match(saved.warnings.join(' | '), /#firms `staff` names `firm` as its inverse/);
  assert.match(saved.warnings.join(' | '), /#firms lists these records as "Staff" through `firm`/);
  assert.equal(getCollection('firms').fields[1].inverse, 'firm', 'the other schema is untouched');
});

test('the routes change the schema for the operator, log it, and refuse an agent', async () => {
  seed();
  const types = await req('GET', '/api/field-types');
  assert.deepEqual(types.body.changes.text, TYPE_CHANGES.text);
  assert.ok(types.body.types.includes('relation'));

  const ok = await req('PATCH', '/api/collections/people/fields/city', { actor: 'crystal', label: 'Home city', options: ['manila', 'cebu', 'davao'] });
  assert.equal(ok.status, 200);
  assert.deepEqual(fieldOf(ok.body, 'city'), { key: 'city', type: 'select', options: ['manila', 'cebu', 'davao'], label: 'Home city' });
  assert.equal(fieldOf(getCollection('people'), 'city').actor, undefined, '`actor` is who changed it, never part of the field');

  const bad = await req('PATCH', '/api/collections/people/fields/photo', { type: 'text' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /cannot become text/);

  // An assistant proposes; it does not edit a schema. Refused on both verbs, and nothing changed.
  const patched = await req('PATCH', '/api/collections/people/fields/city', { actor: 'scout-fb', label: 'Hacked' });
  const removed = await req('DELETE', '/api/collections/people/fields/city', { actor: 'scout-fb' });
  assert.equal(patched.status, 403);
  assert.equal(removed.status, 403);
  assert.match(patched.body.error, /proposes the change/);
  assert.equal(fieldOf(getCollection('people'), 'city').label, 'Home city');

  const target = '.scout/collections/people.md';
  const schema = readEvents({ target, type: 'schema' });
  assert.ok(schema.some(e => e.actor === 'crystal' && e.detail.change === 'field-update' && e.detail.field === 'city' && e.detail.changed.includes('label')));
  const refused = readEvents({ target, type: 'refused' });
  assert.deepEqual(refused.map(e => e.detail.change).sort(), ['change', 'remove'], 'both attempts are in Activity');
  assert.ok(refused.every(e => e.actor === 'scout-fb'));

  const gone = await req('DELETE', '/api/collections/people/fields/tags?actor=crystal');
  assert.equal(gone.status, 200);
  assert.ok(readEvents({ target, type: 'schema' }).some(e => e.detail.change === 'field-remove' && e.detail.field === 'tags'));
});
