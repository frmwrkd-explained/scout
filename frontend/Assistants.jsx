// frontend/Assistants.jsx — the team she owns. T12 step 6, M4.
//
// The promise this screen has to keep (GOAL.md §1/§3): she is not configuring software, she is
// standing over a small team. So every card answers three human questions in this order —
// WHAT IS IT DOING RIGHT NOW, WHAT DID IT DO LAST, WHAT DID IT COST — before it shows a single
// key from the file. No model ids, no `scope.collections`, no YAML on screen.
//
// PROPS (all optional; anything not passed is fetched once on mount and re-fetched when `nonce`
// changes, so the screen also stands up on its own before App.jsx wires it):
//
//   assistants   [Assistant]  from GET /api/assistants — backend/tasks.mjs `getAssistant()` shape:
//                             { id, name, job, scope:{collections,territory}, schedule, model,
//                               parent, status:'idle'|'running'|'blocked', path, body, ... }
//   tasks        [Task]       from GET /api/tasks — used to say, in plain language, what a running
//                             assistant is on and what a blocked one is stuck on.
//   runs         [Run]        from GET /api/runs — "what it did last" and "what it cost".
//   nonce        any          change it to force a re-fetch (e.g. after hiring).
//   currency     string       prefix for money figures. Default '$'.
//   onHire()                  open the hiring screen (frontend/Hire.jsx). This screen's ONE solid
//                             accent fill. Omit it and the button is disabled, never hidden.
//   onSelect(id)              open one assistant.
//   onDecide(subject)         send her to DECIDE. subject is always
//                             { kind:'task'|'assistant', id, path, question, task, assistant }.
//   onOpenPath(path)          Law 8 — open the raw `.md`. Every object on this screen offers it.
//   onSendOut(id)             put ONE assistant out now (POST /api/assistants/:id/run). Optional:
//                             without it the button is disabled and says why, never hidden.
//   onSendOutAll()            put them all out. Both are SECONDARY here — the one solid accent
//                             fill on this screen is Hire, and TODAY owns "Send them out" in
//                             accent. Two accent fills on one screen is two primary actions.
//
// EXPORTS the assistant/task vocabulary (states, lanes, dots, paths, figures) because Hire.jsx and
// Project.jsx speak it too, and a second copy of "what colour is blocked" is exactly the bug
// CLAUDE.md's source-of-truth table exists to prevent.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { api } from './api';
import { Btn, Empty, Eyebrow } from './ui';
import { Freshness } from './Freshness';

export const monoStyle = (extra = '') => ({ ...sx(extra), fontFamily: MONO });
// Every figure in Scout is mono with tabular numerals (docs/05_UI_SPEC.md §6). Spread this, do not
// retype it — stacked digits that do not align are the tell that someone did.
export const FIGURE = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' };

// ── the vocabulary ───────────────────────────────────────────────────────────────────────────
// --marked is the in-flight channel and is deliberately NOT the accent: an accent fill on this
// screen would read "click this", and the one accent fill belongs to Hire. styles.css :root spells
// the rule out at --marked. The round-3 prototype drew RUNNING in --ok; it is --marked here because
// running is a state, not a health verdict, and --ok then means "fine, nothing wanted".
export const ASSISTANT_STATES = {
  running: { key: 'running', word: 'WORKING', color: 'var(--marked)' },
  idle: { key: 'idle', word: 'IDLE', color: 'var(--ok)' },
  blocked: { key: 'blocked', word: 'BLOCKED', color: 'var(--warn)' },
};

// The four task lanes, in the order a queue is read: what is stuck, what is moving, what is
// waiting, what is finished. backend/tasks.mjs TASK_STATUS is the machine list; this is its face.
export const TASK_LANES = [
  { key: 'blocked', name: 'BLOCKED ON YOU', color: 'var(--warn)', stripe: 'var(--warn)' },
  { key: 'claimed', name: 'BEING WORKED', color: 'var(--marked)', stripe: 'var(--marked)' },
  { key: 'open', name: 'OPEN', color: 'var(--border-3)', stripe: 'transparent' },
  { key: 'done', name: 'DONE', color: 'var(--ok)', stripe: 'transparent' },
];
export const laneOf = key => TASK_LANES.find(l => l.key === key) || TASK_LANES[2];

