// Changing a value where it stands. A click on a stage in a table must change the stage — it used
// to narrow the view to that stage instead, because a chip in a row could only filter. These pin
// the gesture in every layout, the in-place editor in the table, and the one save path behind both.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('a choice or a yes/no that can be changed is changed by clicking it', () => {
  const cells = src('frontend/cells.jsx');
  const cell = cells.slice(cells.indexOf('export function Cell('), cells.indexOf('export default Cell;'));
  assert.match(cell, /if \(onChange && field && !isDerived\(field\) && !field\.auto\)/, 'never for a computed or automatic value');
  assert.match(cell, /field\.type === 'select' \|\| field\.type === 'status'\) return <ChoiceEditor[^>]*onChange=\{onChange\}[^>]*bare/);
  assert.match(cell, /field\.type === 'checkbox'\) return <CheckboxEditor/);
});

test('the menu changes first and narrows last', () => {
  const cells = src('frontend/cells.jsx');
  const editor = cells.slice(cells.indexOf('function ChoiceEditor('), cells.indexOf('const SelectEditor'));
  const change = editor.indexOf('onChange(o.value)');
  const clear = editor.indexOf("label: 'Clear'");
  const narrow = editor.indexOf("'Show all with “'");
  assert.ok(change > 0 && clear > change && narrow > clear, 'options, then Clear, then "Show all with"');
  assert.match(editor, /onDoubleClick=\{e => e\.stopPropagation\(\)\}/, 'a double-click on the chip does not open the record');
});

test('every layout hands a row\'s cells a way to change them', () => {
  for (const file of ['frontend/TableView.jsx', 'frontend/ListView.jsx', 'frontend/GalleryView.jsx', 'frontend/BoardView.jsx']) {
    assert.match(src(file), /onChange=\{onPatch \? \w+ => onPatch\(\w+, f\.key, \w+\) : undefined\}/, file);
  }
  assert.match(src('frontend/RecordHeader.jsx'), /onChange=\{onChange \? v => onChange\(f\.key, v\) : undefined\}/, 'the folded line on a record too');
});

test('a table cell a person types in becomes its editor on a click', () => {
  const table = src('frontend/TableView.jsx');
  assert.match(table, /\['text', 'number', 'date', 'url', 'email', 'phone', 'multiselect', 'relation'\]\.includes\(f\.type\)/);
  assert.match(table, /!isDerived\(f\) && !f\.auto/, 'computed and automatic cells stay read-only');
  assert.match(table, /<Editor field=\{f\} value=\{r\.fields\[f\.key\]\} onChange=\{v => onPatch\(r, f\.key, v\)\}/);
  assert.match(table, /className="tvCell editing" onDoubleClick=\{e => e\.stopPropagation\(\)\}/);
});

test('one save path: any row, shown at once, put back if the save fails', () => {
  const app = src('frontend/App.jsx');
  const fn = app.slice(app.indexOf('patchRow = async (path, key, value) => {'), app.indexOf('onSchemaChanged = async'));
  assert.match(fn, /api\.patchRecord\(path, \{ \[key\]: value \}/, 'through the record route, so the log and automations see it');
  assert.match(fn, /this\.setState\(put\(before\)\)/, 'a failed save restores what was there');
  assert.match(app, /patchSelected = \(key, value\) => this\.patchRow\(this\.state\.selected, key, value\)/);
  assert.match(app, /onPatch=\{\(row, key, value\) => this\.patchRow\(row\.path, key, value\)\}/);
});

test('a number field shows what is typed whether or not a focus event arrived', () => {
  const cells = src('frontend/cells.jsx');
  const input = cells.slice(cells.indexOf('function NumberInput('), cells.indexOf('// ── select · status ──'));
  assert.match(input, /value=\{draft\}/, 'the box is always the draft');
  assert.match(input, /draft\.replace\(\/\[,\\s\]\/g, ''\)/, 'separators are stripped before saving');
});
