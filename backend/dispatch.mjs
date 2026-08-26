// backend/dispatch.mjs — the one button.
//
//   "She presses one button. The assistants go back out."   — GOAL.md §3
//
// This is the last unwired clause of T14 step 1: the local-CLI path existed (agentHome.mjs,
// agentRunner.mjs, agentProviders.mjs, all ported and tested) and was wired only to CHAT. An
// assistant — the thing this app is actually about — could be hired, scoped, scheduled and given
// tasks, and then nothing could send it anywhere. TODAY's primary button has been rendering
// `NO RUNNER WIRED YET` since M5 because `onSendOut` had nobody to call. This module is that
// somebody.
//
// WHAT THIS IS NOT. It is a composer, not a fifth implementation of anything:
//   · `agentRunner.mjs` owns the OS process, the provider argv and the isolated home. We call
//     `cliExecutor` — the SAME function chat turns go through — so there is one spawn path.
//   · `tasks.mjs` owns assistants, tasks and the run store. We call `appendRun` / `saveAssistant`.
//   · `agentIndex.mjs` owns what an agent may do. We do not restate it; the brief points at it.
//   · `records.mjs` remains the only writer of documents. The assistant writes through door 1
//     exactly like any other agent — over HTTP, gated, deduped and logged. A local CLI is not a
//     privileged door, it is just a door we happen to open ourselves.
//
// SO THIS FILE DOES FOUR THINGS:
//   1. builds the brief          — pure, exported, tested
//   2. records the run           — before the process starts, so a crash still leaves a record
//   3. spawns                    — through cliExecutor
//   4. writes back what happened — and COUNTS WHAT IT DID FROM THE LOG, never from the agent's
//      own claim. An agent reporting "found 12" is a claim; twelve `store` events signed by that
//      agent between its start and its end is a fact. Same rule territory.mjs already lives by.
//
// NON-BLOCKING BY CONSTRUCTION. `sendOut()` returns as soon as the run exists, and hands back
// `done` for anyone who wants to wait (tests, the demonstration). A sweep takes minutes; an HTTP
// request that stays open for minutes is a request that dies to a proxy timeout and leaves an
// assistant marked `running` forever. The screens poll instead (`App.watchRuns`), and only while
// somebody is actually out.
//
// AND IT IS STOPPABLE. Every run carries an AbortController. A spawned process a person cannot
// stop is a trap, and "Send them out" is a button people will press by accident.

import { listAssistants, getAssistant, saveAssistant, listTasks, appendRun, listRuns, normalizeSchedule } from './tasks.mjs';
import { cliExecutor } from './agentRunner.mjs';
import { selfApiBase } from './agentHome.mjs';
import { resolveBin } from './jobs.mjs';
import { getSettings, listProjects } from './store.mjs';
import { logEvent, readEvents } from './log.mjs';

// A sweep is not a chat turn. The chat timeout (5 minutes) is the wrong shape for an assistant
// asked to work a group, so a run gets its own, overridable the same way chat's is.
export const RUN_TIMEOUT_MS = Number(process.env.SCOUT_RUN_TIMEOUT_MS) || 20 * 60_000;

// How much of the agent's reply becomes the run's summary. She reads this at 9am; a run that
// pasted 200KB of transcript into `runs/` would be unreadable AND would bloat every later read of
// the folder. The whole reply is never lost — it is what the agent wrote through the API that
// matters, and that is in `data/`.
export const MAX_SUMMARY_CHARS = 4000;

export class DispatchError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.name = 'DispatchError';
    this.status = status;
    Object.assign(this, extra);
  }
}

// runId -> { assistant, ac, done }. In-process, deliberately: this is a single-process desktop app
// and the map IS the atomic guard. tasks.mjs's mkdir-lock protocol exists because SEVERAL agents
// claim tasks; only one process ever presses this button.
const inFlight = new Map();

export function runningNow() {
  return [...inFlight.entries()].map(([runId, v]) => ({ run: runId, assistant: v.assistant }));
}
export function isRunning(assistantId) {
  for (const v of inFlight.values()) if (v.assistant === String(assistantId)) return true;
  return false;
}

