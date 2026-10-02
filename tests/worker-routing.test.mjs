import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { freshRoot, seedProject } from './helpers.mjs';
import { getStorageRoot, setStorageRoot, saveSettings, writeMd } from '../backend/store.mjs';
import { saveAssistant, saveTask, getTask, claimTask, heartbeatTaskLease,
  releaseTaskLease, recoverExpiredTaskLeases, workerCanTask, listRuns } from '../backend/tasks.mjs';
import { wakeWorker, tickWorkers, workersSettled, workerStatus, getWorkerWake, matchingWorkers } from '../backend/workers.mjs';
import { saveWorkerPolicy } from '../backend/workerScope.mjs';
import { sendOut } from '../backend/dispatch.mjs';
import { listProposals } from '../backend/proposals.mjs';
import { ensureArtifactCollection } from '../backend/conductor.mjs';
import { upsertRecord, patchRecord, readRecord } from '../backend/records.mjs';

function seed({ settings = {}, assistants = 1, taskCount = 1 } = {}) {
  const root = freshRoot();
  seedProject('growth');
  saveSettings({ autoRun: false, workerSchedulerEnabled: false, workerMaxConcurrent: 2, workerMaxAttempts: 3,
    workerLeaseMinutes: 1, workerRetryMinutes: 1, workerQuotaCooldownMinutes: 5, ...settings });
  for (let i = 0; i < assistants; i++) saveAssistant('writer-' + i, {
    name: 'Writer ' + i, job: 'Prepare a useful campaign draft', project: 'growth', worker_enabled: true,
    worker_mode: 'prepare', capabilities: ['draft', 'research'],
  });
  for (let i = 0; i < taskCount; i++) saveTask('growth', 'draft-' + i, {
    title: 'Draft campaign ' + i, requires: ['draft'], body: 'Prepare a first draft for the human to review.',
  });
  return root;
}
const good = async () => ({ ok: true, text: 'A useful first draft. Please review the offer.', provider: 'stub', model: 'test-light' });
const wake = (key = 'first', task = 'draft-0', deps = {}) => wakeWorker({ key, project: 'growth', task }, { deps });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };

test('declared skills route tasks, malformed declarations fail closed, and skills never grant project membership', () => {
  seed({ assistants: 2 });
  saveAssistant('writer-1', { capabilities: ['measure'] });
  assert.deepEqual(matchingWorkers(getTask('growth', 'draft-0')).map(a => a.id), ['writer-0']);
  assert.equal(workerCanTask({ capabilities: ['draft'] }, { requires: ['draft', 'measure'] }), false);
  assert.equal(workerCanTask({ capabilities: 'draft' }, { requires: [] }), false);
  assert.throws(() => saveTask('growth', 'bad', { title: 'Bad', requires: [''] }), /requires must be/);
  saveWorkerPolicy('writer-0', { universes: ['local'], projects: [], collections: { read: [], write: [] } });
  assert.deepEqual(matchingWorkers(getTask('growth', 'draft-0')), []);
});

test('leased task heartbeat and stale recovery reject an old worker after reassignment', () => {
  seed();
  const at = Date.now();
  const first = claimTask('growth', 'draft-0', { actor: 'writer-0', now: at, lease: { id: 'first-lease', ms: 1000 } });
  assert.equal(first.won, true);
  assert.throws(() => heartbeatTaskLease('growth', 'draft-0', { actor: 'writer-0', leaseId: 'wrong', now: at }), /another worker/);
  const beat = heartbeatTaskLease('growth', 'draft-0', { actor: 'writer-0', leaseId: 'first-lease', now: at + 500, leaseMs: 1000 });
  assert.equal(Date.parse(beat.lease_expires_at), at + 1500);
  assert.equal(recoverExpiredTaskLeases({ now: at + 1400 }).length, 0);
  assert.equal(recoverExpiredTaskLeases({ now: at + 1600 }).length, 1);
  assert.equal(getTask('growth', 'draft-0').status, 'open');
  claimTask('growth', 'draft-0', { actor: 'writer-1', now: at + 1600, lease: { id: 'replacement', ms: 1000 } });
  assert.throws(() => releaseTaskLease('growth', 'draft-0', { actor: 'writer-0', leaseId: 'first-lease', now: at + 1700, status: 'done' }), /another worker/);
  assert.throws(() => saveTask('growth', 'draft-0', { status: 'done' }, { actor: 'writer-0', leaseId: 'first-lease', now: at + 1700 }), /current worker/);
  assert.equal(getTask('growth', 'draft-0').assigned, 'writer-1');
});

