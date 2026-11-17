// How a saved view says it wants to be shown: the display keys (`size`, `fields`, `cover`, `fit`,
// `summary`, `wrap`, `group`, `widths`), the one module that reads them, the validation that
// refuses a wrong one, and the one-pass counts that replaced "fetch every view to count it".
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, req, getStorageRoot, fs, path } from './helpers.mjs';
import { saveCollection } from '../backend/collections.mjs';
import { saveView, listViews } from '../backend/views.mjs';
import { upsertRecord } from '../backend/records.mjs';
import {
  sizeKey, sizeOf, SIZE, coverOf, fitOf, wrapOf, summaryOf, shownFields, pickableFields, groupRows, sameQuery,
  applyQuick, toggleQuick, quickToFilter,
} from '../frontend/viewDisplay.js';

const SCHEMA = {
  id: 'shots', label: 'Shots', query: { path: 'data/shots/**' },
  fields: [
    { key: 'name', type: 'text', primary: true },
    { key: 'still', type: 'file', primary_media: true },
    { key: 'clip', type: 'file' },
    { key: 'kind', type: 'select', options: ['ad', 'thumbnail'] },
    { key: 'tags', type: 'multiselect' },
    { key: 'prompt', type: 'text', multiline: true },
    { key: 'shot_on', type: 'date' },
  ],
};
const keys = fields => fields.map(f => f.key);

test('a view reads at a sane default, and an old `density` still means something', () => {
  assert.equal(sizeKey({}), 'm');
  assert.equal(sizeKey({ size: 'xl' }), 'xl');
  assert.equal(sizeKey({ density: 'compact' }), 's');
  assert.equal(sizeKey({ density: 'roomy' }), 'l');
  assert.equal(sizeKey({ size: 'huge', density: 'cosy' }), 'm');
  // Bigger is bigger in every dimension — a size step that grew the card and shrank the text
  // would be a bug nobody could see in a single number.
  for (const k of ['title', 'text', 'zoom', 'row', 'thumb', 'card']) {
    assert.ok(SIZE.s[k] < SIZE.m[k] && SIZE.m[k] < SIZE.l[k] && SIZE.l[k] < SIZE.xl[k], k + ' grows with size');
  }
  assert.ok(sizeOf({}).title >= 14, 'the default reads at 14px or more');
  assert.equal(fitOf({}), 'contain');
  assert.equal(fitOf({ fit: 'cover' }), 'cover');
  assert.equal(wrapOf({}), false);
  assert.equal(summaryOf({ type: 'list' }), true);
  assert.equal(summaryOf({ type: 'gallery' }), false);
  assert.equal(summaryOf({ type: 'gallery', summary: true }), true);
});

test('the picture is the schema\'s unless the view says otherwise', () => {
  assert.equal(coverOf(SCHEMA, {}).key, 'still');
  assert.equal(coverOf(SCHEMA, { cover: 'clip' }).key, 'clip');
  assert.equal(coverOf(SCHEMA, { cover: false }), null);
  assert.equal(coverOf({ fields: [{ key: 'name', type: 'text', primary: true }] }, {}), null);
});

test('one list of properties drives every layout', () => {
  const view = { type: 'list', fields: ['tags', 'still', 'name', 'kind', 'made_up'] };
  // A row draws the name and the picture itself, so neither is repeated as a property.
  assert.deepEqual(keys(shownFields(SCHEMA, view)), ['tags', 'kind', 'made_up']);
  // A table has a name column, always first, and the picture is a column like any other.
  assert.deepEqual(keys(shownFields(SCHEMA, view, { title: true })), ['name', 'tags', 'still', 'kind', 'made_up']);
  // A key the schema does not declare is still shown (Law 8), as plain text.
  assert.equal(shownFields(SCHEMA, view).find(f => f.key === 'made_up').type, 'text');
  // An explicitly empty list is "just the name" — not "fall back to the default".
  assert.deepEqual(keys(shownFields(SCHEMA, { type: 'list', fields: [] })), []);
  // A view from before the Properties control keeps the card fields it was saved with.
  assert.deepEqual(keys(shownFields(SCHEMA, { type: 'gallery', fields: ['kind', 'tags'], card: { fields: ['kind'] } })), ['kind']);

  const picks = pickableFields(SCHEMA, { type: 'gallery', fields: ['kind'] });
  assert.deepEqual(keys(picks.shown), ['kind']);
  assert.ok(!keys(picks.hidden).includes('still') && !keys(picks.hidden).includes('name'), 'the leading picture and the name are not offered as properties');
  assert.ok(keys(pickableFields(SCHEMA, { type: 'table', fields: ['kind'] }).hidden).includes('still'), 'in a table the picture is a column');
});

test('grouping sections rows without losing any', () => {
  const rows = [
    { path: 'a', fields: { kind: 'thumbnail', tags: ['x', 'y'], shot_on: '2026-11-17' } },
    { path: 'b', fields: { kind: 'ad', tags: [], shot_on: new Date('2026-11-16T00:00:00.000Z') } },
    { path: 'c', fields: { tags: ['y'] } },
  ];
  assert.equal(groupRows(rows, SCHEMA, {}), null);
  const byKind = groupRows(rows, SCHEMA, { group: 'kind' });
  // Schema order (ad before thumbnail), the heading reads as a name while the key stays the stored
  // value, and the record with no value gets its own trailing group.
  assert.deepEqual(byKind.map(g => [g.key, g.label, g.items.length]), [['ad', 'Ad', 1], ['thumbnail', 'Thumbnail', 1], ['', 'No kind', 1]]);
  // A multi-value field files a record under each of its values.
  const byTag = groupRows(rows, SCHEMA, { group: 'tags' });
  assert.deepEqual(byTag.map(g => [g.key, g.items.map(r => r.path).join('')]), [['x', 'a'], ['y', 'ac'], ['', 'b']]);
  // Dates group by calendar day, newest first, with no timezone shift on a date-only value.
  const byDay = groupRows(rows, SCHEMA, { group: 'shot_on' }, new Date(2026, 10, 17));
  assert.deepEqual(byDay.map(g => [g.key, g.label]), [['2026-11-17', 'Today'], ['2026-11-16', 'Yesterday'], ['', 'No shot on']]);
});