const nowIso = () => new Date().toISOString();
const arr = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

// ── the brief ──────────────────────────────────────────────────────────────────────────────────
// Everything the assistant needs and nothing it can get for itself. It is written in the second
// person, like the Index, and it never restates a rule that lives in the router skill — a copy of
// a rule is a rule that will drift from the one being enforced.
//
// The one thing it DOES restate is the actor, three times, because every score in this app is
// computed from who signed the write. An unsigned finding is invisible to territory.mjs.
export function buildBrief(assistant, { tasks = [], apiBase = selfApiBase(), project = null } = {}) {
  const a = assistant || {};
  const id = String(a.id || 'assistant');
  const name = String(a.name || id);
  const collections = arr(a.scope && a.scope.collections);
  const ground = arr(a.scope && a.scope.territory);
  const L = [];

  L.push('You are ' + name + ', one of the assistants in Scout.');
  L.push('');
  L.push('This is a run. You work on your own, you write what you find through the API, and you stop.');
  L.push('');
  L.push('YOUR JOB');
  L.push(a.job ? String(a.job) : 'No job was written down. Read your own file (assistants/' + id + '.md), do what it says, and if it says nothing, say so and stop.');
  L.push('');
  L.push('WHERE YOU MAY WORK');
  L.push('  collections   ' + (collections.length ? collections.join(', ') : 'none named — ask before you write into one'));
  L.push('  ground        ' + (ground.length ? ground.join(', ') : 'none named — ask before you work new ground'));
  L.push('Nothing else is yours. If the job needs ground you do not have, propose it. Do not take it.');
  if (project) L.push('You are working the project "' + project + '".');
  L.push('');
  L.push('WAKE UP FIRST — ONE READ');
  L.push('  curl -s ' + apiBase + '/api/context');
  L.push('That is who they are, what they are chasing, where you have already looked, what has been');
  L.push('proven to work, and what changed since the last run. Do not re-derive any of it.');
  L.push('Everything you are able to do is listed here, one line each:');
  L.push('  curl -s ' + apiBase + '/api/index');
  L.push('Anything not in that list does not exist. Never read data/ in bulk.');
  L.push('');
  L.push('SIGN EVERY WRITE AS YOURSELF');
  L.push('Every call takes "actor": "' + id + '". That is how the app scores the ground you worked and');
  L.push('how it knows an agent wrote it. A write signed as somebody else is worse than no write.');
  L.push('');
  L.push('YOUR OPEN TASKS');
  if (tasks.length) {
    for (const t of tasks) {
      L.push('  · ' + t.id + ' — ' + (t.title || t.id));
      L.push('    claim it before you work it:');
      L.push('      curl -sX POST ' + apiBase + '/api/tasks/' + encodeURIComponent(t.id) + '/claim -d \'{"actor":"' + id + '"}\'');
    }
    L.push('  A 409 means somebody beat you to it. Take another one; never work a task you did not win.');
  } else {
    L.push('  Nothing is queued for you. Work your job against the ground above.');
  }
  L.push('');
  L.push('WHEN YOU ARE DONE');
  L.push('End your reply with three lines: what you searched, what you found, what needs them.');
  L.push('Those three lines are this run\'s summary — they are what she reads at 9am. Write them for');
  L.push('a person who was asleep, not for a log.');
  L.push('Do NOT post to /api/runs. This run is already being recorded for you.');
  L.push('Then ask ONE question, and record what you learned:');
  L.push('  curl -sX POST ' + apiBase + '/api/learnings/propose \\');
  L.push('    -d \'{"claim":"...","evidence":["..."],"scope":"project","actor":"' + id + '"}\'');
  L.push('One question. Not five.');
  return L.join('\n');
}

