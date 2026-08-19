#!/usr/bin/env node
// Test fixture (ticket 14) — a `claude`-family stub that scripts a `generation` directive fence into
// its reply, exercising the generation-card path end to end: the agent starts a generation and points
// at it by id rather than describing the result in prose. Basename contains "claude" so the runner
// classifies it as the claude (NDJSON stream) runner.
//
// Env:
//   STUB_GEN_SCENARIO  single (default) | batch
//     · single — one `generation` directive referencing a single gen id
//     · batch  — one `generation.batch` directive referencing a batch id (the grid card)
const scenario = process.env.STUB_GEN_SCENARIO || 'single';

const fence = scenario === 'batch'
  ? '```frameforge\n{"type":"generation.batch","batch":"batch-42","project":"p"}\n```'
  : '```frameforge\n{"type":"generation","ref":"gen-7","project":"p"}\n```';
const full = 'Queued that for you:\n\n' + fence + '\n\nI\'ll surface each frame as it lands.';

const line = o => process.stdout.write(JSON.stringify(o) + '\n');
const delta = text => line({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });

line({ type: 'system', subtype: 'init', session_id: 'stub-gen-1', tools: [] });
for (const w of full.split(' ')) delta(w + ' ');
line({ type: 'result', subtype: 'success', result: full, total_cost_usd: 0.001, session_id: 'stub-gen-1' });
