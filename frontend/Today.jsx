// frontend/Today.jsx — the 9am screen (GOAL §3, T13's other half).
//
// PROPS
//   actor       string    who is looking. Defaults to 'crystal'. Reserved for writes; this screen reads.
//   onGo        fn(key)   navigate. Called with a screen key from 08_MODULE_CONTRACTS.md §10 —
//                         'decide' from NEEDS YOU and from the D key, 'goals' from the goals panel.
//   onOpenPath  fn(path)  open a raw .md (Law 8). Optional; links hide without it.
//   onSendOut   fn()      put the assistants back out. Optional — with no runner wired the button
//                         says so instead of pretending. Returns a promise if it does work.
//   refreshKey  any       change it to force a reload (after a decision, after a run).
//
// WHAT IS ON IT, AND NOTHING ELSE
//   1  THREE LINES — what the assistants did overnight.
//   2  NEEDS YOU   — the count, and the one key that starts the queue.
//   3  BEHIND      — the goals that are not going to make it.
//   4  RUNNING     — who is out, who is blocked, and the goals in full (right column).
// That is the whole screen. This is altitude 1 in its entirety: there is no reasoning here and no
// evidence here, because every one of those lives on a card in DECIDE. If you are about to add a
// section, ask whether it is a decision — if it is, it belongs in the queue, and if it is not, it
// belongs on a screen she chose to open.
//
// THE THREE LINES ARE COMPUTED FROM REAL DATA, OR THEY SAY SO
// Sources: api.runs() · api.activity() · api.proposals() · api.goals() · api.assistants(). Every
// figure on this screen is counted from one of those five. When a source is empty or its route is
// not up yet, the line becomes a short mono uppercase statement of that fact — never a zero
// dressed up as news, and never a placeholder number. A person who is trusting an agent overnight
// has to be able to trust the morning summary absolutely.
//
// WHY THE DESIGN'S INLINE "YOUR AGENTS ARE ASKING" BAND IS NOT HERE
// design/Today.dc.html answers agent questions in place with Yes/No/Later. T13 says EVERY approval
// in the app flows through the one queue, and a second decision surface is exactly the second
// implementation Law 10 forbids. Questions are counted here and answered in DECIDE.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { api } from './api';
import { Btn, Chip, Empty, Eyebrow } from './ui';
import { KIND, normalizeCard, unwrap } from './DecideCards';

const mono = (extra = '') => ({ ...sx('font-variant-numeric:tabular-nums;' + extra), fontFamily: MONO });

const first = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '');
// `Number(null)` is 0 and `Number('')` is 0, so the null guard comes first — without it a goal
// with no deadline renders "0 DAYS LEFT", which is a lie with a number on it.
const num = v => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

// "Overnight" starts at 18:00 the evening before today. She opens this at 9am; everything the
// assistants did while she was away sits inside that window.
function overnightStart(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime() - 6 * 3600 * 1000;
}

const clock = ts => {
  const t = Date.parse(String(ts));
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};

// ── normalisers ───────────────────────────────────────────────────────────────────────────────
// Same discipline as DecideCards.normalizeCard: the documented key first, the obvious aliases
// after, and never a crash on a shape that has not landed yet.
const body = r => (r && r.data && typeof r.data === 'object' ? r.data : r || {});

function normEvent(r) {
  const d = body(r);
  return {
    type: String(first(d.type, r.type) || ''),
    actor: String(first(d.actor, r.actor) || ''),
    target: first(d.target, r.target) || null,
    at: Date.parse(String(first(d.at, d.ts, d.time, d.created, r.at) || '')) || null,
  };
}

function normRun(r) {
  const d = body(r);
  const started = Date.parse(String(first(d.started, d.started_at, d.start, d.at, d.created) || '')) || null;
  return {
    assistant: String(first(d.assistant, d.actor, d.agent, r.assistant) || ''),
    started,
    ended: Date.parse(String(first(d.ended, d.ended_at, d.finished, d.finished_at, d.updated) || '')) || null,
    found: num(first(d.found, d.finds, d.results, d.records, d.stored)),
    status: String(first(d.status, d.state) || ''),
  };
}

