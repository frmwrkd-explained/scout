// Ticket 24 — standalone chat + promote-to-project (bind). A standalone session lives under the
// workspace-level chat/ dir; binding it to a project MOVES both records into projects/<pid>/chat/,
// flips its scope, keeps the same id, and preserves the transcript across a "reload" (reading the
// .md directly). Also covers standalone session listing (default list = standalone only).
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, req, server_, getStorageRoot, readMd, fs, path } from './helpers.mjs';

const sessionPath = (pid, id) =>
  path.join(getStorageRoot(), ...(pid ? ['projects', pid, 'chat'] : ['chat']), id + '.md');
const messagesPath = (pid, id) =>
  path.join(getStorageRoot(), ...(pid ? ['projects', pid, 'chat'] : ['chat']), id + '.messages.md');

// Drive a turn to completion over the SSE channel so the transcript has real content to move.
async function runTurn(base, id, text) {
  const ac = new AbortController();
  const resp = await fetch(base + '/api/chat/sessions/' + id + '/stream', { headers: { Accept: 'text/event-stream' }, signal: ac.signal });
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  await reader.read(); // hello — provably subscribed
  await req('POST', '/api/chat/sessions/' + id + '/turn', { text });
  let buf = '';
  for (let i = 0; i < 200; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    if (buf.includes('event: turn-done') || buf.includes('event: error')) break;
  }
  ac.abort();
}

test('standalone session listing: default list is standalone-only; ?project and ?all scope correctly', async () => {
  freshRoot();
  seedProject('p');
  await server_();

  const a = await req('POST', '/api/chat/sessions', { title: 'Loose one' });
  const b = await req('POST', '/api/chat/sessions', { title: 'Loose two' });
  const c = await req('POST', '/api/chat/sessions', { project: 'p', title: 'Project bound' });
  assert.equal(a.body.scope, 'standalone');
  assert.equal(c.body.scope, 'project');

  const standalone = await req('GET', '/api/chat/sessions');
  const ids = standalone.body.map(x => x.id);
  assert.ok(ids.includes(a.body.id) && ids.includes(b.body.id), 'both standalone sessions should list by default');
  assert.ok(!ids.includes(c.body.id), 'a project session must not appear in the standalone list');

  const proj = await req('GET', '/api/chat/sessions?project=p');
  assert.deepEqual(proj.body.map(x => x.id), [c.body.id], 'project list should hold only the project session');

  const all = await req('GET', '/api/chat/sessions?all=1');
  const allIds = all.body.map(x => x.id);
  assert.ok([a, b, c].every(s => allIds.includes(s.body.id)), '?all=1 should include every scope');
});

test('promote-to-project: bind moves records, keeps the id, flips scope, and survives reload', async () => {
  freshRoot();
  const base = await server_();

  // a standalone session with a real transcript
  const created = await req('POST', '/api/chat/sessions', { title: 'Desert idea' });
  const id = created.body.id;
  assert.equal(created.body.scope, 'standalone');
  await runTurn(base, id, 'open on a wide desert');

  const before = readMd(messagesPath(null, id)).data;
  assert.equal(before.messages.length, 2, 'expected user + assistant on disk before bind');
  assert.ok(fs.existsSync(sessionPath(null, id)), 'standalone session file missing pre-bind');

  // the project the chat is promoted into must already exist (the UI creates it first)
  const proj = await req('POST', '/api/projects', { name: 'Promoted' });
  const pid = proj.body.id;

  const bound = await req('POST', '/api/chat/sessions/' + id + '/bind', { project: pid });
  assert.equal(bound.status, 200, 'bind failed: ' + JSON.stringify(bound.body));
  assert.equal(bound.body.id, id, 'bind must keep the same session id');
  assert.equal(bound.body.scope, 'project', 'scope should flip to project');
  assert.equal(bound.body.project, pid);

  // records physically moved: source gone, destination present
  assert.ok(!fs.existsSync(sessionPath(null, id)), 'standalone session file should be removed after bind');
  assert.ok(!fs.existsSync(messagesPath(null, id)), 'standalone messages file should be removed after bind');
  assert.ok(fs.existsSync(sessionPath(pid, id)), 'project session file missing after bind');

  // transcript survives the move (reload = read the .md directly, bypassing any process state)
  const after = readMd(messagesPath(pid, id)).data;
  assert.equal(after.messages.length, 2, 'transcript should survive the move');
  assert.equal(after.messages[0].text, before.messages[0].text, 'user text should be preserved');
  assert.equal(after.project, pid, 'messages record should carry the new project');

  // the route reads it back under the project, with scope flipped and history intact
  const fetched = await req('GET', '/api/chat/sessions/' + id);
  assert.equal(fetched.body.scope, 'project');
  assert.equal(fetched.body.project, pid);
  assert.equal(fetched.body.messages.length, 2);

  // listing: now under the project, no longer standalone
  const standalone = await req('GET', '/api/chat/sessions');
  assert.ok(!standalone.body.some(x => x.id === id), 'bound session should leave the standalone list');
  const projList = await req('GET', '/api/chat/sessions?project=' + pid);
  assert.ok(projList.body.some(x => x.id === id), 'bound session should join the project list');
});

test('bind guards: missing project id → 400; unknown project → 404', async () => {
  freshRoot();
  await server_();
  const { body: s } = await req('POST', '/api/chat/sessions', { title: 'Guarded' });

  const noProject = await req('POST', '/api/chat/sessions/' + s.id + '/bind', {});
  assert.equal(noProject.status, 400, 'bind with no project id should be a 400');

  const badProject = await req('POST', '/api/chat/sessions/' + s.id + '/bind', { project: 'does-not-exist' });
  assert.equal(badProject.status, 404, 'bind to a nonexistent project should be a 404');

  // the session is untouched — still standalone and readable
  const still = await req('GET', '/api/chat/sessions/' + s.id);
  assert.equal(still.body.scope, 'standalone');
});
