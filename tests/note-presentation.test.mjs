import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadJsx } from './helpers.mjs';

const { default: Document } = await loadJsx('frontend/Document.jsx');
const { default: PropertyRows } = await loadJsx('frontend/PropertyRows.jsx');
const collection = { id: 'artifact', label: 'Team drafts', fields: [
  { key: 'title', type: 'text', primary: true },
  { key: 'status', type: 'select', options: ['draft', 'reviewed'] },
  { key: 'source_task', type: 'text' },
  { key: 'result_hash', type: 'text' },
] };
const data = { title: 'Feedback capture sheet', status: 'draft', assistant: 'analyst-123',
  source_task: 'task-123', result_hash: 'opaque-hash-123', updated: '2026-10-02' };
const body = '## Feedback capture sheet\n\n**Template only.** No real replies yet.\n\n## Next experiment\n\nCompare the two guides.';

// The page has no read mode and no edit mode (docs/decisions.md, "The record page is one live
// document"): it opens ready to write on, the title is a field, the key properties sit under it,
// and the button where "Edit note" used to be edits the collection's layout instead.
test('a record opens live: title, author, key properties and the note, with technical details deferred', () => {
  const html = renderToStaticMarkup(React.createElement(Document, {
    path: 'data/artifacts/opaque-name.md', collection, doc: { data, content: body },
    assistants: [{ id: 'analyst-123', name: 'Signal · Analyst' }],
  }));
  assert.match(html, /<h1>.*Feedback capture sheet.*<\/h1>/s);
  assert.match(html, /Signal · Analyst/);
  // Folded by default: one line of the values themselves, which opens into the editable card.
  assert.match(html, /class="recordProps folded"/, 'the properties sit under the title, folded to one line');
  assert.match(html, /aria-expanded="false"[^>]*title="Show and edit the properties"/);
  // The chip reads in sentence case (`Draft`), not spaced capitals — cells.jsx StatusChip.
  assert.match(html, /class="chip[^"]*"[^>]*>.*?Draft</, 'the status is readable on the page without opening anything');
  assert.match(html, /class="documentBody"/, 'the note is on the page, not behind a button');
  assert.match(html, /aria-expanded="false"[^>]*>Details/);
  for (const text of ['opaque-name.md', 'task-123', 'opaque-hash-123', 'analyst-123', 'SUMMARY', 'THE NOTE', 'Archive note']) {
    assert.ok(!html.includes(text), text + ' should not compete with the note');
  }
});

test('there is no mode to enter before writing, and the layout is what the button edits', () => {
  const html = renderToStaticMarkup(React.createElement(Document, {
    path: 'data/artifacts/opaque-name.md', collection, doc: { data, content: body },
  }));
  for (const gone of ['Edit note', 'Finish editing', 'Read note', 'Show less']) {
    assert.ok(!html.includes(gone), '"' + gone + '" belonged to the read/edit modes');
  }
  assert.match(html, />Edit layout</);
  assert.match(html, />Source</);
  assert.match(html, /role="status"[^>]*>Saved</, 'the save state is always visible, because the page is always live');
});

test('generated source identifiers are deferred while ordinary work properties remain available', () => {
  const html = renderToStaticMarkup(React.createElement(PropertyRows, { collection, values: data, showAuto: true }));
  assert.match(html, /Feedback capture sheet/);
  assert.match(html, /File details/);
  assert.ok(!html.includes('task-123'));
  assert.ok(!html.includes('opaque-hash-123'));
  const work = renderToStaticMarkup(React.createElement(PropertyRows, {
    values: { goal_id: 'activation-demo', project: 'growth', universe: 'unit/growth' },
  }));
  assert.match(work, /activation-demo/);
  assert.match(work, /unit\/growth/);
});
