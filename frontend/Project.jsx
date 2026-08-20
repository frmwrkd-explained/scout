// frontend/Project.jsx — standing over a team. T12 step 7, M4.
//
// The screen answers, top to bottom, the questions a person actually has when she opens a project:
// what are we chasing and how far are we · what is the team doing · what is stuck on me · what have
// they turned up. Everything else is a click away (Law 2 — this opens at altitude 1 and never
// deeper). design/Project.dc.html is the visual truth and design/EXTRACT.md §3.2 the measurements:
// a 352px right column, one solid accent fill ("Put the team to work"), density everywhere.
//
// Adding work is a SENTENCE, not a form: she types what she wants done and it enters the queue as
// an open task. She does not pick who does it, because backend/tasks.mjs refuses `assigned` on a
// save — `assigned` is written by claiming and by nothing else, which is the whole reason three
// agents can work one queue without losing a task. Saying "assign it to Vetter" here would be a
// lie about a guarantee, so the screen says what is true: whoever is free picks it up.
//
// PROPS:
//   project      object|string  the project, or its id. Object keys are read loosely
//                               ({ id, name, goal, label, target, current, unit, deadline, path }).
//   goal         object         explicit goal — otherwise matched out of GET /api/goals.
//   tasks        [Task]         GET /api/tasks?project= — fetched if not passed.
//   assistants   [Assistant]    GET /api/assistants — fetched if not passed.
//   runs         [Run]          GET /api/runs — for "what it cost" on the crew cards.
//   needs        [Card]         open DECIDE cards for this project, if the caller has them. Tasks
//                               with `needs_human: true` are always folded in on top.
//   findings     [{collection,label,what,count,path}]  what the team has turned up. See the note in
//                               the panel: backend/tasks.mjs `listFindings()` has no route yet.
//   actor        string         who is adding tasks. Default 'crystal'.
//   currency     string         prefix for money figures. Default '$'.
//   onRun()                     put the team to work — the ONE solid accent fill on this screen.
//   onDecide(subject)           { kind, id, path, question, task, assistant } — same shape as
//                               Assistants.jsx, so DECIDE has one door.
//   onOpenPath(path)            Law 8, on every object here.
//   onOpenCollection(id)        follow a findings row into its collection.
//   onOpenAssistants()          the whole team.

import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { Btn, Empty, Eyebrow, Input } from './ui';
import { Freshness } from './Freshness';
import {
  ASSISTANT_STATES, TASK_LANES, laneOf, stateOf, doingOf, costToday, lastSeen, money, taskTitle, when,
  Dot, StateWord, PathLink, StatLine, FIGURE, monoStyle, useRemote,
} from './Assistants';

const arr = v => (Array.isArray(v) ? v : []);
const listOf = (v, key) => (Array.isArray(v) ? v : arr(v && v[key]));
const num = v => (v == null || v === '' || typeof v === 'boolean' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const first = (...v) => v.find(x => typeof x === 'string' && x.trim()) || null;

// A timestamp a person reads at a glance: the clock if it happened today, the date if it did not.
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function stamp(v) {
  if (v == null || v === '') return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}
function clock(v) {
  const t = stamp(v);
  if (t == null) return null;
  const d = new Date(t);
  // A date with no time in it (`2026-08-19` in YAML, or the UTC-midnight Date gray-matter makes of
  // it) does not know what o'clock it was — printing 02:00 would be inventing the minutes.
  const dateOnly = v instanceof Date ? t % 86400000 === 0 : /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim());
  const sameDay = !dateOnly && d.toDateString() === new Date().toDateString();
  return sameDay
    ? String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
    : d.getDate() + ' ' + MONTHS[d.getMonth()];
}
function daysLeft(deadline) {
  const t = stamp(deadline);
  return t == null ? null : Math.ceil((t - Date.now()) / 86400000);
}

