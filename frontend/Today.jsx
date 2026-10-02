// frontend/Today.jsx — the Today loop (docs/09_TODAY_LOOP.md).
//
// This screen used to be "three lines + needs you + behind + running" — a morning dashboard. The
// owner replaced it with the conductor loop: plan on the left, NOW + chat in the middle, TIME on
// the right. The overnight three-lines summary did not die — it is the first line of the morning
// plan message now, computed server-side (backend/today.mjs overnightLine) from the same sources
// overnightLines() reads. The pure helpers stay exported because tests exercise them directly.
//
// PROPS
//   actor       string    who is looking (reserved for writes; the routes default to the human)
//   onGo        fn(key)   navigate — 'decide' from NEEDS YOU
//   onOpenPath  fn(path)  open a raw .md — reviews and work items are real documents
//   refreshKey  any       change it to force a reload
//
// WHAT THE SCREEN DOES — and what it never does
//   Every number arrives computed: GET /api/today answers plan, clock, nudges, stats and usage in
//   one payload, because the 60s poll is the loop's heartbeat. The screen only ever calls the
//   action routes (start/pause/resume/done/park/stuck/add/reorder) and chat — it does not re-derive
//   minutes, it does not rank the plan, and it never writes a file.
//
// IDLE: 5 minutes without input or a hidden window pauses the clock (the item stays "now"); the
// next input resumes it. The human's intent is the item, not the mouse — so idle never parks.
//
// KEYS: Enter in the composer sends · ⌘↩ marks the now item done.

import React from 'react';
import { TeamPulse } from './Admin';
import { sx } from './sx';
import { MONO } from './tokens';
import { api } from './api';
import { Btn, Chip, Empty, Eyebrow, Input } from './ui';
import { Markdown } from './Markdown';
import { TodayExtras } from './Integrations';
import Artifact, { ArtifactList, messageArtifacts, artifactMessageText, workArtifacts, normalizeArtifacts } from './Artifact';

const mono = (extra = '') => ({ ...sx('font-variant-numeric:tabular-nums;' + extra), fontFamily: MONO });

const first = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '');
const num = v => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

// ── the old screen's pure helpers — kept: tests import them, and the server ports their maths ──
// "Overnight" starts at 18:00 the evening before today.
function overnightStart(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime() - 6 * 3600 * 1000;
}

// HH:MM from anything that is a moment — a number or a string.
export const clock = ts => {
  const t = ts instanceof Date ? ts.getTime() : (typeof ts === 'number' ? ts : Date.parse(String(ts)));
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};

const body = r => (r && r.data && typeof r.data === 'object' ? r.data : r || {});

export function normRun(r) {
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



// The overnight summary — the old screen's three lines. It lives on now as the first line of the
// morning plan message (backend computes its own copy); kept here for tests and for any caller
// that still wants the client-side shape.
export function overnightLines({ runs, events, cards, goals, sources }) {
  const since = overnightStart();
  const nightRuns = runs.filter(r => r.started && r.started >= since);
  const nightEvents = events.filter(e => e.at && e.at >= since);
  const lines = [];

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
    const gate = refused ? plural(refused, 'write was refused at the gate', 'writes were refused at the gate') : '';
    let text = bits.length
      ? bits.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.' + (gate ? ' ' + gate + '.' : '')
      : 'Nothing was written, and ' + gate + '.';
    lines.push({ text: text.charAt(0).toUpperCase() + text.slice(1), honest: false });
  } else {
    lines.push({ text: 'NOTHING WAS WRITTEN OVERNIGHT', honest: true });
  }

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

// ── the loop's own helpers ────────────────────────────────────────────────────────────────────
const fmtMin = m => {
  const n = Math.round(m || 0);
  const h = Math.floor(n / 60), r = n % 60;
  return h ? h + 'h ' + String(r).padStart(2, '0') + 'm' : r + 'm';
};
const fmtTimer = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};

// The day chart draws the whole period, not just days that have segments — a Mon–Sun week with
// one tracked Friday must still show seven columns, or the chart is a single slab.
const parseLocalDay = d => { const [y, m, dd] = String(d).split('-').map(Number); return new Date(y, m - 1, dd); };
const fmtLocalDay = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export function fillDays(byDay, range, day) {
  const map = new Map((byDay || []).map(d => [d.day, d]));
  const today = parseLocalDay(day);
  let start;
  let end = new Date(today);
  if (range === 'week') {
    start = new Date(today);
    start.setDate(today.getDate() - ((today.getDay() + 6) % 7)); // Monday
    end = new Date(start);
    end.setDate(start.getDate() + 6);                            // Sunday
  } else {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
    end.setDate(1); end.setMonth(end.getMonth() + 1); end.setDate(0); // last day of month
  }
  const out = [];
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = fmtLocalDay(d);
    out.push(map.get(key) || { day: key, minutes: 0, by_bucket: [] });
  }
  return out;
}

// Bucket fills use the NEUTRAL ramp only — accent is "click this" and ok/warn/danger/marked are
// status channels, so a bucket can never wear either. Ranked by minutes within the visible range:
// the biggest bucket is the darkest, in both the bar list and the day chart.
const BUCKET_RAMP = ['var(--fg)', 'var(--fg-soft)', 'var(--fg-muted)', 'var(--fg-faint)', 'var(--border-3)', 'var(--border-2)'];
const bucketTone = (bucket, rank) => {
  const i = rank instanceof Map ? (rank.get(bucket) ?? BUCKET_RAMP.length - 1) : BUCKET_RAMP.length - 1;
  return BUCKET_RAMP[Math.min(i, BUCKET_RAMP.length - 1)];
};