function normAssistant(r) {
  const d = body(r);
  return {
    id: String(first(r.id, d.id, d.name, r.slug) || ''),
    name: String(first(d.name, r.id, d.id) || 'unnamed'),
    job: String(first(d.job, d.does, d.role, d.description, d.summary) || ''),
    state: String(first(d.status, d.state) || 'idle').toLowerCase(),
    parent: first(d.parent, d.parent_of, d.sub_agent_of) || null,
  };
}

// backend/memory.mjs `shapeGoal` already computes `current`, `target`, `daysLeft` and `behind` —
// `behind` deliberately so, because "a `behind:` someone typed months ago can never keep claiming
// a goal is fine". The computed value wins; the frontmatter is only a fallback for a payload that
// predates it. Never a second staleness or progress rule on this side of the wire (Law: decay.mjs
// and shapeGoal decide, the frontend renders).
function normGoal(r) {
  const d = body(r);
  const target = num(first(r.target, d.target, d.threshold));
  const current = num(first(r.current, d.current, d.value)) ?? 0;
  const unit = String(first(r.unit, d.unit, '') || '');
  const deadline = Date.parse(String(first(d.deadline, d.due, d.by) || '')) || null;
  const daysLeft = num(r.daysLeft) ?? (deadline === null ? null : Math.ceil((deadline - Date.now()) / 86400000));
  return {
    id: String(first(r.id, d.id, r.slug) || ''),
    path: first(r.path, d.path) || null,
    label: String(first(r.label, d.label, d.name, d.statement, r.id) || 'a goal'),
    kind: String(first(d.kind, 'target')),
    target, current, unit, daysLeft,
    pct: target ? Math.max(0, Math.min(1, current / target)) : 0,
    behind: typeof r.behind === 'boolean' ? r.behind : Boolean(d.behind),
    figure: target === null
      ? String(current) + (unit === 'percent' ? '%' : '')
      : (unit === 'percent' ? current + '% / ' + target + '%' : current + ' / ' + target),
    assistants: [].concat(d.assistants ?? []).filter(Boolean).map(String),
  };
}

