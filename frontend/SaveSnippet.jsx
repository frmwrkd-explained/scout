// SaveSnippetDialog — the one place text becomes a reusable snippet.
//
// Callers hand it text and a suggested name; it collects name + /trigger, POSTs to /api/snippets,
// and refreshes app.state.snippets so the new snippet is typeable as /trigger immediately — in
// this field and every other snippet-aware one (MentionText, SnippetText).
//
// Snippet shape is fixed by the backend (backend/index.mjs:615-630): { file, name, trigger,
// content }. There is no id and no category — `file` is the primary key. Do not invent one here.
//
// Reached from the Composer's right-click menu: a selection in the prompt, the whole prompt, or
// one row of PROMPT · SEGMENTS.
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { sx } from './sx';
import { api } from './api';
import { MONO } from './tokens';


// Mirrors backend/index.mjs cleanTrigger() so the field shows what will actually be stored —
// otherwise the user types "Warm Key" and silently gets "warmkey".
export const toTrigger = s => String(s || '')
  .toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '').slice(0, 24);

export default function SaveSnippetDialog({ app, text, suggestName = '', onClose }) {
  const [name, setName] = useState(suggestName);
  const [trigger, setTrigger] = useState(toTrigger(suggestName));
  const [touchedTrigger, setTouched] = useState(false);
  const [content, setContent] = useState(String(text || ''));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const existing = (app && app.state && app.state.snippets) || [];
  const clash = trigger && existing.find(s => (s.trigger || '') === trigger);

  const setNameSynced = v => {
    setName(v);
    if (!touchedTrigger) setTrigger(toTrigger(v)); // trigger tracks the name until hand-edited
  };

  const save = async () => {
    if (busy) return;
    const n = name.trim();
    const t = toTrigger(trigger);
    if (!n) { setErr('Name it first.'); return; }
    if (!t) { setErr('Needs a trigger — that is what you type after "/".'); return; }
    if (!content.trim()) { setErr('Nothing to save — the snippet body is empty.'); return; }
    setBusy(true); setErr('');
    try {
      await api.saveSnippet(n, t, content);
      app.reloadSnippets && app.reloadSnippets();
      app.showToast && app.showToast('Snippet saved — type /' + t + ' in any prompt', 'var(--ok)');
      onClose();
    } catch (e) { setBusy(false); setErr(e.message || 'Save failed'); }
  };

  const label = t => (
    <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.12em', color: 'var(--fg-muted)', marginBottom: 5 }}>{t}</div>
  );
  const input = (value, onChange, extra) => ({
    value, onChange: e => onChange(e.target.value),
    onKeyDown: e => { e.stopPropagation(); if (e.key === 'Enter') save(); if (e.key === 'Escape') onClose(); },
    style: {
      ...sx('width:100%;box-sizing:border-box;background:var(--sunk);border:1px solid var(--border-2);border-radius:7px;color:var(--fg);padding:8px 11px'),
      fontSize: 12.5, ...extra,
    },
  });

  return createPortal(
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      style={sx('position:fixed;inset:0;z-index:130;background:rgba(5,6,8,.82);display:flex;align-items:center;justify-content:center;padding:34px')}
    >
      <div style={sx('width:100%;max-width:520px;background:var(--surface);border:1px solid var(--border-2);border-radius:12px;overflow:hidden')}>
        <div style={sx('display:flex;align-items:baseline;gap:10px;padding:14px 18px 10px;border-bottom:1px solid var(--line)')}>
          <span style={{ ...sx('font-weight:700;text-transform:uppercase'), fontFamily: MONO, fontSize: 11, letterSpacing: '.16em', color: 'var(--fg)' }}>Save to snippets</span>
          <span style={sx('font-size:11px;color:var(--fg-faint);font-style:italic')}>reusable in every prompt field</span>
        </div>

        <div style={sx('padding:14px 18px 4px;display:flex;gap:10px')}>
          <div style={sx('flex:1;min-width:0')}>
            {label('NAME')}
            <input autoFocus placeholder="e.g. ARRI 28mm body" {...input(name, setNameSynced)} />
          </div>
          <div style={sx('flex:none;width:170px')}>
            {label('TRIGGER')}
            <div style={sx('display:flex;align-items:center;gap:5px')}>
              <span style={{ fontFamily: MONO, fontSize: 13, color: 'var(--accent)' }}>/</span>
              <input placeholder="arri-28" {...input(trigger, v => { setTouched(true); setTrigger(v); }, { fontFamily: MONO, fontSize: 11.5 })} />
            </div>
          </div>
        </div>

        <div style={sx('padding:12px 18px 0')}>
          {label('CONTENT')}
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}
            rows={Math.min(10, Math.max(3, Math.ceil(content.length / 62)))}
            style={{
              ...sx('width:100%;box-sizing:border-box;resize:vertical;background:var(--sunk);border:1px solid var(--border-2);border-radius:7px;color:var(--fg);padding:9px 11px;line-height:1.7'),
              fontFamily: MONO, fontSize: 11,
            }}
          />
        </div>

        <div style={{ ...sx('padding:6px 18px 0;line-height:1.5'), fontFamily: MONO, fontSize: 9.5, color: clash ? 'var(--marked)' : 'var(--border-3)' }}>
          {clash
            ? '/' + trigger + ' is already "' + clash.name + '" — both will match; pick a distinct trigger to avoid ambiguity'
            : 'saved to snippets/' + (toTrigger(trigger) || '…') + '.md'}
        </div>
        {err ? <div style={sx('padding:6px 18px 0;font-size:11px;color:var(--danger)')}>{err}</div> : null}

        <div style={sx('display:flex;align-items:center;gap:10px;padding:14px 18px 16px')}>
          <span style={{ ...sx('margin-left:auto;cursor:pointer'), fontFamily: MONO, fontSize: 10.5, color: 'var(--fg-muted)' }}
            className="hFg" onClick={onClose}>Cancel</span>
          <span
            className="hBtnAccent" onClick={save}
            style={{
              ...sx('padding:7px 18px;border-radius:8px;cursor:pointer;font-weight:700;font-size:11.5px'),
              background: 'var(--accent)', color: 'var(--on-accent)', opacity: busy ? .6 : 1,
            }}
          >{busy ? 'SAVING…' : 'SAVE SNIPPET'}</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
