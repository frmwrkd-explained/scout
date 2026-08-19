// Ticket 09 — streaming agent runner: the `cli` chat executor behind stub CLIs.
//   · claude stub  → NDJSON stream parsed into token deltas + CLI-side resume across turns
//   · generic stub → one-shot fallback with a transcript-tail prompt prefix, same event types
//   · cancel       → aborts the spawned process, emits turn-cancelled, persists a partial message
// Pure helpers (arg builders, stream parser, directive/tail extraction) are unit-tested too.
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { freshRoot, seedProject, req, server_, getStorageRoot, readMd, fs, path } from './helpers.mjs';
import { createSession } from '../backend/chat.mjs';
import {
  runnerKind, allowedToolsValue, buildClaudeArgs, buildOneShotArgs,
  transcriptTail, extractDirectives, handleClaudeEvent,
  planLaunch, cmdShimScript, cmdEscape
} from '../backend/agentRunner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const STUB_CLAUDE = path.join(here, 'fixtures', 'stub-claude.mjs');
const STUB_AGENT = path.join(here, 'fixtures', 'stub-agent.mjs');

const sessionPath = (pid, id) =>
  path.join(getStorageRoot(), ...(pid ? ['projects', pid, 'chat'] : ['chat']), id + '.md');
const messagesPath = (pid, id) =>
  path.join(getStorageRoot(), ...(pid ? ['projects', pid, 'chat'] : ['chat']), id + '.messages.md');

// Drain a session's SSE stream until a terminal event, collecting event types + assembled text.
// `terminals` lets a caller also stop on turn-cancelled. `onFirstDelta` fires once (used by cancel).
async function drain(base, id, { post, terminals = ['turn-done', 'error'], onFirstDelta } = {}) {
  const ac = new AbortController();
  const resp = await fetch(base + '/api/chat/sessions/' + id + '/stream', { headers: { Accept: 'text/event-stream' }, signal: ac.signal });
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  const first = await reader.read();
  assert.match(dec.decode(first.value), /event: hello/);

  if (post) await post();

  const events = [];
  let deltaText = '', buf = '', firedFirst = false;
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
      const type = em[1];
      events.push(type);
      if (type === 'text-delta' && dm) {
        deltaText += JSON.parse(dm[1]).text || '';
        if (!firedFirst && onFirstDelta) { firedFirst = true; await onFirstDelta(); }
      }
      if (terminals.includes(type)) { ac.abort(); return { events, deltaText }; }
    }
  }
  ac.abort();
  return { events, deltaText };
}

// ── unit: pure helpers ──
test('runnerKind classifies claude-family vs generic by basename', () => {
  assert.equal(runnerKind('claude'), 'claude');
  assert.equal(runnerKind('/opt/homebrew/bin/claude'), 'claude');
  assert.equal(runnerKind('/tmp/fixtures/stub-claude.mjs'), 'claude');
  // codex gained its own provider profile (exec-shaped one-shot) in ticket 10
  assert.equal(runnerKind('codex'), 'codex');
  assert.equal(runnerKind('/usr/local/bin/gemini'), 'generic');
  assert.equal(runnerKind(''), 'generic');
});

test('buildClaudeArgs streams JSON, scopes tools, and resumes only when an id is present', () => {
  const fresh = buildClaudeArgs({ prompt: 'hello', allowedTools: '' });
  assert.deepEqual(fresh, ['--output-format', 'stream-json', '--include-partial-messages', '--verbose', '--allowedTools', '', '-p', 'hello']);
  assert.ok(!fresh.includes('--resume'), 'fresh turn must not resume');

  const resumed = buildClaudeArgs({ prompt: 'again', resume: 'sess-9', allowedTools: 'Read,Bash' });
  const ri = resumed.indexOf('--resume');
  assert.ok(ri >= 0 && resumed[ri + 1] === 'sess-9', 'resume id must follow --resume');
  assert.equal(resumed[resumed.indexOf('--allowedTools') + 1], 'Read,Bash', 'per-session tools land in --allowedTools');
  assert.equal(resumed[resumed.length - 2], '-p');
});

