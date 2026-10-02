// The day plan — carryover, the deterministic fallback, the brain's JSON with validation, and
// the plan's message landing in the day's chat. Drives the real module under a fresh storage
// root per test.
import './_env.mjs'; // first
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshRoot, writeMd, getStorageRoot } from './helpers.mjs';
import { localDay, addDays } from '../backend/daytime.mjs';
import { readEvents } from '../backend/log.mjs';
import { readRecord } from '../backend/records.mjs';
import { getSession } from '../backend/chat.mjs';
import { ensurePlanned, workItems, normDay, todaySessionId } from '../backend/today.mjs';
import { saveSettings } from '../backend/store.mjs';

const STUB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'stub-brain.mjs');

// A work item, on disk the way records.mjs leaves it — tag + path both matching the query.
export function seedWork(id, data = {}, body = '') {
  const p = 'data/work/' + id + '.md';
  writeMd(path.join(getStorageRoot(), p), {
    tags: ['work'], title: data.title || id, bucket: 'seo', status: 'planned',
    estimate_min: 30, ...data,
  }, body);
  return p;
}

// A hand-written log day file — seeded work events without driving the clock. `lines` are raw
// event lines in the log's own `ts · actor · type · target · detail` format.
export function seedLogDay(utcDay, lines) {
  writeMd(path.join(getStorageRoot(), 'log', utcDay + '.md'), { type: 'log', date: utcDay },
    '# Activity · ' + utcDay + '\n\n' + lines.join('\n') + '\n');
}
export const workLine = (ts, detail, target = 'today/x', actor = 'crystal') =>
  `- ${ts} · ${actor} · work · ${target} · ${JSON.stringify(detail)}`;

const NOW = new Date(2026, 9, 2, 9, 30);          // a Friday, 9:30 local
const DAY = localDay(NOW);
const YESTERDAY = addDays(DAY, -1);
const dayOf = it => normDay(it.day);

test('ensurePlanned is idempotent — the second call is a no-op', async () => {
  freshRoot();
  seedWork(DAY + '-one', { title: 'One', day: DAY });
  const first = await ensurePlanned(NOW.getTime());
  assert.equal(first.planned, true);
  const second = await ensurePlanned(NOW.getTime() + 60000);
  assert.equal(second.already, true);
  const plans = readEvents({ limit: 5000, type: 'work' }).filter(e => e.detail && e.detail.action === 'plan');
  assert.equal(plans.length, 1);
});

test('yesterday\u2019s unfinished items carry into today, done items stay behind', async () => {
  freshRoot();
  seedWork(YESTERDAY + '-open', { title: 'Carried', day: YESTERDAY });
  seedWork(YESTERDAY + '-closed', { title: 'Yesterday done', day: YESTERDAY, status: 'done' });
  await ensurePlanned(NOW.getTime());
  const open = readRecord('data/work/' + YESTERDAY + '-open.md');
  assert.equal(normDay(open.data.day), DAY);
  const closed = readRecord('data/work/' + YESTERDAY + '-closed.md');
  assert.equal(normDay(closed.data.day), YESTERDAY);
});

test('with no brain the fallback plans deterministically: carryover first, then backlog by order, capped at dayMinutes', async () => {
  freshRoot();
  delete process.env.SCOUT_BRAIN_COMMAND;
  saveSettings({ dayMinutes: 100 });
  seedWork(YESTERDAY + '-carry', { title: 'Carried', day: YESTERDAY, estimate_min: 40 });
  seedWork('backlog-first', { title: 'Backlog A', estimate_min: 30, order: 1 });
  seedWork('backlog-second', { title: 'Backlog B', estimate_min: 30, order: 2 });
  seedWork('backlog-overflow', { title: 'Backlog C', estimate_min: 60, order: 3 }); // 40+30+30=100 fits; +60 does not
  const r = await ensurePlanned(NOW.getTime());
  assert.equal(r.source, 'fallback');
  const items = workItems();
  const inToday = items.filter(i => dayOf(i) === DAY).map(i => i.title).sort();
  assert.deepEqual(inToday, ['Backlog A', 'Backlog B', 'Carried'].sort());
  assert.ok(!dayOf(items.find(i => i.title === 'Backlog C')), 'Backlog C stays in the backlog');
});

test('a stub-brain plan is applied — order, adds, message — and invalid rows drop out', async () => {
  freshRoot();
  process.env.SCOUT_BRAIN_COMMAND = STUB;
  try {
    seedWork(DAY + '-a', { title: 'Alpha', day: DAY, estimate_min: 30 });
    seedWork('backlog-b', { title: 'Beta backlog', estimate_min: 20, order: 1 });
    process.env.SCOUT_BRAIN_REPLY = JSON.stringify({
      order: ['backlog-b', DAY + '-a', 'no-such-id'],
      add: [
        { title: 'Fresh thing', bucket: 'marketing', estimate_min: 45, why: 'launch', prep: true },
        { title: 'Bad bucket', bucket: 'nonsense', estimate_min: 30 },
        { title: 'Too big', bucket: 'seo', estimate_min: 9999 },
      ],
      message: 'Prioritise the backlog pull first.',
    });
    const r = await ensurePlanned(NOW.getTime());
    assert.equal(r.source, 'stub');
    const items = workItems().filter(i => dayOf(i) === DAY);
    const titles = items.map(i => i.title);
    assert.ok(titles.includes('Fresh thing'), 'valid add landed');
    assert.ok(!titles.includes('Bad bucket'), 'bad bucket dropped');
    assert.ok(!titles.includes('Too big'), 'oversized estimate dropped');
    const beta = items.find(i => i.title === 'Beta backlog');
    const alpha = items.find(i => i.title === 'Alpha');
    assert.equal(beta.order, 1);   // the model ordered the backlog pull first
    assert.equal(alpha.order, 2);
    assert.equal(beta.status, 'planned');
    assert.equal(dayOf(beta), DAY); // pulled out of the backlog into today
  } finally { delete process.env.SCOUT_BRAIN_COMMAND; delete process.env.SCOUT_BRAIN_REPLY; }
});

