// Filmmaker chat sessions (ticket 08) — durable, resumable conversations that let the agent
// operate FrameForge through its own HTTP API. Everything is a portable markdown record, exactly
// like the rest of the store: no database, no in-memory session state that a restart would lose.
//
// Two records per session, both under the project dir (project-scoped chat) or a workspace-level
// `chat/` dir (standalone chat):
//   · <id>.md            — the session (frontmatter: id, scope, project, title, mode, executor,
//                          agentCommand, checkpoints, branchedFrom, archived, created/updated)
//   · <id>.messages.md   — the append-only transcript (frontmatter: { session, project, messages:[] })
//
// The turn EXECUTOR is a pluggable boundary. This ticket ships only the `simulate` executor (a
// scripted echo that streams text-delta events with no CLI, no network — hermetic under tests).
// Ticket 09 registers a `cli` executor at the same seam via registerExecutor(); nothing else here
// changes. runTurn() owns persistence + the SSE event envelope; an executor only produces the
// stream of deltas/directives and returns the final assistant text.
//
// The per-session SSE channel mirrors the activity feed (backend/indexer.mjs): a tiny subscriber
// set, typed events, a heartbeat. Event vocabulary: turn-started · text-delta · directive ·
// turn-done · error (executors may emit further pass-through types, e.g. tool-call, later).
import fs from 'fs';
import path from 'path';
import { getStorageRoot, readMd, writeMd, stamp, safe, safeScope, getSettings, paths } from './store.mjs';
import { findAgent } from './jobs.mjs';
import { cliExecutor, directiveMarker } from './agentRunner.mjs';
import { readMemory } from './memory.mjs';

// ── session-start "project understanding" (ticket 20) ──
// The block injected into the agent at session start so a new chat opens already knowing the project:
// its brief (authoritative direction) + the memory hot-cache (durable learnings distilled from past
// sessions). Standalone chats have no project, hence no block. Returns '' when there is nothing to
// inject — the caller then adds nothing. runTurn passes this to the executor as ctx.projectContext;
// the router/CLI path appends it alongside the Index (see backend/agentRunner.mjs) and the hermetic
// `simulate` executor simply acknowledges it, so the injection is observable in tests.
export function projectUnderstanding(project) {
  if (!project) return '';
  let brief = '';
  try { brief = readMd(paths.briefMd(project)).content.trim(); } catch { /* no brief */ }
  const memory = readMemory(project).body;
  if (!brief && !memory) return '';
  const L = ['<frameforge-project-understanding>',
    'What you already know about this project — the user should not have to re-explain it.'];
  if (brief) L.push('', '## Project brief (authoritative direction)', brief);
  if (memory) L.push('', '## Project memory (hot cache — durable learnings from past sessions)', memory);
  L.push('</frameforge-project-understanding>');
  return L.join('\n');
}

const R = () => getStorageRoot();
const standaloneChatDir = () => path.join(R(), 'chat');
const projectChatDir = pid => path.join(R(), 'projects', safeScope(pid), 'chat');
const chatDirFor = (scope, pid) => (scope === 'project' ? projectChatDir(pid) : standaloneChatDir());
const sessionFile = (dir, id) => path.join(dir, safe(id) + '.md');
const messagesFile = (dir, id) => path.join(dir, safe(id) + '.messages.md');

// ── executor registry (the ticket-09 seam) ──
const executors = new Map();
export function registerExecutor(name, fn) { executors.set(name, fn); }
export function hasExecutor(name) { return executors.has(name); }

// The only executor this ticket ships. A scripted echo that streams its reply one word at a time so
// the whole turn loop (SSE order, persistence, checkpoints) is exercisable without an agent CLI.
const STREAM_DELAY = process.env.FRFG_TEST === '1' ? 0 : 35;
const nap = ms => new Promise(r => { const t = setTimeout(r, ms); t.unref?.(); });
async function simulateExecutor({ userText, projectContext, emit }) {
  const lead = projectContext ? 'Working with the project brief and memory already in context. ' : '';
  const text = lead + 'Simulated agent (no CLI connected). You said: ' + JSON.stringify(String(userText || '')) + '.';
  const words = text.split(' ');
  for (let i = 0; i < words.length; i++) {
    emit({ type: 'text-delta', text: (i ? ' ' : '') + words[i] });
    await nap(STREAM_DELAY); // yields to the event loop so SSE bytes flush in order, even at 0ms
  }
  return { text, directives: [], cost: 0 };
}
registerExecutor('simulate', simulateExecutor);

