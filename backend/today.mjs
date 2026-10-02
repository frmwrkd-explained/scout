// The Today loop — docs/09_TODAY_LOOP.md is the prose; this file is the machine copy.
//
// THE ONE RULE OF THIS MODULE: code drives, models only write. Everything in here that ORDERs,
// counts, clocks, nudges or decides "what's next" is arithmetic over the event log and the work
// collection. A model is invoked through brain.mjs only to WRITE — the plan's ordering choice,
// prepared material, a chat reply, a review narrative — and whatever it returns is validated
// and applied through records.mjs like everything else an agent writes.
//
// STORAGE (all file-backed, no database):
//   data/work/<id>.md              work items — a normal collection, so tables/boards/tags work
//   data/reviews/<id>.md           daily + weekly review documents
//   chat/today-<day>.md            one conductor session per local day (+ .messages.md transcript)
//   log/<day>.md                   'work' events — the clock is derived by REPLAYING these
//   .scout/collections/{work,review}.md  the two schemas, created here if a workspace lacks them
//
// WHY THE CLOCK IS EVENTS, NOT FIELDS: a "started_at" column rewrites history every pause; an
// append-only segment log cannot. Buckets freeze into the event's meta at start, so re-bucketing
// an item later does not rewrite last week.
import fs from 'node:fs';
import path from 'node:path';
import { getSettings, getStorageRoot, readMd, slugify, safe } from './store.mjs';
import { localDay, dayStartMs, addDays, weekStartDay, monthStartDay } from './daytime.mjs';
import { logEvent, readEvents } from './log.mjs';
import { upsertRecord, patchRecord, readRecord, DEFAULT_ACTOR, WORK_TRANSITION } from './records.mjs';
import { getCollection, saveCollection } from './collections.mjs';
import { documentsFor } from './documents.mjs';
import { renderCache, saveLearning, listGoals } from './memory.mjs';
import { listProposals } from './proposals.mjs';
import { listRuns } from './tasks.mjs';
import { createSession, getSession, locate, postConductor, registerExecutor } from './chat.mjs';
import { think, parseJsonBlock, usageToday, providersStatus, brainBudgetToday } from './brain.mjs';
import { onSchedulerTick } from './dispatch.mjs';
import { ensureWorkflowFields, workReadiness, validateWorkflow, assertCompletion, scheduleFollowup } from './workflow.mjs';

export class TodayError extends Error {
  constructor(msg, status = 400, extra = {}) { super(msg); this.status = status; Object.assign(this, extra); }
}

// Different windows and a chat turn can change the current item at the same time. Serialize the
// brief work mutations per workspace; model calls remain outside this queue.
const workMutationQueues = new Map();
function assertRoot(root) {
  if (getStorageRoot() !== root) throw new TodayError('workspace changed; retry this action', 409);
}
function serializeWork(fn, root = getStorageRoot()) {
  const prior = workMutationQueues.get(root) || Promise.resolve();
  const current = prior.catch(() => {}).then(() => {
    assertRoot(root);
    return fn();
  });
  workMutationQueues.set(root, current);
  current.finally(() => { if (workMutationQueues.get(root) === current) workMutationQueues.delete(root); }).catch(() => {});
  return current;
}

// ── the two collections ────────────────────────────────────────────────────────────────────────
// Canonical creation is `saveCollection` — the schema is validated the same way as one a human or
// an agent writes through the collections route, and the file lands in `.scout/collections/`.
export const WORK_BUCKETS = ['research', 'reading', 'seo', 'marketing', 'email', 'facebook-groups', 'reddit', 'admin'];

const WORK_SCHEMA = {
  id: 'work', label: 'Work', icon: 'check',
  query: { tag: 'work', path: 'data/work/**' },
  fields: [
    { key: 'title', type: 'text', primary: true, required: true },
    { key: 'bucket', type: 'select', options: WORK_BUCKETS },
    // NOT a gate: there is no pipeline border on your own afternoon — a status field is a board
    // column, not a promotion wall (docs/02_DATA_MODEL.md §2).
    { key: 'status', type: 'status', options: [
      { value: 'planned', label: 'Planned', colour: 'warn', group: 'todo' },
      { value: 'now', label: 'Now', colour: 'accent', group: 'active' },
      { value: 'done', label: 'Done', colour: 'ok', group: 'done' },
      { value: 'parked', label: 'Parked', colour: 'muted', group: 'todo' },
      { value: 'stuck', label: 'Stuck', colour: 'warn', group: 'todo' },
    ] },
    { key: 'day', type: 'date' },          // the day it is planned for; empty = backlog
    { key: 'order', type: 'number' },
    { key: 'estimate_min', type: 'number' },
    { key: 'why', type: 'text' },          // one line — the goal it serves
    { key: 'result', type: 'number' },     // what it produced, recorded at Done
    { key: 'result_note', type: 'text' },
    { key: 'prep', type: 'checkbox' },     // the brain should prepare material for it
    { key: 'prep_state', type: 'select', options: ['none', 'preparing', 'ready', 'failed'] },
  ],
  description: 'The Today loop\'s work items. `day` empty means backlog; `status` is where it is in the push.',
};

const REVIEW_SCHEMA = {
  id: 'review', label: 'Reviews', icon: 'clock',
  query: { tag: 'review', path: 'data/reviews/**' },
  fields: [
    { key: 'title', type: 'text', primary: true, required: true },
    { key: 'kind', type: 'select', options: ['daily', 'weekly'] },
    { key: 'period', type: 'text' },       // '2026-10-02' or week-start day
    { key: 'minutes', type: 'number' },
    { key: 'done', type: 'number' },
  ],
  description: 'Daily and weekly reviews written by the conductor. Numbers are computed by code; the agent writes the narrative.',
};

// Two stat+read calls per invocation — cheap enough for the 60s poll, and deliberately NOT cached:
// the storage root is what makes the answer true, and a cached "ensured" would outlive it.
export function ensureWorkCollections() {
  for (const schema of [WORK_SCHEMA, REVIEW_SCHEMA]) {
    if (!getCollection(schema.id)) {
      try {
        saveCollection(schema);
        logEvent({ type: 'schema', actor: 'conductor', target: '.scout/collections/' + schema.id + '.md',
          detail: { collection: schema.id, why: 'the Today loop creates its collections on first wake' } });
      } catch (e) {
        throw new TodayError('could not create the ' + schema.id + ' collection: ' + e.message, 500);
      }
    }
  }
  ensureWorkflowFields();
}

// ── reading work items ─────────────────────────────────────────────────────────────────────────
// A `day:` date in frontmatter comes back from gray-matter as a UTC-midnight Date; comparing it
// to a local day string through getFullYear() reads the day BEFORE in any negative-offset zone.
// Normalise through its UTC parts — the string it was authored as is the truth.
export function normDay(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m ? m[1] : '';
}

export function workItems() {
  const found = documentsFor('work');
  if (!found) return [];
  return found.documents.map(d => {
    const item = { id: d.slug, path: d.path, title: d.title, ...d.fields };
    // The UI and arithmetic must show the same default for hand-authored work without
    // an estimate. This is a read default; opening Today never fills the file's field.
    return { ...item, estimate_min: est(item) };
  });
}