// How often it works, asked the way a person would ask it. The value is what lands in the file.
export const SCHEDULE_OPTIONS = [
  { value: 'continuous', label: 'All day', hint: 'It keeps going while you work.' },
  { value: 'daily', label: 'Every morning', hint: 'One sweep overnight, ready when you open Scout.' },
  { value: 'weekly', label: 'Once a week', hint: 'A slower ground that does not change much.' },
  { value: 'manual', label: 'Only when I ask', hint: 'It sits still until you send it out.' },
];
// What the schedule STATE is, in one line, for the team header. Every branch is a fact:
//   · schedules on   → how many are due right now
//   · schedules off  → they go when you send them, and nothing else will
//   · no answer yet  → say nothing rather than guess
// The alternative — printing "EVERY MORNING" on a card and leaving it there — is the sentence a
// person believes, and it was untrue for the whole of M4 and M5.
export function scheduleWord(sched) {
  // useRemote resolves a FAILED load to `[]`, not null — so "did the route answer" is a question
  // about the shape, not about truthiness. A screen that cannot reach the route says nothing;
  // guessing "off" would be a claim, and this line's whole job is to stop claims like that.
  if (!sched || typeof sched !== 'object' || Array.isArray(sched) || typeof sched.auto !== 'boolean') return null;
  // `scheduled` comes from the SERVER, already normalised (backend/tasks.mjs normalizeSchedule).
  // Counting the raw strings here would report four sweeps a night over four assistants carrying
  // "every 6 hours" and "when you shortlist someone", none of which anything acts on.
  const scheduled = Number(sched.scheduled) || 0;
  if (!sched.auto) return scheduled ? 'SCHEDULES OFF — YOU SEND THEM OUT' : null;
  if (!scheduled) return 'NO ASSISTANT HAS A SCHEDULE SCOUT CAN ACT ON';
  const due = (sched.due || []).length;
  return due ? due + ' DUE NOW' : 'ON SCHEDULE';
}

// What the card says about this assistant's schedule. `schedule_kind` is the server's reading of
// her words (backend/tasks.mjs); when it comes back `manual` over a schedule she plainly meant as
// one — "every 6 hours" — the card SAYS the app will not act on it, rather than printing her
// sentence back at her as though it were a promise.
export function scheduleStat(a) {
  const raw = a && a.schedule ? String(a.schedule) : '';
  const label = scheduleLabel(a && a.schedule).toUpperCase();
  const known = SCHEDULE_OPTIONS.some(o => o.value === (a && a.schedule));
  if (!raw || known) return label;
  return a && a.schedule_kind && a.schedule_kind !== 'manual' ? label : label + ' · YOU SEND IT';
}

export const scheduleLabel = v => {
  const hit = SCHEDULE_OPTIONS.find(o => o.value === v);
  return hit ? hit.label : (v ? String(v) : 'Only when you ask');
};

