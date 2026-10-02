// The push — the thing that makes this a conductor and not a list. Done/park/stuck all advance:
// the next item starts itself and the clock follows. Through the real routes.
import './_env.mjs'; // first
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { freshRoot, req, writeMd, getStorageRoot } from './helpers.mjs';
import { localDay } from '../backend/daytime.mjs';
import { readEvents } from '../backend/log.mjs';
import { readRecord } from '../backend/records.mjs';
import { getSession } from '../backend/chat.mjs';
import { todaySessionId, ensureWorkCollections, normDay, getToday } from '../backend/today.mjs';

const DAY = () => localDay(Date.now());
const itemPath = id => 'data/work/' + id + '.md';

function seedWork(id, data = {}, body = '') {
  writeMd(path.join(getStorageRoot(), itemPath(id)), {
    tags: ['work'], title: data.title || id, bucket: 'seo', status: 'planned',
    estimate_min: 30, ...data,
  }, body);
}

const workEvents = () => readEvents({ limit: 5000, type: 'work' }).reverse();
const actions = () => workEvents().map(e => e.detail && e.detail.action + ':' + (e.detail.id || '') + (e.detail.outcome ? '=' + e.detail.outcome : ''));

test('done stops the current item with outcome done and auto-starts the next', async () => {
  freshRoot(); ensureWorkCollections();
  seedWork(DAY() + '-a', { title: 'First', day: DAY(), order: 1 });
  seedWork(DAY() + '-b', { title: 'Second', day: DAY(), order: 2 });
  const start = await req('POST', '/api/today/start', { id: DAY() + '-a' });
  assert.equal(start.status, 200);
  const done = await req('POST', '/api/today/done', { id: DAY() + '-a', result: 2 });
  assert.equal(done.status, 200);
  assert.equal(done.body.next.id, DAY() + '-b');
  const seq = actions();
  const aStop = seq.indexOf('stop:' + DAY() + '-a=done');
  const bStart = seq.indexOf('start:' + DAY() + '-b');
  assert.ok(aStop >= 0 && bStart > aStop, 'a stop(done) precedes b start — got ' + seq.join(' | '));
  assert.equal(readRecord(itemPath(DAY() + '-a')).data.status, 'done');
  assert.equal(readRecord(itemPath(DAY() + '-b')).data.status, 'now');
  assert.equal(readRecord(itemPath(DAY() + '-a')).data.result, 2);
});

test('park stops with outcome parked, marks the item parked, and advances', async () => {
  freshRoot(); ensureWorkCollections();
  seedWork(DAY() + '-a', { title: 'First', day: DAY(), order: 1 });
  seedWork(DAY() + '-b', { title: 'Second', day: DAY(), order: 2 });
  await req('POST', '/api/today/start', { id: DAY() + '-a' });
  const r = await req('POST', '/api/today/park', { id: DAY() + '-a' });
  assert.equal(r.status, 200);
  assert.equal(r.body.next.id, DAY() + '-b');
  assert.equal(readRecord(itemPath(DAY() + '-a')).data.status, 'parked');
  assert.ok(actions().includes('stop:' + DAY() + '-a=parked'));
});

test('stuck without a reason is a 400; with one it marks stuck and posts to the day chat', async () => {
  freshRoot(); ensureWorkCollections();
  seedWork(DAY() + '-a', { title: 'First', day: DAY(), order: 1 });
  seedWork(DAY() + '-b', { title: 'Second', day: DAY(), order: 2 });
  const noReason = await req('POST', '/api/today/stuck', { id: DAY() + '-a' });
  assert.equal(noReason.status, 400);
  assert.match(noReason.body.error, /reason/);
  const r = await req('POST', '/api/today/stuck', { id: DAY() + '-a', reason: 'DNS is not propagating' });
  assert.equal(r.status, 200);
  assert.equal(readRecord(itemPath(DAY() + '-a')).data.status, 'stuck');
  const s = getSession(todaySessionId(DAY()));
  assert.ok(s, 'the stuck report made a day session');
  assert.ok(s.messages.some(mm => /Stuck on First: DNS is not propagating/.test(mm.text)), 'the stuck message is in the chat');
});

test('starting B while A runs writes A\u2019s stop(switched) first', async () => {
  freshRoot(); ensureWorkCollections();
  seedWork(DAY() + '-a', { title: 'First', day: DAY(), order: 1 });
  seedWork(DAY() + '-b', { title: 'Second', day: DAY(), order: 2 });
  await req('POST', '/api/today/start', { id: DAY() + '-a' });
  await req('POST', '/api/today/start', { id: DAY() + '-b' });
  const seq = actions();
  const aStop = seq.indexOf('stop:' + DAY() + '-a=switched');
  const bStart = seq.indexOf('start:' + DAY() + '-b');
  assert.ok(aStop >= 0 && aStop < bStart, 'switched stop lands before the new start — got ' + seq.join(' | '));
  assert.equal(readRecord(itemPath(DAY() + '-a')).data.status, 'planned'); // back in line
});