test('manual owner wake works with scheduling off, repeated keys do not start duplicate work', async () => {
  seed();
  const gate = deferred();
  let calls = 0;
  const deps = { think: async () => { calls++; return gate.promise; } };
  assert.equal(tickWorkers({ deps }).paused, true);
  const started = wake('first', 'draft-0', deps);
  assert.equal(started.started, true);
  const repeated = wake('first', 'draft-0', deps);
  assert.equal(repeated.created, false);
  assert.equal(repeated.started, false);
  assert.equal(calls, 1);
  gate.resolve(await good());
  await workersSettled();
  const completed = getWorkerWake(started.wake.id);
  assert.equal(completed.state, 'done');
  assert.equal(getTask('growth', 'draft-0').prepared_text, (await good()).text);
  assert.equal(getTask('growth', 'draft-0').prep_provider, 'stub');
  assert.equal(getTask('growth', 'draft-0').lease_id, null);
  assert.equal(listRuns()[0].status, 'done');
  assert.equal(wake('first', 'draft-0', deps).started, false);
  assert.equal(calls, 1);
});

test('downstream preparation reads the human-edited canonical draft and preserves the immutable original run output', async () => {
  seed({ assistants: 2 }); ensureArtifactCollection();
  saveAssistant('writer-1', { capabilities: ['review'] });
  saveWorkerPolicy('writer-1', { universes: ['local'], projects: ['growth'], collections: { read: ['artifact'], write: [] } });
  saveTask('growth', 'draft-0', { status: 'done', prep_state: 'ready', prepared_text: 'ORIGINAL_RUN_TEXT', goal_id: 'launch', universe: 'local', review_required: false });
  const draft = upsertRecord({ collection: 'artifact', id: 'upstream-draft', title: 'Actual upstream draft', project: 'growth', goal_id: 'launch', universe: 'local',
    body: 'ORIGINAL_RUN_TEXT', status: 'draft' }, { actor: 'crystal' });
  saveTask('growth', 'draft-0', { output_path: draft.path });
  const original = readRecord(draft.path);
  await patchRecord(draft.path, { body: 'HUMAN_CORRECTED_DRAFT: Add a visible skip link.' }, { actor: 'crystal', rev: original.rev });
  saveTask('growth', 'check', { title: 'Check the actual revised draft', requires: ['review'], depends_on: ['draft-0'], goal_id: 'launch', universe: 'local', body: 'Review the upstream copy.' });
  let prompt;
  const started = wakeWorker({ key: 'human-edited-dependency', project: 'growth', task: 'check', assistant: 'writer-1' }, { deps: { think: async input => { prompt = input.prompt; return good(); } } });
  await workersSettled();
  assert.equal(getWorkerWake(started.wake.id).state, 'done');
  assert.match(prompt, /HUMAN_CORRECTED_DRAFT/);
  assert.doesNotMatch(prompt, /ORIGINAL_RUN_TEXT/);
  assert.equal(getTask('growth', 'draft-0').prepared_text, 'ORIGINAL_RUN_TEXT');
});

