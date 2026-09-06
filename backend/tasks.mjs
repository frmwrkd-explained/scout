// Orchestration — assistants, the task queue, atomic claiming, and runs. M4 / T12.
// Contract: docs/08_MODULE_CONTRACTS.md §7. Shapes: docs/04_AGENT_CONTRACT.md §5.
//
// On disk (Law 1 · Law 6 — one file per entity, never a list file):
//
//   assistants/<id>.md                    name, job, scope, schedule, model, parent
//   projects/<pid>/tasks/<id>.md          status · assigned · claimed_at · needs_human
//   projects/<pid>/findings/<agent>-<slug>.md   an agent's output for the project
//   runs/<id>.md                          one run of one assistant
//
// The agent-id prefix on a finding filename is not cosmetic: it is the only reason two assistants
// sweeping the same group at the same second cannot land on the same path and lose one of the two.
//
// THE CLAIM (T12 step 3) is the load-bearing part of this file. See claimTask().

import fs from 'node:fs';
import path from 'node:path';
import { getStorageRoot, readMd, writeMd, safe, safeScope, byDate } from './store.mjs';

const R = () => getStorageRoot();

export const assistantsDir = () => path.join(R(), 'assistants');
export const tasksDir = pid => path.join(R(), 'projects', safeScope(pid), 'tasks');
export const findingsDir = pid => path.join(R(), 'projects', safeScope(pid), 'findings');
export const runsDir = () => path.join(R(), 'runs');
// Locks live under .scout/ because they are derived and disposable (docs/02_DATA_MODEL.md §5).
// Deleting the whole folder while nothing is running costs nothing.
const locksDir = () => path.join(R(), '.scout', 'locks', 'tasks');

const assistantFile = id => path.join(assistantsDir(), safe(id) + '.md');
const taskFile = (pid, id) => path.join(tasksDir(pid), safe(id) + '.md');
const runFile = id => path.join(runsDir(), safe(id) + '.md');

export const TASK_STATUS = ['open', 'claimed', 'done', 'blocked'];
// Written by claimTask and by nothing else. saveTask() refuses a patch that names either of them,
// because a queue where any writer can stamp `assigned` has no claim protocol, only a convention.
export const CLAIM_FIELDS = ['assigned', 'claimed_at'];

export class TaskError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

const nowIso = () => new Date().toISOString();
const ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;

export function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled';
}

// What `slugify` returns when it was given nothing. Named because two places have to recognise it.
const UNTITLED = 'untitled';

// THE ONE PLACE A TASK ID IS DERIVED. `POST /api/tasks` used to do `id || slugify(patch.title)`,
// and the human line on a task lives in `label` (that is how the interview writes all three of
// hers) — so a task posted with only a `label` slugified to `untitled`, and `saveTask` MERGES into
// an existing file. Two such tasks became ONE file carrying the second one's label over the first
// one's territory: a task silently overwritten (Law 5) and two entities in one file (Law 6).
export function taskIdFrom({ id = null, title = null, label = null } = {}) {
  const given = String(id || '').trim();
  if (given) return given;
  const named = String(title || '').trim() || String(label || '').trim();
  if (!named) throw new TaskError('a task needs a title — pass `title` (or `label`), or name the `id` yourself');
  return slugify(named);
}

// The event log is another module's contract (docs/08 §1) and may not have landed yet. Resolve it
// at call time: an injected logEvent wins, then backend/log.mjs, then nothing. This is an adapter
// to someone else's signature, not a second log — never write log lines here.
async function event(deps, ev) {
  try {
    const fn = (deps && deps.logEvent) || (await import('./log.mjs').then(m => m.logEvent, () => null));
    if (fn) fn(ev);
  } catch { /* logging must never fail a mutation */ }
}

function readIf(file) {
  try { return readMd(file); } catch { return null; }
}
// `._*` is macOS's AppleDouble sidecar, written beside almost every file on an exFAT volume —
// which is what this repo lives on. `._librarian.md` ends in `.md`, parses as empty frontmatter,
// and shipped a phantom assistant called `._librarian` into GET /api/assistants with a body of raw
// AppleDouble bytes. Any dotfile is metadata, never a record: skip the lot.
// (backend/documents.mjs has always done this; the newer modules had to learn it the same way.)
function listMd(dir) {
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('.')).sort();
  } catch { return []; }
}

