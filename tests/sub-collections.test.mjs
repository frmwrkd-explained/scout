// Collections a person makes by hand, and sub-collections (docs/02_DATA_MODEL.md §4).
//
// "People in a company": `person` carries a relation to `company`, the company's schema declares
// the subtable, and `?bind=` answers exactly one company's people. Nothing here is a new storage
// concept — these tests pin that the hand-made path writes the SAME two things an accepted agent
// proposal writes (a relation field and a subtable entry), and nothing else.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { freshRoot, req, getStorageRoot, readMd, path } from './helpers.mjs';
import { getCollection, saveCollection } from '../backend/collections.mjs';
import { HUES, subtablesOf, parentsOf, descendantsOf, collectionTree, relationKeyOf, folderOf } from '../shared/collectionShape.mjs';
import { hueOf, colourOf, collectionLabel } from '../frontend/collectionColour.js';
import { TOKENS, LIGHT } from '../frontend/tokens.js';

const schemaFile = id => path.join(getStorageRoot(), '.scout', 'collections', id + '.md');
const create = label => req('POST', '/api/collections/create', { label, actor: 'crystal' });
const nest = (parent, body) => req('POST', '/api/collections/' + parent + '/subcollections', { actor: 'crystal', ...body });

test('a person makes a collection by naming it', async () => {
  freshRoot();
  const r = await create('Client Companies');
  assert.equal(r.status, 200);
  assert.equal(r.body.id, 'client-companies');
  assert.equal(r.body.label, 'Client Companies');
  assert.deepEqual(r.body.query, { path: 'data/client-companies/**' });
  assert.deepEqual(r.body.fields, [{ key: 'name', type: 'text', primary: true, required: true }]);
  assert.equal(folderOf(r.body), 'data/client-companies');

  assert.equal((await create('Client Companies')).status, 409, 'the same name twice is refused, not overwritten');
  assert.equal((await create('   ')).status, 400);
  assert.equal((await create('2026 Shoots')).body.id, 'c-2026-shoots', 'an id must start with a letter');
  // It is a real collection: listed, and records can be written into it through the pipeline.
  const list = await req('GET', '/api/collections');
  assert.ok(list.body.collections.some(c => c.id === 'client-companies'));
  const rec = await req('POST', '/api/records/upsert', { collection: 'client-companies', name: 'Acme', actor: 'crystal' });
  assert.equal(rec.body.path, 'data/client-companies/acme.md');
});

test('the name and the colour change, and nothing else does', async () => {
  freshRoot();
  saveCollection({ id: 'company', label: 'Companies', query: { path: 'data/company/**' },
    fields: [{ key: 'name', type: 'text', primary: true }, { key: 'site', type: 'url' }],
    description: 'Who we work for.\n\nSecond paragraph.' });

  const r = await req('PATCH', '/api/collections/company/meta', { label: 'Clients', colour: 'teal', fields: [], id: 'hacked', actor: 'crystal' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.id, r.body.label, r.body.colour], ['company', 'Clients', 'teal']);
  assert.equal(r.body.fields.length, 2, 'a meta write cannot touch the fields');
  // The description is the file's BODY. It survives once: not dropped, not copied into frontmatter.
  const onDisk = readMd(schemaFile('company'));
  assert.equal(onDisk.content.trim(), 'Who we work for.\n\nSecond paragraph.');
  assert.equal(onDisk.data.description, undefined);
  assert.equal(getCollection('company').description, 'Who we work for.\n\nSecond paragraph.');

  assert.equal((await req('PATCH', '/api/collections/company/meta', { colour: 'chartreuse', actor: 'crystal' })).status, 400);
  assert.equal((await req('PATCH', '/api/collections/company/meta', { label: ' ', actor: 'crystal' })).status, 400);
  const cleared = await req('PATCH', '/api/collections/company/meta', { colour: null, actor: 'crystal' });
  assert.equal(cleared.body.colour, undefined, 'null clears the colour back to automatic');
  assert.equal((await req('PATCH', '/api/collections/nope/meta', { label: 'x', actor: 'crystal' })).status, 404);
});

