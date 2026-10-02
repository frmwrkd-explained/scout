import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadJsx } from './helpers.mjs';
const { CardBody, normalizeCard } = await loadJsx('frontend/DecideCards.jsx');

test('Paperclip approval presents the actual brief and preserves the exact export in details', () => {
  const payload = { version: 1, fingerprint: 'approved-snapshot', connection: { url: 'http://127.0.0.1:5191' },
    issue: { title: 'Compare the local flows', description: '[Scout bridge issue identity]\n\nScout work: local\n\nPrepare a result for review.\n\nKeep Tax ID optional. This is a proposed flow, not a live change.' } };
  const raw = { id: 'approval', kind: 'outbound', channel: 'paperclip', bridge_hash: payload.fingerprint,
    title: 'Delegate comparison', message: JSON.stringify(payload, null, 2), body: JSON.stringify(payload) };
  const html = renderToStaticMarkup(React.createElement(CardBody, { card: normalizeCard(raw) }));
  const visible = html.slice(0, html.indexOf('<details>'));
  assert.match(visible, /Compare the local flows/);
  assert.match(visible, /Keep Tax ID optional\. This is a proposed flow, not a live change\./);
  assert.doesNotMatch(visible, /Scout bridge issue identity|approved-snapshot|&quot;version&quot;/);
  assert.match(html, /Exact export details/);
  assert.match(html, /approved-snapshot/);
  assert.match(html, /Scout bridge issue identity/);
});

test('unreadable or mismatched Paperclip exports retain the ordinary literal approval view', () => {
  for (const message of ['Not a readable export', JSON.stringify({ version: 1, fingerprint: 'different', issue: { title: 'Hidden summary', description: 'Abbreviated' } })]) {
    const card = normalizeCard({ id: 'bad', kind: 'outbound', channel: 'paperclip', bridge_hash: 'expected', message });
    const html = renderToStaticMarkup(React.createElement(CardBody, { card }));
    assert.match(html, /THE EXACT WORDING THAT WILL BE SENT/);
    assert.doesNotMatch(html, /Exact export details/);
  }
});

test('a Paperclip finding embeds its canonical draft for review instead of a remote ID headline', () => {
  const card = normalizeCard({ id: 'finding', kind: 'finding', collection: 'paperclip-result',
    title: 'Paperclip result: remote-work · remote-comment-id', record: 'data/paperclip-result/prepared.md' });
  const html = renderToStaticMarkup(React.createElement(CardBody, { card }));
  assert.match(html, /Review the Paperclip draft/);
  assert.match(html, /data-artifact-path="data\/paperclip-result\/prepared.md"/);
  assert.match(html, /Paperclip draft · Paperclip/);
  assert.doesNotMatch(html, /remote-comment-id/);
});
