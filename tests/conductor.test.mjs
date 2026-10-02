import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { freshRoot, seedProject, req } from './helpers.mjs';
import { getStorageRoot, saveSettings, writeMd, readMd, setStorageRoot } from '../backend/store.mjs';
import { saveGoal, getGoal } from '../backend/memory.mjs';
import { setupTeam } from '../backend/team.mjs';
import { conductorStatus, configureConductor, wakeConductor, conductorSettled, pauseConductor } from '../backend/conductor.mjs';
import { getAssistant, listTasks, getTask, saveTask } from '../backend/tasks.mjs';
import { workersSettled } from '../backend/workers.mjs';
import { upsertRecord, patchRecord, readRecord } from '../backend/records.mjs';
import { workItems, ensureTodaySession, ensurePlanned } from '../backend/today.mjs';
import { recordManualTurn } from '../backend/chat.mjs';
import { localDay, dayStartMs, addDays } from '../backend/daytime.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const answer = plan => ({ ok: true, provider: 'stub', model: 'test-light', text: JSON.stringify(plan) });
async function seed() {
  const root = freshRoot(); seedProject('growth');
  saveSettings({ autoRun: false, workerSchedulerEnabled: false, workerMaxConcurrent: 2,
    brainDailyLimits: { light: 40, heavy: 5 }, workerLeaseMinutes: 1, workerRetryMinutes: 1 });
  saveGoal('launch', { label: 'Make the first setup useful', current: 0, target: 3, universe: 'unit/growth',
    body: 'Get three useful beta replies and improve first-run setup. While replies are pending, work on the supplied setup evidence.' });
  await ensurePlanned();
  const team = await setupTeam({ goal_id: 'launch', project: 'growth' });
  const roles = Object.fromEntries(team.agents.map(id => [getAssistant(id).role, id]));
  const supplied = upsertRecord({ collection: 'artifact', id: 'first-run-brief', title: 'Setup evidence',
    project: 'growth', universe: 'unit/growth', goal_id: 'launch', status: 'draft',
    body: 'SUPPLIED_EVIDENCE: The optional tax ID field currently appears required. These are synthetic usability notes, not customer interviews.' }, { actor: 'crystal' });
  upsertRecord({ collection: 'artifact', id: 'private-other', title: 'Other project secret', project: 'elsewhere', universe: 'finance', body: 'PRIVATE_OTHER_971' }, { actor: 'crystal' });
  return { root, team, roles, supplied };
}
function chain(roles) {
  return { summary: 'Research the setup friction, draft a revision, then check the actual revision.', tasks: [
    { key: 'friction', assistant: roles.researcher, title: 'Identify one setup friction', instructions: 'Use the supplied synthetic notes. Explain the optional tax ID confusion.', requires: ['research'], review_required: false },
    { key: 'revision', assistant: roles.writer, title: 'Draft the simpler first setup', instructions: 'Use the upstream diagnosis to draft optional tax ID copy and an example invoice.', requires: ['draft'], depends_on: ['friction'], review_required: false },
    { key: 'check', assistant: roles.reviewer, title: 'Check the first setup draft', instructions: 'Check the actual upstream draft against the research. Provide concrete corrections and label synthetic evidence.', requires: ['review'], depends_on: ['friction', 'revision'], review_title: 'Pick one setup friction to fix', review_instructions: 'Read the checked draft and choose whether the optional tax ID correction is the first fix.' },
  ] };
}
async function drain() {
  for (let i = 0; i < 10; i++) {
    await conductorSettled(); await workersSettled(); await conductorSettled();
    if (!listTasks({ project: 'growth' }).some(t => t.status === 'claimed')) return;
  }
  assert.fail('team did not drain its bounded specialist packet');
}

