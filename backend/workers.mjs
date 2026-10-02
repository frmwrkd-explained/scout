// Durable, opt-in task workers. Tasks remain the queue and dispatch remains the CLI door.
// Preparation uses the same tools-off brain and daily attempt ledger as Today.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getSettings, getStorageRoot, readMd, writeMd, safe, byDate } from './store.mjs';
import { listAssistants, getAssistant, saveAssistant, listTasks, getTask, claimTask,
  heartbeatTaskLease, releaseTaskLease, recoverExpiredTaskLeases, workerCanTask, appendRun } from './tasks.mjs';
import { sendOut, runningNow, isRunning } from './dispatch.mjs';
import { think, brainBudgetToday } from './brain.mjs';
import { logEvent } from './log.mjs';
import { localDay } from './daytime.mjs';
import { assertPaperclipWorkAvailable } from './paperclip.mjs';
import { propose } from './proposals.mjs';
import { hasWorkerPolicy, getWorkerPolicy, workerProjectAllowed, isProtectedFinance,
  projectWorkerPrompt, issueWorkerRun, withWorkerIdentity, currentWorkerIdentity, assertWorkerDispatchAllowed } from './workerScope.mjs';

export class WorkerError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'WorkerError'; this.status = status; }
}
const active = new Map(); // root + wake id -> promise; durable receipts also survive a restart
const receiptsDir = () => path.join(getStorageRoot(), '.scout', 'worker-wakes');
const receiptFile = id => path.join(receiptsDir(), safe(id) + '.md');
const stamp = n => new Date(n).toISOString();
const bounded = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : fallback;
};
export function workerConfig(settings = getSettings()) {
  return {
    enabled: settings.workerSchedulerEnabled === true && settings.autoRun === true,
    autoRun: settings.autoRun === true, schedulerEnabled: settings.workerSchedulerEnabled === true,
    maxConcurrent: bounded(settings.workerMaxConcurrent, 2, 1, 8),
    leaseMs: bounded(settings.workerLeaseMinutes, 25, 1, 120) * 60_000,
    maxAttempts: bounded(settings.workerMaxAttempts, 3, 1, 5),
    retryMs: bounded(settings.workerRetryMinutes, 5, 1, 120) * 60_000,
    quotaCooldownMs: bounded(settings.workerQuotaCooldownMinutes, 60, 5, 1440) * 60_000,
    overnightEnabled: settings.workerOvernightEnabled === true,
    overnightHour: bounded(settings.workerOvernightHour, 6, 0, 23),
  };
}
function recordEvent(wake, state, extra = {}) {
  logEvent({ type: 'run', actor: wake.assistant || 'worker-scheduler', target: '.scout/worker-wakes/' + wake.id + '.md',
    detail: { worker: true, state, task: wake.task, project: wake.project, ...extra } });
}
function saveWake(wake, patch = {}, now = Date.now()) {
  const next = { ...wake, ...patch, updated: stamp(now) };
  const { summary = '', ...data } = next;
  writeMd(receiptFile(next.id), data, String(summary));
  return next;
}
export function getWorkerWake(id) {
  if (!fs.existsSync(receiptFile(id))) return null;
  try {
    const { data, content } = readMd(receiptFile(id));
    if (data.id !== String(id) || !data.project || !data.task || !['pending', 'running', 'done', 'retry', 'cooldown', 'paused', 'failed'].includes(data.state)) {
      throw new Error('receipt shape is invalid');
    }
    return { ...data, id: String(id), summary: content.trim() };
  } catch { throw new WorkerError('Worker receipt cannot be read; repair its Markdown before retrying a wake.', 409); }
}
export function listWorkerWakes() {
  let files;
  try { files = fs.readdirSync(receiptsDir()).filter(f => !f.startsWith('.') && f.endsWith('.md')); } catch { return []; }
  const dateOrder = byDate('created');
  return files.map(f => getWorkerWake(f.slice(0, -3))).filter(Boolean).sort((a, b) => dateOrder(a, b) || a.id.localeCompare(b.id));
}

