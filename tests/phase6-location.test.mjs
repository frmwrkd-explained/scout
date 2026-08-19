// Phase 6 — serializable location ↔ hash + ui-state persistence (non-sensitive only).
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, req } from './helpers.mjs';
import { encodeLocation, decodeLocation, sameLocation } from '../frontend/location.js';

test('location encodes/decodes losslessly for the key navigable shapes', () => {
  const cases = [
    { page: 'project', projectId: 'neon', tab: 'generate', subview: 'review', filters: { status: 'new' }, entity: null, reviewSessionId: null },
    { page: 'item', projectId: 'neon', entity: { type: 'item', id: 'SH010_gen', scope: null, folder: null }, tab: null, subview: null, filters: {}, reviewSessionId: null },
    { page: 'inbox', reviewSessionId: 'rv-123', projectId: null, tab: null, subview: null, entity: null, filters: {} },
  ];
  for (const loc of cases) {
    const round = decodeLocation(encodeLocation(loc));
    assert.equal(round.page, loc.page);
    assert.equal(round.projectId, loc.projectId);
    assert.equal(round.tab, loc.tab);
    assert.equal(round.reviewSessionId, loc.reviewSessionId);
    if (loc.entity) { assert.equal(round.entity.type, loc.entity.type); assert.equal(round.entity.id, loc.entity.id); }
  }
});

test('home encodes to an empty hash; deep links are exact', () => {
  assert.equal(encodeLocation({ page: 'home' }), '#');
  const h = encodeLocation({ page: 'item', projectId: 'p', entity: { type: 'item', id: 'X' } });
  assert.match(h, /page=item/); assert.match(h, /proj=p/); assert.match(h, /e=item%3AX|e=item:X/);
});

test('ui-state persists location + prefs and rejects non-whitelisted (secret) keys', async () => {
  freshRoot();
  const r = await req('PUT', '/api/ui-state', { location: { page: 'inbox' }, density: 'grid', falApiKey: 'sk-LEAK', foo: 'bar' });
  assert.equal(r.status, 200);
  assert.equal(r.body.location.page, 'inbox');
  assert.equal(r.body.density, 'grid');
  assert.ok(!('falApiKey' in r.body), 'ui-state stored a secret');
  assert.ok(!('foo' in r.body), 'ui-state stored an unwhitelisted key');
  // survives a re-read (on disk)
  const g = await req('GET', '/api/ui-state');
  assert.equal(g.body.location.page, 'inbox');
});
