// `+ Add property` — the last piece of T04, and the human half of Law 9.
//
// A field is a SCHEMA change, and `docs/02_DATA_MODEL.md` §6 says every schema change is a
// proposal. That rule is about **agents**: an agent proposes and lands a card in DECIDE. The human
// is the disposer, so when she adds a field she is not proposing to herself — the field is
// created. Both paths end in the same `saveCollection`, so there is one schema writer either way.
//
// Deliberately small. `docs/04_AGENT_CONTRACT.md` §4 says never change a field's type on live data,
// so this only adds; retiring and re-typing are separate, and neither belongs behind a `+` button.
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
import { Btn, Eyebrow, Field, Input } from './ui';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// Plain-language names, because the person adding a column is not thinking in field types. The
// value on the right is the type from docs/02_DATA_MODEL.md §2 and nowhere else — an agent
// proposing a type outside that set gets a 400 naming the legal set, and so should this.
const KINDS = [
  { type: 'text', label: 'Words', hint: 'A name, a note, anything typed.' },
  { type: 'number', label: 'A number', hint: 'A score, a count, an amount.' },
  { type: 'select', label: 'One of a few choices', hint: 'Pick a single option from a list you set.' },
  { type: 'multiselect', label: 'Any number of tags', hint: 'Several labels at once.' },
  { type: 'status', label: 'A stage', hint: 'Where something has got to. Drives the board columns.' },
  { type: 'date', label: 'A date', hint: 'When something happened.' },
  { type: 'checkbox', label: 'Yes or no', hint: 'A simple flag.' },
  { type: 'url', label: 'A link', hint: 'Opens in the browser.' },
  { type: 'email', label: 'An email address', hint: '' },
  { type: 'phone', label: 'A phone number', hint: '' },
  { type: 'relation', label: 'A link to another record', hint: 'Points at something in another collection.' },
  { type: 'file', label: 'A file', hint: 'A screenshot or a PDF.' },
  { type: 'actor', label: 'Who is on it', hint: 'A person or one of your assistants.' },
];

const keyify = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export default function AddField({ collection, onDone, onCancel, actor = 'crystal' }) {
  const [label, setLabel] = React.useState('');
  const [kind, setKind] = React.useState('text');
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
      await api.addField(collection.id, { ...field, actor });
      onDone && onDone(field);
    } catch (e) {
      // The route's message names what is wrong and, for a bad type, the whole legal set. Show it
      // verbatim rather than replacing it with something friendlier and less useful.
      setError(e.message);
    } finally { setBusy(false); }
  };

  return (
    <div style={sx('position:absolute;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:40px;background:rgba(10,11,14,.66)')}>
      <div style={sx('width:100%;max-width:520px;max-height:100%;overflow-y:auto;padding:22px 24px;border-radius:12px;background:var(--surface-2);border:1px solid var(--border-3);box-shadow:0 24px 48px rgba(0,0,0,.45)')}>
        <Eyebrow style={sx('font-size:8.5px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>
          NEW PROPERTY ON #{collection?.id}
        </Eyebrow>
        <div style={sx('font-size:12.5px;color:var(--fg-muted);line-height:1.6;margin:10px 0 18px')}>
          Everyone sees this column from now on, and it stays empty on the records you already have —
          adding a property never rewrites them.
        </div>

        <Field label="What is it called?">
          <Input value={label} autoFocus placeholder="On camera" onChange={e => setLabel(e.target.value)} />
        </Field>
        {key ? (
          <div style={{ ...mono('font-size:10px;margin:-6px 0 14px'), color: clash ? 'var(--danger)' : 'var(--fg-faint)' }}>
            saved as {key}{clash ? ' — already taken' : ''}
          </div>
        ) : null}

        <Field label="What kind of thing?">
          <div style={sx('display:flex;flex-wrap:wrap;gap:6px;margin-top:4px')}>
            {KINDS.map(k => (
              <button key={k.type} type="button" onClick={() => setKind(k.type)} title={k.hint}
                style={{
                  ...sx('padding:6px 11px;border-radius:6px;font-size:11.5px;font-weight:' + (kind === k.type ? 600 : 500) + ';cursor:pointer;transition:background 130ms ease,border-color 130ms ease'),
                  background: kind === k.type ? 'var(--raise)' : 'transparent',
                  border: '1px solid ' + (kind === k.type ? 'var(--border-3)' : 'var(--border)'),
                  color: kind === k.type ? 'var(--fg)' : 'var(--fg-muted)',
                }}>{k.label}</button>
            ))}
          </div>
        </Field>
        <div style={sx('font-size:12px;color:var(--fg-faint);line-height:1.6;margin:8px 0 16px')}>
          {(KINDS.find(k => k.type === kind) || {}).hint}
        </div>

        {needsOptions ? (
          <Field label="The choices" hint="Separated by commas.">
            <Input value={options} placeholder="needs review, shortlist, contacted" onChange={e => setOptions(e.target.value)} />
          </Field>
        ) : null}

        {needsTarget ? (
          <Field label="Pointing at which collection?">
            <div style={sx('display:flex;flex-wrap:wrap;gap:6px;margin-top:4px')}>
              {collections.filter(c => c.id !== collection?.id).map(c => (
                <button key={c.id} type="button" onClick={() => setTarget(c.id)}
                  style={{
                    ...mono('padding:6px 11px;border-radius:6px;font-size:11.5px;font-weight:600;cursor:pointer'),
                    background: target === c.id ? 'var(--raise)' : 'transparent',
                    border: '1px solid ' + (target === c.id ? 'var(--border-3)' : 'var(--border)'),
                    color: target === c.id ? 'var(--fg)' : 'var(--fg-muted)',
                  }}>#{c.id}</button>
              ))}
            </div>
          </Field>
        ) : null}

        {error ? (
          <div style={sx('margin:12px 0 0;padding:9px 12px;border-radius:8px;background:var(--surface);border:1px solid var(--danger);color:var(--danger);font-size:12px;line-height:1.5')}>
            {error}
          </div>
        ) : null}

        <div style={sx('display:flex;align-items:center;gap:10px;margin-top:20px')}>
          <Btn variant="primary" onClick={save} busy={busy}>{busy ? 'Adding…' : 'Add it'}</Btn>
          <Btn onClick={onCancel}>Cancel</Btn>
        </div>
      </div>
    </div>
  );
}
