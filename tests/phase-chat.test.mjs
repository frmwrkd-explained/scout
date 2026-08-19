// Ticket 08 — filmmaker chat session backend: markdown records, session routes, the per-session
// SSE turn channel (simulate executor), persistence across a "restart", and checkpoint branching.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, req, server_, getStorageRoot, readMd, fs, path } from './helpers.mjs';

const messagesPath = (pid, id) =>
  path.join(getStorageRoot(), ...(pid ? ['projects', pid, 'chat'] : ['chat']), id + '.messages.md');

// Drain a session's SSE stream until `turn-done` (or `error`), returning the ordered event types
// plus the assembled text-delta payload. Mirrors tests/phase4-index-sse.test.mjs.
async function drainTurn(base, id, { post }) {
  const ac = new AbortController();
  const resp = await fetch(base + '/api/chat/sessions/' + id + '/stream', { headers: { Accept: 'text/event-stream' }, signal: ac.signal });
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  // wait for the hello frame so we are provably subscribed before posting the turn
  const first = await reader.read();
  assert.match(dec.decode(first.value), /event: hello/);

  await post();

  const events = [];
  let deltaText = '';
  let buf = '';
  for (let i = 0; i < 200; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    let ix;
    while ((ix = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, ix); buf = buf.slice(ix + 2);
      const em = /event: (\S+)/.exec(frame);
      const dm = /data: (\{.*\})/.exec(frame);
      if (!em) continue;
      const type = em[1];
      events.push(type);
      if (type === 'text-delta' && dm) deltaText += JSON.parse(dm[1]).text || '';
      if (type === 'turn-done' || type === 'error') { ac.abort(); return { events, deltaText }; }
    }
  }
  ac.abort();
  return { events, deltaText };
}

test('create → turn → SSE event order → persistence (survives restart)', async () => {
  freshRoot();
  seedProject('p');
  const base = await server_();

  const created = await req('POST', '/api/chat/sessions', { project: 'p', title: 'Direction' });
  assert.equal(created.status, 200);
  const id = created.body.id;
  assert.ok(id, 'no session id');
  assert.equal(created.body.scope, 'project');
  assert.equal(created.body.project, 'p');
  assert.equal(created.body.mode, 'agent');
  assert.equal(created.body.executor, 'simulate');
  assert.deepEqual(created.body.messages, []);

  const { events, deltaText } = await drainTurn(base, id, {
    post: () => req('POST', '/api/chat/sessions/' + id + '/turn', { text: 'open on a wide desert' })
  });

  // typed event vocabulary + order: turn-started first, at least one text-delta, turn-done last
  assert.equal(events[0], 'turn-started', 'first event was not turn-started: ' + JSON.stringify(events));
  assert.equal(events[events.length - 1], 'turn-done', 'last event was not turn-done: ' + JSON.stringify(events));
  assert.ok(events.includes('text-delta'), 'no text-delta streamed: ' + JSON.stringify(events));
  assert.ok(events.indexOf('turn-started') < events.indexOf('text-delta'), 'text-delta before turn-started');
  assert.ok(deltaText.length > 0, 'no streamed text assembled');

  // persistence: both messages are durable on disk (simulate a restart by reading the .md directly,
  // bypassing any in-process state — the record is the source of truth)
  const rec = readMd(messagesPath('p', id)).data;
  assert.equal(rec.messages.length, 2, 'expected user + assistant persisted');
  assert.equal(rec.messages[0].role, 'user');
  assert.equal(rec.messages[0].text, 'open on a wide desert');
  assert.equal(rec.messages[1].role, 'assistant');
  assert.equal(rec.messages[1].text, deltaText, 'persisted assistant text should equal the streamed deltas');

  // the fetch route returns the same durable transcript
  const fetched = await req('GET', '/api/chat/sessions/' + id);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.messages.length, 2);
});

