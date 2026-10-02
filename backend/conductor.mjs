// A persistent goal team: the model briefs, the canonical queue executes, the person decides.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getStorageRoot, readMd, writeMd, listProjects, byDate } from './store.mjs';
import { getCollection, saveCollection } from './collections.mjs';
import { upsertRecord, patchRecord, readRecord, listRecords } from './records.mjs';
import { getGoal } from './memory.mjs';
import { listTasks, getTask, saveTask, getAssistant, saveAssistant, workerCanTask } from './tasks.mjs';
import { wakeWorker, workerTaskReadiness, matchingWorkers, listWorkerWakes, referencedArtifactPaths } from './workers.mjs';
import { think, parseJsonBlock, brainBudgetToday } from './brain.mjs';
import { propose, listProposals } from './proposals.mjs';
import { DEFAULT_ACTOR, isAgentActor } from './actors.mjs';
import { currentWorkerIdentity, isProtectedFinance } from './workerScope.mjs';
import { projectConductorContext } from './conductorContext.mjs';
import { getSession } from './chat.mjs';
import { localDay, dayStartMs, addDays } from './daytime.mjs';
import { logEvent } from './log.mjs';

export class ConductorError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'ConductorError'; this.status = status; }
}
const active = new Map();
const injectedDeps = new Map(); // Explicit stand-ins stay with their test workspace's event-driven wakes.
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const iso = now => new Date(now).toISOString();
const humanReason = reason => /human|complete|done|chat|conversation|resume|correction/.test(reason);
const humanFingerprint = input => hash({ goal: input.goal,
  messages: input.human_messages, decisions: input.decisions.filter(p => p.status !== 'open'),
  work: input.work.filter(w => w.updated_by && !isAgentActor(w.updated_by)),
  artifacts: input.artifacts.filter(a => a.updated_by && !isAgentActor(a.updated_by)) });
const directory = () => path.join(getStorageRoot(), '.scout', 'conductor');
const controlFile = () => path.join(directory(), 'team.md');
const cycleFile = id => path.join(directory(), 'cycles', id + '.md');
const receiptFile = id => path.join(directory(), 'consumed', id + '.md');
const defaults = { enabled: false, state: 'idle', goal_id: null, project: null, coordinator: null, agents: [],
  cycle: 0, summary: 'Choose a goal and set up a team to begin.', max_parallel: 2, max_tasks_per_cycle: 4,
  min_cycle_minutes: 1, cooldown_minutes: 5, max_cycles_per_day: 12, max_human_reviews: 3 };

function readControl() {
  if (!fs.existsSync(controlFile())) return { ...defaults };
  try {
    const { data, content } = readMd(controlFile());
    if (typeof data.generation !== 'string' || !data.generation || !Array.isArray(data.agents) ||
      (data.active_cycle && !/^cycle-[a-z0-9-]+$/.test(data.active_cycle))) throw new Error('invalid control');
    return { ...defaults, ...data, summary: content.trim() };
  } catch { throw new ConductorError('The conductor control Markdown cannot be read; repair it before waking the team.', 409); }
}
function writeControl(config, patch = {}) {
  const next = { ...config, ...patch, updated: iso(Date.now()) };
  const { summary, ...data } = next;
  writeMd(controlFile(), data, String(summary || ''));
  return next;
}
function owner(actor) {
  if (currentWorkerIdentity() || isAgentActor(actor)) throw new ConductorError('Only the local owner configures or force-wakes a team.', 403);
}
function number(value, fallback, min, max, name) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new ConductorError(name + ' must be an integer from ' + min + ' to ' + max);
  return value;
}
function teamTasks(config) {
  if (!config.project) return [];
  return listTasks({ project: config.project }).filter(t => t.conductor_owned === true && t.goal_id === config.goal_id);
}
function rows(collection) {
  if (!getCollection(collection)) return [];
  return listRecords(collection).rows.map(d => {
    const record = readRecord(d.path);
    return { ...d.fields, ...record.data, id: record.data.id || d.slug || d.id, path: d.path,
      title: record.data.title || d.title, body: record.content || '' };
  });
}
function inScope(row, config, universe) {
  return String(row.project || '') === config.project && String(row.universe || 'local') === universe && !isProtectedFinance(row, row.path);
}
function goalWork(config, universe) {
  return rows('work').filter(w => w.goal_id === config.goal_id && inScope(w, config, universe));
}
function goalArtifacts(config, universe) {
  return rows('artifact').filter(a => inScope(a, config, universe) && (!a.goal_id || a.goal_id === config.goal_id));
}
function receipts() {
  let files;
  try { files = fs.readdirSync(path.join(directory(), 'consumed')).filter(f => !f.startsWith('.') && f.endsWith('.md')); }
  catch { return []; }
  return files.map(f => {
    try { return readMd(path.join(directory(), 'consumed', f)).data; }
    catch { throw new ConductorError('A conductor output receipt is unreadable; repair it before consuming results.', 409); }
  }).sort(byDate('created'));
}
function cycles() {
  let files;
  try { files = fs.readdirSync(path.join(directory(), 'cycles')).filter(f => !f.startsWith('.') && f.endsWith('.md')); }
  catch { return []; }
  return files.map(f => {
    try {
      const { data, content } = readMd(path.join(directory(), 'cycles', f));
      if (!data.id || !Number.isFinite(Date.parse(data.created)) || typeof data.state !== 'string') throw new Error('invalid cycle');
      return { ...data, summary: content.trim() };
    } catch { throw new ConductorError('A conductor cycle receipt is unreadable; repair it before buying another model call.', 409); }
  }).sort(byDate('created'));
}

