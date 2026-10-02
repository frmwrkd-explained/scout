// The learning loop — daily and weekly reviews. The numbers are ALWAYS the rollup's, however the
// model phrases its reply; learnings land `proposed`; the weekly automation rule is code.
import './_env.mjs'; // first
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshRoot, writeMd, readMd, getStorageRoot } from './helpers.mjs';
import { readRecord } from '../backend/records.mjs';
import { listLearnings } from '../backend/memory.mjs';
import { ensureWorkCollections, dailyReview, weeklyReview, workItems, getToday } from '../backend/today.mjs';
import { readEvents } from '../backend/log.mjs';
import { localDay } from '../backend/daytime.mjs';

const STUB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'stub-brain.mjs');

function seedWork(id, data = {}) {
  writeMd(path.join(getStorageRoot(), 'data/work', id + '.md'), {
    tags: ['work'], title: data.title || id, bucket: 'seo', status: 'planned', estimate_min: 30, ...data,
  }, '');
}

// Seed the work log for a LOCAL day with segments: [{ id, bucket, from:'HH:MM', to:'HH:MM', outcome }]
function seedDay(localYmd, segments) {
  const [y, mo, d] = localYmd.split('-').map(Number);
  const lines = [];
  for (const s of segments) {
    const [sh, sm] = s.from.split(':').map(Number);
    const [eh, em] = s.to.split(':').map(Number);
    const start = new Date(y, mo - 1, d, sh, sm), end = new Date(y, mo - 1, d, eh, em);
    const target = 'data/work/' + s.id + '.md';
    lines.push(`- ${start.toISOString()} · crystal · work · ${target} · ${JSON.stringify({ action: 'start', id: s.id, bucket: s.bucket })}`);
    lines.push(`- ${end.toISOString()} · crystal · work · ${target} · ${JSON.stringify({ action: 'stop', id: s.id, bucket: s.bucket, outcome: s.outcome || 'done' })}`);
  }
  // Group by the UTC day file each line lands in — the log names files by UTC date.
  const byFile = {};
  for (const line of lines) {
    const ts = line.slice(2, 26);
    const key = ts.slice(0, 10);
    (byFile[key] ||= []).push(line);
  }
  for (const [fileDay, list] of Object.entries(byFile)) {
    const f = path.join(getStorageRoot(), 'log', fileDay + '.md');
    let prior = '';
    try { prior = readMd(f).content; } catch { /* fresh day file */ }
    writeMd(f, { type: 'log', date: fileDay }, (prior || ('# Activity · ' + fileDay + '\n\n')) + list.join('\n') + '\n');
  }
}

const withBrain = async (reply, fn) => {
  process.env.SCOUT_BRAIN_COMMAND = STUB;
  process.env.SCOUT_BRAIN_REPLY = reply;
  try { return await fn(); }
  finally { delete process.env.SCOUT_BRAIN_COMMAND; delete process.env.SCOUT_BRAIN_REPLY; }
};

test('daily review numbers equal the rollup even when the brain invents different ones', async () => {
  freshRoot(); ensureWorkCollections();
  seedWork('a', { title: 'A', bucket: 'seo', status: 'done', result: 5 });
  seedWork('b', { title: 'B', bucket: 'email', status: 'parked' });
  seedDay('2026-09-28', [
    { id: 'a', bucket: 'seo', from: '09:00', to: '10:30', outcome: 'done' },     // 90 min, result 5
    { id: 'b', bucket: 'email', from: '11:00', to: '11:30', outcome: 'parked' }, // 30 min
  ]);
  await withBrain('{"narrative":"You did 999 glorious minutes.","learnings":[{"title":"Mornings work","body":"seo shipped before noon"}],"tomorrow":"Start with email."}', async () => {
    const r = await dailyReview('2026-09-28');
    assert.equal(r.minutes, 120);                       // 90 + 30 — the rollup's figure
    const rec = readRecord('data/reviews/daily-2026-09-28.md');
    assert.equal(rec.data.minutes, 120);                // NOT the brain's 999
    assert.equal(rec.data.done, 1);
    assert.equal(rec.data.kind, 'daily');
    assert.match(rec.content, /999 glorious minutes/);  // the narrative is the agent's
    assert.match(rec.content, /\| email \| 30 \| 0 \| 0 \|/); // and the numbers are ours
    assert.match(rec.content, /Start with email\./);
  });
  const learnings = listLearnings({ status: 'proposed' });
  assert.ok(learnings.some(l => l.claim === 'Mornings work'), 'the learning landed proposed — never active');
});

