// frontend/Hire.jsx — hiring an assistant. T12 step 6, M4.
//
// The test this screen has to pass is a feeling, not a field list: it must read like writing a job
// for somebody, not like filling in a form. So every label is a QUESTION in her words, the answers
// are sentences and chips, and the machine names never appear — no `scope.collections`, no cron
// string, no model id. backend/tasks.mjs `saveAssistant()` makes everything but a name optional
// precisely so this screen can stay short.
//
// Nothing is asked twice and nothing is asked that the agent can decide for itself. Five questions,
// then a plain-language read-back of the deal she is about to make, then one button.
//
// PROPS:
//   existing     Assistant  re-brief someone already hired (same screen, different verb).
//   assistants   [Assistant]  offered as "who does it report to" (a sub-agent is an assistant with
//                             a `parent`). Fetched if not passed.
//   collections  [{id,name}]  what it may look through. Fetched if not passed.
//   territories  [Territory]  the ground it may work. Fetched if not passed.
//   actor        string       who is doing the hiring. Default 'crystal'.
//   onHired(assistant)        called with the saved assistant after PATCH /api/assistants/:id.
//   onCancel()                back out. Rendered as a ghost — never competes with the one fill.
//   onOpenPath(path)          Law 8 — offered once the file exists (i.e. when re-briefing).
//
// The one solid accent fill on this screen is "Hire <name>". Everything else is neutral.

import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { Btn, Chip, Input } from './ui';
import { SCHEDULE_OPTIONS, scheduleLabel, monoStyle, PathLink, useRemote } from './Assistants';

const arr = v => (Array.isArray(v) ? v : []);
const listOf = (v, key) => (Array.isArray(v) ? v : arr(v && v[key]));

// Mirrors backend/tasks.mjs `slugify` — the id the file will be named with. Shown, never typed:
// she names a person, the app names a file.
const slugify = s => String(s || '').toLowerCase().trim()
  .replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const toggle = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : list.concat(v));

// A question and its answer. The question is a real sentence in the reading face; only the small
// print under it is mono, because the small print is the machine talking.
function Ask({ n, question, note, children }) {
  return (
    <section style={sx('display:flex;flex-direction:column;gap:11px')}>
      <div style={sx('display:flex;align-items:baseline;gap:11px')}>
        <span style={{ ...monoStyle('font-size:10px;font-weight:700;letter-spacing:.1em'), color: 'var(--fg-faint)' }}>{n}</span>
        <h2 style={sx('margin:0;font-size:15.5px;font-weight:500;line-height:1.4;color:var(--fg)')}>{question}</h2>
      </div>
      <div style={sx('padding-left:26px;display:flex;flex-direction:column;gap:9px')}>
        {children}
        {note ? <span style={sx('font-size:11.5px;color:var(--fg-faint);line-height:1.55')}>{note}</span> : null}
      </div>
    </section>
  );
}

