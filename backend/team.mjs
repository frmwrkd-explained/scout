// Owner-created teams reuse the existing assistant registry and scoped worker queue.
import { createHash } from 'node:crypto';
import { listProjects } from './store.mjs';
import { getGoal } from './memory.mjs';
import { isAgentActor, DEFAULT_ACTOR } from './actors.mjs';
import { getAssistant, saveAssistant } from './tasks.mjs';
import { currentWorkerIdentity, saveWorkerPolicy, getWorkerPolicy, isProtectedFinance } from './workerScope.mjs';
import { ensureWorkCollections, workItems } from './today.mjs';
import { patchRecord } from './records.mjs';
import { configureConductor, conductorStatus, ensureArtifactCollection } from './conductor.mjs';

export const TEAM_ROLES = [
  { role: 'researcher', name: 'Scout · Research', capabilities: ['research'], job: 'Investigate the available evidence, identify unknowns and prepare concrete recommendations. Label assumptions. Never invent research or observed customer outcomes.' },
  { role: 'writer', name: 'Pen · Writer', capabilities: ['draft', 'writing'], job: 'Produce useful drafts and implementation material from the brief and prior team outputs. Incorporate human corrections and make the next review easy.' },
  { role: 'reviewer', name: 'Check · Reviewer', capabilities: ['review'], job: 'Review the team’s actual output against the goal and human constraints. Name concrete defects, propose revisions and distinguish evidence from assumptions.' },
  { role: 'analyst', name: 'Signal · Analyst', capabilities: ['analysis', 'measure'], job: 'Interpret supplied results, design practical measurement, and recommend the next experiment. Missing evidence stays missing; a draft never counts as a customer result.' },
];

export async function setupTeam({ goal_id, project, actor = DEFAULT_ACTOR } = {}) {
  if (currentWorkerIdentity() || isAgentActor(actor)) {
    throw Object.assign(new Error('Only the local owner sets up a team'), { status: 403 });
  }
  const goal = getGoal(goal_id);
  if (!goal) throw Object.assign(new Error('Select an existing goal for this team'), { status: 400 });
  if (isProtectedFinance(goal.data, goal.path)) {
    throw Object.assign(new Error('This default team excludes finance. Configure explicit financial membership before coordinating a finance goal.'), { status: 403 });
  }
  if (goal.data?.project && goal.data.project !== project) {
    throw Object.assign(new Error('Select the project assigned to this goal'), { status: 400 });
  }
  if (!listProjects().some(p => p.id === project)) {
    throw Object.assign(new Error('Select an existing project for this team'), { status: 400 });
  }
  ensureWorkCollections();
  ensureArtifactCollection();
  // A goal may predate teams. The owner's goal/project selection supplies missing membership,
  // while explicitly assigned work keeps its original project and universe.
  for (const work of workItems().filter(w => w.goal_id === goal.id && (!w.project || w.project === project))) {
    const patch = { ...(!work.project ? { project } : {}), ...(!work.universe ? { universe: goal.data?.universe || 'local' } : {}) };
    if (Object.keys(patch).length) await patchRecord(work.path, patch, { actor });
  }
  const prefix = 'team-' + createHash('sha256').update(project + '\0' + goal.id).digest('hex').slice(0, 8);
  const coordinator = prefix + '-conductor';
  if (!getAssistant(coordinator)) saveAssistant(coordinator, {
    name: 'Mira · Conductor', job: 'Keep the goal moving: brief specialists, review their outputs, offer the next useful human decision, and adapt to evidence.',
    project, goal_id: goal.id, provider: 'gpt', model: 'gpt-6-luna', role: 'conductor',
    worker_enabled: false, schedule: 'manual', status: 'idle',
    body: 'This assistant coordinates Scout’s durable goal loop. It runs through the text-only conductor, not an unrestricted CLI session.\n',
  }, { actor });
  if (!getWorkerPolicy(coordinator)) saveWorkerPolicy(coordinator, {
    enabled: true, universes: [goal.data?.universe || 'local'], projects: [project],
    collections: { read: ['work', 'artifact'], write: [] },
    memory: { read: ['me.md', 'goals/' + goal.id + '.md'], write: [] }, finance: false,
  }, { actor });
  const agents = TEAM_ROLES.map(role => {
    const id = prefix + '-' + role.role;
    // Reopening setup preserves edited briefs, names, memberships and provider choices.
    if (!getAssistant(id)) {
      saveAssistant(id, { ...role, project, goal_id: goal.id, parent: coordinator,
        provider: 'gpt', model: 'gpt-6-luna', worker_enabled: true, worker_mode: 'prepare',
        schedule: 'manual', status: 'idle', body: role.job + '\n' }, { actor });
      saveWorkerPolicy(id, { enabled: true, universes: [goal.data?.universe || 'local'], projects: [project],
        collections: { read: ['work', 'artifact'], write: [] },
        memory: { read: ['me.md', 'goals/' + goal.id + '.md'], write: [] }, finance: false }, { actor });
    }
    return id;
  });
  configureConductor({ enabled: true, goal_id: goal.id, project, agents, coordinator }, { actor });
  return { ok: true, coordinator, agents, status: conductorStatus() };
}
