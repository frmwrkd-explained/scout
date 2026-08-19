// Ticket 09 — the streaming agent runner: the `cli` chat executor.
//
// This is the ticket-09 half of chat.mjs's executor seam. chat.mjs owns persistence + the SSE
// envelope; this module owns the OS process. It registers a single executor, `cli`, via
// chat.mjs's registerExecutor() and is activated by chat.mjs importing it (no index.mjs wiring).
//
// Two runner shapes behind one executor:
//  · claude  — Claude Code. Spawned with streaming JSON + partial messages
//    (`--output-format stream-json --include-partial-messages --verbose -p`), parsed into ticket-08
//    typed events (text-delta, tool-call, tool-result, directive). Conversation state lives in the
//    CLI: we pass `--resume <cliSessionId>` turn-over-turn and store the id the CLI reports back on
//    the session record (chat.mjs persists it), so transcripts are never re-sent.
//  · one-shot — codex (`codex exec …`) and any other `agentCommand` (Gemini, …; bare `-p`). No
//    resume, no stream: one invocation with a compact transcript tail prefixed to the prompt,
//    emitting the SAME event types (one whole text-delta instead of a token stream). The per-CLI
//    argv shape comes from agentProviders.mjs, never from a literal here.
//
// No CLI installed → the executor does not fail: it emits a `setup` event and returns a helpful
// message, so the session degrades to a setup state that the existing agent status/install/login
// routes power. (createSession already prefers `simulate` when nothing is installed; this is the
// mid-session safety net.)
//
// Tool permissions are scoped per session via the claude `--allowedTools` flag, read from
// session.allowedTools (default [] → empty tool set, matching the jobs runner's safe default).
//
// Cancellation is cooperative: chat.mjs passes an AbortSignal; on abort we SIGTERM (then SIGKILL)
// the child and resolve with the partial text and `cancelled: true`, which chat.mjs persists.
import { spawn } from 'child_process';
import { planLaunch } from './launch.mjs';
import fs from 'fs';
import path from 'path';
import { resolveBin, agentEnv } from './jobs.mjs';
import { getStorageRoot, getSettings } from './store.mjs';
import { prepareAgentHome, indexInjection, selfApiBase } from './agentHome.mjs';
import { providerById, providerFor, resolveSessionModel } from './agentProviders.mjs';

const TURN_TIMEOUT_MS = Number(process.env.FRFG_CHAT_TIMEOUT_MS) || 300_000;

// Which runner a command drives. Claude Code speaks stream-json + --resume; everything else
// degrades to one-shot. Keyed on the binary's basename so an absolute path still classifies.
export function runnerKind(command) {
  return providerFor(command).runner;
}

// Per-session allowed tools → a claude `--allowedTools` value. In headless -p mode every
// non-pre-approved tool call is auto-DENIED (there is no prompt), so an empty value bricks the
// session: the agent can't even curl the local API the router skill tells it to operate, and it
// starts narrating permission walls at a filmmaker. The baseline below is the minimum a FrameForge
// session needs — local API calls, pack scripts (node/python), and reading its own home/skills.
// "Chat tools ship OFF" is enforced by the Index (disabled tools are absent), NOT by tool denial.
export const BASELINE_ALLOWED_TOOLS = [
  'Bash(curl:*)',      // the FrameForge HTTP API on 127.0.0.1
  'Bash(node:*)',      // router + pack scripts (probe.mjs, scaffold.mjs, …)
  'Bash(python3:*)', 'Bash(python:*)', // user packs (e.g. shot-builder) ship python scripts
  'Read', 'Glob', 'Grep'               // the mounted skills/references in the isolated home
];
export function allowedToolsValue(session) {
  const extra = Array.isArray(session?.allowedTools) ? session.allowedTools : [];
  return [...new Set([...BASELINE_ALLOWED_TOOLS, ...extra])].join(',');
}

