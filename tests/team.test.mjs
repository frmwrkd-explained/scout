import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshRoot, req } from './helpers.mjs';
import { createProject } from '../backend/store.mjs';
import { saveGoal } from '../backend/memory.mjs';
import { getAssistant, saveAssistant, listAssistants } from '../backend/tasks.mjs';
import { setupTeam } from '../backend/team.mjs';
import { getWorkerPolicy } from '../backend/workerScope.mjs';
import { conductorStatus } from '../backend/conductor.mjs';
import { upsertRecord, readRecord } from '../backend/records.mjs';
import { publishTeamMessage, todaySessionId } from '../backend/today.mjs';
import { getSession } from '../backend/chat.mjs';
import { localDay } from '../backend/daytime.mjs';

function fixture() {
  freshRoot();
  const project = createProject({ name: 'Growth team' }).id;
  saveGoal('launch', { label: 'Find the setup friction', target: 3, current: 0, universe: 'unit/growth' });
  return { project, goal_id: 'launch' };
}

test('owner team setup creates real scoped specialists and preserves edited briefs on repeat', async () => {
  const input = fixture();
  const first = await setupTeam(input);
  assert.equal(first.agents.length, 4);
  assert.equal(listAssistants().length, 5);
  assert.equal(getAssistant(first.coordinator).worker_enabled, false);
  for (const id of first.agents) {
    const assistant = getAssistant(id), policy = getWorkerPolicy(id);
    assert.equal(assistant.parent, first.coordinator);
    assert.equal(assistant.provider, 'gpt');
    assert.equal(assistant.worker_mode, 'prepare');
    assert.deepEqual(policy.projects, [input.project]);
    assert.equal(policy.finance, false);
    assert.deepEqual(policy.collections.write, []);
    assert.ok(policy.memory.read.includes('goals/launch.md'));
  }
  saveAssistant(first.agents[0], { name: 'My researcher', job: 'Read the supplied interviews' });
  const second = await setupTeam(input);
  assert.deepEqual(second.agents, first.agents);
  assert.equal(getAssistant(second.agents[0]).name, 'My researcher');
  assert.equal(conductorStatus().enabled, true);
});

test('team setup validates the context and refuses an agent owner identity', async () => {
  const input = fixture();
  await assert.rejects(setupTeam({ ...input, goal_id: 'missing' }), /existing goal/);
  await assert.rejects(setupTeam({ ...input, project: 'missing' }), /existing project/);
  saveAssistant('rogue', { name: 'Rogue' });
  await assert.rejects(setupTeam({ ...input, actor: 'rogue' }), /local owner/);
  const response = await req('POST', '/api/conductor/team', { ...input, actor: 'rogue' });
  assert.equal(response.status, 403);
  assert.equal(listAssistants().length, 1);
  saveGoal('cashflow', { label: 'Improve cashflow', universe: 'unit/finance', finance: true });
  await assert.rejects(setupTeam({ ...input, goal_id: 'cashflow' }), /excludes finance/);
  assert.equal(listAssistants().length, 1);
  saveGoal('assigned', { label: 'Assigned goal', project: 'another-project' });
  await assert.rejects(setupTeam({ ...input, goal_id: 'assigned' }), /project assigned/);
  assert.equal(listAssistants().length, 1);
});

test('separate drafts with similar titles retain distinct task identities and contents', async () => {
  await setupTeam(fixture());
  const first = upsertRecord({ collection: 'artifact', id: 'draft-a', title: 'Beta invitation', status: 'draft', body: 'The initial invitation.' }, { actor: 'crystal' });
  const second = upsertRecord({ collection: 'artifact', id: 'draft-b', title: 'Beta invitation', status: 'draft', body: 'The revised invitation after review.' }, { actor: 'crystal' });
  assert.notEqual(first.path, second.path);
  assert.match(readRecord(first.path).content, /initial invitation/);
  assert.match(readRecord(second.path).content, /revised invitation/);
});

test('named specialist outputs stay embedded and deduplicated in the continuing daily conversation', () => {
  fixture();
  const options = { key: 'result-first', assistant: 'Pen · Writer',
    artifacts: [{ path: 'data/artifacts/draft-a.md', title: 'Sample invoice quick start', assistant: 'Pen · Writer' }] };
  publishTeamMessage('The first draft is ready. Check the optional tax ID step.', options);
  publishTeamMessage('The first draft is ready. Check the optional tax ID step.', options);
  const messages = getSession(todaySessionId(localDay())).messages;
  const output = messages.filter(m => m.meta?.key === options.key);
  assert.equal(output.length, 1);
  assert.equal(output[0].meta.assistant, 'Pen · Writer');
  assert.equal(output[0].meta.artifacts[0].title, 'Sample invoice quick start');
});