// ── the three lines ───────────────────────────────────────────────────────────────────────────
// Each returns { text, honest } — `honest: true` means "there was nothing to report", and it
// renders as a short mono uppercase status line rather than as prose with a fabricated number.
function overnightLines({ runs, events, cards, goals, sources }) {
  const since = overnightStart();
  const nightRuns = runs.filter(r => r.started && r.started >= since);
  const nightEvents = events.filter(e => e.at && e.at >= since);
  const lines = [];

  // 1 · who was out
  if (!sources.runs && !sources.activity) {
    lines.push({ text: 'NO RUN LOG AND NO EVENT LOG — NOTHING IS RECORDED YET', honest: true });
  } else if (nightRuns.length) {
    const who = [...new Set(nightRuns.map(r => r.assistant).filter(Boolean))];
    const from = clock(Math.min(...nightRuns.map(r => r.started)));
    const to = clock(Math.max(...nightRuns.map(r => r.ended || r.started)));
    lines.push({
      text: plural(nightRuns.length, 'run', 'runs') + ' overnight' + (from && to ? ', ' + from + ' to ' + to : '')
        + (who.length ? ' — ' + who.join(', ') + '.' : '.'),
      honest: false,
    });
  } else if (nightEvents.length) {
    const who = [...new Set(nightEvents.map(e => e.actor).filter(Boolean))];
    lines.push({ text: 'No runs were logged overnight, but ' + plural(nightEvents.length, 'change', 'changes') + ' landed' + (who.length ? ' from ' + who.join(', ') : '') + '.', honest: false });
  } else {
    lines.push({ text: 'NO ASSISTANT RAN OVERNIGHT', honest: true });
  }

  // 2 · what came of it
  const by = t => nightEvents.filter(e => e.type === t).length;
  const stored = by('store');
  const changed = by('update') + by('merge');
  const skipped = by('skip');
  const refused = by('refused') + by('quarantine');
  if (!sources.activity) {
    lines.push({ text: 'THE EVENT LOG IS NOT AVAILABLE — WHAT WAS WRITTEN CANNOT BE SHOWN', honest: true });
  } else if (stored || changed || skipped || refused) {
    const bits = [];
    if (stored) bits.push(plural(stored, 'new record', 'new records'));
    if (changed) bits.push(plural(changed, 'update', 'updates'));
    if (skipped) bits.push(plural(skipped, 'duplicate skipped', 'duplicates skipped'));
    // Law 4 is only a guarantee if a refusal is visible the next morning — so a night whose only
    // events were refusals still gets a sentence, not an empty one with a full stop on it.
    const gate = refused ? plural(refused, 'write was refused at the gate', 'writes were refused at the gate') : '';
    let text = bits.length
      ? bits.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.' + (gate ? ' ' + gate + '.' : '')
      : 'Nothing was written, and ' + gate + '.';
    lines.push({ text: text.charAt(0).toUpperCase() + text.slice(1), honest: false });
  } else {
    lines.push({ text: 'NOTHING WAS WRITTEN OVERNIGHT', honest: true });
  }

  // 3 · what it means for her
  const behind = goals.filter(g => g.behind);
  if (!sources.proposals && !sources.goals) {
    lines.push({ text: 'THE QUEUE AND YOUR GOALS ARE NOT AVAILABLE', honest: true });
  } else if (cards.length || behind.length) {
    const bits = [];
    if (cards.length) bits.push(plural(cards.length, 'decision is waiting', 'decisions are waiting'));
    if (behind.length) bits.push(plural(behind.length, 'goal is behind', 'goals are behind') + ': ' + behind.map(g => g.label).join(', '));
    let text = bits.join(', and ') + '.';
    lines.push({ text: text.charAt(0).toUpperCase() + text.slice(1), honest: false });
  } else {
    lines.push({ text: 'NOTHING IS WAITING — YOUR ASSISTANTS ARE CLEAR', honest: true });
  }

  return lines;
}