test('the continuous team routes a real dependency packet, stores drafts once and advances a human review', async () => {
  const { roles, supplied, team } = await seed();
  const research = deferred(), prompts = [], plans = [];
  const deps = {
    think: async input => { plans.push(input.prompt); return answer(plans.length === 1 ? chain(roles) : { summary: 'The checked draft is ready for your decision.', tasks: [], waiting_reason: 'Waiting for the reviewed first setup decision.' }); },
    workerThink: async input => {
      prompts.push(input.prompt);
      if (input.prompt.includes('Your job: Investigate')) return research.promise;
      if (input.prompt.includes('Your job: Produce')) return { ok: true, text: 'WRITER_ACTUAL: Tax ID (optional). Start with a sample invoice.', provider: 'stub' };
      return { ok: true, text: 'REVIEW_ACTUAL: The draft now labels tax ID optional. Add an explicit skip link. Evidence is synthetic.', provider: 'stub' };
    },
  };
  assert.equal(wakeConductor({ reason: 'manual', force: true, deps }).started, true);
  await conductorSettled();
  const first = listTasks({ project: 'growth' });
  assert.equal(first.length, 3);
  assert.equal(first.filter(t => t.status === 'claimed').length, 1);
  assert.equal(first.find(t => t.worker_id === roles.writer).status, 'open');
  assert.match(plans[0], /SUPPLIED_EVIDENCE/);
  assert.doesNotMatch(plans[0], /PRIVATE_OTHER_971/);
  research.resolve({ ok: true, text: 'RESEARCH_ACTUAL: Optional tax ID is mistaken for a prerequisite. Start with a sample invoice.', provider: 'stub' });
  await drain();
  const tasks = listTasks({ project: 'growth' });
  assert.ok(tasks.every(t => t.status === 'done' && t.output_path));
  assert.match(prompts.find(p => p.includes('Your job: Produce')), /RESEARCH_ACTUAL/);
  assert.match(prompts.find(p => p.includes('Your job: Review')), /WRITER_ACTUAL/);
  const status = conductorStatus();
  assert.equal(status.goal_label, 'Make the first setup useful');
  assert.equal(status.coordinator, team.coordinator);
  assert.equal(status.recent_outputs.length, 3);
  assert.equal(workItems().filter(w => w.conductor_review).length, 1);
  assert.equal(workItems().find(w => w.conductor_review).status, 'now');
  const review = workItems().find(w => w.conductor_review), writer = tasks.find(t => t.worker_id === roles.writer), check = tasks.find(t => t.worker_id === roles.reviewer);
  assert.ok(review.artifacts.some(a => a.path === writer.output_path), 'human review must contain the actual draft');
  assert.ok(review.artifacts.some(a => a.path === check.output_path), 'human review must also contain the check');
  assert.match(readRecord(tasks.find(t => t.worker_id === roles.writer).output_path).content, /WRITER_ACTUAL/);
  assert.equal(getGoal('launch').current, 0);
  const count = fs.readdirSync(path.join(getStorageRoot(), 'data', 'artifacts')).length;
  await patchRecord(review.path, { artifacts: [{ path: check.output_path, title: check.title, assistant: roles.reviewer }],
    review_generated_paths: [], body: 'HUMAN_BODY_KEEP', result_note: 'HUMAN_NOTE_KEEP', done_when: 'Keep this human review criterion.' }, { actor: 'crystal' });
  const editedReview = readRecord(review.path);
  wakeConductor({ reason: 'manual', force: true, deps }); await drain();
  assert.equal(fs.readdirSync(path.join(getStorageRoot(), 'data', 'artifacts')).length, count);
  assert.equal(workItems().filter(w => w.conductor_review).length, 1);
  const repaired = readRecord(review.path);
  assert.ok(repaired.data.artifacts.some(a => a.path === writer.output_path), 'existing checked-only review is backfilled');
  assert.equal(repaired.content, editedReview.content);
  assert.equal(repaired.data.result_note, 'HUMAN_NOTE_KEEP');
  assert.equal(repaired.data.done_when, 'Keep this human review criterion.');
  assert.ok(readRecord(supplied.path).content.includes('SUPPLIED_EVIDENCE'));
});

test('a specific human correction drives a new specialist iteration immediately despite normal cadence', async () => {
  const { roles } = await seed();
  configureConductor({ min_cycle_minutes: 60 });
  let calls = 0, lastPrompt = '';
  const deps = {
    think: async input => {
      calls++; lastPrompt = input.prompt;
      return answer(calls === 1 ? { summary: 'A copy draft is ready.', tasks: [{ key: 'copy', assistant: roles.writer, title: 'Draft optional field copy', instructions: 'Tax ID should be optional. Make a clear first draft.', requires: ['draft'] }] }
        : { summary: 'Pen is revising the actual copy to make the skip action explicit.', tasks: [{ key: 'copy-v2', assistant: roles.writer, title: 'Revise with explicit Skip tax ID', instructions: 'The human correction is: EXPLICIT_SKIP_CORRECTION. Add a visible Skip tax ID link and keep the sample invoice.', requires: ['draft'] }] });
    }, workerThink: async () => ({ ok: true, text: 'Prepared copy for human review.', provider: 'stub' }),
  };
  wakeConductor({ force: true, deps }); await drain();
  const item = workItems().find(w => w.conductor_review);
  const session = ensureTodaySession(localDay());
  recordManualTurn(session.id, { userText: 'EXPLICIT_SKIP_CORRECTION: make the skip action explicit; keep the sample invoice.', assistantText: 'Recorded for the next revision.', directive: { type: 'generation', ref: 'test-only' } });
  const completed = await req('POST', '/api/today/done', { id: item.id, actor: 'crystal', result: 0, result_note: 'EXPLICIT_SKIP_CORRECTION: a skip link is needed.' });
  assert.equal(completed.status, 200);
  await drain();
  assert.equal(calls, 2);
  assert.match(lastPrompt, /EXPLICIT_SKIP_CORRECTION/);
  assert.equal(listTasks({ project: 'growth' }).length, 2);
  assert.equal(getGoal('launch').current, 0);
});

test('pause invalidates an in-flight coordinator answer and scheduler wakes stay inert', async () => {
  await seed(); const gate = deferred();
  let calls = 0;
  wakeConductor({ force: true, deps: { think: () => { calls++; return gate.promise; } } });
  // Let the asynchronous canonical context read reach the model before pausing.
  await new Promise(resolve => setImmediate(resolve));
  pauseConductor({ reason: 'Owner paused the team' });
  assert.throws(() => pauseConductor({ actor: 'conductor' }), e => e.status === 403);
  gate.resolve(answer({ summary: 'This answer is stale.', tasks: [] }));
  await conductorSettled();
  assert.equal(conductorStatus().state, 'paused');
  assert.equal(conductorStatus().summary, 'Owner paused the team');
  assert.equal(wakeConductor({ reason: 'scheduler', now: Date.now() + 86400000 }).started, false);
  assert.equal(calls, 1);
  assert.equal(listTasks({ project: 'growth' }).length, 0);
});

