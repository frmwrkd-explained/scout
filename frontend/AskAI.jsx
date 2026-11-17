// AskAI — ask the in-app AI about the record you are looking at.
//
// A small button for the record page's toolbar that opens a panel under itself. Three things can
// come back, and only one of them is words:
//   · an ANSWER      plain text. Nothing changes.
//   · a DRAFT        text for the note, or for one long-text property.
//   · a FILL         values for the properties that are empty.
// A draft and a fill are PROPOSALS: the panel lists each change as before → after and waits. Only
// `Apply` changes the record, and it does so by handing the changes to the page (`onApply`), which
// saves them the way it saves anything typed. This component never writes; neither does the route.
//
// Mount (frontend/Document.jsx, in the right-hand toolbar group):
//   <AskAI path={path} schema={schema} data={data} onApply={(fields, bodyAppend) => …} />
//
// Props
//   path      the record's path — what the question is about
//   schema    the record's collection (may be null for a plain note: no Fill, no property labels)
//   data      the record's properties as shown now — used for the "before" side
//   onApply   (fields, bodyAppend) => void | Promise. `fields` is { key: value }; `bodyAppend` is
//             Markdown to add to the end of the note, or undefined.
//   disabled  optional — e.g. while the page is showing the raw source

import React from 'react';
import { Btn } from './ui';
import { propertyLabel } from './PropertyRows';
import { connectorsApi } from './connectorsApi';
import './connectors.css';

export const STARTERS = [
  { id: 'summarise', label: 'Summarise this', mode: 'answer', question: 'Summarise this record in a few sentences.', send: true },
  { id: 'draft', label: 'Draft a note about…', mode: 'draft', question: 'Draft a note about ', send: false },
  { id: 'fill', label: 'Fill the empty properties', mode: 'fill', question: '', send: true, needsSchema: true },
];

// The same name a property has everywhere else on the page (PropertyRows.jsx).
const label = (schema, key) => propertyLabel(((schema && schema.fields) || []).find(f => f.key === key) || { key });

