#!/usr/bin/env node
// Test fixture — a `claude`-family stub that scripts a `frameforge` directive fence into its reply,
// to exercise ticket-12 stream-side detection/parsing/persistence. Basename contains "claude" so the
// runner classifies it as the claude (NDJSON stream) runner.
//
// Env:
//   STUB_SCENARIO  clean (default) | split | malformed
//     · clean     — a well-formed show.style fence, emitted as deltas AND echoed in a result line
//     · split     — same fence, but chunked so the ``` fence + JSON straddle delta boundaries, and
//                   NO result line — forces the runner to reassemble the directive from deltas alone
//     · malformed — a fence whose body is not valid JSON (degrades to a `malformed` directive)
//   STUB_CHUNK     delta size in chars for the `split` scenario (default 6)
const scenario = process.env.STUB_SCENARIO || 'clean';
const chunkSize = Number(process.env.STUB_CHUNK || 6);
const sid = 'stub-dir-1';

const fence = scenario === 'malformed'
  ? '```frameforge\n{ this is not json }\n```'
  : '```frameforge\n{"type":"show.style","ref":"s1"}\n```';
const full = 'Here is the look I locked:\n\n' + fence + '\n\nWant me to apply it?';

const line = o => process.stdout.write(JSON.stringify(o) + '\n');
const delta = text => line({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });

line({ type: 'system', subtype: 'init', session_id: sid, tools: [] });

if (scenario === 'split') {
  // chunk the whole reply into small fixed-size pieces so the fence never lands on a delta boundary
  for (let i = 0; i < full.length; i += chunkSize) delta(full.slice(i, i + chunkSize));
  // deliberately NO result line → the runner must use the delta-assembled text
} else {
  for (const w of full.split(' ')) delta(w + ' ');
  line({ type: 'result', subtype: 'success', result: full, total_cost_usd: 0.001, session_id: sid });
}