// ── normalising what came off disk ───────────────────────────────────────────────────────────
const arr = v => (Array.isArray(v) ? v : []);
const listOf = (v, key) => (Array.isArray(v) ? v : arr(v && v[key]));
const first = (...v) => v.find(x => typeof x === 'string' && x.trim()) || null;
// Number(null) and Number('') are both 0, so a naive Number.isFinite guard turns "we have no
// figure" into the claim "0". Absent is not zero anywhere on these screens.
const num = v => (v == null || v === '' || typeof v === 'boolean' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

// YAML dates arrive as Date objects when a caller reads the file directly (gray-matter parses
// them) and as ISO strings when the same object came over the API. Both are dates; `first()` only
// speaks strings, and silently dropping a Date is why every meter read NEVER against real files.
export function when(...v) {
  for (const x of v) {
    if (x instanceof Date) { if (!Number.isNaN(x.getTime())) return x; continue; }
    if (typeof x === 'number' && Number.isFinite(x)) return x;
    if (typeof x === 'string' && x.trim() && Number.isFinite(Date.parse(x))) return x;
  }
  return null;
}
const sameId = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

// The human sentence off the top of a markdown body. Every object the seed writes opens with one
// paragraph of plain language and then a `## Notes` heading — that first paragraph IS the altitude-1
// answer, so it is read here rather than paraphrased in the UI. Everything below the heading is
// altitude 2 and belongs to the document surface, not to a card.
export function firstPara(md) {
  const text = String(md || '').trim();
  if (!text) return null;
  for (const block of text.split(/\n{2,}/)) {
    const b = block.trim();
    if (!b || b.startsWith('#') || b.startsWith('---')) continue;
    return b.replace(/\s*\n\s*/g, ' ');
  }
  return null;
}

// A task's sentence. backend/tasks.mjs falls `title` back to the id when the file has none, and the
// files on disk carry the human line in `label` (as goals, projects and territory all do) — so an
// id-shaped title is not a title, it is the absence of one.
export function taskTitle(t) {
  if (!t) return '';
  const title = typeof t.title === 'string' && t.title.trim() && t.title !== t.id ? t.title : null;
  return first(t.label, title, t.name, t.title, t.id) || '';
}

export function stateOf(a) {
  const raw = String((a && (a.status || a.state)) || '').toLowerCase();
  if (/^(running|working|sweeping|checking|busy|active|out)$/.test(raw)) return 'running';
  if (/^(blocked|waiting|stuck|held|paused)$/.test(raw)) return 'blocked';
  return 'idle';
}

export function money(v, currency = '$') {
  if (v == null || v === '') return null;
  if (typeof v === 'string') return v.trim() || null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return currency + (n >= 10 ? n.toFixed(0) : n.toFixed(2));
}

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function runsFor(runs, id) {
  return arr(runs).filter(r => sameId(r.assistant, id));
}

// What it cost — its own spend today, and (for a parent) its team's. Summed from runs, because a
// number typed into a file is a claim and a number summed from runs is a fact.
export function costToday(runs, id) {
  const since = startOfToday();
  let total = 0, seen = false;
  for (const r of runsFor(runs, id)) {
    const t = Date.parse(String(r.started || r.ended || ''));
    if (Number.isFinite(t) && t < since) continue;
    const c = num(r.cost);
    if (c == null) continue;
    total += c; seen = true;
  }
  return seen ? total : null;
}

export function lastRun(runs, id) {
  return runsFor(runs, id).find(r => r.started || r.ended) || null;
}

export function tasksFor(tasks, id) {
  return arr(tasks).filter(t => sameId(t.assigned, id));
}

// The age of the thing, for Freshness. Never a second decay renderer (Law 3, docs/08 §2).
export function lastSeen(a, runs) {
  const r = lastRun(runs, a.id);
  return when(r && (r.ended || r.started), a.last_run, a.updated, a.verified_at, a.created);
}

// The question a blocked assistant is asking, in its own words.
export function questionOf(a, tasks) {
  const own = first(a.question, a.asks, a.blocked_on, a.waiting_on);
  if (own) return own;
  const t = tasksFor(tasks, a.id).find(t => t.status === 'blocked' || t.needs_human);
  return t ? first(firstPara(t.body), t.question, taskTitle(t)) : null;
}

// WHAT IT IS DOING RIGHT NOW, in a sentence. Never a status word dressed up as one.
export function doingOf(a, tasks) {
  const own = first(a.doing, a.doing_now, a.current, a.now, firstPara(a.body));
  if (own) return own;
  const state = stateOf(a);
  const mine = tasksFor(tasks, a.id);
  if (state === 'running') {
    const t = mine.find(t => t.status === 'claimed');
    return t ? taskTitle(t) : 'Working now.';
  }
  if (state === 'blocked') {
    const q = questionOf(a, tasks);
    return q ? 'Stopped. It will not go on until you answer.' : 'Stopped. It needs something from you before it can go on.';
  }
  const open = arr(tasks).filter(t => t.status === 'open').length;
  return open
    ? 'Waiting. ' + open + (open === 1 ? ' job is' : ' jobs are') + ' open for whoever is free.'
    : 'Nothing to do right now.';
}

// WHAT IT DID LAST. A run summary is already written for a human; prefer it over anything derived.
export function lastOf(a, runs, tasks) {
  const r = lastRun(runs, a.id);
  const said = first(r && r.summary, a.last, a.last_did, a.did);
  if (said) return said;
  const done = tasksFor(tasks, a.id).filter(t => t.status === 'done');
  return done.length ? taskTitle(done[done.length - 1]) : null;
}

// ── small parts, shared with Hire and Project ────────────────────────────────────────────────
const inFlight = tone => ({ boxShadow: '0 0 0 3px color-mix(in srgb, ' + tone + ' 16%, transparent)' });

export function Dot({ tone, glow = false, size = 7, style }) {
  return (
    <span style={{
      ...sx('flex:none;border-radius:9999px'),
      width: size, height: size, background: tone, border: '1px solid ' + tone,
      ...(glow ? inFlight(tone) : null), ...style,
    }} />
  );
}

export function StateWord({ state, style }) {
  const s = ASSISTANT_STATES[state] || ASSISTANT_STATES.idle;
  return <span style={{ ...monoStyle('font-size:9px;font-weight:800;letter-spacing:.12em'), color: s.color, ...style }}>{s.word}</span>;
}

// Law 8, on every object without exception: the file is two clicks away and this is one of them.
export function PathLink({ path, onOpenPath, style, title }) {
  if (!path) return null;
  return (
    <button type="button" className="hFgL" title={title || 'Open ' + path}
      onClick={e => { e.stopPropagation(); if (onOpenPath) onOpenPath(path); }}
      style={{
        ...monoStyle('font-size:10px;font-weight:500;padding:0;margin:0;text-align:left;background:none;border:none;cursor:pointer'),
        color: 'var(--fg-faint)', ...style,
      }}>{path}</button>
  );
}

// A mono figure line — "12 MIN IN / 8 FOUND / $6 TODAY". Parts that have no value are dropped, so
// an assistant that has never run says nothing rather than "0 FOUND", which is a different claim.
export function StatLine({ parts, style }) {
  const kept = arr(parts).filter(Boolean);
  if (!kept.length) return null;
  return (
    <span style={{ ...monoStyle('font-size:9.5px;font-weight:500;letter-spacing:.04em'), ...FIGURE, color: 'var(--fg-faint)', ...style }}>
      {kept.join(' / ')}
    </span>
  );
}

// ── loading ──────────────────────────────────────────────────────────────────────────────────
// A prop always wins; the fetch only covers the case where nobody passed one. `null` while in
// flight so an empty state is never shown over data that is still coming.
function useRemote(given, load, nonce) {
  const [loaded, setLoaded] = React.useState(null);
  const skip = given != null;
  React.useEffect(() => {
    if (skip) return undefined;
    let alive = true;
    Promise.resolve().then(load).then(v => { if (alive) setLoaded(v); }).catch(() => { if (alive) setLoaded([]); });
    return () => { alive = false; };
  }, [skip, nonce]);
  return skip ? given : loaded;
}
export { useRemote };

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = n => (n < WORDS.length ? WORDS[n] : String(n));

// The headline. Not a count — a sentence she can read without decoding anything.
function teamSentence(list) {
  if (!list.length) return 'Nobody is working for you yet.';
  const n = k => list.filter(a => stateOf(a) === k).length;
  const parts = [];
  if (n('running')) parts.push(word(n('running')) + ' working');
  if (n('blocked')) parts.push(word(n('blocked')) + ' waiting on you');
  if (n('idle')) parts.push(word(n('idle')) + ' idle');
  const s = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

// ── one assistant ────────────────────────────────────────────────────────────────────────────
function AssistantCard({ a, depth, children, tasks, runs, currency, onOpenPath, onDecide, onSelect, kidStates, onSendOut, sending }) {
  const state = stateOf(a);
  const meta = ASSISTANT_STATES[state];
  const doing = doingOf(a, tasks);
  const last = lastOf(a, runs, tasks);
  const asked = state === 'blocked' ? questionOf(a, tasks) : null;
  // Both can resolve to the same paragraph when an assistant and its blocked task were written
  // from the same fact. Say it once.
  const question = asked && asked !== doing ? asked : null;
  const blockedTask = tasksFor(tasks, a.id).find(t => t.status === 'blocked' || t.needs_human) || null;
  const spend = money(costToday(runs, a.id) ?? a.cost_today ?? a.cost, currency);
  const r = lastRun(runs, a.id);
  const found = num(r && (r.found ?? r.finds)) ?? num(a.found);

  const stats = depth
    ? ['SUB-AGENT OF ' + String(a.parent || '').toUpperCase(), scheduleStat(a), spend ? spend + ' TODAY' : null]
    : [scheduleStat(a),
       r && r.started ? 'LAST RUN ' + String(r.started).slice(11, 16) : null,
       found != null ? found + ' FOUND' : null,
       spend ? spend + ' TODAY' : null,
       kidStates && kidStates.length ? kidStates.length + (kidStates.length === 1 ? ' SUB-AGENT' : ' SUB-AGENTS') : null];

  return (
    <div style={{ marginLeft: depth * 22, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="hBd"
        style={{
          ...sx('display:flex;gap:11px;padding:12px 14px;border-radius:8px;transition:border-color 130ms ease'),
          background: depth ? 'var(--surface)' : 'var(--surface-2)',
          border: '1px solid ' + (state === 'blocked' ? 'var(--border-2)' : 'var(--border)'),
          borderLeft: '2px solid ' + (state === 'idle' ? 'var(--line)' : meta.color),
        }}>
        <Dot tone={meta.color} glow={state !== 'idle'} style={{ marginTop: 5 }} />

        <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:6px')}>
          <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:10px')}>
            <button type="button" disabled={!onSelect} onClick={() => onSelect && onSelect(a.id)}
              className={onSelect ? 'hFg' : ''}
              style={{
                ...monoStyle('font-size:12px;font-weight:600;padding:0;background:none;border:none;text-align:left'),
                color: depth ? 'var(--fg-soft)' : 'var(--fg)', cursor: onSelect ? 'pointer' : 'default',
              }}>{a.name || a.id}</button>
            <div style={sx('display:flex;align-items:center;gap:10px;flex:none')}>
              <StateWord state={state} />
              {/* An assistant you cannot send anywhere is a setting, not an assistant. Disabled
                  while it is out, because a second run would spawn a second process against the
                  same task queue — the claim protocol survives that, but the cost does not. */}
              <Btn size="sm" variant="secondary"
                busy={!!sending}
                disabled={!onSendOut || state === 'running'}
                title={state === 'running' ? 'Already out' : 'Send it out now'}
                onClick={() => onSendOut && onSendOut(a.id)}>
                {sending ? 'Sending' : state === 'running' ? 'Out' : 'Send out'}
              </Btn>
            </div>
          </div>

          {/* what it is — the job, in the one sentence she wrote when she hired it */}
          {a.job ? <span style={sx('font-size:11.5px;color:var(--fg-muted);line-height:1.4')}>{a.job}</span> : null}

          {/* what it is doing right now */}
          <span style={sx('font-size:12.5px;color:var(--fg-soft);line-height:1.45')}>{doing}</span>

          {/* what it did last */}
          {last ? (
            <span style={sx('font-size:11.5px;color:var(--fg-muted);line-height:1.45')}>
              <span style={{ ...monoStyle('font-size:9px;font-weight:800;letter-spacing:.12em'), color: 'var(--fg-faint)', marginRight: 8 }}>LAST</span>
              {last}
            </span>
          ) : null}

          <div style={sx('display:flex;align-items:center;gap:14px;flex-wrap:wrap')}>
            <StatLine parts={stats} />
            <Freshness value={lastSeen(a, runs)} />
          </div>

          {/* a blocked assistant surfaces its question, and the question is the way into DECIDE */}
          {state === 'blocked' ? (
            <div style={{
              ...sx('display:flex;align-items:flex-start;gap:12px;padding:11px 12px;border-radius:6px;margin-top:2px'),
              background: 'var(--sunk)', border: '1px solid var(--border-2)', borderLeft: '2px solid var(--warn)',
            }}>
              <span style={sx('flex:1;min-width:0;font-size:12.5px;color:var(--fg);line-height:1.5')}>
                {question || 'It will not go on until you answer.'}
              </span>
              <Btn size="sm" variant="secondary" disabled={!onDecide}
                onClick={() => onDecide && onDecide({
                  kind: blockedTask ? 'task' : 'assistant',
                  id: blockedTask ? blockedTask.id : a.id,
                  path: blockedTask ? blockedTask.path : a.path,
                  question: question || null, task: blockedTask, assistant: a,
                })}>Answer it</Btn>
            </div>
          ) : null}

          <PathLink path={a.path || ('assistants/' + a.id + '.md')} onOpenPath={onOpenPath} />
        </div>
      </div>

      {children}
    </div>
  );
}

// ── the screen ───────────────────────────────────────────────────────────────────────────────
export default function Assistants({
  assistants, tasks, runs, nonce, currency = '$',
  onHire, onSelect, onDecide, onOpenPath, onSendOut, onSendOutAll,
}) {
  // Which cards are mid-request. The RUN is not tracked here — `status: running` on the assistant
  // is, and it comes back from the server. This is only the second between the click and the
  // answer, so that a double-click cannot send the same assistant twice.
  const [sending, setSending] = React.useState(() => new Set());
  const mark = (id, on) => setSending(prev => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });
  const [sendingAll, setSendingAll] = React.useState(false);

  const sendOne = async id => {
    if (!onSendOut) return;
    mark(id, true);
    try { await onSendOut(id); } finally { mark(id, false); }
  };
  const sendAll = async () => {
    if (!onSendOutAll) return;
    setSendingAll(true);
    try { await onSendOutAll(); } finally { setSendingAll(false); }
  };
  const list = useRemote(assistants, () => api.assistants().then(r => listOf(r, 'assistants')), nonce);
  const taskList = useRemote(tasks, () => api.tasks().then(r => listOf(r, 'tasks')), nonce);
  const runList = useRemote(runs, () => api.runs({ limit: 60 }).then(r => listOf(r, 'runs')), nonce);
  // Whether a schedule ACTS. `due` is what the schedule says; `auto` is whether anything will do
  // it. Showing the first without the second is how a person comes to believe their assistants
  // went out overnight when nothing did.
  const sched = useRemote(null, () => api.schedule().catch(() => null), nonce);

  const all = arr(list);
  const T = arr(taskList);
  const R = arr(runList);

  const byId = new Map(all.map(a => [String(a.id), a]));
  const kidsOf = id => all.filter(a => a.parent && String(a.parent) === String(id));
  const roots = all.filter(a => !a.parent || !byId.has(String(a.parent)));
  const subCount = all.length - roots.length;
  const spends = all.map(a => costToday(R, a.id) ?? num(a.cost_today) ?? num(a.cost)).filter(v => v != null);
  const spend = spends.length ? money(spends.reduce((s, v) => s + v, 0), currency) : null;

  const render = (a, depth) => {
    const kids = kidsOf(a.id);
    return (
      <AssistantCard key={a.id} a={a} depth={depth} tasks={T} runs={R} currency={currency}
        kidStates={depth ? null : kids}
        onOpenPath={onOpenPath} onDecide={onDecide} onSelect={onSelect}
        onSendOut={onSendOut ? sendOne : null} sending={sending.has(a.id)}>
        {kids.length ? (
          <div style={sx('display:flex;flex-direction:column;gap:8px')}>{kids.map(k => render(k, depth + 1))}</div>
        ) : null}
      </AssistantCard>
    );
  };

  return (
    <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden')}>
      <header style={sx('flex:none;padding:20px 24px 18px;border-bottom:1px solid var(--line);display:flex;align-items:flex-start;justify-content:space-between;gap:28px')}>
        <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:11px')}>
          <Eyebrow style={sx('font-size:9px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>YOUR TEAM</Eyebrow>
          <h1 style={sx('margin:0;font-size:24px;font-weight:500;letter-spacing:-.015em;line-height:1.3;color:var(--fg)')}>
            {list === null ? ' ' : teamSentence(all)}
          </h1>
          <StatLine style={sx('font-size:10.5px')} parts={[
            all.length ? all.length + (all.length === 1 ? ' ASSISTANT' : ' ASSISTANTS') : null,
            subCount ? subCount + (subCount === 1 ? ' SUB-AGENT' : ' SUB-AGENTS') : null,
            spend ? spend + ' SPENT TODAY' : null,
            scheduleWord(sched),
          ]} />
        </div>
        <div style={sx('flex:none;display:flex;align-items:center;gap:10px')}>
          {/* Secondary on purpose — see the props note. It is the same act as TODAY's big button
              and it calls the same route; it is just not this screen's primary one. */}
          <Btn variant="secondary" busy={sendingAll} disabled={!onSendOutAll || !all.length}
            onClick={sendAll} style={{ flex: 'none', height: 40 }}>
            {sendingAll ? 'Sending them out' : 'Send them all out'}
          </Btn>
          {/* the ONE solid accent fill on this screen */}
          <Btn variant="primary" disabled={!onHire} onClick={() => onHire && onHire()} style={{ flex: 'none', height: 40 }}>
            Hire an assistant
          </Btn>
        </div>
      </header>

      <div style={sx('flex:1;min-height:0;overflow-y:auto;padding:16px 24px 24px;display:flex;flex-direction:column;gap:10px')}>
        {list === null ? null
          : !all.length ? (
            <Empty
              size="page"
              title="NO ASSISTANTS HIRED YET"
              body="An assistant is a job, not a setting: a name, one sentence about what it should do, the ground it may work, and how often. Hire the first one and it can start tonight."
              action={onHire ? { onClick: onHire, label: 'Hire an assistant' } : null}
              style={sx('max-width:560px')}
            />
          ) : roots.map(a => render(a, 0))}
      </div>
    </div>
  );
}