test('review material names the actual ready writer output separately from an earlier canonical guide', async () => {
  seed({ assistants: 2, taskCount: 2 }); ensureArtifactCollection();
  saveAssistant('writer-0', { name: 'Pen · Writer', role: 'writer', capabilities: ['writing'] });
  saveAssistant('writer-1', { name: 'Check · Reviewer', role: 'reviewer', capabilities: ['review'] });
  saveWorkerPolicy('writer-1', { universes: ['local'], projects: ['growth'], collections: { read: ['artifact'], write: [] } });
  const old = upsertRecord({ collection: 'artifact', id: 'older-guide-source', title: 'Older guide', project: 'growth', goal_id: 'launch', universe: 'local',
    body: 'OLDER_SOURCE: Business details came before the preview.', status: 'draft' }, { actor: 'crystal' });
  const latest = upsertRecord({ collection: 'artifact', id: 'latest-ready-writer-guide', title: 'Pen’s revised guide', project: 'growth', goal_id: 'launch', universe: 'local',
    body: 'NEW_READY_GUIDE: Try a sample first; show the invoice before all business details.', status: 'draft' }, { actor: 'crystal' });
  saveTask('growth', 'draft-1', { title: 'Pen’s newly revised guide', status: 'done', prepared_text: 'IMMUTABLE_RUN_TEXT', prepared_by: 'writer-0',
    prep_state: 'ready', output_path: latest.path, goal_id: 'launch', universe: 'local', requires: ['writing'] });
  // The latest file is also named as a source, reproducing a potentially ambiguous brief.
  saveTask('growth', 'check', { title: 'Check Pen’s latest guide', requires: ['review'], depends_on: ['draft-1'], goal_id: 'launch', universe: 'local',
    source_artifacts: [old.path, latest.path], body: 'Review Pen’s newly revised guide against the prior guide and the sample-first human correction.' });
  let prompt;
  const started = wakeWorker({ key: 'unambiguous-review-target', project: 'growth', task: 'check', assistant: 'writer-1' },
    { deps: { think: async input => { prompt = input.prompt; return good(); } } });
  await workersSettled();
  assert.equal(getWorkerWake(started.wake.id).state, 'done');
  const saved = JSON.parse(prompt.split('CANONICAL SOURCE DOCUMENTS\n\n')[1].split('\n\nREADY UPSTREAM TASK OUTPUTS')[0]);
  const ready = JSON.parse(prompt.split('READY UPSTREAM TASK OUTPUTS\n\n')[1]);
  assert.deepEqual(saved.map(s => s.path), [old.path]);
  assert.match(saved[0].material, /earlier draft/);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].id, 'draft-1');
  assert.equal(ready[0].path, latest.path);
  assert.equal(ready[0].assistant_name, 'Pen · Writer');
  assert.deepEqual(ready[0].requires, ['writing']);
  assert.match(ready[0].material, /actual new upstream material/);
  assert.match(ready[0].output, /NEW_READY_GUIDE/);
  assert.doesNotMatch(ready[0].output, /OLDER_SOURCE|IMMUTABLE_RUN_TEXT/);
  assert.match(prompt, /its matching ready writing output below is that guide/);
});

test('explicit and legacy referenced source artifacts supply the actual saved human correction without task dependencies', async () => {
  for (const explicit of [false, true]) {
    seed(); ensureArtifactCollection();
    saveWorkerPolicy('writer-0', { universes: ['local'], projects: ['growth'], collections: { read: ['artifact'], write: [] } });
    const source = upsertRecord({ collection: 'artifact', id: 'saved-human-guide', title: 'Saved guide', project: 'growth', goal_id: 'launch', universe: 'local',
      body: 'OLDER_COPY_DO_NOT_USE', status: 'draft' }, { actor: 'crystal' });
    const original = readRecord(source.path);
    await patchRecord(source.path, { body: 'ACTUAL_HUMAN_CORRECTION: show Skip tax ID before the sample invoice.' }, { actor: 'crystal', rev: original.rev });
    // Fill the cache ahead of the source, reproducing a real source omitted from bounded memory.
    for (let i = 0; i < 10; i++) upsertRecord({ collection: 'artifact', id: 'cached-' + i, title: 'Cached material ' + i,
      project: 'growth', goal_id: 'launch', universe: 'local', body: 'Background material. '.repeat(600) }, { actor: 'crystal' });
    saveTask('growth', 'draft-0', { goal_id: 'launch', universe: 'local', depends_on: [],
      body: 'Research the actual saved correction in [[' + source.path + ']] and propose a concrete fix.',
      ...(explicit ? { source_artifacts: [source.path] } : {}) });
    let prompt;
    const started = wake('reference-' + explicit, 'draft-0', { think: async input => { prompt = input.prompt; return good(); } });
    await workersSettled();
    assert.equal(getWorkerWake(started.wake.id).state, 'done');
    const namedSection = prompt.split('CANONICAL SOURCE DOCUMENTS\n\n')[1].split('\n\nREADY UPSTREAM TASK OUTPUTS')[0];
    const materials = JSON.parse(namedSection);
    assert.equal(materials.length, 1);
    assert.equal(materials[0].path, source.path);
    assert.equal(materials[0].author, 'crystal');
    assert.match(materials[0].output, /ACTUAL_HUMAN_CORRECTION/);
    assert.doesNotMatch(prompt, /OLDER_COPY_DO_NOT_USE/);
  }
});

