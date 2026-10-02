// Every coordinator fact crosses the same membership projection as a specialist prompt.
import { randomUUID, createHash } from 'node:crypto';
import { dayMs } from './store.mjs';
import { getCollection } from './collections.mjs';
import { readRecord } from './records.mjs';
import { renderCache } from './memory.mjs';
import { getAssistant } from './tasks.mjs';
import { localDay } from './daytime.mjs';
import { workReadiness } from './workflow.mjs';
import { isAgentActor } from './actors.mjs';
import { getWorkerPolicy, issueWorkerRun, withWorkerIdentity, currentWorkerIdentity,
  workerCanReadDocument, projectWorkerDocument, isProtectedFinance } from './workerScope.mjs';

const fail = message => Object.assign(new Error(message), { status: 403 });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function projectConductorContext({ config, goal, work, artifacts, tasks, messages, cards, now }, { retainIdentity = false } = {}) {
  const universe = String(goal.data?.universe || 'local');
  const policy = config.coordinator ? getWorkerPolicy(config.coordinator) : null;
  const identity = policy ? issueWorkerRun({ assistantId: config.coordinator,
    runId: 'conductor-context-' + randomUUID(), project: config.project, ttlMs: 3 * 60_000 }) : null;
  // Legacy local coordination is deliberately limited to explicit selected facts.
  const bounds = policy || { enabled: true, finance: false, universes: [universe], projects: [config.project],
    collections: { read: ['work', 'artifact'], write: [] }, memory: { read: [goal.path], write: [] } };
  let released = false;
  const validate = () => {
    if (released) throw fail('The coordinator context identity is no longer active.');
    if (identity) return withWorkerIdentity(identity.token, () => currentWorkerIdentity());
    // Adding membership while a legacy response is out also invalidates that response.
    if (config.coordinator && getWorkerPolicy(config.coordinator)) throw fail('Coordinator membership changed during the model call.');
    return true;
  };
  const release = () => { identity?.revoke(); released = true; };
  const within = fn => identity ? withWorkerIdentity(identity.token, fn) : fn();
  try {
    const result = within(() => {
      if (!bounds.enabled || !bounds.projects.includes(config.project) || !bounds.universes.includes(universe) ||
        !bounds.memory.read.includes(goal.path) || (!bounds.finance && isProtectedFinance(goal.data, goal.path)) ||
        (goal.data?.project && String(goal.data.project) !== config.project)) throw fail('The selected goal is outside coordinator membership.');
      // A shaped goal can contain a rollup against the entire owner store. Raw allowed memory
      // supplies its authored facts; an unscoped computed current never enters this prompt.
      const rawGoal = readRecord(goal.path);
      const goalData = { ...rawGoal.data };
      if (goal.computed) delete goalData.current;
      const projectMatch = row => String(row.project || '') === config.project && String(row.universe || 'local') === universe &&
        (bounds.finance || !isProtectedFinance(row, row.path));
      const projectRow = (row, collectionId) => {
        const collection = getCollection(collectionId);
        if (!collection || !bounds.collections.read.includes(collectionId) || !projectMatch(row) ||
          (!bounds.finance && isProtectedFinance(row, row.path, collection))) return null;
        const doc = { path: row.path, data: row, content: row.body || '' };
        if (identity && !workerCanReadDocument(doc, collection)) return null;
        const projected = projectWorkerDocument(doc, collection, bounds);
        return { ...projected.data, path: projected.path, body: projected.content };
      };
      const visibleWork = work.map(row => projectRow(row, 'work')).filter(Boolean);
      const visibleArtifacts = artifacts.map(row => projectRow(row, 'artifact')).filter(Boolean);
      const visiblePaths = new Set(visibleArtifacts.map(row => row.path));
      const artifactByPath = new Map(visibleArtifacts.map(row => [row.path, row]));
      // Older source briefs remain addressable after their body previews fall out of the
      // recent window. Authored evidence and human edits precede generated draft history.
      const humanActors = new Map();
      const wasEditedByHuman = actor => {
        if (!actor) return false;
        if (!humanActors.has(actor)) humanActors.set(actor, !isAgentActor(actor));
        return humanActors.get(actor);
      };
      const sourceIndex = visibleArtifacts.map((a, index) => ({ a, index,
        priority: (!a.source_task && !a.source_cycle) || wasEditedByHuman(a.updated_by) ? 0 : 1,
        updated: dayMs(a.updated || a.created) || 0,
      })).sort((a, b) => a.priority - b.priority || b.updated - a.updated || b.index - a.index)
        .slice(0, 128).map(({ a }) => ({ path: a.path, title: a.title, body_hash: hash(String(a.body)) }));
      // Queue task fields are explicit selected-project facts, not a global task directory.
      // Output bodies additionally need collection membership and an authorized source artifact.
      const visibleTasks = tasks.filter(t => projectMatch(t) && t.goal_id === config.goal_id && t.conductor_owned === true)
        .map(t => ({ ...t, output_path: visiblePaths.has(t.output_path) ? t.output_path : null,
          prepared_text: bounds.collections.read.includes('artifact') && (!t.output_path || visiblePaths.has(t.output_path))
            ? (t.output_path ? artifactByPath.get(t.output_path)?.body || '' : t.prepared_text) : '' }));
      const taskIds = new Set(visibleTasks.map(t => t.id));
      const visibleCards = cards.filter(p => p.project === config.project &&
        (p.goal_id === config.goal_id || taskIds.has(p.task)) &&
        (!p.universe || String(p.universe) === universe) && (bounds.finance || !isProtectedFinance(p, p.path)))
        .slice(-12).map(p => ({ id: p.id, kind: p.kind, status: p.status, title: p.title, question: p.question, answer: p.answer, reason: p.reason }));
      const human = messages.filter(m => m.role === 'user' && m.meta?.project === config.project &&
        m.meta?.goal_id === config.goal_id && (!m.meta?.universe || m.meta.universe === universe) &&
        (bounds.finance || !isProtectedFinance(m.meta || {}, ''))).slice(-12).map(m => String(m.text || m.content || '').slice(0, 1500));
      const cache = identity ? renderCache({ project: config.project, now }).text :
        'Only the selected goal, supplied project artifacts and assigned task facts below are available. No owner-wide memory is supplied.';
      const input = {
        goal: { id: goal.id, label: rawGoal.data.label || goal.label, body: String(rawGoal.content || '').slice(0, 8000),
          current: goal.computed ? null : goal.current, target: goal.target, unit: goal.unit, data: goalData },
        project: config.project, universe, memory: cache,
        agents: config.agents.map(id => getAssistant(id)).filter(a => a &&
          (!a.project || a.project === config.project) && (!a.universe || a.universe === universe) &&
          (bounds.finance || !isProtectedFinance(a, a.path))).map(a => ({ id: a.id, name: a.name,
          job: String(a.job || '').slice(0, 4000), capabilities: a.capabilities || [], enabled: a.worker_enabled === true })),
        work: visibleWork.slice(-24).map(w => ({ id: w.id, title: w.title, status: w.status, not_before: w.not_before, day: w.day,
          result: w.result, result_note: w.result_note, done_when: w.done_when, updated_by: w.updated_by, readiness: workReadiness(w, visibleWork, localDay(now)),
          body: String(w.body).slice(0, 1200), artifacts: (w.artifacts || []).filter(a => visiblePaths.has(typeof a === 'string' ? a : a.path)) })),
        tasks: visibleTasks.slice(-30).map(t => ({ id: t.id, title: t.title, status: t.status, worker: t.worker_id, depends_on: t.depends_on || [],
          output_path: t.output_path, output: String(t.prepared_text || '').slice(0, 1500), question: t.question })),
        artifacts: visibleArtifacts.slice(-16).map(a => ({ path: a.path, title: a.title, assistant: a.assistant, updated_by: a.updated_by,
          body_hash: hash(String(a.body)), body: String(a.body).slice(0, 3000) })),
        artifact_sources: sourceIndex,
        human_messages: human, decisions: visibleCards,
      };
      const facts = { ...input, memory: String(cache).replace(/^.*(?:Generated|Rendered|Version|version|Built|built|as of).*$/gm, '') };
      return { input, fingerprint: hash(facts), goal, universe, validate, release };
    });
    if (!retainIdentity) release();
    return result;
  } catch (error) { release(); throw error; }
}
