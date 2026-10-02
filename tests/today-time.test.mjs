// Time capture — the pure half of backend/today.mjs. Segments replay the work log; rollups
// answer today/week/month. Every timestamp here is LOCAL civil time (new Date(y, m, d, h, mi)),
// because the clock's day is the machine's day — a UTC-built fixture would test a clock nobody owns.
import './_env.mjs'; // first — storage env before any backend module loads
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { freshRoot, writeMd, getStorageRoot } from './helpers.mjs';
import { segmentsFromEvents, rollup, getToday } from '../backend/today.mjs';
import { localDay, weekStartDay, monthStartDay, dayStartMs, addDays } from '../backend/daytime.mjs';

const at = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi);              // local
const iso = d => d.toISOString();
const ev = (t, action, id, extra = {}) => ({
  ts: iso(t), actor: 'crystal', type: 'work', target: 'data/work/' + id + '.md',
  detail: { action, id, ...extra },
});
const totalMin = segs => Math.round(segs.reduce((a, s) => a + s.minutes, 0));

test('start → pause → resume → stop produces the worked segments only', () => {
  const segs = segmentsFromEvents([
    ev(at(2026, 9, 1, 9, 0), 'start', 'a', { bucket: 'seo' }),
    ev(at(2026, 9, 1, 9, 30), 'pause', 'a'),
    ev(at(2026, 9, 1, 9, 45), 'resume', 'a', { bucket: 'seo' }),
    ev(at(2026, 9, 1, 10, 15), 'stop', 'a', { outcome: 'done' }),
  ], at(2026, 9, 1, 12, 0).getTime());
  assert.equal(segs.length, 2);
  assert.equal(totalMin(segs), 60);
  assert.equal(segs[1].outcome, 'done');
  assert.ok(!segs[1].open);
});

test('switching items stops the first segment at the start event', () => {
  const segs = segmentsFromEvents([
    ev(at(2026, 9, 1, 9, 0), 'start', 'a', { bucket: 'seo' }),
    ev(at(2026, 9, 1, 9, 20), 'stop', 'a', { outcome: 'switched' }),
    ev(at(2026, 9, 1, 9, 20), 'start', 'b', { bucket: 'email' }),
  ], at(2026, 9, 1, 10, 0).getTime());
  assert.equal(segs.length, 2);
  assert.equal(segs[0].minutes, 20);
  assert.equal(segs[0].outcome, 'switched');
  assert.equal(segs[1].open, true);
  assert.equal(segs[1].minutes, 40); // still running — counts through now
});

test('an un-closed segment counts up to now', () => {
  const now = at(2026, 9, 1, 11, 0).getTime();
  const segs = segmentsFromEvents([ev(at(2026, 9, 1, 10, 30), 'start', 'a', { bucket: 'seo' })], now);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].open, true);
  assert.equal(segs[0].minutes, 30);
});

test('a segment spanning local midnight splits per local day', () => {
  const segs = segmentsFromEvents([
    ev(at(2026, 9, 1, 23, 30), 'start', 'a', { bucket: 'seo' }),
    ev(at(2026, 9, 2, 0, 30), 'stop', 'a', { outcome: 'done' }),
  ], at(2026, 9, 2, 9, 0).getTime());
  assert.equal(segs.length, 2);
  assert.equal(segs[0].day, localDay(at(2026, 9, 1, 12, 0)));
  assert.equal(segs[0].minutes, 30);
  assert.equal(segs[1].day, localDay(at(2026, 9, 2, 12, 0)));
  assert.equal(segs[1].minutes, 30);
});