// ── panels ────────────────────────────────────────────────────────────────────────────────────
// The design's section container: --surface, 1px --border, r8. It is not ui.jsx's Card (r10,
// --border-2, 11/13 padding, a status dot in its header) — that one is the dense chat/list card
// and forcing it here would mean overriding every value it owns. One container, declared once,
// used by all four panels on this screen.
function Panel({ label, right, headPad = '20px 22px 0', divider = false, grow = false, children, onLabelClick }) {
  return (
    <section style={{
      ...sx('background:var(--surface);border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;overflow:hidden'),
      ...(grow ? sx('flex:1;min-height:0') : sx('flex:none')),
    }}>
      <div style={{
        ...sx('flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px'),
        padding: headPad,
        ...(divider ? { borderBottom: '1px solid var(--line)' } : null),
      }}>
        {onLabelClick
          ? <Btn variant="ghost" className="hFgL" onClick={onLabelClick} style={sx('padding:0;border:none;border-radius:0')}>
              <Eyebrow style={sx('font-size:9.5px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>{label}</Eyebrow>
            </Btn>
          : <Eyebrow style={sx('font-size:9.5px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>{label}</Eyebrow>}
        {right ? <span style={{ ...mono('font-size:10px;font-weight:500;color:var(--fg-faint)') }}>{right}</span> : null}
      </div>
      {children}
    </section>
  );
}

function GoalRow({ goal, onOpen }) {
  const left = goal.daysLeft === null
    ? (goal.kind === 'threshold' ? 'MEASURED CONTINUOUSLY' : 'NO DEADLINE')
    : goal.daysLeft < 0 ? Math.abs(goal.daysLeft) + 'D OVERDUE' : goal.daysLeft + ' DAYS LEFT';
  return (
    <div style={sx('padding:13px 16px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:9px')}>
      <div style={sx('display:flex;align-items:flex-start;justify-content:space-between;gap:12px')}>
        {goal.path && onOpen
          ? <Btn variant="ghost" className="hFg" onClick={() => onOpen(goal.path)} style={sx('padding:0;border:none;border-radius:0;font-size:12.5px;font-weight:500;color:var(--fg-soft);line-height:1.35;text-align:left;display:block')}>{goal.label}</Btn>
          : <span style={sx('font-size:12.5px;font-weight:500;color:var(--fg-soft);line-height:1.35')}>{goal.label}</span>}
        <span style={{ ...mono('font-size:11.5px;font-weight:600;color:var(--fg);flex:none') }}>{goal.figure}</span>
      </div>
      <div style={sx('height:3px;background:var(--line);border-radius:2px')}>
        <div style={{ ...sx('height:3px;border-radius:2px'), width: Math.round(goal.pct * 100) + '%', background: goal.behind ? 'var(--warn)' : 'var(--fg-soft)' }} />
      </div>
      <span style={{ ...mono('font-size:9.5px;font-weight:500;letter-spacing:.08em'), color: goal.behind ? 'var(--warn)' : 'var(--fg-faint)' }}>
        {(goal.behind ? 'BEHIND / ' : '') + left + ((goal.assistants || []).length ? ' / ' + goal.assistants.join(', ').toUpperCase() : '')}
      </span>
    </div>
  );
}

const RUNNING = ['running', 'sweeping', 'working', 'checking', 'busy'];
const STUCK = ['blocked', 'waiting', 'error', 'failed'];

function AssistantRow({ a, run }) {
  const state = RUNNING.includes(a.state) ? 'running' : STUCK.includes(a.state) ? 'blocked' : 'idle';
  const dot = state === 'running' ? 'var(--ok)' : state === 'blocked' ? 'var(--warn)' : 'var(--border-3)';
  const stateFg = state === 'running' ? 'var(--ok)' : state === 'blocked' ? 'var(--warn)' : 'var(--fg-faint)';
  const stat = run
    ? ['LAST RUN ' + (clock(run.started) || '—'), run.found === null ? null : run.found + ' FOUND'].filter(Boolean).join(' / ')
    : 'NO RUN RECORDED';
  return (
    <div style={{ ...sx('display:flex;gap:11px;padding:11px 16px;border-bottom:1px solid var(--line)'), paddingLeft: a.parent ? 34 : 16 }}>
      <span style={{ ...sx('flex:none;margin-top:5px;width:7px;height:7px;border-radius:9999px'), background: dot }} />
      <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:3px')}>
        <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:10px')}>
          <span style={{ ...mono('font-size:12px;font-weight:600'), color: a.parent ? 'var(--fg-soft)' : 'var(--fg)' }}>{a.name}</span>
          <span style={{ ...mono('font-size:9px;font-weight:800;letter-spacing:.12em'), color: stateFg }}>{a.state.toUpperCase()}</span>
        </div>
        {a.job ? <span style={sx('font-size:11.5px;font-weight:400;color:var(--fg-muted);line-height:1.4')}>{a.job}</span> : null}
        <span style={{ ...mono('font-size:9.5px;font-weight:500;color:var(--fg-faint)') }}>{a.parent ? 'SUB-AGENT OF ' + String(a.parent).toUpperCase() + ' / ' : ''}{stat}</span>
      </div>
    </div>
  );
}

// A short mono uppercase status band. 05_UI_SPEC.md §6 — this is how the app says "nothing here",
// everywhere, and it is the shape T13 names for the empty queue.
function Band({ children, grow = false, tone }) {
  return (
    <div style={{
      ...sx('display:flex;align-items:center;justify-content:center;text-align:center;border:1px dashed var(--border-2);border-radius:8px;padding:18px;min-height:96px'),
      ...(grow ? sx('flex:1;min-height:150px') : sx('flex:none')),
    }}>
      <span style={{ ...mono('font-size:11px;font-weight:600;letter-spacing:.14em'), color: tone || 'var(--fg-faint)' }}>{children}</span>
    </div>
  );
}

// ── the screen ────────────────────────────────────────────────────────────────────────────────
export default class Today extends React.Component {
  state = {
    loading: true, sending: false,
    cards: [], goals: [], assistants: [], runs: [], events: [],
    sources: { proposals: false, goals: false, assistants: false, runs: false, activity: false },
  };

  componentDidMount() {
    this.mounted = true;
    window.addEventListener('keydown', this.onKey);
    this.load();
  }

  componentDidUpdate(prev) {
    if (prev.refreshKey !== this.props.refreshKey) this.load();
  }

  componentWillUnmount() {
    this.mounted = false;
    window.removeEventListener('keydown', this.onKey);
  }

  // Five independent reads. One route being down must degrade one panel, never the morning —
  // most of these land across M3 and M4 and this screen is the first thing anyone opens.
  async load() {
    const settled = await Promise.allSettled([
      api.proposals('open'), api.goals(), api.assistants(), api.runs({ limit: 40 }), api.activity(300),
    ]);
    if (!this.mounted) return;
    const [p, g, a, r, ev] = settled;
    const ok = x => x.status === 'fulfilled';
    this.setState({
      loading: false,
      cards: ok(p) ? unwrap(p.value, 'proposals', 'cards').map(normalizeCard).filter(Boolean) : [],
      goals: ok(g) ? unwrap(g.value, 'goals').map(normGoal) : [],
      assistants: ok(a) ? unwrap(a.value, 'assistants').map(normAssistant) : [],
      runs: ok(r) ? unwrap(r.value, 'runs').map(normRun) : [],
      events: ok(ev) ? unwrap(ev.value, 'events', 'activity').map(normEvent) : [],
      sources: { proposals: ok(p), goals: ok(g), assistants: ok(a), runs: ok(r), activity: ok(ev) },
    });
  }

  onKey = e => {
    const t = e.target || document.activeElement;
    const tag = String((t && t.tagName) || '').toLowerCase();
    if ((t && t.isContentEditable) || tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = String(e.key).toLowerCase();
    if (k === 'd') { e.preventDefault(); if (this.props.onGo) this.props.onGo('decide'); }
    else if (k === 'enter') { e.preventDefault(); this.send(); }
  };

  async send() {
    if (!this.props.onSendOut || this.state.sending) return;
    this.setState({ sending: true });
    try { await this.props.onSendOut(); } finally { if (this.mounted) this.setState({ sending: false }); this.load(); }
  }

  render() {
    const { loading, sending, cards, goals, assistants, runs, events, sources } = this.state;
    const { onGo, onOpenPath, onSendOut } = this.props;

    if (loading) {
      return (
        <div style={sx('flex:1;display:flex;align-items:center;justify-content:center;padding:40px')}>
          <Empty size="page" style={sx('max-width:440px')} title="READING THE WORKSPACE" />
        </div>
      );
    }

    const lines = overnightLines({ runs, events, cards, goals, sources });
    const behind = goals.filter(g => g.behind);
    const since = overnightStart();
    const nightRuns = runs.filter(r => r.started && r.started >= since);
    const runWindow = nightRuns.length
      ? (clock(Math.min(...nightRuns.map(r => r.started))) + ' → ' + (clock(Math.max(...nightRuns.map(r => r.ended || r.started))) || 'NOW') + ' / ' + nightRuns.length + ' RUNS')
      : (sources.runs ? 'NO RUNS RECORDED' : 'NO RUN LOG');

    // Breakdown of the queue by kind — the same six kinds, the same table, no second vocabulary.
    const byKind = cards.reduce((m, c) => { m[c.kind] = (m[c.kind] || 0) + 1; return m; }, {});
    const runningNow = assistants.filter(a => RUNNING.includes(a.state)).length;
    const lastRunFor = id => runs.find(r => r.assistant === id) || null;

    return (
      <div style={sx('flex:1;min-height:0;display:flex;gap:16px;padding:20px;overflow:hidden')}>

        <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;overflow:hidden')}>

          {/* ── 1 · three lines ───────────────────────────────────────────────────────────── */}
          <Panel label="OVERNIGHT" right={runWindow}>
            <div style={sx('padding:12px 22px 20px;display:flex;flex-direction:column;gap:7px')}>
              {lines.map((l, i) => (l.honest
                ? <span key={i} style={{ ...mono('font-size:11px;font-weight:600;letter-spacing:.14em;color:var(--fg-faint)') }}>{l.text}</span>
                : <p key={i} style={sx('margin:0;font-size:16px;font-weight:400;line-height:1.45;color:var(--fg-soft);text-wrap:pretty')}>{l.text}</p>
              ))}
            </div>
          </Panel>

          {/* ── 2 · what needs her ────────────────────────────────────────────────────────── */}
          <Panel label="NEEDS YOU" right={sources.proposals ? null : 'THE QUEUE IS NOT AVAILABLE'} headPad="16px 22px 0">
            <div style={sx('padding:10px 22px 16px;display:flex;flex-direction:column;gap:14px')}>
              <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:20px')}>
                <div style={sx('display:flex;align-items:baseline;gap:8px;flex:none')}>
                  <span style={{ ...mono('font-size:30px;font-weight:600;line-height:1;color:var(--fg)') }}>{cards.length}</span>
                  <span style={sx('font-size:12.5px;font-weight:500;color:var(--fg-muted)')}>
                    {cards.length === 1 ? 'decision waiting' : 'decisions waiting'}
                  </span>
                </div>
                {/* Outlined, not filled: the one solid accent on TODAY is "Send them out". */}
                <Btn variant="secondary" disabled={!cards.length || !onGo} onClick={() => onGo && onGo('decide')}
                  style={sx('flex:none;height:40px;padding:0 18px;border-radius:6px;font-size:13px;gap:10px')}>
                  <span>Start deciding</span>
                  <span style={{ ...mono('font-size:10px;font-weight:600;border:1px solid var(--accent-35);border-radius:4px;padding:1px 5px') }}>D</span>
                </Btn>
              </div>
              {cards.length ? (
                <div style={sx('display:flex;flex-wrap:wrap;gap:6px;min-width:0')}>
                  {Object.keys(byKind).map(k => {
                    const n = byKind[k];
                    const word = (KIND[k] || KIND.unknown).chip;
                    return (
                      <Chip
                        key={k}
                        onClick={() => onGo && onGo('decide')}
                        title={(KIND[k] || KIND.unknown).effect}
                        style={{
                          ...sx('height:26px;display:inline-flex;align-items:center;gap:7px;padding:0 10px;border-radius:6px;background:var(--surface-2);border:1px solid var(--border);font-size:11px'),
                          // Chip is mono by default; the figure stays mono and the word does not.
                          fontFamily: 'inherit',
                        }}
                        label={<>
                          <span style={{ ...mono('font-size:11px;font-weight:600;color:var(--fg-soft)') }}>{n}</span>
                          <span style={sx('font-size:11px;font-weight:500;color:var(--fg-muted)')}>{n === 1 ? word.one : word.many}</span>
                        </>}
                      />
                    );
                  })}
                </div>
              ) : (
                <Band>NO QUESTIONS — YOUR ASSISTANTS ARE CLEAR</Band>
              )}
            </div>
          </Panel>

          {/* ── 3 · the goals that are not going to make it ───────────────────────────────── */}
          <section style={sx('flex:1;min-height:0;display:flex;flex-direction:column;gap:10px')}>
            <div style={sx('flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 2px')}>
              <Eyebrow style={sx('font-size:9.5px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>BEHIND SCHEDULE</Eyebrow>
              <span style={{ ...mono('font-size:10px;font-weight:500;color:var(--fg-faint)') }}>
                {sources.goals ? behind.length + ' OF ' + goals.length : 'GOALS NOT AVAILABLE'}
              </span>
            </div>
            <div style={sx('flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:8px')}>
              {!sources.goals ? (
                <Band grow>THE GOALS ROUTE IS NOT UP YET</Band>
              ) : !goals.length ? (
                <Band grow>NO GOALS SET — TELL YOUR ASSISTANTS WHAT WINNING LOOKS LIKE</Band>
              ) : !behind.length ? (
                <Band grow>{'NOTHING IS BEHIND — ' + goals.length + ' ON TRACK'}</Band>
              ) : behind.map(g => (
                <div key={g.id} style={sx('flex:none;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;overflow:hidden')}>
                  <GoalRow goal={g} onOpen={onOpenPath} />
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* ── 4 · what is running (388px, EXTRACT.md §3.2) ─────────────────────────────────── */}
        <aside style={sx('width:388px;flex:none;display:flex;flex-direction:column;gap:16px;overflow:hidden')}>

          {/* The one solid accent fill on this screen. With no runner wired it says so rather
              than looking like a button that works. */}
          <Btn
            variant="primary"
            busy={sending}
            disabled={!onSendOut}
            onClick={() => this.send()}
            style={sx('flex:none;display:flex;align-items:center;justify-content:space-between;gap:14px;height:64px;padding:0 22px;border-radius:8px')}
          >
            <span style={sx('display:flex;flex-direction:column;gap:4px;align-items:flex-start')}>
              <span style={sx('font-size:16px;font-weight:600')}>{sending ? 'They’re out' : 'Send them out'}</span>
              <span style={{ ...mono('font-size:10px;font-weight:600;letter-spacing:.1em;opacity:.72') }}>
                {!onSendOut ? 'NO RUNNER WIRED YET'
                  : sending ? plural(assistants.length, 'ASSISTANT', 'ASSISTANTS') + ' STARTING'
                  : runningNow ? plural(runningNow, 'ASSISTANT', 'ASSISTANTS') + ' ALREADY RUNNING'
                  : plural(assistants.length, 'ASSISTANT', 'ASSISTANTS') + ' IDLE'}
              </span>
            </span>
            <span style={{ ...mono('font-size:11px;font-weight:600;border-radius:4px;padding:3px 8px;background:var(--accent-deep);color:var(--on-accent)') }}>&#8629;</span>
          </Btn>

          <Panel label="YOUR ASSISTANTS" right={sources.assistants ? runningNow + ' RUNNING' : 'NOT AVAILABLE'} headPad="12px 16px 10px" divider>
            {assistants.length
              ? assistants.map(a => <AssistantRow key={a.id || a.name} a={a} run={lastRunFor(a.id || a.name)} />)
              : <div style={sx('padding:16px')}><Band>{sources.assistants ? 'NO ASSISTANTS HIRED YET' : 'THE ASSISTANTS ROUTE IS NOT UP YET'}</Band></div>}
          </Panel>

          <Panel label="GOALS" right="SET BY YOU" headPad="12px 16px 10px" divider grow onLabelClick={onGo ? () => onGo('goals') : null}>
            <div style={sx('flex:1;min-height:0;overflow-y:auto')}>
              {goals.length
                ? goals.map(g => <GoalRow key={g.id} goal={g} onOpen={onOpenPath} />)
                : <div style={sx('padding:16px')}><Band>{sources.goals ? 'NO GOALS SET' : 'THE GOALS ROUTE IS NOT UP YET'}</Band></div>}
            </div>
          </Panel>
        </aside>
      </div>
    );
  }
}
