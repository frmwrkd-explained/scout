// AUTOMATIONS — "when this happens to a record, do that".
//
// backend/automations.mjs is the whole of it; this screen is how a person reads, switches and
// builds the rules. Every rule is shown as the one sentence it is — "When a Deal's stage becomes
// won → Create invoice — ask me first" — with its switch, its mode and what it has done lately,
// each run linking to the record it made. There is no code and no JSON here: the builder is the
// same sentence with selects in it, offering only what this workspace has.
//
// The screen also says what an automation is NOT, because the limits are the safety: it reacts to
// changes made in the app (not to a file edited by hand), it has no schedule, and all it can do is
// file one new record.
//
// Props
//   actor
//   onOpenPath(path)        open a record, or the rule's own file
//   onNavigate(screen, arg) "Needs you" for a run that is waiting on an answer

import React from 'react';
import { Btn } from './ui';
import { MONO } from './tokens';
import { automationsApi } from './pluginsApi';
import './plugins.css';

const when = ts => { const d = new Date(ts); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); };

function Switch({ on, disabled, label, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      className={'auSwitch' + (on ? ' on' : '')} onClick={() => onChange(!on)}>
      <span className="auSwitchTrack"><span className="auSwitchKnob" /></span>
      <span className="auSwitchWord">{on ? 'On' : 'Off'}</span>
    </button>
  );
}

function Seg({ label, value, options, disabled, onPick }) {
  return (
    <div className="auSeg" role="radiogroup" aria-label={label}>
      {options.map(([key, text]) => (
        <button key={key} type="button" role="radio" aria-checked={value === key} disabled={disabled}
          className={'auSegBtn' + (value === key ? ' on' : '')} onClick={() => value !== key && onPick(key)}>{text}</button>
      ))}
    </div>
  );
}

// What came of one firing, in words, with the way to it.
function Outcome({ run, onOpenPath, onNavigate }) {
  if (run.state === 'ran' && run.made) {
    return <span>made <button type="button" className="auLink" onClick={() => onOpenPath && onOpenPath(run.made)}>{run.made_title || run.made}</button>{run.made_in ? ' in ' + run.made_in : ''}{run.mode === 'ask' ? ', after you said yes' : ''}</span>;
  }
  if (run.state === 'asked') return <span>is waiting for your answer in <button type="button" className="auLink" onClick={() => onNavigate && onNavigate('decide')}>Needs you</button></span>;
  if (run.state === 'declined') return <span>you said no</span>;
  if (run.state === 'failed') return <span className="auFailed">did not run: {run.error}</span>;
  return <span>is running</span>;
}