test('an artifact reference outside worker membership never reaches any model prompt', async () => {
  for (const explicit of [false, true]) {
    seed(); ensureArtifactCollection();
    saveWorkerPolicy('writer-0', { universes: ['local'], projects: ['growth'], collections: { read: ['artifact'], write: [] }, finance: false });
    const privateSource = upsertRecord({ collection: 'artifact', id: 'finance-private-source', title: 'Private financial source', project: 'growth', universe: 'unit/finance',
      body: 'PRIVATE_SOURCE_BODY_MUST_NEVER_REACH_MODEL', status: 'draft' }, { actor: 'crystal' });
    saveTask('growth', 'draft-0', { universe: 'local', body: explicit ? 'Use the declared source.' : 'Use ' + privateSource.path + ' for the draft.',
      ...(explicit ? { source_artifacts: [privateSource.path] } : {}) });
    let calls = 0;
    const started = wake('private-ref-' + explicit, 'draft-0', { think: async () => { calls++; return good(); } });
    await workersSettled();
    assert.equal(calls, 0);
    assert.notEqual(getWorkerWake(started.wake.id).state, 'done');
    assert.equal(getTask('growth', 'draft-0').prepared_text, undefined);
  }
});

test('source excerpts keep the correction at the end of a long human draft inside the shared material budget', async () => {
  seed(); ensureArtifactCollection();
  saveWorkerPolicy('writer-0', { universes: ['local'], projects: ['growth'], collections: { read: ['artifact'], write: [] } });
  const paths = [];
  for (let i = 0; i < 4; i++) paths.push(upsertRecord({ collection: 'artifact', id: 'long-source-' + i, title: 'Long draft ' + i,
    project: 'growth', universe: 'local', body: 'Opening guide. ' + 'Middle material. '.repeat(2000) + '\nHUMAN_END_CORRECTION_' + i }, { actor: 'crystal' }).path);
  saveTask('growth', 'draft-0', { source_artifacts: paths, body: 'Use all four saved drafts and their latest corrections.' });
  let prompt;
  wake('bounded-sources', 'draft-0', { think: async input => { prompt = input.prompt; return good(); } });
  await workersSettled();
  const source = JSON.parse(prompt.split('CANONICAL SOURCE DOCUMENTS\n\n')[1].split('\n\nREADY UPSTREAM TASK OUTPUTS')[0]);
  assert.equal(source.length, 4);
  assert.ok(source.reduce((sum, s) => sum + s.output.length, 0) <= 24_000);
  for (let i = 0; i < 4; i++) assert.match(source[i].output, new RegExp('HUMAN_END_CORRECTION_' + i));
});

test('a source edit during preparation discards the stale answer before canonical completion', async () => {
  seed(); ensureArtifactCollection();
  saveWorkerPolicy('writer-0', { universes: ['local'], projects: ['growth'], collections: { read: ['artifact'], write: [] } });
  const source = upsertRecord({ collection: 'artifact', id: 'source-edited-mid-run', title: 'Current guide', project: 'growth', universe: 'local',
    body: 'Earlier sample invoice guide.', status: 'draft' }, { actor: 'crystal' });
  saveTask('growth', 'draft-0', { source_artifacts: [source.path], body: 'Revise the actual saved guide.' });
  const gate = deferred(), started = wake('mid-preparation-edit', 'draft-0', { think: () => gate.promise });
  await new Promise(resolve => setImmediate(resolve));
  await patchRecord(source.path, { body: 'HUMAN_NEW_EDIT_DURING_THOUGHT: Put Skip tax ID first.' }, { actor: 'crystal' });
  gate.resolve({ ok: true, text: 'STALE_ANSWER_MUST_NOT_BE_SAVED', provider: 'stub' });
  await workersSettled();
  const task = getTask('growth', 'draft-0'), receipt = getWorkerWake(started.wake.id);
  assert.equal(task.status, 'open');
  assert.equal(task.prepared_text, undefined);
  assert.equal(task.lease_id, null);
  assert.equal(receipt.state, 'retry');
  assert.match(receipt.reason, /source material changed/);
  assert.equal(listRuns()[0].status, 'blocked');
});