test('buildOneShotArgs: claude-family keeps tool flags, generic is bare -p', () => {
  assert.deepEqual(buildOneShotArgs({ prompt: 'x', kind: 'generic' }), ['-p', 'x']);
  assert.deepEqual(buildOneShotArgs({ prompt: 'x', kind: 'claude', allowedTools: 'Read' }),
    ['--output-format', 'text', '--allowedTools', 'Read', '-p', 'x']);
});

test('allowedToolsValue always includes the baseline; per-session extras append deduped', () => {
  // Headless -p auto-denies non-pre-approved tools, so an empty value would brick the session —
  // the baseline (local API curl, pack scripts, reading the home) must always be present.
  const base = allowedToolsValue({});
  assert.ok(base.includes('Bash(curl:*)') && base.includes('Read'), 'baseline present by default');
  const extra = allowedToolsValue({ allowedTools: ['WebFetch', 'Read'] });
  assert.ok(extra.includes('WebFetch'), 'session extras append');
  assert.equal(extra.match(/\bRead\b/g).length, 1, 'duplicates collapse');
});

test('transcriptTail is bounded and ordered most-recent-last', () => {
  assert.equal(transcriptTail([]), '');
  const tail = transcriptTail([
    { role: 'user', text: 'a' }, { role: 'assistant', text: 'b' },
    { role: 'user', text: 'c' }, { role: 'assistant', text: 'd' }
  ], 2);
  assert.match(tail, /Conversation so far/);
  assert.ok(!tail.includes('a: ') && tail.includes('User: c'), 'only the last max turns are kept');
  assert.ok(tail.indexOf('c') < tail.indexOf('d'), 'most recent last');
});

test('extractDirectives parses scout fences and skips malformed ones', () => {
  const text = 'intro\n```scout\n{"type":"show.image","ref":"g1"}\n```\nmid\n```scout\n{bad json}\n```\n';
  const ds = extractDirectives(text);
  assert.equal(ds.length, 1);
  assert.deepEqual(ds[0], { type: 'show.image', ref: 'g1' });
});