// Ticket 09 — the streaming agent runner registers itself at the same seam. Owns the OS process;
// runTurn (below) still owns persistence + the SSE envelope.
registerExecutor('cli', cliExecutor);

// Executor selection. Explicit wins (tests opt into 'cli' with a stub agentCommand). Otherwise:
// hermetic 'simulate' under tests (no CLI ever spawned), else 'cli' when the agent binary is
// installed, else 'simulate' so a first-run/demo box degrades to setup instead of failing.
function chooseExecutor(explicit) {
  if (explicit && executors.has(explicit)) return explicit;
  if (process.env.FRFG_TEST === '1') return 'simulate';
  try { return findAgent() ? 'cli' : 'simulate'; } catch { return 'simulate'; }
}

// ── per-session SSE subscribers ──
const subscribers = new Map(); // id -> Set<res>
export function subscribeSession(id, res) {
  let set = subscribers.get(id);
  if (!set) { set = new Set(); subscribers.set(id, set); }
  set.add(res);
  res.on('close', () => { set.delete(res); if (!set.size) subscribers.delete(id); });
  return () => set.delete(res);
}
export function sessionSubscriberCount(id) { return subscribers.get(id)?.size || 0; }
function broadcast(id, type, data) {
  const set = subscribers.get(id);
  if (!set || !set.size) return;
  const payload = 'event: ' + type + '\ndata: ' + JSON.stringify(data) + '\n\n';
  for (const res of set) { try { res.write(payload); } catch { set.delete(res); } }
}

// ── record helpers ──
function readSession(dir, id) {
  try { return readMd(sessionFile(dir, id)).data; } catch { return null; }
}
function writeSession(dir, s) {
  const body = '## Chat session\n\n' + (s.title || '(untitled)') + ' — ' + s.scope +
    (s.project ? ' · ' + s.project : '') + ' · ' + (s.mode || 'agent') + ' mode\n';
  writeMd(sessionFile(dir, s.id), s, body);
  return s;
}
function readMessages(dir, id) {
  try { const { data } = readMd(messagesFile(dir, id)); return Array.isArray(data.messages) ? data.messages : []; }
  catch { return []; }
}
function writeMessages(dir, id, project, messages) {
  const body = '## Transcript\n\n' + messages.map(m =>
    '**' + m.role + '** (' + (m.tsStamp || '') + '): ' + String(m.text || (m.error ? '⚠ ' + m.error : '')).slice(0, 500)
  ).join('\n\n') + '\n';
  writeMd(messagesFile(dir, id), { session: id, project: project || null, count: messages.length, messages }, body);
  return messages;
}

let seq = 0;
function newId() { return 'chat-' + Date.now() + '-' + (++seq).toString(36); }

// Find which dir holds a session id (standalone first, then every project's chat dir). Returns
// { scope, pid, dir } or null. The datastore is the source of truth — no in-memory index to drift.
export function locate(id) {
  const safeId = safe(id);
  const sd = standaloneChatDir();
  if (fs.existsSync(path.join(sd, safeId + '.md'))) return { scope: 'standalone', pid: null, dir: sd };
  const projRoot = path.join(R(), 'projects');
  if (fs.existsSync(projRoot)) {
    for (const p of fs.readdirSync(projRoot).filter(d => !d.startsWith('.') && !d.startsWith('_'))) {
      const cd = projectChatDir(p);
      if (fs.existsSync(path.join(cd, safeId + '.md'))) return { scope: 'project', pid: p, dir: cd };
    }
  }
  return null;
}

function listDir(dir, project) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md') && !f.endsWith('.messages.md') && !f.startsWith('.') && !f.endsWith('.bak'))
    .map(f => { try { return readMd(path.join(dir, f)).data; } catch { return null; } })
    .filter(Boolean)
    .map(s => ({ ...s, project: project ?? s.project ?? null }));
}

