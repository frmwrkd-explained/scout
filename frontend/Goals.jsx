// GOALS — one card per goal: the number, the progress, the days left, who is on it.
//
// T11 / docs/03_MEMORY.md §7.2. A goal is the only memory object with its own clock, so its window
// is its deadline (docs/08_MODULE_CONTRACTS.md §2, TYPE_WINDOW: "goal — its own deadline"). Behind
// schedule is therefore a real, checkable state and it must LOOK behind, not merely say so.
//
// Props
//   onOpenPath(path)   Law 8 — the card prints its `.md` path and it is clickable.
//   onWrote()          optional. Fired after a goal write and its cache regeneration.
//
// Everything shared with the other memory screens is imported from ./Memory — one implementation
// of the path chip, the progress bar, the age line and the write-then-regenerate wrapper.

import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { Btn, Card, Empty, Input, InlineEdit, Chip } from './ui';
import {
  mono, listOf, fm, bodyOf, pathOf, idOf, checkedAt, fadeFg,
  PathLink, Bar, Age, useResource, useMemoryWriter, SaveNote, Loading, Failed, ScreenHead,
} from './Memory';

const DAY = 86400000;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// YAML parses `deadline: 2026-08-31` into a Date, so the value that reaches this screen is an ISO
// timestamp. A person must never be shown `2026-08-31T00:00:00.000Z`, and must never have to type
// it either — read mode says "31 Aug 2026", edit mode hands back a plain `2026-08-31`.
function dateInput(v) {
  if (!v) return '';
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? String(v) : new Date(t).toISOString().slice(0, 10);
}
function humanDate(v) {
  if (!v) return '';
  const t = Date.parse(String(v));
  if (Number.isNaN(t)) return String(v);
  const d = new Date(t);
  return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

// "1 groups to go" is the kind of small wrongness that makes a screen feel machine-written.
function plural(n, unit) {
  if (!unit) return '';
  return Number(n) === 1 ? String(unit).replace(/s$/, '') : String(unit);
}

// Days left, in whole days, from today. Null when the goal carries no deadline — a goal without a
// clock is a standing one and must not be rendered as if it were already late. Pass the whole goal
// and the shaped `daysLeft` (shapeGoal → daysUntil) is used; pass a date string and it is parsed.
function daysLeft(goalOrDate) {
  if (goalOrDate && typeof goalOrDate === 'object') {
    if (goalOrDate.daysLeft != null) return Number(goalOrDate.daysLeft);
    return daysLeft(fm(goalOrDate).deadline);
  }
  if (!goalOrDate) return null;
  const t = Date.parse(String(goalOrDate));
  if (Number.isNaN(t)) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((t - today.getTime()) / DAY);
}

// A goal is either a TARGET (get to 8) or a THRESHOLD (stay above 30%). They are the same card
// with two readings, and collapsing them into one number would lie about the second: 24 out of 30
// is not "80% done", it is "under the line".
// `current`, `target`, `unit` and `daysLeft` are read from the SHAPED goal first, not from its
// frontmatter: backend/memory.mjs `shapeGoal` rolls `current` up from the real records whenever the
// goal declares a count query, and `saveGoal` then refuses a typed `current` outright. Reading the
// frontmatter number here would put a stale figure on the card the backend had already replaced.
function readGoal(g) {
  const f = fm(g);
  const kind = String(f.kind || (f.threshold != null ? 'threshold' : 'target')).toLowerCase();
  const current = Number(g && g.current != null ? g.current : (f.current ?? 0));
  const unitRaw = (g && g.unit) || f.unit || '';
  const unit = unitRaw === 'percent' ? '%' : unitRaw;
  if (kind === 'threshold') {
    const line = Number(f.threshold ?? 0);
    const above = String(f.direction || 'above').toLowerCase() !== 'below';
    const met = above ? current >= line : current <= line;
    return {
      kind, current, target: line, unit, met,
      pct: line ? Math.max(0, Math.min(100, (current / line) * 100)) : 0,
      figure: unit === '%' ? current + '%' : String(current),
      against: (above ? 'needs to stay above ' : 'needs to stay below ') + (unit === '%' ? line + '%' : line + (unit ? ' ' + unit : '')),
      gap: Math.abs(line - current),
    };
  }
  const target = Number(g && g.target != null ? g.target : (f.target ?? 0));
  return {
    kind: 'target', current, target, unit,
    met: target > 0 && current >= target,
    pct: target > 0 ? Math.max(0, Math.min(100, (current / target) * 100)) : 0,
    figure: current + ' / ' + target,
    against: unit ? unit : '',
    gap: Math.max(0, target - current),
  };
}

// `behind` is a field the backend sets. It is trusted first. When it is absent we fall back to the
// only honest client-side reading there is — the goal's own clock against its own progress — which
// is the goal type's decay window, not a second staleness rule for anything else.
function isBehind(g, read, left) {
  const f = fm(g);
  // The backend's computed flag sits on the shaped goal; the frontmatter one is a number someone
  // typed months ago, and shapeGoal deliberately overrides it. Trust the computed one.
  if (typeof (g && g.behind) === 'boolean') return g.behind;
  if (typeof f.behind === 'boolean') return f.behind;
  if (read.kind === 'threshold') return !read.met;
  if (read.met) return false;
  if (left == null) return false;
  const started = Date.parse(String(f.created || f.updated || ''));
  const end = Date.parse(String(f.deadline || ''));
  if (Number.isNaN(started) || Number.isNaN(end) || end <= started) return left < 0;
  const elapsed = Math.max(0, Math.min(1, (Date.now() - started) / (end - started)));
  return read.pct / 100 < elapsed - 0.05;
}

function daysWord(left) {
  if (left == null) return 'NO DEADLINE';
  if (left < 0) return Math.abs(left) === 1 ? '1 DAY PAST DUE' : Math.abs(left) + ' DAYS PAST DUE';
  if (left === 0) return 'DUE TODAY';
  if (left === 1) return '1 DAY LEFT';
  return left + ' DAYS LEFT';
}

function GoalCard({ goal, onOpenPath, onSave }) {
  const f = fm(goal);
  const id = idOf(goal);
  const read = readGoal(goal);
  const left = daysLeft(goal);
  const behind = isBehind(goal, read, left);
  const late = left != null && left < 0 && !read.met;
  const assistants = [].concat(f.assistants || f.assigned || []).filter(Boolean).map(String);
  const save = (label, patch) => onSave(label, () => api.saveGoal(id, patch));

  const tone = read.met ? 'var(--ok)' : behind ? 'var(--warn)' : 'var(--fg-soft)';
  const edge = read.met ? 'var(--border)' : behind ? 'var(--warn)' : 'var(--border)';

  return (
    <Card
      style={{
        ...sx('background:var(--surface-2)'),
        border: '1px solid ' + edge,
        // Behind is a state you should feel before you read it: the card sits on a warmer bed and
        // keeps its edge, while a met goal recedes because it needs nothing from you.
        ...(read.met ? { background: 'var(--surface)', borderColor: 'var(--line)' } : null),
      }}>
      <div style={sx('display:flex;align-items:flex-start;justify-content:space-between;gap:14px')}>
        <InlineEdit
          value={(goal && goal.label) || f.label || f.title || id}
          onCommit={v => save('SAVED', { label: v })}
          placeholder="What are you chasing?"
          style={{ ...sx('white-space:normal;overflow:visible;text-overflow:clip;font-size:14px;font-weight:600;line-height:1.35'), color: fadeFg(goal, read.met ? 'var(--fg-soft)' : 'var(--fg)') }}
        />
        <span style={{ ...mono('flex:none;font-size:19px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1'), color: tone }}>
          {read.figure}
        </span>
      </div>

      <div style={sx('display:flex;flex-direction:column;gap:7px;margin-top:13px')}>
        <Bar pct={read.pct} tone={tone} />
        <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap')}>
          <span style={{ ...mono('font-size:9.5px;font-weight:600;letter-spacing:.08em;font-variant-numeric:tabular-nums'), color: late ? 'var(--danger)' : behind ? 'var(--warn)' : 'var(--fg-faint)' }}>
            {daysWord(left)}
          </span>
          <span style={{ ...mono('font-size:9.5px;font-weight:500;letter-spacing:.06em'), color: 'var(--fg-faint)' }}>
            {read.kind === 'threshold'
              ? read.against.toUpperCase()
              : read.met ? 'DONE' : (read.gap + (read.unit ? ' ' + plural(read.gap, read.unit) : '') + ' TO GO').toUpperCase()}
          </span>
        </div>
      </div>

      {behind && !read.met ? (
        <div style={{ ...sx('display:flex;flex-direction:column;gap:3px;margin-top:12px;padding:9px 11px;border-radius:8px'), background: 'var(--sunk)', border: '1px solid var(--border)' }}>
          <span style={{ ...mono('font-size:9px;font-weight:800;letter-spacing:.14em'), color: 'var(--warn)' }}>BEHIND</span>
          <span style={sx('font-size:11.5px;line-height:1.55;color:var(--fg-soft)')}>
            {read.kind === 'threshold'
              ? 'You are ' + (read.unit === '%' ? read.gap + ' points' : read.gap + ' ' + plural(read.gap, read.unit)) + ' under the line you set.'
              : left != null && left > 0
                ? 'At this pace it will not land by the deadline — ' + read.gap + ' more in ' + left + ' days.'
                : 'The deadline has passed and ' + read.gap + ' are still missing.'}
          </span>
        </div>
      ) : null}

      {bodyOf(goal).trim() ? (
        <p style={sx('margin:12px 0 0;font-size:12px;line-height:1.6;color:var(--fg-muted);max-width:70ch')}>
          {bodyOf(goal).trim().split('\n\n')[0].replace(/^#+\s*/, '')}
        </p>
      ) : null}

      <div style={sx('display:flex;flex-direction:column;gap:9px;margin-top:13px;padding-top:12px;border-top:1px solid var(--line)')}>
        <div style={sx('display:flex;align-items:center;gap:9px;flex-wrap:wrap')}>
          <span style={{ ...mono('font-size:8.5px;font-weight:700;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>ON IT</span>
          {assistants.length
            ? assistants.map(a => <Chip key={a} label={a} on={false} style={sx('cursor:default')} />)
            : <span style={{ ...mono('font-size:9.5px;font-weight:600;letter-spacing:.08em'), color: 'var(--fg-faint)' }}>NOBODY YET</span>}
        </div>

        <div style={sx('display:flex;align-items:center;gap:9px;flex-wrap:wrap')}>
          <span style={{ ...mono('font-size:8.5px;font-weight:700;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>
            {read.kind === 'threshold' ? 'THE LINE' : 'AIMING FOR'}
          </span>
          <InlineEdit
            value={read.target}
            onCommit={v => save('SAVED', read.kind === 'threshold' ? { threshold: Number(v) } : { target: Number(v) })}
            placeholder="a number"
            style={{ ...mono('font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;display:inline-block;min-width:30px'), color: 'var(--fg-soft)' }}
          />
          <span style={{ ...mono('font-size:8.5px;font-weight:700;letter-spacing:.12em;margin-left:8px'), color: 'var(--fg-faint)' }}>BY</span>
          <InlineEdit
            value={dateInput(f.deadline)}
            renderValue={v => humanDate(v)}
            onCommit={v => save('SAVED', { deadline: v })}
            placeholder="no deadline"
            style={{ ...mono('font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;display:inline-block;min-width:80px'), color: 'var(--fg-soft)' }}
          />
          <span style={{ ...mono('font-size:9px;font-weight:500;letter-spacing:.06em;margin-left:4px'), color: 'var(--fg-faint)' }}>
            · {read.current}{read.unit === '%' ? '%' : ''} SO FAR, {goal && goal.computed ? 'COUNTED FROM YOUR RECORDS' : 'COUNTED BY YOUR ASSISTANTS'}
          </span>
        </div>

        <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap')}>
          <Age word="CHECKED" value={checkedAt(goal)} />
          <PathLink path={pathOf(goal)} onOpenPath={onOpenPath} />
        </div>
      </div>
    </Card>
  );
}

// The whole of the create control: a label, and everything else is the card's own inline editors
// (target, deadline) once it exists. `POST /api/goals` (backend/memory.mjs) turns the label into
// the slug and needs nothing else — a goal with a label and no number beats no goal.
function NewGoalInline({ value, onChange, onCreate, onCancel, busy }) {
  return (
    <div style={{ ...sx('display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 14px;border-radius:8px'), background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
      <Input autoFocus value={value} onChange={e => onChange(e.target.value)}
        placeholder="What are you chasing? e.g. Book 6 hazing stories"
        onKeyDown={e => { if (e.key === 'Enter') onCreate(); if (e.key === 'Escape') onCancel(); }}
        style={sx('flex:1;min-width:220px;font-size:13px;padding:8px 12px')} />
      <Btn size="sm" variant="primary" busy={busy} disabled={!value.trim()} onClick={onCreate}>Create</Btn>
      <Btn size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Btn>
    </div>
  );
}

export default function Goals({ onOpenPath, onWrote }) {
  const { data, error, loading, reload } = useResource(() => api.goals(), []);
  const writer = useMemoryWriter(() => { reload(); onWrote && onWrote(); });
  const [creating, setCreating] = React.useState(false);
  const [label, setLabel] = React.useState('');

  const create = async () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const ok = await writer.save('NEW GOAL', () => api.createGoal({ label: trimmed }));
    if (ok) { setCreating(false); setLabel(''); }
  };
  const cancelCreate = () => { setCreating(false); setLabel(''); };

  if (loading && !data) return <Loading what="YOUR GOALS" />;

  const goals = listOf(data, 'goals', 'items');
  if (!goals.length) {
    if (error) {
      return (
        <Failed
          error={error}
          title="NO GOALS SET"
          body={String(error.message || error)}
        />
      );
    }
    return (
      <div style={sx('flex:1;display:flex;align-items:center;justify-content:center;padding:40px')}>
        {creating ? (
          <div style={sx('width:100%;max-width:460px')}>
            <NewGoalInline value={label} onChange={setLabel} onCreate={create} onCancel={cancelCreate} busy={writer.note?.kind === 'saving'} />
          </div>
        ) : (
          <Empty
            size="page" style={sx('max-width:460px')}
            title="NO GOALS SET"
            body="A goal is one number with a date on it. Your assistants read it every morning and it is how they decide what is worth doing first."
            action={{ onClick: () => setCreating(true), label: '+ New goal' }}
          />
        )}
      </div>
    );
  }

  const read = goals.map(g => ({ g, r: readGoal(g), left: daysLeft(g) }));
  const behindCount = read.filter(x => isBehind(x.g, x.r, x.left) && !x.r.met).length;

  // Behind first, then soonest deadline. A goal you are on top of does not need the top of the
  // screen (Law 2 — the surface opens at the thing that needs a decision).
  const sorted = [...read].sort((a, b) => {
    const ab = isBehind(a.g, a.r, a.left) && !a.r.met ? 0 : 1;
    const bb = isBehind(b.g, b.r, b.left) && !b.r.met ? 0 : 1;
    if (ab !== bb) return ab - bb;
    return (a.left == null ? 1e9 : a.left) - (b.left == null ? 1e9 : b.left);
  });

  return (
    <div style={sx('flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden')}>
      <ScreenHead
        eyebrow="WHAT YOU ARE CHASING"
        line={behindCount
          ? behindCount + (behindCount === 1 ? ' goal is behind' : ' goals are behind') + '. Your assistants read these every morning and put the behind ones first — change a number here and they change what they do next.'
          : 'Every goal is on track. Your assistants read these every morning and work the closest deadline first.'}
        right={
          <>
            <SaveNote state={writer.note} />
            {creating ? null : <Btn variant="secondary" size="sm" onClick={() => setCreating(true)}>+ New goal</Btn>}
          </>
        }>
        {creating ? <NewGoalInline value={label} onChange={setLabel} onCreate={create} onCancel={cancelCreate} busy={writer.note?.kind === 'saving'} /> : null}
      </ScreenHead>

      <div style={sx('flex:1;min-height:0;overflow-y:auto;padding:18px 20px 32px')}>
        <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px;align-items:start')}>
          {sorted.map(({ g }) => (
            <GoalCard key={idOf(g) || pathOf(g)} goal={g} onOpenPath={onOpenPath} onSave={writer.save} />
          ))}
        </div>

        {goals.length ? null : <Empty title="NO GOALS SET" />}

        <p style={sx('margin:20px 0 0;font-size:11px;line-height:1.6;color:var(--fg-faint);max-width:70ch')}>
          The number on the left of each goal is counted from your own records — your assistants
          keep it up to date, you set the target and the date.
        </p>
      </div>
    </div>
  );
}

export { readGoal, daysLeft, isBehind };
