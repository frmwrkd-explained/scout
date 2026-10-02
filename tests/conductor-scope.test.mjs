import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, seedProject } from './helpers.mjs';
import { saveSettings } from '../backend/store.mjs';
import { saveGoal, getGoal } from '../backend/memory.mjs';
import { setupTeam } from '../backend/team.mjs';
import { saveWorkerPolicy, getWorkerPolicy } from '../backend/workerScope.mjs';
import { upsertRecord, readRecord } from '../backend/records.mjs';
import { saveTask, listTasks, getAssistant } from '../backend/tasks.mjs';
import { workersSettled } from '../backend/workers.mjs';
import { wakeConductor, conductorSettled, conductorStatus } from '../backend/conductor.mjs';
import { projectConductorContext } from '../backend/conductorContext.mjs';

async function seed(universe = 'local', body = 'Use the supplied setup evidence.') {
  freshRoot(); seedProject('growth');
  saveSettings({ autoRun: false, workerSchedulerEnabled: false, brainDailyLimits: { light: 40, heavy: 0 } });
  saveGoal('launch', { label: 'Improve setup', universe, current: 0, target: 3, body });
  const team = await setupTeam({ goal_id: 'launch', project: 'growth' });
  return { team, roles: Object.fromEntries(team.agents.map(id => [getAssistant(id).role, id])) };
}
const answer = { ok: true, text: JSON.stringify({ summary: 'Await the real setup decision.', tasks: [] }) };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };

test('coordinator collection narrowing excludes artifact material from every prompt source', async () => {
  const { team } = await seed();
  const artifact = upsertRecord({ collection: 'artifact', id: 'denied-source', title: 'Private draft',
    project: 'growth', universe: 'local', goal_id: 'launch', body: 'DENIED_ARTIFACT_BODY_129' }, { actor: 'crystal' });
  saveTask('growth', 'denied-task-output', { status: 'done', goal_id: 'launch', universe: 'local', conductor_owned: true,
    title: 'Private source task', prepared_text: 'DENIED_TASK_OUTPUT_491', output_path: artifact.path, prep_state: 'draft', review_required: false }, { actor: 'crystal' });
  const policy = getWorkerPolicy(team.coordinator);
  saveWorkerPolicy(team.coordinator, { ...policy, collections: { read: ['work'], write: [] } });
  let prompt;
  wakeConductor({ force: true, deps: { think: async request => { prompt = request.prompt; return answer; } } });
  await conductorSettled();
  assert.ok(prompt);
  assert.doesNotMatch(prompt, /DENIED_ARTIFACT_BODY_129|DENIED_TASK_OUTPUT_491/);
  assert.match(prompt, /Improve setup/);
});

test('finance and absent goal-memory membership reject planning before any provider sees the goal', async () => {
  for (const kind of ['finance', 'memory']) {
    const { team } = await seed('local', 'DENIED_GOAL_SECRET_816');
    const policy = getWorkerPolicy(team.coordinator);
    if (kind === 'memory') saveWorkerPolicy(team.coordinator, { ...policy, memory: { read: [], write: [] } });
    else {
      saveGoal('launch', { universe: 'unit/finance' });
      saveWorkerPolicy(team.coordinator, { ...policy, universes: ['unit/finance'], finance: false });
    }
    let calls = 0;
    wakeConductor({ force: true, deps: { think: async () => { calls++; return answer; } } });
    await conductorSettled();
    assert.equal(calls, 0);
    assert.equal(conductorStatus().state, 'cooldown');
    assert.match(conductorStatus().reason, /membership/);
  }
});