// List sessions. { project } → that project's chat; { all:true } → every scope; otherwise standalone.
export function listSessions({ project, all, includeArchived, kinds } = {}) {
  let out = [];
  if (all) {
    out = out.concat(listDir(standaloneChatDir(), null));
    const projRoot = path.join(R(), 'projects');
    if (fs.existsSync(projRoot)) {
      for (const p of fs.readdirSync(projRoot).filter(d => !d.startsWith('.') && !d.startsWith('_'))) {
        out = out.concat(listDir(projectChatDir(p), p));
      }
    }
  } else if (project) {
    out = listDir(projectChatDir(safeScope(project)), safeScope(project));
  } else {
    out = listDir(standaloneChatDir(), null);
  }
  if (!includeArchived) out = out.filter(s => !s.archived);
  // Tool-builder sessions are a means, not a conversation the filmmaker keeps: they are standalone
  // chats, so without this every visit to "+ New tool" would leave an identical "New tool" row in
  // the ordinary chat list. Pass { kinds: ['toolsmith'] } to see them. (ticket 25)
  out = kinds ? out.filter(s => kinds.includes(s.kind || 'chat')) : out.filter(s => (s.kind || 'chat') === 'chat');
  return out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

export function getSession(id) {
  const loc = locate(id);
  if (!loc) return null;
  const s = readSession(loc.dir, id);
  if (!s) return null;
  return { ...s, messages: readMessages(loc.dir, id) };
}

export function createSession({ project, title, mode, executor, agentCommand, kind } = {}) {
  const scope = project ? 'project' : 'standalone';
  const pid = project ? safeScope(project) : null;
  const id = newId();
  const dir = chatDirFor(scope, pid);
  const now = Date.now();
  const s = {
    id, schema: 1, scope, project: pid,
    title: String(title || '').trim() || 'New chat',
    mode: mode === 'manual' ? 'manual' : 'agent',
    // What the session IS, fixed at birth and never patchable (unlike `mode`, which the user flips).
    // 'toolsmith' makes prepareAgentHome mount the tool-builder skill — the whole force-load
    // mechanism behind the "+ New tool" button. Anything else is an ordinary chat.
    kind: kind === 'toolsmith' ? 'toolsmith' : 'chat',
    // executor selection is the ticket-09 seam (cli | simulate)
    executor: chooseExecutor(executor),
    agentCommand: agentCommand || getSettings().agentCommand || 'claude',
    // ticket-09 runtime fields: CLI-side conversation id (resume target) and per-session tool scope
    cliSessionId: null, allowedTools: [],
    checkpoints: [], branchedFrom: null, archived: false,
    created: now, createdAt: stamp(), updated: now, updatedAt: stamp()
  };
  writeSession(dir, s);
  writeMessages(dir, id, pid, []);
  return { ...s, messages: [] };
}

export function patchSession(id, patch = {}) {
  const loc = locate(id);
  if (!loc) return null;
  const s = readSession(loc.dir, id);
  if (!s) return null;
  const next = { ...s };
  if (patch.title !== undefined) next.title = String(patch.title).trim() || s.title;
  if (patch.mode !== undefined) next.mode = patch.mode === 'manual' ? 'manual' : 'agent';
  if (patch.archived !== undefined) next.archived = !!patch.archived;
  if (patch.closed !== undefined) next.closed = !!patch.closed;   // ticket 20 — session-end marker
  if (patch.allowedTools !== undefined) next.allowedTools = Array.isArray(patch.allowedTools) ? patch.allowedTools.map(String) : [];
  next.updated = Date.now();
  next.updatedAt = stamp();
  writeSession(loc.dir, next);
  return next;
}

// Record that a session has been distilled up to its current activity watermark — WITHOUT bumping
// `updated` (a distillation pass is not user activity). The idle sweep uses distilledAt >= updated to
// skip sessions with nothing new since their last distillation. (ticket 20)
export function markSessionDistilled(id, at) {
  const loc = locate(id);
  if (!loc) return null;
  const s = readSession(loc.dir, id);
  if (!s) return null;
  const next = { ...s, distilledAt: at || s.updated || Date.now() };
  writeSession(loc.dir, next);
  return next;
}

function touchSession(loc, id) {
  const s = readSession(loc.dir, id);
  if (!s) return;
  writeSession(loc.dir, { ...s, updated: Date.now(), updatedAt: stamp() });
}

function makeMessage(role, extra = {}) {
  return {
    id: 'm-' + Date.now() + '-' + (++seq).toString(36),
    role, ts: Date.now(), tsStamp: stamp(),
    turn: extra.turn ?? 0, text: extra.text || '',
    directives: extra.directives || [], attachments: extra.attachments || [],
    cost: extra.cost || 0,
    ...(extra.error ? { error: String(extra.error) } : {}),
    ...(extra.cancelled ? { cancelled: true } : {})
  };
}
function appendMessage(loc, id, project, msg) {
  const messages = readMessages(loc.dir, id);
  messages.push(msg);
  writeMessages(loc.dir, id, project, messages);
  return msg;
}

// A running turn per session id, so the cancel route can stop the spawned process. One turn at a
// time per session (the composer blocks re-posting mid-turn), so a single controller suffices.
const activeTurns = new Map(); // id -> AbortController

// Cancel the in-flight turn for a session, if any. The executor observes the AbortSignal, kills its
// child, and returns the partial text; runTurn then persists it marked cancelled. Returns whether a
// turn was actually running.
export function cancelTurn(id) {
  const ac = activeTurns.get(id);
  if (!ac) return false;
  try { ac.abort(); } catch { /* already aborted */ }
  return true;
}

// ── system events (ticket 13 — Production Panel) ──
// A compact, machine-authored transcript entry: ids only, NEVER restated content. The Production
// Panel appends one to the ACTIVE session when a creative lock changes (e.g. the style lock) so the
// conversation's world stays current without a token-heavy restatement — the agent's next turn picks
// up the actual lock via the Index (agentHome.locksForProject); this row is just the in-band signal
// that it moved. Persisted like any message and broadcast on the SSE channel as `system-event` so an
// open transcript reflects it live. Deliberately does NOT touch `updated`/distill watermarks: a lock
// change is a world event, not user activity, and must not re-arm the idle-distill sweep.
export function appendSystemEvent(id, text) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  const loc = locate(id);
  if (!loc) return null;
  const session = readSession(loc.dir, id);
  if (!session) return null;
  const msg = appendMessage(loc, id, session.project, makeMessage('system', { text: clean }));
  broadcast(id, 'system-event', { message: msg });
  return msg;
}