// Only synchronous bookkeeping happens under this lock. Work begins after its durable lease
// exists; no model call or CLI holds a filesystem mutex.
function withWorkerLock(fn) {
  const lock = path.join(getStorageRoot(), '.scout', 'locks', 'workers', 'orchestrate.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  try { fs.mkdirSync(lock); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    try { if (Date.now() - fs.statSync(lock).mtimeMs > 2000) fs.rmdirSync(lock); } catch { /* contender */ }
    try { fs.mkdirSync(lock); } catch { return { busy: true, started: [] }; }
  }
  try { return fn(); } finally { try { fs.rmdirSync(lock); } catch { /* already released */ } }
}
const activeKey = (root, id) => root + '\0' + id;
function availableSlots(config, now) {
  const runs = new Set(runningNow().map(r => r.run));
  for (const wake of listWorkerWakes()) {
    if (wake.state === 'running' && Date.parse(wake.lease_expires_at) > now) runs.add(wake.run || wake.id);
  }
  return Math.max(0, config.maxConcurrent - runs.size);
}
function taskAllowed(assistant, task) {
  if (!workerProjectAllowed(assistant.id, task.project)) return false;
  const policy = getWorkerPolicy(assistant.id);
  if (policy && (!policy.universes.includes(String(task.universe || 'local')) ||
    (!policy.finance && isProtectedFinance(task, task.path)))) return false;
  try { if (task.work_id) assertPaperclipWorkAvailable(task.work_id); } catch { return false; }
  return true;
}
export function matchingWorkers(task, { assistantId = null } = {}) {
  return listAssistants().filter(a => a.worker_enabled === true && (!assistantId || a.id === assistantId)
    && (!a.project || String(a.project) === task.project) && workerCanTask(a, task) && taskAllowed(a, task));
}

function createWake({ key, task, project, assistant = null, actor = 'crystal', source = 'manual', now = Date.now() }) {
  if (!String(key || '').trim() || String(key).length > 200) throw new WorkerError('wake key is required and must be at most 200 characters');
  const found = getTask(project, task);
  if (!found) throw new WorkerError('no task "' + task + '" in project "' + project + '"', 404);
  if (found.work_id) assertPaperclipWorkAvailable(found.work_id);
  const id = 'wake-' + createHash('sha256').update(String(key)).digest('hex').slice(0, 32);
  const existing = getWorkerWake(id);
  if (existing) {
    if (existing.task !== found.id || existing.project !== found.project || (assistant && existing.requested_assistant !== assistant)) {
      throw new WorkerError('wake key was already used for different work', 409);
    }
    return { wake: existing, created: false };
  }
  if (found.status !== 'open' || found.needs_human) throw new WorkerError('Only open tasks without an unanswered human question can be sent to a worker.', 409);
  const wake = saveWake({ id, key: String(key), task: found.id, project: found.project, requested_assistant: assistant,
    assistant: null, actor, source, state: 'pending', attempts: 0, created: stamp(now), next_at: null,
    summary: 'Waiting for a worker with the required skills.' }, {}, now);
  recordEvent(wake, 'pending');
  return { wake, created: true };
}

function finishFailure(wake, reason, now, config, { paused = false } = {}) {
  const quota = paused || /quota|daily call limit|rate.?limit|usage limit|credits|\b429\b|no provider available/i.test(reason);
  const exhausted = wake.attempts >= config.maxAttempts;
  const state = quota ? (exhausted ? 'paused' : 'cooldown') : (exhausted ? 'failed' : 'retry');
  const nextAt = exhausted ? null : stamp(now + (quota ? config.quotaCooldownMs : Math.min(2 * 3600_000, config.retryMs * 2 ** (wake.attempts - 1))));
  const next = saveWake(wake, { state, next_at: nextAt, lease_expires_at: null, ended: stamp(now),
    reason: String(reason).slice(0, 1000), summary: (quota ? 'Paused: ' : 'Worker stopped: ') + String(reason).slice(0, 1000) }, now);
  recordEvent(next, state, { attempt: wake.attempts, next_at: nextAt });
  return next;
}
function recoverWakes(now, config) {
  const recovered = recoverExpiredTaskLeases({ now });
  for (const wake of listWorkerWakes()) {
    if (wake.state !== 'running' || Date.parse(wake.lease_expires_at) > now) continue;
    // A dead backend has no active promise. A live promise with an expired lease is also stale:
    // its finalization checks the lease id and cannot overwrite a replacement worker's result.
    if (wake.run) appendRun({ id: wake.run, assistant: wake.assistant, project: wake.project,
      started: wake.started, ended: stamp(now), status: 'failed', summary: 'Worker lease expired. The task returned to the queue.' });
    finishFailure(wake, 'Worker lease expired before a completion was recorded.', now, config);
    if (getAssistant(wake.assistant)) saveAssistant(wake.assistant, { status: 'idle' }, { actor: 'worker-recovery' });
  }
  return recovered;
}

