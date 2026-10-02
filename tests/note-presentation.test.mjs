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

test('a note opens with readable content and a named author, with technical details deferred', () => {
  const html = renderToStaticMarkup(React.createElement(Document, {
    path: 'data/artifacts/opaque-name.md', collection, doc: { data, content: body },
    assistants: [{ id: 'analyst-123', name: 'Signal · Analyst' }],
  }));
  assert.match(html, /<h1>Feedback capture sheet<\/h1>/);
  assert.match(html, /Signal · Analyst/);
  assert.match(html, /<strong[^>]*>Template only\.<\/strong>/);
  assert.match(html, /Read note/);
  assert.match(html, /aria-expanded="false">Details/);
  for (const text of ['opaque-name.md', 'task-123', 'opaque-hash-123', 'analyst-123', 'SUMMARY', 'THE NOTE', 'Archive note']) {
    assert.ok(!html.includes(text), text + ' should not compete with the note');
  }
});

test('an explicit full-note opening replaces its summary and starts with editing disabled', () => {
  const html = renderToStaticMarkup(React.createElement(Document, {
    path: 'data/artifacts/opaque-name.md', collection, doc: { data, content: body }, startExpanded: true,
  }));
  assert.match(html, /Show less/);
  assert.match(html, /Edit note/);
  assert.ok(!html.includes('Template only.'), 'summary is not repeated above the full editor');
  assert.ok(!html.includes('rich-toolbar'), 'read mode offers no formatting controls');
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