// ── assistants ─────────────────────────────────────────────────────────────────────────────────
// "Creating one must feel like hiring, not configuring" (T12 step 6) — so everything except a name
// is optional, and a sub-agent is just an assistant that names its `parent`.

export function listAssistants() {
  return listMd(assistantsDir()).map(f => getAssistant(f.slice(0, -3))).filter(Boolean);
}

export function getAssistant(id) {
  const found = readIf(assistantFile(id));
  if (!found) return null;
  const { data, content } = found;
  // `...data` FIRST, normalised keys after: a spread placed last lets a missing/garbage value on
  // disk overwrite the default that was there to cover exactly that case.
  return {
    ...data,
    id: data.id || id,
    name: data.name || id,
    job: data.job || '',
    scope: data.scope || {},        // { collections: [], territory: [] }
    schedule: data.schedule || null,
    model: data.model || null,
    parent: data.parent || null,
    status: data.status || 'idle',  // idle | running | blocked
    path: path.join('assistants', safe(id) + '.md'),
    body: content.trim(),
  };
}

export function saveAssistant(id, patch = {}, { actor = 'crystal' } = {}) {
  const clean = String(id || '').trim();
  if (!ID_RE.test(clean)) throw new TaskError('assistant id must be a slug (letters, digits, - and _)');
  const existing = readIf(assistantFile(clean));
  const { body, ...fields } = patch;
  if (fields.parent && safe(fields.parent) === safe(clean)) throw new TaskError('an assistant cannot be its own parent');
  const data = {
    ...(existing ? existing.data : { created: nowIso(), created_by: actor }),
    ...fields,
    id: clean,
    updated: nowIso(),
    updated_by: actor,
  };
  const content = body !== undefined ? String(body) : (existing ? existing.content : '');
  writeMd(assistantFile(clean), data, content);
  return getAssistant(clean);
}

// ── tasks ──────────────────────────────────────────────────────────────────────────────────────