test('daily review is idempotent per day', async () => {
  freshRoot(); ensureWorkCollections();
  seedWork('a', { title: 'A', bucket: 'seo', status: 'done' });
  seedDay('2026-09-28', [{ id: 'a', bucket: 'seo', from: '09:00', to: '09:30' }]);
  await dailyReview('2026-09-28');
  const again = await dailyReview('2026-09-28');
  assert.equal(again.skipped, true);
});

test('an in-progress daily review counts the open clock only through the review time', async () => {
  freshRoot(); ensureWorkCollections();
  seedWork('a', { title: 'A', bucket: 'seo', status: 'now' });
  const start = new Date(2026, 9, 2, 9, 0);
  const now = new Date(2026, 9, 2, 11, 0);
  const utcDay = start.toISOString().slice(0, 10);
  writeMd(path.join(getStorageRoot(), 'log', utcDay + '.md'), { type: 'log', date: utcDay },
    '- ' + start.toISOString() + ' · crystal · work · data/work/a.md · ' + JSON.stringify({ action: 'start', id: 'a', bucket: 'seo' }) + '\n');
  const review = await dailyReview('2026-10-02', { now: now.getTime() });
  assert.equal(review.minutes, 120, 'the review must not extend an open segment to midnight');
});

test('concurrent daily and weekly requests share one narrative run per period', async () => {
  freshRoot(); ensureWorkCollections();
  const daily = await Promise.all([dailyReview('2026-09-28'), dailyReview('2026-09-28')]);
  const weekly = await Promise.all([weeklyReview('2026-09-28'), weeklyReview('2026-09-28')]);
  assert.equal(daily[0].id, daily[1].id);
  assert.equal(weekly[0].id, weekly[1].id);
  const runs = readEvents({ type: 'run', limit: 100 });
  assert.equal(runs.filter(e => e.detail.purpose === 'review_daily').length, 1);
  assert.equal(runs.filter(e => e.detail.purpose === 'review_weekly').length, 1);
});

test('a review awaiting a narrative cannot write into a newly selected workspace', async () => {
  freshRoot(); ensureWorkCollections();
  const pending = dailyReview('2026-09-28');
  freshRoot(); ensureWorkCollections();
  await assert.rejects(pending, /workspace changed/);
  assert.throws(() => readRecord('data/reviews/daily-2026-09-28.md'));
  await dailyReview('2026-09-28');
  assert.equal(readRecord('data/reviews/daily-2026-09-28.md').data.kind, 'daily');
});