test('a cross-midnight completion belongs only to its closing day', () => {
  const segs = segmentsFromEvents([
    ev(at(2026, 9, 1, 23, 30), 'start', 'a', { bucket: 'seo' }),
    ev(at(2026, 9, 2, 0, 30), 'stop', 'a', { outcome: 'done', result: 4 }),
  ]);
  const first = rollup(segs, { a: { result: 99 } }, { from: at(2026, 9, 1, 0, 0).getTime(), to: at(2026, 9, 2, 0, 0).getTime() });
  const second = rollup(segs, { a: { result: 99 } }, { from: at(2026, 9, 2, 0, 0).getTime(), to: at(2026, 9, 3, 0, 0).getTime() });
  assert.equal(first.by_bucket[0].done, 0);
  assert.equal(second.by_bucket[0].done, 1);
  assert.equal(second.by_bucket[0].results, 4, 'completion snapshot survives later edits of the work record');
});

test('paused completion counts an outcome without closing another item or inventing time', () => {
  const segs = segmentsFromEvents([
    ev(at(2026, 9, 1, 9, 0), 'start', 'a', { bucket: 'seo' }),
    ev(at(2026, 9, 1, 9, 30), 'pause', 'a'),
    ev(at(2026, 9, 1, 9, 45), 'start', 'b', { bucket: 'email' }),
    ev(at(2026, 9, 1, 10, 0), 'stop', 'a', { bucket: 'seo', outcome: 'done', result: 2 }),
  ], at(2026, 9, 1, 10, 15).getTime());
  const stats = rollup(segs);
  assert.equal(stats.total_min, 60);
  assert.equal(stats.by_bucket.find(b => b.bucket === 'seo').done, 1);
  assert.equal(stats.by_bucket.find(b => b.bucket === 'seo').results, 2);
  assert.equal(segs.find(s => s.open).id, 'b');
});

test('a pause or stop for another item never closes the open one', () => {
  const segs = segmentsFromEvents([
    ev(at(2026, 9, 1, 9, 0), 'start', 'a', { bucket: 'seo' }),
    ev(at(2026, 9, 1, 9, 10), 'stop', 'b', { outcome: 'done' }), // b was never started
    ev(at(2026, 9, 1, 9, 40), 'pause', 'a'),
  ], at(2026, 9, 1, 12, 0).getTime());
  const worked = segs.filter(s => s.minutes > 0);
  assert.equal(worked.length, 1);
  assert.equal(worked[0].id, 'a');
  assert.equal(worked[0].minutes, 40);
  assert.equal(segs.find(s => s.id === 'b').minutes, 0, 'unclocked completion is only an outcome');
});

test('rollup groups by bucket and by day, inside the range only', () => {
  const segs = segmentsFromEvents([
    ev(at(2026, 9, 5, 9, 0), 'start', 'a', { bucket: 'seo' }),        // Monday Oct 5
    ev(at(2026, 9, 5, 10, 0), 'stop', 'a', { outcome: 'done' }),
    ev(at(2026, 9, 5, 10, 0), 'start', 'b', { bucket: 'email' }),
    ev(at(2026, 9, 5, 10, 30), 'stop', 'b', { outcome: 'parked' }),
    ev(at(2026, 9, 6, 9, 0), 'start', 'c', { bucket: 'seo' }),        // Tuesday Oct 6
    ev(at(2026, 9, 6, 9, 30), 'stop', 'c', { outcome: 'done' }),
  ], at(2026, 9, 6, 12, 0).getTime());
  const items = { a: { result: 3 }, b: { result: 9 }, c: { result: 1 } };
  const r = rollup(segs, items, {});
  assert.equal(r.total_min, 120);
  const seo = r.by_bucket.find(b => b.bucket === 'seo');
  const email = r.by_bucket.find(b => b.bucket === 'email');
  assert.deepEqual({ minutes: seo.minutes, done: seo.done, results: seo.results }, { minutes: 90, done: 2, results: 4 });
  assert.equal(email.minutes, 30);
  assert.equal(email.done, 0);          // parked is not done
  assert.equal(email.results, 0);       // and its 9 results do not count
  assert.equal(r.by_day.length, 2);
  assert.equal(r.by_day[0].minutes, 90);
  assert.equal(r.by_day[1].minutes, 30);

  // A one-day range sees only that day.
  const dayOnly = rollup(segs, items, { from: at(2026, 9, 6, 0, 0).getTime(), to: at(2026, 9, 7, 0, 0).getTime() });
  assert.equal(dayOnly.total_min, 30);
  assert.equal(dayOnly.by_bucket.find(b => b.bucket === 'seo').done, 1);
});