// ── manual-mode turns (ticket 19) ──
// A generation the user composed directly in the chat composer (the Agent⇄Manual switch flipped to
// Manual): the client already STARTED the generation(s) through the normal /api/generate or
// /api/batches routes, then records the turn here. No executor runs, no LLM, no cost on the chat
// message itself — the started generation records carry their own ledgered cost. We append two
// messages so the turn reads exactly like an agent-initiated one and the SAME inline generation cards
// (ticket 14) render it:
//   · a compact USER message describing the manual action (model · kind · prompt snippet)
//   · an ASSISTANT message whose text is a ⟦frameforge:0⟧ marker with the generation directive in
//     directives[0] — ticket 12's persistence shape, so renderMessageBody places the card inline.
// The directive is the router grammar's ids-only envelope: { type:'generation', ref:<genId>, project }
// for a single generate, or { type:'generation.batch', batch:<batchId>, project } for a variant batch.
// Broadcasts turn-done so any open transcript (this client and others) reconciles the two new records.
export function recordManualTurn(id, { userText, assistantText, directive } = {}) {
  const loc = locate(id);
  if (!loc) return null;
  const session = readSession(loc.dir, id);
  if (!session) return null;
  if (!directive || typeof directive !== 'object') throw new Error('manual turn requires a generation directive');
  const prior = readMessages(loc.dir, id);
  const turn = prior.filter(m => m.role === 'user').length; // 0-based, same counter as runTurn
  const userMsg = appendMessage(loc, id, session.project,
    makeMessage('user', { turn, text: String(userText || 'Manual generation') }));
  const lead = String(assistantText || '').trim();
  const body = (lead ? lead + '\n\n' : '') + directiveMarker(0);
  const asstMsg = appendMessage(loc, id, session.project,
    makeMessage('assistant', { turn, text: body, directives: [directive] }));
  touchSession(loc, id);
  broadcast(id, 'turn-done', { turn, assistantMessage: asstMsg, cost: 0 });
  return { turn, userMessage: userMsg, assistantMessage: asstMsg };
}

