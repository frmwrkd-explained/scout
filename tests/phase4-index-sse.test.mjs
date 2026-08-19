// Phase 4 — derived index integrity, malformed-file isolation, and revision-based SSE push.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, seedItem, req, server_, paths, getStorageRoot, fs, path } from './helpers.mjs';

test('one malformed item .md does not break /api/state and is quarantined in the integrity report', async () => {
  freshRoot();
  seedProject('p');
  seedItem('p', 'good', { st: 'new' });
  // write a file whose YAML frontmatter is invalid (unterminated double-quoted scalar)
  fs.writeFileSync(paths.itemMd('p', 'broken'), '---\nfoo: "unterminated\nbar: 2\n---\nbody\n');

  const state = await req('GET', '/api/state');
  assert.equal(state.status, 200, '/api/state crashed on a malformed file');
  assert.ok(state.body.items.some(i => i.id === 'good'), 'good item missing');
  assert.ok(!state.body.items.some(i => i.id === 'broken'), 'malformed item leaked into state');

  const integ = await req('GET', '/api/integrity');
  assert.equal(integ.status, 200);
  assert.ok(integ.body.malformed.some(m => m.relativePath.includes('broken')), 'malformed file not reported');
  assert.ok(integ.body.scanned >= 1);
});

test('/api/integrity/rebuild re-scans and returns a report', async () => {
  freshRoot();
  seedProject('p');
  seedItem('p', 'a');
  const r = await req('POST', '/api/integrity/rebuild');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.malformed.length, 0);
});

test('/api/state carries a revision and ?since= returns a delta of changed domains', async () => {
  freshRoot();
  seedProject('p');
  seedItem('p', 'a', { st: 'new' });
  const s1 = await req('GET', '/api/state');
  const rev0 = s1.body.revision;
  assert.ok(rev0 >= 1);

  // a mutation bumps the revision for the 'items' domain
  await req('PATCH', '/api/projects/p/items/a', { patch: { st: 'kept' } });
  const delta = await req('GET', '/api/state?since=' + rev0);
  assert.equal(delta.status, 200);
  assert.equal(delta.body.full, false);
  assert.ok(delta.body.revision > rev0, 'revision did not advance after a mutation');
  assert.ok(delta.body.changed.includes('items'), 'items domain not in the delta: ' + JSON.stringify(delta.body.changed));
});

test('SSE /api/events pushes a revision event when a mutation happens', async () => {
  freshRoot();
  seedProject('p');
  seedItem('p', 'a', { st: 'new' });
  const base = await server_();

  const ac = new AbortController();
  const resp = await fetch(base + '/api/events', { headers: { Accept: 'text/event-stream' }, signal: ac.signal });
  const reader = resp.body.getReader();
  const dec = new TextDecoder();

  // read the initial hello frame
  const first = await reader.read();
  assert.match(dec.decode(first.value), /event: hello/);

  // trigger a mutation → should push a revision event
  await req('PATCH', '/api/projects/p/items/a', { patch: { st: 'kept' } });

  let buf = '';
  let got = false;
  for (let i = 0; i < 20 && !got; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    if (/event: revision/.test(buf)) got = true;
  }
  ac.abort();
  assert.ok(got, 'no revision event received over SSE after a mutation');
  const m = /data: (\{[^\n]*\})/.exec(buf.split('event: revision')[1] || '');
  if (m) assert.ok(JSON.parse(m[1]).domains.includes('items'));
});