test('concurrency bound holds across independent wake keys and queue fills after a completion', async () => {
  seed({ assistants: 3, taskCount: 3, settings: { autoRun: true, workerSchedulerEnabled: true, workerMaxConcurrent: 2 } });
  const gate = deferred();
  let calls = 0;
  const deps = { think: async () => { calls++; return gate.promise; } };
  const first = tickWorkers({ deps });
  assert.equal(first.started.length, 2);
  assert.equal(calls, 2);
  assert.equal(tickWorkers({ deps }).started.length, 0);
  gate.resolve(await good());
  await workersSettled();
  assert.equal(tickWorkers({ deps: { think: good } }).started.length, 1);
  await workersSettled();
  assert.equal(workerStatus().wakes.filter(w => w.state === 'done').length, 3);
});

test('overnight wakes are once per task and day and never need a system cron', async () => {
  seed({ settings: { autoRun: true, workerSchedulerEnabled: true, workerOvernightEnabled: true, workerOvernightHour: 6 } });
  const now = new Date(); now.setHours(7, 0, 0, 0);
  const before = new Date(now); before.setHours(5);
  assert.equal(tickWorkers({ now: before, deps: { think: good } }).started.length, 0);
  const result = tickWorkers({ now, deps: { think: good, clock: () => now.getTime() } });
  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].source, 'overnight');
  await workersSettled();
  assert.equal(tickWorkers({ now, deps: { think: good } }).started.length, 0);
  assert.equal(workerStatus().wakes.length, 1);
});

test('failed preparation retries with bounded exponential backoff, then asks the human', async () => {
  seed({ settings: { autoRun: true, workerSchedulerEnabled: true, workerMaxAttempts: 2 } });
  let now = Date.now();
  const deps = { think: async () => ({ ok: false, reason: 'The provider exited unexpectedly.' }), clock: () => now };
  const initial = tickWorkers({ now, deps });
  await workersSettled();
  let receipt = getWorkerWake(initial.started[0].id);
  assert.equal(receipt.state, 'retry');
  assert.equal(Date.parse(receipt.next_at), now + 60_000);
  assert.equal(tickWorkers({ now: now + 59_999, deps }).started.length, 0);
  now += 60_000;
  assert.equal(tickWorkers({ now, deps }).started.length, 1);
  await workersSettled();
  receipt = getWorkerWake(receipt.id);
  assert.equal(receipt.state, 'failed');
  assert.equal(receipt.attempts, 2);
  assert.equal(getTask('growth', 'draft-0').status, 'blocked');
  assert.equal(getTask('growth', 'draft-0').needs_human, true);
  assert.equal(listProposals().filter(p => p.kind === 'question' && p.task === 'draft-0').length, 1);
  assert.equal(tickWorkers({ now: now + 10 * 3600_000, deps }).started.length, 0);
});

test('quota failures pause with a durable cooldown instead of spawning a heavy fallback', async () => {
  seed({ settings: { autoRun: true, workerSchedulerEnabled: true, workerMaxAttempts: 1 } });
  let calls = 0;
  const deps = { think: async input => { calls++; assert.equal(input.purpose, 'prep'); return { ok: false, reason: 'light daily call limit reached (40)' }; } };
  const started = tickWorkers({ deps });
  await workersSettled();
  assert.equal(getWorkerWake(started.started[0].id).state, 'paused');
  assert.equal(getTask('growth', 'draft-0').status, 'open');
  assert.equal(tickWorkers({ now: Date.now() + 3600_000, deps }).started.length, 0);
  assert.equal(calls, 1);
});