function Chips({ options, selected, onPick, empty }) {
  if (!options.length) {
    return <span style={{ ...monoStyle('font-size:10px;font-weight:700;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>{empty}</span>;
  }
  return (
    <div style={sx('display:flex;flex-wrap:wrap;gap:6px')}>
      {options.map(o => (
        <Chip key={o.value} label={o.label} on={selected.includes(o.value)} onClick={() => onPick(o.value)}
          style={sx('font-size:11px;padding:6px 12px')} />
      ))}
    </div>
  );
}

// The read-back. Everything she answered, as one sentence she can check without decoding anything.
function offer({ name, job, collections, territories, schedule, parent, collLabel, terrLabel, parentLabel }) {
  const who = name.trim() || 'They';
  const bits = [];
  bits.push(job.trim() ? job.trim().replace(/\.$/, '') + '.' : 'No job written yet.');
  if (collections.length) bits.push('It looks through ' + list(collections.map(collLabel)) + '.');
  bits.push(territories.length
    ? 'It works in ' + list(territories.map(terrLabel)) + ', and nowhere else.'
    : 'It has no ground yet, so it will wait until you give it some.');
  bits.push(scheduleLabel(schedule).toLowerCase() === 'only when i ask'
    ? 'It sits still until you send it out.'
    : 'It works ' + scheduleLabel(schedule).toLowerCase() + '.');
  bits.push(parent ? 'It reports to ' + parentLabel(parent) + '.' : 'It reports to you.');
  return { who, sentence: bits.join(' ') };
}

const list = xs => (xs.length < 2 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

export default function Hire({
  existing, assistants, collections, territories, actor = 'crystal',
  onHired, onCancel, onOpenPath,
}) {
  const team = useRemote(assistants, () => api.assistants().then(r => listOf(r, 'assistants')));
  const colls = useRemote(collections, () => api.collections().then(r => listOf(r, 'collections')));
  // GET /api/territory answers { territory: [...] } — backend/territory.mjs:254. The plural is
  // accepted too so a later rename does not silently empty this question.
  const terrs = useRemote(territories, () => api.territory().then(r => {
    const found = listOf(r, 'territory');
    return found.length ? found : listOf(r, 'territories');
  }));

  const scope = (existing && existing.scope) || {};
  const [name, setName] = React.useState((existing && existing.name) || '');
  const [job, setJob] = React.useState((existing && existing.job) || '');
  const [look, setLook] = React.useState(arr(scope.collections).map(String));
  const [ground, setGround] = React.useState(arr(scope.territory || scope.territories).map(String));
  const [schedule, setSchedule] = React.useState((existing && existing.schedule) || 'daily');
  const [parent, setParent] = React.useState((existing && existing.parent) || '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  const id = existing ? existing.id : slugify(name);
  const collOptions = arr(colls).map(c => ({ value: String(c.id), label: c.name || ('#' + c.id) }));
  const terrOptions = arr(terrs).map(t => ({ value: String(t.id), label: (t.data && t.data.name) || t.name || t.id }));
  const mates = arr(team).filter(a => a.id !== id);

  const labelFor = (options, v) => (options.find(o => o.value === v) || { label: v }).label;
  const read = offer({
    name, job, collections: look, territories: ground, schedule, parent,
    collLabel: v => labelFor(collOptions, v), terrLabel: v => labelFor(terrOptions, v),
    parentLabel: v => ((mates.find(a => a.id === v) || {}).name || v),
  });

  const ready = !!name.trim() && !!job.trim() && !!id;

  async function hire() {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      // Everything a person answered, and nothing they did not. `status: idle` because a new hire
      // has not run yet — claiming a task is what makes it running, never this screen.
      const saved = await api.saveAssistant(id, {
        name: name.trim(),
        job: job.trim(),
        scope: { collections: look, territory: ground },
        schedule,
        parent: parent || null,
        status: (existing && existing.status) || 'idle',
      }, actor);
      if (onHired) onHired(saved);
    } catch (e) {
      setError(e.message || 'The workspace would not take that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;overflow-y:auto')}>
      <div style={sx('width:100%;max-width:660px;margin:0 auto;padding:44px 24px 56px;display:flex;flex-direction:column;gap:34px')}>

        <div style={sx('display:flex;flex-direction:column;gap:13px')}>
          <span style={{ ...monoStyle('font-size:9.5px;font-weight:800;letter-spacing:.18em'), color: 'var(--fg-muted)' }}>
            {existing ? 'RE-BRIEFING' : 'HIRING'}
          </span>
          <h1 style={sx('margin:0;font-size:24px;font-weight:500;line-height:1.35;letter-spacing:-.01em;color:var(--fg)')}>
            {existing ? 'What should ' + (existing.name || existing.id) + ' be doing?' : 'Who do you want working for you?'}
          </h1>
          <p style={sx('margin:0;font-size:14.5px;line-height:1.6;color:var(--fg-muted);max-width:56ch')}>
            Six short questions. You can change any answer later, and they will come back to you
            rather than guess when something is unclear.
          </p>
        </div>

        <Ask n="1" question="What will you call them?"
          note={existing ? null
            : id ? 'They will live in a file called assistants/' + id + '.md, which you can open any time.'
            : 'A name you would say out loud. "Scout", "Vetter", "Writer".'}>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Scout"
            disabled={!!existing} style={sx('width:100%;font-size:13px;padding:10px 13px')} />
          {existing ? <PathLink path={existing.path || ('assistants/' + id + '.md')} onOpenPath={onOpenPath} /> : null}
        </Ask>

        <Ask n="2" question="What is the job? Say it in one sentence."
          note="This is what it reads every time it wakes up, so write it the way you would say it to a person on their first day.">
          <Input value={job} onChange={e => setJob(e.target.value)}
            placeholder="Find nurses who tell their own story, not other people's."
            style={sx('width:100%;font-size:13px;padding:10px 13px')} />
        </Ask>

        <Ask n="3" question="What should it look through?"
          note="Only these. Anything it finds outside them comes to you as a question first.">
          <Chips options={collOptions} selected={look} onPick={v => setLook(toggle(look, v))}
            empty="NOTHING TO LOOK THROUGH YET" />
        </Ask>

        <Ask n="4" question="Where may it work?"
          note="The groups, pages and places it is allowed to go. It will ask before it goes anywhere new.">
          <Chips options={terrOptions} selected={ground} onPick={v => setGround(toggle(ground, v))}
            empty="NO GROUND MAPPED YET" />
        </Ask>

        <Ask n="5" question="How often should it work?"
          note={(SCHEDULE_OPTIONS.find(o => o.value === schedule) || {}).hint}>
          <Chips options={SCHEDULE_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
            selected={[schedule]} onPick={setSchedule} empty="" />
        </Ask>

        <Ask n="6" question="Does it report to anyone?"
          note="A helper reports to another assistant and works to its brief. Most people start with everyone reporting to them.">
          <Chips
            options={[{ value: '', label: 'You' }].concat(mates.map(a => ({ value: a.id, label: a.name || a.id })))}
            selected={[parent]} onPick={v => setParent(v === parent ? '' : v)} empty="" />
        </Ask>

        {/* the read-back — the whole deal in one paragraph, before she commits to it */}
        <div style={{
          ...sx('display:flex;flex-direction:column;gap:9px;padding:16px 18px;border-radius:8px'),
          background: 'var(--surface)', border: '1px solid var(--border)',
        }}>
          <span style={{ ...monoStyle('font-size:9.5px;font-weight:800;letter-spacing:.18em'), color: 'var(--fg-muted)' }}>THE DEAL</span>
          <p style={sx('margin:0;font-size:14px;line-height:1.6;color:var(--fg-soft)')}>
            <strong style={sx('font-weight:600;color:var(--fg)')}>{read.who}</strong>{' '}{read.sentence}
          </p>
        </div>

        {error ? (
          <span style={{ ...monoStyle('font-size:11px;font-weight:600'), color: 'var(--warn)' }}>{error}</span>
        ) : null}

        <div style={sx('display:flex;align-items:center;gap:12px')}>
          <Btn variant="primary" size="lg" busy={busy} disabled={!ready}
            onClick={hire} style={{ height: 42 }}>
            {existing ? 'Save the brief' : 'Hire ' + (name.trim() || 'them')}
          </Btn>
          {onCancel ? <Btn variant="ghost" size="lg" onClick={onCancel} style={{ height: 42 }}>Not now</Btn> : null}
          {!ready ? (
            <span style={{ ...monoStyle('font-size:10px;font-weight:700;letter-spacing:.1em'), color: 'var(--fg-faint)' }}>
              A NAME AND A JOB ARE ENOUGH TO START
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
