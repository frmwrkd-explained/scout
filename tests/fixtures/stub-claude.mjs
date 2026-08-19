#!/usr/bin/env node
// Test fixture — emulates `claude --output-format stream-json --include-partial-messages --verbose
// -p <prompt> [--resume <id>]`. Emits deterministic NDJSON on stdout: a system/init line (with a
// session_id), one stream_event per token, then a result line. Honours --resume by echoing the id
// back and marking the reply, so a test can prove CLI-side conversation state carried across turns.
//
// Env knobs (inherited from the FrameForge process, which is the test process):
//   STUB_DELAY_MS  ms to sleep between tokens (default 0)  — used to make a turn cancellable
//   STUB_CHUNKS    number of filler tokens (default 5)
const argv = process.argv.slice(2);
const val = flag => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };

const resume = val('--resume');
const sid = resume || 'stub-sess-1';
const delay = Number(process.env.STUB_DELAY_MS || 0);
const chunks = Number(process.env.STUB_CHUNKS || 5);
const marker = resume ? ('resumed:' + resume) : 'fresh';

const words = [marker, 'ack'];
for (let i = 0; i < chunks; i++) words.push('w' + i);
const full = words.join(' ');

const line = o => process.stdout.write(JSON.stringify(o) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  line({ type: 'system', subtype: 'init', session_id: sid, tools: [] });
  for (const w of words) {
    line({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: w + ' ' } } });
    if (delay) await sleep(delay);
  }
  line({ type: 'result', subtype: 'success', result: full, total_cost_usd: 0.0021, session_id: sid });
})();