test('checkpoint records a turn boundary and restoring branches a new session with history up to that point', async () => {
  freshRoot();
  seedProject('p');
  const base = await server_();
  const { body: s } = await req('POST', '/api/chat/sessions', { project: 'p', title: 'Branchable' });

  // turn 1
  await drainTurn(base, s.id, { post: () => req('POST', '/api/chat/sessions/' + s.id + '/turn', { text: 'first beat' }) });

  // checkpoint after turn 1 (2 messages on disk)
  const cp = await req('POST', '/api/chat/sessions/' + s.id + '/checkpoint', { label: 'after beat 1' });
  assert.equal(cp.status, 200);
  assert.equal(cp.body.messageIndex, 2, 'checkpoint should capture 2 messages');
  assert.equal(cp.body.turn, 1);

  // turn 2 — diverges past the checkpoint
  await drainTurn(base, s.id, { post: () => req('POST', '/api/chat/sessions/' + s.id + '/turn', { text: 'second beat' }) });
  const afterTwo = await req('GET', '/api/chat/sessions/' + s.id);
  assert.equal(afterTwo.body.messages.length, 4, 'original session should now hold two full turns');

  // restore → a NEW branched session containing only history up to the checkpoint
  const restored = await req('POST', '/api/chat/sessions/' + s.id + '/checkpoint/' + cp.body.id + '/restore');
  assert.equal(restored.status, 200);
  assert.notEqual(restored.body.id, s.id, 'restore must create a new session, not mutate the original');
  assert.equal(restored.body.messages.length, 2, 'branch should contain history up to the checkpoint only');
  assert.equal(restored.body.branchedFrom.session, s.id);
  assert.equal(restored.body.branchedFrom.checkpoint, cp.body.id);

  // the original session is untouched (still four messages)
  const original = await req('GET', '/api/chat/sessions/' + s.id);
  assert.equal(original.body.messages.length, 4, 'restoring a checkpoint must not truncate the source');

  // the branch is a real, independently-listed session under the same project
  const list = await req('GET', '/api/chat/sessions?project=p');
  assert.ok(list.body.some(x => x.id === restored.body.id), 'branch missing from the project session list');
});

test('standalone sessions persist under a workspace-level chat dir; rename + archive round-trip', async () => {
  freshRoot();
  const base = await server_();
  const { body: s } = await req('POST', '/api/chat/sessions', { title: 'Loose idea' });
  assert.equal(s.scope, 'standalone');
  assert.equal(s.project, null);
  assert.ok(fs.existsSync(path.join(getStorageRoot(), 'chat', s.id + '.md')), 'standalone session file not on disk');

  await drainTurn(base, s.id, { post: () => req('POST', '/api/chat/sessions/' + s.id + '/turn', { text: 'hi there' }) });
  const rec = readMd(messagesPath(null, s.id)).data;
  assert.equal(rec.messages.length, 2);

  // rename
  const renamed = await req('PATCH', '/api/chat/sessions/' + s.id, { title: 'Named idea', mode: 'manual' });
  assert.equal(renamed.body.title, 'Named idea');
  assert.equal(renamed.body.mode, 'manual');

  // archive — default list hides it, ?archived=1 shows it
  await req('POST', '/api/chat/sessions/' + s.id + '/archive', { archived: true });
  const active = await req('GET', '/api/chat/sessions');
  assert.ok(!active.body.some(x => x.id === s.id), 'archived session still in the default list');
  const all = await req('GET', '/api/chat/sessions?archived=1');
  assert.ok(all.body.some(x => x.id === s.id), 'archived session missing from the archived list');
});

test('system-event (ticket 13) appends a compact system message, persists it, and broadcasts on SSE', async () => {
  freshRoot();
  seedProject('p');
  const base = await server_();
  const { body: s } = await req('POST', '/api/chat/sessions', { project: 'p', title: 'Locks' });

  // subscribe first so we can prove the broadcast reaches an open transcript
  const ac = new AbortController();
  const resp = await fetch(base + '/api/chat/sessions/' + s.id + '/stream', { headers: { Accept: 'text/event-stream' }, signal: ac.signal });
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  assert.match(dec.decode((await reader.read()).value), /event: hello/);

  const posted = await req('POST', '/api/chat/sessions/' + s.id + '/system-event', { text: 'style-lock changed: noir-teal' });
  assert.equal(posted.status, 200);
  assert.equal(posted.body.message.role, 'system');
  assert.equal(posted.body.message.text, 'style-lock changed: noir-teal');

  // the broadcast arrives on the SSE channel as `system-event`
  let sawEvent = false;
  let buf = '';
  for (let i = 0; i < 40 && !sawEvent; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    if (/event: system-event/.test(buf)) sawEvent = true;
  }
  ac.abort();
  assert.ok(sawEvent, 'system-event was not broadcast on the SSE channel');

  // durable in the transcript, as a system-role row (ids only, no restated content)
  const rec = readMd(messagesPath('p', s.id)).data;
  assert.equal(rec.messages.length, 1);
  assert.equal(rec.messages[0].role, 'system');
  assert.equal(rec.messages[0].text, 'style-lock changed: noir-teal');

  // empty text 400s; missing session 404s
  const empty = await req('POST', '/api/chat/sessions/' + s.id + '/system-event', { text: '  ' });
  assert.equal(empty.status, 400);
  const miss = await req('POST', '/api/chat/sessions/chat-nope/system-event', { text: 'x' });
  assert.equal(miss.status, 404);
});

test('turn on a missing session 404s; empty turn text 400s', async () => {
  freshRoot();
  await server_();
  const miss = await req('POST', '/api/chat/sessions/chat-nope/turn', { text: 'x' });
  assert.equal(miss.status, 404);
  const { body: s } = await req('POST', '/api/chat/sessions', {});
  const empty = await req('POST', '/api/chat/sessions/' + s.id + '/turn', { text: '   ' });
  assert.equal(empty.status, 400);
});