// A value as a person reads it. Empty is a word, not a blank.
export function showValue(value) {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return '';
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

// A proposal as the rows the panel lists. PURE, so the wording is tested without a browser.
export function proposalRows(schema, data, proposal) {
  const rows = Object.entries((proposal && proposal.fields) || {}).map(([key, value]) => ({
    key, label: label(schema, key), before: showValue((data || {})[key]), after: showValue(value),
  }));
  if (proposal && proposal.body_append) rows.push({ key: '__note', label: 'Add to the end of the note', before: '', after: proposal.body_append, note: true });
  return rows;
}

// "3 of 40 AI calls left today" — in small type under every result.
export function budgetLine(result) {
  if (!result || !result.budget) return '';
  const who = result.provider && result.provider !== 'stub' ? 'Answered by ' + (result.model || result.provider) + ' · ' : '';
  return who + result.attempts_left + ' of ' + result.budget.limit + ' AI calls left today';
}

export default function AskAI({ path, schema, data, onApply, disabled = false }) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState('answer');
  const [question, setQuestion] = React.useState('');
  const [target, setTarget] = React.useState('');           // '' = the note, else a long-text field key
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState('');
  const [applied, setApplied] = React.useState(false);
  const wrap = React.useRef(null), box = React.useRef(null);
  const asked = React.useRef(0);

  const longFields = ((schema && schema.fields) || []).filter(f => f.type === 'text' && f.multiline);

  // Closing puts the keyboard back on the button that opened the panel.
  const close = React.useCallback(() => { setOpen(false); wrap.current?.querySelector(':scope > button')?.focus(); }, []);
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const onDown = e => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onDown); };
  }, [open, close]);
  // Under the button, right edges aligned — but never off the window: on a narrow window the
  // button is not at the right edge, and a panel hung from it would start off-screen.
  const [place, setPlace] = React.useState(null);
  React.useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const anchor = wrap.current?.querySelector(':scope > button');
      if (!anchor) return;
      const r = anchor.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
      const width = Math.min(440, vw - 32);
      setPlace({ width, left: Math.max(16, Math.min(r.right - width, vw - width - 16)), top: r.bottom + 8, maxHeight: Math.max(220, vh - r.bottom - 24) });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => { window.removeEventListener('resize', measure); setPlace(null); };
  }, [open]);
  // The keyboard goes to the question box once the panel is placed (it is hidden until then, and
  // a hidden box cannot take focus).
  const placed = !!place;
  React.useEffect(() => { if (open && placed) box.current?.focus(); }, [open, placed]);
  // Another record: an old answer is about something else.
  React.useEffect(() => { asked.current++; setResult(null); setError(''); setApplied(false); setBusy(false); }, [path]);

  const send = async (m = mode, q = question) => {
    if (busy || !path) return;
    const ticket = ++asked.current;
    setBusy(true); setError(''); setResult(null); setApplied(false);
    try {
      const r = await connectorsApi.ask({ path, question: q, mode: m, field: m === 'draft' && target ? target : undefined });
      if (ticket === asked.current) setResult(r);
    } catch (e) { if (ticket === asked.current) setError(e.message); }
    finally { if (ticket === asked.current) setBusy(false); }
  };
  const start = s => {
    setMode(s.mode); setQuestion(s.question);
    if (s.send) send(s.mode, s.question);
    else requestAnimationFrame(() => { const el = box.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  };
  const apply = async () => {
    if (!result || !result.proposal) return;
    try { await onApply?.(result.proposal.fields || {}, result.proposal.body_append || undefined); setApplied(true); }
    catch (e) { setError(e.message || 'Could not apply the changes.'); }
  };

  const rows = result && result.proposal ? proposalRows(schema, data, result.proposal) : [];
  const dropped = (result && result.dropped) || [];

  return (
    <span className="askAi" ref={wrap}>
      <Btn variant="ghost" size="sm" disabled={disabled || !path} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen(v => !v)} title="Ask the AI about this record. It suggests; you decide.">Ask AI</Btn>
      {open ? (
        <div className="askAiPanel" role="dialog" aria-label="Ask AI about this record" style={place || { visibility: 'hidden' }}>
          <div className="askAiHead">
            <span className="askAiTitle">Ask AI about this record</span>
            <button type="button" className="askAiClose" onClick={close} aria-label="Close Ask AI">×</button>
          </div>

          <div className="askAiStarters">
            {STARTERS.map(s => (
              <button key={s.id} type="button" className="askAiStarter" disabled={busy || (s.needsSchema && !schema)}
                title={s.needsSchema && !schema ? 'This note is not in a collection, so it has no properties to fill' : undefined}
                onClick={() => start(s)}>{s.label}</button>
            ))}
          </div>

          <textarea ref={box} className="askAiBox" aria-label="Your question" value={question} maxLength={2000}
            placeholder={mode === 'draft' ? 'What should the text say?' : 'Ask anything about this record…'}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (question.trim()) send(mode === 'fill' ? 'answer' : mode); } }} />

          <div className="askAiRow">
            <div className="askAiSeg" role="radiogroup" aria-label="What you want back">
              {[['answer', 'Answer'], ['draft', 'Draft text']].map(([id, text]) => (
                <button key={id} type="button" role="radio" aria-checked={(mode === 'fill' ? 'answer' : mode) === id}
                  className={'askAiSegBtn' + ((mode === 'fill' ? 'answer' : mode) === id ? ' on' : '')} onClick={() => setMode(id)}>{text}</button>
              ))}
            </div>
            {mode === 'draft' && longFields.length ? (
              <select className="askAiSelect" aria-label="Where the draft goes" value={target} onChange={e => setTarget(e.target.value)}>
                <option value="">into the note</option>
                {longFields.map(f => <option key={f.key} value={f.key}>into {label(schema, f.key)}</option>)}
              </select>
            ) : null}
            <span className="askAiSpacer" />
            <Btn size="sm" variant="secondary" busy={busy} disabled={!question.trim()} onClick={() => send(mode === 'fill' ? 'answer' : mode)}>Ask</Btn>
          </div>

          {busy || result || error ? (
            <div className="askAiOut" aria-live="polite">
              {busy ? <span className="askAiWait">Asking… this can take a little while.</span> : null}
              {error ? <p className="askAiError" role="alert">{error}</p> : null}

              {result && result.answer !== undefined ? <p className="askAiAnswer">{result.answer}</p> : null}

              {result && result.proposal ? (
                rows.length ? (
                  <>
                    <span className="askAiLabel">Suggested changes</span>
                    <ul className="askAiChanges">
                      {rows.map(r => (
                        <li key={r.key} className="askAiChange">
                          <span className="askAiKey">{r.label}</span>
                          <span className="askAiDiff">
                            {r.note ? null : <><span className={'askAiBefore' + (r.before ? '' : ' none')}>{r.before || 'empty'}</span><span aria-hidden="true" className="askAiArrow">→</span></>}
                            <span className={'askAiAfter' + (r.after.length > 160 ? ' long' : '')}>{r.after}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    {applied ? <p className="askAiDone" role="status">Applied. It is saved like anything you type, and you can still change it.</p> : (
                      <div className="askAiRow">
                        <Btn size="sm" variant="secondary" onClick={apply}>Apply</Btn>
                        <Btn size="sm" variant="ghost" onClick={() => setResult(null)}>Discard</Btn>
                        <span className="askAiSmall">Nothing is saved until you apply.</span>
                      </div>
                    )}
                  </>
                ) : <p className="askAiAnswer">{result.note || 'Nothing to suggest — the record gives no basis for the empty properties.'}</p>
              ) : null}

              {dropped.length ? (
                <p className="askAiSmall">Left out because {dropped.length === 1 ? 'it does' : 'they do'} not fit this collection: {dropped.map(d => label(schema, d.key) + ' (' + d.reason + ')').join(', ')}.</p>
              ) : null}
              {result ? <p className="askAiSmall">{budgetLine(result)}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
