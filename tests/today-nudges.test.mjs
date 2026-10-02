// The four nudge rules — each fires AT its threshold and not below — and the once-a-day dedupe
// that keeps the 60s poll from re-posting them.
import './_env.mjs'; // first
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { freshRoot, writeMd, getStorageRoot } from './helpers.mjs';
import { localDay, dayStartMs } from '../backend/daytime.mjs';
import { computeNudges, ensureWorkCollections, ensureTodaySession, ensurePlanned, getToday } from '../backend/today.mjs';
import { getSession } from '../backend/chat.mjs';
import { todaySessionId } from '../backend/today.mjs';
import { logEvent } from '../backend/log.mjs';

const DAY = '2026-10-02';
const nowMs = dayStartMs(DAY) + 12 * 3600000; // noon, local
const item = (id, over = {}) => ({ id, path: 'data/work/' + id + '.md', title: 'T-' + id, bucket: 'seo', status: 'planned', day: DAY, estimate_min: 30, ...over });
const seg = (id, bucket, startMin, endMin, over = {}) => ({
  id, bucket, path: 'data/work/' + id + '.md',
  start: dayStartMs(DAY) + startMin * 60000, end: endMin == null ? nowMs : dayStartMs(DAY) + endMin * 60000,
  day: DAY, minutes: (endMin == null ? nowMs - dayStartMs(DAY) - startMin * 60000 : (endMin - startMin) * 60000) / 60000,
  ...(endMin == null ? { open: true } : {}), ...over,
});
const ev = (min, action, id, extra = {}) => ({
  ts: new Date(dayStartMs(DAY) + min * 60000).toISOString(), actor: 'crystal', type: 'work',
  target: 'data/work/' + id + '.md', detail: { action, id, ...extra },
});

const keys = list => list.map(n => n.key).sort();
const fired = (key, list) => list.some(n => n.key === key);
const silentFor = (key, list) => !list.some(n => n.key === key);

test('over-estimate fires at ≥150% of the estimate AND ≥10 min over, not below either bound', () => {
  const items = [item('a')];                                   // est 30m → fires at elapsed ≥ 45
  // 45m elapsed on a 30m estimate = exactly 1.5×, 15 min over → fires.
  assert.ok(fired('over-a', computeNudges({ items, segs: [seg('a', 'seo', 675, null)], events: [], day: DAY, now: nowMs })));
  // 44m elapsed = 1.47× — over by 14, but below the ratio → silent.
  assert.ok(silentFor('over-a', computeNudges({ items, segs: [seg('a', 'seo', 676, null)], events: [], day: DAY, now: nowMs })));
  // A 15m estimate needs elapsed ≥ 22.5 for the ratio and ≥ 25 for ten minutes over — 25 fires.
  const tiny = [item('c', { estimate_min: 15 })];
  assert.ok(fired('over-c', computeNudges({ items: tiny, segs: [seg('c', 'seo', 695, null)], events: [], day: DAY, now: nowMs })));
  // 22m elapsed: under the ratio and under the minutes → silent.
  assert.ok(silentFor('over-c', computeNudges({ items: tiny, segs: [seg('c', 'seo', 698, null)], events: [], day: DAY, now: nowMs })));
});

test('a bucket over 1.5× its planned minutes fires; at exactly 1.5× it does not', () => {
  const items = [item('a')];                              // seo planned 30m
  const over = [seg('a', 'seo', 600, 646)];               // 46m actual > 45m
  assert.ok(fired('bucket-seo', computeNudges({ items, segs: over, events: [], day: DAY, now: nowMs })));
  const exact = [seg('a', 'seo', 600, 645)];              // 45m == 1.5× — not over
  assert.ok(silentFor('bucket-seo', computeNudges({ items, segs: exact, events: [], day: DAY, now: nowMs })));
});

test('pausing does not reset the estimate and completed work remains in the bucket budget', () => {
  const items = [item('a', { status: 'now' }), item('b', { status: 'done' })];
  const segs = [seg('a', 'seo', 600, 635), seg('a', 'seo', 710, null), seg('b', 'seo', 640, 660)];
  const nudges = computeNudges({ items, segs, events: [], day: DAY, now: nowMs });
  assert.ok(fired('over-a', nudges), '35 + 10 min is over a 30 min task, despite its recent resume');
  assert.ok(silentFor('bucket-seo', nudges), '65 min actual remains below 1.5 × the original 60 min budget');
});

test('paused > 15 min on the active item fires; 14 does not', () => {
  const items = [item('a', { status: 'now' })];
  const firedCase = computeNudges({ items, segs: [seg('a', 'seo', 600, 640)], events: [ev(640, 'pause', 'a')], day: DAY, now: dayStartMs(DAY) + 656 * 60000 });
  assert.ok(fired('paused-a', firedCase));
  const notYet = computeNudges({ items, segs: [seg('a', 'seo', 600, 640)], events: [ev(640, 'pause', 'a')], day: DAY, now: dayStartMs(DAY) + 654 * 60000 });
  assert.ok(silentFor('paused-a', notYet));
});

test('three parks today fires the re-plan nudge; two do not', () => {
  const items = [item('a'), item('b'), item('c')];
  const evs = [ev(600, 'stop', 'a', { outcome: 'parked' }), ev(620, 'stop', 'b', { outcome: 'parked' }), ev(640, 'stop', 'c', { outcome: 'parked' })];
  assert.ok(fired('parked', computeNudges({ items, segs: [], events: evs, day: DAY, now: nowMs })));
  assert.ok(silentFor('parked', computeNudges({ items, segs: [], events: evs.slice(0, 2), day: DAY, now: nowMs })));
});