test('a new sub-collection is a relation on the child and a subtable on the parent', async () => {
  freshRoot();
  await create('Company');
  const r = await nest('company', { label: 'People' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.child.id, r.body.key, r.body.created, r.body.linked], ['people', 'company', true, true]);

  const people = getCollection('people');
  // The field that points at the parent is named for ONE of its records, and the new collection
  // is given a hue of its own rather than whatever its id hashes to.
  const pointer = people.fields.find(f => f.key === 'company');
  assert.deepEqual([pointer.type, pointer.target], ['relation', 'company']);
  assert.ok(typeof pointer.label === 'string' && pointer.label.length > 0);
  assert.match(people.colour, /^(red|orange|amber|green|teal|blue|violet|pink)$/);
  assert.ok(people.fields.find(f => f.key === 'name').primary);
  const company = getCollection('company');
  assert.deepEqual(company.subtables, [{ id: 'people', label: 'People', collection: 'people', bind: { company: '$self' } }]);
  assert.deepEqual(subtablesOf(company).map(s => [s.collection, s.key]), [['people', 'company']]);
  assert.equal(relationKeyOf(company.subtables[0]), 'company');

  assert.equal((await nest('company', { label: 'People' })).status, 409, 'a second "People" is refused — link the one that exists');
  assert.equal((await nest('nope', { label: 'X' })).status, 404);
});

test('an existing collection is nested by reusing its relation, or by adding one', async () => {
  freshRoot();
  await create('Company');
  saveCollection({ id: 'contact', label: 'Contacts', query: { path: 'data/contact/**' },
    fields: [{ key: 'name', type: 'text', primary: true }, { key: 'employer', type: 'relation', target: 'company' }] });
  saveCollection({ id: 'deal', label: 'Deals', query: { path: 'data/deal/**' },
    fields: [{ key: 'name', type: 'text', primary: true }, { key: 'company', type: 'text' }] });

  // It already points at companies through `employer` — that field is the link, no second one.
  const a = await nest('company', { collection: 'contact' });
  assert.deepEqual([a.body.key, a.body.created, a.body.linked], ['employer', false, true]);
  assert.equal(getCollection('contact').fields.length, 2);

  // `deal` has no relation to company, and its `company` key is taken by a text field: a relation
  // is added under a free key, and the text field is left exactly as it was.
  const b = await nest('company', { collection: 'deal' });
  assert.equal(b.body.key, 'company_2');
  assert.deepEqual(getCollection('deal').fields.map(f => [f.key, f.type]), [['name', 'text'], ['company', 'text'], ['company_2', 'relation']]);

  // Linking twice changes nothing.
  const before = readFileSync(schemaFile('company'), 'utf8');
  const again = await nest('company', { collection: 'contact' });
  assert.deepEqual([again.status, again.body.linked], [200, false]);
  assert.equal(readFileSync(schemaFile('company'), 'utf8'), before);
  assert.deepEqual(getCollection('company').subtables.map(s => s.collection), ['contact', 'deal']);

  // Un-nesting removes the entry and nothing else.
  const out = await req('DELETE', '/api/collections/company/subcollections/deal', { actor: 'crystal' });
  assert.deepEqual(out.body.subtables.map(s => s.collection), ['contact']);
  assert.ok(getCollection('deal').fields.some(f => f.key === 'company_2'), 'the relation field stays on the child');
});

test('a loop is refused, and the tree the sidebar draws never repeats', async () => {
  freshRoot();
  await create('Company');
  await nest('company', { label: 'Team' });
  await nest('team', { label: 'Person' });
  assert.equal((await nest('person', { collection: 'company' })).status, 400, 'company is already above person');
  assert.equal((await nest('team', { collection: 'team' })).status, 400, 'nothing nests inside itself');

  const all = (await req('GET', '/api/collections')).body.collections;
  assert.deepEqual([...descendantsOf('company', all)].sort(), ['person', 'team']);
  assert.deepEqual(parentsOf('person', all).map(c => c.id), ['team']);
  assert.deepEqual(collectionTree(all).map(n => [n.collection.id, n.depth, n.parent]), [['company', 0, null], ['team', 1, 'company'], ['person', 2, 'team']]);

  // A cycle typed into the files by hand still terminates, and every collection is still listed.
  const looped = [
    { id: 'a', subtables: [{ collection: 'b', bind: { a: '$self' } }] },
    { id: 'b', subtables: [{ collection: 'a', bind: { b: '$self' } }] },
    { id: 'c', subtables: [{ collection: 'ghost', bind: { c: '$self' } }, { collection: 'd' }, 'junk'] },
    { id: 'd' },
  ];
  const drawn = collectionTree(looped).map(n => n.collection.id + ':' + n.depth);
  assert.deepEqual(drawn, ['c:0', 'd:0', 'a:0', 'b:1']);
  // A child of several parents is listed ONCE, under the shallowest (a CRM: messages belong to
  // people, to deals and to the company — the sidebar must not print Messages three times).
  const crm = [
    { id: 'companies', subtables: [{ collection: 'people', bind: { company: '$self' } }, { collection: 'deals', bind: { company: '$self' } }, { collection: 'messages', bind: { company: '$self' } }] },
    { id: 'people', subtables: [{ collection: 'messages', bind: { person: '$self' } }] },
    { id: 'deals', subtables: [{ collection: 'messages', bind: { deal: '$self' } }, { collection: 'invoices', bind: { deal: '$self' } }] },
    { id: 'messages' }, { id: 'invoices' },
  ];
  assert.deepEqual(collectionTree(crm).map(n => n.collection.id + ':' + n.depth + ':' + n.parent),
    ['companies:0:null', 'people:1:companies', 'deals:1:companies', 'invoices:2:deals', 'messages:1:companies']);
  // An entry with no bound key, or that is not an object, is not a subtable. One naming a
  // collection that does not exist is still read (the schema says so) and simply draws nothing.
  assert.deepEqual(subtablesOf(looped[2]).map(x => [x.collection, x.key]), [['ghost', 'c']]);
});

