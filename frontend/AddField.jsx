// `+ Add property` — the last piece of T04, and the human half of Law 9.
//
// A field is a SCHEMA change, and `docs/02_DATA_MODEL.md` §6 says every schema change is a
// proposal. That rule is about **agents**: an agent proposes and lands a card in DECIDE. The human
// is the disposer, so when she adds a field she is not proposing to herself — the field is
// created. Both paths end in the same `saveCollection`, so there is one schema writer either way.
//
// Deliberately small. `docs/04_AGENT_CONTRACT.md` §4 says never change a field's type on live data,
// so this only adds; retiring and re-typing are separate, and neither belongs behind a `+`.
//
// ── why this is no longer a modal ─────────────────────────────────────────────────────────────
// It was a 520px dialog on a dimmed page: a title, two paragraphs of explanation, thirteen
// full-sentence type buttons wrapped over four lines, then Add/Cancel. Adding one column is a
// small act and that dialog made it read as a large one — accurately reported as "very horrible".
//
// docs/06_REUSE.md points at `AddPropertyRow.svelte` + `TypePickerDropdown.svelte` for exactly
// this, and the shape there is: the add affordance is a ROW in the property list, and the type is
// a small anchored popover of icon+name, arrow-key navigable. That is what this is now — it opens
// in place at the bottom of the properties, the same height as the rows above it, and the whole
// interaction is: type a name, press Enter.
//
// Props:
//   collection   the schema this field joins — required
//   onDone(field)  fired after the field exists, so the caller can reload
//   onCancel()
//   actor        who is adding it. Default 'crystal' — the UI is never an agent (Law 4).

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { api } from './api';
import { Btn, Input } from './ui';
import { FieldIcon } from './cells';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// Plain-language names, because the person adding a column is not thinking in field types. The
// value on the right is the type from docs/02_DATA_MODEL.md §2 and nowhere else — an agent
// proposing a type outside that set gets a 400 naming the legal set, and so should this.
// One short name each: the picker is scanned, and a sentence per row is a sentence per row.
export const KINDS = [
  { type: 'text', label: 'Text', hint: 'A name, a note, anything typed.' },
  { type: 'number', label: 'Number', hint: 'A score, a count, an amount.' },
  { type: 'select', label: 'Select', hint: 'One option from a list you set.' },
  { type: 'multiselect', label: 'Tags', hint: 'Any number of labels at once.' },
  { type: 'status', label: 'Stage', hint: 'Where something has got to. Drives the board columns.' },
  { type: 'date', label: 'Date', hint: 'When something happened.' },
  { type: 'checkbox', label: 'Yes / no', hint: 'A simple flag.' },
  { type: 'url', label: 'Link', hint: 'Opens in the browser.' },
  { type: 'email', label: 'Email', hint: 'An email address.' },
  { type: 'phone', label: 'Phone', hint: 'A phone number.' },
  { type: 'relation', label: 'Relation', hint: 'Points at a record in another collection.' },
  { type: 'file', label: 'File', hint: 'A screenshot or a PDF.' },
  { type: 'actor', label: 'Who', hint: 'A person or one of your assistants.' },
];