test('getToday posts a nudge once per day — the poll cannot repeat it', async (t) => {
  freshRoot(); ensureWorkCollections();
  const day = localDay(Date.now());
  // A start 50 min ago only lands inside today when the test isn't in the day's first hour —
  // skip rather than flake.
  const startMs = Date.now() - 50 * 60000;
  if (localDay(startMs) !== day) { t.skip('inside the day\u2019s first hour — the seeded start would land yesterday'); return; }
  const id = day + '-longrunner';
  writeMd(path.join(getStorageRoot(), 'data/work', id + '.md'), {
    tags: ['work'], title: 'Long runner', bucket: 'seo', status: 'now', day, estimate_min: 30,
  }, '');
  ensureTodaySession(day);
  const startTs = new Date(startMs).toISOString();
  const line = '- ' + startTs + ' · crystal · work · data/work/' + id + '.md · ' + JSON.stringify({ action: 'start', id, bucket: 'seo' });
  const logFile = path.join(getStorageRoot(), 'log', startTs.slice(0, 10) + '.md');
  writeMd(logFile, { type: 'log', date: startTs.slice(0, 10) }, '# Activity · ' + startTs.slice(0, 10) + '\n\n' + line + '\n');
  // Nudges only exist once the day is planned — mark it the way planDay does.
  logEvent({ type: 'work', actor: 'conductor', target: 'today/' + day, detail: { action: 'plan', day, source: 'test', count: 1 } });

  const s1 = await getToday();
  assert.ok(s1.nudges.some(n => n.key === 'over-' + id), 'the over-estimate nudge fired — got ' + JSON.stringify(s1.nudges));
  const msgs1 = getSession(todaySessionId(day)).messages.filter(m => m.meta && m.meta.key === 'nudge-' + day + '-over-' + id);
  assert.equal(msgs1.length, 1);
  const s2 = await getToday();
  assert.ok(s2.nudges.some(n => n.key === 'over-' + id));
  const msgs2 = getSession(todaySessionId(day)).messages.filter(m => m.meta && m.meta.key === 'nudge-' + day + '-over-' + id);
  assert.equal(msgs2.length, 1, 'the second poll did not re-post');
});

// An over-estimate item is ALREADY running when the first poll of the day fires ensurePlanned
// detached — the nudge used to land above the morning plan it should follow. The gate: no plan
// event, no nudges.
test('an unplanned day posts no nudges, even when a rule is already over its threshold', async (t) => {
  freshRoot(); ensureWorkCollections();
  const day = localDay(Date.now());
  const startMs = Date.now() - 50 * 60000;
  if (localDay(startMs) !== day) { t.skip('inside the day\u2019s first hour — the seeded start would land yesterday'); return; }
  const id = day + '-unplanned-runner';
  writeMd(path.join(getStorageRoot(), 'data/work', id + '.md'), {
    tags: ['work'], title: 'Running before the plan', bucket: 'seo', status: 'now', day, estimate_min: 10,
  }, '');
  const startTs = new Date(startMs).toISOString();
  const line = '- ' + startTs + ' · crystal · work · data/work/' + id + '.md · ' + JSON.stringify({ action: 'start', id, bucket: 'seo' });
  writeMd(path.join(getStorageRoot(), 'log', startTs.slice(0, 10) + '.md'), { type: 'log', date: startTs.slice(0, 10) },
    '# Activity · ' + startTs.slice(0, 10) + '\n\n' + line + '\n');

  const s = await getToday(); // no ensurePlanned — the day is unplanned
  assert.equal(s.planned, false);
  assert.deepEqual(s.nudges, [], 'a rule over threshold is still silent before the plan');
  const sess = getSession(todaySessionId(day));
  assert.ok(!sess || !sess.messages.some(m => m.meta && String(m.meta.key).startsWith('nudge-')), 'nothing posted');
});

test('first poll of the day: the plan message precedes every nudge in the transcript', async (t) => {
  freshRoot(); ensureWorkCollections();
  const day = localDay(Date.now());
  const startMs = Date.now() - 50 * 60000;
  if (localDay(startMs) !== day) { t.skip('inside the day\u2019s first hour — the seeded start would land yesterday'); return; }
  const id = day + '-carried-runner';
  writeMd(path.join(getStorageRoot(), 'data/work', id + '.md'), {
    tags: ['work'], title: 'Carried runner', bucket: 'seo', status: 'now', day, estimate_min: 10,
  }, '');
  const startTs = new Date(startMs).toISOString();
  const line = '- ' + startTs + ' · crystal · work · data/work/' + id + '.md · ' + JSON.stringify({ action: 'start', id, bucket: 'seo' });
  writeMd(path.join(getStorageRoot(), 'log', startTs.slice(0, 10) + '.md'), { type: 'log', date: startTs.slice(0, 10) },
    '# Activity · ' + startTs.slice(0, 10) + '\n\n' + line + '\n');

  // The route's shape: ensurePlanned detached, getToday answering while it is in flight.
  const planPass = ensurePlanned();
  await getToday();
  await planPass;
  const s2 = await getToday();
  assert.equal(s2.planned, true);
  assert.ok(s2.nudges.some(n => n.key === 'over-' + id), 'the over-estimate nudge fires once the plan exists');

  const msgs = getSession(todaySessionId(day)).messages;
  const planIx = msgs.findIndex(m => m.meta && m.meta.key === 'plan-' + day);
  const nudgeIx = msgs.findIndex(m => m.meta && String(m.meta.key || '').startsWith('nudge-'));
  assert.ok(planIx >= 0, 'plan message exists');
  assert.ok(nudgeIx >= 0, 'nudge was posted');
  assert.ok(planIx < nudgeIx, 'the plan is the day\u2019s first word — nudge ' + nudgeIx + ' after plan ' + planIx);
});