// ── attachments (ticket 18) ──
// Files the user dropped/picked in the composer were uploaded into the project's context boards via
// the EXISTING context upload routes (frontend/Chat.jsx → api.uploadContext). The message record
// carries compact refs — { id, kind, name, folder, scope } — persisted on the user message so the
// bubble can render image thumbnails and survive reload. The AGENT never sees the binary: it receives
// a short structured line appended to the turn's user text so it can act on each file by reference.
// For images that reference is the exact {scope,folder,name} triple the /api/generate route accepts
// as a `refs` entry (so an attached still becomes a generation ref by id, no prose description). For
// documents it is the GET url the agent fetches through FrameForge's own HTTP API. Exported so a test
// can assert the refs reach the prompt without a live agent subscription.
export function attachmentPromptLine(attachments = []) {
  const list = (Array.isArray(attachments) ? attachments : []).filter(a => a && a.name);
  if (!list.length) return '';
  const lines = list.map(a => {
    const folder = a.folder || '';
    const scope = a.scope || '';
    const rel = 'context/' + (folder ? folder + '/' : '') + a.name;
    const kind = a.kind || 'file';
    if (kind === 'image') {
      return '- ' + rel + ' (image) — to use it as a generation reference, add refs:[{ scope:"' + scope +
        '", folder:"' + folder + '", name:"' + a.name + '" }] to the generate call; do NOT describe its contents into the prompt.';
    }
    const url = '/api/context/' + scope + '/file?folder=' + encodeURIComponent(folder) + '&name=' + encodeURIComponent(a.name);
    return '- ' + rel + ' (' + kind + ') — read it via GET ' + url + ' (FrameForge HTTP API).';
  });
  return ['[attached files — already saved in this project\'s context boards]', ...lines].join('\n');
}