function projectIds() {
  try {
    return fs.readdirSync(path.join(R(), 'projects'), { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
      .map(e => e.name).sort();
  } catch { return []; }
}

export function getTask(project, id) {
  const found = readIf(taskFile(project, id));
  if (!found) return null;
  const { data, content } = found;
  return {
    ...data,
    id: data.id || id,
    project: safeScope(project),
    title: data.title || data.id || id,
    status: TASK_STATUS.includes(data.status) ? data.status : 'open',
    assigned: data.assigned || null,
    claimed_at: data.claimed_at || null,
    needs_human: !!data.needs_human,
    path: path.join('projects', safeScope(project), 'tasks', safe(id) + '.md'),
    body: content.trim(),
  };
}

// The human line on a task lives in `label`, as it does on goals, projects and territory — getTask
// falls `title` back to the id, so an id-shaped title is not a title, it is the absence of one.
// Mirrors frontend/Assistants.jsx `taskTitle()`, which is where the same rule is applied on screen;
// the backend cannot import a .jsx, and a card that names a task must name it the way the screen does.
export function humanName(task) {
  if (!task) return '';
  const title = task.title && task.title !== task.id ? String(task.title).trim() : '';
  return String(task.label || '').trim() || title || String(task.id || '');
}

// Route params carry a task id with no project (`POST /api/tasks/:id/claim`), so the id has to be
// resolvable on its own. Prefer the named project, else the first project holding that file.
export function findTask(id, { project = null } = {}) {
  const tryOne = pid => (fs.existsSync(taskFile(pid, id)) ? getTask(pid, id) : null);
  if (project) return tryOne(project);
  for (const pid of projectIds()) {
    const t = tryOne(pid);
    if (t) return t;
  }
  return null;
}

export function listTasks({ project = null, status = null } = {}) {
  const pids = project ? [safeScope(project)] : projectIds();
  const out = [];
  for (const pid of pids) {
    for (const f of listMd(tasksDir(pid))) {
      const t = getTask(pid, f.slice(0, -3));
      if (!t) continue;
      if (status && t.status !== status) continue;
      out.push(t);
    }
  }
  // Oldest first: a queue is worked in the order it was filled, and DECIDE shows one at a time.
  return out.sort(byDate('created'));
}

export function saveTask(project, id, patch = {}, { actor = 'crystal' } = {}) {
  const pid = safeScope(project);
  if (!pid) throw new TaskError('a task belongs to a project — `project` is required');
  const clean = String(id || '').trim();
  if (!ID_RE.test(clean)) throw new TaskError('task id must be a slug (letters, digits, - and _)');
  // The second half of taskIdFrom's guard, for any caller that is not the route: `untitled` is what
  // an id derived from nothing looks like, and merging into it is how two tasks became one file.
  // A task genuinely called "Untitled" still saves — it arrives with a title or a label.
  if (clean === UNTITLED && !String(patch.title || patch.label || '').trim()) {
    throw new TaskError('a task needs a title — `untitled` is the id of a task nobody named');
  }
  if (patch.status && !TASK_STATUS.includes(patch.status)) {
    throw new TaskError('status must be one of ' + TASK_STATUS.join(' · '));
  }
  // The claim protocol only means something if claimTask is the ONLY writer of these two keys.
  for (const k of CLAIM_FIELDS) {
    if (k in patch) throw new TaskError('"' + k + '" is written by claiming only — POST /api/tasks/:id/claim');
  }

  const existing = readIf(taskFile(pid, clean));
  const { body, ...fields } = patch;
  const prev = existing ? existing.data : { created: nowIso(), created_by: actor, status: 'open', needs_human: false };
  const data = { ...prev, ...fields, id: clean, project: pid, updated: nowIso(), updated_by: actor };
  // Re-opening a task hands it back to the queue; the claim has to go with it or the next claimer
  // reads `open` and still loses the race to a name that is no longer working on it.
  if (fields.status === 'open') { data.assigned = null; data.claimed_at = null; }
  const content = body !== undefined ? String(body) : (existing ? existing.content : '');
  writeMd(taskFile(pid, clean), data, content);
  return getTask(pid, clean);
}

// ── the claim ──────────────────────────────────────────────────────────────────────────────────
// T12 step 3: "write `assigned` + `claimed_at` atomically, then re-read. If someone else won, back
// off and take another."
//
// Write-then-re-read alone is NOT safe, and this is the whole reason this function is long. The
// losing interleaving is:
//
//   A writes assigned=A → A re-reads, sees A, declares victory
//                       → B writes assigned=B → B re-reads, sees B, declares victory
//
// Both won, one task. tmp+rename makes each write atomic but does nothing about read-modify-write.
// So the check and the write happen inside a real mutual-exclusion primitive: mkdir(2) of a lock
// directory, which is atomic and fails with EEXIST when it already exists — cross-process, on every
// platform, with no daemon. The re-read afterwards is kept as the contract's verification step: it
// is what turns "I think I wrote it" into "the file on disk says my name".
const LOCK_STALE_MS = 2000;   // a critical section here is microseconds; 2s means the holder died
const LOCK_TRIES = 200;

function sleepSync(ms) {
  // Synchronous by design: the lock must be held across a synchronous read-modify-write, so the
  // waiter cannot yield to the event loop and let another claim interleave in the same process.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquire(lock) {
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (let i = 0; i < LOCK_TRIES; i++) {
    try {
      fs.mkdirSync(lock);           // NOT recursive — recursive:true succeeds on an existing dir
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmdirSync(lock);
      } catch { /* someone else cleaned it, or it went away — just retry */ }
      sleepSync(1 + (i % 5));
    }
  }
  return false;
}
function release(lock) { try { fs.rmdirSync(lock); } catch { /* already gone */ } }

export function claimTask(project, id, { actor = 'crystal' } = {}) {
  const pid = safeScope(project);
  const clean = safe(String(id || ''));
  const file = taskFile(pid, clean);
  if (!fs.existsSync(file)) throw new TaskError('no task "' + clean + '" in project "' + pid + '"', 404);

  const lock = path.join(locksDir(), pid + '__' + clean + '.lock');
  if (!acquire(lock)) return { won: false, reason: 'busy', task: getTask(pid, clean) };

  let wrote = false;
  try {
    const { data, content } = readMd(file);          // inside the lock — this read is authoritative
    const held = data.assigned || null;
    const open = (!data.status || data.status === 'open') && !held;
    if (!open && held !== actor) {
      return { won: false, reason: held ? 'claimed' : 'not-open', assigned: held, task: getTask(pid, clean) };
    }
    writeMd(file, { ...data, status: 'claimed', assigned: actor, claimed_at: nowIso(), updated: nowIso(), updated_by: actor }, content);
    wrote = true;
  } finally {
    release(lock);
  }

  // The contract's re-read. If the file does not say our name, we lost — back off and take another.
  const task = getTask(pid, clean);
  const won = wrote && task && task.assigned === actor;
  return won ? { won: true, task } : { won: false, reason: 'lost', assigned: task && task.assigned, task };
}

// ── findings ───────────────────────────────────────────────────────────────────────────────────
// `findings/<agent>-<slug>.md`. NOT under data/ — this is the agent's working output for a project,
// and only records.mjs ever writes a record.

export function findingPath(project, agent, slug) {
  return path.join(findingsDir(project), safe(slugify(agent) + '-' + slugify(slug)) + '.md');
}

export function saveFinding(project, { agent, slug, title = '', body = '', ...fields } = {}) {
  if (!agent) throw new TaskError('a finding is named after the agent that wrote it — `agent` is required');
  const file = findingPath(project, agent, slug || title);
  const data = { agent, title: title || slug || '', created: nowIso(), created_by: agent, ...fields };
  writeMd(file, data, String(body));
  return { path: path.relative(R(), file), agent, file };
}

export function listFindings(project) {
  return listMd(findingsDir(project)).map(f => {
    const found = readIf(path.join(findingsDir(project), f));
    if (!found) return null;
    return { id: f.slice(0, -3), ...found.data, body: found.content.trim() };
  }).filter(Boolean);
}

// ── runs ───────────────────────────────────────────────────────────────────────────────────────
// "what it is doing right now in plain language, what it did last, what it cost" (T12 step 6).

export function appendRun(run = {}) {
  const assistant = String(run.assistant || 'unknown');
  const started = run.started || nowIso();
  let id = run.id ? safe(String(run.id)) : safe(slugify(assistant) + '-' + started.replace(/[:.]/g, '-'));
  let n = 2;
  while (!run.id && fs.existsSync(runFile(id))) id = id.replace(/--\d+$/, '') + '--' + n++;
  const { summary, ...fields } = run;
  const data = {
    ...fields,
    id, assistant, started,
    ended: run.ended || null,
    status: run.status || 'running',    // running | done | failed | blocked
    cost: run.cost ?? 0,
  };
  writeMd(runFile(id), data, summary ? String(summary) : '');
  return { ...data, summary: summary || '' };
}

export function listRuns({ assistant = null, limit = 20 } = {}) {
  const out = [];
  for (const f of listMd(runsDir())) {
    const found = readIf(path.join(runsDir(), f));
    if (!found) continue;
    const r = { id: f.slice(0, -3), ...found.data, summary: found.content.trim() };
    if (assistant && r.assistant !== assistant) continue;
    out.push(r);
  }
  // Newest first — "what it did last" is the question this answers.
  out.sort((a, b) => String(b.started || '').localeCompare(String(a.started || '')));
  return out.slice(0, Math.max(0, Number(limit) || 20));
}

// ── routes ─────────────────────────────────────────────────────────────────────────────────────
// Mounted by index.mjs. Never register a route here that this file does not implement — the Index
// reads the registrations, and an advertised 404 costs an agent a whole job.

export function registerTaskRoutes(app, deps = {}) {
  const actorOf = req => String(req.body?.actor || req.query?.actor || 'crystal');
  const fail = (res, e) => res.status(e.status || 400).json({ error: e.message });
  // frontend/api.js sends PATCHes as { patch: {...}, actor }; agents and curl send the fields flat.
  // One door, both shapes — the alternative is an integrator edit in a file this module may not touch.
  const patchOf = (req, drop = []) => {
    const b = req.body || {};
    if (b.patch && typeof b.patch === 'object' && !Array.isArray(b.patch)) return { ...b.patch };
    const { actor, ...rest } = b;
    for (const k of drop) delete rest[k];
    return rest;
  };

  app.get('/api/assistants', (req, res) => res.json({ assistants: listAssistants() }));

  app.patch('/api/assistants/:id', async (req, res) => {
    try {
      const a = saveAssistant(req.params.id, patchOf(req), { actor: actorOf(req) });
      await event(deps, { type: 'update', actor: actorOf(req), target: a.path, detail: { assistant: a.id } });
      res.json(a);
    } catch (e) { fail(res, e); }
  });

  // T12 step 4 — findings are written one file per agent-and-slug so parallel agents can never
  // collide on a filename. The PROJECT screen counts them; without this route it said NOTHING
  // TURNED UP YET over a folder that had.
  app.get('/api/findings', (req, res) => {
    const project = String(req.query.project || '');
    if (!project) return res.status(400).json({ error: 'findings are per project — pass ?project=' });
    res.json({ project, findings: listFindings(project) });
  });

  app.get('/api/tasks', (req, res) => {
    res.json({ tasks: listTasks({ project: req.query.project || null, status: req.query.status || null }) });
  });

  app.post('/api/tasks', async (req, res) => {
    try {
      const { project, id, actor, ...patch } = req.body || {};
      const taskId = taskIdFrom({ id, title: patch.title, label: patch.label });
      const t = saveTask(project, taskId, patch, { actor: actorOf(req) });
      await event(deps, { type: 'store', actor: actorOf(req), target: t.path, detail: { task: t.id } });
      // `needs_human: true` pulls the task straight into the DECIDE queue (T12 step 5). One queue —
      // proposals.mjs owns it; this is the only place a task enters it.
      if (t.needs_human) await pullIntoDecide(t, actorOf(req), deps);
      res.json(t);
    } catch (e) { fail(res, e); }
  });

  app.patch('/api/tasks/:id', async (req, res) => {
    try {
      const found = findTask(req.params.id, { project: req.body?.project });
      if (!found) return res.status(404).json({ error: 'no task "' + req.params.id + '"' });
      const t = saveTask(found.project, found.id, patchOf(req, ['project']), { actor: actorOf(req) });
      await event(deps, { type: 'update', actor: actorOf(req), target: t.path, detail: { status: t.status } });
      if (t.needs_human) await pullIntoDecide(t, actorOf(req), deps);
      res.json(t);
    } catch (e) { fail(res, e); }
  });

  // 409 when someone beat you — the router skill already tells agents to read that and take another
  // (skills/scout-router/references/api-mode.md).
  app.post('/api/tasks/:id/claim', async (req, res) => {
    try {
      const found = findTask(req.params.id, { project: req.body?.project });
      if (!found) return res.status(404).json({ error: 'no task "' + req.params.id + '"' });
      const r = claimTask(found.project, found.id, { actor: actorOf(req) });
      await event(deps, {
        type: 'claim', actor: actorOf(req), target: found.path,
        detail: { won: r.won, assigned: r.assigned || (r.task && r.task.assigned) || null },
      });
      res.status(r.won ? 200 : 409).json(r);
    } catch (e) { fail(res, e); }
  });

  app.get('/api/runs', (req, res) => {
    res.json({ runs: listRuns({ assistant: req.query.assistant || null, limit: req.query.limit || 20 }) });
  });

  app.post('/api/runs', async (req, res) => {
    try {
      const r = appendRun(req.body || {});
      await event(deps, { type: 'store', actor: r.assistant, target: 'runs/' + r.id + '.md', detail: { status: r.status } });
      res.json(r);
    } catch (e) { fail(res, e); }
  });
}

// A blocked task with a question in its body becomes one `question` card, deterministically named
// so re-saving the task cannot fill the queue with copies of the same ask.
async function pullIntoDecide(task, actor, deps) {
  try {
    const propose = (deps && deps.propose) || (await import('./proposals.mjs').then(m => m.propose, () => null));
    if (!propose) return null;
    return await propose({
      id: 'task-' + task.project + '-' + task.id,
      kind: 'question',
      title: humanName(task),
      // `question` FIRST. The Index tells an agent to block a task with "needs_human and a
      // plain-language question", the field round-trips onto the file, and this read it back as
      // `task.body || task.title` — so the card in DECIDE asked her the task's SLUG. She was handed
      // "check-uk-scope" and expected to answer it.
      question: task.question || task.body || task.label || task.id,
      why: 'A task in ' + task.project + ' is blocked and needs an answer.',
      task: task.id,
      project: task.project,
    }, { actor });
  } catch { return null; }   // the queue is a consumer of tasks, never a precondition for saving one
}