// ── arg builders (exported so the safety/shape properties are unit-testable) ──
// model/effort are optional: omitted → the CLI's own default, which keeps the arg shape stable for
// callers that don't select one.
export function buildClaudeArgs({ prompt, resume, allowedTools = '', model, effort }) {
  const args = ['--output-format', 'stream-json', '--include-partial-messages', '--verbose',
    '--allowedTools', allowedTools];
  if (model) args.push('--model', String(model));
  if (effort) args.push('--effort', String(effort));
  if (resume) args.push('--resume', String(resume));
  args.push('-p', String(prompt ?? ''));
  return args;
}
export function buildOneShotArgs({ prompt, kind, allowedTools = '' }) {
  // Per-CLI flag shape lives in agentProviders.mjs (claude: `-p`; codex: `exec`; unknown CLIs get
  // the lowest common denominator the store documents, `-p <prompt>`).
  const p = providerById(kind);
  return (p ? p.promptArgs : providerFor('').promptArgs)(prompt, { allowedTools });
}

// A compact transcript tail for one-shot CLIs with no resume: the last few turns, prefixed to the
// prompt so a stateless CLI still has conversational context (bounded, so it can't blow the budget).
export function transcriptTail(history = [], max = 6) {
  const recent = (Array.isArray(history) ? history : []).slice(-max);
  if (!recent.length) return '';
  const lines = recent.map(m => {
    const who = m.role === 'user' ? 'User' : 'Assistant';
    const body = String(m.text || (m.error ? '[error] ' + m.error : '')).slice(0, 800);
    return who + ': ' + body;
  });
  return ['## Conversation so far (most recent last)', ...lines, ''].join('\n');
}

// ── the directive protocol (ticket 12) ──
//
// A `frameforge` fenced JSON block is the structured channel the agent uses to place a rich card in
// the conversation without restating stored data. parseDirectives() is the canonical detector: it
// pulls EVERY fence out of the assistant text and replaces it, IN PLACE, with a stable placeholder
// marker (⟦frameforge:N⟧) that the frontend maps to the card slot — so the prose around a card keeps
// its order. Fence bodies that don't parse to a JSON object degrade to a `malformed` directive that
// carries the raw text, so the UI can show it as plain text + a subtle warning instead of crashing.
//
// The marker is a plain-text sentinel (unicode math brackets — never produced by markdown, safe in
// YAML/JSON frontmatter) so the client can split the persisted text on it and interleave cards. The
// directive at list index N corresponds to marker ⟦frameforge:N⟧.
const DIRECTIVE_FENCE_RE = /```frameforge[ \t]*\r?\n([\s\S]*?)```/g;
export function directiveMarker(i) { return '⟦frameforge:' + i + '⟧'; }

// Parse every fence → { text: prose with fences replaced by markers, directives: [obj | {type:'malformed',raw}] }.
export function parseDirectives(text) {
  const directives = [];
  const clean = String(text || '').replace(DIRECTIVE_FENCE_RE, (_m, body) => {
    const i = directives.length;
    let d;
    try {
      d = JSON.parse(String(body).trim());
      if (!d || typeof d !== 'object' || Array.isArray(d)) d = { type: 'malformed', raw: String(body).trim() };
    } catch { d = { type: 'malformed', raw: String(body).trim() }; }
    directives.push(d);
    return directiveMarker(i);
  });
  return { text: clean, directives };
}

// Back-compat: the well-formed directive objects only (malformed fences dropped). Kept because
// callers/tests want "just the directives" without the marker rewrite. parseDirectives() is the one
// that also produces the placeholder-marked prose the cards render inline.
export function extractDirectives(text) {
  return parseDirectives(text).directives.filter(d => d && d.type !== 'malformed');
}