function Rule({ rule, actor, onOpenPath, onNavigate, onChanged }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [reason, setReason] = React.useState(null);
  const change = async fn => {
    setBusy(true); setError(null);
    try { await fn(); await onChanged(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const s = rule.sentence;
  return (
    <article className={'auRule' + (rule.enabled ? '' : ' off')}>
      <div className="auRuleTop">
        <div className="auRuleText">
          <div className="pgKicker">{rule.name}</div>
          {s
            ? <p className="auSentence">{s.when} <span className="auArrow" aria-hidden="true">→</span> <b>{s.then}</b></p>
            : <p className="auSentence">This rule cannot be read as a sentence yet.</p>}
        </div>
        <div className="auControls">
          <Seg label="How it runs" value={rule.mode} disabled={busy} options={[['ask', 'Ask me first'], ['auto', 'Do it']]}
            onPick={mode => change(() => automationsApi.update(rule.id, { mode }, actor))} />
          <Switch on={rule.enabled} disabled={busy || (rule.broken && !rule.enabled)} label={(rule.enabled ? 'Switch off ' : 'Switch on ') + rule.name}
            onChange={enabled => change(() => automationsApi.update(rule.id, { enabled }, actor))} />
        </div>
      </div>

      {rule.note ? <p className="auNote">{rule.note}</p> : null}
      {rule.proposed ? <p className="auFlag">Proposed by {rule.proposed_by || 'an assistant'}. It stays switched off until you switch it on.</p> : null}
      {rule.broken ? (
        <div className="pgError" role="alert">
          <span className="auBody">This automation cannot run, so it is switched off:</span>
          <ul className="pgPlain">{rule.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
      ) : null}
      {error ? <div className="pgError" role="alert"><span className="auBody">{error}</span></div> : null}

      <div className="auRuns">
        <div className="pgFactLabel">Last runs{rule.run_count > rule.runs.length ? ' · ' + rule.run_count + ' in all' : ''}</div>
        {rule.runs.length ? rule.runs.map(run => (
          <div key={run.key} className="auRun">
            <span className="auRunWhen" style={{ fontFamily: MONO }}>{when(run.at)}</span>
            <span className="auRunWhat">
              <button type="button" className="auLink" onClick={() => onOpenPath && onOpenPath(run.record)}>{run.title || run.record}</button>
              {' '}<Outcome run={run} onOpenPath={onOpenPath} onNavigate={onNavigate} />
            </span>
          </div>
        )) : <p className="auQuiet">It has not fired yet.</p>}
      </div>

      <div className="auFoot">
        <button type="button" className="pgPath hAccent" style={{ fontFamily: MONO }} onClick={() => onOpenPath && onOpenPath(rule.path)}>{rule.path}</button>
        {reason === null ? (
          <Btn size="sm" variant="ghost" disabled={busy} onClick={() => setReason('')}>Archive…</Btn>
        ) : (
          <span className="auArchive">
            <input className="pgInput" autoFocus aria-label="Why it is being archived" placeholder="Why? It is kept on disk, switched off." value={reason} onChange={e => setReason(e.target.value)} />
            <Btn size="sm" variant="danger" disabled={busy || !reason.trim()} onClick={() => change(() => automationsApi.archive(rule.id, reason.trim(), actor))}>Archive</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setReason(null)}>Keep it</Btn>
          </span>
        )}
      </div>
    </article>
  );
}

const Pick = ({ label, value, onChange, children, wide }) => (
  <select className={'auPick' + (wide ? ' wide' : '')} aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{children}</select>
);

// The same sentence, with selects where the choices are.
function Builder({ options, actor, onSaved, onCancel }) {
  const collections = options.collections;
  const [source, setSource] = React.useState((collections.find(c => options.buttons.some(b => b.on === c.id)) || collections[0] || {}).id || '');
  const [on, setOn] = React.useState('field_becomes');
  const [field, setField] = React.useState('');
  const [value, setValue] = React.useState('');
  const [run, setRun] = React.useState('plugin');
  const [button, setButton] = React.useState('');
  const [target, setTarget] = React.useState('');
  const [called, setCalled] = React.useState('');
  const [mode, setMode] = React.useState('ask');
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  const src = collections.find(c => c.id === source) || { fields: [], singular: 'record', label: '' };
  const fields = src.fields.filter(f => !['relation', 'url', 'email', 'phone'].includes(f.type));
  const f = fields.find(x => x.key === field) || fields.find(x => x.options) || fields[0] || null;
  const choices = f && f.options ? f.options : f && f.type === 'checkbox' ? ['true', 'false'] : null;
  const val = choices ? (choices.includes(value) ? value : choices[choices.length - 1]) : value;
  const buttons = options.buttons.filter(b => b.on === source);
  const chosen = buttons.find(b => b.plugin + '/' + b.action === button) || buttons[0] || null;
  const kind = run === 'plugin' && !buttons.length ? 'create_record' : run;
  // Where a new record most likely belongs: a collection that points back at this one with a
  // single link and has a status to start in — a to-do for a deal, not a company for a deal.
  const fits = c => (c.id === source ? -10 : 0) + (c.fields.some(x => x.type === 'relation' && x.target === source && !x.many) ? 4 : 0) + (c.fields.some(x => x.type === 'status') ? 2 : 0) - c.fields.length / 100;
  const tgt = collections.find(c => c.id === target) || [...collections].sort((a, b) => fits(b) - fits(a))[0];
  const nameTemplate = called || 'Follow up — {{name}}';

  // What the new record is given besides its name: its first status, a link back to the record
  // that fired the rule, and any link the two collections share (the same company, the same owner).
  const extras = [];
  if (kind === 'create_record' && tgt) {
    for (const x of tgt.fields) {
      if (x.type === 'status' && x.options && x.options.length) extras.push([x.key, x.options[0], x.label + ': ' + x.options[0]]);
      else if (x.type === 'relation' && x.target === source && !extras.some(e => e[1] === '{{slug}}')) extras.push([x.key, '{{slug}}', x.label + ': this ' + src.singular.toLowerCase()]);
      else if (src.fields.some(y => y.key === x.key && y.type === x.type && (x.type !== 'relation' || y.target === x.target)) && ['relation', 'select'].includes(x.type)) extras.push([x.key, '{{' + x.key + '}}', x.label + ': the same as the ' + src.singular.toLowerCase() + '’s']);
    }
  }

  const rule = {
    mode,
    when: on === 'record_created' ? { on, collection: source } : { on, collection: source, field: f ? f.key : '', value: val },
    do: kind === 'plugin'
      ? { run: 'plugin', plugin: chosen ? chosen.plugin : '', action: chosen ? chosen.action : '' }
      : { run: 'create_record', collection: tgt ? tgt.id : '', fields: { [tgt ? tgt.name_key : 'name']: nameTemplate, ...Object.fromEntries(extras.map(e => [e[0], e[1]])) } },
  };
  const article = /^[aeiou]/i.test(src.singular) ? 'an' : 'a';
  const suggested = (kind === 'plugin' ? (chosen ? chosen.label : 'Do something') : 'New ' + (tgt ? tgt.singular.toLowerCase() : 'record'))
    + ' when ' + article + ' ' + src.singular.toLowerCase() + (on === 'record_created' ? ' is created' : ' ' + (f ? f.label.toLowerCase() : 'field') + ' becomes ' + String(val || '…'));
  const ready = source && (on === 'record_created' || (f && String(val).trim())) && (kind === 'plugin' ? !!chosen : !!tgt && nameTemplate.trim());

  const save = async () => {
    setBusy(true); setError(null);
    try { onSaved(await automationsApi.create({ name: name.trim() || suggested, ...rule }, actor)); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <section className="auBuilder" aria-label="New automation">
      <div className="pgKicker">New automation</div>
      <div className="auBuild">
        <span>When {article}</span>
        <Pick label="Collection" value={source} onChange={v => { setSource(v); setField(''); setValue(''); setButton(''); }}>
          {collections.map(c => <option key={c.id} value={c.id}>{c.singular}</option>)}
        </Pick>
        <Pick label="What happens" value={on} onChange={setOn}>
          <option value="field_becomes">changes so that</option>
          <option value="record_created">is created</option>
        </Pick>
        {on === 'field_becomes' ? (
          <>
            <Pick label="Field" value={f ? f.key : ''} onChange={v => { setField(v); setValue(''); }}>
              {fields.map(x => <option key={x.key} value={x.key}>{x.label.toLowerCase()}</option>)}
            </Pick>
            <span>becomes</span>
            {choices
              ? <Pick label="Value" value={val} onChange={setValue}>{choices.map(o => <option key={o} value={o}>{o.replace(/-/g, ' ')}</option>)}</Pick>
              : <input className="auPick auType" aria-label="Value" placeholder="a value" value={value} onChange={e => setValue(e.target.value)} />}
          </>
        ) : null}
      </div>
      <div className="auBuild">
        <span className="auArrow" aria-hidden="true">→</span>
        <Pick label="What to do" value={kind} onChange={setRun}>
          <option value="plugin" disabled={!buttons.length}>press a plugin button</option>
          <option value="create_record">create a record</option>
        </Pick>
        {kind === 'plugin' ? (
          <Pick wide label="Which button" value={chosen ? chosen.plugin + '/' + chosen.action : ''} onChange={setButton}>
            {buttons.map(b => <option key={b.plugin + b.action} value={b.plugin + '/' + b.action}>{b.label} ({b.plugin_name}) — files one record in {b.creates}</option>)}
          </Pick>
        ) : (
          <>
            <span>in</span>
            <Pick label="Collection for the new record" value={tgt ? tgt.id : ''} onChange={setTarget}>
              {collections.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Pick>
            <span>called</span>
            <input className="auPick auType wide" aria-label="Name of the new record" placeholder="Follow up — {{name}}" value={called} onChange={e => setCalled(e.target.value)} />
          </>
        )}
      </div>
      <div className="auBuild">
        <span>—</span>
        <Pick label="How it runs" value={mode} onChange={setMode}>
          <option value="ask">ask me first</option>
          <option value="auto">do it</option>
        </Pick>
        <span className="auQuiet">{mode === 'ask' ? 'Each time, a card in Needs you asks before anything is made.' : 'It is made at once, in your name. A change an assistant makes still asks.'}</span>
      </div>

      {kind === 'create_record' ? (
        <p className="auNote">
          <span style={{ fontFamily: MONO }}>{'{{name}}'}</span> is the name of the {src.singular.toLowerCase()} that fired it.
          {extras.length ? ' The new ' + (tgt ? tgt.singular.toLowerCase() : 'record') + ' also gets ' + extras.map(e => e[2].toLowerCase()).join(' · ') + '.' : ''}
        </p>
      ) : !buttons.length ? <p className="auNote">No plugin has a button on {src.label} that files a record, so this one creates a record instead.</p> : null}

      <div className="auBuild auSave">
        <input className="pgInput" aria-label="Name of the automation" placeholder={suggested} value={name} onChange={e => setName(e.target.value)} />
        <Btn variant="primary" busy={busy} disabled={!ready} onClick={save}>Save automation</Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
      {error ? <div className="pgError" role="alert"><span className="auBody">{error}</span></div> : null}
    </section>
  );
}

export default function Automations({ actor, onOpenPath, onNavigate }) {
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [building, setBuilding] = React.useState(false);
  const load = React.useCallback(async () => {
    try { setData(await automationsApi.list()); setError(null); } catch (e) { setError(e.message); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const rules = data ? data.automations : [];
  return (
    <div className="pgScreen">
      <header className="pgHead">
        <div className="pgHeadText">
          <h1 className="pgTitle">Automations</h1>
          <p className="pgLead">When something happens to a record, do something about it. Each automation is one sentence, and all it can ever do is file one new record.</p>
        </div>
        <div className="pgHeadRight">
          <Btn variant={building ? 'ghost' : 'secondary'} disabled={!data} onClick={() => setBuilding(true)}>New automation</Btn>
        </div>
      </header>
      <div className="auScroll">
        <div className="auDoc">
          {building && data ? <Builder options={data.options} actor={actor} onCancel={() => setBuilding(false)} onSaved={async () => { setBuilding(false); await load(); }} /> : null}
          {!data ? <p className="auQuiet">{error || 'Reading the automations folder…'}</p>
            : rules.length ? rules.map(r => <Rule key={r.id} rule={r} actor={actor} onOpenPath={onOpenPath} onNavigate={onNavigate} onChanged={load} />)
              : !building ? <p className="auQuiet">No automations yet. “New automation” builds one as a sentence.</p> : null}

          <section className="auLimits">
            <div className="pgFactLabel">What an automation does not do</div>
            <ul className="pgPlain">
              <li>It reacts to changes made in Scout. A file edited by hand on disk does not fire one.</li>
              <li>It fires once for each record. A deal that is won, lost and won again is not invoiced twice.</li>
              <li>It cannot change or delete a record, send anything, or send an assistant out. It files one new record, and a record it made never fires another automation.</li>
              <li>There is no schedule yet (“every Monday”). Skills run on a schedule through an assistant.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