// Run one user turn: append the user message, stream the executor's reply over SSE, append the
// assistant message durably, then signal turn-done. turn-done ALWAYS means everything is on disk.
// Fire-and-forget from the route (a real CLI turn is long) — the SSE channel is the progress feed.
export async function runTurn(id, userText, attachments = []) {
  const loc = locate(id);
  if (!loc) throw new Error('session not found');
  const session = readSession(loc.dir, id);
  if (!session) throw new Error('session not found');

  const prior = readMessages(loc.dir, id);
  const turn = prior.filter(m => m.role === 'user').length; // 0-based turn index

  // Inject the project understanding (brief + memory hot-cache) on the first turn the AGENT actually
  // runs, so it opens already knowing the project; later turns rely on CLI resume to retain it.
  // Keyed on a session flag, not the user-message count: a manual-mode generation appends a user
  // message without running any executor (and without establishing a resume id), so counting would
  // skip the injection entirely for anyone who generates before they talk.
  const needsContext = session.scope === 'project' && !session.understandingInjected;
  const projectContext = needsContext ? projectUnderstanding(session.project) : '';

  const userMsg = appendMessage(loc, id, session.project, makeMessage('user', { turn, text: String(userText || ''), attachments }));
  broadcast(id, 'turn-started', { turn, userMessage: userMsg });

  // The executor sees the user's text PLUS a compact attachment-refs block (paths/ids the agent can
  // fetch or cite); the persisted user message above keeps the clean text so the bubble stays tidy.
  const attachBlock = attachmentPromptLine(attachments);
  const agentText = attachBlock ? (String(userText || '') + '\n\n' + attachBlock) : String(userText || '');

  // accumulate streamed deltas so a cancelled turn (whose executor may return nothing) still persists
  // whatever tokens reached the client.
  let streamed = '';
  const emit = ev => {
    if (!ev || !ev.type) return;
    if (ev.type === 'directive') broadcast(id, 'directive', { turn, directive: ev.directive });
    else if (ev.type === 'text-delta') { streamed += ev.text || ''; broadcast(id, 'text-delta', { turn, text: ev.text }); }
    else broadcast(id, ev.type, { turn, ...ev }); // pass-through (tool-call, tool-result, setup…)
  };

  const ac = new AbortController();
  activeTurns.set(id, ac);

  try {
    const exec = executors.get(session.executor) || executors.get('simulate');
    const result = await exec({ session, loc, history: prior, userText: agentText, attachments, emit, signal: ac.signal, projectContext }) || {};

    // Resume: persist the CLI-side conversation id so the next turn passes --resume and never re-sends
    // the transcript. Read fresh (the record may have changed) and preserve every other field.
    const newCliSession = result.cliSessionId && result.cliSessionId !== session.cliSessionId;
    // …and mark the understanding as delivered once the executor has actually seen it, so it is
    // injected exactly once per session rather than on every turn.
    if (newCliSession || needsContext) {
      const s = readSession(loc.dir, id);
      if (s) writeSession(loc.dir, {
        ...s,
        cliSessionId: newCliSession ? result.cliSessionId : s.cliSessionId,
        understandingInjected: s.understandingInjected || needsContext,
        updated: Date.now(), updatedAt: stamp()
      });
    }

    const finalText = result.text || streamed || '';
    if (ac.signal.aborted || result.cancelled) {
      const asstMsg = appendMessage(loc, id, session.project,
        makeMessage('assistant', { turn, text: finalText, directives: result.directives || [], cost: result.cost || 0, cancelled: true }));
      touchSession(loc, id);
      broadcast(id, 'turn-cancelled', { turn, assistantMessage: asstMsg, cost: result.cost || 0 });
      return { turn, assistantMessage: asstMsg, cancelled: true };
    }

    const asstMsg = appendMessage(loc, id, session.project,
      makeMessage('assistant', { turn, text: finalText, directives: result.directives || [], cost: result.cost || 0 }));
    touchSession(loc, id);
    broadcast(id, 'turn-done', { turn, assistantMessage: asstMsg, cost: result.cost || 0 });
    return { turn, assistantMessage: asstMsg };
  } catch (e) {
    const message = String(e.message || e);
    appendMessage(loc, id, session.project, makeMessage('assistant', { turn, error: message }));
    touchSession(loc, id);
    broadcast(id, 'error', { turn, message });
    throw e;
  } finally {
    activeTurns.delete(id);
  }
}

// ── checkpoints ──
// A checkpoint records a turn boundary — the transcript length at that moment. Restoring one
// BRANCHES: it creates a fresh session in the same scope containing history up to messageIndex,
// so rolling back never mutates or destroys the original conversation.
export function createCheckpoint(id, { label, turn } = {}) {
  const loc = locate(id);
  if (!loc) return null;
  const s = readSession(loc.dir, id);
  if (!s) return null;
  const messages = readMessages(loc.dir, id);
  const cp = {
    id: 'cp-' + Date.now() + '-' + (++seq).toString(36),
    turn: turn == null ? messages.filter(m => m.role === 'user').length : Number(turn),
    messageIndex: messages.length,
    label: String(label || '').trim() || ('checkpoint at ' + messages.length + ' messages'),
    created: Date.now(), createdAt: stamp()
  };
  const next = { ...s, checkpoints: [...(s.checkpoints || []), cp], updated: Date.now(), updatedAt: stamp() };
  writeSession(loc.dir, next);
  return cp;
}

export function restoreCheckpoint(id, cid) {
  const loc = locate(id);
  if (!loc) return null;
  const s = readSession(loc.dir, id);
  if (!s) return null;
  const cp = (s.checkpoints || []).find(c => c.id === cid);
  if (!cp) return null;
  const history = readMessages(loc.dir, id).slice(0, cp.messageIndex);
  // branch into a new session in the same scope/project
  // `kind` rides along: it is fixed at birth and decides which system skills mount, so a branch that
  // dropped it would silently lose the tool-builder skill mid-interview while the transcript still
  // read as a tool-building conversation. (ticket 25)
  const branch = createSession({ project: s.scope === 'project' ? s.project : null, title: s.title + ' (branch)', mode: s.mode, kind: s.kind });
  const bloc = locate(branch.id);
  writeMessages(bloc.dir, branch.id, branch.project, history);
  const branched = { ...readSession(bloc.dir, branch.id), branchedFrom: { session: id, checkpoint: cid, messageIndex: cp.messageIndex }, updated: Date.now(), updatedAt: stamp() };
  writeSession(bloc.dir, branched);
  return { ...branched, messages: history };
}

