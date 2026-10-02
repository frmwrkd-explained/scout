import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { freshRoot, getStorageRoot, writeMd, req } from './helpers.mjs';
import { readRecord } from '../backend/records.mjs';
import { documentsFor } from '../backend/documents.mjs';
import { ensureWorkCollections, getToday } from '../backend/today.mjs';
import { validateWorkflow, workReadiness, scheduleFollowup } from '../backend/workflow.mjs';
import { localDay, addDays } from '../backend/daytime.mjs';

function seed(id, data = {}) {
  const item = { id, path: 'data/work/' + id + '.md', title: id, bucket: 'email', status: 'planned', estimate_min: 20, ...data };
  writeMd(path.join(getStorageRoot(), item.path), { tags: ['work'], ...item }, '');
  return item;
}

test('approval unlocks implementation, which creates one delayed measurement follow-up', async () => {
  freshRoot(); ensureWorkCollections();
  const day = localDay();
  seed('approval', { day, order: 1, done_when: 'Owner approved the copy' });
  seed('implementation', { day, order: 2, depends_on: ['approval'], destination: 'Email campaign: onboarding', done_when: 'Record the installed campaign URL', follow_up_days: 14, follow_up_title: 'Measure onboarding replies' });
  const waiting = await req('POST', '/api/today/start', { id: 'implementation' });
  assert.equal(waiting.status, 409);
  const missingEvidence = await req('POST', '/api/today/done', { id: 'approval' });
  assert.equal(missingEvidence.status, 400);
  assert.equal(readRecord('data/work/approval.md').data.status, 'planned');
  await req('POST', '/api/today/start', { id: 'approval' });
  const approved = await req('POST', '/api/today/done', { id: 'approval', result_note: 'Approved by owner in the review' });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.next.id, 'implementation');
  const implemented = await req('POST', '/api/today/done', { id: 'implementation', result_note: 'Installed at campaign/42', result: 1 });
  assert.equal(implemented.status, 200);
  assert.equal(implemented.body.next, null);
  const followup = readRecord('data/work/followup-implementation.md');
  assert.equal(followup.data.destination, 'Email campaign: onboarding');
  assert.equal(followup.data.not_before instanceof Date ? followup.data.not_before.toISOString().slice(0, 10) : followup.data.not_before, addDays(day, 14));
  assert.match(followup.content, /Installed at campaign\/42/);
  await req('POST', '/api/today/done', { id: 'implementation' });
  assert.equal(documentsFor('work').documents.filter(row => row.slug === 'followup-implementation').length, 1);
  const today = await req('GET', '/api/today');
  assert.equal(today.body.next, null);
  assert.match(today.body.backlog.find(item => item.id === 'followup-implementation').wait_reason, /Follow up on/);
  const held = await req('POST', '/api/today/start', { id: 'followup-implementation' });
  assert.equal(held.status, 409);
});

test('invalid workflow data is rejected before adding work; cycles and missing prerequisites are refused', async () => {
  freshRoot(); ensureWorkCollections();
  const a = seed('a');
  const b = seed('b', { depends_on: ['a'] });
  const c = seed('c', { depends_on: ['b'] });
  assert.throws(() => validateWorkflow({ depends_on: ['c'] }, { id: 'a', items: [a, b, c] }), /cycle/);
  assert.throws(() => validateWorkflow({ depends_on: ['missing'] }, { items: [a] }), /Unknown prerequisite/);
  assert.throws(() => validateWorkflow({ not_before: '2026-02-30' }), /real/);
  assert.throws(() => validateWorkflow({ follow_up_days: 1.5 }), /whole days/);
  assert.throws(() => validateWorkflow({ goal_id: 'invented' }), /Unknown goal/);
  const count = documentsFor('work').documents.length;
  const result = await req('POST', '/api/today/add', { title: 'Bad followup', not_before: '2026-02-30' });
  assert.equal(result.status, 400);
  assert.equal(documentsFor('work').documents.length, count);
});

test('follow-up readiness uses calendar dates and keeps missing dependencies visible', () => {
  assert.deepEqual(workReadiness({ not_before: '2026-10-16', depends_on: ['a'] }, [{ id: 'a', status: 'done' }], '2026-10-16'), { ready: true, reason: '' });
  assert.equal(workReadiness({ not_before: '2026-10-16' }, [], '2026-10-15').ready, false);
  assert.match(workReadiness({ depends_on: ['lost'] }, []).reason, /Missing prerequisite/);
});

test('duplicate follow-up scheduling preserves its original date', () => {
  freshRoot(); ensureWorkCollections();
  const item = seed('completed', { status: 'done', follow_up_days: 14 });
  const first = scheduleFollowup(item, { now: new Date('2026-10-02T12:00:00').getTime() });
  const repeated = scheduleFollowup(item, { now: new Date('2026-10-10T12:00:00').getTime() });
  assert.equal(first.day, '2026-10-16');
  assert.equal(repeated.day, first.day);
});

test('generic record writes cannot bypass the Today completion and clock workflow', async () => {
  freshRoot(); ensureWorkCollections();
  const item = seed('guarded', { done_when: 'Campaign URL recorded', follow_up_days: 14 });
  for (const status of ['now', 'done', 'parked']) {
    const rejected = await req('PATCH', '/api/records', { path: item.path, patch: { status }, actor: 'crystal', workTransition: 'work-transition' });
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.error, /Today/);
  }
  assert.equal(readRecord(item.path).data.status, 'planned');
  assert.equal(documentsFor('work').documents.length, 1);
  const createdDone = await req('POST', '/api/records/upsert', { collection: 'work', id: 'fake-done', title: 'Fake done', status: 'done' });
  assert.equal(createdDone.status, 400);
  const batch = await req('POST', '/api/records/batch', { items: [
    { collection: 'work', id: 'fake-now', title: 'Fake now', status: 'now' },
    { collection: 'work', id: 'ordinary', title: 'Ordinary', status: 'planned' },
  ] });
  assert.equal(batch.body.results[0].verdict, 'refused');
  assert.equal(batch.body.results[1].verdict, 'store');
  const edit = await req('PATCH', '/api/records', { path: item.path, patch: { status: 'planned', bucket: 'marketing', body: 'Owner note' } });
  assert.equal(edit.status, 200);
  assert.equal(readRecord(item.path).data.bucket, 'marketing');
  const done = await req('POST', '/api/today/done', { id: item.id, result_note: 'Installed at campaign/42' });
  assert.equal(done.status, 200);
  assert.equal(readRecord(item.path).data.status, 'done');
  assert.ok(readRecord('data/work/followup-guarded.md'));
});

test('hand-authored work without an estimate shows the planning default without rewriting its file', async () => {
  freshRoot(); ensureWorkCollections();
  const item = seed('unestimated', { estimate_min: null, day: localDay() });
  const before = readRecord(item.path);
  const today = await getToday();
  assert.equal(today.next.estimate_min, 30);
  assert.equal(today.plan[0].estimate_min, 30);
  assert.equal(readRecord(item.path).rev, before.rev);
  assert.equal(readRecord(item.path).data.estimate_min, null);
});