// ── what actually happened ─────────────────────────────────────────────────────────────────────
// Counted from the event log, filtered to this actor and this run's window. The agent is never
// asked, because the agent is the one party with a reason to be generous.
export function countWork(actorId, since, until = null) {
  const floor = Date.parse(since);
  const ceil = until ? Date.parse(until) : Infinity;
  const out = { found: 0, merged: 0, updated: 0, skipped: 0, refused: 0, proposed: 0 };
  if (!Number.isFinite(floor)) return out;
  const events = readEvents({ limit: 2000, since: floor });
  for (const ev of events) {
    if (ev.actor !== String(actorId)) continue;
    const t = Date.parse(ev.ts);
    if (!(t > floor) || t > ceil) continue;
    if (ev.type === 'store') out.found++;
    else if (ev.type === 'merge') out.merged++;
    else if (ev.type === 'update') out.updated++;
    else if (ev.type === 'skip') out.skipped++;
    else if (ev.type === 'refused') out.refused++;
    else if (ev.type === 'propose') out.proposed++;
  }
  return out;
}

// Which project a run belongs to. An assistant may name one; otherwise the first project there is.
// A workspace with no projects is legal (the interview makes one) — a run without a project simply
// has no task list, which the brief states plainly rather than papering over.
function projectFor(assistant, explicit) {
  if (explicit) return String(explicit);
  if (assistant && assistant.project) return String(assistant.project);
  try {
    const list = listProjects();
    return list && list.length ? String(list[0].id || list[0]) : null;
  } catch { return null; }
}

// The tasks this assistant should be told about: open, in its project, and either unassigned or
// already assigned to it. A task somebody else claimed is not its business.
export function tasksForBrief(assistantId, project) {
  if (!project) return [];
  try {
    return listTasks({ project, status: 'open' })
      .filter(t => !t.assigned || String(t.assigned) === String(assistantId));
  } catch { return []; }
}

// Whether an assistant is blocked is a FACT about its tasks, not a mood. Reading it back off the
// queue after every run is what makes the blocked band on ASSISTANTS honest without anyone having
// to remember to set a flag.
function blockedByTask(assistantId, project) {
  if (!project) return false;
  try {
    return listTasks({ project }).some(t =>
      String(t.assigned || '') === String(assistantId) && (t.status === 'blocked' || t.needs_human));
  } catch { return false; }
}

// ── send one out ───────────────────────────────────────────────────────────────────────────────
// Returns { run, done } as soon as the run record exists. `done` resolves with the finished run.
export function sendOut(id, { project = null, actor = 'crystal', agentCommand = null, deps = {} } = {}) {
  const a = getAssistant(id);
  if (!a) throw new DispatchError('no assistant "' + id + '"', 404);
  if (isRunning(a.id)) throw new DispatchError((a.name || a.id) + ' is already out', 409);

  // The one pre-flight check. Done HERE rather than inside the executor so that a workspace with no
  // agent CLI never accumulates blocked run records nobody asked for: a run that never started is
  // not a run. The app is fully usable in this state — doors 2 and 3 do not need a local CLI at all.
  const command = agentCommand || getSettings().agentCommand || 'claude';
  if (!resolveBin(command)) {
    throw new DispatchError(
      'No agent CLI is connected (' + command + ' was not found). Connect one in Settings → Agent, '
      + 'or let your agents reach Scout through _inbox/ or MCP instead.',
      503, { setup: true, command });
  }

  const pid = projectFor(a, project);
  const tasks = tasksForBrief(a.id, pid);
  const brief = buildBrief(a, { tasks, apiBase: selfApiBase(), project: pid });

  const started = nowIso();
  const run = appendRun({
    assistant: a.id, status: 'running', started, project: pid,
    provider: command, tasks: tasks.map(t => t.id), sent_by: actor,
    summary: 'Out now. ' + (a.job || 'No job written down.'),
  });

  saveAssistant(a.id, { status: 'running', last_run: started }, { actor });
  event(deps, { type: 'run', actor, target: 'runs/' + run.id + '.md', detail: { assistant: a.id, state: 'sent-out', tasks: tasks.length } });

  const ac = new AbortController();
  const done = perform({ a, run, brief, started, pid, command, actor, ac, deps })
    .finally(() => { inFlight.delete(run.id); });
  inFlight.set(run.id, { assistant: a.id, ac, done });
  // `perform` swallows everything the AGENT can do wrong; this covers what the DISK can — a run
  // that cannot write its own record must not become an unhandled rejection and take the app down
  // with it. Registering a handler here does not consume the rejection: a caller awaiting `done`
  // still sees it.
  done.catch(() => { /* the run record is the report; the process stays up */ });

  return { run, done, brief };
}

