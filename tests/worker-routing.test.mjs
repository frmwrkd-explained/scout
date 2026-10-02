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