test('invalid task DAGs apply nothing and provider failures have a durable cooldown', async () => {
  const { roles } = await seed();
  let calls = 0;
  const deps = { think: async () => { calls++; return answer({ summary: 'Invalid cycle.', tasks: [
    { key: 'a', assistant: roles.writer, title: 'A', instructions: 'Draft A', requires: ['draft'], depends_on: ['b'] },
    { key: 'b', assistant: roles.writer, title: 'B', instructions: 'Draft B', requires: ['draft'], depends_on: ['a'] },
  ] }); } };
  wakeConductor({ force: true, deps }); await conductorSettled();
  assert.equal(listTasks({ project: 'growth' }).length, 0);
  assert.equal(conductorStatus().state, 'cooldown');
  assert.match(conductorStatus().reason, /cycle/);
  assert.equal(wakeConductor({ force: true, deps }).started, false);
  assert.equal(calls, 1);
  assert.equal(getAssistant(conductorStatus().coordinator).status, 'blocked');
});

test('root switching during a model call discards the old answer in both workspaces', async () => {
  const { root } = await seed(), gate = deferred();
  wakeConductor({ force: true, deps: { think: () => gate.promise } });
  await new Promise(resolve => setImmediate(resolve));
  const replacement = freshRoot(); seedProject('growth');
  gate.resolve(answer({ summary: 'OLD_ROOT_RESPONSE', tasks: [] }));
  await conductorSettled();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fs.existsSync(path.join(replacement, '.scout', 'conductor', 'team.md')), false);
  assert.doesNotMatch(fs.readFileSync(path.join(root, '.scout', 'conductor', 'team.md'), 'utf8'), /OLD_ROOT_RESPONSE/);
  setStorageRoot(replacement);
});

test('daily coordinator attempts are bounded even when the owner repeatedly wakes the team', async () => {
  await seed(); configureConductor({ max_cycles_per_day: 1 });
  const evening = dayStartMs(localDay()) + 18 * 3600_000;
  const nextDay = addDays(localDay(evening), 1);
  let calls = 0;
  const deps = { think: async () => { calls++; return answer({ summary: 'Wait for a real reply.', tasks: [], waiting_reason: 'External replies are still pending.' }); } };
  wakeConductor({ force: true, deps, now: evening }); await conductorSettled();
  wakeConductor({ force: true, deps, now: evening }); await conductorSettled();
  assert.equal(calls, 1);
  assert.equal(conductorStatus().state, 'cooldown');
  assert.match(conductorStatus().reason, /budget/);
  assert.equal(conductorStatus().next_wake, new Date(dayStartMs(nextDay)).toISOString());
  assert.equal(wakeConductor({ reason: 'morning-open', force: true, deps,
    now: dayStartMs(nextDay) + 8.5 * 3600_000 }).started, true);
  await conductorSettled();
  assert.equal(calls, 2, 'yesterday’s exhausted limit must not block the next morning');
});

test('unreadable durable configuration fails closed instead of creating a fresh team', async () => {
  await seed();
  const file = path.join(getStorageRoot(), '.scout', 'conductor', 'team.md');
  writeMd(file, { enabled: true, agents: 'broken' }, 'Do not replace my corrupted configuration.');
  assert.throws(() => wakeConductor(), e => e.status === 409);
  assert.equal(readMd(file).data.agents, 'broken');
});

test('a disabled fresh workspace keeps Today operable and does not create a team', async () => {
  freshRoot(); seedProject('growth');
  assert.equal(conductorStatus().enabled, false);
  assert.equal(conductorStatus().coordinator_name, null);
  const today = await req('GET', '/api/today');
  assert.equal(today.status, 200);
  assert.equal(today.body.conductor.enabled, false);
  assert.equal(fs.existsSync(path.join(getStorageRoot(), '.scout', 'conductor', 'team.md')), false);
});

test('a restart respects a live durable lease and recovers an expired coordinator without duplicate drafts', async () => {
  await seed();
  const file = path.join(getStorageRoot(), '.scout', 'conductor', 'team.md');
  let control = readMd(file);
  const id = 'cycle-dead-backend', now = Date.now();
  writeMd(path.join(getStorageRoot(), '.scout', 'conductor', 'cycles', id + '.md'), {
    id, goal_id: 'launch', project: 'growth', state: 'thinking', created: new Date(now - 1000).toISOString(), plan_attempted: false,
  }, 'An interrupted round.');
  writeMd(file, { ...control.data, state: 'thinking', active_cycle: id, lease_expires_at: new Date(now + 1000).toISOString() }, control.content);
  assert.equal(wakeConductor({ reason: 'scheduler', now }).started, false);
  const deps = { think: async () => answer({ summary: 'Resume from saved goal evidence.', tasks: [] }) };
  assert.equal(wakeConductor({ reason: 'scheduler', now: now + 1001, deps }).started, true);
  await conductorSettled();
  assert.equal(readMd(path.join(getStorageRoot(), '.scout', 'conductor', 'cycles', id + '.md')).data.state, 'recovered');
  assert.equal(conductorStatus().state, 'waiting');
  assert.equal(listTasks({ project: 'growth' }).length, 0);
});

test('a future wake with unchanged facts creates no extra rounds, then a due wake reassesses once', async () => {
  await seed(); const now = Date.now(), due = now + 3 * 3600000;
  let calls = 0;
  const deps = { think: async () => { calls++; return answer({ summary: 'The external outcome is still pending.', tasks: [], waiting_reason: 'Wait for the dated follow-up.',
    ...(calls === 1 ? { wait_until: new Date(due).toISOString() } : {}) }); } };
  wakeConductor({ force: true, deps, now }); await conductorSettled();
  const first = conductorStatus().cycle;
  assert.equal(wakeConductor({ reason: 'scheduler', deps, now: now + 60000 }).started, false);
  assert.equal(conductorStatus().cycle, first);
  assert.equal(calls, 1);
  assert.equal(wakeConductor({ reason: 'scheduler', deps, now: due + 1 }).started, true);
  await conductorSettled();
  assert.equal(calls, 2);
});