test('membership changes during an actual coordinator call discard the answer before creating tasks', async () => {
  const { team, roles } = await seed();
  const gate = deferred();
  let reached = false;
  wakeConductor({ force: true, deps: { think: async () => { reached = true; return gate.promise; } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reached, true);
  saveWorkerPolicy(team.coordinator, { ...getWorkerPolicy(team.coordinator), memory: { read: [], write: [] } });
  gate.resolve({ ok: true, text: JSON.stringify({ summary: 'Stale plan', tasks: [{ key: 'stale', assistant: roles.writer,
    title: 'Should never be queued', instructions: 'This answer belongs to the former membership.', requires: ['draft'] }] }) });
  await conductorSettled();
  assert.equal(listTasks({ project: 'growth' }).length, 0);
  assert.equal(conductorStatus().state, 'cooldown');
});

test('derived goal counts and classified decisions cannot bypass a scoped snapshot', async () => {
  const { team } = await seed();
  saveGoal('launch', { count: { tag: 'artifact' } });
  const hidden = upsertRecord({ collection: 'artifact', id: 'private-finance', title: 'Financial draft', project: 'growth',
    universe: 'unit/finance', goal_id: 'launch', body: 'FINANCE_BODY_708' }, { actor: 'crystal' });
  const config = { coordinator: team.coordinator, goal_id: 'launch', project: 'growth', agents: team.agents };
  const raw = readRecord(hidden.path);
  const snapshot = projectConductorContext({ config, goal: getGoal('launch'), work: [], tasks: [],
    artifacts: [{ ...raw.data, path: raw.path, body: raw.content }], messages: [{ role: 'user', text: 'FINANCE_CHAT_735', meta: { universe: 'unit/finance' } }],
    cards: [{ id: 'financial-answer', project: 'growth', goal_id: 'launch', universe: 'unit/finance', answer: 'FINANCE_DECISION_731' }], now: Date.now() });
  assert.equal(snapshot.input.goal.current, null);
  assert.doesNotMatch(JSON.stringify(snapshot.input), /FINANCE_BODY_708|FINANCE_CHAT_735|FINANCE_DECISION_731/);
});

test('canonical edited drafts win over stale task copies and only the selected goal conversation is supplied', async () => {
  const { team, roles } = await seed();
  const artifact = upsertRecord({ collection: 'artifact', id: 'edited-draft', title: 'Actual edited draft',
    project: 'growth', universe: 'local', goal_id: 'launch', body: 'CANONICAL_HUMAN_EDIT_592' }, { actor: 'crystal' });
  const task = saveTask('growth', 'draft-task', { title: 'Saved draft', goal_id: 'launch', universe: 'local', conductor_owned: true,
    worker_id: roles.writer, status: 'done', output_path: artifact.path, prepared_text: 'STALE_WORKER_COPY_358' }, { actor: 'crystal' });
  const record = readRecord(artifact.path);
  const context = projectConductorContext({ config: { coordinator: team.coordinator, goal_id: 'launch', project: 'growth', agents: team.agents },
    goal: getGoal('launch'), work: [], tasks: [task], artifacts: [{ ...record.data, path: record.path, body: record.content }], cards: [], now: Date.now(),
    messages: [
      { role: 'user', text: 'UNSCOPED_OLD_CHAT_483' },
      { role: 'user', text: 'OTHER_GOAL_CHAT_708', meta: { project: 'growth', goal_id: 'other' } },
      { role: 'user', text: 'SELECTED_GOAL_CORRECTION_148', meta: { project: 'growth', goal_id: 'launch' } },
    ] });
  assert.match(context.input.tasks[0].output, /CANONICAL_HUMAN_EDIT_592/);
  assert.doesNotMatch(JSON.stringify(context.input), /STALE_WORKER_COPY_358|UNSCOPED_OLD_CHAT_483|OTHER_GOAL_CHAT_708/);
  assert.deepEqual(context.input.human_messages, ['SELECTED_GOAL_CORRECTION_148']);
});

test('a prior model summary cannot reintroduce material after its collection is removed from membership', async () => {
  const { team } = await seed();
  upsertRecord({ collection: 'artifact', id: 'formerly-allowed', title: 'Prior research', project: 'growth', universe: 'local',
    goal_id: 'launch', body: 'PRIVATE_HISTORY_SECRET_189' }, { actor: 'crystal' });
  const prompts = [];
  const deps = { think: async request => {
    prompts.push(request.prompt);
    return { ok: true, text: JSON.stringify({ summary: prompts.length === 1 ? 'Prior research says PRIVATE_HISTORY_SECRET_189.' : 'Wait for your decision.', tasks: [] }) };
  } };
  wakeConductor({ force: true, deps }); await conductorSettled();
  assert.match(prompts[0], /PRIVATE_HISTORY_SECRET_189/);
  saveWorkerPolicy(team.coordinator, { ...getWorkerPolicy(team.coordinator), collections: { read: ['work'], write: [] } });
  wakeConductor({ force: true, deps }); await conductorSettled();
  assert.equal(prompts.length, 2);
  assert.doesNotMatch(prompts[1], /PRIVATE_HISTORY_SECRET_189/);
});

test('older permitted sources stay usable beyond body previews and denied sources stay absent', async () => {
  const { team, roles } = await seed();
  const source = upsertRecord({ collection: 'artifact', id: 'a-foundational-brief', title: 'Foundational beta brief',
    project: 'growth', universe: 'local', goal_id: 'launch', body: 'FOUNDATIONAL_SOURCE_BODY_319' }, { actor: 'crystal' });
  for (let n = 0; n < 20; n++) upsertRecord({ collection: 'artifact', id: 'z-generated-' + String(n).padStart(3, '0'), title: 'Generated history ' + n,
    source_task: 'older-task-' + n, project: 'growth', universe: 'local', goal_id: 'launch', body: 'Generated draft ' + n }, { actor: 'conductor' });
  const denied = upsertRecord({ collection: 'artifact', id: 'private-finance-index', title: 'Denied finance index title',
    project: 'growth', universe: 'unit/finance', goal_id: 'launch', body: 'DENIED_FINANCE_INDEX_951' }, { actor: 'crystal' });
  let context, workerPrompt;
  wakeConductor({ force: true, deps: {
    think: async request => {
      context = JSON.parse(request.prompt.split('CURRENT CANONICAL CONTEXT\n\n')[1].split('\n\nPREVIOUS TEAM ROUNDS')[0]);
      return { ok: true, text: JSON.stringify({ summary: 'Revise using the foundational brief.', tasks: [{ key: 'source-index-draft', assistant: roles.writer,
        title: 'Draft from the foundational brief', instructions: 'Use the foundational source to revise setup copy.', requires: ['draft'],
        source_artifacts: [source.path], review_required: false }] }) };
    }, workerThink: async request => { workerPrompt = request.prompt; return { ok: true, text: 'Prepared revision from actual evidence.', provider: 'stub' }; },
  } });
  await conductorSettled(); await workersSettled(); await conductorSettled();
  assert.ok(context.artifact_sources.some(a => a.path === source.path));
  assert.ok(!context.artifacts.some(a => a.path === source.path));
  assert.ok(context.artifact_sources.every(a => !('body' in a)));
  assert.ok(context.artifact_sources.every(a => a.path !== denied.path && /^[a-f0-9]{64}$/.test(a.body_hash)));
  const task = listTasks({ project: 'growth' }).find(t => t.title === 'Draft from the foundational brief');
  assert.equal(task.status, 'done');
  assert.equal(task.source_hashes[source.path], context.artifact_sources.find(a => a.path === source.path).body_hash);
  assert.match(workerPrompt, /FOUNDATIONAL_SOURCE_BODY_319/);
  assert.doesNotMatch(workerPrompt, /DENIED_FINANCE_INDEX_951/);
});

test('the bounded source index preserves authored evidence and human edits ahead of generated history', async () => {
  const { team } = await seed();
  const artifacts = Array.from({ length: 132 }, (_, n) => ({ path: 'data/artifacts/generated-' + n + '.md', title: 'History ' + n,
    project: 'growth', universe: 'local', goal_id: 'launch', source_task: 'task-' + n, updated_by: 'conductor', body: 'Generated ' + n }));
  artifacts.unshift({ path: 'data/artifacts/authored.md', title: 'Original evidence', project: 'growth', universe: 'local', goal_id: 'launch', body: 'Evidence' });
  artifacts.splice(1, 0, { path: 'data/artifacts/edited.md', title: 'Human correction', project: 'growth', universe: 'local', goal_id: 'launch',
    source_task: 'old-task', updated_by: 'crystal', body: 'Human edit' });
  const context = projectConductorContext({ config: { coordinator: team.coordinator, goal_id: 'launch', project: 'growth', agents: team.agents },
    goal: getGoal('launch'), work: [], tasks: [], artifacts, cards: [], messages: [], now: Date.now() });
  assert.equal(context.input.artifact_sources.length, 128);
  assert.deepEqual(new Set(context.input.artifact_sources.slice(0, 2).map(a => a.path)), new Set(['data/artifacts/authored.md', 'data/artifacts/edited.md']));
  assert.equal(context.input.artifacts.length, 16);
});