test('week boundaries are local Monday–Sunday', () => {
  freshRoot();
  // Oct 4 2026 is a Sunday in every timezone worth testing; its Monday is Sep 28.
  const sun = '2026-10-04';
  assert.equal(weekStartDay(sun), '2026-09-28');
  const mon = '2026-09-28';
  assert.equal(weekStartDay(mon), '2026-09-28');        // a Monday is its own week's start
  assert.equal(addDays(weekStartDay(sun), 6), sun);     // Monday + 6 = Sunday
  assert.equal(monthStartDay('2026-10-17'), '2026-10-01');
  assert.equal(dayStartMs('2026-10-02'), at(2026, 9, 2, 0, 0).getTime());
});

test('a done outcome from outside the range does not count', () => {
  const segs = segmentsFromEvents([
    ev(at(2026, 9, 4, 9, 0), 'start', 'a', { bucket: 'seo' }),   // done on Sunday Oct 4
    ev(at(2026, 9, 4, 10, 0), 'stop', 'a', { outcome: 'done' }),
    ev(at(2026, 9, 5, 9, 0), 'start', 'b', { bucket: 'seo' }),   // worked Monday, parked
    ev(at(2026, 9, 5, 10, 0), 'stop', 'b', { outcome: 'parked' }),
  ], at(2026, 9, 5, 12, 0).getTime());
  const week = rollup(segs, { a: { result: 5 } }, {
    from: at(2026, 9, 5, 0, 0).getTime(),                        // week of Oct 5
    to: at(2026, 9, 12, 0, 0).getTime(),
  });
  assert.equal(week.by_bucket[0].done, 0);                       // a's done-stop was last week
  assert.equal(week.by_bucket[0].results, 0);
});

// The bug this pins: getToday read the event log back to month start only, so on a Friday in the
// first week of a month the week rollup silently dropped Monday–Wednesday (they live in September
// files). The read must reach min(weekStart, monthStart).
test('getToday: the week reaches back before the month does', async () => {
  freshRoot();
  const now = at(2026, 9, 2, 14, 0);                            // Friday Oct 2, local
  const day = localDay(now);
  assert.equal(weekStartDay(day), '2026-09-28');
  assert.equal(monthStartDay(day), '2026-10-01');

  const seedDay = (d, id) => {
    const y = Number(d.slice(0, 4)), mo = Number(d.slice(5, 7)) - 1, dd = Number(d.slice(8, 10));
    writeMd(path.join(getStorageRoot(), 'data/work', id + '.md'), {
      tags: ['work'], title: 'T-' + id, bucket: 'seo', status: 'done', day: d, estimate_min: 60,
    }, '');
    const lines = [
      ev(new Date(y, mo, dd, 9, 0), 'start', id, { bucket: 'seo' }),
      ev(new Date(y, mo, dd, 10, 0), 'stop', id, { outcome: 'done' }),
    ].map(e => '- ' + e.ts + ' · crystal · work · ' + e.target + ' · ' + JSON.stringify(e.detail));
    const logDay = lines[0].slice(2, 12);                        // the UTC day of the timestamps
    writeMd(path.join(getStorageRoot(), 'log', logDay + '.md'), { type: 'log', date: logDay },
      '# Activity · ' + logDay + '\n\n' + lines.join('\n') + '\n');
  };
  seedDay('2026-09-28', 'mon-sep');                              // this week, last month
  seedDay('2026-09-29', 'tue-sep');                              // this week, last month

  const t = await getToday(now.getTime());
  assert.ok(t.stats.week.total_min >= 120, 'week sees Mon+Tue — got ' + t.stats.week.total_min);
  assert.equal(t.stats.month.total_min, 0, 'the month starts Oct 1 — September minutes stay out');
});