function runIdentity(assistant, runId, project, config) {
  return hasWorkerPolicy(assistant.id) ? issueWorkerRun({ assistantId: assistant.id, runId, project, ttlMs: config.leaseMs }) : null;
}
function askAfterFailure(wake, task, question) {
  return propose({ id: 'task-' + task.project + '-' + task.id, kind: 'question', title: task.label || task.title,
    question, task: task.id, project: task.project, why: 'The worker reached its retry limit and needs your instructions.',
    evidence: ['[[' + task.path + ']]'], worker_wake: wake.id }, { actor: wake.assistant });
}
function ownTaskPrompt(task) {
  // No arbitrary task frontmatter, relation rollups or parent work record is passed through.
  return JSON.stringify({ id: task.id, title: task.title, label: task.label || null,
    project: task.project, instructions: task.body, requires: task.requires || [],
    question: task.question || null, requested_output: task.requested_output || null });
}
async function performPreparation({ wake, assistant, task, config, root, deps, identity }) {
  const clock = typeof deps.clock === 'function' ? deps.clock : Date.now;
  let heartbeat;
  const renew = () => {
    if (getStorageRoot() !== root) return;
    try {
      if (identity) withWorkerIdentity(identity.token, () => currentWorkerIdentity());
      const held = heartbeatTaskLease(task.project, task.id, { actor: assistant.id, leaseId: wake.lease_id,
        now: clock(), leaseMs: config.leaseMs });
      const current = getWorkerWake(wake.id);
      if (current?.state === 'running' && current.lease_id === wake.lease_id) saveWake(current, { lease_expires_at: held.lease_expires_at }, clock());
    } catch { /* finalization refuses an expired/revoked lease */ }
  };
  heartbeat = setInterval(renew, Math.min(60_000, Math.max(1000, config.leaseMs / 3)));
  heartbeat.unref?.();
  let result;
  try {
    const context = identity ? withWorkerIdentity(identity.token, () => projectWorkerPrompt({ assistantId: assistant.id, project: task.project })) :
      'Only the assigned task below is supplied. No private workspace, memory or hub data is included.';
    const prompt = [
      'You are ' + assistant.name + ', preparing work for a person in Scout.',
      'Your job: ' + assistant.job,
      'Prepare useful material for the assigned task. Return concise Markdown the person can review and use.',
      'You have no tools. Never say that you sent, published, joined, installed or deployed anything. State any missing information plainly.',
      context, 'ASSIGNED TASK', ownTaskPrompt(task),
    ].join('\n\n');
    result = await (deps.think || think)({ purpose: 'prep', prompt, timeoutMs: Math.min(config.leaseMs - 1000, 20 * 60_000) });
  } catch (e) { result = { ok: false, reason: e.message || String(e) }; }
  finally { clearInterval(heartbeat); }
  if (getStorageRoot() !== root) return { ...wake, state: 'paused', reason: 'workspace changed during worker preparation' };
  if (identity) {
    try { withWorkerIdentity(identity.token, () => currentWorkerIdentity()); }
    catch (e) { result = { ok: false, reason: e.message, paused: true }; }
  }
  identity?.revoke();
  const now = clock();
  const current = getWorkerWake(wake.id), held = getTask(task.project, task.id);
  if (current?.state !== 'running' || current.lease_id !== wake.lease_id || held?.lease_id !== wake.lease_id ||
    !(Date.parse(held.lease_expires_at) > now)) return { ...wake, state: 'paused', reason: 'worker lost its lease; response was not applied' };
  const text = String(result?.text || '').trim();
  if (result?.ok && text && text.length <= 20_000) {
    releaseTaskLease(task.project, task.id, { actor: assistant.id, leaseId: wake.lease_id, now, status: 'done',
      patch: { prepared_text: text, prepared_at: stamp(now), prepared_by: assistant.id, prep_state: 'ready',
        prep_provider: result.provider || null, prep_model: result.model || null, needs_human: false } });
    appendRun({ id: wake.run, assistant: assistant.id, project: task.project, started: wake.started, ended: stamp(now),
      status: 'done', provider: result.provider || null, model: result.model || null, tasks: [task.id],
      summary: 'Prepared material for ' + task.title + '. The person can review it in the task. No external action was performed.' });
    saveAssistant(assistant.id, { status: 'idle', last_run: stamp(now) }, { actor: wake.actor });
    const finished = saveWake(current, { state: 'done', ended: stamp(now), lease_expires_at: null, next_at: null,
      provider: result.provider || null, model: result.model || null, summary: 'Prepared: ' + task.title }, now);
    recordEvent(finished, 'done', { prepared: true });
    return finished;
  }
  const reason = result?.reason || (!text ? 'Worker returned no prepared material.' : 'Worker response exceeded the 20,000 character limit.');
  const finished = finishFailure(current, reason, now, config, { paused: result?.paused });
  releaseTaskLease(task.project, task.id, { actor: assistant.id, leaseId: wake.lease_id, now,
    status: finished.state === 'failed' ? 'blocked' : 'open',
    patch: { prep_state: 'failed', ...(finished.state === 'failed' ? { needs_human: true, question: 'This task failed ' + wake.attempts + ' times. Please correct its instructions or choose another worker.' } : {}) } });
  if (finished.state === 'failed') askAfterFailure(finished, task, getTask(task.project, task.id).question);
  appendRun({ id: wake.run, assistant: assistant.id, project: task.project, started: wake.started, ended: stamp(now),
    status: finished.state === 'failed' ? 'failed' : 'blocked', summary: finished.summary });
  saveAssistant(assistant.id, { status: finished.state === 'failed' ? 'blocked' : 'idle', last_run: stamp(now) }, { actor: wake.actor });
  return finished;
}