export function ensureArtifactCollection() {
  const existing = getCollection('artifact');
  if (existing) {
    if (existing.broken) throw new ConductorError('Repair the artifact collection before starting the team.', 409);
    return existing;
  }
  return saveCollection({ id: 'artifact', label: 'Team drafts', icon: 'file',
    query: { tag: 'artifact', path: 'data/artifacts/**' }, fields: [
      { key: 'title', type: 'text', primary: true, required: true },
      { key: 'status', type: 'select', options: ['draft', 'reviewed'] },
      ...['source_task', 'assistant', 'goal_id', 'project', 'universe', 'result_hash', 'source_cycle'].map(key => ({ key, type: 'text' })),
    ], description: 'Prepared team outputs. Drafts are review material; they never count as a sent message or an observed result.' });
}

export function conductorStatus() {
  const config = readControl(), tasks = teamTasks(config);
  const goal = config.goal_id ? getGoal(config.goal_id) : null;
  const universe = String(goal?.data?.universe || 'local');
  const work = goalWork(config, universe);
  return { ...config, goal_label: goal?.label || null, project_label: listProjects().find(p => p.id === config.project)?.name || config.project,
    coordinator_name: config.coordinator ? getAssistant(config.coordinator)?.name || null : null,
    agents: config.agents.map(id => {
      const a = getAssistant(id), held = tasks.find(t => t.assigned === id && t.status === 'claimed');
      return { id, name: a?.name || id, job: a?.job || '', capabilities: a?.capabilities || [], status: a?.status || 'missing',
        doing: held?.title || null, task: held?.id || null };
    }),
    tasks: tasks.map(t => ({ id: t.id, title: t.title, status: t.status, assistant: t.prepared_by || t.assigned || t.worker_id,
      depends_on: t.depends_on || [], output_path: t.output_path || null, needs_human: !!t.needs_human, question: t.question || null })),
    recent_outputs: receipts().filter(r => r.goal_id === config.goal_id && r.project === config.project).slice(-12).reverse(),
    needs_you: work.filter(w => w.conductor_review && !['done', 'parked'].includes(w.status)).map(w => ({ id: w.id, title: w.title, path: w.path, status: w.status,
      artifacts: w.artifacts || [] })), budget: brainBudgetToday() };
}

export function configureConductor(patch = {}, { actor = DEFAULT_ACTOR } = {}) {
  owner(actor);
  const previous = readControl(), merged = { ...previous, ...patch };
  if ('enabled' in patch && typeof patch.enabled !== 'boolean') throw new ConductorError('enabled must be true or false');
  if (merged.enabled || merged.goal_id || merged.project) {
    if (!getGoal(merged.goal_id)) throw new ConductorError('Select an existing goal for this team.');
    if (!listProjects().some(p => p.id === merged.project)) throw new ConductorError('Select an existing project for this team.');
  }
  if (!Array.isArray(merged.agents) || merged.agents.length > 12 || merged.agents.some(id => typeof id !== 'string' || !getAssistant(id))) {
    throw new ConductorError('agents must name existing specialists (at most 12).');
  }
  if (merged.coordinator && !getAssistant(merged.coordinator)) throw new ConductorError('coordinator must name an existing assistant.');
  const options = {
    max_parallel: number(merged.max_parallel, 2, 1, 4, 'max_parallel'),
    max_tasks_per_cycle: number(merged.max_tasks_per_cycle, 4, 1, 4, 'max_tasks_per_cycle'),
    min_cycle_minutes: number(merged.min_cycle_minutes, 1, 1, 60, 'min_cycle_minutes'),
    cooldown_minutes: number(merged.cooldown_minutes, 5, 5, 1440, 'cooldown_minutes'),
    max_cycles_per_day: number(merged.max_cycles_per_day, 12, 1, 40, 'max_cycles_per_day'),
    max_human_reviews: number(merged.max_human_reviews, 3, 1, 6, 'max_human_reviews'),
  };
  // A config edit invalidates an outstanding response; it cannot apply to another goal/team.
  coordinatorStatus(previous, 'idle');
  writeControl(previous, { ...options, enabled: merged.enabled === true, goal_id: merged.goal_id, project: merged.project,
    coordinator: merged.coordinator || null, agents: [...new Set(merged.agents)], generation: randomUUID(),
    state: merged.enabled ? (previous.state === 'paused' ? 'paused' : 'idle') : 'ended',
    lease_expires_at: null, active_cycle: null, next_wake: null, reason: null,
    ...(previous.goal_id !== merged.goal_id || previous.project !== merged.project ? { input_fingerprint: null } : {}),
    summary: merged.enabled ? 'Team ready. The conductor will brief the next useful work.' : 'Team stopped by the owner.' });
  logEvent({ type: 'work', actor, target: '.scout/conductor/team.md', detail: { action: 'configure-team', enabled: merged.enabled, goal: merged.goal_id, project: merged.project } });
  return conductorStatus();
}
export function pauseConductor({ reason = 'Paused by the owner', untilTomorrow = false, actor = DEFAULT_ACTOR } = {}) {
  owner(actor);
  const config = readControl();
  if (!config.enabled) return conductorStatus();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  writeControl(config, { state: 'paused', generation: randomUUID(), reason, summary: reason, active_cycle: null, lease_expires_at: null,
    paused_until_day: untilTomorrow ? localDay(tomorrow) : null, next_wake: null });
  coordinatorStatus(config, 'idle');
  return conductorStatus();
}
export function resumeConductor({ actor = DEFAULT_ACTOR } = {}) {
  owner(actor);
  const config = readControl();
  writeControl(config, { state: 'idle', generation: randomUUID(), paused_until_day: null, reason: null, next_wake: null,
    summary: 'Team resumed. Reassessing the goal and latest decisions.' });
  return wakeConductor({ reason: 'human-resume', force: true, actor });
}
function coordinatorStatus(config, status) {
  if (config.coordinator && getAssistant(config.coordinator)) saveAssistant(config.coordinator, { status }, { actor: 'conductor' });
}
function valid(root, generation) {
  if (getStorageRoot() !== root) return false;
  const c = readControl();
  return c.enabled && c.generation === generation && c.state !== 'paused';
}