// Parse one decoded NDJSON object from claude's stream-json output, mutating `state` and emitting
// ticket-08 events. Pure + synchronous so stream parsing is unit-testable without a live process.
export function handleClaudeEvent(obj, emit, state) {
  if (!obj || typeof obj !== 'object') return;
  switch (obj.type) {
    case 'system':
      if (obj.session_id) state.cliSessionId = obj.session_id;
      break;
    case 'stream_event': {
      const ev = obj.event || {};
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
        state.text += ev.delta.text;
        emit({ type: 'text-delta', text: ev.delta.text });
      } else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
        emit({ type: 'tool-call', name: ev.content_block.name, callId: ev.content_block.id });
      }
      break;
    }
    case 'assistant': {
      // Full assistant block. With partial messages on, text already streamed via deltas, so only
      // surface tool_use calls here (deduped against the delta stream by type).
      for (const c of (obj.message?.content || [])) {
        if (c.type === 'tool_use') emit({ type: 'tool-call', name: c.name, callId: c.id });
      }
      break;
    }
    case 'user': {
      for (const c of (obj.message?.content || [])) {
        if (c.type === 'tool_result') emit({ type: 'tool-result', callId: c.tool_use_id });
      }
      break;
    }
    case 'result':
      // DEV-135. The result frame is the CLI's OWN failure channel — `is_error: true` plus an
      // `errors[]` array and an `error_*` subtype — and this parser used to ignore all three. A run
      // that failed inside the protocol was therefore read as a success with no text, so the turn
      // completed with an EMPTY assistant bubble and no error anywhere: "agent mode does nothing".
      if (obj.is_error === true || /^error/.test(String(obj.subtype || ''))) {
        const errs = Array.isArray(obj.errors) ? obj.errors.filter(Boolean).map(String) : [];
        state.protocolError = errs.join('; ') || String(obj.subtype || 'the agent CLI reported an error');
        // Do NOT adopt session_id from a failed run. The CLI echoes back the id we ASKED to resume,
        // so a "No conversation found" failure would write the bad id straight back into the session
        // record — every later turn resumes the same dead conversation and the chat is bricked for
        // good. That is the self-perpetuating half of DEV-135; a resume id is only trustworthy from
        // a run that actually worked.
      } else if (obj.session_id) {
        state.cliSessionId = obj.session_id;
      }
      if (typeof obj.total_cost_usd === 'number') state.cost = obj.total_cost_usd;
      if (typeof obj.result === 'string' && obj.result.trim()) state.result = obj.result;
      break;
  }
}

// "the conversation this session wants to resume is gone" — the one failure worth retrying, because
// the fix (drop --resume, start a fresh CLI conversation) is deterministic and costs one run. Matched
// on the CLI's message rather than an exit code, which is a bare 1 for every failure class.
export function isStaleResumeError(msg) {
  return /no conversation found with session id/i.test(String(msg || ''));
}

// ── launching a CLI on Windows ──
// The rule itself now lives in backend/launch.mjs, a leaf module, so backend/jobs.mjs can import
// it too — it could not before, because agentRunner imports resolveBin FROM jobs.mjs and the cycle
// would have been jobs -> agentRunner -> jobs. That is why every non-agent spawn site in the app
// was still launching raw and still failing on Windows after agent chat was fixed.
//
// Re-exported here so existing importers and tests/phase-agent-runner.test.mjs keep working
// against the same names. There is still exactly one implementation.
export { cmdShimScript, cmdEscape, planLaunch } from './launch.mjs';