async function performTools({ wake, assistant, task, config, root, deps }) {
  const clock = typeof deps.clock === 'function' ? deps.clock : Date.now;
  let finished, failure, heartbeat;
  try {
    const outgoing = sendOut(assistant.id, { project: task.project, actor: wake.actor, taskIds: [task.id], deps });
    wake = saveWake(wake, { run: outgoing.run.id }, clock());
    heartbeatTaskLease(task.project, task.id, { actor: assistant.id, leaseId: wake.lease_id,
      now: clock(), leaseMs: config.leaseMs, runId: outgoing.run.id });
    heartbeat = setInterval(() => {
      if (getStorageRoot() !== root) return;
      try {
        const held = heartbeatTaskLease(task.project, task.id, { actor: assistant.id, leaseId: wake.lease_id,
          now: clock(), leaseMs: config.leaseMs });
        const current = getWorkerWake(wake.id);
        if (current?.state === 'running' && current.lease_id === wake.lease_id) saveWake(current, { lease_expires_at: held.lease_expires_at }, clock());
      } catch { /* stale completion is checked below */ }
    }, Math.min(60_000, Math.max(1000, config.leaseMs / 3)));
    heartbeat.unref?.();
    finished = await outgoing.done;
  }
  catch (e) { failure = e.message || String(e); }
  finally { clearInterval(heartbeat); }
  if (getStorageRoot() !== root) return { ...wake, state: 'paused', reason: 'workspace changed during worker run' };
  const now = clock(), current = getWorkerWake(wake.id), held = getTask(task.project, task.id);
  if (current?.state !== 'running' || held?.lease_id !== wake.lease_id || !(Date.parse(held.lease_expires_at) > now)) {
    return { ...wake, state: 'paused', reason: 'worker lost its lease; completion was not applied' };
  }
  // A CLI saying "done" is not task completion. The task's own API status is the receipt.
  const completed = finished?.status === 'done' && held.status === 'done';
  if (completed) {
    releaseTaskLease(task.project, task.id, { actor: assistant.id, leaseId: wake.lease_id, now, status: 'done' });
    const next = saveWake(current, { state: 'done', ended: stamp(now), run: finished.id, next_at: null,
      lease_expires_at: null, summary: finished.summary }, now);
    recordEvent(next, 'done', { run: finished.id });
    return next;
  }
  const next = finishFailure(current, failure || (finished?.status === 'done' ? 'Worker returned without completing its claimed task.' : finished?.summary || 'Worker did not complete.'), now, config);
  releaseTaskLease(task.project, task.id, { actor: assistant.id, leaseId: wake.lease_id, now,
    status: next.state === 'failed' || held.status === 'blocked' ? 'blocked' : 'open',
    patch: next.state === 'failed' ? { needs_human: true, question: 'This worker could not complete its task. Please correct its instructions or choose another worker.' } : {} });
  if (next.state === 'failed') askAfterFailure(next, task, getTask(task.project, task.id).question);
  return next;
}