function context(config, now, options = {}) {
  const goal = getGoal(config.goal_id);
  if (!goal) throw new ConductorError('The selected goal is missing.', 409);
  const universe = String(goal.data?.universe || 'local');
  const work = goalWork(config, universe), artifacts = goalArtifacts(config, universe);
  const tasks = teamTasks(config);
  const messages = getSession('today-' + localDay(now))?.messages || [];
  return projectConductorContext({ config, goal, work, artifacts, tasks, messages,
    cards: listProposals({ status: 'all' }), now }, options);
}
function plannerPrompt(config, input) {
  return [
    'You are Mira, the continuous team conductor inside Scout. Work with the person toward this actual goal, across many rounds.',
    'You coordinate named specialists, inspect their real outputs, incorporate human corrections, and offer the next concrete decision. Never ask a generic "what next" when the goal/evidence allows useful work.',
    'Your summary is shown directly to the person. Speak to them as "you" in 1-3 short sentences, with one concrete next decision. Say "Try the guide and choose the first fix", not "Ask the person to try the guide".',
    'An external outcome may be pending. Respect dated follow-ups and continue useful independent local work from the broader goal. Never invent replies, observations, customer interviews, deployments or completed external actions.',
    'All specialists have NO TOOLS. Brief bounded research from supplied evidence, writing, review or analysis. Draft/synthetic material must be labelled. External sending/publishing remains a separate human approval.',
    'Use actual upstream outputs to revise the work. Do not repeat completed task instructions. A changed human constraint should produce a specific revision, not another identical packet. Avoid busywork.',
    'The newest completed work result_note is the person’s current instruction and decision. Older human_messages are conversation history and cannot override that completion correction. A completed checked review has already been handled: use its new correction to prepare the next useful packet rather than asking for that same review again.',
    'Honor explicit named specialist requests. If you ask Research/Scout, Check, Pen/Writer or Signal/Analyst to work in the summary, include that actual named specialist in the returned tasks or refer to its actual current task. Do not promise Research then only dispatch Pen. Make requested research/review a real step in the dependency chain.',
    'A specialist cannot fetch files or browse. Every existing artifact needed by a brief must be named in source_artifacts using an exact path from CURRENT CANONICAL CONTEXT. artifact_sources is the permitted canonical source index, including older evidence whose body is outside the bounded artifacts preview. Scout supplies the actual saved source text, including human edits, to the specialist. Use depends_on for team task dependencies. Reference both the edited draft and any correction material explicitly.',
    'Return ONE JSON object: {"summary":"short useful team update","tasks":[{"key":"local-slug","assistant":"exact specialist ID","title":"concrete output","instructions":"self-contained brief referring to supplied facts","requires":["skill"],"depends_on":["task key in this response or an existing task ID"],"source_artifacts":["exact existing permitted artifact path"],"review_required":true,"review_title":"the human decision after this output","review_instructions":"what to decide"}],"human_tasks":[{"key":"local-slug","title":"decision based on an existing draft","instructions":"one concrete decision","artifact_paths":["existing artifact path"],"estimate_min":10}],"question":{"text":"only a necessary missing decision","why":"why it blocks useful work"},"waiting_reason":"only if no useful independent work","wait_until":"optional ISO time"}. Omit unused question/wait fields.',
    'At most ' + config.max_tasks_per_cycle + ' tasks. Valid skills come from the named specialists. Set review_required:false for intermediate research/drafts consumed by a downstream specialist; the final checked packet should ask for a human review. Dependencies must form a DAG.',
    'Human reviews are capped at ' + config.max_human_reviews + '. Avoid piling up decisions. Prefer finishing/revising the current packet, but useful independent preparation can continue while a real external outcome is pending.',
    'CURRENT CANONICAL CONTEXT', JSON.stringify(input),
    // Prior prose could quote material whose membership has since changed. Only round state
    // metadata is retained here; actual continuity comes from the currently projected facts.
    'PREVIOUS TEAM ROUNDS', JSON.stringify(cycles().filter(c => c.goal_id === config.goal_id && c.project === config.project).slice(-6).map(c => ({ id: c.id, state: c.state }))),
  ].join('\n\n');
}
function validatePlan(raw, config, input) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConductorError('Coordinator returned no valid plan.');
  const tasks = raw.tasks || [], human = raw.human_tasks || [];
  if (!Array.isArray(tasks) || tasks.length > config.max_tasks_per_cycle || !Array.isArray(human) || human.length > 2) throw new ConductorError('Coordinator exceeded the bounded task plan.');
  const artifactIndex = new Map([...(input.artifact_sources || []), ...input.artifacts].map(a => [a.path, a]));
  const known = new Set(input.tasks.map(t => t.id)), artifactPaths = new Set(artifactIndex.keys()), keys = new Set();
  const checked = tasks.map(t => {
    if (!t || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(t.key || '') || keys.has(t.key)) throw new ConductorError('Task keys must be unique slugs.');
    keys.add(t.key);
    if (!config.agents.includes(t.assistant)) throw new ConductorError('Coordinator selected a specialist outside this team.');
    const assistant = getAssistant(t.assistant);
    if (!String(t.title || '').trim() || String(t.title).length > 200 || !String(t.instructions || '').trim() || String(t.instructions).length > 8000) throw new ConductorError('Each task needs a bounded title and concrete instructions.');
    const requires = t.requires || [];
    if (!Array.isArray(requires) || requires.some(s => typeof s !== 'string') || !workerCanTask(assistant, { requires })) throw new ConductorError('The selected specialist cannot satisfy the task skills.');
    if (assistant.worker_mode !== 'prepare' || !matchingWorkers({ project: config.project, universe: input.universe, requires }, { assistantId: t.assistant }).length) throw new ConductorError('Specialist preparation or project membership is disabled.');
    if (!Array.isArray(t.depends_on || []) || (t.depends_on || []).some(id => typeof id !== 'string')) throw new ConductorError('Task dependencies must name tasks.');
    if (t.source_artifacts != null && (!Array.isArray(t.source_artifacts) || t.source_artifacts.some(p => typeof p !== 'string'))) throw new ConductorError('Task source_artifacts must name permitted canonical artifact paths.');
    const sources = [...new Set([...(t.source_artifacts || []), ...referencedArtifactPaths(t.instructions)])];
    if (sources.length > 4 || sources.some(p => !artifactPaths.has(p))) throw new ConductorError('Task source artifacts must be at most four currently permitted artifacts.');
    if ((t.review_required != null && typeof t.review_required !== 'boolean') ||
      (t.review_title != null && (typeof t.review_title !== 'string' || t.review_title.length > 200)) ||
      (t.review_instructions != null && (typeof t.review_instructions !== 'string' || t.review_instructions.length > 4000))) {
      throw new ConductorError('Review instructions must be bounded text and review_required a boolean.');
    }
    // Hashes come from the current authorized projection, never a model-supplied value.
    const sourceHashes = Object.fromEntries(sources.map(p => {
      const artifact = artifactIndex.get(p);
      return [p, artifact.body_hash || hash(JSON.stringify(String(artifact.body || '')))];
    }));
    return { ...t, requires, depends_on: t.depends_on || [], source_artifacts: sources,
      source_hashes: sourceHashes, review_required: t.review_required !== false };
  });
  const visiting = new Set(), visited = new Set();
  function visit(key) {
    if (visiting.has(key)) throw new ConductorError('Coordinator task dependencies contain a cycle.');
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of checked.find(t => t.key === key).depends_on) {
      if (keys.has(dependency)) visit(dependency);
      else if (!known.has(dependency)) throw new ConductorError('Coordinator named a missing upstream task.');
    }
    visiting.delete(key); visited.add(key);
  }
  checked.forEach(t => visit(t.key));
  for (const t of human) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(t.key || '') || !String(t.title || '').trim() || String(t.title).length > 200 || !String(t.instructions || '').trim() || String(t.instructions).length > 4000 ||
      !Array.isArray(t.artifact_paths) || !t.artifact_paths.length || t.artifact_paths.some(p => !artifactPaths.has(p))) throw new ConductorError('Human review must refer to supplied artifacts and a concrete decision.');
  }
  if (raw.question && (!String(raw.question.text || '').trim() || String(raw.question.text).length > 1000)) throw new ConductorError('Coordinator question must be a bounded real question.');
  const wait = raw.wait_until ? Date.parse(raw.wait_until) : NaN;
  return { tasks: checked, human, summary: String(raw.summary || 'The team prepared the next goal step.').slice(0, 1500),
    question: raw.question || null, waiting_reason: String(raw.waiting_reason || '').slice(0, 1000), wait_until: Number.isFinite(wait) ? iso(wait) : null };
}