// The goal and its number, from wherever it actually lives — the project file, or a goal in memory
// that names this project. Never invented: if there is no target, no bar is drawn.
function goalOf(project, goals) {
  const p = project || {};
  // Both halves of the match have to be present. `x.id === p.goal` with neither defined is true,
  // which is how an empty object became a goal and produced a link to goals/undefined.md.
  const gid = p.goal_id || (typeof p.goal === 'string' ? p.goal : null);
  const g = arr(goals).find(x => x && x.id && gid && String(x.id) === String(gid))
    || arr(goals).find(x => x && x.id && arr(x.projects).map(String).includes(String(p.id)))
    || null;
  const label = first(g && (g.label || g.name), typeof p.goal === 'string' ? p.goal : null, p.label, p.name, p.id)
    || 'This project has no goal written yet.';
  return {
    label,
    target: num(g && g.target) ?? num(p.target),
    current: num(g && g.current) ?? num(p.current) ?? num(p.found),
    unit: first(g && g.unit, p.unit) || '',
    deadline: when(g && g.deadline, p.deadline, p.due),
    path: g && g.id ? 'goals/' + g.id + '.md' : null,
  };
}

// ── the task queue ───────────────────────────────────────────────────────────────────────────
function TaskRow({ t, onDecide, onOpenPath }) {
  const lane = laneOf(t.status);
  const needs = !!t.needs_human;
  const done = t.status === 'done';
  const who = t.assigned || null;
  const at = when(t.done_at, t.claimed_at, t.updated, t.created);
  const stampedAt = clock(at);
  const verb = done ? 'DONE' : who ? 'CLAIMED' : 'ADDED';

  const body = (
    <>
      <div style={sx('display:flex;align-items:center;gap:12px;min-width:0')}>
        <span style={{
          ...sx('flex:1;min-width:0;font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'),
          color: done ? 'var(--fg-faint)' : 'var(--fg-soft)',
        }}>{taskTitle(t)}</span>
        {needs ? (
          <span style={{ ...sx('flex:none;font-size:11.5px;font-weight:600'), color: 'var(--warn)' }}>needs you</span>
        ) : null}
        {needs && onDecide ? (
          <span style={{ ...monoStyle('flex:none;font-size:11px'), color: 'var(--accent)' }}>→</span>
        ) : null}
      </div>
      <div style={sx('display:flex;align-items:center;gap:12px;flex-wrap:wrap')}>
        <span style={{
          ...sx('flex:none;display:inline-flex;align-items:center;gap:6px;height:19px;padding:0 8px 0 7px;border-radius:6px'),
          background: 'var(--raise)', border: '1px solid var(--border-2)',
        }}>
          <Dot size={5} tone={who ? 'var(--marked)' : 'var(--border-3)'} />
          <span style={{ ...monoStyle('font-size:9.5px;font-weight:600'), color: 'var(--fg-muted)' }}>
            {who ? String(who).toUpperCase() : 'UNCLAIMED'}
          </span>
        </span>
        <StatLine parts={[stampedAt ? verb + ' ' + stampedAt : null]} />
        <Freshness value={at} />
        <PathLink path={t.path} onOpenPath={onOpenPath} />
      </div>
    </>
  );

  const box = {
    ...sx('display:flex;flex-direction:column;gap:7px;padding:9px 12px;border-radius:6px;width:100%;text-align:left;transition:border-color 130ms ease'),
    background: done ? 'var(--surface)' : 'var(--surface-2)',
    border: '1px solid ' + (done ? 'var(--line)' : 'var(--border)'),
    borderLeft: '2px solid ' + lane.stripe,
  };

  if (needs && onDecide) {
    return (
      <button type="button" className="hBd"
        onClick={() => onDecide({ kind: 'task', id: t.id, path: t.path, question: t.body || null, task: t, assistant: null })}
        style={{ ...box, cursor: 'pointer' }}>{body}</button>
    );
  }
  return <div className="hBd" style={box}>{body}</div>;
}