function startWake(wake, { now, config, deps }) {
  const task = getTask(wake.project, wake.task);
  if (!task || task.status !== 'open' || task.needs_human) return { started: false, reason: 'task is not open for a worker' };
  const assistants = matchingWorkers(task, { assistantId: wake.requested_assistant }).filter(a => !isRunning(a.id) &&
    !listWorkerWakes().some(w => w.state === 'running' && w.assistant === a.id && Date.parse(w.lease_expires_at) > now));
  const assistant = assistants[0];
  if (!assistant) return { started: false, reason: 'no available worker has the required skills and membership' };
  const mode = task.worker_mode || assistant.worker_mode || 'prepare';
  if (!['prepare', 'tools'].includes(mode)) throw new WorkerError('Unreadable worker_mode; choose prepare or tools before running.', 409);
  if (String(task.body || '').length > 12_000 || String(assistant.job || '').length > 4000) {
    throw new WorkerError('Worker instructions exceed the preparation prompt limit (task 12,000 characters; job 4,000).', 409);
  }
  assertWorkerDispatchAllowed(assistant, { textOnly: mode === 'prepare' });
  const leaseId = randomUUID();
  const runId = 'worker-' + wake.id + '-' + (Number(wake.attempts || 0) + 1);
  const claimed = claimTask(task.project, task.id, { actor: assistant.id, now,
    lease: { id: leaseId, run: runId, ms: config.leaseMs } });
  if (!claimed.won) return { started: false, reason: claimed.reason };
  const running = saveWake(wake, { state: 'running', assistant: assistant.id, attempts: Number(wake.attempts || 0) + 1,
    mode, run: runId, started: stamp(now), lease_id: leaseId, lease_expires_at: claimed.task.lease_expires_at,
    next_at: null, reason: null, summary: 'Working on ' + task.title }, now);
  recordEvent(running, 'running', { attempt: running.attempts });
  const root = getStorageRoot();
  const identity = mode === 'prepare' ? runIdentity(assistant, runId, task.project, config) : null;
  if (mode === 'prepare') {
    appendRun({ id: runId, assistant: assistant.id, project: task.project, started: stamp(now), status: 'running',
      worker_mode: 'prepare', tasks: [task.id], summary: 'Preparing ' + task.title });
    saveAssistant(assistant.id, { status: 'running', last_run: stamp(now) }, { actor: wake.actor });
  }
  const key = activeKey(root, wake.id);
  const done = (mode === 'prepare' ? performPreparation : performTools)({ wake: running, assistant, task: claimed.task, config, root, deps, identity });
  active.set(key, done);
  done.finally(() => { if (active.get(key) === done) active.delete(key); identity?.revoke(); }).catch(() => {});
  return { started: true, wake: running, done };
}

// Manual wakes are explicit owner actions and can run while autoRun is off. A repeated key
// never starts a second run. Scheduled work requires both settings and per-worker opt-in.
export function wakeWorker(input = {}, { now = Date.now(), deps = {} } = {}) {
  if (currentWorkerIdentity()) throw new WorkerError('a worker cannot authorize another worker run', 403);
  return withWorkerLock(() => {
    const config = workerConfig();
    recoverWakes(now, config);
    const created = createWake({ ...input, source: 'manual', now });
    let start = { started: false, reason: 'wake already exists' };
    if (created.created && availableSlots(config, now)) start = startWake(created.wake, { now, config, deps });
    return { ...created, ...start, wake: getWorkerWake(created.wake.id) };
  });
}