async function createReview(config, { key, title, instructions, artifacts, task = null }, today, now) {
  const goal = getGoal(config.goal_id), universe = String(goal.data?.universe || 'local');
  const id = 'team-review-' + hash([config.project, config.goal_id, key]).slice(0, 24);
  // A reused review lives at the first packet's path, not necessarily this output's digest
  // path. Canonical human completion/parking is the receipt for every task in its lineage.
  if (task && goalWork(config, universe).some(w => w.conductor_review && ['done', 'parked'].includes(w.status) &&
    (w.source_task === task || w.review_latest_task === task || (w.review_lineage || []).includes(task)))) return false;
  if (!task) {
    const draftSources = artifacts.map(a => artifactProducer(a.path, config, universe)).filter(writingTask);
    const requestedWritingLineage = new Set(draftSources.flatMap(source => [...taskAncestry(source.id, config, universe).keys()])
      .filter(id => writingTask(getTask(config.project, id))));
    const existing = goalWork(config, universe).filter(w => w.conductor_review && !['done', 'parked'].includes(w.status))
      .find(w => {
        const previous = taskAncestry(w.review_latest_task || w.source_task, config, universe);
        const attachedProducers = (w.artifacts || []).map(a => artifactProducer(a.path, config, universe)).filter(Boolean);
        for (const source of attachedProducers) for (const [id, depth] of taskAncestry(source.id, config, universe)) {
          if (!previous.has(id)) previous.set(id, depth);
        }
        return [...requestedWritingLineage].some(id => previous.has(id));
      });
    // A standalone human decision about that same open writing packet is already available.
    // Its older source references must not replace the current checked draft or human notes.
    if (existing) return false;
  }
  const ancestry = task ? taskAncestry(task, config, universe) : new Map();
  const dependencyAncestry = task ? taskAncestry(task, config, universe, { sources: false }) : new Map();
  // A new research→draft→check packet may refer to the saved guide instead of depending on
  // its old Check task. The artifact's canonical producer identifies that same draft lineage.
  // Merely citing the guide in an independent analysis is not a new writing revision.
  const draftTasks = [...dependencyAncestry.keys()].filter(id => writingTask(getTask(config.project, id)));
  const related = task ? goalWork(config, universe).filter(w => w.conductor_review && !['done', 'parked'].includes(w.status))
    .map(w => {
      const latest = w.review_latest_task || w.source_task;
      if (dependencyAncestry.has(latest)) return { work: w, distance: dependencyAncestry.get(latest) };
      const previousAncestry = taskAncestry(latest, config, universe);
      if (!draftTasks.some(id => !previousAncestry.has(id))) return null;
      const shared = [...previousAncestry.keys()]
        .filter(id => ancestry.has(id) && writingTask(getTask(config.project, id)));
      return shared.length ? { work: w, distance: Math.min(...shared.map(id => ancestry.get(id))) } : null;
    }).filter(Boolean).sort((a, b) => Number(b.work.status === 'now') - Number(a.work.status === 'now') || a.distance - b.distance)[0]?.work : null;
  const reviewPath = related?.path || 'data/work/' + id + '.md';
  if (fs.existsSync(path.join(getStorageRoot(), reviewPath))) {
    // Add missing supporting drafts through the revision-aware writer, preserving the person's
    // body, status, decision notes and any manually attached references.
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = readRecord(reviewPath);
      if (current.data.goal_id !== config.goal_id || !inScope({ ...current.data, path: reviewPath }, config, universe)) {
        throw new ConductorError('The existing review belongs to another goal or scope.', 409);
      }
      const latest = current.data.review_latest_task || current.data.source_task;
      // Consuming old receipts again cannot roll an active review back to an earlier revision.
      if (task && latest && latest !== task) {
        const previousTask = getTask(config.project, latest), incomingTask = getTask(config.project, task);
        if ((current.data.review_lineage || []).includes(task) || taskAncestry(latest, config, universe).has(task) ||
          (previousTask && incomingTask && byDate('created')(incomingTask, previousTask) < 0 && !ancestry.has(latest))) return false;
      }
      const previous = Array.isArray(current.data.artifacts) ? current.data.artifacts : [];
      const generated = new Set(Array.isArray(current.data.review_generated_paths) ? current.data.review_generated_paths :
        [...taskAncestry(latest, config, universe).keys()].map(taskId => getTask(config.project, taskId)?.output_path).filter(Boolean));
      const manuallyAttached = previous.filter(a => !generated.has(a.path));
      const next = [...artifacts, ...manuallyAttached].filter((a, index, all) => all.findIndex(b => b.path === a.path) === index);
      if (hash(next) === hash(previous) && (!task || latest === task) && current.data.review_generated_paths) return false;
      const lineage = [...new Set([...(current.data.review_lineage || []), current.data.source_task, latest, task].filter(Boolean))];
      try { await patchRecord(reviewPath, { artifacts: next, review_generated_paths: artifacts.map(a => a.path),
        ...(task ? { review_latest_task: task, review_lineage: lineage } : {}) }, { actor: 'conductor', rev: current.rev }); return false; }
      catch (error) { if (error.status !== 409 || attempt === 2) throw error; }
    }
  }
  const open = goalWork(config, universe).filter(w => w.conductor_review && !['done', 'parked'].includes(w.status));
  if (open.length >= config.max_human_reviews) return false;
  upsertRecord({ collection: 'work', id, title: String(title).slice(0, 200), tags: ['work'], status: 'planned', day: localDay(now),
    bucket: 'admin', estimate_min: 10, project: config.project, universe, goal_id: config.goal_id, conductor_review: true,
    source_task: task, artifacts, prep: false, prep_state: 'ready', done_when: instructions,
    review_latest_task: task, review_lineage: task ? [task] : [], review_generated_paths: artifacts.map(a => a.path),
    why: 'Review the team’s prepared material and give the next specific correction.',
    body: instructions + '\n\n## Prepared material\n\n' + artifacts.map(a => '[[' + a.path + '|' + a.title + ']]').join('\n') + '\n',
  }, { actor: 'conductor', via: 'team-review' });
  await today.activateReadyWork({ actor: 'conductor' });
  return true;
}
function scopedArtifact(sourcePath, config, universe) {
  if (typeof sourcePath !== 'string' || !/^data\/artifacts\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.md$/.test(sourcePath)) return null;
  let record;
  try { record = readRecord(sourcePath); } catch { return null; }
  return record.collection === 'artifact' && record.data.goal_id === config.goal_id &&
    inScope({ ...record.data, path: record.path }, config, universe) ? record : null;
}
function sourcePaths(task) {
  return [...new Set([...(Array.isArray(task.source_artifacts) ? task.source_artifacts : []), ...referencedArtifactPaths(task.body)])].slice(0, 4);
}
function artifactProducer(sourcePath, config, universe) {
  const artifact = scopedArtifact(sourcePath, config, universe);
  const producer = artifact?.data.source_task ? getTask(config.project, artifact.data.source_task) : null;
  return artifact && producer?.output_path === artifact.path && producer.goal_id === config.goal_id &&
    String(producer.universe || 'local') === universe && !isProtectedFinance(producer, producer.path) ? producer : null;
}
function writingTask(task) {
  if (!task) return false;
  const assistantId = task.prepared_by || task.worker_id || task.assigned;
  const assistant = assistantId ? getAssistant(assistantId) : null;
  return [...(task.requires || []), ...(assistant?.capabilities || [])].some(skill => ['draft', 'writing'].includes(skill));
}
function taskAncestry(id, config, universe, { sources = true } = {}) {
  const found = new Map(), queue = [{ id, depth: 0 }];
  while (queue.length && found.size < 120) {
    const next = queue.shift(), source = next.id ? getTask(config.project, next.id) : null;
    if (!source || found.has(source.id) || source.project !== config.project || source.goal_id !== config.goal_id ||
      String(source.universe || 'local') !== universe || isProtectedFinance(source, source.path)) continue;
    found.set(source.id, next.depth);
    for (const dep of (source.depends_on || []).slice(0, 120)) queue.push({ id: dep, depth: next.depth + 1 });
    if (sources) for (const sourcePath of sourcePaths(source)) {
      const producer = artifactProducer(sourcePath, config, universe);
      // A source_task label alone cannot forge the lineage of another task's draft.
      if (producer) queue.push({ id: producer.id, depth: next.depth + 1 });
    }
  }
  return found;
}
function reviewPacket(task, receipt, config) {
  const universe = String(getGoal(config.goal_id)?.data?.universe || 'local');
  const supporting = [], seen = new Set();
  function add(source) {
    if (!source || seen.has(source.id) || source.project !== config.project || source.goal_id !== config.goal_id ||
      String(source.universe || 'local') !== universe || source.status !== 'done' || !source.output_path) return;
    seen.add(source.id);
    const record = scopedArtifact(source.output_path, config, universe);
    if (!record) return;
    supporting.push({ path: record.path, title: record.data.title || source.title, assistant: record.data.assistant || source.prepared_by || source.worker_id });
  }
  const direct = (task.depends_on || []).map(id => getTask(config.project, id));
  direct.forEach(add); // The actual draft being checked precedes further supporting research.
  for (const source of direct) for (const id of source?.depends_on || []) add(getTask(config.project, id));
  for (const source of [task, ...direct, ...direct.flatMap(t => (t?.depends_on || []).map(id => getTask(config.project, id)))].filter(Boolean)) {
    for (const sourcePath of sourcePaths(source)) {
      const record = scopedArtifact(sourcePath, config, universe);
      if (record && !supporting.some(a => a.path === record.path)) supporting.push({ path: record.path,
        title: record.data.title || path.basename(record.path, '.md'), assistant: record.data.assistant || null });
    }
  }
  const final = { path: receipt.path, title: receipt.title, assistant: receipt.assistant };
  return [...supporting.filter(a => a.path !== final.path).slice(0, 3), final];
}
async function consume(config, today, now, stillValid) {
  const outputs = [];
  for (const task of teamTasks(config)) {
    if (!stillValid()) break;
    if (task.status !== 'done' || task.prep_state !== 'ready' || !task.prepared_text) continue;
    const digest = hash([task.project, task.id, task.prepared_text]), file = receiptFile(digest);
    let receipt = fs.existsSync(file) ? readMd(file).data : null;
    if (!receipt) {
      ensureArtifactCollection();
      const id = 'team-output-' + digest.slice(0, 24), universe = String(getGoal(config.goal_id)?.data?.universe || 'local');
      const artifactPath = 'data/artifacts/' + id + '.md';
      // A recovery never rewrites the person's edits to an already stored draft.
      if (!fs.existsSync(path.join(getStorageRoot(), artifactPath))) upsertRecord({ collection: 'artifact', id, title: task.title, tags: ['artifact'],
        status: 'draft', source_task: task.id, assistant: task.prepared_by || task.worker_id, goal_id: config.goal_id,
        project: config.project, universe, result_hash: digest, source_cycle: task.conductor_cycle,
        body: String(task.prepared_text) }, { actor: 'conductor', via: 'team-output' });
      receipt = { id: digest, path: artifactPath, title: task.title, assistant: task.prepared_by || task.worker_id,
        worker: task.prepared_by || task.worker_id, task: task.id, project: config.project, goal_id: config.goal_id,
        created: iso(now), review_created: false };
      writeMd(file, receipt, 'Canonical prepared draft; no observed outcome or external action is implied.\n');
      saveTask(config.project, task.id, { output_path: artifactPath }, { actor: 'conductor' });
      outputs.push(receipt);
    }
    const packet = reviewPacket(task, receipt, config);
    if (task.review_required !== false) {
      const artifacts = packet;
      const created = await createReview(config, { key: digest, title: task.review_title || 'Review: ' + task.title,
        instructions: task.review_instructions || 'Read the prepared draft. Decide what to keep or change and record your correction before the team continues.', artifacts, task: task.id }, today, now);
      if (created || goalWork(config, String(getGoal(config.goal_id)?.data?.universe || 'local')).some(w => w.conductor_review &&
        (w.source_task === task.id || w.review_latest_task === task.id || (w.review_lineage || []).includes(task.id)))) {
        if (!receipt.review_created) { receipt.review_created = true; writeMd(file, receipt, 'Canonical prepared draft; human review queued.\n'); }
      }
    }
    if (!stillValid()) break;
    await today.publishTeamMessage((getAssistant(receipt.assistant)?.name || receipt.assistant) + ' prepared “' + receipt.title + '”.',
      { key: 'team-output-' + digest, artifacts: packet, assistant: receipt.assistant });
    if (task.review_required !== false && receipt.review_created && packet.length > 1) {
      await today.publishTeamMessage('Your review packet: ' + (task.review_title || 'Review: ' + task.title) + '. The actual drafts and the check are attached.',
        { key: 'team-packet-' + digest + '-' + hash(packet.map(a => a.path)).slice(0, 16), artifacts: packet, assistant: config.coordinator });
    }
  }
  return outputs;
}
function dispatchReady(config, deps, now) {
  const tasks = teamTasks(config), started = [];
  let slots = Math.max(0, config.max_parallel - tasks.filter(t => t.status === 'claimed').length);
  for (const task of tasks) {
    if (!slots) break;
    if (task.status !== 'open' || task.needs_human || !workerTaskReadiness(task, tasks).ready) continue;
    const wake = wakeWorker({ key: 'conductor:' + config.project + ':' + task.id, project: config.project, task: task.id,
      assistant: task.worker_id, actor: DEFAULT_ACTOR }, { now, deps: deps.worker || (deps.workerThink ? { think: deps.workerThink, clock: deps.clock } : {}) });
    if (wake.started) { started.push(task.id); slots--; }
  }
  return started;
}
function pendingRetry(config, now) {
  const taskIds = new Set(teamTasks(config).filter(t => t.status === 'open').map(t => t.id));
  return listWorkerWakes().filter(w => w.project === config.project && taskIds.has(w.task) && ['retry', 'cooldown'].includes(w.state) && Date.parse(w.next_at) > now)
    .sort(byDate('next_at'))[0];
}
function applyTasks(plan, config, cycleId, universe) {
  const ids = new Map();
  // Topological IDs include actual upstream task identities, so changing a brief changes its packet.
  function idFor(key) {
    if (ids.has(key)) return ids.get(key);
    const task = plan.tasks.find(t => t.key === key);
    if (!task) return key;
    const dependencies = task.depends_on.map(idFor);
    const identity = [config.project, config.goal_id, task.assistant, task.title.trim().toLowerCase(), task.instructions.trim(), dependencies];
    if (task.source_artifacts.length) identity.push(task.source_artifacts, task.source_hashes);
    const id = 'team-task-' + hash(identity).slice(0, 24);
    ids.set(key, id); return id;
  }
  plan.tasks.forEach(t => idFor(t.key));
  const created = [];
  for (const t of plan.tasks) {
    const id = ids.get(t.key);
    if (getTask(config.project, id)) continue;
    created.push(saveTask(config.project, id, { title: t.title, body: t.instructions, status: 'open', requires: t.requires,
      depends_on: t.depends_on.map(idFor), source_artifacts: t.source_artifacts, source_hashes: t.source_hashes,
      worker_id: t.assistant, worker_mode: 'prepare', conductor_owned: true,
      conductor_cycle: cycleId, conductor_key: t.key, goal_id: config.goal_id, universe,
      review_required: t.review_required, review_title: t.review_title || null, review_instructions: t.review_instructions || null }, { actor: 'conductor' }));
  }
  return created;
}
function finishCycle(config, cycleId, state, summary, patch = {}) {
  const next = writeControl(config, { state, summary, active_cycle: null, lease_expires_at: null, ...patch });
  const file = cycleFile(cycleId), old = readMd(file).data;
  writeMd(file, { ...old, state, ended: iso(Date.now()), ...patch }, summary);
  coordinatorStatus(next, state === 'cooldown' ? 'blocked' : 'idle');
  return next;
}
async function runCycle(config, cycleId, root, deps, { reason, force, now }) {
  const stillValid = () => valid(root, config.generation);
  const today = await import('./today.mjs');
  if (!stillValid()) return;
  context(config, now); // Authorization precedes owner-side result consumption or new worker calls.
  await consume(config, today, now, stillValid);
  if (!stillValid()) return;
  dispatchReady(config, deps, now);
  const ctx = context(config, now), tasks = teamTasks(config);
  if (tasks.some(t => t.status === 'claimed')) {
    finishCycle(readControl(), cycleId, 'working', 'Specialists are preparing the next packet. Their completed outputs will wake the conductor.',
      { next_wake: iso(now + 60_000) });
    return;
  }
  const retry = pendingRetry(config, now);
  if (retry) {
    finishCycle(readControl(), cycleId, 'cooldown', 'A specialist is waiting for its provider cooldown. Its brief and completed drafts are saved.',
      { reason: retry.reason, next_wake: retry.next_at });
    return;
  }
  const timedWakeDue = config.wait_until && Date.parse(config.wait_until) <= now;
  const humanChanged = humanFingerprint(ctx.input) !== config.last_human_fingerprint;
  const changed = ctx.fingerprint !== config.input_fingerprint || timedWakeDue || config.human_replan_pending || humanChanged;
  const eventDriven = humanReason(reason) || config.human_replan_pending || humanChanged;
  const tooSoon = Date.parse(config.last_plan_at || '') + config.min_cycle_minutes * 60_000 > now;
  if (!force && (!changed || (tooSoon && !eventDriven))) {
    finishCycle(readControl(), cycleId, 'waiting', changed ? 'New results are ready; the conductor will reassess shortly.' : (config.waiting_reason || 'Waiting for the next human decision or new evidence; completed briefs will not be repeated.'),
      { next_wake: changed ? iso(Date.parse(config.last_plan_at) + config.min_cycle_minutes * 60_000) : (config.wait_until || null) });
    return;
  }
  const plannedToday = cycles().filter(c => c.plan_attempted && localDay(c.created) === localDay(now)).length;
  if (plannedToday >= config.max_cycles_per_day || !brainBudgetToday(now).light.remaining) {
    finishCycle(readControl(), cycleId, 'cooldown', 'The team reached its daily light-model budget. Drafts and human decisions remain available.',
      { reason: 'Daily coordinator/light call budget reached.', next_wake: iso(dayStartMs(addDays(localDay(now), 1))) });
    return;
  }
  writeMd(cycleFile(cycleId), { ...readMd(cycleFile(cycleId)).data, plan_attempted: true, input_fingerprint: ctx.fingerprint }, 'Assessing the goal and team output.\n');
  const liveContext = context(config, now, { retainIdentity: true });
  let result, plan;
  try {
    result = await (deps.think || think)({ purpose: 'plan', prompt: plannerPrompt(config, liveContext.input), timeoutMs: 120_000 });
    if (!stillValid()) return;
    liveContext.validate(); // Revoked or changed membership invalidates an outstanding response.
    if (!result?.ok) throw new ConductorError(result?.reason || 'No light coordinator is available.', 503);
    if (context(config, now).fingerprint !== liveContext.fingerprint) {
      finishCycle(readControl(), cycleId, 'idle', 'Your latest edit arrived while the conductor was thinking. It is rereading the current work before briefing the team.', { next_wake: iso(now), human_replan_pending: true });
      const current = active.get(root);
      if (current) { current.again = true; current.queuedReason = 'human-correction'; }
      return;
    }
    try { plan = validatePlan(parseJsonBlock(result.text), config, liveContext.input); }
    catch (error) {
      const recorded = readMd(cycleFile(cycleId));
      writeMd(cycleFile(cycleId), { ...recorded.data, validation_error: String(error.message || error).slice(0, 1000),
        invalid_response: String(result.text || '').slice(0, 20_000), provider: result.provider || null, model: result.model || null }, recorded.content);
      throw error;
    }
  } finally { liveContext.release(); }
  const created = applyTasks(plan, config, cycleId, ctx.universe);
  for (const h of plan.human) {
    if (!stillValid()) return;
    await createReview(config, { key: hash([h.title, h.instructions, h.artifact_paths]), title: h.title, instructions: h.instructions,
      artifacts: h.artifact_paths.map(p => { const a = [...ctx.input.artifacts, ...(ctx.input.artifact_sources || [])].find(a => a.path === p);
        return { path: p, title: a.title, assistant: a.assistant }; }) }, today, now);
  }
  if (!stillValid()) return;
  if (plan.question && !listProposals({ kind: 'question' }).some(p => p.project === config.project && p.goal_id === config.goal_id)) {
    propose({ id: 'team-question-' + hash([config.project, config.goal_id, plan.question.text]).slice(0, 24), kind: 'question',
      title: plan.question.text, question: plan.question.text, why: String(plan.question.why || 'Your decision will let the team continue.').slice(0, 1000),
      project: config.project, goal_id: config.goal_id, evidence: ['[[' + ctx.goal.path + ']]'] }, { actor: 'conductor' });
  }
  const started = dispatchReady(config, deps, now);
  await today.publishTeamMessage(plan.summary + (created.length ? '\n\n' + created.map(t => '- ' + (getAssistant(t.worker_id)?.name || t.worker_id) + ': ' + t.title).join('\n') : ''),
    { key: 'team-cycle-' + cycleId, assistant: config.coordinator });
  if (!stillValid()) return;
  finishCycle(readControl(), cycleId, started.length || teamTasks(config).some(t => t.status === 'claimed') ? 'working' : 'waiting', plan.summary,
    { last_plan_at: iso(now), input_fingerprint: context(config, now).fingerprint, reason: null,
      last_human_fingerprint: humanFingerprint(liveContext.input), human_replan_pending: false,
      waiting_reason: plan.waiting_reason || null, wait_until: plan.wait_until,
      next_wake: started.length ? iso(now + 60_000) : plan.wait_until, provider: result.provider || null, model: result.model || null });
}