async function perform({ a, run, brief, started, pid, command, actor, ac, deps }) {
  const notices = [];
  const s = getSettings();
  const session = {
    // The home is per-run, so two assistants sent out together never share a mounted skills tree
    // (and a tamper in one cannot reach the other). prepareAgentHome() wipes and re-copies it.
    id: 'run-' + run.id,
    kind: 'assistant',
    mode: 'agent',
    project: pid,
    agentCommand: command,
    agentModel: a.model || s.agentModel,
    agentEffort: a.effort || s.agentEffort,
    allowedTools: [],   // the baseline in agentRunner.mjs is what a Scout run needs: curl, node, read
  };

  let text = '', cost = 0, failure = null, cancelled = false, setup = false;
  try {
    const res = await cliExecutor({
      session, history: [], userText: brief, signal: ac.signal, timeoutMs: RUN_TIMEOUT_MS,
      emit: ev => { if (ev && (ev.type === 'notice' || ev.type === 'setup')) notices.push(noticeText(ev)); },
    });
    text = String(res && res.text || '').trim();
    cost = Number(res && res.cost) || 0;
    cancelled = !!(res && res.cancelled);
    setup = !!(res && res.setup);
  } catch (e) {
    failure = e && e.message ? e.message : String(e);
  }

  const ended = nowIso();
  const work = countWork(a.id, started, ended);
  const status = failure ? 'failed' : cancelled ? 'stopped' : setup ? 'blocked' : 'done';

  const finished = appendRun({
    ...run,
    id: run.id,
    ended, status, cost,
    found: work.found, merged: work.merged, updated: work.updated,
    skipped: work.skipped, refused: work.refused, proposed: work.proposed,
    summary: summaryOf({ text, failure, cancelled, notices, work }),
  });

  saveAssistant(a.id, {
    status: blockedByTask(a.id, pid) ? 'blocked' : 'idle',
    last_run: ended,
  }, { actor });

  event(deps, {
    type: 'run', actor: a.id, target: 'runs/' + run.id + '.md',
    detail: { assistant: a.id, state: status, found: work.found, cost },
  });

  return finished;
}

function noticeText(ev) {
  if (ev.type === 'setup') return 'No agent CLI answered (' + (ev.command || 'agent') + '). Nothing was run.';
  return String(ev.text || '').trim();
}

// The run's body, in the order she needs it: what went wrong (if anything), then the agent's own
// three lines, then the counted truth. The counted line goes LAST and always renders, so a run
// whose agent wrote a beautiful summary and stored nothing cannot read as a good night.
function summaryOf({ text, failure, cancelled, notices, work }) {
  const out = [];
  if (failure) out.push('The run failed: ' + failure);
  if (cancelled) out.push('Stopped before it finished.');
  for (const n of notices) if (n) out.push(n);
  // Truncation is stated, never silent — the same rule the hot cache lives by. A summary that
  // stops mid-sentence with no explanation reads as a crash.
  if (text) {
    out.push(text.length > MAX_SUMMARY_CHARS
      ? text.slice(0, MAX_SUMMARY_CHARS) + '\n\n[…the rest of the reply is not kept here. What it '
        + 'WROTE is in data/; this is only what it said.]'
      : text);
  }
  out.push(countedLine(work));
  return out.filter(Boolean).join('\n\n');
}

export function countedLine(work = {}) {
  const parts = [
    work.found ? work.found + ' stored' : null,
    work.merged ? work.merged + ' merged into what was already there' : null,
    work.updated ? work.updated + ' updated' : null,
    work.skipped ? work.skipped + ' already known' : null,
    work.proposed ? work.proposed + ' waiting on you' : null,
    work.refused ? work.refused + ' refused by the gate' : null,
  ].filter(Boolean);
  return parts.length ? 'Counted from the log: ' + parts.join(' · ') + '.' : 'Counted from the log: it wrote nothing.';
}