test('checked revisions update the same open review packet without changing the human work or clock', async () => {
  const { roles } = await seed(), gate = deferred(), checkStarted = deferred();
  let calls = 0;
  const deps = {
    think: async () => {
      calls++;
      return answer(calls === 1 ? { summary: 'Try the actual guide and choose the first fix.', tasks: [
        { key: 'v1', assistant: roles.writer, title: 'Guide v1', instructions: 'Draft a sample invoice start.', requires: ['draft'], review_required: false },
        { key: 'check1', assistant: roles.reviewer, title: 'Check v1', instructions: 'Check the actual first draft.', requires: ['review'], depends_on: ['v1'], review_title: 'Review the actual guide' },
        { key: 'v2', assistant: roles.writer, title: 'Guide v2', instructions: 'Revise using the first check. Add a visible skip link.', requires: ['draft'], depends_on: ['check1'], review_required: false },
        { key: 'check2', assistant: roles.reviewer, title: 'Check v2', instructions: 'Check the revised guide and its skip link.', requires: ['review'], depends_on: ['v2'], review_title: 'Review the revised actual guide' },
      ] } : { summary: 'Your latest checked guide is attached.', tasks: [] });
    },
    workerThink: async input => {
      if (input.prompt.includes('"title":"Check v2"')) { checkStarted.resolve(); return gate.promise; }
      return { ok: true, text: input.prompt.includes('"title":"Guide v2"') ? 'LATEST_ACTUAL_GUIDE: Skip tax ID and start with an invoice.' : 'First draft or concrete check feedback.', provider: 'stub' };
    },
  };
  wakeConductor({ force: true, deps });
  await checkStarted.promise;
  const before = workItems().find(w => w.conductor_review);
  assert.equal(before.status, 'now');
  await patchRecord(before.path, { body: 'HUMAN_EDITED_REVIEW_BODY', result_note: 'Human note stays.', done_when: 'Human review criterion stays.' }, { actor: 'crystal' });
  const editedReview = readRecord(before.path);
  gate.resolve({ ok: true, text: 'LATEST_CHECK: The skip link is visible; check the actual revised guide.', provider: 'stub' });
  await drain();
  const after = workItems().filter(w => w.conductor_review);
  assert.equal(after.length, 1);
  assert.equal(after[0].id, before.id);
  assert.equal(after[0].status, 'now');
  const tasks = listTasks({ project: 'growth' }), writer = tasks.find(t => t.title === 'Guide v2'), check = tasks.find(t => t.title === 'Check v2');
  assert.ok(after[0].artifacts.some(a => a.path === writer.output_path));
  assert.ok(after[0].artifacts.some(a => a.path === check.output_path));
  assert.ok(!after[0].artifacts.some(a => a.path === tasks.find(t => t.title === 'Guide v1').output_path));
  const preserved = readRecord(after[0].path);
  assert.equal(preserved.content, editedReview.content);
  assert.equal(preserved.data.result_note, 'Human note stays.');
  assert.equal(preserved.data.done_when, 'Human review criterion stays.');
  // Re-reading old consumption receipts never downgrades that active packet again.
  wakeConductor({ force: true, deps }); await drain();
  assert.ok(workItems().find(w => w.id === before.id).artifacts.some(a => a.path === writer.output_path));
});

test('a completed or parked reused review is never resurrected by receipts, while a new revision can advance', async () => {
  for (const action of ['done', 'park']) {
    const { roles } = await seed();
    let mode = 'initial', latest;
    const deps = {
      think: async () => answer({ summary: 'Review the concrete checked revision.', tasks: mode === 'initial' ? [
        { key: 'first', assistant: roles.writer, title: 'First guide', instructions: 'Draft the sample guide.', requires: ['draft'], review_required: false },
        { key: 'first-check', assistant: roles.reviewer, title: 'Check first guide', instructions: 'Check the first guide.', requires: ['review'], depends_on: ['first'] },
        { key: 'second', assistant: roles.writer, title: 'Second guide', instructions: 'Revise using the first check.', requires: ['draft'], depends_on: ['first-check'], review_required: false },
        { key: 'second-check', assistant: roles.reviewer, title: 'Check second guide', instructions: 'Check the revised guide.', requires: ['review'], depends_on: ['second'] },
      ] : mode === 'next' ? [
        { key: 'new-after-human', assistant: roles.writer, title: 'New revision after human decision', instructions: 'Apply the new human label correction.', requires: ['draft'], depends_on: [latest], review_required: false },
        { key: 'new-check', assistant: roles.reviewer, title: 'Check the actual new human revision', instructions: 'Check the new label correction.', requires: ['review'], depends_on: ['new-after-human'] },
      ] : [] }), workerThink: async () => ({ ok: true, text: 'Concrete actual draft or check.', provider: 'stub' }),
    };
    wakeConductor({ force: true, deps }); await drain();
    const review = workItems().find(w => w.conductor_review), second = listTasks({ project: 'growth' }).find(t => t.title === 'Check second guide');
    assert.equal(workItems().filter(w => w.conductor_review).length, 1);
    assert.equal(review.review_latest_task, second.id);
    assert.notEqual(review.source_task, second.id, 'the current output reused an earlier packet path');
    latest = second.id; mode = 'hold';
    const closed = await req('POST', '/api/today/' + action, { id: review.id, actor: 'crystal', result: 0,
      result_note: 'HUMAN_HANDLED_THIS_OUTPUT: Next iteration should compare two short labels.' });
    assert.equal(closed.status, 200);
    await drain();
    const canonicalClosed = readRecord(review.path);
    wakeConductor({ force: true, deps }); await drain();
    const recovered = workItems().filter(w => w.conductor_review);
    assert.equal(recovered.length, 1, 'receipt recovery creates no new copy of the closed output');
    assert.equal(recovered[0].id, review.id);
    assert.equal(recovered[0].status, action === 'done' ? 'done' : 'parked');
    assert.equal(readRecord(review.path).rev, canonicalClosed.rev);
    assert.equal(getGoal('launch').current, 0);
    mode = 'next'; wakeConductor({ reason: 'human-correction', force: true, deps }); await drain();
    const next = workItems().filter(w => w.conductor_review);
    assert.equal(next.length, 2, 'an actual new task output still gets its next review');
    assert.equal(next.find(w => w.id === review.id).status, action === 'done' ? 'done' : 'parked');
    const active = next.find(w => w.status === 'now');
    assert.ok(active && active.id !== review.id);
    assert.equal(active.review_latest_task, listTasks({ project: 'growth' }).find(t => t.title === 'Check the actual new human revision').id);
  }
});