export function tickWorkers({ now = Date.now(), deps = {} } = {}) {
  const n = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(n)) throw new WorkerError('worker tick requires a valid time');
  return withWorkerLock(() => {
    const config = workerConfig();
    const recovered = recoverWakes(n, config);
    if (!config.enabled) return { started: [], recovered, paused: true, reason: 'Scheduled workers need autoRun and workerSchedulerEnabled.' };
    if (config.overnightEnabled && new Date(n).getHours() < config.overnightHour) {
      return { started: [], recovered, paused: true, reason: 'Overnight preparation starts at ' + String(config.overnightHour).padStart(2, '0') + ':00 local time.' };
    }
    const overnightDue = config.overnightEnabled && new Date(n).getHours() >= config.overnightHour;
    const wakes = listWorkerWakes();
    for (const task of listTasks({ status: 'open' })) {
      if (task.needs_human || !matchingWorkers(task).length) continue;
      if (wakes.some(w => w.project === task.project && w.task === task.id && ['pending', 'running', 'retry', 'cooldown', 'paused'].includes(w.state))) continue;
      const key = (overnightDue ? 'overnight:' + localDay(n) : 'queue:' + (task.worker_revision || 1)) + ':' + task.project + ':' + task.id;
      createWake({ key, task: task.id, project: task.project, actor: 'schedule', source: overnightDue ? 'overnight' : 'queue', now: n });
    }
    const started = [], waiting = [];
    for (const wake of listWorkerWakes()) {
      if (!['pending', 'retry', 'cooldown'].includes(wake.state) || (wake.next_at && Date.parse(wake.next_at) > n)) continue;
      if (!availableSlots(config, n)) break;
      try {
        const result = startWake(wake, { now: n, config, deps });
        if (result.started) started.push(result.wake); else waiting.push({ id: wake.id, reason: result.reason });
      } catch (e) { waiting.push({ id: wake.id, reason: e.message }); }
    }
    return { started, waiting, recovered, paused: false };
  });
}
export function workersSettled() {
  const root = getStorageRoot();
  return Promise.allSettled([...active.entries()].filter(([key]) => key.startsWith(root + '\0')).map(([, promise]) => promise));
}
export function workerStatus() {
  const config = workerConfig();
  return { config, budget: brainBudgetToday(), wakes: listWorkerWakes(), workers: listAssistants().filter(a => a.worker_enabled === true)
    .map(a => ({ id: a.id, name: a.name, capabilities: a.capabilities || [], mode: a.worker_mode || 'prepare',
      scoped: hasWorkerPolicy(a.id), status: a.status, project: a.project || null })),
    queue: listTasks({ status: 'open' }).map(t => ({ id: t.id, project: t.project, title: t.title,
      requires: t.requires || [], matches: matchingWorkers(t).map(a => a.id) })) };
}
export function registerWorkerRoutes(app, deps = {}) {
  const fail = (res, error) => res.status(error.status || 400).json({ error: error.message });
  app.get('/api/workers', (_req, res) => { try { res.json(workerStatus()); } catch (e) { fail(res, e); } });
  app.post('/api/workers/wake', (req, res) => {
    try {
      const { key, task, project, assistant = null, actor = 'crystal' } = req.body || {};
      const { done, ...result } = wakeWorker({ key, task, project, assistant, actor }, { deps });
      res.json(result);
    } catch (e) { fail(res, e); }
  });
  app.post('/api/workers/tick', (_req, res) => { try { res.json(tickWorkers({ deps })); } catch (e) { fail(res, e); } });
  app.post('/api/workers/wakes/:id/heartbeat', (req, res) => {
    try {
      const wake = getWorkerWake(req.params.id);
      if (!wake || wake.state !== 'running') throw new WorkerError('no running worker wake', 404);
      const actor = currentWorkerIdentity()?.actor || req.body?.actor;
      if (req.workerIdentity && req.workerIdentity.runId !== wake.run) throw new WorkerError('heartbeat belongs to another run', 403);
      if (actor !== wake.assistant || req.body?.leaseId !== wake.lease_id) throw new WorkerError('heartbeat does not own this lease', 403);
      const task = heartbeatTaskLease(wake.project, wake.task, { actor, leaseId: wake.lease_id, leaseMs: workerConfig().leaseMs });
      res.json({ wake: saveWake(wake, { lease_expires_at: task.lease_expires_at }) });
    } catch (e) { fail(res, e); }
  });
  return app;
}