// ── promote-to-project (ticket 24) ──
// Bind a standalone chat to a project: move its two records (<id>.md + <id>.messages.md) out of the
// workspace-level chat/ dir into projects/<pid>/chat/ and flip scope 'standalone' → 'project'. The
// session id is preserved, so an open transcript and every later Index render simply carry the
// project from now on. Idempotent: re-binding to the same project is a no-op read-back; the project
// must already exist on disk (the UI creates it first via POST /api/projects). Returns the bound
// session (with messages) or null when the session or the target project is missing.
export function bindSession(id, project) {
  const pid = project ? safeScope(project) : null;
  if (!pid) return null;
  if (!fs.existsSync(path.join(R(), 'projects', pid))) return null; // no such project
  const loc = locate(id);
  if (!loc) return null;
  const s = readSession(loc.dir, id);
  if (!s) return null;
  const messages = readMessages(loc.dir, id);
  const destDir = projectChatDir(pid);
  // already bound here — nothing to move
  if (path.resolve(loc.dir) === path.resolve(destDir) && s.scope === 'project' && s.project === pid) {
    return { ...s, messages };
  }
  const next = { ...s, scope: 'project', project: pid, updated: Date.now(), updatedAt: stamp() };
  // write the destination first, then drop the source — a crash mid-move leaves a readable copy
  writeSession(destDir, next);
  writeMessages(destDir, id, pid, messages);
  if (path.resolve(loc.dir) !== path.resolve(destDir)) {
    for (const f of [sessionFile(loc.dir, id), messagesFile(loc.dir, id),
                     sessionFile(loc.dir, id) + '.bak', messagesFile(loc.dir, id) + '.bak']) {
      try { fs.unlinkSync(f); } catch { /* not there */ }
    }
  }
  return { ...next, messages };
}