test('a human artifact edit arriving during thought invalidates the stale brief and immediately produces a new one', async () => {
  const { roles, supplied } = await seed(), gate = deferred(), firstStarted = deferred();
  let calls = 0, latest = '';
  const deps = {
    think: async input => {
      calls++; latest = input.prompt;
      if (calls === 1) { firstStarted.resolve(); return gate.promise; }
      return answer({ summary: 'Your updated setup evidence is in this draft.', tasks: [{ key: 'corrected', assistant: roles.writer,
        title: 'Draft after the actual human edit', instructions: 'Use LATEST_HUMAN_CORRECTION and keep the sample invoice.', requires: ['draft'] }] });
    }, workerThink: async () => ({ ok: true, text: 'Draft incorporates the latest supplied human correction.', provider: 'stub' }),
  };
  wakeConductor({ force: true, deps }); await firstStarted.promise;
  const old = readRecord(supplied.path);
  await patchRecord(supplied.path, { body: 'LATEST_HUMAN_CORRECTION: Skip tax ID explicitly before the sample invoice.' }, { actor: 'crystal', rev: old.rev });
  wakeConductor({ reason: 'human-correction', deps });
  gate.resolve(answer({ summary: 'An old answer.', tasks: [{ key: 'stale', assistant: roles.writer, title: 'STALE_BRIEF_MUST_NOT_EXIST', instructions: 'Use the earlier field assumptions.', requires: ['draft'] }] }));
  await drain();
  assert.equal(calls, 2);
  assert.match(latest, /LATEST_HUMAN_CORRECTION/);
  const tasks = listTasks({ project: 'growth' });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'Draft after the actual human edit');
});

test('independent analyst and writer packets keep distinct human reviews despite sharing a goal', async () => {
  const { roles } = await seed();
  const deps = {
    think: async () => answer({ summary: 'Review the guide and the independent experiment when each is ready.', tasks: [
      { key: 'guide', assistant: roles.writer, title: 'Local guide', instructions: 'Draft a clear first setup guide.', requires: ['draft'] },
      { key: 'measurement', assistant: roles.analyst, title: 'Independent feedback experiment', instructions: 'Prepare a measurement plan without inventing observations.', requires: ['analysis'] },
    ] }), workerThink: async () => ({ ok: true, text: 'Useful prepared material.', provider: 'stub' }),
  };
  wakeConductor({ force: true, deps }); await drain();
  const reviews = workItems().filter(w => w.conductor_review);
  assert.equal(reviews.length, 2);
  assert.equal(reviews.filter(w => w.status === 'now').length, 1);
  assert.equal(new Set(reviews.map(w => w.source_task)).size, 2);
});