test('a manual wake resumes a restored own daily budget while remote quota cooldowns stay in force', async () => {
  for (const reason of ['gpt: light daily call limit reached (0)', 'gpt: weekly usage limit reached; resets next week',
    'gpt: light daily call limit reached (0) · claude: weekly usage limit reached']) {
    seed({ settings: { brainDailyLimits: { light: 0, heavy: 5 } } });
    const first = wake('restored-budget', 'draft-0', { think: async () => ({ ok: false, reason }) });
    await workersSettled();
    const before = getWorkerWake(first.wake.id);
    assert.equal(before.state, 'cooldown');
    assert.equal(wake('restored-budget', 'draft-0', { think: good }).started, false, 'a zero allowance remains blocked');
    saveSettings({ brainDailyLimits: { light: 2, heavy: 5 } });
    const restored = wake('restored-budget', 'draft-0', { think: good });
    if (reason === 'gpt: light daily call limit reached (0)') {
      assert.equal(restored.started, true);
      await workersSettled();
      const after = getWorkerWake(first.wake.id);
      assert.equal(after.id, before.id);
      assert.equal(after.created, before.created);
      assert.equal(after.attempts, 2, 'attempt history is retained');
      assert.ok(after.budget_restored_at);
      assert.equal(after.state, 'done');
      assert.equal(listRuns().length, 2);
    } else {
      assert.equal(restored.started, false, 'a restored local allowance never bypasses remote provider limits');
      assert.equal(getWorkerWake(first.wake.id).attempts, 1);
      assert.equal(getWorkerWake(first.wake.id).next_at, before.next_at);
    }
  }
});

test('an expired durable receipt recovers on restart and does not let a late response overwrite the retry', async () => {
  seed({ settings: { autoRun: true, workerSchedulerEnabled: true } });
  let now = Date.now();
  const gate = deferred();
  const first = tickWorkers({ now, deps: { think: () => gate.promise, clock: () => now } });
  now += 61_000;
  const recovery = tickWorkers({ now, deps: { think: good, clock: () => now } });
  assert.equal(recovery.recovered.length, 1);
  assert.equal(getWorkerWake(first.started[0].id).state, 'retry');
  assert.equal(getTask('growth', 'draft-0').status, 'open');
  gate.resolve({ ok: true, text: 'STALE answer' });
  await workersSettled(); // no result is applied after the expired lease
  assert.equal(getTask('growth', 'draft-0').prepared_text, undefined);
});

test('scoped preparation only sees projected context and restricted workers cannot use filesystem CLI', async () => {
  seed();
  saveWorkerPolicy('writer-0', { universes: ['local'], projects: ['growth'], collections: { read: [], write: [] }, finance: false });
  writeMd(path.join(getStorageRoot(), 'data', 'finance', 'payroll.md'), { tags: ['finance'], title: 'Secret payroll' }, 'DO_NOT_LEAK_98765');
  assert.throws(() => sendOut('writer-0'), e => e.status === 403 && /filesystem/.test(e.message));
  let prompt;
  const started = wake('scoped', 'draft-0', { think: async input => { prompt = input.prompt; return good(); } });
  await workersSettled();
  assert.equal(getWorkerWake(started.wake.id).state, 'done');
  assert.match(prompt, /Scoped Scout context/);
  assert.doesNotMatch(prompt, /DO_NOT_LEAK|Secret payroll/);
  assert.match(prompt, /Draft campaign/);
});

test('membership revocation during preparation discards the answer and releases the task', async () => {
  seed();
  const policy = { universes: ['local'], projects: ['growth'], collections: { read: [], write: [] } };
  saveWorkerPolicy('writer-0', policy);
  const gate = deferred();
  const started = wake('revoked', 'draft-0', { think: () => gate.promise });
  saveWorkerPolicy('writer-0', { ...policy, enabled: false });
  gate.resolve({ ok: true, text: 'Do not apply me' });
  await workersSettled();
  assert.equal(getTask('growth', 'draft-0').prepared_text, undefined);
  assert.equal(getTask('growth', 'draft-0').status, 'open');
  assert.match(getWorkerWake(started.wake.id).reason, /revoked|membership/);
});