// Spawn a CLI and pump its stdout. In `stream` mode, stdout is NDJSON split on newlines and each
// object handed to parseLine; otherwise stdout is buffered whole. Resolves (never rejects) with
// { text, cost, cliSessionId, cancelled, err } so the caller decides how to surface failure.
function spawnAndStream({ bin, args, emit, signal, parseLine, stream, env }) {
  return new Promise(resolve => {
    let child;
    try {
      const plan = planLaunch(bin, args);
      const spawnOpts = {
        env: plan.env ? { ...(env || agentEnv()), ...plan.env } : (env || agentEnv()),
        shell: false, stdio: ['ignore', 'pipe', 'pipe'], cwd: getStorageRoot()
      };
      if (plan.verbatim) spawnOpts.windowsVerbatimArguments = true;
      child = spawn(plan.file, plan.args, spawnOpts);
    } catch (e) { return resolve({ text: '', cost: 0, cliSessionId: null, cancelled: false, err: e.message }); }

    const state = { text: '', result: '', cost: 0, cliSessionId: null, protocolError: null };
    let stdout = '', stderr = '', buf = '', settled = false, cancelled = false, onAbort = null;
    let exitCode = null;

    const finish = (extra = {}) => {
      if (settled) return; settled = true;
      clearTimeout(timer);
      if (onAbort && signal) signal.removeEventListener?.('abort', onAbort);
      const text = stream ? (state.result || state.text) : stdout;
      // DEV-135 — three failure channels, in order of how specific they are. The old expression only
      // consulted the third (`stderr && !text`), so a run that failed INSIDE the stream-json protocol
      // with a quiet stderr resolved as a clean success, and a run that failed after emitting some
      // text lost its error entirely. A non-zero exit is the backstop for a CLI that says nothing at
      // all. `err` is now set independently of whether text arrived; the CALLER decides whether
      // partial text is worth keeping (see runClaude).
      // stderr only counts as a FAILURE when the process actually failed or came back empty — CLIs
      // routinely log warnings there on a perfectly good run, and promoting those to an error would
      // put a spurious "stopped early" notice on every successful turn.
      // A fourth channel, and the quietest one: the process started, exited 0 and said NOTHING —
      // not a byte on stdout, not a byte on stderr. Every clause above returns null for that, so the
      // turn used to complete with `err: null` and an empty assistant bubble: the agent "succeeded"
      // and replied with nothing. That is what a Windows user saw behind a launch this file could
      // not perform, and it is indistinguishable from a working CLI to everything downstream. A run
      // that produced no output is a failed run; say so.
      const failed = !!exitCode || !text;
      const err = extra.err
        || state.protocolError
        || (failed && stderr.trim() ? stderr.trim().slice(0, 300) : null)
        || (exitCode ? 'the agent CLI exited with code ' + exitCode + ' and produced no error message' : null)
        || (!text && !cancelled ? 'the agent CLI produced no output' : null);
      resolve({ text, cost: state.cost, cliSessionId: state.cliSessionId, cancelled, err });
    };

    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } finish({ err: 'timeout after ' + TURN_TIMEOUT_MS / 1000 + 's' }); }, TURN_TIMEOUT_MS);
    timer.unref?.();

    if (signal) {
      if (signal.aborted) { cancelled = true; try { child.kill('SIGKILL'); } catch { /* gone */ } }
      onAbort = () => {
        cancelled = true;
        try { child.kill('SIGTERM'); } catch { /* gone */ }
        const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 500);
        t.unref?.();
      };
      signal.addEventListener?.('abort', onAbort, { once: true });
    }

    child.on('error', e => finish({ err: e.message }));
    // utf8 decoding must happen at the STREAM, not per chunk: a multi-byte character (— " emoji, CJK)
    // whose bytes straddle two 'data' events would otherwise be toString()'d in halves and land as
    // U+FFFD in both the NDJSON parse buffer and the persisted reply.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', d => { stderr += d; });
    child.stdout.on('data', d => {
      stdout += d;
      if (!stream || !parseLine) return;
      buf += d;
      let ix;
      while ((ix = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, ix).trim(); buf = buf.slice(ix + 1);
        if (!line) continue;
        let obj; try { obj = JSON.parse(line); } catch { continue; }
        try { parseLine(obj, emit, state); } catch { /* one bad frame never kills the turn */ }
      }
    });
    child.on('close', code => {
      exitCode = code;
      if (stream && parseLine && buf.trim()) { try { parseLine(JSON.parse(buf.trim()), emit, state); } catch { /* trailing junk */ } }
      finish();
    });
  });
}