test('a source-only revision refreshes the current draft lineage at the review cap without merging an independent analysis', async () => {
  const { roles, supplied } = await seed();
  let mode = 'first', sourcePath;
  const deps = {
    think: async () => answer({ summary: 'Read the actual checked guide and decide which fix to keep.', tasks:
      mode === 'first' ? [
        { key: 'original', assistant: roles.writer, title: 'Original guide', instructions: 'Draft a sample invoice guide.', requires: ['draft'], review_required: false },
        { key: 'check-original', assistant: roles.reviewer, title: 'Check original guide', instructions: 'Check the actual guide.', requires: ['review'], depends_on: ['original'] },
      ] : mode === 'analysis' ? [
        { key: 'measurement', assistant: roles.analyst, title: 'Independent measurement decision', instructions: 'Use the guide only as context for a separate experiment plan.',
          requires: ['analysis'], source_artifacts: [sourcePath] },
      ] : [
        { key: 'research-edit', assistant: roles.researcher, title: 'Research the saved correction', instructions: 'Inspect the saved human correction in ' + sourcePath + '.',
          requires: ['research'], source_artifacts: [sourcePath], review_required: false },
        { key: 'corrected', assistant: roles.writer, title: 'Corrected guide', instructions: 'Revise the guide using the actual research findings.',
          requires: ['draft'], depends_on: ['research-edit'], review_required: false },
        { key: 'check-corrected', assistant: roles.reviewer, title: 'Check corrected guide', instructions: 'Check the newly corrected guide.', requires: ['review'], depends_on: ['corrected'] },
      ] }),
    workerThink: async input => ({ ok: true, text: input.prompt.includes('"title":"Corrected guide"')
      ? 'NEW_ACTUAL_GUIDE: Skip tax ID before the sample invoice.' : 'Concrete supplied draft, research, analysis or check.', provider: 'stub' }),
  };
  wakeConductor({ force: true, deps }); await drain();
  const originalTasks = listTasks({ project: 'growth' }), oldWriter = originalTasks.find(t => t.title === 'Original guide');
  const oldCheck = originalTasks.find(t => t.title === 'Check original guide');
  sourcePath = oldWriter.output_path;
  const current = workItems().find(w => w.conductor_review);
  assert.equal(current.status, 'now');
  assert.equal(readRecord(sourcePath).data.source_task, oldWriter.id);
  // Reproduce an older duplicate still planned beside the current packet.
  const stale = upsertRecord({ collection: 'work', id: 'older-stale-review', title: 'Older guide review', tags: ['work'], status: 'planned',
    day: localDay(), bucket: 'admin', estimate_min: 10, project: 'growth', universe: 'unit/growth', goal_id: 'launch', conductor_review: true,
    source_task: oldCheck.id, review_latest_task: oldCheck.id, review_lineage: [oldCheck.id],
    artifacts: [{ path: sourcePath, title: 'Original guide' }], body: 'OLDER_REVIEW_BODY_STAYS', prep: false, prep_state: 'ready' }, { actor: 'crystal' });
  mode = 'analysis';
  wakeConductor({ force: true, deps }); await drain();
  const analysisReview = workItems().find(w => w.conductor_review && ![current.id, stale.id].includes(w.id));
  assert.ok(analysisReview, 'an analyst merely citing the guide keeps its own review');
  assert.equal(workItems().filter(w => w.conductor_review).length, 3);
  const analysisBefore = readRecord(analysisReview.path), staleBefore = readRecord(stale.path);
  await patchRecord(sourcePath, { body: 'HUMAN_CORRECTION: Put Skip tax ID before the sample invoice.' }, { actor: 'crystal' });
  await patchRecord(current.path, { body: 'HUMAN_BODY_MUST_STAY', result_note: 'Human decision notes stay.', done_when: 'Human criterion stays.',
    artifacts: [...current.artifacts, { path: supplied.path, title: 'Manually attached evidence' }] }, { actor: 'crystal' });
  const humanBefore = readRecord(current.path), clockBefore = (await req('GET', '/api/today')).body.now.clock;
  mode = 'correction';
  wakeConductor({ reason: 'human-correction', force: true, deps }); await drain();
  const tasks = listTasks({ project: 'growth' }), writer = tasks.find(t => t.title === 'Corrected guide'), check = tasks.find(t => t.title === 'Check corrected guide');
  assert.ok(writer && check);
  assert.ok(!check.depends_on.includes(oldCheck.id));
  assert.ok(!writer.depends_on.includes(oldCheck.id));
  const updated = readRecord(current.path), reviews = workItems().filter(w => w.conductor_review);
  assert.equal(reviews.length, 3, 'the full review queue does not drop or duplicate a related correction');
  assert.equal(updated.data.status, 'now');
  assert.equal(updated.data.review_latest_task, check.id);
  assert.ok(updated.data.artifacts.some(a => a.path === writer.output_path));
  assert.ok(updated.data.artifacts.some(a => a.path === check.output_path));
  assert.ok(updated.data.artifacts.some(a => a.path === supplied.path), 'manual references remain attached');
  assert.ok(!updated.data.artifacts.some(a => a.path === oldCheck.output_path));
  assert.equal(updated.content, humanBefore.content);
  assert.equal(updated.data.result_note, humanBefore.data.result_note);
  assert.equal(updated.data.done_when, humanBefore.data.done_when);
  assert.equal((await req('GET', '/api/today')).body.now.clock.started, clockBefore.started);
  for (const before of [analysisBefore, staleBefore]) {
    const after = readRecord(before.path);
    assert.equal(after.rev, before.rev);
    assert.equal(after.content, before.content);
    assert.deepEqual(after.data, before.data);
  }
  // Receipt recovery never rolls the current packet back to a prior check.
  wakeConductor({ force: true, deps }); await drain();
  assert.equal(readRecord(current.path).data.review_latest_task, check.id);
  assert.equal(workItems().filter(w => w.conductor_review).length, 3);
});

