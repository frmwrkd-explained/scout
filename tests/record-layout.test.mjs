// How a collection lays out its records' pages (`page`, `header` on the schema), and the route
// that stores a dropped picture. The layout is the collection's, so it is set once and every
// record follows; a wrong value is refused by name; and a customization can always be undone.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { freshRoot, req, server_, getStorageRoot, fs, path, loadJsx } from './helpers.mjs';
import { saveCollection, getCollection } from '../backend/collections.mjs';
import { pageOf, cleanPage, PAGE_SECTIONS } from '../shared/recordPage.mjs';

const { headerFields, headerCandidates } = await loadJsx('frontend/RecordHeader.jsx');

const SCHEMA = {
  id: 'shots', label: 'Shots', query: { path: 'data/shots/**' },
  fields: [
    { key: 'name', type: 'text', primary: true },
    { key: 'still', type: 'file', primary_media: true },
    { key: 'kind', type: 'select', options: ['ad', 'thumbnail'] },
    { key: 'tags', type: 'multiselect' },
    { key: 'prompt', type: 'text', multiline: true },
    { key: 'source', type: 'url' },
    { key: 'number', type: 'number' },
    { key: 'score', type: 'number', display: 'bar', min: 1, max: 10 },
  ],
};
const keys = fields => fields.map(f => f.key);

test('a collection that was never customized opens as the default page', () => {
  assert.deepEqual(pageOf({}), { layout: 'stack', width: 'normal', sections: PAGE_SECTIONS, hidden: [], media: 'lead', mediaSize: 'm', text: 'folded' });
  assert.deepEqual(pageOf(null).sections, PAGE_SECTIONS);
  // The picture beside the text needs room, so that layout is wide unless a width was chosen.
  assert.equal(pageOf({ page: { layout: 'side' } }).width, 'wide');
  assert.equal(pageOf({ page: { layout: 'side', width: 'narrow' } }).width, 'narrow');
  // A part left out is hidden, not lost: it is offered back.
  const page = pageOf({ page: { sections: ['note', 'media'] } });
  assert.deepEqual([page.sections, page.hidden], [['note', 'media'], ['properties', 'text', 'children']]);
  // Unknown values in a hand-edited file fall back instead of breaking the page.
  assert.deepEqual([pageOf({ page: { layout: 'spiral', media: 'wall', sections: ['note', 'nope'] } })].map(p => [p.layout, p.media, p.sections]), [['stack', 'lead', ['note']]]);
});

test('a wrong layout value is refused by name, and clearing is always possible', () => {
  assert.deepEqual(cleanPage({ layout: 'side', width: 'wide', media: 'grid', mediaSize: 'l', text: 'open', sections: ['media', 'media', 'note'] }),
    { layout: 'side', width: 'wide', media: 'grid', mediaSize: 'l', text: 'open', sections: ['media', 'note'] });
  assert.equal(cleanPage(null), null);
  assert.equal(cleanPage({}), null);
  assert.throws(() => cleanPage({ layout: 'spiral' }), /layout "spiral" is not one of stack · side · compact/);
  assert.throws(() => cleanPage({ media: 'wall' }), /media "wall" is not one of lead · grid · strip/);
  assert.throws(() => cleanPage({ sections: ['sidebar'] }), /section "sidebar"/);
  assert.throws(() => cleanPage('wide'), /must be an object/);
});

test('the properties under the title are the short ones by default, and exactly the chosen ones after', () => {
  // Never the title, a picture or long text; a bare number or a URL waits in Details until chosen.
  assert.deepEqual(keys(headerCandidates(SCHEMA)), ['kind', 'tags', 'source', 'number', 'score']);
  assert.deepEqual(keys(headerFields(SCHEMA)), ['kind', 'tags', 'score']);
  assert.deepEqual(keys(headerFields({ ...SCHEMA, header: ['source', 'kind', 'prompt', 'gone'] })), ['source', 'kind'], 'in the chosen order; what cannot sit there is ignored');
  assert.deepEqual(keys(headerFields({ ...SCHEMA, header: [] })), [], 'an empty list is a deliberate "none"');
});

test('the layout is saved on the collection, keeps everything else, and agents cannot set it', async () => {
  freshRoot();
  saveCollection({ ...SCHEMA, description: 'Frames from the shoot.' });
  const set = body => req('PATCH', '/api/collections/shots/meta', body);

  const ok = await set({ page: { layout: 'side', media: 'strip' }, header: ['tags', 'kind'] });
  assert.equal(ok.status, 200);
  const saved = getCollection('shots');
  assert.deepEqual(saved.page, { layout: 'side', media: 'strip' });
  assert.deepEqual(saved.header, ['tags', 'kind']);
  assert.equal(saved.description, 'Frames from the shoot.');
  assert.equal(saved.fields.length, SCHEMA.fields.length, 'the fields are untouched');
  const file = fs.readFileSync(path.join(getStorageRoot(), '.scout', 'collections', 'shots.md'), 'utf8');
  assert.match(file, /page:\n  layout: side/, 'readable in the file, where an agent finds it');

  assert.match((await set({ page: { layout: 'spiral' } })).body.error, /layout "spiral"/);
  assert.match((await set({ header: ['name'] })).body.error, /is the title/);
  assert.match((await set({ header: ['prompt'] })).body.error, /its own block/);
  assert.match((await set({ header: ['nope'] })).body.error, /not a field/);
  assert.equal((await set({ page: { layout: 'stack' }, actor: 'scout-fb' })).status, 403);
  assert.deepEqual(getCollection('shots').page, { layout: 'side', media: 'strip' }, 'a refused change changed nothing');

  await set({ page: null, header: null });
  const cleared = getCollection('shots');
  assert.equal(cleared.page, undefined);
  assert.equal(cleared.header, undefined);
});

test('a dropped picture is stored once under its own hash, and only the operator may attach', async () => {
  const root = freshRoot();
  const base = await server_();
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('a dropped picture')]);
  const post = (type, query = '') => fetch(base + '/api/files/attach?name=shot.png' + query, { method: 'POST', headers: { 'Content-Type': type }, body: bytes });

  const first = await (await post('image/png')).json();
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.deepEqual([first.path, first.existed], ['files/' + sha + '.png', false]);
  assert.deepEqual(fs.readFileSync(path.join(root, first.path)), bytes);
  assert.equal((await (await post('image/png')).json()).existed, true, 'the same picture twice is one file');

  assert.equal((await post('image/png', '&actor=scout-fb')).status, 403);
  const html = await post('text/html');
  assert.equal(html.status, 400);
  assert.match((await html.json()).error, /unsupported/);
});
