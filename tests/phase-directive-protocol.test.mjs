// Ticket 12 — the directive protocol: stream-side detection, parsing, in-place placeholder markers,
// and durable persistence of `scout` fences as typed message parts.
//   · unit    — parseDirectives (well-formed, malformed, multiple, marker positions) + extractDirectives
//   · integ   — a stub CLI scripts a directive fence; the SSE `directive` event fires, the persisted
//               assistant message carries the placeholder marker in its prose + the directive object.
//               Covers the fence-across-stream-chunk-boundary case (a stub that never emits a result
//               line, forcing reassembly from deltas) and the malformed-degrades-not-crashes case.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { freshRoot, seedProject, req, server_, getStorageRoot, readMd, path } from './helpers.mjs';
import { createSession } from '../backend/chat.mjs';
import { parseDirectives, directiveMarker, extractDirectives } from '../backend/agentRunner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const STUB_DIR = path.join(here, 'fixtures', 'stub-claude-directive.mjs');
const messagesPath = (pid, id) =>
  path.join(getStorageRoot(), ...(pid ? ['projects', pid, 'chat'] : ['chat']), id + '.messages.md');

// Drain a session SSE stream to a terminal event; collect event types AND directive payloads.
async function drain(base, id, post) {
  const ac = new AbortController();
  const resp = await fetch(base + '/api/chat/sessions/' + id + '/stream', { headers: { Accept: 'text/event-stream' }, signal: ac.signal });
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  await reader.read(); // hello
  if (post) await post();
  const events = [], directives = [];
  let buf = '';
  for (let i = 0; i < 500; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    let ix;
    while ((ix = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, ix); buf = buf.slice(ix + 2);
      const em = /event: (\S+)/.exec(frame);
      const dm = /data: (\{[\s\S]*\})/.exec(frame);
      if (!em) continue;
      events.push(em[1]);
      if (em[1] === 'directive' && dm) { try { directives.push(JSON.parse(dm[1]).directive); } catch {} }
      if (em[1] === 'turn-done' || em[1] === 'error') { ac.abort(); return { events, directives }; }
    }
  }
  ac.abort();
  return { events, directives };
}

// ── unit ──
test('parseDirectives replaces a fence with a positional marker and returns the parsed object', () => {
  const { text, directives } = parseDirectives('before\n```scout\n{"type":"show.style","ref":"s1"}\n```\nafter');
  assert.equal(directives.length, 1);
  assert.deepEqual(directives[0], { type: 'show.style', ref: 's1' });
  assert.equal(text, 'before\n' + directiveMarker(0) + '\nafter', 'prose keeps its order with the fence swapped for marker 0');
  assert.ok(!/```scout/.test(text), 'the raw fence must not survive in the visible text');
});

test('parseDirectives numbers multiple fences in document order', () => {
  const { text, directives } = parseDirectives(
    'a\n```scout\n{"type":"show.shot","ref":"SH010"}\n```\nb\n```scout\n{"type":"show.style","ref":"s2"}\n```\nc');
  assert.equal(directives.length, 2);
  assert.equal(directives[0].ref, 'SH010');
  assert.equal(directives[1].ref, 's2');
  assert.ok(text.indexOf(directiveMarker(0)) < text.indexOf(directiveMarker(1)), 'markers appear in order');
});

test('parseDirectives degrades malformed JSON to a malformed directive carrying the raw body', () => {
  const { text, directives } = parseDirectives('oops\n```scout\n{ not json }\n```');
  assert.equal(directives.length, 1);
  assert.equal(directives[0].type, 'malformed');
  assert.match(directives[0].raw, /not json/);
  assert.ok(text.includes(directiveMarker(0)), 'even a malformed fence gets a marker so nothing is silently dropped');
});

test('extractDirectives keeps well-formed directives and drops malformed ones', () => {
  const ds = extractDirectives('```scout\n{"type":"show.image","ref":"g1"}\n```\n```scout\n{bad}\n```');
  assert.equal(ds.length, 1);
  assert.deepEqual(ds[0], { type: 'show.image', ref: 'g1' });
});

// ── integration: a scripted directive fence flows end to end ──
test('a scripted directive fence emits a `directive` event and persists a marker + typed part', async () => {
  freshRoot(); seedProject('p');
  const base = await server_();
  const s = createSession({ project: 'p', title: 'Directive', executor: 'cli', agentCommand: STUB_DIR });

  const { events, directives } = await drain(base, s.id, () => req('POST', '/api/chat/sessions/' + s.id + '/turn', { text: 'show me the look' }));
  assert.equal(events[events.length - 1], 'turn-done');
  assert.ok(events.includes('directive'), 'expected a directive SSE event, got: ' + JSON.stringify(events));
  assert.deepEqual(directives[0], { type: 'show.style', ref: 's1' });

  const msgs = readMd(messagesPath('p', s.id)).data.messages;
  const asst = msgs[msgs.length - 1];
  assert.equal(asst.role, 'assistant');
  assert.equal(asst.directives.length, 1);
  assert.deepEqual(asst.directives[0], { type: 'show.style', ref: 's1' });
  assert.ok(asst.text.includes(directiveMarker(0)), 'persisted prose carries the placeholder marker: ' + asst.text);
  assert.ok(!/```scout/.test(asst.text), 'the raw fence must be stripped from the persisted prose');
});

// ── integration: fence split across stream chunk boundaries (no result line → delta reassembly) ──
test('a fence split across stream deltas is still detected and persisted', async () => {
  freshRoot();
  const base = await server_();
  const s = createSession({ title: 'Split', executor: 'cli', agentCommand: STUB_DIR });
  process.env.STUB_SCENARIO = 'split';
  process.env.STUB_CHUNK = '5';
  try {
    const { events, directives } = await drain(base, s.id, () => req('POST', '/api/chat/sessions/' + s.id + '/turn', { text: 'stream it' }));
    assert.equal(events[events.length - 1], 'turn-done');
    assert.ok(events.includes('directive'), 'directive not detected across chunk boundaries: ' + JSON.stringify(events));
    assert.deepEqual(directives[0], { type: 'show.style', ref: 's1' });
  } finally { delete process.env.STUB_SCENARIO; delete process.env.STUB_CHUNK; }

  const msgs = readMd(messagesPath(null, s.id)).data.messages;
  const asst = msgs[msgs.length - 1];
  assert.equal(asst.directives.length, 1);
  assert.ok(asst.text.includes(directiveMarker(0)), 'reassembled prose carries the marker: ' + asst.text);
});

// ── integration: a malformed fence degrades, never crashes the turn ──
test('a malformed directive fence persists as a malformed part and the turn still completes', async () => {
  freshRoot();
  const base = await server_();
  const s = createSession({ title: 'Bad', executor: 'cli', agentCommand: STUB_DIR });
  process.env.STUB_SCENARIO = 'malformed';
  try {
    const { events, directives } = await drain(base, s.id, () => req('POST', '/api/chat/sessions/' + s.id + '/turn', { text: 'break it' }));
    assert.equal(events[events.length - 1], 'turn-done', 'a malformed directive must not error the turn: ' + JSON.stringify(events));
    assert.equal(directives[0].type, 'malformed');
  } finally { delete process.env.STUB_SCENARIO; }

  const msgs = readMd(messagesPath(null, s.id)).data.messages;
  const asst = msgs[msgs.length - 1];
  assert.equal(asst.directives[0].type, 'malformed');
  assert.match(asst.directives[0].raw, /not json/);
});