test('only the operator reshapes collections', async () => {
  freshRoot();
  await create('Company');
  const asAgent = body => ({ ...body, actor: 'scout-fb' });
  assert.equal((await req('POST', '/api/collections/create', asAgent({ label: 'Sneaky' }))).status, 403);
  assert.equal((await req('PATCH', '/api/collections/company/meta', asAgent({ label: 'Renamed' }))).status, 403);
  assert.equal((await req('POST', '/api/collections/company/subcollections', asAgent({ label: 'People' }))).status, 403);
  assert.equal((await req('DELETE', '/api/collections/company/subcollections/people', asAgent({}))).status, 403);
  assert.equal(getCollection('sneaky'), null);
  assert.equal(getCollection('company').label, 'Company');
  assert.equal(getCollection('company').subtables, undefined);
});

test('a company\'s page asks for its people and gets exactly them', async () => {
  freshRoot();
  await create('Company');
  await nest('company', { label: 'People' });
  for (const name of ['Acme', 'Globex']) await req('POST', '/api/records/upsert', { collection: 'company', name, actor: 'crystal' });
  // A relation stores the SLUG of the record it points at.
  for (const [name, company] of [['Ada Lovelace', 'acme'], ['Grace Hopper', 'acme'], ['Hank Scorpio', 'globex'], ['Nobody Yet', undefined]]) {
    const made = await req('POST', '/api/records/upsert', { collection: 'people', name, ...(company ? { company } : {}), actor: 'crystal' });
    assert.equal(made.body.verdict, 'store');
  }
  const of = async slug => (await req('GET', '/api/collections/people/documents?all=1&bind=' + encodeURIComponent(JSON.stringify({ company: slug })))).body.rows.map(r => r.title).sort();
  assert.deepEqual(await of('acme'), ['Ada Lovelace', 'Grace Hopper']);
  assert.deepEqual(await of('globex'), ['Hank Scorpio']);
  assert.deepEqual(await of('initech'), []);
  assert.equal(readMd(path.join(getStorageRoot(), 'data', 'people', 'ada-lovelace.md')).data.company, 'acme');
});

test('every collection has a colour, and each hue reads on every surface of its theme', () => {
  assert.equal(HUES.length, 8);
  // Chosen wins; otherwise the same id always gets the same hue, and it is one of the eight.
  assert.equal(hueOf({ id: 'company', colour: 'pink' }), 'pink');
  assert.equal(hueOf({ id: 'company', colour: 'chartreuse' }), hueOf({ id: 'company' }));
  assert.ok(HUES.includes(hueOf({ id: 'company' })));
  assert.equal(hueOf({ id: 'company' }), hueOf({ id: 'company' }));
  assert.match(colourOf({ id: 'people' }), /^var\(--hue-[a-z]+\)$/);
  assert.equal(collectionLabel({ id: 'people', label: 'People' }), 'People');
  assert.equal(collectionLabel({ id: 'people' }), 'people');

  // The tokens exist in the stylesheet for both themes, and clear 4.5:1 as text on every ground.
  const css = readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), 'frontend/styles.css'), 'utf8');
  const channel = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b); };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  for (const [name, tokens] of [['dark', TOKENS], ['light', LIGHT]]) {
    for (const hue of HUES) {
      const value = tokens['hue-' + hue];
      assert.match(value || '', /^#[0-9A-F]{6}$/i, `${name} --hue-${hue} is in tokens.js`);
      assert.ok(css.includes('--hue-' + hue + ':' + value), `${name} --hue-${hue} ${value} is in styles.css`);
      for (const ground of ['ink', 'surface', 'surface-2', 'raise', 'sunk', 'void']) {
        const ratio = contrast(value, tokens[ground]);
        assert.ok(ratio >= 4.5, `${name} --hue-${hue} on --${ground} is ${ratio.toFixed(2)}:1`);
      }
    }
  }
});
