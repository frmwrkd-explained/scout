// Ticket 14 — inline generation cards. The card RENDERING is build-verified (it is React/JSX driven
// by app state); what is asserted here is the wire contract the card depends on: a `generation`
// directive the agent emits round-trips through the directive protocol (parsed → SSE `directive`
// event → persisted on the assistant message) carrying the generation/batch id the card fetches by.
//
// The full "a real session yields a card going queued→running→done" criterion needs a live provider
// run and is verified manually — see the ticket. Here the plumbing is proven hermetically: the id the
// agent points at survives the round-trip, and the referenced generation record is the one the card
// reads from app state.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { freshRoot, seedProject, seedGen, req, server_, getStorageRoot, readMd, path } from './helpers.mjs';
import { createSession } from '../backend/chat.mjs';
import { parseDirectives, directiveMarker } from '../backend/agentRunner.mjs';
import { listGenerations } from '../backend/generate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.join(here, 'fixtures', 'stub-claude-generation.mjs');
const messagesPath = (pid, id) =>
  path.join(getStorageRoot(), ...(pid ? ['projects', pid, 'chat'] : ['chat']), id + '.messages.md');

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

// ── unit: a generation fence parses to a typed directive carrying the id the card fetches by ──
test('parseDirectives parses a single-generation fence into a `generation` directive with its ref', () => {
  const { text, directives } = parseDirectives('done\n```frameforge\n{"type":"generation","ref":"gen-7","project":"p"}\n```');
  assert.equal(directives.length, 1);
  assert.deepEqual(directives[0], { type: 'generation', ref: 'gen-7', project: 'p' });
  assert.ok(text.includes(directiveMarker(0)), 'the fence is swapped for a positional marker');
  assert.ok(!/```frameforge/.test(text), 'the raw fence must not survive in the prose');
});

test('parseDirectives parses a batch fence into a `generation.batch` directive with its batch id', () => {
  const { directives } = parseDirectives('```frameforge\n{"type":"generation.batch","batch":"batch-42","project":"p"}\n```');
  assert.equal(directives.length, 1);
  assert.equal(directives[0].type, 'generation.batch');
  assert.equal(directives[0].batch, 'batch-42');
});

// ── integration: the agent starts a generation and points at it by id (not prose) ──
test('a scripted single-generation directive round-trips to the persisted message and references a real gen record', async () => {
  freshRoot(); seedProject('p');
  // the record the card would fetch by id from app state — status/cost live on it
  seedGen('p', 'gen-7', { status: 'done', file: 'gen-7_v1.png', cost: 0.015, model: 'fal-ai/flux/schnell', reviewState: 'new' });
  const base = await server_();
  const s = createSession({ project: 'p', title: 'Gen', executor: 'cli', agentCommand: STUB });

  const { events, directives } = await drain(base, s.id, () => req('POST', '/api/chat/sessions/' + s.id + '/turn', { text: 'make me a frame' }));
  assert.equal(events[events.length - 1], 'turn-done');
  assert.ok(events.includes('directive'), 'expected a directive SSE event: ' + JSON.stringify(events));
  assert.equal(directives[0].type, 'generation');
  assert.equal(directives[0].ref, 'gen-7');

  // persisted on the assistant message as a typed part + positional marker
  const msgs = readMd(messagesPath('p', s.id)).data.messages;
  const asst = msgs[msgs.length - 1];
  assert.equal(asst.directives[0].ref, 'gen-7');
  assert.ok(asst.text.includes(directiveMarker(0)), 'prose carries the marker: ' + asst.text);

  // the id resolves to the real record the card renders from (via /api/state projects[].gens)
  const gen = listGenerations('p').find(g => g.id === 'gen-7');
  assert.ok(gen && gen.status === 'done' && gen.cost === 0.015, 'referenced generation record is present with its ledgered cost');
});

test('a scripted batch directive round-trips carrying the batch id the grid card groups by', async () => {
  freshRoot(); seedProject('p');
  const base = await server_();
  const s = createSession({ project: 'p', title: 'Batch', executor: 'cli', agentCommand: STUB });
  process.env.STUB_GEN_SCENARIO = 'batch';
  try {
    const { events, directives } = await drain(base, s.id, () => req('POST', '/api/chat/sessions/' + s.id + '/turn', { text: 'storyboard it' }));
    assert.equal(events[events.length - 1], 'turn-done');
    assert.ok(events.includes('directive'), 'expected a directive SSE event: ' + JSON.stringify(events));
    assert.equal(directives[0].type, 'generation.batch');
    assert.equal(directives[0].batch, 'batch-42');
  } finally { delete process.env.STUB_GEN_SCENARIO; }

  const msgs = readMd(messagesPath('p', s.id)).data.messages;
  const asst = msgs[msgs.length - 1];
  assert.equal(asst.directives[0].batch, 'batch-42');
});