test('only a change to the filter or the sort needs new rows', () => {
  const base = { id: 'all', type: 'list', filter: [], sort: [{ field: 'name', dir: 'asc' }], size: 'm' };
  assert.ok(sameQuery(base, { ...base, type: 'gallery', size: 'xl', fields: ['kind'], cover: false, group: 'kind', widths: { name: 300 } }));
  assert.ok(!sameQuery(base, { ...base, sort: [{ field: 'name', dir: 'desc' }] }));
  assert.ok(!sameQuery(base, { ...base, filter: [{ field: 'kind', op: 'is', value: 'ad' }] }));
  assert.ok(!sameQuery(base, { ...base, id: 'other' }));
});

test('a saved view keeps its display keys, and a wrong one is refused by name', () => {
  freshRoot();
  saveCollection(SCHEMA);
  const view = { id: 'wall', label: 'Wall', type: 'gallery', size: 'l', fit: 'cover', cover: 'clip', summary: true, wrap: false,
    group: 'kind', fields: ['kind', 'tags'], widths: { name: 320, kind: 140 }, filter: [], sort: [] };
  saveView('shots', view);
  const stored = JSON.parse(fs.readFileSync(path.join(getStorageRoot(), '.scout', 'views', 'shots.json'), 'utf8'))[0];
  for (const k of ['size', 'fit', 'cover', 'summary', 'wrap', 'group', 'fields', 'widths']) assert.deepEqual(stored[k], view[k], k + ' is in the file');
  assert.deepEqual(listViews('shots').views[0].widths, { name: 320, kind: 140 });

  const bad = patch => () => saveView('shots', { ...view, ...patch });
  assert.throws(bad({ size: 'huge' }), /size "huge" is not one of s · m · l · xl/);
  assert.throws(bad({ fit: 'stretch' }), /fit "stretch"/);
  assert.throws(bad({ cover: 'kind' }), /cover must name a file field/);
  assert.throws(bad({ cover: 'nope' }), /cover must name a file field/);
  assert.throws(bad({ wrap: 'yes' }), /wrap must be true or false/);
  assert.throws(bad({ widths: { nope: 100 } }), /widths references unknown field "nope"/);
  assert.throws(bad({ widths: { name: 5 } }), /between 40 and 2000/);
  saveView('shots', { ...view, cover: false });   // "no picture" is a legal answer
});

test('every tab is counted in one call', async () => {
  freshRoot();
  saveCollection(SCHEMA);
  for (const [name, kind] of [['One', 'ad'], ['Two', 'ad'], ['Three', 'thumbnail']]) upsertRecord({ collection: 'shots', name, kind });
  saveView('shots', { id: 'all', label: 'Everything', type: 'list', filter: [], sort: [] });
  saveView('shots', { id: 'ads', label: 'Ads', type: 'list', filter: [{ field: 'kind', op: 'is', value: 'ad' }], sort: [] });

  const plain = await req('GET', '/api/views/shots');
  assert.equal(plain.body.counts, undefined, 'counts are opt-in — the plain route stays as cheap as it was');
  const counted = await req('GET', '/api/views/shots?counts=1');
  assert.deepEqual(counted.body.counts, { all: 3, ads: 2 });
  assert.equal(counted.body.total, 3);
  assert.equal(counted.body.views.length, 2);
  assert.equal((await req('GET', '/api/views/nope?counts=1')).status, 404);
});

test('clicking a value narrows the rows, clicking it again widens them, and the draft saves as a real filter', () => {
  const rows = [
    { path: 'a', fields: { kind: 'ad', tags: ['Fashion', 'Beauty'] } },
    { path: 'b', fields: { kind: 'ad', tags: ['Beauty'] } },
    { path: 'c', fields: { kind: 'thumbnail', tags: [] } },
  ];
  const kind = SCHEMA.fields.find(f => f.key === 'kind'), tags = SCHEMA.fields.find(f => f.key === 'tags');
  let quick = toggleQuick([], tags, 'Beauty');
  assert.deepEqual(applyQuick(rows, quick).map(r => r.path), ['a', 'b']);
  quick = toggleQuick(quick, tags, 'Fashion');            // two tags: a record must carry both
  assert.deepEqual(applyQuick(rows, quick).map(r => r.path), ['a']);
  quick = toggleQuick(quick, kind, 'ad');
  assert.deepEqual(applyQuick(rows, quick).map(r => r.path), ['a']);
  // Exactly what the server's own filter understands — so "Save as view" keeps the same rows.
  assert.deepEqual(quickToFilter(SCHEMA, quick), [
    { field: 'tags', op: 'contains', value: 'Beauty' },
    { field: 'tags', op: 'contains', value: 'Fashion' },
    { field: 'kind', op: 'is', value: 'ad' },
  ]);
  quick = toggleQuick(toggleQuick(toggleQuick(quick, tags, 'Beauty'), tags, 'Fashion'), kind, 'ad');
  assert.deepEqual(quick, []);
  assert.equal(applyQuick(rows, quick).length, 3, 'no quick filter shows everything');
});