// ── send them all out ──────────────────────────────────────────────────────────────────────────
// The button. Every assistant that is not already out goes; a sub-agent goes too, because a
// sub-agent is an assistant with a parent and its job is its own.
export function sendOutAll({ project = null, actor = 'crystal', agentCommand = null, deps = {} } = {}) {
  const started = [], skipped = [];
  for (const a of listAssistants()) {
    try {
      const { run } = sendOut(a.id, { project, actor, agentCommand, deps });
      started.push(run);
    } catch (e) {
      // One assistant that cannot go must never stop the rest — but a 503 means the CLI is missing
      // for ALL of them, and reporting it once per assistant is noise. Re-throw it whole.
      if (e && e.status === 503) throw e;
      skipped.push({ assistant: a.id, reason: e && e.message ? e.message : String(e) });
    }
  }
  return { started, skipped };
}

// ── the schedule ───────────────────────────────────────────────────────────────────────────────
// `assistants/<id>.md` has carried a `schedule:` since M4, HIRE has offered four values for it
// since M5, and until now NOTHING ACTED ON IT — the card said "Every morning" over an assistant
// that had never once gone out on its own. An affordance with no capability behind it is worse
// than a missing capability: the person believes the sentence.
//
// The vocabulary is closed (frontend/Assistants.jsx SCHEDULE_OPTIONS) so this is a table, not a
// cron parser — `normalizeSchedule` lives in tasks.mjs with the assistant it describes, and is
// re-exported here because this is the module that acts on it.
export const CONTINUOUS_GAP_MS = Number(process.env.SCOUT_CONTINUOUS_GAP_MS) || 30 * 60_000;
export const DAILY_HOUR = 6;              // "one sweep overnight, ready when you open Scout"
export const WEEKLY_MS = 7 * 24 * 3600_000;
export const SCHEDULER_TICK_MS = Number(process.env.SCOUT_SCHEDULER_TICK_MS) || 60_000;

export { normalizeSchedule };            // the rule lives with the assistant, in tasks.mjs

// Whether this assistant is due, given its last run. Pure and exported, because "is it due" is the
// one judgement here worth being able to test without a clock, a CLI or a filesystem.
export function dueNow(assistant, lastRun = null, now = new Date()) {
  const kind = normalizeSchedule(assistant && assistant.schedule);
  if (kind === 'manual') return false;
  const startedAt = lastRun && lastRun.started ? Date.parse(lastRun.started) : NaN;
  const endedAt = lastRun && lastRun.ended ? Date.parse(lastRun.ended) : NaN;
  const t = now instanceof Date ? now.getTime() : Number(now);

  if (kind === 'continuous') {
    // Measured from when it CAME HOME, not when it left — otherwise a run longer than the gap is
    // due again the moment it finishes, for ever.
    const since = Number.isFinite(endedAt) ? endedAt : startedAt;
    return !Number.isFinite(since) || (t - since) >= CONTINUOUS_GAP_MS;
  }
  if (kind === 'weekly') {
    return !Number.isFinite(startedAt) || (t - startedAt) >= WEEKLY_MS;
  }
  // daily: today's sweep, once today's hour has come round. Scout is not running overnight on most
  // machines, so "overnight" in practice means "the first time she opens it after 6am".
  const cutoff = new Date(t);
  cutoff.setHours(DAILY_HOUR, 0, 0, 0);
  if (t < cutoff.getTime()) return false;
  return !Number.isFinite(startedAt) || startedAt < cutoff.getTime();
}

// Everyone who should go out right now. Exported so a screen can SAY who is next without the
// scheduler having to be running — the answer must not depend on a timer nobody can see.
export function dueAssistants(now = new Date()) {
  const runs = listRuns({ limit: 400 });
  const out = [];
  for (const a of listAssistants()) {
    if (isRunning(a.id)) continue;
    if (dueNow(a, runs.find(r => String(r.assistant) === String(a.id)) || null, now)) out.push(a);
  }
  return out;
}

let timer = null;