async function runClaude({ bin, session, userText, emit, signal, home, projectContext = '', model, effort }) {
  // Isolated home + session Index: the CLI is pointed at CLAUDE_CONFIG_DIR=<home> (global skills never
  // load) and the Index is injected as a system-prompt appendix (the router SKILL.md is never edited).
  const systemPrompt = indexInjection(home.indexText) + (projectContext ? '\n\n' + projectContext : '');
  const run = resume => spawnAndStream({
    bin,
    args: [...(home.extraArgs || []), '--append-system-prompt', systemPrompt,
      ...buildClaudeArgs({ prompt: String(userText || ''), resume, allowedTools: allowedToolsValue(session), model, effort })],
    emit, signal, parseLine: handleClaudeEvent, stream: true, env: { ...agentEnv(), ...(home.env || {}) }
  });

  const resume = session?.cliSessionId || null;
  let res = await run(resume);

  // DEV-135 — stale --resume recovery. The stored cliSessionId points at a conversation inside the
  // isolated CLAUDE_CONFIG_DIR; if that home is rebuilt (or the CLI prunes its history) the id
  // survives in the session record but the conversation does not, and EVERY later turn dies with
  // "No conversation found with session ID". Without this the chat is permanently dead while the
  // settings test — which passes no --resume at all — stays green forever. That is the reported bug.
  // Retry once from a clean conversation: the transcript is on disk either way, so the only thing
  // lost is the CLI's own cache of it.
  if (resume && !res.cancelled && isStaleResumeError(res.err)) {
    emit({ type: 'notice', text: 'The agent’s previous conversation was no longer available — starting a fresh one for this session.' });
    res = await run(null);
    // a fresh conversation always reports a NEW id; chat.mjs persists it and the session self-heals
  }

  const raw = String(res.text || '').trim();
  // The error is no longer conditional on there being no text: a run that streamed a few tokens and
  // THEN failed used to have its error dropped on the floor, so the user saw a truncated reply and
  // no indication anything went wrong. Partial text is still worth keeping, so it is surfaced with
  // the failure appended rather than discarded.
  if (res.err && !res.cancelled) {
    if (!raw) throw new Error('agent run failed: ' + res.err);
    emit({ type: 'notice', text: 'The agent stopped early: ' + res.err });
  }
  // Detect directive fences anywhere in the reply; persist the marker-rewritten prose + typed parts.
  const { text, directives } = parseDirectives(raw);
  for (const d of directives) emit({ type: 'directive', directive: d });
  return { text, directives, cost: res.cost || 0, cliSessionId: res.cliSessionId, cancelled: res.cancelled };
}

async function runOneShot({ bin, kind, session, history, userText, emit, signal, home, projectContext = '', model, effort }) {
  const tail = transcriptTail(history);
  // A generic CLI has no --append-system-prompt; the Index rides at the head of the prompt instead,
  // and the isolation env still relocates its config dir (a no-op for non-claude profiles).
  const prompt = indexInjection(home.indexText) + '\n\n' +
    (projectContext ? projectContext + '\n\n' : '') +
    (tail ? tail + '\n' : '') + 'User: ' + String(userText || '');
  // sessionArgs must precede the subcommand-shaped promptArgs (`codex exec …`): codex takes -m/-c
  // before `exec`, not after the prompt.
  const p = providerById(kind);
  const args = [...(home.extraArgs || []), ...(p ? p.sessionArgs({ model, effort }) : []),
    ...buildOneShotArgs({ prompt, kind, allowedTools: allowedToolsValue(session) })];
  const res = await spawnAndStream({ bin, args, emit, signal, stream: false, env: { ...agentEnv(), ...(home.env || {}) } });
  const raw = String(res.text || '').trim();
  // same contract as runClaude: a failure is reported whether or not text arrived (DEV-135)
  if (res.err && !res.cancelled) {
    if (!raw) throw new Error('agent run failed: ' + res.err);
    emit({ type: 'notice', text: 'The agent stopped early: ' + res.err });
  }
  // whole-message: a one-shot CLI has no token stream, so the reply arrives as ONE text-delta. The
  // live delta carries the raw reply; the persisted message carries the marker-rewritten prose that
  // the cards render inline (turn-done refetches it).
  if (raw && !res.cancelled) emit({ type: 'text-delta', text: raw });
  const { text, directives } = parseDirectives(raw);
  for (const d of directives) emit({ type: 'directive', directive: d });
  return { text, directives, cost: 0, cancelled: res.cancelled };
}