const keyify = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// ── the type popover ───────────────────────────────────────────────────────────────────────────
// Two columns of icon + name, anchored under the type button. Arrow keys move, Enter picks, Esc
// closes — `TypePickerDropdown.svelte` navigates the same way, and a picker of thirteen things
// that only takes a mouse is a picker you have to aim at.
function TypePicker({ value, onPick, onDismiss }) {
  const [i, setI] = React.useState(() => Math.max(0, KINDS.findIndex(k => k.type === value)));
  const ref = React.useRef(null);

  React.useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return onDismiss(); }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); return onPick(KINDS[i].type); }
      const step = { ArrowDown: 2, ArrowUp: -2, ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (step === undefined) return;
      e.preventDefault(); e.stopPropagation();
      setI(n => (n + step + KINDS.length) % KINDS.length);
    };
    // Capture: the name input below has its own Enter handler, and without capture both fire.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [i, onPick, onDismiss]);

  React.useEffect(() => {
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) onDismiss(); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onDismiss]);

  return (
    <div ref={ref}
      style={{
        ...sx('position:absolute;top:100%;left:0;z-index:30;margin-top:5px;width:284px;padding:5px;border-radius:9px;display:grid;grid-template-columns:1fr 1fr;gap:1px'),
        background: 'var(--surface-2)', border: '1px solid var(--border-3)', boxShadow: '0 12px 28px rgba(0,0,0,.4)',
      }}>
      {KINDS.map((k, n) => {
        const on = n === i;
        return (
          <button key={k.type} type="button" title={k.hint}
            onMouseEnter={() => setI(n)}
            onClick={() => onPick(k.type)}
            style={{
              ...sx('display:flex;align-items:center;gap:8px;height:26px;padding:0 7px;border-radius:5px;cursor:pointer;text-align:left;border:none'),
              background: on ? 'var(--raise)' : 'transparent',
              color: k.type === value ? 'var(--fg)' : on ? 'var(--fg-soft)' : 'var(--fg-muted)',
            }}>
            <FieldIcon type={k.type} size={14} />
            <span style={sx('font-size:11.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{k.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function AddField({ collection, onDone, onCancel, actor = 'crystal' }) {
  const [label, setLabel] = React.useState('');
  const [kind, setKind] = React.useState('text');
  const [picking, setPicking] = React.useState(false);
  const [options, setOptions] = React.useState('');
  const [target, setTarget] = React.useState('');
  const [collections, setCollections] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => { api.collections().then(r => setCollections(r.collections || [])).catch(() => {}); }, []);

  const needsOptions = kind === 'select' || kind === 'multiselect' || kind === 'status';
  const needsTarget = kind === 'relation';
  const key = keyify(label);
  const clash = (collection?.fields || []).some(f => f.key === key);
  const chosen = KINDS.find(k => k.type === kind) || KINDS[0];

  const save = async () => {
    setError(null);
    if (!key) return setError('Give it a name first.');
    if (clash) return setError('This collection already has a property called "' + key + '".');
    if (needsTarget && !target) return setError('Say which collection it points at.');
    const field = { key, type: kind };
    if (needsOptions) {
      const list = options.split(',').map(o => o.trim()).filter(Boolean);
      if (!list.length) return setError('List the choices, separated by commas.');
      field.options = list;
    }
    if (needsTarget) field.target = target;
    setBusy(true);
    try {
      // `actor` rides BESIDE the field, and the route destructures it off — it is who is adding
      // the property, never a property of it. Spreading it into the field 400'd every add for the
      // whole build (docs/decisions.md, 2026-08-20).
      await api.addField(collection.id, { ...field, actor });
      onDone && onDone(field);
    } catch (e) {
      // The route's message names what is wrong and, for a bad type, the whole legal set. Show it
      // verbatim rather than replacing it with something friendlier and less useful.
      setError(e.message);
    } finally { setBusy(false); }
  };

  const onKeyDown = e => {
    if (picking) return;
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel && onCancel(); }
  };

  return (
    <div onKeyDown={onKeyDown}
      style={{
        ...sx('display:flex;flex-direction:column;gap:8px;margin:2px 0;padding:8px;border-radius:7px'),
        background: 'var(--surface-2)', border: '1px solid var(--border-2)',
      }}>
      <div style={sx('display:flex;align-items:center;gap:8px;flex-wrap:wrap')}>
        {/* The type button IS the gutter icon of the row this will become. */}
        <div style={sx('position:relative;flex:none')}>
          <button type="button" onClick={() => setPicking(v => !v)} className="hBd"
            title="What kind of thing is it?"
            style={{
              ...sx('display:flex;align-items:center;gap:7px;height:26px;padding:0 9px;border-radius:6px;cursor:pointer'),
              background: 'var(--ink)', border: '1px solid ' + (picking ? 'var(--border-3)' : 'var(--border-2)'), color: 'var(--fg-soft)',
            }}>
            <FieldIcon type={kind} size={14} />
            <span style={sx('font-size:11.5px;font-weight:500')}>{chosen.label}</span>
            <span style={{ ...mono('font-size:8px'), color: 'var(--fg-faint)' }}>▾</span>
          </button>
          {picking ? (
            <TypePicker value={kind} onDismiss={() => setPicking(false)}
              onPick={t => { setKind(t); setPicking(false); }} />
          ) : null}
        </div>

        <Input value={label} autoFocus placeholder="Property name" onChange={e => setLabel(e.target.value)}
          style={sx('flex:1;min-width:150px;height:26px;padding:0 10px;font-size:12px')} />

        <Btn variant="primary" size="sm" onClick={save} busy={busy}>{busy ? 'Adding…' : 'Add'}</Btn>
        <Btn variant="ghost" size="sm" onClick={onCancel}>Cancel</Btn>
      </div>

      {/* Everything below only appears when the chosen type actually needs it. The old dialog
          showed the explanation whether or not it applied, which is most of why it was long. */}
      {needsOptions ? (
        <Input value={options} placeholder="The choices, separated by commas — needs review, shortlist, contacted"
          onChange={e => setOptions(e.target.value)}
          style={sx('height:26px;padding:0 10px;font-size:12px')} />
      ) : null}

      {needsTarget ? (
        <div style={sx('display:flex;align-items:center;gap:6px;flex-wrap:wrap')}>
          <span style={{ ...sx('font-size:11px'), color: 'var(--fg-faint)' }}>Pointing at</span>
          {collections.filter(c => c.id !== collection?.id).map(c => (
            <button key={c.id} type="button" onClick={() => setTarget(c.id)} className="hBd"
              style={{
                ...mono('height:24px;padding:0 9px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer'),
                background: target === c.id ? 'var(--raise)' : 'transparent',
                border: '1px solid ' + (target === c.id ? 'var(--border-3)' : 'var(--border)'),
                color: target === c.id ? 'var(--fg)' : 'var(--fg-muted)',
              }}>#{c.id}</button>
          ))}
        </div>
      ) : null}

      <div style={sx('display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:14px')}>
        {error ? (
          <span style={{ ...sx('font-size:11px;line-height:1.5'), color: 'var(--danger)' }}>{error}</span>
        ) : (
          <>
            {key ? (
              <span style={{ ...mono('font-size:10px'), color: clash ? 'var(--danger)' : 'var(--fg-faint)' }}>
                saved as {key}{clash ? ' — already taken' : ''}
              </span>
            ) : null}
            <span style={{ ...sx('font-size:11px'), color: 'var(--fg-faint)' }}>
              {chosen.hint} It stays empty on the records you already have.
            </span>
          </>
        )}
      </div>
    </div>
  );
}