const byId = items => { const m = {}; for (const i of items) m[i.id] = i; return m; };
const est = it => { const n = Number(it.estimate_min); return Number.isFinite(n) && n > 0 ? n : 30; };
const byOrder = (a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || String(a.title).localeCompare(String(b.title));
const isDone = it => it.status === 'done';

function itemById(id) {
  return workItems().find(i => i.id === id || i.path === String(id)) || null;
}

// ── work events — the clock ────────────────────────────────────────────────────────────────────
function workEvent(actor, item, detail) {
  return logEvent({ type: 'work', actor, target: item ? item.path : 'today/-', detail });
}

// Events are filed under their UTC day, so a local range reads one file either side of the span
// and filters by the real timestamp (docs/09_TODAY_LOOP.md §events).
export function workEventsIn(fromMs, toMs) {
  return readEvents({ limit: 50000, type: 'work', since: fromMs - 86400000 })
    .filter(ev => { const t = clockEventTime(ev); return t >= fromMs && t < toMs; })
    .sort((a, b) => clockEventTime(a) - clockEventTime(b));
}

// A delayed scheduler tick records when it observed the stop and the configured cutoff that
// closes the clock. Only Scout generates clock_at; model action fields never accept it.
const clockEventTime = ev => ev.detail?.action === 'stop' && Number.isFinite(ev.detail.clock_at)
  ? ev.detail.clock_at : Date.parse(ev.ts);

// ── pure time ──────────────────────────────────────────────────────────────────────────────────
// Replay start/pause/resume/stop into segments. A `start` or `resume` opens; `pause` and `stop`
// close (a stop carries outcome: done|parked|stuck|switched). An open segment runs to `now`. A
// segment crossing local midnight is split at it — the machine's calendar is the clock's calendar.
export function segmentsFromEvents(events, now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const closed = [];
  let open = null;
  for (const ev of events) {
    const m = ev.detail || {};
    const t = clockEventTime(ev);
    if (!Number.isFinite(t)) continue;
    if (m.action === 'start' || m.action === 'resume') {
      if (open) closed.push({ ...open, end: t, outcome: 'switched' });
      open = { id: m.id || null, path: ev.target, bucket: m.bucket || null, start: t };
    } else if (m.action === 'pause' || m.action === 'stop') {
      if (open && (!m.id || m.id === open.id)) {
        closed.push({ ...open, end: t, outcome: m.outcome || null, ...(m.result !== undefined ? { result: m.result } : {}) });
        open = null;
      } else if (m.action === 'stop' && m.outcome) {
        // Finishing a paused (or never clocked) item is still an outcome. It contributes no time
        // and must not close a different item's running segment.
        closed.push({ id: m.id || null, path: ev.target, bucket: m.bucket || null,
          start: t, end: t, outcome: m.outcome, ...(m.result !== undefined ? { result: m.result } : {}) });
      }
    }
  }
  if (open) closed.push({ ...open, end: nowMs, open: true });

  const out = [];
  for (const s of closed) {
    let cursor = s.start;
    if (s.end <= s.start) { out.push({ ...s, day: localDay(s.start), minutes: 0 }); continue; }
    while (cursor < s.end) {
      const cut = Math.min(s.end, dayStartMs(addDays(localDay(cursor), 1)));
      // `open` belongs to the last piece only — a segment split at midnight must not leave an
      // earlier piece claiming the clock is still running on yesterday.
      out.push({ ...s, start: cursor, end: cut, day: localDay(cursor), minutes: (cut - cursor) / 60000,
        outcome: cut === s.end ? s.outcome : null, open: !!s.open && cut >= s.end });
      cursor = cut;
    }
  }
  return out;
}

// rollup(segments, items, {from, to}) — minutes by bucket and by day, with `done` counting an
// item once (when its done-stop lands in range) and `results` summing THAT item's result field.
// `items` is { id: item } — segments carry no result field; the record is where it lives.
export function rollup(segments, items = {}, { from = null, to = null } = {}) {
  const get = id => (items instanceof Map ? items.get(id) : items[id]) || null;
  const inRange = s => (from == null || s.end > from) && (to == null || s.start < to);
  const clampMin = s => Math.max(0, Math.min(s.end, to ?? s.end) - Math.max(s.start, from ?? s.start)) / 60000;

  let total = 0;
  const byBucket = new Map(), byDay = new Map();
  for (const s of segments) {
    if (!inRange(s)) continue;
    const min = clampMin(s);
    if (!min) continue;
    total += min;
    const b = s.bucket || 'unbucketed';
    const br = byBucket.get(b) || { bucket: b, minutes: 0, done: 0, results: 0 };
    br.minutes += min; byBucket.set(b, br);
    const dr = byDay.get(s.day) || { day: s.day, minutes: 0, by_bucket: new Map() };
    dr.minutes += min;
    const db = dr.by_bucket.get(b) || { bucket: b, minutes: 0 };
    db.minutes += min; dr.by_bucket.set(b, db);
    byDay.set(s.day, dr);
  }

  // Done + results: the OUTCOME lives on the closing stop, so a segment carries its outcome and
  // an item is counted once, by the day its done-stop landed.
  const doneSeen = new Set();
  for (const s of segments) {
    if (s.outcome !== 'done' || doneSeen.has(s.id)) continue;
    if (from != null && s.end < from) continue;
    if (to != null && s.end >= to) continue;
    doneSeen.add(s.id);
    const b = s.bucket || 'unbucketed';
    const br = byBucket.get(b) || { bucket: b, minutes: 0, done: 0, results: 0 };
    br.done += 1;
    const it = get(s.id);
    // New stop events freeze results at completion. Old logs fall back to the record because
    // they did not capture a snapshot.
    br.results += Number(s.result !== undefined ? s.result : it?.result) || 0;
    byBucket.set(b, br);
  }

  return {
    total_min: Math.round(total),
    by_bucket: [...byBucket.values()].sort((a, b) => b.minutes - a.minutes || a.bucket.localeCompare(b.bucket))
      .map(r => ({ ...r, minutes: Math.round(r.minutes) })),
    by_day: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
      .map(r => ({ day: r.day, minutes: Math.round(r.minutes), by_bucket: [...r.by_bucket.values()].map(x => ({ ...x, minutes: Math.round(x.minutes) })).sort((a, b) => b.minutes - a.minutes) })),
  };
}

// ── the day's session ──────────────────────────────────────────────────────────────────────────
export const todaySessionId = day => 'today-' + day;

export function ensureTodaySession(day) {
  const id = todaySessionId(day);
  const existing = locate(id);
  if (existing) return getSession(id);
  return createSession({ id, title: 'Today · ' + day, executor: 'today', kind: 'today', mode: 'agent' });
}

// ── the overnight line ─────────────────────────────────────────────────────────────────────────
// The old Today screen's "three lines" (frontend/Today.jsx, overnightLines) compressed into the
// FIRST LINE of the morning plan message — same sources: runs, the event log, the open queue,
// goals. A morning with nothing to say says so; it does not invent a quiet night.
function overnightLine(now = Date.now()) {
  const t = now instanceof Date ? now : new Date(now);
  const d = new Date(t); d.setHours(0, 0, 0, 0);
  const since = d.getTime() - 6 * 3600 * 1000; // 18:00 yesterday evening
  const clause = [];

  let runs = [], events = [];
  try { runs = listRuns({ limit: 40 }).filter(r => { const s = Date.parse(String(r.started || '')); return Number.isFinite(s) && s >= since; }); } catch { /* not up */ }
  try { events = readEvents({ limit: 5000, since }); } catch { /* not up */ }
  if (runs.length) {
    const who = [...new Set(runs.map(r => r.assistant).filter(Boolean))];
    clause.push(runs.length + (runs.length === 1 ? ' run' : ' runs') + ' overnight' + (who.length ? ' (' + who.join(', ') + ')' : ''));
  } else {
    clause.push(events.length ? 'no runs overnight, but ' + events.length + ' changes landed' : 'no runs overnight');
  }
  const by = ty => events.filter(e => e.type === ty).length;
  const stored = by('store'), changed = by('update') + by('merge'), skipped = by('skip'), refused = by('refused') + by('quarantine');
  const bits = [];
  if (stored) bits.push(stored + ' new');
  if (changed) bits.push(changed + ' updated');
  if (skipped) bits.push(skipped + ' skipped');
  if (refused) bits.push(refused + ' refused at the gate');
  clause.push(bits.length ? bits.join(', ') : 'nothing written');
  try {
    const cards = listProposals({ status: 'open' }).length;
    const behind = listGoals({}).filter(g => g.behind).length;
    const w = [];
    if (cards) w.push(cards + (cards === 1 ? ' decision waits' : ' decisions wait'));
    if (behind) w.push(behind + (behind === 1 ? ' goal is' : ' goals are') + ' behind');
    clause.push(w.length ? w.join(' and ') : 'nothing waiting on you');
  } catch { clause.push('queue unavailable'); }
  return clause.join(' · ') + '.';
}

// ── planning ───────────────────────────────────────────────────────────────────────────────────
export function plannedToday(day) {
  return readEvents({ limit: 5000, type: 'work', since: dayStartMs(day) - 86400000 })
    .some(ev => ev.detail && ev.detail.action === 'plan' && ev.detail.day === day);
}

// What the model gets to choose from — and no more. A light-tier call's whole world is this
// prompt (brain.mjs §principle): backlog, carryover, the last week of minutes, the hot cache,
// yesterday's review. It returns JSON; nothing else it says is applied.
function planPrompt(day, carried, backlog, items, weekByBucket) {
  const lines = [];
  lines.push('You are the conductor of a work day. Choose the plan for ' + day + ' and reply with ONE json object and a short human message.');
  lines.push('Return EXACTLY this shape (a ```json fence is fine):');
  lines.push('{"order":["<item id>", "..."],"add":[{"title":"…","bucket":"…","estimate_min":30,"why":"…","prep":true,"goal_id":"…","destination":"…","done_when":"…"}],"message":"2-4 sentences to the human — what today is for."}');
  lines.push('Rules: order may only use ids listed below. bucket must be one of: ' + WORK_BUCKETS.join(', ') + '. estimate_min 5-240. At most 8 adds. Keep total planned minutes at or under ' + dayMinutes() + '.');
  if (carried.length) lines.push('', 'Carried over from yesterday (already in today — order them):', ...carried.map(i => '- ' + i.id + ' · ' + i.title + ' · ' + i.bucket + ' · ~' + est(i) + 'm' + (i.why ? ' · why: ' + i.why : '')));
  if (backlog.length) lines.push('', 'Backlog you may pull in:', ...backlog.slice(0, 30).map(i => '- ' + i.id + ' · ' + i.title + ' · ' + i.bucket + ' · ~' + est(i) + 'm' + (i.why ? ' · why: ' + i.why : '')));
  if (Object.keys(weekByBucket).length) lines.push('', 'Last 7 days, minutes by bucket:', JSON.stringify(weekByBucket));
  const cache = (() => { try { return renderCache({}); } catch { return ''; } })();
  if (cache) lines.push('', 'Memory hot cache:', cache);
  const review = reviewDoc('daily-' + addDays(day, -1));
  if (review) lines.push('', "Yesterday's daily review:", String(review.content || '').slice(0, 1500));
  return lines.join('\n');
}

function dayMinutes() { const n = Number(getSettings().dayMinutes); return Number.isFinite(n) && n > 0 ? n : 360; }
function reviewDoc(id) { try { return readRecord('data/reviews/' + id + '.md'); } catch { return null; } }

// Apply a brain plan answer. Returns { message } or null when the JSON is unusable — the caller
// then falls back deterministically rather than shipping a half-parsed plan.
async function applyPlanJson(j, day, items, root = getStorageRoot()) {
  if (!j || typeof j !== 'object' || !Array.isArray(j.order) || (j.add !== undefined && !Array.isArray(j.add))) return null;
  const cap = dayMinutes();
  const known = byId(items);
  const validBucket = b => WORK_BUCKETS.includes(b);

  let spent = 0, order = 0;
  // Items already in today (carried) always keep their place — carryover is not the model's call
  // to undo, only to order.
  const ordered = [], seen = new Set();
  const existing = items.filter(i => normDay(i.day) === day && !isDone(i)).sort(byOrder);
  const requested = [...j.order.map(String), ...existing.map(i => i.id)];
  for (const id of requested) {
    const it = known[id];
    if (!it || seen.has(id) || isDone(it) || (normDay(it.day) && normDay(it.day) !== day)
      || !workReadiness(it, items, day).ready) continue;
    seen.add(id);
    if (spent + est(it) > cap) continue;                   // the day cap is the law, not advice
    spent += est(it); ordered.push(it);
  }
  const adds = [].concat(j.add || []).slice(0, 8)
    .filter(a => a && String(a.title || '').trim() && validBucket(a.bucket)
      && Number(a.estimate_min) >= 5 && Number(a.estimate_min) <= 240);

  // Anything already planned for today that the model left out stays in the plan (carried) or —
  // if it was an unapplied overflow — is what it is; ordering only assigns positions.
  for (const it of ordered) {
    assertRoot(root);
    await patchRecord(it.path, { day, order: ++order, status: it.status === 'done' ? it.status : (it.status === 'now' ? 'now' : 'planned') }, { workTransition: WORK_TRANSITION, actor: 'conductor' });
  }
  // A carried or preplanned item that did not fit must leave Today; keeping its day field would
  // still render and auto-start it, even though no position was assigned.
  const selected = new Set(ordered.map(i => i.id));
  for (const it of existing) if (!selected.has(it.id) && workReadiness(it, items, day).ready) {
    assertRoot(root);
    await stopClocked(it, 'conductor', null);
    assertRoot(root);
    await patchRecord(it.path, { day: '', order: null, status: 'planned' }, { workTransition: WORK_TRANSITION, actor: 'conductor' });
  }
  for (const a of adds) {
    assertRoot(root);
    if (spent + Number(a.estimate_min) > cap) continue;
    let workflow;
    try { workflow = validateWorkflow(a, { id: day + '-' + slugify(a.title), items: workItems() }); }
    catch { continue; }
    spent += Number(a.estimate_min);
    upsertRecord({
      collection: 'work', id: day + '-' + slugify(a.title),
      title: String(a.title).trim(), bucket: a.bucket, estimate_min: Math.round(Number(a.estimate_min)), ...workflow,
      why: String(a.why || '').trim(), prep: !!a.prep, status: 'planned', day, order: ++order,
    }, { actor: 'conductor', via: 'today-plan' });
  }
  return { message: String(j.message || '').trim() || 'Planned ' + order + (order === 1 ? ' item' : ' items') + ' for today.' };
}

// The no-brain plan: carryover first, then backlog by `order`, until the day cap. Templated,
// deterministic, and honest — "no light agent connected" is a state, not a failure.
async function fallbackPlan(day, carried, items, root = getStorageRoot()) {
  const cap = dayMinutes();
  let spent = 0, order = 0;
  const picked = [];
  const today = items.filter(i => normDay(i.day) === day && !isDone(i) && workReadiness(i, items, day).ready).sort(byOrder);
  for (const it of today) {
    assertRoot(root);
    if (spent + est(it) > cap) {
      await stopClocked(it, 'conductor', null);
      assertRoot(root);
      await patchRecord(it.path, { day: '', order: null, status: 'planned' }, { workTransition: WORK_TRANSITION, actor: 'conductor' });
      continue;
    }
    spent += est(it); order = Math.max(order, Number(it.order) || 0); picked.push(it);
  }
  const pickedIds = new Set(picked.map(i => i.id));
  const backlog = items.filter(i => !normDay(i.day) && !isDone(i) && workReadiness(i, items, day).ready).sort(byOrder);
  for (const it of backlog) {
    assertRoot(root);
    if (pickedIds.has(it.id) || spent + est(it) > cap) continue;
    spent += est(it);
    await patchRecord(it.path, { day, status: 'planned', order: ++order }, { workTransition: WORK_TRANSITION, actor: 'conductor' });
    picked.push(it);
  }
  // Re-number the day so order means position, 1..n.
  let n = 0;
  for (const it of picked) if (Number(it.order) !== ++n) {
    assertRoot(root);
    await patchRecord(it.path, { order: n }, { workTransition: WORK_TRANSITION, actor: 'conductor' });
  }
  const lines = picked.map((it, i) => (i + 1) + '. ' + it.title + ' (' + it.bucket + ', ~' + est(it) + 'm)' + (it.why ? ' — ' + it.why : ''));
  const message = [
    'No light agent connected (Gemini/Devin/GPT) — planned deterministically: carryover first, then backlog in order.',
    '',
    ...lines,
    picked.length ? '' : null,
    picked.length ? 'Say the word in chat to reshuffle it.' : 'Nothing carried over and the backlog is empty — tell me what today is for.',
  ].filter(x => x !== null).join('\n');
  return { message, count: picked.length };
}

// One plan pass per day at a time — a double-fire is a no-op, not a race. The map is how
// getToday reports `planning` for THIS day even while another day's pass is still draining.
const planningByDay = new Map(); // root + day -> in-flight plan promise
const periodKey = (root, period) => JSON.stringify([root, period]);
export async function ensurePlanned(now = Date.now()) {
  const root = getStorageRoot();
  ensureWorkCollections();
  const day = localDay(now);
  if (plannedToday(day)) return { planned: false, already: true, day };
  const key = periodKey(root, day);
  const inflight = planningByDay.get(key);
  if (inflight) return inflight;
  const p = (async () => {
    try { return await planDay(day, now, root); } finally { planningByDay.delete(key); }
  })();
  planningByDay.set(key, p);
  return p;
}

async function planDay(day, now, root) {
  const session = ensureTodaySession(day);
  // 1 · carry over yesterday's unfinished work — not-done, whatever the status.
  const yesterday = addDays(day, -1);
  const carried = [];
  await serializeWork(async () => {
    for (const it of workItems()) {
      assertRoot(root);
      if (normDay(it.day) === yesterday && !isDone(it)) {
        await patchRecord(it.path, { day }, { workTransition: WORK_TRANSITION, actor: 'conductor' });
        carried.push({ ...it, day });
      }
    }
  }, root);
  assertRoot(root);
  // 2 · the lazy reviews — yesterday's daily, and Monday pulls last week's. Their failures can
  //    never cost the plan.
  try { await dailyReview(yesterday); } catch { /* a missing review must not stop the day */ }
  assertRoot(root);
  if (new Date(now).getDay() === 1) {
    try { await weeklyReview(weekStartDay(yesterday)); } catch { /* same */ }
    assertRoot(root);
  }
  // 3 · the brain, or the deterministic fallback.
  let items = workItems();
  const backlog = items.filter(i => !normDay(i.day) && !isDone(i) && workReadiness(i, items, day).ready).sort(byOrder);
  const weekAgo = dayStartMs(addDays(day, -7));
  const wk = rollup(segmentsFromEvents(workEventsIn(weekAgo, dayStartMs(day)), now), byId(items), { from: weekAgo, to: dayStartMs(day) });
  const weekByBucket = Object.fromEntries(wk.by_bucket.map(b => [b.bucket, b.minutes]));

  let message, source = 'fallback', count = 0;
  const res = await think({ purpose: 'plan', prompt: planPrompt(day, carried, backlog, items, weekByBucket) });
  assertRoot(root);
  return serializeWork(async () => {
  if (res.ok) {
    const applied = await applyPlanJson(parseJsonBlock(res.text), day, workItems(), root);
    assertRoot(root);
    if (applied) { message = applied.message; source = res.provider || 'brain'; }
  }
  if (!message) {
    const fb = await fallbackPlan(day, carried, workItems(), root);
    assertRoot(root);
    message = fb.message; count = fb.count;
  } else {
    count = workItems().filter(i => normDay(i.day) === day && !isDone(i)).length;
  }
  // 4 · the marker that makes this whole function idempotent.
  logEvent({ type: 'work', actor: 'conductor', target: 'today/' + day, detail: { action: 'plan', day, source, count } });
  // 5 · the plan message — the overnight line first, then the plan.
  postConductor(session.id, overnightLine(now) + '\n\n' + message, { key: 'plan-' + day });
  // 6 · prep ahead of the human: the first two prep-flagged items, two at a time.
  keepPrepAhead(day, now).catch(() => { /* prepared material is a nicety, never a blocker */ });
  return { planned: true, day, source, count };
  }, root);
}

// ── prepared material ──────────────────────────────────────────────────────────────────────────
// `## Prepared` is REPLACED, never appended — re-prep means the material is fresh, not piled up.
export function setPreparedSection(body, text) {
  const cur = String(body || '');
  const re = /\n?## Prepared\n[\s\S]*?(?=\n## |$)/;
  const section = '\n\n## Prepared\n\n' + String(text).trim() + '\n';
  if (re.test(cur)) return cur.replace(re, section).trimStart();
  return cur.trimEnd() + section;
}

let prepRunning = 0;
async function prepItem(item, now) {
  const root = getStorageRoot();
  prepRunning++;
  try {
    await patchRecord(item.path, { prep_state: 'preparing' }, { workTransition: WORK_TRANSITION, actor: 'conductor' });
    assertRoot(root);
    let body = '';
    try { body = readRecord(item.path).content || ''; } catch { /* summary it is */ }
    const cache = (() => { try { return renderCache({}); } catch { return ''; } })();
    const prompt = [
      'Prepare working material for this item — the notes, links and first steps the person needs to start it now. Markdown, terse, no preamble.',
      '', 'Item: ' + item.title, 'Bucket: ' + item.bucket + ' · estimate ~' + est(item) + 'm',
      item.why ? 'Why: ' + item.why : '', body ? 'Existing notes:\n' + body : '',
      cache ? '\nHot cache:\n' + cache : '',
    ].filter(x => x !== '').join('\n');
    const res = await think({ purpose: 'prep', prompt, timeoutMs: 180_000 });
    if (getStorageRoot() !== root) return;
    if (res.ok) {
      // Preparation may take minutes. Preserve any notes the person added while it was running.
      const current = readRecord(item.path).content || '';
      await patchRecord(item.path, { prep_state: 'ready', body: setPreparedSection(current, res.text) }, { workTransition: WORK_TRANSITION, actor: 'conductor' });
    } else {
      await patchRecord(item.path, { prep_state: 'failed' }, { workTransition: WORK_TRANSITION, actor: 'conductor' });
    }
  } finally { prepRunning--; }
}

// Keep two prepared items queued ahead of `now` — the person should never wait on the brain.
async function keepPrepAhead(day, now) {
  const root = getStorageRoot();
  const allItems = workItems();
  const items = allItems.filter(i => normDay(i.day) === day && !isDone(i)).sort(byOrder);
  const nowIx = items.findIndex(i => i.status === 'now');
  const ahead = items.slice(Math.max(0, nowIx)).filter(i => i.prep && i.prep_state !== 'ready' && i.prep_state !== 'preparing'
    && workReadiness(i, allItems, day).ready);
  for (const it of ahead.slice(0, Math.max(0, 2 - prepRunning))) {
    assertRoot(root);
    await prepItem(it, now);
    assertRoot(root);
    if (prepRunning >= 2) break;
  }
}

// ── nudges ─────────────────────────────────────────────────────────────────────────────────────
// Pure rules over the same state getToday computes — no model, templated text, each with a stable
// key so the poll can post once a day (postConductor dedupes on meta.key).
export function computeNudges({ items, segs, events, day, now }) {
  const out = [];
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const known = byId(items);
  const open = segs.find(s => s.open);

  // 1 · over estimate by ≥50% AND ≥10 min
  if (open) {
    const it = known[open.id];
    const estMin = it ? est(it) : 30;
    const actual = segs.filter(s => s.id === open.id && s.day === day).reduce((n, s) => n + s.minutes, 0);
    const over = actual - estMin;
    if (over >= 10 && actual >= estMin * 1.5) {
      out.push({ key: 'over-' + open.id, text: 'You\u2019re ' + Math.round(over) + ' min over on ' + (it ? it.title : open.id) + '. Done, stuck, or should I split it?' });
    }
  }
  // 2 · a bucket today over 1.5× its planned minutes
  const planned = items.filter(i => normDay(i.day) === day);
  const plannedByBucket = {};
  for (const it of planned) plannedByBucket[it.bucket] = (plannedByBucket[it.bucket] || 0) + est(it);
  const actualByBucket = {};
  for (const s of segs) if (s.day === day) actualByBucket[s.bucket || 'unbucketed'] = (actualByBucket[s.bucket || 'unbucketed'] || 0) + s.minutes;
  for (const [b, plannedMin] of Object.entries(plannedByBucket)) {
    const actual = actualByBucket[b] || 0;
    if (plannedMin > 0 && actual > plannedMin * 1.5) {
      out.push({ key: 'bucket-' + b, text: b + ' has taken ' + (actual / 60).toFixed(1) + 'h today vs ' + Math.round(plannedMin) + 'm planned.' });
    }
  }
  // 3 · paused > 15 min with an active item (status 'now', last event for it a pause)
  const nowItem = items.find(i => i.status === 'now' && normDay(i.day) === day);
  if (nowItem && !open) {
    const last = [...events].reverse().find(ev => ev.detail && ev.detail.id === nowItem.id);
    if (last && last.detail.action === 'pause' && nowMs - Date.parse(last.ts) > 15 * 60000) {
      out.push({ key: 'paused-' + nowItem.id, text: 'Paused on ' + nowItem.title + ' for ' + Math.round((nowMs - Date.parse(last.ts)) / 60000) + ' min \u2014 park it or pick it back up?' });
    }
  }
  // 4 · three or more parks today
  const parkedToday = events.filter(ev => ev.detail && ev.detail.action === 'stop' && ev.detail.outcome === 'parked').length;
  if (parkedToday >= 3) {
    out.push({ key: 'parked', text: parkedToday + ' things parked today \u2014 want me to re-plan the afternoon?' });
  }
  return out;
}

// ── getToday ───────────────────────────────────────────────────────────────────────────────────
export async function getToday(now = Date.now()) {
  ensureWorkCollections();
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const day = localDay(nowMs);
  const items = workItems();
  const known = byId(items);

  const plan = items.filter(i => normDay(i.day) === day).sort(byOrder);
  const backlog = items.filter(i => !normDay(i.day) && !isDone(i)).sort(byOrder);
  for (const item of [...plan, ...backlog]) {
    if (!isDone(item)) item.wait_reason = workReadiness(item, items, day).reason || '';
  }

  // One event read covers the whole window any rollup can need — the earliest of this week's
  // Monday and this month's 1st (a week can start in the previous month), minus the one-day
  // margin that makes UTC-named log files line up with local days. Segments are built once and
  // rolled up three ways.
  const mFrom = Math.min(dayStartMs(weekStartDay(day)), dayStartMs(monthStartDay(day))) - 86400000;
  const events = workEventsIn(mFrom, nowMs + 1);
  const segs = segmentsFromEvents(events, nowMs);
  const stats = {
    today: rollup(segs, known, { from: dayStartMs(day), to: nowMs }),
    week: rollup(segs, known, { from: dayStartMs(weekStartDay(day)), to: nowMs }),
    month: rollup(segs, known, { from: dayStartMs(monthStartDay(day)), to: nowMs }),
  };
  // Today's own events/nudges come from the local day slice.
  const dayFrom = dayStartMs(day);
  const todaySegs = segs.filter(s => s.start >= dayFrom || s.open);
  const todayEvents = events.filter(ev => Date.parse(ev.ts) >= dayFrom);
  const open = segs.find(s => s.open) || null;
  // Per-item actual minutes today — the plan column's "estimate vs actual" pair.
  const minToday = {};
  for (const s of todaySegs) if (s.id) minToday[s.id] = (minToday[s.id] || 0) + s.minutes;
  for (const it of plan) it.min_today = Math.round(minToday[it.id] || 0);

  const nowItem = (open && known[open.id]) || plan.find(i => i.status === 'now') || null;
  const next = plan.find(i => i.status === 'planned' && workReadiness(i, items, day).ready) || null;

  // Nudges wait for the plan: the morning plan message is the day's first word, and a nudge
  // posted before it lands both out of order and without a plan to nudge about. Until the day's
  // `plan` event exists — while ensurePlanned is in flight or hasn't fired — nudges are [].
  const isPlanned = plannedToday(day);
  const nudges = isPlanned ? computeNudges({ items, segs: todaySegs, events: todayEvents, day, now: nowMs }) : [];
  // The poll posts: a nudge shows up in the thread once, keyed for the day.
  if (nudges.length) {
    const sid = ensureTodaySession(day).id;
    for (const n of nudges) postConductor(sid, n.text, { key: 'nudge-' + day + '-' + n.key });
  }

  let needs_you = 0;
  try { needs_you = listProposals({ status: 'open' }).length; } catch { /* queue not up */ }
  const reviews = (documentsFor('review')?.documents || [])
    .sort((a, b) => String(b.fields.period || '').localeCompare(String(a.fields.period || ''))).slice(0, 8)
    .map(d => ({ id: d.slug, path: d.path, title: d.title, kind: d.fields.kind, period: d.fields.period }));

  return {
    day,
    planned: isPlanned,
    planning: planningByDay.has(periodKey(getStorageRoot(), day)),
    plan, now: nowItem ? { ...nowItem, clock: open && open.id === nowItem.id
      ? { running: true, started: open.start, elapsed_min: Math.round((nowMs - open.start) / 60000) }
      : { running: false, elapsed_min: 0 } } : null,
    next, backlog, backlog_count: backlog.length,
    nudges, stats, usage: usageToday(nowMs), budget: brainBudgetToday(nowMs), needs_you,
    chat: todaySessionId(day),
    buckets: WORK_BUCKETS,
    reviews,
    settings: (({ dayStart, dayEnd, dayMinutes, brainDailyLimits }) => ({ dayStart, dayEnd, dayMinutes, brainDailyLimits }))(getSettings()),
    providers: await providersStatus(),
    goals: listGoals({}),
  };
}

// ── the push ───────────────────────────────────────────────────────────────────────────────────
// One thing is current; the clock follows it; finishing hands you the next.

// The clock reads one day back as well as today — a segment opened before midnight still has its
// start event in yesterday's file, and a clock that "doesn't know" about it would run it forever.
const clockSegs = nowMs => segmentsFromEvents(workEventsIn(dayStartMs(localDay(nowMs)) - 86400000, nowMs + 1), nowMs);

async function startItem(id, { actor = DEFAULT_ACTOR } = {}) {
  ensureWorkCollections();
  const item = itemById(id);
  if (!item) throw new TodayError('no work item "' + id + '"', 404);
  if (isDone(item)) throw new TodayError('completed work cannot be started again', 400);
  const nowMs = Date.now();
  const day = localDay(nowMs);
  const readiness = workReadiness(item, workItems(), day);
  if (!readiness.ready) throw new TodayError(readiness.reason || 'this item is waiting', 409);
  const open = clockSegs(nowMs).find(s => s.open);
  // Only one item is ever active — starting B writes A's stop first, outcome 'switched'.
  if (open && open.id !== item.id) {
    const prior = itemById(open.id);
    workEvent(actor, prior || { id: open.id, path: open.path, bucket: open.bucket }, { action: 'stop', id: open.id, bucket: open.bucket, outcome: 'switched' });
  }
  // A paused item has no open segment but remains Now. Clear every prior current item before
  // selecting the next so advance() and Resume cannot pick a stale one.
  for (const prior of workItems().filter(i => i.id !== item.id && i.status === 'now')) {
    await patchRecord(prior.path, { status: 'planned' }, { workTransition: WORK_TRANSITION, actor });
  }
  if (!open || open.id !== item.id) workEvent(actor, item, { action: 'start', id: item.id, bucket: item.bucket });
  if (item.status !== 'now' || normDay(item.day) !== day) {
    await patchRecord(item.path, { status: 'now', day }, { workTransition: WORK_TRANSITION, actor });
  }
  keepPrepAhead(day, nowMs).catch(() => {});
  return item;
}

// Pull the next thing: first planned item of the day by order, else the next backlog item (which
// is pulled INTO today), else null + the conductor asks what the afternoon is for.
async function advance(actor) {
  const nowMs = Date.now();
  const day = localDay(nowMs);
  const items = workItems();
  const running = items.find(i => i.status === 'now' && normDay(i.day) === day);
  if (running) return running;   // already advanced — a double-done is not two starts
  const next = items.filter(i => normDay(i.day) === day && i.status === 'planned' && workReadiness(i, items, day).ready).sort(byOrder)[0]
    || items.filter(i => !normDay(i.day) && !isDone(i) && workReadiness(i, items, day).ready).sort(byOrder)[0] || null;
  if (!next) {
    const session = ensureTodaySession(day);
    postConductor(session.id, 'Plan\u2019s clear and the backlog is empty \u2014 tell me what today is for, or I can leave the clock off.', { key: 'empty-' + day });
    return null;
  }
  await startItem(next.id, { actor });
  return itemById(next.id);
}

async function stopClocked(item, actor, outcome, extra = {}) {
  const segs = clockSegs(Date.now());
  const open = segs.find(s => s.open);
  const last = [...segs].reverse().find(s => s.id === item.id);
  const bucket = open?.id === item.id ? open.bucket : (last?.bucket || item.bucket);
  if (open && open.id === item.id) {
    workEvent(actor, item, { action: 'stop', id: item.id, bucket, ...(outcome ? { outcome } : {}), ...extra });
    return true;
  }
  if (outcome) workEvent(actor, item, { action: 'stop', id: item.id, bucket, outcome, ...extra });
  return false;
}

async function pauseItem({ actor = DEFAULT_ACTOR } = {}) {
  const open = clockSegs(Date.now()).find(s => s.open);
  if (!open) return { paused: false };
  const item = itemById(open.id) || { id: open.id, path: open.path, bucket: open.bucket };
  workEvent(actor, item, { action: 'pause', id: open.id, bucket: open.bucket });
  return { paused: true, id: open.id };
}

async function resumeItem({ actor = DEFAULT_ACTOR } = {}) {
  const day = localDay();
  const items = workItems();
  const paused = items.find(i => i.status === 'now' && normDay(i.day) === day);
  if (!paused) return { resumed: false };
  const readiness = workReadiness(paused, items, day);
  if (!readiness.ready) throw new TodayError(readiness.reason || 'this item is waiting', 409);
  if (clockSegs(Date.now()).find(s => s.open)) return { resumed: false, already: true };
  workEvent(actor, paused, { action: 'resume', id: paused.id, bucket: paused.bucket });
  return { resumed: true, id: paused.id };
}

async function stopItem(id, { actor = DEFAULT_ACTOR } = {}) {
  const item = itemById(id);
  if (!item) throw new TodayError('no work item "' + id + '"', 404);
  const clocked = await stopClocked(item, actor, null);
  if (item.status === 'now') await patchRecord(item.path, { status: 'planned' }, { workTransition: WORK_TRANSITION, actor });
  return { stopped: clocked || item.status === 'now' };
}

async function doneItem(id, { result = undefined, result_note = undefined, actor = DEFAULT_ACTOR } = {}) {
  const item = itemById(id);
  if (!item) throw new TodayError('no work item "' + id + '"', 404);
  if (isDone(item)) return { next: await advance(actor) };
  const readiness = workReadiness(item, workItems(), localDay());
  if (!readiness.ready) throw new TodayError(readiness.reason || 'this item is waiting', 409);
  validateWorkflow(item, { id: item.id, items: workItems() });
  assertCompletion(item, result_note);
  const patch = { status: 'done' };
  if (result !== undefined && result !== null && result !== '') {
    const n = Number(result);
    if (!Number.isFinite(n) || n < 0) throw new TodayError('result must be a non-negative number', 400);
    patch.result = n;
  }
  if (result_note !== undefined && result_note !== null && result_note !== '') patch.result_note = String(result_note);
  await stopClocked(item, actor, 'done', { result: patch.result ?? (Number(item.result) || 0) });
  await patchRecord(item.path, patch, { workTransition: WORK_TRANSITION, actor });
  const followup = await scheduleFollowup(item, { actor, now: Date.now() });
  if (followup) {
    postConductor(ensureTodaySession(localDay()).id, 'Follow-up scheduled: ' + (followup.title || item.follow_up_title || item.title), { key: 'followup-' + item.id });
  }
  return { next: await advance(actor) };
}

async function parkItem(id, { actor = DEFAULT_ACTOR } = {}) {
  const item = itemById(id);
  if (!item) throw new TodayError('no work item "' + id + '"', 404);
  if (isDone(item)) throw new TodayError('completed work cannot be parked', 400);
  if (item.status === 'parked') return { next: await advance(actor) };
  await stopClocked(item, actor, 'parked');
  if (item.status !== 'parked') await patchRecord(item.path, { status: 'parked' }, { workTransition: WORK_TRANSITION, actor });
  return { next: await advance(actor) };
}

async function stuckItem(id, { reason, actor = DEFAULT_ACTOR } = {}) {
  const root = getStorageRoot();
  const why = String(reason || '').trim();
  if (!why) throw new TodayError('stuck needs a reason — say what is blocking it', 400);
  const item = itemById(id);
  if (!item) throw new TodayError('no work item "' + id + '"', 404);
  await stopClocked(item, actor, 'stuck', { reason: why });
  if (item.status !== 'stuck') await patchRecord(item.path, { status: 'stuck' }, { workTransition: WORK_TRANSITION, actor });
  const day = localDay();
  const session = ensureTodaySession(day);
  postConductor(session.id, 'Stuck on ' + item.title + ': ' + why, { key: 'stuck-' + day + '-' + item.id });
  // The conductor offers an unblock when a light agent is on — honestly silent when it is not.
  think({ purpose: 'chat', prompt: [
    'The human is stuck on a work item and said why. Offer ONE concrete unblock suggestion, or a',
    'split into 2-4 smaller items as an action block ({"actions":[{"type":"split_item","id":"' + item.id + '","into":[{"title","bucket","estimate_min"}]}]}).',
    'Item: ' + item.title + ' (' + item.bucket + ')', 'Blocked on: ' + why, 'Reply in 1-3 sentences.',
  ].join('\n') }).then(res => {
    if (!res.ok || getStorageRoot() !== root) return;
    postConductor(session.id, res.text);
  }).catch(() => {});
  return { next: await advance(actor) };
}

async function addItem(input, { actor = DEFAULT_ACTOR } = {}) {
  const { title, bucket, estimate_min, day = null, why = '', prep = false } = input;
  ensureWorkCollections();
  const t = String(title || '').trim();
  if (!t) throw new TodayError('an item needs a title', 400);
  if (bucket && !WORK_BUCKETS.includes(bucket)) throw new TodayError('"' + bucket + '" is not a bucket — one of ' + WORK_BUCKETS.join(' · '), 400);
  const hasEstimate = estimate_min !== undefined && estimate_min !== null && estimate_min !== '';
  const estN = Number(estimate_min);
  if (hasEstimate && (!Number.isFinite(estN) || estN < 5 || estN > 240)) {
    throw new TodayError('estimate_min is 5–240', 400);
  }
  const forDay = day === null || day === undefined || day === '' ? localDay() : normDay(day);
  if (!forDay || localDay(dayStartMs(forDay)) !== forDay) throw new TodayError('day must be a real YYYY-MM-DD date');
  const id = (forDay || 'backlog') + '-' + slugify(t);
  const workflow = validateWorkflow(input, { id, items: workItems() });
  const order = (workItems().filter(i => normDay(i.day) === forDay).reduce((m, i) => Math.max(m, Number(i.order) || 0), 0)) + 1;
  const r = upsertRecord({
    collection: 'work', id, title: t, bucket: bucket || 'admin', status: 'planned', ...workflow,
    ...(forDay ? { day: forDay } : {}), order,
    estimate_min: hasEstimate ? Math.round(estN) : 30,
    ...(why ? { why: String(why) } : {}), prep: !!prep, prep_state: 'none',
  }, { actor, via: 'today-add' });
  return r;
}

async function reorderItems(ids, { actor = DEFAULT_ACTOR } = {}) {
  const day = localDay();
  const today = new Set(workItems().filter(i => normDay(i.day) === day).map(i => i.id));
  let n = 0;
  for (const id of [].concat(ids || []).map(String)) {
    if (!today.has(id)) continue;
    const it = itemById(id);
    if (it) await patchRecord(it.path, { order: ++n }, { workTransition: WORK_TRANSITION, actor });
  }
  return { order: n };
}

// ── the conductor's executor ───────────────────────────────────────────────────────────────────
// One reply per human turn: context → light-tier think → validate any action block → strip it →
// receipts. No tools, no session state the files don't already hold.
const WORKFLOW_FIELDS = ['goal_id', 'key_result', 'destination', 'done_when', 'depends_on', 'not_before', 'follow_up_days', 'follow_up_title'];
const ACTION_FIELDS = { update_item: ['title', 'bucket', 'estimate_min', 'order', 'why', ...WORKFLOW_FIELDS] };

function stripJson(text) {
  return String(text || '').replace(/```(?:json)?\s*\n?[\s\S]*?```/g, '').trim();
}

async function applyChatActions(actions, day) {
  const receipts = [], dropped = [];
  const apply = async (a, label, fn) => { try { await fn(); receipts.push(label); } catch (e) { dropped.push(label + ' (' + e.message + ')'); } };
  for (const raw of actions.slice(0, 10)) {
    const a = raw || {};
    const type = String(a.type || '');
    const it = a.id ? itemById(a.id) : null;
    if (a.id && !it) { dropped.push('unknown item "' + a.id + '"'); continue; }
    if (['update_item', 'park_item', 'split_item', 'move_to_tomorrow'].includes(type)
      && (!it || normDay(it.day) !== day || isDone(it))) {
      dropped.push(type + ' needs an unfinished item in this day\'s plan'); continue;
    }
    switch (type) {
      case 'add_item': {
        if (!String(a.title || '').trim()) { dropped.push('add_item without a title'); break; }
        if (a.bucket && !WORK_BUCKETS.includes(a.bucket)) { dropped.push('add_item with unknown bucket "' + a.bucket + '"'); break; }
        await apply(a, 'Added: ' + a.title, () => addItem(
          { ...a, bucket: a.bucket || 'admin', day }, { actor: 'conductor' }));
        break;
      }
      case 'update_item': {
        const fields = {};
        for (const k of ACTION_FIELDS.update_item) if (a.fields && a.fields[k] !== undefined) fields[k] = a.fields[k];
        if (fields.bucket && !WORK_BUCKETS.includes(fields.bucket)) { dropped.push('update_item with unknown bucket "' + fields.bucket + '"'); break; }
        if (!Object.keys(fields).length) { dropped.push('update_item with nothing to change'); break; }
        await apply(a, 'Updated: ' + it.title, async () => {
          if (fields.title !== undefined && !String(fields.title || '').trim()) throw new TodayError('an item needs a title');
          if (fields.bucket !== undefined && !WORK_BUCKETS.includes(fields.bucket)) throw new TodayError('unknown bucket');
          if (fields.estimate_min !== undefined && (!Number.isFinite(Number(fields.estimate_min)) || Number(fields.estimate_min) < 5 || Number(fields.estimate_min) > 240)) throw new TodayError('estimate_min is 5–240');
          if (fields.order !== undefined && (!Number.isInteger(Number(fields.order)) || Number(fields.order) < 1)) throw new TodayError('order must be a positive integer');
          const workflow = validateWorkflow({ ...it, ...fields }, { id: it.id, items: workItems() });
          await patchRecord(it.path, { ...fields, ...workflow }, { workTransition: WORK_TRANSITION, actor: 'conductor' });
        });
        break;
      }
      case 'park_item':
        await apply(a, 'Parked: ' + it.title, () => parkItem(it.id, { actor: 'conductor' }));
        break;
      case 'split_item': {
        const into = Array.isArray(a.into) ? a.into : [];
        if (!into.length) { dropped.push('split_item with no parts'); break; }
        await apply(a, 'Split ' + it.title + ' into ' + into.length, async () => {
          if (into.length > 6) throw new TodayError('split_item allows at most 6 parts');
          const ids = new Set();
          // Validate the whole split before creating its first part; a bad second part must not
          // leave half of a split behind while the original clock continues running.
          for (const part of into) {
            if (!part || !String(part.title || '').trim()) throw new TodayError('every split part needs a title');
            if (part.bucket !== undefined && !WORK_BUCKETS.includes(part.bucket)) throw new TodayError('split_item with unknown bucket');
            if (part.estimate_min !== undefined && (!Number.isFinite(Number(part.estimate_min)) || Number(part.estimate_min) < 5 || Number(part.estimate_min) > 240)) throw new TodayError('estimate_min is 5–240');
            const id = day + '-' + slugify(part.title);
            if (ids.has(id) || itemById(id)) throw new TodayError('split parts need unique new titles');
            ids.add(id);
            validateWorkflow({ goal_id: it.goal_id, key_result: it.key_result, destination: it.destination, done_when: it.done_when, ...part }, { id, items: workItems() });
          }
          const base = workItems().filter(i => normDay(i.day) === day).reduce((m, i) => Math.max(m, Number(i.order) || 0), Number(it.order) || 0);
          let n = base;
          for (const part of into) {
            await addItem({ goal_id: it.goal_id, key_result: it.key_result, destination: it.destination, done_when: it.done_when,
              ...part, bucket: part.bucket || it.bucket || 'admin', day, why: it.why }, { actor: 'conductor' });
            const created = itemById(day + '-' + slugify(part.title));
            if (created) await patchRecord(created.path, { order: ++n }, { workTransition: WORK_TRANSITION, actor: 'conductor' });
          }
          await stopClocked(it, 'conductor', 'switched');
          await patchRecord(it.path, { status: 'parked' }, { workTransition: WORK_TRANSITION, actor: 'conductor' });
          if (it.status === 'now') await advance('conductor');
        });
        break;
      }
      case 'move_to_tomorrow': {
        const tomorrow = addDays(day, 1);
        await apply(a, 'Moved to tomorrow: ' + it.title, async () => {
          await stopClocked(it, 'conductor', 'switched');
          await patchRecord(it.path, { day: tomorrow, status: 'planned' }, { workTransition: WORK_TRANSITION, actor: 'conductor' });
          if (it.status === 'now') await advance('conductor');
        });
        break;
      }
      default: dropped.push('unknown action "' + type + '"');
    }
  }
  return { receipts, dropped };
}

async function todayExecutor({ session, history, userText, emit }) {
  const root = getStorageRoot();
  const m = /^today-(\d{4}-\d{2}-\d{2})$/.exec(String(session.id || ''));
  const day = m ? m[1] : localDay();
  ensureWorkCollections();
  const nowMs = Date.now();
  const items = workItems();
  const plan = items.filter(i => normDay(i.day) === day).sort(byOrder);
  const dayFrom = dayStartMs(day);
  const evs = workEventsIn(dayFrom, nowMs + 1);
  const segs = segmentsFromEvents(evs, nowMs);
  const st = rollup(segs, byId(items), { from: dayFrom, to: nowMs });
  const nowItem = plan.find(i => i.status === 'now') || null;
  let prepared = '';
  if (nowItem) {
    try {
      const rec = readRecord(nowItem.path);
      const pm = /## Prepared\n([\s\S]*?)(?=\n## |$)/.exec(rec.content || '');
      prepared = pm ? pm[1].trim() : '';
    } catch { /* none */ }
  }
  const cache = (() => { try { return renderCache({}); } catch { return ''; } })();
  const prompt = [
    'You are the conductor inside Scout\u2019s Today screen \u2014 terse, concrete, action-first. The human wrote the last line.',
    'Today\u2019s plan (id · status · bucket · est · title):',
    ...plan.map(i => '- ' + i.id + ' · ' + i.status + ' · ' + i.bucket + ' · ~' + est(i) + 'm · ' + i.title),
    'Now item: ' + (nowItem ? nowItem.title + ' (' + nowItem.id + ')' : 'none'),
    prepared ? 'Prepared material for the now item:\n' + prepared : '',
    nowItem ? 'Current handoff: ' + JSON.stringify(Object.fromEntries(WORKFLOW_FIELDS.filter(k => nowItem[k] !== undefined).map(k => [k, nowItem[k]]))) : '',
    'Today so far: ' + st.total_min + ' min tracked · by bucket: ' + st.by_bucket.map(b => b.bucket + ' ' + b.minutes + 'm').join(', '),
    cache ? 'Hot cache:\n' + cache : '',
    'If the human asks for a change to the plan, include ONE ```json block with an actions array. Legal actions: {"type":"add_item","title":"…","bucket":"…","estimate_min":30,"why":"…"} · {"type":"update_item","id":"…","fields":{"title":"…"|"bucket":"…"|"estimate_min":30|"order":1|"why":"…"}} · {"type":"park_item","id":"…"} · {"type":"split_item","id":"…","into":[{"title":"…","bucket":"…","estimate_min":30}]} · {"type":"move_to_tomorrow","id":"…"}. Only use ids from the plan above; only buckets: ' + WORK_BUCKETS.join(', ') + '.',
    'Add and update may also set goal_id (an existing goal), key_result, destination (where the work goes), done_when (completion evidence), depends_on (existing work IDs), not_before (YYYY-MM-DD), follow_up_days (1-365), follow_up_title. Help the human implement the approved material and measure its result. Never claim that anything was sent or deployed from this chat: you only have these plan actions.',
    '',
    'Recent thread:',
    ...history.slice(-12).map(h => h.role + ': ' + String(h.text || '').slice(0, 400)),
    'human: ' + String(userText || ''),
    'conductor:',
  ].filter(x => x !== '').join('\n');

  const res = await think({ purpose: 'chat', prompt });
  assertRoot(root);
  if (!res.ok) {
    const text = res.provider
      ? 'The light agent (' + res.provider + ') did not answer \u2014 ' + res.reason + '. I can still track and plan.'
      : 'No light agent connected (Gemini/Devin/GPT) \u2014 I can still track and plan, but not chat.';
    emit({ type: 'text-delta', text });
    return { text, directives: [], cost: 0 };
  }
  const json = parseJsonBlock(res.text);
  let shown = res.text, receipt = '', drops = [];
  if (json && Array.isArray(json.actions) && json.actions.length) {
    const applied = await serializeWork(() => applyChatActions(json.actions, day), root);
    receipt = applied.receipts.join(' · ');
    drops = applied.dropped;
    shown = stripJson(res.text);
  }
  let final = shown.trim();
  if (receipt) final += '\n\n' + receipt + '.';
  if (drops.length) final += '\n\nCouldn\u2019t apply: ' + drops.join('; ') + '.';
  emit({ type: 'text-delta', text: final });
  return { text: final, directives: [], cost: 0 };
}
registerExecutor('today', todayExecutor);

// ── reviews ────────────────────────────────────────────────────────────────────────────────────
function reviewExists(id) { return !!reviewDoc(id); }
const reviewsInFlight = new Map();
function reviewOnce(kind, period, fn) {
  const root = getStorageRoot();
  const key = periodKey(root, kind + ':' + period);
  const existing = reviewsInFlight.get(key);
  if (existing) return existing;
  const pending = (async () => {
    try { return await fn(root); }
    finally { reviewsInFlight.delete(key); }
  })();
  reviewsInFlight.set(key, pending);
  return pending;
}

// Explicit End day closes the current clock now. A scheduled review closes only clocks that
// were already running at the configured cutoff; a later evening task remains under the person.
async function closeDayClock({ actor = 'conductor', now = Date.now(), cutoff = null, root = getStorageRoot() } = {}) {
  return serializeWork(async () => {
    const open = clockSegs(now).find(s => s.open);
    if (cutoff !== null && open && open.start > cutoff) return { stopped: false };
    if (open) {
      const item = itemById(open.id) || { id: open.id, path: open.path, bucket: open.bucket };
      workEvent(actor, item, { action: 'stop', id: open.id, bucket: open.bucket,
        ...(cutoff !== null ? { clock_at: cutoff } : {}) });
    }
    for (const item of workItems().filter(i => i.status === 'now')) {
      assertRoot(root);
      await patchRecord(item.path, { status: 'planned' }, { workTransition: WORK_TRANSITION, actor });
    }
    return { stopped: !!open };
  }, root);
}

// Numbers are computed by code; the model gets them and writes the narrative around them.
export function dailyReview(day, options = {}) {
  return reviewOnce('daily', day, root => writeDailyReview(day, { ...options, root }));
}
async function writeDailyReview(day, { force = false, now = Date.now(), root, scheduled = false, cutoff = null } = {}) {
  assertRoot(root);
  ensureWorkCollections();
  const id = 'daily-' + day;
  if (reviewExists(id) && !force) return { skipped: true, id };
  if (scheduled) await closeDayClock({ actor: 'schedule', now, cutoff, root });
  assertRoot(root);
  const from = dayStartMs(day), to = Math.min(dayStartMs(addDays(day, 1)), Number(now), cutoff ?? Infinity);
  const items = workItems();
  const known = byId(items);
  const evs = workEventsIn(from - 86400000, to);
  const segs = segmentsFromEvents(evs, to);
  const r = rollup(segs, known, { from, to });
  const outcomes = { done: [], parked: [], stuck: [] };
  for (const ev of evs) {
    const t = Date.parse(ev.ts);
    if (t < from || t >= to) continue;
    const o = ev.detail && ev.detail.outcome;
    if (ev.detail && ev.detail.action === 'stop' && outcomes[o]) {
      const it = known[ev.detail.id];
      outcomes[o].push((it ? it.title : ev.detail.id) + (o === 'stuck' && ev.detail.reason ? ' (' + ev.detail.reason + ')' : ''));
    }
  }
  const transcript = (() => { try { return (getSession(todaySessionId(day)) || {}).messages || []; } catch { return []; } })();

  const res = await think({ purpose: 'review_daily', prompt: [
    'Write today\u2019s daily review narrative. Return ONE json object:',
    '{"narrative":"3-6 sentences — what actually happened, what the numbers say","learnings":[{"title","body"}],"tomorrow":"one line for tomorrow\u2019s plan"}',
    'At most 3 learnings, only when the day genuinely taught something. Numbers below are authoritative — do not restate different ones.',
    'Day: ' + day + ' · minutes: ' + r.total_min + ' · done: ' + r.by_bucket.reduce((a, b) => a + b.done, 0) + ' · results: ' + r.by_bucket.reduce((a, b) => a + b.results, 0),
    'By bucket: ' + JSON.stringify(r.by_bucket),
    'Done: ' + (outcomes.done.join(' · ') || 'none') + ' · Parked: ' + (outcomes.parked.join(' · ') || 'none') + ' · Stuck: ' + (outcomes.stuck.join(' · ') || 'none'),
    transcript.length ? 'Chat tail:\n' + transcript.slice(-10).map(mm => mm.role + ': ' + String(mm.text || '').slice(0, 300)).join('\n') : '',
  ].filter(Boolean).join('\n') });
  assertRoot(root);

  const j = res.ok ? parseJsonBlock(res.text) : null;
  const narrative = (j && String(j.narrative || '').trim())
    || (res.ok ? 'The agent answered but its JSON could not be parsed.' : 'No light agent was available for the narrative \u2014 the numbers above stand on their own.');
  const table = [
    '| bucket | minutes | done | results |', '| --- | ---: | ---: | ---: |',
    ...r.by_bucket.map(b => '| ' + b.bucket + ' | ' + b.minutes + ' | ' + b.done + ' | ' + b.results + ' |'),
    '| **total** | **' + r.total_min + '** | **' + r.by_bucket.reduce((a, b) => a + b.done, 0) + '** | **' + r.by_bucket.reduce((a, b) => a + b.results, 0) + '** |',
    '', 'Done: ' + (outcomes.done.join(' · ') || '\u2014'),
    'Parked: ' + (outcomes.parked.join(' · ') || '\u2014'),
    'Stuck: ' + (outcomes.stuck.join(' · ') || '\u2014'),
  ].join('\n');
  const body = table + '\n\n## What the agent sees\n\n' + narrative + '\n'
    + (j && j.tomorrow ? '\n## Tomorrow\n\n' + String(j.tomorrow).trim() + '\n' : '');
  const fields = { title: 'Daily review · ' + day, kind: 'daily', period: day, minutes: r.total_min, done: r.by_bucket.reduce((a, b) => a + b.done, 0) };
  return serializeWork(async () => {
  if (reviewExists(id)) {
    await patchRecord('data/reviews/' + id + '.md', { ...fields, body }, { workTransition: WORK_TRANSITION, actor: 'conductor' });
    assertRoot(root);
  } else {
    upsertRecord({ collection: 'review', id, ...fields, body }, { actor: 'conductor', via: 'today-review' });
  }
  // Learnings are PROPOSED — the human approves in DECIDE (agents never write active memory).
  for (const [i, l] of [].concat(j && j.learnings || []).slice(0, 3).entries()) {
    if (!l || !String(l.title || '').trim()) continue;
    try {
      saveLearning(slugify(id + '-' + i + '-' + l.title), { claim: String(l.title).trim(), body: String(l.body || ''), status: 'proposed' }, { actor: 'conductor' });
    } catch { /* one bad learning never costs the review */ }
  }
  const session = getSession(todaySessionId(day));
  if (session) {
    postConductor(session.id, 'Daily review is in: ' + r.total_min + ' min tracked, ' + fields.done + ' done, ' + r.by_bucket.reduce((a, b) => a + b.results, 0) + ' results.' + (j && j.tomorrow ? ' Tomorrow: ' + j.tomorrow : ''), { key: 'review-' + day });
  }
  return { id, path: 'data/reviews/' + id + '.md', minutes: r.total_min, done: fields.done };
  }, root);
}

export function weeklyReview(weekStart, options = {}) {
  const ws = weekStartDay(weekStart);
  return reviewOnce('weekly', ws, root => writeWeeklyReview(ws, { ...options, root }));
}
async function writeWeeklyReview(weekStart, { force = false, root } = {}) {
  assertRoot(root);
  ensureWorkCollections();
  const ws = weekStartDay(weekStart);
  const id = 'weekly-' + ws;
  if (reviewExists(id) && !force) return { skipped: true, id };
  const from = dayStartMs(ws), to = dayStartMs(addDays(ws, 7));
  const items = workItems();
  const known = byId(items);
  const evs = workEventsIn(from - 86400000, to);
  const segs = segmentsFromEvents(evs, to);
  const r = rollup(segs, known, { from, to });

  // The automation rule is CODE: ≥3h in a bucket with zero results, or results/hour in the bottom
  // third of the buckets that recorded any — that bucket gets a backlog item. Exactly one, keyed
  // by week + bucket, so re-running never makes a second.
  const withResults = r.by_bucket.filter(b => b.results > 0).sort((a, b) => (a.results / a.minutes) - (b.results / b.minutes));
  const bottomThird = new Set(withResults.slice(0, Math.ceil(withResults.length / 3)).map(b => b.bucket));
  const flagged = r.by_bucket.filter(b => b.minutes >= 180 && (b.results === 0 || bottomThird.has(b.bucket)));

  const created = [];
  await serializeWork(() => {
  for (const b of flagged) {
    const h = (b.minutes / 60).toFixed(1);
    const iid = 'automate-' + slugify(b.bucket) + '-' + ws;
    const already = itemById(iid);
    if (!already) {
      upsertRecord({
        collection: 'work', id: iid,
        title: 'Automate or cut: ' + b.bucket + ' (' + h + 'h, ' + b.results + ' results this week)',
        bucket: 'admin', status: 'planned', estimate_min: 60, why: 'weekly review', prep: true, prep_state: 'none',
      }, { actor: 'conductor', via: 'today-review' });
      created.push(iid);
    }
  }
  }, root);
  assertRoot(root);

  const res = await think({ purpose: 'review_weekly', prompt: [
    'Write the weekly automation review. Return ONE json object: {"narrative":"4-8 sentences","suggestions":{"<bucket>":"one concrete automation or cut"}}',
    'Week ' + ws + ' \u2192 ' + addDays(ws, 6) + '. Numbers are authoritative.',
    'By bucket: ' + JSON.stringify(r.by_bucket.map(b => ({ ...b, hours: Math.round(b.minutes / 60 * 10) / 10, results_per_hour: b.minutes ? Math.round(b.results / b.minutes * 60 * 100) / 100 : 0 }))),
    'Flagged for automate-or-cut: ' + (flagged.map(b => b.bucket).join(', ') || 'none'),
  ].join('\n') });
  assertRoot(root);
  const j = res.ok ? parseJsonBlock(res.text) : null;
  const narrative = (j && String(j.narrative || '').trim())
    || (res.ok ? 'The agent answered but its JSON could not be parsed.'
       : 'No heavy agent (Claude/Codex) was available for the weekly narrative \u2014 the numbers and the automation items stand on their own.');

  const table = [
    '| bucket | hours | done | results | results/h |', '| --- | ---: | ---: | ---: | ---: |',
    ...r.by_bucket.map(b => '| ' + b.bucket + ' | ' + (b.minutes / 60).toFixed(1) + ' | ' + b.done + ' | ' + b.results + ' | ' + (b.minutes ? (b.results / b.minutes * 60).toFixed(2) : '0.00') + ' |'),
  ].join('\n');
  const sugg = flagged.map(b => '- **' + b.bucket + '** \u2014 ' + ((j && j.suggestions && j.suggestions[b.bucket]) || 'flagged by rule; backlog item created.')).join('\n');
  const body = table + '\n\n## What the agent sees\n\n' + narrative + '\n\n## Automate or cut\n\n' + (sugg || '\u2014 nothing crossed the rule this week.') + '\n';
  const fields = { title: 'Weekly review · w/c ' + ws, kind: 'weekly', period: ws, minutes: r.total_min, done: r.by_bucket.reduce((a, b) => a + b.done, 0) };
  return serializeWork(async () => {
  if (reviewExists(id)) {
    await patchRecord('data/reviews/' + id + '.md', { ...fields, body }, { workTransition: WORK_TRANSITION, actor: 'conductor' });
  } else {
    upsertRecord({ collection: 'review', id, ...fields, body }, { actor: 'conductor', via: 'today-review' });
  }
  return { id, path: 'data/reviews/' + id + '.md', flagged: flagged.map(b => b.bucket), created };
  }, root);
}

// ── the wake hook ──────────────────────────────────────────────────────────────────────────────
// One registration, fired by the scheduler's tick every minute. UNDER SCOUT_TEST it is inert on
// purpose: a detached ensurePlanned whose awaits straddle a test's setStorageRoot() would write a
// fresh workspace's day plan into the NEXT test's root. Tests call ensurePlanned/dailyReview
// directly — the hook is proven by today-plan/today-review, not by racing the scheduler.
export function todayTick(now = new Date()) {
  if (process.env.SCOUT_TEST === '1') return Promise.resolve([]);
  const s = getSettings();
  const t = now instanceof Date ? now : new Date(now);
  const mins = t.getHours() * 60 + t.getMinutes();
  const at = hhmm => { const [h, m] = String(hhmm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const jobs = [];
  if (mins >= at(s.dayStart || '08:30')) jobs.push(ensurePlanned(t.getTime()));
  if (mins >= at(s.dayEnd || '17:30')) {
    const end = at(s.dayEnd || '17:30');
    const cutoff = new Date(t); cutoff.setHours(Math.floor(end / 60), end % 60, 0, 0);
    jobs.push(dailyReview(localDay(t), { now: t.getTime(), scheduled: true, cutoff: cutoff.getTime() }).catch(e => e));
  }
  return Promise.allSettled(jobs);
}
onSchedulerTick(todayTick);

// ── routes ─────────────────────────────────────────────────────────────────────────────────────
export function registerTodayRoutes(app, deps = {}) {
  const actorOf = req => String((req.body && req.body.actor) || req.query.actor || DEFAULT_ACTOR);
  const fail = (res, e) => res.status(e.status || 400).json({ error: e.message });
  const wrap = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { fail(res, e); } };
  const mutate = fn => wrap(req => serializeWork(() => fn(req)));

  // The poll: nudges, prep state, the clock, the plan. ensurePlanned fires detached — a first-visit
  // day returns planning:true and the next poll sees the plan (a Gemini call must never hold GET).
  app.get('/api/today', wrap(async () => {
    ensurePlanned().catch(() => {});
    return getToday();
  }));

  app.post('/api/today/start', mutate(async req => ({ ok: true, item: await startItem(req.body && req.body.id, { actor: actorOf(req) }), today: await getToday() })));
  app.post('/api/today/pause', mutate(async req => ({ ok: true, ...(await pauseItem({ actor: actorOf(req) })) })));
  app.post('/api/today/resume', mutate(async req => ({ ok: true, ...(await resumeItem({ actor: actorOf(req) })) })));
  app.post('/api/today/stop', mutate(async req => ({ ok: true, ...(await stopItem(req.body && req.body.id, { actor: actorOf(req) })) })));
  app.post('/api/today/done', mutate(async req => {
    const b = req.body || {};
    const r = await doneItem(b.id, { result: b.result, result_note: b.result_note, actor: actorOf(req) });
    return { ok: true, next: r.next, today: await getToday() };
  }));
  app.post('/api/today/park', mutate(async req => ({ ok: true, ...(await parkItem(req.body && req.body.id, { actor: actorOf(req) })) })));
  app.post('/api/today/stuck', mutate(async req => ({ ok: true, ...(await stuckItem(req.body && req.body.id, { reason: req.body && req.body.reason, actor: actorOf(req) })) })));
  app.post('/api/today/add', mutate(async req => ({ ok: true, ...(await addItem(req.body || {}, { actor: actorOf(req) })) })));
  app.post('/api/today/reorder', mutate(async req => ({ ok: true, ...(await reorderItems(req.body && req.body.ids, { actor: actorOf(req) })) })));
  app.post('/api/today/prep', wrap(async req => {
    const it = itemById(req.body && req.body.id);
    if (!it) throw new TodayError('no work item "' + (req.body && req.body.id) + '"', 404);
    await prepItem(it, Date.now());
    return { ok: true };
  }));
  app.post('/api/today/end', wrap(async req => {
    const root = getStorageRoot();
    await closeDayClock({ actor: actorOf(req), root });
    assertRoot(root);
    return dailyReview(localDay(), { force: true });
  }));
  app.post('/api/today/review-week', wrap(async req => {
    const w = req.body && req.body.week ? normDay(req.body.week) : weekStartDay(addDays(localDay(), -7));
    return weeklyReview(w, { force: !!(req.body && req.body.force) });
  }));
  app.get('/api/today/reviews', wrap(async () => {
    ensureWorkCollections();
    return { reviews: (documentsFor('review')?.documents || []).map(d => ({ id: d.slug, path: d.path, title: d.title, fields: d.fields })) };
  }));
}