test('handleClaudeEvent maps init/deltas/tools/result into events + state', () => {
  const events = [];
  const emit = e => events.push(e);
  const state = { text: '', result: '', cost: 0, cliSessionId: null };
  handleClaudeEvent({ type: 'system', subtype: 'init', session_id: 's1' }, emit, state);
  handleClaudeEvent({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi ' } } }, emit, state);
  handleClaudeEvent({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Bash', id: 't1' } } }, emit, state);
  handleClaudeEvent({ type: 'result', subtype: 'success', result: 'Hi there', total_cost_usd: 0.01, session_id: 's1' }, emit, state);
  assert.equal(state.cliSessionId, 's1');
  assert.equal(state.cost, 0.01);
  assert.equal(state.result, 'Hi there');
  assert.deepEqual(events[0], { type: 'text-delta', text: 'Hi ' });
  assert.equal(events[1].type, 'tool-call');
  assert.equal(events[1].name, 'Bash');
});

// ── unit: launching a CLI on Windows ──
//
// These run on every platform on purpose: the Windows branches take their platform/fs/execPath as
// arguments, so macOS and Linux CI still cover the planning logic they can never execute.

// Verbatim npm `cmd-shim` output (what node_modules/.bin/<cli>.cmd and every globally installed CLI
// actually contain on Windows) — the file spawn() has refused to execute since Node 18.20.
const npmShim = script => [
  '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL',
  'CALL :find_dp0', '',
  'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (',
  '  SET "_prog=node"', '  SET PATHEXT=%PATHEXT:;.JS;=;%', ')', '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\' + script + '" %*'
].join('\r\n') + '\r\n';

test('planLaunch leaves a non-Windows launch exactly as it found it', () => {
  const args = ['-p', 'hello'];
  assert.deepEqual(planLaunch('/opt/homebrew/bin/claude', args, { platform: 'darwin' }),
    { file: '/opt/homebrew/bin/claude', args, env: null, verbatim: false });
  // a script path is left alone too — POSIX honours the shebang, so there is nothing to rewrite
  assert.deepEqual(planLaunch('/tmp/fixtures/stub-claude.mjs', args, { platform: 'linux' }),
    { file: '/tmp/fixtures/stub-claude.mjs', args, env: null, verbatim: false });
});

test('cmdShimScript recovers the wrapped script from both npm shim generations', () => {
  assert.equal(cmdShimScript(npmShim('node_modules\\@anthropic-ai\\claude-code\\cli.js')),
    'node_modules\\@anthropic-ai\\claude-code\\cli.js');
  // pre-2021 shims spell the same thing with %~dp0
  assert.equal(cmdShimScript('@IF EXIST "%~dp0\\node.exe" ( "%~dp0\\node.exe"  "%~dp0\\..\\pkg\\cli.js" %* )'),
    '..\\pkg\\cli.js');
  assert.equal(cmdShimScript('@echo this is not a shim'), null);
});

test('planLaunch unwraps an npm .cmd shim to node + the script it wraps', () => {
  const plan = planLaunch('C:\\Users\\dp\\AppData\\Roaming\\npm\\claude.cmd', ['-p', 'hi'], {
    platform: 'win32',
    readFile: () => npmShim('node_modules\\@anthropic-ai\\claude-code\\cli.js'),
    exists: () => false, // no node.exe beside the shim → fall back to the runtime we are already in
    execPath: 'C:\\Program Files\\nodejs\\node.exe'
  });
  assert.equal(plan.file, 'C:\\Program Files\\nodejs\\node.exe');
  assert.equal(plan.args[0], 'C:\\Users\\dp\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js');
  assert.deepEqual(plan.args.slice(1), ['-p', 'hi']);
  assert.equal(plan.verbatim, false, 'a shim we can unwrap must never route user text through cmd.exe');
  assert.equal(plan.env.ELECTRON_RUN_AS_NODE, '1', 'process.execPath is electron.exe inside the app');
});

test('planLaunch runs a .mjs agentCommand through Node on Windows, as the shebang does on POSIX', () => {
  const plan = planLaunch('C:\\tools\\stub-claude.mjs', ['-p', 'hi'], {
    platform: 'win32', execPath: 'C:\\Program Files\\nodejs\\node.exe'
  });
  assert.deepEqual(plan.args, ['C:\\tools\\stub-claude.mjs', '-p', 'hi']);
  assert.equal(plan.file, 'C:\\Program Files\\nodejs\\node.exe');
  // a real executable is still spawned directly — no interpreter, no shell
  const exe = planLaunch('C:\\Users\\dp\\.local\\bin\\claude.exe', ['-p', 'hi'], { platform: 'win32' });
  assert.equal(exe.file, 'C:\\Users\\dp\\.local\\bin\\claude.exe');
  assert.equal(exe.verbatim, false);
});

test('an unparseable .cmd escapes into cmd.exe — and refuses to truncate a prompt', () => {
  const opts = {
    platform: 'win32', readFile: () => '@echo not a shim at all', exists: () => false,
    comspec: 'C:\\Windows\\System32\\cmd.exe'
  };
  const plan = planLaunch('C:\\bin\\weird.cmd', ['-p', 'a & del x'], opts);
  assert.equal(plan.file, 'C:\\Windows\\System32\\cmd.exe');
  assert.equal(plan.verbatim, true);
  assert.deepEqual(plan.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.ok(!/(^|[^^])&/.test(plan.args[3]), 'no unescaped & may reach cmd.exe: ' + plan.args[3]);
  // cmd.exe ends its command line at the first newline and caps it at 8191 chars. Every claude turn
  // carries a multi-line --append-system-prompt, so this route must fail loudly rather than hand the
  // CLI the first line of the system prompt and call the turn a success.
  assert.throws(() => planLaunch('C:\\bin\\weird.cmd', ['--append-system-prompt', 'one\ntwo'], opts), /multi-line/);
  assert.throws(() => planLaunch('C:\\bin\\weird.cmd', ['-p', 'x'.repeat(9000)], opts), /8191/);
});

test('cmdEscape neutralises the metacharacters a prompt could smuggle into cmd.exe', () => {
  const out = cmdEscape('a & del x | echo %PATH% > f');
  for (const meta of ['&', '|', '>', '%']) {
    assert.ok(!new RegExp('(^|[^^])\\' + meta).test(out), meta + ' left unescaped in: ' + out);
  }
  assert.ok(cmdEscape('say "hi"').includes('\\^"'), 'an embedded quote is CRT-escaped before cmd sees it');
});

// The whole point, on the platform that has it: an npm shim is spawnable again AND the multi-line
// system prompt survives the trip. Windows-only because it launches a real .cmd.
test('an npm .cmd shim launches and carries a multi-line argument intact', {
  skip: process.platform !== 'win32' ? 'Windows-only launch path' : false
}, async () => {
  freshRoot();
  const dir = getStorageRoot();
  fs.writeFileSync(path.join(dir, 'echo-argv.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
  const shim = path.join(dir, 'stub-claude.cmd');
  fs.writeFileSync(shim, npmShim('echo-argv.js'));

  // spawn() would throw EINVAL on this file directly; the plan is what makes it launchable
  const args = ['--append-system-prompt', 'line one\nline two & echo %PATH% > f', '-p', 'hi there'];
  const plan = planLaunch(shim, args);
  const got = await new Promise(res => {
    const c = spawn(plan.file, plan.args, {
      env: { ...process.env, ...(plan.env || {}) }, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      ...(plan.verbatim ? { windowsVerbatimArguments: true } : {})
    });
    let out = '';
    c.on('error', e => res('spawn failed: ' + e.message));
    c.stdout.on('data', d => { out += d; });
    c.on('close', () => res(out));
  });
  assert.deepEqual(JSON.parse(got), args, 'the CLI must receive the argv the runner built, byte for byte');
});

// ── integration: claude stub streams token deltas + resumes across turns ──
test('cli executor streams token deltas and resumes CLI-side session id turn-over-turn', async () => {
  freshRoot();
  seedProject('p');
  const base = await server_();
  const s = createSession({ project: 'p', title: 'Streamed', executor: 'cli', agentCommand: STUB_CLAUDE });
  assert.equal(s.executor, 'cli');

  // turn 1 — fresh (no resume). Expect multiple token deltas and turn-done.
  const t1 = await drain(base, s.id, { post: () => req('POST', '/api/chat/sessions/' + s.id + '/turn', { text: 'open cold' }) });
  assert.equal(t1.events[0], 'turn-started');
  assert.equal(t1.events[t1.events.length - 1], 'turn-done');
  assert.ok(t1.events.filter(e => e === 'text-delta').length >= 2, 'expected a token stream, got: ' + JSON.stringify(t1.events));
  assert.match(t1.deltaText, /fresh/, 'first turn should be a fresh (non-resumed) reply');

  // the CLI session id the stub reported is now persisted on the session record → resume target
  const rec = readMd(sessionPath('p', s.id)).data;
  assert.equal(rec.cliSessionId, 'stub-sess-1', 'cliSessionId not persisted for resume');

  // turn 2 — must pass --resume stub-sess-1; the stub proves it saw the resume id
  const t2 = await drain(base, s.id, { post: () => req('POST', '/api/chat/sessions/' + s.id + '/turn', { text: 'next beat' }) });
  assert.equal(t2.events[t2.events.length - 1], 'turn-done');
  assert.match(t2.deltaText, /resumed:stub-sess-1/, 'second turn did not resume the CLI session: ' + t2.deltaText);

  // both turns persisted; assistant text equals the assembled stream
  const msgs = readMd(messagesPath('p', s.id)).data.messages;
  assert.equal(msgs.length, 4);
  assert.equal(msgs[3].text, t2.deltaText.trim());
});

// ── integration: generic stub → one-shot fallback with transcript-tail prompt ──
test('non-resuming agentCommand degrades to one-shot with a transcript-tail prefix', async () => {
  freshRoot();
  const base = await server_();
  const s = createSession({ title: 'Fallback', executor: 'cli', agentCommand: STUB_AGENT });

  // turn 1 — no history yet, so no tail
  const t1 = await drain(base, s.id, { post: () => req('POST', '/api/chat/sessions/' + s.id + '/turn', { text: 'first' }) });
  assert.ok(t1.events.includes('text-delta'), 'fallback should emit one whole-message text-delta');
  assert.equal(t1.events[t1.events.length - 1], 'turn-done');
  assert.match(t1.deltaText, /tail=no/, 'first turn should carry no transcript tail');

  // turn 2 — history exists, so the fallback prefixes the transcript tail
  const t2 = await drain(base, s.id, { post: () => req('POST', '/api/chat/sessions/' + s.id + '/turn', { text: 'second' }) });
  assert.match(t2.deltaText, /tail=yes/, 'second turn should prefix a transcript tail: ' + t2.deltaText);

  // fallback never resumes (generic CLI has no session id)
  const rec = readMd(sessionPath(null, s.id)).data;
  assert.equal(rec.cliSessionId, null);
});

// ── integration: a run that produced nothing is a failure, not an empty reply ──
test('a CLI that exits 0 without writing a byte fails the turn instead of replying with nothing', async () => {
  freshRoot();
  const base = await server_();
  const s = createSession({ title: 'Silent', executor: 'cli', agentCommand: STUB_AGENT });

  process.env.STUB_SILENT = '1';
  try {
    const { events } = await drain(base, s.id, { post: () => req('POST', '/api/chat/sessions/' + s.id + '/turn', { text: 'anything' }) });
    assert.ok(events.includes('error'), 'a silent run must terminate in error, got: ' + JSON.stringify(events));
    assert.ok(!events.includes('turn-done'), 'a run that produced no output must not read as done');
  } finally { delete process.env.STUB_SILENT; }

  const msgs = readMd(messagesPath(null, s.id)).data.messages;
  assert.match(String(msgs[msgs.length - 1].error), /no output/, 'the failure must name itself on the message');
});

// ── integration: cancel stops the process, emits turn-cancelled, persists a partial ──
test('cancel stops a running turn, emits turn-cancelled, and persists the partial message', async () => {
  freshRoot();
  const base = await server_();
  const s = createSession({ title: 'Cancellable', executor: 'cli', agentCommand: STUB_CLAUDE });

  // make the stub stream slowly so there is a window to cancel mid-turn
  process.env.STUB_DELAY_MS = '60';
  process.env.STUB_CHUNKS = '40';
  try {
    const { events } = await drain(base, s.id, {
      terminals: ['turn-cancelled', 'turn-done', 'error'],
      post: () => req('POST', '/api/chat/sessions/' + s.id + '/turn', { text: 'long take' }),
      // once the first token arrives, cancel the turn
      onFirstDelta: () => req('POST', '/api/chat/sessions/' + s.id + '/cancel')
    });
    assert.ok(events.includes('turn-cancelled'), 'expected a turn-cancelled terminal event, got: ' + JSON.stringify(events));
    assert.ok(!events.includes('turn-done'), 'a cancelled turn must not also complete');
  } finally {
    delete process.env.STUB_DELAY_MS;
    delete process.env.STUB_CHUNKS;
  }

  // the partial assistant message is durable and marked cancelled
  const msgs = readMd(messagesPath(null, s.id)).data.messages;
  const asst = msgs[msgs.length - 1];
  assert.equal(asst.role, 'assistant');
  assert.equal(asst.cancelled, true, 'partial message not marked cancelled');
  assert.ok(asst.text.length > 0, 'expected some streamed-then-cancelled partial text');
});

// ── cancel on an idle session is a no-op (nothing running) ──
test('cancel with no in-flight turn reports cancelled:false; missing session 404s', async () => {
  freshRoot();
  await server_();
  const { body: s } = await req('POST', '/api/chat/sessions', {});
  const idle = await req('POST', '/api/chat/sessions/' + s.id + '/cancel');
  assert.equal(idle.status, 200);
  assert.equal(idle.body.cancelled, false);
  const miss = await req('POST', '/api/chat/sessions/chat-nope/cancel');
  assert.equal(miss.status, 404);
});