test('switching from a paused item keeps one Now and completion resumes the next item', async () => {
  freshRoot(); ensureWorkCollections();
  seedWork('a', { day: DAY(), order: 1 });
  seedWork('b', { day: DAY(), order: 2 });
  await req('POST', '/api/today/start', { id: 'a' });
  await req('POST', '/api/today/pause', {});
  await req('POST', '/api/today/start', { id: 'b' });
  assert.equal(readRecord(itemPath('a')).data.status, 'planned');
  assert.equal(readRecord(itemPath('b')).data.status, 'now');
  const r = await req('POST', '/api/today/done', { id: 'b' });
  assert.equal(r.body.next.id, 'a');
  assert.equal(r.body.today.now.id, 'a');
  assert.equal(r.body.today.now.clock.running, true);
});

test('Done while paused records its outcome and result exactly once without adding paused time', async () => {
  freshRoot(); ensureWorkCollections();
  seedWork('a', { day: DAY(), order: 1 });
  await req('POST', '/api/today/start', { id: 'a' });
  await req('POST', '/api/today/pause', {});
  await req('POST', '/api/today/done', { id: 'a', result: 3 });
  await req('POST', '/api/today/done', { id: 'a', result: 9 });
  const completions = workEvents().filter(e => e.detail.id === 'a' && e.detail.outcome === 'done');
  assert.equal(completions.length, 1);
  assert.equal(completions[0].detail.result, 3);
  const state = await getToday(Date.now() + 100);
  assert.equal(state.stats.today.by_bucket[0].done, 1);
  assert.equal(state.stats.today.by_bucket[0].results, 3);
  assert.equal(state.stats.today.total_min, 0);
});

test('starting the already running item does not restart its timer', async () => {
  freshRoot(); ensureWorkCollections();
  seedWork('a', { day: DAY() });
  await req('POST', '/api/today/start', { id: 'a' });
  await req('POST', '/api/today/start', { id: 'a' });
  assert.equal(workEvents().filter(e => e.detail.action === 'start').length, 1);
});

test('concurrent starts from two clients keep a single current item and clock', async () => {
  freshRoot(); ensureWorkCollections();
  seedWork('a', { day: DAY() });
  seedWork('b', { day: DAY() });
  const results = await Promise.all([
    req('POST', '/api/today/start', { id: 'a' }),
    req('POST', '/api/today/start', { id: 'b' }),
  ]);
  assert.ok(results.every(r => r.status === 200));
  const state = await getToday();
  assert.equal(state.plan.filter(i => i.status === 'now').length, 1);
  assert.equal(state.now.clock.running, true);
  assert.equal(state.now.id, state.plan.find(i => i.status === 'now').id);
});

test('End day closes the clock and does not count the remaining hours through midnight', async () => {
  freshRoot(); ensureWorkCollections();
  seedWork('a', { day: DAY() });
  await req('POST', '/api/today/start', { id: 'a' });
  const ended = await req('POST', '/api/today/end', {});
  assert.equal(ended.status, 200);
  assert.equal(ended.body.minutes, 0);
  assert.equal(readRecord(itemPath('a')).data.status, 'planned');
  assert.equal(workEvents().at(-1).detail.action, 'stop');
});

test('an empty plan pulls the next backlog item; an empty backlog answers next:null + a conductor message', async () => {
  freshRoot(); ensureWorkCollections();
  seedWork(DAY() + '-only', { title: 'Only', day: DAY(), order: 1 });
  seedWork('backlog-next', { title: 'From backlog', estimate_min: 25 });
  await req('POST', '/api/today/start', { id: DAY() + '-only' });
  const r = await req('POST', '/api/today/done', { id: DAY() + '-only' });
  assert.equal(r.body.next.id, 'backlog-next');
  const pulled = readRecord(itemPath('backlog-next')).data;
  assert.equal(normDay(pulled.day), DAY());          // pulled into today
  assert.equal(pulled.status, 'now');

  // Finish that one too — nothing remains.
  const last = await req('POST', '/api/today/done', { id: 'backlog-next' });
  assert.equal(last.body.next, null);
  const s = getSession(todaySessionId(DAY()));
  assert.ok(s.messages.some(mm => mm.meta && mm.meta.kind === 'conductor' && /backlog is empty|what today is for/i.test(mm.text)));
});