function Section({ label, right, children, grow = false }) {
  return (
    <section style={{
      ...sx('background:var(--surface);border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;overflow:hidden'),
      ...(grow ? sx('flex:1;min-height:0') : sx('flex:none')),
    }}>
      <div style={sx('flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px 0')}>
        <Eyebrow style={sx('font-size:9.5px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>{label}</Eyebrow>
        {right ? <span style={{ ...mono('font-size:10px;font-weight:500;color:var(--fg-faint)') }}>{right}</span> : null}
      </div>
      {children}
    </section>
  );
}

// A plan row: state dot, bucket chip, title, estimate vs actual. Click starts it (the clock does
// the switching); ↑/↓ nudge it in the order without a drag layer.
function PlanRow({ it, ix, total, onStart, onMove, onOpen }) {
  const done = it.status === 'done';
  const now = it.status === 'now';
  const marker = done ? '✓' : now ? '●' : '·';
  const markerColor = done ? 'var(--ok)' : now ? 'var(--marked)' : 'var(--fg-faint)';
  const tag = it.wait_reason ? 'waiting' : it.status === 'parked' ? 'parked' : it.status === 'stuck' ? 'stuck'
    : it.prep && it.prep_state === 'preparing' ? 'preparing…' : null;
  return (
    <div className="planRow" onClick={() => { if (!done && !it.wait_reason) onStart(it); }}
      style={sx('display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line);position:relative;cursor:' + (done ? 'default' : 'pointer'))}
      title={done ? 'Done' : it.wait_reason || 'Click to start'}>
      <span style={{ ...mono('font-size:11px;font-weight:700;width:14px;flex:none;text-align:center'), color: markerColor }}>{marker}</span>
      <Chip label={String(it.bucket || 'admin')} style={sx('flex:none')} />
      <span style={sx('flex:1;min-width:0;font-size:12px;font-weight:500;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:' + (done ? 'var(--fg-faint)' : 'var(--fg-soft)'))}>
        {it.title}
      </span>
      {tag ? <span style={{ ...mono('font-size:9px;font-weight:700;letter-spacing:.08em;flex:none'), color: it.status === 'stuck' ? 'var(--warn)' : 'var(--fg-faint)' }}>{tag.toUpperCase()}</span> : null}
      <span style={{ ...mono('font-size:10px;flex:none'), color: Number(it.min_today) > Number(it.estimate_min || 0) ? 'var(--warn)' : 'var(--fg-faint)' }}
        onClick={e => { e.stopPropagation(); if (onOpen && it.path) onOpen(it.path); }}>
        {it.min_today ? it.min_today + 'm/' : ''}{it.estimate_min || '—'}m
      </span>
      <span className="planMove" style={sx('flex:none;display:none;gap:2px')}>
        <Btn size="sm" variant="ghost" disabled={ix === 0} title="Move up"
          onClick={e => { e.stopPropagation(); onMove(it, -1); }} style={sx('padding:0 4px;font-size:9px;line-height:1.4')}>↑</Btn>
        <Btn size="sm" variant="ghost" disabled={ix >= total - 1} title="Move down"
          onClick={e => { e.stopPropagation(); onMove(it, +1); }} style={sx('padding:0 4px;font-size:9px;line-height:1.4')}>↓</Btn>
      </span>
    </div>
  );
}

// One transcript entry. Conductor lines are the quiet system voice (a small eyebrow, no bubble);
// user messages float right; agent replies left.
function ChatMsg({ m, actor, onOpenPath, onSaved, agents, refreshKey }) {
  const artifacts = messageArtifacts(m);
  const text = artifactMessageText(m, artifacts);
  const assistant = m.meta?.assistant;
  const assistantId = typeof assistant === 'object' ? assistant?.id : assistant;
  const speaker = m.meta?.assistant_name || (typeof assistant === 'object' ? assistant?.name : '')
    || (agents || []).find(agent => agent.id === assistantId)?.name || assistantId || artifacts[0]?.assistant || 'Conductor';
  const documents = <ArtifactList artifacts={artifacts} actor={actor} agents={agents} onOpenPath={onOpenPath} onSaved={onSaved} refreshKey={refreshKey} />;
  const conductor = m.meta && m.meta.kind === 'conductor';
  if (conductor) {
    return (
      <div style={sx('padding:10px 16px;border-bottom:1px solid var(--line)')}>
        <Eyebrow style={sx('font-size:8.5px;font-weight:800;letter-spacing:.2em;color:var(--fg-faint);margin-bottom:5px')}>{speaker}</Eyebrow>
        <div style={sx('font-size:12px;line-height:1.5;color:var(--fg-muted)')}>
          <Markdown text={text} />
        </div>
        {documents}
      </div>
    );
  }
  if (m.role === 'system') {
    return (
      <div style={sx('padding:6px 16px;text-align:center')}>
        <span style={{ ...mono('font-size:9.5px;letter-spacing:.06em;color:var(--fg-faint)') }}>{text}</span>
        {documents}
      </div>
    );
  }
  const mine = m.role === 'user';
  return (
    <div style={sx('display:flex;padding:5px 16px;justify-content:' + (mine ? 'flex-end' : 'flex-start'))}>
      <div style={{
        ...sx('max-width:92%;min-width:0;font-size:12.5px;line-height:1.5;padding:8px 12px;border-radius:10px'),
        background: mine ? 'var(--accent-12)' : 'var(--surface-2)',
        border: '1px solid ' + (mine ? 'var(--accent-35)' : 'var(--border)'),
        color: 'var(--fg)',
      }}>
        {!mine ? <Eyebrow style={sx('font-size:8.5px;letter-spacing:.1em;color:var(--fg-muted);margin-bottom:5px')}>{speaker}</Eyebrow> : null}
        {mine ? <span>{text}</span> : <Markdown text={text || (m.error ? '⚠ ' + m.error : '')} />}
        {documents}
      </div>
    </div>
  );
}

export default function Today({ onGo, onOpenPath, onWrote, refreshKey, actor, onWorkClockState, onWorkClockBusy, onWorkClockIntent }) {
  const [data, setData] = React.useState(null);
  const [loadErr, setLoadErr] = React.useState(null);
  const [chat, setChat] = React.useState(null);
  const [stream, setStream] = React.useState('');
  const [turnBusy, setTurnBusy] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [range, setRange] = React.useState('today');
  const [doneOpen, setDoneOpen] = React.useState(false);
  const [doneResult, setDoneResult] = React.useState('');
  const [doneNote, setDoneNote] = React.useState('');
  const [stuckOpen, setStuckOpen] = React.useState(false);
  const [stuckReason, setStuckReason] = React.useState('');
  const [addOpen, setAddOpen] = React.useState(false);
  const [add, setAdd] = React.useState({ title: '', bucket: 'research', estimate_min: 30, goal_id: '', destination: '', done_when: '', not_before: '', follow_up_days: '' });
  const [backlogOpen, setBacklogOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState('');
  const [focusedArtifact, setFocusedArtifact] = React.useState(null);
  const [focusedDirty, setFocusedDirty] = React.useState(false);
  const artifactDesk = React.useRef(null);
  const [, setTick] = React.useState(0);

  const dataRef = React.useRef(data);
  dataRef.current = data;
  const busyRef = React.useRef(false);
  const chatId = data && data.chat;

  const load = React.useCallback(async () => {
    try {
      const d = await api.today();
      setData(d); setLoadErr(null);
      onWorkClockState?.(d);
      if (d.chat) {
        try { setChat(await api.chatSession(d.chat)); } catch { setChat(null); }
      }
    } catch (e) {
      setLoadErr(e);
    }
  }, [onWorkClockState]);

  // The heartbeat — nudges, prep state, the clock all arrive through here. 3s while a morning
  // plan is being written so the plan lands on screen promptly; 60s the rest of the day.
  React.useEffect(() => {
    let t;
    let dead = false;
    const tick = async () => {
      await load();
      if (dead) return;
      const d = dataRef.current;
      t = setTimeout(tick, d?.planning || ['thinking', 'working'].includes(d?.conductor?.state) ? 3000 : 60 * 1000);
    };
    tick();
    return () => { dead = true; clearTimeout(t); };
  }, [load, refreshKey]);

  // App owns idle/visibility handling across navigation; this tick only paints the clock.
  React.useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 15 * 1000);
    return () => clearInterval(iv);
  }, []);

  // The day's chat is a live SSE channel: conductor posts and replies arrive without a poll.
  React.useEffect(() => {
    if (!chatId) return undefined;
    const es = new EventSource(api.chatStreamUrl(chatId));
    const reload = () => api.chatSession(chatId).then(setChat).catch(() => {});
    es.addEventListener('text-delta', ev => {
      try { const d = JSON.parse(ev.data); setStream(s => s + (d.text || '')); } catch { /* partial frame */ }
    });
    es.addEventListener('turn-started', () => { setStream(''); setTurnBusy(true); });
    es.addEventListener('turn-done', () => { setStream(''); setTurnBusy(false); reload(); load(); onWrote?.(); });
    es.addEventListener('turn-cancelled', () => { setStream(''); setTurnBusy(false); reload(); });
    es.addEventListener('error', () => { setTurnBusy(false); reload(); });
    es.addEventListener('system-event', () => { reload(); load(); onWrote?.(); });
    return () => es.close();
  }, [chatId, load, onWrote]);

  const act = React.useCallback(async fn => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    onWorkClockBusy?.(true);
    setActionError('');
    try { await fn(); onWrote?.(); } catch (error) { setActionError(String(error.message || error)); }
    busyRef.current = false; setBusy(false);
    await load();
    onWorkClockBusy?.(false);
  }, [load, onWorkClockBusy, onWrote]);

  const start = it => act(() => { onWorkClockIntent?.('start'); return api.todayStart(it.id); });
  const move = (it, dir) => act(() => {
    const ids = (dataRef.current.plan || []).map(p => p.id);
    const ix = ids.indexOf(it.id);
    const jx = ix + dir;
    if (ix < 0 || jx < 0 || jx >= ids.length) return Promise.resolve();
    [ids[ix], ids[jx]] = [ids[jx], ids[ix]];
    return api.todayReorder(ids);
  });

  const doDone = () => act(async () => {
    const n = dataRef.current.now;
    if (!n) return;
    onWorkClockIntent?.('done');
    await api.todayDone(n.id, doneResult === '' ? undefined : Number(doneResult), doneNote || undefined);
    setDoneOpen(false); setDoneResult(''); setDoneNote('');
  });
  const doPark = it => act(() => { onWorkClockIntent?.('park'); return api.todayPark((it || dataRef.current.now).id); });
  const doStuck = () => act(async () => {
    const n = dataRef.current.now;
    if (!n || !stuckReason.trim()) return;
    onWorkClockIntent?.('stuck');
    await api.todayStuck(n.id, stuckReason.trim());
    setStuckOpen(false); setStuckReason('');
  });
  const doAdd = () => act(async () => {
    if (!add.title.trim()) return;
    await api.todayAdd({ ...add, title: add.title.trim(), estimate_min: Number(add.estimate_min) || 30, day: dataRef.current.day });
    setAdd(a => ({ ...a, title: '' }));
  });
  const planBacklog = it => act(() => api.patchRecord(it.path, { day: dataRef.current.day, status: 'planned' }));
  const endDay = () => act(() => { onWorkClockIntent?.('end'); return api.todayEndDay(); });

  const sendChat = () => {
    const text = draft.trim();
    if (!text || !chatId || turnBusy) return;
    setDraft('');
    setTurnBusy(true); setStream('');
    api.chatTurn(chatId, text).catch(error => {
      setTurnBusy(false);
      setDraft(current => current || text);
      setActionError(String(error.message || error));
    });
  };

  // ⌘↩ = Done on the now item (the result box stays a deliberate extra step on click).
  React.useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        const n = dataRef.current && dataRef.current.now;
        if (n && !busyRef.current) {
          e.preventDefault();
          if (n.done_when) setDoneOpen(true);
          else doDone();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prepared material lives in the item's body under `## Prepared` — fetched only while a now
  // item is active, so the NOW card never waits on it.
  const [nowDoc, setNowDoc] = React.useState(null);
  const focusArtifact = React.useCallback(ref => {
    const artifact = normalizeArtifacts([ref])[0];
    if (!artifact) return;
    if (focusedDirty && focusedArtifact?.path !== artifact.path) {
      setActionError('Save or cancel the edit on the table before opening another document.'); return;
    }
    setFocusedArtifact(previous => previous?.path === artifact.path ? previous : artifact);
    setTimeout(() => artifactDesk.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0);
  }, [focusedDirty, focusedArtifact?.path]);
  const artifactSaved = React.useCallback(doc => {
    if (doc.path === dataRef.current?.now?.path) setNowDoc(doc);
    onWrote?.(); load();
  }, [load, onWrote]);
  const nowId = data && data.now && data.now.id;
  const nowPrep = data && data.now && data.now.prep_state;
  const nowPacket = JSON.stringify(data?.now?.artifacts || []);
  React.useEffect(() => {
    setNowDoc(null);
    if (!nowId) return undefined;
    let dead = false;
    const pull = () => api.record((dataRef.current.now || {}).path || '').then(d => { if (!dead) setNowDoc(d); }).catch(() => {});
    pull();
    const iv = setInterval(pull, 20 * 1000);
    return () => { dead = true; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowId, nowPrep, nowPacket, refreshKey]);

  if (loadErr && !data) {
    return (
      <div style={sx('flex:1;display:flex;align-items:center;justify-content:center;padding:40px')}>
        <Empty size="page" style={sx('max-width:440px')} title="TODAY DID NOT LOAD" body={String(loadErr.message || loadErr)} />
      </div>
    );
  }
  if (!data) {
    return (
      <div style={sx('flex:1;display:flex;align-items:center;justify-content:center;padding:40px')}>
        <Empty size="page" style={sx('max-width:440px')} title="READING THE WORKSPACE" />
      </div>
    );
  }

  const now = data.now;
  const next = data.next;
  const stats = (data.stats || {})[range] || { total_min: 0, by_bucket: [], by_day: [] };
  const usage = data.usage || {};
  const dayChart = range === 'today' ? [] : fillDays(stats.by_day, range, data.day);
  const maxBucket = Math.max(1, ...stats.by_bucket.map(b => b.minutes));
  const maxDay = Math.max(1, ...dayChart.map(d => d.minutes));
  // by_bucket arrives minutes-desc — its index IS the ramp rank, so the same bucket is the same
  // tone in the bar list and inside every day column.
  const bucketRank = new Map(stats.by_bucket.map((b, i) => [b.bucket, i]));
  const elapsedMs = now && now.clock && now.clock.running ? Date.now() - now.clock.started : null;
  const over = elapsedMs !== null && elapsedMs > (Number(now.estimate_min) || 0) * 60000;
  const preparedText = (() => {
    const m = /## Prepared\n([\s\S]*?)(?=\n## |$)/.exec((nowDoc && (nowDoc.content || nowDoc.body)) || '');
    return m ? m[1].trim() : '';
  })();
  const messages = (chat && chat.messages) || [];
  const packetArtifacts = workArtifacts(now, nowDoc);
  const teamArtifacts = normalizeArtifacts(data.conductor?.recent_outputs || []).slice(0, 4);
  const teamAgents = [...(data.conductor?.agents || []),
    { id: data.conductor?.coordinator, name: data.conductor?.coordinator_name || 'Conductor' },
    { id: 'conductor', name: data.conductor?.coordinator_name || 'Conductor' }];

  const planLabel = data.day
    ? new Date(data.day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    : 'Today';

  return (
    <div className="todayWorkspace" style={sx('flex:1;min-height:0;display:flex;flex-direction:column;padding:18px 22px;gap:14px')}>
      {/* ── header ── */}
      <div style={sx('flex:none;display:flex;align-items:baseline;gap:16px')}>
        <h1 style={sx('font-size:17px;font-weight:700;color:var(--fg);letter-spacing:-.01em')}>{planLabel}</h1>
        <span style={{ ...mono('font-size:11.5px;color:var(--fg-muted)') }}>
          Tracked today {fmtMin(((data.stats || {}).today || {}).total_min)}
        </span>
        {data.needs_you ? (
          <Btn variant="ghost" className="hFg" onClick={() => onGo && onGo('decide')}
            style={{ ...mono('font-size:11.5px;font-weight:600;color:var(--warn);padding:0;border:none') }}>
            {data.needs_you} need you →
          </Btn>
        ) : null}
        <span style={sx('flex:1')} />
        {data.planning ? <span style={{ ...mono('font-size:10px;letter-spacing:.1em;color:var(--fg-faint)') }}>PLANNING…</span> : null}
        <Btn size="sm" variant="ghost" busy={busy} onClick={endDay} title="Write today's review now">End day</Btn>
      </div>
      <TeamPulse team={data.conductor} onAdmin={() => onGo?.('admin')} />

      {actionError ? <div role="alert" style={sx('color:var(--warn);font-size:12px')}>{actionError}</div> : null}

      <div className="todayColumns" style={sx('flex:1;min-height:0')}>
        {/* ── left: the plan ── */}
        <div className="todayPlan" style={sx('min-height:0;display:flex;flex-direction:column;gap:12px')}>
          <Section label="TODAY" right={plural((data.plan || []).filter(i => i.status === 'done').length, 'done', 'done') + ' / ' + (data.plan || []).length} grow>
            <div style={sx('flex:1;min-height:0;overflow:auto;margin-top:8px')}>
              {(data.plan || []).map((it, ix) => (
                <PlanRow key={it.id} it={it} ix={ix} total={data.plan.length}
                  onStart={start} onMove={move} onOpen={onOpenPath} />
              ))}
              {!data.plan.length ? (
                <div style={sx('padding:16px')}>
                  <span style={{ ...mono('font-size:10.5px;letter-spacing:.1em;color:var(--fg-faint)') }}>
                    {data.planned === false ? 'NOT PLANNED YET — THE FIRST POLL OF THE DAY PLANS IT' : 'NOTHING PLANNED'}
                  </span>
                </div>
              ) : null}
            </div>
            <div style={sx('flex:none;border-top:1px solid var(--line);padding:10px 12px;display:flex;flex-direction:column;gap:8px')}>
              {addOpen ? (
                <div style={sx('display:flex;flex-direction:column;gap:6px')}>
                  <div style={sx('display:flex;gap:6px;align-items:center')}>
                  <Input value={add.title} placeholder="New item…" autoFocus
                    onChange={e => setAdd(a => ({ ...a, title: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } }}
                    style={sx('flex:1;min-width:0;font-size:12px')} />
                  <select value={add.bucket} onChange={e => setAdd(a => ({ ...a, bucket: e.target.value }))}
                    style={{ ...mono('font-size:10px'), background: 'var(--raise)', color: 'var(--fg-soft)', border: '1px solid var(--border-2)', borderRadius: 6, padding: '4px 6px' }}>
                    {(data.buckets || ['research', 'reading', 'seo', 'marketing', 'email', 'facebook-groups', 'reddit', 'admin']).map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                  <Input value={add.estimate_min} type="number" min="5" max="240" title="minutes"
                    onChange={e => setAdd(a => ({ ...a, estimate_min: e.target.value }))}
                    style={{ ...mono('font-size:11px;width:52px;flex:none') }} />
                  <Btn size="sm" variant="secondary" onClick={doAdd} disabled={!add.title.trim()}>Add</Btn>
                  </div>
                  <select aria-label="Goal" value={add.goal_id} onChange={e => setAdd(a => ({ ...a, goal_id: e.target.value }))}
                    style={sx('font-size:11px;background:var(--raise);color:var(--fg-soft);border:1px solid var(--border-2);border-radius:6px;padding:6px')}>
                    <option value="">Goal (optional)</option>
                    {(data.goals || []).map(goal => <option key={goal.id} value={goal.id}>{goal.label}</option>)}
                  </select>
                  <Input aria-label="Destination" value={add.destination} placeholder="Where does the output go?"
                    onChange={e => setAdd(a => ({ ...a, destination: e.target.value }))} style={sx('font-size:11px')} />
                  <Input aria-label="Done when" value={add.done_when} placeholder="What proves this is done?"
                    onChange={e => setAdd(a => ({ ...a, done_when: e.target.value }))} style={sx('font-size:11px')} />
                  <div style={sx('display:flex;gap:6px;align-items:center')}>
                    <Input aria-label="Not before" title="Start on or after this date" type="date" value={add.not_before}
                      onChange={e => setAdd(a => ({ ...a, not_before: e.target.value }))} style={sx('font-size:11px;min-width:0;flex:1')} />
                    <Input aria-label="Follow up after days" title="Create a follow-up this many days after completion" type="number" min="1" max="365"
                      placeholder="Follow-up days" value={add.follow_up_days}
                      onChange={e => setAdd(a => ({ ...a, follow_up_days: e.target.value }))} style={sx('font-size:11px;width:110px')} />
                  </div>
                </div>
              ) : (
                <Btn variant="ghost" size="sm" onClick={() => setAddOpen(true)} style={sx('align-self:flex-start')}>+ Add</Btn>
              )}
              <Btn variant="ghost" className="hFg" onClick={() => setBacklogOpen(o => !o)}
                style={{ ...mono('font-size:10px;letter-spacing:.08em;padding:0;border:none;color:var(--fg-faint);align-self:flex-start') }}>
                BACKLOG · {data.backlog_count || 0} {backlogOpen ? '▾' : '▸'}
              </Btn>
              {backlogOpen ? (
                <div style={sx('max-height:180px;overflow:auto;display:flex;flex-direction:column;gap:2px')}>
                  {(data.backlog || []).map(it => (
                    <Btn key={it.id} variant="ghost" className="hBg" title="Plan it for today" onClick={() => planBacklog(it)}
                      style={sx('text-align:left;padding:5px 8px;border-radius:6px;font-size:11.5px;color:var(--fg-muted);display:flex;gap:8px;align-items:center')}>
                      <span style={{ ...mono('font-size:9px;color:var(--fg-faint);flex:none') }}>{it.bucket}</span>
                      <span style={sx('overflow:hidden;text-overflow:ellipsis')}>
                        {it.title}{it.wait_reason ? <span style={sx('display:block;color:var(--warn);font-size:10px')}>{it.wait_reason}</span> : null}
                      </span>
                    </Btn>
                  ))}
                  {!data.backlog_count ? <span style={{ ...mono('font-size:10px;color:var(--fg-faint)') }}>EMPTY</span> : null}
                </div>
              ) : null}
            </div>
          </Section>
        </div>

        {/* ── center: now + the conductor ── */}
        <div className="todayDesk" style={sx('min-width:0;min-height:0;display:flex;flex-direction:column;gap:12px')}>
          <section style={sx('flex:none;max-height:46vh;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px 18px;display:flex;flex-direction:column;gap:10px')}>
            {data.planning ? (
              <span style={{ ...mono('font-size:10px;letter-spacing:.12em;color:var(--fg-faint)') }}>PLANNING YOUR DAY…</span>
            ) : null}
            {now ? (
              <>
                <div style={sx('display:flex;align-items:center;gap:10px')}>
                  <span style={{ ...mono('font-size:9px;font-weight:800;letter-spacing:.2em;color:var(--fg-faint);flex:none') }}>NOW</span>
                  <Chip label={String(now.bucket || 'admin')} />
                  <span style={sx('flex:1')} />
                  <span style={{ ...mono('font-size:15px;font-weight:700'), color: over ? 'var(--warn)' : 'var(--fg)' }}>
                    {now.clock && now.clock.running ? fmtTimer(elapsedMs) : 'paused'} <span style={sx('font-size:10.5px;font-weight:500;color:var(--fg-faint)')}>/ {now.estimate_min || '—'}m</span>
                  </span>
                </div>
                <div style={sx('font-size:15px;font-weight:600;color:var(--fg);line-height:1.3')}>{now.title}</div>
                {now.why ? <div style={sx('font-size:11.5px;color:var(--fg-muted);line-height:1.4')}>{now.why}</div> : null}
                {now.goal_id || now.destination || now.done_when ? (
                  <div style={sx('display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--fg-muted)')}>
                    {now.goal_id ? <Btn variant="ghost" size="sm" onClick={() => focusArtifact({ path: 'goals/' + now.goal_id + '.md', title: (data.goals || []).find(goal => goal.id === now.goal_id)?.label || 'Goal brief' })}
                      style={sx('align-self:flex-start;padding:0;color:var(--fg-soft)')}>
                      Goal: {(data.goals || []).find(goal => goal.id === now.goal_id)?.label || now.goal_id}
                    </Btn> : null}
                    {now.key_result ? <div>Measure: {now.key_result}</div> : null}
                    {now.destination ? <div>Destination: {now.destination}</div> : null}
                    {now.done_when ? <div>Done when: {now.done_when}</div> : null}
                    {now.follow_up_days ? <div>Follow-up: {now.follow_up_days} days after completion</div> : null}
                  </div>
                ) : null}
                {now.prep && now.prep_state === 'preparing' ? (
                  <span style={{ ...mono('font-size:10px;letter-spacing:.08em;color:var(--fg-faint)') }}>PREPARING MATERIAL…</span>
                ) : null}
                {packetArtifacts.length || now.path ? <div style={sx('display:flex;flex-direction:column;gap:7px;border-top:1px solid var(--line);padding-top:9px')}>
                  <Eyebrow style={sx('font-size:9px;color:var(--fg-muted)')}>YOUR WORK PACKET{preparedText ? ' · material ready' : ''}</Eyebrow>
                  <ArtifactList artifacts={packetArtifacts} actor={actor} agents={teamAgents} onOpenPath={onOpenPath} onSaved={artifactSaved} refreshKey={refreshKey} />
                  {now.path ? <Artifact key={now.path} artifact={{ path: now.path, title: now.title, type: 'Working notes' }} seed={nowDoc || undefined}
                    actor={actor} agents={teamAgents} onOpenPath={onOpenPath} onSaved={artifactSaved} refreshKey={String(refreshKey) + ':' + (nowDoc?.rev || '')} /> : null}
                </div> : null}
                <div style={sx('display:flex;gap:8px;align-items:center;flex-wrap:wrap')}>
                  {now.clock && now.clock.running ? (
                    <Btn size="sm" variant="ghost" busy={busy} onClick={() => act(() => { onWorkClockIntent?.('pause'); return api.todayPause(); })}>Pause</Btn>
                  ) : (
                    <Btn size="sm" variant="secondary" busy={busy} onClick={() => act(() => { onWorkClockIntent?.('resume'); return api.todayResume(); })}>Resume</Btn>
                  )}
                  <Btn size="sm" variant="primary" busy={busy} onClick={() => setDoneOpen(o => !o)}>Done</Btn>
                  <Btn size="sm" variant="ghost" busy={busy} onClick={() => doPark()}>Park</Btn>
                  <Btn size="sm" variant="ghost" busy={busy} onClick={() => setStuckOpen(o => !o)}>Stuck</Btn>
                  <span style={sx('flex:1')} />
                  <span style={{ ...mono('font-size:9px;color:var(--fg-faint);letter-spacing:.08em') }}>⌘↩ DONE</span>
                </div>
                {doneOpen ? (
                  <div style={sx('display:flex;gap:6px;align-items:center;border-top:1px solid var(--line);padding-top:10px')}>
                    <Input value={doneResult} type="number" placeholder="Result?" title="optional — a number"
                      onChange={e => setDoneResult(e.target.value)} style={{ ...mono('font-size:11px;width:90px;flex:none') }} />
                    <Input value={doneNote} placeholder={now.done_when ? 'Completion evidence (required)' : 'note, optional'}
                      onChange={e => setDoneNote(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); doDone(); } }}
                      style={sx('flex:1;min-width:0;font-size:12px')} />
                    <Btn size="sm" variant="primary" busy={busy} disabled={!!now.done_when && !doneNote.trim()} onClick={doDone}>Done</Btn>
                  </div>
                ) : null}
                {stuckOpen ? (
                  <div style={sx('display:flex;gap:6px;align-items:center;border-top:1px solid var(--line);padding-top:10px')}>
                    <Input value={stuckReason} placeholder="What's blocking it? (required)" autoFocus
                      onChange={e => setStuckReason(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); doStuck(); } }}
                      style={sx('flex:1;min-width:0;font-size:12px')} />
                    <Btn size="sm" variant="secondary" busy={busy} disabled={!stuckReason.trim()} onClick={doStuck}>Mark stuck</Btn>
                  </div>
                ) : null}
              </>
            ) : next ? (
              <div style={sx('display:flex;align-items:center;gap:12px')}>
                <div style={sx('flex:1;min-width:0')}>
                  <span style={{ ...mono('font-size:9px;font-weight:800;letter-spacing:.2em;color:var(--fg-faint)') }}>UP NEXT</span>
                  <div style={sx('font-size:14px;font-weight:600;color:var(--fg);margin-top:4px')}>{next.title}</div>
                  <div style={{ ...mono('font-size:10px;color:var(--fg-faint);margin-top:2px') }}>{next.bucket} · ~{next.estimate_min || '—'}m</div>
                </div>
                <Btn variant="primary" busy={busy} onClick={() => start(next)}>Start</Btn>
              </div>
            ) : (
              <div style={sx('display:flex;align-items:center;gap:12px')}>
                <span style={sx('flex:1;font-size:12.5px;color:var(--fg-muted)')}>
                  {data.planned === false ? 'The day isn’t planned yet — the first poll plans it.'
                    : ['thinking', 'working'].includes(data.conductor?.state) ? 'The team is preparing your next review. Their drafts will appear here.'
                    : data.plan.some(item => item.status !== 'done' && item.wait_reason) ? 'Nothing ready right now — your waiting work stays in the plan.'
                    : 'Nothing planned — ask me to plan, or add an item on the left.'}
                </span>
              </div>
            )}
          </section>

          {/* the day's thread */}
          <section style={sx('flex:1;min-height:0;background:var(--surface);border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;overflow:hidden')}>
            <div style={sx('flex:1;min-height:0;overflow:auto;padding:8px 0;display:flex;flex-direction:column;gap:2px')}>
              {focusedArtifact ? <div ref={artifactDesk} style={sx('padding:8px 16px 12px;border-bottom:1px solid var(--line)')}>
                <div style={sx('display:flex;align-items:center;gap:8px;margin-bottom:6px')}><Eyebrow style={sx('flex:1;font-size:9px')}>ON THE TABLE</Eyebrow>
                  <Btn size="sm" variant="ghost" disabled={focusedDirty} onClick={() => setFocusedArtifact(null)}>Put away</Btn></div>
                <Artifact key={focusedArtifact.path} artifact={focusedArtifact} defaultExpanded actor={actor} agents={teamAgents} onDirty={setFocusedDirty}
                  onOpenPath={onOpenPath} onSaved={artifactSaved} refreshKey={refreshKey} />
              </div> : null}
              {teamArtifacts.length ? <div style={sx('padding:8px 16px 12px;border-bottom:1px solid var(--line)')}>
                <Eyebrow style={sx('font-size:9px;margin-bottom:8px;color:var(--fg-muted)')}>FROM YOUR TEAM</Eyebrow>
                <ArtifactList artifacts={teamArtifacts} actor={actor} agents={teamAgents} onOpenPath={onOpenPath} onSaved={artifactSaved} refreshKey={refreshKey} />
              </div> : null}
              {messages.map(m => <ChatMsg key={m.id} m={m} actor={actor} onOpenPath={onOpenPath} onSaved={artifactSaved}
                agents={teamAgents} refreshKey={refreshKey} />)}
              {stream || turnBusy ? (
                <div style={sx('display:flex;padding:5px 16px')}>
                  <div style={sx('max-width:82%;font-size:12.5px;line-height:1.5;padding:8px 12px;border-radius:10px;background:var(--surface-2);border:1px solid var(--border);color:var(--fg)')}>
                    {stream ? <Markdown text={artifactMessageText({ text: stream })} /> : <span style={{ ...mono('font-size:10px;letter-spacing:.12em;color:var(--fg-faint)') }}>THINKING…</span>}
                  </div>
                </div>
              ) : null}
              {!messages.length && !stream ? (
                <div style={sx('flex:1;display:flex;align-items:center;justify-content:center')}>
                  <span style={{ ...mono('font-size:10px;letter-spacing:.14em;color:var(--fg-faint)') }}>THE DAY’S THREAD — PLANS, NUDGES AND REPLIES LAND HERE</span>
                </div>
              ) : null}
            </div>
            <div style={sx('flex:none;border-top:1px solid var(--line);padding:10px 14px;display:flex;gap:8px;align-items:flex-end')}>
              <textarea value={draft} rows={2} placeholder={chatId ? 'Tell the conductor…' : 'The thread starts when the day is planned'}
                disabled={!chatId}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); sendChat(); }
                }}
                style={sx('flex:1;resize:none;background:var(--raise);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);font:inherit;font-size:12.5px;padding:8px 10px;line-height:1.4')} />
              <Btn variant="secondary" busy={turnBusy} disabled={!chatId || !draft.trim()} onClick={sendChat}>Send</Btn>
            </div>
          </section>
        </div>

        {/* ── right: time ── */}
        <div className="todayStats" style={sx('min-width:0;min-height:0;display:flex;flex-direction:column;gap:12px')}>
          <TodayExtras work={data.now || data.next} plannedWork={data.next} onGo={onGo} onOpenPath={onOpenPath} onOpenArtifact={focusArtifact} onWrote={onWrote} refreshKey={refreshKey} />
          <Section label="TIME" grow>
            <div style={sx('flex:none;display:flex;gap:6px;padding:10px 16px 0')}>
              {[['today', 'Today'], ['week', 'Week'], ['month', 'Month']].map(([k, l]) => (
                <Chip key={k} label={l} on={range === k} onClick={() => setRange(k)} />
              ))}
            </div>
            <div style={sx('flex:none;padding:10px 16px 0;display:flex;align-items:baseline;gap:10px')}>
              <span style={{ ...mono('font-size:22px;font-weight:700;color:var(--fg)') }}>{fmtMin(stats.total_min)}</span>
              <span style={{ ...mono('font-size:10px;color:var(--fg-faint);letter-spacing:.08em') }}>TRACKED</span>
            </div>
            <div style={sx('flex:none;padding:10px 16px 0;display:flex;flex-direction:column;gap:7px')}>
              {stats.by_bucket.map(b => (
                <div key={b.bucket} style={sx('display:flex;align-items:center;gap:8px')}>
                  <span style={{ ...mono('font-size:9.5px;width:96px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg-muted)') }}>{b.bucket}</span>
                  <div style={sx('flex:1;height:5px;background:var(--line);border-radius:3px;overflow:hidden')}>
                    <div style={{ height: '100%', borderRadius: 3, width: Math.round(b.minutes / maxBucket * 100) + '%', background: bucketTone(b.bucket, bucketRank) }} />
                  </div>
                  <span style={{ ...mono('font-size:10px;flex:none;color:var(--fg-soft)') }}>
                    {fmtMin(b.minutes)}{b.done ? ' · ' + b.done + '✓' : ''}{b.results ? ' · ' + b.results + ' results' : ''}
                  </span>
                </div>
              ))}
              {!stats.by_bucket.length ? (
                <span style={{ ...mono('font-size:10px;letter-spacing:.1em;color:var(--fg-faint)') }}>NO TRACKED TIME IN THIS RANGE</span>
              ) : null}
            </div>
            {range !== 'today' && dayChart.length ? (
              <div style={sx('flex:1;min-height:0;padding:12px 16px;display:flex;flex-direction:column;gap:4px')}>
                <div style={sx('flex:1;min-height:0;display:flex;align-items:flex-end;gap:3px')}>
                  {dayChart.map(d => (
                    <div key={d.day} title={d.day + ' · ' + fmtMin(d.minutes)}
                      style={sx('flex:1;display:flex;flex-direction:column-reverse;gap:1px;height:100%;min-width:0')}>
                      {(d.by_bucket || []).map(b => (
                        <div key={b.bucket} style={{ flex: 'none', height: Math.max(2, Math.round(b.minutes / maxDay * 100)) + '%', background: bucketTone(b.bucket, bucketRank), borderRadius: 1 }} />
                      ))}
                    </div>
                  ))}
                </div>
                {/* one label row — a label must never ride on top of a bar it belongs under */}
                <div style={sx('flex:none;display:flex;gap:3px')}>
                  {dayChart.map(d => (
                    <span key={d.day} style={{ ...mono('font-size:8px;flex:1;min-width:0;text-align:center;color:var(--fg-faint)') }}>
                      {range === 'week' ? 'MTWTFSS'[parseLocalDay(d.day).getDay() === 0 ? 6 : parseLocalDay(d.day).getDay() - 1] : parseLocalDay(d.day).getDate()}
                    </span>
                  ))}
                </div>
              </div>
            ) : <span style={sx('flex:1')} />}
            <div style={sx('flex:none;border-top:1px solid var(--line);padding:9px 16px;display:flex;flex-direction:column;gap:5px')}>
              <span style={{ ...mono('font-size:9.5px;letter-spacing:.06em;color:var(--fg-faint)') }}>
                AGENTS TODAY: {['gemini', 'devin', 'gpt', 'claude', 'codex', 'stub'].filter(p => usage[p]).map(p => (p === 'gpt' ? 'GPT-6 Luna' : p) + ' ' + usage[p]).join(' · ') || 'none'}
              </span>
              {data.budget ? <span style={{ ...mono('font-size:9px;color:var(--fg-faint)') }}>
                Calls left: light {data.budget.light.remaining}/{data.budget.light.limit} · heavy {data.budget.heavy.remaining}/{data.budget.heavy.limit}
              </span> : null}
              {(data.providers || []).filter(provider => provider.installed && provider.textOnlyAvailable === false).map(provider => (
                <span key={provider.id} title={provider.textOnlyReason} style={{ ...mono('font-size:9px;color:var(--warn)') }}>
                  {provider.label}: Today unavailable
                </span>
              ))}
            </div>
          </Section>

          {(data.reviews || []).length ? (
            <Section label="REVIEWS">
              <div style={sx('padding:8px 8px 12px;display:flex;flex-direction:column')}>
                {data.reviews.map(r => (
                  <Btn key={r.id} variant="ghost" className="hBg" onClick={() => onOpenPath && onOpenPath(r.path)}
                    style={sx('text-align:left;padding:6px 8px;border-radius:6px;display:flex;gap:8px;align-items:center')}>
                    <span style={{ ...mono('font-size:9px;color:var(--fg-faint);flex:none;width:44px') }}>{String(r.kind || '').toUpperCase()}</span>
                    <span style={sx('flex:1;min-width:0;font-size:11.5px;color:var(--fg-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{r.title}</span>
                  </Btn>
                ))}
              </div>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