test('a workspace switch during preparation never writes the old answer into the new root', async () => {
  const old = seed();
  const gate = deferred();
  const started = wake('root-change', 'draft-0', { think: () => gate.promise });
  const newer = freshRoot();
  seedProject('growth');
  saveTask('growth', 'draft-0', { title: 'Unrelated new task' });
  gate.resolve({ ok: true, text: 'OLD_ROOT_PRIVATE_REPLY' });
  await started.done;
  assert.equal(getTask('growth', 'draft-0').title, 'Unrelated new task');
  assert.equal(getTask('growth', 'draft-0').prepared_text, undefined);
  assert.equal(fs.existsSync(path.join(newer, '.scout', 'worker-wakes')), false);
  setStorageRoot(old);
  assert.equal(getWorkerWake(started.wake.id).state, 'running', 'original durable lease remains recoverable');
});

test('active Paperclip delegation blocks both lease claiming and local routing', () => {
  seed();
  saveTask('growth', 'draft-0', { work_id: 'remote-owned-work' });
  writeMd(path.join(getStorageRoot(), '.scout', 'paperclip', 'receipts', 'delegated.md'), {
    key: 'delegated', kind: 'issue', workId: 'remote-owned-work', state: 'delegated', remoteId: 'remote-issue',
  }, '');
  assert.deepEqual(matchingWorkers(getTask('growth', 'draft-0')), []);
  assert.throws(() => claimTask('growth', 'draft-0', { actor: 'writer-0' }), e => e.status === 409);
  assert.throws(() => wake('remote'), e => e.status === 409);
});

test('ordinary task edits racing a real lease holder cannot restore a released claim', async () => {
  seed();
  saveTask('growth', 'draft-0', { body: 'Preserve the task body. '.repeat(500) });
  const scratch = path.dirname(process.env.SCOUT_CONFIG);
  const program = path.join(scratch, 'worker-patch-race.mjs');
  const gun = path.join(scratch, 'worker-patch-race-' + Date.now());
  fs.writeFileSync(program, `
import fs from 'node:fs';
import { saveTask, claimTask, releaseTaskLease } from '${new URL('../backend/tasks.mjs', import.meta.url).href}';
const [mode, gun] = process.argv.slice(2);
fs.writeFileSync(gun + '.' + mode + '.ready', 'ready');
const deadline = Date.now() + 10000;
while (!fs.existsSync(gun)) { if (Date.now() > deadline) throw new Error('starting gun timed out'); }
for (let i = 0; i < 80; i++) {
  if (mode === 'edit') saveTask('growth', 'draft-0', { question: 'edit-' + i });
  else {
    const leaseId = 'claim-' + i;
    const r = claimTask('growth', 'draft-0', { actor: 'writer-0', lease: { id: leaseId, ms: 10000 } });
    if (!r.won) throw new Error('ordinary edit resurrected or lost a claim: ' + r.reason);
    releaseTaskLease('growth', 'draft-0', { actor: 'writer-0', leaseId });
  }
}
process.stdout.write('done');
`);
  const children = [];
  const runs = ['edit', 'claim'].map(mode => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [program, mode, gun], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(mode + ': ' + err)));
  }));
  try {
    const deadline = Date.now() + 10000;
    while (!['edit', 'claim'].every(mode => fs.existsSync(gun + '.' + mode + '.ready'))) {
      if (Date.now() > deadline) throw new Error('race workers did not boot');
      await new Promise(r => setTimeout(r, 5));
    }
    fs.writeFileSync(gun, 'go');
    await Promise.all(runs);
    const final = getTask('growth', 'draft-0');
    assert.equal(final.status, 'open');
    assert.equal(final.lease_id, null);
    assert.equal(final.assigned, null);
    assert.equal(final.question, 'edit-79');
  } finally { for (const child of children) if (child.exitCode == null) child.kill(); }
});

test('an unreadable durable receipt stops routing instead of being replaced and spending again', async () => {
  seed();
  const first = wake('unreadable', 'draft-0', { think: good });
  await workersSettled();
  const file = path.join(getStorageRoot(), '.scout', 'worker-wakes', first.wake.id + '.md');
  const broken = '---\nstate: [unreadable\n---\nKeep this evidence.\n';
  fs.writeFileSync(file, broken);
  assert.throws(() => wake('unreadable', 'draft-0', { think: good }), e => e.status === 409 && /receipt cannot be read/.test(e.message));
  assert.equal(fs.readFileSync(file, 'utf8'), broken);
});
