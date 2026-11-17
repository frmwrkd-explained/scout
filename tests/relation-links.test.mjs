// Links between records. A relation stores a slug on disk; on screen it must read as the record's
// name, be a way to open that record, and be easy to set — from the whole target collection, with
// search, and with "create it" when the record does not exist yet.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nameFromSlug, rankRecords, hasExactName } from '../frontend/relationNames.js';
import { groupRows } from '../frontend/viewDisplay.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const COMPANIES = [
  { slug: 'northfold-labs', title: 'Northfold Labs' },
  { slug: 'acme-north', title: 'Acme North' },
  { slug: 'bellwether-trust', title: 'Bellwether Trust' },
  { slug: 'kestrel-vine', title: 'Kestrel & Vine' },
  { slug: 'old-north-road', title: 'The Road Company' },
];

test('a slug reads as a name while the real title loads', () => {
  assert.equal(nameFromSlug('bellwether-trust'), 'Bellwether Trust');
  assert.equal(nameFromSlug('msg_0218'), 'Msg 0218');
  assert.equal(nameFromSlug(''), '');
  assert.equal(nameFromSlug(null), '');
});

test('the picker ranks by name: starts-with, then a word that starts with it, then contains, then the slug', () => {
  assert.deepEqual(rankRecords(COMPANIES, 'north').map(x => x.slug), ['northfold-labs', 'acme-north', 'old-north-road']);
  assert.deepEqual(rankRecords(COMPANIES, '').map(x => x.title), ['Acme North', 'Bellwether Trust', 'Kestrel & Vine', 'Northfold Labs', 'The Road Company']);
  assert.deepEqual(rankRecords(COMPANIES, 'NORTH', ['northfold-labs']).map(x => x.slug), ['acme-north', 'old-north-road'], 'already linked records are not offered again');
  assert.deepEqual(rankRecords(COMPANIES, 'zzz'), []);
  assert.deepEqual(rankRecords(null, 'a'), []);
});

test('"Create …" is offered only when nothing has exactly that name', () => {
  assert.equal(hasExactName(COMPANIES, 'northfold labs'), true);
  assert.equal(hasExactName(COMPANIES, ' Northfold Labs '), true);
  assert.equal(hasExactName(COMPANIES, 'Northfold'), false);
  assert.equal(hasExactName(COMPANIES, ''), false);
});

test('a link prints the record\'s name and opens it; a group heading on a relation does the same', () => {
  const cells = src('frontend/cells.jsx');
  const cell = cells.slice(cells.indexOf('export function RelationChip('), cells.indexOf('function DateCell('));
  assert.match(cell, /useRecordNames\(target\)/);
  assert.match(cell, /nameOf\(names, id\)/);
  assert.match(cell, /onFollow\(target, String\(id\)\)/);
  assert.doesNotMatch(cell, /\{String\(id\)\}\s*<\/button>/, 'the slug is never the visible label');
  const list = src('frontend/ListView.jsx');
  const head = list.slice(list.indexOf('export function GroupHeader('), list.indexOf('export default function ListView('));
  assert.match(head, /field\.type === 'relation'/);
  assert.match(head, /onFollow\(field\.target, String\(value\)\)/);
  for (const file of ['frontend/ListView.jsx', 'frontend/TableView.jsx', 'frontend/GalleryView.jsx']) {
    assert.match(src(file), /<GroupHeader [^>]*field=\{groupFieldOf\(collection, view\)\}[^>]*onFollow=\{onFollow\}/, file + ' hands the group its field and a way to open it');
  }
});

test('the picker reads the whole target collection, searches, and can create', () => {
  const picker = src('frontend/RelationPicker.jsx');
  assert.match(picker, /rankRecords\(names\.list, text, exclude\)/);
  assert.match(picker, /api\.upsert\(\{ collection: target, name: typed \}\)/, 'a new record goes through the record writer');
  assert.match(src('frontend/recordNames.js'), /api\.allDocuments\(id\)/, 'every record, not one saved view');
  // The old source of choices: the target collection's FIRST VIEW — a filtered list.
  assert.doesNotMatch(src('frontend/Document.jsx'), /api\.documents\(f\.target/);
});

test('following a link looks in the collection the link names', () => {
  const app = src('frontend/App.jsx');
  const fn = app.slice(app.indexOf('openRelation = (collection, id) => {'), app.indexOf('browse = async'));
  assert.match(fn, /if \(!collection \|\| collection === this\.state\.active\)/);
});

test('a choice group reads like its chip', () => {
  const schema = { id: 'deals', fields: [{ key: 'name', type: 'text', primary: true }, { key: 'stage', type: 'status', options: ['lead', 'closed-won'] }] };
  const rows = [{ path: 'a', fields: { stage: 'closed-won' } }, { path: 'b', fields: { stage: 'lead' } }];
  assert.deepEqual(groupRows(rows, schema, { group: 'stage' }).map(g => [g.key, g.label]), [['lead', 'Lead'], ['closed-won', 'Closed won']]);
});