// ── the crew ─────────────────────────────────────────────────────────────────────────────────
function CrewCard({ a, tasks, runs, currency, onOpenPath, onDecide }) {
  const state = stateOf(a);
  const meta = ASSISTANT_STATES[state];
  const spend = money(costToday(runs, a.id) ?? a.cost_today ?? a.cost, currency);
  return (
    <div style={{
      ...sx('display:flex;gap:11px;padding:11px 12px;border-radius:6px'),
      background: 'var(--surface-2)',
      border: '1px solid ' + (state === 'blocked' ? 'var(--border-2)' : 'var(--border)'),
    }}>
      <Dot tone={meta.color} glow={state !== 'idle'} style={{ marginTop: 5 }} />
      <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:4px')}>
        <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:8px')}>
          <span style={{ ...monoStyle('font-size:11.5px;font-weight:600'), color: a.parent ? 'var(--fg-soft)' : 'var(--fg)' }}>
            {a.name || a.id}
          </span>
          <StateWord state={state} style={sx('font-size:8.5px;letter-spacing:.1em')} />
        </div>
        <span style={sx('font-size:12px;color:var(--fg-soft);line-height:1.45')}>{doingOf(a, tasks)}</span>
        <StatLine parts={[
          a.parent ? 'SUB-AGENT OF ' + String(a.parent).toUpperCase() : null,
          spend ? spend + ' TODAY' : null,
        ]} />
        <div style={sx('display:flex;align-items:center;gap:12px;flex-wrap:wrap')}>
          <Freshness value={lastSeen(a, runs)} />
          <PathLink path={a.path || ('assistants/' + a.id + '.md')} onOpenPath={onOpenPath} />
        </div>
        {state === 'blocked' && onDecide ? (
          <Btn size="sm" variant="secondary" style={sx('margin-top:3px;align-self:flex-start')}
            onClick={() => onDecide({ kind: 'assistant', id: a.id, path: a.path, question: null, task: null, assistant: a })}>
            Answer it
          </Btn>
        ) : null}
      </div>
    </div>
  );
}