test('task identity binds the projected full source body and remains stable when that source is unchanged', async () => {
  const { roles, supplied } = await seed();
  const prefix = 'UNCHANGED_FIRST_3000_CHARACTERS. '.repeat(250);
  await patchRecord(supplied.path, { body: prefix + '\nORIGINAL_LONG_TAIL' }, { actor: 'crystal' });
  let workerCalls = 0;
  const deps = {
    think: async () => answer({ summary: 'Scout is inspecting the latest saved evidence.', tasks: [{ key: 'same-source', assistant: roles.researcher,
      title: 'Inspect the current source', instructions: 'Inspect the saved source and its latest correction.', requires: ['research'], review_required: false,
      source_artifacts: [supplied.path], source_hashes: { [supplied.path]: 'MODEL_FORGED_HASH_MUST_BE_IGNORED' } }] }),
    workerThink: async () => { workerCalls++; return { ok: true, text: 'A concrete diagnosis based on supplied evidence.', provider: 'stub' }; },
  };
  wakeConductor({ force: true, deps }); await drain();
  const first = listTasks({ project: 'growth' })[0];
  assert.notEqual(first.source_hashes[supplied.path], 'MODEL_FORGED_HASH_MUST_BE_IGNORED');
  wakeConductor({ force: true, deps }); await drain();
  assert.equal(listTasks({ project: 'growth' }).length, 1);
  assert.equal(workerCalls, 1);
  // Only the tail changes, beyond the coordinator's 3,000-character body preview.
  await patchRecord(supplied.path, { body: prefix + '\nLATEST_LONG_TAIL_CORRECTION' }, { actor: 'crystal' });
  wakeConductor({ reason: 'human-correction', deps }); await drain();
  const revised = listTasks({ project: 'growth' });
  assert.equal(revised.length, 2);
  assert.equal(workerCalls, 2);
  assert.notEqual(revised[1].id, first.id);
  assert.notEqual(revised[1].source_hashes[supplied.path], first.source_hashes[supplied.path]);
  wakeConductor({ force: true, deps }); await drain();
  assert.equal(listTasks({ project: 'growth' }).length, 2);
  assert.equal(workerCalls, 2);
});

test('a standalone human decision reuses the open writing packet while an analyst-only decision stays separate', async () => {
  const { roles } = await seed();
  let mode = 'first', guidePath, analysisPath;
  const deps = {
    think: async () => answer(mode === 'first' ? { summary: 'Try the checked guide.', tasks: [
      { key: 'guide', assistant: roles.writer, title: 'Current guide', instructions: 'Draft a sample-first guide.', requires: ['draft'], review_required: false },
      { key: 'check', assistant: roles.reviewer, title: 'Check current guide', instructions: 'Check the actual completed guide.', requires: ['review'], depends_on: ['guide'] },
    ] } : { summary: 'Your current checked guide is ready; decide the independent measurement separately.', tasks: [], human_tasks: [
      { key: 'another-guide-decision', title: 'Decide if the checked guide is ready', instructions: 'Review the guide and give the next correction.', artifact_paths: [guidePath, analysisPath] },
      { key: 'separate-analysis-decision', title: 'Choose the independent measurement', instructions: 'Choose a measurement without inventing observations.', artifact_paths: [analysisPath] },
    ] }), workerThink: async () => ({ ok: true, text: 'Actual useful draft or check.', provider: 'stub' }),
  };
  wakeConductor({ force: true, deps }); await drain();
  const current = workItems().find(w => w.conductor_review), writer = listTasks({ project: 'growth' }).find(t => t.worker_id === roles.writer);
  guidePath = writer.output_path;
  const analysis = upsertRecord({ collection: 'artifact', id: 'independent-analysis-material', title: 'Separate measurement evidence', project: 'growth', universe: 'unit/growth',
    goal_id: 'launch', source_task: 'independent-measurement', assistant: roles.analyst, status: 'draft', body: 'Separate local measurement proposal; no observations.' }, { actor: 'crystal' });
  analysisPath = analysis.path;
  saveTask('growth', 'independent-measurement', { title: 'Independent measurement', status: 'done', requires: ['analysis'], worker_id: roles.analyst,
    output_path: analysisPath, goal_id: 'launch', universe: 'unit/growth' });
  await patchRecord(current.path, { body: 'HUMAN_CURRENT_PACKET_NOTES', result_note: 'Keep the current decision.' }, { actor: 'crystal' });
  const before = readRecord(current.path);
  mode = 'human'; wakeConductor({ force: true, deps }); await drain();
  const reviews = workItems().filter(w => w.conductor_review), after = readRecord(current.path);
  assert.equal(reviews.length, 2);
  assert.equal(reviews.find(w => w.status === 'now').id, current.id);
  assert.equal(after.rev, before.rev);
  assert.equal(after.content, before.content);
  assert.deepEqual(after.data.artifacts, before.data.artifacts);
  assert.ok(reviews.some(w => w.title === 'Choose the independent measurement'));
  assert.ok(!reviews.some(w => w.title === 'Decide if the checked guide is ready'));
});