// One tick. Returns what it sent, so the caller (and a test) can see rather than infer.
export function schedulerTick({ actor = 'schedule', deps = {}, now = new Date() } = {}) {
  if (!getSettings().autoRun) return [];
  const sent = [];
  for (const a of dueAssistants(now)) {
    try { sendOut(a.id, { actor, deps }); sent.push(a.id); }
    catch (e) {
      // 503 means no CLI is connected, which is true for EVERY assistant — stop the sweep rather
      // than raising the same alarm once per assistant, once a minute, for ever.
      if (e && e.status === 503) break;
      // Anything else is one assistant's problem (already out, gone from disk); take the next.
    }
  }
  return sent;
}

export function startScheduler({ intervalMs = SCHEDULER_TICK_MS, deps = {} } = {}) {
  stopScheduler();
  timer = setInterval(() => { try { schedulerTick({ deps }); } catch { /* a tick must never take the app down */ } }, intervalMs);
  timer.unref?.();                        // never the reason a process stays alive
  return timer;
}
export function stopScheduler() { if (timer) { clearInterval(timer); timer = null; } }
export function schedulerRunning() { return !!timer; }

// ── stopping ───────────────────────────────────────────────────────────────────────────────────
export function stopRun(runId) {
  const entry = inFlight.get(String(runId));
  if (!entry) throw new DispatchError('run "' + runId + '" is not running', 404);
  entry.ac.abort();
  return { run: String(runId), assistant: entry.assistant, stopping: true };
}

export function stopAll() {
  const ids = [...inFlight.keys()];
  for (const id of ids) { try { inFlight.get(id).ac.abort(); } catch { /* already gone */ } }
  return { stopped: ids };
}

// The log is another module's contract and must never be able to fail a run.
function event(deps, ev) {
  try { ((deps && deps.logEvent) || logEvent)(ev); } catch { /* never fail a run on the log */ }
}

// ── routes ─────────────────────────────────────────────────────────────────────────────────────
export function registerDispatchRoutes(app, deps = {}) {
  const actorOf = req => String(req.body?.actor || req.query?.actor || 'crystal');
  const fail = (res, e) => res.status(e.status || 400).json({
    error: e.message, ...(e.setup ? { setup: true, command: e.command } : {}),
  });

  // Send one out. The response is the RUNNING record — the work continues after it is sent.
  app.post('/api/assistants/:id/run', (req, res) => {
    try {
      const { run } = sendOut(req.params.id, {
        project: req.body?.project || null, actor: actorOf(req), deps,
      });
      res.json({ run, running: true });
    } catch (e) { fail(res, e); }
  });

  // The one button.
  app.post('/api/assistants/run', (req, res) => {
    try {
      res.json(sendOutAll({ project: req.body?.project || null, actor: actorOf(req), deps }));
    } catch (e) { fail(res, e); }
  });

  // What the schedule actually means right now. A screen that wants to say "3 due at 6am" must be
  // able to ask rather than reimplement dueNow() — a second copy of that rule would drift, and the
  // one on screen is the one the person believes.
  app.get('/api/schedule', (req, res) => {
    const on = !!getSettings().autoRun;
    const all = listAssistants();
    res.json({
      auto: on,
      running: schedulerRunning(),
      // How many assistants have a schedule this app will ACT on. Four assistants carrying
      // "every 6 hours" and "when you shortlist someone" is `scheduled: 0`, and a screen that
      // counted the raw strings instead would promise four sweeps that are never coming.
      scheduled: all.filter(a => normalizeSchedule(a.schedule) !== 'manual').length,
      total: all.length,
      due: dueAssistants().map(a => ({ id: a.id, name: a.name, schedule: normalizeSchedule(a.schedule) })),
      out: runningNow(),
    });
  });

  app.get('/api/runs/:id', (req, res) => {
    const found = listRuns({ limit: 500 }).find(r => String(r.id) === String(req.params.id));
    if (!found) return res.status(404).json({ error: 'no run "' + req.params.id + '"' });
    res.json({ run: found, running: inFlight.has(String(req.params.id)) });
  });

  app.post('/api/runs/:id/stop', (req, res) => {
    try { res.json(stopRun(req.params.id)); } catch (e) { fail(res, e); }
  });
}

export default {
  sendOut, sendOutAll, stopRun, stopAll, buildBrief, countWork,
  dueNow, dueAssistants, schedulerTick, startScheduler, stopScheduler, registerDispatchRoutes,
};