function Panel({ label, right, children, last }) {
  return (
    <div style={{
      ...sx('padding:14px 20px 16px;display:flex;flex-direction:column;gap:11px'),
      borderBottom: last ? 'none' : '1px solid var(--line)',
    }}>
      <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:10px')}>
        <Eyebrow style={sx('font-size:9px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>{label}</Eyebrow>
        {right}
      </div>
      {children}
    </div>
  );
}

// ── the screen ───────────────────────────────────────────────────────────────────────────────
export default function Project({
  project, goal, tasks, assistants, runs, needs, findings,
  actor = 'crystal', currency = '$',
  onRun, onDecide, onOpenPath, onOpenCollection, onOpenAssistants,
}) {
  const p = typeof project === 'string' ? { id: project } : (project || null);
  const pid = p && p.id ? String(p.id) : null;

  const [nonce, setNonce] = React.useState(0);
  const [draft, setDraft] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [error, setError] = React.useState(null);

  const taskList = useRemote(tasks, () => api.tasks(pid ? { project: pid } : {}).then(r => listOf(r, 'tasks')), nonce);
  const team = useRemote(assistants, () => api.assistants().then(r => listOf(r, 'assistants')), nonce);
  const runList = useRemote(runs, () => api.runs({ limit: 60 }).then(r => listOf(r, 'runs')), nonce);
  const goals = useRemote(goal ? [goal] : null, () => api.goals().then(r => listOf(r, 'goals')), nonce);

  const T = arr(taskList), A = arr(team), R = arr(runList);
  const g = goal && goal.label ? { ...goalOf(p, []), ...goal } : goalOf(p, arr(goals));

  const counts = k => T.filter(t => t.status === k).length;
  const left = daysLeft(g.deadline);
  const pct = g.target ? Math.max(0, Math.min(100, Math.round(((g.current || 0) / g.target) * 100))) : null;

  // "What needs her" — tasks the agents marked, plus anything the caller already has from DECIDE.
  const needsHuman = T.filter(t => t.needs_human || t.status === 'blocked');
  const needsList = needsHuman.map(t => ({
    key: 'task:' + t.id,
    text: taskTitle(t),
    meta: [(t.assigned || 'unclaimed').toUpperCase(), clock(t.claimed_at || t.updated) ? 'SINCE ' + clock(t.claimed_at || t.updated) : null].filter(Boolean).join(' / '),
    age: when(t.claimed_at, t.updated, t.created),
    path: t.path,
    subject: { kind: 'task', id: t.id, path: t.path, question: t.body || null, task: t, assistant: null },
  })).concat(arr(needs).map(c => ({
    key: 'card:' + (c.id || c.title),
    text: c.title || c.question || c.claim || c.id,
    meta: [(c.actor || c.agent || c.kind || '').toString().toUpperCase(), c.created ? 'SINCE ' + clock(c.created) : null].filter(Boolean).join(' / '),
    age: when(c.created, c.updated),
    path: c.path,
    subject: { kind: 'card', id: c.id, path: c.path, question: c.question || null, task: null, assistant: null },
  })));

  // Who is on it: whoever holds a task here, else whoever the project names, else the whole team.
  const named = new Set(arr(p && p.assistants).map(String));
  const holders = new Set(T.map(t => t.assigned).filter(Boolean).map(String));
  const crew = A.filter(a => holders.has(String(a.id)) || named.has(String(a.id)));
  const onIt = crew.length ? crew : A;

  const finds = arr(findings);
  const findTotal = finds.reduce((s, f) => s + (num(f.count ?? f.n) || 0), 0);

  async function addTask() {
    const text = draft.trim();
    if (!text || adding) return;
    if (!pid) { setError('Open a project first — a task belongs to one.'); return; }
    setAdding(true); setError(null);
    try {
      // POST /api/tasks — backend/tasks.mjs slugifies the title into the id. No `assigned`: the
      // queue hands work out by claiming, and this screen does not get to skip that.
      await api.saveTask({ project: pid, title: text, actor, status: 'open' });
      setDraft('');
      setNonce(n => n + 1);
    } catch (e) {
      setError(e.message || 'That task would not save.');
    } finally {
      setAdding(false);
    }
  }

  if (!pid) {
    return (
      <div style={sx('flex:1;display:flex;align-items:center;justify-content:center;padding:40px')}>
        <Empty size="page" style={sx('max-width:460px')} title="NO PROJECT OPEN"
          body="A project is a goal, a queue of work and the people on it. Pick one from the switcher at the top of the rail." />
      </div>
    );
  }

  return (
    <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden')}>

      {/* THE GOAL — the number first, because that is the question she opens with */}
      <header style={sx('flex:none;padding:20px 24px 18px;border-bottom:1px solid var(--line);display:flex;align-items:flex-start;justify-content:space-between;gap:28px')}>
        <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:12px')}>
          <div style={sx('display:flex;align-items:center;gap:10px')}>
            <Eyebrow style={sx('font-size:9px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>THE GOAL</Eyebrow>
            <span style={{
              ...sx('display:inline-flex;align-items:center;gap:6px;height:18px;padding:0 8px 0 7px;border-radius:9999px'),
              border: '1px solid var(--border-2)',
            }}>
              <Dot size={5} tone={counts('claimed') ? 'var(--marked)' : 'var(--ok)'} />
              <span style={{ ...monoStyle('font-size:8.5px;font-weight:800;letter-spacing:.12em'), color: 'var(--fg-muted)' }}>
                {counts('claimed') ? 'RUNNING' : 'STANDING BY'}
              </span>
            </span>
          </div>

          <h1 style={sx('margin:0;font-size:24px;font-weight:500;letter-spacing:-.015em;line-height:1.3;color:var(--fg)')}>{g.label}</h1>

          <div style={sx('display:flex;align-items:center;gap:16px;flex-wrap:wrap')}>
            {g.target != null ? (
              <>
                <div style={sx('display:flex;align-items:baseline;gap:7px')}>
                  <span style={{ ...sx('font-size:22px;font-weight:600;color:var(--fg)'), ...FIGURE }}>{g.current || 0}</span>
                  <span style={{ ...monoStyle('font-size:12px;font-weight:500'), ...FIGURE, color: 'var(--fg-faint)' }}>
                    / {g.target} {(g.unit || 'found').toUpperCase()}
                  </span>
                </div>
                <div style={{ ...sx('flex:1;height:4px;border-radius:2px;background:var(--line)'), maxWidth: 320 }}>
                  <div style={{ ...sx('height:4px;border-radius:2px;background:var(--fg-soft)'), width: pct + '%' }} />
                </div>
              </>
            ) : null}
            {left != null ? (
              <span style={{ ...monoStyle('font-size:11px;font-weight:500;letter-spacing:.06em'), ...FIGURE, color: left < 0 ? 'var(--warn)' : 'var(--fg-muted)' }}>
                {left < 0 ? Math.abs(left) + ' DAYS OVER' : left + ' DAYS LEFT'}
              </span>
            ) : null}
            <span style={sx('width:1px;height:14px;background:var(--border)')} />
            <PathLink path={(p && p.path) || ('projects/' + pid + '/project.md')} onOpenPath={onOpenPath} style={sx('font-size:11px')} />
            {g.path ? <PathLink path={g.path} onOpenPath={onOpenPath} style={sx('font-size:11px')} /> : null}
          </div>
        </div>

        {/* the ONE solid accent fill */}
        <Btn variant="primary" disabled={!onRun} onClick={() => onRun && onRun()} style={{ flex: 'none', height: 40 }}>
          Put the team to work
        </Btn>
      </header>

      <div style={sx('flex:1;min-height:0;display:flex;overflow:hidden')}>

        {/* THE WORK */}
        <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden;border-right:1px solid var(--line)')}>
          <div style={sx('flex:none;padding:14px 24px 12px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap')}>
            <Eyebrow style={sx('font-size:9px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>THE WORK</Eyebrow>
            <div style={sx('display:flex;align-items:center;gap:6px')}>
              {TASK_LANES.map(l => (
                <span key={l.key} style={{
                  ...sx('display:inline-flex;align-items:center;gap:7px;height:20px;padding:0 9px 0 8px;border-radius:9999px'),
                  border: '1px solid var(--border-2)',
                }}>
                  <Dot size={5} tone={l.color} />
                  <span style={sx('font-size:8.5px;font-weight:800;letter-spacing:.12em;color:var(--fg-muted)')}>{l.name}</span>
                  <span style={{ ...monoStyle('font-size:10px;font-weight:600'), ...FIGURE, color: 'var(--fg-soft)' }}>{counts(l.key)}</span>
                </span>
              ))}
            </div>
          </div>

          {/* add-a-task, in plain language */}
          <div style={sx('flex:none;padding:0 24px 12px;display:flex;flex-direction:column;gap:7px')}>
            <div className="hBd" style={{
              ...sx('display:flex;align-items:center;gap:10px;height:40px;padding:0 12px;border-radius:6px;transition:border-color 130ms ease'),
              background: 'var(--surface-2)', border: '1px solid var(--border)',
            }}>
              <span style={{ ...monoStyle('font-size:12px'), color: 'var(--fg-faint)' }}>+</span>
              <Input value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addTask(); }}
                placeholder="Ask someone to do something — plain language is fine"
                style={sx('flex:1;min-width:0;height:30px;background:transparent;border:none;padding:0;font-family:inherit;font-size:12.5px;color:var(--fg)')} />
              <Btn size="sm" variant="secondary" busy={adding} disabled={!draft.trim()} onClick={addTask}>Add task</Btn>
            </div>
            <span style={{ ...monoStyle('font-size:9.5px;font-weight:600;letter-spacing:.08em'), color: error ? 'var(--warn)' : 'var(--fg-faint)' }}>
              {error || 'IT GOES IN THE QUEUE — WHOEVER IS FREE PICKS IT UP'}
            </span>
          </div>

          <div style={sx('flex:1;min-height:0;overflow-y:auto;padding:0 24px 20px;display:flex;flex-direction:column;gap:16px')}>
            {taskList === null ? null : !T.length ? (
              <Empty title="NOTHING IN THE QUEUE YET" body="Type what you want done above. It becomes a task the assistants can claim." />
            ) : TASK_LANES.map(l => {
              const rows = T.filter(t => t.status === l.key);
              if (!rows.length) return null;
              return (
                <div key={l.key} style={sx('display:flex;flex-direction:column;gap:7px')}>
                  <div style={sx('display:flex;align-items:center;gap:9px')}>
                    <Dot size={5} tone={l.color} />
                    <span style={{ ...sx('font-size:8.5px;font-weight:800;letter-spacing:.18em'), color: l.key === 'blocked' ? 'var(--warn)' : 'var(--fg-muted)' }}>{l.name}</span>
                    <span style={{ ...monoStyle('font-size:10px;font-weight:600'), ...FIGURE, color: 'var(--fg-faint)' }}>{rows.length}</span>
                    <span style={sx('flex:1;height:1px;background:var(--line)')} />
                  </div>
                  {rows.map(t => <TaskRow key={t.id} t={t} onDecide={onDecide} onOpenPath={onOpenPath} />)}
                </div>
              );
            })}
          </div>
        </div>

        {/* the right column — 352px per design/EXTRACT.md §3.2 */}
        <aside style={{ ...sx('flex:none;display:flex;flex-direction:column;overflow-y:auto'), width: 352 }}>

          <Panel label="NEEDS YOU"
            right={<span style={{ ...monoStyle('font-size:11px;font-weight:600'), ...FIGURE, color: needsList.length ? 'var(--warn)' : 'var(--fg-faint)' }}>{needsList.length}</span>}>
            {!needsList.length ? (
              <Empty title="NOTHING WAITING — YOUR ASSISTANTS ARE CLEAR" />
            ) : needsList.map(n => (
              <button key={n.key} type="button" className="hBd" disabled={!onDecide}
                onClick={() => onDecide && onDecide(n.subject)}
                style={{
                  ...sx('display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:6px;width:100%;text-align:left;transition:border-color 130ms ease'),
                  background: 'var(--surface-2)', border: '1px solid var(--border)', cursor: onDecide ? 'pointer' : 'default',
                }}>
                <span style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:4px')}>
                  <span style={sx('font-size:12.5px;font-weight:500;color:var(--fg-soft);line-height:1.35')}>{n.text}</span>
                  <span style={sx('display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>
                    <StatLine parts={[n.meta]} />
                    <Freshness value={n.age} showLabel={false} width={28} />
                  </span>
                  <PathLink path={n.path} onOpenPath={onOpenPath} />
                </span>
                <span style={{ ...monoStyle('flex:none;font-size:11px'), color: 'var(--accent)' }}>→</span>
              </button>
            ))}
          </Panel>

          <Panel label="WHO'S ON IT"
            right={
              <button type="button" disabled={!onOpenAssistants} onClick={() => onOpenAssistants && onOpenAssistants()}
                className={onOpenAssistants ? 'hFgL' : ''}
                style={{ ...monoStyle('font-size:10px;font-weight:500;padding:0;background:none;border:none'), color: 'var(--fg-faint)', cursor: onOpenAssistants ? 'pointer' : 'default' }}>
                {onIt.length + ' OF YOUR ' + (A.length || onIt.length)}
              </button>
            }>
            {team === null ? null : !onIt.length ? (
              <Empty title="NO ASSISTANTS HIRED YET" />
            ) : onIt.map(a => (
              <CrewCard key={a.id} a={a} tasks={T} runs={R} currency={currency}
                onOpenPath={onOpenPath} onDecide={onDecide} />
            ))}
          </Panel>

          <Panel last label="WHAT THEY'VE TURNED UP"
            right={findTotal ? <span style={{ ...monoStyle('font-size:11px;font-weight:600'), ...FIGURE, color: 'var(--fg-soft)' }}>{findTotal}</span> : null}>
            {!finds.length ? (
              <Empty title="NOTHING TURNED UP YET" body="Findings land here as the assistants work — one file each, under this project." />
            ) : finds.map(f => (
              <button key={f.collection || f.label} type="button" className="hBd"
                disabled={!onOpenCollection || !f.collection}
                onClick={() => onOpenCollection && f.collection && onOpenCollection(f.collection)}
                style={{
                  ...sx('display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 12px;border-radius:6px;width:100%;text-align:left;transition:border-color 130ms ease'),
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  cursor: onOpenCollection && f.collection ? 'pointer' : 'default',
                }}>
                <span style={sx('display:flex;flex-direction:column;gap:3px;min-width:0')}>
                  <span style={{ ...monoStyle('font-size:11.5px;font-weight:600'), color: 'var(--fg-soft)' }}>
                    {f.label || ('#' + f.collection)}
                  </span>
                  <span style={sx('font-size:11.5px;color:var(--fg-muted)')}>{f.what || 'found for this project'}</span>
                  <PathLink path={f.path} onOpenPath={onOpenPath} />
                </span>
                <span style={sx('flex:none;display:flex;align-items:baseline;gap:6px')}>
                  <span style={{ ...monoStyle('font-size:18px;font-weight:600'), ...FIGURE, color: 'var(--fg)' }}>
                    {num(f.count ?? f.n) ?? 0}
                  </span>
                  <span style={{ ...monoStyle('font-size:11px'), color: 'var(--accent)' }}>→</span>
                </span>
              </button>
            ))}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