test('a human decision about a sibling revision reuses the checked packet sharing its canonical writer ancestor', async () => {
  const { roles } = await seed();
  let mode = 'origin', originPath, siblingPath;
  const deps = {
    think: async () => answer(mode === 'origin' ? { summary: 'Prepare the original guide.', tasks: [
      { key: 'origin', assistant: roles.writer, title: 'Origin guide', instructions: 'Draft a sample-first guide.', requires: ['draft'], review_required: false },
    ] } : mode === 'checked' ? { summary: 'Check the current guide revision.', tasks: [
      { key: 'current-sibling', assistant: roles.writer, title: 'Current sibling guide', instructions: 'Revise the saved original into a current sample-first guide.',
        source_artifacts: [originPath], requires: ['draft'], review_required: false },
      { key: 'current-check', assistant: roles.reviewer, title: 'Check current sibling', instructions: 'Check the newly completed guide.', requires: ['review'], depends_on: ['current-sibling'] },
    ] } : { summary: 'Your current checked guide is already ready for this decision.', tasks: [], human_tasks: [
      { key: 'older-sibling-decision', title: 'Decide whether the sibling guide is ready', instructions: 'Choose whether to try the guide locally.', artifact_paths: [siblingPath] },
    ] }), workerThink: async () => ({ ok: true, text: 'Concrete sample-first guide or check.', provider: 'stub' }),
  };
  wakeConductor({ force: true, deps }); await drain();
  originPath = listTasks({ project: 'growth' }).find(t => t.title === 'Origin guide').output_path;
  const sibling = upsertRecord({ collection: 'artifact', id: 'older-sibling-guide', title: 'Older sibling guide', project: 'growth', goal_id: 'launch', universe: 'unit/growth',
    source_task: 'older-sibling-writer', assistant: roles.writer, status: 'draft', body: 'An earlier sibling revision based on the same saved original.' }, { actor: 'crystal' });
  siblingPath = sibling.path;
  saveTask('growth', 'older-sibling-writer', { title: 'Older sibling writer task', status: 'done', worker_id: roles.writer, requires: ['draft'],
    goal_id: 'launch', universe: 'unit/growth', source_artifacts: [originPath], output_path: siblingPath });
  mode = 'checked'; wakeConductor({ force: true, deps }); await drain();
  const current = workItems().find(w => w.conductor_review), tasks = listTasks({ project: 'growth' });
  const writer = tasks.find(t => t.title === 'Current sibling guide'), check = tasks.find(t => t.title === 'Check current sibling');
  assert.equal(current.review_latest_task, check.id);
  assert.ok(!check.depends_on.includes('older-sibling-writer'));
  assert.ok(!writer.depends_on?.includes('older-sibling-writer'));
  await patchRecord(current.path, { body: 'HUMAN_CURRENT_SIBLING_NOTES', result_note: 'Keep the fresh checked packet.' }, { actor: 'crystal' });
  const before = readRecord(current.path);
  mode = 'human'; wakeConductor({ force: true, deps }); await drain();
  const reviews = workItems().filter(w => w.conductor_review), after = readRecord(current.path);
  assert.equal(reviews.length, 1, 'a sibling draft cannot create a second decision about the same writing lineage');
  assert.equal(reviews[0].id, current.id);
  assert.equal(reviews[0].status, 'now');
  assert.equal(after.rev, before.rev);
  assert.equal(after.content, before.content);
  assert.deepEqual(after.data.artifacts, before.data.artifacts);
  assert.ok(after.data.artifacts.some(a => a.path === writer.output_path));
  assert.ok(after.data.artifacts.some(a => a.path === check.output_path));
  assert.ok(!after.data.artifacts.some(a => a.path === siblingPath));
});

test('invalid model reply evidence stays in its durable cycle and is never applied as a plan', async () => {
  await seed();
  wakeConductor({ force: true, deps: { think: async () => ({ ok: true, text: 'I will ask Research to work on this, without a JSON task plan.', provider: 'stub', model: 'test-light' }) } });
  await conductorSettled();
  assert.equal(conductorStatus().state, 'cooldown');
  const cycle = fs.readdirSync(path.join(getStorageRoot(), '.scout', 'conductor', 'cycles')).map(file => readMd(path.join(getStorageRoot(), '.scout', 'conductor', 'cycles', file)).data)
    .find(c => c.validation_error);
  assert.match(cycle.invalid_response, /without a JSON task plan/);
  assert.equal(listTasks({ project: 'growth' }).length, 0);
});

test('a named research brief declares visible source artifacts and actually receives the saved edited source', async () => {
  const { roles, supplied } = await seed();
  const old = readRecord(supplied.path);
  await patchRecord(supplied.path, { body: 'SAVED_SOURCE_CORRECTION: Place Skip tax ID before the example invoice.' }, { actor: 'crystal', rev: old.rev });
  let coordinatorPrompt, workerPrompt;
  const deps = {
    think: async input => {
      coordinatorPrompt = input.prompt;
      return answer({ summary: 'Scout is researching your saved correction before Pen revises the guide.', tasks: [{ key: 'research-saved-edit', assistant: roles.researcher,
        title: 'Research the saved setup correction', requires: ['research'], instructions: 'Read the saved human edit in ' + supplied.path + ' and identify the concrete setup friction.',
        source_artifacts: [supplied.path], review_required: false }] });
    }, workerThink: async input => { workerPrompt = input.prompt; return { ok: true, text: 'The saved correction calls for a visible skip before the example invoice.', provider: 'stub' }; },
  };
  wakeConductor({ force: true, deps }); await drain();
  const task = listTasks({ project: 'growth' })[0];
  assert.deepEqual(task.source_artifacts, [supplied.path]);
  assert.equal(task.prepared_by, roles.researcher);
  assert.match(workerPrompt, /SAVED_SOURCE_CORRECTION/);
  assert.match(coordinatorPrompt, /Honor explicit named specialist requests/);
  assert.match(coordinatorPrompt, /source_artifacts/);
});

test('a plan cannot name a source artifact absent from the coordinator projection', async () => {
  const { roles } = await seed();
  wakeConductor({ force: true, deps: { think: async () => answer({ summary: 'Invalid private source.', tasks: [{ key: 'bad-source', assistant: roles.writer,
    title: 'Must not be created', instructions: 'Use data/artifacts/private-other.md.', requires: ['draft'], source_artifacts: ['data/artifacts/private-other.md'] }] }) } });
  await conductorSettled();
  assert.equal(listTasks({ project: 'growth' }).length, 0);
  assert.equal(conductorStatus().state, 'cooldown');
  assert.match(conductorStatus().reason, /permitted artifacts/);
});