export function registerChatRoutes(app, deps = {}) {
  const activity = deps.appendActivity || (() => {});

  // list — ?project=<pid> | ?all=1 | (default) standalone; ?archived=1 includes archived
  app.get('/api/chat/sessions', (req, res) => {
    res.json(listSessions({
      project: req.query.project ? String(req.query.project) : null,
      all: req.query.all === '1' || req.query.all === 'true',
      includeArchived: req.query.archived === '1'
    }));
  });

  app.post('/api/chat/sessions', (req, res) => {
    const { project, title, mode, kind } = req.body || {};
    try {
      const s = createSession({ project: project ? String(project) : null, title, mode, kind });
      // NB: never pass `ref: undefined` — appendActivity → writeMd only strips TOP-LEVEL undefined,
      // so a nested undefined reaches js-yaml and throws. Add `ref` only when defined.
      const ev = { dot: 'green', t: 'Chat session created', t2: '· ' + s.title, s: (s.project || 'standalone') + ' · ' + s.mode + ' mode', kind: s.project ? 'proj' : 'none' };
      if (s.project) ev.ref = s.project;
      activity(ev);
      res.json(s);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.get('/api/chat/sessions/:id', (req, res) => {
    const s = getSession(req.params.id);
    if (!s) return res.status(404).json({ error: 'session not found' });
    res.json(s);
  });

  app.patch('/api/chat/sessions/:id', (req, res) => {
    const s = patchSession(req.params.id, req.body || {});
    if (!s) return res.status(404).json({ error: 'session not found' });
    res.json(s);
  });

  app.post('/api/chat/sessions/:id/archive', (req, res) => {
    const s = patchSession(req.params.id, { archived: req.body?.archived === false ? false : true });
    if (!s) return res.status(404).json({ error: 'session not found' });
    res.json(s);
  });

  // promote a standalone chat to a project (ticket 24) — moves the session + transcript into the
  // project's chat dir and flips its scope, keeping the same id. The client creates the project via
  // POST /api/projects first, then calls this; the agent can do the same mid-conversation.
  app.post('/api/chat/sessions/:id/bind', (req, res) => {
    const project = req.body?.project ? String(req.body.project) : null;
    if (!project) return res.status(400).json({ error: 'bind requires a project id' });
    const loc = locate(req.params.id);
    if (!loc) return res.status(404).json({ error: 'session not found' });
    const bound = bindSession(req.params.id, project);
    if (!bound) return res.status(404).json({ error: 'session or project not found' });
    const ev = { dot: 'green', t: 'Chat promoted to project', t2: '· ' + (bound.title || bound.id), s: 'bound to ' + bound.project, kind: 'proj', ref: bound.project };
    activity(ev);
    res.json(bound);
  });

  // post a user turn — kicks off the executor; progress streams over the SSE endpoint below
  app.post('/api/chat/sessions/:id/turn', (req, res) => {
    const text = String(req.body?.text || '');
    const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    // ticket 18 — an attachments-only turn (e.g. "here's the reference still") is valid: the refs
    // reach the agent even with no prose. Reject only when there is genuinely nothing to send.
    if (!text.trim() && !attachments.length) return res.status(400).json({ error: 'turn text is empty' });
    const loc = locate(req.params.id);
    if (!loc) return res.status(404).json({ error: 'session not found' });
    const turn = readMessages(loc.dir, req.params.id).filter(m => m.role === 'user').length;
    runTurn(req.params.id, text, attachments).catch(() => { /* error already broadcast + persisted */ });
    res.json({ ok: true, turn });
  });

  // cancel the in-flight turn — stops the spawned agent process; runTurn persists the partial
  // assistant message (cancelled: true) and broadcasts a `turn-cancelled` event on the SSE channel.
  app.post('/api/chat/sessions/:id/cancel', (req, res) => {
    const loc = locate(req.params.id);
    if (!loc) return res.status(404).json({ error: 'session not found' });
    const cancelled = cancelTurn(req.params.id);
    res.json({ ok: true, cancelled });
  });

  // append a compact system event (ids only) to a session — the Production Panel posts one when a
  // creative lock changes so the active conversation's world stays current. See appendSystemEvent.
  app.post('/api/chat/sessions/:id/system-event', (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'system event text is empty' });
    const msg = appendSystemEvent(req.params.id, text);
    if (!msg) return res.status(404).json({ error: 'session not found' });
    res.json({ ok: true, message: msg });
  });

  // record a manual-mode generation turn (ticket 19) — the client started the generation via
  // /api/generate|/api/batches, this persists the user + assistant(directive) messages so the same
  // inline cards render it and it lands in session history + the cost ledger like an agent turn.
  app.post('/api/chat/sessions/:id/manual-turn', (req, res) => {
    const loc = locate(req.params.id);
    if (!loc) return res.status(404).json({ error: 'session not found' });
    try {
      const r = recordManualTurn(req.params.id, req.body || {});
      if (!r) return res.status(404).json({ error: 'session not found' });
      res.json({ ok: true, ...r });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // checkpoints — create + restore(branch)
  app.post('/api/chat/sessions/:id/checkpoint', (req, res) => {
    const cp = createCheckpoint(req.params.id, { label: req.body?.label, turn: req.body?.turn });
    if (!cp) return res.status(404).json({ error: 'session not found' });
    res.json(cp);
  });
  app.post('/api/chat/sessions/:id/checkpoint/:cid/restore', (req, res) => {
    const branch = restoreCheckpoint(req.params.id, req.params.cid);
    if (!branch) return res.status(404).json({ error: 'session or checkpoint not found' });
    const ev = { dot: 'amber', t: 'Chat branched from checkpoint', t2: '· ' + branch.title, s: 'new session ' + branch.id, kind: branch.project ? 'proj' : 'none' };
    if (branch.project) ev.ref = branch.project;
    activity(ev);
    res.json(branch);
  });

  // per-session SSE stream — typed turn events (mirrors backend/indexer.mjs /api/events)
  app.get('/api/chat/sessions/:id/stream', (req, res) => {
    const loc = locate(req.params.id);
    if (!loc) return res.status(404).json({ error: 'session not found' });
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    res.write('event: hello\ndata: ' + JSON.stringify({ id: req.params.id }) + '\n\n');
    subscribeSession(req.params.id, res);
    const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25000);
    hb.unref?.();
    req.on('close', () => clearInterval(hb));
  });
}