test('the dayMinutes cap returns the brain order\u2019s overflow to the backlog', async () => {
  freshRoot();
  process.env.SCOUT_BRAIN_COMMAND = STUB;
  try {
    saveSettings({ dayMinutes: 60 });
    seedWork(DAY + '-x', { title: 'X', day: DAY, estimate_min: 45 });
    seedWork(DAY + '-y', { title: 'Y', day: DAY, estimate_min: 45 });
    process.env.SCOUT_BRAIN_REPLY = JSON.stringify({ order: [DAY + '-x', DAY + '-y'], add: [], message: 'both' });
    await ensurePlanned(NOW.getTime());
    const items = workItems();
    assert.equal(items.find(i => i.title === 'X').order, 1);
    assert.ok(items.find(i => i.title === 'Y').order == null, 'Y exceeded the cap — no order assigned');
    assert.equal(dayOf(items.find(i => i.title === 'Y')), '', 'overflow must not still render or auto-start in Today');
  } finally { delete process.env.SCOUT_BRAIN_COMMAND; delete process.env.SCOUT_BRAIN_REPLY; }
});

test('fallback carryover also obeys the day cap and preserves overflow in the backlog', async () => {
  freshRoot(); saveSettings({ dayMinutes: 60 });
  seedWork('carry-a', { day: YESTERDAY, estimate_min: 45, order: 1 });
  seedWork('carry-b', { day: YESTERDAY, estimate_min: 45, order: 2 });
  await ensurePlanned(NOW.getTime());
  const items = workItems();
  assert.equal(items.filter(i => dayOf(i) === DAY).reduce((n, i) => n + i.estimate_min, 0), 45);
  assert.equal(dayOf(items.find(i => i.id === 'carry-b')), '');
});

test('a brain order cannot pull future work forward, and duplicate ids count once against the budget', async () => {
  freshRoot(); saveSettings({ dayMinutes: 60 });
  seedWork('a', { estimate_min: 30 });
  seedWork('b', { estimate_min: 30 });
  seedWork('later', { day: addDays(DAY, 2), estimate_min: 15 });
  process.env.SCOUT_BRAIN_COMMAND = STUB;
  process.env.SCOUT_BRAIN_REPLY = JSON.stringify({ order: ['a', 'a', 'b', 'later'], add: [], message: 'go' });
  try { await ensurePlanned(NOW.getTime()); }
  finally { delete process.env.SCOUT_BRAIN_COMMAND; delete process.env.SCOUT_BRAIN_REPLY; }
  const items = workItems();
  assert.deepEqual(items.filter(i => dayOf(i) === DAY).map(i => i.id).sort(), ['a', 'b']);
  assert.equal(dayOf(items.find(i => i.id === 'later')), addDays(DAY, 2));
});

test('the plan message lands in the day\u2019s chat as a conductor message, overnight line first', async () => {
  freshRoot();
  seedWork('backlog-solo', { title: 'Solo', estimate_min: 30, order: 1 });
  await ensurePlanned(NOW.getTime());
  const s = getSession(todaySessionId(DAY));
  assert.ok(s, 'today session exists');
  const msg = s.messages.find(mm => mm.meta && mm.meta.kind === 'conductor' && mm.meta.key === 'plan-' + DAY);
  assert.ok(msg, 'plan conductor message exists');
  assert.equal(msg.role, 'assistant');
  const first = msg.text.split('\n')[0];
  assert.match(first, /overnight|nothing written|waiting/i);
  assert.match(msg.text, /Solo|deterministically|No light agent/);
});

test('a second ensurePlanned posts no second plan message', async () => {
  freshRoot();
  seedWork('backlog-solo', { title: 'Solo', estimate_min: 30 });
  await ensurePlanned(NOW.getTime());
  await ensurePlanned(NOW.getTime() + 120000);
  const s = getSession(todaySessionId(DAY));
  const plans = s.messages.filter(mm => mm.meta && mm.meta.key === 'plan-' + DAY);
  assert.equal(plans.length, 1);
});

test('an in-flight plan belongs to its workspace and cannot block or mutate another root', async () => {
  freshRoot();
  seedWork('original', { title: 'Original task', day: DAY });
  const original = ensurePlanned(NOW.getTime());
  const rejected = assert.rejects(original, /workspace changed/);
  freshRoot();
  seedWork('new-root', { title: 'New workspace task' });
  const current = await ensurePlanned(NOW.getTime());
  await rejected;
  assert.equal(current.planned, true);
  assert.deepEqual(workItems().filter(i => dayOf(i) === DAY).map(i => i.id), ['new-root']);
  const session = getSession(todaySessionId(DAY));
  assert.ok(session.messages.every(message => !message.text.includes('Original task')));
});
