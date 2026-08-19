// Ticket 18 — attachments: image/document refs ride a chat turn, persist on the user message, and
// reach the agent as a compact structured block (paths/ids it can fetch or cite) WITHOUT the binary.
// The `simulate` executor echoes the userText it receives, so draining the SSE stream lets us prove
// the attachment block reached the prompt end-to-end — no live agent subscription required.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject, req, server_, getStorageRoot, readMd, fs, path } from './helpers.mjs';
import { attachmentPromptLine } from '../backend/chat.mjs';

const messagesPath = (pid, id) => path.join(getStorageRoot(), 'projects', pid, 'chat', id + '.messages.md');

async function drainTurn(base, id, { post }) {
  const ac = new AbortController();
  const resp = await fetch(base + '/api/chat/sessions/' + id + '/stream', { headers: { Accept: 'text/event-stream' }, signal: ac.signal });
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  const first = await reader.read();
  assert.match(dec.decode(first.value), /event: hello/);
  await post();
  const events = [];
  let deltaText = '', buf = '';
  for (let i = 0; i < 400; i++) {
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
      if (em[1] === 'text-delta' && dm) deltaText += JSON.parse(dm[1]).text || '';
      if (em[1] === 'turn-done' || em[1] === 'error') { ac.abort(); return { events, deltaText }; }
    }
  }
  ac.abort();
  return { events, deltaText };
}

test('attachmentPromptLine — image refs carry the exact generation-ref triple; documents carry a fetch url', () => {
  assert.equal(attachmentPromptLine([]), '', 'no attachments → empty block');
  const line = attachmentPromptLine([
    { id: 'context/References/hero.jpg', kind: 'image', name: 'hero.jpg', folder: 'References', scope: 'p' },
    { id: 'context/Script/treatment.pdf', kind: 'document', name: 'treatment.pdf', folder: 'Script', scope: 'p' }
  ]);
  // image → citable as a generation ref by id, no prose description
  assert.match(line, /context\/References\/hero\.jpg \(image\)/);
  assert.match(line, /refs:\[\{ scope:"p", folder:"References", name:"hero\.jpg" \}\]/);
  // document → the agent reads it through FrameForge's own HTTP API
  assert.match(line, /GET \/api\/context\/p\/file\?folder=Script&name=treatment\.pdf/);
});

test('a posted turn carries attachment refs → persisted on the user message, reaches the prompt, survives reload', async () => {
  freshRoot();
  seedProject('p');
  const base = await server_();
  const { body: s } = await req('POST', '/api/chat/sessions', { project: 'p', title: 'With refs' });

  const attachments = [
    { id: 'context/References/hero.jpg', kind: 'image', name: 'hero.jpg', folder: 'References', scope: 'p' },
    { id: 'context/Script/treatment.pdf', kind: 'document', name: 'treatment.pdf', folder: 'Script', scope: 'p' }
  ];
  const { events, deltaText } = await drainTurn(base, s.id, {
    post: () => req('POST', '/api/chat/sessions/' + s.id + '/turn', { text: 'summarize my attached treatment', attachments })
  });
  assert.equal(events[0], 'turn-started');
  assert.equal(events[events.length - 1], 'turn-done');

  // refs reached the prompt: simulate echoes the userText it received, which now includes the block
  assert.match(deltaText, /context\/References\/hero\.jpg/, 'image ref missing from prompt');
  assert.match(deltaText, /context\/Script\/treatment\.pdf/, 'document ref missing from prompt');
  // the generation-ref block reached the prompt (simulate JSON-escapes quotes in its echo, so match
  // escaping-agnostically; the exact triple shape is asserted by the attachmentPromptLine unit test)
  assert.match(deltaText, /refs:\[\{ scope:/, 'generation-ref block missing from prompt');
  assert.match(deltaText, /to use it as a generation reference/, 'image ref instruction missing');

  // persisted on the user message — clean text, structured refs, and survives a "reload" (disk read)
  const rec = readMd(messagesPath('p', s.id)).data;
  const userMsg = rec.messages.find(m => m.role === 'user');
  assert.equal(userMsg.text, 'summarize my attached treatment', 'user bubble text must stay clean (no ref block)');
  assert.equal(userMsg.attachments.length, 2);
  assert.equal(userMsg.attachments[0].name, 'hero.jpg');
  assert.equal(userMsg.attachments[0].kind, 'image');
  assert.equal(userMsg.attachments[0].folder, 'References');
  assert.equal(userMsg.attachments[0].scope, 'p');

  // the fetch route returns the same durable refs
  const fetched = await req('GET', '/api/chat/sessions/' + s.id);
  const u = fetched.body.messages.find(m => m.role === 'user');
  assert.equal(u.attachments.length, 2);
  assert.equal(u.attachments[1].name, 'treatment.pdf');
});

test('a turn with attachments but no text is accepted (attachments-only send)', async () => {
  freshRoot();
  seedProject('p');
  const base = await server_();
  const { body: s } = await req('POST', '/api/chat/sessions', { project: 'p', title: 'Image only' });

  // attachments-only send: empty text + refs is a valid turn (the frontend allows it too).
  const attachments = [{ id: 'context/References/plate.png', kind: 'image', name: 'plate.png', folder: 'References', scope: 'p' }];
  const { events, deltaText } = await drainTurn(base, s.id, {
    post: () => req('POST', '/api/chat/sessions/' + s.id + '/turn', { text: '', attachments })
  });
  assert.equal(events[events.length - 1], 'turn-done');
  assert.match(deltaText, /context\/References\/plate\.png/);

  const rec = readMd(messagesPath('p', s.id)).data;
  const userMsg = rec.messages.find(m => m.role === 'user');
  assert.equal(userMsg.attachments.length, 1);
});