// The `cli` executor. Signature matches ticket 08's seam:
//   async ({ session, loc, history, userText, attachments, emit, signal }) =>
//     ({ text, directives, cost, cliSessionId?, cancelled?, setup? })
export async function cliExecutor(ctx = {}) {
  const { session, history = [], userText, emit, signal, projectContext = '' } = ctx;
  const command = session?.agentCommand || getSettings().agentCommand || 'claude';
  const bin = resolveBin(command);

  if (!bin) {
    emit?.({ type: 'setup', reason: 'agent-not-installed', command });
    return {
      text: 'No agent CLI is connected (' + command + ' not found). Install or sign in from Settings → Agent, then try again.',
      directives: [], cost: 0, setup: true
    };
  }

  // Prepare the isolated agent home for THIS session on every turn: fresh router copy (tamper-reset),
  // remounted enabled packs, regenerated Index + Core-API ref against live locks/mode.
  const home = prepareAgentHome({ session, apiBase: selfApiBase() });

  // Model/effort: per-session override wins, else the global setting, validated against what THIS
  // provider actually accepts (an unknown value would otherwise kill the run on an unrecognised arg).
  const s = getSettings();
  const { model, effort } = resolveSessionModel(providerFor(command), {
    model: session?.agentModel || s.agentModel,
    effort: session?.agentEffort || s.agentEffort
  });

  const kind = runnerKind(command);
  return kind === 'claude'
    ? runClaude({ bin, session, userText, emit, signal, home, projectContext, model, effort })
    : runOneShot({ bin, kind, session, history, userText, emit, signal, home, projectContext, model, effort });
}

// ── the honest connection test (DEV-135, acceptance 3) ──
//
// jobs.mjs testAgent() answers "can this CLI reply to a bare prompt?" — no tools, no system prompt,
// no isolated home, default cwd, no --resume. A chat turn is none of those things, so a green test
// proved nothing about the thing that was broken and the user was told the agent worked while every
// message vanished into silence.
//
// This runs the REAL pipeline instead: the same prepareAgentHome(), the same CLAUDE_CONFIG_DIR, the
// same cwd, the same --allowedTools + --append-system-prompt argv the runner builds. It reports each
// stage separately, so a failure says WHICH layer broke rather than just "not connected".
export async function testAgentPipeline({ session = null } = {}) {
  const stages = [];
  const stage = (name, ok, detail) => { stages.push({ name, ok, detail: detail || '' }); return ok; };
  const done = ok => ({ ok, stages });

  const command = getSettings().agentCommand || 'claude';
  const bin = resolveBin(command);
  if (!stage('bin', !!bin, bin || command + ' was not found on PATH')) return done(false);

  // A throwaway session so the probe never touches a real conversation's resume id or home.
  const probe = session || { id: 'agent-selftest', scope: 'standalone', executor: 'cli', allowedTools: [] };
  let home;
  try {
    home = prepareAgentHome({ session: probe, apiBase: selfApiBase() });
    stage('isolated-home', true, home.env?.CLAUDE_CONFIG_DIR || home.dir || 'prepared');
  } catch (e) {
    stage('isolated-home', false, String(e.message || e));
    return done(false);
  }

  const s = getSettings();
  const { model, effort } = resolveSessionModel(providerFor(command), {
    model: probe.agentModel || s.agentModel, effort: probe.agentEffort || s.agentEffort
  });

  // The load-bearing stage: a one-token turn through the exact argv/env a chat message uses. This is
  // what would have caught the stale --resume, a home missing its carried credentials, and a parser
  // that read an is_error frame as success.
  const kind = runnerKind(command);
  const emit = () => { /* the probe has no SSE channel */ };
  try {
    const res = kind === 'claude'
      ? await runClaude({ bin, session: { ...probe, cliSessionId: null }, userText: 'Reply with exactly: OK', emit, home, model, effort })
      : await runOneShot({ bin, kind, session: probe, history: [], userText: 'Reply with exactly: OK', emit, home, model, effort });
    const text = String(res.text || '').trim();
    if (!stage('turn', !!text, text.slice(0, 120) || 'the run completed but returned no text')) return done(false);
  } catch (e) {
    const msg = String(e.message || e);
    stage('turn', false, msg);
    // classify the two failures a filmmaker can actually act on
    if (/401|auth|credential|log ?in|OAuth/i.test(msg)) stages.push({ name: 'auth', ok: false, detail: 'the isolated home has no usable credentials — sign in again from Settings' });
    return done(false);
  }
  return done(true);
}