export function wakeConductor({ reason = 'manual', force = false, actor = DEFAULT_ACTOR, deps = {}, now = Date.now() } = {}) {
  if (force) owner(actor);
  if (currentWorkerIdentity()) throw new ConductorError('A scoped specialist cannot wake the owner conductor.', 403);
  now = Number(now instanceof Date ? now.getTime() : now);
  const root = getStorageRoot();
  if (Object.keys(deps).length) injectedDeps.set(root, deps);
  else deps = injectedDeps.get(root) || {};
  let config = readControl();
  if (!config.enabled) return { started: false, status: conductorStatus() };
  if (config.state === 'paused') {
    if (config.paused_until_day && localDay(now) >= config.paused_until_day && /open|morning|scheduler/.test(reason)) {
      config = writeControl(config, { state: 'idle', paused_until_day: null, reason: null, generation: randomUUID() });
    } else return { started: false, status: conductorStatus() };
  }
  if (humanReason(reason)) config = writeControl(config, { human_replan_pending: true });
  if (active.has(root)) {
    const held = active.get(root); held.again = true;
    if (humanReason(reason) || !humanReason(held.queuedReason || '')) held.queuedReason = reason;
    return { started: false, status: conductorStatus() };
  }
  if (config.state === 'cooldown' && Date.parse(config.next_wake) > now) return { started: false, status: conductorStatus() };
  if (config.active_cycle && Date.parse(config.lease_expires_at) > now) return { started: false, status: conductorStatus() };
  // A scheduler tick does not create a history file or buy a call for unchanged facts.
  if (!force && config.state === 'waiting' && config.input_fingerprint && !config.human_replan_pending && !(config.next_wake && Date.parse(config.next_wake) <= now)) {
    const current = context(config, now);
    if (current.fingerprint === config.input_fingerprint && humanFingerprint(current.input) === config.last_human_fingerprint) return { started: false, status: conductorStatus() };
  }
  const lock = path.join(directory(), 'wake.lock');
  fs.mkdirSync(directory(), { recursive: true });
  try { fs.mkdirSync(lock); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    try { if (Date.now() - fs.statSync(lock).mtimeMs > 2000) fs.rmdirSync(lock); } catch { /* contender */ }
    try { fs.mkdirSync(lock); } catch { return { started: false, status: conductorStatus() }; }
  }
  let cycleId;
  try {
    config = readControl();
    if (config.active_cycle && Date.parse(config.lease_expires_at) > now) return { started: false, status: conductorStatus() };
    if (config.active_cycle && fs.existsSync(cycleFile(config.active_cycle))) {
      const abandoned = readMd(cycleFile(config.active_cycle));
      writeMd(cycleFile(config.active_cycle), { ...abandoned.data, state: 'recovered', ended: iso(now), reason: 'Coordinator lease expired.' },
        'The prior backend stopped before recording completion. Canonical tasks and stored outputs are being reassessed.');
    }
    cycleId = 'cycle-' + randomUUID();
    config = writeControl(config, { state: 'thinking', generation: randomUUID(), cycle: (Number(config.cycle) || 0) + 1,
      active_cycle: cycleId, lease_expires_at: iso(now + 3 * 60_000), last_wake: iso(now), reason,
      summary: 'The conductor is reading the goal, recent decisions and team outputs.' });
    writeMd(cycleFile(cycleId), { id: cycleId, goal_id: config.goal_id, project: config.project, created: iso(now), reason, state: 'thinking' }, config.summary);
    coordinatorStatus(config, 'running');
  } finally { try { fs.rmdirSync(lock); } catch { /* released */ } }
  const entry = { again: false, reason, queuedReason: null, done: null };
  active.set(root, entry);
  entry.done = runCycle(config, cycleId, root, deps, { reason, force, now }).catch(error => {
    if (!valid(root, config.generation)) return;
    finishCycle(readControl(), cycleId, 'cooldown', 'The conductor paused: ' + String(error.message || error).slice(0, 800),
      { reason: String(error.message || error).slice(0, 1000), next_wake: iso(now + config.cooldown_minutes * 60_000) });
  }).finally(() => {
    if (active.get(root) === entry) active.delete(root);
    const next = getStorageRoot() === root ? readControl() : null;
    if (next?.enabled && next.state !== 'paused' && entry.again) {
      queueMicrotask(() => wakeConductor({ reason: entry.queuedReason || entry.reason, deps, now: typeof deps.clock === 'function' ? deps.clock() : Date.now() }));
    }
  });
  return { started: true, status: conductorStatus() };
}
export async function conductorSettled() {
  const root = getStorageRoot();
  while (active.has(root)) await active.get(root).done;
}
