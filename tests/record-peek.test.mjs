// Browsing from a record: a value on a record (a tag, a category) opens a window of the other
// records that share it. These pin the three things that were wrong or missing: a click on a tag
// must not delete it, the window's filter is the one comparison the quick filters use, and a
// record or a whole set can be opened by address (how "open in a new tab" works).
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyQuick } from '../frontend/viewDisplay.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('a tag in the editor has two buttons: its name browses, only its × removes', () => {
  const cells = src('frontend/cells.jsx');
  const editor = cells.slice(cells.indexOf('function MultiSelectEditor('), cells.indexOf('// ── date ──'));
  assert.match(editor, /className="tagEditName[^"]*"[^>]*onClick=\{\(\) => onPick\(field, t\)\}/, 'the name calls onPick');
  assert.match(editor, /className="tagEditX"[^>]*onClick=\{\(\) => onChange\(chosen\.filter\(x => x !== t\)\)\}/, 'the × removes');
  // The bug: one Chip per tag whose whole surface was the remove button.
  assert.doesNotMatch(editor, /<Chip[^>]*title="Remove"/);
});

test('a clickable chip keeps its own type: the pick style never resets the font', () => {
  const cells = src('frontend/cells.jsx');
  const pick = /const PICK = sx\('([^']*)'\)/.exec(cells)[1];
  assert.doesNotMatch(pick, /(^|;)font:/, '`font:` shorthand wipes size, weight and family');
  assert.doesNotMatch(cells, /\.\.\.style, \.\.\.PICK/, 'PICK is spread before the chip style, never after');
});

test('the window shows exactly the records that carry the value', () => {
  const rows = [
    { path: 'a.md', fields: { tags: ['Food & Beverage', 'Home & Garden'], category: 'ADs' } },
    { path: 'b.md', fields: { tags: ['Health & Beauty'], category: 'ADs' } },
    { path: 'c.md', fields: { tags: [], category: 'Creative' } },
    { path: 'd.md', fields: { category: 'ADs' } },
  ];
  assert.deepEqual(applyQuick(rows, [{ field: 'tags', value: 'Food & Beverage' }]).map(r => r.path), ['a.md']);
  assert.deepEqual(applyQuick(rows, [{ field: 'category', value: 'ADs' }]).map(r => r.path), ['a.md', 'b.md', 'd.md']);
});

test('a record and a set open by address, and the desktop app keeps those windows in the app', () => {
  const peek = src('frontend/RecordPeek.jsx');
  assert.match(peek, /'#open=' \+ encodeURIComponent\(path\)/);
  assert.match(peek, /'#browse=' \+ \[collectionId, fieldKey, String\(value\)\]\.map\(encodeURIComponent\)\.join\('\/'\)/);
  const app = src('frontend/App.jsx');
  assert.match(app, /\/\^#open=\(\.\+\)\$\//, 'App reads #open=');
  assert.match(app, /\^#browse=/, 'App reads #browse=');
  const main = src('desktop/main.cjs');
  const handler = main.slice(main.indexOf('setWindowOpenHandler'));
  assert.ok(handler.indexOf("url.startsWith('http://127.0.0.1:' + port + '/')") < handler.indexOf('shell.openExternal(url)'),
    'a link to the app itself is allowed before external links are sent to the browser');
});

test('the window reuses the collection screen\'s cards and list — no second card', () => {
  const peek = src('frontend/RecordPeek.jsx');
  assert.match(peek, /import GalleryView from '\.\/GalleryView'/);
  assert.match(peek, /import ListView from '\.\/ListView'/);
  assert.match(peek, /applyQuick\(/);
});
