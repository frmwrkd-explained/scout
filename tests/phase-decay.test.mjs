// M3 · T10 step 1 — ONE staleness rule for the whole app (docs/03_MEMORY.md §4, Law 3).
//
// The load-bearing assertion in this file is the LAST one: that `backend/decay.mjs` is the only
// place in the backend that defines a staleness rule. Two rules means the row that renders fresh
// in the table is the row the cache dropped for being stale, and nobody can explain either.

import './_env.mjs'; // first — sets the storage root before store.mjs captures it
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TYPE_WINDOW, DEFAULT_WINDOW, staleness, isStale, ageDays, windowDays, agoLabel, daysUntil, dayOf,
} from '../backend/decay.mjs';

const DAY = 864e5;
const NOW = Date.parse('2026-08-19T12:00:00Z');
// A full timestamp, so a ratio assertion measures the rule and not the fact that a date-only
// frontmatter stamp means midnight. `dayOnly` covers the date-only case explicitly, below.
const daysAgo = n => new Date(NOW - n * DAY).toISOString();
const dayOnly = n => new Date(NOW - n * DAY).toISOString().slice(0, 10);

test('TYPE_WINDOW is exactly the table in docs/03_MEMORY.md §4', () => {
  assert.deepEqual(TYPE_WINDOW, { territory: 7, playbook: 30, learning: 90, record: 30 });
  assert.equal(DEFAULT_WINDOW, 30, 'anything unnamed decays on the record window');
});

test('staleness runs 0 → 1 across the type window and clamps at both ends', () => {
  const t = d => ({ type: 'territory', verified_at: daysAgo(d) });
  assert.equal(staleness(t(0), NOW), 0, 'verified today is not stale at all');
  assert.equal(Math.round(staleness(t(3.5), NOW) * 100) / 100, 0.5, 'half a 7-day window is 0.5');
  assert.equal(staleness(t(7), NOW), 1, 'at the window it is fully stale');
  assert.equal(staleness(t(700), NOW), 1, 'and it never exceeds 1');
  assert.equal(isStale(t(6), NOW), false);
  assert.equal(isStale(t(7), NOW), true, 'isStale is exactly staleness >= 1');
});

test('each type decays on its own window', () => {
  const at = (type, d) => staleness({ type, verified_at: daysAgo(d) }, NOW);
  assert.equal(at('territory', 8), 1);
  assert.ok(at('playbook', 8) < 1, 'a playbook claim is good for 30 days');
  assert.equal(at('playbook', 30), 1);
  assert.ok(at('learning', 60) < 1, 'a learning is good for 90');
  assert.equal(at('learning', 90), 1);
  assert.equal(at('record', 30), 1);
});

test('sweep_interval_days overrides the type window — the human beats the default', () => {
  const slow = { type: 'territory', verified_at: daysAgo(20), sweep_interval_days: 60 };
  assert.equal(windowDays(slow), 60);
  assert.ok(staleness(slow, NOW) < 1, 'a territory told to sweep every 60 days is fresh at 20');
  const fast = { type: 'playbook', verified_at: daysAgo(3), sweep_interval_days: 2 };
  assert.equal(isStale(fast, NOW), true, 'and a 2-day window makes a 3-day-old claim stale');
});

test('the date read is verified_at, then updated, then created', () => {
  assert.equal(ageDays({ type: 'record', verified_at: daysAgo(1), updated: daysAgo(10), created: daysAgo(99) }, NOW), 1);
  assert.equal(ageDays({ type: 'record', updated: daysAgo(10), created: daysAgo(99) }, NOW), 10);
  assert.equal(ageDays({ type: 'record', created: daysAgo(99) }, NOW), 99);
});

test('an object with no date at all is stale, never fresh', () => {
  // Treating an undated object as brand new is how dead ground stays in the cache forever.
  assert.equal(ageDays({ type: 'territory' }, NOW), Infinity);
  assert.equal(staleness({ type: 'territory' }, NOW), 1);
  assert.equal(isStale({}, NOW), true);
  assert.equal(agoLabel({ type: 'territory' }, NOW), 'never');
});

test('a goal decays against its own deadline, not a fixed window', () => {
  const goal = { type: 'goal', created: daysAgo(10), deadline: new Date(NOW + 10 * DAY).toISOString().slice(0, 10) };
  assert.equal(Math.round(windowDays(goal)), 20, 'the window is the span it was given');
  assert.equal(Math.round(staleness(goal, NOW) * 10) / 10, 0.5, 'halfway to the deadline is halfway through');
  const overdue = { type: 'goal', created: daysAgo(40), deadline: daysAgo(5) };
  assert.equal(staleness(overdue, NOW), 1);
  assert.equal(daysUntil(overdue.deadline, NOW), -5, 'and it says how many days it is overdue');
});

test('a re-verified goal keeps its deadline — verifying does not move the finish line', () => {
  const goal = { type: 'goal', created: daysAgo(18), deadline: new Date(NOW + 2 * DAY).toISOString().slice(0, 10), verified_at: daysAgo(0) };
  assert.ok(staleness(goal, NOW) > 0.8, 'still 90% elapsed however recently someone looked at it');
});

test('a date-only frontmatter stamp is read as that day at midnight', () => {
  // What gray-matter hands back for `verified_at: 2026-08-19` — the common case on disk.
  const t = { type: 'territory', verified_at: dayOnly(0) };
  assert.equal(agoLabel(t, NOW), 'today', 'it still reads as today');
  assert.ok(staleness(t, NOW) < 0.1, 'and it is nowhere near stale');
  assert.equal(isStale({ type: 'territory', verified_at: dayOnly(8) }, NOW), true);
});

test('agoLabel is the same age the staleness came from', () => {
  assert.equal(agoLabel({ type: 'territory', verified_at: daysAgo(0) }, NOW), 'today');
  assert.equal(agoLabel({ type: 'territory', verified_at: daysAgo(1) }, NOW), '1d ago');
  assert.equal(agoLabel({ type: 'territory', verified_at: daysAgo(12) }, NOW), '12d ago');
});

test('dayOf renders any frontmatter date as a plain YYYY-MM-DD', () => {
  // gray-matter parses an UNQUOTED yaml date into a real Date; interpolating that straight into a
  // string produced "Thu Jul 30 2026 02:00:00 GMT+0200 (…)" inside the agent's context file.
  assert.equal(dayOf(new Date(Date.UTC(2026, 6, 30))), '2026-07-30');
  assert.equal(dayOf('2026-07-30'), '2026-07-30');
  assert.equal(dayOf('2026-07-30T09:04:12.331Z'), '2026-07-30');
  assert.equal(dayOf(''), '', 'and nothing at all renders as nothing');
  assert.equal(dayOf(undefined), '');
});

test('decay.mjs is the ONLY staleness rule in the backend', () => {
  // docs/08 §2: "Never inline a second staleness rule anywhere." This is that sentence, enforced.
  const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'backend');
  const defines = /(?:function|const|let|var)\s+(?:staleness|isStale|computeStaleness|freshness)\b/;
  const offenders = fs.readdirSync(backend)
    .filter(f => f.endsWith('.mjs') && f !== 'decay.mjs' && !f.startsWith('._'))
    .filter(f => defines.test(fs.readFileSync(path.join(backend, f), 'utf8')));
  assert.deepEqual(offenders, [], 'these modules define a second staleness rule — import decay.mjs instead');
});