test('a delayed scheduled review closes an overdue clock at dayEnd and leaves a later task alone', async () => {
  freshRoot(); ensureWorkCollections();
  const day = localDay();
  const [y, m, d] = day.split('-').map(Number);
  const cutoff = new Date(y, m - 1, d, 17, 30).getTime();
  const now = new Date(y, m - 1, d, 18, 0).getTime();
  seedWork('a', { day, status: 'now' });
  const start = new Date(y, m - 1, d, 17, 0).toISOString();
  const logDay = start.slice(0, 10);
  const file = path.join(getStorageRoot(), 'log', logDay + '.md');
  writeMd(file, { type: 'log', date: logDay }, '- ' + start + ' · crystal · work · data/work/a.md · ' + JSON.stringify({ action: 'start', id: 'a', bucket: 'seo' }) + '\n');
  const review = await dailyReview(day, { now, scheduled: true, cutoff });
  assert.equal(review.minutes, 30);
  assert.equal((await getToday(now + 1)).now, null);
  const stop = readEvents({ type: 'work', limit: 20 }).find(e => e.detail.action === 'stop');
  assert.equal(stop.detail.clock_at, cutoff);

  seedWork('b', { day, status: 'now' });
  const previous = readMd(file);
  writeMd(file, previous.data, previous.content + '- ' + new Date(now).toISOString() + ' · crystal · work · data/work/b.md · ' + JSON.stringify({ action: 'start', id: 'b', bucket: 'seo' }) + '\n');
  const again = await dailyReview(day, { now: now + 15 * 60000, scheduled: true, cutoff });
  assert.equal(again.skipped, true);
  assert.equal((await getToday(now + 15 * 60000)).now.id, 'b');
  assert.equal((await getToday(now + 15 * 60000)).now.clock.running, true);
});

test('weekly review flags a ≥3h zero-result bucket and creates exactly one backlog item', async () => {
  freshRoot(); ensureWorkCollections();
  const ws = '2026-09-28'; // a Monday
  seedWork('fb', { title: 'FB grind', bucket: 'facebook-groups', status: 'done' });
  seedWork('seo-wk', { title: 'SEO week', bucket: 'seo', status: 'done', result: 4 });
  seedDay('2026-09-28', [
    { id: 'fb', bucket: 'facebook-groups', from: '09:00', to: '12:00' },   // 3h, no results
    { id: 'seo-wk', bucket: 'seo', from: '13:00', to: '14:00' },           // 1h, results
  ]);
  seedDay('2026-09-29', [
    { id: 'fb', bucket: 'facebook-groups', from: '09:00', to: '10:00' },   // +1h → 4h total
    { id: 'seo-wk', bucket: 'seo', from: '10:00', to: '11:00' },           // +1h → 2h
  ]);
  await withBrain('{"narrative":"Facebook-groups ate the week and returned nothing.","suggestions":{"facebook-groups":"Automate the cross-post, then stop reading it daily."}}', async () => {
    const r = await weeklyReview(ws);
    assert.deepEqual(r.flagged, ['facebook-groups']);
    assert.equal(r.created.length, 1);
  });
  const auto = workItems().find(i => i.id === 'automate-facebook-groups-' + ws);
  assert.ok(auto, 'the automation backlog item exists');
  assert.equal(auto.bucket, 'admin');
  assert.equal(auto.status, 'planned');
  assert.ok(!auto.day, 'it sits in the backlog, not in a day');
  assert.match(auto.title, /Automate or cut: facebook-groups \(4\.0h, 0 results/);
  const rec = readRecord('data/reviews/weekly-2026-09-28.md');
  assert.match(rec.content, /facebook-groups/);
  assert.match(rec.content, /Automate the cross-post/);

  // Idempotent — a re-run creates no second item.
  const again = await weeklyReview(ws);
  assert.equal(again.skipped, true);
  assert.equal(workItems().filter(i => String(i.id).startsWith('automate-')).length, 1);
});

test('weekly review without a heavy brain still writes numbers and flags — honestly', async () => {
  freshRoot(); ensureWorkCollections();
  delete process.env.SCOUT_BRAIN_COMMAND;
  seedWork('fb', { title: 'FB', bucket: 'facebook-groups', status: 'done' });
  seedDay('2026-09-28', [{ id: 'fb', bucket: 'facebook-groups', from: '09:00', to: '13:00' }]);
  const r = await weeklyReview('2026-09-28');
  assert.deepEqual(r.flagged, ['facebook-groups']);
  const rec = readRecord('data/reviews/weekly-2026-09-28.md');
  assert.match(rec.content, /No heavy agent/);
});
