// Phase — resizable chat panels (ticket 07): chatSidebarW / prodPanelW persist through the
// existing ui-state surface, same allowlist discipline as phase6-location.test.mjs:30.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, req } from './helpers.mjs';

test('ui-state persists chatSidebarW/prodPanelW and rejects a non-whitelisted key', async () => {
  freshRoot();
  const r = await req('PUT', '/api/ui-state', { chatSidebarW: 300, prodPanelW: 340, bogusKey: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.body.chatSidebarW, 300);
  assert.equal(r.body.prodPanelW, 340);
  assert.ok(!('bogusKey' in r.body), 'ui-state stored an unwhitelisted key');
  // survives a re-read (on disk)
  const g = await req('GET', '/api/ui-state');
  assert.equal(g.body.chatSidebarW, 300);
  assert.equal(g.body.prodPanelW, 340);
  assert.ok(!('bogusKey' in g.body));
});
