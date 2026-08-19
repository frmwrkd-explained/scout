// DEV-135 — the chat agent was dead while the settings "Test" button stayed green.
//
// The two paths genuinely differ: jobs.mjs testAgent() runs `-p "Reply with exactly: OK"` with no
// tools, no system prompt, no isolated home and NO --resume, while a chat turn runs stream-json with
// --resume <cliSessionId> under CLAUDE_CONFIG_DIR=<isolated home>. So the test could not observe the
// thing that was broken.
//
// What was broken, reproduced against the real CLI and covered here as unit tests on the pure
// stream parser (handleClaudeEvent is exported precisely so this needs no live process):
//
//   1. The `result` frame is the CLI's own failure channel — `is_error: true` + `errors[]` + an
//      `error_*` subtype — and the parser ignored all three. A run that failed inside the protocol
//      was read as a success with no text: the turn completed with an EMPTY assistant bubble and no
//      error anywhere. That is "agent mode does nothing".
//   2. The same frame echoes back the session id we ASKED to resume. Adopting it from a FAILED run
//      wrote the dead id straight back into the session record, so every later turn resumed the same
//      missing conversation — the chat was bricked permanently and could not recover on its own.
//
// The live behaviour (`claude --resume <unknown-id>` → exit 1, stderr "No conversation found with
// session ID: …", plus a stream-json result frame carrying is_error) is what isStaleResumeError()
// matches to trigger the one-shot retry without --resume.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleClaudeEvent, isStaleResumeError, buildClaudeArgs } from '../backend/agentRunner.mjs';

const blank = () => ({ text: '', result: '', cost: 0, cliSessionId: null, protocolError: null });
const noop = () => { };

// ── 1. a protocol-level failure is no longer read as an empty success ────────────────────────────
test('an is_error result frame records the error instead of completing silently', () => {
  const st = blank();
  handleClaudeEvent({
    type: 'result', subtype: 'error_during_execution', is_error: true,
    session_id: '00000000-dead-beef-0000-000000000000', total_cost_usd: 0,
    errors: ['No conversation found with session ID: 00000000-dead-beef-0000-000000000000']
  }, noop, st);
  assert.match(st.protocolError, /No conversation found with session ID/);
  assert.equal(st.text, '');
  assert.equal(st.result, '');
});

test('an error subtype with no errors[] still produces a non-empty reason', () => {
  const st = blank();
  handleClaudeEvent({ type: 'result', subtype: 'error_max_turns', is_error: true }, noop, st);
  assert.ok(st.protocolError && st.protocolError.trim(), 'must never leave a failure unexplained');
  assert.match(st.protocolError, /error_max_turns/);
});

// ── 2. a failed run must not poison the stored resume id ─────────────────────────────────────────
test('session_id from a FAILED result frame is not adopted — the session must not self-brick', () => {
  const st = blank();
  handleClaudeEvent({
    type: 'result', is_error: true, session_id: 'the-dead-id',
    errors: ['No conversation found with session ID: the-dead-id']
  }, noop, st);
  assert.equal(st.cliSessionId, null,
    'adopting the echoed id is what made every later turn resume the same missing conversation');
});

test('session_id from a SUCCESSFUL result frame is still adopted', () => {
  const st = blank();
  handleClaudeEvent({ type: 'result', session_id: 'fresh-id', total_cost_usd: 0.02, result: 'PONG' }, noop, st);
  assert.equal(st.cliSessionId, 'fresh-id');
  assert.equal(st.result, 'PONG');
  assert.equal(st.cost, 0.02);
  assert.equal(st.protocolError, null);
});

test('a system frame still establishes the session id (the normal first-turn path)', () => {
  const st = blank();
  handleClaudeEvent({ type: 'system', session_id: 'sys-id' }, noop, st);
  assert.equal(st.cliSessionId, 'sys-id');
});

// ── 3. the stale-resume classifier ───────────────────────────────────────────────────────────────
test('isStaleResumeError matches the CLI wording and nothing else', () => {
  // verbatim from `claude --resume <unknown>`: exit 1, this on stderr
  assert.equal(isStaleResumeError('No conversation found with session ID: 0000-dead'), true);
  assert.equal(isStaleResumeError('no conversation found with session id: x'), true); // case-insensitive
  assert.equal(isStaleResumeError('agent run failed: No conversation found with session ID: x'), true);
  // must NOT swallow unrelated failures into a silent retry
  assert.equal(isStaleResumeError('401 Unauthorized'), false);
  assert.equal(isStaleResumeError('timeout after 300s'), false);
  assert.equal(isStaleResumeError(''), false);
  assert.equal(isStaleResumeError(null), false);
});

// ── 4. the retry actually drops --resume ─────────────────────────────────────────────────────────
test('buildClaudeArgs omits --resume entirely when the retry passes null', () => {
  const withResume = buildClaudeArgs({ prompt: 'hi', resume: 'abc', allowedTools: 'Bash' });
  assert.ok(withResume.includes('--resume'));
  assert.equal(withResume[withResume.indexOf('--resume') + 1], 'abc');

  const retry = buildClaudeArgs({ prompt: 'hi', resume: null, allowedTools: 'Bash' });
  assert.equal(retry.includes('--resume'), false, 'the recovery run must start a fresh conversation');
  // everything else about the shape is unchanged, so the retry is the same turn minus the bad id
  assert.ok(retry.includes('--output-format') && retry.includes('stream-json'));
  assert.equal(retry[retry.length - 2], '-p');
  assert.equal(retry[retry.length - 1], 'hi');
});

// ── 5. a normal streaming turn is untouched by all of the above ──────────────────────────────────
test('text deltas and a clean result still produce the reply', () => {
  const st = blank();
  const seen = [];
  const emit = e => seen.push(e);
  handleClaudeEvent({ type: 'system', session_id: 's1' }, emit, st);
  handleClaudeEvent({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'PO' } } }, emit, st);
  handleClaudeEvent({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'NG' } } }, emit, st);
  handleClaudeEvent({ type: 'result', session_id: 's1', result: 'PONG', total_cost_usd: 0.01 }, emit, st);
  assert.equal(st.text, 'PONG');
  assert.equal(st.result, 'PONG');
  assert.equal(st.protocolError, null);
  assert.equal(st.cliSessionId, 's1');
  assert.deepEqual(seen.map(e => e.type), ['text-delta', 'text-delta']);
});
